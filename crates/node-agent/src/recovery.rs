//! Persist restart reservations before starting a process. Agent restarts cannot
//! reset a crash loop's budget. A new deployment receives a new instance identity.
use serde::{Deserialize, Serialize};
use std::{io, path::Path, time::Duration};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;
const LIMIT: u8 = 5;
const MAX_DELAY_MS: i64 = 60_000;

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
        if state.attempts > LIMIT || state.retry_at_ms.is_some_and(|t| t < 0) {
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
    pub async fn before_start(&mut self, root: &Path, id: Uuid, now_ms: i64) -> io::Result<Gate> {
        if let Some(deadline) = self.retry_at_ms {
            // A wall-clock correction must neither hang recovery forever nor
            // refund a reservation. Rebase only the deadline, never the budget.
            if deadline > now_ms.saturating_add(MAX_DELAY_MS) {
                self.retry_at_ms = Some(now_ms.saturating_add(MAX_DELAY_MS));
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
        if self.attempts >= LIMIT {
            return Ok(Gate::Exhausted);
        }
        let delay = (5_000i64 << self.attempts).min(MAX_DELAY_MS);
        self.attempts += 1;
        self.retry_at_ms = Some(now_ms.saturating_add(delay));
        self.save(root, id).await?;
        Ok(Gate::Wait)
    }
    pub async fn healthy(&mut self, root: &Path, id: Uuid, stable_for: Duration) -> io::Result<()> {
        if stable_for >= Duration::from_secs(600)
            && (self.attempts > 0 || self.retry_at_ms.is_some())
        {
            self.attempts = 0;
            self.retry_at_ms = None;
            self.save(root, id).await?;
        }
        Ok(())
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
        let mut now = 1_000_000;
        for delay in [5_000, 10_000, 20_000, 40_000, 60_000] {
            let mut state = Recovery::load(root, id).await.unwrap();
            assert_eq!(state.before_start(root, id, now).await.unwrap(), Gate::Wait);
            let mut state = Recovery::load(root, id).await.unwrap();
            assert_eq!(
                state.before_start(root, id, now + delay - 1).await.unwrap(),
                Gate::Wait
            );
            now += delay;
            assert_eq!(
                state.before_start(root, id, now).await.unwrap(),
                Gate::Start
            );
        }
        let mut state = Recovery::load(root, id).await.unwrap();
        assert_eq!(
            state.before_start(root, id, now).await.unwrap(),
            Gate::Exhausted
        );
        state
            .healthy(root, id, Duration::from_secs(599))
            .await
            .unwrap();
        assert_eq!(
            state.before_start(root, id, now).await.unwrap(),
            Gate::Exhausted
        );
        state
            .healthy(root, id, Duration::from_secs(600))
            .await
            .unwrap();
        let mut state = Recovery::load(root, id).await.unwrap();
        assert_eq!(state.before_start(root, id, now).await.unwrap(), Gate::Wait);
    }
    #[tokio::test]
    async fn interrupted_start_consumes_reservation_and_clock_reversal_is_bounded() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let id = Uuid::now_v7();
        let mut state = Recovery::load(root, id).await.unwrap();
        state.before_start(root, id, 1_000_000).await.unwrap();
        assert_eq!(state.before_start(root, id, 0).await.unwrap(), Gate::Wait);
        assert_eq!(
            state.before_start(root, id, 60_000).await.unwrap(),
            Gate::Start
        );
        let mut state = Recovery::load(root, id).await.unwrap();
        assert_eq!(
            state.before_start(root, id, 60_000).await.unwrap(),
            Gate::Wait
        );
        assert_eq!(state.attempts, 2);
        tokio::fs::write(root.join(format!("{id}.recovery.json")), b"broken")
            .await
            .unwrap();
        assert!(Recovery::load(root, id).await.is_err());
    }
}
