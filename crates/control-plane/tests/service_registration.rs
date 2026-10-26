use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use control_plane::auth;
use http_body_util::BodyExt;
use lucid_auth::NewPasswordUser;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

async fn sign_in(runtime: &auth::Runtime, username: &str) -> (String, String) {
    let user = runtime
        .service
        .provision_password_user(NewPasswordUser {
            username: username.into(),
            name: username.into(),
            email: None,
            password: "disposable-test-password-only".into(),
            role: "user".into(),
        })
        .await
        .unwrap();
    let login = runtime
        .service
        .sign_in_username(username, "disposable-test-password-only".into(), None, None)
        .await
        .unwrap();
    let cookie = format!(
        "better-auth.session_token={}",
        runtime
            .service
            .signed_cookie_value(&login.session.session.token)
    );
    (user.id, cookie)
}

async fn request(
    pool: &PgPool,
    runtime: &auth::Runtime,
    cookie: &str,
    method: &str,
    path: &str,
    body: Value,
) -> (StatusCode, Value) {
    let response = control_plane::authenticated_router(
        pool.clone(),
        vec!["http://localhost:5188".into()],
        runtime.service.clone(),
    )
    .oneshot(
        Request::builder()
            .method(method)
            .uri(path)
            .header("host", "localhost:8080")
            .header("content-type", "application/json")
            .header("origin", "http://localhost:5188")
            .header("cookie", cookie)
            .body(Body::from(body.to_string()))
            .unwrap(),
    )
    .await
    .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}

async fn create_organization(
    pool: &PgPool,
    runtime: &auth::Runtime,
    cookie: &str,
    slug: &str,
) -> String {
    let (status, organization) = request(
        pool,
        runtime,
        cookie,
        "POST",
        "/api/auth/organization/create",
        json!({"name":slug,"slug":slug}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{organization}");
    let id = organization["id"].as_str().unwrap();
    let (status, selected) = request(
        pool,
        runtime,
        cookie,
        "POST",
        "/api/auth/organization/set-active",
        json!({"organizationId":id}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{selected}");
    id.into()
}

async fn cross_organization_replay(pool: PgPool, separate_user: bool) {
    let runtime = auth::build(
        pool.clone(),
        vec![9; 32],
        "http://localhost:5188",
        &["http://localhost:5188".into()],
    )
    .unwrap();
    auth::migrate(&runtime).await.unwrap();
    let (owner, owner_cookie) = sign_in(&runtime, "owner").await;
    let original_organization =
        create_organization(&pool, &runtime, &owner_cookie, "original-org").await;
    let input = json!({
        "operationId": Uuid::new_v4(),
        "spec": serde_json::from_str::<Value>(include_str!("../../../examples/oci-service.json")).unwrap(),
        "buildOnCreate": false
    });
    let (status, service) = request(
        &pool,
        &runtime,
        &owner_cookie,
        "POST",
        "/api/services",
        input.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{service}");
    assert_eq!(
        request(
            &pool,
            &runtime,
            &owner_cookie,
            "POST",
            "/api/services",
            input.clone()
        )
        .await,
        (StatusCode::OK, service.clone())
    );
    let mut conflicting = input.clone();
    conflicting["spec"]["resources"]["memoryMib"] = json!(1024);
    assert_eq!(
        request(
            &pool,
            &runtime,
            &owner_cookie,
            "POST",
            "/api/services",
            conflicting.clone()
        )
        .await
        .0,
        StatusCode::CONFLICT
    );

    let (caller, cookie) = if separate_user {
        sign_in(&runtime, "other_user").await
    } else {
        (owner, owner_cookie)
    };
    create_organization(&pool, &runtime, &cookie, "other-org").await;
    let membership: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM member WHERE \"userId\"=$1 AND \"organizationId\"=$2)",
    )
    .bind(&caller)
    .bind(&original_organization)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(membership, !separate_user);
    let path = format!("/api/services/{}", service["id"].as_str().unwrap());
    assert_eq!(
        request(&pool, &runtime, &cookie, "GET", &path, Value::Null)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    // Both matching and conflicting specs must hide the foreign operation.
    for body in [input, conflicting] {
        let (status, replay) =
            request(&pool, &runtime, &cookie, "POST", "/api/services", body).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{replay}");
        assert_eq!(
            replay,
            json!({"error":"service not found","code":"not_found"})
        );
    }
    let (_, services) = request(
        &pool,
        &runtime,
        &cookie,
        "GET",
        "/api/services",
        Value::Null,
    )
    .await;
    assert_eq!(services["total"], 0);
    let counts: (i64, i64, i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM services), (SELECT count(*) FROM projects), \
         (SELECT count(*) FROM events), (SELECT count(*) FROM builds)",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(counts, (1, 1, 1, 0));
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn registration_retry_is_scoped_to_the_active_organization(pool: PgPool) {
    cross_organization_replay(pool, false).await;
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn registration_retry_cannot_reveal_a_nonmembers_service(pool: PgPool) {
    cross_organization_replay(pool, true).await;
}
