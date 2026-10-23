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
        json!({"operation_id":Uuid::new_v4(),"spec":spec}),
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
#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn deployments_spread_deduplicate_and_preserve_active_revision_on_failure(pool: PgPool) {
    let (service, revision, _) = fixture(&pool).await;
    let path = format!("/api/services/{service}/deployments");
    let req = json!({"operation_id":Uuid::new_v4(),"revision_id":revision});
    let (a, b) = tokio::join!(
        call(&pool, &path, req.clone(), None),
        call(&pool, &path, req, None)
    );
    assert_eq!(a.0, StatusCode::OK);
    assert_eq!(a, b);
    let id = a.1["id"].as_str().unwrap().parse::<Uuid>().unwrap();
    let nodes: i64 =
        sqlx::query_scalar("SELECT count(DISTINCT node_id) FROM instances WHERE deployment_id=$1")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(nodes, 2);
    control_plane::runtime::reconcile(&pool).await.unwrap();
    let status: String = sqlx::query_scalar("SELECT status FROM deployments WHERE id=$1")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "preparing");
    sqlx::query("UPDATE instances SET state='ready',observed_at=now() WHERE deployment_id=$1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    let (_, next) = call(
        &pool,
        &path,
        json!({"operation_id":Uuid::new_v4(),"revision_id":revision}),
        None,
    )
    .await;
    let next = next["id"].as_str().unwrap().parse::<Uuid>().unwrap();
    sqlx::query("UPDATE instances SET state='failed' WHERE deployment_id=$1")
        .bind(next)
        .execute(&pool)
        .await
        .unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    let active: Uuid = sqlx::query_scalar("SELECT id FROM deployments WHERE status='active'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(active, id);
    let failed: String = sqlx::query_scalar("SELECT status FROM deployments WHERE id=$1")
        .bind(next)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(failed, "failed");
    assert_eq!(
        call(
            &pool,
            &format!("/api/deployments/{id}/stop"),
            json!({}),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let generations: Vec<i64> =
        sqlx::query_scalar("SELECT generation FROM instances WHERE deployment_id=$1")
            .bind(id)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(generations, vec![2, 2]);
    call(
        &pool,
        &format!("/api/deployments/{id}/stop"),
        json!({}),
        None,
    )
    .await;
    let generations: Vec<i64> =
        sqlx::query_scalar("SELECT generation FROM instances WHERE deployment_id=$1")
            .bind(id)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(generations, vec![2, 2]);
}
#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn node_identity_and_generations_fence_observations(pool: PgPool) {
    let (service, revision, nodes) = fixture(&pool).await;
    call(
        &pool,
        &format!("/api/services/{service}/deployments"),
        json!({"operation_id":Uuid::new_v4(),"revision_id":revision}),
        None,
    )
    .await;
    let request = json!({"version":1,"node_id":nodes[0],"observations":[]});
    assert_eq!(
        call(&pool, "/api/agent/sync", request.clone(), None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(
            &pool,
            "/api/agent/sync",
            request.clone(),
            Some(&"b".repeat(64))
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let (_, r) = call(&pool, "/api/agent/sync", request, Some(&"a".repeat(64))).await;
    let id = r["assignments"][0]["instance_id"]
        .as_str()
        .unwrap()
        .parse::<Uuid>()
        .unwrap();
    let observation = json!({"observed_unix_ms":chrono::Utc::now().timestamp_millis(),"instance_id":id,"generation":0,"state":"ready","diagnostic":null,"metrics":null,"logs":[]});
    call(
        &pool,
        "/api/agent/sync",
        json!({"version":1,"node_id":nodes[0],"observations":[observation]}),
        Some(&"a".repeat(64)),
    )
    .await;
    let state: String = sqlx::query_scalar("SELECT state FROM instances WHERE id=$1")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(state, "assigned");
    let log = json!({"key":"c".repeat(64),"timestamp":"2026-10-23T20:00:00Z","stream":"stdout","line":"hello\n"});
    let observation = json!({"observed_unix_ms":chrono::Utc::now().timestamp_millis(),"instance_id":id,"generation":1,"state":"ready","diagnostic":null,"metrics":{"cpu_millis":12.0,"memory_bytes":4096,"pids":3},"logs":[log]});
    let req = json!({"version":1,"node_id":nodes[0],"observations":[observation]});
    for _ in 0..2 {
        assert_eq!(
            call(&pool, "/api/agent/sync", req.clone(), Some(&"a".repeat(64)))
                .await
                .0,
            StatusCode::OK
        );
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM runtime_logs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
    let metrics: i64 = sqlx::query_scalar("SELECT count(*) FROM runtime_metrics")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        metrics, 1,
        "a repeated heartbeat must not create a fresh sample"
    );
    let state: String = sqlx::query_scalar("SELECT state FROM instances WHERE id=$1")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(state, "ready");
}
