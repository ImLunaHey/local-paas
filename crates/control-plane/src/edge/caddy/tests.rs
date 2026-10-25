use super::*;
use axum::{Router, extract::Request, response::IntoResponse};
use hickory_resolver::{
    config::{NameServerConfig, ResolverConfig},
    net::runtime::TokioRuntimeProvider,
    proto::{
        op::{Message, OpCode},
        rr::{
            Record, RecordType,
            rdata::{A, TXT},
        },
    },
};
use std::{
    net::{IpAddr, Ipv4Addr},
    process::{Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::net::{TcpListener, UdpSocket};
use uuid::Uuid;

struct Process(std::process::Child);
impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
struct Task(tokio::task::JoinHandle<()>);
impl Drop for Task {
    fn drop(&mut self) {
        self.0.abort();
    }
}

fn openssl(root: &std::path::Path, args: &[&str]) {
    assert!(
        Command::new("openssl")
            .current_dir(root)
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("openssl required")
            .success()
    );
}
async fn address() -> SocketAddr {
    TcpListener::bind("127.0.0.1:0")
        .await
        .unwrap()
        .local_addr()
        .unwrap()
}
fn config(root: &std::path::Path, public: SocketAddr, gateway: SocketAddr, ingress: u16) -> Config {
    Config {
        admin_socket: Some(root.join("admin.sock")),
        admin_url: None,
        admin_ca_file: None,
        admin_identity_file: None,
        public_address: public,
        probe_ca_file: None,
        gateway_address: gateway,
        gateway_server_name: "ingress.local-paas".into(),
        gateway_ca_file: root.join("ca.pem"),
        gateway_certificate_file: root.join("gateway.pem"),
        gateway_key_file: root.join("gateway.key"),
        ingress_port: ingress,
    }
}

async fn dns(value: String) -> (TokioResolver, Task) {
    let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let port = socket.local_addr().unwrap().port();
    let task = tokio::spawn(async move {
        let mut bytes = [0u8; 2048];
        loop {
            let (len, peer) = socket.recv_from(&mut bytes).await.unwrap();
            let request = Message::from_vec(&bytes[..len]).unwrap();
            let mut response = Message::response(request.metadata.id, OpCode::Query);
            response.metadata.recursion_available = true;
            response.metadata.recursion_desired = request.metadata.recursion_desired;
            for query in request.queries {
                response.add_query(query.clone());
                let data = match query.query_type() {
                    RecordType::TXT => Some(RData::TXT(TXT::new(vec![value.clone()]))),
                    RecordType::A => Some(RData::A(A::new(127, 0, 0, 1))),
                    _ => None,
                };
                if let Some(data) = data {
                    response.add_answer(Record::from_rdata(query.name().clone(), 1, data));
                }
            }
            socket
                .send_to(&response.to_vec().unwrap(), peer)
                .await
                .unwrap();
        }
    });
    let mut server = NameServerConfig::udp(IpAddr::V4(Ipv4Addr::LOCALHOST));
    server.connections[0].port = port;
    let resolver = TokioResolver::builder_with_config(
        ResolverConfig::from_name_servers(vec![server]),
        TokioRuntimeProvider::default(),
    )
    .build()
    .unwrap();
    (resolver, Task(task))
}

#[test]
fn remote_management_requires_https_and_client_identity() {
    let root = tempfile::tempdir().unwrap();
    let mut cfg = config(
        root.path(),
        "127.0.0.1:443".parse().unwrap(),
        "127.0.0.1:18444".parse().unwrap(),
        8090,
    );
    cfg.admin_socket = None;
    cfg.admin_url = Some("http://example.test:2019".into());
    assert!(matches!(Caddy::new(cfg), Err(Failure::Configuration)));
    let mut cfg = config(
        root.path(),
        "127.0.0.1:443".parse().unwrap(),
        "127.0.0.1:18444".parse().unwrap(),
        8090,
    );
    cfg.admin_socket = None;
    cfg.admin_url = Some("https://admin.example.test".into());
    assert!(matches!(Caddy::new(cfg), Err(Failure::Configuration)));
}

#[tokio::test]
#[ignore = "requires local caddy and openssl from nix develop; no public DNS or infrastructure"]
async fn caddy_api_issues_tls_updates_generations_preserves_routes_and_removes_domain() {
    let root = tempfile::tempdir().unwrap();
    openssl(
        root.path(),
        &[
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            "ca.key",
            "-out",
            "ca.pem",
            "-subj",
            "/CN=edge-test",
            "-days",
            "2",
            "-addext",
            "basicConstraints=critical,CA:TRUE",
        ],
    );
    openssl(
        root.path(),
        &[
            "req",
            "-new",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            "gateway.key",
            "-out",
            "gateway.csr",
            "-subj",
            "/CN=ingress.local-paas",
            "-addext",
            "subjectAltName=DNS:ingress.local-paas",
            "-addext",
            "basicConstraints=critical,CA:FALSE",
            "-addext",
            "extendedKeyUsage=serverAuth,clientAuth",
        ],
    );
    openssl(
        root.path(),
        &[
            "x509",
            "-req",
            "-in",
            "gateway.csr",
            "-CA",
            "ca.pem",
            "-CAkey",
            "ca.key",
            "-CAcreateserial",
            "-out",
            "gateway.pem",
            "-days",
            "2",
            "-copy_extensions",
            "copy",
        ],
    );
    let public = address().await;
    let gateway = address().await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let ingress = listener.local_addr().unwrap();
    let healthy = Arc::new(AtomicBool::new(true));
    let check = healthy.clone();
    let _app = Task(tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().fallback(move |request: Request| {
                let healthy = check.clone();
                async move {
                    if !healthy.load(Ordering::Relaxed) {
                        return StatusCode::SERVICE_UNAVAILABLE.into_response();
                    }
                    let host = request.headers().get("host").unwrap().to_str().unwrap();
                    let generation = host
                        .strip_suffix(".edge.invalid")
                        .and_then(|s| s.rsplit_once('-'))
                        .map(|(_, g)| g)
                        .unwrap_or("0");
                    (
                        StatusCode::NO_CONTENT,
                        [
                            ("x-local-paas-generation", generation.to_string()),
                            ("x-local-paas-route", host.to_string()),
                        ],
                    )
                        .into_response()
                }
            }),
        )
        .await
        .unwrap();
    }));
    let cfg = config(root.path(), public, gateway, ingress.port());
    let unrelated = json!({"@id":"operator-owned","handle":[{"handler":"static_response","status_code":421}],"terminal":true});
    let initial = json!({
        "admin":{"listen":format!("unix/{}",root.path().join("admin.sock").display())},
        "storage":{"module":"file_system","root":root.path().join("storage")},
        "apps":{
            "pki":{"certificate_authorities":{"local":{"install_trust":false}}},
            "tls":{"certificates":{"load_files":[{"certificate":cfg.gateway_certificate_file,"key":cfg.gateway_key_file,"tags":["gateway"]}]},
                "automation":{"renew_interval":"1s","policies":[{"subjects":["app.example.test"],"renewal_window_ratio":0.9,"issuers":[{"module":"internal","lifetime":"3m"}]}]}},
            "http":{"https_port":public.port(),"servers":{
                "platform":{"listen":[public.to_string()],"tls_connection_policies":[{}],"automatic_https":{"disable_redirects":true},"routes":[unrelated]},
                "gateway":{"listen":[gateway.to_string()],"automatic_https":{"disable":true},
                    "tls_connection_policies":[{"certificate_selection":{"any_tag":["gateway"]},"client_authentication":{"mode":"require_and_verify","trusted_ca_certs_pem_files":[cfg.gateway_ca_file]}}],
                    "routes":[{"handle":[{"handler":"reverse_proxy","upstreams":[{"dial":ingress.to_string()}],"headers":{"request":{"set":{"Host":["{http.request.header.X-Local-Paas-Route}"]},"delete":["X-Local-Paas-Route"]}}}]}]}
            }}
        }
    });
    let configuration = root.path().join("caddy.json");
    std::fs::write(&configuration, initial.to_string()).unwrap();
    let log = std::fs::File::create(root.path().join("caddy.log")).unwrap();
    let mut process = Process(
        Command::new("caddy")
            .args(["run", "--config"])
            .arg(configuration)
            .env("XDG_CONFIG_HOME", root.path().join("config"))
            .env("XDG_DATA_HOME", root.path().join("data"))
            .stdout(Stdio::null())
            .stderr(log)
            .spawn()
            .expect("caddy required"),
    );
    let mut adapter = Caddy::new(cfg).unwrap_or_else(|_| panic!("adapter configuration"));
    let mut ready = false;
    for _ in 0..100 {
        if adapter.routes().await.is_ok() {
            ready = true;
            break;
        }
        assert!(
            process.0.try_wait().unwrap().is_none(),
            "Caddy rejected fixture: {}",
            std::fs::read_to_string(root.path().join("caddy.log")).unwrap()
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(ready, "Caddy startup timed out");
    let ca_response = adapter
        .admin
        .get(format!("{}/pki/ca/local", adapter.admin_url))
        .send()
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    let ca: Value = serde_json::from_slice(&ca_response).unwrap();
    adapter.probe_ca = Some(
        reqwest::Certificate::from_pem(ca["root_certificate"].as_str().unwrap().as_bytes())
            .unwrap(),
    );
    let mut route = Route {
        id: Uuid::new_v4(),
        hostname: "app.example.test".into(),
        ownership_token: Uuid::new_v4(),
        generation: 1,
        deployment: Some(Uuid::new_v4()),
        acknowledged_generation: None,
        acknowledged_deployment: None,
    };
    let (resolver, _dns) = dns(route.challenge_value()).await;
    adapter.dns = resolver;
    assert_eq!(adapter.verify(&route).await, Ok(()));
    let mut forged = route.clone();
    forged.ownership_token = Uuid::new_v4();
    assert_eq!(adapter.verify(&forged).await, Err(Failure::Ownership));
    let mut observation = None;
    for _ in 0..50 {
        match adapter.reconcile(&route).await {
            Ok(value) => {
                observation = Some(value);
                break;
            }
            Err(Failure::Tls) => tokio::time::sleep(Duration::from_millis(100)).await,
            Err(error) => panic!(
                "Caddy route: {error:?}; {}",
                std::fs::read_to_string(root.path().join("caddy.log")).unwrap()
            ),
        }
    }
    let first_expiry = observation.unwrap().certificate_expires_at.unwrap();
    assert!(first_expiry > Utc::now());
    let (before, etag) = adapter.routes().await.unwrap();
    assert!(before.as_array().unwrap().contains(&unrelated));
    adapter.reconcile(&route).await.unwrap();
    assert_eq!(
        adapter.routes().await.unwrap().1,
        etag,
        "unchanged observations must not rewrite Caddy"
    );
    // Caddy renews the short-lived development certificate itself. Observing a
    // renewed certificate must not trigger a route configuration write.
    let mut renewed = false;
    for _ in 0..120 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if adapter.probe(&route).await.is_ok_and(|observation| {
            observation
                .certificate_expires_at
                .is_some_and(|expiry| expiry > first_expiry)
        }) {
            renewed = true;
            break;
        }
    }
    assert!(renewed, "Caddy did not renew the development certificate");
    assert_eq!(adapter.routes().await.unwrap().1, etag);
    healthy.store(false, Ordering::Relaxed);
    route.generation = 2;
    assert!(matches!(
        adapter.reconcile(&route).await,
        Err(Failure::Health)
    ));
    assert_eq!(
        adapter.routes().await.unwrap().0,
        before,
        "unhealthy candidate must not replace current route"
    );
    healthy.store(true, Ordering::Relaxed);
    adapter.reconcile(&route).await.unwrap();
    // A stale concurrent update is rejected by Caddy, not silently overwritten.
    assert_eq!(
        adapter
            .admin
            .patch(format!("{}{ROUTES}", adapter.admin_url))
            .header("if-match", etag)
            .header("content-type", "application/json")
            .body(before.to_string())
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::PRECONDITION_FAILED
    );
    let probe = client()
        .add_root_certificate(adapter.probe_ca.clone().unwrap())
        .resolve(&route.hostname, public)
        .build()
        .unwrap();
    assert_eq!(
        probe
            .get(format!("https://{}:{}/", route.hostname, public.port()))
            .header("host", "denied.example.test")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::MISDIRECTED_REQUEST
    );
    // The private gateway itself requires a client certificate.
    let gateway_client = client()
        .add_root_certificate(
            reqwest::Certificate::from_pem(&std::fs::read(root.path().join("ca.pem")).unwrap())
                .unwrap(),
        )
        .resolve("ingress.local-paas", gateway)
        .build()
        .unwrap();
    assert!(
        gateway_client
            .get(format!("https://ingress.local-paas:{}/", gateway.port()))
            .send()
            .await
            .is_err()
    );
    route.deployment = None;
    route.generation = 3;
    adapter.reconcile(&route).await.unwrap();
    assert_eq!(adapter.routes().await.unwrap().0, json!([unrelated]));
}
