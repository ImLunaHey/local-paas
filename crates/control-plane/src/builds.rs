//! Durable build requests. HTTP handlers only persist intent; a separate worker executes it.
use crate::{ApiError, Service};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use platform_domain::{ImageDigest, ServiceSpec, Workload, commit_hash};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Transaction, types::Json as DbJson};
use uuid::Uuid;

pub const LOG_LIMIT: usize = 512 * 1024;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Build {
    pub id: Uuid,
    pub service_id: Uuid,
    pub operation_id: Uuid,
    pub spec: DbJson<ServiceSpec>,
    pub no_cache: bool,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing)]
    pub claim_token: Option<Uuid>,
    #[serde(skip_serializing)]
    pub lease_until: Option<DateTime<Utc>>,
    pub cancel_requested: bool,
    pub error_code: Option<String>,
    pub log_bytes: i32,
    pub logs_truncated: bool,
    pub resolved_commit: Option<String>,
    pub build_plan: Option<DbJson<platform_build_runner::BuildPlan>>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CreateBuild {
    pub operation_id: Uuid,
    #[serde(default)]
    pub no_cache: bool,
    /// A new source revision can be built without mutating the service's original spec.
    pub commit: Option<String>,
    pub branch: Option<String>,
    pub tag: Option<String>,
}

pub(crate) async fn create(
    State(pool): State<PgPool>,
    Path(service_id): Path<Uuid>,
    Json(request): Json<CreateBuild>,
) -> Result<(StatusCode, Json<Build>), ApiError> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(request.operation_id.to_string())
        .execute(&mut *tx)
        .await?;
    let request_json = serde_json::to_value(&request).map_err(|_| ApiError::Database)?;
    if let Some(existing) =
        sqlx::query_as::<_, Build>("SELECT * FROM builds WHERE operation_id = $1")
            .bind(request.operation_id)
            .fetch_optional(&mut *tx)
            .await?
    {
        let original: Option<serde_json::Value> =
            sqlx::query_scalar("SELECT request_json FROM builds WHERE id = $1")
                .bind(existing.id)
                .fetch_one(&mut *tx)
                .await?;
        let same = if let Some(original) = original {
            original == request_json
        } else {
            // Legacy requests predate configuration editing. Compare any explicit
            // override to their immutable snapshot, never today's service spec.
            let mut source = existing.spec.source.clone();
            if request.commit.is_some() || request.branch.is_some() || request.tag.is_some() {
                source.commit = request.commit.clone();
                source.branch = request.branch.clone();
                source.tag = request.tag.clone();
            }
            source == existing.spec.source && existing.no_cache == request.no_cache
        };
        if existing.service_id != service_id || !same {
            return Err(ApiError::Conflict(
                "build operation ID was already used with different input",
            ));
        }
        tx.commit().await?;
        return Ok((StatusCode::OK, Json(existing)));
    }
    let service = sqlx::query_as::<_, Service>(
        "SELECT id, operation_id, spec, created_at, version FROM services WHERE id = $1 FOR UPDATE",
    )
    .bind(service_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ApiError::NotFound)?;
    let mut spec = service.spec.0;
    if request.commit.is_some() || request.branch.is_some() || request.tag.is_some() {
        spec.source.commit = request.commit;
        spec.source.branch = request.branch;
        spec.source.tag = request.tag;
    }
    spec.validate().map_err(ApiError::Invalid)?;
    crate::source_uploads::validate_scope(&mut tx, &spec).await?;
    if !matches!(
        spec.workload,
        Workload::OciService { .. }
            | Workload::PostgresService { .. }
            | Workload::RedisService { .. }
            | Workload::RustfsService { .. }
    ) {
        return Err(ApiError::Conflict(
            "celld applications use a separate fleet deployment path; OCI builds are not supported",
        ));
    }
    let active: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM builds WHERE service_id = $1 AND status IN ('queued', 'running'))")
        .bind(service_id).fetch_one(&mut *tx).await?;
    if active {
        return Err(ApiError::Conflict(
            "this service already has a queued or running build",
        ));
    }
    let commit = spec.source.commit.clone();
    let build = sqlx::query_as::<_, Build>("INSERT INTO builds (id, service_id, operation_id, spec, no_cache, resolved_commit, request_json) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *")
        .bind(Uuid::now_v7()).bind(service_id).bind(request.operation_id).bind(DbJson(spec)).bind(request.no_cache).bind(commit).bind(request_json)
        .fetch_one(&mut *tx).await?;
    event(&mut tx, &build, "build.queued").await?;
    tx.commit().await?;
    Ok((StatusCode::ACCEPTED, Json(build)))
}

