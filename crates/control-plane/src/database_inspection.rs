//! Fixed, read-only engine queries. No user SQL, row values or raw INFO output.
use crate::{ApiError, Service, secrets};
use axum::{
    Json,
    extract::{Path, Query, State},
};
use platform_domain::Workload;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{
    ConnectOptions, Connection, PgConnection, PgPool,
    postgres::{PgConnectOptions, PgSslMode},
    types::Json as DbJson,
};
use std::{collections::BTreeMap, time::Duration};
use tokio::sync::Semaphore;
use uuid::Uuid;

static INSPECTIONS: Semaphore = Semaphore::const_new(4);
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct Inspect {
    table: Option<u32>,
}

pub async fn get(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Query(query): Query<Inspect>,
) -> Result<Json<Value>, ApiError> {
    let _permit = INSPECTIONS
        .try_acquire()
        .map_err(|_| ApiError::Unavailable("database inspection is busy; retry shortly"))?;
    let service: Service = sqlx::query_as("SELECT * FROM services WHERE id=$1")
        .bind(id)
        .fetch_optional(&pool)
        .await?
        .ok_or(ApiError::NotFound)?;
    if !service.spec.workload.is_database() {
        return Err(ApiError::Conflict("inspection requires a database service"));
    }
    let port: i32 = sqlx::query_scalar("SELECT n.endpoint_base+v.slot FROM volumes v JOIN nodes n ON n.id=v.node_id WHERE v.id=$1 AND n.last_seen>now()-interval '30 seconds' AND EXISTS(SELECT 1 FROM deployments d JOIN instances i ON i.deployment_id=d.id WHERE d.service_id=v.id AND d.status='active' AND i.state='ready' AND i.observed_at>now()-interval '30 seconds')").bind(id).fetch_optional(&pool).await?.ok_or(ApiError::Conflict("deploy the database and wait for readiness to inspect it"))?;
    if ![21000..21004, 21100..21104, 21200..21204]
        .iter()
        .any(|r| r.contains(&port))
    {
        return Err(ApiError::Conflict("invalid database endpoint"));
    }
    // Reading metadata never creates or rotates a database credential.
    let (_, values) = secrets::own_values(&pool, id).await?;
    let password =
        values
            .get(service.spec.workload.database_secret())
            .ok_or(ApiError::Conflict(
                "restore the database credential in OpenBao before inspecting it",
            ))?;
    let value = tokio::time::timeout(Duration::from_secs(8), async {
        match &service.spec.workload {
            Workload::PostgresService { database, .. } => {
                let options = PgConnectOptions::new()
                    .host("127.0.0.1")
                    .port(port as u16)
                    .username("postgres")
                    .password(password)
                    .database(database)
                    .ssl_mode(PgSslMode::Disable)
                    .application_name("platform-inspector")
                    .options([
                        ("default_transaction_read_only", "on"),
                        ("statement_timeout", "2000"),
                        ("lock_timeout", "500"),
                    ])
                    .disable_statement_logging();
                let mut connection = PgConnection::connect_with(&options)
                    .await
                    .map_err(|_| unavailable())?;
                let result = postgres(&mut connection, query.table)
                    .await
                    .map_err(|_| unavailable());
                let _ = connection.close().await;
                result
            }
            Workload::RedisService { .. } if query.table.is_none() => {
                redis(port as u16, password).await
            }
            _ => Err(ApiError::Conflict(
                "table inspection is only available for PostgreSQL",
            )),
        }
    })
    .await
    .map_err(|_| {
        ApiError::Unavailable("database inspection timed out; retry when the database is available")
    })??;
    Ok(Json(value))
}
fn unavailable() -> ApiError {
    ApiError::Unavailable("could not inspect the database; check its health and OpenBao credential")
}

