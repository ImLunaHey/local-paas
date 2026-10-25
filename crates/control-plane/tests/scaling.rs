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
    let mut spec: Value =
        serde_json::from_str(include_str!("../../../examples/oci-service.json")).unwrap();
    spec["workload"]["replicas"] = json!(1);
    spec["distinctNodes"] = json!(false);
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
async fn active(pool: &PgPool) -> (Uuid, Uuid, Vec<Uuid>) {
    let (service, revision, nodes) = fixture(pool).await;
    let (status, value) = call(
        pool,
        &format!("/api/services/{service}/deployments"),
        json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let deployment = value["id"].as_str().unwrap().parse::<Uuid>().unwrap();
    sqlx::query("UPDATE instances SET state='ready',observed_at=now()")
        .execute(pool)
        .await
        .unwrap();
    control_plane::runtime::reconcile(pool).await.unwrap();
    (service, deployment, nodes)
}

async fn policy(pool: &PgPool, service: Uuid, value: Value) -> (StatusCode, Value) {
    let response = control_plane::router(pool.clone(), vec![])
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/services/{service}/scaling"))
                .header("host", "localhost:8080")
                .header("content-type", "application/json")
                .body(Body::from(value.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}
async fn enable(pool: &PgPool, service: Uuid, minimum: u16) {
    let result = policy(pool,service,json!({"operationId":Uuid::new_v4(),"expectedVersion":0,"policy":{"enabled":true,"minReplicas":minimum,"maxReplicas":3}})).await;
    assert_eq!(result.0, StatusCode::OK, "{}", result.1);
}
async fn observe(pool: &PgPool, cpu: f64) {
    sqlx::query("UPDATE nodes SET last_seen=now()")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("UPDATE instances SET state='ready',observed_at=now(),cpu_millis=$1 WHERE desired_state='running' AND scale_down_after IS NULL").bind(cpu).execute(pool).await.unwrap();
}
async fn elapsed(pool: &PgPool) {
    sqlx::query("UPDATE scaling_policies SET evaluated_at=now()-interval '16 seconds',stable_since=now()-interval '1 hour',last_scaled_at=now()-interval '1 hour'").execute(pool).await.unwrap();
}
async fn condition(pool: &PgPool) -> String {
    sqlx::query_scalar("SELECT condition FROM scaling_policies")
        .fetch_one(pool)
        .await
        .unwrap()
}
async fn desired(pool: &PgPool) -> i32 {
    sqlx::query_scalar("SELECT desired_replicas FROM scaling_policies")
        .fetch_one(pool)
        .await
        .unwrap()
}
async fn reconcile(pool: &PgPool) {
    control_plane::runtime::reconcile(pool).await.unwrap();
}
async fn cleanup(pool: &PgPool) {
    sqlx::query("UPDATE instances SET scale_down_after=now()-interval '1 second' WHERE scale_down_after IS NOT NULL").execute(pool).await.unwrap();
    reconcile(pool).await;
    sqlx::query("UPDATE instances SET state='stopped' WHERE desired_state='stopped'")
        .execute(pool)
        .await
        .unwrap();
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn sustained_load_cooldown_restart_and_gradual_scale_in(pool: PgPool) {
    let (service, _, _) = active(&pool).await;
    enable(&pool, service, 1).await;
    observe(&pool, 500.0).await;
    reconcile(&pool).await;
    assert_eq!(condition(&pool).await, "stabilizing");
    elapsed(&pool).await;
    let (a, b) = tokio::join!(
        control_plane::runtime::reconcile(&pool),
        control_plane::runtime::reconcile(&pool)
    );
    a.unwrap();
    b.unwrap();
    assert_eq!(desired(&pool).await, 2);
    let decisions: i64 =
        sqlx::query_scalar("SELECT count(*) FROM scaling_decisions WHERE reason='scaled_out'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(decisions, 1);
    let unrouted: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM instances WHERE NOT routing_enabled AND scaling_deadline IS NOT NULL",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(unrouted, 1);
    observe(&pool, 500.0).await;
    sqlx::query("UPDATE scaling_policies SET evaluated_at=now()-interval '16 seconds'")
        .execute(&pool)
        .await
        .unwrap();
    // A new connection to the actual SQLx fixture models a controller restart.
    let options = pool.connect_options();
    let restarted = sqlx::PgPool::connect_with((*options).clone())
        .await
        .unwrap();
    control_plane::runtime::reconcile(&restarted).await.unwrap();
    assert_eq!(condition(&pool).await, "cooldown");
    elapsed(&pool).await;
    reconcile(&pool).await;
    assert_eq!(desired(&pool).await, 3);
    observe(&pool, 5.0).await;
    elapsed(&pool).await;
    reconcile(&pool).await;
    assert_eq!(condition(&pool).await, "stabilizing");
    elapsed(&pool).await;
    reconcile(&pool).await;
    assert_eq!(desired(&pool).await, 2);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM instances WHERE desired_state='running'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        3,
        "drain precedes shutdown"
    );
    cleanup(&pool).await;
    elapsed(&pool).await;
    reconcile(&pool).await;
    elapsed(&pool).await;
    reconcile(&pool).await;
    assert_eq!(desired(&pool).await, 1);
    let audit: i64 = sqlx::query_scalar("SELECT count(*) FROM audit_log WHERE action='scaling.decision' AND details->>'reason' IN ('scaled_out','scaled_in')").fetch_one(&pool).await.unwrap();
    assert_eq!(audit, 4);
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn stale_missing_and_interrupted_metrics_freeze_scaling(pool: PgPool) {
    let (service, _, _) = active(&pool).await;
    enable(&pool, service, 1).await;
    reconcile(&pool).await;
    assert_eq!(condition(&pool).await, "metrics_unavailable");
    observe(&pool, 500.0).await;
    elapsed(&pool).await;
    reconcile(&pool).await;
    sqlx::query("UPDATE instances SET observed_at=now()-interval '40 seconds'")
        .execute(&pool)
        .await
        .unwrap();
    elapsed(&pool).await;
    reconcile(&pool).await;
    assert_eq!(condition(&pool).await, "metrics_unavailable");
    observe(&pool, 500.0).await;
    elapsed(&pool).await;
    reconcile(&pool).await;
    assert_eq!(
        condition(&pool).await,
        "stabilizing",
        "missing data resets the sustained-load window"
    );
    assert_eq!(desired(&pool).await, 1);
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn operator_budget_capacity_and_selectors_are_enforced(pool: PgPool) {
    let (service, _, nodes) = active(&pool).await;
    let result = policy(&pool,service,json!({"operationId":Uuid::new_v4(),"expectedVersion":0,"policy":{"enabled":true,"nodeNames":["node-2"]}})).await;
    assert_eq!(result.0, StatusCode::OK);
    observe(&pool, 500.0).await;
    reconcile(&pool).await;
    sqlx::query("UPDATE nodes SET draining=true WHERE id=$1")
        .bind(nodes[2])
        .execute(&pool)
        .await
        .unwrap();
    elapsed(&pool).await;
    reconcile(&pool).await;
    assert_eq!(condition(&pool).await, "capacity_exhausted");
    sqlx::query("UPDATE nodes SET draining=false")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE scaling_limits SET max_instances=1")
        .execute(&pool)
        .await
        .unwrap();
    elapsed(&pool).await;
    reconcile(&pool).await;
    assert_eq!(condition(&pool).await, "operator_limit");
    sqlx::query("UPDATE scaling_limits SET max_instances=3")
        .execute(&pool)
        .await
        .unwrap();
    elapsed(&pool).await;
    reconcile(&pool).await;
    assert_eq!(desired(&pool).await, 2);
    assert_eq!(
        sqlx::query_scalar::<_, Uuid>(
            "SELECT node_id FROM instances WHERE scaling_deadline IS NOT NULL"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        nodes[2]
    );
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn rollout_and_failed_candidates_do_not_race_scaling(pool: PgPool) {
    let (service, deployment, _) = active(&pool).await;
    enable(&pool, service, 1).await;
    observe(&pool, 500.0).await;
    reconcile(&pool).await;
    elapsed(&pool).await;
    reconcile(&pool).await;
    let revision: Uuid = sqlx::query_scalar("SELECT revision_id FROM deployments WHERE id=$1")
        .bind(deployment)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(
            &pool,
            &format!("/api/services/{service}/deployments"),
            json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
            None
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    sqlx::query("UPDATE instances SET scaling_deadline=now()-interval '1 second' WHERE scaling_deadline IS NOT NULL").execute(&pool).await.unwrap();
    reconcile(&pool).await;
    cleanup(&pool).await;
    observe(&pool, 500.0).await;
    elapsed(&pool).await;
    reconcile(&pool).await;
    assert_eq!(condition(&pool).await, "candidate_failed");
    assert_eq!(desired(&pool).await, 1);
    let next = call(
        &pool,
        &format!("/api/services/{service}/deployments"),
        json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
        None,
    )
    .await;
    assert_eq!(next.0, StatusCode::OK, "{}", next.1);
    elapsed(&pool).await;
    reconcile(&pool).await;
    assert_eq!(condition(&pool).await, "rollout_job_or_cleanup_pending");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM instances WHERE state<>'stopped'")
            .fetch_one(&pool)
            .await
            .unwrap(),
        2
    );
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn policy_retries_and_ineligible_workloads_are_rejected(pool: PgPool) {
    let (service, _, _) = active(&pool).await;
    let input = json!({"operationId":Uuid::new_v4(),"expectedVersion":0,"policy":{"enabled":true}});
    assert_eq!(
        policy(&pool, service, input.clone()).await.0,
        StatusCode::OK
    );
    assert_eq!(
        policy(&pool, service, input.clone()).await.0,
        StatusCode::OK
    );
    let mut conflict = input.clone();
    conflict["policy"]["maxReplicas"] = json!(4);
    assert_eq!(
        policy(&pool, service, conflict).await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM audit_log WHERE action='scaling.policy.updated'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        1
    );
    for workload in [
        json!({"kind":"redis-service","storageGib":1}),
        json!({"kind":"celld-service","wrangler":"wrangler.json","members":3,"bucketRef":"test"}),
    ] {
        sqlx::query("UPDATE services SET spec=jsonb_set(spec,'{workload}',$1)")
            .bind(workload)
            .execute(&pool)
            .await
            .unwrap();
        let value = policy(
            &pool,
            service,
            json!({"operationId":Uuid::new_v4(),"expectedVersion":1,"policy":{"enabled":true}}),
        )
        .await;
        assert_eq!(value.0, StatusCode::CONFLICT, "{}", value.1);
    }
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn idle_service_sleeps_and_http_request_wakes_without_routing_candidates(pool: PgPool) {
    let (service, _, _) = active(&pool).await;
    enable(&pool, service, 0).await;
    observe(&pool, 0.0).await;
    sqlx::query("INSERT INTO preview_routes(authority,service_id) VALUES('sleep.test',$1) ON CONFLICT(service_id) DO UPDATE SET authority='sleep.test'").bind(service).execute(&pool).await.unwrap();
    sqlx::query(
        "UPDATE scaling_policies SET ingress_seen_at=now(),last_request_at=now()-interval '1 hour'",
    )
    .execute(&pool)
    .await
    .unwrap();
    reconcile(&pool).await;
    elapsed(&pool).await;
    reconcile(&pool).await;
    assert_eq!(desired(&pool).await, 0);
    cleanup(&pool).await;
    elapsed(&pool).await;
    reconcile(&pool).await;
    assert_eq!(
        desired(&pool).await,
        0,
        "old requests must not immediately wake an idle service"
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let ingress_pool = pool.clone();
    let ingress = tokio::spawn(async move {
        control_plane::preview::serve(ingress_pool, listener)
            .await
            .unwrap();
    });
    let client = reqwest::Client::new();
    let mut requested = false;
    for _ in 0..30 {
        let response = client
            .get(format!("http://{address}/"))
            .header("host", "sleep.test")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(response.headers().get("retry-after").unwrap(), "5");
        requested = sqlx::query_scalar("SELECT wake_requested FROM scaling_policies")
            .fetch_one(&pool)
            .await
            .unwrap();
        if requested {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert!(requested);
    let page = client
        .get(format!("http://{address}/account?tab=billing"))
        .header("host", "sleep.test")
        .header("accept", "text/html")
        .send()
        .await
        .unwrap();
    assert_eq!(page.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(page.headers()["cache-control"], "no-store");
    assert!(page.text().await.unwrap().contains("Waking up service"));
    let probe = client
        .head(format!("http://{address}/account?tab=billing"))
        .header("host", "sleep.test")
        .header("x-local-paas-wake-check", "1")
        .send()
        .await
        .unwrap();
    assert_eq!(probe.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(probe.headers()["x-local-paas-wake-status"], "waiting");
    elapsed(&pool).await;
    reconcile(&pool).await;
    assert_eq!(desired(&pool).await, 1);
    assert_eq!(condition(&pool).await, "waking");
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM instances WHERE desired_state='running' AND routing_enabled"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
    observe(&pool, 0.0).await;
    reconcile(&pool).await;
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM instances WHERE desired_state='running' AND routing_enabled"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        1
    );
    ingress.abort();
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn jobs_and_private_connections_block_unsafe_changes(pool: PgPool) {
    let (service, deployment, _) = active(&pool).await;
    let revision: Uuid = sqlx::query_scalar("SELECT revision_id FROM deployments WHERE id=$1")
        .bind(deployment)
        .fetch_one(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE nodes SET capabilities=ARRAY['jobs-v1']")
        .execute(&pool)
        .await
        .unwrap();
    let job = call(&pool,&format!("/api/services/{service}/jobs"),json!({"operationId":Uuid::new_v4(),"revisionId":revision,"options":{"command":[],"timeoutSeconds":60}}),None).await;
    assert_eq!(job.0, StatusCode::OK, "{}", job.1);
    let attempt = policy(
        &pool,
        service,
        json!({"operationId":Uuid::new_v4(),"expectedVersion":0,"policy":{"enabled":true}}),
    )
    .await;
    assert_eq!(attempt.0, StatusCode::CONFLICT);
    sqlx::query("UPDATE deployments SET status='cancelled' WHERE job_options IS NOT NULL")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE instances SET state='stopped',desired_state='stopped' WHERE deployment_id IN(SELECT id FROM deployments WHERE job_options IS NOT NULL)").execute(&pool).await.unwrap();
    let target = service.to_string();
    sqlx::query("UPDATE services SET spec=jsonb_set(spec,'{workload,privateConnections}',$1)")
        .bind(json!([{"serviceId":target,"env":"SELF_URL"}]))
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(policy(&pool,service,json!({"operationId":Uuid::new_v4(),"expectedVersion":0,"policy":{"enabled":true,"minReplicas":0}})).await.0,StatusCode::CONFLICT);
    sqlx::query("UPDATE services SET spec=spec #- '{workload,privateConnections}'")
        .execute(&pool)
        .await
        .unwrap();
    enable(&pool, service, 0).await;
    let mut spec: Value = sqlx::query_scalar("SELECT spec FROM services WHERE id=$1")
        .bind(service)
        .fetch_one(&pool)
        .await
        .unwrap();
    spec["workload"]["privateConnections"] = json!([{"serviceId":target,"env":"SELF_URL"}]);
    let response = control_plane::router(pool.clone(), vec![])
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/services/{service}"))
                .header("host", "localhost:8080")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"operationId":Uuid::new_v4(),"expectedVersion":1,"spec":spec})
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn physical_domain_preference_and_stale_reservations_are_preserved(pool: PgPool) {
    let (service, _, nodes) = active(&pool).await;
    enable(&pool, service, 1).await;
    sqlx::query("UPDATE nodes SET failure_domain=CASE WHEN id=$1 THEN 'host-b' ELSE 'host-a' END")
        .bind(nodes[2])
        .execute(&pool)
        .await
        .unwrap();
    observe(&pool, 500.0).await;
    reconcile(&pool).await;
    elapsed(&pool).await;
    reconcile(&pool).await;
    assert_eq!(
        sqlx::query_scalar::<_, Uuid>(
            "SELECT node_id FROM instances WHERE scaling_deadline IS NOT NULL"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        nodes[2]
    );
    // A failed/terminating instance still owns its slot and budget until cleanup.
    sqlx::query("UPDATE instances SET state='failed' WHERE scaling_deadline IS NOT NULL")
        .execute(&pool)
        .await
        .unwrap();
    reconcile(&pool).await;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM instances WHERE state<>'stopped'")
            .fetch_one(&pool)
            .await
            .unwrap(),
        2
    );
    elapsed(&pool).await;
    reconcile(&pool).await;
    assert_eq!(condition(&pool).await, "rollout_job_or_cleanup_pending");
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn open_http_stream_refreshes_idle_activity(pool: PgPool) {
    use futures_util::StreamExt;
    let (service, _, _) = active(&pool).await;
    observe(&pool, 0.0).await;
    sqlx::query("INSERT INTO preview_routes(authority,service_id) VALUES('stream.test',$1) ON CONFLICT(service_id) DO UPDATE SET authority='stream.test'").bind(service).execute(&pool).await.unwrap();
    let backend_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = i32::from(backend_listener.local_addr().unwrap().port());
    sqlx::query("UPDATE nodes SET endpoint_base=$1-(SELECT slot FROM instances WHERE node_id=nodes.id LIMIT 1) WHERE id IN(SELECT node_id FROM instances)").bind(port).execute(&pool).await.unwrap();
    let backend = tokio::spawn(async move {
        axum::serve(
            backend_listener,
            axum::Router::new()
                .route("/health", axum::routing::get(|| async { "ready" }))
                .route(
                    "/",
                    axum::routing::get(|| async {
                        let stream =
                            futures_util::stream::once(async { Ok::<_, std::io::Error>("open\n") })
                                .chain(futures_util::stream::pending());
                        axum::response::Response::new(Body::from_stream(stream))
                    }),
                ),
        )
        .await
        .unwrap();
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let ingress_pool = pool.clone();
    let ingress = tokio::spawn(async move {
        control_plane::preview::serve(ingress_pool, listener)
            .await
            .unwrap();
    });
    let client = reqwest::Client::new();
    let mut open = None;
    for _ in 0..30 {
        let response = client
            .get(format!("http://{address}/"))
            .header("host", "stream.test")
            .send()
            .await
            .unwrap();
        if response.status().is_success() {
            open = Some(response);
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert!(open.is_some());
    enable(&pool, service, 0).await;
    sqlx::query("UPDATE scaling_policies SET last_request_at=now()-interval '1 hour'")
        .execute(&pool)
        .await
        .unwrap();
    let mut refreshed = false;
    for _ in 0..40 {
        refreshed = sqlx::query_scalar(
            "SELECT last_request_at>now()-interval '10 seconds' FROM scaling_policies",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        if refreshed {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert!(
        refreshed,
        "open response streams must continually prevent idle sleep"
    );
    elapsed(&pool).await;
    sqlx::query("UPDATE scaling_policies SET direction=-1")
        .execute(&pool)
        .await
        .unwrap();
    reconcile(&pool).await;
    assert_eq!(desired(&pool).await, 1);
    drop(open);
    ingress.abort();
    backend.abort();
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn relocation_overlap_does_not_inflate_desired_count(pool: PgPool) {
    let (service, _, nodes) = active(&pool).await;
    enable(&pool, service, 1).await;
    observe(&pool, 500.0).await;
    sqlx::query("UPDATE services SET relocation_enabled=true")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE nodes SET draining=true,cordoned=true WHERE id=$1")
        .bind(nodes[0])
        .execute(&pool)
        .await
        .unwrap();
    reconcile(&pool).await;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM relocations")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
    elapsed(&pool).await;
    reconcile(&pool).await;
    assert_eq!(desired(&pool).await, 1);
    assert_eq!(condition(&pool).await, "rollout_job_or_cleanup_pending");
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn unavailable_ingress_and_operator_pause_freeze_sleep(pool: PgPool) {
    let (service, _, _) = active(&pool).await;
    enable(&pool, service, 0).await;
    observe(&pool, 0.0).await;
    sqlx::query("UPDATE scaling_policies SET last_request_at=now()-interval '1 hour',direction=-1,stable_since=now()-interval '1 hour'").execute(&pool).await.unwrap();
    reconcile(&pool).await;
    assert_eq!(desired(&pool).await, 1);
    assert_eq!(condition(&pool).await, "ingress_unavailable");
    sqlx::query("UPDATE scaling_limits SET enabled=false")
        .execute(&pool)
        .await
        .unwrap();
    elapsed(&pool).await;
    reconcile(&pool).await;
    assert_eq!(desired(&pool).await, 1);
    assert_eq!(condition(&pool).await, "disabled");
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn autoscaling_never_uses_another_organizations_nodes(pool: PgPool) {
    let (service, _, nodes) = active(&pool).await;
    let response=policy(&pool,service,json!({"operationId":Uuid::new_v4(),"expectedVersion":0,"policy":{"enabled":true,"nodeNames":["node-2"]}})).await;
    assert_eq!(response.0, StatusCode::OK);
    sqlx::query("UPDATE nodes SET organization_id='another-organization' WHERE id=$1")
        .bind(nodes[2])
        .execute(&pool)
        .await
        .unwrap();
    observe(&pool, 500.0).await;
    reconcile(&pool).await;
    elapsed(&pool).await;
    reconcile(&pool).await;
    assert_eq!(desired(&pool).await, 1);
    assert_eq!(condition(&pool).await, "capacity_exhausted");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM instances WHERE node_id=$1")
            .bind(nodes[2])
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}
