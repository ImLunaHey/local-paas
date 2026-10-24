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
#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL and loopback HTTP listeners"]
async fn ingress_uses_local_health_honors_membership_and_expires_routes_without_database(
    pool: PgPool,
) {
    use axum::{Router, routing::get};
    use std::{
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        },
        time::Duration,
    };
    let (service, revision, nodes) = fixture(&pool).await;
    let healthy = Arc::new(AtomicBool::new(true));
    let health = healthy.clone();
    let app_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let app_port = app_listener.local_addr().unwrap().port();
    let app = tokio::spawn(async move {
        axum::serve(
            app_listener,
            Router::new().route(
                "/{*path}",
                get(move || {
                    let health = health.clone();
                    async move {
                        if health.load(Ordering::Relaxed) {
                            StatusCode::OK
                        } else {
                            StatusCode::SERVICE_UNAVAILABLE
                        }
                    }
                }),
            ),
        )
        .await
        .unwrap();
    });
    sqlx::query("UPDATE nodes SET endpoint_base=$2 WHERE id=$1")
        .bind(nodes[0])
        .bind(i32::from(app_port))
        .execute(&pool)
        .await
        .unwrap();
    let (_, deployed) = call(
        &pool,
        &format!("/api/services/{service}/deployments"),
        json!({"operation_id":Uuid::new_v4(),"revision_id":revision}),
        None,
    )
    .await;
    assert!(deployed["id"].is_string());
    sqlx::query("UPDATE instances SET state='ready',observed_at=now()")
        .execute(&pool)
        .await
        .unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    sqlx::query("INSERT INTO domains(hostname,service_id) VALUES('canary.test',$1)")
        .bind(service)
        .execute(&pool)
        .await
        .unwrap();
    let ingress_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = ingress_listener.local_addr().unwrap().port();
    let ingress_pool = pool.clone();
    let ingress = tokio::spawn(async move {
        control_plane::preview::serve(ingress_pool, ingress_listener)
            .await
            .unwrap();
    });
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap();
    async fn wait(client: &reqwest::Client, port: u16, status: StatusCode) {
        for _ in 0..60 {
            if client
                .get(format!("http://127.0.0.1:{port}/hello"))
                .header("host", "canary.test")
                .send()
                .await
                .unwrap()
                .status()
                == status
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        panic!("ingress did not converge to {status}");
    }
    wait(&client, port, StatusCode::OK).await;
    // Controller/agent observations expire, but desired topology and local health still work.
    sqlx::query("UPDATE nodes SET last_seen=now()-interval '5 minutes'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE instances SET observed_at=now()-interval '5 minutes'")
        .execute(&pool)
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_secs(3)).await;
    wait(&client, port, StatusCode::OK).await;
    healthy.store(false, Ordering::Relaxed);
    wait(&client, port, StatusCode::SERVICE_UNAVAILABLE).await;
    healthy.store(true, Ordering::Relaxed);
    wait(&client, port, StatusCode::OK).await;
    sqlx::query("UPDATE instances SET routing_enabled=false")
        .execute(&pool)
        .await
        .unwrap();
    wait(&client, port, StatusCode::SERVICE_UNAVAILABLE).await;
    sqlx::query("UPDATE instances SET routing_enabled=true")
        .execute(&pool)
        .await
        .unwrap();
    wait(&client, port, StatusCode::OK).await;
    // Block snapshot refresh while the HTTP server remains healthy: old routes must expire.
    let mut blocker = pool.begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(712184551)")
        .execute(&mut *blocker)
        .await
        .unwrap();
    wait(&client, port, StatusCode::SERVICE_UNAVAILABLE).await;
    blocker.rollback().await.unwrap();
    wait(&client, port, StatusCode::OK).await;
    // Cleanup acknowledgement cannot make a still-leased slot immediately reusable.
    sqlx::query("UPDATE instances SET state='stopped',desired_state='stopped' WHERE node_id=$1")
        .bind(nodes[0])
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE nodes SET last_seen=now()")
        .execute(&pool)
        .await
        .unwrap();
    let (_, next) = call(
        &pool,
        &format!("/api/services/{service}/deployments"),
        json!({"operation_id":Uuid::new_v4(),"revision_id":revision}),
        None,
    )
    .await;
    let next: Uuid = next["id"].as_str().unwrap().parse().unwrap();
    assert!(!sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM instances WHERE deployment_id=$1 AND node_id=$2 AND slot=0)").bind(next).bind(nodes[0]).fetch_one(&pool).await.unwrap());
    ingress.abort();
    app.abort();
}
