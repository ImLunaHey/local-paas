//! Provider-neutral source policy with a GitHub webhook adapter.
//!
//! Webhook credentials live in OpenBao. Deliveries retain only bounded metadata
//! and a body digest, never signatures, credentials, or complete payloads.
use crate::{ApiError, auth, builds, secrets::Bao};
use axum::{
    Extension, Json,
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
};
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::collections::BTreeSet;
use std::time::Duration;
use url::Url;
use utoipa::ToSchema;
use uuid::Uuid;
use zeroize::Zeroizing;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SourceConnection {
    pub id: Uuid,
    pub service_id: Uuid,
    pub organization_id: String,
    pub provider: String,
    pub repository: String,
    #[serde(skip)]
    pub repository_key: String,
    #[serde(skip)]
    pub secret_path: String,
    pub events: Vec<String>,
    pub enabled: bool,
    pub github_app_id: Option<i64>,
    pub github_installation_id: Option<i64>,
    pub authentication_status: String,
    pub authentication_error: Option<String>,
    pub last_authenticated_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub last_delivery_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, sqlx::FromRow, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WebhookDelivery {
    pub id: Uuid,
    pub source_connection_id: Uuid,
    pub delivery_id: String,
    pub event: String,
    pub action: Option<String>,
    pub source_ref: Option<String>,
    pub resolved_commit: Option<String>,
    pub status: String,
    pub reason: String,
    #[serde(skip)]
    pub body_sha256: String,
    pub build_id: Option<Uuid>,
    pub received_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct CreateSourceConnection {
    pub service_id: Uuid,
    /// GitHub `owner/repository` identity or its credential-free HTTPS URL.
    pub repository: String,
    /// Shared GitHub webhook secret. It is written to OpenBao and never returned.
    pub webhook_secret: String,
    /// Any combination of `push`, `tag`, and `pull_request`.
    pub events: Vec<String>,
    /// GitHub App ID. Supply all three GitHub App fields for private access.
    pub github_app_id: Option<i64>,
    /// Repository installation ID for this app.
    pub github_installation_id: Option<i64>,
    /// PEM-encoded GitHub App private key. Stored only in OpenBao.
    pub github_private_key: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RotateGitHubKey {
    /// Replacement PEM-encoded GitHub App private key.
    pub github_private_key: String,
}

#[utoipa::path(
    get,
    path = "/api/source-connections",
    responses((status = 200, body = [SourceConnection]))
)]
pub(crate) async fn list(
    State(pool): State<PgPool>,
    Extension(context): Extension<auth::Context>,
) -> Result<Json<Vec<SourceConnection>>, ApiError> {
    let rows = sqlx::query_as(
        "SELECT * FROM source_connections WHERE ($1::text IS NULL OR organization_id=$1) ORDER BY created_at DESC,id DESC",
    )
    .bind(context.organization_id.as_deref())
    .fetch_all(&pool)
    .await?;
    Ok(Json(rows))
}

#[utoipa::path(
    post,
    path = "/api/source-connections",
    request_body = CreateSourceConnection,
    responses((status = 201, body = SourceConnection), (status = 409, body = crate::openapi::ErrorResponse))
)]
pub(crate) async fn create(
    State(pool): State<PgPool>,
    Extension(context): Extension<auth::Context>,
    Json(input): Json<CreateSourceConnection>,
) -> Result<(StatusCode, Json<SourceConnection>), ApiError> {
    let organization_id = auth::required_organization(&context)?.to_owned();
    let (repository, repository_key) = canonical_repository(&input.repository)?;
    let events = validate_events(input.events)?;
    if !(32..=512).contains(&input.webhook_secret.len()) || input.webhook_secret.contains('\0') {
        return Err(ApiError::Conflict(
            "webhook secret must contain between 32 and 512 bytes",
        ));
    }
    validate_github_app(
        input.github_app_id,
        input.github_installation_id,
        input.github_private_key.as_deref(),
    )?;
    let managed: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM pull_request_previews WHERE service_id=$1)",
    )
    .bind(input.service_id)
    .fetch_one(&pool)
    .await?;
    if managed {
        return Err(ApiError::Conflict(
            "PR previews use their parent source connection",
        ));
    }
    let service_repository: String = sqlx::query_scalar(
        "SELECT s.spec->'source'->>'repository' FROM services s JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id WHERE s.id=$1 AND p.organization_id=$2",
    )
    .bind(input.service_id)
    .bind(&organization_id)
    .fetch_optional(&pool)
    .await?
    .ok_or(ApiError::NotFound)?;
    let (_, service_repository_key) = canonical_repository(&service_repository)?;
    if service_repository_key != repository_key {
        return Err(ApiError::Conflict(
            "source connection repository must match the service repository",
        ));
    }

    let id = Uuid::now_v7();
    let secret_path = format!("source-connections/{id}");
    let bao = Bao::new()?;
    bao.create_source_secret(
        &secret_path,
        &input.webhook_secret,
        input.github_private_key.as_deref(),
    )
    .await?;
    let inserted = sqlx::query_as::<_, SourceConnection>(
        "INSERT INTO source_connections(id,service_id,organization_id,provider,repository,repository_key,secret_path,events,github_app_id,github_installation_id,authentication_status) VALUES($1,$2,$3,'github',$4,$5,$6,$7,$8,$9,$10) RETURNING *",
    )
    .bind(id)
    .bind(input.service_id)
    .bind(&organization_id)
    .bind(repository)
    .bind(repository_key)
    .bind(&secret_path)
    .bind(events)
    .bind(input.github_app_id)
    .bind(input.github_installation_id)
    .bind(if input.github_app_id.is_some() {
        "configured"
    } else {
        "public"
    })
    .fetch_one(&pool)
    .await;
    match inserted {
        Ok(connection) => Ok((StatusCode::CREATED, Json(connection))),
        Err(error) => {
            bao.delete_source_secret(&secret_path).await;
            if error
                .as_database_error()
                .is_some_and(|database| database.is_unique_violation())
            {
                Err(ApiError::Conflict(
                    "this service already has a source connection",
                ))
            } else {
                Err(ApiError::from(error))
            }
        }
    }
}

