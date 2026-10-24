//! Explicit, offline preparation of a mutually authenticated remote worker link.
//! The agent protocol, scheduler and immutable image names remain unchanged.
use serde::{Deserialize, Serialize};
use std::{fmt::Write, net::Ipv4Addr, path::Path};

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Plan {
    pub index: u16,
    pub name: String,
    pub failure_domain: String,
    pub controller_address: Ipv4Addr,
    pub worker_address: Ipv4Addr,
    pub controller_root: String,
    pub worker_root: String,
}

fn private_address(ip: Ipv4Addr) -> bool {
    ip.is_private() || (ip.octets()[0] == 100 && (64..128).contains(&ip.octets()[1]))
}
pub fn safe_path(path: &str) -> bool {
    Path::new(path).is_absolute()
        && !path.ends_with('/')
        && path.split('/').all(|part| part != "." && part != "..")
        && path
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"/._-".contains(&b))
}
impl Plan {
    pub fn validate(&self) -> Result<()> {
        if !(4..=7).contains(&self.index) {
            return Err("remote worker index must be 4–7, unique across the installation".into());
        }
        for label in [&self.name, &self.failure_domain] {
            if label.is_empty()
                || label.len() > 63
                || !label
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            {
                return Err(
                    "name and failureDomain must be 1–63 lowercase letters, digits or hyphens"
                        .into(),
                );
            }
        }
        if !private_address(self.controller_address)
            || !private_address(self.worker_address)
            || self.controller_address == self.worker_address
        {
            return Err(
                "use distinct private IPv4 addresses on an established encrypted network".into(),
            );
        }
        if !safe_path(&self.controller_root) || !safe_path(&self.worker_root) {
            return Err(
                "checkout roots must be absolute paths containing only letters, digits, /, ., _, -"
                    .into(),
            );
        }
        Ok(())
    }
    pub fn base(&self) -> u16 {
        21000 + (self.index - 1) * 100
    }
    pub fn link_base(&self) -> u16 {
        30000 + self.index * 100
    }
    pub fn directory(&self, controller: bool) -> String {
        format!(
            "{}/.local/remote-workers/{}/{}",
            if controller {
                &self.controller_root
            } else {
                &self.worker_root
            },
            self.index,
            if controller { "controller" } else { "worker" }
        )
    }
}

