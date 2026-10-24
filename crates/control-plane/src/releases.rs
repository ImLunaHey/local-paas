//! Pre-deploy jobs are children of a persisted rollout, with the same snapshot.
use platform_domain::{Execution, PreDeploy, ServiceSpec, Workload};
use sqlx::{Postgres, Row, Transaction, types::Json};
use uuid::Uuid;

pub async fn enqueue(
    tx: &mut Transaction<'_, Postgres>,
    parent: Uuid,
    spec: &ServiceSpec,
    options: &PreDeploy,
) -> Result<(), sqlx::Error> {
    let mut job_spec = spec.clone();
    if let Workload::OciService {
        execution,
        replicas,
        port,
        readiness,
        pre_deploy,
        ..
    } = &mut job_spec.workload
    {
        *execution = Execution::Worker;
        *replicas = 1;
        *port = None;
        *readiness = None;
        *pre_deploy = None;
    }
    job_spec.domains.clear();
    job_spec.distinct_nodes = false;
    let child = Uuid::new_v4();
    sqlx::query("INSERT INTO deployments(id,operation_id,service_id,revision_id,spec,status,job_options,secret_version,secret_snapshot,database_ports,volume_size_gib,error_code,parent_deployment_id) SELECT $1,$1,service_id,revision_id,$2,'job',$3,secret_version,secret_snapshot,database_ports,volume_size_gib,'waiting_for_capacity',id FROM deployments WHERE id=$4")
        .bind(child).bind(Json(job_spec)).bind(Json(options)).bind(parent).execute(&mut **tx).await?;
    sqlx::query("INSERT INTO events(id,service_id,operation_id,kind) SELECT $1,service_id,id,'deployment.pre_deploy_requested' FROM deployments WHERE id=$2").bind(Uuid::new_v4()).bind(parent).execute(&mut **tx).await?;
    Ok(())
}

pub async fn cancel(tx: &mut Transaction<'_, Postgres>, parent: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE deployments SET status='cancelled',completed_at=now() WHERE parent_deployment_id=$1 AND status='job'").bind(parent).execute(&mut **tx).await?;
    sqlx::query("UPDATE instances SET desired_state='stopped',generation=generation+1 WHERE deployment_id IN (SELECT id FROM deployments WHERE parent_deployment_id=$1) AND desired_state<>'stopped'").bind(parent).execute(&mut **tx).await?;
    Ok(())
}

pub async fn reconcile(tx: &mut Transaction<'_, Postgres>) -> Result<(), sqlx::Error> {
    let parents = sqlx::query("SELECT d.id,d.service_id,d.spec,d.database_ports,j.id AS job_id,j.status AS job_status FROM deployments d JOIN deployments j ON j.parent_deployment_id=d.id WHERE d.status='releasing' ORDER BY d.created_at FOR UPDATE OF d").fetch_all(&mut **tx).await?;
    for row in parents {
        let id: Uuid = row.get("id");
        let service: Uuid = row.get("service_id");
        let status: String = row.get("job_status");
        if status == "job" {
            continue;
        }
        if status != "succeeded" {
            sqlx::query("UPDATE deployments SET status='failed',error_code='pre_deploy_failed',completed_at=now() WHERE id=$1").bind(id).execute(&mut **tx).await?;
            event(tx, id, "deployment.pre_deploy_failed").await?;
            continue;
        }
        let occupied: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM instances WHERE deployment_id=$1 AND state<>'stopped')",
        )
        .bind(row.get::<Uuid, _>("job_id"))
        .fetch_one(&mut **tx)
        .await?;
        if occupied {
            continue;
        }
        let spec: ServiceSpec = row.get::<Json<ServiceSpec>, _>("spec").0;
        if spec.workload.is_worker() {
            // Preserve the previous worker until migration succeeded. From here,
            // the existing shutdown barrier owns the singleton transition.
            sqlx::query("UPDATE deployments SET status='waiting',error_code='waiting_for_shutdown' WHERE id=$1").bind(id).execute(&mut **tx).await?;
            sqlx::query("UPDATE deployments SET status='superseded' WHERE service_id=$1 AND status='active'").bind(service).execute(&mut **tx).await?;
            sqlx::query("UPDATE instances SET desired_state='stopped',generation=generation+1 WHERE deployment_id IN (SELECT id FROM deployments WHERE service_id=$1 AND job_options IS NULL AND id<>$2) AND desired_state<>'stopped'").bind(service).bind(id).execute(&mut **tx).await?;
            event(tx, id, "deployment.pre_deploy_succeeded").await?;
            continue;
        }
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
            false,
        )
        .await?;
        let replicas = match spec.workload {
            Workload::OciService { replicas, .. } => replicas,
            _ => continue,
        };
        if placements.len() != usize::from(replicas) {
            sqlx::query("UPDATE deployments SET error_code='waiting_for_capacity' WHERE id=$1 AND error_code IS DISTINCT FROM 'waiting_for_capacity'").bind(id).execute(&mut **tx).await?;
            continue;
        }
        if let Some(v) = &spec.volume {
            sqlx::query("UPDATE shared_volumes SET node_id=$2 WHERE id=$1 AND node_id IS NULL")
                .bind(v.id)
                .bind(placements[0].0)
                .execute(&mut **tx)
                .await?;
        }
        for (node, slot) in placements {
            sqlx::query("INSERT INTO instances(id,deployment_id,node_id,slot,desired_state) VALUES($1,$2,$3,$4,'running')").bind(Uuid::new_v4()).bind(id).bind(node).bind(slot).execute(&mut **tx).await?;
        }
        sqlx::query("UPDATE deployments SET status='preparing',error_code=NULL,deadline=now()+interval '180 seconds' WHERE id=$1").bind(id).execute(&mut **tx).await?;
        event(tx, id, "deployment.pre_deploy_succeeded").await?;
    }
    Ok(())
}
async fn event(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    kind: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO events(id,service_id,operation_id,kind) SELECT $1,service_id,id,$3 FROM deployments WHERE id=$2 ON CONFLICT(operation_id,kind) DO NOTHING").bind(Uuid::new_v4()).bind(id).bind(kind).execute(&mut **tx).await?;
    Ok(())
}
