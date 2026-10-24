//! Read bounded public manifest metadata; never clone or execute source on the host.
use crate::{Config, Error, Request};
use node_semver::{Range, Version};
use platform_domain::{BuildMode, Workload};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeSet, time::Duration};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum BuildPlan {
    Dockerfile {
        path: String,
    },
    Generated {
        generator: String,
        runtime: String,
        package_manager: String,
        dockerfile: String,
        dockerignore: String,
    },
}

const NODE: [(&str, &str); 2] = [
    (
        "24.22.1",
        "node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205",
    ),
    (
        "22.23.4",
        "node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d",
    ),
];
const BUN_VERSION: &str = "1.4.4";
const BUN_IMAGE: &str =
    "oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d";
const LOCKS: [(&str, &str); 6] = [
    ("package-lock.json", "npm"),
    ("npm-shrinkwrap.json", "npm"),
    ("pnpm-lock.yaml", "pnpm"),
    ("yarn.lock", "yarn"),
    ("bun.lock", "bun"),
    ("bun.lockb", "bun"),
];
// Last-match-wins exclusions cannot be undone by repository ignore rules.
const EXCLUDES: &str = "\n.git\n**/.git\nnode_modules\n**/node_modules\n.env\n.env.*\n**/.env\n**/.env.*\n.npmrc\n**/.npmrc\n.next\n**/.next\nnpm-debug.log*\n";

