use sqlx::PgPool;

#[sqlx::test(migrations = false)]
#[ignore = "requires disposable PostgreSQL"]
async fn startup_never_creates_or_upgrades_the_database(pool: PgPool) {
    assert!(control_plane::check_migrations(&pool).await.is_err());
    let absent: bool = sqlx::query_scalar("SELECT to_regclass('public._sqlx_migrations') IS NULL")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(absent);
    control_plane::migrate(&pool).await.unwrap();
    control_plane::check_migrations(&pool).await.unwrap();
    sqlx::query("UPDATE _sqlx_migrations SET checksum='\\x00'::bytea WHERE version=(SELECT max(version) FROM _sqlx_migrations)")
        .execute(&pool).await.unwrap();
    assert!(control_plane::check_migrations(&pool).await.is_err());
}

#[sqlx::test(migrations = false)]
#[ignore = "requires disposable PostgreSQL"]
async fn breaking_contract_refuses_existing_state_without_mutating_it(pool: PgPool) {
    let mut before = sqlx::migrate!("./migrations");
    before.migrations = before
        .migrations
        .iter()
        .filter(|m| m.version < 27)
        .cloned()
        .collect::<Vec<_>>()
        .into();
    before.run(&pool).await.unwrap();
    sqlx::query("INSERT INTO host_metric_samples(host_id,timestamp,sample) VALUES ('old-host',now(),'{\"cpu_percent\":42}')")
        .execute(&pool).await.unwrap();
    let error = control_plane::migrate(&pool).await.unwrap_err();
    assert!(
        error
            .to_string()
            .contains("requires a fresh platform database")
    );
    let value: serde_json::Value =
        sqlx::query_scalar("SELECT sample FROM host_metric_samples WHERE host_id='old-host'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(value, serde_json::json!({"cpu_percent":42}));
    let applied: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM _sqlx_migrations WHERE version=27)")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!applied);
}
