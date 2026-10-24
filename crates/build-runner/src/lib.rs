//! Bounded buildctl client for a separately isolated BuildKit daemon.
//! No host checkout, Dockerfile execution or daemon startup. Generated recipes
//! are the only local files forwarded to the isolated builder.
use platform_domain::{ImageDigest, ServiceSpec, Workload};
use std::{
    env,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
    sync::mpsc,
};
use uuid::Uuid;
mod detect;
pub use detect::{BuildPlan, plan};
mod refs;
pub use refs::resolve_commit;

#[derive(Clone)]
pub struct Config {
    pub binary: PathBuf,
    pub git_binary: Option<PathBuf>,
    pub address: String,
    pub ca: PathBuf,
    pub cert: PathBuf,
    pub key: PathBuf,
    pub server_name: String,
    pub registry_prefix: String,
    pub registry_insecure: bool,
    pub registry_auth_file: Option<PathBuf>,
    pub repository_hosts: Vec<String>,
    pub timeout: Duration,
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("automatic build detection failed: {0}")]
    Detection(&'static str),
    #[error("missing required builder setting: {0}")]
    Missing(&'static str),
    #[error("invalid builder setting: {0}")]
    Config(&'static str),
    #[error("repository host is not allowed for builds")]
    Repository,
    #[error("only OCI services support BuildKit builds")]
    Workload,
    #[error("build client could not start or read output")]
    Client,
    #[error("BuildKit returned a failed build; see build logs")]
    BuildFailed,
    #[error("build exceeded its time limit")]
    Timeout,
    #[error("BuildKit did not return valid image digest metadata")]
    Metadata,
    #[error("branch or tag could not be resolved from the repository")]
    ReferenceLookup,
    #[error("the requested branch or tag does not exist")]
    ReferenceMissing,
    #[error("build lost its claim before source resolution was recorded")]
    Lease,
}

impl Error {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Detection(code) => code,
            Self::Missing(_) | Self::Config(_) => "builder_configuration",
            Self::Repository => "repository_not_allowed",
            Self::Workload => "unsupported_workload",
            Self::Client => "build_client_failed",
            Self::BuildFailed => "build_failed",
            Self::Timeout => "build_timeout",
            Self::Metadata => "invalid_image_metadata",
            Self::ReferenceLookup => "source_resolution_failed",
            Self::ReferenceMissing => "source_ref_not_found",
            Self::Lease => "worker_lease_lost",
        }
    }
}

impl Config {
    pub fn from_env() -> Result<Self, Error> {
        fn required(name: &'static str) -> Result<String, Error> {
            env::var(name)
                .ok()
                .filter(|v| !v.is_empty())
                .ok_or(Error::Missing(name))
        }
        let config = Self {
            binary: required("BUILDCTL_PATH")?.into(),
            git_binary: env::var("BUILD_GIT_PATH")
                .ok()
                .filter(|p| !p.is_empty())
                .map(Into::into),
            address: required("BUILDKIT_ADDR")?,
            ca: required("BUILDKIT_TLS_CA")?.into(),
            cert: required("BUILDKIT_TLS_CERT")?.into(),
            key: required("BUILDKIT_TLS_KEY")?.into(),
            server_name: required("BUILDKIT_TLS_SERVER_NAME")?,
            registry_prefix: required("BUILD_REGISTRY_PREFIX")?,
            registry_insecure: env::var("BUILD_REGISTRY_INSECURE").is_ok_and(|v| v == "true"),
            registry_auth_file: env::var("BUILD_REGISTRY_AUTH_FILE")
                .ok()
                .filter(|v| !v.is_empty())
                .map(Into::into),
            repository_hosts: env::var("BUILD_REPOSITORY_HOSTS")
                .unwrap_or_else(|_| "github.com".into())
                .split(',')
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
                .collect(),
            timeout: Duration::from_secs(
                env::var("BUILD_TIMEOUT_SECONDS")
                    .unwrap_or_else(|_| "1800".into())
                    .parse()
                    .map_err(|_| Error::Config("BUILD_TIMEOUT_SECONDS"))?,
            ),
        };
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<(), Error> {
        if !self.binary.is_absolute() {
            return Err(Error::Config("BUILDCTL_PATH must be absolute"));
        }
        let address = url::Url::parse(&self.address).map_err(|_| Error::Config("BUILDKIT_ADDR"))?;
        if address.scheme() != "tcp"
            || address.host_str().is_none()
            || address.port().is_none()
            || !address.username().is_empty()
            || address.password().is_some()
            || address.query().is_some()
            || address.fragment().is_some()
            || !matches!(address.path(), "" | "/")
        {
            return Err(Error::Config(
                "BUILDKIT_ADDR must be a TCP endpoint protected by mutual TLS",
            ));
        }
        for path in [&self.ca, &self.cert, &self.key] {
            if !path.is_absolute() || !path.is_file() {
                return Err(Error::Config("TLS files must exist at absolute paths"));
            }
        }
        if self.server_name.is_empty() || self.server_name.chars().any(char::is_whitespace) {
            return Err(Error::Config("BUILDKIT_TLS_SERVER_NAME"));
        }
        let prefix = &self.registry_prefix;
        if !prefix.contains('/')
            || prefix.ends_with('/')
            || prefix.contains("..")
            || prefix.contains("//")
            || !prefix
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"-._/:".contains(&b))
            || prefix
                .split_once('/')
                .is_none_or(|(host, path)| host.is_empty() || path.is_empty() || path.contains(':'))
        {
            return Err(Error::Config(
                "BUILD_REGISTRY_PREFIX must be registry-host/namespace without a scheme or tag",
            ));
        }
        if !(10..=7200).contains(&self.timeout.as_secs()) {
            return Err(Error::Config("BUILD_TIMEOUT_SECONDS must be 10–7200"));
        }
        if self.repository_hosts.is_empty() {
            return Err(Error::Config("BUILD_REPOSITORY_HOSTS"));
        }
        Ok(())
    }

