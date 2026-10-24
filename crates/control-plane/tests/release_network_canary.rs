//! Explicit live drill against disposable apps only. Upload ZIP is prepared from
//! examples/release-network-canary. All created workloads are stopped on completion.
use reqwest::{Client, Method};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::time::Duration;
use uuid::Uuid;
async fn api(c: &Client, method: Method, path: &str, body: Value) -> Result<Value, String> {
    let r = c
        .request(method, format!("http://127.0.0.1:8080/api{path}"))
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = r.status();
    let value: Value = serde_json::from_slice(&r.bytes().await.map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("{path}: {status} {value}"));
    }
    Ok(value)
}
fn id(v: &Value) -> Uuid {
    v["id"].as_str().unwrap().parse().unwrap()
}
async fn build(c: &Client, service: Uuid) -> Result<Uuid, String> {
    let b = api(
        c,
        Method::POST,
        &format!("/services/{service}/builds"),
        json!({"operationId":Uuid::new_v4(),"noCache":false}),
    )
    .await?;
    let build = id(&b);
    for _ in 0..240 {
        let revisions = api(
            c,
            Method::GET,
            &format!("/services/{service}/revisions"),
            Value::Null,
        )
        .await?;
        if let Some(r) = revisions
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["buildId"] == build.to_string())
        {
            return Ok(id(r));
        }
        let b = api(c, Method::GET, &format!("/builds/{build}"), Value::Null).await?;
        if matches!(
            b["status"].as_str(),
            Some("failed" | "cancelled" | "interrupted")
        ) {
            return Err(format!("build {build} failed: {}", b["errorCode"]));
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    Err("build timed out".into())
}
async fn configure(c: &Client, service: Uuid, edit: impl FnOnce(&mut Value)) -> Result<(), String> {
    let mut s = api(c, Method::GET, &format!("/services/{service}"), Value::Null).await?;
    edit(&mut s["spec"]);
    api(
        c,
        Method::PUT,
        &format!("/services/{service}"),
        json!({"operationId":Uuid::new_v4(),"expectedVersion":s["version"],"spec":s["spec"]}),
    )
    .await?;
    Ok(())
}
async fn deploy(c: &Client, service: Uuid, revision: Uuid) -> Result<Uuid, String> {
    let body = json!({"operationId":Uuid::new_v4(),"revisionId":revision});
    let d = api(
        c,
        Method::POST,
        &format!("/services/{service}/deployments"),
        body.clone(),
    )
    .await?;
    let retry = api(
        c,
        Method::POST,
        &format!("/services/{service}/deployments"),
        body,
    )
    .await?;
    if d != retry {
        return Err("deployment retry was not idempotent".into());
    }
    Ok(id(&d))
}
async fn wait(pool: &PgPool, deployment: Uuid, expected: &str) -> Result<(), String> {
    for _ in 0..180 {
        let status: String = sqlx::query_scalar("SELECT status FROM deployments WHERE id=$1")
            .bind(deployment)
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;
        if status == expected {
            return Ok(());
        }
        if matches!(status.as_str(), "failed" | "stopped") {
            return Err(format!(
                "deployment {deployment}: {status}, expected {expected}"
            ));
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    Err(format!("deployment {deployment} did not reach {expected}"))
}
async fn body(c: &Client, pool: &PgPool, service: Uuid, path: &str) -> Result<String, String> {
    let port:i32=sqlx::query_scalar("SELECT n.endpoint_base+i.slot FROM instances i JOIN nodes n ON n.id=i.node_id JOIN deployments d ON d.id=i.deployment_id WHERE d.service_id=$1 AND d.status='active' AND i.state='ready' AND i.desired_state='running' LIMIT 1").bind(service).fetch_one(pool).await.map_err(|e|e.to_string())?;
    c.get(format!("http://127.0.0.1:{port}{path}"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())
}
#[tokio::test]
#[ignore = "requires RUN_RELEASE_NETWORK_CANARY=1 and .local/release-network-source.zip"]
async fn real_build_options_release_gates_and_private_connections() {
    if std::env::var("RUN_RELEASE_NETWORK_CANARY").as_deref() != Ok("1") {
        return;
    }
    let pool = PgPool::connect(&std::env::var("DATABASE_URL").unwrap())
        .await
        .unwrap();
    let nodes:i64=sqlx::query_scalar("SELECT count(*) FROM nodes WHERE 'private-network-v1'=ANY(capabilities) AND last_seen>now()-interval '30 seconds'").fetch_one(&pool).await.unwrap();
    assert_eq!(nodes, 3);
    let c = Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let zip = tokio::fs::read(root.join(".local/release-network-source.zip"))
        .await
        .unwrap();
    api(
        &c,
        Method::POST,
        "/projects",
        json!({"name":"platform-release-canary"}),
    )
    .await
    .unwrap();
    let uploaded = c
        .post("http://127.0.0.1:8080/api/source-uploads?project=platform-release-canary")
        .header("Content-Type", "application/zip")
        .body(zip)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .bytes()
        .await
        .unwrap();
    let uploaded: Value = serde_json::from_slice(&uploaded).unwrap();
    let mut services = Vec::new();
    let result:Result<(),String>=async {
        let stamp=chrono::Utc::now().timestamp_millis();
        for name in ["upstream","client"] {
            let spec=json!({"schemaVersion":1,"project":"platform-release-canary","environment":"production","name":format!("{name}-{stamp}"),"source":{"upload":uploaded["digest"]},"resources":{"cpuMillis":50,"memoryMib":32},"distinctNodes":false,"domains":[],"secrets":[],"workload":{"kind":"oci-service","buildMode":"dockerfile","dockerfile":"Dockerfile","context":".","buildArgs":{"CANARY_LABEL":"release-v1"},"buildTarget":"app","replicas":1,"port":3000,"readiness":{"path":"/","intervalSeconds":1,"stabilizationSeconds":2}}});
            let s=api(&c,Method::POST,"/services",json!({"operationId":Uuid::new_v4(),"spec":spec,"buildOnCreate":false})).await?;services.push(id(&s));
        }
        let target=services[0];let source=services[1];
        tokio::fs::write(root.join(".local/release-network-canary.json"),json!({"target":target,"source":source}).to_string()).await.map_err(|e|e.to_string())?;
        let revision=build(&c,target).await?;
        let old=deploy(&c,target,revision).await?;wait(&pool,old,"active").await?;
        if body(&c,&pool,target,"/").await?.trim()!="release-v1"{return Err("build arg/stage was not used".into());}
        println!("Dockerfile target and literal build argument verified by live HTTP response");
        for (command,limit,expected) in [("fail",60,"failed"),("sleep",10,"timed_out")] {
            configure(&c,target,|spec|spec["workload"]["preDeploy"]=json!({"command":["/canary",command],"timeoutSeconds":limit})).await?;
            let d=deploy(&c,target,revision).await?;wait(&pool,d,"failed").await?;
            let outcome:String=sqlx::query_scalar("SELECT status FROM deployments WHERE parent_deployment_id=$1").bind(d).fetch_one(&pool).await.map_err(|e|e.to_string())?;
            if outcome!=expected{return Err(format!("migration expected {expected}, got {outcome}"));}
            if body(&c,&pool,target,"/").await?.trim()!="release-v1"{return Err("failed migration disrupted old app".into());}
            for _ in 0..30 {let running:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM instances i JOIN deployments d ON d.id=i.deployment_id WHERE d.parent_deployment_id=$1 AND i.state<>'stopped')").bind(d).fetch_one(&pool).await.map_err(|e|e.to_string())?;if !running{break;}tokio::time::sleep(Duration::from_secs(1)).await;}
            println!("{expected} migration preserved the old HTTP app");
        }
        configure(&c,target,|spec|spec["workload"]["preDeploy"]=json!({"command":["/canary","sleep"],"timeoutSeconds":90})).await?;
        let d=deploy(&c,target,revision).await?;
        for _ in 0..90 {let started:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM instance_starts s JOIN instances i ON i.id=s.instance_id JOIN deployments d ON d.id=i.deployment_id WHERE d.parent_deployment_id=$1)").bind(d).fetch_one(&pool).await.map_err(|e|e.to_string())?;if started{break;}tokio::time::sleep(Duration::from_secs(1)).await;}
        let status=tokio::process::Command::new("systemctl").args(["--user","restart","local-paas-api"]).env("XDG_RUNTIME_DIR","/run/user/1000").status().await.map_err(|e|e.to_string())?;
        if !status.success(){return Err("API restart failed".into());}
        wait(&pool,d,"active").await?;
        let starts:i64=sqlx::query_scalar("SELECT count(*) FROM instance_starts s JOIN instances i ON i.id=s.instance_id JOIN deployments j ON j.id=i.deployment_id WHERE j.parent_deployment_id=$1").bind(d).fetch_one(&pool).await.map_err(|e|e.to_string())?;
        if starts!=1{return Err(format!("migration had {starts} starts"));}println!("controller restart resumed the migration gate without repeating its command");
        configure(&c,source,|spec|{spec["workload"]["privateConnections"]=json!([{"serviceId":target,"env":"API_URL"}]);spec["workload"]["preDeploy"]=json!({"command":["/canary","fetch"],"timeoutSeconds":60});}).await?;
        let client_revision=build(&c,source).await?;
        let client_deploy=deploy(&c,source,client_revision).await?;wait(&pool,client_deploy,"active").await?;
        if body(&c,&pool,source,"/dependency").await?.trim()!="release-v1"{return Err("private service call failed".into());}
        let separate_nodes: bool=sqlx::query_scalar("SELECT a.node_id<>b.node_id FROM instances a JOIN deployments da ON da.id=a.deployment_id CROSS JOIN instances b JOIN deployments db ON db.id=b.deployment_id WHERE da.service_id=$1 AND db.service_id=$2 AND da.status='active' AND db.status='active'").bind(source).bind(target).fetch_one(&pool).await.map_err(|e|e.to_string())?;
        if !separate_nodes { return Err("cross-node canary was unexpectedly colocated".into()); }
        println!("pre-deploy job and app both resolved and called the private dependency across worker VMs");
        configure(&c,target,|spec|{spec["workload"].as_object_mut().unwrap().remove("preDeploy");spec["workload"]["buildArgs"]["CANARY_LABEL"]=json!("release-v2");}).await?;
        let next=build(&c,target).await?;let next=deploy(&c,target,next).await?;wait(&pool,next,"active").await?;
        for attempt in 0..20 {if body(&c,&pool,source,"/dependency").await.ok().as_deref()==Some("release-v2\n"){break;} else if attempt==19{return Err("private proxy did not adopt the new healthy deployment".into());}tokio::time::sleep(Duration::from_secs(1)).await;}
        println!("private connection followed a replacement deployment without restarting the client");
        let job=api(&c,Method::POST,&format!("/services/{target}/jobs"),json!({"operationId":Uuid::new_v4(),"revisionId":revision,"options":{"command":["/canary","blocked"],"timeoutSeconds":60}})).await?;
        wait(&pool,id(&job),"succeeded").await?;
        println!("a workload without a declared connection could not use the private proxy");
        Ok(())
    }.await;
    // Cleanup always runs, including failed drills; retain history and logs.
    for service in &services {
        let deployments:Vec<Uuid>=sqlx::query_scalar("SELECT id FROM deployments WHERE service_id=$1 AND status IN ('active','releasing','preparing','waiting','job')").bind(service).fetch_all(&pool).await.unwrap();
        for deployment in deployments {
            let _ = api(
                &c,
                Method::POST,
                &format!("/deployments/{deployment}/stop"),
                json!({}),
            )
            .await;
        }
    }
    for _ in 0..60 {
        let running:i64=sqlx::query_scalar("SELECT count(*) FROM instances i JOIN deployments d ON d.id=i.deployment_id WHERE d.service_id=ANY($1) AND i.state<>'stopped'").bind(&services).fetch_one(&pool).await.unwrap();
        if running == 0 {
            break;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    if let Err(error) = result {
        panic!("{error}");
    }
}
