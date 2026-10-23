mod containerd;
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

#[derive(Deserialize)]
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
    let runtime = Arc::new(Containerd::new(root, config.node_id));
    let reports: Reports = Arc::new(RwLock::new(HashMap::new()));
    let (desired, rx) = watch::channel(Vec::<Assignment>::new());
    let mut tasks = HashMap::new();
    println!("Node agent ready: {}", config.node_id);
    loop {
        let request = SyncRequest {
            version: VERSION,
            node_id: config.node_id,
            observations: reports.read().await.values().cloned().collect(),
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
                    for assignment in &response.assignments {
                        if !tasks.contains_key(&assignment.instance_id) {
                            let id = assignment.instance_id;
                            let runtime = runtime.clone();
                            let reports = reports.clone();
                            let rx = rx.clone();
                            let health = health.clone();
                            tasks.insert(
                                id,
                                tokio::spawn(async move {
                                    instance_loop(id, runtime, reports, rx, health).await;
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
    if a.spec.validate().is_err()
        || !a.spec.secrets.is_empty()
        || !(20000..20004).contains(&a.published_port)
        || a.generation < 1
    {
        return None;
    }
    let Workload::OciService { port, .. } = a.spec.workload else {
        return None;
    };
    Some((
        Operation {
            id: a.deployment_id,
            instance_id: a.instance_id,
            generation: a.generation as u64,
            controller_epoch: 1,
        },
        PrepareSpec {
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
            mounts: vec![],
            secret_names: vec![],
            network: NetworkPolicy {
                declared_port: port,
                published_port: a.published_port,
                allowed_egress: vec![],
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
) {
    let mut started = None;
    let mut stable = None;
    let mut previous = None;
    let mut failed = None;
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
            state: "starting".into(),
            diagnostic: None,
            metrics: None,
            logs: vec![],
        };
        if a.desired_state == "stopped" {
            let result = match runtime.info(id).await {
                Ok(_) => match runtime.stop(&op, Duration::from_secs(20)).await {
                    Ok(()) => runtime.destroy(&op).await,
                    Err(e) => Err(e),
                },
                Err(platform_runtime::RuntimeError::NotFound) => Ok(()),
                Err(e) => Err(e),
            };
            if result.is_ok() {
                report.state = "stopped".into();
                stopped = true;
            } else {
                report.state = "unknown".into();
                report.diagnostic = Some("cleanup_failed".into());
            }
        } else if a.desired_state == "running" {
            if started.is_none() && failed.is_none() {
                reports.write().await.insert(id, report.clone());
                match runtime.prepare(&op, &spec).await {
                    Ok(()) => {
                        if runtime.start(&op).await.is_ok() {
                            started = Some(Instant::now());
                        } else {
                            failed = Some("start_failed");
                        }
                    }
                    Err(_) => failed = Some("prepare_failed"),
                }
            }
            if let Some(code) = failed {
                report.state = "failed".into();
                report.diagnostic = Some(code.into());
            } else if let Ok(info) = runtime.info(id).await {
                if info["State"]["Running"] != true {
                    failed = Some("process_exited");
                    report.state = "failed".into();
                    report.diagnostic = Some("process_exited".into());
                } else {
                    let Workload::OciService { readiness, .. } = &a.spec.workload else {
                        unreachable!()
                    };
                    let ready = health
                        .get(format!(
                            "http://127.0.0.1:{}{}",
                            a.published_port, readiness.path
                        ))
                        .send()
                        .await
                        .is_ok_and(|r| r.status().is_success());
                    if ready {
                        let since = stable.get_or_insert_with(Instant::now);
                        if since.elapsed().as_secs() >= readiness.stabilization_seconds as u64 {
                            report.state = "ready".into();
                        }
                    } else {
                        stable = None;
                        report.diagnostic = Some("readiness_pending".into());
                        if started.is_some_and(|t| t.elapsed() > Duration::from_secs(120)) {
                            failed = Some("readiness_failed");
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
        report.logs = read_logs(&runtime.logfile(id)).await;
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
async fn measure(pid: u64, previous: &mut Option<(Instant, u64, u64)>) -> Option<Metrics> {
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
    let now = Instant::now();
    let milli = previous
        .as_ref()
        .filter(|(_, _, p)| *p == pid)
        .map(|(t, c, _)| {
            cpu.saturating_sub(*c) as f64 / now.duration_since(*t).as_secs_f64() / 1000.0
        });
    *previous = Some((now, cpu, pid));
    Some(Metrics {
        cpu_millis: milli?,
        memory_bytes,
        pids,
    })
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
