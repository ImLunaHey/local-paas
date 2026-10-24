//! Explicit live fault injection against examples/recovery-canary only.
use serde_json::{Value, json};
use sqlx::PgPool;
use std::time::{Duration, Instant};
use uuid::Uuid;

struct Canary {
    pool: PgPool,
    client: reqwest::Client,
    service: Uuid,
}
impl Canary {
    async fn post(&self, path: &str, body: Value) -> Result<Value, String> {
        let response = self
            .client
            .post(format!("http://127.0.0.1:8080/api{path}"))
            .header("content-type", "application/json")
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("canary API returned {}", response.status()));
        }
        serde_json::from_slice(&response.bytes().await.map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())
    }
    async fn state(&self, instance: Uuid) -> Result<(String, Option<String>, i64), String> {
        sqlx::query_as("SELECT state,diagnostic,(SELECT count(*) FROM instance_starts WHERE instance_id=i.id) FROM instances i WHERE id=$1")
            .bind(instance).fetch_one(&self.pool).await.map_err(|e| e.to_string())
    }
    async fn wait(
        &self,
        instance: Uuid,
        expected: &str,
        diagnostic: Option<&str>,
        seconds: u64,
    ) -> Result<i64, String> {
        let deadline = Instant::now() + Duration::from_secs(seconds);
        loop {
            let (state, code, starts) = self.state(instance).await?;
            if state == expected && diagnostic.is_none_or(|d| code.as_deref() == Some(d)) {
                return Ok(starts);
            }
            if expected == "ready" && matches!(state.as_str(), "failed" | "stopped") {
                return Err(format!("canary cannot become ready: {state}/{code:?}"));
            }
            if Instant::now() >= deadline {
                return Err(format!(
                    "expected {expected}/{diagnostic:?}, observed {state}/{code:?}"
                ));
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }
    async fn get(&self, port: i32, path: &str) -> Result<reqwest::StatusCode, String> {
        self.client
            .get(format!("http://127.0.0.1:{port}{path}"))
            .send()
            .await
            .map(|r| r.status())
            .map_err(|e| e.to_string())
    }
    async fn deploy(&self) -> Result<(Uuid, Uuid, i32), String> {
        let revision: Uuid = sqlx::query_scalar(
            "SELECT id FROM revisions WHERE service_id=$1 ORDER BY created_at DESC LIMIT 1",
        )
        .bind(self.service)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        let created = self
            .post(
                &format!("/services/{}/deployments", self.service),
                json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
            )
            .await?;
        let deployment: Uuid = created["id"]
            .as_str()
            .ok_or("missing deployment ID")?
            .parse()
            .map_err(|_| "invalid deployment ID")?;
        let (instance, port): (Uuid, i32) = sqlx::query_as("SELECT i.id,n.endpoint_base+i.slot FROM instances i JOIN nodes n ON n.id=i.node_id WHERE deployment_id=$1")
            .bind(deployment).fetch_one(&self.pool).await.map_err(|e| e.to_string())?;
        Ok((deployment, instance, port))
    }
    async fn stop(&self, deployment: Uuid, instance: Uuid) -> Result<(), String> {
        self.post(&format!("/deployments/{deployment}/stop"), json!({}))
            .await?;
        self.wait(instance, "stopped", None, 90).await?;
        Ok(())
    }
    async fn active(&self, deployment: Uuid, instance: Uuid) -> Result<(), String> {
        self.wait(instance, "ready", None, 150).await?;
        for _ in 0..30 {
            let status: String = sqlx::query_scalar("SELECT status FROM deployments WHERE id=$1")
                .bind(deployment)
                .fetch_one(&self.pool)
                .await
                .map_err(|e| e.to_string())?;
            if status == "active" {
                // Allow the promotion assignment to reach the agent.
                tokio::time::sleep(Duration::from_secs(10)).await;
                return Ok(());
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        Err("canary promotion timed out".into())
    }
}

#[tokio::test]
#[ignore = "requires PLATFORM_RECOVERY_CANARY and the private live development platform"]
async fn active_service_recovers_and_stops_without_unbounded_restarts() {
    let Ok(id) = std::env::var("PLATFORM_RECOVERY_CANARY") else {
        return;
    };
    let service: Uuid = id.parse().expect("invalid canary ID");
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
    assert_eq!(spec["workload"]["kind"], "oci-service");
    assert_eq!(spec["workload"]["replicas"], 1);
    assert_eq!(spec["workload"]["port"], 3000);
    assert_eq!(spec["domains"], json!([]));
    assert_eq!(spec["secrets"], json!([]));
    assert!(spec.get("volume").is_none());
    let canary = Canary {
        pool,
        service,
        client: reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap(),
    };
    let (deployment, instance, port) = canary.deploy().await.unwrap();
    let result: Result<(), String> = async {
        canary.active(deployment, instance).await?;
        let starts = canary.state(instance).await?.2;
        if !canary.get(port, "/unhealthy").await?.is_success() {
            return Err("could not disable readiness".into());
        }
        canary
            .wait(instance, "starting", Some("readiness_pending"), 30)
            .await?;
        // Exceed the candidate's 120-second startup deadline. Active readiness
        // must be able to recover without a restart or a permanently failed latch.
        tokio::time::sleep(Duration::from_secs(130)).await;
        let observed = canary.state(instance).await?;
        if observed.0 != "starting" || observed.2 != starts {
            return Err("readiness failure restarted or latched the active process".into());
        }
        if canary.get(port, "/health").await? != reqwest::StatusCode::SERVICE_UNAVAILABLE {
            return Err("canary should be unhealthy".into());
        }
        canary.get(port, "/healthy").await?;
        if canary.wait(instance, "ready", None, 30).await? != starts {
            return Err("readiness recovery changed process identity".into());
        }
        for retry in 1..=5 {
            let _ = canary.get(port, "/crash").await;
            canary.wait(instance, "starting", None, 30).await?;
            if canary.wait(instance, "ready", None, 110).await? != starts + retry {
                return Err("missing or duplicate restart marker".into());
            }
            eprintln!("canary recovered after exit {retry}");
        }
        let _ = canary.get(port, "/crash").await;
        if canary
            .wait(instance, "failed", Some("crash_loop"), 30)
            .await?
            != starts + 5
        {
            return Err("restart budget exceeded".into());
        }
        tokio::time::sleep(Duration::from_secs(15)).await;
        if canary.state(instance).await?.2 != starts + 5 {
            return Err("crash loop continued restarting".into());
        }
        Ok(())
    }
    .await;
    let cleanup = canary.stop(deployment, instance).await;
    result.unwrap();
    cleanup.unwrap();

    let (deployment, instance, port) = canary.deploy().await.unwrap();
    let result: Result<(), String> = async {
        canary.active(deployment, instance).await?;
        let _ = canary.get(port, "/crash").await;
        canary
            .wait(instance, "starting", Some("restart_backoff"), 30)
            .await?;
        canary.stop(deployment, instance).await?;
        let starts = canary.state(instance).await?.2;
        tokio::time::sleep(Duration::from_secs(20)).await;
        let observed = canary.state(instance).await?;
        if observed.0 != "stopped" || observed.2 != starts {
            return Err("stopped deployment restarted".into());
        }
        Ok(())
    }
    .await;
    let cleanup = canary.stop(deployment, instance).await;
    result.unwrap();
    cleanup.unwrap();
}
