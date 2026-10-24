//! Agent-owned OCI runtime contract. No containerd types escape this boundary.
//! celld fleet handoff belongs to a separate controller, never generic Stop.
use async_trait::async_trait;
use futures_core::Stream;
use platform_domain::{ImageDigest, Resources};
use std::{collections::BTreeMap, net::IpAddr, path::PathBuf, pin::Pin, time::Duration};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct Operation {
    pub id: Uuid,
    pub instance_id: Uuid,
    pub generation: u64,
    pub controller_epoch: u64,
}

#[derive(Debug, Clone)]
pub struct Identity {
    pub project: String,
    pub environment: String,
    pub service: String,
    pub revision: Uuid,
    pub instance: Uuid,
    pub node: Uuid,
}

#[derive(Debug, Clone)]
pub struct PrepareSpec {
    /// Explicit argv override; empty preserves the image entrypoint and CMD.
    pub command: Vec<String>,
    pub identity: Identity,
    pub image: ImageDigest,
    pub registry_repository: String,
    pub limits: Limits,
    pub mounts: Vec<Mount>,
    pub network: NetworkPolicy,
    pub secret_names: Vec<String>,
    pub environment: BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
pub struct Limits {
    pub resources: Resources,
    pub pids: u32,
    pub ephemeral_bytes: u64,
    pub log_bytes: u64,
    pub io_bytes_per_second: u64,
}

#[derive(Debug, Clone)]
pub enum Mount {
    Tmpfs {
        destination: PathBuf,
        max_bytes: u64,
    },
    // The agent resolves an owned volume ID; callers cannot choose host paths.
    Volume {
        id: Uuid,
        destination: PathBuf,
        read_only: bool,
        size_gib: u16,
    },
}

#[derive(Debug, Clone)]
pub struct NetworkPolicy {
    pub declared_port: Option<u16>,
    pub published_port: u16,
    pub allowed_egress: Vec<EgressRule>,
}

#[derive(Debug, Clone)]
pub struct EgressRule {
    pub address: IpAddr,
    pub prefix_length: u8,
    pub port: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstanceState {
    Pending,
    Assigned,
    Starting,
    Ready,
    Draining,
    Stopped,
    Failed,
    Unknown,
}

#[derive(Debug, Clone)]
pub struct Observation {
    pub instance_id: Uuid,
    pub generation: u64,
    pub state: InstanceState,
    pub image: ImageDigest,
    pub exit_code: Option<i32>,
}

pub struct ExecRequest {
    pub argv: Vec<String>,
    pub timeout: Duration,
    pub max_output_bytes: usize,
}

pub struct ExecOutput {
    pub exit_code: i32,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub truncated: bool,
}
pub struct LogRequest {
    pub cursor: Option<String>,
    pub max_bytes: usize,
    pub follow: bool,
}
pub struct LogEntry {
    pub cursor: String,
    pub stderr: bool,
    pub bytes: Vec<u8>,
    pub labels: BTreeMap<String, String>,
}
pub type LogStream = Pin<Box<dyn Stream<Item = Result<LogEntry, RuntimeError>> + Send>>;

#[derive(Debug, thiserror::Error)]
pub enum RuntimeError {
    #[error("runtime failure: {0}")]
    Diagnostic(String),
    #[error("runtime rejected operation: {0}")]
    Rejected(&'static str),
    #[error("runtime operation is not supported by this adapter")]
    Unsupported,
    #[error("instance not found")]
    NotFound,
    #[error("operation rejected by fencing or generation check")]
    StaleOperation,
    #[error("runtime capacity exhausted")]
    Capacity,
    #[error("runtime operation failed (diagnostic reference: {0})")]
    Failed(Uuid),
}

/// Implementations must persist operation deduplication, reject stale epochs,
/// reconcile after restart, and enforce hardened defaults. Prepare never starts
/// a workload; Stop is graceful; Destroy releases mounts, secrets and resources.
/// Exec is an authenticated, audited admin capability, not a public app endpoint.
#[async_trait]
pub trait Runtime: Send + Sync {
    async fn prepare(&self, operation: &Operation, spec: &PrepareSpec) -> Result<(), RuntimeError>;
    async fn start(&self, operation: &Operation) -> Result<(), RuntimeError>;
    async fn stop(&self, operation: &Operation, grace: Duration) -> Result<(), RuntimeError>;
    async fn kill(&self, operation: &Operation) -> Result<(), RuntimeError>;
    async fn inspect(&self, instance: Uuid) -> Result<Observation, RuntimeError>;
    async fn exec(
        &self,
        operation: &Operation,
        request: ExecRequest,
    ) -> Result<ExecOutput, RuntimeError>;
    async fn stream_logs(
        &self,
        instance: Uuid,
        request: LogRequest,
    ) -> Result<LogStream, RuntimeError>;
    async fn destroy(&self, operation: &Operation) -> Result<(), RuntimeError>;
}
