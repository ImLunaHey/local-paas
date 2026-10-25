//! Durable autoscaling decisions share the scheduler lock with rollout and agent acceptance.
use crate::ApiError;
use axum::{
    Json,
    extract::{Path, State},
};
use chrono::{DateTime, Utc};
use platform_domain::{ServiceSpec, Workload, scaling::ScalingPolicy};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Row, Transaction, types::Json as DbJson};
use uuid::Uuid;

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Configure {
    operation_id: Uuid,
    expected_version: i32,
    policy: ScalingPolicy,
}
async fn lock(pool: &PgPool) -> Result<Transaction<'_, Postgres>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(712184551)")
        .execute(&mut *tx)
        .await?;
    Ok(tx)
}
#[utoipa::path(get, path = "/api/services/{id}/scaling", params(("id" = Uuid, Path)), responses((status = 200, body = Value)), operation_id = "getServiceScaling")]
pub async fn get(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let spec: DbJson<ServiceSpec> = sqlx::query_scalar("SELECT spec FROM services WHERE id=$1")
        .bind(id)
        .fetch_optional(&pool)
        .await?
        .ok_or(ApiError::NotFound)?;
    let state: Option<DbJson<Value>> = sqlx::query_scalar("SELECT jsonb_build_object('policy',policy,'version',version,'desiredReplicas',desired_replicas,'lastScaledAt',last_scaled_at,'condition',condition,'evaluatedAt',evaluated_at) FROM scaling_policies WHERE service_id=$1").bind(id).fetch_optional(&pool).await?;
    let current: i64 = sqlx::query_scalar("SELECT count(*) FROM instances i JOIN deployments d ON d.id=i.deployment_id JOIN nodes n ON n.id=i.node_id WHERE d.service_id=$1 AND d.status='active' AND i.desired_state='running' AND i.routing_enabled AND i.state='ready' AND i.observed_at>now()-interval '15 seconds' AND n.last_seen>now()-interval '30 seconds'").bind(id).fetch_one(&pool).await?;
    let decisions: Vec<DbJson<Value>> = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'timestamp',timestamp,'currentReplicas',current_replicas,'recommendedReplicas',recommended_replicas,'desiredReplicas',desired_replicas,'cpuPercent',cpu_percent,'reason',reason,'estimatedCapacity',estimated_capacity) FROM scaling_decisions WHERE service_id=$1 ORDER BY timestamp DESC,id DESC LIMIT 20").bind(id).fetch_all(&pool).await?;
    let limits: DbJson<Value> = sqlx::query_scalar("SELECT jsonb_build_object('enabled',enabled,'maxServices',max_services,'maxInstances',max_instances,'maxCpuMillis',max_cpu_millis,'maxMemoryMib',max_memory_mib) FROM scaling_limits WHERE singleton").fetch_one(&pool).await?;
    Ok(Json(
        json!({"eligible":ScalingPolicy::eligible(&spec),"state":state.unwrap_or(DbJson(json!({"policy":ScalingPolicy::default(),"version":0,"desiredReplicas":replicas(&spec),"condition":"disabled"}))),"currentReplicas":current,"decisions":decisions,"limits":limits}),
    ))
}
#[utoipa::path(put, path = "/api/services/{id}/scaling", params(("id" = Uuid, Path)), request_body = Configure, responses((status = 200, body = Value)), operation_id = "configureServiceScaling")]
pub async fn configure(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(input): Json<Configure>,
) -> Result<Json<Value>, ApiError> {
    input.policy.validate().map_err(ApiError::Conflict)?;
    let mut tx = lock(&pool).await?;
    if let Some(row) = sqlx::query(
        "SELECT service_id,version,policy FROM scaling_operations WHERE operation_id=$1",
    )
    .bind(input.operation_id)
    .fetch_optional(&mut *tx)
    .await?
    {
        if row.get::<Uuid, _>("service_id") != id
            || row.get::<i32, _>("version") != input.expected_version
            || row.get::<DbJson<ScalingPolicy>, _>("policy").0 != input.policy
        {
            return Err(ApiError::Conflict(
                "operation ID belongs to another scaling policy update",
            ));
        }
        tx.commit().await?;
        return get(State(pool), Path(id)).await;
    }
    let spec: DbJson<ServiceSpec> =
        sqlx::query_scalar("SELECT spec FROM services WHERE id=$1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(ApiError::NotFound)?;
    if input.policy.enabled {
        let available: bool = sqlx::query_scalar("SELECT (SELECT count(*) FROM scaling_policies WHERE service_id<>$1 AND (policy->>'enabled')::boolean)<max_services FROM scaling_limits WHERE singleton").bind(id).fetch_one(&mut *tx).await?;
        if !available {
            return Err(ApiError::Conflict(
                "operator limit on autoscaled services reached",
            ));
        }
        validate_eligibility(&mut tx, id, &spec, &input.policy).await?;
        let snapshots: Vec<DbJson<ServiceSpec>> = sqlx::query_scalar("SELECT spec FROM deployments WHERE service_id=$1 AND status IN ('active','preparing','waiting','releasing') AND job_options IS NULL").bind(id).fetch_all(&mut *tx).await?;
        if snapshots.iter().any(|s| !ScalingPolicy::eligible(s)) {
            return Err(ApiError::Conflict(
                "the current deployment is ineligible for autoscaling",
            ));
        }
        if crate::jobs::occupied(&mut tx, id).await? {
            return Err(ApiError::Conflict(
                "wait for jobs and pre-deploy commands to finish cleanup",
            ));
        }
    }
    let version: Option<i32> =
        sqlx::query_scalar("SELECT version FROM scaling_policies WHERE service_id=$1")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    if version.unwrap_or(0) != input.expected_version {
        return Err(ApiError::Conflict(
            "scaling policy changed; reload before saving",
        ));
    }
    let current: i64 = sqlx::query_scalar("SELECT count(*) FROM instances i JOIN deployments d ON d.id=i.deployment_id WHERE d.service_id=$1 AND d.status='active' AND i.desired_state='running' AND i.scale_down_after IS NULL").bind(id).fetch_one(&mut *tx).await?;
    if current > 32 {
        return Err(ApiError::Conflict(
            "wait for relocation cleanup before configuring scaling",
        ));
    }
    sqlx::query("INSERT INTO scaling_policies(service_id,policy,desired_replicas) VALUES($1,$2,$3) ON CONFLICT(service_id) DO UPDATE SET policy=EXCLUDED.policy,version=scaling_policies.version+1,direction=0,stable_since=now(),condition='awaiting_evaluation',failure_latched=false,last_request_at=now()").bind(id).bind(DbJson(&input.policy)).bind(current as i32).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO scaling_operations(operation_id,service_id,version,policy) VALUES($1,$2,$3,$4)").bind(input.operation_id).bind(id).bind(input.expected_version).bind(DbJson(&input.policy)).execute(&mut *tx).await?;
    audit(
        &mut tx,
        id,
        "scaling.policy.updated",
        json!({"operationId":input.operation_id,"policy":input.policy}),
    )
    .await?;
    tx.commit().await?;
    get(State(pool), Path(id)).await
}
pub(crate) async fn validate_eligibility(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    spec: &ServiceSpec,
    policy: &ScalingPolicy,
) -> Result<(), ApiError> {
    if !ScalingPolicy::eligible(spec) {
        return Err(ApiError::Conflict(
            "autoscaling requires stateless HTTP OCI replicas without volumes or pre-deploy commands",
        ));
    }
    if policy.min_replicas == 0 {
        // Private TCP discovery has no request activator; both live snapshots and future configurations matter.
        let incoming: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM services WHERE spec->'workload'->'privateConnections' @> $1 UNION ALL SELECT 1 FROM deployments WHERE status IN ('active','preparing','waiting','releasing','job') AND spec->'workload'->'privateConnections' @> $1)").bind(DbJson(json!([{"serviceId":id}]))).fetch_one(&mut **tx).await?;
        if incoming {
            return Err(ApiError::Conflict(
                "scale-to-zero is unavailable for private connection targets",
            ));
        }
    }
    Ok(())
}
pub(crate) fn replicas(spec: &ServiceSpec) -> u16 {
    if let Workload::OciService { replicas, .. } = spec.workload {
        replicas
    } else {
        1
    }
}
pub(crate) fn set_replicas(spec: &mut ServiceSpec, count: u16) {
    if let Workload::OciService { replicas, .. } = &mut spec.workload {
        *replicas = count;
    }
}
pub(crate) async fn policy(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
) -> Result<Option<ScalingPolicy>, sqlx::Error> {
    Ok(sqlx::query_scalar::<_, DbJson<ScalingPolicy>>(
        "SELECT policy FROM scaling_policies WHERE service_id=$1 AND (policy->>'enabled')::boolean",
    )
    .bind(id)
    .fetch_optional(&mut **tx)
    .await?
    .map(|p| p.0))
}
async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    action: &str,
    details: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO audit_log(actor,action,outcome,target_type,target_id,details,organization_id) SELECT 'platform',$1,'succeeded','service',$2,$3,p.organization_id FROM services s JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id WHERE s.id=$2::uuid").bind(action).bind(id.to_string()).bind(DbJson(details)).execute(&mut **tx).await?;
    Ok(())
}

