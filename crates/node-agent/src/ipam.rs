//! Reconcile orphaned host-local reservations only after proving their runtime owner is gone.
use platform_runtime::RuntimeError;
use std::{net::Ipv4Addr, path::Path, process::Stdio, time::Duration};
use tokio::{io::AsyncWriteExt, process::Command};

fn unavailable() -> RuntimeError {
    RuntimeError::Rejected("workload_address_still_reserved")
}

#[derive(Debug, PartialEq)]
pub struct Reservation {
    pub runtime_id: String,
    interface: String,
}
impl Reservation {
    fn parse(text: &str) -> Result<Self, RuntimeError> {
        let mut lines = text.lines();
        let id = lines
            .next()
            .and_then(|s| s.strip_prefix("local-paas-"))
            .ok_or_else(unavailable)?;
        let interface = lines.next().ok_or_else(unavailable)?;
        if id.len() != 64
            || !id.bytes().all(|c| c.is_ascii_hexdigit())
            || !interface
                .strip_prefix("eth")
                .is_some_and(|n| !n.is_empty() && n.bytes().all(|c| c.is_ascii_digit()))
            || lines.next().is_some()
        {
            return Err(unavailable());
        }
        Ok(Self {
            runtime_id: id.into(),
            interface: interface.into(),
        })
    }
}

pub async fn reservation(ip: Ipv4Addr) -> Result<Option<Reservation>, RuntimeError> {
    let path = Path::new("/run/local-paas-cni/workloads").join(ip.to_string());
    match tokio::fs::read_to_string(path).await {
        Ok(text) => Reservation::parse(&text).map(Some),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(unavailable()),
    }
}

pub async fn task_absent(id: &str) -> Result<bool, RuntimeError> {
    let result = tokio::time::timeout(
        Duration::from_secs(10),
        Command::new("ctr")
            .args(["--namespace", "local-paas", "tasks", "list", "--quiet"])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| unavailable())?
    .map_err(|_| unavailable())?;
    if !result.status.success() || result.stdout.len() > 65536 {
        return Err(unavailable());
    }
    let tasks = std::str::from_utf8(&result.stdout).map_err(|_| unavailable())?;
    Ok(!tasks.lines().any(|task| task.trim() == id))
}

pub async fn release(ip: Ipv4Addr, reservation: &Reservation) -> Result<(), RuntimeError> {
    // Use the plugin's DEL operation (including its lock and owner check), never unlink a lease.
    let plugin = std::env::var("HOST_LOCAL_PLUGIN").map_err(|_| unavailable())?;
    let octets = ip.octets();
    let config = serde_json::json!({"cniVersion":"1.0.0", "name":"workloads", "ipam": {
        "type":"host-local", "dataDir":"/run/local-paas-cni",
        "ranges":[[{"subnet":format!("{}.{}.{}.0/24",octets[0],octets[1],octets[2])}]]
    }});
    plugin_command(&plugin, "DEL", reservation, &config).await
}

async fn plugin_command(
    plugin: &str,
    operation: &str,
    reservation: &Reservation,
    config: &serde_json::Value,
) -> Result<(), RuntimeError> {
    let mut child = Command::new(plugin)
        .env_clear()
        .env("CNI_COMMAND", operation)
        .env(
            "CNI_CONTAINERID",
            format!("local-paas-{}", reservation.runtime_id),
        )
        .env("CNI_IFNAME", &reservation.interface)
        .env(
            "CNI_NETNS",
            if operation == "ADD" {
                "/nonexistent"
            } else {
                ""
            },
        )
        .env("CNI_PATH", "/nonexistent")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| unavailable())?;
    let status = tokio::time::timeout(Duration::from_secs(10), async {
        child
            .stdin
            .take()
            .ok_or_else(unavailable)?
            .write_all(config.to_string().as_bytes())
            .await
            .map_err(|_| unavailable())?;
        child.wait().await.map_err(|_| unavailable())
    })
    .await
    .map_err(|_| unavailable())??;
    if !status.success() {
        return Err(unavailable());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_exact_platform_owners_are_reclaimable() {
        let id = "a".repeat(64);
        assert_eq!(
            Reservation::parse(&format!("local-paas-{id}\r\neth0"))
                .unwrap()
                .runtime_id,
            id
        );
        for text in [
            format!("other-{id}\neth0"),
            format!("local-paas-{id}\n../eth0"),
            format!("local-paas-{id}\neth0\nextra"),
            "local-paas-short\neth0".into(),
        ] {
            assert!(Reservation::parse(&text).is_err());
        }
    }
    #[tokio::test]
    #[ignore = "requires HOST_LOCAL_PLUGIN_TEST pointing to the pinned CNI host-local binary"]
    async fn real_plugin_releases_orphans_without_releasing_a_replacement() {
        let plugin = std::env::var("HOST_LOCAL_PLUGIN_TEST").expect("set HOST_LOCAL_PLUGIN_TEST");
        let root = tempfile::tempdir().unwrap();
        let config = serde_json::json!({"cniVersion":"1.0.0", "name":"workloads",
            "args":{"cni":{"ips":["172.31.255.100"]}},
            "ipam":{"type":"host-local", "dataDir":root.path(), "ranges":[[{"subnet":"172.31.255.0/24"}]]}});
        let old = Reservation {
            runtime_id: "a".repeat(64),
            interface: "eth0".into(),
        };
        let new = Reservation {
            runtime_id: "b".repeat(64),
            interface: "eth0".into(),
        };
        let path = root.path().join("workloads/172.31.255.100");
        for _ in 0..10 {
            plugin_command(&plugin, "ADD", &old, &config).await.unwrap();
            assert!(
                plugin_command(&plugin, "ADD", &new, &config).await.is_err(),
                "reproduce occupied address failure"
            );
            plugin_command(&plugin, "DEL", &old, &config).await.unwrap();
            plugin_command(&plugin, "ADD", &new, &config).await.unwrap();
            plugin_command(&plugin, "DEL", &old, &config).await.unwrap();
            assert_eq!(
                Reservation::parse(&std::fs::read_to_string(&path).unwrap()).unwrap(),
                new
            );
            plugin_command(&plugin, "DEL", &new, &config).await.unwrap();
            assert!(!path.exists());
        }
    }
}
