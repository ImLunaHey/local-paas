//! Explicit operator enrollment; never accepted from an unauthenticated node.
use serde::Deserialize;
use sqlx::{PgPool, Row};
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
    #[serde(default)]
    pub organization_id: Option<String>,
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
        if self
            .organization_id
            .as_ref()
            .is_some_and(|id| id.is_empty() || id.len() > 255)
        {
            return Err("invalid organization ID");
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
    if let Some(organization_id) = &input.organization_id {
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM organization WHERE id=$1)")
                .bind(organization_id)
                .fetch_one(&mut *tx)
                .await?;
        if !exists {
            return Err("organization does not exist".into());
        }
    }
    if let Some(row) = sqlx::query(
        "SELECT name,token_hash,cpu_millis,memory_mib,slots,endpoint_base,failure_domain,organization_id FROM nodes WHERE id=$1",
    )
    .bind(input.node_id)
    .fetch_optional(&mut *tx)
    .await?
    {
        if row.get::<String, _>("name") != input.name
            || row.get::<String, _>("token_hash") != hash
            || row.get::<i32, _>("cpu_millis") != input.cpu_millis
            || row.get::<i32, _>("memory_mib") != input.memory_mib
            || row.get::<i32, _>("slots") != input.slots
            || row.get::<i32, _>("endpoint_base") != input.endpoint_base
            || row.get::<String, _>("failure_domain") != input.failure_domain
            || row.get::<Option<String>, _>("organization_id") != input.organization_id
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
    sqlx::query(
        "INSERT INTO nodes(id,name,token_hash,cpu_millis,memory_mib,slots,endpoint_base,failure_domain,cordoned,organization_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    )
    .bind(input.node_id)
    .bind(&input.name)
    .bind(hash)
    .bind(input.cpu_millis)
    .bind(input.memory_mib)
    .bind(input.slots)
    .bind(input.endpoint_base)
    .bind(&input.failure_domain)
    .bind(input.cordoned)
    .bind(&input.organization_id)
    .execute(&mut *tx)
    .await?;
    let details = serde_json::json!({"name":input.name,"failureDomain":input.failure_domain,"endpointBase":input.endpoint_base,"cordoned":input.cordoned,"organizationId":input.organization_id});
    sqlx::query(
        "INSERT INTO audit_log(actor,action,outcome,target_type,target_id,organization_id,details) VALUES('operator','node.enroll','succeeded','node',$1,$2,$3)",
    )
    .bind(input.node_id.to_string())
    .bind(&input.organization_id)
    .bind(details)
    .execute(&mut *tx)
    .await?;
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
