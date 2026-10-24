//! OpenBao is the authority. Only names, paths and versions enter PostgreSQL.
use crate::{ApiError, Service};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, Row, types::Json as DbJson};
use std::{collections::BTreeMap, time::Duration};
use uuid::Uuid;
pub struct Bao {
    client: reqwest::Client,
    url: String,
    token: String,
}
impl Bao {
    pub fn configured() -> bool {
        std::env::var_os("OPENBAO_ADDR").is_some()
    }
    pub fn new() -> Result<Self, ApiError> {
        let url = std::env::var("OPENBAO_ADDR")
            .map_err(|_| ApiError::Unavailable("OpenBao is not configured"))?;
        if !url.starts_with("https://") {
            return Err(ApiError::Unavailable("OpenBao requires verified HTTPS"));
        }
        let certificate = std::fs::read(
            std::env::var("OPENBAO_CA_FILE")
                .map_err(|_| ApiError::Unavailable("OpenBao CA is not configured"))?,
        )
        .map_err(|_| ApiError::Unavailable("OpenBao CA unavailable"))?;
        let token = std::fs::read_to_string(
            std::env::var("OPENBAO_TOKEN_FILE")
                .map_err(|_| ApiError::Unavailable("OpenBao identity unavailable"))?,
        )
        .map_err(|_| ApiError::Unavailable("OpenBao identity unavailable"))?;
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .tls_built_in_root_certs(false)
            .add_root_certificate(
                reqwest::Certificate::from_pem(&certificate)
                    .map_err(|_| ApiError::Unavailable("invalid OpenBao CA"))?,
            )
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| ApiError::Database)?;
        Ok(Self {
            client,
            url,
            token: token.trim().into(),
        })
    }
    pub async fn call(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
        token: Option<&str>,
    ) -> Result<Value, ApiError> {
        let mut req = self
            .client
            .request(method, format!("{}/v1/{path}", self.url))
            .header("X-Vault-Token", token.unwrap_or(&self.token))
            .header("X-Vault-Request", "true");
        if let Some(body) = body {
            req = req
                .header("content-type", "application/json")
                .body(body.to_string());
        }
        let response = req
            .send()
            .await
            .map_err(|_| ApiError::Unavailable("OpenBao is unavailable"))?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(Value::Null);
        }
        if !response.status().is_success() {
            return Err(ApiError::Unavailable(
                "OpenBao rejected the operation; check seal state, permissions or secret version",
            ));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|_| ApiError::Unavailable("OpenBao response unavailable"))?;
        if bytes.is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_slice(&bytes)
            .map_err(|_| ApiError::Unavailable("invalid OpenBao response"))
    }
    async fn read(
        &self,
        path: &str,
        version: Option<i32>,
        token: Option<&str>,
    ) -> Result<(i32, BTreeMap<String, String>), ApiError> {
        let suffix = version.map(|v| format!("?version={v}")).unwrap_or_default();
        let value = self
            .call(
                reqwest::Method::GET,
                &format!("platform/data/{path}{suffix}"),
                None,
                token,
            )
            .await?;
        if value.is_null() {
            return Ok((0, BTreeMap::new()));
        }
        let version = value["data"]["metadata"]["version"]
            .as_i64()
            .ok_or(ApiError::Unavailable("invalid secret version"))? as i32;
        let values = serde_json::from_value(value["data"]["data"].clone())
            .map_err(|_| ApiError::Unavailable("invalid secret data"))?;
        Ok((version, values))
    }
}
async fn identity(pool: &PgPool, id: Uuid) -> Result<(Uuid, String), ApiError> {
    let env: Uuid = sqlx::query_scalar("SELECT environment_id FROM services WHERE id=$1")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok((env, format!("workloads/{env}/{id}")))
}
async fn sources(pool: &PgPool, id: Uuid) -> Result<Vec<(Uuid, String, Vec<String>)>, ApiError> {
    let rows=sqlx::query("WITH RECURSIVE chain AS (SELECT e.id,e.parent_id,0 AS depth,s.name FROM services s JOIN environments e ON e.id=s.environment_id WHERE s.id=$1 UNION ALL SELECT e.id,e.parent_id,c.depth+1,c.name FROM environments e JOIN chain c ON e.id=c.parent_id WHERE c.depth<8) SELECT s.id,s.environment_id,s.spec FROM chain c JOIN services s ON s.environment_id=c.id AND s.name=c.name ORDER BY c.depth DESC").bind(id).fetch_all(pool).await?;
    rows.into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let env: Uuid = r.get("environment_id");
            let spec: DbJson<platform_domain::ServiceSpec> = r.get("spec");
            Ok((id, format!("workloads/{env}/{id}"), spec.secrets.clone()))
        })
        .collect()
}
pub async fn references(pool: &PgPool, id: Uuid) -> Result<Vec<String>, ApiError> {
    let mut names = std::collections::BTreeSet::new();
    for (_, _, refs) in sources(pool, id).await? {
        names.extend(refs);
    }
    Ok(names.into_iter().collect())
}
async fn resolved(
    pool: &PgPool,
    id: Uuid,
    bao: &Bao,
) -> Result<(BTreeMap<String, String>, BTreeMap<String, Uuid>), ApiError> {
    let mut values = BTreeMap::new();
    let mut origins = BTreeMap::new();
    for (source, path, refs) in sources(pool, id).await? {
        let (_, own) = bao.read(&path, None, None).await?;
        for (name, value) in own {
            if refs.contains(&name) {
                origins.insert(name.clone(), source);
                values.insert(name, value);
            }
        }
    }
    Ok((values, origins))
}
pub(crate) async fn list(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let (_, path) = identity(&pool, id).await?;
    let spec: DbJson<platform_domain::ServiceSpec> =
        sqlx::query_scalar("SELECT spec FROM services WHERE id=$1")
            .bind(id)
            .fetch_one(&pool)
            .await?;
    if !Bao::configured() {
        return Ok(Json(
            json!({"configured":false,"version":0,"names":[],"references":spec.secrets,"path":path}),
        ));
    }
    let bao = Bao::new()?;
    let (version, values) = bao.read(&path, None, None).await?;
    let names: Vec<String> = values.keys().cloned().collect();
    // Repair metadata if OpenBao committed a prior write before a database failure.
    sqlx::query("INSERT INTO secret_sets(service_id,version,names) VALUES($1,$2,$3) ON CONFLICT(service_id) DO UPDATE SET version=excluded.version,names=excluded.names,updated_at=now() WHERE secret_sets.version<excluded.version").bind(id).bind(version).bind(&names).execute(&pool).await?;
    let (resolved, origins) = resolved(&pool, id, &bao).await?;
    let refs = references(&pool, id).await?;
    Ok(Json(
        json!({"configured":true,"version":version,"names":resolved.keys().collect::<Vec<_>>(),"own_names":names,"origins":origins,"references":refs,"path":path}),
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Update {
    name: String,
    value: Option<String>,
    expected_version: i32,
}
pub(crate) async fn update(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(input): Json<Update>,
) -> Result<Json<Value>, ApiError> {
    update_bundle(
        &pool,
        id,
        input.expected_version,
        std::collections::BTreeMap::from([(input.name, input.value)]),
    )
    .await
}
pub(crate) async fn own_values(
    pool: &PgPool,
    id: Uuid,
) -> Result<(i32, std::collections::BTreeMap<String, String>), ApiError> {
    let (_, path) = identity(pool, id).await?;
    Bao::new()?.read(&path, None, None).await
}
pub(crate) async fn update_bundle(
    pool: &PgPool,
    id: Uuid,
    expected_version: i32,
    changes: std::collections::BTreeMap<String, Option<String>>,
) -> Result<Json<Value>, ApiError> {
    if changes.is_empty()
        || changes.len() > 100
        || changes.iter().any(|(name, value)| {
            !valid_name(name)
                || value
                    .as_ref()
                    .is_some_and(|v| v.len() > 32768 || v.contains('\0'))
        })
    {
        return Err(ApiError::Conflict("invalid secret names or values"));
    }
    let (_, path) = identity(pool, id).await?;
    let bao = Bao::new()?;
    let mut tx = pool.begin().await?;
    let mut service: Service = sqlx::query_as("SELECT * FROM services WHERE id=$1 FOR UPDATE")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    if service.spec.workload.is_managed() {
        let initialized: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM volumes WHERE id=$1)")
                .bind(id)
                .fetch_one(&mut *tx)
                .await?;
        if initialized {
            return Err(ApiError::Conflict(
                "database password rotation requires a coordinated SQL change and is not available yet",
            ));
        }
    }
    let (version, mut values) = bao.read(&path, None, None).await?;
    if version != expected_version {
        return Err(ApiError::Conflict(
            "secrets changed; reload the secret list before saving",
        ));
    }
    for (name, value) in changes {
        if let Some(value) = value {
            values.insert(name.clone(), value);
            if !service.spec.secrets.contains(&name) {
                service.spec.secrets.push(name);
            }
        } else {
            values.remove(&name);
            service.spec.secrets.retain(|n| n != &name);
        }
    }
    service.spec.validate().map_err(ApiError::Invalid)?;
    if serde_json::to_vec(&values)
        .map_err(|_| ApiError::Database)?
        .len()
        > 49152
    {
        return Err(ApiError::Conflict("service secret bundle exceeds 48 KiB"));
    }
    let policy = format!("path \"platform/data/{path}/snapshots\" {{ capabilities = [\"read\"] }}");
    bao.call(
        reqwest::Method::PUT,
        &format!("sys/policies/acl/platform-workload-{id}"),
        Some(json!({"policy":policy})),
        None,
    )
    .await?;
    let response = bao
        .call(
            reqwest::Method::POST,
            &format!("platform/data/{path}"),
            Some(json!({"options":{"cas":version},"data":values})),
            None,
        )
        .await?;
    let version = response["data"]["version"]
        .as_i64()
        .ok_or(ApiError::Unavailable(
            "OpenBao did not acknowledge the write",
        ))? as i32;
    let names: Vec<String> = values.keys().cloned().collect();
    sqlx::query("INSERT INTO secret_sets(service_id,version,names) VALUES($1,$2,$3) ON CONFLICT(service_id) DO UPDATE SET version=excluded.version,names=excluded.names,updated_at=now()").bind(id).bind(version).bind(&names).execute(&mut *tx).await?;
    sqlx::query("UPDATE services SET spec=$2,version=version+1 WHERE id=$1")
        .bind(id)
        .bind(DbJson(&service.spec.0))
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO events(id,service_id,operation_id,kind) VALUES($1,$2,$3,'secrets.updated')",
    )
    .bind(Uuid::new_v4())
    .bind(id)
    .bind(Uuid::new_v4())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"version":version,"names":names})))
}
pub async fn snapshot(pool: &PgPool, id: Uuid, names: &[String]) -> Result<Option<i32>, ApiError> {
    if names.is_empty() {
        return Ok(None);
    }
    let (_, path) = identity(pool, id).await?;
    let bao = Bao::new()?;
    let (mut values, _) = resolved(pool, id, &bao).await?;
    if names.iter().any(|n| !values.contains_key(n)) {
        return Err(ApiError::Conflict(
            "save every referenced secret in OpenBao before deploying",
        ));
    }
    values.retain(|name, _| names.contains(name));
    // Materialize inheritance inside OpenBao, under this workload's exact path.
    // A later change in any environment cannot modify a running revision's bundle.
    let path = format!("{path}/snapshots");
    let (version, _) = bao.read(&path, None, None).await?;
    let policy = format!("path \"platform/data/{path}\" {{ capabilities = [\"read\"] }}");
    bao.call(
        reqwest::Method::PUT,
        &format!("sys/policies/acl/platform-workload-{id}"),
        Some(json!({"policy":policy})),
        None,
    )
    .await?;
    let result = bao
        .call(
            reqwest::Method::POST,
            &format!("platform/data/{path}"),
            Some(json!({"options":{"cas":version},"data":values})),
            None,
        )
        .await?;
    let version = result["data"]["version"]
        .as_i64()
        .ok_or(ApiError::Unavailable(
            "OpenBao did not acknowledge the secret snapshot",
        ))? as i32;
    Ok(Some(version))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Delivery {
    node_id: Uuid,
    instance_id: Uuid,
    generation: i64,
}
pub(crate) async fn deliver(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<Delivery>,
) -> Result<Json<Value>, ApiError> {
    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .filter(|v| v.len() == 64)
        .ok_or(ApiError::Unauthorized)?;
    let r=sqlx::query("SELECT d.service_id,d.secret_version,d.secret_snapshot,d.spec,s.environment_id FROM instances i JOIN nodes n ON n.id=i.node_id JOIN deployments d ON d.id=i.deployment_id JOIN services s ON s.id=d.service_id WHERE i.id=$1 AND i.node_id=$2 AND i.generation=$3 AND i.desired_state='running' AND n.token_hash=$4").bind(input.instance_id).bind(input.node_id).bind(input.generation).bind(crate::runtime::token_hash(token)).fetch_optional(&pool).await?.ok_or(ApiError::Unauthorized)?;
    let service: Uuid = r.get("service_id");
    let environment: Uuid = r.get("environment_id");
    let version: Option<i32> = r.get("secret_version");
    let spec: DbJson<platform_domain::ServiceSpec> = r.get("spec");
    if spec.secrets.is_empty() {
        return Ok(Json(json!({"values":{},"version":null})));
    }
    let version = version.ok_or(ApiError::Conflict(
        "deployment has no pinned secret version",
    ))?;
    let bao = Bao::new()?;
    // One read, sixty-second maximum lifetime, exact workload path and no default policy.
    let issued=bao.call(reqwest::Method::POST,"auth/token/create/platform-workload",Some(json!({"policies":[format!("platform-workload-{service}")],"ttl":"60s","num_uses":1,"no_default_policy":true,"metadata":{"instance":input.instance_id.to_string()}})),None).await?;
    let identity = issued["auth"]["client_token"]
        .as_str()
        .ok_or(ApiError::Unavailable(
            "workload identity could not be issued",
        ))?;
    let (_, mut values) = bao
        .read(
            &format!(
                "workloads/{environment}/{service}{}",
                if r.get::<bool, _>("secret_snapshot") {
                    "/snapshots"
                } else {
                    ""
                }
            ),
            Some(version),
            Some(identity),
        )
        .await?;
    values.retain(|name, _| spec.secrets.contains(name));
    if values.len() != spec.secrets.len() {
        return Err(ApiError::Unavailable("pinned secret version is incomplete"));
    }
    Ok(Json(json!({"values":values,"version":version})))
}
pub async fn renew() -> Result<(), ApiError> {
    if Bao::configured() {
        Bao::new()?
            .call(
                reqwest::Method::POST,
                "auth/token/renew-self",
                Some(json!({})),
                None,
            )
            .await?;
    }
    Ok(())
}
fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name
            .bytes()
            .enumerate()
            .all(|(i, b)| b == b'_' || b.is_ascii_uppercase() || (i > 0 && b.is_ascii_digit()))
}
pub(crate) async fn database_password(pool: &PgPool, id: Uuid) -> Result<String, ApiError> {
    let (_, path) = identity(pool, id).await?;
    let bao = Bao::new()?;
    let (version, values) = bao.read(&path, None, None).await?;
    let spec: DbJson<platform_domain::ServiceSpec> =
        sqlx::query_scalar("SELECT spec FROM services WHERE id=$1")
            .bind(id)
            .fetch_one(pool)
            .await?;
    let secret = spec.workload.database_secret();
    if let Some(password) = values.get(secret) {
        return Ok(password.clone());
    }
    let initialized: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM volumes WHERE id=$1)")
        .bind(id)
        .fetch_one(pool)
        .await?;
    if initialized {
        return Err(ApiError::Conflict(
            "database credentials are missing; restore the original OpenBao secret before starting this volume",
        ));
    }
    let password = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let _ = update(
        State(pool.clone()),
        Path(id),
        Json(Update {
            name: secret.into(),
            value: Some(password.clone()),
            expected_version: version,
        }),
    )
    .await?;
    Ok(password)
}
pub(crate) async fn connect_database(
    pool: &PgPool,
    id: Uuid,
    value: String,
    name: &str,
    expected_version: i32,
) -> Result<(), ApiError> {
    let _ = update(
        State(pool.clone()),
        Path(id),
        Json(Update {
            name: name.into(),
            value: Some(value),
            expected_version,
        }),
    )
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unsafe_names() {
        assert!(valid_name("DATABASE_URL"));
        assert!(!valid_name("A=B"));
        assert!(!valid_name("../OTHER"));
        assert!(!valid_name("1BAD"));
    }
}
