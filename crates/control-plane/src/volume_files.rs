//! Bounded in-memory file RPC; the owning agent keeps filesystem authority.
use crate::{ApiError, Service};
use axum::{
    Json,
    body::Bytes,
    extract::{Path, Query, Request, State},
    http::{HeaderMap, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use platform_protocol::{FILE_LIMIT, FileAction, FilePoll, FileReply, FileResult, FileTask};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::{Semaphore, oneshot};
use uuid::Uuid;

static TRANSFERS: Semaphore = Semaphore::const_new(4);
static REPLIES: Semaphore = Semaphore::const_new(4);
static JOBS: LazyLock<Mutex<HashMap<Uuid, Job>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
#[derive(Clone)]
struct Scope {
    service: Uuid,
    version: i32,
    node: Uuid,
    volume: Uuid,
    read_only: bool,
}
struct Job {
    scope: Scope,
    task: Option<FileTask>,
    reply: oneshot::Sender<FileResult>,
    expires: Instant,
}
struct Cleanup(Uuid);
impl Drop for Cleanup {
    fn drop(&mut self) {
        if let Ok(mut jobs) = JOBS.lock() {
            jobs.remove(&self.0);
        }
    }
}
pub async fn limit(request: Request, next: Next) -> Response {
    let Ok(_permit) = TRANSFERS.try_acquire() else {
        return ApiError::Unavailable("file transfers are busy; retry shortly").into_response();
    };
    next.run(request).await
}
pub async fn limit_replies(request: Request, next: Next) -> Response {
    let Ok(_permit) = REPLIES.try_acquire() else {
        return ApiError::Unavailable("file replies are busy; retry shortly").into_response();
    };
    next.run(request).await
}
async fn scope(pool: &PgPool, id: Uuid) -> Result<Scope, ApiError> {
    let service: Service = sqlx::query_as("SELECT * FROM services WHERE id=$1")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(ApiError::NotFound)?;
    let volume = service.spec.volume.as_ref().ok_or(ApiError::Conflict(
        "attach a shared volume before browsing files",
    ))?;
    if !matches!(
        service.spec.workload,
        platform_domain::Workload::OciService { .. }
    ) {
        return Err(ApiError::Conflict(
            "only application volumes support file browsing",
        ));
    }
    let node:Uuid=sqlx::query_scalar("SELECT n.id FROM shared_volumes v JOIN nodes n ON n.id=v.node_id WHERE v.id=$1 AND v.environment_id=(SELECT environment_id FROM services WHERE id=$2) AND n.last_seen>now()-interval '30 seconds' AND 'volume-files-v1'=ANY(n.capabilities)").bind(volume.id).bind(id).fetch_optional(pool).await?.ok_or(ApiError::Unavailable("deploy an attached service and wait for its storage worker to support file browsing"))?;
    Ok(Scope {
        service: id,
        version: service.version,
        node,
        volume: volume.id,
        read_only: volume.read_only,
    })
}
async fn unchanged(pool: &PgPool, s: &Scope) -> Result<(), ApiError> {
    let current = scope(pool, s.service).await?;
    if current.version != s.version
        || current.volume != s.volume
        || current.node != s.node
        || current.read_only != s.read_only
    {
        return Err(ApiError::Conflict(
            "storage attachment changed; refresh before retrying",
        ));
    }
    Ok(())
}
async fn transfer(
    pool: &PgPool,
    s: &Scope,
    path: String,
    action: FileAction,
) -> Result<FileResult, ApiError> {
    let id = Uuid::now_v7();
    let (tx, rx) = oneshot::channel();
    let task = FileTask {
        id,
        volume_id: s.volume,
        read_only: s.read_only,
        expires_unix_ms: chrono::Utc::now().timestamp_millis() + 18000,
        path,
        action,
    };
    {
        let mut jobs = JOBS.lock().map_err(|_| ApiError::Database)?;
        jobs.retain(|_, j| j.expires > Instant::now());
        if jobs.len() >= 4 {
            return Err(ApiError::Unavailable(
                "file transfers are busy; retry shortly",
            ));
        }
        jobs.insert(
            id,
            Job {
                scope: s.clone(),
                task: Some(task),
                reply: tx,
                expires: Instant::now() + Duration::from_secs(20),
            },
        );
    }
    let _cleanup = Cleanup(id);
    let result = tokio::time::timeout(Duration::from_secs(20), rx)
        .await
        .map_err(|_| {
            ApiError::Unavailable(
                "file transfer timed out; refresh the folder before retrying an upload",
            )
        })?
        .map_err(|_| ApiError::Unavailable("file transfer interrupted; refresh before retrying"))?;
    unchanged(pool, s).await?;
    if let FileResult::Failed { code } = &result {
        return Err(ApiError::Conflict(match code.as_str() {
            "already_exists" => "a file with that name already exists; choose another name",
            "read_only" => "this volume attachment is read only",
            "file_limit" => "file exceeds the browser's 16 MiB transfer limit",
            "listing_limit" => "this directory exceeds the browser's 10,000-entry listing limit",
            "not_mounted" => "the volume is not mounted; deploy an attached service first",
            "path_unavailable" | "invalid_path" | "not_regular_file" => {
                "path unavailable; only regular files and directories inside this volume are accessible"
            }
            _ => "file transfer failed; check worker health and available volume space",
        }));
    }
    Ok(result)
}
async fn authenticate(pool: &PgPool, headers: &HeaderMap, node: Uuid) -> Result<(), ApiError> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .filter(|t| t.len() == 64)
        .ok_or(ApiError::Unauthorized)?;
    let valid: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM nodes WHERE id=$1 AND token_hash=$2)")
            .bind(node)
            .bind(crate::runtime::token_hash(token))
            .fetch_one(pool)
            .await?;
    if !valid {
        return Err(ApiError::Unauthorized);
    }
    Ok(())
}
pub async fn poll(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<FilePoll>,
) -> Result<Json<Option<FileTask>>, ApiError> {
    authenticate(&pool, &headers, input.node_id).await?;
    let next = {
        let mut jobs = JOBS.lock().map_err(|_| ApiError::Database)?;
        jobs.retain(|_, j| j.expires > Instant::now());
        jobs.values_mut()
            .find(|j| j.scope.node == input.node_id && j.task.is_some())
            .map(|j| {
                (
                    j.scope.clone(),
                    j.task.take().expect("selected pending task"),
                )
            })
    };
    if let Some((s, task)) = next {
        if unchanged(&pool, &s).await.is_err() {
            if let Some(job) = JOBS
                .lock()
                .map_err(|_| ApiError::Database)?
                .remove(&task.id)
            {
                let _ = job.reply.send(FileResult::Failed {
                    code: "attachment_changed".into(),
                });
            }
            return Ok(Json(None));
        }
        Ok(Json(Some(task)))
    } else {
        Ok(Json(None))
    }
}
pub async fn reply(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<FileReply>,
) -> Result<Json<Value>, ApiError> {
    authenticate(&pool, &headers, input.node_id).await?;
    let mut jobs = JOBS.lock().map_err(|_| ApiError::Database)?;
    let job = jobs.get(&input.id).ok_or(ApiError::NotFound)?;
    if job.scope.node != input.node_id || job.task.is_some() {
        return Err(ApiError::Unauthorized);
    }
    if let Some(job) = jobs.remove(&input.id) {
        let _ = job.reply.send(input.result);
    }
    Ok(Json(json!({"received":true})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct Browse {
    #[serde(default)]
    path: String,
    cursor: Option<usize>,
    #[serde(default)]
    download: bool,
}
fn validate(q: &Browse) -> Result<(), ApiError> {
    let p = q.path.trim_end_matches('/');
    if q.path.len() > 1024
        || q.path.starts_with('/')
        || q.path.contains('\\')
        || q.path.chars().any(char::is_control)
        || (!p.is_empty() && p.split('/').any(|p| p.is_empty() || p == "." || p == ".."))
        || q.cursor.is_some_and(|o| o > 10000)
    {
        return Err(ApiError::Conflict("invalid volume path or listing cursor"));
    }
    Ok(())
}
pub async fn get(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Query(q): Query<Browse>,
) -> Result<Response, ApiError> {
    validate(&q)?;
    let s = scope(&pool, id).await?;
    let result = transfer(
        &pool,
        &s,
        q.path,
        if q.download {
            FileAction::Download
        } else {
            FileAction::List {
                offset: q.cursor.unwrap_or(0),
            }
        },
    )
    .await?;
    match result {
        FileResult::Listing { items, cursor } if !q.download && items.len() <= 200 => Ok(Json(
            json!({"items":items,"cursor":cursor,"readOnly":s.read_only,"limitBytes":FILE_LIMIT}),
        )
        .into_response()),
        FileResult::Download { base64 }
            if q.download && base64.len() <= FILE_LIMIT.div_ceil(3) * 4 =>
        {
            let body = STANDARD
                .decode(base64)
                .map_err(|_| ApiError::Unavailable("invalid file response"))?;
            if body.len() > FILE_LIMIT {
                return Err(ApiError::Conflict("file exceeds transfer limit"));
            }
            Ok((
                [
                    (header::CONTENT_TYPE, "application/octet-stream"),
                    (header::CONTENT_DISPOSITION, "attachment"),
                    (header::CACHE_CONTROL, "no-store"),
                    (
                        header::HeaderName::from_static("x-content-type-options"),
                        "nosniff",
                    ),
                ],
                body,
            )
                .into_response())
        }
        _ => Err(ApiError::Unavailable("invalid file response")),
    }
}
pub async fn upload(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Query(q): Query<Browse>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    validate(&q)?;
    if q.path.is_empty()
        || q.path.ends_with('/')
        || q.download
        || q.cursor.is_some()
        || body.len() > FILE_LIMIT
        || headers
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            != Some("application/octet-stream")
    {
        return Err(ApiError::Conflict(
            "upload a binary file up to 16 MiB with a filename",
        ));
    }
    let s = scope(&pool, id).await?;
    if s.read_only {
        return Err(ApiError::Conflict("this volume attachment is read only"));
    }
    if !matches!(
        transfer(
            &pool,
            &s,
            q.path,
            FileAction::Upload {
                base64: STANDARD.encode(body)
            }
        )
        .await?,
        FileResult::Uploaded
    ) {
        return Err(ApiError::Unavailable("invalid upload response"));
    }
    Ok(Json(json!({"uploaded":true})))
}
