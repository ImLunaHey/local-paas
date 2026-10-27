use axum::{body::Body, http::Request};
use control_plane::auth;
use http_body_util::BodyExt;
use lucid_auth::{NewOrganization, NewPasswordUser};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

async fn fixture(pool: &PgPool) -> (auth::Runtime, String, String, String) {
    let runtime = auth::build(
        pool.clone(),
        vec![9; 32],
        "http://localhost:5188",
        &["http://localhost:5188".into()],
    )
    .unwrap();
    auth::migrate(&runtime).await.unwrap();
    let user = runtime
        .service
        .provision_password_user(NewPasswordUser {
            username: "roletester".into(),
            name: "Role test".into(),
            email: None,
            password: "disposable-test-password-only".into(),
            role: "user".into(),
        })
        .await
        .unwrap();
    let login = runtime
        .service
        .sign_in_username(
            "roletester",
            "disposable-test-password-only".into(),
            None,
            None,
        )
        .await
        .unwrap();
    let organization = runtime
        .service
        .create_organization(
            &login.session,
            NewOrganization {
                name: "Role tests".into(),
                slug: "role-tests".into(),
                logo: None,
                metadata: None,
                keep_current_active_organization: false,
            },
        )
        .await
        .unwrap();
    let cookie = format!(
        "better-auth.session_token={}",
        runtime
            .service
            .signed_cookie_value(&login.session.session.token)
    );
    let selected = request(
        pool,
        &runtime,
        &cookie,
        "POST",
        "/api/auth/organization/set-active",
        json!({"organizationId":organization.organization.id}),
    )
    .await;
    assert_eq!(selected.0, 200, "could not select test organization");
    (runtime, cookie, user.id, organization.organization.id)
}

async fn request(
    pool: &PgPool,
    runtime: &auth::Runtime,
    credential: &str,
    method: &str,
    path: &str,
    body: Value,
) -> (u16, Value) {
    let builder = Request::builder()
        .method(method)
        .uri(path)
        .header("host", "localhost:8080")
        .header("content-type", "application/json")
        .header("origin", "http://localhost:5188");
    let builder = builder.header("cookie", credential);
    let response = control_plane::authenticated_router(
        pool.clone(),
        vec!["http://localhost:5188".into()],
        runtime.service.clone(),
    )
    .oneshot(builder.body(Body::from(body.to_string())).unwrap())
    .await
    .unwrap();
    let status = response.status().as_u16();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn created_source_roles_enforce_independent_read_and_manage_actions(pool: PgPool) {
    let (runtime, cookie, user, org) = fixture(&pool).await;
    for (role, actions) in [
        ("source-reader", vec!["read"]),
        ("source-manager", vec!["manage"]),
        ("source-admin", vec!["read", "manage"]),
    ] {
        // Use the same endpoint and payload shape as the custom role form.
        let (status, body) = request(
            &pool,
            &runtime,
            &cookie,
            "POST",
            "/api/auth/organization/create-role",
            json!({"role":role,"permission":{"source":actions}}),
        )
        .await;
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["roleData"]["permission"], json!({"source":actions}));
    }

    for (role, can_read, can_manage) in [
        ("member", false, false),
        ("source-reader", true, false),
        ("source-manager", false, true),
        ("source-admin", true, true),
    ] {
        // Assign each persisted role to an ordinary user; no platform admin bypass.
        sqlx::query("UPDATE member SET role=$1 WHERE \"userId\"=$2 AND \"organizationId\"=$3")
            .bind(role)
            .bind(&user)
            .bind(&org)
            .execute(&pool)
            .await
            .unwrap();
        let (status, body) = request(
            &pool,
            &runtime,
            &cookie,
            "GET",
            "/api/source-connections",
            Value::Null,
        )
        .await;
        assert_eq!(status, if can_read { 200 } else { 403 }, "{role}: {body}");
        if can_read {
            assert_eq!(body, json!([]));
        } else {
            assert_eq!(body["code"], "permission_denied");
        }

        // Deliberately invalid input reaches the real write handler only with manage.
        // No OpenBao instance or source credential is needed to test this boundary.
        let (status, body) = request(
            &pool,
            &runtime,
            &cookie,
            "POST",
            "/api/source-connections",
            json!({
                "serviceId":uuid::Uuid::nil(), "repository":"not-a-repository",
                "webhookSecret":"", "events":["push"]
            }),
        )
        .await;
        assert_eq!(status, if can_manage { 409 } else { 403 }, "{role}: {body}");
        if can_manage {
            assert_eq!(
                body["error"],
                "repository must be a GitHub owner/repository identity"
            );
        } else {
            assert_eq!(body["code"], "permission_denied");
        }

        // Source management must not implicitly grant preview/deployment privileges.
        for (method, path) in [
            (
                "PUT",
                format!(
                    "/api/source-connections/{}/preview-policy",
                    uuid::Uuid::nil()
                ),
            ),
            (
                "DELETE",
                format!(
                    "/api/source-connections/{}/previews/{}",
                    uuid::Uuid::nil(),
                    uuid::Uuid::nil()
                ),
            ),
            ("GET", "/api/projects".into()),
        ] {
            let (status, body) = request(&pool, &runtime, &cookie, method, &path, json!({})).await;
            assert_eq!(status, 403, "{role} {method} {path}: {body}");
            assert_eq!(body["code"], "permission_denied");
        }
    }
}
