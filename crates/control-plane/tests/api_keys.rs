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
            username: "keytester".into(),
            name: "Key test".into(),
            email: None,
            password: "disposable-test-password-only".into(),
            role: "user".into(),
        })
        .await
        .unwrap();
    let login = runtime
        .service
        .sign_in_username(
            "keytester",
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
                name: "Key tests".into(),
                slug: "key-tests".into(),
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
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("host", "localhost:8080")
        .header("content-type", "application/json")
        .header("origin", "http://localhost:5188");
    builder = if credential.starts_with("lp_") {
        builder.header("authorization", format!("Bearer {credential}"))
    } else {
        builder.header("cookie", credential)
    };
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

fn key_request(permissions: Value) -> Value {
    json!({"name":"test key","expiresInDays":7,"permissions":permissions})
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn keys_are_hashed_scoped_audited_and_revocable(pool: PgPool) {
    let (runtime, cookie, user, org) = fixture(&pool).await;
    let (status, created) = request(
        &pool,
        &runtime,
        &cookie,
        "POST",
        "/api/api-keys",
        key_request(json!({"project":["read"]})),
    )
    .await;
    assert_eq!(status, 200, "{created}");
    let key = created["key"].as_str().unwrap();
    let id = created["metadata"]["id"].as_str().unwrap();
    let stored: (String, String, String) = sqlx::query_as(
        "SELECT token_hash,user_id,organization_id FROM personal_api_keys WHERE id=$1::uuid",
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored.0, control_plane::runtime::token_hash(key));
    assert_ne!(stored.0, key);
    assert_eq!((stored.1, stored.2), (user, org.clone()));
    let (status, list) = request(
        &pool,
        &runtime,
        &cookie,
        "GET",
        "/api/api-keys",
        Value::Null,
    )
    .await;
    assert_eq!(status, 200);
    assert!(!list.to_string().contains(key));
    let audits: Vec<String> =
        sqlx::query_scalar("SELECT details::text FROM audit_log WHERE target_type='api_key'")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert!(!audits.is_empty());
    assert!(audits.iter().all(|entry| !entry.contains(key)));
    assert_eq!(
        request(&pool, &runtime, key, "GET", "/api/projects", Value::Null)
            .await
            .0,
        200
    );
    assert_eq!(
        request(
            &pool,
            &runtime,
            key,
            "POST",
            "/api/projects",
            json!({"name":"not-allowed"})
        )
        .await
        .0,
        403
    );
    assert_eq!(
        request(&pool, &runtime, key, "GET", "/api/services", Value::Null)
            .await
            .0,
        403
    );
    assert_eq!(
        request(
            &pool,
            &runtime,
            key,
            "POST",
            "/api/api-keys",
            key_request(json!({"project":["read"]}))
        )
        .await
        .0,
        403
    );
    assert_eq!(
        request(
            &pool,
            &runtime,
            key,
            "GET",
            "/api/auth/get-session",
            Value::Null
        )
        .await
        .0,
        403
    );
    let foreign = uuid::Uuid::new_v4();
    sqlx::query("INSERT INTO projects(id,name,organization_id) VALUES($1,'foreign','another-org')")
        .bind(foreign)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        request(
            &pool,
            &runtime,
            key,
            "GET",
            &format!("/api/projects/{foreign}"),
            Value::Null
        )
        .await
        .0,
        404
    );
    assert_eq!(
        request(
            &pool,
            &runtime,
            &cookie,
            "DELETE",
            &format!("/api/api-keys/{id}"),
            Value::Null
        )
        .await
        .0,
        200
    );
    assert_eq!(
        request(&pool, &runtime, key, "GET", "/api/projects", Value::Null)
            .await
            .0,
        401
    );
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn keys_follow_current_membership_and_expiry(pool: PgPool) {
    let (runtime, cookie, user, org) = fixture(&pool).await;
    let (_, created) = request(
        &pool,
        &runtime,
        &cookie,
        "POST",
        "/api/api-keys",
        key_request(json!({"project":["read","create"]})),
    )
    .await;
    let key = created["key"].as_str().unwrap();
    let id = created["metadata"]["id"].as_str().unwrap();
    // Change the disposable fixture's current role, without issuing a new key.
    sqlx::query("UPDATE member SET role='viewer' WHERE \"userId\"=$1 AND \"organizationId\"=$2")
        .bind(&user)
        .bind(&org)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        request(&pool, &runtime, key, "GET", "/api/projects", Value::Null)
            .await
            .0,
        200
    );
    assert_eq!(
        request(
            &pool,
            &runtime,
            key,
            "POST",
            "/api/projects",
            json!({"name":"denied"})
        )
        .await
        .0,
        403
    );
    assert_ne!(
        request(
            &pool,
            &runtime,
            &cookie,
            "POST",
            "/api/api-keys",
            key_request(json!({"project":["create"]}))
        )
        .await
        .0,
        200
    );
    sqlx::query(
        "UPDATE personal_api_keys SET expires_at=now()-interval '1 second' WHERE id=$1::uuid",
    )
    .bind(id)
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        request(&pool, &runtime, key, "GET", "/api/projects", Value::Null)
            .await
            .0,
        401
    );
    sqlx::query("UPDATE personal_api_keys SET expires_at=now()+interval '1 day' WHERE id=$1::uuid")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM member WHERE \"userId\"=$1 AND \"organizationId\"=$2")
        .bind(&user)
        .bind(&org)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        request(&pool, &runtime, key, "GET", "/api/projects", Value::Null)
            .await
            .0,
        403
    );
    assert_eq!(
        request(
            &pool,
            &runtime,
            &cookie,
            "GET",
            "/api/api-keys",
            Value::Null
        )
        .await
        .0,
        403
    );
}