/// Capacity includes pending starts, terminating instances and stale reservations.
pub(crate) async fn budget(
    tx: &mut Transaction<'_, Postgres>,
    spec: &ServiceSpec,
) -> Result<u16, sqlx::Error> {
    let row = sqlx::query("SELECT l.*,count(i.id) AS used,coalesce(sum((d.spec->'resources'->>'cpuMillis')::bigint),0)::bigint AS cpu,coalesce(sum((d.spec->'resources'->>'memoryMib')::bigint),0)::bigint AS memory FROM scaling_limits l LEFT JOIN instances i ON i.state<>'stopped' LEFT JOIN deployments d ON d.id=i.deployment_id GROUP BY l.singleton").fetch_one(&mut **tx).await?;
    if !row.get::<bool, _>("enabled") {
        return Ok(0);
    }
    let slots = i64::from(row.get::<i32, _>("max_instances")) - row.get::<i64, _>("used");
    let cpu = (row.get::<i64, _>("max_cpu_millis") - row.get::<i64, _>("cpu"))
        / i64::from(spec.resources.cpu_millis);
    let memory = (row.get::<i64, _>("max_memory_mib") - row.get::<i64, _>("memory"))
        / i64::from(spec.resources.memory_mib);
    Ok(slots.min(cpu).min(memory).clamp(0, 32) as u16)
}

