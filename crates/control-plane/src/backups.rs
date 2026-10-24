//! Explicit local backup operator. Restic owns encryption and snapshot integrity.
//! Database values and child diagnostics never enter platform logs or metadata.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgPool, Row, postgres::PgConnectOptions};
use std::{
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{io::AsyncReadExt, process::Command};
use uuid::Uuid;

type Result<T> = std::result::Result<T, &'static str>;
#[derive(Clone)]
struct Context {
    root: PathBuf,
    repository: String,
    key: PathBuf,
}
#[derive(Serialize, Deserialize)]
struct Snapshot {
    kind: String,
    service: Option<Uuid>,
    id: String,
    file: String,
}
#[derive(Serialize, Deserialize)]
struct Manifest {
    version: u32,
    id: Uuid,
    created_at: String,
    snapshots: Vec<Snapshot>,
}

async fn command(mut cmd: Command) -> Result<Vec<u8>> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = cmd.spawn().map_err(|_| "backup tool could not start")?;
    let mut output = child
        .stdout
        .take()
        .ok_or("backup tool output unavailable")?
        .take(1024 * 1024 + 1);
    let mut bytes = Vec::new();
    let status = tokio::time::timeout(Duration::from_secs(600), async {
        let (read, status) = tokio::join!(output.read_to_end(&mut bytes), child.wait());
        read.map_err(|_| "backup tool output failed")?;
        status.map_err(|_| "backup tool failed")
    })
    .await
    .map_err(|_| "backup tool timed out")??;
    if !status.success() || bytes.len() > 1024 * 1024 {
        return Err("backup tool failed; diagnostics withheld to protect data");
    }
    Ok(bytes)
}
fn save(path: &Path, value: &impl Serialize) -> Result<()> {
    use std::io::Write;
    let temp = path.with_extension("tmp");
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&temp)
        .map_err(|_| "backup metadata unavailable")?;
    file.write_all(&serde_json::to_vec_pretty(value).map_err(|_| "invalid backup metadata")?)
        .map_err(|_| "backup metadata write failed")?;
    file.sync_all().map_err(|_| "backup metadata sync failed")?;
    std::fs::rename(temp, path).map_err(|_| "backup metadata commit failed")
}
impl Context {
    fn new(root: PathBuf) -> Result<Self> {
        let root = root
            .canonicalize()
            .map_err(|_| "checkout path unavailable")?;
        let repository = std::env::var("RESTIC_REPOSITORY").unwrap_or_else(|_| {
            root.join(".local/backups/repository")
                .to_string_lossy()
                .into_owned()
        });
        let key = std::env::var_os("RESTIC_PASSWORD_FILE")
            .map(PathBuf::from)
            .unwrap_or_else(|| root.join(".local/backups/repository.key"));
        Ok(Self {
            root,
            repository,
            key,
        })
    }
    fn dir(&self) -> PathBuf {
        self.root.join(".local/backups")
    }
    fn services(&self) -> PathBuf {
        self.root.join(".local/platform-services")
    }
    fn tool(&self, name: &str) -> PathBuf {
        self.root.join(".local/service-tools/bin").join(name)
    }
    fn restic(&self) -> Command {
        let mut cmd = Command::new(self.tool("restic"));
        cmd.env("RESTIC_REPOSITORY", &self.repository)
            .env("RESTIC_PASSWORD_FILE", &self.key)
            .env("RESTIC_CACHE_DIR", self.dir().join("cache"));
        cmd
    }
    fn sandbox(&self, program: &Path, stage: &Path) -> Result<Command> {
        let mut cmd = Command::new(self.tool("bwrap"));
        // The sandbox intentionally does not mount the host's locale archive.
        cmd.env("LC_ALL", "C").env("LANG", "C");
        cmd.args([
            "--unshare-all",
            "--die-with-parent",
            "--new-session",
            "--ro-bind",
            "/nix/store",
            "/nix/store",
            "--proc",
            "/proc",
            "--dev",
            "/dev",
            "--tmpfs",
            "/tmp",
            "--ro-bind",
            "/etc/passwd",
            "/etc/passwd",
            "--ro-bind",
            "/etc/group",
            "/etc/group",
        ])
        .arg("--bind")
        .arg(stage)
        .arg(stage)
        .arg("--chdir")
        .arg(stage)
        .arg("--")
        .arg(
            program
                .canonicalize()
                .map_err(|_| "restore executable unavailable")?,
        );
        Ok(cmd)
    }
    fn stage(&self) -> Result<tempfile::TempDir> {
        let runtime = std::env::var_os("XDG_RUNTIME_DIR")
            .ok_or("XDG_RUNTIME_DIR must point to the private runtime tmpfs")?;
        let path = PathBuf::from(runtime);
        // Keep restored secret material and database files off persistent workload/host disks.
        if !path.starts_with("/run/user") {
            return Err("backup staging must use /run/user tmpfs");
        }
        let filesystem =
            rustix::fs::statfs(&path).map_err(|_| "cannot verify temporary backup filesystem")?;
        if filesystem.f_type != libc::TMPFS_MAGIC {
            return Err("restore staging requires a tmpfs filesystem");
        }
        tempfile::Builder::new()
            .prefix("local-paas-backup-")
            .tempdir_in(path)
            .map_err(|_| "private backup staging unavailable")
    }
    #[allow(clippy::too_many_arguments)] // Explicit snapshot identity, command argv and private child environment.
    async fn snapshot(
        &self,
        run: Uuid,
        kind: &str,
        service: Option<Uuid>,
        file: &str,
        executable: &Path,
        args: &[String],
        env: &[(&str, String)],
    ) -> Result<Snapshot> {
        let mut cmd = self.restic();
        cmd.args([
            "backup",
            "--json",
            "--tag",
            &run.to_string(),
            "--tag",
            kind,
            "--stdin-filename",
            file,
            "--stdin-from-command",
            "--",
        ])
        .arg(executable)
        .args(args)
        .envs(env.iter().map(|(k, v)| (*k, v)));
        let output = command(cmd).await?;
        let id = output
            .split(|c| *c == b'\n')
            .filter_map(|line| serde_json::from_slice::<Value>(line).ok())
            .find_map(|value| {
                value
                    .get("snapshot_id")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .ok_or("backup did not produce a snapshot")?;
        if !snapshot_id(&id) {
            return Err("backup returned an invalid snapshot ID");
        }
        Ok(Snapshot {
            kind: kind.into(),
            service,
            id,
            file: file.into(),
        })
    }
    async fn restore(&self, snapshot: &Snapshot, target: &Path) -> Result<PathBuf> {
        if !snapshot_id(&snapshot.id)
            || !matches!(
                snapshot.file.as_str(),
                "database.dump" | "database.rdb" | "openbao.tar"
            )
        {
            return Err("invalid restore manifest");
        }
        let mut cmd = self.restic();
        cmd.args(["restore", &snapshot.id, "--verify", "--target"])
            .arg(target);
        command(cmd).await?;
        let path = target.join(&snapshot.file);
        if !path.is_file() {
            return Err("restored snapshot is missing its archive");
        }
        Ok(path)
    }
    async fn systemctl(&self, args: &[&str]) -> Result<()> {
        let mut cmd = Command::new("systemctl");
        cmd.arg("--user").args(args);
        command(cmd).await.map(|_| ())
    }
    async fn resume(&self) -> Result<()> {
        if !self.dir().join("openbao-paused").exists() {
            return Ok(());
        }
        let mut started = false;
        for _ in 0..30 {
            if self
                .systemctl(&["is-active", "--quiet", "local-paas-openbao"])
                .await
                .is_ok()
            {
                started = true;
                break;
            }
            if self
                .systemctl(&["start", "local-paas-openbao"])
                .await
                .is_ok()
            {
                started = true;
                break;
            }
            let mut cmd = Command::new("systemd-run");
            cmd.args([
                "--user",
                "--unit=local-paas-openbao",
                "--collect",
                "--property=Restart=on-failure",
                "--property=RestartSec=5",
                "--property=LimitCORE=0",
                "--property=MemoryMax=512M",
                "--property=MemorySwapMax=0",
                "--property=UMask=0077",
                "--property=NoNewPrivileges=true",
                "--property=CPUQuota=100%",
                "--property=TasksMax=256",
            ])
            .arg(self.tool("bao"))
            .arg("server")
            .arg(format!(
                "-config={}",
                self.services().join("openbao.hcl").display()
            ));
            if command(cmd).await.is_ok() {
                started = true;
                break;
            }
            // An interrupted `systemctl stop` may leave the old transient unit
            // deactivating. Its name cannot be reused until systemd collects it.
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        if !started {
            return Err("OpenBao restart failed; maintenance marker retained for recovery");
        }
        unseal(&self.services(), 18200).await?;
        std::fs::remove_file(self.dir().join("openbao-paused"))
            .map_err(|_| "OpenBao resumed but maintenance marker remains")?;
        Ok(())
    }
}
fn snapshot_id(id: &str) -> bool {
    (id.len() == 8 || id.len() == 64) && id.bytes().all(|c| c.is_ascii_hexdigit())
}

async fn bao_client(root: &Path) -> Result<reqwest::Client> {
    let pem = std::fs::read(root.join("tls/ca.pem")).map_err(|_| "OpenBao CA unavailable")?;
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .tls_built_in_root_certs(false)
        .add_root_certificate(
            reqwest::Certificate::from_pem(&pem).map_err(|_| "OpenBao CA invalid")?,
        )
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|_| "OpenBao client unavailable")
}
async fn unseal(root: &Path, port: u16) -> Result<()> {
    let client = bao_client(root).await?;
    let mut ready = false;
    for _ in 0..30 {
        if let Ok(response) = client
            .get(format!("https://127.0.0.1:{port}/v1/sys/seal-status"))
            .send()
            .await
            && response.status().is_success()
        {
            let value: Value = serde_json::from_slice(
                &response
                    .bytes()
                    .await
                    .map_err(|_| "OpenBao seal status unavailable")?,
            )
            .map_err(|_| "invalid seal status")?;
            if value["sealed"] == false {
                return Ok(());
            }
            ready = true;
            break;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    if !ready {
        return Err("OpenBao did not become available");
    }
    let credentials: Value = serde_json::from_slice(
        &std::fs::read(root.join("recovery/initialization.json"))
            .map_err(|_| "OpenBao recovery material unavailable")?,
    )
    .map_err(|_| "invalid recovery material")?;
    for key in credentials["keys"]
        .as_array()
        .ok_or("invalid recovery keys")?
        .iter()
        .take(2)
    {
        let response = client
            .post(format!("https://127.0.0.1:{port}/v1/sys/unseal"))
            .header("content-type", "application/json")
            .body(json!({"key":key}).to_string())
            .send()
            .await
            .map_err(|_| "OpenBao unseal failed")?;
        if !response.status().is_success() {
            return Err("OpenBao unseal rejected");
        }
        let value: Value = serde_json::from_slice(
            &response
                .bytes()
                .await
                .map_err(|_| "OpenBao unseal failed")?,
        )
        .map_err(|_| "invalid unseal response")?;
        if value["sealed"] == false {
            return Ok(());
        }
    }
    Err("OpenBao remains sealed")
}

struct ResumeGuard(Context);
impl Drop for ResumeGuard {
    fn drop(&mut self) {
        if self.0.dir().join("openbao-paused").exists()
            && let Ok(exe) = std::env::current_exe()
        {
            let _ = std::process::Command::new(exe)
                .arg("resume")
                .arg(&self.0.root)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }
}
async fn audit(pool: &PgPool, id: Uuid, action: &str, outcome: &str, details: Value) -> Result<()> {
    sqlx::query("INSERT INTO audit_log(actor,action,outcome,target_type,target_id,details) VALUES('backup-worker',$1,$2,'backup',$3,$4)")
        .bind(action).bind(outcome).bind(id.to_string()).bind(sqlx::types::Json(details)).execute(pool).await.map_err(|_| "backup audit could not be committed")?;
    Ok(())
}
async fn backup(context: &Context, pool: &PgPool) -> Result<Manifest> {
    let id = Uuid::now_v7();
    audit(pool, id, "backup.start", "started", json!({})).await?;
    let mut manifest = Manifest {
        version: 1,
        id,
        created_at: chrono::Utc::now().to_rfc3339(),
        snapshots: Vec::new(),
    };
    let result: Result<()> = async {
        let stage = context.stage()?;
        let databases = sqlx::query("SELECT s.id,s.kind,coalesce(s.spec->'workload'->>'database','0') AS database,n.endpoint_base+i.slot AS port,i.state, i.observed_at>now()-interval '15 seconds' AND n.last_seen>now()-interval '30 seconds' AS fresh FROM services s JOIN deployments d ON d.service_id=s.id AND d.status='active' JOIN instances i ON i.deployment_id=d.id AND i.desired_state='running' JOIN nodes n ON n.id=i.node_id WHERE s.kind IN ('postgres-service','redis-service')")
            .fetch_all(pool).await.map_err(|_| "database inventory unavailable")?;
        for row in databases {
            if row.get::<String,_>("state") != "ready" || !row.get::<bool,_>("fresh") { return Err("an active database is not healthy; backup set is incomplete"); }
            let service: Uuid = row.get("id");
            let kind: String = row.get("kind");
            let port: i32 = row.get("port");
            let database: String = row.get("database");
            let (_, values) = crate::secrets::own_values(pool, service).await.map_err(|_| "database backup credential unavailable")?;
            let snapshot = if kind == "postgres-service" {
                context.snapshot(id, "postgres", Some(service), "database.dump", &context.tool("pg_dump"),
                    &["--host=127.0.0.1".into(),format!("--port={port}"),"--username=postgres".into(),format!("--dbname={database}"),"--no-password".into(),"--format=custom".into()],
                    &[("PGPASSWORD",values.get("POSTGRES_PASSWORD").ok_or("database password unavailable")?.clone()),("PGCONNECT_TIMEOUT","5".into())]).await?
            } else {
                let rdb = stage.path().join("database.rdb");
                let mut cmd = Command::new(context.tool("redis-cli"));
                cmd.args(["-h", "127.0.0.1", "-p", &port.to_string(), "--rdb"]).arg(&rdb)
                    .env("REDISCLI_AUTH", values.get("REDIS_PASSWORD").ok_or("database password unavailable")?);
                command(cmd).await?;
                let snapshot = context.snapshot(id,"redis",Some(service),"database.rdb",&context.tool("cat"), &[rdb.to_string_lossy().into_owned()],&[]).await?;
                std::fs::remove_file(rdb).map_err(|_| "temporary Redis archive cleanup failed")?;
                snapshot
            };
            manifest.snapshots.push(snapshot);
        }
        // File-backed OpenBao has no online snapshot primitive. Keep it offline through
        // both snapshots so PostgreSQL cannot reference newer secret versions than the backup.
        save(&context.dir().join("openbao-paused"), &json!({"backup_id":id}))?;
        let guard = ResumeGuard(context.clone());
        context.systemctl(&["stop", "local-paas-openbao"]).await?;
        let bao = context.snapshot(id,"openbao",None,"openbao.tar",&context.tool("tar"),
            &["-C".into(),context.services().to_string_lossy().into_owned(),"-cf".into(),"-".into(),"openbao".into(),"tls".into(),"recovery".into(),"controller.token".into(),"openbao.hcl".into()],&[]).await?;
        manifest.snapshots.push(bao);
        let control = context.snapshot(id,"control-plane",None,"database.dump",&context.tool("pg_dump"),
            &[format!("--host={}",context.root.join(".local/socket").display()),"--port=55432".into(),"--dbname=local_paas".into(),"--no-password".into(),"--format=custom".into()],&[]).await?;
        manifest.snapshots.push(control);
        context.resume().await?;
        drop(guard);
        let path = stage.path().join("manifest.json"); save(&path,&manifest)?;
        context.snapshot(id,"manifest",None,"manifest.json",&context.tool("cat"), &[path.to_string_lossy().into_owned()],&[]).await?;
        save(&context.dir().join("latest.json"), &manifest)?;
        Ok(())
    }.await;
    audit(
        pool,
        id,
        "backup.complete",
        if result.is_ok() {
            "succeeded"
        } else {
            "failed"
        },
        json!({"snapshots":manifest.snapshots.len(),"error":result.as_ref().err()}),
    )
    .await?;
    result?;
    Ok(manifest)
}

pub async fn cli() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let action = args
        .next()
        .ok_or("usage: platform-backup init|run|verify|resume CHECKOUT")?;
    let context = Context::new(PathBuf::from(args.next().ok_or("checkout required")?))?;
    std::fs::create_dir_all(context.dir()).map_err(|_| "backup directory unavailable")?;
    std::fs::set_permissions(context.dir(), std::fs::Permissions::from_mode(0o700))
        .map_err(|_| "backup directory permissions unavailable")?;
    if action == "resume" {
        return context.resume().await;
    }
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .mode(0o600)
        .open(context.dir().join("operator.lock"))
        .map_err(|_| "backup lock unavailable")?;
    lock.try_lock()
        .map_err(|_| "another backup or restore drill is already running")?;
    if action == "init" {
        if !context.key.exists() {
            if Path::new(&context.repository).join("config").exists() {
                return Err("existing repository has no key; recover its original key");
            }
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .mode(0o600)
                .open(&context.key)
                .map_err(|_| "backup key creation failed")?;
            file.write_all(
                format!("{}{}", Uuid::now_v7().simple(), Uuid::now_v7().simple()).as_bytes(),
            )
            .map_err(|_| "backup key write failed")?;
            file.sync_all().map_err(|_| "backup key sync failed")?;
        }
        let mut cmd = context.restic();
        cmd.arg("init");
        command(cmd).await?;
        println!("Encrypted backup repository initialized; recovery key saved privately.");
        return Ok(());
    }
    context.resume().await?;
    let pool = PgPool::connect_with(
        PgConnectOptions::new()
            .host(&context.root.join(".local/socket").to_string_lossy())
            .port(55432)
            .database("local_paas"),
    )
    .await
    .map_err(|_| "platform database unavailable")?;
    match action.as_str() {
        "run" => {
            let manifest = backup(&context, &pool).await?;
            println!(
                "Backup {} complete: {} snapshots.",
                manifest.id,
                manifest.snapshots.len()
            );
        }
        "verify" => verify(&context, &pool).await?,
        _ => return Err("unknown backup command"),
    }
    Ok(())
}

async fn verify(context: &Context, pool: &PgPool) -> Result<()> {
    let mut cmd = context.restic();
    cmd.args(["dump", "--tag", "manifest", "latest", "manifest.json"]);
    let manifest: Manifest =
        serde_json::from_slice(&command(cmd).await?).map_err(|_| "backup manifest unavailable")?;
    if manifest.version != 1 || manifest.snapshots.is_empty() {
        return Err("unsupported or empty backup set");
    }
    audit(
        pool,
        manifest.id,
        "backup.restore_check",
        "started",
        json!({}),
    )
    .await?;
    let result = verify_set(context, &manifest).await;
    let details = match &result {
        Ok(details) => details.clone(),
        Err(error) => json!({"error":error}),
    };
    audit(
        pool,
        manifest.id,
        "backup.restore_check",
        if result.is_ok() {
            "succeeded"
        } else {
            "failed"
        },
        details.clone(),
    )
    .await?;
    save(
        &context.dir().join("verification.json"),
        &json!({"backup_id":manifest.id,"checked_at":chrono::Utc::now().to_rfc3339(),"succeeded":result.is_ok(),"details":details}),
    )?;
    result?;
    println!(
        "Backup {} restored and verified in disposable PostgreSQL, Redis and OpenBao instances.",
        manifest.id
    );
    Ok(())
}

async fn verify_set(context: &Context, manifest: &Manifest) -> Result<Value> {
    let stage = context.stage()?;
    let pg_data = stage.path().join("pg");
    let socket = stage.path().join("socket");
    std::fs::create_dir(&socket).map_err(|_| "restore socket directory unavailable")?;
    let mut init = Command::new(context.tool("initdb"));
    init.arg("-D")
        .arg(&pg_data)
        .args(["--auth=trust", "--no-instructions", "--no-locale"]);
    command(init).await?;
    let mut postgres = context
        .sandbox(&context.tool("postgres"), stage.path())?
        .arg("-D")
        .arg(&pg_data)
        .arg("-k")
        .arg(&socket)
        .args([
            "-p",
            "55439",
            "-h",
            "",
            "-c",
            "fsync=off",
            "-c",
            "shared_buffers=32MB",
            "-c",
            "max_connections=10",
            "-c",
            "log_min_error_statement=panic",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "disposable PostgreSQL could not start")?;
    let options = PgConnectOptions::new()
        .host(&socket.to_string_lossy())
        .port(55439)
        .database("postgres");
    let mut admin = None;
    for _ in 0..100 {
        if let Ok(pool) = PgPool::connect_with(options.clone()).await {
            admin = Some(pool);
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let admin = admin.ok_or("disposable PostgreSQL unavailable")?;
    let mut restored = Vec::new();
    let mut platform = None;
    let mut bao_root = None;
    for (index, snapshot) in manifest.snapshots.iter().enumerate() {
        let target = stage.path().join(index.to_string());
        let archive = context.restore(snapshot, &target).await?;
        match snapshot.kind.as_str() {
            "control-plane" | "postgres" => {
                let database = format!("restore_{index}");
                sqlx::query(&format!("CREATE DATABASE {database}"))
                    .execute(&admin)
                    .await
                    .map_err(|_| "disposable database creation failed")?;
                let mut restore = Command::new(context.tool("pg_restore"));
                restore
                    .arg("--host")
                    .arg(&socket)
                    .args([
                        "--port=55439",
                        "--no-password",
                        "--exit-on-error",
                        "--no-owner",
                        "--no-privileges",
                        "--dbname",
                        &database,
                    ])
                    .arg(archive);
                command(restore).await?;
                let database_pool = PgPool::connect_with(options.clone().database(&database))
                    .await
                    .map_err(|_| "restored database unavailable")?;
                let tables: i64 = sqlx::query_scalar("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'")
                    .fetch_one(&database_pool).await.map_err(|_| "restored catalog query failed")?;
                if snapshot.kind == "control-plane" {
                    let _: i64 = sqlx::query_scalar("SELECT count(*) FROM services")
                        .fetch_one(&database_pool)
                        .await
                        .map_err(|_| "control-plane tables missing from restore")?;
                    platform = Some(database_pool);
                } else {
                    database_pool.close().await;
                }
                restored
                    .push(json!({"kind":snapshot.kind,"service":snapshot.service,"tables":tables}));
            }
            "redis" => {
                let sock = target.join("redis.sock");
                let mut redis = context
                    .sandbox(&context.tool("redis-server"), stage.path())?
                    .args([
                        "--port",
                        "0",
                        "--save",
                        "",
                        "--appendonly",
                        "no",
                        "--unixsocketperm",
                        "700",
                        "--dbfilename",
                        "database.rdb",
                    ])
                    .arg("--unixsocket")
                    .arg(&sock)
                    .arg("--dir")
                    .arg(&target)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .kill_on_drop(true)
                    .spawn()
                    .map_err(|_| "disposable Redis could not start")?;
                let mut keyspace = None;
                for _ in 0..100 {
                    let mut ping = Command::new(context.tool("redis-cli"));
                    ping.arg("-s").arg(&sock).args(["INFO", "keyspace"]);
                    if let Ok(bytes) = command(ping).await {
                        keyspace = Some(bytes);
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
                let keyspace = String::from_utf8(keyspace.ok_or("restored Redis unavailable")?)
                    .map_err(|_| "restored Redis invalid response")?;
                if !keyspace.contains("# Keyspace") {
                    return Err("restored Redis did not load the archive");
                }
                restored.push(json!({"kind":"redis","service":snapshot.service,"loaded":true}));
                redis
                    .kill()
                    .await
                    .map_err(|_| "disposable Redis cleanup failed")?;
                redis
                    .wait()
                    .await
                    .map_err(|_| "disposable Redis cleanup failed")?;
            }
            "openbao" => {
                let mut tar = Command::new(context.tool("tar"));
                tar.arg("-xf")
                    .arg(archive)
                    .arg("-C")
                    .arg(&target)
                    .arg("--no-same-owner");
                command(tar).await?;
                bao_root = Some(target);
            }
            _ => return Err("unsupported backup component"),
        }
    }
    let platform = platform.ok_or("backup set lacks platform state")?;
    let bao_root = bao_root.ok_or("backup set lacks OpenBao")?;
    // Port is deliberately different from the live authority and never exposed by ingress.
    let port = 28200;
    let reservation = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|_| "OpenBao restore port is already in use")?;
    let hcl = format!(
        "ui = false\ndisable_mlock = true\nstorage \"file\" {{ path = {} }}\nlistener \"tcp\" {{ address = \"127.0.0.1:{port}\"\n tls_cert_file = {}\n tls_key_file = {}\n }}\napi_addr = \"https://127.0.0.1:{port}\"\n",
        json!(bao_root.join("openbao")),
        json!(bao_root.join("tls/server.pem")),
        json!(bao_root.join("tls/server.key"))
    );
    let config = bao_root.join("restore.hcl");
    std::fs::write(&config, hcl).map_err(|_| "restore OpenBao configuration unavailable")?;
    drop(reservation);
    let mut bao = Command::new(context.tool("bao"))
        .arg("server")
        .arg(format!("-config={}", config.display()))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "disposable OpenBao could not start")?;
    unseal(&bao_root, port).await?;
    let client = bao_client(&bao_root).await?;
    let recovery: Value = serde_json::from_slice(
        &std::fs::read(bao_root.join("recovery/initialization.json"))
            .map_err(|_| "restored recovery material missing")?,
    )
    .map_err(|_| "invalid restored recovery material")?;
    let token = recovery["root_token"]
        .as_str()
        .ok_or("restored recovery identity missing")?;
    // Verify every deployment's pinned secret version against the restored authority.
    // Values are only inspected in memory and never included in reports.
    let versions = sqlx::query("SELECT DISTINCT s.environment_id,d.service_id,d.secret_version,d.secret_snapshot FROM deployments d JOIN services s ON s.id=d.service_id WHERE d.secret_version IS NOT NULL")
        .fetch_all(&platform).await.map_err(|_| "restored secret references unavailable")?;
    for row in &versions {
        let env: Uuid = row.get("environment_id");
        let service: Uuid = row.get("service_id");
        let version: i32 = row.get("secret_version");
        let suffix = if row.get::<bool, _>("secret_snapshot") {
            "/snapshots"
        } else {
            ""
        };
        let response = client.get(format!("https://127.0.0.1:{port}/v1/platform/data/workloads/{env}/{service}{suffix}?version={version}"))
            .header("X-Vault-Token",token).send().await.map_err(|_| "restored secret version unavailable")?;
        if !response.status().is_success() {
            return Err("a pinned secret version is missing from restored OpenBao");
        }
        let value: Value = serde_json::from_slice(
            &response
                .bytes()
                .await
                .map_err(|_| "restored secret response unavailable")?,
        )
        .map_err(|_| "invalid restored secret response")?;
        if !value["data"]["data"].is_object() {
            return Err("restored secret version is deleted or unavailable");
        }
    }
    restored
        .push(json!({"kind":"openbao","unsealed":true,"verified_secret_versions":versions.len()}));
    bao.kill()
        .await
        .map_err(|_| "disposable OpenBao cleanup failed")?;
    bao.wait()
        .await
        .map_err(|_| "disposable OpenBao cleanup failed")?;
    platform.close().await;
    admin.close().await;
    postgres
        .kill()
        .await
        .map_err(|_| "disposable PostgreSQL cleanup failed")?;
    postgres
        .wait()
        .await
        .map_err(|_| "disposable PostgreSQL cleanup failed")?;
    Ok(json!({"components":restored}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshot_identifiers_cannot_select_arbitrary_paths_or_flags() {
        assert!(snapshot_id("a123abcd"));
        assert!(snapshot_id(&"a".repeat(64)));
        for id in ["latest", "../archive", "--target", "a123abcd:subtree", "a"] {
            assert!(!snapshot_id(id));
        }
    }
}
