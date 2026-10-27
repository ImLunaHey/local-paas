use crate::secrets;
use platform_protocol::{
    LogEntry, MAX_LOG_ENTRIES, MAX_LOG_LINE_BYTES, MAX_SYNC_BYTES, SyncRequest,
};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

pub async fn read(path: &std::path::Path, values: &secrets::Values) -> Vec<LogEntry> {
    let Ok(mut file) = tokio::fs::File::open(path).await else {
        return vec![];
    };
    let size = file.metadata().await.map(|m| m.len()).unwrap_or(0);
    let offset = size.saturating_sub(32768);
    if file.seek(std::io::SeekFrom::Start(offset)).await.is_err() {
        return vec![];
    }
    let mut bytes = Vec::new();
    if file.take(32768).read_to_end(&mut bytes).await.is_err() {
        return vec![];
    }
    let mut seen = HashSet::new();
    bytes
        .split(|b| *b == b'\n')
        .filter_map(|line| {
            let value: serde_json::Value = serde_json::from_slice(line).ok()?;
            let line = value["log"].as_str()?;
            let timestamp = value["time"].as_str()?;
            let stream = value["stream"].as_str()?;
            if line.len() > MAX_LOG_LINE_BYTES || !["stdout", "stderr"].contains(&stream) {
                return None;
            }
            let key = format!(
                "{:x}",
                Sha256::digest(format!("{timestamp}\0{stream}\0{line}"))
            );
            if !seen.insert(key.clone()) {
                return None;
            }
            // Redact the complete line before bounding it: truncating plaintext can
            // expose a secret prefix. Drop oversized output without slicing UTF-8.
            let line = secrets::redact(line, values);
            if line.len() > MAX_LOG_LINE_BYTES {
                return None;
            }
            Some(LogEntry {
                key,
                timestamp: timestamp.into(),
                stream: stream.into(),
                line,
            })
        })
        .take(MAX_LOG_ENTRIES)
        .collect()
}

/// Reserve room for every health report, then fit redacted logs into the exact
/// wire budget, including JSON escaping, entry metadata, and array separators.
pub fn limit_payload(request: &mut SyncRequest) -> Result<(), serde_json::Error> {
    let logs: Vec<_> = request
        .observations
        .iter_mut()
        .map(|report| std::mem::take(&mut report.logs))
        .collect();
    let mut remaining = MAX_SYNC_BYTES.saturating_sub(serde_json::to_vec(request)?.len());
    for (report, entries) in request.observations.iter_mut().zip(logs) {
        for entry in entries.into_iter().take(MAX_LOG_ENTRIES) {
            let size = serde_json::to_vec(&entry)?.len() + usize::from(!report.logs.is_empty());
            if entry.line.len() <= MAX_LOG_LINE_BYTES && size <= remaining {
                remaining -= size;
                report.logs.push(entry);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use platform_protocol::{InstanceReport, VERSION};
    use serde_json::json;
    use uuid::Uuid;

    async fn read_lines(lines: &[String], values: &secrets::Values) -> Vec<LogEntry> {
        let file = tempfile::NamedTempFile::new().unwrap();
        let contents = lines
            .iter()
            .map(|line| {
                json!({"log":line,"time":"2026-10-23T20:00:00Z","stream":"stdout"}).to_string()
                    + "\n"
            })
            .collect::<String>();
        std::fs::write(file.path(), contents).unwrap();
        read(file.path(), values).await
    }

    #[tokio::test]
    async fn repeated_short_secrets_are_bounded_after_redaction_and_valid_logs_deduplicate() {
        let values = secrets::Values::from([("TOKEN".into(), "abc".into())]);
        let oversized = "abc".repeat(2000);
        assert_eq!(oversized.len(), 6000);
        assert_eq!(secrets::redact(&oversized, &values).len(), 20000);
        let valid = "é🦀 abc".to_owned();
        let lines = [oversized, valid.clone(), valid.clone()];
        let logs = read_lines(&lines, &values).await;
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].line, "é🦀 [REDACTED]");
        let retry = read_lines(&[valid], &values).await;
        assert_eq!(logs[0].key, retry[0].key);
        assert!(logs.iter().all(|log| !log.line.contains("abc")));
    }

    #[tokio::test]
    async fn utf8_byte_boundary_is_checked_after_redacting_the_complete_secret() {
        let values = secrets::Values::from([("TOKEN".into(), "abc".into())]);
        let at_limit = "é".repeat((MAX_LOG_LINE_BYTES - "[REDACTED]".len()) / 2) + "abc";
        let logs = read_lines(std::slice::from_ref(&at_limit), &values).await;
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].line.len(), MAX_LOG_LINE_BYTES);
        assert!(logs[0].line.ends_with("[REDACTED]"));
        assert!(read_lines(&[at_limit + "é"], &values).await.is_empty());
    }

    #[test]
    fn total_wire_budget_includes_redaction_json_escaping_and_all_health_reports() {
        let values = secrets::Values::from([("TOKEN".into(), "abc".into())]);
        let line = secrets::redact(
            &("abc".repeat(1000) + &"\u{0001}".repeat(1000) + "🦀"),
            &values,
        );
        let mut request = SyncRequest {
            version: VERSION,
            node_id: Uuid::new_v4(),
            capabilities: vec!["recovery-v2".into()],
            observations: (0..8)
                .map(|_| InstanceReport {
                    instance_id: Uuid::new_v4(),
                    generation: 1,
                    observed_unix_ms: 1000,
                    process_started_at: None,
                    job_result: None,
                    state: "ready".into(),
                    diagnostic: None,
                    health: None,
                    metrics: None,
                    logs: (0..8)
                        .map(|index| LogEntry {
                            key: format!("{index:064x}"),
                            timestamp: "2026-10-23T20:00:00Z".into(),
                            stream: "stdout".into(),
                            line: line.clone(),
                        })
                        .collect(),
                })
                .collect(),
        };
        let mut health_only = request.clone();
        for report in &mut health_only.observations {
            report.logs.clear();
        }
        assert!(serde_json::to_vec(&request).unwrap().len() > MAX_SYNC_BYTES);
        limit_payload(&mut request).unwrap();
        let payload = serde_json::to_vec(&request).unwrap();
        assert!(payload.len() <= MAX_SYNC_BYTES);
        let roundtrip: SyncRequest = serde_json::from_slice(&payload).unwrap();
        let retained: Vec<_> = roundtrip
            .observations
            .iter()
            .flat_map(|r| &r.logs)
            .collect();
        assert!(!retained.is_empty());
        assert!(retained.len() < 64);
        assert!(retained.iter().all(|entry| entry.line == line));
        // No report is sacrificed to make room for logs.
        for report in &mut request.observations {
            report.logs.clear();
        }
        assert_eq!(
            serde_json::to_value(request).unwrap(),
            serde_json::to_value(health_only).unwrap()
        );
    }
}
