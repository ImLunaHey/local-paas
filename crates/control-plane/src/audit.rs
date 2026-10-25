use crate::ApiError;
use axum::{
    Extension, Json,
    extract::{MatchedPath, Query, Request, State},
    http::{HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, types::Json as DbJson};
use uuid::Uuid;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filters {
    before: Option<i64>,
    project: Option<Uuid>,
    environment: Option<Uuid>,
    actor: Option<String>,
    action: Option<String>,
    outcome: Option<String>,
    from: Option<chrono::DateTime<chrono::Utc>>,
    until: Option<chrono::DateTime<chrono::Utc>>,
}
pub async fn list(
    State(pool): State<PgPool>,
    Extension(context): Extension<crate::auth::Context>,
    Query(q): Query<Filters>,
) -> Result<Json<Value>, ApiError> {
    if [&q.actor, &q.action, &q.outcome]
        .into_iter()
        .flatten()
        .any(|s| s.len() > 128)
    {
        return Err(ApiError::Conflict("audit filter exceeds 128 characters"));
    }
    let rows:Vec<DbJson<Value>>=sqlx::query_scalar("SELECT jsonb_build_object('sequence',a.sequence,'requestId',a.request_id,'timestamp',a.timestamp,'actor',a.actor,'action',a.action,'outcome',a.outcome,'targetType',a.target_type,'targetId',a.target_id,'serviceId',a.service_id,'environmentId',a.environment_id,'projectId',a.project_id,'project',a.project,'environment',a.environment,'details',a.details) FROM (SELECT l.*,p.name AS project,e.name AS environment FROM audit_log l LEFT JOIN projects p ON p.id=l.project_id LEFT JOIN environments e ON e.id=l.environment_id WHERE ($9::text IS NULL OR coalesce(l.organization_id,p.organization_id)=$9) AND l.target_type IS DISTINCT FROM 'request' AND ($1::bigint IS NULL OR l.sequence<$1) AND ($2::uuid IS NULL OR l.project_id=$2) AND ($3::uuid IS NULL OR l.environment_id=$3) AND ($4::text IS NULL OR strpos(lower(l.actor),lower($4))>0) AND ($5::text IS NULL OR strpos(lower(l.action),lower($5))>0) AND ($6::text IS NULL OR l.outcome=$6) AND ($7::timestamptz IS NULL OR l.timestamp>=$7) AND ($8::timestamptz IS NULL OR l.timestamp<=$8) ORDER BY l.sequence DESC LIMIT 101) a").bind(q.before).bind(q.project).bind(q.environment).bind(q.actor).bind(q.action).bind(q.outcome).bind(q.from).bind(q.until).bind(context.organization_id.as_deref()).fetch_all(&pool).await?;
    let more = rows.len() > 100;
    let rows: Vec<Value> = rows.into_iter().take(100).map(|r| r.0).collect();
    let next = if more {
        rows.last().map(|r| r["sequence"].clone())
    } else {
        None
    };
    Ok(Json(json!({"entries":rows,"nextCursor":next})))
}
pub async fn record_action(State(pool): State<PgPool>, request: Request, next: Next) -> Response {
    let request_id = Uuid::now_v7();
    let method = request.method().to_string();
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map(|p| p.as_str())
        .unwrap_or("unmatched")
        .to_string();
    let action = match (method.as_str(), route.as_str()) {
        ("POST", "/api/source-uploads") => "source.upload",
        ("POST", "/api/source-connections") => "source.connection.create",
        ("GET", "/api/services/{id}/storage/files" | "/api/services/{id}/volume/files")
            if request
                .uri()
                .query()
                .is_some_and(|q| q.split('&').any(|p| p == "download=true")) =>
        {
            "storage.file.download"
        }
        ("PUT", "/api/services/{id}/storage/files" | "/api/services/{id}/volume/files") => {
            "storage.file.upload"
        }
        ("POST", "/api/volumes") => "volume.create",
        ("POST", "/api/services/{id}/buckets") => "bucket.create",
        ("DELETE", "/api/services/{id}/storage-connection") => "bucket.detach",
        ("POST", "/api/services/{id}/storage-connection") => "bucket.attach",
        ("POST", "/api/projects") => "project.create",
        ("POST", "/api/domains") => "domain.register",
        ("POST", "/api/services/{id}/database-connection") => "database.connect",
        ("PUT", "/api/domains/{hostname}") => "domain.assign",
        ("PUT", "/api/projects/{id}") => "project.configure",
        ("POST", "/api/environments") => "environment.create",
        ("POST", "/api/services") => "service.create",
        ("PUT", "/api/services/{id}") => "service.configure",
        ("PUT", "/api/services/{id}/networking") => "service.networking.configure",
        ("PUT", "/api/services/{id}/secrets") => "secret.update",
        ("POST", "/api/services/{id}/builds") => "build.request",
        ("POST", "/api/builds/{id}/cancel") => "build.cancel",
        ("POST", "/api/services/{id}/deployments") => "deployment.request",
        ("POST", "/api/deployments/{id}/stop") => "deployment.stop",
        ("POST", "/api/agent/secrets") => "workload.secrets.deliver",
        _ => return next.run(request).await,
    };
    let segments: Vec<&str> = request.uri().path().split('/').collect();
    let target = segments.get(3).and_then(|s| s.parse::<Uuid>().ok());
    let service = match (segments.get(2).copied(), target) {
        (Some("services"), id) => id,
        (Some("builds"), Some(id)) => {
            sqlx::query_scalar("SELECT service_id FROM builds WHERE id=$1")
                .bind(id)
                .fetch_optional(&pool)
                .await
                .ok()
                .flatten()
        }
        (Some("deployments"), Some(id)) => {
            sqlx::query_scalar("SELECT service_id FROM deployments WHERE id=$1")
                .bind(id)
                .fetch_optional(&pool)
                .await
                .ok()
                .flatten()
        }
        _ => None,
    };
    let scope: Option<(Uuid, Uuid)> = if let Some(id) = service {
        sqlx::query_as("SELECT s.environment_id,e.project_id FROM services s JOIN environments e ON e.id=s.environment_id WHERE s.id=$1").bind(id).fetch_optional(&pool).await.ok().flatten()
    } else {
        None
    };
    let project = scope.map(|s| s.1).or_else(|| {
        (segments.get(2) == Some(&"projects"))
            .then_some(target)
            .flatten()
    });
    let operator = request.extensions().get::<crate::auth::Context>().cloned();
    let actor = if route.starts_with("/api/agent/") {
        let hash = request
            .headers()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(crate::runtime::token_hash);
        let node: Option<Uuid> = if let Some(hash) = hash {
            sqlx::query_scalar("SELECT id FROM nodes WHERE token_hash=$1")
                .bind(hash)
                .fetch_optional(&pool)
                .await
                .ok()
                .flatten()
        } else {
            None
        };
        node.map(|n| format!("node:{n}"))
            .unwrap_or("unauthenticated node".into())
    } else if let Some(operator) = &operator {
        operator.audit_actor()
    } else {
        "unauthenticated operator".into()
    };
    let organization = operator.and_then(|operator| operator.organization_id);

    let insert = |outcome: &'static str, details: Value| {
        sqlx::query("INSERT INTO audit_log(request_id,actor,action,outcome,target_type,target_id,service_id,environment_id,project_id,organization_id,details) VALUES($1,$2,$3,$4,'action',$5,$6,$7,$8,$9,$10)").bind(request_id).bind(&actor).bind(action).bind(outcome).bind(target.map(|v|v.to_string())).bind(service).bind(scope.map(|s|s.0)).bind(project).bind(&organization).bind(DbJson(details))
    };
    if insert("requested", json!({})).execute(&pool).await.is_err() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"code":"audit_unavailable","error":"audit storage unavailable; request was not executed"})),
        )
            .into_response();
    }

    let mut response = next.run(request).await;
    let outcome = if response.status().is_success() {
        "succeeded"
    } else {
        "failed"
    };
    if insert(outcome, json!({})).execute(&pool).await.is_err() {
        tracing::error!(%request_id, "could not complete audit record; requested entry remains");
    }
    response.headers_mut().insert(
        "x-request-id",
        HeaderValue::from_str(&request_id.to_string()).expect("UUID is a valid header"),
    );
    response
}
