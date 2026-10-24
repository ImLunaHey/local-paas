//! Explicit single-host installation. Never reads or prints workload secrets.
use serde::Deserialize;
use std::{
    fs,
    net::TcpListener,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct Settings {
    #[serde(default)]
    public_origin: String,
    #[serde(default)]
    preview_host: String,
    #[serde(default)]
    preview_ports: Vec<u16>,
}
impl Settings {
    fn validate(&self) -> Result<()> {
        if !self.public_origin.is_empty() {
            let u = reqwest::Url::parse(&self.public_origin)?;
            if u.scheme() != "https"
                || u.host_str().is_none()
                || !u.username().is_empty()
                || u.password().is_some()
                || u.query().is_some()
                || u.fragment().is_some()
                || u.path() != "/"
                || self.public_origin.ends_with('/')
                || !self
                    .public_origin
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b":.-/".contains(&c))
            {
                return Err(
                    "public_origin must be an exact HTTPS origin without a trailing slash".into(),
                );
            }
        }
        if !self
            .preview_host
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b".-".contains(&c))
            || self.preview_ports.iter().any(|p| *p < 1024)
            || self.preview_ports.len() > 32
        {
            return Err("invalid preview host/ports".into());
        }
        Ok(())
    }
}
fn run(program: impl AsRef<std::ffi::OsStr>, args: &[&str]) -> Result<()> {
    let status = Command::new(program).args(args).status()?;
    if !status.success() {
        return Err("setup step failed; correct the reported prerequisite before retrying".into());
    }
    Ok(())
}
fn succeeds(program: &str, args: &[&str]) -> bool {
    Command::new(program)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}
