//! Runtime-independent desired state. Contains references, never secret values.
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServiceSpec {
    pub schema_version: u32,
    pub project: String,
    pub environment: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "GitSource::is_empty")]
    pub source: GitSource,
    pub resources: Resources,
    pub distinct_nodes: bool,
    pub domains: Vec<String>,
    pub secrets: Vec<String>,
    pub workload: Workload,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume: Option<VolumeAttachment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VolumeAttachment {
    pub id: uuid::Uuid,
    pub mount_path: String,
    pub read_only: bool,
}

pub fn volume_mount_path(path: &str) -> bool {
    path.len() <= 200
        && path.starts_with('/')
        && !path.ends_with('/')
        && path.split('/').skip(1).all(|part| {
            !part.is_empty()
                && part != "."
                && part != ".."
                && part
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_- .".contains(&b))
                && !part.contains(' ')
        })
        && ![
            "/proc",
            "/sys",
            "/dev",
            "/etc",
            "/run",
            "/tmp",
            "/bin",
            "/sbin",
            "/lib",
            "/lib64",
            "/usr",
            "/.platform-secret-exec",
        ]
        .iter()
        .any(|p| path == *p || path.starts_with(&format!("{p}/")))
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitSource {
    #[serde(default)]
    pub repository: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upload: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
}

impl GitSource {
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }
    pub fn pin(&mut self, commit: String) {
        self.commit = Some(commit);
        self.branch = None;
        self.tag = None;
    }
}

