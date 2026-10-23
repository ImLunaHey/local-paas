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
        json!({"build_on_create":false,"operation_id":Uuid::new_v4(),"spec":spec}),
        None,
    )
    .await;
    let service = s["id"].as_str().unwrap().parse::<Uuid>().unwrap();
    call(
        pool,
        &format!("/api/services/{service}/builds"),
        json!({"operation_id":Uuid::new_v4(),"no_cache":false}),
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
    let req = json!({"operation_id":Uuid::new_v4(),"revision_id":revision});
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
        json!({"operation_id":Uuid::new_v4(),"revision_id":revision}),
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
async fn node_identity_and_generations_fence_observations(pool: PgPool) {
    let (service, revision, nodes) = fixture(&pool).await;
    call(
        &pool,
        &format!("/api/services/{service}/deployments"),
        json!({"operation_id":Uuid::new_v4(),"revision_id":revision}),
        None,
    )
    .await;
    let request = json!({"version":1,"node_id":nodes[0],"observations":[]});
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
    let id = r["assignments"][0]["instance_id"]
        .as_str()
        .unwrap()
        .parse::<Uuid>()
        .unwrap();
    let observation = json!({"observed_unix_ms":chrono::Utc::now().timestamp_millis(),"instance_id":id,"generation":0,"state":"ready","diagnostic":null,"metrics":null,"logs":[]});
    call(
        &pool,
        "/api/agent/sync",
        json!({"version":1,"node_id":nodes[0],"observations":[observation]}),
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
    let observation = json!({"observed_unix_ms":chrono::Utc::now().timestamp_millis(),"instance_id":id,"generation":1,"state":"ready","diagnostic":null,"metrics":{"cpu_millis":12.0,"memory_bytes":4096,"pids":3},"logs":[log]});
    let req = json!({"version":1,"node_id":nodes[0],"observations":[observation]});
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
        json!({"operation_id":Uuid::new_v4(),"revision_id":revision}),
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
    let observation = json!({"instance_id":instance,"generation":1,"observed_unix_ms":now.timestamp_millis(),"state":"ready","diagnostic":null,"metrics":null,"logs":[
        {"key":"a".repeat(64),"timestamp":now.to_rfc3339(),"stream":"stdout","line":"{\"level\":50,\"msg\":\"Request failed\",\"request\":{\"id\":\"abc\"}}"},
        {"key":"b".repeat(64),"timestamp":now.to_rfc3339(),"stream":"stderr","line":"plain stderr"}
    ]});
    assert_eq!(
        call(
            &pool,
            "/api/agent/sync",
            json!({"version":1,"node_id":nodes[0],"observations":[observation.clone()]}),
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
    let (_, after) = read(&pool, &format!("{path}?after={}", page["next_cursor"])).await;
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
    observation["observed_unix_ms"] = json!(now.timestamp_millis() + 1);
    call(
        &pool,
        "/api/agent/sync",
        json!({"version":1,"node_id":nodes[0],"observations":[observation]}),
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
    let request = json!({"operation_id":Uuid::new_v4(),"project":"sandbox","environment":"development","name":"uploads","size_gib":1});
    let (code, volume) = call(&pool, "/api/volumes", request.clone(), None).await;
    assert_eq!(code, StatusCode::OK);
    assert_eq!(call(&pool, "/api/volumes", request, None).await.1, volume);
    let attachment = json!({"id":volume["id"],"mount_path":"/data","read_only":false});
    sqlx::query("UPDATE services SET spec=jsonb_set(jsonb_set(spec,'{volume}',$2),'{workload,replicas}','1') WHERE id=$1").bind(service).bind(&attachment).execute(&pool).await.unwrap();
    let deploy = |revision| json!({"operation_id":Uuid::new_v4(),"revision_id":revision});
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
    spec["volume"]["read_only"] = json!(true);
    let (code, app) = call(
        &pool,
        "/api/services",
        json!({"operation_id":Uuid::new_v4(),"build_on_create":false,"spec":spec}),
        None,
    )
    .await;
    assert_eq!(code, StatusCode::CREATED, "{app}");
    let appid = app["id"].as_str().unwrap().parse::<Uuid>().unwrap();
    call(
        &pool,
        &format!("/api/services/{appid}/builds"),
        json!({"operation_id":Uuid::new_v4(),"no_cache":false}),
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
            json!({"operation_id":Uuid::new_v4(),"build_on_create":false,"spec":spec}),
            None
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let (_,shadow)=call(&pool,"/api/environments",json!({"project":"sandbox","name":"shadow","parent_id":sqlx::query_scalar::<_,Uuid>("SELECT environment_id FROM services WHERE id=$1").bind(service).fetch_one(&pool).await.unwrap()}),None).await;
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
