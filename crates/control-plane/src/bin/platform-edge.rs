//! Run on the management host. Caddy admin credentials are file references only.
use control_plane::edge::{
    self,
    caddy::{Caddy, Config},
};
use sqlx::postgres::PgPoolOptions;
use std::time::Duration;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    platform_telemetry::init()?;
    let path = std::env::var("EDGE_CONFIG_FILE").map_err(|_| "EDGE_CONFIG_FILE is required")?;
    let bytes = std::fs::read(path).map_err(|_| "cannot read edge configuration")?;
    let config: Config =
        serde_json::from_slice(&bytes).map_err(|_| "invalid edge configuration")?;
    let provider =
        Caddy::new(config).map_err(|_| "invalid edge transport or certificate references")?;
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .acquire_timeout(Duration::from_secs(3))
        .connect(&std::env::var("DATABASE_URL").map_err(|_| "DATABASE_URL is required")?)
        .await
        .map_err(|_| "edge database unavailable")?;
    control_plane::check_migrations(&pool).await?;
    let mut interval = tokio::time::interval(Duration::from_secs(2));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        interval.tick().await;
        if edge::tick(&pool, &provider).await.is_err() {
            tracing::warn!("edge reconciliation failed; route leases will expire");
        }
    }
}
