//! Real TLS tests, isolated on alternate loopback addresses. No running platform
//! services, credentials, overlay network or VM provisioning are used.
use platform_remote_worker::{Plan, registry_config, tunnel_config};
use std::{
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    thread,
    time::{Duration, Instant},
};
struct Process(Child);
impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
fn run(program: &str, args: &[&str]) {
    assert!(
        Command::new(program)
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success()
    );
}
fn certificate(dir: &Path, ip: &str) {
    fs::create_dir_all(dir).unwrap();
    run(
        "openssl",
        &[
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-days",
            "1",
            "-subj",
            "/CN=test",
            "-addext",
            &format!("subjectAltName=IP:{ip}"),
            "-addext",
            "extendedKeyUsage=serverAuth,clientAuth",
            "-keyout",
            dir.join("identity.key").to_str().unwrap(),
            "-out",
            dir.join("identity.crt").to_str().unwrap(),
        ],
    );
}
fn start(tool: &str, config: &Path) -> Process {
    let mut command = Command::new(tool);
    if tool == "caddy" {
        command.args(["run", "--adapter", "caddyfile", "--config"]);
    }
    Process(
        command
            .arg(config)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    )
}
fn wait(address: &str) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while TcpStream::connect(address).is_err() {
        assert!(
            Instant::now() < deadline,
            "listener {address} did not start"
        );
        thread::sleep(Duration::from_millis(50));
    }
}
fn echo(address: &str) -> Arc<AtomicUsize> {
    let listener = TcpListener::bind(address).unwrap();
    listener.set_nonblocking(true).unwrap();
    let count = Arc::new(AtomicUsize::new(0));
    let received = count.clone();
    thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(30);
        while Instant::now() < deadline {
            if let Ok((mut stream, _)) = listener.accept() {
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut bytes = [0; 4096];
                if let Ok(size) = stream.read(&mut bytes)
                    && size > 0
                {
                    received.fetch_add(1, Ordering::SeqCst);
                    let _ = stream.write_all(&bytes[..size]);
                }
            } else {
                thread::sleep(Duration::from_millis(10));
            }
        }
    });
    count
}
fn exchange(address: &str, bytes: &[u8]) -> Vec<u8> {
    let mut stream = TcpStream::connect(address).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    stream.write_all(bytes).unwrap();
    let mut output = vec![0; bytes.len()];
    stream.read_exact(&mut output).unwrap();
    output
}
#[test]
#[ignore = "requires pinned stunnel, openssl and caddy; uses only loopback test listeners"]
fn real_bidirectional_tls_and_registry_write_rejection() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().to_str().unwrap().to_string();
    let plan = Plan {
        index: 4,
        name: "test".into(),
        failure_domain: "remote".into(),
        controller_address: "10.91.0.1".parse().unwrap(),
        worker_address: "10.91.0.2".parse().unwrap(),
        controller_root: root.clone(),
        worker_root: root,
    };
    let controller = std::path::PathBuf::from(plan.directory(true));
    let worker = std::path::PathBuf::from(plan.directory(false));
    certificate(&controller, "10.91.0.1");
    certificate(&worker, "10.91.0.2");
    fs::copy(controller.join("identity.crt"), worker.join("peer.crt")).unwrap();
    fs::copy(worker.join("identity.crt"), controller.join("peer.crt")).unwrap();
    let routes = |text: String, side: &str| {
        text.replace("accept = 10.91.0.1:", "accept = 127.0.0.3:")
            .replace("connect = 10.91.0.1:", "connect = 127.0.0.3:")
            .replace("accept = 10.91.0.2:", "accept = 127.0.0.2:")
            .replace("connect = 10.91.0.2:", "connect = 127.0.0.2:")
            .replace("127.0.0.1:", &format!("{side}:"))
    };
    fs::write(
        controller.join("stunnel.conf"),
        routes(tunnel_config(&plan, true).unwrap(), "127.0.0.3"),
    )
    .unwrap();
    fs::write(
        worker.join("stunnel.conf"),
        routes(tunnel_config(&plan, false).unwrap(), "127.0.0.2"),
    )
    .unwrap();
    let controller_requests = echo("127.0.0.3:18443");
    let _local = echo("127.0.0.3:21000");
    let _remote = echo("127.0.0.2:21300");
    let _server = start("stunnel", &controller.join("stunnel.conf"));
    let _client = start("stunnel", &worker.join("stunnel.conf"));
    wait("127.0.0.2:18443");
    wait("127.0.0.3:21300");
    for (address, payload) in [
        ("127.0.0.2:18443", b"outbound agent".as_slice()),
        ("127.0.0.3:21300", b"inbound workload".as_slice()),
        ("127.0.0.2:21000", b"private service".as_slice()),
    ] {
        assert_eq!(exchange(address, payload), payload);
    }
    // A bare peer and a different pinned identity cannot reach the agent gateway.
    let before = controller_requests.load(Ordering::SeqCst);
    let mut plain = TcpStream::connect("127.0.0.3:30400").unwrap();
    plain
        .write_all(b"plaintext must not reach the agent")
        .unwrap();
    drop(plain);
    let wrong = temp.path().join("wrong");
    certificate(&wrong, "10.91.0.2");
    let wrong_config = routes(tunnel_config(&plan, false).unwrap(), "127.0.0.4")
        .split("\n[registry]")
        .next()
        .unwrap()
        .replace(&plan.directory(false), wrong.to_str().unwrap());
    fs::copy(controller.join("identity.crt"), wrong.join("peer.crt")).unwrap();
    fs::write(wrong.join("stunnel.conf"), wrong_config).unwrap();
    let _wrong = start("stunnel", &wrong.join("stunnel.conf"));
    wait("127.0.0.4:18443");
    let mut bad = TcpStream::connect("127.0.0.4:18443").unwrap();
    bad.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
    bad.write_all(b"wrong node").unwrap();
    let mut bytes = [0; 64];
    assert!(!matches!(bad.read(&mut bytes), Ok(n) if n > 0));
    assert_eq!(controller_requests.load(Ordering::SeqCst), before);
    // The real generated Caddy policy rejects push/delete/non-registry paths.
    let registry = registry_config(&plan)
        .unwrap()
        .replace("127.0.0.1", "127.0.0.3");
    fs::write(controller.join("Caddyfile"), registry).unwrap();
    let _caddy = start("caddy", &controller.join("Caddyfile"));
    wait("127.0.0.3:15104");
    let registry_listener = TcpListener::bind("127.0.0.3:15000").unwrap();
    let backend = thread::spawn(move || {
        for _ in 0..2 {
            let (mut stream, _) = registry_listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = [0; 4096];
            let size = stream.read(&mut bytes).unwrap();
            assert!(
                bytes[..size].starts_with(b"GET /v2/") || bytes[..size].starts_with(b"HEAD /v2/")
            );
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .unwrap();
        }
    });
    for (method, path, status) in [
        ("POST", "/v2/images/uploads/", 403),
        ("PUT", "/v2/images/manifests/latest", 403),
        ("DELETE", "/v2/images/blobs/digest", 403),
        ("GET", "/api/services", 403),
        ("GET", "/v2/", 200),
        ("HEAD", "/v2/", 200),
    ] {
        let mut stream = TcpStream::connect("127.0.0.2:15000").unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        write!(stream,"{method} {path} HTTP/1.1\r\nHost: 10.0.2.2:15000\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(
            response.starts_with(&format!("HTTP/1.1 {status}")),
            "{response}"
        );
    }
    backend.join().unwrap();
}