pub(crate) async fn list(
    State(pool): State<PgPool>,
    Path(service_id): Path<Uuid>,
) -> Result<Json<Vec<Build>>, ApiError> {
    ensure_service(&pool, service_id).await?;
    Ok(Json(
        sqlx::query_as(
            "SELECT * FROM builds WHERE service_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50",
        )
        .bind(service_id)
        .fetch_all(&pool)
        .await?,
    ))
}

pub(crate) async fn get(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<Build>, ApiError> {
    Ok(Json(
        sqlx::query_as("SELECT * FROM builds WHERE id = $1")
            .bind(id)
            .fetch_optional(&pool)
            .await?
            .ok_or(ApiError::NotFound)?,
    ))
}

pub(crate) async fn cancel(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<Build>, ApiError> {
    let mut tx = pool.begin().await?;
    let build: Build = sqlx::query_as("SELECT * FROM builds WHERE id = $1 FOR UPDATE")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(ApiError::NotFound)?;
    if matches!(build.status.as_str(), "queued" | "running") && !build.cancel_requested {
        sqlx::query("UPDATE builds SET cancel_requested = true, status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END, finished_at = CASE WHEN status = 'queued' THEN now() ELSE finished_at END WHERE id = $1")
            .bind(id).execute(&mut *tx).await?;
        event(
            &mut tx,
            &build,
            if build.status == "queued" {
                "build.cancelled"
            } else {
                "build.cancel_requested"
            },
        )
        .await?;
    }
    let updated = sqlx::query_as("SELECT * FROM builds WHERE id = $1")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(updated))
}

#[derive(Deserialize)]
pub struct LogCursor {
    #[serde(default)]
    after: i64,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Log {
    pub sequence: i64,
    pub message: String,
    pub created_at: DateTime<Utc>,
}

pub(crate) async fn logs(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Query(cursor): Query<LogCursor>,
) -> Result<Json<Value>, ApiError> {
    let build: Build = sqlx::query_as("SELECT * FROM builds WHERE id = $1")
        .bind(id)
        .fetch_optional(&pool)
        .await?
        .ok_or(ApiError::NotFound)?;
    let entries: Vec<Log> = sqlx::query_as("SELECT sequence, message, created_at FROM build_logs WHERE build_id = $1 AND sequence > $2 ORDER BY sequence LIMIT 128")
        .bind(id).bind(cursor.after).fetch_all(&pool).await?;
    let next = entries.last().map_or(cursor.after, |log| log.sequence);
    Ok(Json(
        json!({"entries":entries,"next_cursor":next,"truncated":build.logs_truncated}),
    ))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Revision {
    pub id: Uuid,
    pub service_id: Uuid,
    pub build_id: Uuid,
    pub spec: DbJson<ServiceSpec>,
    pub image_repository: String,
    pub image_digest: String,
    pub created_at: DateTime<Utc>,
}

pub(crate) async fn revisions(
    State(pool): State<PgPool>,
    Path(service_id): Path<Uuid>,
) -> Result<Json<Vec<Revision>>, ApiError> {
    ensure_service(&pool, service_id).await?;
    Ok(Json(sqlx::query_as("SELECT * FROM revisions WHERE service_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50")
        .bind(service_id).fetch_all(&pool).await?))
}

pub(crate) async fn system(State(pool): State<PgPool>) -> Result<Json<Value>, ApiError> {
    let online: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM build_workers WHERE last_seen > now() - interval '15 seconds')").fetch_one(&pool).await?;
    let database_runtime_ready:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM nodes WHERE last_seen>now()-interval '30 seconds' AND NOT cordoned AND capabilities @> ARRAY['databases-v1'])").fetch_one(&pool).await?;
    Ok(Json(
        json!({"worker_online":online,"database_runtime_ready":database_runtime_ready,"log_limit_bytes":LOG_LIMIT}),
    ))
}

async fn ensure_service(pool: &PgPool, id: Uuid) -> Result<(), ApiError> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM services WHERE id=$1)")
        .bind(id)
        .fetch_one(pool)
        .await?;
    if exists {
        Ok(())
    } else {
        Err(ApiError::NotFound)
    }
}