#[utoipa::path(
    put,
    path = "/api/source-connections/{id}/github-key",
    params(("id" = Uuid, Path)),
    request_body = RotateGitHubKey,
    responses((status = 200, body = SourceConnection))
)]
pub(crate) async fn rotate_github_key(
    State(pool): State<PgPool>,
    Extension(context): Extension<auth::Context>,
    Path(id): Path<Uuid>,
    Json(input): Json<RotateGitHubKey>,
) -> Result<Json<SourceConnection>, ApiError> {
    validate_private_key(&input.github_private_key)?;
    let organization_id = auth::required_organization(&context)?;
    let connection: SourceConnection =
        sqlx::query_as("SELECT * FROM source_connections WHERE id=$1 AND organization_id=$2")
            .bind(id)
            .bind(organization_id)
            .fetch_optional(&pool)
            .await?
            .ok_or(ApiError::NotFound)?;
    if connection.github_app_id.is_none() {
        return Err(ApiError::Conflict(
            "this source connection has no GitHub App configuration",
        ));
    }
    Bao::new()?
        .rotate_source_github_private_key(&connection.secret_path, &input.github_private_key)
        .await?;
    let connection = sqlx::query_as(
        "UPDATE source_connections SET authentication_status='configured',authentication_error=NULL WHERE id=$1 RETURNING *",
    )
    .bind(id)
    .fetch_one(&pool)
    .await?;
    Ok(Json(connection))
}

fn validate_github_app(
    app_id: Option<i64>,
    installation_id: Option<i64>,
    private_key: Option<&str>,
) -> Result<(), ApiError> {
    match (app_id, installation_id, private_key) {
        (None, None, None) => Ok(()),
        (Some(app), Some(installation), Some(key)) if app > 0 && installation > 0 => {
            validate_private_key(key)
        }
        _ => Err(ApiError::Conflict(
            "GitHub App ID, installation ID, and private key must be supplied together",
        )),
    }
}

fn validate_private_key(key: &str) -> Result<(), ApiError> {
    if !(512..=32 * 1024).contains(&key.len())
        || key.contains('\0')
        || EncodingKey::from_rsa_pem(key.as_bytes()).is_err()
    {
        return Err(ApiError::Conflict(
            "GitHub App private key must be a valid bounded RSA PEM",
        ));
    }
    Ok(())
}