pub(crate) async fn reconcile(tx: &mut Transaction<'_, Postgres>) -> Result<(), sqlx::Error> {
    // Finish already committed actions even if the policy is subsequently disabled.
    sqlx::query("UPDATE instances SET desired_state='stopped',generation=generation+1 WHERE scale_down_after<=now() AND desired_state='running'").execute(&mut **tx).await?;
    let candidates = sqlx::query("SELECT i.id,i.deployment_id,d.service_id,d.status,i.state,coalesce(i.observed_at>now()-interval '15 seconds' AND n.last_seen>now()-interval '30 seconds',false) AS fresh,i.scaling_deadline<=now() AS expired FROM instances i JOIN deployments d ON d.id=i.deployment_id JOIN nodes n ON n.id=i.node_id WHERE i.scaling_deadline IS NOT NULL AND i.desired_state='running'").fetch_all(&mut **tx).await?;
    for row in candidates {
        let id: Uuid = row.get("id");
        let ready = row.get::<String, _>("state") == "ready" && row.get::<bool, _>("fresh");
        let failed = row.get::<bool, _>("expired")
            || row.get::<String, _>("state") == "failed"
            || row.get::<String, _>("status") != "active";
        if ready && !failed {
            sqlx::query(
                "UPDATE instances SET scaling_deadline=NULL,routing_enabled=true WHERE id=$1",
            )
            .bind(id)
            .execute(&mut **tx)
            .await?;
        } else if failed {
            sqlx::query("UPDATE instances SET desired_state='stopped',generation=generation+1,scaling_deadline=NULL WHERE id=$1").bind(id).execute(&mut **tx).await?;
            sqlx::query("UPDATE scaling_policies SET condition='candidate_failed',failure_latched=true,desired_replicas=greatest(desired_replicas-1,0),last_scaled_at=now(),direction=0 WHERE service_id=$1").bind(row.get::<Uuid,_>("service_id")).execute(&mut **tx).await?;
            audit(
                tx,
                row.get("service_id"),
                "scaling.candidate.failed",
                json!({"instanceId":id}),
            )
            .await?;
        }
    }
    let policies = sqlx::query("SELECT p.*,s.spec AS service_spec FROM scaling_policies p JOIN services s ON s.id=p.service_id WHERE ((p.policy->>'enabled')::boolean OR p.condition<>'disabled') AND (p.evaluated_at IS NULL OR p.evaluated_at<=now()-interval '15 seconds') ORDER BY p.evaluated_at NULLS FIRST,p.service_id FOR UPDATE OF p").fetch_all(&mut **tx).await?;
    sqlx::query("DELETE FROM scaling_decisions WHERE timestamp<now()-interval '7 days'")
        .execute(&mut **tx)
        .await?;
    for row in policies {
        evaluate(tx, row).await?;
    }
    Ok(())
}