pub async fn plan(config: &Config, request: &Request) -> Result<BuildPlan, Error> {
    if matches!(request.spec.workload, Workload::RustfsService { .. }) {
        request.spec.validate().map_err(|_| Error::Workload)?;
        return Ok(BuildPlan::Generated {
            generator:"platform-rustfs-v1".into(),runtime:"RustFS 1.0.3".into(),package_manager:"pinned official image".into(),
            dockerfile:r#"FROM rustfs/rustfs:1.0.3@sha256:9ca9559533b537d10482fe923288b676ad08f92a7069d9a17327fbae3cab688b
ENV RUSTFS_CONSOLE_ENABLE=false RUSTFS_OBS_LOG_DIRECTORY=/tmp/logs RUSTFS_OBS_LOGGER_LEVEL=warn
ENTRYPOINT ["/usr/bin/rustfs"]
CMD ["/data"]
"#.into(),dockerignore:"*\n".into()
        });
    }
    if matches!(request.spec.workload, Workload::RedisService { .. }) {
        request.spec.validate().map_err(|_| Error::Workload)?;
        let script = r#"set -eu; umask 077; printf 'bind 0.0.0.0\nport 6379\ndir /data\nappendonly yes\nappendfsync everysec\nsave ""\nmaxmemory %s\nmaxmemory-policy noeviction\nrequirepass %s\n' "$REDIS_MAXMEMORY" "$REDIS_PASSWORD" > /tmp/platform-redis.conf; exec redis-server /tmp/platform-redis.conf"#;
        return Ok(BuildPlan::Generated {
            generator: "platform-redis-v1".into(),
            runtime: "Redis 8.2.10".into(),
            package_manager: "pinned official image".into(),
            dockerfile: format!(
                "FROM redis:8.2.10-bookworm@sha256:e5f23377739f95a2f530b9c99f93accb4f634577f09d00a7d8e0638f2fdf69e0\nCMD {}\n",
                serde_json::to_string(&["sh", "-c", script]).map_err(|_| Error::Client)?
            ),
            dockerignore: "*\n".into(),
        });
    }
    if matches!(request.spec.workload, Workload::PostgresService { .. }) {
        request.spec.validate().map_err(|_| Error::Workload)?;
        return Ok(BuildPlan::Generated {
            generator: "platform-postgres-v1".into(), runtime: "PostgreSQL 18.6".into(), package_manager: "pinned official image".into(),
            dockerfile: "FROM postgres:18.6-bookworm@sha256:bbf83594798e144bff365a9c191c5d779f181fb3135902064ab8ff11918020fc\nRUN sed -i 's/PGHOST= PGHOSTADDR=/PGHOST=\\/tmp PGHOSTADDR=/' /usr/local/bin/docker-entrypoint.sh\nENV PGDATA=/var/lib/postgresql/18/docker\nCMD [\"postgres\",\"-c\",\"unix_socket_directories=/tmp\",\"-c\",\"max_connections=50\",\"-c\",\"shared_buffers=64MB\"]\n".into(),
            dockerignore: "*\n".into(),
        });
    }

    let Workload::OciService {
        build_mode,
        build_args,
        build_target,
        build_command,
        start_command,
        dockerfile,
        context,
        port,
        ..
    } = &request.spec.workload
    else {
        return Err(Error::Workload);
    };
    request.spec.validate().map_err(|_| Error::Workload)?;
    if request.spec.source.upload.is_none() {
        config.repository(&request.spec)?;
    }
    if *build_mode == BuildMode::Dockerfile {
        return Ok(BuildPlan::Dockerfile {
            path: dockerfile.clone(),
        });
    }
    let source = if request.spec.source.upload.is_some() {
        Source::Local(request.local_context.clone().ok_or(Error::UploadedSource)?)
    } else {
        Source::Remote(PublicSource::new(config, request)?)
    };
    tokio::time::timeout(Duration::from_secs(90), async {
        if *build_mode == BuildMode::Auto
            && build_command.is_none()
            && start_command.is_none()
            && source.exists(dockerfile).await?
        {
            return Ok(BuildPlan::Dockerfile {
                path: dockerfile.clone(),
            });
        }
        // Match BuildKit's supported lowercase Dockerfile spelling.
        if *build_mode == BuildMode::Auto
            && build_command.is_none()
            && start_command.is_none()
            && let Some(prefix) = dockerfile.strip_suffix("Dockerfile")
        {
            let lower = format!("{prefix}dockerfile");
            if source.exists(&lower).await? {
                return Ok(BuildPlan::Dockerfile { path: lower });
            }
        }
        if !build_args.is_empty() || build_target.is_some() {
            return Err(Error::Detection("dockerfile_required_for_build_options"));
        }
        let path = |file: &str| {
            if context == "." {
                file.to_string()
            } else {
                format!("{context}/{file}")
            }
        };
        let package = source
            .read(&path("package.json"), 256 * 1024)
            .await?
            .ok_or(Error::Detection("auto_language_unsupported"))?;
        let package: Value = serde_json::from_slice(&package)
            .map_err(|_| Error::Detection("auto_package_invalid"))?;
        let mut managers = BTreeSet::new();
        for (lock, manager) in LOCKS {
            if source.exists(&path(lock)).await? {
                managers.insert(manager.to_string());
            }
        }
        let mut versions = Vec::new();
        for file in [".node-version", ".nvmrc"] {
            if let Some(bytes) = source.read(&path(file), 256).await? {
                versions.push(
                    String::from_utf8(bytes)
                        .map_err(|_| Error::Detection("auto_runtime_unsupported"))?,
                );
            }
        }
        let ignore = source
            .read(&path(".dockerignore"), 16 * 1024)
            .await?
            .unwrap_or_default();
        let ignore =
            String::from_utf8(ignore).map_err(|_| Error::Detection("auto_source_unavailable"))?;
        generate_with_commands(
            &package,
            &managers,
            &versions,
            &ignore,
            *port,
            build_command.as_deref(),
            start_command.as_deref(),
        )
    })
    .await
    .map_err(|_| Error::Detection("auto_source_unavailable"))?
}

