//! Durable desired runtime state. Polling agents never receive database credentials.
use crate::{ApiError, Service};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use chrono::{DateTime, Utc};
use platform_domain::{ServiceSpec, Workload};
use platform_protocol::{Assignment, SyncRequest, SyncResponse, VERSION};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row, types::Json as DbJson};
use uuid::Uuid;

pub fn token_hash(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeployRequest {
    pub operation_id: Uuid,
    pub revision_id: Uuid,
}

pub(crate) async fn deploy(
    State(pool): State<PgPool>,
    Path(service_id): Path<Uuid>,
    Json(input): Json<DeployRequest>,
) -> Result<Json<Value>, ApiError> {
    let database_spec: Option<DbJson<ServiceSpec>> =
        sqlx::query_scalar("SELECT spec FROM services WHERE id=$1")
            .bind(service_id)
            .fetch_optional(&pool)
            .await?;
    if database_spec
        .as_ref()
        .is_some_and(|s| s.workload.is_managed())
    {
        crate::secrets::database_password(&pool, service_id).await?;
    }
    let mut tx = pool.begin().await?;
    // Serializes allocation and promotion across API processes without a leader lease.
    sqlx::query("SELECT pg_advisory_xact_lock(712184551)")
        .execute(&mut *tx)
        .await?;
    if let Some(row) =
        sqlx::query("SELECT id,service_id,revision_id FROM deployments WHERE operation_id=$1")
            .bind(input.operation_id)
            .fetch_optional(&mut *tx)
            .await?
    {
        if row.get::<Uuid, _>("service_id") != service_id
            || row.get::<Uuid, _>("revision_id") != input.revision_id
        {
            return Err(ApiError::Conflict(
                "operation ID belongs to another deployment",
            ));
        }
        return Ok(Json(json!({"id":row.get::<Uuid,_>("id")})));
    }
    let service: Service = sqlx::query_as("SELECT * FROM services WHERE id=$1 FOR UPDATE")
        .bind(service_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(ApiError::NotFound)?;
    let mut resolved_spec = service.spec.0.clone();
    resolved_spec.secrets = crate::secrets::references(&pool, service_id).await?;
    let spec = &resolved_spec;
    let (replicas, database_size) = match spec.workload {
        Workload::OciService { replicas, .. } => (replicas, None),
        Workload::PostgresService { storage_gib, .. }
        | Workload::RedisService { storage_gib }
        | Workload::RustfsService { storage_gib } => (1, Some(storage_gib)),
        _ => {
            return Err(ApiError::Conflict(
                "celld requires its dedicated fleet runtime",
            ));
        }
    };
    if !spec.workload.is_worker() && (database_size.is_some() || spec.volume.is_some()) {
        let occupied: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM instances i JOIN deployments d ON d.id=i.deployment_id WHERE d.service_id=$1 AND i.state<>'stopped')").bind(service_id).fetch_one(&mut *tx).await?;
        if occupied {
            return Err(ApiError::Conflict(
                "stop this service and wait for confirmed shutdown before deploying a volume-backed revision; other attached services keep running",
            ));
        }
    }
    let volume: Option<(Uuid, i32, i32)> =
        sqlx::query_as("SELECT node_id,slot,size_gib FROM volumes WHERE id=$1")
            .bind(service_id)
            .fetch_optional(&mut *tx)
            .await?;
    if let Some((_, _, size)) = volume
        && database_size != Some(size as u16)
    {
        return Err(ApiError::Conflict(
            "database storage size and workload kind cannot change after volume allocation",
        ));
    }
    crate::volumes::validate_scope(&mut tx, spec).await?;
    let shared: Option<(Option<Uuid>, i32)> = if let Some(v) = &spec.volume {
        Some(
            sqlx::query_as("SELECT node_id,size_gib FROM shared_volumes WHERE id=$1 FOR UPDATE")
                .bind(v.id)
                .fetch_one(&mut *tx)
                .await?,
        )
    } else {
        None
    };
    let secret_version = crate::secrets::snapshot(&pool, service_id, &spec.secrets).await?;
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM revisions WHERE id=$1 AND service_id=$2)")
            .bind(input.revision_id)
            .bind(service_id)
            .fetch_one(&mut *tx)
            .await?;
    if !exists {
        return Err(ApiError::NotFound);
    }
    let preparing: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM deployments WHERE service_id=$1 AND status IN ('preparing','waiting'))",
    )
    .bind(service_id)
    .fetch_one(&mut *tx)
    .await?;
    if preparing {
        return Err(ApiError::Conflict("a deployment is already preparing"));
    }
    let database_ports:Vec<i32>=sqlx::query_scalar("SELECT n.endpoint_base+v.slot FROM database_connections c JOIN volumes v ON v.id=c.database_id JOIN nodes n ON n.id=v.node_id WHERE c.service_id=$1 UNION SELECT n.endpoint_base+v.slot FROM storage_bindings c JOIN storage_buckets b ON b.id=c.bucket_id JOIN volumes v ON v.id=b.service_id JOIN nodes n ON n.id=v.node_id WHERE c.service_id=$1 AND c.status='ready'").bind(service_id).fetch_all(&mut *tx).await?;
    if spec.workload.is_worker() {
        let deployment = Uuid::new_v4();
        sqlx::query("INSERT INTO deployments(id,operation_id,service_id,revision_id,spec,status,secret_version,secret_snapshot,database_ports,volume_size_gib,error_code) VALUES($1,$2,$3,$4,$5,'waiting',$6,true,$7,$8,'waiting_for_shutdown')").bind(deployment).bind(input.operation_id).bind(service_id).bind(input.revision_id).bind(DbJson(spec)).bind(secret_version).bind(&database_ports).bind(shared.map(|v| v.1)).execute(&mut *tx).await?;
        sqlx::query(
            "UPDATE deployments SET status='superseded' WHERE service_id=$1 AND status='active'",
        )
        .bind(service_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query("UPDATE instances SET desired_state='stopped',generation=generation+1 WHERE deployment_id IN(SELECT id FROM deployments WHERE service_id=$1) AND desired_state<>'stopped'").bind(service_id).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO events(id,service_id,operation_id,kind) VALUES($1,$2,$3,'deployment.requested')").bind(Uuid::new_v4()).bind(service_id).bind(input.operation_id).execute(&mut *tx).await?;
        tx.commit().await?;
        return Ok(Json(json!({"id":deployment})));
    }
    let placements = place(&mut tx, service_id, spec, &database_ports, volume, shared).await?;
    if placements.len() != replicas as usize {
        return Err(ApiError::Conflict(
            "insufficient healthy worker capacity for the requested replicas and placement; the current deployment is unchanged",
        ));
    }
    if let Some(size) = database_size
        && volume.is_none()
    {
        sqlx::query("INSERT INTO volumes(id,node_id,slot,size_gib) VALUES($1,$2,$3,$4)")
            .bind(service_id)
            .bind(placements[0].0)
            .bind(placements[0].1)
            .bind(i32::from(size))
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = &spec.volume {
        sqlx::query("UPDATE shared_volumes SET node_id=$2 WHERE id=$1 AND node_id IS NULL")
            .bind(v.id)
            .bind(placements[0].0)
            .execute(&mut *tx)
            .await?;
    }
    let deployment = Uuid::new_v4();
    sqlx::query("INSERT INTO deployments(id,operation_id,service_id,revision_id,spec,status,secret_version,secret_snapshot,database_ports,volume_size_gib) VALUES($1,$2,$3,$4,$5,'preparing',$6,true,$7,$8)").bind(deployment).bind(input.operation_id).bind(service_id).bind(input.revision_id).bind(DbJson(spec)).bind(secret_version).bind(database_ports).bind(shared.map(|v| v.1)).execute(&mut *tx).await?;
    for (node, slot) in placements {
        sqlx::query("INSERT INTO instances(id,deployment_id,node_id,slot,desired_state) VALUES($1,$2,$3,$4,'running')").bind(Uuid::new_v4()).bind(deployment).bind(node).bind(slot).execute(&mut *tx).await?;
    }
    sqlx::query("INSERT INTO events(id,service_id,operation_id,kind) VALUES($1,$2,$3,'deployment.requested')").bind(Uuid::new_v4()).bind(service_id).bind(input.operation_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"id":deployment})))
}