#[derive(Serialize)]
struct GitHubAppClaims {
    iat: i64,
    exp: i64,
    iss: String,
}

#[derive(Deserialize)]
struct InstallationTokenResponse {
    token: String,
    expires_at: DateTime<Utc>,
    permissions: std::collections::BTreeMap<String, String>,
}

enum MintError {
    Credential,
    Dependency,
}

/// Mint a new repository-scoped installation token for one build. Neither the
/// app key nor token is cached, persisted, returned by the API, or logged.
pub async fn github_build_token(
    pool: &PgPool,
    connection_id: Uuid,
) -> Result<Option<platform_build_runner::GitAuthToken>, platform_build_runner::Error> {
    let connection: SourceConnection =
        sqlx::query_as("SELECT * FROM source_connections WHERE id=$1 AND enabled")
            .bind(connection_id)
            .fetch_optional(pool)
            .await
            .map_err(|_| platform_build_runner::Error::Client)?
            .ok_or(platform_build_runner::Error::SourceAuthentication)?;
    let (Some(app_id), Some(installation_id)) =
        (connection.github_app_id, connection.github_installation_id)
    else {
        return Ok(None);
    };
    let result = mint_installation_token(&connection, app_id, installation_id).await;
    match result {
        Ok(token) => {
            sqlx::query("UPDATE source_connections SET authentication_status='active',authentication_error=NULL,last_authenticated_at=now() WHERE id=$1")
                .bind(connection_id)
                .execute(pool)
                .await
                .map_err(|_| platform_build_runner::Error::Client)?;
            Ok(Some(token))
        }
        Err(error) => {
            let (message, runner_error) = match error {
                MintError::Credential => (
                    "GitHub denied credential exchange; verify the key, installation, repository access, and provider rate limits",
                    platform_build_runner::Error::SourceAuthentication,
                ),
                MintError::Dependency => (
                    "GitHub credential exchange is unavailable; check OpenBao and GitHub connectivity",
                    platform_build_runner::Error::SourceAuthenticationUnavailable,
                ),
            };
            sqlx::query("UPDATE source_connections SET authentication_status='error',authentication_error=$2 WHERE id=$1")
                .bind(connection_id)
                .bind(message)
                .execute(pool)
                .await
                .map_err(|_| platform_build_runner::Error::Client)?;
            Err(runner_error)
        }
    }
}

async fn mint_installation_token(
    connection: &SourceConnection,
    app_id: i64,
    installation_id: i64,
) -> Result<platform_build_runner::GitAuthToken, MintError> {
    let private_key = Zeroizing::new(
        Bao::new()
            .map_err(|_| MintError::Dependency)?
            .source_github_private_key(&connection.secret_path)
            .await
            .map_err(|_| MintError::Dependency)?,
    );
    let now = Utc::now().timestamp();
    let claims = GitHubAppClaims {
        iat: now - 60,
        exp: now + 9 * 60,
        iss: app_id.to_string(),
    };
    let key =
        EncodingKey::from_rsa_pem(private_key.as_bytes()).map_err(|_| MintError::Credential)?;
    let jwt =
        encode(&Header::new(Algorithm::RS256), &claims, &key).map_err(|_| MintError::Credential)?;
    let repository = connection
        .repository
        .split('/')
        .nth(1)
        .ok_or(MintError::Credential)?;
    let client = reqwest::Client::builder()
        .https_only(true)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .user_agent("local-paas-github-app/1")
        .build()
        .map_err(|_| MintError::Dependency)?;
    let response = client
        .post(format!(
            "https://api.github.com/app/installations/{installation_id}/access_tokens"
        ))
        .bearer_auth(jwt)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2026-03-10")
        .header("Content-Type", "application/json")
        .body(
            serde_json::json!({
                "repositories":[repository],
                "permissions":{"contents":"read"}
            })
            .to_string(),
        )
        .send()
        .await
        .map_err(|_| MintError::Dependency)?;
    if !response.status().is_success() {
        return Err(
            if matches!(
                response.status(),
                reqwest::StatusCode::UNAUTHORIZED
                    | reqwest::StatusCode::FORBIDDEN
                    | reqwest::StatusCode::NOT_FOUND
                    | reqwest::StatusCode::UNPROCESSABLE_ENTITY
            ) {
                MintError::Credential
            } else {
                MintError::Dependency
            },
        );
    }
    if response
        .content_length()
        .is_some_and(|size| size > 64 * 1024)
    {
        return Err(MintError::Dependency);
    }
    let body = response.bytes().await.map_err(|_| MintError::Dependency)?;
    if body.len() > 64 * 1024 {
        return Err(MintError::Dependency);
    }
    let response: InstallationTokenResponse =
        serde_json::from_slice(&body).map_err(|_| MintError::Dependency)?;
    if response.expires_at < Utc::now() + chrono::Duration::minutes(5)
        || !matches!(
            response.permissions.get("contents").map(String::as_str),
            Some("read" | "write")
        )
    {
        return Err(MintError::Credential);
    }
    platform_build_runner::GitAuthToken::new(response.token).map_err(|_| MintError::Dependency)
}