    pub fn image_repository(&self, service_id: Uuid) -> String {
        format!("{}/{}", self.registry_prefix, service_id)
    }

    pub(crate) fn repository(&self, spec: &ServiceSpec) -> Result<url::Url, Error> {
        spec.validate()
            .map_err(|_| Error::Config("invalid service specification"))?;
        let mut repository =
            url::Url::parse(&spec.source.repository).map_err(|_| Error::Repository)?;
        if !repository
            .host_str()
            .is_some_and(|host| self.repository_hosts.iter().any(|allowed| allowed == host))
            || repository.port_or_known_default() != Some(443)
        {
            return Err(Error::Repository);
        }
        let path = repository.path().trim_end_matches('/');
        if !path.ends_with(".git") {
            repository.set_path(&format!("{path}.git"));
        }
        Ok(repository)
    }

    fn arguments(&self, request: &Request, metadata: &Path) -> Result<Vec<String>, Error> {
        request.spec.validate().map_err(|_| Error::Workload)?;
        let (source, context, dockerfile) = match &request.spec.workload {
            Workload::OciService {
                dockerfile,
                context,
                ..
            } => {
                let mut repository = self.repository(&request.spec)?;
                let commit = request
                    .spec
                    .source
                    .commit
                    .as_deref()
                    .ok_or(Error::Config("source must be resolved before building"))?;
                repository.set_fragment(Some(commit));
                (
                    repository.to_string(),
                    context.as_str(),
                    dockerfile.as_str(),
                )
            }
            Workload::PostgresService { .. }
            | Workload::RedisService { .. }
            | Workload::RustfsService { .. } => (String::new(), ".", "Dockerfile"),
            _ => return Err(Error::Workload),
        };
        let mut output = format!(
            "type=image,name={}:build-{},push=true",
            self.image_repository(request.service_id),
            request.build_id
        );
        if self.registry_insecure {
            output.push_str(",registry.insecure=true");
        }
        let mut args = vec![
            "--addr".into(),
            self.address.clone(),
            "--tlscacert".into(),
            self.ca.to_string_lossy().into(),
            "--tlscert".into(),
            self.cert.to_string_lossy().into(),
            "--tlskey".into(),
            self.key.to_string_lossy().into(),
            "--tlsservername".into(),
            self.server_name.clone(),
            "build".into(),
            "--frontend".into(),
            "dockerfile.v0".into(),
            "--progress".into(),
            "plain".into(),
            "--opt".into(),
            format!("context={source}"),
            "--opt".into(),
            format!("contextsubdir={context}"),
            "--opt".into(),
            format!("filename={dockerfile}"),
            "--opt".into(),
            // BuildKit's built-in frontend skips #syntax forwarding when
            // cmdline is present. Verified against the pinned daemon release.
            "cmdline=dockerfile.v0".into(),
            "--opt".into(),
            format!("build-arg:BUILDKIT_CACHE_MOUNT_NS={}", request.service_id),
            "--opt".into(),
            "image-resolve-mode=pull".into(),
            "--output".into(),
            output,
            "--metadata-file".into(),
            metadata.to_string_lossy().into(),
        ];
        if request.no_cache {
            args.push("--no-cache".into());
        }
        Ok(args)
    }
}