async fn place(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    service_id: Uuid,
    spec: &ServiceSpec,
    database_ports: &[i32],
    volume: Option<(Uuid, i32, i32)>,
    shared: Option<(Option<Uuid>, i32)>,
) -> Result<Vec<(Uuid, i32)>, sqlx::Error> {
    let replicas = match spec.workload {
        Workload::OciService { replicas, .. } => replicas,
        _ => 1,
    };
    let database_size = match spec.workload {
        Workload::PostgresService { storage_gib, .. }
        | Workload::RedisService { storage_gib }
        | Workload::RustfsService { storage_gib } => Some(storage_gib),
        _ => None,
    };
    let nodes = sqlx::query("SELECT * FROM nodes WHERE NOT cordoned AND last_seen>now()-interval '30 seconds' ORDER BY name FOR UPDATE").fetch_all(&mut **tx).await?;
    let mut placements = Vec::new();
    for node in nodes {
        let id: Uuid = node.get("id");
        if spec.workload.is_worker()
            && !node
                .get::<Vec<String>, _>("capabilities")
                .iter()
                .any(|c| c == "workers-v1")
        {
            continue;
        }
        if (database_size.is_some() || !database_ports.is_empty())
            && !node
                .get::<Vec<String>, _>("capabilities")
                .iter()
                .any(|c| c == "databases-v1")
        {
            continue;
        }
        if matches!(spec.workload, Workload::RustfsService { .. })
            && !node
                .get::<Vec<String>, _>("capabilities")
                .iter()
                .any(|c| c == "rustfs-v1")
        {
            continue;
        }
        if shared.is_some()
            && !node
                .get::<Vec<String>, _>("capabilities")
                .iter()
                .any(|c| c == "shared-volumes-v1")
        {
            continue;
        }
        if shared.and_then(|v| v.0).is_some_and(|owner| owner != id) {
            continue;
        }
        if (database_size.is_some() && volume.is_none()) || shared.is_some_and(|v| v.0.is_none()) {
            let reserved_gib:i64=sqlx::query_scalar("SELECT (SELECT coalesce(sum(size_gib),0) FROM volumes WHERE node_id=$1)+(SELECT coalesce(sum(size_gib),0) FROM shared_volumes WHERE node_id=$1)").bind(id).fetch_one(&mut **tx).await?;
            let needed = database_size
                .map(i32::from)
                .or(shared.map(|v| v.1))
                .unwrap_or(0);
            if reserved_gib + i64::from(needed) > 8 {
                continue;
            }
        }
        if volume.is_some_and(|v| v.0 != id) {
            continue;
        }
        let reserved: Vec<i32> =
            sqlx::query_scalar("SELECT slot FROM volumes WHERE node_id=$1 AND id<>$2")
                .bind(id)
                .bind(service_id)
                .fetch_all(&mut **tx)
                .await?;
        let used = sqlx::query("SELECT i.slot,d.spec FROM instances i JOIN deployments d ON d.id=i.deployment_id WHERE i.node_id=$1 AND i.state<>'stopped'").bind(id).fetch_all(&mut **tx).await?;
        let mut cpu = 0;
        let mut memory = 0;
        let mut slots = Vec::new();
        for row in used {
            let DbJson(s): DbJson<ServiceSpec> = row.get("spec");
            cpu += s.resources.cpu_millis as i32;
            memory += s.resources.memory_mib as i32;
            slots.push(row.get::<i32, _>("slot"));
        }
        for slot in 0..node.get::<i32, _>("slots") {
            if placements.len() == replicas as usize {
                break;
            }
            if !slots.contains(&slot)
                && !reserved.contains(&slot)
                && volume.is_none_or(|v| v.1 == slot)
                && cpu + spec.resources.cpu_millis as i32 <= node.get::<i32, _>("cpu_millis")
                && memory + spec.resources.memory_mib as i32 <= node.get::<i32, _>("memory_mib")
            {
                placements.push((id, slot));
                cpu += spec.resources.cpu_millis as i32;
                memory += spec.resources.memory_mib as i32;
                if spec.distinct_nodes {
                    break;
                }
            }
        }
    }
    Ok(placements)
}