#[utoipa::path(
    get,
    path = "/api/source-connections/{id}/deliveries",
    params(("id" = Uuid, Path)),
    responses((status = 200, body = [WebhookDelivery]))
)]
pub(crate) async fn deliveries(
    State(pool): State<PgPool>,
    Extension(context): Extension<auth::Context>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<WebhookDelivery>>, ApiError> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM source_connections WHERE id=$1 AND ($2::text IS NULL OR organization_id=$2))",
    )
    .bind(id)
    .bind(context.organization_id.as_deref())
    .fetch_one(&pool)
    .await?;
    if !exists {
        return Err(ApiError::NotFound);
    }
    let rows = sqlx::query_as(
        "SELECT * FROM webhook_deliveries WHERE source_connection_id=$1 ORDER BY received_at DESC,id DESC LIMIT 100",
    )
    .bind(id)
    .fetch_all(&pool)
    .await?;
    Ok(Json(rows))
}

pub(crate) async fn github_webhook(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<WebhookDelivery>), ApiError> {
    if headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        != Some("application/json")
    {
        return Err(ApiError::Forbidden);
    }
    let event = header_value(&headers, "x-github-event", 64)?;
    let delivery_id = header_value(&headers, "x-github-delivery", 128)?;
    if !delivery_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(ApiError::Forbidden);
    }
    let signature = header_value(&headers, "x-hub-signature-256", 71)?;
    let connection: SourceConnection =
        sqlx::query_as("SELECT * FROM source_connections WHERE id=$1 AND enabled")
            .bind(id)
            .fetch_optional(&pool)
            .await?
            .ok_or(ApiError::NotFound)?;
    let secret = Bao::new()?
        .source_webhook_secret(&connection.secret_path)
        .await?;
    verify_signature(secret.as_bytes(), &body, &signature)?;
    let body_sha256 = format!("{:x}", Sha256::digest(&body));
    let payload: Value = serde_json::from_slice(&body)
        .map_err(|_| ApiError::Conflict("invalid GitHub webhook payload"))?;
    process_delivery(&pool, connection, event, delivery_id, body_sha256, payload).await
}

