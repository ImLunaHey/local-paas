//! Persist restart reservations before starting a process. Agent restarts cannot
//! reset a crash loop's budget. A new deployment receives a new instance identity.
use platform_domain::RecoveryPolicy;
use serde::{Deserialize, Serialize};
use std::{io, path::Path, time::Duration};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

#[derive(Debug, PartialEq, Eq)]
pub enum Gate {
    Wait,
    Start,
    Exhausted,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Recovery {
    attempts: u8,
    retry_at_ms: Option<i64>,
}
impl Recovery {
    pub async fn load(root: &Path, id: Uuid) -> io::Result<Self> {
        let state: Self = match tokio::fs::read(root.join(format!("{id}.recovery.json"))).await {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(io::Error::other)?,
            Err(e) if e.kind() == io::ErrorKind::NotFound => Self::default(),
            Err(e) => return Err(e),
        };
        if state.attempts > 20 || state.retry_at_ms.is_some_and(|t| t < 0) {
            return Err(io::Error::other("invalid restart budget"));
        }
        Ok(state)
    }
    async fn save(&self, root: &Path, id: Uuid) -> io::Result<()> {
        let destination = root.join(format!("{id}.recovery.json"));
        let temporary = root.join(format!("{id}.recovery.tmp"));
        let mut file = tokio::fs::File::create(&temporary).await?;
        file.write_all(&serde_json::to_vec(self).map_err(io::Error::other)?)
            .await?;
        file.sync_all().await?;
        tokio::fs::rename(temporary, destination).await?;
        tokio::fs::File::open(root).await?.sync_all().await
    }
    pub async fn before_start(
        &mut self,
        root: &Path,
        id: Uuid,
        now_ms: i64,
        policy: &RecoveryPolicy,
    ) -> io::Result<Gate> {
        let max_delay_ms = i64::from(policy.max_backoff_seconds) * 1000;
        if let Some(deadline) = self.retry_at_ms {
            // A wall-clock correction must neither hang recovery forever nor
            // refund a reservation. Rebase only the deadline, never the budget.
            if deadline > now_ms.saturating_add(max_delay_ms) {
                self.retry_at_ms = Some(now_ms.saturating_add(max_delay_ms));
                self.save(root, id).await?;
                return Ok(Gate::Wait);
            }
            if deadline > now_ms {
                return Ok(Gate::Wait);
            }
            self.retry_at_ms = None;
            self.save(root, id).await?;
            return Ok(Gate::Start);
        }
        if self.attempts >= policy.restart_attempts {
            return Ok(Gate::Exhausted);
        }
        let shift = u32::from(self.attempts.min(20));
        let delay = (i64::from(policy.initial_backoff_seconds) * 1000)
            .saturating_mul(1_i64 << shift)
            .min(max_delay_ms);
        self.attempts += 1;
        self.retry_at_ms = Some(now_ms.saturating_add(delay));
        self.save(root, id).await?;
        Ok(Gate::Wait)
    }
    pub async fn healthy(
        &mut self,
        root: &Path,
        id: Uuid,
        stable_for: Duration,
        policy: &RecoveryPolicy,
    ) -> io::Result<()> {
        if stable_for >= Duration::from_secs(u64::from(policy.reset_after_seconds))
            && (self.attempts > 0 || self.retry_at_ms.is_some())
        {
            self.attempts = 0;
            self.retry_at_ms = None;
            self.save(root, id).await?;
        }
        Ok(())
    }

    pub fn attempts(&self) -> u8 {
        self.attempts
    }

    pub fn retry_at_ms(&self) -> Option<i64> {
        self.retry_at_ms
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn reservations_survive_restarts_and_exhaust_without_extra_starts() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let id = Uuid::now_v7();
        let policy = RecoveryPolicy::default();
        let mut now = 1_000_000;
        for delay in [5_000, 10_000, 20_000, 40_000, 60_000] {
            let mut state = Recovery::load(root, id).await.unwrap();
            assert_eq!(
                state.before_start(root, id, now, &policy).await.unwrap(),
                Gate::Wait
            );
            let mut state = Recovery::load(root, id).await.unwrap();
            assert_eq!(
                state
                    .before_start(root, id, now + delay - 1, &policy)
                    .await
                    .unwrap(),
                Gate::Wait
            );
            now += delay;
            assert_eq!(
                state.before_start(root, id, now, &policy).await.unwrap(),
                Gate::Start
            );
        }
        let mut state = Recovery::load(root, id).await.unwrap();
        assert_eq!(
            state.before_start(root, id, now, &policy).await.unwrap(),
            Gate::Exhausted
        );
        state
            .healthy(root, id, Duration::from_secs(599), &policy)
            .await
            .unwrap();
        assert_eq!(
            state.before_start(root, id, now, &policy).await.unwrap(),
            Gate::Exhausted
        );
        state
            .healthy(root, id, Duration::from_secs(600), &policy)
            .await
            .unwrap();
        let mut state = Recovery::load(root, id).await.unwrap();
        assert_eq!(
            state.before_start(root, id, now, &policy).await.unwrap(),
            Gate::Wait
        );
    }
    #[tokio::test]
    async fn interrupted_start_consumes_reservation_and_clock_reversal_is_bounded() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let id = Uuid::now_v7();
        let policy = RecoveryPolicy::default();
        let mut state = Recovery::load(root, id).await.unwrap();
        state
            .before_start(root, id, 1_000_000, &policy)
            .await
            .unwrap();
        assert_eq!(
            state.before_start(root, id, 0, &policy).await.unwrap(),
            Gate::Wait
        );
        assert_eq!(
            state.before_start(root, id, 60_000, &policy).await.unwrap(),
            Gate::Start
        );
        let mut state = Recovery::load(root, id).await.unwrap();
        assert_eq!(
            state.before_start(root, id, 60_000, &policy).await.unwrap(),
            Gate::Wait
        );
        assert_eq!(state.attempts, 2);
        tokio::fs::write(root.join(format!("{id}.recovery.json")), b"broken")
            .await
            .unwrap();
        assert!(Recovery::load(root, id).await.is_err());
    }

    #[tokio::test]
    async fn configured_budget_backoff_and_stabilization_are_enforced() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let id = Uuid::now_v7();
        let policy = RecoveryPolicy {
            restart_attempts: 1,
            initial_backoff_seconds: 2,
            max_backoff_seconds: 2,
            reset_after_seconds: 30,
            replacement_attempts: 0,
            replacement_backoff_seconds: 1,
        };
        let mut state = Recovery::load(root, id).await.unwrap();
        assert_eq!(
            state.before_start(root, id, 10_000, &policy).await.unwrap(),
            Gate::Wait
        );
        assert_eq!(state.retry_at_ms(), Some(12_000));
        assert_eq!(
            state.before_start(root, id, 12_000, &policy).await.unwrap(),
            Gate::Start
        );
        assert_eq!(
            state.before_start(root, id, 12_000, &policy).await.unwrap(),
            Gate::Exhausted
        );
        state
            .healthy(root, id, Duration::from_secs(30), &policy)
            .await
            .unwrap();
        assert_eq!(state.attempts(), 0);
    }
}
