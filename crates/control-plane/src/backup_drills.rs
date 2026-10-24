//! Explicit opt-in drills against disposable canaries, never production services.
use crate::secrets;
use sqlx::{
    ConnectOptions, Connection, PgConnection, PgPool,
    postgres::{PgConnectOptions, PgSslMode},
};
use std::{path::Path, time::Duration};
use uuid::Uuid;

async fn canary(variable: &str) -> Option<(PgPool, Uuid)> {
    let id: Uuid = std::env::var(variable)
        .ok()?
        .parse()
        .expect("invalid canary ID");
    let pool = PgPool::connect(&std::env::var("DATABASE_URL").unwrap())
        .await
        .unwrap();
    let project: String = sqlx::query_scalar("SELECT p.name FROM services s JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id WHERE s.id=$1")
        .bind(id).fetch_one(&pool).await.unwrap();
    assert_eq!(
        project, "platform-storage-canary",
        "only disposable storage canaries may be used"
    );
    Some((pool, id))
}

async fn pg_tool(
    program: &str,
    port: i32,
    password: &str,
    database: &str,
    archive: &Path,
    restore: bool,
) -> Result<(), &'static str> {
    let mut command = tokio::process::Command::new(program);
    command
        .env_clear()
        .env("PGPASSWORD", password)
        .env("PGCONNECT_TIMEOUT", "5")
        .env(
            "PGOPTIONS",
            "-c statement_timeout=60000 -c lock_timeout=5000",
        )
        .args(["--host=127.0.0.1", "--username=postgres", "--no-password"])
        .arg(format!("--port={port}"))
        .arg(format!("--dbname={database}"))
        .kill_on_drop(true);
    if restore {
        command
            .args(["--exit-on-error", "--no-owner", "--no-privileges"])
            .arg(archive);
    } else {
        command.args(["--format=custom", "--file"]).arg(archive);
    }
    // Child stderr is deliberately not exposed: engine errors may include data.
    let output = tokio::time::timeout(Duration::from_secs(90), command.output())
        .await
        .map_err(|_| "PostgreSQL backup command timed out")?
        .map_err(|_| "PostgreSQL backup command could not start")?;
    if output.status.success() {
        Ok(())
    } else {
        Err("PostgreSQL backup command failed")
    }
}

#[tokio::test]
#[ignore = "requires PLATFORM_DATABASE_SMOKE_POSTGRES and disposable development database"]
async fn postgres_dump_restores_into_an_independent_database() {
    let Some((pool, id)) = canary("PLATFORM_DATABASE_SMOKE_POSTGRES").await else {
        return;
    };
    let (_, values) = secrets::own_values(&pool, id)
        .await
        .map_err(|_| "credential unavailable")
        .unwrap();
    let (port, database): (i32, String) = sqlx::query_as("SELECT n.endpoint_base+v.slot,s.spec->'workload'->>'database' FROM volumes v JOIN nodes n ON n.id=v.node_id JOIN services s ON s.id=v.id WHERE v.id=$1")
        .bind(id).fetch_one(&pool).await.unwrap();
    let password = &values["POSTGRES_PASSWORD"];
    let options = PgConnectOptions::new()
        .host("127.0.0.1")
        .port(port as u16)
        .username("postgres")
        .password(password)
        .database(&database)
        .ssl_mode(PgSslMode::Disable)
        .disable_statement_logging();
    let mut source = PgConnection::connect_with(&options)
        .await
        .map_err(|_| "canary connection failed")
        .unwrap();
    let suffix = Uuid::new_v4().simple().to_string();
    let table = format!("backup_canary_{suffix}");
    let restored_database = format!("restore_canary_{suffix}");
    // Private temporary archive; no credentials in URLs, argv, files or test output.
    let temporary = tempfile::tempdir().unwrap();
    let archive = tempfile::NamedTempFile::new_in(temporary.path()).unwrap();
    let dump = std::env::var("PLATFORM_PG_DUMP")
        .unwrap_or_else(|_| "/run/current-system/sw/bin/pg_dump".into());
    let restore = std::env::var("PLATFORM_PG_RESTORE")
        .unwrap_or_else(|_| "/run/current-system/sw/bin/pg_restore".into());
    let result: Result<(), &'static str> = async {
        sqlx::query(&format!(
            "CREATE TABLE public.{table}(id integer PRIMARY KEY, value text NOT NULL)"
        ))
        .execute(&mut source)
        .await
        .map_err(|_| "canary table creation failed")?;
        sqlx::query(&format!("INSERT INTO public.{table} VALUES(1,$1)"))
            .bind(&suffix)
            .execute(&mut source)
            .await
            .map_err(|_| "canary insert failed")?;
        pg_tool(&dump, port, password, &database, archive.path(), false).await?;
        sqlx::query(&format!("DROP TABLE public.{table}"))
            .execute(&mut source)
            .await
            .map_err(|_| "canary source removal failed")?;
        sqlx::query(&format!("CREATE DATABASE {restored_database}"))
            .execute(&mut source)
            .await
            .map_err(|_| "restore database creation failed")?;
        pg_tool(
            &restore,
            port,
            password,
            &restored_database,
            archive.path(),
            true,
        )
        .await?;
        let mut restored =
            PgConnection::connect_with(&options.clone().database(&restored_database))
                .await
                .map_err(|_| "restored database connection failed")?;
        let value: String =
            sqlx::query_scalar(&format!("SELECT value FROM public.{table} WHERE id=1"))
                .fetch_one(&mut restored)
                .await
                .map_err(|_| "restored row unavailable")?;
        restored
            .close()
            .await
            .map_err(|_| "restored connection close failed")?;
        if value != suffix {
            return Err("restored row differs from backup");
        }
        Ok(())
    }
    .await;
    let cleanup_database = sqlx::query(&format!(
        "DROP DATABASE IF EXISTS {restored_database} WITH (FORCE)"
    ))
    .execute(&mut source)
    .await;
    let cleanup_table = sqlx::query(&format!("DROP TABLE IF EXISTS public.{table}"))
        .execute(&mut source)
        .await;
    assert!(
        cleanup_database.is_ok() && cleanup_table.is_ok(),
        "canary cleanup failed"
    );
    result.unwrap();
}

