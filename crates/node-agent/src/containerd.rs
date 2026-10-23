//! Privileged containerd adapter. nerdctl is a pinned low-level client, never an orchestrator.
use async_trait::async_trait;
use platform_domain::ImageDigest;
use platform_runtime::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{io::AsyncReadExt, process::Command};
use uuid::Uuid;

pub struct Containerd {
    pub root: PathBuf,
    pub node: Uuid,
}
#[derive(Serialize, Deserialize)]
struct Record {
    generation: u64,
    epoch: u64,
    image: ImageDigest,
}
fn failure() -> RuntimeError {
    RuntimeError::Failed(Uuid::new_v4())
}
impl Containerd {
    pub fn new(root: PathBuf, node: Uuid) -> Self {
        Self { root, node }
    }
    pub async fn command(&self, args: &[String]) -> Result<Vec<u8>, RuntimeError> {
        let mut child = Command::new("nerdctl")
            .args([
                "--namespace",
                "local-paas",
                "--cgroup-manager",
                "cgroupfs",
                "--userns-remap",
                "workload:workload",
            ])
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|_| failure())?;
        let stdout = child.stdout.take().ok_or_else(failure)?;
        let stderr = child.stderr.take().ok_or_else(failure)?;
        tokio::time::timeout(Duration::from_secs(300), async {
            let mut out = Vec::new();
            let mut err = Vec::new();
            let mut stdout = stdout.take(1048577);
            let mut stderr = stderr.take(65537);
            let (a, b, c) = tokio::join!(
                stdout.read_to_end(&mut out),
                stderr.read_to_end(&mut err),
                child.wait()
            );
            a.map_err(|_| failure())?;
            b.map_err(|_| failure())?;
            let status = c.map_err(|_| failure())?;
            if !status.success() || out.len() > 1048576 {
                if String::from_utf8_lossy(&err).contains("no such container")
                    || String::from_utf8_lossy(&err).contains("no such object")
                {
                    return Err(RuntimeError::NotFound);
                }
                // No raw runtime diagnostics go to platform logs.
                let _ = tokio::fs::write(self.root.join("last-runtime-error"), &err).await;
                return Err(failure());
            }
            Ok(out)
        })
        .await
        .map_err(|_| failure())?
    }
    pub async fn info(&self, id: Uuid) -> Result<Value, RuntimeError> {
        let bytes = self.command(&["inspect".into(), id.to_string()]).await?;
        let array: Value = serde_json::from_slice(&bytes).map_err(|_| failure())?;
        array
            .as_array()
            .and_then(|a| a.first())
            .cloned()
            .ok_or(RuntimeError::NotFound)
    }
    async fn record(&self, id: Uuid) -> Result<Record, RuntimeError> {
        serde_json::from_slice(
            &tokio::fs::read(self.root.join(format!("{id}.json")))
                .await
                .map_err(|e| {
                    if e.kind() == std::io::ErrorKind::NotFound {
                        RuntimeError::NotFound
                    } else {
                        failure()
                    }
                })?,
        )
        .map_err(|_| failure())
    }
    async fn fence(&self, op: &Operation) -> Result<Record, RuntimeError> {
        let mut record = self.record(op.instance_id).await?;
        if op.controller_epoch < record.epoch || op.generation < record.generation {
            return Err(RuntimeError::StaleOperation);
        }
        record.generation = op.generation;
        record.epoch = op.controller_epoch;
        self.save(op.instance_id, &record).await?;
        Ok(record)
    }
    async fn save(&self, id: Uuid, r: &Record) -> Result<(), RuntimeError> {
        let temp = self.root.join(format!("{id}.tmp"));
        let dest = self.root.join(format!("{id}.json"));
        tokio::fs::write(&temp, serde_json::to_vec(r).map_err(|_| failure())?)
            .await
            .map_err(|_| failure())?;
        let file = tokio::fs::OpenOptions::new()
            .write(true)
            .open(&temp)
            .await
            .map_err(|_| failure())?;
        file.sync_all().await.map_err(|_| failure())?;
        tokio::fs::rename(temp, dest).await.map_err(|_| failure())?;
        tokio::fs::File::open(&self.root)
            .await
            .map_err(|_| failure())?
            .sync_all()
            .await
            .map_err(|_| failure())?;
        Ok(())
    }
    pub fn logfile(&self, id: Uuid) -> PathBuf {
        self.root.join("logs").join(format!("{id}.json"))
    }
}
#[async_trait]
impl Runtime for Containerd {
    async fn prepare(&self, op: &Operation, spec: &PrepareSpec) -> Result<(), RuntimeError> {
        if spec.identity.instance != op.instance_id
            || spec.identity.node != self.node
            || !spec.secret_names.is_empty()
            || !spec.mounts.is_empty()
        {
            return Err(failure());
        }
        match self.record(op.instance_id).await {
            Ok(r) => {
                if r.image != spec.image {
                    return Err(RuntimeError::StaleOperation);
                }
                self.fence(op).await?;
            }
            Err(RuntimeError::NotFound) => {
                self.save(
                    op.instance_id,
                    &Record {
                        generation: op.generation,
                        epoch: op.controller_epoch,
                        image: spec.image.clone(),
                    },
                )
                .await?;
            }
            Err(error) => return Err(error),
        }
        match self.info(op.instance_id).await {
            Ok(_) => return Ok(()),
            Err(RuntimeError::NotFound) => {}
            Err(e) => return Err(e),
        }
        if !spec
            .registry_repository
            .starts_with("127.0.0.1:15000/platform/")
            || !spec
                .registry_repository
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b":/.-".contains(&c))
        {
            return Err(failure());
        }
        let image = format!(
            "{}@{}",
            spec.registry_repository,
            String::from(spec.image.clone())
        );
        self.command(&["pull".into(), image.clone()]).await?;
        let port = spec.network.declared_port;
        let published = spec.network.published_port;
        // All writable application storage is bounded tmpfs. Default seccomp remains on.
        let mut args: Vec<String> = ["create", "--name"]
            .into_iter()
            .map(str::to_string)
            .collect();
        args.push(op.instance_id.to_string());
        for (flag, value) in [
            ("--user", "1000:1000".to_string()),
            ("--cap-drop", "ALL".into()),
            ("--security-opt", "no-new-privileges".into()),
            ("--security-opt", "apparmor=local-paas".into()),
            ("--network", "workloads".into()),
            (
                "--cpus",
                format!("{:.3}", spec.limits.resources.cpu_millis as f64 / 1000.0),
            ),
            ("--memory", format!("{}m", spec.limits.resources.memory_mib)),
            (
                "--memory-swap",
                format!("{}m", spec.limits.resources.memory_mib),
            ),
            ("--pids-limit", spec.limits.pids.to_string()),
            (
                "--tmpfs",
                "/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777".into(),
            ),
            (
                "--tmpfs",
                "/run:rw,noexec,nosuid,nodev,size=16m,mode=755".into(),
            ),
            ("--shm-size", "16m".into()),
            ("--device-read-bps", "/dev/vda:20971520".into()),
            ("--device-write-bps", "/dev/vda:20971520".into()),
            ("--ulimit", "core=0".into()),
            ("--publish", format!("0.0.0.0:{published}:{port}")),
            ("--log-driver", "json-file".into()),
            ("--log-opt", "max-size=1m".into()),
            ("--log-opt", "max-file=2".into()),
            (
                "--log-opt",
                format!("log-path={}", self.logfile(op.instance_id).display()),
            ),
            ("--env", format!("PORT={port}")),
            ("--env", "HOST=0.0.0.0".into()),
            ("--env", "HOSTNAME=0.0.0.0".into()),
            ("--env", "XDG_CACHE_HOME=/tmp/.cache".into()),
            (
                "--label",
                format!("platform.project={}", spec.identity.project),
            ),
            (
                "--label",
                format!("platform.environment={}", spec.identity.environment),
            ),
            (
                "--label",
                format!("platform.service={}", spec.identity.service),
            ),
            (
                "--label",
                format!("platform.revision={}", spec.identity.revision),
            ),
            (
                "--label",
                format!("platform.instance={}", spec.identity.instance),
            ),
            ("--label", format!("platform.node={}", spec.identity.node)),
        ] {
            args.push(flag.into());
            args.push(value);
        }
        args.extend(["--read-only".into(), "--no-healthcheck".into(), image]);
        self.command(&args).await?;
        Ok(())
    }
    async fn start(&self, op: &Operation) -> Result<(), RuntimeError> {
        self.fence(op).await?;
        let info = self.info(op.instance_id).await?;
        if info["State"]["Running"] == true {
            return Ok(());
        }
        self.command(&["start".into(), op.instance_id.to_string()])
            .await?;
        Ok(())
    }
    async fn stop(&self, op: &Operation, grace: Duration) -> Result<(), RuntimeError> {
        self.fence(op).await?;
        match self.info(op.instance_id).await {
            Ok(_) => {
                self.command(&[
                    "stop".into(),
                    "--time".into(),
                    grace.as_secs().min(60).to_string(),
                    op.instance_id.to_string(),
                ])
                .await?;
            }
            Err(RuntimeError::NotFound) => {}
            Err(e) => return Err(e),
        }
        Ok(())
    }
    async fn kill(&self, op: &Operation) -> Result<(), RuntimeError> {
        self.fence(op).await?;
        self.command(&["kill".into(), op.instance_id.to_string()])
            .await?;
        Ok(())
    }
    async fn inspect(&self, id: Uuid) -> Result<Observation, RuntimeError> {
        let r = self.record(id).await?;
        let info = self.info(id).await?;
        Ok(Observation {
            instance_id: id,
            generation: r.generation,
            state: if info["State"]["Running"] == true {
                InstanceState::Starting
            } else {
                InstanceState::Stopped
            },
            image: r.image,
            exit_code: info["State"]["ExitCode"].as_i64().map(|n| n as i32),
        })
    }
    async fn exec(&self, _: &Operation, _: ExecRequest) -> Result<ExecOutput, RuntimeError> {
        Err(RuntimeError::Unsupported)
    }
    async fn stream_logs(&self, id: Uuid, request: LogRequest) -> Result<LogStream, RuntimeError> {
        if request.follow {
            return Err(RuntimeError::Unsupported);
        }
        let info = self.info(id).await?;
        let labels: BTreeMap<String, String> = info["Config"]["Labels"]
            .as_object()
            .map(|o| {
                o.iter()
                    .filter_map(|(k, v)| {
                        Some((
                            k.strip_prefix("platform.")?.to_string(),
                            v.as_str()?.to_string(),
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let entries = crate::read_logs(&self.logfile(id)).await;
        let after = request
            .cursor
            .as_ref()
            .and_then(|c| entries.iter().position(|e| &e.key == c))
            .map(|i| i + 1)
            .unwrap_or(0);
        let mut remaining = request.max_bytes.min(65536);
        let entries: Vec<_> = entries
            .into_iter()
            .skip(after)
            .take_while(|e| {
                if e.line.len() > remaining {
                    return false;
                }
                remaining -= e.line.len();
                true
            })
            .map(|e| {
                Ok(platform_runtime::LogEntry {
                    cursor: e.key,
                    stderr: e.stream == "stderr",
                    bytes: e.line.into_bytes(),
                    labels: labels.clone(),
                })
            })
            .collect();
        Ok(Box::pin(futures_util::stream::iter(entries)))
    }

    async fn destroy(&self, op: &Operation) -> Result<(), RuntimeError> {
        self.fence(op).await?;
        match self.info(op.instance_id).await {
            Ok(_) => {
                self.command(&["rm".into(), "--force".into(), op.instance_id.to_string()])
                    .await?;
            }
            Err(RuntimeError::NotFound) => {}
            Err(e) => return Err(e),
        }
        Ok(())
    }
}

pub async fn cgroup(pid: u64) -> Option<PathBuf> {
    let text = tokio::fs::read_to_string(format!("/proc/{pid}/cgroup"))
        .await
        .ok()?;
    let path = text.lines().find_map(|l| l.strip_prefix("0::"))?;
    if !path.starts_with('/') || path.contains("..") {
        return None;
    }
    Some(Path::new("/sys/fs/cgroup").join(path.trim_start_matches('/')))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn durable_generation_fencing_survives_reopening_the_adapter() {
        let dir = tempfile::tempdir().unwrap();
        let node = Uuid::new_v4();
        let id = Uuid::new_v4();
        let runtime = Containerd::new(dir.path().into(), node);
        runtime
            .save(
                id,
                &Record {
                    generation: 7,
                    epoch: 2,
                    image: format!("sha256:{}", "a".repeat(64)).try_into().unwrap(),
                },
            )
            .await
            .unwrap();
        let reopened = Containerd::new(dir.path().into(), node);
        let mut op = Operation {
            id: Uuid::new_v4(),
            instance_id: id,
            generation: 6,
            controller_epoch: 2,
        };
        assert!(matches!(
            reopened.fence(&op).await,
            Err(RuntimeError::StaleOperation)
        ));
        op.generation = 8;
        op.controller_epoch = 1;
        assert!(matches!(
            reopened.fence(&op).await,
            Err(RuntimeError::StaleOperation)
        ));
        op.controller_epoch = 2;
        reopened.fence(&op).await.unwrap();
        reopened.fence(&op).await.unwrap();
        assert_eq!(reopened.record(id).await.unwrap().generation, 8);
        tokio::fs::write(dir.path().join(format!("{id}.json")), "broken")
            .await
            .unwrap();
        assert!(matches!(
            reopened.record(id).await,
            Err(RuntimeError::Failed(_))
        ));
    }
}
