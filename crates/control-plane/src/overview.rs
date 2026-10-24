use crate::ApiError;
use axum::{
    Json,
    extract::{Query, State},
};
use serde_json::{Value, json};
use sqlx::{PgPool, types::Json as DbJson};

pub async fn get(State(pool): State<PgPool>) -> Result<Json<Value>, ApiError> {
    let summary: DbJson<Value> = sqlx::query_scalar("SELECT jsonb_build_object('projects',(SELECT count(*) FROM projects),'services',(SELECT count(*) FROM services),'ready_instances',(SELECT count(*) FROM instances i JOIN nodes n ON n.id=i.node_id WHERE i.desired_state='running' AND i.state='ready' AND i.observed_at>now()-interval '15 seconds' AND n.last_seen>now()-interval '30 seconds'),'healthy_nodes',(SELECT count(*) FROM nodes WHERE last_seen>now()-interval '30 seconds'),'total_nodes',(SELECT count(*) FROM nodes),'pending_builds',(SELECT count(*) FROM builds WHERE status IN ('queued','running')),'failed_deployments',(SELECT count(*) FROM deployments WHERE status='failed' AND job_options IS NULL AND created_at>now()-interval '24 hours'))").fetch_one(&pool).await?;
    let deployments: Vec<DbJson<Value>> = sqlx::query_scalar("SELECT jsonb_build_object('id',d.id,'service_id',s.id,'service',s.name,'project',p.name,'environment',e.name,'status',d.status,'created_at',d.created_at,'error_code',d.error_code) FROM deployments d JOIN services s ON s.id=d.service_id JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id WHERE d.job_options IS NULL ORDER BY d.created_at DESC,d.id DESC LIMIT 12").fetch_all(&pool).await?;
    let builds: Vec<DbJson<Value>> = sqlx::query_scalar("SELECT jsonb_build_object('id',b.id,'service_id',s.id,'service',s.name,'project',p.name,'environment',e.name,'status',b.status,'created_at',b.created_at,'error_code',b.error_code) FROM builds b JOIN services s ON s.id=b.service_id JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id ORDER BY b.created_at DESC,b.id DESC LIMIT 8").fetch_all(&pool).await?;
    Ok(Json(
        json!({"summary":summary,"deployments":deployments,"builds":builds}),
    ))
}

#[derive(Default, serde::Deserialize)]
pub struct HostQuery {
    #[serde(default)]
    range: crate::host_metrics::Range,
}
pub async fn hosts(
    State(pool): State<PgPool>,
    Query(query): Query<HostQuery>,
) -> Result<Json<Value>, ApiError> {
    let nodes: Vec<DbJson<Value>> = sqlx::query_scalar("SELECT jsonb_build_object('id',n.id,'name',n.name,'cordoned',n.cordoned,'last_seen',n.last_seen,'healthy',coalesce(n.last_seen>now()-interval '30 seconds',false),'cpu_millis',n.cpu_millis,'memory_mib',n.memory_mib,'slots',n.slots,'occupied_slots',(SELECT count(*) FROM instances i WHERE i.node_id=n.id AND i.state<>'stopped'),'reserved_cpu_millis',coalesce((SELECT sum((d.spec->'resources'->>'cpu_millis')::bigint) FROM instances i JOIN deployments d ON d.id=i.deployment_id WHERE i.node_id=n.id AND i.state<>'stopped'),0),'reserved_memory_mib',coalesce((SELECT sum((d.spec->'resources'->>'memory_mib')::bigint) FROM instances i JOIN deployments d ON d.id=i.deployment_id WHERE i.node_id=n.id AND i.state<>'stopped'),0)) FROM nodes n ORDER BY n.name").fetch_all(&pool).await?;
    Ok(Json(
        json!({"host":crate::host_metrics::snapshot(&pool, query.range).await?,"nodes":nodes}),
    ))
}
