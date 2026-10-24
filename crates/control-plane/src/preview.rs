//! Independently supervised ingress with bounded route leases and local health checks.
use axum::{
    Router,
    body::Body,
    extract::{Request, State},
    http::{HeaderMap, HeaderName, StatusCode},
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Utc};
use futures_util::StreamExt;
use sqlx::{PgPool, Row};
use std::collections::HashMap;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;
#[derive(Clone)]
struct Proxy {
    routes: Arc<RwLock<HashMap<String, Vec<Backend>>>>,
    client: reqwest::Client,
    next: Arc<AtomicUsize>,
    connections: Arc<Semaphore>,
}
#[derive(Clone)]
struct Backend {
    port: i32,
    expires: DateTime<Utc>,
}
struct RefreshGuard(tokio::task::JoinHandle<()>);
impl Drop for RefreshGuard {
    fn drop(&mut self) {
        self.0.abort();
    }
}

async fn refresh(
    pool: &PgPool,
    health: &reqwest::Client,
) -> Result<HashMap<String, Vec<Backend>>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(712184551)")
        .execute(&mut *tx)
        .await?;
    // Readiness is initially certified by the agent. Local probes keep checking it
    // while the controller is offline. Desired state, route membership and leases
    // remain authoritative; stale observations alone do not kill healthy traffic.
    let rows=sqlx::query("SELECT r.authority,i.id,n.endpoint_base+i.slot AS port,coalesce(d.spec->'workload'->'readiness'->>'path','/') AS path,clock_timestamp()+interval '10 seconds' AS expires FROM (SELECT authority,service_id FROM preview_routes UNION SELECT hostname AS authority,service_id FROM domains WHERE service_id IS NOT NULL) r JOIN deployments d ON d.service_id=r.service_id AND d.status='active' JOIN instances i ON i.deployment_id=d.id JOIN nodes n ON n.id=i.node_id WHERE i.state='ready' AND i.routing_enabled AND i.desired_state='running' AND d.spec->'workload'->>'kind'='oci-service' AND coalesce(d.spec->'workload'->>'execution','http')='http' ORDER BY i.id").fetch_all(&mut *tx).await?;
    for r in &rows {
        sqlx::query("INSERT INTO ingress_route_leases(instance_id,expires_at) VALUES($1,$2) ON CONFLICT(instance_id) DO UPDATE SET expires_at=greatest(ingress_route_leases.expires_at,EXCLUDED.expires_at)").bind(r.get::<Uuid,_>("id")).bind(r.get::<DateTime<Utc>,_>("expires")).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    let mut checks = futures_util::stream::iter(rows.into_iter().map(|r| {
        let health = health.clone();
        async move {
            let authority: String = r.get("authority");
            let port: i32 = r.get("port");
            let path: String = r.get("path");
            let healthy = health
                .get(format!("http://127.0.0.1:{port}{path}"))
                .header("host", &authority)
                .send()
                .await
                .is_ok_and(|response| response.status().is_success());
            (
                authority,
                Backend {
                    port,
                    expires: r.get("expires"),
                },
                healthy,
            )
        }
    }))
    .buffer_unordered(16);
    let mut routes: HashMap<String, Vec<Backend>> = HashMap::new();
    while let Some((authority, backend, healthy)) = checks.next().await {
        if healthy {
            routes.entry(authority).or_default().push(backend);
        }
    }
    Ok(routes)
}

pub async fn serve(
    pool: PgPool,
    listener: tokio::net::TcpListener,
) -> Result<(), Box<dyn std::error::Error>> {
    let routes = Arc::new(RwLock::new(HashMap::new()));
    let health = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(2))
        .build()?;
    let refresh_routes = routes.clone();
    let updater = RefreshGuard(tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(2));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            match tokio::time::timeout(Duration::from_secs(5), refresh(&pool, &health)).await {
                Ok(Ok(snapshot)) => *refresh_routes.write().await = snapshot,
                _ => tracing::warn!(
                    "ingress refresh failed; cached routes expire within ten seconds"
                ),
            }
        }
    }));
    let result = axum::serve(
        listener,
        Router::new().fallback(proxy).with_state(Proxy {
            routes,
            client: client()?,
            next: Arc::new(AtomicUsize::new(0)),
            connections: Arc::new(Semaphore::new(256)),
        }),
    )
    .await;
    drop(updater);
    result?;
    Ok(())
}
fn client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(2))
        .http1_only()
        .read_timeout(Duration::from_secs(300))
        .build()
}

