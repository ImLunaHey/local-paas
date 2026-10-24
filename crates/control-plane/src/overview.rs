use crate::ApiError;
use axum::{
    Json,
    extract::{Query, State},
};
use serde_json::{Value, json};
use sqlx::{PgPool, types::Json as DbJson};

pub async fn get(State(pool): State<PgPool>) -> Result<Json<Value>, ApiError> {
    let summary: DbJson<Value> = sqlx::query_scalar("SELECT jsonb_build_object('projects',(SELECT count(*) FROM projects),'services',(SELECT count(*) FROM services),'readyInstances',(SELECT count(*) FROM instances i JOIN nodes n ON n.id=i.node_id WHERE i.desired_state='running' AND i.state='ready' AND i.observed_at>now()-interval '15 seconds' AND n.last_seen>now()-interval '30 seconds'),'healthyNodes',(SELECT count(*) FROM nodes WHERE last_seen>now()-interval '30 seconds'),'totalNodes',(SELECT count(*) FROM nodes),'pendingBuilds',(SELECT count(*) FROM builds WHERE status IN ('queued','running')),'failedDeployments',(SELECT count(*) FROM deployments WHERE status='failed' AND job_options IS NULL AND created_at>now()-interval '24 hours'))").fetch_one(&pool).await?;
    let deployments: Vec<DbJson<Value>> = sqlx::query_scalar("SELECT jsonb_build_object('id',d.id,'serviceId',s.id,'service',s.name,'project',p.name,'environment',e.name,'status',d.status,'createdAt',d.created_at,'errorCode',d.error_code) FROM deployments d JOIN services s ON s.id=d.service_id JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id WHERE d.job_options IS NULL ORDER BY d.created_at DESC,d.id DESC LIMIT 12").fetch_all(&pool).await?;
    let builds: Vec<DbJson<Value>> = sqlx::query_scalar("SELECT jsonb_build_object('id',b.id,'serviceId',s.id,'service',s.name,'project',p.name,'environment',e.name,'status',b.status,'createdAt',b.created_at,'errorCode',b.error_code) FROM builds b JOIN services s ON s.id=b.service_id JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id ORDER BY b.created_at DESC,b.id DESC LIMIT 8").fetch_all(&pool).await?;
    Ok(Json(
        json!({"summary":summary,"deployments":deployments,"builds":builds}),
    ))
}

#[derive(Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostQuery {
    #[serde(default)]
    range: crate::host_metrics::Range,
}
pub async fn hosts(
    State(pool): State<PgPool>,
    Query(query): Query<HostQuery>,
) -> Result<Json<Value>, ApiError> {
    let nodes: Vec<DbJson<Value>> = sqlx::query_scalar("SELECT jsonb_build_object('id',n.id,'name',n.name,'cordoned',n.cordoned,'lastSeen',n.last_seen,'healthy',coalesce(n.last_seen>now()-interval '30 seconds',false),'cpuMillis',n.cpu_millis,'memoryMib',n.memory_mib,'slots',n.slots,'occupiedSlots',(SELECT count(*) FROM instances i WHERE i.node_id=n.id AND i.state<>'stopped'),'reservedCpuMillis',coalesce((SELECT sum((d.spec->'resources'->>'cpuMillis')::bigint) FROM instances i JOIN deployments d ON d.id=i.deployment_id WHERE i.node_id=n.id AND i.state<>'stopped'),0),'reservedMemoryMib',coalesce((SELECT sum((d.spec->'resources'->>'memoryMib')::bigint) FROM instances i JOIN deployments d ON d.id=i.deployment_id WHERE i.node_id=n.id AND i.state<>'stopped'),0)) FROM nodes n ORDER BY n.name").fetch_all(&pool).await?;
    Ok(Json(
        json!({"host":crate::host_metrics::snapshot(&pool, query.range).await?,"nodes":nodes}),
    ))
}
