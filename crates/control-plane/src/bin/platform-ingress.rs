//! Separately supervised private ingress. No build, scheduling or secret authority.
use sqlx::postgres::PgPoolOptions;
use std::time::Duration;
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter("control_plane=info")
        .init();
    let pool = PgPoolOptions::new()
        .max_connections(3)
        .acquire_timeout(Duration::from_secs(2))
        .connect(&std::env::var("DATABASE_URL").map_err(|_| "DATABASE_URL required")?)
        .await
        .map_err(|_| "ingress database unavailable")?;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:8090").await?;
    tracing::info!("private ingress listening on 127.0.0.1:8090");
    control_plane::preview::serve(pool, listener).await
}
