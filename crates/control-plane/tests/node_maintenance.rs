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
    let (_, s) = call(
        pool,
        "/api/services",
        json!({"build_on_create":false,"operation_id":Uuid::new_v4(),"spec":spec}),
        None,
    )
    .await;
    let service = s["id"].as_str().unwrap().parse::<Uuid>().unwrap();
    call(
        pool,
        &format!("/api/services/{service}/builds"),
        json!({"operation_id":Uuid::new_v4(),"no_cache":false}),
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
        json!({"operation_id":Uuid::new_v4(),"revision_id":revision}),
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
async fn action(pool: &PgPool, node: Uuid, action: &str) {
    assert_eq!(
        call(
            pool,
            &format!("/api/nodes/{node}/actions"),
            json!({"operation_id":Uuid::new_v4(),"action":action}),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
}
async fn enabled(pool: &PgPool, service: Uuid) {
    sqlx::query("UPDATE services SET relocation_enabled=true WHERE id=$1")
        .bind(service)
        .execute(pool)
        .await
        .unwrap();
}
async fn count(pool: &PgPool) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM relocations")
        .fetch_one(pool)
        .await
        .unwrap()
}
#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn drain_waits_for_opt_in_readiness_and_route_expiry_then_keeps_slot_until_cleanup(
    pool: PgPool,
) {
    let (service, _, nodes) = active(&pool).await;
    action(&pool, nodes[0], "drain").await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(count(&pool).await, 0);
    enabled(&pool, service).await;
    let (a, b) = tokio::join!(
        control_plane::runtime::reconcile(&pool),
        control_plane::runtime::reconcile(&pool)
    );
    a.unwrap();
    b.unwrap();
    let (old, new): (Uuid, Uuid) =
        sqlx::query_as("SELECT old_instance,new_instance FROM relocations")
            .fetch_one(&pool)
            .await
            .unwrap();
    let target: Uuid = sqlx::query_scalar("SELECT node_id FROM instances WHERE id=$1")
        .bind(new)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(target, nodes[2]);
    assert_eq!(count(&pool).await, 1);
    let route: bool = sqlx::query_scalar("SELECT routing_enabled FROM instances WHERE id=$1")
        .bind(new)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!route);
    sqlx::query(
        "UPDATE instances SET state='ready',observed_at=now()-interval '40 seconds' WHERE id=$1",
    )
    .bind(new)
    .execute(&pool)
    .await
    .unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT state FROM relocations")
            .fetch_one(&pool)
            .await
            .unwrap(),
        "preparing"
    );
    sqlx::query("UPDATE instances SET observed_at=now() WHERE id=$1")
        .bind(new)
        .execute(&pool)
        .await
        .unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT desired_state FROM instances WHERE id=$1")
            .bind(old)
            .fetch_one(&pool)
            .await
            .unwrap(),
        "running"
    );
    assert!(
        !sqlx::query_scalar::<_, bool>("SELECT routing_enabled FROM instances WHERE id=$1")
            .bind(old)
            .fetch_one(&pool)
            .await
            .unwrap()
    );
    sqlx::query("UPDATE relocations SET drain_after=now()-interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    // A new controller connection resumes the persisted handoff.
    let url = pool.connect_options();
    let restarted = PgPool::connect_with((*url).clone()).await.unwrap();
    control_plane::runtime::reconcile(&restarted).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT desired_state FROM instances WHERE id=$1")
            .bind(old)
            .fetch_one(&pool)
            .await
            .unwrap(),
        "stopped"
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT state FROM instances WHERE id=$1")
            .bind(old)
            .fetch_one(&pool)
            .await
            .unwrap(),
        "ready"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT generation FROM instances WHERE id=$1")
            .bind(old)
            .fetch_one(&pool)
            .await
            .unwrap(),
        2
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM audit_log WHERE action LIKE 'relocation.%'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        3
    );
    restarted.close().await;
}
#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn disconnected_node_replacement_is_opt_in_and_failed_candidate_preserves_original(
    pool: PgPool,
) {
    let (service, _, nodes) = active(&pool).await;
    sqlx::query("UPDATE nodes SET last_seen=now()-interval '60 seconds' WHERE id=$1")
        .bind(nodes[0])
        .execute(&pool)
        .await
        .unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(count(&pool).await, 0);
    enabled(&pool, service).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    let (old, new): (Uuid, Uuid) = sqlx::query_as(
        "SELECT old_instance,new_instance FROM relocations WHERE reason='node_lost'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE instances SET state='failed',observed_at=now() WHERE id=$1")
        .bind(new)
        .execute(&pool)
        .await
        .unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert!(
        sqlx::query_scalar::<_, bool>(
            "SELECT desired_state='running' AND routing_enabled FROM instances WHERE id=$1"
        )
        .bind(old)
        .fetch_one(&pool)
        .await
        .unwrap()
    );
    for _ in 0..3 {
        control_plane::runtime::reconcile(&pool).await.unwrap();
    }
    assert_eq!(count(&pool).await, 1);
    action(&pool, nodes[0], "retry").await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(count(&pool).await, 1);
    sqlx::query("UPDATE instances SET state='stopped' WHERE id=$1")
        .bind(new)
        .execute(&pool)
        .await
        .unwrap();
    action(&pool, nodes[0], "retry").await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(count(&pool).await, 2);
}
#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn pinned_volumes_workers_and_jobs_never_relocate_even_with_policy_enabled(pool: PgPool) {
    let (service, deployment, nodes) = active(&pool).await;
    enabled(&pool, service).await;
    action(&pool, nodes[0], "drain").await;
    let original: Value = sqlx::query_scalar::<_, sqlx::types::Json<Value>>(
        "SELECT spec FROM deployments WHERE id=$1",
    )
    .bind(deployment)
    .fetch_one(&pool)
    .await
    .unwrap()
    .0;
    for workload in [
        json!({"kind":"postgres-service","database":"test","storage_gib":1}),
        json!({"kind":"redis-service","storage_gib":1}),
        json!({"kind":"rustfs-service","storage_gib":1}),
        {
            let mut w = original["workload"].clone();
            w["execution"] = json!("worker");
            w
        },
    ] {
        let mut spec = original.clone();
        spec["workload"] = workload;
        sqlx::query("UPDATE deployments SET spec=$2 WHERE id=$1")
            .bind(deployment)
            .bind(sqlx::types::Json(spec))
            .execute(&pool)
            .await
            .unwrap();
        control_plane::runtime::reconcile(&pool).await.unwrap();
        assert_eq!(count(&pool).await, 0);
    }
    let mut spec = original;
    spec["volume"] = json!({"id":Uuid::new_v4(),"mount_path":"/data","read_only":true});
    sqlx::query("UPDATE deployments SET spec=$2 WHERE id=$1")
        .bind(deployment)
        .bind(sqlx::types::Json(spec))
        .execute(&pool)
        .await
        .unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(count(&pool).await, 0);
}
#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn cordon_is_idempotent_and_no_capacity_never_stops_the_original(pool: PgPool) {
    let (service, _, nodes) = active(&pool).await;
    enabled(&pool, service).await;
    let path = format!("/api/nodes/{}/actions", nodes[2]);
    let op = Uuid::new_v4();
    let body = json!({"operation_id":op,"action":"cordon"});
    let a = call(&pool, &path, body.clone(), None).await;
    let b = call(&pool, &path, body, None).await;
    assert_eq!(a, b);
    assert_eq!(
        call(
            &pool,
            &path,
            json!({"operation_id":op,"action":"drain"}),
            None
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    action(&pool, nodes[0], "drain").await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(count(&pool).await, 0);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM instances WHERE desired_state='running'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        2
    );
    action(&pool, nodes[2], "uncordon").await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(count(&pool).await, 1);
}
#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn stopping_deployment_during_relocation_cannot_resurrect_any_instance(pool: PgPool) {
    let (service, deployment, nodes) = active(&pool).await;
    enabled(&pool, service).await;
    action(&pool, nodes[0], "drain").await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    call(
        &pool,
        &format!("/api/deployments/{deployment}/stop"),
        json!({}),
        None,
    )
    .await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM instances WHERE desired_state='running'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
}
#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn replacement_losing_readiness_during_drain_restores_old_route(pool: PgPool) {
    let (service, _, nodes) = active(&pool).await;
    enabled(&pool, service).await;
    action(&pool, nodes[0], "drain").await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    sqlx::query("UPDATE instances SET state='ready',observed_at=now() WHERE id IN(SELECT new_instance FROM relocations)").execute(&pool).await.unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    sqlx::query(
        "UPDATE instances SET state='starting' WHERE id IN(SELECT new_instance FROM relocations)",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE relocations SET drain_after=now()-interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert!(sqlx::query_scalar::<_,bool>("SELECT routing_enabled AND desired_state='running' FROM instances WHERE id=(SELECT old_instance FROM relocations)").fetch_one(&pool).await.unwrap());
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT state FROM relocations")
            .fetch_one(&pool)
            .await
            .unwrap(),
        "failed"
    );
}
