//! Explicit integration test against the disposable Lake VM, never run in CI.
use platform_build_runner::Config;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::Command;

#[tokio::test]
#[ignore = "requires the isolated development VM and .local/builder.env"]
async fn dockerfile_can_reach_public_internet_but_not_lake() {
    let config = Config::from_env().expect("source .local/builder.env first");
    let listener = TcpListener::bind("127.0.0.1:18089").await.unwrap();
    let hits = Arc::new(AtomicUsize::new(0));
    let count = hits.clone();
    let server = tokio::spawn(async move {
        loop {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 1024];
            let _ = stream.read(&mut request).await;
            count.fetch_add(1, Ordering::SeqCst);
            let _ = stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
                .await;
        }
    });
    // Prove the test listener is reachable from the ordinary host context.
    let mut probe = TcpStream::connect("127.0.0.1:18089").await.unwrap();
    probe
        .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\n")
        .await
        .unwrap();
    let mut response = Vec::new();
    probe.read_to_end(&mut response).await.unwrap();
    assert!(response.ends_with(b"ok"));
    assert_eq!(hits.swap(0, Ordering::SeqCst), 1);

    let temp = tempfile::tempdir_in("/dev/shm").unwrap();
    let fixtures = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../infra/builder/fixtures")
        .canonicalize()
        .unwrap();
    // Only these synthetic fixtures are shared for this diagnostic. The product
    // runner never enables --local and fetches pinned Git inside the VM instead.
    let output = tokio::time::timeout(
        Duration::from_secs(120),
        Command::new(&config.binary)
            .args([
                "--addr",
                &config.address,
                "--tlsservername",
                &config.server_name,
            ])
            .arg("--tlscacert")
            .arg(&config.ca)
            .arg("--tlscert")
            .arg(&config.cert)
            .arg("--tlskey")
            .arg(&config.key)
            .args([
                "build",
                "--frontend",
                "dockerfile.v0",
                "--opt",
                "cmdline=dockerfile.v0",
                "--opt",
                "target=isolation",
                "--no-cache",
                "--progress",
                "plain",
            ])
            .arg("--local")
            .arg(format!("context={}", fixtures.display()))
            .arg("--local")
            .arg(format!("dockerfile={}", fixtures.display()))
            .env_clear()
            .env("HOME", temp.path())
            .env("DOCKER_CONFIG", temp.path())
            .kill_on_drop(true)
            .output(),
    )
    .await;
    server.abort();
    let output = output.expect("VM test timed out").unwrap();
    let log = String::from_utf8_lossy(&output.stderr);
    assert!(output.status.success(), "{log}");
    assert!(log.contains("isolation-checks-passed"), "{log}");
    assert_eq!(
        hits.load(Ordering::SeqCst),
        0,
        "a Dockerfile reached Lake's loopback listener"
    );
}