pub(crate) async fn process_delivery(
    pool: &PgPool,
    connection: SourceConnection,
    event: String,
    delivery_id: String,
    body_sha256: String,
    payload: Value,
) -> Result<(StatusCode, Json<WebhookDelivery>), ApiError> {
    let decision = decide(&connection, &event, &payload)?;

    let mut tx = pool.begin().await?;
    crate::pr_previews::lock(&mut tx).await?;
    sqlx::query("SELECT id FROM source_connections WHERE id=$1 FOR UPDATE")
        .bind(connection.id)
        .execute(&mut *tx)
        .await?;
    if let Some(existing) = sqlx::query_as::<_, WebhookDelivery>(
        "SELECT * FROM webhook_deliveries WHERE source_connection_id=$1 AND delivery_id=$2",
    )
    .bind(connection.id)
    .bind(&delivery_id)
    .fetch_optional(&mut *tx)
    .await?
    {
        if existing.body_sha256 != body_sha256 || existing.event != event {
            return Err(ApiError::Conflict(
                "GitHub delivery ID was already used with different input",
            ));
        }
        tx.commit().await?;
        return Ok((StatusCode::OK, Json(existing)));
    }

    let delivery_row_id = Uuid::now_v7();
    let operation_id = Uuid::now_v7();
    let mut status = decision.status;
    let mut reason = decision.reason;
    let mut build_id = None;
    let preview_decision = if event == "pull_request" {
        crate::pr_previews::receive(&mut tx, &connection, &payload).await?
    } else {
        None
    };
    if let Some((preview_status, preview_reason)) = preview_decision {
        status = preview_status;
        reason = preview_reason;
    }
    if status == "accepted" && preview_decision.is_none() {
        sqlx::query("SELECT id FROM services WHERE id=$1 FOR UPDATE")
            .bind(connection.service_id)
            .execute(&mut *tx)
            .await?;
        let active: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM builds WHERE service_id=$1 AND status IN ('queued','running'))",
        )
        .bind(connection.service_id)
        .fetch_one(&mut *tx)
        .await?;
        if active {
            status = "blocked";
            reason = "service already has a queued or running build";
        } else if let Some(commit) = decision.commit.as_deref() {
            build_id = Some(
                builds::enqueue_pinned(
                    &mut tx,
                    connection.service_id,
                    operation_id,
                    commit,
                    connection.id,
                )
                .await?
                .id,
            );
        }
    }
    let delivery = sqlx::query_as::<_, WebhookDelivery>(
        "INSERT INTO webhook_deliveries(id,source_connection_id,delivery_id,event,action,source_ref,resolved_commit,status,reason,body_sha256,build_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
    )
    .bind(delivery_row_id)
    .bind(connection.id)
    .bind(delivery_id)
    .bind(event)
    .bind(decision.action)
    .bind(decision.source_ref)
    .bind(decision.commit)
    .bind(status)
    .bind(reason)
    .bind(body_sha256)
    .bind(build_id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("UPDATE source_connections SET last_delivery_at=now() WHERE id=$1")
        .bind(connection.id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    let response_status = if delivery.status == "accepted" {
        StatusCode::ACCEPTED
    } else {
        StatusCode::OK
    };
    Ok((response_status, Json(delivery)))
}

struct Decision {
    status: &'static str,
    reason: &'static str,
    action: Option<String>,
    source_ref: Option<String>,
    commit: Option<String>,
}

fn decide(
    connection: &SourceConnection,
    event: &str,
    payload: &Value,
) -> Result<Decision, ApiError> {
    let repository = payload["repository"]["full_name"]
        .as_str()
        .ok_or(ApiError::Conflict(
            "GitHub payload is missing repository identity",
        ))?;
    let (_, repository_key) = canonical_repository(repository)?;
    if repository_key != connection.repository_key {
        return Ok(Decision {
            status: "ignored",
            reason: "payload repository does not match this connection",
            action: None,
            source_ref: None,
            commit: None,
        });
    }
    match event {
        "ping" => Ok(Decision {
            status: "ignored",
            reason: "GitHub ping verified",
            action: None,
            source_ref: None,
            commit: None,
        }),
        "push" => push_decision(connection, payload),
        "pull_request" => pull_request_decision(connection, payload),
        _ => Ok(Decision {
            status: "ignored",
            reason: "event type is not supported",
            action: None,
            source_ref: None,
            commit: None,
        }),
    }
}

fn push_decision(connection: &SourceConnection, payload: &Value) -> Result<Decision, ApiError> {
    let source_ref = payload["ref"]
        .as_str()
        .filter(|value| value.len() <= 512)
        .ok_or(ApiError::Conflict("GitHub push payload has no valid ref"))?;
    if payload["deleted"].as_bool().unwrap_or(false) {
        return Ok(Decision {
            status: "ignored",
            reason: "deleted refs do not start builds",
            action: Some("deleted".into()),
            source_ref: Some(source_ref.into()),
            commit: None,
        });
    }
    let policy = if source_ref.starts_with("refs/heads/") {
        "push"
    } else if source_ref.starts_with("refs/tags/") {
        "tag"
    } else {
        return Ok(Decision {
            status: "ignored",
            reason: "ref namespace is not supported",
            action: None,
            source_ref: Some(source_ref.into()),
            commit: None,
        });
    };
    let commit = payload["after"]
        .as_str()
        .filter(|value| platform_domain::commit_hash(value))
        .ok_or(ApiError::Conflict(
            "GitHub push payload has no full commit hash",
        ))?;
    Ok(policy_decision(
        connection, policy, source_ref, commit, None,
    ))
}

fn pull_request_decision(
    connection: &SourceConnection,
    payload: &Value,
) -> Result<Decision, ApiError> {
    let action = payload["action"]
        .as_str()
        .filter(|value| value.len() <= 64)
        .ok_or(ApiError::Conflict(
            "GitHub pull request payload has no valid action",
        ))?;
    if !matches!(action, "opened" | "synchronize" | "reopened") {
        return Ok(Decision {
            status: "ignored",
            reason: "pull request action does not start a build",
            action: Some(action.into()),
            source_ref: None,
            commit: None,
        });
    }
    let head_repository = payload["pull_request"]["head"]["repo"]["full_name"]
        .as_str()
        .ok_or(ApiError::Conflict(
            "GitHub pull request payload has no head repository",
        ))?;
    let base_repository = payload["pull_request"]["base"]["repo"]["full_name"]
        .as_str()
        .ok_or(ApiError::Conflict(
            "GitHub pull request payload has no base repository",
        ))?;
    if canonical_repository(head_repository)?.1 != canonical_repository(base_repository)?.1 {
        return Ok(Decision {
            status: "ignored",
            reason: "fork pull requests are denied by default",
            action: Some(action.into()),
            source_ref: None,
            commit: None,
        });
    }
    let source_ref = payload["pull_request"]["head"]["ref"]
        .as_str()
        .filter(|value| value.len() <= 512)
        .ok_or(ApiError::Conflict(
            "GitHub pull request payload has no valid head ref",
        ))?;
    let commit = payload["pull_request"]["head"]["sha"]
        .as_str()
        .filter(|value| platform_domain::commit_hash(value))
        .ok_or(ApiError::Conflict(
            "GitHub pull request payload has no full commit hash",
        ))?;
    Ok(policy_decision(
        connection,
        "pull_request",
        source_ref,
        commit,
        Some(action),
    ))
}

fn policy_decision(
    connection: &SourceConnection,
    policy: &str,
    source_ref: &str,
    commit: &str,
    action: Option<&str>,
) -> Decision {
    if connection
        .events
        .iter()
        .any(|configured| configured == policy)
    {
        Decision {
            status: "accepted",
            reason: "event matched source policy",
            action: action.map(str::to_owned),
            source_ref: Some(source_ref.into()),
            commit: Some(commit.into()),
        }
    } else {
        Decision {
            status: "ignored",
            reason: "event is disabled by source policy",
            action: action.map(str::to_owned),
            source_ref: Some(source_ref.into()),
            commit: Some(commit.into()),
        }
    }
}

pub(crate) fn canonical_repository(input: &str) -> Result<(String, String), ApiError> {
    let candidate = if input.contains("://") {
        let url = Url::parse(input).map_err(|_| ApiError::Conflict("invalid GitHub repository"))?;
        if url.scheme() != "https"
            || url.host_str() != Some("github.com")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(ApiError::Conflict(
                "repository must be a credential-free GitHub HTTPS URL",
            ));
        }
        url.path().trim_matches('/').to_owned()
    } else {
        input.trim_matches('/').to_owned()
    };
    let candidate = candidate.strip_suffix(".git").unwrap_or(&candidate);
    let segments: Vec<&str> = candidate.split('/').collect();
    if segments.len() != 2
        || segments.iter().any(|segment| {
            segment.is_empty()
                || segment.len() > 100
                || !segment
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        })
    {
        return Err(ApiError::Conflict(
            "repository must be a GitHub owner/repository identity",
        ));
    }
    let repository = format!("{}/{}", segments[0], segments[1]);
    Ok((repository.clone(), repository.to_ascii_lowercase()))
}