pub struct Request {
    pub build_id: Uuid,
    pub service_id: Uuid,
    pub spec: ServiceSpec,
    pub no_cache: bool,
}
pub struct Output {
    pub repository: String,
    pub digest: ImageDigest,
}

pub async fn run(
    config: &Config,
    request: Request,
    plan: &BuildPlan,
    logs: mpsc::Sender<String>,
) -> Result<Output, Error> {
    config.validate()?;
    // Metadata and the scoped registry auth copy live in Linux tmpfs.
    let temp = tempfile::tempdir_in("/dev/shm").map_err(|_| Error::Client)?;
    let metadata = temp.path().join("metadata.json");
    let mut args = config.arguments(&request, &metadata)?;
    prepare_recipe(plan, temp.path(), &mut args).await?;
    if request.spec.workload.is_managed() {
        // A database template has no repository: send only an empty build context.
        let context = temp.path().join("context");
        tokio::fs::create_dir(&context)
            .await
            .map_err(|_| Error::Client)?;
        let position = args
            .iter()
            .position(|v| v == "context=")
            .ok_or(Error::Client)?;
        args.drain(position - 1..=position);
        args.extend(["--local".into(), format!("context={}", context.display())]);
    }
    // Empty HOME prevents implicit host credentials. Only one explicitly supplied
    // registry auth entry is forwarded; credential helpers are not executed.
    let docker_config = temp.path().join("docker");
    tokio::fs::create_dir(&docker_config)
        .await
        .map_err(|_| Error::Client)?;
    if let Some(auth_file) = &config.registry_auth_file {
        let data = read_bounded(auth_file, 64 * 1024).await?;
        let auth: serde_json::Value =
            serde_json::from_slice(&data).map_err(|_| Error::Config("BUILD_REGISTRY_AUTH_FILE"))?;
        let host = config
            .registry_prefix
            .split('/')
            .next()
            .ok_or(Error::Config("BUILD_REGISTRY_PREFIX"))?;
        let value = auth
            .get("auths")
            .and_then(|a| a.get(host))
            .and_then(|a| a.get("auth"))
            .and_then(|a| a.as_str())
            .ok_or(Error::Config("registry auth entry missing"))?;
        let scoped = serde_json::json!({"auths":{host:{"auth":value}}});
        tokio::fs::write(docker_config.join("config.json"), scoped.to_string())
            .await
            .map_err(|_| Error::Client)?;
    }
    let mut child = Command::new(&config.binary)
        .args(args)
        .env_clear()
        .env("HOME", temp.path())
        .env("DOCKER_CONFIG", &docker_config)
        .current_dir(temp.path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| Error::Client)?;
    let stdout = child.stdout.take().ok_or(Error::Client)?;
    let stderr = child.stderr.take().ok_or(Error::Client)?;
    let result = tokio::time::timeout(config.timeout, async {
        let (_, _, status) =
            tokio::try_join!(drain(stdout, logs.clone()), drain(stderr, logs), async {
                child.wait().await.map_err(|_| Error::Client)
            })?;
        if status.success() {
            Ok(())
        } else {
            Err(Error::BuildFailed)
        }
    })
    .await;
    match result {
        Ok(result) => result?,
        Err(_) => {
            let _ = child.kill().await;
            return Err(Error::Timeout);
        }
    }
    let metadata = read_bounded(&metadata, 64 * 1024).await?;
    let value: serde_json::Value =
        serde_json::from_slice(&metadata).map_err(|_| Error::Metadata)?;
    let digest = value
        .get("containerimage.digest")
        .and_then(|v| v.as_str())
        .ok_or(Error::Metadata)?;
    Ok(Output {
        repository: config.image_repository(request.service_id),
        digest: digest.to_string().try_into().map_err(|_| Error::Metadata)?,
    })
}