async fn reconcile_workers(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<(), sqlx::Error> {
    let waiting = sqlx::query("SELECT id,service_id,spec,database_ports FROM deployments WHERE status='waiting' ORDER BY created_at FOR UPDATE").fetch_all(&mut **tx).await?;
    for row in waiting {
        let id: Uuid = row.get("id");
        let service: Uuid = row.get("service_id");
        let DbJson(spec): DbJson<ServiceSpec> = row.get("spec");
        // Unknown, stale and failed instances all retain ownership until the
        // assigned agent confirms cleanup at the current generation.
        let occupied: bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM instances i JOIN deployments d ON d.id=i.deployment_id WHERE d.service_id=$1 AND i.state<>'stopped')").bind(service).fetch_one(&mut **tx).await?;
        if occupied {
            continue;
        }
        let shared: Option<(Option<Uuid>, i32)> = if let Some(v) = &spec.volume {
            Some(
                sqlx::query_as(
                    "SELECT node_id,size_gib FROM shared_volumes WHERE id=$1 FOR UPDATE",
                )
                .bind(v.id)
                .fetch_one(&mut **tx)
                .await?,
            )
        } else {
            None
        };
        let ports: Vec<i32> = row.get("database_ports");
        let placements = place(tx, service, &spec, &ports, None, shared).await?;
        if placements.len() != 1 {
            sqlx::query("UPDATE deployments SET error_code='waiting_for_capacity' WHERE id=$1 AND error_code IS DISTINCT FROM 'waiting_for_capacity'").bind(id).execute(&mut **tx).await?;
            continue;
        }
        if let Some(v) = spec.volume {
            sqlx::query("UPDATE shared_volumes SET node_id=$2 WHERE id=$1 AND node_id IS NULL")
                .bind(v.id)
                .bind(placements[0].0)
                .execute(&mut **tx)
                .await?;
        }
        sqlx::query("INSERT INTO instances(id,deployment_id,node_id,slot,desired_state) VALUES($1,$2,$3,$4,'running')").bind(Uuid::new_v4()).bind(id).bind(placements[0].0).bind(placements[0].1).execute(&mut **tx).await?;
        sqlx::query("UPDATE deployments SET status='preparing',error_code=NULL,deadline=now()+interval '180 seconds' WHERE id=$1").bind(id).execute(&mut **tx).await?;
        sqlx::query("INSERT INTO events(id,service_id,operation_id,kind) VALUES($1,$2,$3,'deployment.assigned')").bind(Uuid::new_v4()).bind(service).bind(id).execute(&mut **tx).await?;
    }
    Ok(())
}

