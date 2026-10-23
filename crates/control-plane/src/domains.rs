//! Desired public domain assignments; no public routing is activated yet.
use crate::ApiError;
use axum::{
    Json,
    extract::{Path, State},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, types::Json as DbJson};
use uuid::Uuid;
fn normalize(host: &str) -> Option<String> {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    if host.len() > 253 || !host.contains('.') || host.parse::<std::net::IpAddr>().is_ok() {
        return None;
    }
    if !host.split('.').all(|part| {
        !part.is_empty()
            && part.len() <= 63
            && part.as_bytes()[0].is_ascii_alphanumeric()
            && part.as_bytes()[part.len() - 1].is_ascii_alphanumeric()
            && part.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    }) {
        return None;
    }
    Some(host)
}
pub async fn list(State(pool): State<PgPool>) -> Result<Json<Value>, ApiError> {
    let items:Vec<DbJson<Value>>=sqlx::query_scalar("SELECT jsonb_build_object('hostname',d.hostname,'service_id',d.service_id,'version',d.version,'created_at',d.created_at,'updated_at',d.updated_at,'project',p.name,'project_id',p.id,'environment',e.name,'service',s.name,'status','pending-edge') FROM domains d LEFT JOIN services s ON s.id=d.service_id LEFT JOIN environments e ON e.id=s.environment_id LEFT JOIN projects p ON p.id=e.project_id ORDER BY d.hostname").fetch_all(&pool).await?;
    let target = std::env::var("EDGE_CNAME_TARGET")
        .ok()
        .and_then(|s| normalize(&s));
    Ok(Json(
        json!({"items":items,"cname_target":target,"edge_ready":false}),
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Create {
    hostname: String,
}
pub async fn create(
    State(pool): State<PgPool>,
    Json(input): Json<Create>,
) -> Result<Json<Value>, ApiError> {
    let hostname=normalize(&input.hostname).ok_or(ApiError::Conflict("enter a hostname such as app.example.com, without a URL, port or wildcard; use punycode for international domains"))?;
    let inserted = sqlx::query("INSERT INTO domains(hostname) VALUES($1) ON CONFLICT DO NOTHING")
        .bind(&hostname)
        .execute(&pool)
        .await?;
    if inserted.rows_affected() == 0 {
        return Err(ApiError::Conflict("this domain is already registered"));
    }
    Ok(Json(json!({"hostname":hostname})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Update {
    service_id: Option<Uuid>,
    expected_version: i32,
}
pub async fn update(
    State(pool): State<PgPool>,
    Path(hostname): Path<String>,
    Json(input): Json<Update>,
) -> Result<Json<Value>, ApiError> {
    let mut tx = pool.begin().await?;
    let version: Option<i32> =
        sqlx::query_scalar("SELECT version FROM domains WHERE hostname=$1 FOR UPDATE")
            .bind(&hostname)
            .fetch_optional(&mut *tx)
            .await?;
    let version = version.ok_or(ApiError::NotFound)?;
    if version != input.expected_version {
        return Err(ApiError::Conflict(
            "domain assignment changed; reload before saving",
        ));
    }
    if let Some(id) = input.service_id {
        let kind: Option<String> =
            sqlx::query_scalar("SELECT kind FROM services WHERE id=$1 FOR SHARE")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?;
        match kind.as_deref() {
            Some("oci-service" | "celld-service") => {}
            Some(_) => {
                return Err(ApiError::Conflict(
                    "domains can only target web applications",
                ));
            }
            None => return Err(ApiError::NotFound),
        }
    }
    sqlx::query(
        "UPDATE domains SET service_id=$2,version=version+1,updated_at=now() WHERE hostname=$1",
    )
    .bind(&hostname)
    .bind(input.service_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"saved":true,"status":"pending-edge"})))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_hostnames_without_accepting_urls_addresses_or_wildcards() {
        assert_eq!(
            normalize(" App.Example.COM. "),
            Some("app.example.com".into())
        );
        for host in [
            "https://example.com",
            "example.com:443",
            "*.example.com",
            "127.0.0.1",
            "localhost",
            "a..com",
            "-a.example",
            "a_.example",
            "example.com/path",
            "💜.com",
        ] {
            assert!(normalize(host).is_none(), "{host}");
        }
    }
}
