//! Structured parsing and durable log history. Never interpolate user input into SQL.
use crate::ApiError;
use axum::{
    Json,
    extract::{Path, Query, State},
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, Row, types::Json as DbJson};
use uuid::Uuid;

pub fn parse(line: &str) -> (String, String, Option<Value>) {
    let fields = serde_json::from_str::<Value>(line.trim())
        .ok()
        .filter(Value::is_object);
    let value = fields.as_ref().and_then(|v| {
        v.get("level")
            .or_else(|| v.get("severity"))
            .or_else(|| v.get("severity_text"))
    });
    let level = match value {
        Some(Value::Number(n)) => match n.as_u64() {
            Some(10) => "trace",
            Some(20) => "debug",
            Some(30) => "info",
            Some(40) => "warn",
            Some(50) => "error",
            Some(60) => "fatal",
            _ => "unclassified",
        }
        .to_owned(),
        Some(Value::String(s)) => match s.to_ascii_lowercase().as_str() {
            "trace" => "trace",
            "debug" => "debug",
            "info" | "information" => "info",
            "warn" | "warning" => "warn",
            "error" | "err" => "error",
            "fatal" | "critical" | "panic" => "fatal",
            _ => "unclassified",
        }
        .to_owned(),
        _ => "unclassified".into(),
    };
    let message = fields
        .as_ref()
        .and_then(|v| v.get("msg").or_else(|| v.get("message")))
        .and_then(Value::as_str)
        .unwrap_or(line.trim_end())
        .to_owned();
    (level, message, fields)
}
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogQuery {
    pub after: Option<i64>,
    pub before: Option<i64>,
    pub instance_id: Option<Uuid>,
    pub search: Option<String>,
    pub level: Option<String>,
    pub stream: Option<String>,
    pub field: Option<String>,
    pub value: Option<String>,
    pub from: Option<DateTime<Utc>>,
    pub until: Option<DateTime<Utc>>,
}
impl LogQuery {
    fn validate(&self) -> Result<(), ApiError> {
        if self.search.as_ref().is_some_and(|s| s.len() > 512)
            || self.value.as_ref().is_some_and(|s| s.len() > 512)
            || self.level.as_ref().is_some_and(|s| {
                !matches!(
                    s.as_str(),
                    "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "unclassified"
                )
            })
            || self
                .stream
                .as_ref()
                .is_some_and(|s| !matches!(s.as_str(), "stdout" | "stderr"))
            || self.field.as_ref().is_some_and(|s| {
                s.is_empty()
                    || s.len() > 128
                    || !s
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"_.".contains(&c))
            })
            || (self.field.is_some() != self.value.is_some())
            || (self.after.is_some() && self.before.is_some())
        {
            return Err(ApiError::Conflict("invalid log filter"));
        }
        Ok(())
    }
}
async fn ch(
    query: &str,
    params: &[(&str, String)],
    body: Option<String>,
) -> Result<String, ApiError> {
    let url = std::env::var("CLICKHOUSE_URL")
        .map_err(|_| ApiError::Unavailable("ClickHouse is not configured"))?;
    let password = std::env::var("CLICKHOUSE_PASSWORD_FILE")
        .ok()
        .map(std::fs::read_to_string)
        .transpose()
        .map_err(|_| ApiError::Unavailable("ClickHouse credential unavailable"))?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|_| ApiError::Database)?;
    let mut request = client
        .post(url)
        .query(&[
            ("query", query),
            ("wait_end_of_query", "1"),
            ("output_format_json_quote_64bit_integers", "0"),
        ])
        .query(params);
    if let Some(p) = password {
        request = request.basic_auth("platform", Some(p.trim().to_owned()));
    }
    let body = body.unwrap_or_default();
    let response = request
        .header(reqwest::header::CONTENT_LENGTH, body.len())
        .body(body)
        .send()
        .await
        .map_err(|_| ApiError::Unavailable("Log archive unavailable; recent logs remain queued"))?;
    if !response.status().is_success() {
        tracing::warn!(status = %response.status(), "log archive rejected request");
        return Err(ApiError::Unavailable("Log archive query failed"));
    }
    response.text().await.map_err(|_| ApiError::Database)
}
pub async fn archive(pool: &PgPool) -> Result<(), ApiError> {
    if std::env::var_os("CLICKHOUSE_URL").is_none() {
        return Ok(());
    }
    let mut tx = pool.begin().await?;
    let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_xact_lock(712184552)")
        .fetch_one(&mut *tx)
        .await?;
    if !locked {
        return Ok(());
    }
    ch("CREATE TABLE IF NOT EXISTS default.platform_logs (sequence Int64, service_id UUID, instance_id UUID, revision_id UUID, node String, project String, environment String, timestamp DateTime64(3,'UTC'), stream LowCardinality(String), level LowCardinality(String), message String, line String, fields String) ENGINE=ReplacingMergeTree ORDER BY (service_id,sequence)",&[],None).await?;
    let rows=sqlx::query("SELECT l.*,d.service_id,d.revision_id,d.spec->>'project' AS project,d.spec->>'environment' AS environment,n.name AS node FROM runtime_logs l JOIN instances i ON i.id=l.instance_id JOIN deployments d ON d.id=i.deployment_id JOIN nodes n ON n.id=i.node_id WHERE NOT l.archived ORDER BY l.sequence LIMIT 500").fetch_all(&mut *tx).await?;
    if rows.is_empty() {
        return Ok(());
    }
    let mut payload = String::new();
    let mut ids = Vec::new();
    for r in rows {
        let sequence: i64 = r.get("sequence");
        ids.push(sequence);
        let line: String = r.get("line");
        let (level, message, fields) = parse(&line);
        sqlx::query("UPDATE runtime_logs SET level=$2,message=$3,fields=$4 WHERE sequence=$1")
            .bind(sequence)
            .bind(&level)
            .bind(&message)
            .bind(fields.as_ref().map(DbJson))
            .execute(&mut *tx)
            .await?;
        payload.push_str(&json!({"sequence":sequence,"service_id":r.get::<Uuid,_>("service_id"),"instance_id":r.get::<Uuid,_>("instance_id"),"revision_id":r.get::<Uuid,_>("revision_id"),"node":r.get::<String,_>("node"),"project":r.get::<String,_>("project"),"environment":r.get::<String,_>("environment"),"timestamp":r.get::<DateTime<Utc>,_>("timestamp").format("%Y-%m-%d %H:%M:%S%.3f").to_string(),"stream":r.get::<String,_>("stream"),"level":level,"message":message,"line":line,"fields":fields.map(|v|v.to_string()).unwrap_or_default()}).to_string());
        payload.push('\n');
    }
    ch(
        "INSERT INTO default.platform_logs FORMAT JSONEachRow",
        &[],
        Some(payload),
    )
    .await?;
    sqlx::query("UPDATE runtime_logs SET archived=true WHERE sequence=ANY($1)")
        .bind(ids)
        .execute(&mut *tx)
        .await?;
    // Never evict unacknowledged output. ClickHouse has no expiry TTL.
    sqlx::query("DELETE FROM runtime_logs WHERE archived AND timestamp<now()-interval '24 hours'")
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}
pub(crate) async fn logs(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Query(q): Query<LogQuery>,
) -> Result<Json<Value>, ApiError> {
    q.validate()?;
    crate::runtime::service_exists(&pool, id).await?;
    let descending = q.after.is_none();
    let direction = if descending { "DESC" } else { "ASC" };
    let sql = format!(
        "SELECT jsonb_build_object('sequence',l.sequence,'instanceId',i.id,'node',n.name,'revisionId',d.revision_id,'timestamp',l.timestamp,'stream',l.stream,'line',l.line,'level',l.level,'message',coalesce(l.message,l.line),'fields',l.fields) FROM runtime_logs l JOIN instances i ON i.id=l.instance_id JOIN deployments d ON d.id=i.deployment_id JOIN nodes n ON n.id=i.node_id WHERE d.service_id=$1 AND ($2::bigint IS NULL OR l.sequence>$2) AND ($3::bigint IS NULL OR l.sequence<$3) AND ($4::uuid IS NULL OR i.id=$4) AND ($5::text IS NULL OR strpos(lower(l.line),lower($5))>0) AND ($6::text IS NULL OR l.level=$6) AND ($7::text IS NULL OR l.stream=$7) AND ($8::text IS NULL OR l.fields #>> string_to_array($8,'.')=$9) AND ($10::timestamptz IS NULL OR l.timestamp>=$10) AND ($11::timestamptz IS NULL OR l.timestamp<=$11) ORDER BY l.sequence {direction} LIMIT 256"
    );
    let recent: Vec<DbJson<Value>> = sqlx::query_scalar(&sql)
        .bind(id)
        .bind(q.after)
        .bind(q.before)
        .bind(q.instance_id)
        .bind(&q.search)
        .bind(&q.level)
        .bind(&q.stream)
        .bind(&q.field)
        .bind(&q.value)
        .bind(q.from)
        .bind(q.until)
        .fetch_all(&pool)
        .await?;
    let mut entries: Vec<Value> = recent.into_iter().map(|v| v.0).collect();
    let mut archive_error = None;
    if std::env::var_os("CLICKHOUSE_URL").is_some() {
        let mut predicates = vec!["service_id={service:UUID}".to_owned()];
        let mut params = vec![("param_service", id.to_string())];
        for (name, value, predicate) in [
            (
                "param_after",
                q.after.map(|v| v.to_string()),
                "sequence>{after:Int64}",
            ),
            (
                "param_before",
                q.before.map(|v| v.to_string()),
                "sequence<{before:Int64}",
            ),
            (
                "param_instance",
                q.instance_id.map(|v| v.to_string()),
                "instance_id={instance:UUID}",
            ),
            (
                "param_search",
                q.search.clone(),
                "positionCaseInsensitiveUTF8(line,{search:String})>0",
            ),
            ("param_level", q.level.clone(), "level={level:String}"),
            ("param_stream", q.stream.clone(), "stream={stream:String}"),
            (
                "param_from",
                q.from.map(|v| v.timestamp_millis().to_string()),
                "timestamp>=fromUnixTimestamp64Milli({from:Int64})",
            ),
            (
                "param_until",
                q.until.map(|v| v.timestamp_millis().to_string()),
                "timestamp<=fromUnixTimestamp64Milli({until:Int64})",
            ),
        ] {
            if let Some(value) = value {
                params.push((name, value));
                predicates.push(predicate.into())
            }
        }
        if let (Some(field), Some(value)) = (&q.field, &q.value) {
            params.push(("param_field", format!("$.{field}")));
            params.push(("param_value", value.clone()));
            predicates.push("JSON_VALUE(fields,{field:String})={value:String}".into());
        }
        let query = format!(
            "SELECT sequence,instance_id AS instanceId,node,revision_id AS revisionId,formatDateTime(timestamp,'%Y-%m-%dT%H:%i:%S.%fZ','UTC') AS timestamp,stream,line,level,message,fields FROM default.platform_logs FINAL WHERE {} ORDER BY sequence {direction} LIMIT 256 FORMAT JSONEachRow",
            predicates.join(" AND ")
        );
        match ch(&query, &params, None).await {
            Ok(text) => {
                for line in text.lines() {
                    if let Ok(mut entry) = serde_json::from_str::<Value>(line) {
                        entry["fields"] = entry["fields"]
                            .as_str()
                            .and_then(|s| serde_json::from_str(s).ok())
                            .unwrap_or(Value::Null);
                        entries.push(entry)
                    }
                }
            }
            Err(_) => {
                archive_error =
                    Some("Archive unavailable; displaying locally queued/recent output only")
            }
        }
    }
    entries.sort_by_key(|v| v["sequence"].as_i64().unwrap_or(0));
    entries.dedup_by_key(|v| v["sequence"].as_i64());
    if entries.len() > 256 {
        if descending {
            entries.drain(..entries.len() - 256);
        } else {
            entries.truncate(256);
        }
    }
    let next = entries
        .last()
        .and_then(|v| v["sequence"].as_i64())
        .or(q.after)
        .unwrap_or(0);
    let oldest = entries.first().and_then(|v| v["sequence"].as_i64());
    let markers:Vec<DbJson<Value>> = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'timestamp',timestamp,'message',message,'instanceId',instance_id) FROM (SELECT d.id::text AS id,d.created_at AS timestamp,'Deployment started · '||left(d.id::text,8) AS message,NULL::uuid AS instance_id FROM deployments d WHERE d.service_id=$1 AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM instances i WHERE i.deployment_id=d.id AND i.id=$2)) UNION ALL SELECT s.instance_id::text||':'||s.started_at::text,s.started_at,(CASE WHEN s.started_at=(SELECT min(s2.started_at) FROM instance_starts s2 WHERE s2.instance_id=s.instance_id) THEN 'Instance started · ' ELSE 'Instance restarted · ' END)||n.name||' / '||left(i.id::text,8),i.id FROM instance_starts s JOIN instances i ON i.id=s.instance_id JOIN deployments d ON d.id=i.deployment_id JOIN nodes n ON n.id=i.node_id WHERE d.service_id=$1 AND ($2::uuid IS NULL OR i.id=$2)) timeline WHERE ($3::timestamptz IS NULL OR timestamp>=$3) AND ($4::timestamptz IS NULL OR timestamp<=$4) ORDER BY timestamp DESC LIMIT 500")
        .bind(id).bind(q.instance_id).bind(q.from).bind(q.until).fetch_all(&pool).await?;
    Ok(Json(
        json!({"markers":markers,"entries":entries,"nextCursor":next,"oldestCursor":oldest,"hasMore":entries.len()==256,"archiveWarning":archive_error}),
    ))
}
pub(crate) async fn status(State(pool): State<PgPool>) -> Result<Json<Value>, ApiError> {
    let pending: i64 = sqlx::query_scalar("SELECT count(*) FROM runtime_logs WHERE NOT archived")
        .fetch_one(&pool)
        .await?;
    let mut bytes = None;
    let mut available = false;
    if std::env::var_os("CLICKHOUSE_URL").is_some()
        && let Ok(body)=ch("SELECT sum(bytes_on_disk) AS bytes FROM system.parts WHERE active AND database='default' AND table='platform_logs' FORMAT JSONEachRow",&[],None).await {available=true;bytes=serde_json::from_str::<Value>(body.trim()).ok().map(|v|v["bytes"].clone());
    }
    Ok(Json(
        json!({"configured":std::env::var_os("CLICKHOUSE_URL").is_some(),"available":available,"pendingEntries":pending,"bytesOnDisk":bytes,"retention":"No automatic expiry"}),
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn distinguishes_stream_from_severity() {
        let (level, message, fields) =
            parse(r#"{"level":50,"msg":"failed","request":{"id":"abc"}}"#);
        assert_eq!(level, "error");
        assert_eq!(message, "failed");
        assert_eq!(fields.unwrap()["request"]["id"], "abc");
        assert_eq!(parse("normal output").0, "unclassified");
        assert!(parse("[1,2]").2.is_none());
        assert_eq!(
            parse(r#"{"severity":"WARNING","message":"slow"}"#).0,
            "warn"
        );
    }
}
