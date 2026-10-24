//! Privileged containerd adapter. nerdctl is a pinned low-level client, never an orchestrator.
use async_trait::async_trait;
use platform_domain::ImageDigest;
use platform_runtime::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
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
                let mut text = String::from_utf8_lossy(&err).to_string();
                if let Ok(mut entries) = tokio::fs::read_dir("/run/local-paas-secrets").await {
                    while let Ok(Some(entry)) = entries.next_entry().await {
                        if let Ok(id) = entry.file_name().to_string_lossy().parse::<Uuid>()
                            && let Ok(values) = crate::secrets::load(id).await
                        {
                            text = crate::secrets::redact(&text, &values);
                        }
                    }
                }
                let text = text.lines().last().unwrap_or("runtime command failed");
                let message = text.split("msg=").last().unwrap_or(text).trim_matches('"');
                // Preserve the actionable address instead of spending the whole
                // diagnostic budget on nested CNI error wrappers.
                let message = message
                    .find("requested IP address")
                    .map(|i| &message[i..])
                    .unwrap_or(message);
                let stage = args.first().map(String::as_str).unwrap_or("runtime");
                let mut diagnostic = format!("{stage}: {message}");
                diagnostic.truncate(diagnostic.floor_char_boundary(128));
                err.fill(0);
                return Err(RuntimeError::Diagnostic(diagnostic));
            }
            Ok(out)
        })
        .await
        .map_err(|_| failure())?
    }
    async fn image_config(&self, repository: &str, digest: &str) -> Result<Value, RuntimeError> {
        let repository = repository
            .strip_prefix("127.0.0.1:15000/")
            .ok_or_else(failure)?;
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|_| failure())?;
        async fn get(
            client: &reqwest::Client,
            repository: &str,
            kind: &str,
            digest: &str,
        ) -> Result<Value, RuntimeError> {
            if !digest.starts_with("sha256:")
                || digest.len() != 71
                || !digest[7..].bytes().all(|b| b.is_ascii_hexdigit())
            {
                return Err(failure());
            }
            let mut response=client.get(format!("http://10.0.2.2:15000/v2/{repository}/{kind}/{digest}")).header("Accept","application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json").send().await.map_err(|_|failure())?;
            if !response.status().is_success() {
                return Err(RuntimeError::Rejected("image_configuration_unavailable"));
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| failure())? {
                if bytes.len() + chunk.len() > 1048576 {
                    return Err(failure());
                }
                bytes.extend(chunk);
            }
            if format!("sha256:{:x}", Sha256::digest(&bytes)) != digest {
                return Err(RuntimeError::Rejected(
                    "image_configuration_digest_mismatch",
                ));
            }
            serde_json::from_slice(&bytes).map_err(|_| failure())
        }
        let mut manifest = get(&client, repository, "manifests", digest).await?;
        if let Some(members) = manifest["manifests"].as_array() {
            let selected = members
                .iter()
                .find(|v| matches_platform(v, std::env::consts::ARCH))
                .and_then(|v| v["digest"].as_str())
                .ok_or_else(failure)?;
            manifest = get(&client, repository, "manifests", selected).await?;
        }
        let digest = manifest["config"]["digest"].as_str().ok_or_else(failure)?;
        let config = get(&client, repository, "blobs", digest).await?;
        Ok(config["config"].clone())
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
    pub async fn release_orphan_address(&self, ip: std::net::Ipv4Addr) -> Result<(), RuntimeError> {
        let Some(lease) = crate::ipam::reservation(ip).await? else {
            return Ok(());
        };
        // A stopped container still owns its address until removed. An absent container
        // alone is insufficient: independently check containerd's task inventory.
        match self
            .command(&["inspect".into(), lease.runtime_id.clone()])
            .await
        {
            Err(RuntimeError::NotFound) => {}
            Ok(bytes) => {
                let entries: Value = serde_json::from_slice(&bytes).map_err(|_| failure())?;
                let owner = entries[0]["Config"]["Labels"]["platform.instance"]
                    .as_str()
                    .and_then(|s| s.parse::<Uuid>().ok());
                return Err(RuntimeError::Diagnostic(match owner {
                    Some(id) => format!("address {ip} still owned by instance {id}"),
                    None => format!("address {ip} still owned by an unknown container"),
                }));
            }
            Err(error) => return Err(error),
        }
        if !crate::ipam::task_absent(&lease.runtime_id).await? {
            return Err(RuntimeError::Rejected("workload_address_task_present"));
        }
        crate::ipam::release(ip, &lease).await?;
        if crate::ipam::reservation(ip).await?.is_some() {
            return Err(RuntimeError::Rejected("workload_address_still_reserved"));
        }
        Ok(())
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
        if self.root.join(format!("{id}.has-secrets")).exists() {
            PathBuf::from("/run/local-paas-logs").join(format!("{id}.json"))
        } else {
            self.root.join("logs").join(format!("{id}.json"))
        }
    }
}
#[async_trait]
impl Runtime for Containerd {
    async fn prepare(&self, op: &Operation, spec: &PrepareSpec) -> Result<(), RuntimeError> {
        if spec.identity.instance != op.instance_id || spec.identity.node != self.node {
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
        let ip = crate::network::address(
            spec.network
                .published_port
                .checked_sub(20000)
                .ok_or_else(failure)?,
        )?;
        let mut ports = Vec::new();
        for rule in &spec.network.allowed_egress {
            if rule.address != std::net::IpAddr::V4(std::net::Ipv4Addr::new(10, 0, 2, 2))
                || rule.prefix_length != 32
                || !crate::network::valid_port(rule.port)
            {
                return Err(RuntimeError::Unsupported);
            }
            ports.push(rule.port);
        }
        match self.info(op.instance_id).await {
            Err(RuntimeError::NotFound) => self.release_orphan_address(ip).await?,
            Ok(_) => {}
            Err(error) => return Err(error),
        }
        crate::network::apply(op.instance_id, Some(ip), &ports).await?;
        // Container metadata survives a VM reboot; loop mounts do not. Restore
        // every volume before the existing-container shortcut or start can run.
        for mount in &spec.mounts {
            let Mount::Volume {
                id,
                destination,
                size_gib,
                ..
            } = mount
            else {
                return Err(RuntimeError::Unsupported);
            };
            if !destination
                .to_str()
                .is_some_and(platform_domain::volume_mount_path)
            {
                return Err(RuntimeError::Unsupported);
            }
            crate::volumes::prepare(&self.root, *id, *size_gib).await?;
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
            ("--ip", ip.to_string()),
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
            ("--log-driver", "json-file".into()),
            ("--log-opt", "max-size=1m".into()),
            ("--log-opt", "max-file=2".into()),
            (
                "--log-opt",
                format!("log-path={}", self.logfile(op.instance_id).display()),
            ),
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
        for (hostname, address) in &spec.network.hosts {
            if !hostname.starts_with("svc-")
                || !hostname.ends_with(".internal")
                || hostname.len() != 45
                || !hostname[4..36].bytes().all(|b| b.is_ascii_hexdigit())
                || Some(*address) != crate::discovery::gateway().map(Into::into)
            {
                return Err(RuntimeError::Unsupported);
            }
            args.extend(["--add-host".into(), format!("{hostname}:{address}")]);
        }
        if let Some(port) = port {
            args.extend([
                "--publish".into(),
                format!("0.0.0.0:{published}:{port}"),
                "--env".into(),
                format!("PORT={port}"),
                "--env".into(),
                "HOST=0.0.0.0".into(),
                "--env".into(),
                "HOSTNAME=0.0.0.0".into(),
            ]);
        }
        for mount in &spec.mounts {
            let Mount::Volume {
                id,
                destination,
                read_only,
                size_gib,
            } = mount
            else {
                return Err(RuntimeError::Unsupported);
            };
            if !destination
                .to_str()
                .is_some_and(platform_domain::volume_mount_path)
            {
                return Err(RuntimeError::Unsupported);
            }
            let path = crate::volumes::prepare(&self.root, *id, *size_gib).await?;
            args.extend([
                "--mount".into(),
                format!(
                    "type=bind,src={},dst={}{}",
                    path.display(),
                    destination.display(),
                    if *read_only { ",ro" } else { "" }
                ),
            ]);
        }
        for (key, value) in &spec.environment {
            let managed = matches!(
                key.as_str(),
                "POSTGRES_DB" | "POSTGRES_USER" | "REDIS_MAXMEMORY" | "RUSTFS_ACCESS_KEY"
            ) && !value.is_empty()
                && value
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');
            let private = !key.is_empty()
                && key.len() <= 128
                && !key.as_bytes()[0].is_ascii_digit()
                && key
                    .bytes()
                    .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
                && spec.network.hosts.keys().any(|host| {
                    (crate::discovery::BASE..crate::discovery::BASE + 16)
                        .any(|port| *value == format!("http://{host}:{port}"))
                });
            if !managed && !private {
                return Err(RuntimeError::Unsupported);
            }
            args.extend(["--env".into(), format!("{key}={value}")]);
        }
        let mut original = spec.command.clone();
        if !spec.secret_names.is_empty() {
            let dir = crate::secrets::directory(op.instance_id);
            if !dir.join(".environment").is_file() {
                return Err(RuntimeError::Rejected("secret_files_missing"));
            }
            if original.is_empty() {
                let config = self
                    .image_config(&spec.registry_repository, &String::from(spec.image.clone()))
                    .await?;
                for key in ["Entrypoint", "Cmd"] {
                    if let Some(parts) = config[key].as_array() {
                        for part in parts {
                            original.push(part.as_str().ok_or_else(failure)?.to_string());
                        }
                    }
                }
            }
            if original.is_empty() {
                return Err(RuntimeError::Rejected("image_command_missing"));
            }
            args.extend([
                "--mount".into(),
                format!("type=bind,src={},dst=/.platform-secrets,ro", dir.display()),
                "--mount".into(),
                format!(
                    "type=bind,src={},dst=/.platform-secret-exec,ro",
                    self.root.join("secret-exec").display()
                ),
                "--entrypoint".into(),
                "/.platform-secret-exec".into(),
            ]);
        } else if !original.is_empty() {
            args.extend(["--entrypoint".into(), original.remove(0)]);
        }
        args.extend(["--read-only".into(), "--no-healthcheck".into(), image]);
        args.extend(original);
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
            Ok(info) if info["State"]["Running"] == true => {
                self.command(&[
                    "stop".into(),
                    "--time".into(),
                    grace.as_secs().min(60).to_string(),
                    op.instance_id.to_string(),
                ])
                .await?;
            }
            Ok(_) => {} // Failed creates have metadata but no task to stop; destroy still runs.
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
        let mut entries = crate::read_logs(&self.logfile(id)).await;
        let values = if self.root.join(format!("{id}.has-secrets")).exists() {
            crate::secrets::load(id).await.map_err(|_| failure())?
        } else {
            BTreeMap::new()
        };
        for entry in &mut entries {
            entry.line = crate::secrets::redact(&entry.line, &values);
        }
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

// Rust and OCI use different names for the same CPU architecture.
fn matches_platform(member: &Value, arch: &str) -> bool {
    let oci = match arch {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        _ => return false,
    };
    member["platform"]["os"] == "linux" && member["platform"]["architecture"] == oci
}

#[cfg(test)]
mod platform_tests {
    use super::*;
    #[test]
    fn selects_native_manifest_and_rejects_attestations() {
        let arm = serde_json::json!({"platform":{"os":"linux","architecture":"arm64"}});
        let amd = serde_json::json!({"platform":{"os":"linux","architecture":"amd64"}});
        assert!(matches_platform(&arm, "aarch64"));
        assert!(matches_platform(&amd, "x86_64"));
        assert!(!matches_platform(&amd, "aarch64"));
        assert!(!matches_platform(&arm, "x86_64"));
        assert!(!matches_platform(
            &serde_json::json!({"platform":{"os":"unknown","architecture":"unknown"}}),
            "aarch64"
        ));
        assert!(!matches_platform(&arm, "unsupported"));
    }
}
