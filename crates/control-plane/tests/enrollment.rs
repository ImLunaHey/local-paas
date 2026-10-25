use control_plane::enrollment::{Enrollment, enroll, revoke};
use sqlx::PgPool;
use uuid::Uuid;
fn input() -> Enrollment {
    serde_json::from_value(serde_json::json!({"node_id":Uuid::now_v7(),"name":"remote-4","token":"a".repeat(64),"controller_url":"https://controller.local-paas:18443","cpu_millis":1000,"memory_mib":1400,"slots":4,"endpoint_base":21300,"failure_domain":"physical-b","cordoned":true})).unwrap()
}
#[test]
fn rejects_invalid_capacity_identity_and_remote_admission() {
    let mut config = input();
    assert!(config.validate().is_ok());
    config.cordoned = false;
    assert!(config.validate().is_err());
    config.cordoned = true;
    config.endpoint_base = 21301;
    assert!(config.validate().is_err());
    config.endpoint_base = 21300;
    config.memory_mib = i32::MAX;
    assert!(config.validate().is_err());
    config.memory_mib = 1400;
    config.failure_domain = "unspecified".into();
    assert!(config.validate().is_err());
}
#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn retries_collisions_audit_and_revocation(pool: PgPool) {
    let config = input();
    enroll(&pool, &config).await.unwrap();
    enroll(&pool, &config).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM audit_log WHERE action='node.enroll'")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
    assert!(
        sqlx::query_scalar::<_, bool>("SELECT cordoned FROM nodes WHERE id=$1")
            .bind(config.node_id)
            .fetch_one(&pool)
            .await
            .unwrap()
    );
    let details: serde_json::Value =
        sqlx::query_scalar("SELECT details FROM audit_log WHERE action='node.enroll'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!details.to_string().contains(&config.token));
    let mut collision = input();
    collision.name = "different-node".into();
    assert!(enroll(&pool, &collision).await.is_err());
    collision.endpoint_base = 21400;
    collision.name = config.name.clone();
    assert!(enroll(&pool, &collision).await.is_err());
    sqlx::query("UPDATE nodes SET cordoned=false WHERE id=$1")
        .bind(config.node_id)
        .execute(&pool)
        .await
        .unwrap();
    enroll(&pool, &config).await.unwrap();
    assert!(
        !sqlx::query_scalar::<_, bool>("SELECT cordoned FROM nodes WHERE id=$1")
            .bind(config.node_id)
            .fetch_one(&pool)
            .await
            .unwrap()
    );
    revoke(&pool, config.node_id).await.unwrap();
    revoke(&pool, config.node_id).await.unwrap();
    assert!(
        sqlx::query_scalar::<_, bool>(
            "SELECT cordoned AND token_hash='' AND last_seen IS NULL FROM nodes WHERE id=$1"
        )
        .bind(config.node_id)
        .fetch_one(&pool)
        .await
        .unwrap()
    );
    assert!(enroll(&pool, &config).await.is_err()); // A retry cannot undo revocation.
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM audit_log WHERE action='node.revoke'")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn organization_ownership_is_validated_and_part_of_node_identity(pool: PgPool) {
    sqlx::query("CREATE TABLE organization (id text PRIMARY KEY)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO organization(id) VALUES('organization-a')")
        .execute(&pool)
        .await
        .unwrap();
    let mut config = input();
    config.organization_id = Some("missing".into());
    assert!(enroll(&pool, &config).await.is_err());
    config.organization_id = Some("organization-a".into());
    enroll(&pool, &config).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, Option<String>>("SELECT organization_id FROM nodes WHERE id=$1")
            .bind(config.node_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some("organization-a".into())
    );
    config.organization_id = None;
    assert!(enroll(&pool, &config).await.is_err());
}
#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires disposable PostgreSQL"]
async fn concurrent_enrollment_reserves_ports_once(pool: PgPool) {
    let a = input();
    let mut b = input();
    b.name = "second".into();
    let (first, second) = tokio::join!(enroll(&pool, &a), enroll(&pool, &b));
    assert_ne!(first.is_ok(), second.is_ok());
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM nodes")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
}
