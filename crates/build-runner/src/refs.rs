use crate::{Config, Error};
use platform_domain::{ServiceSpec, commit_hash};
use std::{process::Stdio, time::Duration};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
};

/// Fetch ref advertisements only. No clone, checkout, hooks, or source execution
/// occurs on the controller host. Dockerfiles still run entirely inside the VM.
pub async fn resolve_commit(config: &Config, spec: &ServiceSpec) -> Result<String, Error> {
    let repository = config.repository(spec)?;
    if let Some(commit) = &spec.source.commit {
        return Ok(commit.clone());
    }
    let reference = if let Some(branch) = &spec.source.branch {
        format!("refs/heads/{branch}")
    } else if let Some(tag) = &spec.source.tag {
        format!("refs/tags/{tag}")
    } else {
        return Err(Error::ReferenceLookup);
    };
    let binary = config
        .git_binary
        .as_ref()
        .filter(|p| p.is_absolute() && p.is_file())
        .ok_or(Error::Config(
            "BUILD_GIT_PATH must name an absolute Git executable",
        ))?;
    let temp = tempfile::tempdir_in("/dev/shm").map_err(|_| Error::Client)?;
    let mut command = Command::new(binary);
    command
        .env_clear()
        .env("HOME", temp.path())
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_SSL_CAINFO", "/etc/ssl/certs/ca-certificates.crt")
        .current_dir(temp.path())
        .args([
            "-c",
            "credential.helper=",
            "-c",
            "http.followRedirects=false",
            "-c",
            "protocol.allow=never",
            "-c",
            "protocol.https.allow=always",
            "ls-remote",
            "--exit-code",
            "--",
            repository.as_str(),
            &reference,
        ]);
    if spec.source.tag.is_some() {
        command.arg(format!("{reference}^{{}}"));
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| Error::ReferenceLookup)?;
    let stdout = child.stdout.take().ok_or(Error::ReferenceLookup)?;
    let stderr = child.stderr.take().ok_or(Error::ReferenceLookup)?;
    let result = tokio::time::timeout(Duration::from_secs(30), async {
        tokio::try_join!(bounded(stdout), bounded(stderr), async {
            child.wait().await.map_err(|_| Error::ReferenceLookup)
        })
    })
    .await
    .map_err(|_| Error::ReferenceLookup)??;
    if result.2.code() == Some(2) {
        return Err(Error::ReferenceMissing);
    }
    if !result.2.success() {
        return Err(Error::ReferenceLookup);
    }
    parse_ref(&result.0, &reference, spec.source.tag.is_some())
}

async fn bounded(stream: impl AsyncRead + Unpin) -> Result<Vec<u8>, Error> {
    let mut bytes = Vec::new();
    stream
        .take(65537)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| Error::ReferenceLookup)?;
    if bytes.len() > 65536 {
        return Err(Error::ReferenceLookup);
    }
    Ok(bytes)
}

fn parse_ref(output: &[u8], reference: &str, tag: bool) -> Result<String, Error> {
    let text = std::str::from_utf8(output).map_err(|_| Error::ReferenceLookup)?;
    let mut direct: Option<String> = None;
    let mut peeled: Option<String> = None;
    for line in text.lines() {
        let Some((hash, name)) = line.split_once('\t') else {
            return Err(Error::ReferenceLookup);
        };
        let target = if name == reference {
            &mut direct
        } else if tag && name == format!("{reference}^{{}}") {
            &mut peeled
        } else {
            continue;
        };
        if !commit_hash(hash) || target.as_ref().is_some_and(|old| old != hash) {
            return Err(Error::ReferenceLookup);
        }
        *target = Some(hash.into());
    }
    if direct.is_none() {
        return Err(Error::ReferenceMissing);
    }
    peeled.or(direct).ok_or(Error::ReferenceMissing)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn branches_and_lightweight_tags_match_exact_names() {
        let hash = "a".repeat(40);
        for reference in ["refs/heads/feature/forms", "refs/tags/v1.0"] {
            assert_eq!(
                parse_ref(
                    format!("{hash}\t{reference}\n").as_bytes(),
                    reference,
                    reference.starts_with("refs/tags/")
                )
                .unwrap(),
                hash
            );
        }
        assert!(matches!(
            parse_ref(
                format!("{hash}\trefs/heads/not-main\n").as_bytes(),
                "refs/heads/main",
                false
            ),
            Err(Error::ReferenceMissing)
        ));
    }
    #[test]
    fn annotated_tags_use_the_peeled_commit() {
        let object = "a".repeat(40);
        let commit = "b".repeat(40);
        let data = format!("{object}\trefs/tags/v1\n{commit}\trefs/tags/v1^{{}}\n");
        assert_eq!(
            parse_ref(data.as_bytes(), "refs/tags/v1", true).unwrap(),
            commit
        );
    }
    #[test]
    fn inconsistent_or_invalid_advertisements_fail_closed() {
        assert!(parse_ref(b"nonsense\trefs/heads/main\n", "refs/heads/main", false).is_err());
        let data = format!(
            "{}\trefs/heads/main\n{}\trefs/heads/main\n",
            "a".repeat(40),
            "b".repeat(40)
        );
        assert!(parse_ref(data.as_bytes(), "refs/heads/main", false).is_err());
    }
}
