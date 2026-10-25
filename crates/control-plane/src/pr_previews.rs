//! Opt-in, same-repository PR previews. All lifecycle work is durable and fenced
//! by the scheduler lock; no provider event executes builds or runtime actions.
use crate::{ApiError, auth, source_connections::SourceConnection};
use axum::{
    Extension, Json,
    extract::{Path, State},
};
use chrono::{DateTime, Utc};
use futures_util::{StreamExt, stream};
use platform_domain::{Execution, Resources, ServiceSpec, Workload};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool, Postgres, Row, Transaction, types::Json as DbJson};
use std::collections::{BTreeMap, BTreeSet};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewPolicy {
    pub enabled: bool,
    pub max_active: i32,
    pub max_builds: i32,
    pub ttl_hours: i32,
    pub resources: Resources,
    /// Services copied into each preview. Empty preserves the legacy behavior:
    /// only the source connection's service is included with no secret grants.
    #[serde(default)]
    pub services: Vec<PreviewServicePolicy>,
}

#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewServicePolicy {
    pub source_service_id: Uuid,
    pub resources: Resources,
    #[serde(default)]
    pub secret_references: Vec<String>,
    #[serde(default)]
    pub allowed_dependencies: Vec<Uuid>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PreviewServiceTemplate {
    source_service_id: Uuid,
    spec: ServiceSpec,
    secret_references: Vec<String>,
    allowed_dependencies: Vec<Uuid>,
    primary_route: bool,
}

#[derive(Debug, Serialize, sqlx::FromRow, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestPreview {
    pub id: Uuid,
    pub source_connection_id: Uuid,
    pub number: i64,
    pub head_commit: String,
    pub environment_id: Option<Uuid>,
    pub service_id: Option<Uuid>,
    pub build_id: Option<Uuid>,
    pub deployment_id: Option<Uuid>,
    pub status: String,
    pub reason: String,
    pub expires_at: DateTime<Utc>,
    pub preview_url: Option<String>,
    pub provider_status: String,
    pub provider_error: Option<String>,
    pub service_count: i64,
}

async fn connection(
    pool: &PgPool,
    id: Uuid,
    context: &auth::Context,
) -> Result<SourceConnection, ApiError> {
    sqlx::query_as(
        "SELECT * FROM source_connections WHERE id=$1 AND ($2::text IS NULL OR organization_id=$2)",
    )
    .bind(id)
    .bind(context.organization_id.as_deref())
    .fetch_optional(pool)
    .await?
    .ok_or(ApiError::NotFound)
}

#[utoipa::path(get, path="/api/source-connections/{id}/preview-policy", params(("id"=Uuid, Path)), responses((status=200, body=Option<PreviewPolicy>)), operation_id="getPreviewPolicy")]
pub(crate) async fn get_policy(
    State(pool): State<PgPool>,
    Extension(context): Extension<auth::Context>,
    Path(id): Path<Uuid>,
) -> Result<Json<Option<PreviewPolicy>>, ApiError> {
    connection(&pool, id, &context).await?;
    let row = sqlx::query("SELECT * FROM preview_policies WHERE source_connection_id=$1")
        .bind(id)
        .fetch_optional(&pool)
        .await?;
    Ok(Json(row.map(|r| {
        PreviewPolicy {
            enabled: r.get("enabled"),
            max_active: r.get("max_active"),
            max_builds: r.get("max_builds"),
            ttl_hours: r.get("ttl_hours"),
            resources: r.get::<DbJson<ServiceSpec>, _>("spec").resources,
            services: r
                .get::<DbJson<Vec<PreviewServiceTemplate>>, _>("services")
                .iter()
                .map(|template| PreviewServicePolicy {
                    source_service_id: template.source_service_id,
                    resources: template.spec.resources,
                    secret_references: template.secret_references.clone(),
                    allowed_dependencies: template.allowed_dependencies.clone(),
                })
                .collect(),
        }
    })))
}

