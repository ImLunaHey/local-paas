use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

async fn call(pool: &PgPool, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
    let response = control_plane::router(pool.clone(), vec![])
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
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
async fn service(pool: &PgPool, name: &str) -> Uuid {
    let mut spec: Value =
        serde_json::from_str(include_str!("../../../examples/oci-service.json")).unwrap();
    spec["name"] = json!(name);
    let (status, body) = call(
        pool,
        "POST",
        "/api/services",
        json!({"operationId":Uuid::new_v4(),"buildOnCreate":false,"spec":spec}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["id"].as_str().unwrap().parse().unwrap()
}
fn update(version: i32, html: Option<&str>) -> Value {
    json!({"operationId":Uuid::new_v4(),"expectedVersion":version,"html":html})
}
const CUSTOM: &str = "<!doctype html><html><head><style>body{color:orange}</style></head><body><h1>Custom {{service_name}}</h1><p data-waking-status>Every {{retry_after_seconds}} seconds</p>{{readiness_script}}</body></html>";

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn uploads_are_versioned_idempotent_bounded_and_audited_without_html(pool: PgPool) {
    let id = service(&pool, "custom-page").await;
    let path = format!("/api/services/{id}/waking-page");
    let (_, initial) = call(&pool, "GET", &path, Value::Null).await;
    assert_eq!(initial["version"], 0);
    assert_eq!(initial["html"], Value::Null);
    assert!(
        initial["starterTemplate"]
            .as_str()
            .unwrap()
            .contains("{{readiness_script}}")
    );
    let input = update(0, Some(CUSTOM));
    let (a, b) = tokio::join!(
        call(&pool, "PUT", &path, input.clone()),
        call(&pool, "PUT", &path, input.clone())
    );
    assert_eq!(a.0, StatusCode::OK);
    assert_eq!(b.0, StatusCode::OK);
    assert_eq!(a.1["version"], 1);
    let (_, persisted) = call(&pool, "GET", &path, Value::Null).await;
    assert_eq!(persisted["html"], CUSTOM);
    assert_eq!(
        call(&pool, "PUT", &path, update(0, Some(CUSTOM))).await.0,
        StatusCode::CONFLICT
    );
    let mut reused = input;
    reused["html"] = json!(CUSTOM.replace("Custom", "Different"));
    assert_eq!(
        call(&pool, "PUT", &path, reused).await.0,
        StatusCode::CONFLICT
    );
    for invalid in [
        "<h1>No injection</h1>".to_owned(),
        "{{readiness_script}}{{not_supported}}".into(),
        format!("{{{{readiness_script}}}}{}", "a".repeat(128 * 1024)),
    ] {
        assert_eq!(
            call(&pool, "PUT", &path, update(1, Some(&invalid))).await.0,
            StatusCode::CONFLICT
        );
    }
    let audits: Vec<Value> = sqlx::query_scalar(
        "SELECT details FROM audit_log WHERE action='service.waking_page.updated'",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(audits.len(), 1);
    assert!(!audits[0].to_string().contains("Custom"));
    assert_eq!(audits[0]["custom"], true);
    let restored = call(&pool, "PUT", &path, update(1, None)).await;
    assert_eq!(restored.0, StatusCode::OK);
    assert_eq!(restored.1["version"], 2);
    assert_eq!(restored.1["html"], Value::Null);
    assert_eq!(
        call(
            &pool,
            "GET",
            &format!("/api/services/{}/waking-page", Uuid::new_v4()),
            Value::Null
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn ingress_serves_the_services_template_and_observes_reset(pool: PgPool) {
    let custom = service(&pool, "custom-app").await;
    let default = service(&pool, "default-app").await;
    for (id, authority) in [(custom, "custom.test"), (default, "default.test")] {
        assert_eq!(call(&pool,"PUT",&format!("/api/services/{id}/scaling"),json!({"operationId":Uuid::new_v4(),"expectedVersion":0,"policy":{"enabled":true,"minReplicas":0}})).await.0,StatusCode::OK);
        sqlx::query("INSERT INTO preview_routes(authority,service_id) VALUES($1,$2) ON CONFLICT(service_id) DO UPDATE SET authority=EXCLUDED.authority").bind(authority).bind(id).execute(&pool).await.unwrap();
    }
    let path = format!("/api/services/{custom}/waking-page");
    assert_eq!(
        call(&pool, "PUT", &path, update(0, Some(CUSTOM))).await.0,
        StatusCode::OK
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
    let fetch = |authority: &'static str| {
        client
            .get(format!("http://{address}/original?query=kept"))
            .header("host", authority)
            .header("accept", "text/html")
            .send()
    };
    let mut html = String::new();
    for _ in 0..40 {
        let response = fetch("custom.test").await.unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        html = response.text().await.unwrap();
        if html.contains("Custom custom-app") {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert!(html.contains("Custom custom-app"), "{html}");
    assert!(html.contains("Every 5 seconds"));
    assert!(html.contains("X-Local-Paas-Wake-Check"));
    assert!(!html.contains("{{"));
    let response = fetch("default.test").await.unwrap();
    assert_eq!(response.headers()["cache-control"], "no-store");
    let html = response.text().await.unwrap();
    assert!(html.contains("Waking up service"));
    assert!(!html.contains("Custom custom-app"));
    let api = client
        .get(format!("http://{address}/api"))
        .header("host", "custom.test")
        .send()
        .await
        .unwrap();
    assert!(!api.text().await.unwrap().contains("Custom"));
    assert_eq!(
        call(&pool, "PUT", &path, update(1, None)).await.0,
        StatusCode::OK
    );
    let mut restored = false;
    for _ in 0..40 {
        let html = fetch("custom.test").await.unwrap().text().await.unwrap();
        if html.contains("Built for a smaller cloud.") {
            restored = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert!(restored);
    ingress.abort();
}
