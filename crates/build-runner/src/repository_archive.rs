use crate::{Config, Error, GitAuthToken};
use platform_domain::ServiceSpec;
use reqwest::{Client, StatusCode, header};
use std::time::Duration;

/// Download one immutable GitHub ZIP under strict redirect and size policy,
/// then validate and extract it for non-executing build-plan inspection.
pub async fn verified_github_context(
    config: &Config,
    spec: &ServiceSpec,
    token: Option<&GitAuthToken>,
) -> Result<tempfile::TempDir, Error> {
    let repository = config.repository(spec)?;
    if repository.host_str() != Some("github.com") {
        return Err(Error::Repository);
    }
    let parts: Vec<_> = repository.path().trim_matches('/').split('/').collect();
    if parts.len() != 2 {
        return Err(Error::Repository);
    }
    let owner = parts[0];
    let name = parts[1].trim_end_matches(".git");
    let commit = spec
        .source
        .commit
        .as_deref()
        .filter(|value| platform_domain::commit_hash(value))
        .ok_or(Error::ReferenceLookup)?;
    let mut endpoint =
        url::Url::parse("https://api.github.com/repos/").map_err(|_| Error::Repository)?;
    endpoint
        .path_segments_mut()
        .map_err(|_| Error::Repository)?
        .extend([owner, name, "zipball", commit]);
    let client = Client::builder()
        .https_only(true)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(60))
        .user_agent("local-paas-source-validator/1")
        .build()
        .map_err(|_| Error::Client)?;
    let mut request = client
        .get(endpoint)
        .header(header::ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2026-03-10");
    if let Some(token) = token {
        request = request.bearer_auth(token.expose());
    }
    let response = request.send().await.map_err(|_| Error::SourceArchive)?;
    if matches!(
        response.status(),
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
    ) {
        return Err(Error::SourceAuthentication);
    }
    if response.status() != StatusCode::FOUND {
        return Err(Error::SourceArchive);
    }
    let location = response
        .headers()
        .get(header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .ok_or(Error::SourceArchive)?;
    let location = validate_redirect(location)?;
    let mut response = client
        .get(location)
        .send()
        .await
        .map_err(|_| Error::SourceArchive)?;
    if response.status() != StatusCode::OK
        || response
            .content_length()
            .is_some_and(|size| size > platform_sources::ARCHIVE_LIMIT as u64)
    {
        return Err(Error::SourceArchive);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| Error::SourceArchive)? {
        if bytes.len() + chunk.len() > platform_sources::ARCHIVE_LIMIT {
            return Err(Error::SourceArchive);
        }
        bytes.extend_from_slice(&chunk);
    }
    let directory = tempfile::tempdir_in("/dev/shm").map_err(|_| Error::Client)?;
    let path = directory.path().to_owned();
    tokio::task::spawn_blocking(move || {
        platform_sources::inspect_repository_archive(&bytes, Some(&path))
            .map_err(|_| Error::SourceArchive)
    })
    .await
    .map_err(|_| Error::SourceArchive)??;
    Ok(directory)
}

fn validate_redirect(value: &str) -> Result<url::Url, Error> {
    let url = url::Url::parse(value).map_err(|_| Error::SourceArchive)?;
    if url.scheme() != "https"
        || url.host_str() != Some("codeload.github.com")
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(Error::SourceArchive);
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redirects_are_limited_to_github_codeload_https() {
        assert!(
            validate_redirect("https://codeload.github.com/o/r/legacy.zip/abc?token=x").is_ok()
        );
        for value in [
            "http://codeload.github.com/o/r.zip",
            "https://127.0.0.1/source.zip",
            "https://codeload.github.com.evil.test/source.zip",
            "https://user@codeload.github.com/source.zip",
            "https://codeload.github.com:444/source.zip",
        ] {
            assert!(validate_redirect(value).is_err(), "{value}");
        }
    }
}