enum Source {
    Local(std::path::PathBuf),
    Remote(PublicSource),
}
impl Source {
    async fn exists(&self, path: &str) -> Result<bool, Error> {
        match self {
            Self::Local(root) => Ok(root.join(path).is_file()),
            Self::Remote(source) => source.exists(path).await,
        }
    }
    async fn read(&self, path: &str, limit: usize) -> Result<Option<Vec<u8>>, Error> {
        match self {
            Self::Local(root) => {
                let path = root.join(path);
                if !path.exists() {
                    return Ok(None);
                }
                crate::read_bounded(&path, limit)
                    .await
                    .map(Some)
                    .map_err(|_| Error::UploadedSource)
            }
            Self::Remote(source) => source.read(path, limit).await,
        }
    }
}
struct PublicSource {
    client: Client,
    base: url::Url,
}
impl PublicSource {
    fn new(config: &Config, request: &Request) -> Result<Self, Error> {
        let repo = config.repository(&request.spec)?;
        // Provider-specific metadata inspection; never use arbitrary raw-content URLs.
        if repo.host_str() != Some("github.com") {
            return Err(Error::Detection("auto_provider_unsupported"));
        }
        let parts: Vec<_> = repo.path().trim_matches('/').split('/').collect();
        if parts.len() != 2
            || parts.iter().any(|s| {
                s.is_empty()
                    || !s
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
            })
        {
            return Err(Error::Repository);
        }
        let commit = request
            .spec
            .source
            .commit
            .as_deref()
            .ok_or(Error::ReferenceLookup)?;
        let base = url::Url::parse(&format!(
            "https://raw.githubusercontent.com/{}/{}/{commit}/",
            parts[0],
            parts[1].trim_end_matches(".git")
        ))
        .map_err(|_| Error::Repository)?;
        let client = Client::builder()
            .https_only(true)
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(15))
            .user_agent("local-paas-build-inspection/1")
            .build()
            .map_err(|_| Error::Client)?;
        Ok(Self { client, base })
    }
    fn url(&self, path: &str) -> Result<url::Url, Error> {
        // Encode path components rather than allowing query/fragment/URL injection.
        let mut url = self.base.clone();
        let mut segments = url.path_segments_mut().map_err(|_| Error::Repository)?;
        segments.pop_if_empty();
        for part in path.split('/') {
            segments.push(part);
        }
        drop(segments);
        Ok(url)
    }
    async fn exists(&self, path: &str) -> Result<bool, Error> {
        let response = self
            .client
            .head(self.url(path)?)
            .send()
            .await
            .map_err(|_| Error::Detection("auto_source_unavailable"))?;
        match response.status() {
            StatusCode::OK => Ok(true),
            StatusCode::NOT_FOUND => Ok(false),
            _ => Err(Error::Detection("auto_source_unavailable")),
        }
    }
    async fn read(&self, path: &str, limit: usize) -> Result<Option<Vec<u8>>, Error> {
        let mut response = self
            .client
            .get(self.url(path)?)
            .send()
            .await
            .map_err(|_| Error::Detection("auto_source_unavailable"))?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if response.status() != StatusCode::OK
            || response.content_length().is_some_and(|n| n > limit as u64)
        {
            return Err(Error::Detection("auto_source_unavailable"));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| Error::Detection("auto_source_unavailable"))?
        {
            if bytes.len() + chunk.len() > limit {
                return Err(Error::Detection("auto_source_unavailable"));
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(Some(bytes))
    }
}

fn satisfies(version: &str, range: &str) -> bool {
    let range = range.trim().trim_start_matches('v');
    match (version.parse::<Version>(), range.parse::<Range>()) {
        (Ok(version), Ok(range)) => version.satisfies(&range),
        _ => false,
    }
}
fn script(package: &Value, name: &str) -> Result<bool, Error> {
    match package.get("scripts").and_then(|v| v.get(name)) {
        None => Ok(false),
        Some(Value::String(s)) if !s.trim().is_empty() => Ok(true),
        _ => Err(Error::Detection("auto_package_invalid")),
    }
}
fn exact_version(value: &str) -> bool {
    let parts: Vec<_> = value.split('.').collect();
    parts.len() == 3
        && value.len() <= 32
        && parts
            .iter()
            .all(|s| !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit()))
}