fn output(program: &str, args: &[&str]) -> Result<String> {
    let result = Command::new(program)
        .args(args)
        .stderr(Stdio::null())
        .output()?;
    if !result.status.success() {
        return Err(format!("{program} inspection failed").into());
    }
    Ok(String::from_utf8(result.stdout)?.trim().to_owned())
}
fn private_write(path: &Path, content: &str) -> Result<()> {
    use std::io::Write;
    if path.exists() {
        if fs::read_to_string(path)? == content {
            return Ok(());
        }
        return Err(format!(
            "refusing to replace existing configuration: {}",
            path.display()
        )
        .into());
    }
    let mut f = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(path)?;
    f.write_all(content.as_bytes())?;
    f.sync_all()?;
    Ok(())
}
fn safe_path(path: &Path) -> Result<String> {
    let s = path.to_str().ok_or("non-UTF8 checkout path")?;
    if !s.starts_with('/')
        || !s
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"/._-".contains(&c))
    {
        return Err(
            "installation paths must be absolute and contain only letters, numbers, / . _ -".into(),
        );
    }
    Ok(s.to_owned())
}
fn settings(root: &Path) -> Result<Settings> {
    let value: Settings = serde_json::from_slice(
        &fs::read(root.join(".local/platform.json"))
            .map_err(|_| "copy platform.example.json to .local/platform.json first")?,
    )?;
    value.validate()?;
    Ok(value)
}
fn check(root: &Path, fresh: bool) -> Result<()> {
    safe_path(root)?;
    if std::env::consts::OS != "linux" || !matches!(std::env::consts::ARCH, "x86_64" | "aarch64") {
        return Err("requires x86-64 or ARM64 Linux".into());
    }
    if output("id", &["-u"])? == "0" {
        return Err("run as an ordinary dedicated operator user, not root".into());
    }
    if !Path::new("/dev/kvm").exists() {
        return Err(
            "KVM is required; enable hardware virtualization (nested KVM on cloud VMs)".into(),
        );
    }
    if !Path::new("/sys/fs/cgroup/cgroup.controllers").exists() {
        return Err("unified cgroup v2 is required".into());
    }
    if !succeeds("systemctl", &["--user", "show-environment"]) {
        return Err("systemd user manager is required (log in as the operator through SSH)".into());
    }
    settings(root)?;
    for tool in [
        "nix", "cargo", "rustc", "node", "pnpm", "psql", "initdb", "openssl",
    ] {
        if !succeeds(tool, &["--version"]) {
            return Err(format!("missing {tool}; enter nix develop first").into());
        }
    }
    if fresh {
        let available = fs::read_to_string("/proc/meminfo")?
            .lines()
            .find_map(|l| {
                l.strip_prefix("MemAvailable:")
                    .and_then(|v| v.split_whitespace().next()?.parse::<u64>().ok())
            })
            .unwrap_or(0);
        if available < 16 * 1024 * 1024 {
            return Err("full installation requires at least 16 GiB available RAM".into());
        }
        let free = output("df", &["-Pk", root.to_str().ok_or("path")?])?;
        let free = free
            .lines()
            .last()
            .and_then(|l| l.split_whitespace().nth(3))
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);
        if free < 100 * 1024 * 1024 {
            return Err("full installation requires at least 100 GiB free disk".into());
        }
        if !succeeds("getent", &["group", "kvm"]) {
            return Err("the host must have a kvm group granting access to /dev/kvm".into());
        }
        let units = PathBuf::from(std::env::var("HOME")?).join(".config/systemd/user");
        if render_user_units(&safe_path(root)?)
            .iter()
            .any(|(name, _)| units.join(name).exists())
        {
            return Err(
                "existing local-paas user units: refusing to adopt another installation".into(),
            );
        }
        for port in [
            8080, 8090, 5188, 12340, 15000, 18123, 18200, 18201, 18443, 21000, 21001, 21002, 21003,
            21100, 21101, 21102, 21103, 21200, 21201, 21202, 21203,
        ] {
            TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
                .map_err(|_| format!("required loopback port {port} is occupied"))?;
        }
        if root.join(".local/postgres/PG_VERSION").exists() {
            return Err("install is for a fresh host; existing database was left untouched".into());
        }
        for n in [
            "local-paas-builder",
            "local-paas-worker-1",
            "local-paas-worker-2",
            "local-paas-worker-3",
        ] {
            if succeeds("id", &[n]) {
                return Err(format!(
                    "existing {n} account: refusing to adopt another installation"
                )
                .into());
            }
        }
        for uid in 61000..=61003 {
            if succeeds("getent", &["passwd", &uid.to_string()]) {
                return Err(format!("reserved UID {uid} is occupied").into());
            }
        }
    }
    println!(
        "Prerequisites checked for {}. Reserve at least 16 GiB available RAM and 100 GiB disk for the full stack; builds need additional headroom.",
        std::env::consts::ARCH
    );
    Ok(())
}
fn environment(root: &str, cfg: &Settings) -> String {
    let raw = format!(
        "DATABASE_URL=postgresql:///local_paas?host={root}/.local/socket&port=55432\nPUBLIC_ORIGIN={}\nPREVIEW_HOST={}\nPREVIEW_PORTS={}\nCLICKHOUSE_URL=http://127.0.0.1:18123\nCLICKHOUSE_PASSWORD_FILE={root}/.local/platform-services/clickhouse.password\nOPENBAO_ADDR=https://127.0.0.1:18200\nOPENBAO_CA_FILE={root}/.local/platform-services/tls/ca.pem\nOPENBAO_TOKEN_FILE={root}/.local/platform-services/controller.token\n",
        cfg.public_origin,
        cfg.preview_host,
        cfg.preview_ports
            .iter()
            .map(u16::to_string)
            .collect::<Vec<_>>()
            .join(",")
    );
    raw.lines()
        .map(|line| {
            let (name, value) = line
                .split_once('=')
                .expect("generated environment assignment");
            format!("{name}='{value}'\n")
        })
        .collect()
}
fn user_unit(root: &str, executable: &str, arguments: &str, after: &str, extra: &str) -> String {
    format!(
        "# Generated by local-paas; configuration contains file references only.\n[Unit]\nDescription=Local PaaS\nAfter={after}\nPartOf=local-paas.target\n[Service]\nWorkingDirectory={root}\nEnvironmentFile={root}/.local/platform.env\nEnvironment=PATH={root}/.local/host-tools/bin:/run/wrappers/bin:/usr/sbin:/usr/bin:/sbin:/bin\nEnvironment=XDG_RUNTIME_DIR=%t\nExecStart={executable} {arguments}\nRestart=on-failure\nRestartSec=3\nUMask=0077\nLimitCORE=0\nMemorySwapMax=0\n{extra}\n[Install]\nWantedBy=local-paas.target\n"
    )
}
fn render_user_units(root: &str) -> Vec<(String, String)> {
    let host = format!("{root}/.local/host-tools/bin");
    let svc = format!("{root}/.local/service-tools/bin");
    let bin = format!("{root}/target/debug");
    let pg = "local-paas-postgres.service";
    let specs = [
        (
            "postgres",
            format!("{host}/postgres"),
            format!("-D {root}/.local/postgres -k {root}/.local/socket -h '' -p 55432"),
            "",
            "KillSignal=SIGINT\nTimeoutStopSec=90",
        ),
        (
            "openbao",
            format!("{svc}/bao"),
            format!("server -config={root}/.local/platform-services/openbao.hcl"),
            "",
            "MemoryMax=512M\nNoNewPrivileges=yes",
        ),
        (
            "clickhouse",
            format!("{svc}/clickhouse"),
            format!("server --config-file={root}/.local/platform-services/clickhouse.xml"),
            "",
            "MemoryMax=2G\nNoNewPrivileges=yes",
        ),
        ("api", format!("{bin}/control-plane"), String::new(), pg, ""),
        (
            "ingress",
            format!("{bin}/platform-ingress"),
            String::new(),
            pg,
            "MemoryMax=256M\nNoNewPrivileges=yes",
        ),
        (
            "agent-gateway",
            format!("{host}/caddy"),
            format!("run --config {root}/.local/worker-credentials/Caddyfile --adapter caddyfile"),
            "",
            "NoNewPrivileges=yes",
        ),
        (
            "web",
            format!("{host}/caddy"),
            format!("run --config {root}/.local/frontend.Caddyfile --adapter caddyfile"),
            "local-paas-api.service",
            "NoNewPrivileges=yes",
        ),
        (
            "build-worker",
            format!("{host}/bash"),
            format!("{root}/infra/builder/worker.sh --run"),
            pg,
            "",
        ),
    ];
    let mut units: Vec<_> = specs
        .into_iter()
        .map(|(n, e, a, d, x)| {
            (
                format!("local-paas-{n}.service"),
                user_unit(root, &e, &a, d, x),
            )
        })
        .collect();
    units.push(("local-paas.target".into(),"[Unit]\nDescription=Local PaaS private management stack\n[Install]\nWantedBy=default.target\n".into()));
    units
}
fn prepare(root: &Path) -> Result<()> {
    settings(root)?;
    run("nix", &["build", ".", "-o", ".local/host-tools"])?;
    run(
        "nix",
        &[
            "build",
            "path:./infra/services",
            "-o",
            ".local/service-tools",
        ],
    )?;
    run(
        "nix",
        &[
            "build",
            "path:./infra/builder#tools",
            "-o",
            ".local/builder-tools",
        ],
    )?;
    run(
        "nix",
        &["build", "path:./infra/builder", "-o", ".local/builder-vm"],
    )?;
    run("bash", &["infra/workers/build.sh"])?;
    run("cargo", &["build", "--workspace", "--bins"])?;
    run("pnpm", &["install", "--frozen-lockfile"])?;
    run("pnpm", &["--dir", "web", "build"])?;
    if !root.join(".local/builder-tls/client.key").exists() {
        run("bash", &["infra/builder/credentials.sh"])?;
    }
    run("bash", &["infra/workers/credentials.sh"])?;
    println!("Prepared binaries, VMs and private identities. No services were started.");
    Ok(())
}
fn install(root: &Path) -> Result<()> {
    let marker = root.join(".local/install-started");
    check(root, !marker.exists())?;
    if !succeeds("sudo", &["-n", "true"]) {
        run("sudo", &["-v"])?;
    }
    fs::set_permissions(root.join(".local"), fs::Permissions::from_mode(0o700))?;
    private_write(&marker, &safe_path(root)?)?;
    prepare(root)?;
    if !succeeds("sudo", &["-n", "true"]) {
        run("sudo", &["-v"])?;
    }
    let r = safe_path(root)?;
    let cfg = settings(root)?;
    private_write(&root.join(".local/platform.env"), &environment(&r, &cfg))?;
    // These scripts initialize local files and start dedicated services only.
    run("bash", &["infra/services/database.sh"])?;
    run("bash", &["infra/services/start.sh"])?;
    std::thread::sleep(Duration::from_secs(3));
    run(
        root.join("target/debug/initialize-openbao"),
        &[&format!("{r}/.local/platform-services")],
    )?;
    let status = Command::new(root.join("target/debug/platform-migrate"))
        .env(
            "DATABASE_URL",
            format!("postgresql:///local_paas?host={r}/.local/socket&port=55432"),
        )
        .status()?;
    if !status.success() {
        return Err("database migration failed".into());
    }
    for index in 1..=3 {
        let status = Command::new(root.join("target/debug/enroll-node"))
            .env(
                "DATABASE_URL",
                format!("postgresql:///local_paas?host={r}/.local/socket&port=55432"),
            )
            .arg(format!(".local/worker-credentials/{index}/config.json"))
            .status()?;
        if !status.success() {
            return Err("node enrollment failed".into());
        }
    }
    if !succeeds("systemctl", &["is-active", "--quiet", "local-paas-builder"]) {
        run("bash", &["infra/builder/start.sh", "--prepare"])?;
    }
    for index in 1..=3 {
        if !succeeds(
            "systemctl",
            &[
                "is-active",
                "--quiet",
                &format!("local-paas-worker-{index}"),
            ],
        ) {
            run(
                "bash",
                &["infra/workers/start.sh", &index.to_string(), "--prepare"],
            )?;
        }
    }
    private_write(
        &root.join(".local/frontend.Caddyfile"),
        &frontend_config(&r, &cfg),
    )?;
    // Stop only the freshly created transient management units before installing replacements.
    run(
        "systemctl",
        &[
            "--user",
            "stop",
            "local-paas-postgres",
            "local-paas-openbao",
            "local-paas-clickhouse",
        ],
    )?;
    let home = PathBuf::from(std::env::var("HOME")?);
    safe_path(&home)?;
    let units = home.join(".config/systemd/user");
    fs::create_dir_all(&units)?;
    for (name, content) in render_user_units(&r) {
        private_write(&units.join(&name), &content)?;
    }
    install_vm_units(root)?;
    run("systemctl", &["--user", "daemon-reload"])?;
    for (name, _) in render_user_units(&r) {
        run("systemctl", &["--user", "enable", &name])?;
    }
    let user = output("id", &["-un"])?;
    run("sudo", &["-n", "loginctl", "enable-linger", &user])?;
    run("systemctl", &["--user", "start", "local-paas.target"])?;
    std::thread::sleep(Duration::from_secs(3));
    run(
        root.join("target/debug/initialize-openbao"),
        &[&format!("{r}/.local/platform-services")],
    )?;
    wait_ready(&r)?;
    println!(
        "Installed persistent services. Open http://localhost:5188 (SSH-forward this port for remote access). After a reboot run make unseal. No public ingress or off-site backup was enabled."
    );
    Ok(())
}
fn frontend_config(root: &str, cfg: &Settings) -> String {
    let public = reqwest::Url::parse(&cfg.public_origin)
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned))
        .unwrap_or_default();
    format!(
        "{{\n admin off\n auto_https off\n}}\nhttp://:5188 {{\n bind 127.0.0.1\n @trusted host localhost 127.0.0.1 {public}\n handle @trusted {{\n handle /api/* {{\n reverse_proxy 127.0.0.1:8080 {{\n header_up Host 127.0.0.1:8080\n }}\n }}\n handle {{\n root * {root}/web/dist\n try_files {{path}} /index.html\n file_server\n }}\n }}\n handle {{\n respond 404\n }}\n}}\n"
    )
}
fn wait_ready(root: &str) -> Result<()> {
    tokio::runtime::Runtime::new()?.block_on(async {
        let client=reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(2)).build()?;
        let db=format!("postgresql:///local_paas?host={root}/.local/socket&port=55432");
        let pool=sqlx::postgres::PgPoolOptions::new().max_connections(1).connect(&db).await?;
        for _ in 0..120 {
            let nodes=sqlx::query_scalar::<_,i64>("SELECT count(*) FROM nodes WHERE last_seen>now()-interval '30 seconds'").fetch_one(&pool).await.unwrap_or(0);
            let api=client.get("http://127.0.0.1:8080/api/health").send().await.is_ok_and(|r|r.status().is_success());
            let web=client.get("http://127.0.0.1:5188/").send().await.is_ok_and(|r|r.status().is_success());
            let registry=client.get("http://127.0.0.1:15000/v2/").send().await.is_ok_and(|r|r.status().is_success());
            if nodes==3 && api && web && registry { println!("API, dashboard, registry and all three authenticated nodes are ready."); return Ok(()); }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
        Err("services installed but readiness timed out; inspect systemd journals and retry setup-install".into())
    })
}
fn vm_unit(name: &str, vm: &str, builder: bool) -> String {
    let (memory, cpu) = if builder {
        ("4G", "200%")
    } else {
        ("2600M", "100%")
    };
    format!(
        "[Unit]\nDescription=Local PaaS isolated VM\nRequires=local-paas-firewall.service\nAfter=local-paas-firewall.service network-online.target\n[Service]\nUser={name}\nGroup={name}\nSupplementaryGroups=kvm\nWorkingDirectory=/var/lib/{name}\nExecStart={vm}/bin/run-{name}-vm\nEnvironment=TMPDIR=/var/lib/{name}/tmp\nEnvironment=USE_TMPDIR=1\nRestart=on-failure\nRestartSec=5\nProtectSystem=strict\nProtectHome=yes\nReadWritePaths=/var/lib/{name}\nPrivateTmp=yes\nNoNewPrivileges=yes\nCapabilityBoundingSet=\nProtectKernelTunables=yes\nProtectKernelModules=yes\nProtectControlGroups=yes\nRestrictSUIDSGID=yes\nDevicePolicy=closed\nDeviceAllow=/dev/kvm rw\nMemoryMax={memory}\nMemorySwapMax=0\nCPUQuota={cpu}\nTasksMax=128\nLimitCORE=0\nTimeoutStopSec=30\nKillMode=control-group\n[Install]\nWantedBy=multi-user.target\n"
    )
}
fn install_vm_units(root: &Path) -> Result<()> {
    install_selected_vm_units(root, &[0, 1, 2, 3])
}
fn install_selected_vm_units(root: &Path, indexes: &[u16]) -> Result<()> {
    let staging = root.join(".local/system-units");
    fs::create_dir_all(&staging)?;
    let nft = root.join(".local/worker-tools/bin/nft").canonicalize()?;
    let helper = root.join("target/debug/platform-setup");
    run(
        "sudo",
        &["-n", "install", "-d", "-m", "0755", "/var/lib/local-paas"],
    )?;
    run(
        "sudo",
        &[
            "-n",
            "install",
            "-m",
            "0755",
            helper.to_str().ok_or("path")?,
            "/var/lib/local-paas/platform-setup",
        ],
    )?;
    let remote = indexes.len() == 1 && (4..=7).contains(&indexes[0]);
    let firewall_name = if remote {
        format!("local-paas-worker-{}-firewall.service", indexes[0])
    } else {
        "local-paas-firewall.service".into()
    };
    let selection = if remote {
        format!(" {}", indexes[0])
    } else {
        String::new()
    };
    let firewall = format!(
        "[Unit]\nDescription=Local PaaS VM egress isolation\n[Service]\nType=oneshot\nRemainAfterExit=yes\nExecStart=/var/lib/local-paas/platform-setup firewall {}{selection}\n",
        safe_path(&nft)?
    );
    let mut units = vec![(firewall_name.clone(), firewall)];
    for &index in indexes {
        let (name, path) = if index == 0 {
            (
                "local-paas-builder".to_owned(),
                root.join(".local/builder-vm"),
            )
        } else {
            (
                format!("local-paas-worker-{index}"),
                root.join(format!(".local/worker-{index}-vm")),
            )
        };
        units.push((
            format!("{name}.service"),
            vm_unit(&name, &safe_path(&path.canonicalize()?)?, index == 0)
                .replace("local-paas-firewall.service", &firewall_name),
        ));
    }
    for (name, body) in &units {
        let p = staging.join(name);
        private_write(&p, body)?;
        run(
            "sudo",
            &[
                "-n",
                "install",
                "-m",
                "0644",
                p.to_str().ok_or("path")?,
                &format!("/etc/systemd/system/{name}"),
            ],
        )?;
    }
    run("sudo", &["-n", "systemctl", "daemon-reload"])?;
    for (name, _) in units.into_iter().skip(1) {
        run("sudo", &["-n", "systemctl", "enable", "--now", &name])?;
    }
    Ok(())
}
fn firewall(nft: &str, indexes: &[u16]) -> Result<()> {
    if output("id", &["-u"])? != "0" {
        return Err("firewall operation requires root".into());
    }
    for &index in indexes {
        let (name, table) = if index == 0 {
            (
                "local-paas-builder".to_owned(),
                "local_paas_builder".to_owned(),
            )
        } else {
            (
                format!("local-paas-worker-{index}"),
                format!("local_paas_worker_{index}"),
            )
        };
        let rule_path = format!("/var/lib/local-paas/firewall/{name}.nft");
        let original = fs::read_to_string(rule_path)?;
        let rules = original
            .lines()
            .filter(|l| !l.starts_with("delete table "))
            .collect::<Vec<_>>()
            .join("\n");
        let exists = succeeds(nft, &["list", "table", "inet", &table]);
        // A single nft transaction replaces existing rules with no unfiltered interval.
        let rules = if exists {
            format!("delete table inet {table}\n{rules}\n")
        } else {
            format!("{rules}\n")
        };
        use std::io::Write;
        let mut child = Command::new(nft)
            .args(["-f", "-"])
            .stdin(Stdio::piped())
            .spawn()?;
        child
            .stdin
            .take()
            .ok_or("nft stdin")?
            .write_all(rules.as_bytes())?;
        if !child.wait()?.success() {
            return Err("VM firewall failed; VMs must remain stopped".into());
        }
    }
    Ok(())
}
fn main() {
    if let Err(e) = cli() {
        eprintln!("Setup failed: {e}");
        std::process::exit(1);
    }
}
fn cli() -> Result<()> {
    let args: Vec<_> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("firewall") {
        let indexes = match args.get(3) {
            Some(value) => {
                let index: u16 = value.parse()?;
                if !(4..=7).contains(&index) {
                    return Err("remote index must be 4–7".into());
                }
                vec![index]
            }
            None => vec![0, 1, 2, 3],
        };
        return firewall(args.get(2).ok_or("missing nft executable")?, &indexes);
    }
    let root = std::env::current_dir()?.canonicalize()?;
    if !root.join("infra/workers/vm.nix").exists() {
        return Err("run from the repository root".into());
    }
    match args.get(1).map(String::as_str) {
        Some("remote-worker") => {
            let index: u16 = args.get(2).ok_or("remote worker index required")?.parse()?;
            if !(4..=7).contains(&index) { return Err("remote index must be 4–7".into()); }
            if output("id", &["-u"])? == "0" || !Path::new("/dev/kvm").exists()
                || !Path::new("/sys/fs/cgroup/cgroup.controllers").exists()
                || !succeeds("systemctl", &["--user", "show-environment"])
            { return Err("run as an operator on systemd Linux with KVM and cgroup v2".into()); }
            // Preparation installs only this VM's identity, disk directory and firewall.
            // It never initializes a controller, database, builder or other workers.
            run("bash", &["infra/workers/start.sh", &index.to_string(), "--prepare"])?;
            install_selected_vm_units(&root, &[index])
        }
        Some("check") => check(&root, false),
        Some("prepare") => prepare(&root),
        Some("install") => install(&root),
        Some("render") => {
            let r = safe_path(&root)?;
            let cfg = settings(&root)?;
            println!("--- platform.env\n{}", environment(&r, &cfg));
            println!("--- frontend.Caddyfile\n{}", frontend_config(&r, &cfg));
            for (name, body) in render_user_units(&r) {
                println!("--- {name}\n{body}");
            }
            Ok(())
        }
        _ => Err("usage: platform-setup check|prepare|install|render|remote-worker INDEX (see docs/install.md)".into()),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn configuration_cannot_inject_shell_or_unit_directives() {
        for origin in [
            "https://host/",
            "https://user:pass@host",
            "http://host",
            "https://host\nBAD=x",
            "https://host?a=b",
            "https://host/evil",
        ] {
            assert!(
                Settings {
                    public_origin: origin.into(),
                    ..Default::default()
                }
                .validate()
                .is_err()
            );
        }
        assert!(
            Settings {
                public_origin: "https://my-host.example:5188".into(),
                ..Default::default()
            }
            .validate()
            .is_ok()
        );
        assert!(safe_path(Path::new("/srv/platform%u")).is_err());
        assert!(safe_path(Path::new("/srv/platform$USER")).is_err());
    }
    #[test]
    fn environment_is_literal_in_shell_and_configuration_is_retry_safe() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("environment");
        let content = environment("/srv/platform", &Settings::default());
        private_write(&file, &content).unwrap();
        private_write(&file, &content).unwrap();
        assert!(private_write(&file, "different").is_err());
        let result = Command::new("bash")
            .args(["-c", "source \"$1\"; printf '%s' \"$DATABASE_URL\"", "test"])
            .arg(file)
            .output()
            .unwrap();
        assert!(result.status.success());
        assert_eq!(
            String::from_utf8(result.stdout).unwrap(),
            "postgresql:///local_paas?host=/srv/platform/.local/socket&port=55432"
        );
    }
    #[test]
    fn persistent_units_keep_secrets_out_of_arguments_and_run_static_frontend() {
        let units = render_user_units("/srv/platform");
        assert_eq!(units.len(), 9);
        let web = &units
            .iter()
            .find(|(n, _)| n == "local-paas-web.service")
            .unwrap()
            .1;
        assert!(web.contains("caddy run"));
        assert!(!web.contains("vite"));
        for (_, unit) in &units {
            assert!(!unit.contains("lake."));
            assert!(!unit.contains("token="));
        }
        let vm = vm_unit("local-paas-worker-1", "/nix/store/vm", false);
        assert!(vm.contains("Requires=local-paas-firewall.service"));
        assert!(vm.contains("SupplementaryGroups=kvm"));
        assert!(vm.contains("ProtectHome=yes"));
    }
}
