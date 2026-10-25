//! Versioned outbound node protocol. Runtime-specific identifiers stay on nodes.
use platform_domain::{ImageDigest, RecoveryPolicy, ServiceSpec};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const VERSION: u32 = 2;
/// Host-facing slots for the bounded seven-node topology. TLS links preserve
/// these addresses across remote hosts without exposing arbitrary private ports.
pub fn valid_node_port(port: u16) -> bool {
    (21000..=21603).contains(&port) && (port - 21000) % 100 < 4
}
fn is_false(value: &bool) -> bool {
    !value
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct Assignment {
    pub instance_id: Uuid,
    pub deployment_id: Uuid,
    pub revision_id: Uuid,
    pub service_id: Uuid,
    pub generation: i64,
    pub desired_state: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub recovery_allowed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery_policy: Option<RecoveryPolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub job: Option<JobExecution>,
    pub image_repository: String,
    pub image_digest: ImageDigest,
    pub spec: ServiceSpec,
    pub published_port: u16,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub database_ports: Vec<u16>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub private_backends: Vec<Vec<PrivateBackend>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume_size_gib: Option<u16>,
}
/// Node-private proxy destinations. The current VM transport uses host-forwarded
/// ports; the public/scheduler domain never sees container runtime identifiers.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct PrivateBackend {
    pub port: u16,
    pub expires_unix_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct SyncRequest {
    pub version: u32,
    pub node_id: Uuid,
    pub observations: Vec<InstanceReport>,
    #[serde(default)]
    pub capabilities: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct SyncResponse {
    pub version: u32,
    pub assignments: Vec<Assignment>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct InstanceReport {
    pub instance_id: Uuid,
    pub generation: i64,
    pub observed_unix_ms: i64,
    #[serde(default)]
    pub process_started_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub job_result: Option<JobResult>,
    pub state: String,
    pub diagnostic: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub health: Option<RuntimeHealth>,
    pub metrics: Option<Metrics>,
    pub logs: Vec<LogEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHealth {
    pub process: ProcessObservation,
    pub startup: ProbeObservation,
    pub readiness: ProbeObservation,
    pub liveness: ProbeObservation,
    pub recovery: RecoveryObservation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProcessObservation {
    Running,
    Exited,
    Unknown,
}
impl ProcessObservation {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Exited => "exited",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProbeObservation {
    NotConfigured,
    Pending,
    Passing,
    Failing,
    Unknown,
}
impl ProbeObservation {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotConfigured => "not_configured",
            Self::Pending => "pending",
            Self::Passing => "passing",
            Self::Failing => "failing",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryPhase {
    Stable,
    Backoff,
    Restarting,
    Exhausted,
    Disabled,
}
impl RecoveryPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Backoff => "backoff",
            Self::Restarting => "restarting",
            Self::Exhausted => "exhausted",
            Self::Disabled => "disabled",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryObservation {
    pub phase: RecoveryPhase,
    pub attempts: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_at_unix_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct JobExecution {
    /// Empty uses the image command. Otherwise replaces both entrypoint and CMD.
    pub command: Vec<String>,
    pub deadline_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct JobResult {
    pub outcome: JobOutcome,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobOutcome {
    Succeeded,
    Failed,
    TimedOut,
    Unknown,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct Metrics {
    pub cpu_millis: f64,
    pub memory_bytes: u64,
    pub pids: u64,
    #[serde(default)]
    pub io_read_bytes_per_second: Option<f64>,
    #[serde(default)]
    pub io_write_bytes_per_second: Option<f64>,
    #[serde(default)]
    pub network_rx_bytes_per_second: Option<f64>,
    #[serde(default)]
    pub network_tx_bytes_per_second: Option<f64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub key: String,
    pub timestamp: String,
    pub stream: String,
    pub line: String,
}

pub const FILE_LIMIT: usize = 16 * 1024 * 1024;
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct FilePoll {
    pub node_id: Uuid,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct FileTask {
    pub id: Uuid,
    pub volume_id: Uuid,
    pub read_only: bool,
    pub expires_unix_ms: i64,
    pub path: String,
    pub action: FileAction,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all_fields = "camelCase",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum FileAction {
    List { offset: usize },
    Download,
    Upload { base64: String },
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub kind: String,
    pub size: Option<u64>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all_fields = "camelCase",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum FileResult {
    Listing {
        items: Vec<FileEntry>,
        cursor: Option<String>,
    },
    Download {
        base64: String,
    },
    Uploaded,
    Failed {
        code: String,
    },
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct FileReply {
    pub node_id: Uuid,
    pub id: Uuid,
    pub result: FileResult,
}

#[cfg(test)]
mod contract_tests {
    use super::*;

    #[test]
    fn v2_uses_camel_case_and_rejects_old_fields() {
        let node = Uuid::now_v7();
        let value = serde_json::json!({"version":VERSION,"nodeId":node,"observations":[]});
        let request: SyncRequest = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(request.node_id, node);
        assert_eq!(
            serde_json::to_value(&request).unwrap()["nodeId"],
            value["nodeId"]
        );
        let old = serde_json::json!({"version":1,"node_id":node,"observations":[]});
        assert!(serde_json::from_value::<SyncRequest>(old).is_err());
    }

    #[test]
    fn application_log_lines_are_opaque() {
        let line = r#"{"user_id":"a","cpu_millis":17,"nested":{"build_args":true}}"#;
        let report = InstanceReport {
            instance_id: Uuid::now_v7(),
            generation: 7,
            observed_unix_ms: 123,
            process_started_at: None,
            job_result: None,
            state: "ready".into(),
            diagnostic: None,
            health: None,
            metrics: Some(Metrics::default()),
            logs: vec![LogEntry {
                key: "one".into(),
                timestamp: "2026-01-01T00:00:00Z".into(),
                stream: "stdout".into(),
                line: line.into(),
            }],
        };
        let value = serde_json::to_value(&report).unwrap();
        assert_eq!(value["logs"][0]["line"], line);
        assert!(value["metrics"].get("cpuMillis").is_some());
        assert!(value["metrics"].get("cpu_millis").is_none());
        assert!(value.get("instanceId").is_some());
    }
}