fn validate_events(events: Vec<String>) -> Result<Vec<String>, ApiError> {
    let allowed = ["push", "tag", "pull_request"];
    let unique: BTreeSet<String> = events.into_iter().collect();
    if unique.is_empty()
        || unique.len() > allowed.len()
        || unique
            .iter()
            .any(|event| !allowed.contains(&event.as_str()))
    {
        return Err(ApiError::Conflict(
            "events must contain push, tag, or pull_request",
        ));
    }
    Ok(unique.into_iter().collect())
}

fn header_value(headers: &HeaderMap, name: &'static str, limit: usize) -> Result<String, ApiError> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty() && value.len() <= limit)
        .map(str::to_owned)
        .ok_or(ApiError::Unauthorized)
}

fn verify_signature(secret: &[u8], body: &[u8], signature: &str) -> Result<(), ApiError> {
    let encoded = signature
        .strip_prefix("sha256=")
        .filter(|value| value.len() == 64)
        .ok_or(ApiError::Unauthorized)?;
    let mut expected = [0u8; 32];
    for (index, chunk) in encoded.as_bytes().chunks_exact(2).enumerate() {
        let high = hex_nibble(chunk[0])?;
        let low = hex_nibble(chunk[1])?;
        expected[index] = high * 16 + low;
    }
    let mut mac = HmacSha256::new_from_slice(secret).map_err(|_| ApiError::Unauthorized)?;
    mac.update(body);
    mac.verify_slice(&expected)
        .map_err(|_| ApiError::Unauthorized)
}

