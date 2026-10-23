use crate::ApiError;
use axum::{
    Json,
    extract::{Path, State},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, types::Json as DbJson};
use uuid::Uuid;
pub fn valid_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 63
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && s.as_bytes()[0].is_ascii_alphanumeric()
}
pub async fn list(State(pool): State<PgPool>) -> Result<Json<Value>, ApiError> {
    let items:Vec<DbJson<Value>>=sqlx::query_scalar("SELECT jsonb_build_object('id',p.id,'name',p.name,'environments',(SELECT count(*) FROM environments e WHERE e.project_id=p.id),'services',(SELECT count(DISTINCT s.name) FROM services s JOIN environments e ON e.id=s.environment_id WHERE e.project_id=p.id)) FROM projects p ORDER BY p.name").fetch_all(&pool).await?;
    Ok(Json(json!({"items":items})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Create {
    name: String,
}
pub async fn create(
    State(pool): State<PgPool>,
    Json(input): Json<Create>,
) -> Result<Json<Value>, ApiError> {
    if !valid_name(&input.name) {
        return Err(ApiError::Conflict(
            "use a lowercase project name up to 63 characters",
        ));
    }
    let mut tx = pool.begin().await?;
    let id:Uuid=sqlx::query_scalar("INSERT INTO projects(id,name) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id").bind(Uuid::new_v4()).bind(&input.name).fetch_one(&mut *tx).await?;
    for name in ["production", "development"] {
        sqlx::query(
            "INSERT INTO environments(id,project_id,name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        )
        .bind(Uuid::new_v4())
        .bind(id)
        .bind(name)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"id":id,"name":input.name})))
}
pub async fn get(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let name: String = sqlx::query_scalar("SELECT name FROM projects WHERE id=$1")
        .bind(id)
        .fetch_optional(&pool)
        .await?
        .ok_or(ApiError::NotFound)?;
    let envs:Vec<DbJson<Value>>=sqlx::query_scalar("SELECT jsonb_build_object('id',e.id,'project',$2::text,'name',e.name,'parent_id',e.parent_id,'parent_name',p.name,'service_count',(SELECT count(*) FROM services s WHERE s.environment_id=e.id)) FROM environments e LEFT JOIN environments p ON p.id=e.parent_id WHERE e.project_id=$1 ORDER BY e.name").bind(id).bind(&name).fetch_all(&pool).await?;
    Ok(Json(json!({"id":id,"name":name,"environments":envs})))
}