fn hop(name: &HeaderName) -> bool {
    matches!(
        name.as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}
async fn proxy(State(p): State<Proxy>, request: Request) -> Response {
    let permit = match p.connections.clone().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    let authority = request
        .headers()
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    let backend = {
        let routes = p.routes.read().await;
        let ready: Vec<_> = routes
            .get(&authority)
            .into_iter()
            .flatten()
            .filter(|b| b.expires > Utc::now())
            .collect();
        if ready.is_empty() {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                "No healthy application instances are ready.\n",
            )
                .into_response();
        }
        ready[p.next.fetch_add(1, Ordering::Relaxed) % ready.len()].clone()
    };
    forward(
        &p.client,
        request,
        backend.port,
        authority,
        permit,
        Some(backend.expires),
    )
    .await
}
fn connection_tokens(headers: &HeaderMap) -> Vec<HeaderName> {
    headers
        .get_all("connection")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .filter_map(|v| v.trim().parse().ok())
        .collect()
}
fn websocket(headers: &HeaderMap) -> bool {
    headers
        .get("upgrade")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case("websocket"))
        && connection_tokens(headers).iter().any(|v| v == "upgrade")
}
fn strip_hop(headers: &mut HeaderMap) {
    let names = connection_tokens(headers);
    for name in names {
        headers.remove(name);
    }
    let names: Vec<_> = headers.keys().filter(|name| hop(name)).cloned().collect();
    for name in names {
        headers.remove(name);
    }
}
async fn forward(
    client: &reqwest::Client,
    mut request: Request,
    port: i32,
    authority: String,
    permit: OwnedSemaphorePermit,
    expires: Option<DateTime<Utc>>,
) -> Response {
    let upgrade = websocket(request.headers()) && request.method() == axum::http::Method::GET;
    let downstream = upgrade.then(|| hyper::upgrade::on(&mut request));
    let path = request
        .uri()
        .path_and_query()
        .map(|p| p.as_str())
        .unwrap_or("/")
        .to_string();
    let (parts, body) = request.into_parts();
    let body = match tokio::time::timeout(
        Duration::from_secs(30),
        axum::body::to_bytes(body, 8 * 1024 * 1024),
    )
    .await
    {
        Ok(Ok(body)) => body,
        Ok(Err(_)) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
        Err(_) => return StatusCode::REQUEST_TIMEOUT.into_response(),
    };
    // A slow upload must not connect to a slot whose lease expired while reading.
    if expires.is_some_and(|deadline| deadline <= Utc::now()) {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    let mut headers = parts.headers;
    strip_hop(&mut headers);
    let remove: Vec<_> = headers
        .keys()
        .filter(|h| h.as_str().starts_with("x-forwarded-") || h.as_str() == "forwarded")
        .cloned()
        .collect();
    for h in remove {
        headers.remove(h);
    }
    if upgrade {
        headers.insert("connection", "upgrade".parse().unwrap());
        headers.insert("upgrade", "websocket".parse().unwrap());
    }
    let upstream = match tokio::time::timeout(
        Duration::from_secs(30),
        client
            .request(parts.method, format!("http://127.0.0.1:{port}{path}"))
            .headers(headers)
            .header("host", &authority)
            .header("x-forwarded-host", authority)
            .header("x-forwarded-proto", "https")
            .body(body)
            .send(),
    )
    .await
    {
        Ok(Ok(upstream)) => upstream,
        Ok(Err(_)) => return StatusCode::BAD_GATEWAY.into_response(),
        Err(_) => return StatusCode::GATEWAY_TIMEOUT.into_response(),
    };
    let switching = upstream.status() == StatusCode::SWITCHING_PROTOCOLS;
    if switching && (!upgrade || !websocket(upstream.headers())) {
        return StatusCode::BAD_GATEWAY.into_response();
    }
    let mut headers = upstream.headers().clone();
    strip_hop(&mut headers);
    let mut response = Response::builder().status(upstream.status());
    if switching {
        headers.insert("connection", "upgrade".parse().unwrap());
        headers.insert("upgrade", "websocket".parse().unwrap());
        tokio::spawn(async move {
            let _permit = permit;
            let pair = tokio::time::timeout(Duration::from_secs(10), async {
                let remote = upstream.upgrade().await.ok()?;
                let local = downstream?.await.ok()?;
                Some((remote, hyper_util::rt::TokioIo::new(local)))
            })
            .await;
            if let Ok(Some((mut remote, mut local))) = pair {
                let _ = tokio::time::timeout(
                    Duration::from_secs(86400),
                    tokio::io::copy_bidirectional(&mut remote, &mut local),
                )
                .await;
            }
        });
        *response.headers_mut().unwrap() = headers;
        return response.body(Body::empty()).unwrap();
    }
    *response.headers_mut().unwrap() = headers;
    // The permit lives with the response stream, including slow clients and disconnects.
    let stream = futures_util::stream::unfold(
        (upstream.bytes_stream(), permit),
        |(mut stream, permit)| async move { stream.next().await.map(|chunk| (chunk, (stream, permit))) },
    );
    response.body(Body::from_stream(stream)).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn slow_upload_cannot_connect_after_its_route_lease_expires() {
        let stream = futures_util::stream::once(async {
            tokio::time::sleep(Duration::from_millis(150)).await;
            Ok::<_, std::io::Error>("upload")
        });
        let request = Request::builder()
            .method("POST")
            .uri("/upload")
            .body(Body::from_stream(stream))
            .unwrap();
        let response = forward(
            &client().unwrap(),
            request,
            1,
            "canary.test".into(),
            Arc::new(Semaphore::new(1)).acquire_owned().await.unwrap(),
            Some(Utc::now() + chrono::Duration::milliseconds(50)),
        )
        .await;
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    async fn serve(router: Router) -> (i32, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = i32::from(listener.local_addr().unwrap().port());
        let task = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        (port, task)
    }
    async fn proxy_to(port: i32, permits: Arc<Semaphore>) -> (i32, tokio::task::JoinHandle<()>) {
        let client = client().unwrap();
        serve(Router::new().fallback(move |request: Request| {
            let client = client.clone();
            let permits = permits.clone();
            async move {
                forward(
                    &client,
                    request,
                    port,
                    "app.example.test".into(),
                    permits.acquire_owned().await.unwrap(),
                    None,
                )
                .await
            }
        }))
        .await
    }
    #[test]
    fn removes_all_case_insensitive_connection_nominations() {
        let mut headers = HeaderMap::new();
        headers.append("connection", "keep-alive, X-Private".parse().unwrap());
        headers.append("connection", "x-other".parse().unwrap());
        for name in ["x-private", "x-other", "keep-alive", "set-cookie"] {
            headers.insert(name, "value".parse().unwrap());
        }
        strip_hop(&mut headers);
        assert_eq!(headers.len(), 1);
        assert!(headers.contains_key("set-cookie"));
    }
    #[tokio::test]
    async fn websocket_handshake_and_bidirectional_bytes_survive_the_proxy() {
        let (upstream, server) = serve(Router::new().fallback(|mut request: Request| async move {
            assert_eq!(request.headers()["origin"], "https://app.example.test");
            assert_eq!(request.headers()["sec-websocket-protocol"], "events");
            assert_eq!(request.headers()["x-forwarded-host"], "app.example.test");
            let upgrade = hyper::upgrade::on(&mut request);
            tokio::spawn(async move {
                let mut io = hyper_util::rt::TokioIo::new(upgrade.await.unwrap());
                let mut bytes = [0; 8];
                io.read_exact(&mut bytes).await.unwrap();
                assert_eq!(&bytes, b"\x81\x82\x01\x02\x03\x04ik"); // masked "hi"
                io.write_all(b"\x81\x02hi").await.unwrap();
            });
            Response::builder()
                .status(101)
                .header("connection", "upgrade")
                .header("upgrade", "websocket")
                .header("sec-websocket-accept", "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")
                .header("sec-websocket-protocol", "events")
                .body(Body::empty())
                .unwrap()
        }))
        .await;
        let permits = Arc::new(Semaphore::new(1));
        let (port, proxy) = proxy_to(upstream, permits.clone()).await;
        let mut socket = tokio::net::TcpStream::connect(("127.0.0.1", port as u16))
            .await
            .unwrap();
        socket.write_all(b"GET /events HTTP/1.1\r\nHost: app.example.test\r\nConnection: keep-alive, Upgrade\r\nUpgrade: websocket\r\nOrigin: https://app.example.test\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: events\r\nX-Forwarded-Host: spoof.invalid\r\n\r\n").await.unwrap();
        let mut headers = Vec::new();
        while !headers.ends_with(b"\r\n\r\n") {
            headers.push(socket.read_u8().await.unwrap());
        }
        let headers = String::from_utf8(headers).unwrap().to_lowercase();
        assert!(headers.starts_with("http/1.1 101"));
        assert!(headers.contains("sec-websocket-protocol: events"));
        assert_eq!(permits.available_permits(), 0);
        socket
            .write_all(b"\x81\x82\x01\x02\x03\x04ik")
            .await
            .unwrap();
        let mut bytes = [0; 4];
        tokio::time::timeout(Duration::from_secs(2), socket.read_exact(&mut bytes))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(&bytes, b"\x81\x02hi");
        drop(socket);
        let _permit = tokio::time::timeout(Duration::from_secs(2), permits.acquire())
            .await
            .unwrap()
            .unwrap();
        proxy.abort();
        server.abort();
    }
    #[tokio::test]
    async fn sse_flushes_before_completion_and_releases_capacity_on_disconnect() {
        let (upstream, server) = serve(Router::new().fallback(|| async {
            let stream = futures_util::stream::unfold(0, |n| async move {
                if n > 0 {
                    tokio::time::sleep(Duration::from_secs(120)).await;
                }
                Some((Ok::<_, std::io::Error>(format!("data: {n}\n\n")), n + 1))
            });
            Response::builder()
                .header("content-type", "text/event-stream")
                .body(Body::from_stream(stream))
                .unwrap()
        }))
        .await;
        let permits = Arc::new(Semaphore::new(1));
        let (port, proxy) = proxy_to(upstream, permits.clone()).await;
        let mut response = reqwest::Client::new()
            .get(format!("http://127.0.0.1:{port}/events"))
            .send()
            .await
            .unwrap();
        let chunk = tokio::time::timeout(Duration::from_secs(2), response.chunk())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(chunk, "data: 0\n\n");
        assert_eq!(permits.available_permits(), 0);
        drop(response);
        let _permit = tokio::time::timeout(Duration::from_secs(2), permits.acquire())
            .await
            .unwrap()
            .unwrap();
        proxy.abort();
        server.abort();
    }

    #[tokio::test]
    #[ignore = "65-second real-time streaming regression; no database required"]
    async fn sse_survives_the_previous_sixty_second_total_timeout() {
        let (upstream, server) = serve(Router::new().fallback(|| async {
            let stream = futures_util::stream::unfold(0, |n| async move {
                if n > 1 {
                    return None;
                }
                if n == 1 {
                    tokio::time::sleep(Duration::from_secs(65)).await;
                }
                Some((Ok::<_, std::io::Error>(format!("data: {n}\n\n")), n + 1))
            });
            Response::builder()
                .header("content-type", "text/event-stream")
                .body(Body::from_stream(stream))
                .unwrap()
        }))
        .await;
        let (port, proxy) = proxy_to(upstream, Arc::new(Semaphore::new(1))).await;
        let mut response = reqwest::Client::new()
            .get(format!("http://127.0.0.1:{port}/events"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.chunk().await.unwrap().unwrap(), "data: 0\n\n");
        let chunk = tokio::time::timeout(Duration::from_secs(70), response.chunk())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(chunk, "data: 1\n\n");
        proxy.abort();
        server.abort();
    }
}