fn generate_with_commands(
    package: &Value,
    locks: &BTreeSet<String>,
    versions: &[String],
    ignore: &str,
    port: Option<u16>,
    build_override: Option<&str>,
    start_override: Option<&str>,
) -> Result<BuildPlan, Error> {
    if !package.is_object() {
        return Err(Error::Detection("auto_package_invalid"));
    }
    if package.get("workspaces").is_some() {
        return Err(Error::Detection("auto_workspace_unsupported"));
    }
    if start_override.is_none() && !script(package, "start")? {
        return Err(Error::Detection("auto_start_missing"));
    }
    let build = if build_override.is_some() {
        false
    } else {
        script(package, "build")?
    };
    if locks.len() > 1 {
        return Err(Error::Detection("auto_package_manager_conflict"));
    }
    let manager = locks
        .first()
        .ok_or(Error::Detection("auto_lockfile_missing"))?
        .as_str();
    let mut manager_version = match manager {
        "npm" => None,
        "pnpm" => Some("12.15.0"),
        "yarn" => Some("1.22.22"),
        "bun" => Some(BUN_VERSION),
        _ => return Err(Error::Detection("auto_package_manager_conflict")),
    };
    if let Some(declared) = package.get("packageManager") {
        let declared = declared
            .as_str()
            .ok_or(Error::Detection("auto_package_invalid"))?;
        let (name, version) = declared
            .split_once('@')
            .ok_or(Error::Detection("auto_package_manager_conflict"))?;
        // Corepack integrity suffix is metadata, not part of the npm version.
        let version = version.split('+').next().unwrap_or("");
        if name != manager || !exact_version(version) {
            return Err(Error::Detection("auto_package_manager_conflict"));
        }
        manager_version = Some(version);
    }
    let engines = package.get("engines");
    let node_range = engines.and_then(|v| v.get("node"));
    let bun_range = engines.and_then(|v| v.get("bun"));
    let (runtime, image, run) = if manager == "bun" {
        if manager_version != Some(BUN_VERSION)
            || !versions.is_empty()
            || bun_range.is_some_and(|r| !r.as_str().is_some_and(|r| satisfies(BUN_VERSION, r)))
        {
            return Err(Error::Detection("auto_runtime_unsupported"));
        }
        (format!("Bun {BUN_VERSION}"), BUN_IMAGE, "bun run --bun")
    } else {
        if bun_range.is_some() {
            return Err(Error::Detection("auto_runtime_unsupported"));
        }
        let (version, image) = NODE
            .iter()
            .find(|(v, _)| {
                node_range.is_none_or(|r| r.as_str().is_some_and(|r| satisfies(v, r)))
                    && versions
                        .iter()
                        .all(|r| matches!(r.trim(), "node" | "lts/*") || satisfies(v, r))
            })
            .ok_or(Error::Detection("auto_runtime_unsupported"))?;
        (
            format!("Node {version}"),
            *image,
            match manager {
                "pnpm" => "pnpm run",
                "yarn" => "yarn run",
                _ => "npm run",
            },
        )
    };
    let setup = match (manager, manager_version) {
        ("npm", Some(v)) => format!("RUN npm install --global npm@{v}\n"),
        ("pnpm", Some(v)) => format!("RUN npm install --global pnpm@{v}\n"),
        ("yarn", Some(v)) if v.starts_with("1.") => {
            format!("RUN npm install --global --force yarn@{v}\n")
        }
        ("yarn", Some(v)) => format!("RUN npm install --global --force @yarnpkg/cli-dist@{v}\n"),
        _ => String::new(),
    };
    let install = match manager {
        "npm" => "npm ci --include=dev --no-audit --no-fund",
        "pnpm" => "pnpm install --frozen-lockfile",
        "yarn" if manager_version.is_some_and(|v| v.starts_with("1.")) => {
            "yarn install --frozen-lockfile --non-interactive"
        }
        "yarn" => "yarn install --immutable",
        "bun" => "bun install --frozen-lockfile",
        _ => unreachable!(),
    };
    // Never interpolate repository scripts into Dockerfile syntax. The package
    // manager reads scripts inside the isolated build/runtime boundary.
    let command_args = if let Some(command) = start_override {
        vec!["/bin/sh", "-c", command]
    } else {
        run.split_whitespace().chain(["start"]).collect::<Vec<_>>()
    };
    let command = serde_json::to_string(&command_args).map_err(|_| Error::Client)?;
    let build_step = if let Some(command) = build_override {
        format!(
            "RUN {}\n",
            serde_json::to_string(&["/bin/sh", "-c", command]).map_err(|_| Error::Client)?
        )
    } else if build {
        format!("RUN {run} build\n")
    } else {
        String::new()
    };
    let mut dockerignore = ignore
        .lines()
        .filter(|line| !line.trim_start().starts_with('#'))
        .collect::<Vec<_>>()
        .join("\n");
    dockerignore.push_str(EXCLUDES);
    let mut copy_flags = String::new();
    for line in dockerignore.lines() {
        let pattern = line.trim();
        if pattern.is_empty() || pattern == "." {
            continue;
        }
        // Flags stay one literal Dockerfile token: reject unsupported syntax
        // instead of dropping repository exclusions or allowing interpolation.
        if pattern == "!"
            || !pattern
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"-._/!*?[]".contains(&c))
        {
            return Err(Error::Detection("auto_ignore_unsupported"));
        }
        copy_flags.push_str(&format!(" --exclude={pattern}"));
    }
    let http_environment = port
        .map(|p| format!(" HOST=0.0.0.0 HOSTNAME=0.0.0.0 PORT={p}"))
        .unwrap_or_default();
    let expose = port.map(|p| format!("EXPOSE {p}\n")).unwrap_or_default();
    let dockerfile = format!(
        "# Generated by local-paas javascript-v1\nFROM {image} AS base\nUSER root\n{setup}WORKDIR /app\nFROM base AS build\nRUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ && rm -rf /var/lib/apt/lists/*\nCOPY{copy_flags} . .\nRUN test -z \"$(find . -type f \\( -name .env -o -name '.env.*' -o -name .npmrc \\) -print -quit)\"\nRUN {install}\n{build_step}FROM base AS runtime\nENV NODE_ENV=production{http_environment}\nCOPY --from=build --chown=1000:1000 /app /app\nUSER 1000:1000\n{expose}CMD {command}\n"
    );
    Ok(BuildPlan::Generated {
        generator: "javascript-v1".into(),
        runtime,
        package_manager: format!(
            "{manager}{}",
            manager_version
                .map(|v| format!("@{v}"))
                .unwrap_or_else(|| " (bundled)".into())
        ),
        dockerfile,
        dockerignore,
    })
}

