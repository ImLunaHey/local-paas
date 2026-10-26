use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;
async fn call(pool: &PgPool, path: &str, value: Value, token: Option<&str>) -> (StatusCode, Value) {
    let mut r = Request::builder()
        .method("POST")
        .uri(path)
        .header("host", "localhost:8080")
        .header("content-type", "application/json");
    if let Some(token) = token {
        r = r.header("authorization", format!("Bearer {token}"));
    }
    let response = control_plane::router(pool.clone(), vec![])
        .oneshot(r.body(Body::from(value.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
async fn fixture(pool: &PgPool) -> (Uuid, Uuid, Vec<Uuid>) {
    let spec: Value =
        serde_json::from_str(include_str!("../../../examples/oci-service.json")).unwrap();
    let (_, s) = call(
        pool,
        "/api/services",
        json!({"buildOnCreate":false,"operationId":Uuid::new_v4(),"spec":spec}),
        None,
    )
    .await;
    let service = s["id"].as_str().unwrap().parse::<Uuid>().unwrap();
    call(
        pool,
        &format!("/api/services/{service}/builds"),
        json!({"operationId":Uuid::new_v4(),"noCache":false}),
        None,
    )
    .await;
    let b = control_plane::builds::claim(pool).await.unwrap().unwrap();
    control_plane::builds::finish(
        pool,
        &b,
        control_plane::builds::Completion::Succeeded {
            repository: "127.0.0.1:15000/platform/test".into(),
            digest: format!("sha256:{}", "a".repeat(64)).try_into().unwrap(),
        },
    )
    .await
    .unwrap();
    let revision: Uuid = sqlx::query_scalar("SELECT id FROM revisions WHERE build_id=$1")
        .bind(b.id)
        .fetch_one(pool)
        .await
        .unwrap();
    let mut nodes = Vec::new();
    for i in 0..3 {
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO nodes(id,name,token_hash,cpu_millis,memory_mib,slots,endpoint_base,last_seen) VALUES($1,$2,$3,1000,1500,4,$4,now())").bind(id).bind(format!("node-{i}")).bind(control_plane::runtime::token_hash(&"a".repeat(64))).bind(21000+i*100).execute(pool).await.unwrap();
        nodes.push(id);
    }
    (service, revision, nodes)
}
#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn deployments_spread_deduplicate_and_preserve_active_revision_on_failure(pool: PgPool) {
    let (service, revision, _) = fixture(&pool).await;
    let path = format!("/api/services/{service}/deployments");
    let req = json!({"operationId":Uuid::new_v4(),"revisionId":revision});
    let (a, b) = tokio::join!(
        call(&pool, &path, req.clone(), None),
        call(&pool, &path, req, None)
    );
    assert_eq!(a.0, StatusCode::OK);
    assert_eq!(a, b);
    let id = a.1["id"].as_str().unwrap().parse::<Uuid>().unwrap();
    let nodes: i64 =
        sqlx::query_scalar("SELECT count(DISTINCT node_id) FROM instances WHERE deployment_id=$1")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(nodes, 2);
    control_plane::runtime::reconcile(&pool).await.unwrap();
    let status: String = sqlx::query_scalar("SELECT status FROM deployments WHERE id=$1")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "preparing");
    sqlx::query("UPDATE instances SET state='ready',observed_at=now() WHERE deployment_id=$1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    let (_, next) = call(
        &pool,
        &path,
        json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
        None,
    )
    .await;
    let next = next["id"].as_str().unwrap().parse::<Uuid>().unwrap();
    sqlx::query("UPDATE instances SET state='failed' WHERE deployment_id=$1")
        .bind(next)
        .execute(&pool)
        .await
        .unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    let active: Uuid = sqlx::query_scalar("SELECT id FROM deployments WHERE status='active'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(active, id);
    let failed: String = sqlx::query_scalar("SELECT status FROM deployments WHERE id=$1")
        .bind(next)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(failed, "failed");
    assert_eq!(
        call(
            &pool,
            &format!("/api/deployments/{id}/stop"),
            json!({}),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let generations: Vec<i64> =
        sqlx::query_scalar("SELECT generation FROM instances WHERE deployment_id=$1")
            .bind(id)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(generations, vec![2, 2]);
    call(
        &pool,
        &format!("/api/deployments/{id}/stop"),
        json!({}),
        None,
    )
    .await;
    let generations: Vec<i64> =
        sqlx::query_scalar("SELECT generation FROM instances WHERE deployment_id=$1")
            .bind(id)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(generations, vec![2, 2]);
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn placements_exclude_nodes_owned_by_another_organization(pool: PgPool) {
    let (service, revision, nodes) = fixture(&pool).await;
    sqlx::query("UPDATE nodes SET organization_id='another-organization' WHERE id=$1")
        .bind(nodes[0])
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE nodes SET organization_id='test-organization' WHERE id=$1")
        .bind(nodes[1])
        .execute(&pool)
        .await
        .unwrap();

    let (status, deployment) = call(
        &pool,
        &format!("/api/services/{service}/deployments"),
        json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let deployment: Uuid = deployment["id"].as_str().unwrap().parse().unwrap();
    let assigned: Vec<Uuid> =
        sqlx::query_scalar("SELECT node_id FROM instances WHERE deployment_id=$1 ORDER BY node_id")
            .bind(deployment)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(assigned.len(), 2);
    assert!(!assigned.contains(&nodes[0]));
    assert!(assigned.contains(&nodes[1]));
    assert!(assigned.contains(&nodes[2]));
}
#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn node_identity_and_generations_fence_observations(pool: PgPool) {
    let (service, revision, nodes) = fixture(&pool).await;
    call(
        &pool,
        &format!("/api/services/{service}/deployments"),
        json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
        None,
    )
    .await;
    let request = json!({"version":platform_protocol::VERSION,"nodeId":nodes[0],"observations":[]});
    assert_eq!(
        call(&pool, "/api/agent/sync", request.clone(), None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(
            &pool,
            "/api/agent/sync",
            request.clone(),
            Some(&"b".repeat(64))
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let (_, r) = call(&pool, "/api/agent/sync", request, Some(&"a".repeat(64))).await;
    let id = r["assignments"][0]["instanceId"]
        .as_str()
        .unwrap()
        .parse::<Uuid>()
        .unwrap();
    let observation = json!({"observedUnixMs":chrono::Utc::now().timestamp_millis(),"instanceId":id,"generation":0,"state":"ready","diagnostic":null,"metrics":null,"logs":[]});
    call(
        &pool,
        "/api/agent/sync",
        json!({"version":platform_protocol::VERSION,"nodeId":nodes[0],"observations":[observation]}),
        Some(&"a".repeat(64)),
    )
    .await;
    let state: String = sqlx::query_scalar("SELECT state FROM instances WHERE id=$1")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(state, "assigned");
    let log = json!({"key":"c".repeat(64),"timestamp":"2026-10-23T20:00:00Z","stream":"stdout","line":"hello\n"});
    let observation = json!({"observedUnixMs":chrono::Utc::now().timestamp_millis(),"instanceId":id,"generation":1,"state":"ready","diagnostic":null,"metrics":{"cpuMillis":12.0,"memoryBytes":4096,"pids":3},"logs":[log]});
    let req = json!({"version":platform_protocol::VERSION,"nodeId":nodes[0],"observations":[observation]});
    for _ in 0..2 {
        assert_eq!(
            call(&pool, "/api/agent/sync", req.clone(), Some(&"a".repeat(64)))
                .await
                .0,
            StatusCode::OK
        );
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM runtime_logs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
    let metrics: i64 = sqlx::query_scalar("SELECT count(*) FROM runtime_metrics")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        metrics, 1,
        "a repeated heartbeat must not create a fresh sample"
    );
    let state: String = sqlx::query_scalar("SELECT state FROM instances WHERE id=$1")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(state, "ready");
}

async fn read(pool: &PgPool, path: &str) -> (StatusCode, Value) {
    let response = control_plane::router(pool.clone(), vec![])
        .oneshot(
            Request::builder()
                .uri(path)
                .header("host", "localhost:8080")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}
#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn structured_logs_search_filter_and_page_without_cross_service_leaks(pool: PgPool) {
    let (service, revision, nodes) = fixture(&pool).await;
    let (_, d) = call(
        &pool,
        &format!("/api/services/{service}/deployments"),
        json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
        None,
    )
    .await;
    let instance: Uuid =
        sqlx::query_scalar("SELECT id FROM instances WHERE deployment_id=$1 AND node_id=$2")
            .bind(d["id"].as_str().unwrap().parse::<Uuid>().unwrap())
            .bind(nodes[0])
            .fetch_one(&pool)
            .await
            .unwrap();
    let now = chrono::Utc::now();
    let observation = json!({"instanceId":instance,"generation":1,"observedUnixMs":now.timestamp_millis(),"state":"ready","diagnostic":null,"metrics":null,"logs":[
        {"key":"a".repeat(64),"timestamp":now.to_rfc3339(),"stream":"stdout","line":"{\"level\":50,\"msg\":\"Request failed\",\"request\":{\"id\":\"abc\"}}"},
        {"key":"b".repeat(64),"timestamp":now.to_rfc3339(),"stream":"stderr","line":"plain stderr"}
    ]});
    assert_eq!(
        call(
            &pool,
            "/api/agent/sync",
            json!({"version":platform_protocol::VERSION,"nodeId":nodes[0],"observations":[observation.clone()]}),
            Some(&"a".repeat(64))
        )
        .await
        .0,
        StatusCode::OK
    );
    let path = format!("/api/services/{service}/runtime/logs");
    let (_, page) = read(
        &pool,
        &format!("{path}?level=error&stream=stdout&field=request.id&value=abc&search=FAILED"),
    )
    .await;
    assert_eq!(page["entries"].as_array().unwrap().len(), 1);
    assert_eq!(page["entries"][0]["message"], "Request failed");
    let (_, stderr) = read(&pool, &format!("{path}?level=unclassified&stream=stderr")).await;
    assert_eq!(stderr["entries"].as_array().unwrap().len(), 1);
    let (_, after) = read(&pool, &format!("{path}?after={}", page["nextCursor"])).await;
    assert_eq!(after["entries"][0]["line"], "plain stderr");
    assert_eq!(
        read(&pool, &format!("{path}?field=a%27&value=b")).await.0,
        StatusCode::CONFLICT
    );
    let (_, unknown) = read(
        &pool,
        &format!("/api/services/{}/runtime/logs", Uuid::new_v4()),
    )
    .await;
    assert!(unknown["entries"].is_null());
    // Repeated agent tails cannot rearchive a row after PostgreSQL cache eviction.
    sqlx::query("DELETE FROM runtime_logs WHERE instance_id=$1")
        .bind(instance)
        .execute(&pool)
        .await
        .unwrap();
    let mut observation = observation;
    observation["observedUnixMs"] = json!(now.timestamp_millis() + 1);
    call(
        &pool,
        "/api/agent/sync",
        json!({"version":platform_protocol::VERSION,"nodeId":nodes[0],"observations":[observation]}),
        Some(&"a".repeat(64)),
    )
    .await;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM runtime_logs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn shared_volumes_colocate_services_and_fence_replacements(pool: PgPool) {
    let (service, revision, nodes) = fixture(&pool).await;
    let request = json!({"operationId":Uuid::new_v4(),"project":"sandbox","environment":"development","name":"uploads","sizeGib":1});
    let (code, volume) = call(&pool, "/api/volumes", request.clone(), None).await;
    assert_eq!(code, StatusCode::OK);
    assert_eq!(call(&pool, "/api/volumes", request, None).await.1, volume);
    let attachment = json!({"id":volume["id"],"mountPath":"/data","readOnly":false});
    sqlx::query("UPDATE services SET spec=jsonb_set(jsonb_set(spec,'{volume}',$2),'{workload,replicas}','1') WHERE id=$1").bind(service).bind(&attachment).execute(&pool).await.unwrap();
    let deploy = |revision| json!({"operationId":Uuid::new_v4(),"revisionId":revision});
    let path = format!("/api/services/{service}/deployments");
    assert_eq!(
        call(&pool, &path, deploy(revision), None).await.0,
        StatusCode::CONFLICT,
        "legacy agents must not receive shared volume assignments"
    );
    sqlx::query("UPDATE nodes SET capabilities=ARRAY['shared-volumes-v1']")
        .execute(&pool)
        .await
        .unwrap();
    let (code, first) = call(&pool, &path, deploy(revision), None).await;
    assert_eq!(code, StatusCode::OK, "{first}");
    assert_eq!(
        call(&pool, &path, deploy(revision), None).await.0,
        StatusCode::CONFLICT,
        "replacement must wait for confirmed stop"
    );
    let owner: Uuid = sqlx::query_scalar("SELECT node_id FROM shared_volumes WHERE id=$1")
        .bind(volume["id"].as_str().unwrap().parse::<Uuid>().unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(owner, nodes[0]);
    let mut spec: Value = sqlx::query_scalar("SELECT spec FROM services WHERE id=$1")
        .bind(service)
        .fetch_one(&pool)
        .await
        .unwrap();
    spec["name"] = json!("file-browser");
    spec["volume"]["readOnly"] = json!(true);
    let (code, app) = call(
        &pool,
        "/api/services",
        json!({"operationId":Uuid::new_v4(),"buildOnCreate":false,"spec":spec}),
        None,
    )
    .await;
    assert_eq!(code, StatusCode::CREATED, "{app}");
    let appid = app["id"].as_str().unwrap().parse::<Uuid>().unwrap();
    call(
        &pool,
        &format!("/api/services/{appid}/builds"),
        json!({"operationId":Uuid::new_v4(),"noCache":false}),
        None,
    )
    .await;
    let b = control_plane::builds::claim(&pool).await.unwrap().unwrap();
    control_plane::builds::finish(
        &pool,
        &b,
        control_plane::builds::Completion::Succeeded {
            repository: "127.0.0.1:15000/platform/test".into(),
            digest: format!("sha256:{}", "b".repeat(64)).try_into().unwrap(),
        },
    )
    .await
    .unwrap();
    let rev: Uuid = sqlx::query_scalar("SELECT id FROM revisions WHERE build_id=$1")
        .bind(b.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let (code, second) = call(
        &pool,
        &format!("/api/services/{appid}/deployments"),
        deploy(rev),
        None,
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{second}");
    let second_owner: Uuid =
        sqlx::query_scalar("SELECT node_id FROM instances WHERE deployment_id=$1")
            .bind(second["id"].as_str().unwrap().parse::<Uuid>().unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(second_owner, owner);
    // Even an otherwise valid service cannot attach files across environment boundaries.
    spec["name"] = json!("other-env");
    spec["environment"] = json!("production");
    assert_eq!(
        call(
            &pool,
            "/api/services",
            json!({"operationId":Uuid::new_v4(),"buildOnCreate":false,"spec":spec}),
            None
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let (_,shadow)=call(&pool,"/api/environments",json!({"project":"sandbox","name":"shadow","parentId":sqlx::query_scalar::<_,Uuid>("SELECT environment_id FROM services WHERE id=$1").bind(service).fetch_one(&pool).await.unwrap()}),None).await;
    assert!(shadow["id"].is_string(), "{shadow}");
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM services WHERE environment_id=$1 AND spec ? 'volume'",
    )
    .bind(shadow["id"].as_str().unwrap().parse::<Uuid>().unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 0);
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn volume_file_rpc_checks_owner_permissions_and_attachment_versions(pool: PgPool) {
    let (service, _, nodes) = fixture(&pool).await;
    let (_, volume) = call(&pool,"/api/volumes",json!({"operationId":Uuid::new_v4(),"project":"sandbox","environment":"development","name":"browser-volume","sizeGib":1}),None).await;
    let volume: Uuid = volume["id"].as_str().unwrap().parse().unwrap();
    sqlx::query("UPDATE shared_volumes SET node_id=$2 WHERE id=$1")
        .bind(volume)
        .bind(nodes[0])
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE nodes SET capabilities=ARRAY['volume-files-v1']")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE services SET spec=jsonb_set(spec,'{volume}',$2) WHERE id=$1")
        .bind(service)
        .bind(json!({"id":volume,"mountPath":"/data","readOnly":true}))
        .execute(&pool)
        .await
        .unwrap();
    let token = "a".repeat(64);
    assert_eq!(
        call(
            &pool,
            "/api/agent/files/poll",
            json!({"nodeId":nodes[0]}),
            Some(&"b".repeat(64))
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let app = control_plane::router(pool.clone(), vec![]);
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!(
                    "/api/services/{service}/volume/files?path=test.txt"
                ))
                .header("host", "localhost")
                .header("content-type", "application/octet-stream")
                .body(Body::from("no"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert!(
        call(
            &pool,
            "/api/agent/files/poll",
            json!({"nodeId":nodes[0]}),
            Some(&token)
        )
        .await
        .1
        .is_null()
    );
    let pending = tokio::spawn(
        app.clone().oneshot(
            Request::builder()
                .uri(format!("/api/services/{service}/volume/files"))
                .header("host", "localhost")
                .body(Body::empty())
                .unwrap(),
        ),
    );
    let mut task = Value::Null;
    for _ in 0..30 {
        task = call(
            &pool,
            "/api/agent/files/poll",
            json!({"nodeId":nodes[0]}),
            Some(&token),
        )
        .await
        .1;
        if !task.is_null() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert_eq!(task["volumeId"], volume.to_string());
    assert_eq!(task["readOnly"], true);
    let result = json!({"nodeId":nodes[1],"id":task["id"],"result":{"kind":"listing","items":[],"cursor":null}});
    assert_eq!(
        call(&pool, "/api/agent/files/result", result, Some(&token))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    sqlx::query("UPDATE services SET version=version+1 WHERE id=$1")
        .bind(service)
        .execute(&pool)
        .await
        .unwrap();
    let result = json!({"nodeId":nodes[0],"id":task["id"],"result":{"kind":"listing","items":[],"cursor":null}});
    assert_eq!(
        call(&pool, "/api/agent/files/result", result, Some(&token))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        pending.await.unwrap().unwrap().status(),
        StatusCode::CONFLICT,
        "a stale attachment must not receive the result"
    );
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/api/services/{service}/volume/files?path=..%2Fsecret"
                ))
                .header("host", "localhost")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn recovery_is_only_authorized_after_promotion_and_for_capable_agents(pool: PgPool) {
    let (service, revision, nodes) = fixture(&pool).await;
    let (_, deployed) = call(
        &pool,
        &format!("/api/services/{service}/deployments"),
        json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
        None,
    )
    .await;
    let id = deployed["id"].as_str().unwrap().parse::<Uuid>().unwrap();
    let request = json!({"version":platform_protocol::VERSION,"nodeId":nodes[0],"observations":[],"capabilities":["recovery-v1"]});
    let token = "a".repeat(64);
    let (status, preparing) = call(&pool, "/api/agent/sync", request.clone(), Some(&token)).await;
    assert_eq!(status, StatusCode::OK);
    assert!(preparing["assignments"][0].get("recoveryAllowed").is_none());
    sqlx::query("UPDATE instances SET state='ready',observed_at=now() WHERE deployment_id=$1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    let (_, active) = call(&pool, "/api/agent/sync", request.clone(), Some(&token)).await;
    assert_eq!(active["assignments"][0]["recoveryAllowed"], true);
    let (_, configured) = call(
        &pool,
        "/api/agent/sync",
        json!({"version":platform_protocol::VERSION,"nodeId":nodes[0],"observations":[],"capabilities":["recovery-v1","recovery-v2"]}),
        Some(&token),
    )
    .await;
    assert!(
        configured["assignments"][0]
            .get("recoveryAllowed")
            .is_none()
    );
    assert_eq!(
        configured["assignments"][0]["recoveryPolicy"]["restartAttempts"],
        5
    );
    let (_, legacy) = call(
        &pool,
        "/api/agent/sync",
        json!({"version":platform_protocol::VERSION,"nodeId":nodes[0],"observations":[]}),
        Some(&token),
    )
    .await;
    assert!(
        legacy["assignments"][0].get("recoveryAllowed").is_none(),
        "old agents reject unknown fields"
    );
    call(
        &pool,
        &format!("/api/deployments/{id}/stop"),
        json!({}),
        None,
    )
    .await;
    let (_, stopped) = call(&pool, "/api/agent/sync", request, Some(&token)).await;
    assert_eq!(stopped["assignments"][0]["desiredState"], "stopped");
    assert!(stopped["assignments"][0].get("recoveryAllowed").is_none());
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn health_transitions_are_bounded_visible_and_auditable(pool: PgPool) {
    let (service, revision, nodes) = fixture(&pool).await;
    let (_, deployed) = call(
        &pool,
        &format!("/api/services/{service}/deployments"),
        json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
        None,
    )
    .await;
    let deployment: Uuid = deployed["id"].as_str().unwrap().parse().unwrap();
    sqlx::query("UPDATE instances SET state='ready',observed_at=now() WHERE deployment_id=$1")
        .bind(deployment)
        .execute(&pool)
        .await
        .unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    let instance: Uuid =
        sqlx::query_scalar("SELECT id FROM instances WHERE deployment_id=$1 AND node_id=$2")
            .bind(deployment)
            .bind(nodes[0])
            .fetch_one(&pool)
            .await
            .unwrap();
    let observed = chrono::Utc::now().timestamp_millis();
    let observation = |at| {
        json!({
            "instanceId":instance,
            "generation":1,
            "observedUnixMs":at,
            "state":"failed",
            "diagnostic":"crash_loop",
            "health":{
                "process":"exited",
                "startup":"pending",
                "readiness":"failing",
                "liveness":"passing",
                "recovery":{"phase":"exhausted","attempts":5}
            },
            "metrics":null,
            "logs":[]
        })
    };
    for at in [observed, observed + 1] {
        assert_eq!(
            call(
                &pool,
                "/api/agent/sync",
                json!({"version":platform_protocol::VERSION,"nodeId":nodes[0],"observations":[observation(at)],"capabilities":["recovery-v2"]}),
                Some(&"a".repeat(64)),
            )
            .await
            .0,
            StatusCode::OK
        );
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM instance_health_events WHERE instance_id=$1",
        )
        .bind(instance)
        .fetch_one(&pool)
        .await
        .unwrap(),
        1,
        "unchanged five-second reports must not grow history"
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT runtime_health FROM deployments WHERE id=$1")
            .bind(deployment)
            .fetch_one(&pool)
            .await
            .unwrap(),
        "degraded"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM audit_log WHERE action='recovery.budget_exhausted' AND target_id=$1",
        )
        .bind(deployment.to_string())
        .fetch_one(&pool)
        .await
        .unwrap(),
        1
    );
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn singleton_workers_wait_for_authenticated_current_generation_shutdown(pool: PgPool) {
    let (service, revision, nodes) = fixture(&pool).await;
    sqlx::query("UPDATE services SET spec=jsonb_set(jsonb_set(spec,'{workload}',((spec->'workload')-'port'-'readiness')||'{\"execution\":\"worker\",\"replicas\":1}'::jsonb),'{domains}','[]'::jsonb) WHERE id=$1")
        .bind(service).execute(&pool).await.unwrap();
    call(
        &pool,
        "/api/domains",
        json!({"hostname":"worker.example.com"}),
        None,
    )
    .await;
    for (path, body, expected) in [
        (
            "/api/domains/worker.example.com".to_string(),
            json!({"serviceId":service,"expectedVersion":1}),
            StatusCode::CONFLICT,
        ),
        (
            format!("/api/services/{service}/networking"),
            json!({"enabled":false,"port":3000,"expectedVersion":1}),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        let response = control_plane::router(pool.clone(), vec![])
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(path)
                    .header("host", "localhost:8080")
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            expected,
            "worker must not acquire HTTP routing through another API"
        );
    }
    let path = format!("/api/services/{service}/deployments");
    let request = json!({"operationId":Uuid::new_v4(),"revisionId":revision});
    let first = call(&pool, &path, request.clone(), None).await;
    assert_eq!(first.0, StatusCode::OK);
    assert_eq!(first, call(&pool, &path, request, None).await);
    let first_id: Uuid = first.1["id"].as_str().unwrap().parse().unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM instances WHERE deployment_id=$1")
        .bind(first_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0, "legacy nodes cannot run workers");
    sqlx::query("UPDATE nodes SET capabilities=ARRAY['workers-v1','recovery-v1'] WHERE id=$1")
        .bind(nodes[1])
        .execute(&pool)
        .await
        .unwrap();
    control_plane::runtime::reconcile(&pool).await.unwrap();
    let (old, node, slot): (Uuid, Uuid, i32) =
        sqlx::query_as("SELECT id,node_id,slot FROM instances WHERE deployment_id=$1")
            .bind(first_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(node, nodes[1]);
    let token = "a".repeat(64);
    let (_, legacy) = call(
        &pool,
        "/api/agent/sync",
        json!({"version":platform_protocol::VERSION,"nodeId":node,"observations":[]}),
        Some(&token),
    )
    .await;
    assert_eq!(legacy["assignments"], json!([]));
    let report = |node, generation, state| json!({"version":platform_protocol::VERSION,"nodeId":node,"capabilities":["workers-v1","recovery-v1"],"observations":[{"instanceId":old,"generation":generation,"state":state,"observedUnixMs":chrono::Utc::now().timestamp_millis(),"diagnostic":null,"metrics":null,"logs":[]}]});
    assert_eq!(
        call(
            &pool,
            "/api/agent/sync",
            report(node, 1, "ready"),
            Some(&token)
        )
        .await
        .0,
        StatusCode::OK
    );
    control_plane::runtime::reconcile(&pool).await.unwrap();
    let (_, second) = call(
        &pool,
        &path,
        json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
        None,
    )
    .await;
    let second_id: Uuid = second["id"].as_str().unwrap().parse().unwrap();
    assert_eq!(
        call(
            &pool,
            &path,
            json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
            None
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let (desired, generation): (String, i64) =
        sqlx::query_as("SELECT desired_state,generation FROM instances WHERE id=$1")
            .bind(old)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!((desired.as_str(), generation), ("stopped", 2));
    // Neither stale generations nor reports from another node may release ownership.
    call(
        &pool,
        "/api/agent/sync",
        report(node, 1, "stopped"),
        Some(&token),
    )
    .await;
    call(
        &pool,
        "/api/agent/sync",
        report(nodes[0], 2, "stopped"),
        Some(&token),
    )
    .await;
    sqlx::query("UPDATE nodes SET last_seen=now()-interval '1 hour' WHERE id=$1")
        .bind(node)
        .execute(&pool)
        .await
        .unwrap();
    for _ in 0..2 {
        control_plane::runtime::reconcile(&pool).await.unwrap();
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM instances WHERE deployment_id=$1")
        .bind(second_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0, "unknown old worker must block replacement");
    assert_eq!(
        call(
            &pool,
            "/api/agent/sync",
            report(node, 2, "stopped"),
            Some(&token)
        )
        .await
        .0,
        StatusCode::OK
    );
    let (a, b) = tokio::join!(
        control_plane::runtime::reconcile(&pool),
        control_plane::runtime::reconcile(&pool)
    );
    a.unwrap();
    b.unwrap();
    let allocations: Vec<(Uuid, i32)> =
        sqlx::query_as("SELECT node_id,slot FROM instances WHERE deployment_id=$1")
            .bind(second_id)
            .fetch_all(&pool)
            .await
            .unwrap();
    // The other capable node can win placement, but there is exactly one allocation.
    assert_eq!(allocations.len(), 1);
    assert!(allocations[0].1 == slot);
    call(
        &pool,
        &format!("/api/deployments/{second_id}/stop"),
        json!({}),
        None,
    )
    .await;
    let (_, third) = call(
        &pool,
        &path,
        json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
        None,
    )
    .await;
    let third_id: Uuid = third["id"].as_str().unwrap().parse().unwrap();
    call(
        &pool,
        &format!("/api/deployments/{third_id}/stop"),
        json!({}),
        None,
    )
    .await;
    control_plane::runtime::reconcile(&pool).await.unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM instances WHERE deployment_id=$1")
        .bind(third_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        count, 0,
        "cancelling a waiting deployment cannot start it later"
    );
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn remote_nodes_require_admission_then_use_the_same_assignment_protocol(pool: PgPool) {
    let (service, revision, _) = fixture(&pool).await;
    sqlx::query("UPDATE nodes SET cordoned=true")
        .execute(&pool)
        .await
        .unwrap();
    let config: control_plane::enrollment::Enrollment = serde_json::from_value(json!({
        "node_id":Uuid::now_v7(),"name":"remote-7","token":"b".repeat(64),
        "controller_url":"https://controller.local-paas:18443","cpu_millis":1000,
        "memory_mib":1400,"slots":4,"endpoint_base":21600,"failure_domain":"host-b","cordoned":true
    }))
    .unwrap();
    control_plane::enrollment::enroll(&pool, &config)
        .await
        .unwrap();
    let sync =
        json!({"version":platform_protocol::VERSION,"nodeId":config.node_id,"observations":[]});
    let (status, _) = call(&pool, "/api/agent/sync", sync.clone(), Some(&config.token)).await;
    assert_eq!(status, StatusCode::OK);
    let path = format!("/api/services/{service}/deployments");
    assert_eq!(
        call(
            &pool,
            &path,
            json!({"operationId":Uuid::now_v7(),"revisionId":revision}),
            None
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    // Admit one local node and the remote node for the two distinct replicas.
    sqlx::query("UPDATE nodes SET cordoned=false WHERE name='node-0'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(
            &pool,
            &format!("/api/nodes/{}/actions", config.node_id),
            json!({"operationId":Uuid::now_v7(),"action":"uncordon"}),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let (status, _) = call(
        &pool,
        &path,
        json!({"operationId":Uuid::now_v7(),"revisionId":revision}),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, response) = call(&pool, "/api/agent/sync", sync.clone(), Some(&config.token)).await;
    let assignments = response["assignments"].as_array().unwrap();
    assert_eq!(assignments.len(), 1);
    assert_eq!(assignments[0]["publishedPort"], 20000);
    assert!(
        assignments[0]["imageRepository"]
            .as_str()
            .unwrap()
            .starts_with("127.0.0.1:15000/platform/")
    );
    control_plane::enrollment::revoke(&pool, config.node_id)
        .await
        .unwrap();
    assert_eq!(
        call(&pool, "/api/agent/sync", sync, Some(&config.token))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn rejected_logs_preserve_heartbeats_health_and_valid_log_deduplication(pool: PgPool) {
    let (service, revision, nodes) = fixture(&pool).await;
    call(
        &pool,
        &format!("/api/services/{service}/deployments"),
        json!({"operationId":Uuid::new_v4(),"revisionId":revision}),
        None,
    )
    .await;
    let (instance, node): (Uuid, Uuid) = sqlx::query_as("SELECT id,node_id FROM instances LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE nodes SET last_seen=now()-interval '10 seconds' WHERE id=$1")
        .bind(node)
        .execute(&pool)
        .await
        .unwrap();
    let before: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT last_seen FROM nodes WHERE id=$1")
            .bind(node)
            .fetch_one(&pool)
            .await
            .unwrap();
    let valid = json!({"key":"c".repeat(64),"timestamp":"2026-10-23T20:00:00Z","stream":"stdout","line":"é🦀 [REDACTED]"});
    // The production redactor's 6,000-byte repeated-secret regression is covered
    // in node-agent. Exercise its former 20,000-byte output at the HTTP boundary.
    let mut oversized = valid.clone();
    oversized["line"] = json!("[REDACTED]".repeat(2000));
    let mut logs = vec![oversized];
    for (field, value) in [
        ("key", json!("short")),
        ("key", json!("\0".repeat(64))),
        ("timestamp", json!("invalid")),
        ("timestamp", json!("-005000-01-01T00:00:00Z")),
        ("stream", json!("invalid")),
        ("line", json!("invalid\0text")),
        ("line", json!(r#"{"message":"invalid\u0000text"}"#)),
        ("line", json!(r#"{"nested":[{"\u0000":"invalid"}]}"#)),
    ] {
        let mut invalid = valid.clone();
        invalid[field] = value;
        logs.push(invalid);
    }
    logs.push(valid.clone());
    let mut boundary = valid.clone();
    boundary["key"] = json!("d".repeat(64));
    boundary["line"] = json!("é".repeat(platform_protocol::MAX_LOG_LINE_BYTES / 2));
    logs.push(boundary);
    logs.resize(platform_protocol::MAX_LOG_ENTRIES, valid);
    let mut excess = logs[0].clone();
    excess["key"] = json!("e".repeat(64));
    excess["line"] = json!("beyond the entry count limit");
    logs.push(excess);
    let observed = chrono::Utc::now().timestamp_millis() - 1000;
    let observation = json!({
        "observedUnixMs":observed,"instanceId":instance,"generation":1,"state":"ready",
        "diagnostic":null,"metrics":{"cpuMillis":12.0,"memoryBytes":4096,"pids":3},
        "health":{"process":"running","startup":"passing","readiness":"passing","liveness":"not_configured","recovery":{"phase":"stable","attempts":0}},
        "logs":logs
    });
    let request =
        json!({"version":platform_protocol::VERSION,"nodeId":node,"observations":[observation]});
    assert_eq!(
        call(
            &pool,
            "/api/agent/sync",
            request.clone(),
            Some(&"b".repeat(64))
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let unchanged: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT last_seen FROM nodes WHERE id=$1")
            .bind(node)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(before, unchanged);
    let mut stale = request.clone();
    stale["observations"][0]["generation"] = json!(0);
    let mut foreign = request.clone();
    foreign["nodeId"] = json!(nodes.into_iter().find(|id| *id != node).unwrap());
    for fenced in [stale, foreign] {
        assert_eq!(
            call(&pool, "/api/agent/sync", fenced, Some(&"a".repeat(64)))
                .await
                .0,
            StatusCode::OK
        );
        let state: String = sqlx::query_scalar("SELECT state FROM instances WHERE id=$1")
            .bind(instance)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(state, "assigned");
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM runtime_log_keys")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }
    // A newer heartbeat with the same valid log keys exercises database-level
    // deduplication, rather than just the observation timestamp fence.
    for offset in [0, 1] {
        let mut request = request.clone();
        request["observations"][0]["observedUnixMs"] = json!(observed + offset);
        sqlx::query("UPDATE nodes SET last_seen=$2 WHERE id=$1")
            .bind(node)
            .bind(before)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            call(&pool, "/api/agent/sync", request, Some(&"a".repeat(64)))
                .await
                .0,
            StatusCode::OK
        );
        let after: chrono::DateTime<chrono::Utc> =
            sqlx::query_scalar("SELECT last_seen FROM nodes WHERE id=$1")
                .bind(node)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(after > before);
        let state: String = sqlx::query_scalar("SELECT state FROM instances WHERE id=$1")
            .bind(instance)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(state, "ready");
        let lines: Vec<String> =
            sqlx::query_scalar("SELECT line FROM runtime_logs ORDER BY entry_key")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            lines,
            vec![
                "é🦀 [REDACTED]".to_owned(),
                "é".repeat(platform_protocol::MAX_LOG_LINE_BYTES / 2)
            ]
        );
        let keys: i64 = sqlx::query_scalar("SELECT count(*) FROM runtime_log_keys")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            keys, 2,
            "rejected entries must not reserve deduplication keys"
        );
    }
    let health: (String, String) =
        sqlx::query_as("SELECT process,readiness FROM instance_health_events WHERE instance_id=$1")
            .bind(instance)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(health, ("running".into(), "passing".into()));
    let metrics: i64 =
        sqlx::query_scalar("SELECT count(*) FROM runtime_metrics WHERE instance_id=$1")
            .bind(instance)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(metrics, 2);
}
