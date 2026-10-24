//! Explicit administrator operation. Never prints enrollment credentials.
use sqlx::postgres::PgPoolOptions;
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 1 && !(args.len() == 2 && args[0] == "revoke") {
        return Err("usage: enroll-node PRIVATE_CONFIG.json | revoke NODE_ID".into());
    }
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&std::env::var("DATABASE_URL")?)
        .await?;
    control_plane::check_migrations(&pool).await?;
    if args[0] == "revoke" {
        let id = args.get(1).ok_or("missing node ID")?.parse()?;
        control_plane::enrollment::revoke(&pool, id).await?;
        println!(
            "Revoked node {id}; stop its TLS link and fence the host before replacing singleton workloads."
        );
    } else {
        let cfg = serde_json::from_slice(&tokio::fs::read(&args[0]).await?)?;
        control_plane::enrollment::enroll(&pool, &cfg).await?;
        println!("Enrolled node {}", cfg.node_id);
    }
    Ok(())
}