#[cfg(test)]
fn generate(
    package: &Value,
    locks: &BTreeSet<String>,
    versions: &[String],
    ignore: &str,
    port: u16,
) -> Result<BuildPlan, Error> {
    generate_with_commands(package, locks, versions, ignore, Some(port), None, None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn npm() -> Value {
        json!({"scripts":{"start":"node server.js","build":"tsc"}})
    }
    fn locks(manager: &str) -> BTreeSet<String> {
        BTreeSet::from([manager.into()])
    }
    fn recipe(plan: BuildPlan) -> String {
        let BuildPlan::Generated { dockerfile, .. } = plan else {
            panic!("not generated")
        };
        dockerfile
    }

    #[test]
    fn npm_installs_builds_and_starts_without_interpolating_scripts() {
        let mut pkg = npm();
        pkg["scripts"]["start"] = json!("node index.js\nFROM malicious:latest");
        let df = recipe(generate(&pkg, &locks("npm"), &[], "", 8080).unwrap());
        assert!(df.contains("npm ci --include=dev"));
        assert!(df.contains("RUN npm run build"));
        assert!(df.contains("CMD [\"npm\",\"run\",\"start\"]"));
        assert!(df.contains("USER 1000:1000\nEXPOSE 8080"));
        assert!(!df.contains("malicious"));
        assert!(df.contains("@sha256:"));
        pkg["scripts"].as_object_mut().unwrap().remove("build");
        assert!(
            !recipe(generate(&pkg, &locks("npm"), &[], "", 3000).unwrap())
                .contains("RUN npm run build")
        );
    }

    #[test]
    fn explicit_commands_override_scripts_and_are_json_encoded() {
        let pkg = json!({"name":"custom-app"});
        let build = "echo 'quoted'\nprintf built > built";
        let start = "node dist/server.js --port \"$PORT\"";
        let df = recipe(
            generate_with_commands(
                &pkg,
                &locks("npm"),
                &[],
                "",
                Some(3000),
                Some(build),
                Some(start),
            )
            .unwrap(),
        );
        let build_args: Vec<String> = serde_json::from_str(
            df.lines()
                .find_map(|l| l.strip_prefix("RUN [").map(|v| format!("[{v}")))
                .unwrap()
                .as_str(),
        )
        .unwrap();
        assert_eq!(build_args, ["/bin/sh", "-c", build]);
        let start_args: Vec<String> =
            serde_json::from_str(df.lines().find_map(|l| l.strip_prefix("CMD ")).unwrap()).unwrap();
        assert_eq!(start_args, ["/bin/sh", "-c", start]);
        assert!(!df.contains("RUN npm run build"));
    }

    #[test]
    fn generated_worker_keeps_start_command_without_http_environment() {
        let df = recipe(
            generate_with_commands(&npm(), &locks("npm"), &[], "", None, None, None).unwrap(),
        );
        assert!(df.contains("CMD [\"npm\",\"run\",\"start\"]"));
        assert!(!df.contains("EXPOSE"));
        assert!(!df.contains("PORT="));
    }

    #[test]
    fn package_managers_use_frozen_installs_and_exact_tool_versions() {
        for (manager, version, install, start) in [
            (
                "pnpm",
                "10.20.0",
                "pnpm install --frozen-lockfile",
                "[\"pnpm\",\"run\",\"start\"]",
            ),
            (
                "yarn",
                "1.22.22",
                "yarn install --frozen-lockfile",
                "[\"yarn\",\"run\",\"start\"]",
            ),
            (
                "yarn",
                "4.9.2",
                "yarn install --immutable",
                "[\"yarn\",\"run\",\"start\"]",
            ),
            (
                "bun",
                BUN_VERSION,
                "bun install --frozen-lockfile",
                "[\"bun\",\"run\",\"--bun\",\"start\"]",
            ),
        ] {
            let mut pkg = npm();
            pkg["packageManager"] = json!(format!("{manager}@{version}"));
            let df = recipe(generate(&pkg, &locks(manager), &[], "", 3000).unwrap());
            assert!(df.contains(install));
            assert!(df.contains(start));
            if manager == "yarn" && version.starts_with('4') {
                assert!(df.contains("@yarnpkg/cli-dist@4.9.2"));
            }
        }
    }

    #[test]
    fn ambiguous_or_incomplete_apps_get_actionable_failures() {
        let mut pkg = npm();
        pkg["scripts"].as_object_mut().unwrap().remove("start");
        assert_eq!(
            generate(&pkg, &locks("npm"), &[], "", 3000)
                .unwrap_err()
                .code(),
            "auto_start_missing"
        );
        assert_eq!(
            generate(&npm(), &BTreeSet::new(), &[], "", 3000)
                .unwrap_err()
                .code(),
            "auto_lockfile_missing"
        );
        assert_eq!(
            generate(
                &npm(),
                &BTreeSet::from(["npm".into(), "bun".into()]),
                &[],
                "",
                3000
            )
            .unwrap_err()
            .code(),
            "auto_package_manager_conflict"
        );
        for declaration in ["pnpm@10.20.0", "npm@latest", "npm@1.2.3\nRUN evil"] {
            let mut pkg = npm();
            pkg["packageManager"] = json!(declaration);
            assert_eq!(
                generate(&pkg, &locks("npm"), &[], "", 3000)
                    .unwrap_err()
                    .code(),
                "auto_package_manager_conflict"
            );
        }
        let mut pkg = npm();
        pkg["workspaces"] = json!(["packages/*"]);
        assert_eq!(
            generate(&pkg, &locks("npm"), &[], "", 3000)
                .unwrap_err()
                .code(),
            "auto_workspace_unsupported"
        );
    }

    #[test]
    fn declared_runtime_constraints_are_respected() {
        let mut pkg = npm();
        pkg["engines"] = json!({"node":"^22"});
        assert!(recipe(generate(&pkg, &locks("npm"), &[], "", 3000).unwrap()).contains("node:22."));
        assert_eq!(
            generate(&pkg, &locks("npm"), &["24".into()], "", 3000)
                .unwrap_err()
                .code(),
            "auto_runtime_unsupported"
        );
        pkg["engines"]["node"] = json!(">=16 <20");
        assert!(generate(&pkg, &locks("npm"), &[], "", 3000).is_err());
        assert!(
            recipe(generate(&npm(), &locks("npm"), &["v22".into()], "", 3000).unwrap())
                .contains("node:22.")
        );
    }

    #[test]
    fn repository_exclusions_cannot_reinclude_dotenv_or_credentials() {
        let plan = generate(
            &npm(),
            &locks("npm"),
            &[],
            "# comment\ncoverage\n!.env\n!.npmrc",
            3000,
        )
        .unwrap();
        let BuildPlan::Generated {
            dockerignore,
            dockerfile,
            ..
        } = plan
        else {
            unreachable!()
        };
        assert!(dockerignore.starts_with("coverage\n!.env\n!.npmrc"));
        assert!(dockerignore.ends_with(EXCLUDES));
        assert!(dockerignore.contains("**/.env.*"));
        assert!(dockerfile.contains("COPY --exclude=coverage --exclude=!.env --exclude=!.npmrc"));
        assert!(dockerfile.contains("--exclude=**/.env.*"));
        for invalid in ["foo bar", "${HOME}", "foo\\bar", "!"] {
            assert_eq!(
                generate(&npm(), &locks("npm"), &[], invalid, 3000)
                    .unwrap_err()
                    .code(),
                "auto_ignore_unsupported"
            );
        }
    }

    #[tokio::test]
    #[ignore = "requires .local/builder.env, the isolated builder VM and public GitHub"]
    async fn generated_recipe_excludes_dotenv_from_remote_git() {
        use crate::prepare_recipe;
        use std::process::Stdio;
        use tokio::process::Command;
        let config = Config::from_env().unwrap();
        let temp = tempfile::tempdir_in("/dev/shm").unwrap();
        let mut spec: platform_domain::ServiceSpec =
            serde_json::from_str(include_str!("../../../examples/build-canary.json")).unwrap();
        // This public, pinned fixture contains a tracked .env. Never read it:
        // the generated COPY and subsequent absence check must exclude it.
        spec.source.repository = "https://github.com/fish-lgbt/studio".into();
        spec.source
            .pin("ef4437b04f0d070f75cfdfb8711192ec502f9939".into());
        if let Workload::OciService { context, .. } = &mut spec.workload {
            *context = ".".into();
        }
        let request = crate::Request {
            build_id: uuid::Uuid::now_v7(),
            service_id: uuid::Uuid::now_v7(),
            spec,
            no_cache: true,
            local_context: None,
        };
        let mut plan = generate(&npm(), &locks("npm"), &[], "!.env", 3000).unwrap();
        if let BuildPlan::Generated { dockerfile, .. } = &mut plan {
            // Test the production source-copy path without running this app's
            // install/build scripts or publishing a diagnostic image.
            dockerfile.truncate(dockerfile.find("RUN npm ci").unwrap());
            dockerfile
                .push_str("RUN test -f package.json && echo remote-context-exclusions-verified\n");
        }
        let mut args = config
            .arguments(&request, &temp.path().join("metadata.json"))
            .unwrap();
        prepare_recipe(&plan, temp.path(), &mut args).await.unwrap();
        let output_index = args.iter().position(|a| a == "--output").unwrap();
        args.drain(output_index..output_index + 2);
        let output = tokio::time::timeout(
            Duration::from_secs(180),
            Command::new(&config.binary)
                .args(args)
                .env_clear()
                .env("HOME", temp.path())
                .env("DOCKER_CONFIG", temp.path())
                .stdin(Stdio::null())
                .kill_on_drop(true)
                .output(),
        )
        .await
        .unwrap()
        .unwrap();
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(output.status.success(), "{stderr}");
        assert!(
            stderr.contains("remote-context-exclusions-verified"),
            "{stderr}"
        );
    }

    #[tokio::test]
    #[ignore = "requires .local/builder.env and the isolated builder VM"]
    async fn generated_recipe_builds_and_runs_without_dotenv_or_host_context() {
        use crate::{prepare_recipe, read_bounded};
        use std::process::Stdio;
        use tokio::process::Command;
        let config = Config::from_env().unwrap();
        let temp = tempfile::tempdir_in("/dev/shm").unwrap();
        let context = temp.path().join("synthetic-app");
        tokio::fs::create_dir(&context).await.unwrap();
        let package = json!({"name":"generated-build-test","version":"1.0.0","scripts":{
            "build":"node -e \"const fs=require('fs'); for(const p of ['.env','.env.local','.npmrc','nested/.env']) if(fs.existsSync(p)) throw Error('excluded file copied'); fs.writeFileSync('built','ok')\"",
            "start":"node -e \"if(process.getuid()!==1000)throw Error('not nonroot');if(require('fs').readFileSync('built','utf8')!=='ok')throw Error('missing build');console.log('generated-app-started')\""
        }});
        tokio::fs::write(context.join("package.json"), package.to_string())
            .await
            .unwrap();
        tokio::fs::write(context.join("package-lock.json"),r#"{"name":"generated-build-test","version":"1.0.0","lockfileVersion":3,"packages":{"":{"name":"generated-build-test","version":"1.0.0"}}}"#).await.unwrap();
        tokio::fs::create_dir(context.join("nested")).await.unwrap();
        for path in [".env", ".env.local", ".npmrc", "nested/.env"] {
            tokio::fs::write(context.join(path), "SYNTHETIC_DO_NOT_COPY=canary")
                .await
                .unwrap();
        }
        let mut plan = generate_with_commands(
            &package,
            &locks("npm"),
            &[],
            "!.env\n!.npmrc",
            Some(3000),
            Some("npm run build && printf override > custom-build"),
            Some("npm run start && test \"$(cat custom-build)\" = override"),
        )
        .unwrap();
        if let BuildPlan::Generated { dockerfile, .. } = &mut plan {
            dockerfile.push_str("RUN [\"/bin/sh\",\"-c\",\"npm run start && test \\\"$(cat custom-build)\\\" = override\"]\n");
        }
        let request = crate::Request {
            build_id: uuid::Uuid::now_v7(),
            service_id: uuid::Uuid::now_v7(),
            spec: serde_json::from_str(include_str!("../../../examples/build-canary.json"))
                .unwrap(),
            no_cache: true,
            local_context: None,
        };
        let metadata = temp.path().join("metadata.json");
        let mut args = config.arguments(&request, &metadata).unwrap();
        prepare_recipe(&plan, temp.path(), &mut args).await.unwrap();
        // Only this explicit diagnostic forwards a disposable synthetic context.
        // Product builds still use the remote commit-addressed Git context.
        let mut filtered = Vec::new();
        let mut i = 0;
        while i < args.len() {
            if args[i] == "--opt"
                && (args[i + 1].starts_with("context=")
                    || args[i + 1].starts_with("contextsubdir="))
            {
                i += 2;
            } else {
                filtered.push(args[i].clone());
                i += 1;
            }
        }
        filtered.extend(["--local".into(), format!("context={}", context.display())]);
        let output = tokio::time::timeout(
            Duration::from_secs(180),
            Command::new(&config.binary)
                .args(filtered)
                .env_clear()
                .env("HOME", temp.path())
                .env("DOCKER_CONFIG", temp.path())
                .stdin(Stdio::null())
                .kill_on_drop(true)
                .output(),
        )
        .await
        .unwrap()
        .unwrap();
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(output.status.success(), "{stderr}");
        assert!(stderr.contains("generated-app-started"), "{stderr}");
        let metadata: Value =
            serde_json::from_slice(&read_bounded(&metadata, 65536).await.unwrap()).unwrap();
        assert!(
            metadata["containerimage.digest"]
                .as_str()
                .unwrap()
                .starts_with("sha256:")
        );
    }
}