async fn evaluate(
    tx: &mut Transaction<'_, Postgres>,
    row: sqlx::postgres::PgRow,
) -> Result<(), sqlx::Error> {
    let id: Uuid = row.get("service_id");
    let p: ScalingPolicy = row.get::<DbJson<ScalingPolicy>, _>("policy").0;
    let now: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
        .fetch_one(&mut **tx)
        .await?;
    let active = sqlx::query(
        "SELECT id,spec,database_ports FROM deployments WHERE service_id=$1 AND status='active'",
    )
    .bind(id)
    .fetch_optional(&mut **tx)
    .await?;
    let mut reason = "stable";
    let mut desired = row.get::<i32, _>("desired_replicas") as u16;
    let mut current = sqlx::query_scalar::<_,i64>("SELECT count(*) FROM instances i JOIN deployments d ON d.id=i.deployment_id WHERE d.service_id=$1 AND d.status='active' AND i.desired_state='running' AND i.scale_down_after IS NULL").bind(id).fetch_one(&mut **tx).await? as u16;
    let mut recommended = desired;
    let mut cpu = None;
    let mut capacity: Option<u16> = None;
    let mut direction = 0i32;
    let mut since: DateTime<Utc> = row.get("stable_since");
    let enabled: bool = sqlx::query_scalar("SELECT enabled FROM scaling_limits WHERE singleton")
        .fetch_one(&mut **tx)
        .await?;
    if !p.enabled || !enabled {
        reason = "disabled";
    } else if !ScalingPolicy::eligible(&row.get::<DbJson<ServiceSpec>, _>("service_spec")) {
        reason = "ineligible";
    } else if let Some(active) = active {
        let deployment: Uuid = active.get("id");
        let mut spec: ServiceSpec = active.get::<DbJson<ServiceSpec>, _>("spec").0;
        let instances = sqlx::query("SELECT i.*,n.name,coalesce(i.observed_at>now()-interval '15 seconds' AND n.last_seen>now()-interval '30 seconds',false) AS fresh FROM instances i JOIN nodes n ON n.id=i.node_id WHERE i.deployment_id=$1 AND i.desired_state='running' AND i.scale_down_after IS NULL ORDER BY i.id").bind(deployment).fetch_all(&mut **tx).await?;
        current = instances.len() as u16;
        recommended = current;
        let occupied: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM deployments WHERE service_id=$1 AND status IN ('preparing','waiting','releasing') UNION ALL SELECT 1 FROM instances i JOIN deployments d ON d.id=i.deployment_id WHERE d.service_id=$1 AND i.state<>'stopped' AND (d.status<>'active' OR i.desired_state='stopped' OR i.scale_down_after IS NOT NULL OR i.scaling_deadline IS NOT NULL) UNION ALL SELECT 1 FROM relocations r JOIN instances i ON i.id=r.old_instance JOIN deployments d ON d.id=i.deployment_id WHERE d.service_id=$1 AND r.state IN ('preparing','draining'))").bind(id).fetch_one(&mut **tx).await?;
        if !occupied {
            desired = current;
        }
        if !ScalingPolicy::eligible(&spec) {
            reason = "ineligible";
        } else if occupied
            || crate::jobs::occupied(tx, id).await?
            || crate::edge::busy(tx, id).await?
        {
            reason = "rollout_job_or_cleanup_pending";
        } else if row.get::<bool, _>("failure_latched") {
            reason = "candidate_failed";
        } else if current > 0
            && instances.iter().any(|i| {
                i.get::<String, _>("state") != "ready"
                    || !i.get::<bool, _>("fresh")
                    || i.get::<Option<f64>, _>("cpu_millis").is_none()
            })
        {
            reason = "metrics_unavailable";
        } else {
            let allowed = budget(tx, &spec).await?;
            let excluded: Vec<Uuid> = if spec.distinct_nodes {
                instances.iter().map(|i| i.get("node_id")).collect()
            } else {
                vec![]
            };
            set_replicas(&mut spec, p.max_replicas);
            let placements = crate::runtime::place_excluding(
                tx,
                id,
                &spec,
                &active.get::<Vec<i32>, _>("database_ports"),
                None,
                None,
                false,
                &excluded,
            )
            .await?;
            capacity = Some((placements.len() as u16).min(allowed));
            let last_request: DateTime<Utc> = row.get("last_request_at");
            let ingress_fresh = row
                .get::<Option<DateTime<Utc>>, _>("ingress_seen_at")
                .is_some_and(|t| (now - t).num_seconds() <= 15);
            if current == 0 {
                recommended = if p.min_replicas > 0 {
                    p.min_replicas
                } else if row.get::<bool, _>("wake_requested") {
                    1
                } else {
                    0
                };
            } else {
                let utilization = instances
                    .iter()
                    .map(|i| i.get::<Option<f64>, _>("cpu_millis").unwrap_or_default())
                    .sum::<f64>()
                    * 100.0
                    / (f64::from(current) * f64::from(spec.resources.cpu_millis));
                cpu = Some(utilization);
                recommended = p.recommendation(current, utilization);
                if p.min_replicas == 0
                    && utilization <= 1.0
                    && ingress_fresh
                    && (now - last_request).num_seconds() >= i64::from(p.idle_seconds)
                {
                    recommended = 0;
                }
                if p.min_replicas == 0 && !ingress_fresh && recommended <= current {
                    recommended = current;
                    reason = "ingress_unavailable";
                }
            }
            direction = (i32::from(recommended) - i32::from(current)).signum();
            if direction != row.get::<i32, _>("direction")
                || row
                    .get::<Option<DateTime<Utc>>, _>("evaluated_at")
                    .is_none_or(|t| (now - t).num_seconds() > 30)
            {
                since = now;
            }
            let wake = current == 0 && recommended > 0;
            let window = if direction > 0 {
                p.scale_up_window_seconds
            } else {
                p.scale_down_window_seconds
            };
            let cooling = row
                .get::<Option<DateTime<Utc>>, _>("last_scaled_at")
                .is_some_and(|t| (now - t).num_seconds() < i64::from(p.cooldown_seconds));
            if direction != 0 && !wake && cooling {
                reason = "cooldown";
            } else if direction != 0 && !wake && (now - since).num_seconds() < i64::from(window) {
                reason = "stabilizing";
            } else if direction > 0 {
                let count = (recommended - current)
                    .min(p.max_step)
                    .min(capacity.unwrap_or(0));
                if count == 0 {
                    reason = if allowed == 0 {
                        "operator_limit"
                    } else {
                        "capacity_exhausted"
                    };
                } else {
                    for (node, slot) in placements.into_iter().take(usize::from(count)) {
                        sqlx::query("INSERT INTO instances(id,deployment_id,node_id,slot,desired_state,routing_enabled,scaling_deadline) VALUES($1,$2,$3,$4,'running',false,now()+interval '180 seconds')").bind(Uuid::now_v7()).bind(deployment).bind(node).bind(slot).execute(&mut **tx).await?;
                    }
                    desired = current + count;
                    reason = if wake { "waking" } else { "scaled_out" };
                }
            } else if direction < 0 {
                let count = (current - recommended).min(p.max_step);
                for instance in instances.iter().rev().take(usize::from(count)) {
                    sqlx::query("UPDATE instances SET routing_enabled=false,scale_down_after=now()+interval '20 seconds' WHERE id=$1").bind(instance.get::<Uuid,_>("id")).execute(&mut **tx).await?;
                }
                desired = current - count;
                reason = if desired == 0 {
                    "sleeping"
                } else {
                    "scaled_in"
                };
            }
        }
    } else {
        reason = "no_active_deployment";
    }
    if direction == 0 {
        since = now;
    }
    let changed = ["waking", "scaled_out", "scaled_in", "sleeping"].contains(&reason);
    let decision = Uuid::now_v7();
    sqlx::query("UPDATE scaling_policies SET evaluated_at=now(),desired_replicas=$2,condition=$3,direction=$4,stable_since=$5,last_scaled_at=CASE WHEN $6 THEN now() ELSE last_scaled_at END,wake_requested=CASE WHEN $6 THEN false ELSE wake_requested END WHERE service_id=$1").bind(id).bind(i32::from(desired)).bind(reason).bind(if changed {0} else {direction}).bind(since).bind(changed).execute(&mut **tx).await?;
    sqlx::query("INSERT INTO scaling_decisions(id,service_id,current_replicas,recommended_replicas,desired_replicas,cpu_percent,reason,estimated_capacity) VALUES($1,$2,$3,$4,$5,$6,$7,$8)").bind(decision).bind(id).bind(i32::from(current)).bind(i32::from(recommended)).bind(i32::from(desired)).bind(cpu).bind(reason).bind(capacity.map(i32::from)).execute(&mut **tx).await?;
    if changed || reason != row.get::<String, _>("condition") {
        audit(tx,id,"scaling.decision",json!({"decisionId":decision,"currentReplicas":current,"recommendedReplicas":recommended,"desiredReplicas":desired,"reason":reason})).await?;
    }
    Ok(())
}