async fn event(
    tx: &mut Transaction<'_, Postgres>,
    build: &Build,
    kind: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO events (id, service_id, operation_id, kind, build_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (operation_id,kind) DO NOTHING")
        .bind(Uuid::now_v7()).bind(build.service_id).bind(build.operation_id).bind(kind).bind(build.id).execute(&mut **tx).await?;
    Ok(())
}

/// Atomic claim with a fencing token. Abandoned attempts are not retried silently.
pub async fn claim(pool: &PgPool) -> Result<Option<Build>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let build: Option<Build> = sqlx::query_as("UPDATE builds SET status='running', started_at=now(), claim_token=$1, lease_until=now()+interval '30 seconds' WHERE id=(SELECT id FROM builds WHERE status='queued' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *")
        .bind(Uuid::now_v7()).fetch_optional(&mut *tx).await?;
    if let Some(build) = &build {
        event(&mut tx, build, "build.started").await?;
    }
    tx.commit().await?;
    Ok(build)
}

pub async fn heartbeat(pool: &PgPool, worker_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO build_workers (id,last_seen) VALUES ($1,now()) ON CONFLICT (id) DO UPDATE SET last_seen=now()")
        .bind(worker_id).execute(pool).await?;
    Ok(())
}

/// Returns None when the lease is lost, otherwise whether cancellation was requested.
pub async fn renew(pool: &PgPool, build: &Build) -> Result<Option<bool>, sqlx::Error> {
    sqlx::query_scalar("UPDATE builds SET lease_until=now()+interval '30 seconds' WHERE id=$1 AND claim_token=$2 AND status='running' AND lease_until>now() RETURNING cancel_requested")
        .bind(build.id).bind(build.claim_token).fetch_optional(pool).await
}

