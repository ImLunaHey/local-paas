//! Versioned outbound node protocol. Runtime-specific identifiers stay on nodes.
use platform_domain::{ImageDigest, ServiceSpec};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const VERSION: u32 = 1;
fn is_false(value: &bool) -> bool {
    !value
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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
    pub job: Option<JobExecution>,
    pub image_repository: String,
    pub image_digest: ImageDigest,
    pub spec: ServiceSpec,
    pub published_port: u16,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub database_ports: Vec<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume_size_gib: Option<u16>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SyncRequest {
    pub version: u32,
    pub node_id: Uuid,
    pub observations: Vec<InstanceReport>,
    #[serde(default)]
    pub capabilities: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SyncResponse {
    pub version: u32,
    pub assignments: Vec<Assignment>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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
    pub metrics: Option<Metrics>,
    pub logs: Vec<LogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JobExecution {
    /// Empty uses the image command. Otherwise replaces both entrypoint and CMD.
    pub command: Vec<String>,
    pub deadline_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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
pub struct LogEntry {
    pub key: String,
    pub timestamp: String,
    pub stream: String,
    pub line: String,
}

pub const FILE_LIMIT: usize = 16 * 1024 * 1024;
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FilePoll {
    pub node_id: Uuid,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileTask {
    pub id: Uuid,
    pub volume_id: Uuid,
    pub read_only: bool,
    pub expires_unix_ms: i64,
    pub path: String,
    pub action: FileAction,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum FileAction {
    List { offset: usize },
    Download,
    Upload { base64: String },
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileEntry {
    pub path: String,
    pub kind: String,
    pub size: Option<u64>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
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
pub struct FileReply {
    pub node_id: Uuid,
    pub id: Uuid,
    pub result: FileResult,
}
