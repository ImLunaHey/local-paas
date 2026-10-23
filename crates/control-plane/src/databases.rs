use crate::{ApiError, Service};
use axum::{
    Json,
    extract::{Path, State},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, types::Json as DbJson};
use uuid::Uuid;
pub async fn get(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let service: Service = sqlx::query_as("SELECT * FROM services WHERE id=$1")
        .bind(id)
        .fetch_optional(&pool)
        .await?
        .ok_or(ApiError::NotFound)?;
    if !service.spec.workload.is_database() {
        return Err(ApiError::Conflict("not a database service"));
    }
    let volume:Option<DbJson<Value>>=sqlx::query_scalar("SELECT jsonb_build_object('node',n.name,'size_gib',v.size_gib,'port',n.endpoint_base+v.slot,'host','10.0.2.2') FROM volumes v JOIN nodes n ON n.id=v.node_id WHERE v.id=$1").bind(id).fetch_optional(&pool).await?;
    let apps:Vec<DbJson<Value>>=sqlx::query_scalar("SELECT jsonb_build_object('id',s.id,'name',s.name,'connected',c.database_id=$1) FROM services s LEFT JOIN database_connections c ON c.service_id=s.id AND c.database_id=$1 WHERE s.environment_id=(SELECT environment_id FROM services WHERE id=$1) AND s.kind='oci-service' ORDER BY s.name").bind(id).fetch_all(&pool).await?;
    Ok(Json(json!({"volume":volume,"applications":apps})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Connect {
    database_id: Uuid,
    expected_secret_version: i32,
}
pub async fn connect(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(input): Json<Connect>,
) -> Result<Json<Value>, ApiError> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(712184551)")
        .execute(&mut *tx)
        .await?;
    let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM services a JOIN services d ON d.environment_id=a.environment_id WHERE a.id=$1 AND d.id=$2 AND a.kind='oci-service' AND d.kind IN ('postgres-service','redis-service'))").bind(id).bind(input.database_id).fetch_one(&mut *tx).await?;
    if !valid {
        return Err(ApiError::Conflict(
            "connect an application and database in the same project environment",
        ));
    }
    let row:Option<(i32,String,String)>=sqlx::query_as("SELECT n.endpoint_base+v.slot,coalesce(s.spec->'workload'->>'database','0'),s.kind FROM volumes v JOIN nodes n ON n.id=v.node_id JOIN services s ON s.id=v.id WHERE v.id=$1").bind(input.database_id).fetch_optional(&mut *tx).await?;
    let (port, database, kind) = row.ok_or(ApiError::Conflict(
        "deploy the database once to allocate its private endpoint",
    ))?;
    let password = crate::secrets::database_password(&pool, input.database_id).await?;
    // Managed passwords are generated as hexadecimal. Reject incompatible legacy credentials.
    if !password.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err(ApiError::Conflict(
            "database credentials need a supported managed password",
        ));
    }
    let redis = kind == "redis-service";
    let url = if redis {
        format!("redis://:{password}@10.0.2.2:{port}/0")
    } else {
        format!("postgresql://postgres:{password}@10.0.2.2:{port}/{database}")
    };
    crate::secrets::connect_database(
        &pool,
        id,
        url,
        if redis { "REDIS_URL" } else { "DATABASE_URL" },
        input.expected_secret_version,
    )
    .await?;
    sqlx::query("INSERT INTO database_connections(service_id,database_id,secret_name) VALUES($1,$2,$3) ON CONFLICT(service_id,secret_name) DO UPDATE SET database_id=excluded.database_id,created_at=now()").bind(id).bind(input.database_id).bind(if redis {"REDIS_URL"} else {"DATABASE_URL"}).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"saved":true,"redeploy_required":true})))
}
