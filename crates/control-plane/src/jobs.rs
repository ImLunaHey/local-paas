//! One-shot OCI runs and durable interval scheduling. No automatic job retries.
use crate::{ApiError, Service};
use axum::{
    Json,
    extract::{Path, State},
};
use chrono::{DateTime, Utc};
use platform_domain::{Execution, Workload};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Row, Transaction, types::Json as DbJson};
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Options {
    pub command: Vec<String>,
    pub timeout_seconds: u32,
}
impl Options {
    fn validate(&self) -> Result<(), ApiError> {
        if !(10..=86400).contains(&self.timeout_seconds)
            || self.command.len() > 64
            || self
                .command
                .iter()
                .any(|s| s.len() > 4096 || s.contains('\0'))
            || self.command.iter().map(String::len).sum::<usize>() > 16384
            || self.command.first().is_some_and(|s| s.is_empty())
        {
            return Err(ApiError::Conflict(
                "use a 10–86400 second timeout and at most 64 command arguments (16 KiB total)",
            ));
        }
        Ok(())
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunRequest {
    pub operation_id: Uuid,
    pub revision_id: Uuid,
    pub options: Options,
}
pub async fn run(
    State(pool): State<PgPool>,
    Path(service): Path<Uuid>,
    Json(input): Json<RunRequest>,
) -> Result<Json<Value>, ApiError> {
    input.options.validate()?;
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(712184551)")
        .execute(&mut *tx)
        .await?;
    if let Some(row) = sqlx::query(
        "SELECT id,service_id,revision_id,job_options FROM deployments WHERE operation_id=$1",
    )
    .bind(input.operation_id)
    .fetch_optional(&mut *tx)
    .await?
    {
        if row.get::<Uuid, _>("service_id") != service
            || row.get::<Uuid, _>("revision_id") != input.revision_id
            || row
                .get::<Option<DbJson<Options>>, _>("job_options")
                .map(|o| o.0)
                != Some(input.options)
        {
            return Err(ApiError::Conflict(
                "operation ID belongs to a different run",
            ));
        }
        return Ok(Json(json!({"id":row.get::<Uuid,_>("id")})));
    }
    if occupied(&mut tx, service).await? {
        return Err(ApiError::Conflict(
            "a job is queued, running, or awaiting confirmed cleanup; cancel it or wait before starting another",
        ));
    }
    let id = enqueue(
        &pool,
        &mut tx,
        service,
        input.revision_id,
        input.operation_id,
        &input.options,
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"id":id})))
}

pub(crate) async fn occupied(
    tx: &mut Transaction<'_, Postgres>,
    service: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM deployments d WHERE service_id=$1 AND (status='releasing' OR (job_options IS NOT NULL AND (status='job' OR EXISTS(SELECT 1 FROM instances i WHERE i.deployment_id=d.id AND i.state<>'stopped')))))").bind(service).fetch_one(&mut **tx).await
}

