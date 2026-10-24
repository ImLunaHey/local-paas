//! S3 browser uses the application's scoped identity, never the root storage key.
use crate::{ApiError, s3, secrets};
use axum::{
    Json,
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;
const LIMIT: usize = 16 * 1024 * 1024;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Browse {
    #[serde(default)]
    path: String,
    cursor: Option<String>,
    #[serde(default)]
    download: bool,
}
async fn connection(pool: &PgPool, id: Uuid) -> Result<(s3::Client, String, bool), ApiError> {
    let (port,bucket,readonly):(i32,String,bool)=sqlx::query_as("SELECT n.endpoint_base+v.slot,b.name,c.read_only FROM storage_bindings c JOIN storage_buckets b ON b.id=c.bucket_id JOIN volumes v ON v.id=b.service_id JOIN nodes n ON n.id=v.node_id WHERE c.service_id=$1 AND c.status='ready'").bind(id).fetch_optional(pool).await?.ok_or(ApiError::Conflict("attach an S3 bucket before browsing it"))?;
    let (_, values) = secrets::own_values(pool, id).await?;
    let credential = |key| {
        values.get(key).cloned().ok_or(ApiError::Conflict(
            "restore the storage credentials in OpenBao",
        ))
    };
    Ok((
        s3::Client::new(
            port,
            credential("AWS_ACCESS_KEY_ID")?,
            credential("AWS_SECRET_ACCESS_KEY")?,
        )?,
        bucket,
        readonly,
    ))
}
fn path(bucket: &str, key: &str) -> Result<String, ApiError> {
    if key.len() > 1024
        || key.chars().any(char::is_control)
        || key.starts_with('/')
        || key.split('/').any(|p| p == "." || p == "..")
    {
        return Err(ApiError::Conflict("invalid object path"));
    }
    let mut u = reqwest::Url::parse("http://storage/").map_err(|_| ApiError::Database)?;
    u.path_segments_mut()
        .map_err(|_| ApiError::Database)?
        .pop_if_empty()
        .push(bucket)
        .extend(key.split('/'));
    Ok(u.path().into())
}
async fn bounded(mut r: reqwest::Response, max: usize) -> Result<Vec<u8>, ApiError> {
    if r.content_length().is_some_and(|n| n > max as u64) {
        return Err(ApiError::Conflict(
            "file exceeds the browser's 16 MiB transfer limit",
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = r
        .chunk()
        .await
        .map_err(|_| ApiError::Unavailable("storage transfer interrupted"))?
    {
        if bytes.len() + chunk.len() > max {
            return Err(ApiError::Conflict(
                "storage response exceeds transfer limit",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
#[derive(Deserialize, Default)]
#[serde(rename_all = "PascalCase")]
struct Listing {
    #[serde(default)]
    contents: Vec<Object>,
    #[serde(default)]
    common_prefixes: Vec<Prefix>,
    next_continuation_token: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Object {
    key: String,
    size: u64,
    last_modified: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Prefix {
    prefix: String,
}
pub async fn get(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Query(query): Query<Browse>,
) -> Result<Response, ApiError> {
    let (client, bucket, readonly) = connection(&pool, id).await?;
    let resource = path(&bucket, &query.path)?;
    if query.download {
        let r = client
            .request(reqwest::Method::GET, &resource, vec![])
            .await?;
        if !r.status().is_success() {
            return Err(ApiError::Conflict(
                "object is unavailable or access was denied",
            ));
        }
        let bytes = bounded(r, LIMIT).await?;
        return Ok((
            [
                (header::CONTENT_TYPE, "application/octet-stream"),
                (header::CONTENT_DISPOSITION, "attachment"),
                (header::CACHE_CONTROL, "no-store"),
                (
                    header::HeaderName::from_static("x-content-type-options"),
                    "nosniff",
                ),
            ],
            bytes,
        )
            .into_response());
    }
    let mut u =
        reqwest::Url::parse(&format!("http://storage/{bucket}")).map_err(|_| ApiError::Database)?;
    {
        let mut p = u.query_pairs_mut();
        p.append_pair("list-type", "2")
            .append_pair("delimiter", "/")
            .append_pair("max-keys", "200")
            .append_pair("prefix", &query.path);
        if let Some(cursor) = query.cursor {
            if cursor.len() > 4096 {
                return Err(ApiError::Conflict("invalid listing cursor"));
            }
            p.append_pair("continuation-token", &cursor);
        }
    }
    let resource = format!("{}?{}", u.path(), u.query().unwrap_or_default());
    let r = client
        .request(reqwest::Method::GET, &resource, vec![])
        .await?;
    if !r.status().is_success() {
        return Err(ApiError::Conflict(
            "bucket is unavailable or access was denied",
        ));
    }
    let bytes = bounded(r, 1024 * 1024).await?;
    let listing: Listing = quick_xml::de::from_reader(bytes.as_slice())
        .map_err(|_| ApiError::Unavailable("invalid S3 listing"))?;
    let mut items: Vec<Value> = listing
        .common_prefixes
        .into_iter()
        .map(|p| json!({"path":p.prefix,"kind":"directory"}))
        .collect();
    items.extend(
        listing
            .contents
            .into_iter()
            .filter(|o| o.key != query.path)
            .map(|o| json!({"path":o.key,"kind":"file","size":o.size,"modified":o.last_modified})),
    );
    Ok(Json(json!({"items":items,"cursor":listing.next_continuation_token,"readOnly":readonly,"limitBytes":LIMIT})).into_response())
}
pub async fn upload(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Query(query): Query<Browse>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    if headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        != Some("application/octet-stream")
        || body.len() > LIMIT
        || query.path.is_empty()
    {
        return Err(ApiError::Conflict(
            "upload a binary file up to 16 MiB with a filename",
        ));
    }
    let (client, bucket, readonly) = connection(&pool, id).await?;
    if readonly {
        return Err(ApiError::Conflict("this storage attachment is read only"));
    }
    let resource = path(&bucket, &query.path)?;
    let r = client
        .request_headers(
            reqwest::Method::PUT,
            &resource,
            body.to_vec(),
            &[("if-none-match", "*")],
        )
        .await?;
    if r.status() == StatusCode::PRECONDITION_FAILED || r.status() == StatusCode::CONFLICT {
        return Err(ApiError::Conflict(
            "a file with that name already exists; choose another name",
        ));
    }
    if !r.status().is_success() {
        return Err(ApiError::Unavailable("object upload failed"));
    }
    Ok(Json(json!({"uploaded":true})))
}
