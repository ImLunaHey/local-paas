//! Runtime-independent public routing. Only a checked provider observation is an ACK.
pub mod caddy;
pub(crate) mod rollout;
pub use rollout::{advance, begin, busy, rollback, set_target, stop_allowed};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

pub const LEASE_SECONDS: i64 = 90;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Route {
    pub id: Uuid,
    pub hostname: String,
    /// Public DNS challenge, not an authentication credential.
    pub ownership_token: Uuid,
    pub generation: i64,
    pub deployment: Option<Uuid>,
    pub acknowledged_generation: Option<i64>,
    pub acknowledged_deployment: Option<Uuid>,
}
impl Route {
    pub fn authority(&self, generation: i64) -> String {
        format!("{}-{generation}.edge.invalid", self.id.simple())
    }
    pub fn challenge_name(&self) -> String {
        format!("_local-paas.{}", self.hostname)
    }
    pub fn challenge_value(&self) -> String {
        format!("local-paas={}", self.ownership_token)
    }
}

pub struct Observation {
    pub certificate_expires_at: Option<DateTime<Utc>>,
}
/// Fixed codes only: provider response bodies, certificates and credentials must
/// never be copied to application records, audit events or logs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    Dns,
    Ownership,
    Configuration,
    Unavailable,
    Conflict,
    Tls,
    Health,
}
impl Failure {
    pub fn code(self) -> &'static str {
        match self {
            Self::Dns => "dns_pending",
            Self::Ownership => "ownership_pending",
            Self::Configuration => "edge_configuration",
            Self::Unavailable => "edge_unavailable",
            Self::Conflict => "edge_conflict",
            Self::Tls => "tls_pending",
            Self::Health => "route_unhealthy",
        }
    }
}

pub trait Edge: Send + Sync {
    fn verify(&self, route: &Route) -> impl Future<Output = Result<(), Failure>> + Send;
    /// Implementations authenticate the management connection, verify DNS before
    /// activation and observe TLS plus the exact generation through the data path.
    /// Removal must be read back from the edge. Retries must be idempotent.
    fn reconcile(&self, route: &Route)
    -> impl Future<Output = Result<Observation, Failure>> + Send;
}

/// Separately supervised worker; a database transaction lock fences concurrent
/// workers across the external operation. Domain edits use the same row lock.
/// Network calls are bounded, and no scheduler lock is held during them.
pub async fn tick(pool: &PgPool, provider: &impl Edge) -> Result<(), sqlx::Error> {
    let hosts: Vec<String> = sqlx::query_scalar("SELECT hostname FROM domains WHERE edge_generation>0 AND edge_retry_at<=now() ORDER BY edge_retry_at,hostname LIMIT 32")
        .fetch_all(pool).await?;
    for hostname in hosts {
        let mut tx = pool.begin().await?;
        let Some(row) = sqlx::query("SELECT * FROM domains WHERE hostname=$1 AND edge_retry_at<=now() FOR NO KEY UPDATE SKIP LOCKED")
            .bind(&hostname).fetch_optional(&mut *tx).await? else { continue };
        let route = Route {
            id: row.get("edge_id"),
            hostname,
            ownership_token: row.get("ownership_token"),
            generation: row.get("edge_generation"),
            deployment: row.get("edge_deployment"),
            acknowledged_generation: row.get("acknowledged_generation"),
            acknowledged_deployment: row.get("acknowledged_deployment"),
        };
        let observed = observe(pool, provider, &route).await?;
        match observed {
            Ok(observation)
                if route.deployment.is_none()
                    || observation
                        .certificate_expires_at
                        .is_some_and(|e| e > Utc::now()) =>
            {
                sqlx::query("UPDATE domains SET acknowledged_generation=edge_generation,acknowledged_deployment=edge_deployment,verified_at=CASE WHEN edge_deployment IS NOT NULL THEN now() ELSE verified_at END,edge_lease_expires_at=CASE WHEN edge_deployment IS NULL THEN clock_timestamp()+make_interval(secs=>$2) ELSE (SELECT expires_at FROM edge_targets WHERE hostname=domains.hostname AND generation=domains.edge_generation) END,certificate_expires_at=$3,edge_error=NULL,edge_retry_at=clock_timestamp()+interval '20 seconds' WHERE hostname=$1")
                    .bind(&route.hostname).bind(LEASE_SECONDS as f64).bind(observation.certificate_expires_at).execute(&mut *tx).await?;
            }
            result => {
                let failure = result.err().unwrap_or(Failure::Tls);
                // A failed/uncertain apply must not strand the old route. Restore
                // and probe its exact generation, retaining the pending desired
                // generation so the controller cannot mistake recovery for ACK.
                if let Some(generation) = route.acknowledged_generation
                    && generation != route.generation
                    && route.acknowledged_deployment.is_some()
                {
                    let mut previous = route.clone();
                    previous.generation = generation;
                    previous.deployment = route.acknowledged_deployment;
                    if let Ok(observation) = observe(pool, provider, &previous).await? {
                        sqlx::query("UPDATE domains SET edge_lease_expires_at=(SELECT expires_at FROM edge_targets WHERE hostname=domains.hostname AND generation=$2),certificate_expires_at=$3 WHERE hostname=$1")
                            .bind(&route.hostname).bind(generation).bind(observation.certificate_expires_at).execute(&mut *tx).await?;
                    }
                }
                sqlx::query("UPDATE domains SET edge_error=$2,edge_retry_at=clock_timestamp()+interval '5 seconds' WHERE hostname=$1")
                    .bind(&route.hostname).bind(failure.code()).execute(&mut *tx).await?;
            }
        }
        tx.commit().await?;
    }
    Ok(())
}

async fn observe(
    pool: &PgPool,
    provider: &impl Edge,
    route: &Route,
) -> Result<Result<Observation, Failure>, sqlx::Error> {
    let verified = tokio::time::timeout(std::time::Duration::from_secs(5), provider.verify(route))
        .await
        .unwrap_or(Err(Failure::Dns));
    if let Err(failure) = verified {
        return Ok(Err(failure));
    }
    // No transaction is held on this target. The domain's non-key lock fences
    // assignments while allowing this foreign-key check on a separate connection.
    if let Some(deployment) = route.deployment {
        sqlx::query("INSERT INTO edge_targets(authority,hostname,generation,deployment_id,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+make_interval(secs=>$5)) ON CONFLICT(authority) DO UPDATE SET expires_at=EXCLUDED.expires_at")
            .bind(route.authority(route.generation)).bind(&route.hostname).bind(route.generation).bind(deployment).bind(LEASE_SECONDS as f64).execute(pool).await?;
    }
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        provider.reconcile(route),
    )
    .await
    .unwrap_or(Err(Failure::Unavailable));
    let result = result.and_then(|observation| {
        if route.deployment.is_some()
            && !observation.certificate_expires_at.is_some_and(|expiry| {
                expiry > Utc::now() + chrono::Duration::seconds(LEASE_SECONDS)
            })
        {
            Err(Failure::Tls)
        } else {
            Ok(observation)
        }
    });
    if result.is_err() {
        sqlx::query("UPDATE edge_targets SET expires_at=least(expires_at,clock_timestamp()) WHERE hostname=$1 AND generation=$2")
            .bind(&route.hostname).bind(route.generation).execute(pool).await?;
    }
    Ok(result)
}
