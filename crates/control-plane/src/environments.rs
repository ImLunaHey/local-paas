use crate::ApiError;
use axum::{Json, extract::State};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, types::Json as DbJson};
use uuid::Uuid;
pub(crate) async fn list(State(pool): State<PgPool>) -> Result<Json<Value>, ApiError> {
    let items:Vec<DbJson<Value>>=sqlx::query_scalar("SELECT jsonb_build_object('id',e.id,'project',p.name,'name',e.name,'service_count',(SELECT count(*) FROM services s WHERE s.environment_id=e.id)) FROM environments e JOIN projects p ON p.id=e.project_id ORDER BY p.name,e.name").fetch_all(&pool).await?;
    Ok(Json(json!({"items":items})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Create {
    project: String,
    name: String,
}
pub(crate) async fn create(
    State(pool): State<PgPool>,
    Json(input): Json<Create>,
) -> Result<Json<Value>, ApiError> {
    fn valid(s: &str) -> bool {
        !s.is_empty()
            && s.len() <= 63
            && s.bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            && s.as_bytes()[0].is_ascii_alphanumeric()
    }
    if !valid(&input.project) || !valid(&input.name) {
        return Err(ApiError::Conflict(
            "project and environment must be lowercase names up to 63 characters",
        ));
    }
    let mut tx = pool.begin().await?;
    let project:Uuid=sqlx::query_scalar("INSERT INTO projects(id,name) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id").bind(Uuid::new_v4()).bind(&input.project).fetch_one(&mut *tx).await?;
    let id:Uuid=sqlx::query_scalar("INSERT INTO environments(id,project_id,name) VALUES($1,$2,$3) ON CONFLICT(project_id,name) DO UPDATE SET name=excluded.name RETURNING id").bind(Uuid::new_v4()).bind(project).bind(&input.name).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"id":id,"project":input.project,"name":input.name}),
    ))
}
