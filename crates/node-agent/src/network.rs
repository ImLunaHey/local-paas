//! Exact workload-IP/database-port grants; never opens the NAS LAN.
use platform_runtime::RuntimeError;
use serde::{Deserialize, Serialize};
use std::{net::Ipv4Addr, path::Path, process::Stdio, time::Duration};
use tokio::{io::AsyncWriteExt, process::Command, sync::Mutex};
use uuid::Uuid;
static LOCK: Mutex<()> = Mutex::const_new(());
#[derive(Serialize, Deserialize)]
struct Grant {
    ip: Ipv4Addr,
    ports: Vec<u16>,
}
fn failure() -> RuntimeError {
    RuntimeError::Rejected("database_network_policy_failed")
}
pub fn valid_port(port: u16) -> bool {
    (21000..=21003).contains(&port)
        || (21100..=21103).contains(&port)
        || (21200..=21203).contains(&port)
}
pub fn address(slot: u16) -> Result<Ipv4Addr, RuntimeError> {
    if slot > 3 {
        return Err(failure());
    }
    let prefix = std::env::var("WORKLOAD_NETWORK_PREFIX").map_err(|_| failure())?;
    let ip: Ipv4Addr = format!("{prefix}.{}", 100 + slot)
        .parse()
        .map_err(|_| failure())?;
    if ip.octets()[0..2] != [172, 31] {
        return Err(failure());
    }
    Ok(ip)
}
pub async fn apply(id: Uuid, ip: Option<Ipv4Addr>, ports: &[u16]) -> Result<(), RuntimeError> {
    let _guard = LOCK.lock().await;
    if ports.iter().any(|p| !valid_port(*p)) {
        return Err(failure());
    }
    // Grants describe this boot's network namespaces. /run survives an agent
    // restart, but never resurrects stale or partially persisted grants after a
    // VM power loss. Every assignment rebuilds its grant before it can start.
    let directory = Path::new("/run/local-paas-network-grants");
    tokio::fs::create_dir_all(directory)
        .await
        .map_err(|_| failure())?;
    let path = directory.join(format!("{id}.json"));
    if let Some(ip) = ip {
        let temp = directory.join(format!("{id}.tmp"));
        let bytes = serde_json::to_vec(&Grant {
            ip,
            ports: ports.to_vec(),
        })
        .map_err(|_| failure())?;
        tokio::fs::write(&temp, bytes)
            .await
            .map_err(|_| failure())?;
        tokio::fs::rename(temp, path).await.map_err(|_| failure())?;
    } else if let Err(error) = tokio::fs::remove_file(path).await
        && error.kind() != std::io::ErrorKind::NotFound
    {
        return Err(failure());
    }
    let mut entries = tokio::fs::read_dir(directory)
        .await
        .map_err(|_| failure())?;
    let mut elements = std::collections::BTreeSet::new();
    while let Some(entry) = entries.next_entry().await.map_err(|_| failure())? {
        if entry.path().extension().is_none_or(|e| e != "json") {
            continue;
        }
        let grant: Grant =
            serde_json::from_slice(&tokio::fs::read(entry.path()).await.map_err(|_| failure())?)
                .map_err(|_| failure())?;
        if grant.ip.octets()[0..2] != [172, 31] || grant.ports.iter().any(|p| !valid_port(*p)) {
            return Err(failure());
        }
        for port in grant.ports {
            elements.insert(format!("{} . {port}", grant.ip));
        }
    }
    let mut rules = "flush set inet local_paas_workloads database_egress\n".to_string();
    if !elements.is_empty() {
        rules += &format!(
            "add element inet local_paas_workloads database_egress {{ {} }}\n",
            elements.into_iter().collect::<Vec<_>>().join(", ")
        );
    }
    let mut child = Command::new("nft")
        .args(["-f", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| failure())?;
    let result = tokio::time::timeout(Duration::from_secs(10), async {
        child
            .stdin
            .take()
            .ok_or_else(failure)?
            .write_all(rules.as_bytes())
            .await
            .map_err(|_| failure())?;
        child.wait().await.map_err(|_| failure())
    })
    .await
    .map_err(|_| failure())??;
    if !result.success() {
        return Err(failure());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_worker_slot_ports_are_allowed() {
        for port in [21000, 21003, 21102, 21203] {
            assert!(valid_port(port));
        }
        for port in [5432, 15000, 18443, 21004, 21199] {
            assert!(!valid_port(port));
        }
    }
}
