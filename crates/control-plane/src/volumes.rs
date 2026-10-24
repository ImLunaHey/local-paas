use crate::ApiError;
use axum::{
    Json,
    extract::{Query, State},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Transaction, types::Json as DbJson};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scope {
    project: String,
    environment: String,
}
pub async fn list(
    State(pool): State<PgPool>,
    Query(scope): Query<Scope>,
) -> Result<Json<Value>, ApiError> {
    let items: Vec<DbJson<Value>> = sqlx::query_scalar("SELECT jsonb_build_object('id',v.id,'name',v.name,'sizeGib',v.size_gib,'node',n.name,'services',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'mountPath',s.spec->'volume'->>'mountPath','readOnly',s.spec->'volume'->'readOnly')) FROM services s WHERE s.spec->'volume'->>'id'=v.id::text),'[]'::jsonb)) FROM shared_volumes v JOIN environments e ON e.id=v.environment_id JOIN projects p ON p.id=e.project_id LEFT JOIN nodes n ON n.id=v.node_id WHERE p.name=$1 AND e.name=$2 ORDER BY v.name").bind(scope.project).bind(scope.environment).fetch_all(&pool).await?;
    Ok(Json(json!({"items":items})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct Create {
    operation_id: Uuid,
    project: String,
    environment: String,
    name: String,
    size_gib: i32,
}
pub async fn create(
    State(pool): State<PgPool>,
    Json(input): Json<Create>,
) -> Result<Json<Value>, ApiError> {
    if input.name.is_empty()
        || input.name.len() > 63
        || input.name.starts_with('-')
        || input.name.ends_with('-')
        || input.name.contains("--")
        || !input
            .name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        || !(1..=2).contains(&input.size_gib)
    {
        return Err(ApiError::Conflict(
            "use a lowercase volume name and a development size of 1–2 GiB",
        ));
    }
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(input.operation_id.to_string())
        .execute(&mut *tx)
        .await?;
    let env:Uuid=sqlx::query_scalar("SELECT e.id FROM environments e JOIN projects p ON p.id=e.project_id WHERE p.name=$1 AND e.name=$2").bind(&input.project).bind(&input.environment).fetch_optional(&mut *tx).await?.ok_or(ApiError::NotFound)?;
    if let Some((id, e, name, size)) = sqlx::query_as::<_, (Uuid, Uuid, String, i32)>(
        "SELECT id,environment_id,name,size_gib FROM shared_volumes WHERE operation_id=$1",
    )
    .bind(input.operation_id)
    .fetch_optional(&mut *tx)
    .await?
    {
        if e != env || name != input.name || size != input.size_gib {
            return Err(ApiError::Conflict("operation ID belongs to another volume"));
        }
        return Ok(Json(json!({"id":id})));
    }
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO shared_volumes(id,operation_id,environment_id,name,size_gib) VALUES($1,$2,$3,$4,$5)").bind(id).bind(input.operation_id).bind(env).bind(input.name).bind(input.size_gib).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"id":id})))
}
pub async fn validate_scope(
    tx: &mut Transaction<'_, Postgres>,
    spec: &platform_domain::ServiceSpec,
) -> Result<(), ApiError> {
    if let Some(volume) = &spec.volume {
        let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM shared_volumes v JOIN environments e ON e.id=v.environment_id JOIN projects p ON p.id=e.project_id WHERE v.id=$1 AND p.name=$2 AND e.name=$3)").bind(volume.id).bind(&spec.project).bind(&spec.environment).fetch_one(&mut **tx).await?;
        if !valid {
            return Err(ApiError::Conflict(
                "attach a volume from this project's environment",
            ));
        }
    }
    Ok(())
}
