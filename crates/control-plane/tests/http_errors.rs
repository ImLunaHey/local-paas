use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use tower::ServiceExt;

#[tokio::test]
async fn framework_rejections_are_coded_and_never_echo_submitted_data() {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://localhost/unused_test")
        .unwrap();
    for (method, path, body, expected, code) in [
        (
            "POST",
            "/api/specs/validate",
            "{not-json-sensitive-value",
            400,
            "invalid_request",
        ),
        (
            "POST",
            "/api/specs/validate",
            r#"{"schema_version":1,"secret":"sensitive-value"}"#,
            422,
            "validation_failed",
        ),
        (
            "GET",
            "/api/services?offset=sensitive-value",
            "",
            400,
            "invalid_request",
        ),
        (
            "GET",
            "/api/services/sensitive-value",
            "",
            400,
            "invalid_request",
        ),
        ("GET", "/api/does-not-exist", "", 404, "not_found"),
    ] {
        let response = control_plane::router(pool.clone(), vec![])
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header("host", "localhost")
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), expected);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["code"], code);
        assert!(!String::from_utf8_lossy(&bytes).contains("sensitive-value"));
    }
}