#[test]
fn scope_and_expiry_validation_is_explicit() {
    for input in [
        key_request(json!({})),
        key_request(json!({"project":["*"]})),
        key_request(json!({"organization":["delete"]})),
        json!({"name":"x","expiresInDays":0,"permissions":{"project":["read"]}}),
        json!({"name":"x","expiresInDays":91,"permissions":{"project":["read"]}}),
    ] {
        assert!(
            control_plane::api_keys::validate(&serde_json::from_value(input).unwrap()).is_err()
        );
    }
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn audit_failure_rolls_back_creation_and_root_keys_remain_scoped(pool: PgPool) {
    let (runtime, cookie, user, _) = fixture(&pool).await;
    sqlx::query("ALTER TABLE audit_log ADD CONSTRAINT test_reject_key_audit CHECK (action <> 'api_key.create')").execute(&pool).await.unwrap();
    let (status, _) = request(
        &pool,
        &runtime,
        &cookie,
        "POST",
        "/api/api-keys",
        key_request(json!({"project":["read"]})),
    )
    .await;
    assert_eq!(status, 503);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM personal_api_keys")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    sqlx::query("ALTER TABLE audit_log DROP CONSTRAINT test_reject_key_audit")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE \"user\" SET role='admin' WHERE id=$1")
        .bind(&user)
        .execute(&pool)
        .await
        .unwrap();
    let (status, created) = request(
        &pool,
        &runtime,
        &cookie,
        "POST",
        "/api/api-keys",
        key_request(json!({"project":["read"]})),
    )
    .await;
    assert_eq!(status, 200);
    let key = created["key"].as_str().unwrap();
    assert_eq!(
        request(
            &pool,
            &runtime,
            key,
            "POST",
            "/api/projects",
            json!({"name":"denied"})
        )
        .await
        .0,
        403
    );
    sqlx::query("UPDATE \"user\" SET banned=true WHERE id=$1")
        .bind(&user)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        request(&pool, &runtime, key, "GET", "/api/projects", Value::Null)
            .await
            .0,
        401
    );
}

fn service_request(build_on_create: Option<bool>) -> Value {
    let mut spec: Value =
        serde_json::from_str(include_str!("../../../examples/oci-service.json")).unwrap();
    spec["name"] = json!(format!("service-{}", uuid::Uuid::new_v4()));
    let mut input = json!({"operationId":uuid::Uuid::new_v4(),"spec":spec});
    if let Some(build) = build_on_create {
        input["buildOnCreate"] = json!(build);
    }
    input
}

