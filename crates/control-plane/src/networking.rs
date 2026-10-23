use crate::{ApiError, Service};
use axum::{
    Json,
    extract::{Path, State},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, types::Json as DbJson};
use uuid::Uuid;
fn endpoints() -> Vec<String> {
    let Ok(host) = std::env::var("PREVIEW_HOST") else {
        return vec![];
    };
    if host.is_empty()
        || !host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-".contains(&b))
    {
        return vec![];
    }
    std::env::var("PREVIEW_PORTS")
        .unwrap_or_default()
        .split(',')
        .filter_map(|p| p.parse::<u16>().ok())
        .filter(|p| *p >= 1024)
        .map(|p| format!("{host}:{p}"))
        .collect()
}
pub(crate) async fn get(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    crate::runtime::service_exists(&pool, id).await?;
    let route: Option<String> =
        sqlx::query_scalar("SELECT authority FROM preview_routes WHERE service_id=$1")
            .bind(id)
            .fetch_optional(&pool)
            .await?;
    let used: Vec<String> =
        sqlx::query_scalar("SELECT authority FROM preview_routes WHERE service_id<>$1")
            .bind(id)
            .fetch_all(&pool)
            .await?;
    let available: Vec<String> = endpoints()
        .into_iter()
        .filter(|a| !used.contains(a))
        .collect();
    let active_port:Option<i32>=sqlx::query_scalar("SELECT (spec->'workload'->>'port')::integer FROM deployments WHERE service_id=$1 AND status='active'").bind(id).fetch_optional(&pool).await?;
    Ok(Json(
        json!({"authority":route,"available":available,"active_port":active_port,"scope":"private-tailnet"}),
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Update {
    authority: Option<String>,
    enabled: Option<bool>,
    port: u16,
    expected_version: i32,
}
pub(crate) async fn update(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(mut input): Json<Update>,
) -> Result<Json<Value>, ApiError> {
    if input
        .authority
        .as_ref()
        .is_some_and(|a| !endpoints().contains(a))
    {
        return Err(ApiError::Conflict(
            "choose an available configured HTTPS endpoint",
        ));
    }
    let mut tx = pool.begin().await?;
    // Serialize automatic allocation so two services cannot claim the same URL.
    sqlx::query("SELECT pg_advisory_xact_lock(72401952)")
        .execute(&mut *tx)
        .await?;
    if let Some(enabled) = input.enabled {
        input.authority = if enabled {
            let existing: Option<String> =
                sqlx::query_scalar("SELECT authority FROM preview_routes WHERE service_id=$1")
                    .bind(id)
                    .fetch_optional(&mut *tx)
                    .await?;
            if existing.is_some() {
                existing
            } else {
                let used: Vec<String> = sqlx::query_scalar("SELECT authority FROM preview_routes")
                    .fetch_all(&mut *tx)
                    .await?;
                Some(endpoints().into_iter().find(|a| !used.contains(a)).ok_or(ApiError::Conflict("all private URLs are in use; ask the platform administrator to add capacity"))?)
            }
        } else {
            None
        };
    }
    let mut service: Service = sqlx::query_as("SELECT * FROM services WHERE id=$1 FOR UPDATE")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(ApiError::NotFound)?;
    if service.version != input.expected_version {
        return Err(ApiError::Conflict(
            "configuration changed; reload before saving networking",
        ));
    }
    let platform_domain::Workload::OciService { ref mut port, .. } = service.spec.0.workload else {
        return Err(ApiError::Conflict(
            "celld networking requires its dedicated fleet runtime",
        ));
    };
    *port = input.port;
    service.spec.validate().map_err(ApiError::Invalid)?;
    if let Some(authority) = &input.authority {
        let owner: Option<Uuid> =
            sqlx::query_scalar("SELECT service_id FROM preview_routes WHERE authority=$1")
                .bind(authority)
                .fetch_optional(&mut *tx)
                .await?;
        if owner.is_some_and(|owner| owner != id) {
            return Err(ApiError::Conflict(
                "that HTTPS endpoint belongs to another service",
            ));
        }
    }
    sqlx::query("DELETE FROM preview_routes WHERE service_id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    if let Some(authority) = &input.authority {
        sqlx::query("INSERT INTO preview_routes(authority,service_id) VALUES($1,$2)")
            .bind(authority)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|_| {
                ApiError::Conflict("that HTTPS endpoint was just assigned; reload networking")
            })?;
    }
    sqlx::query("UPDATE services SET spec=$2,version=version+1 WHERE id=$1")
        .bind(id)
        .bind(DbJson(&service.spec.0))
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO events(id,service_id,operation_id,kind) VALUES($1,$2,$3,'networking.updated')",
    )
    .bind(Uuid::new_v4())
    .bind(id)
    .bind(Uuid::new_v4())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({"saved":true,"url":input.authority.map(|a|format!("https://{a}"))}),
    ))
}
