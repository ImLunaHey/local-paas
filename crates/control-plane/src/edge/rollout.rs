use crate::ApiError;
use axum::{
    Json,
    extract::{Path, State},
};
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

pub async fn busy(tx: &mut Transaction<'_, Postgres>, service: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM edge_rollouts WHERE service_id=$1 AND phase NOT IN ('complete','failed'))")
        .bind(service).fetch_one(&mut **tx).await
}

pub async fn set_target(
    tx: &mut Transaction<'_, Postgres>,
    hostname: &str,
    deployment: Option<Uuid>,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE domains SET edge_deployment=$2,edge_generation=edge_generation+1,edge_error=NULL,edge_retry_at=now() WHERE hostname=$1 AND edge_deployment IS DISTINCT FROM $2")
        .bind(hostname).bind(deployment).execute(&mut **tx).await?;
    Ok(())
}

async fn target_service(
    tx: &mut Transaction<'_, Postgres>,
    service: Uuid,
    deployment: Option<Uuid>,
) -> Result<(), sqlx::Error> {
    let hosts: Vec<String> = sqlx::query_scalar(
        "SELECT hostname FROM domains WHERE service_id=$1 ORDER BY hostname FOR UPDATE",
    )
    .bind(service)
    .fetch_all(&mut **tx)
    .await?;
    for host in hosts {
        set_target(tx, &host, deployment).await?;
    }
    Ok(())
}

/// Return true when public routing owns promotion. Private-only services keep
/// their existing runtime flow; celld never enters this OCI rollout lifecycle.
pub async fn begin(
    tx: &mut Transaction<'_, Postgres>,
    deployment: Uuid,
    service: Uuid,
) -> Result<bool, sqlx::Error> {
    let public: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM domains WHERE service_id=$1)")
            .bind(service)
            .fetch_one(&mut **tx)
            .await?;
    if !public {
        return Ok(false);
    }
    sqlx::query("INSERT INTO edge_rollouts(deployment_id,service_id,previous_deployment,phase) SELECT $1,$2,(SELECT id FROM deployments WHERE service_id=$2 AND status='active'),'promoting' ON CONFLICT(deployment_id) DO NOTHING")
        .bind(deployment).bind(service).execute(&mut **tx).await?;
    target_service(tx, service, Some(deployment)).await?;
    sqlx::query("UPDATE deployments SET error_code='pending_edge_ack' WHERE id=$1 AND error_code IS DISTINCT FROM 'pending_edge_ack'")
        .bind(deployment).execute(&mut **tx).await?;
    Ok(true)
}

async fn healthy(tx: &mut Transaction<'_, Postgres>, id: Uuid) -> Result<bool, sqlx::Error> {
    // Relocations retain historical allocations. Only current routing members
    // determine whether this deployment is a healthy promotion/rollback target.
    sqlx::query_scalar("SELECT count(*)>0 AND bool_and(i.state='ready' AND coalesce(i.observed_at>now()-interval '15 seconds' AND n.last_seen>now()-interval '30 seconds',false)) FROM instances i JOIN nodes n ON n.id=i.node_id WHERE i.deployment_id=$1 AND i.desired_state='running' AND i.routing_enabled")
        .bind(id).fetch_one(&mut **tx).await
}

async fn acknowledged(
    tx: &mut Transaction<'_, Postgres>,
    service: Uuid,
    deployment: Option<Uuid>,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT count(*)>0 AND bool_and(coalesce(edge_deployment IS NOT DISTINCT FROM $2 AND acknowledged_generation=edge_generation AND acknowledged_deployment IS NOT DISTINCT FROM $2 AND edge_lease_expires_at>clock_timestamp() AND (edge_deployment IS NULL OR certificate_expires_at>clock_timestamp()) AND edge_error IS NULL,false)) FROM domains WHERE service_id=$1")
        .bind(service).bind(deployment).fetch_one(&mut **tx).await
}

async fn stop_instances(
    tx: &mut Transaction<'_, Postgres>,
    deployment: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE instances SET desired_state='stopped',generation=generation+1 WHERE deployment_id=$1 AND desired_state='running'")
        .bind(deployment).execute(&mut **tx).await?;
    Ok(())
}

async fn event(
    tx: &mut Transaction<'_, Postgres>,
    service: Uuid,
    id: Uuid,
    kind: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO events(id,service_id,operation_id,kind) VALUES($1,$2,$3,$4) ON CONFLICT(operation_id,kind) DO NOTHING")
        .bind(Uuid::now_v7()).bind(service).bind(id).bind(kind).execute(&mut **tx).await?;
    Ok(())
}