async fn creation_counts(pool: &PgPool) -> (i64, i64, i64, i64, i64, i64) {
    sqlx::query_as(
        "SELECT (SELECT count(*) FROM projects), (SELECT count(*) FROM environments),
         (SELECT count(*) FROM services), (SELECT count(*) FROM builds),
         (SELECT count(*) FROM events),
         (SELECT count(*) FROM audit_log WHERE target_type IN ('services','builds'))",
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn assert_create_only(pool: &PgPool, runtime: &auth::Runtime, credential: &str) {
    for build_on_create in [None, Some(true)] {
        let before = creation_counts(pool).await;
        let (status, body) = request(
            pool,
            runtime,
            credential,
            "POST",
            "/api/services",
            service_request(build_on_create),
        )
        .await;
        assert_eq!(status, 403, "{body}");
        assert_eq!(body["code"], "forbidden");
        assert_eq!(creation_counts(pool).await, before);
    }
    let before = creation_counts(pool).await;
    let (status, body) = request(
        pool,
        runtime,
        credential,
        "POST",
        "/api/services",
        service_request(Some(false)),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    let after = creation_counts(pool).await;
    assert_eq!(after.2, before.2 + 1);
    assert_eq!(after.3, before.3);
    assert_eq!(after.4, before.4 + 1);
    assert_eq!(
        request(
            pool,
            runtime,
            credential,
            "POST",
            &format!("/api/services/{}/builds", body["id"].as_str().unwrap()),
            json!({"operationId":uuid::Uuid::new_v4()}),
        )
        .await
        .0,
        403
    );
}

async fn assert_create_and_build(pool: &PgPool, runtime: &auth::Runtime, credential: &str) {
    for build_on_create in [None, Some(true)] {
        let (status, body) = request(
            pool,
            runtime,
            credential,
            "POST",
            "/api/services",
            service_request(build_on_create),
        )
        .await;
        assert_eq!(status, 201, "{body}");
        let queued: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM builds WHERE service_id=$1::uuid AND status='queued'",
        )
        .bind(body["id"].as_str().unwrap())
        .fetch_one(pool)
        .await
        .unwrap();
        assert_eq!(queued, 1);
    }
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn service_creation_builds_require_api_key_scope(pool: PgPool) {
    let (runtime, cookie, _, _) = fixture(&pool).await;
    for can_build in [false, true] {
        let mut permissions = json!({"service":["create"]});
        if can_build {
            permissions["build"] = json!(["execute"]);
        }
        let (status, created) = request(
            &pool,
            &runtime,
            &cookie,
            "POST",
            "/api/api-keys",
            key_request(permissions),
        )
        .await;
        assert_eq!(status, 200);
        let key = created["key"].as_str().unwrap();
        if can_build {
            assert_create_and_build(&pool, &runtime, key).await;
        } else {
            assert_create_only(&pool, &runtime, key).await;
            // celld registration does not enqueue OCI builds, even by default.
            let mut input = service_request(None);
            input["spec"] =
                serde_json::from_str(include_str!("../../../examples/celld-service.json")).unwrap();
            let before = creation_counts(&pool).await;
            let (status, body) =
                request(&pool, &runtime, key, "POST", "/api/services", input).await;
            assert_eq!(status, 201, "{body}");
            assert_eq!(creation_counts(&pool).await.3, before.3);
        }
    }
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn service_creation_builds_require_current_custom_role_for_sessions_and_keys(pool: PgPool) {
    let (runtime, cookie, user, org) = fixture(&pool).await;
    let (status, created) = request(
        &pool,
        &runtime,
        &cookie,
        "POST",
        "/api/api-keys",
        key_request(json!({"service":["create"],"build":["execute"]})),
    )
    .await;
    assert_eq!(status, 200);
    let key = created["key"].as_str().unwrap();
    for (role, permission) in [
        ("creator", json!({"service":["create"]})),
        ("builder", json!({"service":["create"],"build":["execute"]})),
    ] {
        let (status, body) = request(
            &pool,
            &runtime,
            &cookie,
            "POST",
            "/api/auth/organization/create-role",
            json!({"role":role,"permission":permission}),
        )
        .await;
        assert_eq!(status, 200, "{body}");
    }
    for role in ["creator", "builder"] {
        sqlx::query("UPDATE member SET role=$1 WHERE \"userId\"=$2 AND \"organizationId\"=$3")
            .bind(role)
            .bind(&user)
            .bind(&org)
            .execute(&pool)
            .await
            .unwrap();
        for credential in [cookie.as_str(), key] {
            if role == "creator" {
                assert_create_only(&pool, &runtime, credential).await;
            } else {
                assert_create_and_build(&pool, &runtime, credential).await;
            }
        }
    }
}
