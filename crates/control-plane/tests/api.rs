use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

fn request_body() -> Value {
    json!({"operation_id":Uuid::new_v4(), "spec":serde_json::from_str::<Value>(include_str!("../../../examples/oci-service.json")).unwrap()})
}

async fn call(pool: &PgPool, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
    let response = control_plane::router(pool.clone(), vec!["http://localhost:5173".into()])
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("host", "localhost:8080")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}

// SQLx creates and drops a separate database for each test. These are opt-in
// so ordinary unit tests work without a database; CI runs them explicitly.
#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL: cargo test -p control-plane --test api -- --ignored"]
async fn registration_is_durable_and_audited(pool: PgPool) {
    let (status, service) = call(&pool, "POST", "/api/services", request_body()).await;
    assert_eq!(status, StatusCode::CREATED);
    let id = service["id"].as_str().unwrap();
    // A new Router observes persisted state, not process-local memory.
    let (status, stored) = call(&pool, "GET", &format!("/api/services/{id}"), Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(stored, service);
    let (_, events) = call(
        &pool,
        "GET",
        &format!("/api/services/{id}/events"),
        Value::Null,
    )
    .await;
    assert_eq!(events.as_array().unwrap().len(), 1);
    assert_eq!(events[0]["kind"], "service.registered");
    let (_, list) = call(&pool, "GET", "/api/services", Value::Null).await;
    assert_eq!(list["total"], 1);
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn concurrent_retries_have_one_effect(pool: PgPool) {
    let request = request_body();
    let (first, second) = tokio::join!(
        call(&pool, "POST", "/api/services", request.clone()),
        call(&pool, "POST", "/api/services", request)
    );
    assert!(matches!(
        (first.0, second.0),
        (StatusCode::CREATED, StatusCode::OK) | (StatusCode::OK, StatusCode::CREATED)
    ));
    assert_eq!(first.1, second.1);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM events")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn conflicting_retries_and_names_are_rejected(pool: PgPool) {
    let mut request = request_body();
    assert_eq!(
        call(&pool, "POST", "/api/services", request.clone())
            .await
            .0,
        StatusCode::CREATED
    );
    request["spec"]["resources"]["memory_mib"] = json!(1024);
    assert_eq!(
        call(&pool, "POST", "/api/services", request.clone())
            .await
            .0,
        StatusCode::CONFLICT
    );
    request["operation_id"] = json!(Uuid::new_v4());
    assert_eq!(
        call(&pool, "POST", "/api/services", request).await.0,
        StatusCode::CONFLICT
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM events")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn validation_prevents_all_writes(pool: PgPool) {
    let mut request = request_body();
    request["spec"]["source"]["commit"] = json!("main");
    let (status, error) = call(&pool, "POST", "/api/services", request).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(error["issues"][0]["field"], "source.commit");
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM projects")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn celld_stays_a_distinct_workload(pool: PgPool) {
    let request = json!({"operation_id":Uuid::new_v4(), "spec":serde_json::from_str::<Value>(include_str!("../../../examples/celld-service.json")).unwrap()});
    let (status, service) = call(&pool, "POST", "/api/services", request).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(service["spec"]["workload"]["kind"], "celld-service");
    assert!(service["spec"]["workload"].get("dockerfile").is_none());
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn browser_origins_and_unknown_services_are_rejected(pool: PgPool) {
    let response = control_plane::router(pool.clone(), vec!["http://localhost:5173".into()])
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/services")
                .header("host", "localhost:8080")
                .header("origin", "https://untrusted.example")
                .header("content-type", "application/json")
                .body(Body::from(request_body().to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let response = control_plane::router(pool.clone(), vec!["http://localhost:5188".into()])
        .oneshot(
            Request::builder()
                .uri("/api/services")
                .header("host", "rebound.example:8080")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        call(
            &pool,
            "GET",
            &format!("/api/services/{}", Uuid::new_v4()),
            Value::Null
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn event_failure_rolls_back_entire_registration(pool: PgPool) {
    sqlx::raw_sql("CREATE FUNCTION reject_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END; $$; CREATE TRIGGER reject_event BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION reject_event();")
        .execute(&pool).await.unwrap();
    let (status, _) = call(&pool, "POST", "/api/services", request_body()).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    let counts: (i64, i64, i64, i64) = sqlx::query_as("SELECT (SELECT count(*) FROM projects), (SELECT count(*) FROM environments), (SELECT count(*) FROM services), (SELECT count(*) FROM events)")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(counts, (0, 0, 0, 0));
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn tailnet_and_local_origins_work_without_allowing_other_origins(pool: PgPool) {
    let app = control_plane::router(
        pool,
        vec![
            "http://localhost:5188".into(),
            "https://lake.example.ts.net:5188".into(),
        ],
    );
    for (origin, expected) in [
        ("http://localhost:5188", StatusCode::OK),
        ("https://lake.example.ts.net:5188", StatusCode::OK),
        ("https://lake.example.ts.net:5189", StatusCode::FORBIDDEN),
        ("https://other.example.ts.net:5188", StatusCode::FORBIDDEN),
        ("null", StatusCode::FORBIDDEN),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/specs/validate")
                    .header("host", "127.0.0.1:8080")
                    .header("origin", origin)
                    .header("content-type", "application/json")
                    .body(Body::from(request_body()["spec"].to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected, "{origin}");
    }
}
