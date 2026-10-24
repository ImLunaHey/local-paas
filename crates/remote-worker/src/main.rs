use platform_remote_worker::{Plan, Result, registry_config, service_unit, tunnel_config};
use std::{
    fs,
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use uuid::Uuid;

fn run(program: &str, args: &[&str]) -> Result<()> {
    if !Command::new(program)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()?
        .success()
    {
        return Err(
            format!("{program} failed; check prerequisites and certificate validity").into(),
        );
    }
    Ok(())
}
fn path(path: &Path) -> Result<&str> {
    path.to_str().ok_or_else(|| "non-UTF8 path".into())
}
fn private_dir(path: &Path) -> Result<()> {
    fs::create_dir_all(path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}
fn write(path: &Path, bytes: &[u8]) -> Result<()> {
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?
        .write_all(bytes)?;
    Ok(())
}
fn certificate(directory: &Path, address: std::net::Ipv4Addr) -> Result<()> {
    run(
        "openssl",
        &[
            "req",
            "-x509",
            "-newkey",
            "rsa:3072",
            "-nodes",
            "-days",
            "365",
            "-subj",
            "/CN=local-paas-node-link",
            "-addext",
            &format!("subjectAltName=IP:{address}"),
            "-addext",
            "extendedKeyUsage=serverAuth,clientAuth",
            "-keyout",
            path(&directory.join("identity.key"))?,
            "-out",
            path(&directory.join("identity.crt"))?,
        ],
    )
}
fn prepare(plan_file: &Path) -> Result<()> {
    let plan: Plan = serde_json::from_slice(&fs::read(plan_file)?)?;
    plan.validate()?;
    let root = std::env::current_dir()?.canonicalize()?;
    if root != Path::new(&plan.controller_root) {
        return Err("run prepare from controllerRoot".into());
    }
    let parent = root.join(".local/remote-workers");
    private_dir(&parent)?;
    let destination = parent.join(plan.index.to_string());
    if destination.exists() {
        return Err(
            "bundle already exists; preserve its identity, do not regenerate enrolled nodes".into(),
        );
    }
    let staging = tempfile::Builder::new()
        .prefix("prepare-")
        .tempdir_in(&parent)?;
    let controller = staging.path().join("controller");
    let worker = staging.path().join("worker");
    private_dir(&controller)?;
    private_dir(&worker)?;
    certificate(&controller, plan.controller_address)?;
    certificate(&worker, plan.worker_address)?;
    write(
        &controller.join("peer.crt"),
        &fs::read(worker.join("identity.crt"))?,
    )?;
    write(
        &worker.join("peer.crt"),
        &fs::read(controller.join("identity.crt"))?,
    )?;
    let id = Uuid::now_v7();
    let random = Command::new("openssl")
        .args(["rand", "-hex", "32"])
        .output()?;
    if !random.status.success() {
        return Err("token generation failed".into());
    }
    let token = String::from_utf8(random.stdout)?.trim().to_string();
    if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("invalid generated token".into());
    }
    let agent = worker.join("agent");
    private_dir(&agent)?;
    let config = serde_json::json!({"node_id":id,"token":token,"name":plan.name,"controller_url":"https://controller.local-paas:18443","cpu_millis":1000,"memory_mib":1400,"slots":4,"endpoint_base":plan.base(),"failure_domain":plan.failure_domain,"cordoned":true});
    let bytes = serde_json::to_vec_pretty(&config)?;
    write(&agent.join("config.json"), &bytes)?;
    write(&controller.join("enrollment.json"), &bytes)?;
    let ca = root.join(".local/worker-credentials");
    run(
        "openssl",
        &[
            "x509",
            "-in",
            path(&ca.join("ca.crt"))?,
            "-checkend",
            "86400",
            "-noout",
        ],
    )?;
    run(
        "openssl",
        &[
            "req",
            "-new",
            "-newkey",
            "rsa:3072",
            "-nodes",
            "-subj",
            &format!("/CN={id}"),
            "-keyout",
            path(&agent.join("client.key"))?,
            "-out",
            path(&agent.join("client.csr"))?,
        ],
    )?;
    write(&agent.join("extensions"), b"extendedKeyUsage=clientAuth\n")?;
    run(
        "openssl",
        &[
            "x509",
            "-req",
            "-days",
            "14",
            "-CA",
            path(&ca.join("ca.crt"))?,
            "-CAkey",
            path(&ca.join("ca.key"))?,
            "-set_serial",
            &format!("0x{}", id.simple()),
            "-extfile",
            path(&agent.join("extensions"))?,
            "-in",
            path(&agent.join("client.csr"))?,
            "-out",
            path(&agent.join("client.crt"))?,
        ],
    )?;
    write(&agent.join("ca.crt"), &fs::read(ca.join("ca.crt"))?)?;
    run(
        "genisoimage",
        &[
            "-quiet",
            "-R",
            "-V",
            "NODE_CREDS",
            "-o",
            path(&worker.join("credentials.iso"))?,
            "-graft-points",
            &format!("config.json={}", agent.join("config.json").display()),
            &format!("client.crt={}", agent.join("client.crt").display()),
            &format!("client.key={}", agent.join("client.key").display()),
            &format!("ca.crt={}", agent.join("ca.crt").display()),
        ],
    )?;
    for (side, is_controller) in [(&controller, true), (&worker, false)] {
        write(&side.join("plan.json"), &serde_json::to_vec_pretty(&plan)?)?;
        write(
            &side.join("stunnel.conf"),
            tunnel_config(&plan, is_controller)?.as_bytes(),
        )?;
        write(
            &side.join("link.service"),
            service_unit(&plan, is_controller, false)?.as_bytes(),
        )?;
    }
    write(
        &controller.join("Caddyfile"),
        registry_config(&plan)?.as_bytes(),
    )?;
    write(
        &controller.join("registry.service"),
        service_unit(&plan, true, true)?.as_bytes(),
    )?;
    // No enrollment or infrastructure changes until the operator installs the bundle.
    fs::rename(staging.path(), &destination)?;
    println!(
        "Prepared worker {id} in {}. Keep both bundles private; transfer only worker/ to the remote host.",
        destination.display()
    );
    Ok(())
}
fn install(side: &str, bundle: &Path) -> Result<()> {
    let controller = match side {
        "controller" => true,
        "worker" => false,
        _ => return Err("side must be controller or worker".into()),
    };
    let plan: Plan = serde_json::from_slice(&fs::read(bundle.join("plan.json"))?)?;
    plan.validate()?;
    if bundle.canonicalize()? != Path::new(&plan.directory(controller)) {
        return Err("bundle must be installed at the path recorded in its plan".into());
    }
    let root = if controller {
        &plan.controller_root
    } else {
        &plan.worker_root
    };
    for tool in ["stunnel", "caddy"] {
        if !Path::new(root)
            .join(format!(".local/host-tools/bin/{tool}"))
            .exists()
        {
            return Err("build the pinned host tools first".into());
        }
    }
    // Reject edited transport rules; only fixed platform paths may cross the link.
    if fs::read_to_string(bundle.join("stunnel.conf"))? != tunnel_config(&plan, controller)? {
        return Err("transport configuration differs from the validated plan".into());
    }
    if controller {
        if fs::read_to_string(bundle.join("Caddyfile"))? != registry_config(&plan)? {
            return Err("registry configuration differs from plan".into());
        }
    } else {
        let credentials = Path::new(root).join(".local/worker-credentials");
        private_dir(&credentials)?;
        let iso = credentials.join(format!("node-{}.iso", plan.index));
        let bytes = fs::read(bundle.join("credentials.iso"))?;
        if iso.exists() {
            if fs::read(&iso)? != bytes {
                return Err("refusing to replace existing worker credentials".into());
            }
        } else {
            write(&iso, &bytes)?;
        }
    }
    let units = PathBuf::from(std::env::var("HOME")?).join(".config/systemd/user");
    fs::create_dir_all(&units)?;
    for registry in if controller {
        vec![true, false]
    } else {
        vec![false]
    } {
        let name = format!(
            "local-paas-remote-{}-{}.service",
            plan.index,
            if registry { "registry" } else { "link" }
        );
        let text = service_unit(&plan, controller, registry)?;
        let target = units.join(&name);
        if target.exists() {
            if fs::read_to_string(&target)? != text {
                return Err("existing unit differs; review before replacing".into());
            }
        } else {
            write(&target, text.as_bytes())?;
        }
        run("systemctl", &["--user", "daemon-reload"])?;
        run("systemctl", &["--user", "enable", "--now", &name])?;
        run("systemctl", &["--user", "is-active", "--quiet", &name])?;
    }
    println!(
        "Installed private link for worker {}. This does not enroll or enable scheduling; follow docs/remote-workers.md.",
        plan.index
    );
    Ok(())
}
fn cli() -> Result<()> {
    let args: Vec<_> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("prepare") if args.len()==3 => prepare(Path::new(&args[2])),
        Some("install") if args.len()==4 => install(&args[2],Path::new(&args[3])),
        _=>Err("usage: platform-remote-worker prepare PLAN.json | install controller|worker BUNDLE_DIRECTORY".into())
    }
}
fn main() {
    if let Err(error) = cli() {
        eprintln!("Remote worker setup failed: {error}");
        std::process::exit(1);
    }
}
