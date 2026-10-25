use crate::ApiError;
use axum::{
    Extension, Json,
    extract::{Query, State},
};
use serde_json::{Value, json};
use sqlx::{PgPool, types::Json as DbJson};

pub async fn get(
    State(pool): State<PgPool>,
    Extension(context): Extension<crate::auth::Context>,
) -> Result<Json<Value>, ApiError> {
    let organization = if context.is_superuser {
        None
    } else {
        context.organization_id.as_deref()
    };
    let summary: DbJson<Value> = sqlx::query_scalar("SELECT jsonb_build_object('projects',(SELECT count(*) FROM projects WHERE $1::text IS NULL OR organization_id=$1),'services',(SELECT count(*) FROM services s JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id WHERE $1::text IS NULL OR p.organization_id=$1),'readyInstances',(SELECT count(*) FROM instances i JOIN nodes n ON n.id=i.node_id JOIN deployments d ON d.id=i.deployment_id JOIN services s ON s.id=d.service_id JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id WHERE ($1::text IS NULL OR p.organization_id=$1) AND i.desired_state='running' AND i.state='ready' AND i.observed_at>now()-interval '15 seconds' AND n.last_seen>now()-interval '30 seconds'),'healthyNodes',(SELECT count(*) FROM nodes WHERE ($1::text IS NULL OR organization_id=$1) AND last_seen>now()-interval '30 seconds'),'totalNodes',(SELECT count(*) FROM nodes WHERE $1::text IS NULL OR organization_id=$1),'pendingBuilds',(SELECT count(*) FROM builds b JOIN services s ON s.id=b.service_id JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id WHERE ($1::text IS NULL OR p.organization_id=$1) AND b.status IN ('queued','running')),'failedDeployments',(SELECT count(*) FROM deployments d JOIN services s ON s.id=d.service_id JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id WHERE ($1::text IS NULL OR p.organization_id=$1) AND d.status='failed' AND d.job_options IS NULL AND d.created_at>now()-interval '24 hours'))").bind(organization).fetch_one(&pool).await?;
    let deployments: Vec<DbJson<Value>> = sqlx::query_scalar("SELECT jsonb_build_object('id',d.id,'serviceId',s.id,'service',s.name,'project',p.name,'environment',e.name,'status',d.status,'createdAt',d.created_at,'errorCode',d.error_code) FROM deployments d JOIN services s ON s.id=d.service_id JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id WHERE ($1::text IS NULL OR p.organization_id=$1) AND d.job_options IS NULL ORDER BY d.created_at DESC,d.id DESC LIMIT 12").bind(organization).fetch_all(&pool).await?;
    let builds: Vec<DbJson<Value>> = sqlx::query_scalar("SELECT jsonb_build_object('id',b.id,'serviceId',s.id,'service',s.name,'project',p.name,'environment',e.name,'status',b.status,'createdAt',b.created_at,'errorCode',b.error_code) FROM builds b JOIN services s ON s.id=b.service_id JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id WHERE ($1::text IS NULL OR p.organization_id=$1) ORDER BY b.created_at DESC,b.id DESC LIMIT 8").bind(organization).fetch_all(&pool).await?;
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
    Extension(context): Extension<crate::auth::Context>,
) -> Result<Json<Value>, ApiError> {
    if !context.is_superuser {
        return Err(ApiError::Forbidden);
    }
    let nodes: Vec<DbJson<Value>> = sqlx::query_scalar("SELECT jsonb_build_object('id',n.id,'name',n.name,'cordoned',n.cordoned,'lastSeen',n.last_seen,'healthy',coalesce(n.last_seen>now()-interval '30 seconds',false),'cpuMillis',n.cpu_millis,'memoryMib',n.memory_mib,'slots',n.slots,'occupiedSlots',(SELECT count(*) FROM instances i WHERE i.node_id=n.id AND i.state<>'stopped'),'reservedCpuMillis',coalesce((SELECT sum((d.spec->'resources'->>'cpuMillis')::bigint) FROM instances i JOIN deployments d ON d.id=i.deployment_id WHERE i.node_id=n.id AND i.state<>'stopped'),0),'reservedMemoryMib',coalesce((SELECT sum((d.spec->'resources'->>'memoryMib')::bigint) FROM instances i JOIN deployments d ON d.id=i.deployment_id WHERE i.node_id=n.id AND i.state<>'stopped'),0)) FROM nodes n ORDER BY n.name").fetch_all(&pool).await?;
    Ok(Json(
        json!({"host":crate::host_metrics::snapshot(&pool, query.range).await?,"nodes":nodes}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::Context;
    use sqlx::postgres::PgPoolOptions;

    #[tokio::test]
    async fn organization_administrators_cannot_read_controller_host_metrics() {
        let pool = PgPoolOptions::new()
            .connect_lazy("postgresql://localhost/not-used")
            .unwrap();
        let context = Context {
            actor_id: "organization-admin".into(),
            user_id: "organization-admin".into(),
            username: "organization-admin".into(),
            organization_id: Some("organization-a".into()),
            is_superuser: false,
        };
        let result = hosts(State(pool), Query(HostQuery::default()), Extension(context)).await;
        assert!(matches!(result, Err(ApiError::Forbidden)));
    }
}
