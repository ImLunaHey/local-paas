//! Reserve a single start durably. Ambiguous starts require an explicit new run;
//! neither a controller retry nor an agent restart may repeat external effects.
use crate::{containerd::Containerd, now_millis};
use platform_protocol::{JobExecution, JobOutcome, JobResult};
use platform_runtime::{Operation, PrepareSpec, Runtime, RuntimeError};
use serde::{Deserialize, Serialize};
use std::{io, path::Path};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    deadline_unix_ms: i64,
    result: Option<JobResult>,
}
impl Journal {
    async fn load(root: &Path, id: Uuid) -> io::Result<Option<Self>> {
        match tokio::fs::read(root.join(format!("{id}.job.json"))).await {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(io::Error::other),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }
    async fn save(&self, root: &Path, id: Uuid) -> io::Result<()> {
        let temporary = root.join(format!("{id}.job.tmp"));
        let mut file = tokio::fs::File::create(&temporary).await?;
        file.write_all(&serde_json::to_vec(self).map_err(io::Error::other)?)
            .await?;
        file.sync_all().await?;
        tokio::fs::rename(temporary, root.join(format!("{id}.job.json"))).await?;
        tokio::fs::File::open(root).await?.sync_all().await
    }
}

pub async fn step(
    runtime: &Containerd,
    op: &Operation,
    spec: &PrepareSpec,
    job: &JobExecution,
) -> Result<Option<JobResult>, ()> {
    let previous = Journal::load(&runtime.root, op.instance_id)
        .await
        .map_err(|_| ())?;
    let fresh = previous.is_none();
    let mut journal = previous.unwrap_or(Journal {
        deadline_unix_ms: job.deadline_unix_ms,
        result: None,
    });
    if journal.result.is_some() {
        return Ok(journal.result);
    }
    if fresh {
        // This reservation deliberately precedes preparation as well as start.
        // A crash between reservation and start loses a run, never duplicates it.
        journal
            .save(&runtime.root, op.instance_id)
            .await
            .map_err(|_| ())?;
        if now_millis() >= journal.deadline_unix_ms {
            journal.result = Some(JobResult {
                outcome: JobOutcome::TimedOut,
                exit_code: None,
            });
        } else if runtime.prepare(op, spec).await.is_err() {
            journal.result = Some(JobResult {
                outcome: JobOutcome::Failed,
                exit_code: None,
            });
        } else if now_millis() >= journal.deadline_unix_ms {
            journal.result = Some(JobResult {
                outcome: JobOutcome::TimedOut,
                exit_code: None,
            });
        } else if runtime.start(op).await.is_err() {
            // The runtime might have accepted start before its response was lost.
            // The controller must stop/confirm cleanup before allowing another run.
            journal.result = Some(JobResult {
                outcome: JobOutcome::Unknown,
                exit_code: None,
            });
        } else {
            return Ok(None);
        }
    } else {
        match runtime.info(op.instance_id).await {
            Ok(info) if info["State"]["Running"] == true => {
                if now_millis() < journal.deadline_unix_ms {
                    return Ok(None);
                }
                runtime.kill(op).await.map_err(|_| ())?;
                journal.result = Some(JobResult {
                    outcome: JobOutcome::TimedOut,
                    exit_code: None,
                });
            }
            Ok(info) => {
                let late = info["State"]["FinishedAt"]
                    .as_str()
                    .and_then(|s| s.parse::<chrono::DateTime<chrono::Utc>>().ok())
                    .is_some_and(|t| t.timestamp_millis() > journal.deadline_unix_ms);
                journal.result = Some(if late {
                    JobResult {
                        outcome: JobOutcome::TimedOut,
                        exit_code: None,
                    }
                } else {
                    exited(&info)
                });
            }
            Err(RuntimeError::NotFound) => {
                journal.result = Some(JobResult {
                    outcome: JobOutcome::Unknown,
                    exit_code: None,
                })
            }
            Err(_) => return Err(()),
        }
    }
    journal
        .save(&runtime.root, op.instance_id)
        .await
        .map_err(|_| ())?;
    Ok(journal.result)
}

fn exited(info: &serde_json::Value) -> JobResult {
    // A created-but-never-started container also has ExitCode=0. It is not success.
    let started = crate::process_started_at(info).is_some();
    let exit_code = info["State"]["ExitCode"]
        .as_i64()
        .and_then(|n| i32::try_from(n).ok())
        .filter(|_| started);
    JobResult {
        outcome: match exit_code {
            Some(0) => JobOutcome::Succeeded,
            Some(_) => JobOutcome::Failed,
            None => JobOutcome::Unknown,
        },
        exit_code,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[tokio::test]
    async fn reservation_and_result_survive_restarts_and_corruption_fails_closed() {
        let dir = tempfile::tempdir().unwrap();
        let id = Uuid::now_v7();
        assert!(Journal::load(dir.path(), id).await.unwrap().is_none());
        let mut journal = Journal {
            deadline_unix_ms: 12345,
            result: None,
        };
        journal.save(dir.path(), id).await.unwrap();
        let restored = Journal::load(dir.path(), id).await.unwrap().unwrap();
        assert_eq!(restored.deadline_unix_ms, 12345);
        assert!(restored.result.is_none()); // Reserved, never eligible for another start.
        journal.result = Some(JobResult {
            outcome: JobOutcome::Failed,
            exit_code: Some(7),
        });
        journal.save(dir.path(), id).await.unwrap();
        assert_eq!(
            Journal::load(dir.path(), id).await.unwrap().unwrap().result,
            journal.result
        );
        tokio::fs::write(dir.path().join(format!("{id}.job.json")), b"broken")
            .await
            .unwrap();
        assert!(Journal::load(dir.path(), id).await.is_err());
    }
    #[test]
    fn exit_zero_requires_evidence_that_the_process_started() {
        assert_eq!(
            exited(&json!({"State":{"StartedAt":"0001-01-01T00:00:00Z","ExitCode":0}})).outcome,
            JobOutcome::Unknown
        );
        assert_eq!(
            exited(&json!({"State":{"StartedAt":"2020-01-01T00:00:00Z","ExitCode":0}})).outcome,
            JobOutcome::Succeeded
        );
        assert_eq!(
            exited(&json!({"State":{"StartedAt":"2020-01-01T00:00:00Z","ExitCode":9}})).exit_code,
            Some(9)
        );
    }
}
