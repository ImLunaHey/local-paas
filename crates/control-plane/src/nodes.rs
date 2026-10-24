//! Node maintenance and opt-in, overlap-safe HTTP relocation.
use crate::ApiError;
use axum::{
    Json,
    extract::{Path, State},
};
use platform_domain::{ServiceSpec, Workload};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Row, Transaction, types::Json as DbJson};
use uuid::Uuid;

fn blocked(spec: &ServiceSpec, enabled: bool, job: bool) -> Option<&'static str> {
    if job {
        Some("Jobs require confirmed completion; they are never relocated automatically.")
    } else if spec.workload.is_worker() {
        Some("Singleton worker: confirmed shutdown is required before replacement.")
    } else if spec.workload.is_managed() || spec.volume.is_some() {
        Some("Persistent storage is pinned to this node.")
    } else if !matches!(spec.workload, Workload::OciService { .. }) {
        Some("This workload needs its own fleet lifecycle.")
    } else if !enabled {
        Some("Relocation is disabled. Enable only if concurrent copies are safe.")
    } else {
        None
    }
}
pub async fn list(State(pool): State<PgPool>) -> Result<Json<Value>, ApiError> {
    let nodes: Vec<DbJson<Value>>=sqlx::query_scalar("SELECT jsonb_build_object('id',n.id,'name',n.name,'cordoned',n.cordoned,'draining',n.draining,'lastSeen',n.last_seen,'online',coalesce(n.last_seen>now()-interval '30 seconds',false),'cpuMillis',n.cpu_millis,'memoryMib',n.memory_mib,'slots',n.slots,'reservedDiskGib',(SELECT coalesce(sum(size_gib),0) FROM volumes WHERE node_id=n.id)+(SELECT coalesce(sum(size_gib),0) FROM shared_volumes WHERE node_id=n.id),'capabilities',n.capabilities) FROM nodes n ORDER BY n.name").fetch_all(&pool).await?;
    let rows=sqlx::query("SELECT i.*,d.service_id,d.spec,d.status AS deployment_status,d.job_options IS NOT NULL AS job,s.name,s.relocation_enabled,n.last_seen,r.state AS relocation_state,r.diagnostic AS relocation_diagnostic FROM instances i JOIN deployments d ON d.id=i.deployment_id JOIN services s ON s.id=d.service_id JOIN nodes n ON n.id=i.node_id LEFT JOIN relocations r ON r.old_instance=i.id AND r.state<>'cancelled' WHERE i.state<>'stopped' ORDER BY n.name,s.name,i.id").fetch_all(&pool).await?;
    let mut instances = Vec::new();
    for r in rows {
        let spec: DbJson<ServiceSpec> = r.get("spec");
        let enabled = r.get("relocation_enabled");
        let reason = blocked(&spec, enabled, r.get("job"));
        instances.push(json!({"id":r.get::<Uuid,_>("id"),"nodeId":r.get::<Uuid,_>("node_id"),"serviceId":r.get::<Uuid,_>("service_id"),"name":r.get::<String,_>("name"),"project":spec.project,"environment":spec.environment,"state":r.get::<String,_>("state"),"desiredState":r.get::<String,_>("desired_state"),"observedAt":r.get::<Option<chrono::DateTime<chrono::Utc>>,_>("observed_at"),"diagnostic":r.get::<Option<String>,_>("diagnostic"),"cpuMillis":r.get::<Option<f64>,_>("cpu_millis"),"memoryBytes":r.get::<Option<i64>,_>("memory_bytes"),"requestedCpuMillis":spec.resources.cpu_millis,"requestedMemoryMib":spec.resources.memory_mib,"relocationEnabled":enabled,"canEnable":blocked(&spec,true,r.get("job")).is_none(),"blockedReason":reason,"relocationState":r.get::<Option<String>,_>("relocation_state"),"relocationDiagnostic":r.get::<Option<String>,_>("relocation_diagnostic")}));
    }
    Ok(Json(json!({"nodes":nodes,"instances":instances})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    operation_id: Uuid,
    action: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    operation_id: Uuid,
    enabled: bool,
}
async fn lock(pool: &PgPool) -> Result<Transaction<'_, Postgres>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(712184551)")
        .execute(&mut *tx)
        .await?;
    Ok(tx)
}
async fn operation(
    tx: &mut Transaction<'_, Postgres>,
    op: Uuid,
    target: Uuid,
    action: &str,
    payload: Value,
) -> Result<bool, ApiError> {
    if let Some(r) =
        sqlx::query("SELECT target_id,action,payload FROM node_operations WHERE operation_id=$1")
            .bind(op)
            .fetch_optional(&mut **tx)
            .await?
    {
        if r.get::<Uuid, _>("target_id") != target
            || r.get::<String, _>("action") != action
            || r.get::<DbJson<Value>, _>("payload").0 != payload
        {
            return Err(ApiError::Conflict(
                "operation ID belongs to a different action",
            ));
        }
        return Ok(false);
    }
    sqlx::query(
        "INSERT INTO node_operations(operation_id,target_id,action,payload) VALUES($1,$2,$3,$4)",
    )
    .bind(op)
    .bind(target)
    .bind(action)
    .bind(DbJson(payload))
    .execute(&mut **tx)
    .await?;
    Ok(true)
}
async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    target: Uuid,
    action: &str,
    details: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO audit_log(actor,action,outcome,target_type,target_id,details) VALUES('platform', $1,'succeeded','node-maintenance',$2,$3)").bind(action).bind(target.to_string()).bind(DbJson(details)).execute(&mut **tx).await?;
    Ok(())
}
pub async fn action(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(input): Json<Action>,
) -> Result<Json<Value>, ApiError> {
    if !["cordon", "uncordon", "drain", "retry"].contains(&input.action.as_str()) {
        return Err(ApiError::Conflict("unknown node action"));
    }
    let mut tx = lock(&pool).await?;
    if !sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM nodes WHERE id=$1)")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?
    {
        return Err(ApiError::NotFound);
    }
    if operation(&mut tx, input.operation_id, id, &input.action, json!({})).await? {
        match input.action.as_str() {
            "uncordon" => {
                sqlx::query("UPDATE nodes SET cordoned=false,draining=false WHERE id=$1")
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            }
            "drain" => {
                sqlx::query("UPDATE nodes SET cordoned=true,draining=true WHERE id=$1")
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            }
            "cordon" => {
                sqlx::query("UPDATE nodes SET cordoned=true WHERE id=$1")
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            }
            _ => {
                sqlx::query("UPDATE relocations SET state='cancelled' WHERE state='failed' AND old_instance IN(SELECT id FROM instances WHERE node_id=$1) AND new_instance IN(SELECT id FROM instances WHERE state='stopped')").bind(id).execute(&mut *tx).await?;
            }
        }
        audit(
            &mut tx,
            id,
            &format!("node.{}", input.action),
            json!({"operationId":input.operation_id}),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"id":id})))
}
pub async fn policy(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(input): Json<Policy>,
) -> Result<Json<Value>, ApiError> {
    let mut tx = lock(&pool).await?;
    let spec: DbJson<ServiceSpec> =
        sqlx::query_scalar("SELECT spec FROM services WHERE id=$1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(ApiError::NotFound)?;
    if input.enabled && blocked(&spec, true, false).is_some() {
        return Err(ApiError::Conflict(
            "only stateless HTTP services support relocation",
        ));
    }
    if operation(
        &mut tx,
        input.operation_id,
        id,
        "relocation.policy",
        json!({"enabled":input.enabled}),
    )
    .await?
    {
        sqlx::query("UPDATE services SET relocation_enabled=$2 WHERE id=$1")
            .bind(id)
            .bind(input.enabled)
            .execute(&mut *tx)
            .await?;
        audit(
            &mut tx,
            id,
            "service.relocation.configure",
            json!({"enabled":input.enabled,"operationId":input.operation_id}),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"enabled":input.enabled})))
}