async fn enqueue(
    pool: &PgPool,
    tx: &mut Transaction<'_, Postgres>,
    service_id: Uuid,
    revision: Uuid,
    operation: Uuid,
    options: &Options,
) -> Result<Uuid, ApiError> {
    let service: Service = sqlx::query_as("SELECT * FROM services WHERE id=$1 FOR UPDATE")
        .bind(service_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(ApiError::NotFound)?;
    let mut spec = service.spec.0;
    let Workload::OciService {
        execution,
        replicas,
        port,
        readiness,
        pre_deploy,
        ..
    } = &mut spec.workload
    else {
        return Err(ApiError::Conflict(
            "jobs require an OCI application revision",
        ));
    };
    *pre_deploy = None;
    *execution = Execution::Worker;
    *replicas = 1;
    *port = None;
    *readiness = None;
    spec.domains.clear();
    spec.distinct_nodes = false;
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM revisions WHERE id=$1 AND service_id=$2)")
            .bind(revision)
            .bind(service_id)
            .fetch_one(&mut **tx)
            .await?;
    if !exists {
        return Err(ApiError::NotFound);
    }
    crate::volumes::validate_scope(tx, &spec).await?;
    spec.secrets = crate::secrets::references(pool, service_id).await?;
    crate::discovery::validate(tx, &spec).await?;
    let secret_version = crate::secrets::snapshot(pool, service_id, &spec.secrets).await?;
    let ports:Vec<i32>=sqlx::query_scalar("SELECT n.endpoint_base+v.slot FROM database_connections c JOIN volumes v ON v.id=c.database_id JOIN nodes n ON n.id=v.node_id WHERE c.service_id=$1 UNION SELECT n.endpoint_base+v.slot FROM storage_bindings c JOIN storage_buckets b ON b.id=c.bucket_id JOIN volumes v ON v.id=b.service_id JOIN nodes n ON n.id=v.node_id WHERE c.service_id=$1 AND c.status='ready'").bind(service_id).fetch_all(&mut **tx).await?;
    let size: Option<i32> = if let Some(v) = &spec.volume {
        sqlx::query_scalar("SELECT size_gib FROM shared_volumes WHERE id=$1")
            .bind(v.id)
            .fetch_optional(&mut **tx)
            .await?
    } else {
        None
    };
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO deployments(id,operation_id,service_id,revision_id,spec,status,job_options,secret_version,secret_snapshot,database_ports,volume_size_gib,error_code) VALUES($1,$2,$3,$4,$5,'job',$6,$7,true,$8,$9,'waiting_for_capacity')").bind(id).bind(operation).bind(service_id).bind(revision).bind(DbJson(spec)).bind(DbJson(options)).bind(secret_version).bind(ports).bind(size).execute(&mut **tx).await?;
    sqlx::query(
        "INSERT INTO events(id,service_id,operation_id,kind) VALUES($1,$2,$3,'job.requested')",
    )
    .bind(Uuid::now_v7())
    .bind(service_id)
    .bind(operation)
    .execute(&mut **tx)
    .await?;
    Ok(id)
}

