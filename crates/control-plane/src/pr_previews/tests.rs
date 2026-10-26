use super::*;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

async fn api(pool: &PgPool, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
    let response = crate::router(pool.clone(), vec![])
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
    let body = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&body).unwrap())
}
async fn fixture(pool: &PgPool) -> SourceConnection {
    let mut spec: Value =
        serde_json::from_str(include_str!("../../../../examples/oci-service.json")).unwrap();
    spec["secrets"] = json!(["PRODUCTION_KEY"]);
    let (status, service) = api(
        pool,
        "POST",
        "/api/services",
        json!({"operationId":Uuid::now_v7(),"spec":spec,"buildOnCreate":false}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{service}");
    let id = Uuid::now_v7();
    let source:SourceConnection=sqlx::query_as("INSERT INTO source_connections(id,service_id,organization_id,provider,repository,repository_key,secret_path,events) VALUES($1,$2,'test-organization','github','example/web-canary','example/web-canary',$3,ARRAY['pull_request']) RETURNING *")
        .bind(id).bind(service["id"].as_str().unwrap().parse::<Uuid>().unwrap()).bind(format!("source-connections/{id}")).fetch_one(pool).await.unwrap();
    let (status,policy)=api(pool,"PUT",&format!("/api/source-connections/{id}/preview-policy"),json!({"enabled":true,"maxActive":1,"maxBuilds":1,"ttlHours":24,"resources":{"cpuMillis":250,"memoryMib":256}})).await;
    assert_eq!(status, StatusCode::OK, "{policy}");
    source
}
fn payload(number: i64, action: &str, second: u32, commit: char) -> Value {
    json!({"repository":{"full_name":"example/web-canary"},"number":number,"action":action,"pull_request":{"updated_at":format!("2026-10-25T10:00:{second:02}Z"),"head":{"repo":{"full_name":"example/web-canary"},"sha":commit.to_string().repeat(40),"ref":"change"},"base":{"repo":{"full_name":"example/web-canary"}}}})
}
async fn deliver(
    pool: &PgPool,
    source: &SourceConnection,
    payload: Value,
) -> crate::source_connections::WebhookDelivery {
    crate::source_connections::process_delivery(
        pool,
        source.clone(),
        "pull_request".into(),
        Uuid::new_v4().to_string(),
        "a".repeat(64),
        payload,
    )
    .await
    .unwrap()
    .1
    .0
}
async fn preview(pool: &PgPool, number: i64) -> sqlx::postgres::PgRow {
    sqlx::query("SELECT * FROM pull_request_previews WHERE number=$1")
        .bind(number)
        .fetch_one(pool)
        .await
        .unwrap()
}
// Routes are preinstalled as test fixtures instead of changing process-global environment.
async fn route(pool: &PgPool, number: i64) {
    let row = preview(pool, number).await;
    let service: Uuid = row.get("service_id");
    sqlx::query(
        "INSERT INTO preview_routes(authority,service_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    )
    .bind(format!("preview.test:{}", 19000 + number))
    .bind(service)
    .execute(pool)
    .await
    .unwrap();
}
async fn finish(pool: &PgPool) -> Uuid {
    let build = crate::builds::claim(pool).await.unwrap().unwrap();
    crate::builds::finish(
        pool,
        &build,
        crate::builds::Completion::Succeeded {
            repository: format!("127.0.0.1:15000/platform/{}", build.service_id),
            digest: format!("sha256:{}", "a".repeat(64)).try_into().unwrap(),
        },
    )
    .await
    .unwrap();
    build.id
}

#[test]
fn template_removes_production_resources_and_rejects_workers() {
    let mut spec: ServiceSpec =
        serde_json::from_str(include_str!("../../../../examples/oci-service.json")).unwrap();
    spec.secrets = vec!["PRODUCTION_SECRET".into()];
    spec.domains = vec!["prod.example.com".into()];
    spec.volume = Some(platform_domain::VolumeAttachment {
        id: Uuid::new_v4(),
        mount_path: "/data".into(),
        read_only: false,
    });
    if let Workload::OciService {
        private_connections,
        build_args,
        ..
    } = &mut spec.workload
    {
        private_connections.push(platform_domain::PrivateConnection {
            service_id: Uuid::new_v4(),
            env: "PROD_URL".into(),
        });
        build_args.insert("PROD_ENDPOINT".into(), "prod.example.com".into());
    }
    let preview = sanitized(
        spec.clone(),
        Resources {
            cpu_millis: 100,
            memory_mib: 128,
        },
        &std::collections::BTreeSet::new(),
        &std::collections::BTreeSet::new(),
    )
    .unwrap();
    assert!(preview.secrets.is_empty() && preview.domains.is_empty() && preview.volume.is_none());
    assert_eq!(preview.resources.memory_mib, 128);
    if let Workload::OciService {
        private_connections,
        build_args,
        replicas,
        ..
    } = preview.workload
    {
        assert!(private_connections.is_empty() && build_args.is_empty());
        assert_eq!(replicas, 1);
    } else {
        panic!("wrong workload");
    }
    if let Workload::OciService { execution, .. } = &mut spec.workload {
        *execution = Execution::Worker;
    }
    assert!(
        sanitized(
            spec,
            Resources {
                cpu_millis: 100,
                memory_mib: 128
            },
            &std::collections::BTreeSet::new(),
            &std::collections::BTreeSet::new(),
        )
        .is_err()
    );
}

#[test]
fn provider_checks_use_terminal_conclusions_only_for_terminal_states() {
    assert_eq!(provider_check_state("pending"), ("queued", None));
    assert_eq!(provider_check_state("building"), ("in_progress", None));
    assert_eq!(provider_check_state("deploying"), ("in_progress", None));
    assert_eq!(
        provider_check_state("ready"),
        ("completed", Some("success"))
    );
    assert_eq!(
        provider_check_state("closed"),
        ("completed", Some("cancelled"))
    );
    assert_eq!(
        provider_check_state("failed"),
        ("completed", Some("failure"))
    );
}

// Build and schedule real preview children, leaving their runtime observations
// under test control. No worker or provider credentials are needed.
async fn deployment_fixture(pool: &PgPool, service_count: usize) -> Vec<Uuid> {
    let source = fixture(pool).await;
    if service_count == 2 {
        let (environment, DbJson(mut spec)): (Uuid, DbJson<ServiceSpec>) =
            sqlx::query_as("SELECT environment_id,spec FROM services WHERE id=$1")
                .bind(source.service_id)
                .fetch_one(pool)
                .await
                .unwrap();
        let dependency = Uuid::now_v7();
        spec.name = "api".into();
        spec.secrets.clear();
        sqlx::query("INSERT INTO services(id,environment_id,name,kind,operation_id,spec,registered_spec) VALUES($1,$2,'api','oci-service',$3,$4,$4)")
            .bind(dependency).bind(environment).bind(Uuid::now_v7()).bind(DbJson(spec)).execute(pool).await.unwrap();
        let resources = json!({"cpuMillis":250,"memoryMib":256});
        let (status, response) = api(
            pool,
            "PUT",
            &format!("/api/source-connections/{}/preview-policy", source.id),
            json!({
                "enabled":true,"maxActive":1,"maxBuilds":2,"ttlHours":24,
                "resources":resources,
                "services":[
                    {"sourceServiceId":source.service_id,"resources":resources},
                    {"sourceServiceId":dependency,"resources":resources}
                ]
            }),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{response}");
    }
    deliver(pool, &source, payload(1, "opened", 1, 'a')).await;
    reconcile(pool).await.unwrap();
    route(pool, 1).await;
    sqlx::query("INSERT INTO nodes(id,name,token_hash,cpu_millis,memory_mib,slots,endpoint_base,last_seen) VALUES($1,'preview-node',$2,2000,4096,4,21000,now())")
        .bind(Uuid::new_v4()).bind(crate::runtime::token_hash(&"a".repeat(64))).execute(pool).await.unwrap();
    for _ in 0..service_count {
        reconcile(pool).await.unwrap();
        finish(pool).await;
    }
    reconcile(pool).await.unwrap();
    let deployments = sqlx::query_scalar(
        "SELECT deployment_id FROM pull_request_preview_services ORDER BY position",
    )
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(deployments.len(), service_count);
    deployments
}

async fn assert_readiness(pool: &PgPool, expected: &str) {
    reconcile(pool).await.unwrap();
    let status: String = preview(pool, 1).await.get("status");
    assert_eq!(status, expected);
    let check = provider_check_state(&status);
    let expected_check = match expected {
        "deploying" => ("in_progress", None),
        "degraded" => ("completed", Some("neutral")),
        "failed" => ("completed", Some("failure")),
        "ready" => ("completed", Some("success")),
        _ => panic!("unexpected readiness state: {expected}"),
    };
    assert_eq!(check, expected_check);
}

async fn set_deployment_status(pool: &PgPool, deployment: Uuid, status: &str) {
    sqlx::query("UPDATE deployments SET status=$2 WHERE id=$1")
        .bind(deployment)
        .bind(status)
        .execute(pool)
        .await
        .unwrap();
}

async fn fresh_observations(pool: &PgPool) {
    sqlx::query("UPDATE instances SET state='ready',desired_state='running',observed_at=now()")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("UPDATE nodes SET last_seen=now()")
        .execute(pool)
        .await
        .unwrap();
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn single_service_readiness_waits_for_active_fresh_healthy_deployment(pool: PgPool) {
    let deployment = deployment_fixture(&pool, 1).await[0];
    assert_readiness(&pool, "deploying").await;
    for pending in ["preparing", "waiting", "releasing"] {
        set_deployment_status(&pool, deployment, pending).await;
        // Even fresh ready instances cannot bypass the deployment's lifecycle.
        fresh_observations(&pool).await;
        assert_readiness(&pool, "deploying").await;
    }
    set_deployment_status(&pool, deployment, "active").await;
    fresh_observations(&pool).await;
    assert_readiness(&pool, "ready").await;
    for unhealthy in [
        "UPDATE instances SET state='starting'",
        "UPDATE instances SET desired_state='stopped'",
        "UPDATE instances SET observed_at=NULL",
        "UPDATE instances SET observed_at=now()-interval '16 seconds'",
        "UPDATE nodes SET last_seen=NULL",
        "UPDATE nodes SET last_seen=now()-interval '31 seconds'",
        "DELETE FROM instances",
    ] {
        fresh_observations(&pool).await;
        sqlx::query(unhealthy).execute(&pool).await.unwrap();
        assert_readiness(&pool, "degraded").await;
    }
    for failed in ["failed", "stopped", "superseded"] {
        set_deployment_status(&pool, deployment, failed).await;
        assert_readiness(&pool, "failed").await;
    }
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn multi_service_readiness_checks_every_child_before_reporting_success(pool: PgPool) {
    let deployments = deployment_fixture(&pool, 2).await;
    assert_readiness(&pool, "deploying").await;
    for pending in ["preparing", "waiting", "releasing"] {
        // Exercise both child orders: a pending child must neither hide a later
        // failure nor be overwritten by a later healthy child.
        for index in 0..deployments.len() {
            let pending_child = deployments[index];
            let other_child = deployments[1 - index];
            set_deployment_status(&pool, pending_child, pending).await;
            set_deployment_status(&pool, other_child, pending).await;
            fresh_observations(&pool).await;
            assert_readiness(&pool, "deploying").await;
            set_deployment_status(&pool, other_child, "active").await;
            assert_readiness(&pool, "deploying").await;
            sqlx::query("UPDATE instances SET observed_at=now()-interval '16 seconds' WHERE deployment_id=$1")
                .bind(other_child).execute(&pool).await.unwrap();
            assert_readiness(&pool, "degraded").await;
            for failed in ["failed", "stopped", "superseded"] {
                set_deployment_status(&pool, other_child, failed).await;
                assert_readiness(&pool, "failed").await;
            }
            set_deployment_status(&pool, other_child, "active").await;
            set_deployment_status(&pool, pending_child, "active").await;
            fresh_observations(&pool).await;
            assert_readiness(&pool, "ready").await;
        }
    }
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn events_are_ordered_idempotent_isolated_and_quota_bounded(pool: PgPool) {
    let source = fixture(&pool).await;
    let event = payload(1, "opened", 1, 'a');
    let first = crate::source_connections::process_delivery(
        &pool,
        source.clone(),
        "pull_request".into(),
        "delivery-one".into(),
        "a".repeat(64),
        event.clone(),
    )
    .await
    .unwrap()
    .1;
    let second = crate::source_connections::process_delivery(
        &pool,
        source.clone(),
        "pull_request".into(),
        "delivery-one".into(),
        "a".repeat(64),
        event,
    )
    .await
    .unwrap()
    .1;
    assert_eq!(first.id, second.id);
    assert!(first.build_id.is_none());
    reconcile(&pool).await.unwrap();
    let p = preview(&pool, 1).await;
    let service: Uuid = p.get("service_id");
    let (parent,spec):(Option<Uuid>,DbJson<ServiceSpec>)=sqlx::query_as("SELECT e.parent_id,s.spec FROM services s JOIN environments e ON e.id=s.environment_id WHERE s.id=$1").bind(service).fetch_one(&pool).await.unwrap();
    assert!(parent.is_none());
    assert!(spec.secrets.is_empty());
    assert_ne!(service, source.service_id);
    route(&pool, 1).await;
    reconcile(&pool).await.unwrap();
    let p = preview(&pool, 1).await;
    let build: Uuid = p.get("build_id");
    reconcile(&pool).await.unwrap();
    assert_eq!(preview(&pool, 1).await.get::<Uuid, _>("build_id"), build);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM builds WHERE service_id=$1")
            .bind(source.service_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
    deliver(&pool, &source, payload(2, "opened", 1, 'a')).await;
    reconcile(&pool).await.unwrap();
    assert_eq!(
        preview(&pool, 2).await.get::<String, _>("reason"),
        "Active preview quota exhausted"
    );
    assert!(
        preview(&pool, 2)
            .await
            .get::<Option<Uuid>, _>("service_id")
            .is_none()
    );
    let mut fork = payload(3, "opened", 1, 'a');
    fork["pull_request"]["head"]["repo"]["full_name"] = json!("fork/web-canary");
    assert_eq!(deliver(&pool, &source, fork).await.status, "ignored");
    deliver(&pool, &source, payload(1, "closed", 4, 'a')).await;
    assert_eq!(
        deliver(&pool, &source, payload(1, "synchronize", 3, 'b'))
            .await
            .status,
        "ignored"
    );
    assert_eq!(
        deliver(&pool, &source, payload(1, "reopened", 4, 'b'))
            .await
            .status,
        "ignored"
    );
    reconcile(&pool).await.unwrap();
    assert_eq!(preview(&pool, 1).await.get::<String, _>("status"), "closed");
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT status FROM builds WHERE id=$1")
            .bind(build)
            .fetch_one(&pool)
            .await
            .unwrap(),
        "cancelled"
    );
    deliver(&pool, &source, payload(1, "reopened", 5, 'b')).await;
    assert!(preview(&pool, 1).await.get::<bool, _>("desired_open"));
    // Raw service controls cannot attach secrets, start jobs or exceed preview quotas.
    for (method, path, body) in [
        ("PUT", format!("/api/services/{service}/secrets"), json!({})),
        ("POST", format!("/api/services/{service}/jobs"), json!({})),
        (
            "POST",
            format!("/api/services/{service}/builds"),
            json!({"operationId":Uuid::new_v4()}),
        ),
    ] {
        assert_eq!(
            api(&pool, method, &path, body).await.0,
            StatusCode::CONFLICT
        );
    }
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM audit_log WHERE target_type='pull_request_previews' AND details ? 'desired_open' AND organization_id='test-organization'").fetch_one(&pool).await.unwrap();
    assert!(count >= 3);
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn build_deploy_update_and_cleanup_resume_without_leaking_resources(pool: PgPool) {
    let source = fixture(&pool).await;
    deliver(&pool, &source, payload(1, "opened", 1, 'a')).await;
    reconcile(&pool).await.unwrap();
    route(&pool, 1).await;
    reconcile(&pool).await.unwrap();
    finish(&pool).await;
    // No worker is not success: retain durable deployment intent for later capacity.
    reconcile(&pool).await.unwrap();
    assert_eq!(
        preview(&pool, 1).await.get::<String, _>("status"),
        "deploying"
    );
    assert!(
        preview(&pool, 1)
            .await
            .get::<Option<Uuid>, _>("deployment_id")
            .is_none()
    );
    let node = Uuid::new_v4();
    sqlx::query("INSERT INTO nodes(id,name,token_hash,cpu_millis,memory_mib,slots,endpoint_base,last_seen) VALUES($1,'preview-node',$2,2000,4096,4,21000,now())").bind(node).bind(crate::runtime::token_hash(&"a".repeat(64))).execute(&pool).await.unwrap();
    reconcile(&pool).await.unwrap();
    let deployment: Uuid = preview(&pool, 1).await.get("deployment_id");
    reconcile(&pool).await.unwrap();
    assert_eq!(
        preview(&pool, 1).await.get::<Uuid, _>("deployment_id"),
        deployment
    );
    sqlx::query("UPDATE instances SET state='ready',observed_at=now() WHERE deployment_id=$1")
        .bind(deployment)
        .execute(&pool)
        .await
        .unwrap();
    crate::runtime::reconcile(&pool).await.unwrap();
    reconcile(&pool).await.unwrap();
    assert_eq!(preview(&pool, 1).await.get::<String, _>("status"), "ready");
    sqlx::query("UPDATE nodes SET last_seen=NULL WHERE id=$1")
        .bind(node)
        .execute(&pool)
        .await
        .unwrap();
    reconcile(&pool).await.unwrap();
    assert_eq!(
        preview(&pool, 1).await.get::<String, _>("status"),
        "degraded"
    );
    sqlx::query("UPDATE nodes SET last_seen=now() WHERE id=$1")
        .bind(node)
        .execute(&pool)
        .await
        .unwrap();
    // Coalesce changes while the previous build runs; never deploy a superseded build result.
    deliver(&pool, &source, payload(1, "synchronize", 2, 'b')).await;
    reconcile(&pool).await.unwrap();
    deliver(&pool, &source, payload(1, "synchronize", 3, 'c')).await;
    reconcile(&pool).await.unwrap();
    finish(&pool).await;
    reconcile(&pool).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM deployments")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
    let latest = finish(&pool).await;
    reconcile(&pool).await.unwrap();
    let next: Uuid = preview(&pool, 1).await.get("deployment_id");
    assert_ne!(next, deployment);
    let commit: String =
        sqlx::query_scalar("SELECT spec->'source'->>'commit' FROM deployments WHERE id=$1")
            .bind(next)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(commit, "c".repeat(40));
    assert_eq!(preview(&pool, 1).await.get::<Uuid, _>("build_id"), latest);
    sqlx::query("UPDATE instances SET state='failed',observed_at=now() WHERE deployment_id=$1")
        .bind(next)
        .execute(&pool)
        .await
        .unwrap();
    crate::runtime::reconcile(&pool).await.unwrap();
    reconcile(&pool).await.unwrap();
    assert_eq!(preview(&pool, 1).await.get::<String, _>("status"), "failed");
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT status FROM deployments WHERE id=$1")
            .bind(deployment)
            .fetch_one(&pool)
            .await
            .unwrap(),
        "active"
    );
    deliver(&pool, &source, payload(1, "closed", 4, 'c')).await;
    reconcile(&pool).await.unwrap();
    let p = preview(&pool, 1).await;
    assert_eq!(p.get::<String, _>("status"), "cleaning");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM preview_routes")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM instances WHERE desired_state<>'stopped'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
    // Controller restart does not treat unreachable instances as stopped.
    reconcile(&pool).await.unwrap();
    assert_eq!(
        preview(&pool, 1).await.get::<String, _>("status"),
        "cleaning"
    );
    sqlx::query("UPDATE instances SET state='stopped',observed_at=now()")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO ingress_route_leases(instance_id,expires_at) SELECT id,now()+interval '30 seconds' FROM instances").execute(&pool).await.unwrap();
    reconcile(&pool).await.unwrap();
    assert_eq!(
        preview(&pool, 1).await.get::<String, _>("status"),
        "cleaning"
    );
    sqlx::query("UPDATE ingress_route_leases SET expires_at=now()-interval '10 seconds'")
        .execute(&pool)
        .await
        .unwrap();
    reconcile(&pool).await.unwrap();
    assert_eq!(preview(&pool, 1).await.get::<String, _>("status"), "closed");
    assert!(!preview(&pool, 1).await.get::<bool, _>("admitted"));
    deliver(&pool, &source, payload(1, "reopened", 5, 'd')).await;
    reconcile(&pool).await.unwrap();
    route(&pool, 1).await;
    reconcile(&pool).await.unwrap();
    assert_eq!(
        preview(&pool, 1).await.get::<Uuid, _>("service_id"),
        p.get::<Uuid, _>("service_id")
    );
    let running = crate::builds::claim(&pool).await.unwrap().unwrap();
    sqlx::query("UPDATE pull_request_previews SET expires_at=now()-interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    reconcile(&pool).await.unwrap();
    assert_eq!(
        preview(&pool, 1).await.get::<String, _>("status"),
        "cleaning"
    );
    assert!(
        sqlx::query_scalar::<_, bool>("SELECT cancel_requested FROM builds WHERE id=$1")
            .bind(running.id)
            .fetch_one(&pool)
            .await
            .unwrap()
    );
    crate::builds::finish(&pool, &running, crate::builds::Completion::Cancelled)
        .await
        .unwrap();
    reconcile(&pool).await.unwrap();
    assert_eq!(preview(&pool, 1).await.get::<String, _>("status"), "closed");
    assert_eq!(
        deliver(&pool, &source, payload(1, "synchronize", 6, 'e'))
            .await
            .status,
        "ignored"
    );
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn build_quota_disable_and_organization_scope_fail_closed(pool: PgPool) {
    let source = fixture(&pool).await;
    sqlx::query("UPDATE preview_policies SET max_active=2 WHERE source_connection_id=$1")
        .bind(source.id)
        .execute(&pool)
        .await
        .unwrap();
    deliver(&pool, &source, payload(1, "opened", 1, 'a')).await;
    deliver(&pool, &source, payload(2, "opened", 1, 'b')).await;
    reconcile(&pool).await.unwrap();
    route(&pool, 1).await;
    route(&pool, 2).await;
    let (a, b) = tokio::join!(reconcile(&pool), reconcile(&pool));
    a.unwrap();
    b.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM builds WHERE status='queued'")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM pull_request_previews WHERE reason='Waiting for preview build capacity'").fetch_one(&pool).await.unwrap(),1);
    // Closing an unknown PR leaves a tombstone so a delayed opened event cannot resurrect it.
    deliver(&pool, &source, payload(3, "closed", 3, 'c')).await;
    assert_eq!(
        deliver(&pool, &source, payload(3, "opened", 2, 'c'))
            .await
            .status,
        "ignored"
    );
    let mut context = auth::Context::testing();
    context.organization_id = Some("another-organization".into());
    assert!(matches!(
        get_policy(
            State(pool.clone()),
            Extension(context.clone()),
            Path(source.id)
        )
        .await,
        Err(ApiError::NotFound)
    ));
    assert!(matches!(
        list(State(pool.clone()), Extension(context), Path(source.id)).await,
        Err(ApiError::NotFound)
    ));
    // Disabling must still work after the source service changes repository.
    sqlx::query("UPDATE services SET spec=jsonb_set(spec,'{source,repository}','\"https://github.com/example/changed\"') WHERE id=$1").bind(source.service_id).execute(&pool).await.unwrap();
    let (status,response)=api(&pool,"PUT",&format!("/api/source-connections/{}/preview-policy",source.id),json!({"enabled":false,"maxActive":2,"maxBuilds":1,"ttlHours":24,"resources":{"cpuMillis":250,"memoryMib":256}})).await;
    assert_eq!(status, StatusCode::OK, "{response}");
    reconcile(&pool).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM pull_request_previews WHERE status<>'closed'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
    assert_eq!(
        deliver(&pool, &source, payload(4, "opened", 4, 'd'))
            .await
            .reason,
        "preview policy is disabled"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM builds WHERE service_id=$1")
            .bind(source.service_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn multi_service_templates_remap_dependencies_and_audit_secret_grants(pool: PgPool) {
    let source = fixture(&pool).await;
    let (environment, DbJson(mut primary)): (Uuid, DbJson<ServiceSpec>) =
        sqlx::query_as("SELECT environment_id,spec FROM services WHERE id=$1")
            .bind(source.service_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let dependency = Uuid::now_v7();
    let mut dependency_spec = primary.clone();
    dependency_spec.name = "api".into();
    dependency_spec.secrets.clear();
    if let Workload::OciService {
        private_connections,
        ..
    } = &mut dependency_spec.workload
    {
        private_connections.clear();
    }
    sqlx::query("INSERT INTO services(id,environment_id,name,kind,operation_id,spec,registered_spec) VALUES($1,$2,'api','oci-service',$3,$4,$4)")
        .bind(dependency).bind(environment).bind(Uuid::now_v7()).bind(DbJson(&dependency_spec)).execute(&pool).await.unwrap();
    if let Workload::OciService {
        private_connections,
        ..
    } = &mut primary.workload
    {
        private_connections.push(platform_domain::PrivateConnection {
            service_id: dependency,
            env: "API_URL".into(),
        });
    }
    sqlx::query("UPDATE services SET spec=$2,registered_spec=$2 WHERE id=$1")
        .bind(source.service_id)
        .bind(DbJson(&primary))
        .execute(&pool)
        .await
        .unwrap();
    let policy = json!({
        "enabled":true,
        "maxActive":1,
        "maxBuilds":2,
        "ttlHours":24,
        "resources":{"cpuMillis":250,"memoryMib":256},
        "services":[
            {"sourceServiceId":source.service_id,"resources":{"cpuMillis":300,"memoryMib":384},"secretReferences":["PRODUCTION_KEY"],"allowedDependencies":[dependency]},
            {"sourceServiceId":dependency,"resources":{"cpuMillis":200,"memoryMib":256},"secretReferences":[],"allowedDependencies":[]}
        ]
    });
    let (status, response) = api(
        &pool,
        "PUT",
        &format!("/api/source-connections/{}/preview-policy", source.id),
        policy,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{response}");
    deliver(&pool, &source, payload(70, "opened", 1, 'a')).await;
    reconcile(&pool).await.unwrap();
    let services = sqlx::query("SELECT source_service_id,service_id,primary_route FROM pull_request_preview_services ORDER BY position")
        .fetch_all(&pool).await.unwrap();
    assert_eq!(services.len(), 2);
    let primary_preview: Uuid = services[0].get("service_id");
    let dependency_preview: Uuid = services[1].get("service_id");
    assert!(services[0].get::<bool, _>("primary_route"));
    let DbJson(primary_preview_spec): DbJson<ServiceSpec> =
        sqlx::query_scalar("SELECT spec FROM services WHERE id=$1")
            .bind(primary_preview)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(primary_preview_spec.secrets, vec!["PRODUCTION_KEY"]);
    let Workload::OciService {
        private_connections,
        ..
    } = primary_preview_spec.workload
    else {
        panic!("preview service is not OCI")
    };
    assert_eq!(private_connections[0].service_id, dependency_preview);
    assert_eq!(
        sqlx::query_scalar::<_, Vec<String>>(
            "SELECT names FROM preview_secret_grants WHERE target_service_id=$1"
        )
        .bind(primary_preview)
        .fetch_one(&pool)
        .await
        .unwrap(),
        vec!["PRODUCTION_KEY"]
    );
    assert!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM audit_log WHERE target_type='preview_secret_grants'"
        )
        .fetch_one(&pool)
        .await
        .unwrap()
            >= 1
    );
}