/// Only registered preview/domain routes can request activation. HTTP bodies are never retained.
pub(crate) async fn ingress_heartbeat(
    pool: &PgPool,
    busy: &[Uuid],
) -> Result<std::collections::HashMap<String, std::sync::Arc<crate::waking::Page>>, sqlx::Error> {
    let mut tx = lock(pool).await?;
    let rows = sqlx::query(include_str!("scaling/ingress.sql"))
        .fetch_all(&mut *tx)
        .await?;
    let registered: Vec<Uuid> = rows
        .iter()
        .filter(|r| r.get::<bool, _>("enabled"))
        .map(|r| r.get("service_id"))
        .collect();
    sqlx::query("UPDATE scaling_policies SET ingress_seen_at=now(),last_request_at=CASE WHEN service_id=ANY($1) THEN now() ELSE last_request_at END WHERE service_id=ANY($2)").bind(busy).bind(registered).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            (
                r.get("authority"),
                std::sync::Arc::new(crate::waking::Page {
                    service_id: r.get("service_id"),
                    enabled: r.get("enabled"),
                    service_name: r.get("service_name"),
                    html: r.get("html"),
                    expires: r.get("expires"),
                    sleeping_generation: r.get("sleeping_generation"),
                }),
            )
        })
        .collect())
}
pub(crate) async fn request_wake(pool: &PgPool, id: Uuid) -> Result<(), sqlx::Error> {
    let mut tx = lock(pool).await?;
    // Coalesce request storms into one durable flag; active streams refresh the idle clock separately.
    sqlx::query("UPDATE scaling_policies SET last_request_at=now(),wake_requested=true WHERE service_id=$1 AND (policy->>'enabled')::boolean AND (policy->>'minReplicas')::integer=0 AND (NOT wake_requested OR last_request_at<now()-interval '15 seconds')").bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}
