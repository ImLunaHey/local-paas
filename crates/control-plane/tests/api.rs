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
    json!({"buildOnCreate":false,"operationId":Uuid::new_v4(), "spec":serde_json::from_str::<Value>(include_str!("../../../examples/oci-service.json")).unwrap()})
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
    assert!(events[0]["createdAt"].as_str().is_some());
    assert!(events[0].get("created_at").is_none());
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
    request["spec"]["resources"]["memoryMib"] = json!(1024);
    assert_eq!(
        call(&pool, "POST", "/api/services", request.clone())
            .await
            .0,
        StatusCode::CONFLICT
    );
    request["operationId"] = json!(Uuid::new_v4());
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
    let request = json!({"buildOnCreate":false,"operationId":Uuid::new_v4(), "spec":serde_json::from_str::<Value>(include_str!("../../../examples/celld-service.json")).unwrap()});
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
            "https://platform.example.ts.net:5188".into(),
        ],
    );
    for (origin, expected) in [
        ("http://localhost:5188", StatusCode::OK),
        ("https://platform.example.ts.net:5188", StatusCode::OK),
        (
            "https://platform.example.ts.net:5189",
            StatusCode::FORBIDDEN,
        ),
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

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn configuration_updates_are_versioned_retry_safe_and_preserve_builds(pool: PgPool) {
    let registration = request_body();
    let (_, initial) = call(&pool, "POST", "/api/services", registration.clone()).await;
    let id = initial["id"].as_str().unwrap();
    let path = format!("/api/services/{id}");
    let build_request = json!({"operationId":Uuid::new_v4()});
    let (_, build) = call(
        &pool,
        "POST",
        &format!("{path}/builds"),
        build_request.clone(),
    )
    .await;
    let mut spec = initial["spec"].clone();
    spec["source"] =
        json!({"repository":"https://github.com/example/new.git","branch":"feature/config"});
    spec["resources"]["memoryMib"] = json!(1024);
    spec["name"] = json!("renamed-service");
    let update = json!({"operationId":Uuid::new_v4(),"expectedVersion":1,"spec":spec});
    let (a, b) = tokio::join!(
        call(&pool, "PUT", &path, update.clone()),
        call(&pool, "PUT", &path, update.clone())
    );
    assert_eq!(a.0, StatusCode::OK);
    assert_eq!(a, b);
    assert_eq!(a.1["version"], 2);
    assert_eq!(a.1["spec"], spec);
    let (_, stored) = call(&pool, "GET", &path, Value::Null).await;
    assert_eq!(stored, a.1);
    let retry = call(&pool, "POST", &format!("{path}/builds"), build_request).await;
    assert_eq!(retry.0, StatusCode::OK);
    assert_eq!(retry.1, build);
    assert_eq!(retry.1["spec"], initial["spec"]);
    // A stale editor must not overwrite the winning edit.
    let mut stale = update.clone();
    stale["operationId"] = json!(Uuid::new_v4());
    assert_eq!(
        call(&pool, "PUT", &path, stale).await.0,
        StatusCode::CONFLICT
    );
    let mut second = update.clone();
    second["operationId"] = json!(Uuid::new_v4());
    second["expectedVersion"] = json!(2);
    second["spec"]["resources"]["memoryMib"] = json!(2048);
    assert_eq!(call(&pool, "PUT", &path, second).await.1["version"], 3);
    // A lost response can be retried even after another update has committed.
    assert_eq!(call(&pool, "PUT", &path, update.clone()).await, a);
    let mut conflicting = update;
    conflicting["spec"]["resources"]["memoryMib"] = json!(4096);
    assert_eq!(
        call(&pool, "PUT", &path, conflicting).await.0,
        StatusCode::CONFLICT
    );
    // Registration retries retain the original request identity without undoing edits.
    let replay = call(&pool, "POST", "/api/services", registration).await;
    assert_eq!(replay.0, StatusCode::OK);
    assert_eq!(replay.1["version"], 3);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM events WHERE kind='service.updated'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 2);
    call(
        &pool,
        "POST",
        &format!("/api/builds/{}/cancel", build["id"].as_str().unwrap()),
        Value::Null,
    )
    .await;
    let (_, next) = call(
        &pool,
        "POST",
        &format!("{path}/builds"),
        json!({"operationId":Uuid::new_v4()}),
    )
    .await;
    assert_eq!(next["spec"]["source"]["branch"], "feature/config");
    assert_eq!(next["spec"]["resources"]["memoryMib"], 2048);
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn invalid_or_unauditable_updates_leave_configuration_unchanged(pool: PgPool) {
    let (_, initial) = call(&pool, "POST", "/api/services", request_body()).await;
    let path = format!("/api/services/{}", initial["id"].as_str().unwrap());
    let mut update =
        json!({"operationId":Uuid::new_v4(),"expectedVersion":1,"spec":initial["spec"]});
    update["spec"]["workload"]["dockerfile"] = json!("../Dockerfile");
    assert_eq!(
        call(&pool, "PUT", &path, update.clone()).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    update["spec"] =
        serde_json::from_str::<Value>(include_str!("../../../examples/celld-service.json"))
            .unwrap();
    assert_eq!(
        call(&pool, "PUT", &path, update.clone()).await.0,
        StatusCode::CONFLICT
    );
    update["spec"] = initial["spec"].clone();
    update["spec"]["resources"]["memoryMib"] = json!(2048);
    sqlx::query(
        "ALTER TABLE events ADD CONSTRAINT reject_updates CHECK (kind != 'service.updated')",
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        call(&pool, "PUT", &path, update).await.0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(call(&pool, "GET", &path, Value::Null).await.1, initial);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM service_updates")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn environments_are_explicit_filtered_and_service_identity_cannot_move(pool: PgPool) {
    let a = call(
        &pool,
        "POST",
        "/api/environments",
        json!({"project":"personal","name":"staging"}),
    )
    .await;
    let b = call(
        &pool,
        "POST",
        "/api/environments",
        json!({"project":"personal","name":"staging"}),
    )
    .await;
    assert_eq!(a, b);
    assert_eq!(a.0, StatusCode::OK);
    let (_, service) = call(&pool, "POST", "/api/services", request_body()).await;
    let (_, page) = call(
        &pool,
        "GET",
        "/api/services?environment=staging",
        Value::Null,
    )
    .await;
    assert_eq!(page["total"], 0);
    let (_, all) = call(&pool, "GET", "/api/services", Value::Null).await;
    assert_eq!(all["total"], 1);
    let id = service["id"].as_str().unwrap();
    let mut spec = service["spec"].clone();
    spec["environment"] = json!("staging");
    assert_eq!(
        call(
            &pool,
            "PUT",
            &format!("/api/services/{id}"),
            json!({"operationId":Uuid::new_v4(),"expectedVersion":1,"spec":spec})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let (_, envs) = call(&pool, "GET", "/api/environments", Value::Null).await;
    assert!(
        envs["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["name"] == "staging")
    );
    let (_, net) = call(
        &pool,
        "GET",
        &format!("/api/services/{id}/networking"),
        Value::Null,
    )
    .await;
    assert!(net["authority"].is_null());
    assert_eq!(
        call(
            &pool,
            "PUT",
            &format!("/api/services/{id}/networking"),
            json!({"authority":"unconfigured.example:5555","port":3000,"expectedVersion":1})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(
            &pool,
            "PUT",
            &format!("/api/services/{id}/networking"),
            json!({"authority":null,"port":4000,"expectedVersion":1})
        )
        .await
        .0,
        StatusCode::OK
    );
    let (_, saved) = call(&pool, "GET", &format!("/api/services/{id}"), Value::Null).await;
    assert_eq!(saved["spec"]["workload"]["port"], 4000);
    assert_eq!(
        call(
            &pool,
            "PUT",
            &format!("/api/services/{id}/networking"),
            json!({"authority":null,"port":5000,"expectedVersion":1})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn registration_queues_first_build_atomically_and_retries_do_not_duplicate(pool: PgPool) {
    let mut body = request_body();
    body.as_object_mut().unwrap().remove("buildOnCreate");
    let (first, second) = tokio::join!(
        call(&pool, "POST", "/api/services", body.clone()),
        call(&pool, "POST", "/api/services", body.clone())
    );
    assert_eq!(first.1["id"], second.1["id"]);
    assert!([first.0, second.0].contains(&StatusCode::CREATED));
    let service: Uuid = first.1["id"].as_str().unwrap().parse().unwrap();
    let builds: i64 =
        sqlx::query_scalar("SELECT count(*) FROM builds WHERE service_id=$1 AND status='queued'")
            .bind(service)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(builds, 1);
    let events: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM events WHERE service_id=$1 AND kind='build.queued'",
    )
    .bind(service)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(events, 1);
    sqlx::query("ALTER TABLE builds ADD CONSTRAINT reject_initial_build CHECK (false) NOT VALID")
        .execute(&pool)
        .await
        .unwrap();
    body["operationId"] = json!(Uuid::new_v4());
    body["spec"]["name"] = json!("failed-registration");
    assert_eq!(
        call(&pool, "POST", "/api/services", body).await.0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM services WHERE name='failed-registration')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!exists);
}