fn hex_nibble(value: u8) -> Result<u8, ApiError> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        _ => Err(ApiError::Unauthorized),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::types::Json as DbJson;

    fn connection(events: &[&str]) -> SourceConnection {
        SourceConnection {
            id: Uuid::nil(),
            service_id: Uuid::nil(),
            organization_id: "organization".into(),
            provider: "github".into(),
            repository: "Example/App".into(),
            repository_key: "example/app".into(),
            secret_path: "source-connections/test".into(),
            events: events.iter().map(|event| (*event).into()).collect(),
            enabled: true,
            github_app_id: None,
            github_installation_id: None,
            authentication_status: "public".into(),
            authentication_error: None,
            last_authenticated_at: None,
            created_at: Utc::now(),
            last_delivery_at: None,
        }
    }

    #[test]
    fn verifies_github_signatures_without_timing_sensitive_comparison() {
        let body = br#"{"repository":{"full_name":"Example/App"}}"#;
        let mut mac = HmacSha256::new_from_slice(b"a sufficiently long webhook secret").unwrap();
        mac.update(body);
        let signature = format!("sha256={:x}", mac.finalize().into_bytes());
        assert!(verify_signature(b"a sufficiently long webhook secret", body, &signature).is_ok());
        assert!(verify_signature(b"different sufficiently long secret", body, &signature).is_err());
        assert!(
            verify_signature(
                b"a sufficiently long webhook secret",
                b"changed",
                &signature
            )
            .is_err()
        );
    }

    #[test]
    fn canonicalizes_only_credential_free_github_repositories() {
        assert_eq!(
            canonical_repository("https://github.com/Example/App.git").unwrap(),
            ("Example/App".into(), "example/app".into())
        );
        assert_eq!(
            canonical_repository("Example/App").unwrap().1,
            "example/app"
        );
        for invalid in [
            "http://github.com/example/app",
            "https://token@github.com/example/app",
            "https://gitlab.com/example/app",
            "example/app/extra",
        ] {
            assert!(canonical_repository(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn github_app_configuration_is_all_or_nothing_and_responses_are_redacted() {
        assert!(validate_github_app(None, None, None).is_ok());
        assert!(validate_github_app(Some(1), None, None).is_err());
        assert!(validate_github_app(Some(1), Some(2), Some("not a PEM")).is_err());

        let mut source = connection(&["push"]);
        source.github_app_id = Some(1);
        source.github_installation_id = Some(2);
        source.authentication_status = "error".into();
        source.authentication_error = Some("credential-free remediation".into());
        let value = serde_json::to_value(source).unwrap();
        assert_eq!(value["authenticationStatus"], "error");
        assert_eq!(value["authenticationError"], "credential-free remediation");
        assert!(value.get("secret_path").is_none());
        assert!(!value.to_string().contains("source-connections/test"));
    }

    #[test]
    fn pins_pushes_and_denies_fork_pull_requests() {
        let commit = "a".repeat(40);
        let push = serde_json::json!({
            "repository":{"full_name":"example/app"},
            "ref":"refs/heads/main",
            "after":commit,
            "deleted":false
        });
        let accepted = decide(&connection(&["push"]), "push", &push).unwrap();
        assert_eq!(accepted.status, "accepted");
        assert_eq!(accepted.commit.as_deref(), Some(commit.as_str()));

        let pull = serde_json::json!({
            "repository":{"full_name":"example/app"},
            "action":"opened",
            "pull_request":{
                "head":{"ref":"change","sha":commit,"repo":{"full_name":"attacker/app"}},
                "base":{"repo":{"full_name":"example/app"}}
            }
        });
        let ignored = decide(&connection(&["pull_request"]), "pull_request", &pull).unwrap();
        assert_eq!(ignored.status, "ignored");
        assert_eq!(ignored.reason, "fork pull requests are denied by default");
        assert!(ignored.commit.is_none());
    }

    #[sqlx::test(migrations = "./migrations")]
    #[ignore = "requires disposable PostgreSQL"]
    async fn delivery_retries_are_idempotent_and_active_builds_are_truthful(pool: PgPool) {
        let project_id = Uuid::now_v7();
        let environment_id = Uuid::now_v7();
        let service_id = Uuid::now_v7();
        let spec: platform_domain::ServiceSpec =
            serde_json::from_str(include_str!("../../../examples/oci-service.json")).unwrap();
        sqlx::query(
            "INSERT INTO projects(id,name,organization_id) VALUES($1,'project','organization')",
        )
        .bind(project_id)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO environments(id,project_id,name) VALUES($1,$2,'production')")
            .bind(environment_id)
            .bind(project_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO services(id,environment_id,name,kind,operation_id,spec,registered_spec) VALUES($1,$2,$3,'oci-service',$4,$5,$5)")
            .bind(service_id)
            .bind(environment_id)
            .bind(&spec.name)
            .bind(Uuid::now_v7())
            .bind(DbJson(&spec))
            .execute(&pool)
            .await
            .unwrap();
        let mut source = connection(&["push"]);
        source.id = Uuid::now_v7();
        source.service_id = service_id;
        sqlx::query("INSERT INTO source_connections(id,service_id,organization_id,provider,repository,repository_key,secret_path,events) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(source.id)
            .bind(source.service_id)
            .bind(&source.organization_id)
            .bind(&source.provider)
            .bind(&source.repository)
            .bind(&source.repository_key)
            .bind(&source.secret_path)
            .bind(&source.events)
            .execute(&pool)
            .await
            .unwrap();
        let commit = "a".repeat(40);
        let payload = serde_json::json!({
            "repository":{"full_name":"example/app"},
            "ref":"refs/heads/main",
            "after":commit,
            "deleted":false
        });
        let first = process_delivery(
            &pool,
            source.clone(),
            "push".into(),
            "delivery-1".into(),
            "b".repeat(64),
            payload.clone(),
        )
        .await
        .unwrap();
        assert_eq!(first.0, StatusCode::ACCEPTED);
        assert_eq!(first.1.status, "accepted");
        assert_eq!(first.1.resolved_commit.as_deref(), Some(commit.as_str()));
        assert_eq!(
            sqlx::query_scalar::<_, Option<Uuid>>(
                "SELECT source_connection_id FROM builds WHERE id=$1"
            )
            .bind(first.1.build_id.unwrap())
            .fetch_one(&pool)
            .await
            .unwrap(),
            Some(source.id)
        );
        let retry = process_delivery(
            &pool,
            source.clone(),
            "push".into(),
            "delivery-1".into(),
            "b".repeat(64),
            payload.clone(),
        )
        .await
        .unwrap();
        assert_eq!(retry.0, StatusCode::OK);
        assert_eq!(retry.1.id, first.1.id);
        assert!(
            process_delivery(
                &pool,
                source.clone(),
                "push".into(),
                "delivery-1".into(),
                "c".repeat(64),
                payload.clone(),
            )
            .await
            .is_err()
        );
        let blocked = process_delivery(
            &pool,
            source,
            "push".into(),
            "delivery-2".into(),
            "d".repeat(64),
            payload,
        )
        .await
        .unwrap();
        assert_eq!(blocked.1.status, "blocked");
        assert!(blocked.1.build_id.is_none());
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM builds")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
    }
}
