use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::{StatusCode, header, uri::Authority},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use platform_domain::{ServiceSpec, ValidationIssue};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{PgPool, types::Json as DbJson};
use uuid::Uuid;

mod audit;
#[cfg(test)]
mod backup_drills;
pub mod backups;
pub mod builds;
mod configuration;
mod database_inspection;
mod databases;
mod discovery;
mod domains;
mod environments;
mod history;
pub mod host_metrics;
pub mod jobs;
pub mod logging;
mod networking;
mod object_storage;
mod overview;
pub mod preview;
mod projects;
mod releases;
pub mod runtime;
mod s3;
pub mod secrets;
mod source_uploads;
mod storage_files;
mod volume_files;
mod volumes;

pub fn router(pool: PgPool, browser_origins: Vec<String>) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route(
            "/api/source-uploads",
            post(source_uploads::upload)
                .layer(DefaultBodyLimit::max(platform_sources::ARCHIVE_LIMIT))
                .layer(middleware::from_fn(source_uploads::limit)),
        )
        .route(
            "/api/services/{id}/volume/files",
            get(volume_files::get)
                .put(volume_files::upload)
                .layer(DefaultBodyLimit::max(platform_protocol::FILE_LIMIT))
                .layer(middleware::from_fn(volume_files::limit)),
        )
        .route("/api/agent/files/poll", post(volume_files::poll))
        .route(
            "/api/agent/files/result",
            post(volume_files::reply)
                .layer(DefaultBodyLimit::max(24 * 1024 * 1024))
                .layer(middleware::from_fn(volume_files::limit_replies)),
        )
        .route(
            "/api/services/{id}/database/inspect",
            get(database_inspection::get),
        )
        .route(
            "/api/services/{id}/storage/files",
            get(storage_files::get)
                .put(storage_files::upload)
                .layer(DefaultBodyLimit::max(16 * 1024 * 1024)),
        )
        .route(
            "/api/services/{id}/buckets",
            get(object_storage::list).post(object_storage::create),
        )
        .route(
            "/api/services/{id}/storage-connection",
            post(object_storage::connect).delete(object_storage::detach),
        )
        .route("/api/volumes", get(volumes::list).post(volumes::create))
        .route("/api/domains", get(domains::list).post(domains::create))
        .route(
            "/api/domains/{hostname}",
            axum::routing::put(domains::update),
        )
        .route("/api/overview", get(overview::get))
        .route("/api/hosts", get(overview::hosts))
        .route("/api/services/{id}/database", get(databases::get))
        .route(
            "/api/services/{id}/database-connection",
            post(databases::connect),
        )
        .route("/api/audit", get(audit::list))
        .route("/api/projects", get(projects::list).post(projects::create))
        .route(
            "/api/projects/{id}",
            get(projects::get).put(projects::update),
        )
        .route("/api/search", get(projects::search))
        .route(
            "/api/services/{id}/secrets",
            get(secrets::list).put(secrets::update),
        )
        .route("/api/agent/secrets", post(secrets::deliver))
        .route(
            "/api/environments",
            get(environments::list).post(environments::create),
        )
        .route("/api/services/{id}/private-network", get(discovery::list))
        .route(
            "/api/services/{id}/networking",
            get(networking::get).put(networking::update),
        )
        .route("/api/services", get(list_services).post(create_service))
        .route(
            "/api/services/{id}",
            get(get_service).put(configuration::update),
        )
        .route("/api/services/{id}/events", get(list_events))
        .route(
            "/api/services/{id}/deployments",
            get(history::list).post(runtime::deploy),
        )
        .route("/api/deployments/{id}/stop", post(runtime::stop))
        .route("/api/services/{id}/runtime", get(runtime::status))
        .route("/api/services/{id}/jobs", get(jobs::list).post(jobs::run))
        .route(
            "/api/services/{id}/job-schedule",
            axum::routing::put(jobs::schedule),
        )
        .route("/api/services/{id}/runtime/logs", get(logging::logs))
        .route("/api/log-storage", get(logging::status))
        .route("/api/services/{id}/runtime/metrics", get(runtime::metrics))
        .route(
            "/api/agent/sync",
            post(runtime::sync).layer(DefaultBodyLimit::max(512 * 1024)),
        )
        .route("/api/specs/validate", post(validate_spec))
        .route("/api/build-system", get(builds::system))
        .route(
            "/api/services/{id}/builds",
            get(builds::list).post(builds::create),
        )
        .route("/api/services/{id}/revisions", get(builds::revisions))
        .route("/api/builds/{id}", get(builds::get))
        .route("/api/builds/{id}/logs", get(builds::logs))
        .route("/api/builds/{id}/cancel", post(builds::cancel))
        .layer(DefaultBodyLimit::max(64 * 1024))
        .layer(middleware::from_fn(move |request: Request, next: Next| {
            let origins = browser_origins.clone();
            async move {
                // Reject rebinding hostnames even for reads. This local API is
                // not an authenticated network service.
                let local_host = request
                    .headers()
                    .get(header::HOST)
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<Authority>().ok())
                    .is_some_and(|authority| {
                        matches!(authority.host(), "localhost" | "127.0.0.1" | "[::1]")
                    });
                if !local_host {
                    return (
                        StatusCode::FORBIDDEN,
                        Json(json!({"error":"local Host header required"})),
                    )
                        .into_response();
                }
                // JSON-only mutations and no CORS block cross-site form writes.
                // Also reject explicit untrusted browser origins, including null.
                if request.headers().get(header::ORIGIN).is_some_and(|value| {
                    !origins
                        .iter()
                        .any(|origin| value.as_bytes() == origin.as_bytes())
                }) {
                    return (
                        StatusCode::FORBIDDEN,
                        Json(json!({"error":"untrusted browser origin"})),
                    )
                        .into_response();
                }
                let secrets = request.uri().path().ends_with("/secrets")
                    || request.uri().path().starts_with("/api/agent/files/")
                    || request.uri().path().ends_with("/database/inspect")
                    || request.uri().path().ends_with("/files");
                let mut response = next.run(request).await;
                if secrets {
                    response.headers_mut().insert(
                        header::CACHE_CONTROL,
                        header::HeaderValue::from_static("no-store"),
                    );
                }
                response
            }
        }))
        .layer(middleware::from_fn_with_state(
            pool.clone(),
            audit::record_action,
        ))
        .with_state(pool)
}

pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!().run(pool).await
}

pub enum ApiError {
    Unauthorized,
    Invalid(Vec<ValidationIssue>),
    Conflict(&'static str),
    NotFound,
    Database,
    Unavailable(&'static str),
}

impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        if error
            .as_database_error()
            .is_some_and(|e| e.is_unique_violation())
        {
            Self::Conflict("a service with this project, environment and name already exists")
        } else {
            // Avoid logging database statements/details that may contain submitted data.
            tracing::error!("database operation failed");
            Self::Database
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, value) = match self {
            Self::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                json!({"error":"valid workload identity required"}),
            ),
            Self::Unavailable(message) => {
                (StatusCode::SERVICE_UNAVAILABLE, json!({"error":message}))
            }
            Self::Invalid(issues) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({"error":"invalid service specification", "issues":issues}),
            ),
            Self::Conflict(message) => (StatusCode::CONFLICT, json!({"error":message})),
            Self::NotFound => (StatusCode::NOT_FOUND, json!({"error":"service not found"})),
            Self::Database => (
                StatusCode::SERVICE_UNAVAILABLE,
                json!({"error":"Could not access the platform database. Please try again shortly."}),
            ),
        };
        (status, Json(value)).into_response()
    }
}

#[derive(Debug, Deserialize, Serialize, sqlx::FromRow)]
pub struct Service {
    pub id: Uuid,
    pub operation_id: Uuid,
    pub version: i32,
    pub spec: DbJson<ServiceSpec>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CreateService {
    pub operation_id: Uuid,
    pub spec: ServiceSpec,
    #[serde(default = "default_build_on_create")]
    pub build_on_create: bool,
}
fn default_build_on_create() -> bool {
    true
}

async fn health(State(pool): State<PgPool>) -> Result<Json<serde_json::Value>, ApiError> {
    sqlx::query("SELECT 1").execute(&pool).await?;
    Ok(Json(
        json!({"status":"ok", "mode":"local-development", "capabilities":["service-registration", "build-queue", "image-revisions"]}),
    ))
}

async fn validate_spec(Json(spec): Json<ServiceSpec>) -> Result<Json<serde_json::Value>, ApiError> {
    spec.validate().map_err(ApiError::Invalid)?;
    Ok(Json(json!({"valid":true})))
}

#[derive(Deserialize)]
struct Pagination {
    #[serde(default)]
    offset: u32,
    project: Option<String>,
    environment: Option<String>,
}

async fn list_services(
    State(pool): State<PgPool>,
    Query(page): Query<Pagination>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let items = sqlx::query_as::<_, Service>("SELECT id, operation_id, spec, created_at, version FROM services WHERE ($2::text IS NULL OR spec->>'project'=$2) AND ($3::text IS NULL OR spec->>'environment'=$3) ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET $1")
        .bind(i64::from(page.offset)).bind(&page.project).bind(&page.environment).fetch_all(&pool).await?;
    let total: i64 = sqlx::query_scalar("SELECT count(*) FROM services WHERE ($1::text IS NULL OR spec->>'project'=$1) AND ($2::text IS NULL OR spec->>'environment'=$2)")
        .bind(&page.project).bind(&page.environment)
        .fetch_one(&pool)
        .await?;
    Ok(Json(json!({"items":items,"total":total})))
}

async fn get_service(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<Service>, ApiError> {
    sqlx::query_as::<_, Service>(
        "SELECT id, operation_id, spec, created_at, version FROM services WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&pool)
    .await?
    .map(Json)
    .ok_or(ApiError::NotFound)
}

#[derive(Serialize, sqlx::FromRow)]
struct Event {
    id: Uuid,
    operation_id: Uuid,
    kind: String,
    created_at: DateTime<Utc>,
}

async fn list_events(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<Event>>, ApiError> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM services WHERE id = $1)")
        .bind(id)
        .fetch_one(&pool)
        .await?;
    if !exists {
        return Err(ApiError::NotFound);
    }
    Ok(Json(sqlx::query_as::<_, Event>("SELECT id, operation_id, kind, created_at FROM events WHERE service_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100")
        .bind(id).fetch_all(&pool).await?))
}

async fn create_service(
    State(pool): State<PgPool>,
    Json(request): Json<CreateService>,
) -> Result<(StatusCode, Json<Service>), ApiError> {
    request.spec.validate().map_err(ApiError::Invalid)?;
    let mut tx = pool.begin().await?;
    domains::lock(&mut tx).await?;
    volumes::validate_scope(&mut tx, &request.spec).await?;
    discovery::validate(&mut tx, &request.spec).await?;
    source_uploads::validate_scope(&mut tx, &request.spec).await?;
    // Concurrent retries of the same operation must observe the first commit.
    // A hash collision only serializes two otherwise unrelated registrations.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(request.operation_id.to_string())
        .execute(&mut *tx)
        .await?;
    if let Some(existing) = sqlx::query_as::<_, Service>(
        "SELECT id, operation_id, spec, created_at, version FROM services WHERE operation_id = $1",
    )
    .bind(request.operation_id)
    .fetch_optional(&mut *tx)
    .await?
    {
        let registered: DbJson<ServiceSpec> =
            sqlx::query_scalar("SELECT registered_spec FROM services WHERE id = $1")
                .bind(existing.id)
                .fetch_one(&mut *tx)
                .await?;
        if registered.0 != request.spec {
            return Err(ApiError::Conflict(
                "operation ID was already used with a different specification",
            ));
        }
        tx.commit().await?;
        return Ok((StatusCode::OK, Json(existing)));
    }
    let project_id: Uuid = sqlx::query_scalar("INSERT INTO projects (id, name) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id")
        .bind(Uuid::new_v4()).bind(&request.spec.project).fetch_one(&mut *tx).await?;
    let environment_id: Uuid = sqlx::query_scalar("INSERT INTO environments (id, project_id, name) VALUES ($1, $2, $3) ON CONFLICT (project_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id")
        .bind(Uuid::new_v4()).bind(project_id).bind(&request.spec.environment).fetch_one(&mut *tx).await?;
    let service = sqlx::query_as::<_, Service>("INSERT INTO services (id, environment_id, name, kind, operation_id, spec, registered_spec) VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id, operation_id, spec, created_at, version")
        .bind(Uuid::new_v4()).bind(environment_id).bind(&request.spec.name).bind(request.spec.kind())
        .bind(request.operation_id).bind(DbJson(&request.spec)).fetch_one(&mut *tx).await?;
    domains::assign_service(&mut tx, service.id, &request.spec.domains).await?;
    sqlx::query("INSERT INTO events (id, service_id, operation_id, kind) VALUES ($1, $2, $3, 'service.registered')")
        .bind(Uuid::new_v4()).bind(service.id).bind(request.operation_id).execute(&mut *tx).await?;
    if request.build_on_create && service.spec.kind() != "celld-service" {
        let build_id = Uuid::new_v4();
        let build_request = builds::CreateBuild {
            operation_id: request.operation_id,
            no_cache: false,
            commit: None,
            branch: None,
            tag: None,
        };
        sqlx::query("INSERT INTO builds(id,service_id,operation_id,spec,no_cache,resolved_commit,request_json) VALUES($1,$2,$3,$4,false,$5,$6)")
            .bind(build_id).bind(service.id).bind(request.operation_id).bind(&service.spec)
            .bind(&service.spec.source.commit).bind(DbJson(&build_request)).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO events(id,service_id,operation_id,kind,build_id) VALUES($1,$2,$3,'build.queued',$4)")
            .bind(Uuid::new_v4()).bind(service.id).bind(request.operation_id).bind(build_id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(service)))
}