#[tokio::test]
#[ignore = "requires PLATFORM_DATABASE_SMOKE_REDIS and disposable development database"]
async fn redis_serialized_key_restores_under_a_new_name() {
    use redis::IntoConnectionInfo;
    let Some((pool, id)) = canary("PLATFORM_DATABASE_SMOKE_REDIS").await else {
        return;
    };
    let (_, values) = secrets::own_values(&pool, id)
        .await
        .map_err(|_| "credential unavailable")
        .unwrap();
    let port: i32 = sqlx::query_scalar(
        "SELECT n.endpoint_base+v.slot FROM volumes v JOIN nodes n ON n.id=v.node_id WHERE v.id=$1",
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let info = format!("redis://127.0.0.1:{port}/0")
        .into_connection_info()
        .unwrap();
    let settings = info
        .redis_settings()
        .clone()
        .set_password(&values["REDIS_PASSWORD"]);
    let client = redis::Client::open(info.set_redis_settings(settings))
        .map_err(|_| "client invalid")
        .unwrap();
    let config = redis::AsyncConnectionConfig::new()
        .set_connection_timeout(Some(Duration::from_secs(5)))
        .set_response_timeout(Some(Duration::from_secs(5)));
    let mut connection = client
        .get_multiplexed_async_connection_with_config(&config)
        .await
        .map_err(|_| "canary connection failed")
        .unwrap();
    let key = format!("backup-canary:{}", Uuid::new_v4().simple());
    let restored = format!("{key}:restored");
    let result: Result<(), &'static str> = async {
        let _: () = redis::cmd("SET")
            .arg(&key)
            .arg("retained canary")
            .arg("EX")
            .arg(300)
            .arg("NX")
            .query_async(&mut connection)
            .await
            .map_err(|_| "canary insert failed")?;
        let payload: Vec<u8> = redis::cmd("DUMP")
            .arg(&key)
            .query_async(&mut connection)
            .await
            .map_err(|_| "canary export failed")?;
        let _: i64 = redis::cmd("DEL")
            .arg(&key)
            .query_async(&mut connection)
            .await
            .map_err(|_| "canary removal failed")?;
        let _: () = redis::cmd("RESTORE")
            .arg(&restored)
            .arg(300_000)
            .arg(payload)
            .query_async(&mut connection)
            .await
            .map_err(|_| "canary restore failed")?;
        let value: String = redis::cmd("GET")
            .arg(&restored)
            .query_async(&mut connection)
            .await
            .map_err(|_| "restored key unavailable")?;
        if value != "retained canary" {
            return Err("restored key differs from backup");
        }
        Ok(())
    }
    .await;
    let cleanup: redis::RedisResult<i64> = redis::cmd("DEL")
        .arg(&key)
        .arg(&restored)
        .query_async(&mut connection)
        .await;
    assert!(cleanup.is_ok(), "canary cleanup failed");
    result.unwrap();
}
