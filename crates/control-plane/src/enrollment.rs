//! Explicit operator enrollment; never accepted from an unauthenticated node.
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Enrollment {
    pub node_id: Uuid,
    pub token: String,
    pub name: String,
    pub controller_url: String,
    pub cpu_millis: i32,
    pub memory_mib: i32,
    pub slots: i32,
    pub endpoint_base: i32,
    #[serde(default = "unspecified")]
    pub failure_domain: String,
    #[serde(default)]
    pub cordoned: bool,
}
fn unspecified() -> String {
    "unspecified".into()
}
impl Enrollment {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.token.len() != 64 || !self.token.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("invalid enrollment token");
        }
        for label in [&self.name, &self.failure_domain] {
            if label.is_empty()
                || label.len() > 63
                || !label
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            {
                return Err("invalid node name or failure domain");
            }
        }
        if self.controller_url != "https://controller.local-paas:18443" {
            return Err("unsupported controller gateway");
        }
        if !(1..=1000).contains(&self.cpu_millis)
            || !(1..=1400).contains(&self.memory_mib)
            || !(1..=4).contains(&self.slots)
        {
            return Err("capacity exceeds the current worker VM allocation");
        }
        if self.endpoint_base < 21000
            || self.endpoint_base > 21600
            || (self.endpoint_base - 21000) % 100 != 0
        {
            return Err("endpoint base must identify one of worker slots 1–7");
        }
        if self.endpoint_base >= 21300 && (!self.cordoned || self.failure_domain == "unspecified") {
            return Err(
                "remote nodes must enroll cordoned with an explicit physical failure domain",
            );
        }
        Ok(())
    }
}
pub async fn enroll(pool: &PgPool, input: &Enrollment) -> Result<(), Box<dyn std::error::Error>> {
    input.validate()?;
    let mut tx = pool.begin().await?;
    sqlx::query!("SELECT pg_advisory_xact_lock(712184551)")
        .execute(&mut *tx)
        .await?;
    let hash = crate::runtime::token_hash(&input.token);
    if let Some(row) = sqlx::query!(
        "SELECT name,token_hash,cpu_millis,memory_mib,slots,endpoint_base,failure_domain FROM nodes WHERE id=$1", input.node_id
    ).fetch_optional(&mut *tx).await? {
        if row.name != input.name || row.token_hash != hash || row.cpu_millis != input.cpu_millis
            || row.memory_mib != input.memory_mib || row.slots != input.slots
            || row.endpoint_base != input.endpoint_base || row.failure_domain != input.failure_domain
        { return Err("node already exists with different identity or configuration".into()); }
        // A retry must not undo maintenance state or generate duplicate audit entries.
        tx.commit().await?;
        return Ok(());
    }
    let reserved = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM nodes WHERE name=$1 OR int4range(endpoint_base,endpoint_base+slots) && int4range($2::integer,$2::integer+$3::integer)) AS "reserved!""#,
        input.name, input.endpoint_base, input.slots
    ).fetch_one(&mut *tx).await?;
    if reserved {
        return Err("node name or endpoint range is already reserved".into());
    }
    sqlx::query!(
        "INSERT INTO nodes(id,name,token_hash,cpu_millis,memory_mib,slots,endpoint_base,failure_domain,cordoned) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        input.node_id,input.name,hash,input.cpu_millis,input.memory_mib,input.slots,input.endpoint_base,input.failure_domain,input.cordoned
    ).execute(&mut *tx).await?;
    let details = serde_json::json!({"name":input.name,"failureDomain":input.failure_domain,"endpointBase":input.endpoint_base,"cordoned":input.cordoned});
    sqlx::query!(
        "INSERT INTO audit_log(actor,action,outcome,target_type,target_id,details) VALUES('operator','node.enroll','succeeded','node',$1,$2)",
        input.node_id.to_string(),details
    ).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}
pub async fn revoke(pool: &PgPool, id: Uuid) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query!("SELECT pg_advisory_xact_lock(712184551)")
        .execute(&mut *tx)
        .await?;
    let hash = sqlx::query_scalar!("SELECT token_hash FROM nodes WHERE id=$1", id)
        .fetch_one(&mut *tx)
        .await?;
    if !hash.is_empty() {
        sqlx::query!(
            "UPDATE nodes SET token_hash='',cordoned=true,last_seen=NULL WHERE id=$1",
            id
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query!(
            "INSERT INTO audit_log(actor,action,outcome,target_type,target_id,details) VALUES('operator','node.revoke','succeeded','node',$1,'{}')",id.to_string()
        ).execute(&mut *tx).await?;
    }
    tx.commit().await
}