pub async fn list(
    State(pool): State<PgPool>,
    Path(service): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    crate::runtime::service_exists(&pool, service).await?;
    let runs: Vec<DbJson<Value>> = sqlx::query_scalar("SELECT jsonb_build_object('id',d.id,'revision_id',d.revision_id,'options',d.job_options,'status',CASE WHEN d.status<>'job' THEN d.status WHEN i.id IS NULL THEN 'queued' WHEN n.last_seen<now()-interval '30 seconds' OR i.observed_at<now()-interval '15 seconds' OR i.state='unknown' THEN 'unknown' WHEN i.state='assigned' THEN 'assigned' ELSE 'running' END,'result',d.job_result,'error_code',d.error_code,'created_at',d.created_at,'completed_at',d.completed_at,'instance_id',i.id,'node',n.name,'cleanup_pending',coalesce(i.desired_state='stopped' AND i.state<>'stopped',false)) FROM deployments d LEFT JOIN instances i ON i.deployment_id=d.id LEFT JOIN nodes n ON n.id=i.node_id WHERE d.service_id=$1 AND d.job_options IS NOT NULL ORDER BY d.created_at DESC LIMIT 50").bind(service).fetch_all(&pool).await?;
    let schedule: Option<DbJson<Value>> =
        sqlx::query_scalar("SELECT to_jsonb(s) FROM job_schedules s WHERE service_id=$1")
            .bind(service)
            .fetch_optional(&pool)
            .await?;
    let occurrences: Vec<DbJson<Value>> = sqlx::query_scalar("SELECT to_jsonb(o) FROM job_occurrences o WHERE service_id=$1 ORDER BY scheduled_at DESC LIMIT 20").bind(service).fetch_all(&pool).await?;
    Ok(Json(
        json!({"runs":runs,"schedule":schedule,"occurrences":occurrences}),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScheduleRequest {
    pub operation_id: Uuid,
    pub version: i64,
    pub revision_id: Uuid,
    pub options: Options,
    pub interval_minutes: i32,
    pub enabled: bool,
}
pub async fn schedule(
    State(pool): State<PgPool>,
    Path(service): Path<Uuid>,
    Json(input): Json<ScheduleRequest>,
) -> Result<Json<Value>, ApiError> {
    input.options.validate()?;
    if !(1..=10080).contains(&input.interval_minutes) {
        return Err(ApiError::Conflict(
            "choose an interval between one minute and one week",
        ));
    }
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(712184551)")
        .execute(&mut *tx)
        .await?;
    let valid: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM services s JOIN revisions r ON r.service_id=s.id WHERE s.id=$1 AND r.id=$2 AND s.spec->'workload'->>'kind'='oci-service')").bind(service).bind(input.revision_id).fetch_one(&mut *tx).await?;
    if !valid {
        return Err(ApiError::NotFound);
    }
    let current = sqlx::query("SELECT version,operation_id,revision_id,options,interval_minutes,status FROM job_schedules WHERE service_id=$1 FOR UPDATE").bind(service).fetch_optional(&mut *tx).await?;
    let status = if input.enabled { "enabled" } else { "paused" };
    if let Some(row) = &current
        && row.get::<Uuid, _>("operation_id") == input.operation_id
    {
        if row.get::<Uuid, _>("revision_id") != input.revision_id
            || row.get::<DbJson<Options>, _>("options").0 != input.options
            || row.get::<i32, _>("interval_minutes") != input.interval_minutes
            || row.get::<String, _>("status") != status
        {
            return Err(ApiError::Conflict(
                "operation ID belongs to a different schedule update",
            ));
        }
        return Ok(Json(
            json!({"id":service,"version":row.get::<i64,_>("version")}),
        ));
    }
    if current
        .as_ref()
        .map(|r| r.get::<i64, _>("version"))
        .unwrap_or(0)
        != input.version
    {
        return Err(ApiError::Conflict(
            "schedule changed; refresh before saving",
        ));
    }
    sqlx::query("INSERT INTO job_schedules(id,service_id,operation_id,revision_id,options,interval_minutes,status,next_run_at) VALUES($1,$1,$2,$3,$4,$5,$6,clock_timestamp()+make_interval(mins=>$5)) ON CONFLICT(id) DO UPDATE SET operation_id=excluded.operation_id,version=job_schedules.version+1,revision_id=excluded.revision_id,options=excluded.options,interval_minutes=excluded.interval_minutes,status=excluded.status,next_run_at=excluded.next_run_at,updated_at=clock_timestamp()").bind(service).bind(input.operation_id).bind(input.revision_id).bind(DbJson(input.options)).bind(input.interval_minutes).bind(status).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"id":service,"version":input.version+1})))
}