async fn prepare_recipe(
    plan: &BuildPlan,
    temp: &Path,
    args: &mut Vec<String>,
) -> Result<(), Error> {
    match plan {
        BuildPlan::Dockerfile { path } => {
            for arg in args.iter_mut() {
                if arg.starts_with("filename=") {
                    *arg = format!("filename={path}");
                }
            }
        }
        BuildPlan::Generated {
            dockerfile,
            dockerignore,
            ..
        } => {
            let recipe = temp.join("recipe");
            tokio::fs::create_dir(&recipe)
                .await
                .map_err(|_| Error::Client)?;
            tokio::fs::write(recipe.join("Dockerfile"), dockerfile)
                .await
                .map_err(|_| Error::Client)?;
            tokio::fs::write(recipe.join("Dockerfile.dockerignore"), dockerignore)
                .await
                .map_err(|_| Error::Client)?;
            for arg in args.iter_mut() {
                if arg.starts_with("filename=") {
                    *arg = "filename=Dockerfile".into();
                }
            }
            // Only platform-generated recipe files are shared, never repository
            // files, HOME, credentials, or any NAS directory.
            args.extend([
                "--opt".into(),
                "dockerfilekey=generated".into(),
                "--local".into(),
                format!("generated={}", recipe.display()),
            ]);
        }
    }
    Ok(())
}

async fn read_bounded(path: &Path, limit: usize) -> Result<Vec<u8>, Error> {
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|_| Error::Metadata)?;
    let mut bytes = Vec::new();
    file.take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| Error::Metadata)?;
    if bytes.len() > limit {
        return Err(Error::Metadata);
    }
    Ok(bytes)
}

async fn drain(
    mut stream: impl AsyncRead + Unpin,
    logs: mpsc::Sender<String>,
) -> Result<(), Error> {
    let mut buffer = [0u8; 4096];
    loop {
        let len = stream.read(&mut buffer).await.map_err(|_| Error::Client)?;
        if len == 0 {
            return Ok(());
        }
        if logs
            .send(String::from_utf8_lossy(&buffer[..len]).into_owned())
            .await
            .is_err()
        {
            return Err(Error::Client);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> Config {
        Config {
            binary: "/bin/buildctl".into(),
            git_binary: None,
            address: "tcp://builder:1234".into(),
            ca: "/tmp/ca".into(),
            cert: "/tmp/cert".into(),
            key: "/tmp/key".into(),
            server_name: "builder".into(),
            registry_prefix: "registry.example/platform".into(),
            registry_insecure: false,
            registry_auth_file: None,
            repository_hosts: vec!["github.com".into()],
            timeout: Duration::from_secs(1800),
        }
    }
    fn request() -> Request {
        Request {
            build_id: Uuid::new_v4(),
            service_id: Uuid::new_v4(),
            spec: serde_json::from_str(include_str!("../../../examples/oci-service.json")).unwrap(),
            no_cache: true,
        }
    }
    #[test]
    fn remote_build_has_pinned_git_and_no_host_sharing() {
        let request = request();
        let args = config()
            .arguments(&request, Path::new("/tmp/metadata.json"))
            .unwrap();
        assert!(args.contains(&format!(
            "context=https://github.com/example/web-canary.git#{}",
            request.spec.source.commit.as_deref().unwrap()
        )));
        assert!(args.contains(&"--no-cache".into()));
        assert!(args.iter().any(|a| a.contains("push=true")));
        for forbidden in ["--local", "--secret", "--ssh", "--allow"] {
            assert!(!args.iter().any(|a| a == forbidden));
        }
    }
    #[test]
    fn checkout_context_and_dockerfile_have_independent_paths() {
        let mut request = request();
        if let Workload::OciService {
            dockerfile,
            context,
            ..
        } = &mut request.spec.workload
        {
            *dockerfile = "deploy/Dockerfile".into();
            *context = "app".into();
        }
        let args = config()
            .arguments(&request, Path::new("/tmp/metadata.json"))
            .unwrap();
        assert!(args.contains(&"contextsubdir=app".into()));
        assert!(args.contains(&"filename=deploy/Dockerfile".into()));
    }
    #[test]
    fn private_fetch_targets_and_celld_are_rejected() {
        let mut request = request();
        request.spec.source.repository = "https://127.0.0.1/database".into();
        assert!(matches!(
            config().arguments(&request, Path::new("/tmp/meta")),
            Err(Error::Repository)
        ));
        request.spec =
            serde_json::from_str(include_str!("../../../examples/celld-service.json")).unwrap();
        assert!(matches!(
            config().arguments(&request, Path::new("/tmp/meta")),
            Err(Error::Workload)
        ));
    }
    #[tokio::test]
    async fn oversized_metadata_is_not_loaded_unboundedly() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("metadata");
        tokio::fs::write(&path, vec![b'x'; 4096]).await.unwrap();
        assert!(matches!(
            read_bounded(&path, 1024).await,
            Err(Error::Metadata)
        ));
    }
}
