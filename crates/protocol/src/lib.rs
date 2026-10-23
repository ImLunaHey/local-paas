//! Versioned outbound node protocol. Runtime-specific identifiers stay on nodes.
use platform_domain::{ImageDigest, ServiceSpec};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const VERSION: u32 = 1;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Assignment {
    pub instance_id: Uuid,
    pub deployment_id: Uuid,
    pub revision_id: Uuid,
    pub service_id: Uuid,
    pub generation: i64,
    pub desired_state: String,
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
    pub state: String,
    pub diagnostic: Option<String>,
    pub metrics: Option<Metrics>,
    pub logs: Vec<LogEntry>,
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
