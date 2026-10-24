use crate::ApiError;
use axum::{
    Json,
    body::Bytes,
    extract::{Query, Request, State},
    http::{HeaderMap, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Transaction};
use std::{io::Write, os::unix::fs::PermissionsExt};
use tokio::sync::Semaphore;
use uuid::Uuid;
static UPLOADS: Semaphore = Semaphore::const_new(2);
static VALIDATORS: Semaphore = Semaphore::const_new(2);
static WRITER: std::sync::Mutex<()> = std::sync::Mutex::new(());
pub async fn limit(request: Request, next: Next) -> Response {
    let Ok(_permit) = UPLOADS.try_acquire() else {
        return ApiError::Unavailable("source uploads are busy; retry shortly").into_response();
    };
    next.run(request).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Scope {
    project: String,
}
pub async fn upload(
    State(pool): State<PgPool>,
    Query(scope): Query<Scope>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    if headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        != Some("application/zip")
    {
        return Err(ApiError::Conflict("upload an application/zip archive"));
    }
    let project: Uuid = sqlx::query_scalar("SELECT id FROM projects WHERE name=$1")
        .bind(&scope.project)
        .fetch_optional(&pool)
        .await?
        .ok_or(ApiError::NotFound)?;
    let size = body.len();
    let data = body.clone();
    let permit = VALIDATORS
        .try_acquire()
        .map_err(|_| ApiError::Unavailable("source validators are busy; retry shortly"))?;
    let summary = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        platform_sources::inspect(&data, None)
    })
    .await
    .map_err(|_| ApiError::Unavailable("source validation interrupted"))?
    .map_err(|e| ApiError::Conflict(e.0))?;
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(712184562)")
        .execute(&mut *tx)
        .await?;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM source_uploads WHERE project_id=$1 AND digest=$2)",
    )
    .bind(project)
    .bind(&summary.digest)
    .fetch_one(&mut *tx)
    .await?;
    if !exists {
        let total: i64 = sqlx::query_scalar(
            "SELECT coalesce(sum(archive_bytes),0)::bigint FROM source_uploads WHERE project_id=$1",
        )
        .bind(project)
        .fetch_one(&mut *tx)
        .await?;
        if total + size as i64 > 256 * 1024 * 1024 {
            return Err(ApiError::Conflict(
                "project source archives exceed the 256 MiB development quota",
            ));
        }
    }
    let digest = summary.digest.clone();
    tokio::task::spawn_blocking(move || -> Result<(), ApiError> {
        // Cancellation must not release filesystem quota serialization while a
        // blocking write continues after its request/transaction is dropped.
        let _writer = WRITER
            .lock()
            .map_err(|_| ApiError::Unavailable("source writer unavailable"))?;
        let root = platform_sources::root();
        std::fs::create_dir_all(&root)
            .map_err(|_| ApiError::Unavailable("source storage unavailable"))?;
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| ApiError::Database)?;
        let path = platform_sources::path(&digest).map_err(|_| ApiError::Database)?;
        if path.exists() {
            return Ok(());
        }
        let total: u64 = std::fs::read_dir(&root)
            .map_err(|_| ApiError::Database)?
            .filter_map(Result::ok)
            .filter_map(|e| e.metadata().ok())
            .map(|m| m.len())
            .sum();
        if total + size as u64 > 1024 * 1024 * 1024 {
            return Err(ApiError::Conflict(
                "source storage exceeds the 1 GiB development quota",
            ));
        }
        let mut file = tempfile::NamedTempFile::new_in(&root).map_err(|_| ApiError::Database)?;
        file.write_all(&body)
            .map_err(|_| ApiError::Unavailable("source storage full"))?;
        file.as_file().sync_all().map_err(|_| ApiError::Database)?;
        file.as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o400))
            .map_err(|_| ApiError::Database)?;
        file.persist_noclobber(path)
            .map_err(|_| ApiError::Unavailable("source archive persistence failed"))?;
        std::fs::File::open(root)
            .and_then(|f| f.sync_all())
            .map_err(|_| ApiError::Database)?;
        Ok(())
    })
    .await
    .map_err(|_| ApiError::Unavailable("source persistence interrupted"))??;
    sqlx::query("INSERT INTO source_uploads(project_id,digest,archive_bytes,expanded_bytes,file_count) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING").bind(project).bind(&summary.digest).bind(size as i64).bind(summary.expanded as i64).bind(summary.files as i32).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"digest":summary.digest,"files":summary.files,"expanded_bytes":summary.expanded,"archive_bytes":size}),
    ))
}
pub async fn validate_scope(
    tx: &mut Transaction<'_, Postgres>,
    spec: &platform_domain::ServiceSpec,
) -> Result<(), ApiError> {
    if let Some(digest) = &spec.source.upload {
        let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM source_uploads u JOIN projects p ON p.id=u.project_id WHERE p.name=$1 AND u.digest=$2)").bind(&spec.project).bind(digest).fetch_one(&mut **tx).await?;
        if !exists {
            return Err(ApiError::Conflict(
                "upload this source to the service's project first",
            ));
        }
    }
    Ok(())
}