pub(crate) async fn stop(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(712184551)")
        .execute(&mut *tx)
        .await?;
    let row = sqlx::query("SELECT service_id FROM deployments WHERE id=$1 FOR UPDATE")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(ApiError::NotFound)?;
    sqlx::query("UPDATE deployments SET status='stopped' WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE instances SET desired_state='stopped',generation=generation+1 WHERE deployment_id=$1 AND desired_state<>'stopped'").bind(id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO events(id,service_id,operation_id,kind) VALUES($1,$2,$3,'deployment.stopped') ON CONFLICT(operation_id,kind) DO NOTHING").bind(Uuid::new_v4()).bind(row.get::<Uuid,_>("service_id")).bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"id":id})))
}

pub async fn reconcile(pool: &PgPool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(712184551)")
        .execute(&mut *tx)
        .await?;
    reconcile_workers(&mut tx).await?;
    let pending = sqlx::query("SELECT id,service_id,deadline<now() AS expired FROM deployments WHERE status='preparing' FOR UPDATE").fetch_all(&mut *tx).await?;
    for d in pending {
        let id: Uuid = d.get("id");
        let service: Uuid = d.get("service_id");
        let states=sqlx::query("SELECT i.state,(i.observed_at>now()-interval '15 seconds' AND n.last_seen>now()-interval '30 seconds') AS fresh FROM instances i JOIN nodes n ON n.id=i.node_id WHERE i.deployment_id=$1").bind(id).fetch_all(&mut *tx).await?;
        let failed = d.get::<bool, _>("expired")
            || states
                .iter()
                .any(|r| r.get::<String, _>("state") == "failed");
        let ready = !states.is_empty()
            && states.iter().all(|r| {
                r.get::<String, _>("state") == "ready"
                    && r.get::<Option<bool>, _>("fresh") == Some(true)
            });
        if failed || ready {
            if ready && !failed {
                let old: Vec<Uuid>=sqlx::query_scalar("UPDATE deployments SET status='superseded' WHERE service_id=$1 AND status='active' RETURNING id").bind(service).fetch_all(&mut *tx).await?;
                for old in old {
                    sqlx::query("UPDATE instances SET desired_state='stopped',generation=generation+1 WHERE deployment_id=$1 AND desired_state='running'").bind(old).execute(&mut *tx).await?;
                }
                sqlx::query("UPDATE deployments SET status='active' WHERE id=$1")
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            } else {
                sqlx::query("UPDATE deployments SET status='failed',error_code='readiness_failed' WHERE id=$1").bind(id).execute(&mut *tx).await?;
                sqlx::query("UPDATE instances SET desired_state='stopped',generation=generation+1 WHERE deployment_id=$1 AND desired_state='running'").bind(id).execute(&mut *tx).await?;
            }
            sqlx::query("INSERT INTO events(id,service_id,operation_id,kind) VALUES($1,$2,$3,$4) ON CONFLICT(operation_id,kind) DO NOTHING").bind(Uuid::new_v4()).bind(service).bind(id).bind(if failed {"deployment.failed"} else {"deployment.active"}).execute(&mut *tx).await?;
        }
    }
    sqlx::query("DELETE FROM runtime_metrics WHERE timestamp<now()-interval '1 hour'")
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

type NodeError = (StatusCode, &'static str);
fn db_error(_: sqlx::Error) -> NodeError {
    (StatusCode::SERVICE_UNAVAILABLE, "runtime state unavailable")
}
pub async fn sync(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<SyncRequest>,
) -> Result<Json<SyncResponse>, NodeError> {
    if input.version != VERSION
        || input.observations.len() > 8
        || input.capabilities.len() > 16
        || input.capabilities.iter().any(|c| {
            c.len() > 64
                || !c
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
    {
        return Err((StatusCode::BAD_REQUEST, "invalid protocol request"));
    }
    let token = headers
        .get("authorization")
        .and_then(|x| x.to_str().ok())
        .and_then(|x| x.strip_prefix("Bearer "))
        .filter(|x| x.len() == 64)
        .ok_or((StatusCode::UNAUTHORIZED, "node credentials required"))?;
    let mut tx = pool.begin().await.map_err(db_error)?;
    let known =
        sqlx::query("UPDATE nodes SET last_seen=now(),capabilities=$3 WHERE id=$1 AND token_hash=$2 RETURNING id")
            .bind(input.node_id)
            .bind(token_hash(token))
            .bind(&input.capabilities)
        .fetch_optional(&mut *tx)
            .await
            .map_err(db_error)?;
    if known.is_none() {
        return Err((StatusCode::UNAUTHORIZED, "invalid node identity"));
    }
    for o in input.observations {
        if o.observed_unix_ms < 0 || o.observed_unix_ms > Utc::now().timestamp_millis() + 5000 {
            return Err((StatusCode::BAD_REQUEST, "invalid observation time"));
        }
        if !["starting", "ready", "failed", "stopped", "unknown"].contains(&o.state.as_str())
            || o.logs.len() > 256
            || o.diagnostic.as_ref().is_some_and(|s| s.len() > 128)
        {
            return Err((StatusCode::BAD_REQUEST, "invalid observation"));
        }
        if o.metrics.as_ref().is_some_and(|m| {
            !m.cpu_millis.is_finite()
                || !(0.0..=128000.0).contains(&m.cpu_millis)
                || m.memory_bytes > 1 << 50
                || m.pids > 1_000_000
                || [
                    m.io_read_bytes_per_second,
                    m.io_write_bytes_per_second,
                    m.network_rx_bytes_per_second,
                    m.network_tx_bytes_per_second,
                ]
                .into_iter()
                .flatten()
                .any(|v| !v.is_finite() || !(0.0..=1e15).contains(&v))
        }) {
            return Err((StatusCode::BAD_REQUEST, "invalid measurement"));
        }
        let m = o.metrics.as_ref();
        let updated=sqlx::query("UPDATE instances SET state=$4,diagnostic=CASE WHEN $4='stopped' THEN coalesce($5,diagnostic) ELSE $5 END,observed_at=to_timestamp($9::double precision/1000),cpu_millis=$6,memory_bytes=$7,pids=$8 WHERE id=$1 AND node_id=$2 AND generation=$3 AND (observed_at IS NULL OR observed_at<to_timestamp($9::double precision/1000)) RETURNING id")
            .bind(o.instance_id).bind(input.node_id).bind(o.generation).bind(&o.state).bind(&o.diagnostic).bind(m.map(|m|m.cpu_millis)).bind(m.map(|m|m.memory_bytes as i64)).bind(m.map(|m|m.pids as i64)).bind(o.observed_unix_ms as f64).fetch_optional(&mut *tx).await.map_err(db_error)?;
        if updated.is_none() {
            continue;
        }
        if let Some(started) = &o.process_started_at {
            let started = started
                .parse::<DateTime<Utc>>()
                .map_err(|_| (StatusCode::BAD_REQUEST, "invalid process start time"))?;
            if started.timestamp_millis() > o.observed_unix_ms + 5000 || started.timestamp() < 0 {
                return Err((StatusCode::BAD_REQUEST, "invalid process start time"));
            }
            sqlx::query("INSERT INTO instance_starts(instance_id,started_at) VALUES($1,$2) ON CONFLICT DO NOTHING").bind(o.instance_id).bind(started).execute(&mut *tx).await.map_err(db_error)?;
        }
        sqlx::query("UPDATE instances SET io_read_bytes_per_second=$2,io_write_bytes_per_second=$3,network_rx_bytes_per_second=$4,network_tx_bytes_per_second=$5 WHERE id=$1").bind(o.instance_id).bind(m.and_then(|m|m.io_read_bytes_per_second)).bind(m.and_then(|m|m.io_write_bytes_per_second)).bind(m.and_then(|m|m.network_rx_bytes_per_second)).bind(m.and_then(|m|m.network_tx_bytes_per_second)).execute(&mut *tx).await.map_err(db_error)?;
        if let Some(m) = m {
            sqlx::query("INSERT INTO runtime_metrics(instance_id,cpu_millis,memory_bytes,pids,io_read_bytes_per_second,io_write_bytes_per_second,network_rx_bytes_per_second,network_tx_bytes_per_second) VALUES($1,$2,$3,$4,$5,$6,$7,$8)").bind(o.instance_id).bind(m.cpu_millis).bind(m.memory_bytes as i64).bind(m.pids as i64).bind(m.io_read_bytes_per_second).bind(m.io_write_bytes_per_second).bind(m.network_rx_bytes_per_second).bind(m.network_tx_bytes_per_second).execute(&mut *tx).await.map_err(db_error)?;
        }
        for log in o.logs {
            if log.key.len() != 64
                || log.line.len() > 16384
                || !["stdout", "stderr"].contains(&log.stream.as_str())
            {
                return Err((StatusCode::BAD_REQUEST, "invalid log entry"));
            }
            let timestamp = log
                .timestamp
                .parse::<DateTime<Utc>>()
                .map_err(|_| (StatusCode::BAD_REQUEST, "invalid log timestamp"))?;
            let inserted=sqlx::query("INSERT INTO runtime_log_keys(instance_id,entry_key) VALUES($1,$2) ON CONFLICT DO NOTHING").bind(o.instance_id).bind(&log.key).execute(&mut *tx).await.map_err(db_error)?;
            if inserted.rows_affected() == 0 {
                continue;
            }
            let (level, message, fields) = crate::logging::parse(&log.line);
            sqlx::query("INSERT INTO runtime_logs(instance_id,entry_key,timestamp,stream,line,level,message,fields) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(instance_id,entry_key) DO NOTHING").bind(o.instance_id).bind(log.key).bind(timestamp).bind(log.stream).bind(log.line).bind(level).bind(message).bind(fields.map(DbJson)).execute(&mut *tx).await.map_err(db_error)?;
        }
    }
    let rows=sqlx::query("SELECT i.id,i.generation,i.desired_state,i.slot,d.id AS deployment_id,d.service_id,d.revision_id,d.spec,d.status AS deployment_status,d.database_ports,d.volume_size_gib,r.image_repository,r.image_digest FROM instances i JOIN deployments d ON d.id=i.deployment_id JOIN revisions r ON r.id=d.revision_id WHERE i.node_id=$1 AND i.state<>'stopped'").bind(input.node_id).fetch_all(&mut *tx).await.map_err(db_error)?;
    let mut assignments = Vec::new();
    for r in rows {
        let spec = r.get::<DbJson<ServiceSpec>, _>("spec").0;
        if spec.workload.is_worker() && !input.capabilities.iter().any(|c| c == "workers-v1") {
            continue;
        }
        let digest = r
            .get::<String, _>("image_digest")
            .try_into()
            .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "invalid stored image"))?;
        assignments.push(Assignment {
            instance_id: r.get("id"),
            deployment_id: r.get("deployment_id"),
            revision_id: r.get("revision_id"),
            service_id: r.get("service_id"),
            generation: r.get("generation"),
            desired_state: r.get("desired_state"),
            recovery_allowed: r.get::<String, _>("deployment_status") == "active"
                && input.capabilities.iter().any(|c| c == "recovery-v1"),
            image_repository: r.get("image_repository"),
            image_digest: digest,
            spec,
            volume_size_gib: r.get::<Option<i32>, _>("volume_size_gib").map(|v| v as u16),
            published_port: 20000 + r.get::<i32, _>("slot") as u16,
            database_ports: r
                .get::<Vec<i32>, _>("database_ports")
                .into_iter()
                .map(|p| p as u16)
                .collect(),
        });
    }
    tx.commit().await.map_err(db_error)?;
    Ok(Json(SyncResponse {
        version: VERSION,
        assignments,
    }))
}

pub(crate) async fn service_exists(pool: &PgPool, id: Uuid) -> Result<(), ApiError> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM services WHERE id=$1)")
        .bind(id)
        .fetch_one(pool)
        .await?;
    if exists {
        Ok(())
    } else {
        Err(ApiError::NotFound)
    }
}
pub(crate) async fn status(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    service_exists(&pool, id).await?;
    let deployments:Vec<DbJson<Value>>=sqlx::query_scalar("SELECT to_jsonb(d) FROM (SELECT id,revision_id,status,error_code,created_at FROM deployments WHERE service_id=$1 ORDER BY created_at DESC LIMIT 20) d").bind(id).fetch_all(&pool).await?;
    let instances:Vec<DbJson<Value>>=sqlx::query_scalar("SELECT jsonb_build_object('id',i.id,'deployment_id',i.deployment_id,'node_id',n.id,'node_name',n.name,'state',CASE WHEN i.state='stopped' THEN 'stopped' WHEN n.last_seen<now()-interval '30 seconds' OR i.observed_at<now()-interval '15 seconds' THEN 'unknown' ELSE i.state END,'desired_state',i.desired_state,'diagnostic',i.diagnostic,'observed_at',i.observed_at,'cpu_millis',i.cpu_millis,'memory_bytes',i.memory_bytes,'pids',i.pids,'io_read_bytes_per_second',i.io_read_bytes_per_second,'io_write_bytes_per_second',i.io_write_bytes_per_second,'network_rx_bytes_per_second',i.network_rx_bytes_per_second,'network_tx_bytes_per_second',i.network_tx_bytes_per_second) FROM instances i JOIN nodes n ON n.id=i.node_id JOIN deployments d ON d.id=i.deployment_id WHERE d.service_id=$1 ORDER BY d.created_at DESC,n.name LIMIT 80").bind(id).fetch_all(&pool).await?;
    let nodes: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM nodes WHERE last_seen>now()-interval '30 seconds' AND NOT cordoned",
    )
    .fetch_one(&pool)
    .await?;
    let authority: Option<String> =
        sqlx::query_scalar("SELECT authority FROM preview_routes WHERE service_id=$1")
            .bind(id)
            .fetch_optional(&pool)
            .await?;
    Ok(Json(
        json!({"deployments":deployments,"instances":instances,"healthy_nodes":nodes,"preview_url":authority.map(|a|format!("https://{a}"))}),
    ))
}
pub(crate) async fn metrics(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    service_exists(&pool, id).await?;
    let entries:Vec<DbJson<Value>>=sqlx::query_scalar("SELECT jsonb_build_object('instance_id',i.id,'node',n.name,'timestamp',m.timestamp,'cpu_millis',m.cpu_millis,'memory_bytes',m.memory_bytes,'pids',m.pids,'io_read_bytes_per_second',m.io_read_bytes_per_second,'io_write_bytes_per_second',m.io_write_bytes_per_second,'network_rx_bytes_per_second',m.network_rx_bytes_per_second,'network_tx_bytes_per_second',m.network_tx_bytes_per_second) FROM runtime_metrics m JOIN instances i ON i.id=m.instance_id JOIN deployments d ON d.id=i.deployment_id JOIN nodes n ON n.id=i.node_id WHERE d.service_id=$1 AND m.timestamp>now()-interval '15 minutes' ORDER BY m.timestamp DESC LIMIT 5000").bind(id).fetch_all(&pool).await?;
    Ok(Json(json!({"samples":entries})))
}
