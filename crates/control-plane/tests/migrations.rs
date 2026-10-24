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
