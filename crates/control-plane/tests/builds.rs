use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use control_plane::builds::{self, Completion};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

async fn call(pool: &PgPool, method: &str, path: &str, value: Value) -> (StatusCode, Value) {
    let response = control_plane::router(pool.clone(), vec!["http://localhost:5188".into()])
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("host", "localhost:8080")
                .header("content-type", "application/json")
                .body(Body::from(value.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}

async fn service(pool: &PgPool, celld: bool) -> String {
    let spec: Value = serde_json::from_str(if celld {
        include_str!("../../../examples/celld-service.json")
    } else {
        include_str!("../../../examples/oci-service.json")
    })
    .unwrap();
    let (status, body) = call(
        pool,
        "POST",
        "/api/services",
        json!({"operation_id":Uuid::new_v4(),"spec":spec}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    body["id"].as_str().unwrap().into()
}

async fn queued(pool: &PgPool) -> (String, Value) {
    let service = service(pool, false).await;
    let (status, build) = call(
        pool,
        "POST",
        &format!("/api/services/{service}/builds"),
        json!({"operation_id":Uuid::new_v4(),"no_cache":false}),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    (service, build)
}

fn success() -> Completion {
    Completion::Succeeded {
        repository: "registry.example/platform/service".into(),
        digest: format!("sha256:{}", "a".repeat(64)).try_into().unwrap(),
    }
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn build_requests_are_idempotent_and_concurrent_claims_are_exclusive(pool: PgPool) {
    let service = service(&pool, false).await;
    let path = format!("/api/services/{service}/builds");
    let request = json!({"operation_id":Uuid::new_v4(),"no_cache":true});
    let (a, b) = tokio::join!(
        call(&pool, "POST", &path, request.clone()),
        call(&pool, "POST", &path, request.clone())
    );
    assert!(matches!(
        (a.0, b.0),
        (StatusCode::ACCEPTED, StatusCode::OK) | (StatusCode::OK, StatusCode::ACCEPTED)
    ));
    assert_eq!(a.1, b.1);
    let mut changed = request;
    changed["no_cache"] = false.into();
    assert_eq!(
        call(&pool, "POST", &path, changed).await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(&pool, "POST", &path, json!({"operation_id":Uuid::new_v4()}))
            .await
            .0,
        StatusCode::CONFLICT
    );
    let (a, b) = tokio::join!(builds::claim(&pool), builds::claim(&pool));
    assert_eq!(
        usize::from(a.unwrap().is_some()) + usize::from(b.unwrap().is_some()),
        1
    );
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn success_atomically_records_digest_revision_and_audit_event(pool: PgPool) {
    let (service, _) = queued(&pool).await;
    let build = builds::claim(&pool).await.unwrap().unwrap();
    assert!(builds::finish(&pool, &build, success()).await.unwrap());
    assert!(!builds::finish(&pool, &build, success()).await.unwrap());
    let (_, revisions) = call(
        &pool,
        "GET",
        &format!("/api/services/{service}/revisions"),
        Value::Null,
    )
    .await;
    assert_eq!(revisions.as_array().unwrap().len(), 1);
    assert_eq!(
        revisions[0]["image_digest"],
        format!("sha256:{}", "a".repeat(64))
    );
    assert_eq!(
        revisions[0]["spec"]["source"]["commit"],
        build.spec.source.commit.as_deref().unwrap()
    );
    let (_, events) = call(
        &pool,
        "GET",
        &format!("/api/services/{service}/events"),
        Value::Null,
    )
    .await;
    assert_eq!(
        events
            .as_array()
            .unwrap()
            .iter()
            .filter(|v| v["kind"] == "build.succeeded")
            .count(),
        1
    );
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn failed_builds_have_diagnostics_and_no_revision(pool: PgPool) {
    let (service, _) = queued(&pool).await;
    let build = builds::claim(&pool).await.unwrap().unwrap();
    builds::append_log(&pool, &build, "Dockerfile not found\n")
        .await
        .unwrap();
    builds::finish(&pool, &build, Completion::Failed("build_failed"))
        .await
        .unwrap();
    let (_, stored) = call(
        &pool,
        "GET",
        &format!("/api/builds/{}", build.id),
        Value::Null,
    )
    .await;
    assert_eq!(stored["status"], "failed");
    assert_eq!(stored["error_code"], "build_failed");
    let (_, revisions) = call(
        &pool,
        "GET",
        &format!("/api/services/{service}/revisions"),
        Value::Null,
    )
    .await;
    assert_eq!(revisions.as_array().unwrap().len(), 0);
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn cancellation_wins_over_a_late_success(pool: PgPool) {
    let (service, _) = queued(&pool).await;
    let build = builds::claim(&pool).await.unwrap().unwrap();
    let path = format!("/api/builds/{}/cancel", build.id);
    assert_eq!(
        call(&pool, "POST", &path, Value::Null).await.0,
        StatusCode::OK
    );
    assert_eq!(
        call(&pool, "POST", &path, Value::Null).await.0,
        StatusCode::OK
    );
    assert_eq!(builds::renew(&pool, &build).await.unwrap(), Some(true));
    builds::finish(&pool, &build, success()).await.unwrap();
    let (_, stored) = call(
        &pool,
        "GET",
        &format!("/api/builds/{}", build.id),
        Value::Null,
    )
    .await;
    assert_eq!(stored["status"], "cancelled");
    let (_, revisions) = call(
        &pool,
        "GET",
        &format!("/api/services/{service}/revisions"),
        Value::Null,
    )
    .await;
    assert_eq!(revisions.as_array().unwrap().len(), 0);
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn cancelled_queue_entries_are_never_claimed(pool: PgPool) {
    let (_, build) = queued(&pool).await;
    let path = format!("/api/builds/{}/cancel", build["id"].as_str().unwrap());
    let (_, cancelled) = call(&pool, "POST", &path, Value::Null).await;
    assert_eq!(cancelled["status"], "cancelled");
    assert!(builds::claim(&pool).await.unwrap().is_none());
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn expired_workers_cannot_renew_write_logs_or_publish(pool: PgPool) {
    let (_, _) = queued(&pool).await;
    let build = builds::claim(&pool).await.unwrap().unwrap();
    sqlx::query("UPDATE builds SET lease_until=now()-interval '1 second' WHERE id=$1")
        .bind(build.id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(builds::renew(&pool, &build).await.unwrap(), None);
    builds::append_log(&pool, &build, "stale output")
        .await
        .unwrap();
    assert!(!builds::finish(&pool, &build, success()).await.unwrap());
    builds::expire(&pool).await.unwrap();
    let (_, stored) = call(
        &pool,
        "GET",
        &format!("/api/builds/{}", build.id),
        Value::Null,
    )
    .await;
    assert_eq!(stored["status"], "interrupted");
    assert_eq!(stored["log_bytes"], 0);
    assert!(builds::claim(&pool).await.unwrap().is_none());
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn logs_are_bounded_utf8_safe_and_cursor_addressable(pool: PgPool) {
    queued(&pool).await;
    let build = builds::claim(&pool).await.unwrap().unwrap();
    builds::append_log(&pool, &build, "first\n").await.unwrap();
    let path = format!("/api/builds/{}/logs", build.id);
    let (_, first) = call(&pool, "GET", &path, Value::Null).await;
    builds::append_log(&pool, &build, &"€".repeat(builds::LOG_LIMIT))
        .await
        .unwrap();
    let (_, rest) = call(
        &pool,
        "GET",
        &format!("{path}?after={}", first["next_cursor"]),
        Value::Null,
    )
    .await;
    assert_eq!(rest["truncated"], true);
    assert_eq!(rest["entries"].as_array().unwrap().len(), 1);
    let count: i64 = sqlx::query_scalar(
        "SELECT sum(octet_length(message))::bigint FROM build_logs WHERE build_id=$1",
    )
    .bind(build.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(count as usize <= builds::LOG_LIMIT);
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn changing_commit_captures_an_immutable_build_snapshot(pool: PgPool) {
    let service = service(&pool, false).await;
    let commit = "a".repeat(40);
    let (status, build) = call(
        &pool,
        "POST",
        &format!("/api/services/{service}/builds"),
        json!({"operation_id":Uuid::new_v4(),"commit":commit}),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(build["spec"]["source"]["commit"], commit);
    let (_, stored) = call(
        &pool,
        "GET",
        &format!("/api/services/{service}"),
        Value::Null,
    )
    .await;
    assert_ne!(stored["spec"]["source"]["commit"], commit);
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn celld_cannot_enter_the_oci_build_pipeline(pool: PgPool) {
    let service = service(&pool, true).await;
    let (status, _) = call(
        &pool,
        "POST",
        &format!("/api/services/{service}/builds"),
        json!({"operation_id":Uuid::new_v4()}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM builds")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn stale_worker_heartbeats_do_not_claim_availability(pool: PgPool) {
    let (_, system) = call(&pool, "GET", "/api/build-system", Value::Null).await;
    assert_eq!(system["worker_online"], false);
    let id = Uuid::new_v4();
    builds::heartbeat(&pool, id).await.unwrap();
    assert_eq!(
        call(&pool, "GET", "/api/build-system", Value::Null).await.1["worker_online"],
        true
    );
    sqlx::query("UPDATE build_workers SET last_seen=now()-interval '1 minute'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(&pool, "GET", "/api/build-system", Value::Null).await.1["worker_online"],
        false
    );
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn mutable_refs_are_pinned_once_and_revisions_keep_only_the_commit(pool: PgPool) {
    let id = service(&pool, false).await;
    for kind in ["branch", "tag"] {
        let request = json!({"operation_id":Uuid::new_v4(),kind:"release/v1"});
        let (status, queued) = call(
            &pool,
            "POST",
            &format!("/api/services/{id}/builds"),
            request,
        )
        .await;
        assert_eq!(status, StatusCode::ACCEPTED);
        assert!(queued["resolved_commit"].is_null());
        let build = builds::claim(&pool).await.unwrap().unwrap();
        assert!(builds::finish(&pool, &build, success()).await.is_err());
        let commit = if kind == "branch" {
            "a".repeat(40)
        } else {
            "b".repeat(40)
        };
        assert!(
            builds::record_resolution(&pool, &build, &commit)
                .await
                .unwrap()
        );
        assert!(
            builds::record_resolution(&pool, &build, &commit)
                .await
                .unwrap()
        );
        assert!(
            !builds::record_resolution(&pool, &build, &"c".repeat(40))
                .await
                .unwrap()
        );
        assert!(builds::finish(&pool, &build, success()).await.unwrap());
        let (_, stored) = call(
            &pool,
            "GET",
            &format!("/api/builds/{}", build.id),
            Value::Null,
        )
        .await;
        assert_eq!(stored["spec"]["source"][kind], "release/v1");
        assert_eq!(stored["resolved_commit"], commit);
        let revision: Value = sqlx::query_scalar("SELECT spec FROM revisions WHERE build_id=$1")
            .bind(build.id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(revision["source"]["commit"], commit);
        assert!(revision["source"].get(kind).is_none());
        assert!(
            !builds::record_resolution(&pool, &build, &commit)
                .await
                .unwrap()
        );
    }
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn cancelled_and_expired_claims_cannot_resolve_sources(pool: PgPool) {
    let id = service(&pool, false).await;
    for expire in [true, false] {
        call(
            &pool,
            "POST",
            &format!("/api/services/{id}/builds"),
            json!({"operation_id":Uuid::new_v4(),"branch":"main"}),
        )
        .await;
        let build = builds::claim(&pool).await.unwrap().unwrap();
        if expire {
            sqlx::query("UPDATE builds SET lease_until=now()-interval '1 second' WHERE id=$1")
                .bind(build.id)
                .execute(&pool)
                .await
                .unwrap();
        } else {
            call(
                &pool,
                "POST",
                &format!("/api/builds/{}/cancel", build.id),
                Value::Null,
            )
            .await;
        }
        assert!(
            !builds::record_resolution(&pool, &build, &"a".repeat(40))
                .await
                .unwrap()
        );
        sqlx::query("UPDATE builds SET status='interrupted' WHERE id=$1")
            .bind(build.id)
            .execute(&pool)
            .await
            .unwrap();
    }
}
