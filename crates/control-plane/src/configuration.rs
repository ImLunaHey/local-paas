use crate::{ApiError, Service};
use axum::{
    Json,
    extract::{Path, State},
};
use platform_domain::ServiceSpec;
use serde::Deserialize;
use sqlx::{PgPool, types::Json as DbJson};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateService {
    operation_id: Uuid,
    expected_version: i32,
    spec: ServiceSpec,
}

pub(crate) async fn update(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(request): Json<UpdateService>,
) -> Result<Json<Service>, ApiError> {
    request.spec.validate().map_err(ApiError::Invalid)?;
    let mut tx = pool.begin().await?;
    crate::domains::lock(&mut tx).await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(request.operation_id.to_string())
        .execute(&mut *tx)
        .await?;
    let replay = sqlx::query_as::<_, (Uuid, i32, DbJson<ServiceSpec>, DbJson<Service>)>(
        "SELECT service_id, expected_version, spec, response FROM service_updates WHERE operation_id = $1"
    ).bind(request.operation_id).fetch_optional(&mut *tx).await?;
    if let Some((service_id, version, spec, response)) = replay {
        if service_id != id || version != request.expected_version || spec.0 != request.spec {
            return Err(ApiError::Conflict(
                "operation ID was already used for a different configuration update",
            ));
        }
        return Ok(Json(response.0));
    }
    let current = sqlx::query_as::<_, Service>("SELECT * FROM services WHERE id = $1 FOR UPDATE")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(ApiError::NotFound)?;
    if current.version != request.expected_version {
        return Err(ApiError::Conflict(
            "configuration changed since you opened it; reload the configuration before saving",
        ));
    }
    crate::volumes::validate_scope(&mut tx, &request.spec).await?;
    crate::discovery::validate(&mut tx, &request.spec).await?;
    crate::source_uploads::validate_scope(&mut tx, &request.spec).await?;
    if current.spec.workload.is_managed() && current.spec.workload != request.spec.workload {
        let allocated: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM volumes WHERE id=$1)")
                .bind(id)
                .fetch_one(&mut *tx)
                .await?;
        if allocated {
            return Err(ApiError::Conflict(
                "database name and storage size are immutable after volume allocation",
            ));
        }
    }
    if current.spec.kind() != request.spec.kind()
        || current.spec.workload.is_worker() != request.spec.workload.is_worker()
    {
        return Err(ApiError::Conflict(
            "an existing service cannot change workload kind; register a separate service",
        ));
    }
    if current.spec.project != request.spec.project
        || current.spec.environment != request.spec.environment
    {
        return Err(ApiError::Conflict(
            "create a separate service in the target environment; existing service identity and secret scope cannot move",
        ));
    }
    let project_id: Uuid = sqlx::query_scalar("INSERT INTO projects (id, name) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id")
        .bind(Uuid::now_v7()).bind(&request.spec.project).fetch_one(&mut *tx).await?;
    crate::domains::assign_service(&mut tx, id, &request.spec.domains).await?;
    let environment_id: Uuid = sqlx::query_scalar("INSERT INTO environments (id, project_id, name) VALUES ($1, $2, $3) ON CONFLICT (project_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id")
        .bind(Uuid::now_v7()).bind(project_id).bind(&request.spec.environment).fetch_one(&mut *tx).await?;
    let service = sqlx::query_as::<_, Service>("UPDATE services SET environment_id = $2, name = $3, spec = $4, version = version + 1 WHERE id = $1 RETURNING *")
        .bind(id).bind(environment_id).bind(&request.spec.name).bind(DbJson(&request.spec)).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO events (id, service_id, operation_id, kind) VALUES ($1, $2, $3, 'service.updated')")
        .bind(Uuid::now_v7()).bind(id).bind(request.operation_id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO service_updates (operation_id, service_id, expected_version, spec, response) VALUES ($1, $2, $3, $4, $5)")
        .bind(request.operation_id).bind(id).bind(request.expected_version).bind(DbJson(&request.spec)).bind(DbJson(&service)).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(service))
}