/// Resolve once under the current claim; never move an already pinned job.
pub async fn record_resolution(
    pool: &PgPool,
    build: &Build,
    commit: &str,
) -> Result<bool, sqlx::Error> {
    if !commit_hash(commit) {
        return Ok(false);
    }
    let mut tx = pool.begin().await?;
    let updated = sqlx::query("UPDATE builds SET resolved_commit=$3 WHERE id=$1 AND claim_token=$2 AND status='running' AND lease_until>now() AND NOT cancel_requested AND (resolved_commit IS NULL OR resolved_commit=$3)")
        .bind(build.id).bind(build.claim_token).bind(commit).execute(&mut *tx).await?.rows_affected() == 1;
    if updated {
        // Idempotent resolution retries retain one audit event.
        sqlx::query("INSERT INTO events (id,service_id,operation_id,kind,build_id) VALUES ($1,$2,$3,'build.source_resolved',$4) ON CONFLICT (operation_id,kind) DO NOTHING")
            .bind(Uuid::now_v7()).bind(build.service_id).bind(build.operation_id).bind(build.id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(updated)
}

/// Retain the exact recipe before execution; only the live claim can write it.
pub async fn record_plan(
    pool: &PgPool,
    build: &Build,
    plan: &platform_build_runner::BuildPlan,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let updated = sqlx::query("UPDATE builds SET build_plan=$3 WHERE id=$1 AND claim_token=$2 AND status='running' AND lease_until>now() AND NOT cancel_requested AND (build_plan IS NULL OR build_plan=$3)")
        .bind(build.id).bind(build.claim_token).bind(DbJson(plan)).execute(&mut *tx).await?.rows_affected() == 1;
    if updated {
        sqlx::query("INSERT INTO events (id,service_id,operation_id,kind,build_id) VALUES ($1,$2,$3,'build.planned',$4) ON CONFLICT (operation_id,kind) DO NOTHING")
            .bind(Uuid::now_v7()).bind(build.service_id).bind(build.operation_id).bind(build.id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(updated)
}

pub async fn append_log(pool: &PgPool, build: &Build, message: &str) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    let bytes: Option<i32> = sqlx::query_scalar("SELECT log_bytes FROM builds WHERE id=$1 AND claim_token=$2 AND status='running' AND lease_until>now() FOR UPDATE")
        .bind(build.id).bind(build.claim_token).fetch_optional(&mut *tx).await?;
    if let Some(bytes) = bytes {
        // No terminal escapes or NULs. React renders this as text, never HTML.
        let clean: String = message
            .chars()
            .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
            .collect();
        let remaining = LOG_LIMIT.saturating_sub(bytes as usize);
        let mut end = remaining.min(clean.len());
        while !clean.is_char_boundary(end) {
            end -= 1;
        }
        if end > 0 {
            sqlx::query("INSERT INTO build_logs (build_id,message) VALUES ($1,$2)")
                .bind(build.id)
                .bind(&clean[..end])
                .execute(&mut *tx)
                .await?;
        }
        sqlx::query("UPDATE builds SET log_bytes=log_bytes+$2, logs_truncated=logs_truncated OR $3 WHERE id=$1")
            .bind(build.id).bind(end as i32).bind(end < clean.len()).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}

#[derive(Debug)]
pub enum Completion {
    Succeeded {
        repository: String,
        digest: ImageDigest,
    },
    Failed(&'static str),
    Cancelled,
}

/// The revision and successful build/event commit together, fenced by a live lease.
pub async fn finish(
    pool: &PgPool,
    build: &Build,
    completion: Completion,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let current: Option<Build> = sqlx::query_as("SELECT * FROM builds WHERE id=$1 AND claim_token=$2 AND status='running' AND lease_until>now() FOR UPDATE")
        .bind(build.id).bind(build.claim_token).fetch_optional(&mut *tx).await?;
    let Some(current) = current else {
        return Ok(false);
    };
    let completion = if current.cancel_requested {
        Completion::Cancelled
    } else {
        completion
    };
    let (status, error) = match &completion {
        Completion::Succeeded { .. } => ("succeeded", None),
        Completion::Failed(code) => ("failed", Some(*code)),
        Completion::Cancelled => ("cancelled", None),
    };
    if let Completion::Succeeded { repository, digest } = completion {
        let mut pinned = current.spec.0;
        if !pinned.workload.is_managed() && pinned.source.upload.is_none() {
            let commit = current.resolved_commit.ok_or_else(|| {
                sqlx::Error::Protocol("successful build has no resolved commit".into())
            })?;
            pinned.source.pin(commit);
        }
        sqlx::query("INSERT INTO revisions (id,service_id,build_id,spec,image_repository,image_digest) VALUES ($1,$2,$3,$4,$5,$6)")
            .bind(Uuid::now_v7()).bind(build.service_id).bind(build.id).bind(DbJson(pinned)).bind(repository).bind(String::from(digest)).execute(&mut *tx).await?;
    }
    sqlx::query(
        "UPDATE builds SET status=$2,error_code=$3,finished_at=now(),lease_until=NULL WHERE id=$1",
    )
    .bind(build.id)
    .bind(status)
    .bind(error)
    .execute(&mut *tx)
    .await?;
    event(&mut tx, build, &format!("build.{status}")).await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn expire(pool: &PgPool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    let builds: Vec<Build> = sqlx::query_as("UPDATE builds SET status='interrupted',error_code='worker_lease_expired',finished_at=now(),lease_until=NULL WHERE status='running' AND lease_until<=now() RETURNING *").fetch_all(&mut *tx).await?;
    for build in builds {
        event(&mut tx, &build, "build.interrupted").await?;
    }
    sqlx::query("DELETE FROM build_workers WHERE last_seen < now()-interval '1 day'")
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}