pub(crate) async fn reconcile(tx: &mut Transaction<'_, Postgres>) -> Result<(), sqlx::Error> {
    let moves=sqlx::query("SELECT r.*,o.desired_state AS old_desired,o.state AS old_state,d.status AS deployment_status,s.relocation_enabled,c.state AS candidate_state,c.desired_state AS candidate_desired,coalesce(c.observed_at>now()-interval '15 seconds' AND n.last_seen>now()-interval '30 seconds',false) AS fresh,r.deadline<now() AS expired,coalesce(r.drain_after<=now(),false) AS drained FROM relocations r JOIN instances o ON o.id=r.old_instance JOIN deployments d ON d.id=o.deployment_id JOIN services s ON s.id=d.service_id JOIN instances c ON c.id=r.new_instance JOIN nodes n ON n.id=c.node_id WHERE r.state IN ('preparing','draining') ORDER BY r.created_at FOR UPDATE OF r").fetch_all(&mut **tx).await?;
    for r in moves {
        let id: Uuid = r.get("id");
        let old: Uuid = r.get("old_instance");
        let new: Uuid = r.get("new_instance");
        let state: String = r.get("state");
        let ready = r.get::<String, _>("candidate_state") == "ready" && r.get::<bool, _>("fresh");
        let cancelled = r.get::<String, _>("deployment_status") != "active"
            || !r.get::<bool, _>("relocation_enabled");
        let failed = r.get::<String, _>("candidate_state") == "failed"
            || (state == "preparing" && r.get::<bool, _>("expired"))
            || (state == "draining" && r.get::<bool, _>("drained") && !ready);
        if cancelled || failed {
            sqlx::query("UPDATE relocations SET state='failed',diagnostic=$2 WHERE id=$1")
                .bind(id)
                .bind(if cancelled {
                    "relocation_cancelled"
                } else {
                    "replacement_readiness_failed"
                })
                .execute(&mut **tx)
                .await?;
            sqlx::query("UPDATE instances SET routing_enabled=false,desired_state='stopped',generation=generation+1 WHERE id=$1 AND desired_state='running'").bind(new).execute(&mut **tx).await?;
            // Never resurrect a stopped deployment or revoke an already confirmed handoff.
            sqlx::query(
                "UPDATE instances SET routing_enabled=true WHERE id=$1 AND desired_state='running'",
            )
            .bind(old)
            .execute(&mut **tx)
            .await?;
            audit(
                tx,
                id,
                "relocation.failed",
                json!({"oldInstance":old,"newInstance":new}),
            )
            .await?;
        } else if state == "preparing" && ready {
            sqlx::query("UPDATE instances SET routing_enabled=(id=$2) WHERE id=ANY($1)")
                .bind(vec![old, new])
                .bind(new)
                .execute(&mut **tx)
                .await?;
            // Public/private route leases expire before shutdown; do not reuse the old slot.
            sqlx::query("UPDATE relocations SET state='draining',drain_after=now()+interval '20 seconds' WHERE id=$1").bind(id).execute(&mut **tx).await?;
            audit(
                tx,
                id,
                "relocation.promoted",
                json!({"oldInstance":old,"newInstance":new}),
            )
            .await?;
        } else if state == "draining" && ready && r.get::<bool, _>("drained") {
            sqlx::query("UPDATE instances SET desired_state='stopped',generation=generation+1 WHERE id=$1 AND desired_state='running'").bind(old).execute(&mut **tx).await?;
            sqlx::query("UPDATE relocations SET state='completed' WHERE id=$1")
                .bind(id)
                .execute(&mut **tx)
                .await?;
            audit(tx,id,"relocation.completed",json!({"oldInstance":old,"newInstance":new,"cleanupPending":r.get::<String,_>("old_state")!="stopped"})).await?;
        }
    }
    let candidates=sqlx::query("SELECT i.id,i.node_id,i.deployment_id,d.service_id,d.spec,d.database_ports,n.draining,s.relocation_enabled FROM instances i JOIN nodes n ON n.id=i.node_id JOIN deployments d ON d.id=i.deployment_id JOIN services s ON s.id=d.service_id WHERE i.desired_state='running' AND i.routing_enabled AND d.status='active' AND d.job_options IS NULL AND (n.draining OR n.last_seen<now()-interval '45 seconds') AND NOT EXISTS(SELECT 1 FROM relocations r WHERE r.old_instance=i.id AND r.state<>'cancelled') AND NOT EXISTS(SELECT 1 FROM relocations r WHERE r.new_instance=i.id AND r.state IN ('preparing','draining')) AND NOT EXISTS(SELECT 1 FROM deployments pending WHERE pending.service_id=d.service_id AND pending.status IN ('preparing','waiting','releasing')) ORDER BY i.id").fetch_all(&mut **tx).await?;
    for r in candidates {
        let mut spec: ServiceSpec = r.get::<DbJson<ServiceSpec>, _>("spec").0;
        if blocked(&spec, r.get("relocation_enabled"), false).is_some() {
            continue;
        }
        let deployment: Uuid = r.get("deployment_id");
        let old: Uuid = r.get("id");
        let mut exclude = vec![r.get::<Uuid, _>("node_id")];
        if spec.distinct_nodes {
            let existing: Vec<Uuid> = sqlx::query_scalar(
                "SELECT node_id FROM instances WHERE deployment_id=$1 AND desired_state='running'",
            )
            .bind(deployment)
            .fetch_all(&mut **tx)
            .await?;
            exclude.extend(existing);
        }
        if let Workload::OciService {
            ref mut replicas, ..
        } = spec.workload
        {
            *replicas = 1;
        }
        let placements = crate::runtime::place_excluding(
            tx,
            r.get("service_id"),
            &spec,
            &r.get::<Vec<i32>, _>("database_ports"),
            None,
            None,
            false,
            &exclude,
        )
        .await?;
        let Some((node, slot)) = placements.first() else {
            continue;
        };
        let new = Uuid::now_v7();
        let id = Uuid::now_v7();
        sqlx::query("INSERT INTO instances(id,deployment_id,node_id,slot,desired_state,routing_enabled) VALUES($1,$2,$3,$4,'running',false)").bind(new).bind(deployment).bind(node).bind(slot).execute(&mut **tx).await?;
        let reason = if r.get::<bool, _>("draining") {
            "drain"
        } else {
            "node_lost"
        };
        sqlx::query("INSERT INTO relocations(id,old_instance,new_instance,reason,state) VALUES($1,$2,$3,$4,'preparing')").bind(id).bind(old).bind(new).bind(reason).execute(&mut **tx).await?;
        audit(
            tx,
            id,
            "relocation.started",
            json!({"oldInstance":old,"newInstance":new,"reason":reason}),
        )
        .await?;
    }
    Ok(())
}