fn section(
    out: &mut String,
    name: &str,
    client: bool,
    accept: &str,
    connect: &str,
    directory: &str,
    peer: Ipv4Addr,
) {
    // All inputs are validated or generated; there are no user-selected destinations.
    writeln!(out, "\n[{name}]\nclient = {}\naccept = {accept}\nconnect = {connect}\ncert = {directory}/identity.crt\nkey = {directory}/identity.key\nCAfile = {directory}/peer.crt\nverifyPeer = yes\nrequireCert = yes\ncheckIP = {peer}\nsslVersionMin = TLSv1.3\nTIMEOUTconnect = 5\nTIMEOUTidle = 86400", if client { "yes" } else { "no" }).expect("string write");
}
/// Fixed listeners, never a general-purpose CONNECT/SOCKS proxy. Only the peer's
/// pinned certificate is accepted, in both directions. Plaintext stays on loopback.
pub fn tunnel_config(plan: &Plan, controller: bool) -> Result<String> {
    plan.validate()?;
    let directory = plan.directory(controller);
    let mut text =
        "foreground = yes\nsyslog = no\ndebug = warning\npid =\nsocket = l:SO_REUSEADDR=yes\n"
            .to_string();
    let peer = if controller {
        plan.worker_address
    } else {
        plan.controller_address
    };
    // Each remote worker has a separate controller listener/pin set.
    for (name, local, offset) in [
        ("agent", 18443, 0),
        (
            "registry",
            if controller {
                15100 + plan.index
            } else {
                15000
            },
            1,
        ),
    ] {
        let tls = format!("{}:{}", plan.controller_address, plan.link_base() + offset);
        let plain = format!("127.0.0.1:{local}");
        let (accept, connect) = if controller {
            (&tls, &plain)
        } else {
            (&plain, &tls)
        };
        section(
            &mut text,
            name,
            !controller,
            accept,
            connect,
            &directory,
            peer,
        );
    }
    for index in 1..=7 {
        for slot in 0..4 {
            let port = 21000 + (index - 1) * 100 + slot;
            let plain = format!("127.0.0.1:{port}");
            let own = index == plan.index;
            let tls = if own {
                format!("{}:{}", plan.worker_address, plan.link_base() + 40 + slot)
            } else {
                format!(
                    "{}:{}",
                    plan.controller_address,
                    plan.link_base() + 10 + (index - 1) * 4 + slot
                )
            };
            let client = controller == own;
            let (accept, connect) = if client {
                (&plain, &tls)
            } else {
                (&tls, &plain)
            };
            section(
                &mut text,
                &format!("worker-{index}-{slot}"),
                client,
                accept,
                connect,
                &directory,
                peer,
            );
        }
    }
    Ok(text)
}
pub fn registry_config(plan: &Plan) -> Result<String> {
    plan.validate()?;
    Ok(format!(
        "{{\n admin off\n auto_https off\n}}\nhttp://:{} {{\n bind 127.0.0.1\n @pull {{\n  method GET HEAD\n  path /v2/*\n }}\n handle @pull {{\n  reverse_proxy 127.0.0.1:15000\n }}\n handle {{\n  respond 403\n }}\n}}\n",
        15100 + plan.index
    ))
}
/// Persistent unprivileged link processes; installation is explicit and separate
/// from preparation. No raw runtime socket or controller database reaches a peer.
pub fn service_unit(plan: &Plan, controller: bool, registry: bool) -> Result<String> {
    plan.validate()?;
    let root = if controller {
        &plan.controller_root
    } else {
        &plan.worker_root
    };
    let directory = plan.directory(controller);
    let command = if registry {
        format!(
            "{root}/.local/host-tools/bin/caddy run --config {directory}/Caddyfile --adapter caddyfile"
        )
    } else {
        format!("{root}/.local/host-tools/bin/stunnel {directory}/stunnel.conf")
    };
    Ok(format!(
        "[Unit]\nDescription=Local PaaS remote worker {} {}\nAfter=network-online.target\nWants=network-online.target\n[Service]\nExecStart={command}\nRestart=on-failure\nRestartSec=5\nUMask=0077\nNoNewPrivileges=true\nPrivateTmp=true\nLimitCORE=0\nMemoryMax=256M\nTasksMax=128\nLimitNOFILE=4096\n[Install]\nWantedBy=default.target\n",
        plan.index,
        if registry {
            "read-only registry"
        } else {
            "authenticated link"
        }
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn plan() -> Plan {
        Plan {
            index: 4,
            name: "worker-4".into(),
            failure_domain: "host-b".into(),
            controller_address: "100.64.0.1".parse().unwrap(),
            worker_address: "100.64.0.2".parse().unwrap(),
            controller_root: "/srv/platform".into(),
            worker_root: "/srv/platform".into(),
        }
    }
    #[test]
    fn rejects_public_addresses_injection_and_reserved_indexes() {
        let original = plan();
        for index in [0, 1, 3, 8, u16::MAX] {
            let mut p = original.clone();
            p.index = index;
            assert!(p.validate().is_err());
        }
        for address in [
            "0.0.0.0",
            "127.0.0.1",
            "8.8.8.8",
            "169.254.1.1",
            "100.128.0.1",
        ] {
            let mut p = original.clone();
            p.worker_address = address.parse().unwrap();
            assert!(p.validate().is_err());
        }
        for path in [
            "relative",
            "/srv/foo\nexec=bad",
            "/srv/../etc",
            "/srv/$HOME",
            "/srv/x%h",
        ] {
            assert!(!safe_path(path));
        }
    }
    #[test]
    fn fixed_routes_and_pins_cover_every_slot_without_listener_collisions() {
        for index in 4..=7 {
            let mut p = plan();
            p.index = index;
            for controller in [true, false] {
                let text = tunnel_config(&p, controller).unwrap();
                assert_eq!(text.matches("verifyPeer = yes").count(), 30);
                assert_eq!(text.matches("requireCert = yes").count(), 30);
                assert!(!text.contains("0.0.0.0:"));
                let listeners: Vec<_> = text
                    .lines()
                    .filter_map(|line| line.strip_prefix("accept = "))
                    .collect();
                let unique: std::collections::HashSet<_> = listeners.iter().collect();
                assert_eq!(listeners.len(), unique.len());
                assert_eq!(
                    listeners
                        .iter()
                        .filter(|l| l.starts_with("127.0.0.1:"))
                        .count(),
                    if controller { 4 } else { 26 }
                );
                assert!(text.contains(&format!("{}:{}", p.worker_address, p.link_base() + 40)));
            }
            assert!(registry_config(&p).unwrap().contains("method GET HEAD"));
            assert!(registry_config(&p).unwrap().contains("respond 403"));
        }
    }
}
