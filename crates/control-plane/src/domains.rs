//! Organization-scoped desired domains and observed public edge state.
use crate::ApiError;
use axum::{
    Extension, Json,
    extract::{Path, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Transaction, types::Json as DbJson};
use utoipa::ToSchema;
use uuid::Uuid;
pub async fn lock(tx: &mut Transaction<'_, Postgres>) -> Result<(), ApiError> {
    sqlx::query("SELECT pg_advisory_xact_lock(712184551)")
        .execute(&mut **tx)
        .await?;
    sqlx::query("SELECT pg_advisory_xact_lock(712184563)")
        .execute(&mut **tx)
        .await?;
    Ok(())
}
pub async fn assign_service(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    names: &[String],
) -> Result<(), ApiError> {
    let rows:Vec<(String,Option<Uuid>)>=sqlx::query_as("SELECT d.hostname,d.service_id FROM domains d WHERE d.organization_id=(SELECT p.organization_id FROM services s JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id WHERE s.id=$2) AND (d.hostname=ANY($1) OR d.service_id=$2) ORDER BY d.hostname FOR UPDATE")
        .bind(names).bind(id).fetch_all(&mut **tx).await?;
    if names
        .iter()
        .any(|name| !rows.iter().any(|(host, _)| host == name))
    {
        return Err(ApiError::Conflict(
            "choose domains registered on the Domains page",
        ));
    }
    for (host, owner) in rows {
        let desired = names.contains(&host).then_some(id);
        if desired.is_some() && owner.is_some_and(|owner| owner != id) {
            return Err(ApiError::Conflict(
                "domain is assigned to another service; reassign it from Domains",
            ));
        }
        if owner != desired {
            for service in [owner, desired].into_iter().flatten() {
                if crate::edge::busy(tx, service).await? {
                    return Err(ApiError::Conflict(
                        "wait for the public edge rollout or rollback to finish before reassigning domains",
                    ));
                }
            }
            sqlx::query("UPDATE domains SET service_id=$2,version=version+1,updated_at=now() WHERE hostname=$1")
                .bind(&host).bind(desired).execute(&mut **tx).await?;
            target_assignment(tx, &host, desired).await?;
        }
    }
    Ok(())
}
pub(crate) fn normalize(host: &str) -> Option<String> {
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
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OwnershipRecord {
    pub name: String,
    pub value: String,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DomainObservation {
    pub hostname: String,
    pub service_id: Option<Uuid>,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub project: Option<String>,
    pub project_id: Option<Uuid>,
    pub environment: Option<String>,
    pub service: Option<String>,
    pub generation: i64,
    pub acknowledged_generation: Option<i64>,
    pub desired_deployment: Option<Uuid>,
    pub acknowledged_deployment: Option<Uuid>,
    pub verified_at: Option<DateTime<Utc>>,
    pub lease_expires_at: Option<DateTime<Utc>>,
    pub certificate_expires_at: Option<DateTime<Utc>>,
    pub error_code: Option<String>,
    pub ownership_record: OwnershipRecord,
    /// Derived from current observations and expiry, never an operator-set success flag.
    pub status: String,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DomainList {
    pub items: Vec<DomainObservation>,
    pub cname_target: Option<String>,
}

#[utoipa::path(get, path="/api/domains", operation_id="listDomains", responses((status=200, body=DomainList)))]
pub async fn list(
    State(pool): State<PgPool>,
    Extension(context): Extension<crate::auth::Context>,
) -> Result<Json<DomainList>, ApiError> {
    let items: Vec<DbJson<DomainObservation>> =
        sqlx::query_scalar(include_str!("domains/list.sql"))
            .bind(context.organization_id.as_deref())
            .fetch_all(&pool)
            .await?;
    let target = std::env::var("EDGE_CNAME_TARGET")
        .ok()
        .and_then(|s| normalize(&s));
    Ok(Json(DomainList {
        items: items.into_iter().map(|row| row.0).collect(),
        cname_target: target,
    }))
}
#[derive(Deserialize, ToSchema)]
#[schema(as = RegisterDomain)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct Create {
    hostname: String,
}
#[utoipa::path(post, path="/api/domains", operation_id="registerDomain", request_body=Create, responses((status=200, body=Value),(status=409, body=crate::openapi::ErrorResponse)))]
pub async fn create(
    State(pool): State<PgPool>,
    Extension(context): Extension<crate::auth::Context>,
    Json(input): Json<Create>,
) -> Result<Json<Value>, ApiError> {
    let hostname=normalize(&input.hostname).ok_or(ApiError::Conflict("enter a hostname such as app.example.com, without a URL, port or wildcard; use punycode for international domains"))?;
    let inserted = sqlx::query(
        "INSERT INTO domains(hostname,organization_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    )
    .bind(&hostname)
    .bind(crate::auth::required_organization(&context)?)
    .execute(&pool)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(ApiError::Conflict("this domain is already registered"));
    }
    Ok(Json(json!({"hostname":hostname})))
}
#[derive(Deserialize, ToSchema)]
#[schema(as = AssignDomain)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    service_id: Option<Uuid>,
    expected_version: i32,
}
#[utoipa::path(put, path="/api/domains/{hostname}", operation_id="assignDomain", params(("hostname"=String, Path)), request_body=Update, responses((status=200, body=Value),(status=409, body=crate::openapi::ErrorResponse)))]
pub async fn update(
    State(pool): State<PgPool>,
    Path(hostname): Path<String>,
    Json(input): Json<Update>,
) -> Result<Json<Value>, ApiError> {
    let mut tx = pool.begin().await?;
    lock(&mut tx).await?;
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
        let managed: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM pull_request_preview_services WHERE service_id=$1)",
        )
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
        if managed {
            return Err(ApiError::Conflict(
                "PR previews support private routes only",
            ));
        }
        let worker: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM services s JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id JOIN domains d ON d.hostname=$2 WHERE s.id=$1 AND p.organization_id=d.organization_id AND s.spec->'workload'->>'execution'='worker')")
            .bind(id).bind(&hostname).fetch_one(&mut *tx).await?;
        if worker {
            return Err(ApiError::Conflict(
                "background workers cannot receive domain mappings",
            ));
        }
        let kind: Option<String> =
            sqlx::query_scalar("SELECT s.kind FROM services s JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id JOIN domains d ON d.hostname=$2 WHERE s.id=$1 AND p.organization_id=d.organization_id FOR SHARE")
                .bind(id)
                .bind(&hostname)
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
    let previous: Option<Uuid> =
        sqlx::query_scalar("SELECT service_id FROM domains WHERE hostname=$1")
            .bind(&hostname)
            .fetch_one(&mut *tx)
            .await?;
    for service in [previous, input.service_id].into_iter().flatten() {
        if crate::edge::busy(&mut tx, service).await? {
            return Err(ApiError::Conflict(
                "wait for the public edge rollout or rollback to finish before reassigning domains",
            ));
        }
    }
    sqlx::query(
        "UPDATE domains SET service_id=$2,version=version+1,updated_at=now() WHERE hostname=$1",
    )
    .bind(&hostname)
    .bind(input.service_id)
    .execute(&mut *tx)
    .await?;
    target_assignment(&mut tx, &hostname, input.service_id).await?;
    // Keep the editable service declaration aligned with the domain registry.
    for id in [previous, input.service_id]
        .into_iter()
        .flatten()
        .collect::<std::collections::BTreeSet<_>>()
    {
        sqlx::query("UPDATE services SET spec=jsonb_set(spec,'{domains}',(SELECT coalesce(jsonb_agg(hostname ORDER BY hostname),'[]'::jsonb) FROM domains WHERE service_id=$1)),version=version+1 WHERE id=$1")
            .bind(id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"saved":true,"status":"pending-edge"})))
}

async fn target_assignment(
    tx: &mut Transaction<'_, Postgres>,
    hostname: &str,
    service: Option<Uuid>,
) -> Result<(), ApiError> {
    let deployment: Option<Uuid> = sqlx::query_scalar("SELECT id FROM deployments WHERE service_id=$1 AND status='active' AND spec->'workload'->>'kind'='oci-service' AND coalesce(spec->'workload'->>'execution','http')='http'")
        .bind(service).fetch_optional(&mut **tx).await?;
    crate::edge::set_target(tx, hostname, deployment).await?;
    Ok(())
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
