//! Deterministic edge failure fixtures. They never claim to exercise live ACME.
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use chrono::{Duration, Utc};
use control_plane::edge::{self, Edge, Failure, Observation, Route};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};
use tower::ServiceExt;
use uuid::Uuid;

#[derive(Default)]
struct TestEdge {
    unavailable: AtomicBool,
    unverified: AtomicBool,
    rejected: Mutex<Option<Uuid>>,
    installed: Mutex<Option<(i64, Option<Uuid>)>>,
}
impl Edge for TestEdge {
    async fn verify(&self, route: &Route) -> Result<(), Failure> {
        if route.deployment.is_some() && self.unverified.load(Ordering::Relaxed) {
            Err(Failure::Ownership)
        } else {
            Ok(())
        }
    }
    async fn reconcile(&self, route: &Route) -> Result<Observation, Failure> {
        if self.unavailable.load(Ordering::Relaxed) {
            return Err(Failure::Unavailable);
        }
        // Model an uncertain apply: the candidate has taken effect before a
        // subsequent data-path probe fails. Recovery must explicitly restore old.
        *self.installed.lock().unwrap() = Some((route.generation, route.deployment));
        if route.deployment.is_some() && route.deployment == *self.rejected.lock().unwrap() {
            return Err(Failure::Health);
        }
        Ok(Observation {
            certificate_expires_at: route.deployment.map(|_| Utc::now() + Duration::days(30)),
        })
    }
}

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
async fn fixture(pool: &PgPool) -> (Uuid, Uuid) {
    let mut spec: Value =
        serde_json::from_str(include_str!("../../../examples/oci-service.json")).unwrap();
    spec["workload"]["replicas"] = json!(1);
    spec["distinctNodes"] = json!(false);
    let (status, service) = call(
        pool,
        "POST",
        "/api/services",
        json!({"operationId":Uuid::new_v4(),"buildOnCreate":false,"spec":spec}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{service}");
    let id: Uuid = service["id"].as_str().unwrap().parse().unwrap();
    call(
        pool,
        "POST",
        &format!("/api/services/{id}/builds"),
        json!({"operationId":Uuid::new_v4(),"noCache":false}),
    )
    .await;
    let build = control_plane::builds::claim(pool).await.unwrap().unwrap();
    control_plane::builds::finish(
        pool,
        &build,
        control_plane::builds::Completion::Succeeded {
            repository: "127.0.0.1:15000/platform/test".into(),
            digest: format!("sha256:{}", "a".repeat(64)).try_into().unwrap(),
        },
    )
    .await
    .unwrap();
    let revision: Uuid = sqlx::query_scalar("SELECT id FROM revisions WHERE build_id=$1")
        .bind(build.id)
        .fetch_one(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO nodes(id,name,token_hash,cpu_millis,memory_mib,slots,endpoint_base,last_seen) VALUES($1,'edge-test',$2,4000,8192,4,21000,now())")
        .bind(Uuid::new_v4()).bind(control_plane::runtime::token_hash(&"a".repeat(64))).execute(pool).await.unwrap();
    (id, revision)
}
async fn deploy(pool: &PgPool, service: Uuid, revision: Uuid) -> Uuid {
    let (status, value) = call(
        pool,
        "POST",
        &format!("/api/services/{service}/deployments"),
        json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{value}");
    value["id"].as_str().unwrap().parse().unwrap()
}
async fn fresh(pool: &PgPool) {
    sqlx::query(
        "UPDATE instances SET state='ready',observed_at=now() WHERE desired_state='running'",
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("UPDATE nodes SET last_seen=now()")
        .execute(pool)
        .await
        .unwrap();
}
async fn attach(pool: &PgPool, service: Uuid) {
    assert_eq!(
        call(
            pool,
            "POST",
            "/api/domains",
            json!({"hostname":"app.example.test"})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            pool,
            "PUT",
            "/api/domains/app.example.test",
            json!({"serviceId":service,"expectedVersion":1})
        )
        .await
        .0,
        StatusCode::OK
    );
}
async fn tick(pool: &PgPool, provider: &TestEdge) {
    sqlx::query("UPDATE domains SET edge_retry_at=now()")
        .execute(pool)
        .await
        .unwrap();
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        edge::tick(pool, provider),
    )
    .await
    .expect("edge worker must not deadlock with foreign-key grants")
    .unwrap();
}
async fn status(pool: &PgPool, id: Uuid) -> String {
    sqlx::query_scalar("SELECT status FROM deployments WHERE id=$1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}
async fn running(pool: &PgPool, id: Uuid) -> bool {
    sqlx::query_scalar(
        "SELECT bool_and(desired_state='running') FROM instances WHERE deployment_id=$1",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn promotion_waits_for_exact_live_ack_and_retains_old_until_drain(pool: PgPool) {
    let (service, revision) = fixture(&pool).await;
    let old = deploy(&pool, service, revision).await;
    fresh(&pool).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    attach(&pool, service).await;
    let provider = TestEdge::default();
    tick(&pool, &provider).await;
    let candidate = deploy(&pool, service, revision).await;
    fresh(&pool).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(status(&pool, candidate).await, "preparing");
    assert!(running(&pool, old).await);
    // Repeated reconciliation models restart: generation must not increment.
    let generation: i64 = sqlx::query_scalar("SELECT edge_generation FROM domains")
        .fetch_one(&pool)
        .await
        .unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT edge_generation FROM domains")
            .fetch_one(&pool)
            .await
            .unwrap(),
        generation
    );
    tick(&pool, &provider).await;
    // Even an exact ACK is unusable after its lease expires.
    sqlx::query("UPDATE domains SET edge_lease_expires_at=now()-interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(status(&pool, candidate).await, "preparing");
    tick(&pool, &provider).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(status(&pool, candidate).await, "active");
    assert!(running(&pool, old).await);
    assert_eq!(
        call(
            &pool,
            "POST",
            &format!("/api/deployments/{old}/stop"),
            Value::Null
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    // New deploys and reassignment cannot race the rollback window.
    assert_eq!(
        call(
            &pool,
            "PUT",
            "/api/domains/app.example.test",
            json!({"serviceId":null,"expectedVersion":2})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    sqlx::query("UPDATE edge_rollouts SET drain_after=now()-interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert!(!running(&pool, old).await);
    assert!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM audit_log WHERE action IN ('edge.route','edge.rollout')"
        )
        .fetch_one(&pool)
        .await
        .unwrap()
            >= 4
    );
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn failed_apply_restores_previous_route_and_rollback_waits_during_outage(pool: PgPool) {
    let (service, revision) = fixture(&pool).await;
    let old = deploy(&pool, service, revision).await;
    fresh(&pool).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    attach(&pool, service).await;
    let provider = TestEdge::default();
    tick(&pool, &provider).await;
    let candidate = deploy(&pool, service, revision).await;
    fresh(&pool).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    *provider.rejected.lock().unwrap() = Some(candidate);
    tick(&pool, &provider).await;
    assert_eq!(provider.installed.lock().unwrap().unwrap().1, Some(old));
    assert_eq!(status(&pool, old).await, "active");
    assert!(running(&pool, old).await && running(&pool, candidate).await);
    assert_eq!(
        call(
            &pool,
            "POST",
            &format!("/api/deployments/{candidate}/rollback"),
            Value::Null
        )
        .await
        .0,
        StatusCode::OK
    );
    provider.unavailable.store(true, Ordering::Relaxed);
    tick(&pool, &provider).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert!(running(&pool, candidate).await);
    assert_eq!(status(&pool, candidate).await, "preparing");
    provider.unavailable.store(false, Ordering::Relaxed);
    tick(&pool, &provider).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(status(&pool, candidate).await, "failed");
    assert_eq!(status(&pool, old).await, "active");
    assert!(running(&pool, candidate).await);
    sqlx::query("UPDATE edge_rollouts SET drain_after=now()-interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert!(!running(&pool, candidate).await);
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn unverified_domain_never_grants_route_and_failed_first_deploy_requires_removal_ack(
    pool: PgPool,
) {
    let (service, revision) = fixture(&pool).await;
    attach(&pool, service).await;
    let candidate = deploy(&pool, service, revision).await;
    fresh(&pool).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    let provider = TestEdge::default();
    provider.unverified.store(true, Ordering::Relaxed);
    tick(&pool, &provider).await;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM edge_targets")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
    assert!(provider.installed.lock().unwrap().is_none());
    sqlx::query("UPDATE deployments SET deadline=now()-interval '1 second' WHERE id=$1")
        .bind(candidate)
        .execute(&pool)
        .await
        .unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert!(running(&pool, candidate).await);
    provider.unavailable.store(true, Ordering::Relaxed);
    tick(&pool, &provider).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert!(running(&pool, candidate).await);
    provider.unavailable.store(false, Ordering::Relaxed);
    tick(&pool, &provider).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(status(&pool, candidate).await, "failed");
    assert_eq!(provider.installed.lock().unwrap().unwrap().1, None);
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn unassignment_removes_route_only_after_observation_and_reports_renewal(pool: PgPool) {
    let (service, revision) = fixture(&pool).await;
    let old = deploy(&pool, service, revision).await;
    fresh(&pool).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    attach(&pool, service).await;
    let provider = TestEdge::default();
    tick(&pool, &provider).await;
    sqlx::query("UPDATE domains SET certificate_expires_at=now()+interval '2 days'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(&pool, "GET", "/api/domains", Value::Null).await.1["items"][0]["status"],
        "certificate-expiring"
    );
    tick(&pool, &provider).await;
    assert_eq!(
        call(&pool, "GET", "/api/domains", Value::Null).await.1["items"][0]["status"],
        "active"
    );
    assert_eq!(
        call(
            &pool,
            "PUT",
            "/api/domains/app.example.test",
            json!({"serviceId":null,"expectedVersion":2})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&pool, "GET", "/api/domains", Value::Null).await.1["items"][0]["status"],
        "removing"
    );
    tick(&pool, &provider).await;
    assert_eq!(
        call(&pool, "GET", "/api/domains", Value::Null).await.1["items"][0]["status"],
        "removed"
    );
    // Leased old targets fence shutdown and slot reuse even after route removal.
    assert_eq!(
        call(
            &pool,
            "POST",
            &format!("/api/deployments/{old}/stop"),
            Value::Null
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    sqlx::query("UPDATE edge_targets SET expires_at=now()-interval '20 seconds'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(
            &pool,
            "POST",
            &format!("/api/deployments/{old}/stop"),
            Value::Null
        )
        .await
        .0,
        StatusCode::OK
    );
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn failed_promoted_candidate_restores_previous_active_deployment(pool: PgPool) {
    let (service, revision) = fixture(&pool).await;
    let old = deploy(&pool, service, revision).await;
    fresh(&pool).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    attach(&pool, service).await;
    let provider = TestEdge::default();
    tick(&pool, &provider).await;
    let candidate = deploy(&pool, service, revision).await;
    fresh(&pool).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    tick(&pool, &provider).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(status(&pool, candidate).await, "active");
    sqlx::query("UPDATE instances SET state='failed' WHERE deployment_id=$1")
        .bind(candidate)
        .execute(&pool)
        .await
        .unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert!(running(&pool, old).await && running(&pool, candidate).await);
    tick(&pool, &provider).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(status(&pool, old).await, "active");
    assert_eq!(status(&pool, candidate).await, "failed");
    assert!(
        running(&pool, candidate).await,
        "rollback acknowledgement precedes draining"
    );
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn rollback_health_ignores_retired_relocation_allocations(pool: PgPool) {
    let (service, revision) = fixture(&pool).await;
    let old = deploy(&pool, service, revision).await;
    fresh(&pool).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    // Completed relocations preserve their stopped allocations for history.
    sqlx::query("INSERT INTO instances(id,deployment_id,node_id,slot,desired_state,state,routing_enabled) SELECT $1,deployment_id,node_id,slot,'stopped','stopped',false FROM instances WHERE deployment_id=$2")
        .bind(Uuid::new_v4()).bind(old).execute(&pool).await.unwrap();
    attach(&pool, service).await;
    let provider = TestEdge::default();
    tick(&pool, &provider).await;
    let candidate = deploy(&pool, service, revision).await;
    fresh(&pool).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    tick(&pool, &provider).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(status(&pool, candidate).await, "active");
    assert_eq!(
        call(
            &pool,
            "POST",
            &format!("/api/deployments/{candidate}/rollback"),
            Value::Null
        )
        .await
        .0,
        StatusCode::OK
    );
    tick(&pool, &provider).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(status(&pool, old).await, "active");
    assert_eq!(status(&pool, candidate).await, "failed");
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn every_domain_needs_a_removal_ack_including_never_observed_domains(pool: PgPool) {
    let (service, revision) = fixture(&pool).await;
    attach(&pool, service).await;
    assert_eq!(
        call(
            &pool,
            "POST",
            "/api/domains",
            json!({"hostname":"other.example.test"})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &pool,
            "PUT",
            "/api/domains/other.example.test",
            json!({"serviceId":service,"expectedVersion":1})
        )
        .await
        .0,
        StatusCode::OK
    );
    let candidate = deploy(&pool, service, revision).await;
    fresh(&pool).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(
        call(
            &pool,
            "POST",
            &format!("/api/deployments/{candidate}/rollback"),
            Value::Null
        )
        .await
        .0,
        StatusCode::OK
    );
    sqlx::query("UPDATE domains SET edge_retry_at=now()+interval '1 day' WHERE hostname='other.example.test'").execute(&pool).await.unwrap();
    let provider = TestEdge::default();
    edge::tick(&pool, &provider).await.unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(
        status(&pool, candidate).await,
        "preparing",
        "an unobserved removal is not an ACK"
    );
    tick(&pool, &provider).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(status(&pool, candidate).await, "failed");
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn unassigning_last_domain_cannot_bypass_removal_barrier_on_next_deployment(pool: PgPool) {
    let (service, revision) = fixture(&pool).await;
    let old = deploy(&pool, service, revision).await;
    fresh(&pool).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    attach(&pool, service).await;
    let provider = TestEdge::default();
    tick(&pool, &provider).await;
    assert_eq!(
        call(
            &pool,
            "PUT",
            "/api/domains/app.example.test",
            json!({"serviceId":null,"expectedVersion":2})
        )
        .await
        .0,
        StatusCode::OK
    );
    let candidate = deploy(&pool, service, revision).await;
    fresh(&pool).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(status(&pool, candidate).await, "preparing");
    assert!(running(&pool, old).await);
    // Expiry fences data traffic, but it is not a substitute for removal ACK.
    sqlx::query("UPDATE edge_targets SET expires_at=now()-interval '1 minute'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE domains SET edge_lease_expires_at=now()-interval '1 minute'")
        .execute(&pool)
        .await
        .unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(status(&pool, candidate).await, "preparing");
    tick(&pool, &provider).await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    assert_eq!(status(&pool, candidate).await, "active");
    assert!(!running(&pool, old).await);
}