async fn postgres(conn: &mut PgConnection, table: Option<u32>) -> Result<Value, sqlx::Error> {
    // pg_catalog search_path avoids user-defined objects shadowing built-in functions.
    sqlx::query("SET search_path TO pg_catalog")
        .execute(&mut *conn)
        .await?;
    let stats: DbJson<Value> = sqlx::query_scalar(r#"SELECT jsonb_build_object(
        'database',current_database(),'sizeBytes',pg_database_size(current_database()),
        'connections',(SELECT count(*) FROM pg_stat_activity WHERE datid=d.datid AND pid<>pg_backend_pid()),
        'activeConnections',(SELECT count(*) FROM pg_stat_activity WHERE datid=d.datid AND pid<>pg_backend_pid() AND state='active'),
        'commits',xact_commit,'rollbacks',xact_rollback,'deadlocks',deadlocks,
        'cacheHitPercent',round(100.0*blks_hit/nullif(blks_hit::numeric+blks_read,0),2),
        'statsReset',stats_reset) FROM pg_stat_database d WHERE datname=current_database()"#).fetch_one(&mut *conn).await?;
    let mut tables: Vec<DbJson<Value>> = sqlx::query_scalar(r#"SELECT jsonb_build_object(
        'id',c.oid::bigint,'schema',n.nspname,'name',c.relname,
        'kind',CASE c.relkind WHEN 'p' THEN 'partitioned table' WHEN 'm' THEN 'materialized view' ELSE 'table' END,
        'estimatedRows',CASE WHEN c.reltuples<0 THEN NULL ELSE c.reltuples::bigint END,
        'tableBytes',pg_table_size(c.oid),'indexBytes',pg_indexes_size(c.oid))
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind IN ('r','p','m') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
        ORDER BY n.nspname,c.relname LIMIT 201"#).fetch_all(&mut *conn).await?;
    let truncated = tables.len() > 200;
    tables.truncate(200);
    let detail = if let Some(oid) = table {
        let selected: Option<DbJson<Value>>=sqlx::query_scalar(r#"SELECT jsonb_build_object('id',c.oid::bigint,'schema',n.nspname,'name',c.relname)
            FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid::bigint=$1 AND c.relkind IN ('r','p','m') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'"#).bind(i64::from(oid)).fetch_optional(&mut *conn).await?;
        if let Some(mut selected) = selected {
            let columns: Vec<DbJson<Value>>=sqlx::query_scalar(r#"SELECT jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'nullable',NOT a.attnotnull,'primaryKey',EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=a.attrelid AND i.indisprimary AND a.attnum=ANY(i.indkey)),'generated',a.attgenerated<>'','identity',a.attidentity<>'') FROM pg_attribute a WHERE a.attrelid::bigint=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum LIMIT 1600"#).bind(i64::from(oid)).fetch_all(&mut *conn).await?;
            let mut indexes: Vec<DbJson<Value>>=sqlx::query_scalar(r#"SELECT jsonb_build_object('name',c.relname,'unique',i.indisunique,'primaryKey',i.indisprimary,'valid',i.indisvalid,'sizeBytes',pg_relation_size(c.oid),'method',am.amname) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam WHERE i.indrelid::bigint=$1 ORDER BY c.relname LIMIT 101"#).bind(i64::from(oid)).fetch_all(&mut *conn).await?;
            selected.0["indexesTruncated"] = json!(indexes.len() > 100);
            indexes.truncate(100);
            selected.0["columns"] = json!(columns);
            selected.0["indexes"] = json!(indexes);
            Some(selected.0)
        } else {
            None
        }
    } else {
        None
    };
    Ok(
        json!({"engine":"postgres","observedAt":chrono::Utc::now(),"stats":stats,"tables":tables,"tablesTruncated":truncated,"table":detail}),
    )
}
async fn redis(port: u16, password: &str) -> Result<Value, ApiError> {
    use redis::IntoConnectionInfo;
    let info = format!("redis://127.0.0.1:{port}/0")
        .into_connection_info()
        .map_err(|_| unavailable())?;
    let settings = info.redis_settings().clone().set_password(password);
    let client =
        redis::Client::open(info.set_redis_settings(settings)).map_err(|_| unavailable())?;
    let config = redis::AsyncConnectionConfig::new()
        .set_connection_timeout(Some(Duration::from_secs(2)))
        .set_response_timeout(Some(Duration::from_secs(2)));
    let mut connection = client
        .get_multiplexed_async_connection_with_config(&config)
        .await
        .map_err(|_| unavailable())?;
    let output: String = redis::cmd("INFO")
        .arg(&["memory", "clients", "stats", "persistence", "keyspace"])
        .query_async(&mut connection)
        .await
        .map_err(|_| unavailable())?;
    if output.len() > 256 * 1024 {
        return Err(ApiError::Unavailable(
            "database statistics exceed the inspection limit",
        ));
    }
    Ok(redis_stats(&output))
}
fn redis_stats(output: &str) -> Value {
    let fields: BTreeMap<_, _> = output
        .lines()
        .filter_map(|line| line.split_once(':'))
        .collect();
    let mut stats = serde_json::Map::new();
    for (native_name, name) in [
        ("used_memory", "usedMemory"),
        ("used_memory_peak", "usedMemoryPeak"),
        ("used_memory_rss", "usedMemoryRss"),
        ("maxmemory", "maxmemory"),
        ("connected_clients", "connectedClients"),
        ("blocked_clients", "blockedClients"),
        ("instantaneous_ops_per_sec", "instantaneousOpsPerSec"),
        ("total_commands_processed", "totalCommandsProcessed"),
        ("keyspace_hits", "keyspaceHits"),
        ("keyspace_misses", "keyspaceMisses"),
        ("evicted_keys", "evictedKeys"),
        ("expired_keys", "expiredKeys"),
        ("aof_enabled", "aofEnabled"),
        ("aof_rewrite_in_progress", "aofRewriteInProgress"),
        ("rdb_bgsave_in_progress", "rdbBgsaveInProgress"),
        ("rdb_last_save_time", "rdbLastSaveTime"),
    ] {
        stats.insert(
            name.into(),
            fields
                .get(native_name)
                .and_then(|v| v.parse::<u64>().ok())
                .map_or(Value::Null, |v| json!(v)),
        );
    }
    for (native_name, name) in [
        ("aof_last_write_status", "aofLastWriteStatus"),
        ("aof_last_bgrewrite_status", "aofLastBgrewriteStatus"),
        ("rdb_last_bgsave_status", "rdbLastBgsaveStatus"),
    ] {
        stats.insert(
            name.into(),
            match fields.get(native_name).copied() {
                Some("ok") => json!("ok"),
                Some("err") => json!("error"),
                _ => Value::Null,
            },
        );
    }
    let keyspaces:Vec<_>=fields.iter().filter(|(name,_)|name.strip_prefix("db").is_some_and(|n|!n.is_empty() && n.bytes().all(|b|b.is_ascii_digit()))).take(64).map(|(name,value)|{
        let parts:BTreeMap<_,_>=value.split(',').filter_map(|p|p.split_once('=')).collect();
        let number=|key|parts.get(key).and_then(|n|n.parse::<u64>().ok());
        json!({"name":name,"keys":number("keys"),"expires":number("expires"),"avgTtlMs":number("avg_ttl")})
    }).collect();
    json!({"engine":"redis","observedAt":chrono::Utc::now(),"stats":stats,"keyspaces":keyspaces})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn redis_exposes_only_numeric_counters_and_known_statuses() {
        let value = redis_stats(
            "# Stats\r\nused_memory:123\r\nconnected_clients:2\r\naof_last_write_status:ok\r\nsecret:private\r\naof_last_bgrewrite_status:private\r\ndb0:keys=8,expires=3,avg_ttl=1200\r\ndbfoo:keys=500\r\n",
        );
        assert_eq!(value["stats"]["usedMemory"], 123);
        assert_eq!(value["keyspaces"][0]["keys"], 8);
        assert_eq!(value["keyspaces"].as_array().unwrap().len(), 1);
        assert!(!value.to_string().contains("private"));
        assert!(value["stats"]["maxmemory"].is_null());
    }
    #[sqlx::test(migrations = "./migrations")]
    #[ignore = "requires disposable PostgreSQL test server"]
    async fn postgres_catalog_is_read_only_and_excludes_row_values(pool: PgPool) {
        sqlx::query("CREATE SCHEMA inspector_fixture")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE inspector_fixture.items(id bigint PRIMARY KEY, label text NOT NULL, note text)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO inspector_fixture.items VALUES(1,'private row value',NULL)")
            .execute(&pool)
            .await
            .unwrap();
        let oid: i64 =
            sqlx::query_scalar("SELECT 'inspector_fixture.items'::regclass::oid::bigint")
                .fetch_one(&pool)
                .await
                .unwrap();
        let mut conn = pool.acquire().await.unwrap();
        sqlx::query("SET default_transaction_read_only=on")
            .execute(&mut *conn)
            .await
            .unwrap();
        let value = postgres(&mut conn, Some(oid as u32)).await.unwrap();
        assert_eq!(value["table"]["columns"][0]["primaryKey"], true);
        assert_eq!(value["table"]["columns"][1]["nullable"], false);
        assert_eq!(value["table"]["columns"][2]["nullable"], true);
        assert_eq!(value["table"]["indexes"][0]["method"], "btree");
        assert!(!value.to_string().contains("private row value"));
        assert!(
            sqlx::query("INSERT INTO inspector_fixture.items VALUES(2,'no',NULL)")
                .execute(&mut *conn)
                .await
                .is_err()
        );
        let invalid = postgres(&mut conn, Some(0)).await.unwrap();
        assert!(invalid["table"].is_null());
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;
    #[tokio::test]
    #[ignore = "requires explicit PLATFORM_DATABASE_SMOKE_POSTGRES and disposable development services"]
    async fn inspect_managed_postgres_and_redis() {
        let Ok(pg) = std::env::var("PLATFORM_DATABASE_SMOKE_POSTGRES") else {
            return;
        };
        let pg: Uuid = pg.parse().unwrap();
        let redis: Uuid = std::env::var("PLATFORM_DATABASE_SMOKE_REDIS")
            .unwrap()
            .parse()
            .unwrap();
        let pool = PgPool::connect(&std::env::var("DATABASE_URL").unwrap())
            .await
            .unwrap();
        for id in [pg, redis] {
            let project:String=sqlx::query_scalar("SELECT p.name FROM services s JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id WHERE s.id=$1").bind(id).fetch_one(&pool).await.unwrap();
            assert_eq!(
                project, "platform-storage-canary",
                "only disposable storage canaries may be used"
            );
        }
        let (_, values) = secrets::own_values(&pool, pg)
            .await
            .map_err(|_| "credential unavailable")
            .unwrap();
        let (port,database):(i32,String)=sqlx::query_as("SELECT n.endpoint_base+v.slot,s.spec->'workload'->>'database' FROM volumes v JOIN nodes n ON n.id=v.node_id JOIN services s ON s.id=v.id WHERE v.id=$1").bind(pg).fetch_one(&pool).await.unwrap();
        let options = PgConnectOptions::new()
            .host("127.0.0.1")
            .port(port as u16)
            .username("postgres")
            .password(&values["POSTGRES_PASSWORD"])
            .database(&database)
            .ssl_mode(PgSslMode::Disable)
            .disable_statement_logging();
        let mut connection = PgConnection::connect_with(&options)
            .await
            .map_err(|_| "canary connection failed")
            .unwrap();
        sqlx::query("CREATE TABLE IF NOT EXISTS public.platform_inspection_canary(id bigint PRIMARY KEY, name text NOT NULL, created_at timestamptz DEFAULT now())").execute(&mut connection).await.unwrap();
        let oid: i64 =
            sqlx::query_scalar("SELECT 'public.platform_inspection_canary'::regclass::oid::bigint")
                .fetch_one(&mut connection)
                .await
                .unwrap();
        connection.close().await.unwrap();
        let Json(value) = get(
            State(pool.clone()),
            Path(pg),
            Query(Inspect {
                table: Some(oid as u32),
            }),
        )
        .await
        .map_err(|_| "PostgreSQL inspection failed")
        .unwrap();
        assert_eq!(value["table"]["name"], "platform_inspection_canary");
        assert_eq!(value["table"]["columns"][0]["primaryKey"], true);
        assert!(value["stats"]["sizeBytes"].as_u64().unwrap() > 0);
        let Json(value) = get(State(pool), Path(redis), Query(Inspect { table: None }))
            .await
            .map_err(|_| "Redis inspection failed")
            .unwrap();
        assert_eq!(value["engine"], "redis");
        assert_eq!(value["stats"]["aofEnabled"], 1);
        assert!(value["stats"]["usedMemory"].as_u64().unwrap() > 0);
    }
}
