use std::{
    fs,
    os::unix::fs::PermissionsExt,
    process::{Command, Stdio},
};
#[test]
#[ignore = "requires openssl and genisoimage; creates only disposable local credentials"]
fn prepares_private_separate_bundles_without_rotating_existing_identity() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let ca = root.join(".local/worker-credentials");
    fs::create_dir_all(&ca).unwrap();
    assert!(
        Command::new("openssl")
            .args([
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-days",
                "30",
                "-subj",
                "/CN=test-ca",
                "-keyout"
            ])
            .arg(ca.join("ca.key"))
            .arg("-out")
            .arg(ca.join("ca.crt"))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success()
    );
    let plan = serde_json::json!({"index":4,"name":"remote-4","failureDomain":"host-b","controllerAddress":"100.64.0.1","workerAddress":"100.64.0.2","controllerRoot":root,"workerRoot":"/srv/platform"});
    let plan_path = root.join("plan.json");
    fs::write(&plan_path, plan.to_string()).unwrap();
    let command = || {
        let mut c = Command::new(env!("CARGO_BIN_EXE_platform-remote-worker"));
        c.current_dir(root).arg("prepare").arg(&plan_path);
        c
    };
    let result = command().output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let bundle = root.join(".local/remote-workers/4");
    let enrollment: serde_json::Value =
        serde_json::from_slice(&fs::read(bundle.join("controller/enrollment.json")).unwrap())
            .unwrap();
    assert_eq!(enrollment["cordoned"], true);
    assert_eq!(enrollment["endpoint_base"], 21300);
    assert!(
        !String::from_utf8_lossy(&result.stdout).contains(enrollment["token"].as_str().unwrap())
    );
    assert_eq!(
        fs::metadata(bundle.join("worker"))
            .unwrap()
            .permissions()
            .mode()
            & 0o077,
        0
    );
    assert_eq!(
        fs::metadata(bundle.join("worker/agent/config.json"))
            .unwrap()
            .permissions()
            .mode()
            & 0o077,
        0
    );
    assert!(!bundle.join("worker/ca.key").exists());
    assert!(!bundle.join("worker/agent/ca.key").exists());
    assert!(
        bundle
            .join("worker/credentials.iso")
            .metadata()
            .unwrap()
            .len()
            > 0
    );
    let second = command().output().unwrap();
    assert!(!second.status.success());
    let after: serde_json::Value =
        serde_json::from_slice(&fs::read(bundle.join("controller/enrollment.json")).unwrap())
            .unwrap();
    assert_eq!(enrollment, after);
}
