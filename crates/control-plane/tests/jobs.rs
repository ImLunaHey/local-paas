use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;
async fn call(pool: &PgPool, path: &str, value: Value, token: Option<&str>) -> (StatusCode, Value) {
    let mut r = Request::builder()
        .method("POST")
        .uri(path)
        .header("host", "localhost:8080")
        .header("content-type", "application/json");
    if let Some(token) = token {
        r = r.header("authorization", format!("Bearer {token}"));
    }
    let response = control_plane::router(pool.clone(), vec![])
        .oneshot(r.body(Body::from(value.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
async fn fixture(pool: &PgPool) -> (Uuid, Uuid, Vec<Uuid>) {
    let spec: Value =
        serde_json::from_str(include_str!("../../../examples/oci-service.json")).unwrap();
    fixture_with_spec(pool, spec).await
}

async fn fixture_with_spec(pool: &PgPool, spec: Value) -> (Uuid, Uuid, Vec<Uuid>) {
    let (_, s) = call(
        pool,
        "/api/services",
        json!({"buildOnCreate":false,"operationId":Uuid::new_v4(),"spec":spec}),
        None,
    )
    .await;
    let service = s["id"].as_str().unwrap().parse::<Uuid>().unwrap();
    call(
        pool,
        &format!("/api/services/{service}/builds"),
        json!({"operationId":Uuid::new_v4(),"noCache":false}),
        None,
    )
    .await;
    let b = control_plane::builds::claim(pool).await.unwrap().unwrap();
    control_plane::builds::finish(
        pool,
        &b,
        control_plane::builds::Completion::Succeeded {
            repository: "127.0.0.1:15000/platform/test".into(),
            digest: format!("sha256:{}", "a".repeat(64)).try_into().unwrap(),
        },
    )
    .await
    .unwrap();
    let revision: Uuid = sqlx::query_scalar("SELECT id FROM revisions WHERE build_id=$1")
        .bind(b.id)
        .fetch_one(pool)
        .await
        .unwrap();
    let mut nodes = Vec::new();
    for i in 0..3 {
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO nodes(id,name,token_hash,cpu_millis,memory_mib,slots,endpoint_base,last_seen) VALUES($1,$2,$3,1000,1500,4,$4,now())").bind(id).bind(format!("node-{i}")).bind(control_plane::runtime::token_hash(&"a".repeat(64))).bind(21000+i*100).execute(pool).await.unwrap();
        nodes.push(id);
    }
    (service, revision, nodes)
}

async fn put(pool: &PgPool, path: &str, value: Value) -> (StatusCode, Value) {
    let response = control_plane::router(pool.clone(), vec![])
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(path)
                .header("host", "localhost:8080")
                .header("content-type", "application/json")
                .body(Body::from(value.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
async fn status(pool: &PgPool, id: Uuid) -> String {
    sqlx::query_scalar("SELECT status FROM deployments WHERE id=$1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn jobs_deduplicate_isolate_results_and_hold_ownership_until_cleanup(pool: PgPool) {
    let (service, revision, nodes) = fixture(&pool).await;
    let path = format!("/api/services/{service}/jobs");
    let request = json!({"operationId":Uuid::new_v4(),"revisionId":revision,"options":{"command":["/app/import","--limit","10"],"timeoutSeconds":60}});
    let (first, retry) = tokio::join!(
        call(&pool, &path, request.clone(), None),
        call(&pool, &path, request.clone(), None)
    );
    assert_eq!(first.0, StatusCode::OK, "{first:?}");
    assert_eq!(first, retry);
    let id: Uuid = first.1["id"].as_str().unwrap().parse().unwrap();
    let mut conflicting = request.clone();
    conflicting["options"]["timeoutSeconds"] = json!(90);
    assert_eq!(
        call(&pool, &path, conflicting, None).await.0,
        StatusCode::CONFLICT
    );
    control_plane::runtime::reconcile(&pool).await.unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM instances WHERE deployment_id=$1")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0, "old agents cannot receive a one-shot job");
    sqlx::query("UPDATE nodes SET capabilities=ARRAY['jobs-v1','workers-v1'] WHERE id=$1")
        .bind(nodes[0])
        .execute(&pool)
        .await
        .unwrap();
    let (a, b) = tokio::join!(
        control_plane::runtime::reconcile(&pool),
        control_plane::runtime::reconcile(&pool)
    );
    assert!(a.is_ok());
    assert!(b.is_ok());
    let instance: Uuid = sqlx::query_scalar("SELECT id FROM instances WHERE deployment_id=$1")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let token = "a".repeat(64);
    let sync = |node, capabilities: Value, observations: Value| json!({"version":platform_protocol::VERSION,"nodeId":node,"capabilities":capabilities,"observations":observations});
    let (_, legacy) = call(
        &pool,
        "/api/agent/sync",
        sync(nodes[0], json!(["workers-v1"]), json!([])),
        Some(&token),
    )
    .await;
    assert_eq!(legacy["assignments"], json!([]));
    let (_, assigned) = call(
        &pool,
        "/api/agent/sync",
        sync(
            nodes[0],
            json!(["workers-v1", "jobs-v1", "recovery-v1"]),
            json!([]),
        ),
        Some(&token),
    )
    .await;
    let assignment = &assigned["assignments"][0];
    assert_eq!(assignment["job"]["command"], request["options"]["command"]);
    assert!(assignment["spec"]["workload"]["port"].is_null());
    assert!(assignment["recoveryAllowed"].is_null());
    assert!(
        assignment["job"]["deadlineUnixMs"].as_i64().unwrap()
            > chrono::Utc::now().timestamp_millis()
    );
    let result = |generation| json!([{"instanceId":instance,"generation":generation,"observedUnixMs":chrono::Utc::now().timestamp_millis(),"state":"failed","jobResult":{"outcome":"succeeded","exitCode":0},"metrics":null,"diagnostic":null,"logs":[]}]);
    // A report from a different node or generation must not complete the job.
    call(
        &pool,
        "/api/agent/sync",
        sync(nodes[1], json!(["workers-v1", "jobs-v1"]), result(1)),
        Some(&token),
    )
    .await;
    call(
        &pool,
        "/api/agent/sync",
        sync(nodes[0], json!(["workers-v1", "jobs-v1"]), result(0)),
        Some(&token),
    )
    .await;
    assert_eq!(status(&pool, id).await, "job");
    sqlx::query("UPDATE nodes SET last_seen=now()-interval '1 hour' WHERE id=$1")
        .bind(nodes[0])
        .execute(&pool)
        .await
        .unwrap();
    let mut another = request.clone();
    another["operationId"] = json!(Uuid::new_v4());
    assert_eq!(
        call(&pool, &path, another.clone(), None).await.0,
        StatusCode::CONFLICT,
        "lost nodes still own their job"
    );
    let (code, finished) = call(
        &pool,
        "/api/agent/sync",
        sync(nodes[0], json!(["workers-v1", "jobs-v1"]), result(1)),
        Some(&token),
    )
    .await;
    assert_eq!(code, StatusCode::OK);
    assert_eq!(status(&pool, id).await, "succeeded");
    assert_eq!(finished["assignments"][0]["desiredState"], "stopped");
    assert_eq!(
        call(&pool, &path, another.clone(), None).await.0,
        StatusCode::CONFLICT,
        "completion is not confirmed cleanup"
    );
    tokio::time::sleep(std::time::Duration::from_millis(2)).await;
    call(&pool,"/api/agent/sync",sync(nodes[0],json!(["workers-v1","jobs-v1"]),json!([{"instanceId":instance,"generation":2,"observedUnixMs":chrono::Utc::now().timestamp_millis(),"state":"stopped","diagnostic":null,"metrics":null,"logs":[]}])),Some(&token)).await;
    let (code, new) = call(&pool, &path, another, None).await;
    assert_eq!(code, StatusCode::OK);
    let second: Uuid = new["id"].as_str().unwrap().parse().unwrap();
    call(
        &pool,
        &format!("/api/deployments/{second}/stop"),
        json!({}),
        None,
    )
    .await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(status(&pool, second).await, "cancelled");
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM instances WHERE deployment_id=$1")
        .bind(second)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    call(
        &pool,
        &format!("/api/deployments/{id}/stop"),
        json!({}),
        None,
    )
    .await;
    assert_eq!(
        status(&pool, id).await,
        "succeeded",
        "cancel cannot overwrite terminal results"
    );
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE target_type='deployments' AND target_id=$1",
    )
    .bind(id.to_string())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(count >= 2);
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn schedules_are_versioned_deduplicated_and_skip_overlap_and_missed_ticks(pool: PgPool) {
    let (service, revision, _) = fixture(&pool).await;
    let path = format!("/api/services/{service}/job-schedule");
    let mut request = json!({"operationId":Uuid::new_v4(),"version":0,"revisionId":revision,"options":{"command":[],"timeoutSeconds":60},"intervalMinutes":1,"enabled":true});
    let first = put(&pool, &path, request.clone()).await;
    assert_eq!(first.0, StatusCode::OK, "{first:?}");
    assert_eq!(first, put(&pool, &path, request.clone()).await);
    let mut stale = request.clone();
    stale["operationId"] = json!(Uuid::new_v4());
    assert_eq!(put(&pool, &path, stale).await.0, StatusCode::CONFLICT);
    sqlx::query("UPDATE job_schedules SET next_run_at=now()-interval '1 second' WHERE id=$1")
        .bind(service)
        .execute(&pool)
        .await
        .unwrap();
    let (a, b) = tokio::join!(
        control_plane::jobs::tick(&pool),
        control_plane::jobs::tick(&pool)
    );
    assert!(a.is_ok());
    assert!(b.is_ok());
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM deployments WHERE service_id=$1")
        .bind(service)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
    sqlx::query("UPDATE job_schedules SET next_run_at=now()-interval '1 second' WHERE id=$1")
        .bind(service)
        .execute(&pool)
        .await
        .unwrap();
    assert!(control_plane::jobs::tick(&pool).await.is_ok());
    let overlap: i64 =
        sqlx::query_scalar("SELECT count(*) FROM job_occurrences WHERE status='skipped_overlap'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(overlap, 1);
    sqlx::query("UPDATE job_schedules SET next_run_at=now()-interval '2 hours' WHERE id=$1")
        .bind(service)
        .execute(&pool)
        .await
        .unwrap();
    assert!(control_plane::jobs::tick(&pool).await.is_ok());
    let skipped: i64 = sqlx::query_scalar(
        "SELECT skipped_count FROM job_occurrences WHERE status='skipped_missed'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(skipped, 121);
    request["operationId"] = json!(Uuid::new_v4());
    request["version"] = json!(1);
    request["enabled"] = json!(false);
    assert_eq!(put(&pool, &path, request.clone()).await.0, StatusCode::OK);
    sqlx::query("UPDATE job_schedules SET next_run_at=now()-interval '1 second' WHERE id=$1")
        .bind(service)
        .execute(&pool)
        .await
        .unwrap();
    assert!(control_plane::jobs::tick(&pool).await.is_ok());
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM job_occurrences")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 3);
    let audited: i64 =
        sqlx::query_scalar("SELECT count(*) FROM audit_log WHERE target_type='job_schedules'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        audited, 2,
        "automatic next-run advancement is not an administrative edit"
    );
    let spec: Value = sqlx::query_scalar("SELECT spec FROM services WHERE id=$1")
        .bind(service)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(
        spec["workload"]["execution"].is_null(),
        "job snapshots cannot change the app's execution type"
    );
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn singleton_replacement_does_not_cancel_or_wait_for_an_independent_job(pool: PgPool) {
    let (service, revision, _) = fixture(&pool).await;
    sqlx::query("UPDATE nodes SET capabilities=ARRAY['workers-v1','jobs-v1']")
        .execute(&pool)
        .await
        .unwrap();
    let (code,job)=call(&pool,&format!("/api/services/{service}/jobs"),json!({"operationId":Uuid::new_v4(),"revisionId":revision,"options":{"command":[],"timeoutSeconds":60}}),None).await;
    assert_eq!(code, StatusCode::OK);
    let job: Uuid = job["id"].as_str().unwrap().parse().unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    sqlx::query("UPDATE services SET spec=jsonb_set(jsonb_set(spec,'{workload}',((spec->'workload')-'port'-'readiness')||'{\"execution\":\"worker\",\"replicas\":1}'::jsonb),'{domains}','[]'::jsonb) WHERE id=$1").bind(service).execute(&pool).await.unwrap();
    let (code, worker) = call(
        &pool,
        &format!("/api/services/{service}/deployments"),
        json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
        None,
    )
    .await;
    assert_eq!(code, StatusCode::OK);
    let worker: Uuid = worker["id"].as_str().unwrap().parse().unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(status(&pool, worker).await, "preparing");
    let desired: String =
        sqlx::query_scalar("SELECT desired_state FROM instances WHERE deployment_id=$1")
            .bind(job)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        desired, "running",
        "worker replacement must not stop an independent job"
    );
    call(
        &pool,
        &format!("/api/deployments/{worker}/stop"),
        json!({}),
        None,
    )
    .await;
    assert_eq!(status(&pool, job).await, "job");
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn release_gate_is_durable_and_requires_success_and_cleanup(pool: PgPool) {
    let (service, revision, _) = fixture(&pool).await;
    sqlx::query("UPDATE nodes SET capabilities=ARRAY['workers-v1','jobs-v1']")
        .execute(&pool)
        .await
        .unwrap();
    let path = format!("/api/services/{service}/deployments");
    let (_, old) = call(
        &pool,
        &path,
        json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
        None,
    )
    .await;
    let old: Uuid = old["id"].as_str().unwrap().parse().unwrap();
    sqlx::query("UPDATE deployments SET status='active' WHERE id=$1")
        .bind(old)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE services SET spec=jsonb_set(spec,'{workload,preDeploy}',$2) WHERE id=$1")
        .bind(service)
        .bind(json!({"command":["/migrate"],"timeoutSeconds":60}))
        .execute(&pool)
        .await
        .unwrap();
    let request = json!({"operationId":Uuid::new_v4(),"revisionId":revision});
    let (a, b) = tokio::join!(
        call(&pool, &path, request.clone(), None),
        call(&pool, &path, request.clone(), None)
    );
    assert_eq!(a.0, StatusCode::OK, "{a:?}");
    assert_eq!(a, b);
    let parent: Uuid = a.1["id"].as_str().unwrap().parse().unwrap();
    let child: Uuid =
        sqlx::query_scalar("SELECT id FROM deployments WHERE parent_deployment_id=$1")
            .bind(parent)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status(&pool, parent).await, "releasing");
    assert_eq!(status(&pool, old).await, "active");
    let snapshot: bool=sqlx::query_scalar("SELECT j.revision_id=d.revision_id AND j.secret_version IS NOT DISTINCT FROM d.secret_version AND j.database_ports=d.database_ports AND j.spec->'workload'->'preDeploy' IS NULL FROM deployments j JOIN deployments d ON d.id=j.parent_deployment_id WHERE j.id=$1").bind(child).fetch_one(&pool).await.unwrap();
    assert!(snapshot);
    let manual=call(&pool,&format!("/api/services/{service}/jobs"),json!({"operationId":Uuid::new_v4(),"revisionId":revision,"options":{"command":[],"timeoutSeconds":60}}),None).await;
    assert_eq!(manual.0, StatusCode::CONFLICT);
    control_plane::runtime::reconcile(&pool).await.unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM instances WHERE deployment_id=$1")
        .bind(parent)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    sqlx::query("UPDATE deployments SET status='succeeded',job_result='{\"outcome\":\"succeeded\",\"exitCode\":0}' WHERE id=$1").bind(child).execute(&pool).await.unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(
        status(&pool, parent).await,
        "releasing",
        "success without confirmed cleanup cannot proceed"
    );
    sqlx::query(
        "UPDATE instances SET state='stopped',desired_state='stopped' WHERE deployment_id=$1",
    )
    .bind(child)
    .execute(&pool)
    .await
    .unwrap();
    let (a, b) = tokio::join!(
        control_plane::runtime::reconcile(&pool),
        control_plane::runtime::reconcile(&pool)
    );
    a.unwrap();
    b.unwrap();
    assert_eq!(status(&pool, parent).await, "preparing");
    assert_eq!(status(&pool, old).await, "active");
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM deployments WHERE parent_deployment_id=$1")
            .bind(parent)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 1);
    sqlx::query("UPDATE instances SET state='ready',observed_at=now() WHERE deployment_id=$1")
        .bind(parent)
        .execute(&pool)
        .await
        .unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(status(&pool, parent).await, "active");
    assert_eq!(status(&pool, old).await, "superseded");
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn failed_and_cancelled_release_jobs_preserve_the_old_worker(pool: PgPool) {
    let (service, revision, _) = fixture(&pool).await;
    sqlx::query("UPDATE nodes SET capabilities=ARRAY['workers-v1','jobs-v1']")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE services SET spec=jsonb_set(jsonb_set(spec,'{workload}',((spec->'workload')-'port'-'readiness')||'{\"execution\":\"worker\",\"replicas\":1}'::jsonb),'{domains}','[]'::jsonb) WHERE id=$1").bind(service).execute(&pool).await.unwrap();
    let path = format!("/api/services/{service}/deployments");
    let (_, old) = call(
        &pool,
        &path,
        json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
        None,
    )
    .await;
    let old: Uuid = old["id"].as_str().unwrap().parse().unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    sqlx::query("UPDATE deployments SET status='active' WHERE id=$1")
        .bind(old)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE services SET spec=jsonb_set(spec,'{workload,preDeploy}',$2) WHERE id=$1")
        .bind(service)
        .bind(json!({"command":["/migrate"],"timeoutSeconds":60}))
        .execute(&pool)
        .await
        .unwrap();
    for result in ["failed", "timed_out", "uncertain", "cancelled"] {
        let (code, p) = call(
            &pool,
            &path,
            json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
            None,
        )
        .await;
        assert_eq!(code, StatusCode::OK, "{p:?}");
        let parent: Uuid = p["id"].as_str().unwrap().parse().unwrap();
        sqlx::query("UPDATE deployments SET status=$2 WHERE parent_deployment_id=$1")
            .bind(parent)
            .bind(result)
            .execute(&pool)
            .await
            .unwrap();
        control_plane::runtime::reconcile(&pool).await.unwrap();
        assert_eq!(status(&pool, parent).await, "failed");
        assert_eq!(status(&pool, old).await, "active");
        let desired: String =
            sqlx::query_scalar("SELECT desired_state FROM instances WHERE deployment_id=$1")
                .bind(old)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(desired, "running");
    }
    let (_, p) = call(
        &pool,
        &path,
        json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
        None,
    )
    .await;
    let parent: Uuid = p["id"].as_str().unwrap().parse().unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    call(
        &pool,
        &format!("/api/deployments/{parent}/stop"),
        json!({}),
        None,
    )
    .await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(status(&pool, parent).await, "stopped");
    assert_eq!(status(&pool, old).await, "active");
    let child: String =
        sqlx::query_scalar("SELECT status FROM deployments WHERE parent_deployment_id=$1")
            .bind(parent)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(child, "cancelled");
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn private_routes_are_scoped_health_gated_and_quarantine_reused_slots(pool: PgPool) {
    let (target, revision, nodes) = fixture(&pool).await;
    sqlx::query("UPDATE nodes SET capabilities=ARRAY['workers-v1','jobs-v1','private-network-v1']")
        .execute(&pool)
        .await
        .unwrap();
    let mut spec: Value = sqlx::query_scalar("SELECT spec FROM services WHERE id=$1")
        .bind(target)
        .fetch_one(&pool)
        .await
        .unwrap();
    spec["name"] = json!("private-client");
    spec["workload"]["replicas"] = json!(1);
    spec["workload"]["privateConnections"] = json!([{"serviceId":target,"env":"API_URL"}]);
    let mut wrong = spec.clone();
    wrong["environment"] = json!("other");
    let (status, _) = call(
        &pool,
        "/api/services",
        json!({"operationId":Uuid::new_v4(),"spec":wrong,"buildOnCreate":false}),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (code, source) = call(
        &pool,
        "/api/services",
        json!({"operationId":Uuid::new_v4(),"spec":spec,"buildOnCreate":false}),
        None,
    )
    .await;
    assert_eq!(code, StatusCode::CREATED, "{source:?}");
    let source: Uuid = source["id"].as_str().unwrap().parse().unwrap();
    call(
        &pool,
        &format!("/api/services/{source}/builds"),
        json!({"operationId":Uuid::new_v4(),"noCache":false}),
        None,
    )
    .await;
    let b = control_plane::builds::claim(&pool).await.unwrap().unwrap();
    control_plane::builds::finish(
        &pool,
        &b,
        control_plane::builds::Completion::Succeeded {
            repository: "127.0.0.1:15000/platform/test".into(),
            digest: format!("sha256:{}", "a".repeat(64)).try_into().unwrap(),
        },
    )
    .await
    .unwrap();
    let source_revision: Uuid = sqlx::query_scalar("SELECT id FROM revisions WHERE build_id=$1")
        .bind(b.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let (_, d) = call(
        &pool,
        &format!("/api/services/{target}/deployments"),
        json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
        None,
    )
    .await;
    let target_deploy: Uuid = d["id"].as_str().unwrap().parse().unwrap();
    sqlx::query("UPDATE nodes SET capabilities=ARRAY[]::text[]")
        .execute(&pool)
        .await
        .unwrap();
    let deploy = json!({"operationId":Uuid::new_v4(),"revisionId":source_revision});
    assert_eq!(
        call(
            &pool,
            &format!("/api/services/{source}/deployments"),
            deploy.clone(),
            None
        )
        .await
        .0,
        StatusCode::CONFLICT,
        "legacy nodes cannot run private clients"
    );
    sqlx::query("UPDATE nodes SET capabilities=ARRAY['private-network-v1']")
        .execute(&pool)
        .await
        .unwrap();
    let (code, d) = call(
        &pool,
        &format!("/api/services/{source}/deployments"),
        deploy,
        None,
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{d:?}");
    let source_deploy: Uuid = d["id"].as_str().unwrap().parse().unwrap();
    let node: Uuid = sqlx::query_scalar("SELECT node_id FROM instances WHERE deployment_id=$1")
        .bind(source_deploy)
        .fetch_one(&pool)
        .await
        .unwrap();
    let sync = || json!({"version":platform_protocol::VERSION,"nodeId":node,"observations":[],"capabilities":["private-network-v1"]});
    let token = "a".repeat(64);
    let (_, response) = call(&pool, "/api/agent/sync", sync(), Some(&token)).await;
    let client = response["assignments"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["serviceId"] == source.to_string())
        .unwrap();
    assert_eq!(
        client["privateBackends"],
        json!([[]]),
        "preparing targets are not routable"
    );
    sqlx::query("UPDATE deployments SET status='active' WHERE id=$1")
        .bind(target_deploy)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE instances SET state='ready',observed_at=now() WHERE deployment_id=$1")
        .bind(target_deploy)
        .execute(&pool)
        .await
        .unwrap();
    let (_, response) = call(&pool, "/api/agent/sync", sync(), Some(&token)).await;
    let client = response["assignments"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["serviceId"] == source.to_string())
        .unwrap();
    assert_eq!(client["privateBackends"][0].as_array().unwrap().len(), 2);
    let leases: i64 = sqlx::query_scalar("SELECT count(*) FROM private_route_leases")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(leases, 2);
    call(
        &pool,
        &format!("/api/deployments/{target_deploy}/stop"),
        json!({}),
        None,
    )
    .await;
    sqlx::query("UPDATE instances SET state='stopped' WHERE deployment_id=$1")
        .bind(target_deploy)
        .execute(&pool)
        .await
        .unwrap();
    let (_, response) = call(&pool, "/api/agent/sync", sync(), Some(&token)).await;
    let client = response["assignments"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["serviceId"] == source.to_string())
        .unwrap();
    assert_eq!(client["privateBackends"], json!([[]]));
    let (_, d) = call(
        &pool,
        &format!("/api/services/{target}/deployments"),
        json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
        None,
    )
    .await;
    let new: Uuid = d["id"].as_str().unwrap().parse().unwrap();
    let reused:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM instances a JOIN instances b ON a.node_id=b.node_id AND a.slot=b.slot WHERE a.deployment_id=$1 AND b.deployment_id=$2)").bind(target_deploy).bind(new).fetch_one(&pool).await.unwrap();
    assert!(!reused, "unexpired route leases quarantine old slots");
    // Shadowing rewrites target references, never points development at production.
    let environment: Uuid = sqlx::query_scalar("SELECT environment_id FROM services WHERE id=$1")
        .bind(source)
        .fetch_one(&pool)
        .await
        .unwrap();
    let (code, shadow) = call(
        &pool,
        "/api/environments",
        json!({"project":spec["project"],"name":"shadow-private","parentId":environment}),
        None,
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{shadow:?}");
    let remapped:Uuid=sqlx::query_scalar("SELECT (spec->'workload'->'privateConnections'->0->>'serviceId')::uuid FROM services WHERE environment_id=$1 AND name='private-client'").bind(shadow["id"].as_str().unwrap().parse::<Uuid>().unwrap()).fetch_one(&pool).await.unwrap();
    assert_ne!(remapped, target);
    let env: Uuid = sqlx::query_scalar("SELECT environment_id FROM services WHERE id=$1")
        .bind(remapped)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(env.to_string(), shadow["id"].as_str().unwrap());
    assert_eq!(nodes.len(), 3);
}

fn http_spec_with_release() -> Value {
    let mut spec: Value =
        serde_json::from_str(include_str!("../../../examples/oci-service.json")).unwrap();
    spec["workload"]["liveness"] =
        json!({"path":"/health","intervalSeconds":5,"failureThreshold":3});
    spec["workload"]["preDeploy"] = json!({"command":["echo","migration"],"timeoutSeconds":60});
    let spec: platform_domain::ServiceSpec = serde_json::from_value(spec).unwrap();
    spec.validate().unwrap();
    serde_json::to_value(spec).unwrap()
}

async fn stored_spec(pool: &PgPool, deployment: Uuid) -> platform_domain::ServiceSpec {
    sqlx::query_scalar::<_, sqlx::types::Json<platform_domain::ServiceSpec>>(
        "SELECT spec FROM deployments WHERE id=$1",
    )
    .bind(deployment)
    .fetch_one(pool)
    .await
    .unwrap()
    .0
}

async fn job_assignment(
    pool: &PgPool,
    node: Uuid,
    observations: Value,
) -> platform_protocol::Assignment {
    let (code, response) = call(
        pool,
        "/api/agent/sync",
        json!({"version":platform_protocol::VERSION,"nodeId":node,
            "capabilities":["workers-v1","jobs-v1","recovery-v1"],"observations":observations}),
        Some(&"a".repeat(64)),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{response}");
    let response: platform_protocol::SyncResponse = serde_json::from_value(response).unwrap();
    assert_eq!(response.assignments.len(), 1);
    let assignment = response.assignments.into_iter().next().unwrap();
    // Both start and stop pass this same domain validation in the node agent.
    assignment.spec.validate().unwrap();
    assert!(assignment.spec.workload.is_worker());
    assert!(!assignment.recovery_allowed);
    assert!(assignment.recovery_policy.is_none());
    assignment
}

async fn http_job_runs_and_cleans_up(pool: &PgPool, pre_deploy: bool) {
    let original = http_spec_with_release();
    let (service, revision, nodes) = fixture_with_spec(pool, original.clone()).await;
    sqlx::query("UPDATE nodes SET capabilities=ARRAY['workers-v1','jobs-v1'] WHERE id=$1")
        .bind(nodes[0])
        .execute(pool)
        .await
        .unwrap();
    let (path, request) = if pre_deploy {
        (
            format!("/api/services/{service}/deployments"),
            json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
        )
    } else {
        (
            format!("/api/services/{service}/jobs"),
            json!({"operationId":Uuid::new_v4(),"revisionId":revision,
                "options":{"command":["echo","job"],"timeoutSeconds":60}}),
        )
    };
    let (code, response) = call(pool, &path, request.clone(), None).await;
    assert_eq!(code, StatusCode::OK, "{response}");
    let deployment: Uuid = response["id"].as_str().unwrap().parse().unwrap();
    let job = if pre_deploy {
        sqlx::query_scalar("SELECT id FROM deployments WHERE parent_deployment_id=$1")
            .bind(deployment)
            .fetch_one(pool)
            .await
            .unwrap()
    } else {
        deployment
    };
    let spec = stored_spec(pool, job).await;
    spec.validate().unwrap();
    assert!(spec.domains.is_empty());
    assert!(!spec.distinct_nodes);
    let platform_domain::Workload::OciService {
        execution,
        replicas,
        port,
        readiness,
        liveness,
        pre_deploy: release,
        ..
    } = &spec.workload
    else {
        panic!("expected OCI job");
    };
    assert_eq!(*execution, platform_domain::Execution::Worker);
    assert_eq!(*replicas, 1);
    assert!(port.is_none() && readiness.is_none() && liveness.is_none() && release.is_none());
    let stored: Value = sqlx::query_scalar("SELECT spec FROM services WHERE id=$1")
        .bind(service)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(stored["workload"], original["workload"]);
    if pre_deploy {
        assert_eq!(
            serde_json::to_value(stored_spec(pool, deployment).await).unwrap()["workload"],
            original["workload"]
        );
    }
    control_plane::runtime::reconcile(pool).await.unwrap();
    let start = job_assignment(pool, nodes[0], json!([])).await;
    assert_eq!(start.deployment_id, job);
    assert_eq!(start.desired_state, "running");
    let command = if pre_deploy {
        vec!["echo", "migration"]
    } else {
        vec!["echo", "job"]
    };
    assert_eq!(start.job.as_ref().unwrap().command, command);
    let stop = job_assignment(
        pool,
        nodes[0],
        json!([{
            "instanceId":start.instance_id,"generation":start.generation,
            "observedUnixMs":chrono::Utc::now().timestamp_millis(),"state":"failed",
            "jobResult":{"outcome":"succeeded","exitCode":0},"logs":[]
        }]),
    )
    .await;
    assert_eq!(status(pool, job).await, "succeeded");
    assert_eq!(stop.instance_id, start.instance_id);
    assert_eq!(stop.desired_state, "stopped");
    assert!(stop.generation > start.generation);
    control_plane::runtime::reconcile(pool).await.unwrap();
    if pre_deploy {
        assert_eq!(status(pool, deployment).await, "releasing");
    } else {
        let mut next = request.clone();
        next["operationId"] = json!(Uuid::new_v4());
        assert_eq!(call(pool, &path, next, None).await.0, StatusCode::CONFLICT);
    }
    tokio::time::sleep(std::time::Duration::from_millis(2)).await;
    let (code, _) = call(
        pool,
        "/api/agent/sync",
        json!({
            "version":platform_protocol::VERSION,"nodeId":nodes[0],
            "capabilities":["workers-v1","jobs-v1"],"observations":[{
                "instanceId":stop.instance_id,"generation":stop.generation,
                "observedUnixMs":chrono::Utc::now().timestamp_millis(),"state":"stopped","logs":[]
            }]
        }),
        Some(&"a".repeat(64)),
    )
    .await;
    assert_eq!(code, StatusCode::OK);
    control_plane::runtime::reconcile(pool).await.unwrap();
    let cleaned: bool = sqlx::query_scalar("SELECT state='stopped' FROM instances WHERE id=$1")
        .bind(stop.instance_id)
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(cleaned);
    if pre_deploy {
        assert_eq!(status(pool, deployment).await, "preparing");
    } else {
        let mut next = request;
        next["operationId"] = json!(Uuid::new_v4());
        assert_eq!(call(pool, &path, next, None).await.0, StatusCode::OK);
    }
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn one_off_http_job_clears_liveness_and_allows_cleanup(pool: PgPool) {
    http_job_runs_and_cleans_up(&pool, false).await;
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn pre_deploy_http_job_clears_liveness_and_allows_cleanup(pool: PgPool) {
    http_job_runs_and_cleans_up(&pool, true).await;
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn invalid_derived_job_specs_are_rejected_before_persistence(pool: PgPool) {
    let (service, revision, _) = fixture_with_spec(&pool, http_spec_with_release()).await;
    // Simulate a stored specification that no longer meets domain constraints.
    sqlx::query("UPDATE services SET spec=jsonb_set(spec,'{resources,cpuMillis}','0') WHERE id=$1")
        .bind(service)
        .execute(&pool)
        .await
        .unwrap();
    for endpoint in ["jobs", "deployments"] {
        let operation = Uuid::new_v4();
        let mut request = json!({"operationId":operation,"revisionId":revision});
        if endpoint == "jobs" {
            request["options"] = json!({"command":["echo","job"],"timeoutSeconds":60});
        }
        let (code, response) = call(
            &pool,
            &format!("/api/services/{service}/{endpoint}"),
            request,
            None,
        )
        .await;
        assert_eq!(code, StatusCode::UNPROCESSABLE_ENTITY, "{response}");
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM deployments WHERE service_id=$1")
            .bind(service)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            count, 0,
            "invalid jobs and their parent deployments must roll back"
        );
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM events WHERE operation_id=$1")
            .bind(operation)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0, "rejected requests must not emit success events");
    }
}