#[utoipa::path(put, path="/api/source-connections/{id}/preview-policy", params(("id"=Uuid, Path)), request_body=PreviewPolicy, responses((status=200, body=PreviewPolicy)), operation_id="configurePreviewPolicy")]
pub(crate) async fn configure_policy(
    State(pool): State<PgPool>,
    Extension(context): Extension<auth::Context>,
    Path(id): Path<Uuid>,
    Json(input): Json<PreviewPolicy>,
) -> Result<Json<PreviewPolicy>, ApiError> {
    let source = connection(&pool, id, &context).await?;
    if !(1..=10).contains(&input.max_active)
        || !(1..=3).contains(&input.max_builds)
        || !(1..=168).contains(&input.ttl_hours)
        || !(100..=2000).contains(&input.resources.cpu_millis)
        || !(64..=2048).contains(&input.resources.memory_mib)
    {
        return Err(ApiError::Conflict(
            "preview limits: 1–10 active, 1–3 builds, 1–168 hours, 100–2000 CPU millis and 64–2048 MiB",
        ));
    }
    let mut tx = pool.begin().await?;
    lock(&mut tx).await?;
    sqlx::query("SELECT id FROM source_connections WHERE id=$1 FOR UPDATE")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let existing: Option<(DbJson<ServiceSpec>, DbJson<Vec<PreviewServiceTemplate>>)> =
        sqlx::query_as("SELECT spec,services FROM preview_policies WHERE source_connection_id=$1")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    let (spec, templates) = if !input.enabled
        && let Some((DbJson(mut spec), DbJson(mut templates))) = existing
    {
        spec.resources = input.resources;
        for template in &mut templates {
            if template.primary_route {
                template.spec.resources = input.resources;
            }
        }
        (spec, templates)
    } else {
        let requested = if input.services.is_empty() {
            vec![PreviewServicePolicy {
                source_service_id: source.service_id,
                resources: input.resources,
                secret_references: Vec::new(),
                allowed_dependencies: Vec::new(),
            }]
        } else {
            input.services.clone()
        };
        if requested.len() > 5
            || !requested
                .iter()
                .any(|service| service.source_service_id == source.service_id)
            || requested
                .iter()
                .map(|service| service.source_service_id)
                .collect::<BTreeSet<_>>()
                .len()
                != requested.len()
        {
            return Err(ApiError::Conflict(
                "preview templates require 1–5 unique services including the source connection service",
            ));
        }
        let source_environment: Uuid =
            sqlx::query_scalar("SELECT environment_id FROM services WHERE id=$1")
                .bind(source.service_id)
                .fetch_one(&mut *tx)
                .await?;
        let included = requested
            .iter()
            .map(|service| service.source_service_id)
            .collect::<BTreeSet<_>>();
        let mut templates = Vec::with_capacity(requested.len());
        for requested_service in requested {
            if !(100..=2000).contains(&requested_service.resources.cpu_millis)
                || !(64..=2048).contains(&requested_service.resources.memory_mib)
                || requested_service
                    .allowed_dependencies
                    .iter()
                    .any(|dependency| !included.contains(dependency))
            {
                return Err(ApiError::Conflict(
                    "preview service resources or dependency allowlist is invalid",
                ));
            }
            let row =
                sqlx::query("SELECT environment_id,spec FROM services WHERE id=$1 FOR UPDATE")
                    .bind(requested_service.source_service_id)
                    .fetch_optional(&mut *tx)
                    .await?
                    .ok_or(ApiError::Conflict(
                        "preview template service does not exist",
                    ))?;
            if row.get::<Uuid, _>("environment_id") != source_environment {
                return Err(ApiError::Conflict(
                    "preview template services must belong to the source environment",
                ));
            }
            let DbJson(service_spec): DbJson<ServiceSpec> = row.get("spec");
            if crate::source_connections::canonical_repository(&service_spec.source.repository)?.1
                != source.repository_key
            {
                return Err(ApiError::Conflict(
                    "every preview template service must use the source connection repository",
                ));
            }
            let secret_references = requested_service
                .secret_references
                .into_iter()
                .collect::<BTreeSet<_>>();
            if secret_references
                .iter()
                .any(|name| !service_spec.secrets.contains(name))
            {
                return Err(ApiError::Conflict(
                    "preview secret references must already exist on their source service",
                ));
            }
            let allowed_dependencies = requested_service
                .allowed_dependencies
                .into_iter()
                .collect::<BTreeSet<_>>();
            let spec = sanitized(
                service_spec,
                requested_service.resources,
                &secret_references,
                &allowed_dependencies,
            )?;
            templates.push(PreviewServiceTemplate {
                source_service_id: requested_service.source_service_id,
                spec,
                secret_references: secret_references.into_iter().collect(),
                allowed_dependencies: allowed_dependencies.into_iter().collect(),
                primary_route: requested_service.source_service_id == source.service_id,
            });
        }
        templates.sort_by_key(|template| !template.primary_route);
        let spec = templates
            .iter()
            .find(|template| template.primary_route)
            .expect("source service template validated")
            .spec
            .clone();
        (spec, templates)
    };
    sqlx::query("INSERT INTO preview_policies(source_connection_id,enabled,max_active,max_builds,ttl_hours,spec,services) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(source_connection_id) DO UPDATE SET enabled=$2,max_active=$3,max_builds=$4,ttl_hours=$5,spec=$6,services=$7,updated_at=now()")
        .bind(id).bind(input.enabled).bind(input.max_active).bind(input.max_builds).bind(input.ttl_hours).bind(DbJson(spec)).bind(DbJson(templates)).execute(&mut *tx).await?;
    if !input.enabled {
        sqlx::query("UPDATE pull_request_previews SET desired_open=false,suppressed=true,status='cleaning',reason='Preview policy disabled',provider_status='pending',provider_error=NULL,updated_at=now() WHERE source_connection_id=$1 AND status<>'closed'").bind(id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(input))
}

fn sanitized(
    mut spec: ServiceSpec,
    resources: Resources,
    secret_references: &BTreeSet<String>,
    allowed_dependencies: &BTreeSet<Uuid>,
) -> Result<ServiceSpec, ApiError> {
    let Workload::OciService {
        execution: Execution::Http,
        replicas,
        pre_deploy,
        private_connections,
        build_args,
        ..
    } = &mut spec.workload
    else {
        return Err(ApiError::Conflict(
            "previews support stateless HTTP OCI services only",
        ));
    };
    *replicas = 1;
    *pre_deploy = None;
    private_connections.retain(|connection| allowed_dependencies.contains(&connection.service_id));
    build_args.clear();
    spec.secrets.retain(|name| secret_references.contains(name));
    spec.domains.clear();
    spec.volume = None;
    spec.resources = resources;
    spec.distinct_nodes = false;
    spec.validate().map_err(ApiError::Invalid)?;
    Ok(spec)
}

#[utoipa::path(get, path="/api/source-connections/{id}/previews", params(("id"=Uuid, Path)), responses((status=200, body=[PullRequestPreview])), operation_id="listPreviews")]
pub(crate) async fn list(
    State(pool): State<PgPool>,
    Extension(context): Extension<auth::Context>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<PullRequestPreview>>, ApiError> {
    connection(&pool, id, &context).await?;
    Ok(Json(sqlx::query_as("SELECT p.*,CASE WHEN r.authority IS NOT NULL THEN 'https://' || r.authority END AS preview_url,(SELECT count(*) FROM pull_request_preview_services ps WHERE ps.preview_id=p.id) AS service_count FROM pull_request_previews p LEFT JOIN preview_routes r ON r.service_id=p.service_id WHERE p.source_connection_id=$1 ORDER BY p.updated_at DESC,p.id DESC LIMIT 100").bind(id).fetch_all(&pool).await?))
}

#[utoipa::path(delete, path="/api/source-connections/{id}/previews/{preview_id}", params(("id"=Uuid, Path),("preview_id"=Uuid, Path)), responses((status=200)), operation_id="deletePreview")]
pub(crate) async fn delete(
    State(pool): State<PgPool>,
    Extension(context): Extension<auth::Context>,
    Path((id, preview)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    connection(&pool, id, &context).await?;
    let mut tx = pool.begin().await?;
    lock(&mut tx).await?;
    let changed=sqlx::query("UPDATE pull_request_previews SET desired_open=false,suppressed=true,status=CASE WHEN status='closed' THEN status ELSE 'cleaning' END,reason='Cleanup requested by operator',provider_status='pending',provider_error=NULL,updated_at=now() WHERE id=$1 AND source_connection_id=$2").bind(preview).bind(id).execute(&mut *tx).await?;
    if changed.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }
    tx.commit().await?;
    Ok(Json(serde_json::json!({"accepted":true})))
}

pub(crate) async fn lock(tx: &mut Transaction<'_, Postgres>) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT pg_advisory_xact_lock(712184551)")
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// Called only after signature and delivery-ID validation, in the delivery transaction.
pub(crate) async fn receive(
    tx: &mut Transaction<'_, Postgres>,
    source: &SourceConnection,
    payload: &serde_json::Value,
) -> Result<Option<(&'static str, &'static str)>, ApiError> {
    let policy =
        sqlx::query("SELECT enabled,ttl_hours FROM preview_policies WHERE source_connection_id=$1")
            .bind(source.id)
            .fetch_optional(&mut **tx)
            .await?;
    let Some(policy) = policy else {
        return Ok(None);
    };
    // Configured previews own PR events, even when disabled. Never fall back to production builds.
    if !policy.get::<bool, _>("enabled") {
        return Ok(Some(("ignored", "preview policy is disabled")));
    }
    let pr = &payload["pull_request"];
    let action = payload["action"].as_str().unwrap_or_default();
    if !matches!(action, "opened" | "reopened" | "synchronize" | "closed") {
        return Ok(Some((
            "ignored",
            "pull request action does not change previews",
        )));
    }
    for repository in [
        &payload["repository"]["full_name"],
        &pr["base"]["repo"]["full_name"],
        &pr["head"]["repo"]["full_name"],
    ] {
        if repository
            .as_str()
            .and_then(|s| crate::source_connections::canonical_repository(s).ok())
            .is_none_or(|(_, key)| key != source.repository_key)
        {
            return Ok(Some((
                "ignored",
                "fork or mismatched pull request repository is denied",
            )));
        }
    }
    let number = payload["number"]
        .as_i64()
        .filter(|n| *n > 0)
        .ok_or(ApiError::Conflict("pull request number is required"))?;
    let event_at = pr["updated_at"]
        .as_str()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc))
        .ok_or(ApiError::Conflict(
            "pull request updated_at is required for event ordering",
        ))?;
    let commit = pr["head"]["sha"]
        .as_str()
        .filter(|s| platform_domain::commit_hash(s))
        .ok_or(ApiError::Conflict("pull request head commit is required"))?;
    let open = action != "closed";
    let existing=sqlx::query("SELECT id,event_at,desired_open,suppressed FROM pull_request_previews WHERE source_connection_id=$1 AND number=$2 FOR UPDATE").bind(source.id).bind(number).fetch_optional(&mut **tx).await?;
    if let Some(row) = existing {
        let previous: DateTime<Utc> = row.get("event_at");
        // Equal timestamps are ambiguous: close wins; other updates fail closed.
        if event_at < previous
            || (event_at == previous && (open || !row.get::<bool, _>("desired_open")))
        {
            return Ok(Some(("ignored", "stale or ambiguous pull request event")));
        }
        if open
            && (!row.get::<bool, _>("desired_open") || row.get::<bool, _>("suppressed"))
            && action != "reopened"
        {
            return Ok(Some((
                "ignored",
                "closed or expired preview requires an explicit reopen",
            )));
        }
        sqlx::query("UPDATE pull_request_previews SET event_at=$2,provider_check_id=CASE WHEN head_commit<>$3 THEN NULL ELSE provider_check_id END,provider_reported_state=CASE WHEN head_commit<>$3 THEN NULL ELSE provider_reported_state END,head_commit=$3,desired_open=$4,suppressed=false,expires_at=now()+make_interval(hours=>$5),status=CASE WHEN NOT $4 THEN 'cleaning' WHEN status IN ('closed','blocked','failed') THEN 'pending' ELSE status END,provider_status='pending',provider_error=NULL,updated_at=now() WHERE id=$1")
            .bind(row.get::<Uuid,_>("id")).bind(event_at).bind(commit).bind(open).bind(policy.get::<i32,_>("ttl_hours")).execute(&mut **tx).await?;
    } else {
        sqlx::query("INSERT INTO pull_request_previews(id,source_connection_id,number,event_at,desired_open,head_commit,status,reason,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+make_interval(hours=>$9))")
            .bind(Uuid::now_v7()).bind(source.id).bind(number).bind(event_at).bind(open).bind(commit).bind(if open {"pending"} else {"closed"}).bind(if open {"Preview requested"} else {"Pull request closed"}).bind(policy.get::<i32,_>("ttl_hours")).execute(&mut **tx).await?;
    }
    Ok(Some((
        "accepted",
        if open {
            "preview intent recorded"
        } else {
            "preview cleanup requested"
        },
    )))
}

async fn state(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    status: &str,
    reason: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE pull_request_previews SET status=$2,reason=$3,provider_status='pending',provider_error=NULL,updated_at=now() WHERE id=$1 AND (status,reason) IS DISTINCT FROM ($2,$3)").bind(id).bind(status).bind(reason).execute(&mut **tx).await?;
    Ok(())
}

/// Each item commits independently. The scheduler lock prevents close/update,
/// capacity allocation, and promotion from racing the preview's pinned intent.
pub async fn reconcile(pool: &PgPool) -> Result<(), ApiError> {
    let ids:Vec<Uuid>=sqlx::query_scalar("SELECT id FROM pull_request_previews WHERE status<>'closed' OR desired_open ORDER BY last_checked_at,id LIMIT 100").fetch_all(pool).await?;
    for id in ids {
        let mut tx = pool.begin().await?;
        lock(&mut tx).await?;
        reconcile_one(pool, &mut tx, id).await?;
        sqlx::query("UPDATE pull_request_previews SET last_checked_at=now() WHERE id=$1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
    }
    let provider_ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM pull_request_previews WHERE provider_status='pending' ORDER BY updated_at,id LIMIT 20",
    )
    .fetch_all(pool)
    .await?;
    stream::iter(provider_ids)
        .map(|id| publish_provider_status(pool, id))
        .buffer_unordered(4)
        .collect::<Vec<_>>()
        .await;
    Ok(())
}

async fn publish_provider_status(pool: &PgPool, id: Uuid) {
    let generation: Option<DateTime<Utc>> =
        sqlx::query_scalar("SELECT updated_at FROM pull_request_previews WHERE id=$1")
            .bind(id)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    if let Err((status, message)) = try_publish_provider_status(pool, id).await {
        let _ = sqlx::query(
            "UPDATE pull_request_previews SET provider_status=$2,provider_error=$3 WHERE id=$1 AND updated_at=$4 AND provider_status='pending'",
        )
        .bind(id)
        .bind(status)
        .bind(message)
        .bind(generation)
        .execute(pool)
        .await;
    }
}

async fn try_publish_provider_status(
    pool: &PgPool,
    id: Uuid,
) -> Result<(), (&'static str, &'static str)> {
    let row=sqlx::query("SELECT p.head_commit,p.status,p.reason,p.provider_check_id,p.provider_reported_state,p.provider_status,CASE WHEN r.authority IS NOT NULL THEN 'https://' || r.authority END AS preview_url,c.* FROM pull_request_previews p JOIN source_connections c ON c.id=p.source_connection_id LEFT JOIN preview_routes r ON r.service_id=p.service_id WHERE p.id=$1").bind(id).fetch_one(pool).await.map_err(|_|("failed","Could not load preview provider status"))?;
    if row.get::<String, _>("provider_status") != "pending" {
        return Ok(());
    }
    let connection = SourceConnection::from_row(&row).map_err(|_| {
        (
            "failed",
            "Could not load source connection for provider status",
        )
    })?;
    let status: String = row.get("status");
    let reason: String = row.get("reason");
    let head: String = row.get("head_commit");
    let preview_url: Option<String> = row.get("preview_url");
    let reported_state = serde_json::json!({
        "head": &head,
        "status": &status,
        "reason": &reason,
        "url": &preview_url,
    })
    .to_string();
    if row
        .get::<Option<String>, _>("provider_reported_state")
        .as_deref()
        == Some(reported_state.as_str())
    {
        return Ok(());
    }
    if connection.github_app_id.is_none() {
        return Err((
            "unavailable",
            "Configure a GitHub App with Checks write permission to publish PR status",
        ));
    }
    let token = crate::source_connections::github_checks_token(&connection)
        .await
        .map_err(|_| {
            (
                "failed",
                "GitHub App token or Checks write permission is unavailable",
            )
        })?;
    let (check_status, conclusion) = provider_check_state(&status);
    let dashboard = std::env::var("PUBLIC_ORIGIN")
        .ok()
        .filter(|origin| origin.starts_with("https://") || origin.starts_with("http://localhost"))
        .map(|origin| format!("{origin}/services/{}/builds", connection.service_id));
    let summary = match &preview_url {
        Some(url) => format!("{reason}\n\nPrivate preview: {url}"),
        None => reason.clone(),
    };
    let mut body = serde_json::json!({
        "name":"local-paas preview",
        "head_sha":&head,
        "status":check_status,
        "external_id":id.to_string(),
        "output":{"title":format!("Preview {status}"),"summary":summary}
    });
    if let Some(conclusion) = conclusion {
        body["conclusion"] = serde_json::Value::String(conclusion.into());
    }
    if let Some(dashboard) = dashboard {
        body["details_url"] = serde_json::Value::String(dashboard);
    }
    let repository = connection.repository.trim_end_matches(".git");
    let check_id: Option<i64> = row.get("provider_check_id");
    let url = check_id.map_or_else(
        || format!("https://api.github.com/repos/{repository}/check-runs"),
        |check| format!("https://api.github.com/repos/{repository}/check-runs/{check}"),
    );
    let client = reqwest::Client::builder()
        .https_only(true)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("local-paas-github-checks/1")
        .build()
        .map_err(|_| ("failed", "Could not initialize GitHub status publishing"))?;
    let response = client
        .request(
            if check_id.is_some() {
                reqwest::Method::PATCH
            } else {
                reqwest::Method::POST
            },
            url,
        )
        .bearer_auth(token.as_str())
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2026-03-10")
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|_| ("failed", "GitHub status publishing is unavailable"))?;
    if !response.status().is_success() {
        return Err((
            "failed",
            "GitHub rejected the preview check; verify Checks write permission",
        ));
    }
    let response_id = match check_id {
        None => response
            .bytes()
            .await
            .ok()
            .filter(|bytes| bytes.len() <= 64 * 1024)
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
            .and_then(|value| value["id"].as_i64())
            .ok_or((
                "failed",
                "GitHub returned an invalid preview check response",
            ))?,
        Some(check_id) => check_id,
    };
    sqlx::query("UPDATE pull_request_previews SET provider_check_id=$2,provider_reported_state=$3,provider_status='published',provider_error=NULL WHERE id=$1 AND head_commit=$4 AND status=$5 AND reason=$6")
        .bind(id).bind(response_id).bind(reported_state).bind(head).bind(status).bind(reason).execute(pool).await.map_err(|_|("failed","Could not persist GitHub preview check state"))?;
    Ok(())
}