/// Called outside runtime reconciliation: OpenBao snapshot failures cannot prevent
/// healthy applications or already-running jobs from being reconciled.
pub async fn tick(pool: &PgPool) -> Result<(), ApiError> {
    let due: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM job_schedules WHERE status='enabled' AND next_run_at<=clock_timestamp() ORDER BY next_run_at LIMIT 32").fetch_all(pool).await?;
    for id in due {
        let mut tx = pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(712184551)")
            .execute(&mut *tx)
            .await?;
        let Some(row) = sqlx::query("SELECT *,clock_timestamp() AS clock FROM job_schedules WHERE id=$1 AND status='enabled' AND next_run_at<=clock_timestamp() FOR UPDATE").bind(id).fetch_optional(&mut *tx).await? else { continue; };
        let scheduled: DateTime<Utc> = row.get("next_run_at");
        let now: DateTime<Utc> = row.get("clock");
        let interval = i64::from(row.get::<i32, _>("interval_minutes")) * 60;
        let elapsed = (now - scheduled).num_seconds();
        let skipped = elapsed / interval;
        let next = scheduled + chrono::Duration::seconds((skipped + 1) * interval);
        let occurrence = Uuid::now_v7();
        let (status, run) = if elapsed > 30 {
            ("skipped_missed", None)
        } else if occupied(&mut tx, id).await? {
            ("skipped_overlap", None)
        } else {
            // A savepoint makes failure visible without retrying a missed slot.
            sqlx::query("SAVEPOINT job_enqueue")
                .execute(&mut *tx)
                .await?;
            let options = row.get::<DbJson<Options>, _>("options").0;
            match enqueue(
                pool,
                &mut tx,
                id,
                row.get("revision_id"),
                occurrence,
                &options,
            )
            .await
            {
                Ok(run) => ("queued", Some(run)),
                Err(_) => {
                    sqlx::query("ROLLBACK TO SAVEPOINT job_enqueue")
                        .execute(&mut *tx)
                        .await?;
                    ("failed_to_queue", None)
                }
            }
        };
        sqlx::query("INSERT INTO job_occurrences(id,service_id,schedule_id,scheduled_at,status,deployment_id,skipped_count) VALUES($1,$2,$2,$3,$4,$5,$6)").bind(occurrence).bind(id).bind(scheduled).bind(status).bind(run).bind(if status=="skipped_missed" { skipped+1 } else { 0 }).execute(&mut *tx).await?;
        sqlx::query("UPDATE job_schedules SET next_run_at=$2 WHERE id=$1")
            .bind(id)
            .bind(next)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
    }
    Ok(())
}

pub async fn reconcile(tx: &mut Transaction<'_, Postgres>) -> Result<(), sqlx::Error> {
    let pending = sqlx::query("SELECT id,service_id,spec,database_ports,job_options FROM deployments WHERE status='job' FOR UPDATE").fetch_all(&mut **tx).await?;
    for row in pending {
        let id: Uuid = row.get("id");
        let service: Uuid = row.get("service_id");
        if let Some(instance) = sqlx::query("SELECT state FROM instances WHERE deployment_id=$1")
            .bind(id)
            .fetch_optional(&mut **tx)
            .await?
        {
            if instance.get::<String, _>("state") == "failed" {
                sqlx::query("UPDATE deployments SET status='failed',completed_at=now(),error_code='job_setup_failed' WHERE id=$1").bind(id).execute(&mut **tx).await?;
                sqlx::query("UPDATE instances SET desired_state='stopped',generation=generation+1 WHERE deployment_id=$1 AND desired_state<>'stopped'").bind(id).execute(&mut **tx).await?;
            }
            continue;
        }
        let spec = row.get::<DbJson<platform_domain::ServiceSpec>, _>("spec").0;
        let shared: Option<(Option<Uuid>, i32)> = if let Some(v) = &spec.volume {
            sqlx::query_as("SELECT node_id,size_gib FROM shared_volumes WHERE id=$1 FOR UPDATE")
                .bind(v.id)
                .fetch_optional(&mut **tx)
                .await?
        } else {
            None
        };
        let placements = crate::runtime::place(
            tx,
            service,
            &spec,
            &row.get::<Vec<i32>, _>("database_ports"),
            None,
            shared,
            true,
        )
        .await?;
        let Some((node, slot)) = placements.first() else {
            continue;
        };
        if let Some(v) = &spec.volume {
            sqlx::query("UPDATE shared_volumes SET node_id=$2 WHERE id=$1 AND node_id IS NULL")
                .bind(v.id)
                .bind(node)
                .execute(&mut **tx)
                .await?;
        }
        sqlx::query("INSERT INTO instances(id,deployment_id,node_id,slot,desired_state) VALUES($1,$2,$3,$4,'running')").bind(Uuid::now_v7()).bind(id).bind(node).bind(slot).execute(&mut **tx).await?;
        let options = row.get::<DbJson<Options>, _>("job_options").0;
        sqlx::query("UPDATE deployments SET error_code=NULL,deadline=clock_timestamp()+make_interval(secs=>$2) WHERE id=$1").bind(id).bind(f64::from(options.timeout_seconds)).execute(&mut **tx).await?;
    }
    Ok(())
}
