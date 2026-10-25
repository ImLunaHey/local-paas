use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn service_configuration_assigns_only_registered_available_domains(pool: PgPool) {
    let (_, _, id) = fixture(&pool).await;
    let (_, current) = request(&pool, "GET", &format!("/api/services/{id}"), json!(null)).await;
    let mut spec = current["spec"].clone();
    spec["domains"] = json!(["canary.example.com"]);
    let change = json!({"operationId":Uuid::new_v4(),"expectedVersion":1,"spec":spec});
    assert_eq!(
        request(&pool, "PUT", &format!("/api/services/{id}"), change.clone())
            .await
            .0,
        409
    );
    assert_eq!(
        request(
            &pool,
            "POST",
            "/api/domains",
            json!({"hostname":"canary.example.com"})
        )
        .await
        .0,
        200
    );
    assert_eq!(
        request(&pool, "PUT", &format!("/api/services/{id}"), change)
            .await
            .0,
        200
    );
    let assigned: Uuid =
        sqlx::query_scalar("SELECT service_id FROM domains WHERE hostname='canary.example.com'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(assigned, id);
    spec["name"] = json!("another-service");
    assert_eq!(
        request(
            &pool,
            "POST",
            "/api/services",
            json!({"operationId":Uuid::new_v4(),"buildOnCreate":false,"spec":spec})
        )
        .await
        .0,
        409
    );
    assert_eq!(
        request(
            &pool,
            "PUT",
            "/api/domains/canary.example.com",
            json!({"serviceId":null,"expectedVersion":2})
        )
        .await
        .0,
        200
    );
    let (_, saved) = request(&pool, "GET", &format!("/api/services/{id}"), json!(null)).await;
    assert_eq!(saved["spec"]["domains"], json!([]));
    assert_eq!(saved["version"], 3);
}
async fn request(pool: &PgPool, method: &str, path: &str, body: Value) -> (u16, Value) {
    let response = control_plane::router(pool.clone(), vec![])
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("Host", "localhost:8080")
                .header("Content-Type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status().as_u16();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
async fn fixture(pool: &PgPool) -> (Uuid, Uuid, Uuid) {
    let (status, project) = request(
        pool,
        "POST",
        "/api/projects",
        json!({"name":"project-canary"}),
    )
    .await;
    assert_eq!(status, 200);
    let project: Uuid = project["id"].as_str().unwrap().parse().unwrap();
    let env: Uuid =
        sqlx::query_scalar("SELECT id FROM environments WHERE project_id=$1 AND name='production'")
            .bind(project)
            .fetch_one(pool)
            .await
            .unwrap();
    let mut spec: Value =
        serde_json::from_str(include_str!("../../../examples/oci-service.json")).unwrap();
    spec["project"] = json!("project-canary");
    spec["environment"] = json!("production");
    spec["name"] = json!("web");
    spec["secrets"] = json!([]);
    let (status, service) = request(
        pool,
        "POST",
        "/api/services",
        json!({"buildOnCreate":false,"operationId":Uuid::new_v4(),"spec":spec}),
    )
    .await;
    assert_eq!(status, 201);
    (
        project,
        env,
        service["id"].as_str().unwrap().parse().unwrap(),
    )
}
#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn shadow_environment_is_project_scoped_and_does_not_start_workloads(pool: PgPool) {
    let (project, env, service) = fixture(&pool).await;
    let (status, shadow) = request(
        &pool,
        "POST",
        "/api/environments",
        json!({"project":"project-canary","name":"preview","parentId":env}),
    )
    .await;
    assert_eq!(status, 200);
    let child: Uuid = shadow["id"].as_str().unwrap().parse().unwrap();
    let spec: Value = sqlx::query_scalar("SELECT spec FROM services WHERE environment_id=$1")
        .bind(child)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(spec["environment"], "preview");
    assert_eq!(spec["name"], "web");
    assert_eq!(spec["domains"], json!([]));
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM deployments")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(rows, 0);
    let (status, _) = request(
        &pool,
        "POST",
        "/api/environments",
        json!({"project":"unrelated","name":"preview","parentId":env}),
    )
    .await;
    assert_eq!(status, 409);
    let (status, details) = request(
        &pool,
        "GET",
        &format!("/api/projects/{project}"),
        Value::Null,
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(details["environments"].as_array().unwrap().len(), 3);
    let (_, audit) = request(
        &pool,
        "GET",
        &format!("/api/audit?project={project}"),
        Value::Null,
    )
    .await;
    assert!(
        audit["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["action"] == "services.insert" && e["targetId"] == service.to_string())
    );
    assert!(
        sqlx::query("DELETE FROM audit_log")
            .execute(&pool)
            .await
            .is_err()
    );
    let (_, audit) = request(&pool, "GET", "/api/audit?outcome=failed", Value::Null).await;
    assert!(
        audit["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["action"] == "environment.create")
    );
}
#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL and dedicated OpenBao configuration"]
async fn secret_shadow_overrides_and_snapshots_remain_immutable(pool: PgPool) {
    if std::env::var_os("OPENBAO_ADDR").is_none() {
        return;
    }
    let (_, env, service) = fixture(&pool).await;
    let secret_path = format!("/api/services/{service}/secrets");
    let parent_value = Uuid::new_v4().to_string();
    let (status, _) = request(
        &pool,
        "PUT",
        &secret_path,
        json!({"name":"DATABASE_URL","value":parent_value,"expectedVersion":0}),
    )
    .await;
    assert_eq!(status, 200);
    let (_, shadow) = request(
        &pool,
        "POST",
        "/api/environments",
        json!({"project":"project-canary","name":"preview","parentId":env}),
    )
    .await;
    let child_env: Uuid = shadow["id"].as_str().unwrap().parse().unwrap();
    let child: Uuid =
        sqlx::query_scalar("SELECT id FROM services WHERE environment_id=$1 AND name='web'")
            .bind(child_env)
            .fetch_one(&pool)
            .await
            .unwrap();
    let (_, metadata) = request(
        &pool,
        "GET",
        &format!("/api/services/{child}/secrets"),
        Value::Null,
    )
    .await;
    assert!(
        metadata["names"]
            .as_array()
            .unwrap()
            .contains(&json!("DATABASE_URL"))
    );
    assert!(!metadata.to_string().contains(&parent_value));
    let refs = control_plane::secrets::references(&pool, child)
        .await
        .unwrap_or_else(|_| panic!("secret references unavailable"));
    let first = control_plane::secrets::snapshot(&pool, child, &refs)
        .await
        .unwrap_or_else(|_| panic!("snapshot failed"))
        .unwrap();
    let override_value = Uuid::new_v4().to_string();
    let (status, _) = request(
        &pool,
        "PUT",
        &format!("/api/services/{child}/secrets"),
        json!({"name":"DATABASE_URL","value":override_value,"expectedVersion":0}),
    )
    .await;
    assert_eq!(status, 200);
    let second = control_plane::secrets::snapshot(&pool, child, &refs)
        .await
        .unwrap_or_else(|_| panic!("snapshot failed"))
        .unwrap();
    assert!(second > first);
    let bao = control_plane::secrets::Bao::new().unwrap_or_else(|_| panic!("OpenBao unavailable"));
    for (version, expected) in [
        (first, parent_value.as_str()),
        (second, override_value.as_str()),
    ] {
        let bundle = bao
            .call(
                reqwest::Method::GET,
                &format!("platform/data/workloads/{child_env}/{child}/snapshots?version={version}"),
                None,
                None,
            )
            .await
            .unwrap_or_else(|_| panic!("snapshot unavailable"));
        assert!(bundle["data"]["data"]["DATABASE_URL"].as_str() == Some(expected));
    }
    let (_, audit) = request(&pool, "GET", "/api/audit", Value::Null).await;
    assert!(
        !audit.to_string().contains(&parent_value) && !audit.to_string().contains(&override_value)
    );
    let (status, _) = request(
        &pool,
        "POST",
        "/api/agent/secrets",
        json!({"nodeId":Uuid::new_v4(),"instanceId":Uuid::new_v4(),"generation":1}),
    )
    .await;
    assert_eq!(status, 401);
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn audit_records_actions_but_not_http_traffic(pool: PgPool) {
    let (project, _, service) = fixture(&pool).await;
    let count = || sqlx::query_scalar::<_, i64>("SELECT count(*) FROM audit_log");
    let before = count().fetch_one(&pool).await.unwrap();
    for path in ["/api/health", "/api/audit", "/api/projects", "/api/missing"] {
        request(&pool, "GET", path, Value::Null).await;
    }
    request(&pool, "POST", "/api/agent/sync", json!({})).await;
    request(&pool, "POST", "/api/specs/validate", json!({})).await;
    assert_eq!(count().fetch_one(&pool).await.unwrap(), before);
    // Earlier request traffic remains append-only, but is excluded from every audit page.
    sqlx::query("INSERT INTO audit_log(actor,action,outcome,target_type) VALUES('legacy','GET /api/health','succeeded','request')")
        .execute(&pool).await.unwrap();
    let (status, page) = request(&pool, "GET", "/api/audit", Value::Null).await;
    assert_eq!(status, 200);
    assert!(
        page["entries"]
            .as_array()
            .unwrap()
            .iter()
            .all(|entry| entry["targetType"] != "request")
    );
    let (status, page) = request(
        &pool,
        "GET",
        &format!("/api/audit?project={project}&action=service.create&outcome=succeeded"),
        Value::Null,
    )
    .await;
    assert_eq!(status, 200);
    // Creation has no path ID; the committed record supplies the project scope.
    assert!(page["entries"].as_array().unwrap().is_empty());
    let (_, page) = request(
        &pool,
        "GET",
        &format!("/api/audit?project={project}&action=services.insert"),
        Value::Null,
    )
    .await;
    assert!(
        page["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["targetId"] == service.to_string())
    );
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn rename_updates_current_specs_preserves_ids_and_checks_stale_names(pool: PgPool) {
    let (project, env, service) = fixture(&pool).await;
    let path = format!("/api/projects/{project}");
    let (status, _) = request(
        &pool,
        "PUT",
        &path,
        json!({"name":"renamed-canary","expectedName":"project-canary"}),
    )
    .await;
    assert_eq!(status, 200);
    let (status, current) = request(
        &pool,
        "GET",
        &format!("/api/services/{service}"),
        Value::Null,
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(current["spec"]["project"], "renamed-canary");
    let env_after: Uuid = sqlx::query_scalar("SELECT environment_id FROM services WHERE id=$1")
        .bind(service)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(env, env_after);
    let original: Value = sqlx::query_scalar("SELECT registered_spec FROM services WHERE id=$1")
        .bind(service)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(original["project"], "project-canary");
    let (status, _) = request(
        &pool,
        "PUT",
        &path,
        json!({"name":"overwritten","expectedName":"project-canary"}),
    )
    .await;
    assert_eq!(status, 409);
    let (_, results) = request(&pool, "GET", "/api/search?q=renamed-canary", Value::Null).await;
    assert_eq!(results["items"].as_array().unwrap().len(), 2);
    let (_, overview) = request(&pool, "GET", "/api/overview", Value::Null).await;
    assert_eq!(overview["summary"]["services"], 1);
    assert_eq!(overview["summary"]["readyInstances"], 0);
    assert_eq!(overview["deployments"], json!([]));
    let (status, hosts) = request(&pool, "GET", "/api/hosts", Value::Null).await;
    assert_eq!(status, 200);
    assert_eq!(hosts["nodes"], json!([]));
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn global_domains_normalize_reassign_and_audit_without_claiming_live_routing(pool: PgPool) {
    let (_, _, service) = fixture(&pool).await;
    let (status, _) = request(
        &pool,
        "POST",
        "/api/domains",
        json!({"hostname":"HTTPS://bad.example"}),
    )
    .await;
    assert_eq!(status, 409);
    let (status, _) = request(
        &pool,
        "POST",
        "/api/domains",
        json!({"hostname":" App.Example.COM. "}),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(
        request(
            &pool,
            "POST",
            "/api/domains",
            json!({"hostname":"app.example.com"})
        )
        .await
        .0,
        409
    );
    let path = "/api/domains/app.example.com";
    assert_eq!(
        request(
            &pool,
            "PUT",
            path,
            json!({"serviceId":service,"expectedVersion":1})
        )
        .await
        .0,
        200
    );
    assert_eq!(
        request(
            &pool,
            "PUT",
            path,
            json!({"serviceId":null,"expectedVersion":1})
        )
        .await
        .0,
        409
    );
    let (_, domains) = request(&pool, "GET", "/api/domains", Value::Null).await;
    assert!(domains["items"][0]["acknowledgedGeneration"].is_null());
    assert_eq!(domains["items"][0]["serviceId"], json!(service));
    assert_eq!(domains["items"][0]["status"], "waiting-deployment");
    assert_eq!(
        request(
            &pool,
            "PUT",
            path,
            json!({"serviceId":null,"expectedVersion":2})
        )
        .await
        .0,
        200
    );
    let audit:Value=sqlx::query_scalar("SELECT details FROM audit_log WHERE target_type='domains' AND action='domains.update' ORDER BY sequence DESC LIMIT 1").fetch_one(&pool).await.unwrap();
    assert_eq!(audit["hostname"], "app.example.com");
    assert_eq!(audit["previous_service_id"], json!(service));
    assert!(audit["serviceId"].is_null());
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn private_url_auto_allocation_preserves_existing_url_and_disables_cleanly(pool: PgPool) {
    let (_, _, service) = fixture(&pool).await;
    let path = format!("/api/services/{service}/networking");
    let (_, before) = request(&pool, "GET", &path, Value::Null).await;
    let (status, saved) = request(
        &pool,
        "PUT",
        &path,
        json!({"enabled":true,"port":3000,"expectedVersion":1}),
    )
    .await;
    if before["available"].as_array().unwrap().is_empty() {
        assert_eq!(status, 409);
        let version: i32 = sqlx::query_scalar("SELECT version FROM services WHERE id=$1")
            .bind(service)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(version, 1);
        return;
    }
    assert_eq!(status, 200);
    let (status, retry) = request(
        &pool,
        "PUT",
        &path,
        json!({"enabled":true,"port":3000,"expectedVersion":2}),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(saved["url"], retry["url"]);
    assert_eq!(
        request(
            &pool,
            "PUT",
            &path,
            json!({"enabled":false,"port":3000,"expectedVersion":3})
        )
        .await
        .0,
        200
    );
    let (_, after) = request(&pool, "GET", &path, Value::Null).await;
    assert!(after["authority"].is_null());
}