fn provider_check_state(status: &str) -> (&'static str, Option<&'static str>) {
    match status {
        "pending" | "blocked" => ("queued", None),
        "building" | "deploying" | "cleaning" => ("in_progress", None),
        "ready" => ("completed", Some("success")),
        "closed" => ("completed", Some("cancelled")),
        "degraded" => ("completed", Some("neutral")),
        _ => ("completed", Some("failure")),
    }
}

async fn reconcile_one(
    pool: &PgPool,
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
) -> Result<(), ApiError> {
    let row=sqlx::query("SELECT p.*,c.service_id AS source_service,c.enabled AS connection_enabled,c.repository_key,pp.enabled AS policy_enabled,pp.max_active,pp.max_builds,pp.spec AS template,pp.services AS templates FROM pull_request_previews p JOIN source_connections c ON c.id=p.source_connection_id JOIN preview_policies pp ON pp.source_connection_id=c.id WHERE p.id=$1 FOR UPDATE OF p").bind(id).fetch_one(&mut **tx).await?;
    let source: Uuid = row.get("source_connection_id");
    let services: Vec<Uuid> = sqlx::query_scalar(
        "SELECT service_id FROM pull_request_preview_services WHERE preview_id=$1 ORDER BY position",
    )
    .bind(id)
    .fetch_all(&mut **tx)
    .await?;
    let desired: bool = row.get("desired_open");
    let expired: bool = row.get::<DateTime<Utc>, _>("expires_at") <= Utc::now();
    if !desired
        || expired
        || !row.get::<bool, _>("policy_enabled")
        || !row.get::<bool, _>("connection_enabled")
        || row.get::<String, _>("status") == "cleaning"
    {
        if expired
            || !row.get::<bool, _>("policy_enabled")
            || !row.get::<bool, _>("connection_enabled")
        {
            sqlx::query("UPDATE pull_request_previews SET desired_open=false,suppressed=true WHERE id=$1 AND desired_open").bind(id).execute(&mut **tx).await?;
        }
        if !services.is_empty() {
            // Withdraw routes immediately; retain instances and reservations until agents confirm shutdown.
            sqlx::query("DELETE FROM preview_routes WHERE service_id=ANY($1)")
                .bind(&services)
                .execute(&mut **tx)
                .await?;
            sqlx::query("UPDATE builds SET cancel_requested=true,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,finished_at=CASE WHEN status='queued' THEN now() ELSE finished_at END WHERE service_id=ANY($1) AND status IN ('queued','running') AND NOT cancel_requested").bind(&services).execute(&mut **tx).await?;
            sqlx::query("UPDATE deployments SET status=CASE WHEN job_options IS NULL THEN 'stopped' ELSE 'cancelled' END WHERE service_id=ANY($1) AND status NOT IN ('stopped','cancelled','succeeded','failed','superseded')").bind(&services).execute(&mut **tx).await?;
            sqlx::query("UPDATE instances SET desired_state='stopped',generation=generation+1 WHERE deployment_id IN(SELECT id FROM deployments WHERE service_id=ANY($1)) AND desired_state<>'stopped'").bind(&services).execute(&mut **tx).await?;
            let busy:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM builds WHERE service_id=ANY($1) AND status IN ('queued','running') UNION ALL SELECT 1 FROM instances i JOIN deployments d ON d.id=i.deployment_id WHERE d.service_id=ANY($1) AND (i.state<>'stopped' OR EXISTS(SELECT 1 FROM ingress_route_leases l WHERE l.instance_id=i.id AND l.expires_at+interval '5 seconds'>clock_timestamp()) OR EXISTS(SELECT 1 FROM private_route_leases l WHERE l.instance_id=i.id AND l.expires_at+interval '5 seconds'>clock_timestamp())))").bind(&services).fetch_one(&mut **tx).await?;
            if busy {
                return Ok(state(
                    tx,
                    id,
                    "cleaning",
                    "Waiting for build cancellation, confirmed shutdown and route lease expiry",
                )
                .await?);
            }
        }
        sqlx::query("UPDATE pull_request_preview_services SET build_id=NULL,deployment_id=NULL WHERE preview_id=$1")
            .bind(id)
            .execute(&mut **tx)
            .await?;
        sqlx::query("UPDATE pull_request_previews SET build_id=NULL,deployment_id=NULL,admitted=false WHERE id=$1 AND (build_id IS NOT NULL OR deployment_id IS NOT NULL OR admitted)").bind(id).execute(&mut **tx).await?;
        let reopened = desired
            && !expired
            && row.get::<bool, _>("policy_enabled")
            && row.get::<bool, _>("connection_enabled");
        state(
            tx,
            id,
            if reopened { "pending" } else { "closed" },
            if reopened {
                "Cleanup complete; reopening preview"
            } else {
                "Cleanup confirmed; history retained"
            },
        )
        .await?;
        return Ok(());
    }
    let active:i64=sqlx::query_scalar("SELECT count(*) FROM pull_request_previews WHERE source_connection_id=$1 AND id<>$2 AND admitted").bind(source).bind(id).fetch_one(&mut **tx).await?;
    if active >= i64::from(row.get::<i32, _>("max_active")) && !row.get::<bool, _>("admitted") {
        return Ok(state(tx, id, "blocked", "Active preview quota exhausted").await?);
    }
    sqlx::query("UPDATE pull_request_previews SET admitted=true WHERE id=$1 AND NOT admitted")
        .bind(id)
        .execute(&mut **tx)
        .await?;
    let head: String = row.get("head_commit");
    let DbJson(mut templates): DbJson<Vec<PreviewServiceTemplate>> = row.get("templates");
    if templates.is_empty() {
        let DbJson(spec): DbJson<ServiceSpec> = row.get("template");
        templates.push(PreviewServiceTemplate {
            source_service_id: row.get("source_service"),
            secret_references: spec.secrets.clone(),
            allowed_dependencies: Vec::new(),
            primary_route: true,
            spec,
        });
    }
    if services.is_empty() {
        let project:Uuid=sqlx::query_scalar("SELECT e.project_id FROM services s JOIN environments e ON e.id=s.environment_id WHERE s.id=$1").bind(row.get::<Uuid,_>("source_service")).fetch_one(&mut **tx).await?;
        let project_name: String = sqlx::query_scalar("SELECT name FROM projects WHERE id=$1")
            .bind(project)
            .fetch_one(&mut **tx)
            .await?;
        let environment = Uuid::now_v7();
        let environment_name = format!("pr-{}", environment.simple());
        sqlx::query("INSERT INTO environments(id,project_id,name) VALUES($1,$2,$3)")
            .bind(environment)
            .bind(project)
            .bind(&environment_name)
            .execute(&mut **tx)
            .await?;
        let service_ids = templates
            .iter()
            .map(|template| (template.source_service_id, Uuid::now_v7()))
            .collect::<BTreeMap<_, _>>();
        for (position, template) in templates.iter().enumerate() {
            let mut spec = template.spec.clone();
            spec.project.clone_from(&project_name);
            spec.environment.clone_from(&environment_name);
            spec.source.pin(head.clone());
            if let Workload::OciService {
                private_connections,
                ..
            } = &mut spec.workload
            {
                for connection in private_connections {
                    connection.service_id =
                        *service_ids
                            .get(&connection.service_id)
                            .ok_or(ApiError::Conflict(
                                "preview dependency is not in its template",
                            ))?;
                }
            }
            let service = service_ids[&template.source_service_id];
            sqlx::query("INSERT INTO services(id,environment_id,name,kind,operation_id,spec,registered_spec) VALUES($1,$2,$3,'oci-service',$4,$5,$5)").bind(service).bind(environment).bind(&spec.name).bind(Uuid::now_v7()).bind(DbJson(&spec)).execute(&mut **tx).await?;
            sqlx::query("INSERT INTO pull_request_preview_services(preview_id,source_service_id,service_id,primary_route,position) VALUES($1,$2,$3,$4,$5)")
                .bind(id).bind(template.source_service_id).bind(service).bind(template.primary_route).bind(i32::try_from(position).map_err(|_| ApiError::Database)?).execute(&mut **tx).await?;
            if !template.secret_references.is_empty() {
                sqlx::query("INSERT INTO preview_secret_grants(preview_id,source_service_id,target_service_id,names) VALUES($1,$2,$3,$4)")
                    .bind(id).bind(template.source_service_id).bind(service).bind(&template.secret_references).execute(&mut **tx).await?;
            }
            if template.primary_route {
                sqlx::query(
                    "UPDATE pull_request_previews SET environment_id=$2,service_id=$3 WHERE id=$1",
                )
                .bind(id)
                .bind(environment)
                .bind(service)
                .execute(&mut **tx)
                .await?;
            }
        }
    }
    let primary: Uuid = sqlx::query_scalar("SELECT service_id FROM pull_request_preview_services WHERE preview_id=$1 AND primary_route")
        .bind(id)
        .fetch_one(&mut **tx)
        .await?;
    sqlx::query("SELECT pg_advisory_xact_lock(72401952)")
        .execute(&mut **tx)
        .await?;
    let route: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM preview_routes WHERE service_id=$1)")
            .bind(primary)
            .fetch_one(&mut **tx)
            .await?;
    if !route {
        let used: Vec<String> = sqlx::query_scalar("SELECT authority FROM preview_routes")
            .fetch_all(&mut **tx)
            .await?;
        let Some(authority) = crate::networking::endpoints()
            .into_iter()
            .find(|s| !used.contains(s))
        else {
            return Ok(state(
                tx,
                id,
                "blocked",
                "No configured private preview URL is available",
            )
            .await?);
        };
        sqlx::query("INSERT INTO preview_routes(authority,service_id) VALUES($1,$2)")
            .bind(authority)
            .bind(primary)
            .execute(&mut **tx)
            .await?;
    }
    let children = sqlx::query("SELECT service_id,build_id,deployment_id,primary_route FROM pull_request_preview_services WHERE preview_id=$1 ORDER BY position")
        .bind(id).fetch_all(&mut **tx).await?;
    let mut all_healthy = true;
    for child in children {
        let service: Uuid = child.get("service_id");
        let current: DbJson<ServiceSpec> =
            sqlx::query_scalar("SELECT spec FROM services WHERE id=$1")
                .bind(service)
                .fetch_one(&mut **tx)
                .await?;
        if crate::source_connections::canonical_repository(&current.source.repository)?.1
            != row.get::<String, _>("repository_key")
        {
            return Ok(state(
                tx,
                id,
                "failed",
                "Preview repository no longer matches its source connection",
            )
            .await?);
        }
        let build = if let Some(build_id) = child.get::<Option<Uuid>, _>("build_id") {
            Some(
                sqlx::query_as::<_, crate::builds::Build>("SELECT * FROM builds WHERE id=$1")
                    .bind(build_id)
                    .fetch_one(&mut **tx)
                    .await?,
            )
        } else {
            None
        };
        if build
            .as_ref()
            .is_none_or(|b| b.resolved_commit.as_deref() != Some(head.as_str()))
        {
            if build
                .as_ref()
                .is_some_and(|b| matches!(b.status.as_str(), "queued" | "running"))
            {
                return Ok(state(
                    tx,
                    id,
                    "building",
                    "Waiting for the previous build before building the latest commit",
                )
                .await?);
            }
            let count:i64=sqlx::query_scalar("SELECT count(*) FROM builds b JOIN pull_request_preview_services ps ON ps.service_id=b.service_id JOIN pull_request_previews p ON p.id=ps.preview_id WHERE p.source_connection_id=$1 AND b.status IN ('queued','running')").bind(source).fetch_one(&mut **tx).await?;
            if count >= i64::from(row.get::<i32, _>("max_builds")) {
                return Ok(state(tx, id, "pending", "Waiting for preview build capacity").await?);
            }
            let mut updated = current.0;
            updated.source.pin(head.clone());
            sqlx::query("UPDATE services SET spec=$2,version=version+1 WHERE id=$1")
                .bind(service)
                .bind(DbJson(updated))
                .execute(&mut **tx)
                .await?;
            let build =
                crate::builds::enqueue_pinned(tx, service, Uuid::now_v7(), &head, source).await?;
            sqlx::query("UPDATE pull_request_preview_services SET build_id=$2,deployment_id=NULL WHERE preview_id=$1 AND service_id=$3")
            .bind(id).bind(build.id).bind(service).execute(&mut **tx).await?;
            if child.get::<bool, _>("primary_route") {
                sqlx::query(
                    "UPDATE pull_request_previews SET build_id=$2,deployment_id=NULL WHERE id=$1",
                )
                .bind(id)
                .bind(build.id)
                .execute(&mut **tx)
                .await?;
            }
            return Ok(state(tx, id, "building", "Building the pinned PR commit").await?);
        }
        let build = build.expect("current build exists");
        match build.status.as_str() {
            "queued" | "running" => {
                return Ok(state(tx, id, "building", "Building the pinned PR commit").await?);
            }
            "succeeded" => {}
            _ => {
                return Ok(state(
                    tx,
                    id,
                    "failed",
                    "Preview build failed or was cancelled; send a newer PR update to retry",
                )
                .await?);
            }
        }
        let deployment = if let Some(deployment) = child.get::<Option<Uuid>, _>("deployment_id") {
            deployment
        } else {
            let revision: Uuid = sqlx::query_scalar("SELECT id FROM revisions WHERE build_id=$1")
                .bind(build.id)
                .fetch_one(&mut **tx)
                .await?;
            match crate::runtime::deploy_in_transaction(
                pool,
                tx,
                service,
                crate::runtime::DeployRequest {
                    operation_id: build.id,
                    revision_id: revision,
                },
            )
            .await
            {
                Ok(Json(result)) => {
                    let deployment: Uuid = result["id"]
                        .as_str()
                        .and_then(|s| s.parse().ok())
                        .ok_or(ApiError::Database)?;
                    sqlx::query("UPDATE pull_request_preview_services SET deployment_id=$2 WHERE preview_id=$1 AND service_id=$3")
                    .bind(id).bind(deployment).bind(service).execute(&mut **tx).await?;
                    if child.get::<bool, _>("primary_route") {
                        sqlx::query(
                            "UPDATE pull_request_previews SET deployment_id=$2 WHERE id=$1",
                        )
                        .bind(id)
                        .bind(deployment)
                        .execute(&mut **tx)
                        .await?;
                    }
                    deployment
                }
                Err(ApiError::Conflict(reason)) => {
                    return Ok(state(tx, id, "deploying", reason).await?);
                }
                Err(error) => return Err(error),
            }
        };
        let status: String = sqlx::query_scalar("SELECT status FROM deployments WHERE id=$1")
            .bind(deployment)
            .fetch_one(&mut **tx)
            .await?;
        match status.as_str() {
        "active" => {
            let healthy:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM instances WHERE deployment_id=$1) AND NOT EXISTS(SELECT 1 FROM instances i JOIN nodes n ON n.id=i.node_id WHERE i.deployment_id=$1 AND (i.state<>'ready' OR i.desired_state<>'running' OR i.observed_at IS NULL OR i.observed_at<=now()-interval '15 seconds' OR n.last_seen IS NULL OR n.last_seen<=now()-interval '30 seconds'))").bind(deployment).fetch_one(&mut **tx).await?;
            all_healthy &= healthy;
        }
        "preparing" | "waiting" | "releasing" => {
            state(tx, id, "deploying", "Waiting for deployment readiness").await?
        }
        _ => return Ok(state(tx,id,"failed","A preview service deployment failed or stopped; prior healthy revisions may still be serving").await?),
        }
    }
    state(
        tx,
        id,
        if all_healthy { "ready" } else { "degraded" },
        if all_healthy {
            "All preview services are ready"
        } else {
            "A preview service has no fresh healthy replica observation"
        },
    )
    .await?;
    Ok(())
}

