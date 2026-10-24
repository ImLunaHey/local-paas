//! Opt-in isolated OpenBao lifecycle test; never touches the operator's authority.
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::Path,
    process::{Command, Stdio},
};

#[test]
#[ignore = "requires PLATFORM_BOOTSTRAP_TEST=1, OpenBao tools and Linux user/network namespaces"]
fn openbao_bootstrap_recovers_seal_and_expired_identity() {
    if std::env::var("PLATFORM_BOOTSTRAP_TEST").as_deref() != Ok("1") {
        return;
    }
    if std::env::var("PLATFORM_BOOTSTRAP_CHILD").as_deref() != Ok("1") {
        let status = Command::new("unshare")
            .args(["--user", "--map-root-user", "--net"])
            .arg(std::env::current_exe().unwrap())
            .args([
                "--ignored",
                "--exact",
                "openbao_bootstrap_recovers_seal_and_expired_identity",
            ])
            .env("PLATFORM_BOOTSTRAP_CHILD", "1")
            .status()
            .unwrap();
        assert!(status.success(), "isolated bootstrap subprocess failed");
        return;
    }
    assert!(
        Command::new("ip")
            .args(["link", "set", "lo", "up"])
            .status()
            .unwrap()
            .success()
    );
    let dir = tempfile::tempdir().unwrap();
    for name in ["tls", "recovery", "data"] {
        fs::create_dir(dir.path().join(name)).unwrap();
    }
    let openssl = Command::new("openssl")
        .args([
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-days",
            "1",
            "-subj",
            "/CN=bootstrap-test",
            "-addext",
            "subjectAltName=IP:127.0.0.1",
        ])
        .arg("-keyout")
        .arg(dir.path().join("tls/key.pem"))
        .arg("-out")
        .arg(dir.path().join("tls/ca.pem"))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .unwrap();
    assert!(openssl.success());
    assert!(
        Command::new("openssl")
            .args([
                "req",
                "-new",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-subj",
                "/CN=bootstrap-server"
            ])
            .arg("-keyout")
            .arg(dir.path().join("tls/server.key"))
            .arg("-out")
            .arg(dir.path().join("tls/server.csr"))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success()
    );
    fs::write(dir.path().join("tls/extensions"),"basicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n").unwrap();
    assert!(
        Command::new("openssl")
            .args(["x509", "-req", "-days", "1", "-CAcreateserial"])
            .arg("-in")
            .arg(dir.path().join("tls/server.csr"))
            .arg("-CA")
            .arg(dir.path().join("tls/ca.pem"))
            .arg("-CAkey")
            .arg(dir.path().join("tls/key.pem"))
            .arg("-extfile")
            .arg(dir.path().join("tls/extensions"))
            .arg("-out")
            .arg(dir.path().join("tls/server.pem"))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success()
    );
    let d = dir.path().display();
    fs::write(dir.path().join("config.hcl"),format!("disable_mlock=true\napi_addr=\"https://127.0.0.1:18200\"\nstorage \"file\" {{ path=\"{d}/data\" }}\nlistener \"tcp\" {{\n address=\"127.0.0.1:18200\"\n tls_cert_file=\"{d}/tls/server.pem\"\n tls_key_file=\"{d}/tls/server.key\"\n}}\n")).unwrap();
    let bao = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.local/service-tools/bin/bao");
    let mut child = Command::new(bao)
        .arg("server")
        .arg(format!("-config={d}/config.hcl"))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    struct Cleanup<'a>(&'a mut std::process::Child);
    impl Drop for Cleanup<'_> {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let _cleanup = Cleanup(&mut child);
    let initialize = || {
        assert!(
            Command::new(env!("CARGO_BIN_EXE_initialize-openbao"))
                .arg(dir.path())
                .stdout(Stdio::null())
                .stderr(Stdio::inherit())
                .status()
                .unwrap()
                .success(),
            "bootstrap failed"
        );
    };
    initialize();
    let identity = dir.path().join("controller.token");
    let original = fs::read_to_string(&identity).unwrap();
    assert_eq!(
        fs::metadata(&identity).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let recovery: serde_json::Value =
        serde_json::from_slice(&fs::read(dir.path().join("recovery/initialization.json")).unwrap())
            .unwrap();
    let root = recovery["root_token"].as_str().unwrap();
    let client = reqwest::Client::builder()
        .no_proxy()
        .tls_built_in_root_certs(false)
        .add_root_certificate(
            reqwest::Certificate::from_pem(&fs::read(dir.path().join("tls/ca.pem")).unwrap())
                .unwrap(),
        )
        .build()
        .unwrap();
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        let r = client
            .post("https://127.0.0.1:18200/v1/sys/seal")
            .header("X-Vault-Token", root)
            .send()
            .await
            .unwrap();
        assert!(r.status().is_success());
    });
    initialize();
    assert!(
        original == fs::read_to_string(&identity).unwrap(),
        "valid identity must survive unseal"
    );
    runtime.block_on(async {
        let r = client
            .post("https://127.0.0.1:18200/v1/auth/token/revoke")
            .header("X-Vault-Token", root)
            .header("content-type", "application/json")
            .body(serde_json::json!({"token":original}).to_string())
            .send()
            .await
            .unwrap();
        assert!(r.status().is_success());
    });
    initialize();
    assert!(
        original != fs::read_to_string(&identity).unwrap(),
        "revoked identity must be replaced"
    );
    assert_eq!(
        fs::metadata(&identity).unwrap().permissions().mode() & 0o777,
        0o600
    );
}
