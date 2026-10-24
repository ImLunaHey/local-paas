use crate::ApiError;
use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, types::Json as DbJson};
use uuid::Uuid;
#[derive(Deserialize)]
pub struct Cursor {
    before: Option<Uuid>,
}
pub async fn list(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Query(cursor): Query<Cursor>,
) -> Result<Json<Value>, ApiError> {
    let rows: Vec<DbJson<Value>> = sqlx::query_scalar("SELECT jsonb_build_object('id',d.id,'revision_id',d.revision_id,'status',d.status,'created_at',d.created_at,'instances',coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'node',n.name,'state',i.state,'diagnostic',i.diagnostic,'has_logs',EXISTS(SELECT 1 FROM runtime_log_keys k WHERE k.instance_id=i.id)) ORDER BY n.name,i.id) FROM instances i JOIN nodes n ON n.id=i.node_id WHERE i.deployment_id=d.id),'[]'::jsonb)) FROM deployments d WHERE d.service_id=$1 AND d.job_options IS NULL AND ($2::uuid IS NULL OR (d.created_at,d.id)<(SELECT created_at,id FROM deployments WHERE id=$2 AND service_id=$1)) ORDER BY d.created_at DESC,d.id DESC LIMIT 21")
        .bind(id).bind(cursor.before).fetch_all(&pool).await?;
    let more = rows.len() > 20;
    let rows: Vec<Value> = rows.into_iter().take(20).map(|r| r.0).collect();
    let cursor = if more {
        rows.last().map(|r| r["id"].clone())
    } else {
        None
    };
    Ok(Json(json!({"deployments":rows,"next_cursor":cursor})))
}
