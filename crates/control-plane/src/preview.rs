//! Private preview ingress. Database promotion switches the entire backend set.
use axum::{
    Router,
    body::Body,
    extract::{Request, State},
    http::{HeaderName, StatusCode},
    response::{IntoResponse, Response},
};
use sqlx::{PgPool, Row};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
#[derive(Clone)]
struct Proxy {
    pool: PgPool,
    client: reqwest::Client,
    next: Arc<AtomicUsize>,
}
pub async fn start(
    pool: PgPool,
) -> Result<tokio::task::JoinHandle<()>, Box<dyn std::error::Error>> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(2))
        .timeout(std::time::Duration::from_secs(60))
        .build()?;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:8090").await?;
    Ok(tokio::spawn(async move {
        let _ = axum::serve(
            listener,
            Router::new().fallback(proxy).with_state(Proxy {
                pool,
                client,
                next: Arc::new(AtomicUsize::new(0)),
            }),
        )
        .await;
    }))
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
    let authority = request
        .headers()
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    let rows=match sqlx::query("SELECT n.endpoint_base+i.slot AS port FROM preview_routes r JOIN deployments d ON d.service_id=r.service_id AND d.status='active' JOIN instances i ON i.deployment_id=d.id JOIN nodes n ON n.id=i.node_id WHERE r.authority=$1 AND i.state='ready' AND i.desired_state='running' AND i.observed_at>now()-interval '15 seconds' AND n.last_seen>now()-interval '30 seconds' ORDER BY i.id").bind(&authority).fetch_all(&p.pool).await{Ok(r) if !r.is_empty()=>r,_=>return(StatusCode::SERVICE_UNAVAILABLE,"No healthy application instances are ready.\n").into_response()};
    let port = rows[p.next.fetch_add(1, Ordering::Relaxed) % rows.len()].get::<i32, _>("port");
    let path = request
        .uri()
        .path_and_query()
        .map(|p| p.as_str())
        .unwrap_or("/")
        .to_string();
    let (parts, body) = request.into_parts();
    let body = match axum::body::to_bytes(body, 8 * 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
    };
    let mut headers = parts.headers;
    let connection_headers: Vec<HeaderName> = headers
        .get("connection")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(',')
        .filter_map(|v| v.trim().parse().ok())
        .collect();
    for h in connection_headers {
        headers.remove(h);
    }
    let remove: Vec<_> = headers
        .keys()
        .filter(|h| hop(h) || h.as_str().starts_with("x-forwarded-") || h.as_str() == "forwarded")
        .cloned()
        .collect();
    for h in remove {
        headers.remove(h);
    }
    let result = p
        .client
        .request(parts.method, format!("http://127.0.0.1:{port}{path}"))
        .headers(headers)
        .header("x-forwarded-host", authority)
        .header("x-forwarded-proto", "https")
        .body(body)
        .send()
        .await;
    match result {
        Ok(upstream) => {
            let mut response = Response::builder().status(upstream.status());
            let nominated: Vec<&str> = upstream
                .headers()
                .get("connection")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .split(',')
                .map(str::trim)
                .collect();
            for (name, value) in upstream.headers() {
                if !hop(name) && !nominated.contains(&name.as_str()) {
                    response = response.header(name, value);
                }
            }
            response
                .body(Body::from_stream(upstream.bytes_stream()))
                .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
        }
        Err(_) => StatusCode::BAD_GATEWAY.into_response(),
    }
}
