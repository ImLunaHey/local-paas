//! Explicit local administrator operation. Never prints enrollment credentials.
use sqlx::postgres::PgPoolOptions;
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args()
        .nth(1)
        .ok_or("usage: enroll-node PRIVATE_CONFIG.json")?;
    let cfg: serde_json::Value = serde_json::from_slice(&tokio::fs::read(path).await?)?;
    let id = cfg["node_id"]
        .as_str()
        .ok_or("node ID required")?
        .parse::<uuid::Uuid>()?;
    let token = cfg["token"]
        .as_str()
        .filter(|s| s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit()))
        .ok_or("invalid enrollment token")?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&std::env::var("DATABASE_URL")?)
        .await?;
    control_plane::check_migrations(&pool).await?;
    sqlx::query("INSERT INTO nodes(id,name,token_hash,cpu_millis,memory_mib,slots,endpoint_base) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET token_hash=EXCLUDED.token_hash")
      .bind(id).bind(cfg["name"].as_str().ok_or("name required")?).bind(control_plane::runtime::token_hash(token))
      .bind(cfg["cpu_millis"].as_i64().ok_or("cpu required")? as i32).bind(cfg["memory_mib"].as_i64().ok_or("memory required")? as i32)
      .bind(cfg["slots"].as_i64().ok_or("slots required")? as i32).bind(cfg["endpoint_base"].as_i64().ok_or("endpoint required")? as i32).execute(&pool).await?;
    println!("Enrolled node {id}");
    Ok(())
}