pub async fn advance(tx: &mut Transaction<'_, Postgres>) -> Result<(), sqlx::Error> {
    let rows = sqlx::query("SELECT r.*,d.deadline<now() AS expired,coalesce(r.drain_after<=now(),false) AS drained FROM edge_rollouts r JOIN deployments d ON d.id=r.deployment_id WHERE phase NOT IN ('complete','failed') ORDER BY r.created_at FOR UPDATE OF r")
        .fetch_all(&mut **tx).await?;
    for row in rows {
        let id: Uuid = row.get("deployment_id");
        let service: Uuid = row.get("service_id");
        let previous: Option<Uuid> = row.get("previous_deployment");
        let phase: String = row.get("phase");
        let ready = healthy(tx, id).await?;
        let failed: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM instances WHERE deployment_id=$1 AND state='failed' AND desired_state='running' AND routing_enabled)",
        )
        .bind(id)
        .fetch_one(&mut **tx)
        .await?;
        if (phase == "promoting" && (row.get::<bool, _>("expired") || failed))
            || (phase == "draining" && !ready)
        {
            target_service(tx, service, previous).await?;
            sqlx::query("UPDATE edge_rollouts SET phase='rolling_back',drain_after=NULL WHERE deployment_id=$1")
                .bind(id).execute(&mut **tx).await?;
            sqlx::query("UPDATE deployments SET error_code='pending_edge_rollback' WHERE id=$1")
                .bind(id)
                .execute(&mut **tx)
                .await?;
            event(tx, service, id, "deployment.rollback_requested").await?;
            continue;
        }
        if phase == "promoting" && ready && acknowledged(tx, service, Some(id)).await? {
            if let Some(old) = previous {
                sqlx::query("UPDATE deployments SET status='superseded' WHERE id=$1")
                    .bind(old)
                    .execute(&mut **tx)
                    .await?;
            }
            sqlx::query("UPDATE deployments SET status='active',error_code=NULL WHERE id=$1")
                .bind(id)
                .execute(&mut **tx)
                .await?;
            sqlx::query("UPDATE edge_rollouts SET phase='draining',drain_after=now()+interval '120 seconds' WHERE deployment_id=$1")
                .bind(id).execute(&mut **tx).await?;
            event(tx, service, id, "deployment.active").await?;
        } else if phase == "draining"
            && row.get::<bool, _>("drained")
            && ready
            && acknowledged(tx, service, Some(id)).await?
        {
            if let Some(old) = previous {
                stop_instances(tx, old).await?;
            }
            sqlx::query("UPDATE edge_rollouts SET phase='complete' WHERE deployment_id=$1")
                .bind(id)
                .execute(&mut **tx)
                .await?;
        } else if phase == "rolling_back" {
            let previous_healthy = match previous {
                Some(old) => healthy(tx, old).await?,
                None => true,
            };
            if previous_healthy && acknowledged(tx, service, previous).await? {
                // Vacate the unique active slot before restoring the old deployment.
                sqlx::query(
                    "UPDATE deployments SET status='failed',error_code='edge_rollback' WHERE id=$1",
                )
                .bind(id)
                .execute(&mut **tx)
                .await?;
                if let Some(old) = previous {
                    sqlx::query("UPDATE deployments SET status='active' WHERE id=$1")
                        .bind(old)
                        .execute(&mut **tx)
                        .await?;
                }
                sqlx::query("UPDATE edge_rollouts SET phase='rollback_draining',drain_after=now()+interval '120 seconds' WHERE deployment_id=$1")
                    .bind(id).execute(&mut **tx).await?;
                event(tx, service, id, "deployment.rolled_back").await?;
            }
        } else if phase == "rollback_draining"
            && row.get::<bool, _>("drained")
            && acknowledged(tx, service, previous).await?
        {
            stop_instances(tx, id).await?;
            sqlx::query("UPDATE edge_rollouts SET phase='failed' WHERE deployment_id=$1")
                .bind(id)
                .execute(&mut **tx)
                .await?;
        }
    }
    Ok(())
}

#[utoipa::path(post, path="/api/deployments/{id}/rollback", operation_id="rollbackPublicDeployment", params(("id"=Uuid, Path)), responses((status=200, body=Value),(status=409, body=crate::openapi::ErrorResponse)))]
pub async fn rollback(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(712184551)")
        .execute(&mut *tx)
        .await?;
    let row = sqlx::query("SELECT * FROM edge_rollouts WHERE deployment_id=$1 FOR UPDATE")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(ApiError::NotFound)?;
    let phase: String = row.get("phase");
    if phase == "rolling_back" || phase == "rollback_draining" || phase == "failed" {
        return Ok(Json(json!({"id":id,"status":phase})));
    }
    if !["promoting", "draining"].contains(&phase.as_str()) {
        return Err(ApiError::Conflict(
            "rollback window has ended; deploy a retained revision instead",
        ));
    }
    let previous: Option<Uuid> = row.get("previous_deployment");
    if let Some(old) = previous
        && !healthy(&mut tx, old).await?
    {
        return Err(ApiError::Conflict(
            "previous deployment is not healthy; rollback cannot be guaranteed",
        ));
    }
    let service: Uuid = row.get("service_id");
    target_service(&mut tx, service, previous).await?;
    sqlx::query(
        "UPDATE edge_rollouts SET phase='rolling_back',drain_after=NULL WHERE deployment_id=$1",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE deployments SET error_code='pending_edge_rollback' WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    event(&mut tx, service, id, "deployment.rollback_requested").await?;
    tx.commit().await?;
    Ok(Json(json!({"id":id,"status":"rolling_back"})))
}

pub async fn stop_allowed(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM edge_rollouts WHERE (deployment_id=$1 OR previous_deployment=$1) AND phase NOT IN ('complete','failed')) AND NOT EXISTS(SELECT 1 FROM domains WHERE edge_deployment=$1 OR acknowledged_deployment=$1) AND NOT EXISTS(SELECT 1 FROM edge_targets WHERE deployment_id=$1 AND expires_at+interval '15 seconds'>clock_timestamp())")
        .bind(id).fetch_one(&mut **tx).await
}
