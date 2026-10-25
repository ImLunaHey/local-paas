//! Explicit same-environment connections. Never resolves an arbitrary hostname.
use crate::ApiError;
use axum::{
    Json,
    extract::{Path, State},
};
use chrono::{DateTime, Utc};
use platform_domain::ServiceSpec;
use platform_protocol::PrivateBackend;
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Row, Transaction, types::Json as DbJson};
use uuid::Uuid;

pub async fn validate(
    tx: &mut Transaction<'_, Postgres>,
    spec: &ServiceSpec,
) -> Result<(), ApiError> {
    for c in spec.workload.private_connections() {
        if crate::scaling::policy(tx, c.service_id)
            .await?
            .is_some_and(|p| p.min_replicas == 0)
        {
            return Err(ApiError::Conflict(
                "private connections cannot target a scale-to-zero service",
            ));
        }
        if spec.secrets.contains(&c.env) {
            return Err(ApiError::Conflict(
                "private connection variable conflicts with a secret",
            ));
        }
        let valid: bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM services WHERE id=$1 AND spec->>'project'=$2 AND spec->>'environment'=$3 AND kind='oci-service' AND coalesce(spec->'workload'->>'execution','http')='http')").bind(c.service_id).bind(&spec.project).bind(&spec.environment).fetch_one(&mut **tx).await?;
        if !valid {
            return Err(ApiError::Conflict(
                "private connections require an HTTP service in this project and environment",
            ));
        }
    }
    Ok(())
}

pub async fn list(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    crate::runtime::service_exists(&pool, id).await?;
    let items: Vec<DbJson<Value>>=sqlx::query_scalar("SELECT jsonb_build_object('id',s.id,'name',s.name,'readyInstances',(SELECT count(*) FROM instances i JOIN deployments d ON d.id=i.deployment_id JOIN nodes n ON n.id=i.node_id WHERE d.service_id=s.id AND d.status='active' AND i.desired_state='running' AND i.state='ready' AND i.routing_enabled AND i.observed_at>now()-interval '15 seconds' AND n.last_seen>now()-interval '30 seconds')) FROM services s JOIN services caller ON caller.environment_id=s.environment_id WHERE caller.id=$1 AND s.id<>$1 AND s.kind='oci-service' AND coalesce(s.spec->'workload'->>'execution','http')='http' ORDER BY s.name").bind(id).fetch_all(&pool).await?;
    Ok(Json(json!({"items":items})))
}

pub async fn backends(
    tx: &mut Transaction<'_, Postgres>,
    source: Uuid,
    spec: &ServiceSpec,
) -> Result<Vec<Vec<PrivateBackend>>, sqlx::Error> {
    let mut routes = Vec::new();
    for connection in spec.workload.private_connections() {
        // Use current stable environment IDs: project renames don't invalidate
        // old deployment snapshots. No old/superseded/candidate backend is used.
        let rows = sqlx::query("SELECT i.id,n.endpoint_base+i.slot AS port,least(clock_timestamp()+interval '10 seconds',i.observed_at+interval '15 seconds',n.last_seen+interval '30 seconds') AS expires FROM instances i JOIN deployments d ON d.id=i.deployment_id JOIN nodes n ON n.id=i.node_id JOIN services target ON target.id=d.service_id JOIN services caller ON caller.environment_id=target.environment_id WHERE caller.id=$1 AND target.id=$2 AND d.status='active' AND d.job_options IS NULL AND i.desired_state='running' AND i.state='ready' AND i.routing_enabled AND i.observed_at>clock_timestamp()-interval '15 seconds' AND n.last_seen>clock_timestamp()-interval '30 seconds' AND coalesce(d.spec->'workload'->>'execution','http')='http' ORDER BY i.id LIMIT 32").bind(source).bind(connection.service_id).fetch_all(&mut **tx).await?;
        let mut endpoints = Vec::new();
        for row in rows {
            let expires: DateTime<Utc> = row.get("expires");
            sqlx::query("INSERT INTO private_route_leases(instance_id,expires_at) VALUES($1,$2) ON CONFLICT(instance_id) DO UPDATE SET expires_at=greatest(private_route_leases.expires_at,excluded.expires_at)").bind(row.get::<Uuid,_>("id")).bind(expires).execute(&mut **tx).await?;
            endpoints.push(PrivateBackend {
                port: row.get::<i32, _>("port") as u16,
                expires_unix_ms: expires.timestamp_millis(),
            });
        }
        routes.push(endpoints);
    }
    Ok(routes)
}