pub fn commit_hash(value: &str) -> bool {
    matches!(value.len(), 40 | 64)
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn git_ref_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && value != "@"
        && !value.starts_with('-')
        && !value.starts_with("refs/")
        && !value.ends_with('.')
        && !value.contains("..")
        && !value.contains("@{")
        && !value
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || "~^:?*[\\".contains(c))
        && value
            .split('/')
            .all(|part| !part.is_empty() && !part.starts_with('.') && !part.ends_with(".lock"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Resources {
    pub cpu_millis: u32,
    pub memory_mib: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Workload {
    RustfsService {
        storage_gib: u16,
    },
    RedisService {
        storage_gib: u16,
    },
    PostgresService {
        database: String,
        storage_gib: u16,
    },
    OciService {
        #[serde(default)]
        build_mode: BuildMode,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        build_command: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        start_command: Option<String>,
        dockerfile: String,
        context: String,
        replicas: u16,
        port: u16,
        readiness: Readiness,
    },
    CelldService {
        wrangler: String,
        members: u16,
        bucket_ref: String,
    },
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BuildMode {
    #[default]
    Auto,
    Dockerfile,
    Generated,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Readiness {
    pub path: String,
    pub interval_seconds: u16,
    pub stabilization_seconds: u16,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct ValidationIssue {
    pub field: String,
    pub message: String,
}

impl Workload {
    pub fn is_managed(&self) -> bool {
        self.is_database() || matches!(self, Self::RustfsService { .. })
    }
    pub fn is_database(&self) -> bool {
        matches!(
            self,
            Self::PostgresService { .. } | Self::RedisService { .. }
        )
    }
    pub fn database_secret(&self) -> &'static str {
        match self {
            Self::RustfsService { .. } => "RUSTFS_SECRET_KEY",
            Self::RedisService { .. } => "REDIS_PASSWORD",
            _ => "POSTGRES_PASSWORD",
        }
    }
}
impl ServiceSpec {
    pub fn validate(&self) -> Result<(), Vec<ValidationIssue>> {
        let mut issues = Vec::new();
        let mut check = |valid: bool, field: &str, message: &str| {
            if !valid {
                issues.push(ValidationIssue {
                    field: field.into(),
                    message: message.into(),
                });
            }
        };
        check(self.schema_version == 1, "schema_version", "must be 1");
        if let Some(volume) = &self.volume {
            check(
                matches!(self.workload, Workload::OciService { replicas: 1, .. }),
                "volume",
                "a volume attachment requires an OCI application with one replica",
            );
            check(
                volume_mount_path(&volume.mount_path),
                "volume.mount_path",
                "use an absolute data directory such as /data; system directories and path traversal are forbidden",
            );
        }
        for (field, value) in [
            ("project", &self.project),
            ("environment", &self.environment),
            ("name", &self.name),
        ] {
            check(
                slug(value),
                field,
                "use 1–63 lowercase letters, digits or interior hyphens",
            );
        }
        if self.workload.is_managed() {
            check(
                self.secrets
                    .iter()
                    .all(|name| name == self.workload.database_secret()),
                "secrets",
                "database services only accept their managed password reference",
            );
            check(
                self.source.is_empty(),
                "source",
                "database services do not have a Git source",
            );
        } else if let Some(digest) = &self.source.upload {
            check(
                matches!(self.workload, Workload::OciService { .. }),
                "source.upload",
                "uploaded sources currently support OCI services only",
            );
            check(
                digest.len() == 64
                    && digest
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
                "source.upload",
                "use the uploaded source's SHA-256 digest",
            );
            check(
                self.source.repository.is_empty()
                    && self.source.commit.is_none()
                    && self.source.branch.is_none()
                    && self.source.tag.is_none(),
                "source",
                "choose an uploaded source or a Git source, not both",
            );
        } else {
            let repo = url::Url::parse(&self.source.repository);
            check(
                self.source.repository.len() <= 2048
                    && repo.is_ok_and(|url| {
                        url.scheme() == "https"
                            && url.host_str().is_some()
                            && url.username().is_empty()
                            && url.password().is_none()
                            && url.query().is_none()
                            && url.fragment().is_none()
                    }),
                "source.repository",
                "use an HTTPS repository URL without credentials, query or fragment",
            );
            check(
                [&self.source.commit, &self.source.branch, &self.source.tag]
                    .iter()
                    .filter(|v| v.is_some())
                    .count()
                    == 1,
                "source",
                "choose exactly one commit, branch, or tag",
            );
            if let Some(commit) = &self.source.commit {
                check(
                    commit_hash(commit),
                    "source.commit",
                    "use a full lowercase Git commit hash (40 or 64 hex characters)",
                );
            }
            for (field, value) in [
                ("source.branch", &self.source.branch),
                ("source.tag", &self.source.tag),
            ] {
                if let Some(value) = value {
                    check(
                        git_ref_name(value),
                        field,
                        "use a branch or tag name without refs/ prefix, whitespace, wildcards, or revision expressions",
                    );
                }
            }
        }
        check(
            (1..=64000).contains(&self.resources.cpu_millis),
            "resources.cpu_millis",
            "must be between 1 and 64000 per instance",
        );
        check(
            (16..=65536).contains(&self.resources.memory_mib),
            "resources.memory_mib",
            "must be between 16 and 65536 per instance",
        );
        check(self.domains.len() <= 20, "domains", "at most 20 domains");
        let mut domains = HashSet::new();
        for domain in &self.domains {
            check(
                domain.len() <= 253 && domain.contains('.') && domain.split('.').all(slug),
                "domains",
                "use lowercase DNS names without a scheme, port or wildcard",
            );
            check(domains.insert(domain), "domains", "domains must be unique");
        }
        check(
            self.secrets.len() <= 100,
            "secrets",
            "at most 100 secret names",
        );
        let mut secrets = HashSet::new();
        for secret in &self.secrets {
            check(
                !secret.is_empty()
                    && secret.len() <= 128
                    && secret.bytes().enumerate().all(|(i, c)| {
                        c == b'_' || c.is_ascii_uppercase() || (i > 0 && c.is_ascii_digit())
                    }),
                "secrets",
                "use environment-variable names only; never supply values or paths",
            );
            check(
                secrets.insert(secret),
                "secrets",
                "secret names must be unique",
            );
        }
        match &self.workload {
            Workload::RustfsService { storage_gib } => {
                check(
                    (1..=2).contains(storage_gib),
                    "workload.storage_gib",
                    "development storage supports 1–2 GiB",
                );
                check(
                    self.resources.memory_mib >= 1024,
                    "resources.memory_mib",
                    "RustFS needs at least 1024 MiB for this development template",
                );
                check(
                    self.domains.is_empty(),
                    "domains",
                    "RustFS uses private S3 connections",
                );
                check(
                    !self.distinct_nodes,
                    "distinct_nodes",
                    "RustFS runs on its persistent volume owner",
                );
            }
            Workload::RedisService { storage_gib } => {
                check(
                    (1..=2).contains(storage_gib),
                    "workload.storage_gib",
                    "development volumes support 1–2 GiB",
                );
                check(
                    self.resources.memory_mib >= 128,
                    "resources.memory_mib",
                    "Redis needs at least 128 MiB",
                );
                check(
                    self.domains.is_empty(),
                    "domains",
                    "databases use private connections",
                );
                check(
                    !self.distinct_nodes,
                    "distinct_nodes",
                    "database storage is pinned to one node",
                );
            }
            Workload::PostgresService {
                database,
                storage_gib,
            } => {
                check(
                    !database.is_empty()
                        && database.len() <= 63
                        && database
                            .bytes()
                            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_'),
                    "workload.database",
                    "use 1–63 lowercase letters, digits or underscores",
                );
                check(
                    (1..=2).contains(storage_gib),
                    "workload.storage_gib",
                    "development database volumes support 1–2 GiB",
                );
                check(
                    self.resources.memory_mib >= 256,
                    "resources.memory_mib",
                    "PostgreSQL needs at least 256 MiB",
                );
                check(
                    self.domains.is_empty(),
                    "domains",
                    "databases use private connections, not HTTP domains",
                );
                check(
                    !self.distinct_nodes,
                    "distinct_nodes",
                    "a database is a single instance pinned to its volume owner",
                );
            }

            Workload::OciService {
                dockerfile,
                context,
                replicas,
                port,
                readiness,
                build_mode,
                build_command,
                start_command,
            } => {
                for (field, command) in [
                    ("workload.build_command", build_command),
                    ("workload.start_command", start_command),
                ] {
                    if let Some(command) = command {
                        check(
                            !command.trim().is_empty()
                                && command.len() <= 4096
                                && !command
                                    .chars()
                                    .any(|c| c.is_control() && c != '\n' && c != '\t'),
                            field,
                            "use a nonempty shell command up to 4096 bytes; keep secrets in secret references",
                        );
                        check(
                            *build_mode != BuildMode::Dockerfile,
                            field,
                            "custom commands require automatic or generated build mode; repository Dockerfiles define their own commands",
                        );
                    }
                }
                check(
                    relative_path(dockerfile, false),
                    "workload.dockerfile",
                    "use a repository-relative file path without traversal",
                );
                check(
                    relative_path(context, true),
                    "workload.context",
                    "use a repository-relative directory or . without traversal",
                );
                check(
                    (1..=32).contains(replicas),
                    "workload.replicas",
                    "must be between 1 and 32",
                );
                check(*port != 0, "workload.port", "must be between 1 and 65535");
                check(
                    readiness.path.len() <= 1024
                        && readiness.path.starts_with('/')
                        && !readiness.path.starts_with("//")
                        && !readiness.path.contains(['\r', '\n', '#', '\\'])
                        && !readiness.path.chars().any(char::is_control),
                    "workload.readiness.path",
                    "use an absolute HTTP path beginning with a single /",
                );
                check(
                    (1..=300).contains(&readiness.interval_seconds),
                    "workload.readiness.interval_seconds",
                    "must be between 1 and 300",
                );
                check(
                    readiness.stabilization_seconds >= readiness.interval_seconds
                        && readiness.stabilization_seconds <= 3600,
                    "workload.readiness.stabilization_seconds",
                    "must cover at least one check interval and be at most 3600",
                );
            }
            Workload::CelldService {
                wrangler,
                members,
                bucket_ref,
            } => {
                check(
                    relative_path(wrangler, false),
                    "workload.wrangler",
                    "use a repository-relative Wrangler file path without traversal",
                );
                check(
                    (2..=32).contains(members),
                    "workload.members",
                    "fleet durability starts with 2–32 members",
                );
                check(
                    slug(bucket_ref),
                    "workload.bucket_ref",
                    "use a fleet-scoped bucket configuration reference, not credentials",
                );
            }
        }
        if issues.is_empty() {
            Ok(())
        } else {
            Err(issues)
        }
    }

    pub fn kind(&self) -> &'static str {
        match self.workload {
            Workload::OciService { .. } => "oci-service",
            Workload::PostgresService { .. } => "postgres-service",
            Workload::RustfsService { .. } => "rustfs-service",
            Workload::RedisService { .. } => "redis-service",
            Workload::CelldService { .. } => "celld-service",
        }
    }
}

fn slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 63
        && !value.starts_with('-')
        && !value.ends_with('-')
        && value
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

fn relative_path(value: &str, directory: bool) -> bool {
    (directory && value == ".")
        || (!value.is_empty()
            && value.len() <= 1024
            && !value.contains(['\\', ':'])
            && !value.chars().any(char::is_control)
            && value
                .split('/')
                .all(|part| !part.is_empty() && part != "." && part != ".."))
}

/// The only image identifier accepted by the runtime: a SHA-256 OCI digest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ImageDigest(String);

impl TryFrom<String> for ImageDigest {
    type Error = &'static str;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.strip_prefix("sha256:").is_some_and(|hash| {
            hash.len() == 64
                && hash
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        }) {
            Ok(Self(value))
        } else {
            Err("expected sha256: followed by 64 lowercase hexadecimal characters")
        }
    }
}

impl From<ImageDigest> for String {
    fn from(value: ImageDigest) -> Self {
        value.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn example() -> ServiceSpec {
        serde_json::from_str(include_str!("../../../examples/oci-service.json")).unwrap()
    }

    #[test]
    fn both_workload_examples_validate() {
        example().validate().unwrap();
        serde_json::from_str::<ServiceSpec>(include_str!("../../../examples/celld-service.json"))
            .unwrap()
            .validate()
            .unwrap();
    }

    #[test]
    fn sources_accept_one_commit_branch_or_tag_and_reject_unsafe_ref_names() {
        let mut spec = example();
        spec.source.branch = Some("feature/config".into());
        assert!(spec.validate().is_err());
        spec.source.commit = None;
        spec.validate().unwrap();
        spec.source.branch = None;
        assert!(spec.validate().is_err());
        spec.source.tag = Some("v1.2.3".into());
        spec.validate().unwrap();
        for name in [
            "",
            "-main",
            "refs/heads/main",
            "a..b",
            "a@{1}",
            "a b",
            "a\nb",
            "a*",
            "a?",
            "a[",
            "a\\b",
            "a:b",
            ".hidden",
            "a/.hidden",
            "a.lock",
            "a//b",
            "a/",
            "a.",
            "@",
        ] {
            spec.source.tag = Some(name.into());
            assert!(spec.validate().is_err(), "accepted {name:?}");
        }
    }

    #[test]
    fn rejects_credentials_and_mutable_commits() {
        let mut spec = example();
        spec.source.repository = "https://user:secret@example.com/repo.git".into();
        spec.source.commit = Some("main".into());
        let issues = spec.validate().unwrap_err();
        assert!(issues.iter().any(|i| i.field == "source.repository"));
        assert!(issues.iter().any(|i| i.field == "source.commit"));
    }

    #[test]
    fn rejects_paths_and_values_that_cross_boundaries() {
        for path in [
            "../Dockerfile",
            "/Dockerfile",
            "src/../../Dockerfile",
            "a\\Dockerfile",
            "a//Dockerfile",
            "C:/Dockerfile",
        ] {
            assert!(!relative_path(path, false), "{path}");
        }
        let mut spec = example();
        spec.secrets = vec!["DATABASE_URL=secret".into()];
        spec.domains = vec!["https://example.com".into()];
        assert_eq!(spec.validate().unwrap_err().len(), 2);
    }

    #[test]
    fn custom_commands_require_a_generated_recipe_and_valid_text() {
        for (mode, command, valid) in [
            (BuildMode::Auto, "npm run build", true),
            (BuildMode::Generated, "node server.js", true),
            (BuildMode::Dockerfile, "npm start", false),
            (BuildMode::Auto, "   ", false),
            (BuildMode::Auto, "npm\0start", false),
        ] {
            let mut spec = example();
            if let Workload::OciService {
                build_mode,
                build_command,
                start_command,
                ..
            } = &mut spec.workload
            {
                *build_mode = mode;
                *build_command = Some(command.into());
                *start_command = Some(command.into());
            }
            assert_eq!(spec.validate().is_ok(), valid);
        }
    }

    #[test]
    fn unknown_fields_cannot_silently_disable_policy() {
        let mut value = serde_json::to_value(example()).unwrap();
        value["workload"]["privileged"] = true.into();
        assert!(serde_json::from_value::<ServiceSpec>(value).is_err());
    }

    #[test]
    fn readiness_requires_time_to_stabilize() {
        let mut spec = example();
        if let Workload::OciService { readiness, .. } = &mut spec.workload {
            readiness.stabilization_seconds = 0;
        }
        assert!(
            spec.validate()
                .unwrap_err()
                .iter()
                .any(|i| i.field.ends_with("stabilization_seconds"))
        );
    }

    #[test]
    fn runtime_rejects_mutable_image_names() {
        assert!(ImageDigest::try_from("nginx:latest".to_string()).is_err());
        assert!(ImageDigest::try_from(format!("sha256:{}", "a".repeat(64))).is_ok());
        assert!(serde_json::from_str::<ImageDigest>("\"sha256:abc\"").is_err());
    }
}