pub(crate) async fn ensure_environment_writable(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
) -> Result<(), ApiError> {
    let managed: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM pull_request_previews WHERE environment_id=$1)",
    )
    .bind(id)
    .fetch_one(&mut **tx)
    .await?;
    if managed {
        return Err(ApiError::Conflict(
            "PR preview environments are managed by their source policy",
        ));
    }
    Ok(())
}

/// Preview services are immutable through ordinary service mutations. This also
/// protects secrets, bindings, jobs, scaling and manual builds from bypassing policy.
pub(crate) async fn guard(
    State(pool): State<PgPool>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    if !matches!(
        *request.method(),
        axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
    ) {
        let parts: Vec<_> = request.uri().path().split('/').collect();
        if let (Some(kind), Some(id)) = (
            parts.get(2),
            parts.get(3).and_then(|v| v.parse::<Uuid>().ok()),
        ) {
            let query = match *kind {
                "services" => Some(
                    "SELECT EXISTS(SELECT 1 FROM pull_request_preview_services WHERE service_id=$1)",
                ),
                "builds" => Some(
                    "SELECT EXISTS(SELECT 1 FROM pull_request_preview_services p JOIN builds b ON b.service_id=p.service_id WHERE b.id=$1)",
                ),
                "deployments" => Some(
                    "SELECT EXISTS(SELECT 1 FROM pull_request_preview_services p JOIN deployments d ON d.service_id=p.service_id WHERE d.id=$1)",
                ),
                _ => None,
            };
            if let Some(query) = query {
                match sqlx::query_scalar::<_,bool>(query).bind(id).fetch_one(&pool).await {
                    Ok(true)=>return ApiError::Conflict("PR previews are managed by their source policy; use preview cleanup to remove them").into_response(),
                    Err(_)=>return ApiError::Database.into_response(),
                    Ok(false)=>{},
                }
            }
        }
    }
    next.run(request).await
}

#[cfg(test)]
mod tests;
