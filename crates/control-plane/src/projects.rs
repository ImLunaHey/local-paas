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

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Update {
    name: String,
    expected_name: String,
}
pub async fn update(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(input): Json<Update>,
) -> Result<Json<Value>, ApiError> {
    if !valid_name(&input.name) {
        return Err(ApiError::Conflict(
            "use a lowercase project name up to 63 characters",
        ));
    }
    let mut tx = pool.begin().await?;
    let name: String = sqlx::query_scalar("SELECT name FROM projects WHERE id=$1 FOR UPDATE")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(ApiError::NotFound)?;
    if name != input.expected_name && name != input.name {
        return Err(ApiError::Conflict(
            "project changed; reload settings before saving",
        ));
    }
    let taken: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM projects WHERE name=$1 AND id<>$2)")
            .bind(&input.name)
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    if taken {
        return Err(ApiError::Conflict("another project already uses this name"));
    }
    if name != input.name {
        sqlx::query("UPDATE projects SET name=$2 WHERE id=$1")
            .bind(id)
            .bind(&input.name)
            .execute(&mut *tx)
            .await?;
        // Desired configuration follows the new name; historical build/deployment snapshots remain immutable.
        sqlx::query("UPDATE services SET spec=jsonb_set(spec,'{project}',to_jsonb($2::text)),version=version+1 WHERE environment_id IN (SELECT id FROM environments WHERE project_id=$1)").bind(id).bind(&input.name).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"id":id,"name":input.name})))
}
#[derive(Deserialize)]
pub struct Search {
    #[serde(default)]
    q: String,
}
pub async fn search(
    State(pool): State<PgPool>,
    axum::extract::Query(input): axum::extract::Query<Search>,
) -> Result<Json<Value>, ApiError> {
    if input.q.len() > 128 {
        return Err(ApiError::Conflict("search must be at most 128 characters"));
    }
    let items:Vec<DbJson<Value>>=sqlx::query_scalar("SELECT to_jsonb(result) FROM (SELECT 'project' AS kind,p.id,p.name,p.id AS project_id,p.name AS project,NULL::text AS environment FROM projects p WHERE strpos(lower(p.name),lower($1))>0 UNION ALL SELECT 'service',s.id,s.name,p.id,p.name,e.name FROM services s JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id WHERE strpos(lower(s.name||' '||p.name||' '||e.name),lower($1))>0 ORDER BY kind,name LIMIT 30) result").bind(input.q.trim()).fetch_all(&pool).await?;
    Ok(Json(json!({"items":items})))
}
