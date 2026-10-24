//! Opt-in fault drill for the socket-free, slow-shutdown worker fixture.
use serde_json::{Value, json};
use sqlx::PgPool;
use std::time::Duration;
use uuid::Uuid;

async fn post(client: &reqwest::Client, path: &str, body: Value) -> Result<Value, String> {
    let response = client
        .post(format!("http://127.0.0.1:8080/api{path}"))
        .header("content-type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("API returned {}", response.status()));
    }
    serde_json::from_slice(&response.bytes().await.map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}
async fn active(pool: &PgPool, deployment: Uuid) -> Result<(Uuid, i32), String> {
    for _ in 0..180 {
        let row:Option<(Uuid,i32)>=sqlx::query_as("SELECT i.id,n.endpoint_base+i.slot FROM instances i JOIN nodes n ON n.id=i.node_id JOIN deployments d ON d.id=i.deployment_id WHERE d.id=$1 AND d.status='active' AND i.state='ready' AND i.observed_at>now()-interval '15 seconds'")
            .bind(deployment).fetch_optional(pool).await.map_err(|e|e.to_string())?;
        if let Some(row) = row {
            return Ok(row);
        }
        let status: String = sqlx::query_scalar("SELECT status FROM deployments WHERE id=$1")
            .bind(deployment)
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;
        if matches!(status.as_str(), "failed" | "stopped") {
            return Err(format!("worker deployment {status}"));
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    Err("worker activation timed out".into())
}
#[tokio::test]
#[ignore = "requires PLATFORM_WORKER_CANARY built from examples/worker-canary on the private development platform"]
async fn replacement_waits_for_real_worker_shutdown_and_exposes_no_http_port() {
    let Ok(id) = std::env::var("PLATFORM_WORKER_CANARY") else {
        return;
    };
    let service: Uuid = id.parse().unwrap();
    let pool = PgPool::connect(&std::env::var("DATABASE_URL").unwrap())
        .await
        .unwrap();
    let spec: Value = sqlx::query_scalar("SELECT spec FROM services WHERE id=$1")
        .bind(service)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(spec["project"], "platform-storage-canary");
    assert!(spec["name"].as_str().unwrap().starts_with("worker-canary-"));
    assert_eq!(spec["workload"]["execution"], "worker");
    assert_eq!(spec["domains"], json!([]));
    assert_eq!(spec["secrets"], json!([]));
    assert!(spec.get("volume").is_none());
    let revision: Uuid = sqlx::query_scalar(
        "SELECT id FROM revisions WHERE service_id=$1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(service)
    .fetch_one(&pool)
    .await
    .unwrap();
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let mut deployments = Vec::<Uuid>::new();
    let result:Result<(),String>=async {
        let first=post(&client,&format!("/services/{service}/deployments"),json!({"operation_id":Uuid::new_v4(),"revision_id":revision})).await?;
        let first:Uuid=first["id"].as_str().ok_or("missing deployment ID")?.parse().map_err(|_|"invalid deployment ID")?;
        deployments.push(first);
        let (old,port)=active(&pool,first).await?;
        if client.get(format!("http://127.0.0.1:{port}/")).send().await.is_ok() { return Err("worker exposed an HTTP listener".into()); }
        let second=post(&client,&format!("/services/{service}/deployments"),json!({"operation_id":Uuid::new_v4(),"revision_id":revision})).await?;
        let second:Uuid=second["id"].as_str().ok_or("missing deployment ID")?.parse().map_err(|_|"invalid deployment ID")?;
        deployments.push(second);
        let mut waiting=false;
        for _ in 0..90 {
            let (old_state,count):(String,i64)=sqlx::query_as("SELECT state,(SELECT count(*) FROM instances WHERE deployment_id=$2) FROM instances WHERE id=$1")
                .bind(old).bind(second).fetch_one(&pool).await.map_err(|e|e.to_string())?;
            if old_state=="stopped" { break; }
            waiting=true;
            if count!=0 { return Err("replacement allocated before old worker confirmed stopped".into()); }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        if !waiting { return Err("slow shutdown was not observed".into()); }
        let (new,port)=active(&pool,second).await?;
        let ordered:bool=sqlx::query_scalar("SELECT (SELECT min(started_at) FROM instance_starts WHERE instance_id=$2)>=(SELECT observed_at FROM instances WHERE id=$1)")
            .bind(old).bind(new).fetch_one(&pool).await.map_err(|e|e.to_string())?;
        if !ordered { return Err("replacement process started before shutdown acknowledgment".into()); }
        if client.get(format!("http://127.0.0.1:{port}/")).send().await.is_ok() { return Err("replacement exposed an HTTP listener".into()); }
        let logged:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM runtime_logs WHERE instance_id=$1 AND line LIKE '%worker.tick%')")
            .bind(new).fetch_one(&pool).await.map_err(|e|e.to_string())?;
        if !logged { return Err("worker runtime logs were not retained".into()); }
        Ok(())
    }.await;
    let mut cleanup = Ok(());
    for deployment in deployments {
        if let Err(error) = post(
            &client,
            &format!("/deployments/{deployment}/stop"),
            json!({}),
        )
        .await
        {
            cleanup = Err(error);
            continue;
        }
        for attempt in 0..90 {
            let stopped:bool=sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM instances WHERE deployment_id=$1 AND state<>'stopped')").bind(deployment).fetch_one(&pool).await.unwrap();
            if stopped {
                break;
            }
            if attempt == 89 {
                cleanup = Err("worker cleanup timed out".into());
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }
    cleanup.unwrap();
    result.unwrap();
}
