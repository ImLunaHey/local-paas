//! Explicit Lake-only destructive fault drill, against the disposable Rust recovery fixture.
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use std::{process::Stdio, time::Duration};
use uuid::Uuid;
type Result<T> = std::result::Result<T, String>;
fn root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}
async fn command(program: &str, args: &[&str]) -> Result<()> {
    let status = tokio::process::Command::new(program)
        .args(args)
        .current_dir(root())
        .env("XDG_RUNTIME_DIR", "/run/user/1000")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|_| "operator command unavailable")?;
    if status.success() {
        Ok(())
    } else {
        Err("operator command failed".into())
    }
}
async fn api(
    client: &reqwest::Client,
    method: reqwest::Method,
    path: &str,
    body: Value,
) -> Result<Value> {
    let response = client
        .request(method, format!("http://127.0.0.1:8080/api{path}"))
        .header("content-type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|_| "canary API unavailable")?;
    if !response.status().is_success() {
        return Err(format!("canary API status {}", response.status()));
    }
    serde_json::from_slice(
        &response
            .bytes()
            .await
            .map_err(|_| "canary response unavailable")?,
    )
    .map_err(|_| "invalid canary API response".into())
}
async fn wait(pool: &PgPool, query: &str, id: Uuid, seconds: u64) -> Result<()> {
    for _ in 0..seconds {
        if sqlx::query_scalar::<_, bool>(query)
            .bind(id)
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?
        {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    Err("canary state transition timed out".into())
}
#[tokio::test]
#[ignore = "PLATFORM_NODE_CANARY: stops worker-3, partitions worker-2 gateway, and stops controller for 60s"]
async fn drain_node_loss_partition_and_controller_outage() {
    let Ok(id) = std::env::var("PLATFORM_NODE_CANARY") else {
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
    assert!(
        spec["name"]
            .as_str()
            .unwrap()
            .starts_with("recovery-canary-")
    );
    assert_eq!(spec["workload"]["replicas"], 1);
    assert!(spec.get("volume").is_none());
    assert_eq!(spec["secrets"], json!([]));
    assert_eq!(spec["domains"], json!([]));
    assert!(
        !sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM nodes WHERE cordoned OR draining)"
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    );
    let node2: Uuid = sqlx::query_scalar("SELECT id FROM nodes WHERE name='worker-2'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let revision: Uuid = sqlx::query_scalar(
        "SELECT id FROM revisions WHERE service_id=$1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(service)
    .fetch_one(&pool)
    .await
    .unwrap();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    api(
        &client,
        reqwest::Method::PUT,
        &format!("/services/{service}/relocation"),
        json!({"operationId":Uuid::new_v4(),"enabled":true}),
    )
    .await
    .unwrap();
    let created = api(
        &client,
        reqwest::Method::POST,
        &format!("/services/{service}/deployments"),
        json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
    )
    .await
    .unwrap();
    let deployment: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    let mut worker_stopped = false;
    let mut partition = false;
    let mut controller_stopped = false;
    let result:Result<()>=async {
        wait(&pool,"SELECT status='active' FROM deployments WHERE id=$1",deployment,180).await?;
        let original=sqlx::query("SELECT i.id,n.name FROM instances i JOIN nodes n ON n.id=i.node_id WHERE deployment_id=$1 AND desired_state='running'").bind(deployment).fetch_one(&pool).await.map_err(|e|e.to_string())?;
        if original.get::<String,_>("name")!="worker-2" {return Err("canary must initially fit on worker-2; stop rather than fault another node".into());}
        let old:Uuid=original.get("id");
        api(&client,reqwest::Method::POST,&format!("/nodes/{node2}/actions"),json!({"operationId":Uuid::new_v4(),"action":"drain"})).await?;
        wait(&pool,"SELECT EXISTS(SELECT 1 FROM relocations WHERE old_instance=$1 AND state='preparing')",old,30).await?;
        command("systemctl",&["--user","stop","local-paas-api"]).await?;controller_stopped=true;
        // This exceeds both original ingress observation freshness thresholds.
        for _ in 0..20 {
            let response=client.get("http://127.0.0.1:8090/").header("host", std::env::var("PLATFORM_CANARY_HOST").unwrap_or_else(|_|"localhost:5201".into())).send().await.map_err(|_|"independent ingress unavailable")?;
            if !response.status().is_success() {return Err(format!("healthy preview failed during controller outage: {}",response.status()));}
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
        command("bash",&["infra/services/api.sh"]).await?;controller_stopped=false;
        wait(&pool,"SELECT EXISTS(SELECT 1 FROM relocations WHERE old_instance=$1 AND state='completed')",old,180).await?;
        wait(&pool,"SELECT state='stopped' FROM instances WHERE id=$1",old,90).await?;
        api(&client,reqwest::Method::POST,&format!("/nodes/{node2}/actions"),json!({"operationId":Uuid::new_v4(),"action":"uncordon"})).await?;
        let second:Uuid=sqlx::query_scalar("SELECT id FROM instances WHERE deployment_id=$1 AND desired_state='running'").bind(deployment).fetch_one(&pool).await.map_err(|e|e.to_string())?;
        command("sudo",&["-n","systemctl","stop","local-paas-worker-3"]).await?;worker_stopped=true;
        wait(&pool,"SELECT EXISTS(SELECT 1 FROM relocations WHERE old_instance=$1 AND reason='node_lost' AND state='completed')",second,240).await?;
        command("bash",&["infra/workers/start.sh","3"]).await?;worker_stopped=false;
        wait(&pool,"SELECT state='stopped' FROM instances WHERE id=$1",second,180).await?;
        let third:Uuid=sqlx::query_scalar("SELECT id FROM instances WHERE deployment_id=$1 AND desired_state='running'").bind(deployment).fetch_one(&pool).await.map_err(|e|e.to_string())?;
        let nft=root().join(".local/worker-tools/bin/nft");let nft=nft.to_str().unwrap();
        command("sudo",&["-n",nft,"add","table","inet","local_paas_partition_drill"]).await?;partition=true;
        command("sudo",&["-n",nft,"add","chain","inet","local_paas_partition_drill","output","{ type filter hook output priority -20; policy accept; }"]).await?;
        command("sudo",&["-n",nft,"add","rule","inet","local_paas_partition_drill","output","meta","skuid","61002","ip","daddr","127.0.0.1","tcp","dport","18443","drop"]).await?;
        wait(&pool,"SELECT EXISTS(SELECT 1 FROM relocations WHERE old_instance=$1 AND reason='node_lost' AND state='completed')",third,240).await?;
        command("sudo",&["-n",nft,"delete","table","inet","local_paas_partition_drill"]).await?;partition=false;
        wait(&pool,"SELECT state='stopped' FROM instances WHERE id=$1",third,90).await?;
        println!("Live drain, controller-outage ingress, stopped-VM recovery, partition recovery and returning-agent cleanup passed.");
        Ok(())
    }.await;
    // Cleanup on every ordinary error; no test assertion skips this section.
    if partition {
        let nft = root().join(".local/worker-tools/bin/nft");
        command(
            "sudo",
            &[
                "-n",
                nft.to_str().unwrap(),
                "delete",
                "table",
                "inet",
                "local_paas_partition_drill",
            ],
        )
        .await
        .unwrap();
    }
    if worker_stopped {
        command("bash", &["infra/workers/start.sh", "3"])
            .await
            .unwrap();
    }
    if controller_stopped {
        command("bash", &["infra/services/api.sh"]).await.unwrap();
    }
    api(
        &client,
        reqwest::Method::POST,
        &format!("/nodes/{node2}/actions"),
        json!({"operationId":Uuid::new_v4(),"action":"uncordon"}),
    )
    .await
    .unwrap();
    api(
        &client,
        reqwest::Method::POST,
        &format!("/deployments/{deployment}/stop"),
        json!({}),
    )
    .await
    .unwrap();
    api(
        &client,
        reqwest::Method::PUT,
        &format!("/services/{service}/relocation"),
        json!({"operationId":Uuid::new_v4(),"enabled":false}),
    )
    .await
    .unwrap();
    wait(
        &pool,
        "SELECT NOT EXISTS(SELECT 1 FROM instances WHERE deployment_id=$1 AND state<>'stopped')",
        deployment,
        180,
    )
    .await
    .unwrap();
    result.unwrap();
}
