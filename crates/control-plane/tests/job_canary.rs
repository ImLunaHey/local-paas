//! Opt-in disposable job drill. Never points at an ordinary application.
use serde_json::{Value, json};
use sqlx::PgPool;
use std::time::Duration;
use uuid::Uuid;

async fn request(
    client: &reqwest::Client,
    method: reqwest::Method,
    path: &str,
    body: Value,
) -> Result<Value, String> {
    let response = client
        .request(method, format!("http://127.0.0.1:8080/api{path}"))
        .header("content-type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("{path}: {}", response.status()));
    }
    serde_json::from_slice(&response.bytes().await.map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}
async fn wait_finished(pool: &PgPool, run: Uuid) -> Result<(String, Option<i32>, Uuid), String> {
    for _ in 0..180 {
        let row:Option<(String,Option<i32>,Uuid,String)>=sqlx::query_as("SELECT d.status,(d.job_result->>'exitCode')::integer,i.id,i.state FROM deployments d JOIN instances i ON i.deployment_id=d.id WHERE d.id=$1").bind(run).fetch_optional(pool).await.map_err(|e|e.to_string())?;
        if let Some((status, exit, id, state)) = row
            && status != "job"
            && state == "stopped"
        {
            return Ok((status, exit, id));
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    Err("job completion/cleanup timed out".into())
}
async fn wait_started(pool: &PgPool, run: Uuid) -> Result<String, String> {
    for _ in 0..120 {
        let row:Option<String>=sqlx::query_scalar("SELECT n.name FROM instances i JOIN nodes n ON n.id=i.node_id WHERE i.deployment_id=$1 AND EXISTS(SELECT 1 FROM instance_starts s WHERE s.instance_id=i.id)").bind(run).fetch_optional(pool).await.map_err(|e|e.to_string())?;
        if let Some(node) = row {
            return Ok(node);
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    Err("job start timed out".into())
}

#[tokio::test]
#[ignore = "requires PLATFORM_JOB_CANARY built from examples/job-canary on the private development platform"]
async fn real_jobs_record_results_cancel_timeout_and_schedule_without_restarting() {
    let Ok(id) = std::env::var("PLATFORM_JOB_CANARY") else {
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
    assert!(spec["name"].as_str().unwrap().starts_with("job-canary-"));
    assert_eq!(spec["secrets"], json!([]));
    assert_eq!(spec["domains"], json!([]));
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
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap();
    let vm_only = std::env::var("PLATFORM_JOB_VM_ONLY").as_deref() == Ok("1");
    let baseline: Vec<Uuid> = sqlx::query_scalar("SELECT i.id FROM instances i JOIN deployments d ON d.id=i.deployment_id WHERE i.desired_state='running' AND d.status='active'").fetch_all(&pool).await.unwrap();
    let mut runs = Vec::new();
    let result:Result<(),String>=async {
        for (label,command,limit,expected,exit,mode) in [
            ("default",vec![],60,"succeeded",Some(0),Some("default")),
            ("override",vec!["/canary"],60,"succeeded",Some(0),Some("success")),
            ("failure",vec!["/canary","fail"],60,"failed",Some(7),Some("fail")),
            ("timeout",vec!["/canary","sleep","30"],10,"timed_out",None,Some("sleep")),
            ("cancel",vec!["/canary","sleep","60"],120,"cancelled",None,Some("sleep")),
            ("controller-restart",vec!["/canary","sleep","20"],90,"succeeded",Some(0),Some("sleep")),
        ] {
            if vm_only { break; }
            let body=json!({"operationId":Uuid::new_v4(),"revisionId":revision,"options":{"command":command,"timeoutSeconds":limit}});
            let response=request(&client,reqwest::Method::POST,&format!("/services/{service}/jobs"),body.clone()).await?;
            let run:Uuid=response["id"].as_str().ok_or("missing run ID")?.parse().map_err(|_|"invalid run ID")?;
            runs.push(run);
            let duplicate=request(&client,reqwest::Method::POST,&format!("/services/{service}/jobs"),body).await?;
            if duplicate!=response {return Err("retry produced a different run".into());}
            if label=="cancel" || label=="controller-restart" {
                wait_started(&pool,run).await?;
                if label=="cancel" {request(&client,reqwest::Method::POST,&format!("/deployments/{run}/stop"),json!({})).await?;}
                else {
                    let status=tokio::process::Command::new("systemctl").args(["--user","restart","local-paas-api"]).env("XDG_RUNTIME_DIR","/run/user/1000").output().await.map_err(|_|"could not restart API")?;
                    if !status.status.success() {return Err("API restart failed".into());}
                }
            }
            let (status,code,instance)=wait_finished(&pool,run).await?;
            if status!=expected || code!=exit {return Err(format!("{label}: expected {expected}/{exit:?}, got {status}/{code:?}"));}
            let starts:i64=sqlx::query_scalar("SELECT count(*) FROM instance_starts WHERE instance_id=$1").bind(instance).fetch_one(&pool).await.map_err(|e|e.to_string())?;
            if starts!=1 {return Err(format!("{label}: expected one process start, got {starts}"));}
            if let Some(mode)=mode {
                let found:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM runtime_logs WHERE instance_id=$1 AND fields->>'event'='job.start' AND fields->>'mode'=$2)").bind(instance).bind(mode).fetch_one(&pool).await.map_err(|e|e.to_string())?;
                if !found {return Err(format!("{label}: missing structured job.start log for {mode}"));}
            }
            println!("{label}: {status}, exit {code:?}, one start, logs retained, cleanup confirmed");
        }
        if vm_only || std::env::var("PLATFORM_JOB_VM_RESTART").as_deref()==Ok("1") {
            let response=request(&client,reqwest::Method::POST,&format!("/services/{service}/jobs"),json!({"operationId":Uuid::new_v4(),"revisionId":revision,"options":{"command":["/canary","sleep","120"],"timeoutSeconds":180}})).await?;
            let run:Uuid=response["id"].as_str().ok_or("missing run")?.parse().map_err(|_|"bad ID")?;runs.push(run);
            let node=wait_started(&pool,run).await?;
            let index=match node.as_str(){"worker-1"=>"1","worker-2"=>"2","worker-3"=>"3",_=>return Err("unexpected test node".into())};
            let stopped=tokio::process::Command::new("sudo").args(["-n","systemctl","stop",&format!("local-paas-worker-{index}")]).output().await.map_err(|_|"VM stop failed")?;
            if !stopped.status.success(){return Err("VM stop failed".into());}
            let start=tokio::process::Command::new("bash").args(["infra/workers/start.sh",index]).current_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")).output().await.map_err(|_|"VM restart failed")?;
            if !start.status.success(){return Err("VM restart failed".into());}
            let (status,_,instance)=wait_finished(&pool,run).await?;
            if !["failed","uncertain"].contains(&status.as_str()){return Err(format!("VM loss must not restart a job: {status}"));}
            let starts:i64=sqlx::query_scalar("SELECT count(*) FROM instance_starts WHERE instance_id=$1").bind(instance).fetch_one(&pool).await.map_err(|e|e.to_string())?;
            if starts!=1{return Err("job restarted after VM loss".into());}
            let mut healthy = false;
            for _ in 0..180 {
                healthy=sqlx::query_scalar("SELECT count(*)=$2 FROM instances i JOIN nodes n ON n.id=i.node_id WHERE i.id=ANY($1) AND i.state='ready' AND i.observed_at>now()-interval '15 seconds' AND n.last_seen>now()-interval '30 seconds'").bind(&baseline).bind(baseline.len() as i64).fetch_one(&pool).await.map_err(|e|e.to_string())?;
                if healthy { break; }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            if !healthy { return Err("existing applications did not recover after VM restart".into()); }
            println!("VM restart: {status}, original start retained, no second execution; all {} existing app instances recovered", baseline.len());
        }
        if vm_only { return Ok(()); }
        let current:Option<i64>=sqlx::query_scalar("SELECT version FROM job_schedules WHERE id=$1").bind(service).fetch_optional(&pool).await.map_err(|e|e.to_string())?;
        request(&client,reqwest::Method::PUT,&format!("/services/{service}/job-schedule"),json!({"operationId":Uuid::new_v4(),"version":current.unwrap_or(0),"revisionId":revision,"options":{"command":["/canary"],"timeoutSeconds":60},"intervalMinutes":1,"enabled":true})).await?;
        let mut scheduled=None;
        for _ in 0..100 {
            scheduled=sqlx::query_scalar("SELECT o.deployment_id FROM job_occurrences o JOIN job_schedules s ON s.id=o.schedule_id WHERE o.service_id=$1 AND o.status='queued' AND o.created_at>=s.updated_at ORDER BY o.created_at DESC LIMIT 1").bind(service).fetch_optional(&pool).await.map_err(|e|e.to_string())?;
            if scheduled.is_some(){break;}
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        let run=scheduled.ok_or("scheduled occurrence did not run")?;runs.push(run);
        let (status,exit,_)=wait_finished(&pool,run).await?;
        if status!="succeeded" || exit!=Some(0){return Err("scheduled job did not succeed".into());}
        println!("interval schedule: real due occurrence succeeded");
        Ok(())
    }.await;
    // Always pause our canary schedule and cancel leftover runs, including failures.
    if let Some(version) =
        sqlx::query_scalar::<_, i64>("SELECT version FROM job_schedules WHERE id=$1")
            .bind(service)
            .fetch_optional(&pool)
            .await
            .unwrap()
    {
        request(&client,reqwest::Method::PUT,&format!("/services/{service}/job-schedule"),json!({"operationId":Uuid::new_v4(),"version":version,"revisionId":revision,"options":{"command":["/canary"],"timeoutSeconds":60},"intervalMinutes":1,"enabled":false})).await.unwrap();
    }
    for run in runs {
        request(
            &client,
            reqwest::Method::POST,
            &format!("/deployments/{run}/stop"),
            json!({}),
        )
        .await
        .unwrap();
    }
    result.unwrap();
}
