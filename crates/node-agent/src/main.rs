mod containerd;
mod discovery;
mod ipam;
mod jobs;
mod network;
mod recovery;
mod secrets;
mod volume_files;
mod volumes;
use containerd::Containerd;
use platform_domain::Workload;
use platform_protocol::{
    Assignment, InstanceReport, LogEntry, Metrics, SyncRequest, SyncResponse, VERSION,
};
use platform_runtime::{Identity, Limits, NetworkPolicy, Operation, PrepareSpec, Runtime};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncSeekExt},
    sync::{RwLock, watch},
};
use uuid::Uuid;

#[derive(Clone, Deserialize)]
struct Config {
    node_id: Uuid,
    token: String,
    controller_url: String,
}
type Reports = Arc<RwLock<HashMap<Uuid, InstanceReport>>>;
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dir =
        PathBuf::from(std::env::var("AGENT_CREDENTIALS").unwrap_or("/run/node-credentials".into()));
    let config: Config = serde_json::from_slice(&tokio::fs::read(dir.join("config.json")).await?)?;
    if !config.controller_url.starts_with("https://") || config.token.len() != 64 {
        return Err("invalid agent configuration".into());
    }
    let mut pem = tokio::fs::read(dir.join("client.crt")).await?;
    pem.extend(tokio::fs::read(dir.join("client.key")).await?);
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .tls_built_in_root_certs(false)
        .add_root_certificate(reqwest::Certificate::from_pem(
            &tokio::fs::read(dir.join("ca.crt")).await?,
        )?)
        .identity(reqwest::Identity::from_pem(&pem)?)
        .timeout(Duration::from_secs(15))
        .build()?;
    let health = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(3))
        .build()?;
    let root = PathBuf::from("/var/lib/local-paas-agent");
    tokio::fs::create_dir_all(root.join("logs")).await?;
    tokio::fs::create_dir_all("/run/local-paas-logs").await?;
    let helper = std::env::var("SECRET_EXECUTOR")?;
    tokio::fs::copy(helper, root.join("secret-exec.new")).await?;
    tokio::fs::rename(root.join("secret-exec.new"), root.join("secret-exec")).await?;
    tokio::spawn(volume_files::run(
        config.clone(),
        client.clone(),
        root.clone(),
    ));
    let runtime = Arc::new(Containerd::new(root, config.node_id));
    let reports: Reports = Arc::new(RwLock::new(HashMap::new()));
    let (desired, rx) = watch::channel(Vec::<Assignment>::new());
    let mut tasks = HashMap::new();
    let discovery = discovery::Discovery::start().await?;
    println!("Node agent ready: {}", config.node_id);
    loop {
        let request = SyncRequest {
            version: VERSION,
            node_id: config.node_id,
            observations: reports.read().await.values().cloned().collect(),
            capabilities: vec![
                "databases-v1".into(),
                "shared-volumes-v1".into(),
                "rustfs-v1".into(),
                "volume-files-v1".into(),
                "recovery-v1".into(),
                "workers-v1".into(),
                "jobs-v1".into(),
                "private-network-v1".into(),
            ],
        };
        match client
            .post(format!("{}/api/agent/sync", config.controller_url))
            .bearer_auth(&config.token)
            .json(&request)
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => {
                if let Ok(response) = response.json::<SyncResponse>().await
                    && response.version == VERSION
                    && response.assignments.len() <= 4
                {
                    discovery.update(&response.assignments).await;
                    for assignment in &response.assignments {
                        if !tasks.contains_key(&assignment.instance_id) {
                            let id = assignment.instance_id;
                            let runtime = runtime.clone();
                            let reports = reports.clone();
                            let rx = rx.clone();
                            let health = health.clone();
                            let client = client.clone();
                            let config = config.clone();
                            tasks.insert(
                                id,
                                tokio::spawn(async move {
                                    instance_loop(id, runtime, reports, rx, health, client, config)
                                        .await;
                                }),
                            );
                        }
                    }
                    desired.send_replace(response.assignments);
                    tasks.retain(|_, handle| !handle.is_finished());
                }
            }
            _ => eprintln!("Controller unavailable; retaining current workloads"),
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}
fn prepare(a: &Assignment, node: Uuid) -> Option<(Operation, PrepareSpec)> {
    if let Some(job) = &a.job
        && (!a.spec.workload.is_worker()
            || a.recovery_allowed
            || job.command.len() > 64
            || job
                .command
                .iter()
                .any(|v| v.len() > 4096 || v.contains('\0'))
            || job.command.first().is_some_and(|v| v.is_empty())
            || job.deadline_unix_ms < 0)
    {
        return None;
    }
    if a.spec.validate().is_err() || !(20000..20004).contains(&a.published_port) || a.generation < 1
    {
        return None;
    }
    let (port, mut mounts, mut environment) = match &a.spec.workload {
        Workload::OciService { port, .. } => (*port, vec![], std::collections::BTreeMap::new()),
        Workload::PostgresService {
            database,
            storage_gib,
        } => (
            Some(5432),
            vec![platform_runtime::Mount::Volume {
                id: a.service_id,
                destination: "/var/lib/postgresql".into(),
                read_only: false,
                size_gib: *storage_gib,
            }],
            std::collections::BTreeMap::from([
                ("POSTGRES_DB".into(), database.clone()),
                ("POSTGRES_USER".into(), "postgres".into()),
            ]),
        ),
        Workload::RustfsService { storage_gib } => (
            Some(9000),
            vec![platform_runtime::Mount::Volume {
                id: a.service_id,
                destination: "/data".into(),
                read_only: false,
                size_gib: *storage_gib,
            }],
            std::collections::BTreeMap::from([(
                "RUSTFS_ACCESS_KEY".into(),
                a.service_id.simple().to_string(),
            )]),
        ),
        Workload::RedisService { storage_gib } => (
            Some(6379),
            vec![platform_runtime::Mount::Volume {
                id: a.service_id,
                destination: "/data".into(),
                read_only: false,
                size_gib: *storage_gib,
            }],
            std::collections::BTreeMap::from([(
                "REDIS_MAXMEMORY".into(),
                (u64::from(a.spec.resources.memory_mib) * 1024 * 1024 * 3 / 4).to_string(),
            )]),
        ),
        _ => return None,
    };
    let mut hosts = std::collections::BTreeMap::new();
    for (index, connection) in a.spec.workload.private_connections().iter().enumerate() {
        let gateway = discovery::gateway()?;
        let hostname = connection.hostname();
        environment.insert(
            connection.env.clone(),
            format!("http://{hostname}:{}", discovery::BASE + index as u16),
        );
        hosts.insert(hostname, gateway.into());
    }
    if let Some(v) = &a.spec.volume {
        mounts.push(platform_runtime::Mount::Volume {
            id: v.id,
            destination: v.mount_path.clone().into(),
            read_only: v.read_only,
            size_gib: a.volume_size_gib?,
        });
    }
    Some((
        Operation {
            id: a.deployment_id,
            instance_id: a.instance_id,
            generation: a.generation as u64,
            controller_epoch: 1,
        },
        PrepareSpec {
            command: a
                .job
                .as_ref()
                .map(|j| j.command.clone())
                .unwrap_or_default(),
            identity: Identity {
                project: a.spec.project.clone(),
                environment: a.spec.environment.clone(),
                service: a.spec.name.clone(),
                revision: a.revision_id,
                instance: a.instance_id,
                node,
            },
            image: a.image_digest.clone(),
            registry_repository: a.image_repository.clone(),
            limits: Limits {
                resources: a.spec.resources,
                pids: 128,
                ephemeral_bytes: 96 * 1024 * 1024,
                log_bytes: 2 * 1024 * 1024,
                io_bytes_per_second: 20 * 1024 * 1024,
            },
            mounts,
            environment,
            secret_names: a.spec.secrets.clone(),
            network: NetworkPolicy {
                hosts,
                declared_port: port,
                published_port: a.published_port,
                allowed_egress: a
                    .database_ports
                    .iter()
                    .map(|port| platform_runtime::EgressRule {
                        address: std::net::Ipv4Addr::new(10, 0, 2, 2).into(),
                        prefix_length: 32,
                        port: *port,
                    })
                    .collect(),
            },
        },
    ))
}
async fn instance_loop(
    id: Uuid,
    runtime: Arc<Containerd>,
    reports: Reports,
    rx: watch::Receiver<Vec<Assignment>>,
    health: reqwest::Client,
    client: reqwest::Client,
    config: Config,
) {
    let mut values = secrets::load(id).await.unwrap_or_default();
    let mut started = None;
    let mut stable = None;
    let mut previous = None;
    let (mut recovery, mut failed) = match recovery::Recovery::load(&runtime.root, id).await {
        Ok(state) => (state, None),
        Err(_) => (
            recovery::Recovery::default(),
            Some("recovery_state_unavailable".to_owned()),
        ),
    };
    let mut prepared = false;
    let mut last_generation = 0;
    let mut stopped = false;
    // A spawned task may run before the watch sender publishes its first assignment.
    tokio::time::sleep(Duration::from_millis(50)).await;
    loop {
        let assignment = rx.borrow().iter().find(|a| a.instance_id == id).cloned();
        let Some(a) = assignment else {
            if stopped {
                reports.write().await.remove(&id);
                break;
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
            continue;
        };
        let Some((op, spec)) = prepare(&a, runtime.node) else {
            eprintln!("Rejected invalid assignment {id}");
            break;
        };
        if a.generation < last_generation {
            tokio::time::sleep(Duration::from_secs(5)).await;
            continue;
        }
        last_generation = a.generation;
        let mut report = InstanceReport {
            instance_id: id,
            generation: a.generation,
            observed_unix_ms: now_millis(),
            process_started_at: None,
            job_result: None,
            state: "starting".into(),
            diagnostic: None,
            metrics: None,
            logs: vec![],
        };
        if a.desired_state == "stopped" && stopped {
            // The slot may already belong to a replacement after our acknowledgement.
            report.state = "stopped".into();
        } else if a.desired_state == "stopped" {
            let result = match runtime.info(id).await {
                Ok(_) => match runtime.stop(&op, Duration::from_secs(20)).await {
                    Ok(()) => runtime.destroy(&op).await,
                    Err(e) => Err(e),
                },
                Err(platform_runtime::RuntimeError::NotFound) => Ok(()),
                Err(e) => Err(e),
            };
            let network_cleanup = if result.is_ok() {
                match network::address(spec.network.published_port - 20000) {
                    Ok(ip) => match runtime.release_orphan_address(ip).await {
                        Ok(()) => network::apply(id, None, &[]).await,
                        Err(error) => Err(error),
                    },
                    Err(error) => Err(error),
                }
            } else {
                Err(platform_runtime::RuntimeError::Rejected("cleanup_pending"))
            };
            if result.is_ok() && network_cleanup.is_ok() {
                report.state = "stopped".into();
                stopped = true;
            } else {
                report.state = "unknown".into();
                report.diagnostic = Some(match result.err().or_else(|| network_cleanup.err()) {
                    Some(platform_runtime::RuntimeError::Diagnostic(message)) => message,
                    Some(platform_runtime::RuntimeError::Rejected(message)) => message.into(),
                    _ => "cleanup_failed".into(),
                });
            }
        } else if a.desired_state == "running"
            && let Some(job) = &a.job
        {
            if !a.spec.secrets.is_empty() && values.is_empty() {
                match secrets::obtain(&client, &config, &a).await {
                    Ok(received) => match secrets::install(&runtime, id, &received).await {
                        Ok(()) => values = received,
                        Err(()) => failed = Some("secret_materialization_failed".into()),
                    },
                    Err(()) => failed = Some("secret_delivery_failed".into()),
                }
            }
            if let Some(code) = &failed {
                report.state = "failed".into();
                report.diagnostic = Some(code.clone());
            } else {
                match jobs::step(&runtime, &op, &spec, job).await {
                    Ok(result) => {
                        report.job_result = result;
                        if report.job_result.is_some() {
                            report.state = "failed".into(); // Terminal observation; result determines outcome.
                        }
                    }
                    Err(()) => {
                        report.state = "unknown".into();
                        report.diagnostic = Some("job_state_unavailable".into());
                    }
                }
                if let Ok(info) = runtime.info(id).await {
                    report.process_started_at = process_started_at(&info);
                    if info["State"]["Running"] == true {
                        report.metrics =
                            measure(info["State"]["Pid"].as_u64().unwrap_or(0), &mut previous)
                                .await;
                    }
                }
            }
        } else if a.desired_state == "running" {
            // Promotion can arrive one heartbeat after a process exit observation.
            if a.recovery_allowed
                && matches!(
                    failed.as_deref(),
                    Some("process_exited" | "readiness_failed" | "database_network_policy_failed")
                )
            {
                failed = None;
            }
            if started.is_none() && failed.is_none() {
                reports.write().await.insert(id, report.clone());
                if !a.spec.secrets.is_empty() && values.is_empty() {
                    match secrets::obtain(&client, &config, &a).await {
                        Ok(received) => match secrets::install(&runtime, id, &received).await {
                            Ok(()) => values = received,
                            Err(()) => failed = Some("secret_materialization_failed".into()),
                        },
                        Err(()) => failed = Some("secret_delivery_failed".into()),
                    }
                }
                if failed.is_none() && !prepared {
                    match runtime.prepare(&op, &spec).await {
                        Ok(()) => prepared = true,
                        Err(platform_runtime::RuntimeError::Diagnostic(code)) => {
                            failed = Some(code)
                        }
                        Err(platform_runtime::RuntimeError::Rejected(code)) => {
                            failed = Some(code.into())
                        }
                        Err(_) => failed = Some("prepare_failed".into()),
                    }
                }
                if failed.is_none() {
                    let gate = match runtime.info(id).await {
                        Ok(info) if a.recovery_allowed && info["State"]["Running"] != true => {
                            recovery.before_start(&runtime.root, id, now_millis()).await
                        }
                        Ok(_) => Ok(recovery::Gate::Start),
                        Err(_) => {
                            failed = Some("inspect_failed".into());
                            Ok(recovery::Gate::Wait)
                        }
                    };
                    match gate {
                        Ok(recovery::Gate::Start) => match runtime.start(&op).await {
                            Ok(()) => {
                                started = Some(Instant::now());
                                stable = None;
                                previous = None;
                            }
                            Err(error) if !a.recovery_allowed => {
                                failed = Some(match error {
                                    platform_runtime::RuntimeError::Diagnostic(code) => code,
                                    platform_runtime::RuntimeError::Rejected(code) => code.into(),
                                    _ => "start_failed".into(),
                                });
                            }
                            Err(_) => {
                                report.diagnostic = Some("restart_backoff".into());
                            }
                        },
                        Ok(recovery::Gate::Wait) => {
                            report.diagnostic = Some("restart_backoff".into())
                        }
                        Ok(recovery::Gate::Exhausted) => failed = Some("crash_loop".into()),
                        Err(_) => failed = Some("recovery_state_unavailable".into()),
                    }
                }
            }
            if let Some(code) = &failed {
                report.state = "failed".into();
                report.diagnostic = Some(code.clone());
            } else if started.is_none() {
                // A backoff reservation is pending; do not classify it as another exit.
            } else if let Ok(info) = runtime.info(id).await {
                report.process_started_at = process_started_at(&info);
                if info["State"]["Running"] != true {
                    started = None;
                    stable = None;
                    previous = None;
                    if !a.recovery_allowed {
                        failed = Some("process_exited".into());
                        report.state = "failed".into();
                    }
                    report.diagnostic = Some("process_exited".into());
                } else {
                    let default_readiness = platform_domain::Readiness {
                        path: if matches!(a.spec.workload, Workload::RustfsService { .. }) {
                            "/health/ready".into()
                        } else {
                            "/".into()
                        },
                        interval_seconds: 5,
                        stabilization_seconds: 10,
                    };
                    let readiness = match &a.spec.workload {
                        Workload::OciService {
                            readiness: Some(readiness),
                            ..
                        } => readiness,
                        _ => &default_readiness,
                    };
                    let ready = if a.spec.workload.is_worker() {
                        true // Process observation only; no claim of application readiness.
                    } else if matches!(a.spec.workload, Workload::RedisService { .. }) {
                        runtime.command(&["exec".into(),id.to_string(),"/.platform-secret-exec".into(),"sh".into(),"-c".into(),"REDISCLI_AUTH=\"$REDIS_PASSWORD\" exec redis-cli -h 127.0.0.1 ping".into()]).await.is_ok_and(|out|out==b"PONG\n")
                    } else if matches!(a.spec.workload, Workload::PostgresService { .. }) {
                        runtime
                            .command(&[
                                "exec".into(),
                                id.to_string(),
                                "pg_isready".into(),
                                "-h".into(),
                                "127.0.0.1".into(),
                                "-p".into(),
                                "5432".into(),
                                "-U".into(),
                                "postgres".into(),
                                "-t".into(),
                                "2".into(),
                            ])
                            .await
                            .is_ok()
                    } else {
                        health
                            .get(format!(
                                "http://127.0.0.1:{}{}",
                                a.published_port, readiness.path
                            ))
                            .send()
                            .await
                            .is_ok_and(|r| r.status().is_success())
                    };
                    if ready {
                        let since = stable.get_or_insert_with(Instant::now);
                        if since.elapsed().as_secs() >= readiness.stabilization_seconds as u64 {
                            report.state = "ready".into();
                            if recovery
                                .healthy(&runtime.root, id, since.elapsed())
                                .await
                                .is_err()
                            {
                                failed = Some("recovery_state_unavailable".into());
                                report.state = "failed".into();
                                report.diagnostic = failed.clone();
                            }
                        }
                    } else {
                        stable = None;
                        report.diagnostic = Some("readiness_pending".into());
                        if !a.recovery_allowed
                            && started.is_some_and(|t| t.elapsed() > Duration::from_secs(120))
                        {
                            failed = Some("readiness_failed".into());
                            report.state = "failed".into();
                            report.diagnostic = Some("readiness_failed".into());
                        }
                    }
                    if let Some(pid) = info["State"]["Pid"].as_u64() {
                        report.metrics = measure(pid, &mut previous).await;
                    }
                }
            } else {
                report.state = "unknown".into();
                report.diagnostic = Some("inspect_failed".into());
            }
        } else {
            report.state = "unknown".into();
            report.diagnostic = Some("unsupported_desired_state".into());
        }
        if a.spec.secrets.is_empty() || !values.is_empty() {
            report.logs = read_logs(&runtime.logfile(id)).await;
            for log in &mut report.logs {
                log.line = secrets::redact(&log.line, &values);
            }
        }
        if stopped {
            secrets::clear(id).await;
        }
        report.observed_unix_ms = now_millis();
        reports.write().await.insert(id, report);
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}
fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
fn process_started_at(info: &serde_json::Value) -> Option<String> {
    let text = info["State"]["StartedAt"].as_str()?;
    let started = text.parse::<chrono::DateTime<chrono::Utc>>().ok()?;
    (started.timestamp() > 0 && started.timestamp_millis() <= now_millis() + 5000)
        .then(|| text.to_owned())
}

#[cfg(test)]
mod observation_tests {
    #[test]
    fn absent_runtime_start_times_do_not_poison_the_node_heartbeat() {
        for started in [
            "",
            "0001-01-01T00:00:00Z",
            "0001-01-01 00:00:00 +0000 UTC",
            "invalid",
        ] {
            assert!(
                super::process_started_at(&serde_json::json!({"State":{"StartedAt":started}}))
                    .is_none()
            );
        }
        let info = serde_json::json!({"State":{"StartedAt":"2020-01-01T00:00:00Z"}});
        assert_eq!(
            super::process_started_at(&info).as_deref(),
            Some("2020-01-01T00:00:00Z")
        );
    }
}
struct Counters {
    time: Instant,
    pid: u64,
    cpu: u64,
    io: Option<(u64, u64)>,
    network: Option<(u64, u64)>,
}
async fn measure(pid: u64, previous: &mut Option<Counters>) -> Option<Metrics> {
    let path = containerd::cgroup(pid).await?;
    let cpu = tokio::fs::read_to_string(path.join("cpu.stat"))
        .await
        .ok()?
        .lines()
        .find_map(|line| {
            line.strip_prefix("usage_usec ")
                .and_then(|s| s.parse::<u64>().ok())
        })?;
    let memory_bytes = tokio::fs::read_to_string(path.join("memory.current"))
        .await
        .ok()?
        .trim()
        .parse()
        .ok()?;
    let pids = tokio::fs::read_to_string(path.join("pids.current"))
        .await
        .ok()?
        .trim()
        .parse()
        .ok()?;
    let io = tokio::fs::read_to_string(path.join("io.stat"))
        .await
        .ok()
        .map(|text| io_counters(&text));
    let network = tokio::fs::read_to_string(format!("/proc/{pid}/net/dev"))
        .await
        .ok()
        .map(|text| network_counters(&text));
    let now = Instant::now();
    let old = previous.as_ref().filter(|v| v.pid == pid);
    let elapsed = old
        .map(|v| now.duration_since(v.time).as_secs_f64())
        .unwrap_or(0.0);
    let rate = |current: Option<u64>, last: Option<u64>| {
        current
            .zip(last)
            .filter(|(c, p)| c >= p && elapsed > 0.0)
            .map(|(c, p)| (c - p) as f64 / elapsed)
    };
    let result = Metrics {
        cpu_millis: rate(Some(cpu), old.map(|v| v.cpu)).unwrap_or(0.0) / 1000.0,
        memory_bytes,
        pids,
        io_read_bytes_per_second: rate(io.map(|v| v.0), old.and_then(|v| v.io).map(|v| v.0)),
        io_write_bytes_per_second: rate(io.map(|v| v.1), old.and_then(|v| v.io).map(|v| v.1)),
        network_rx_bytes_per_second: rate(
            network.map(|v| v.0),
            old.and_then(|v| v.network).map(|v| v.0),
        ),
        network_tx_bytes_per_second: rate(
            network.map(|v| v.1),
            old.and_then(|v| v.network).map(|v| v.1),
        ),
    };
    let ready = old.is_some();
    *previous = Some(Counters {
        time: now,
        pid,
        cpu,
        io,
        network,
    });
    ready.then_some(result)
}
fn io_counters(text: &str) -> (u64, u64) {
    let mut result = (0u64, 0u64);
    for word in text.split_whitespace() {
        if let Some(v) = word
            .strip_prefix("rbytes=")
            .and_then(|s| s.parse::<u64>().ok())
        {
            result.0 = result.0.saturating_add(v)
        }
        if let Some(v) = word
            .strip_prefix("wbytes=")
            .and_then(|s| s.parse::<u64>().ok())
        {
            result.1 = result.1.saturating_add(v)
        }
    }
    result
}
fn network_counters(text: &str) -> (u64, u64) {
    let mut result = (0u64, 0u64);
    for line in text.lines() {
        if let Some((name, values)) = line.split_once(':') {
            if name.trim() == "lo" {
                continue;
            }
            let values: Vec<&str> = values.split_whitespace().collect();
            if let (Some(rx), Some(tx)) = (
                values.first().and_then(|v| v.parse::<u64>().ok()),
                values.get(8).and_then(|v| v.parse::<u64>().ok()),
            ) {
                result.0 = result.0.saturating_add(rx);
                result.1 = result.1.saturating_add(tx)
            }
        }
    }
    result
}
async fn read_logs(path: &std::path::Path) -> Vec<LogEntry> {
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
            if line.len() > 16384 || !["stdout", "stderr"].contains(&stream) {
                return None;
            }
            let key = format!(
                "{:x}",
                Sha256::digest(format!("{timestamp}\0{stream}\0{line}"))
            );
            if !seen.insert(key.clone()) {
                return None;
            }
            Some(LogEntry {
                key,
                timestamp: timestamp.into(),
                stream: stream.into(),
                line: line.into(),
            })
        })
        .take(256)
        .collect()
}

#[cfg(test)]
mod measurements_tests {
    use super::*;
    #[test]
    fn sums_devices_and_excludes_loopback() {
        assert_eq!(
            io_counters("8:0 rbytes=100 wbytes=200 rios=1\n8:1 rbytes=5 wbytes=7"),
            (105, 207)
        );
        assert_eq!(
            network_counters("lo: 100 0 0 0 0 0 0 0 100 0\neth0: 50 0 0 0 0 0 0 0 60 0"),
            (50, 60)
        );
    }
}
