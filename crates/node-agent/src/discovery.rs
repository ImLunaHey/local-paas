//! Bounded TCP forwarding for explicitly assigned private service connections.
//! No HTTP parsing: streaming, WebSocket upgrades and application headers survive.
use platform_protocol::{Assignment, PrivateBackend};
use std::{
    collections::HashMap,
    net::{IpAddr, Ipv4Addr},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{RwLock, Semaphore},
};

pub const BASE: u16 = 24000;
type Routes = HashMap<(Ipv4Addr, u16), Vec<PrivateBackend>>;
#[derive(Clone)]
pub struct Discovery {
    routes: Arc<RwLock<Routes>>,
}
impl Discovery {
    pub async fn start() -> std::io::Result<Self> {
        let routes = Arc::new(RwLock::new(HashMap::new()));
        let limit = Arc::new(Semaphore::new(128));
        let next = Arc::new(AtomicUsize::new(0));
        // Bind all sockets before spawning to avoid a partial listener set.
        let mut listeners = Vec::new();
        for port in BASE..BASE + 16 {
            listeners.push((
                port,
                TcpListener::bind((Ipv4Addr::UNSPECIFIED, port)).await?,
            ));
        }
        for (port, listener) in listeners {
            let routes = routes.clone();
            let limit = limit.clone();
            let next = next.clone();
            tokio::spawn(async move {
                loop {
                    let Ok((client, peer)) = listener.accept().await else {
                        break;
                    };
                    let Ok(permit) = limit.clone().try_acquire_owned() else {
                        continue;
                    };
                    let IpAddr::V4(ip) = peer.ip() else { continue };
                    let endpoints = routes
                        .read()
                        .await
                        .get(&(ip, port))
                        .cloned()
                        .unwrap_or_default();
                    let offset = next.fetch_add(1, Ordering::Relaxed);
                    tokio::spawn(async move {
                        let _permit = permit;
                        forward(client, endpoints, offset).await;
                    });
                }
            });
        }
        Ok(Self { routes })
    }
    pub async fn update(&self, assignments: &[Assignment]) {
        let mut routes = HashMap::new();
        for a in assignments {
            if a.desired_state != "running"
                || a.private_backends.len() != a.spec.workload.private_connections().len()
                || a.private_backends.len() > 16
            {
                continue;
            }
            let Some(slot) = a.published_port.checked_sub(20000) else {
                continue;
            };
            let Ok(ip) = crate::network::address(slot) else {
                continue;
            };
            for (index, backends) in a.private_backends.iter().enumerate() {
                if backends.len() > 32
                    || backends.iter().any(|b| !crate::network::valid_port(b.port))
                {
                    continue;
                }
                routes.insert((ip, BASE + index as u16), backends.clone());
            }
        }
        *self.routes.write().await = routes;
    }
}
fn usable(backend: &PrivateBackend) -> bool {
    let now = chrono::Utc::now().timestamp_millis();
    crate::network::valid_port(backend.port)
        && backend.expires_unix_ms > now
        && backend.expires_unix_ms <= now + 15_000
}
async fn forward(mut client: TcpStream, endpoints: Vec<PrivateBackend>, offset: usize) {
    for index in 0..endpoints.len() {
        let endpoint = &endpoints[(index + offset) % endpoints.len()];
        if !usable(endpoint) {
            continue;
        }
        let Ok(Ok(mut upstream)) = tokio::time::timeout(
            Duration::from_secs(2),
            TcpStream::connect((Ipv4Addr::new(10, 0, 2, 2), endpoint.port)),
        )
        .await
        else {
            continue;
        };
        // Never retry once application bytes have been sent (side effects).
        let _ = tokio::time::timeout(
            Duration::from_secs(86400),
            tokio::io::copy_bidirectional(&mut client, &mut upstream),
        )
        .await;
        return;
    }
}
pub fn gateway() -> Option<Ipv4Addr> {
    let ip = crate::network::address(0).ok()?;
    let mut octets = ip.octets();
    octets[3] = 1;
    Some(octets.into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stale_and_unbounded_routes_fail_closed() {
        let now = chrono::Utc::now().timestamp_millis();
        assert!(usable(&PrivateBackend {
            port: 21000,
            expires_unix_ms: now + 9000
        }));
        for (port, expires) in [(8080, now + 9000), (21000, now - 1), (21000, now + 60000)] {
            assert!(!usable(&PrivateBackend {
                port,
                expires_unix_ms: expires
            }));
        }
    }
}
