//! Explicit deployment-time database migration; application startup only verifies schema.
use sqlx::postgres::PgPoolOptions;
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let url = std::env::var("DATABASE_URL").map_err(|_| "DATABASE_URL is required")?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .map_err(|_| "migration database connection unavailable")?;
    control_plane::migrate(&pool)
        .await
        .map_err(|_| "database migration failed; review schema and migration history")?;
    println!("Database migrations applied.");
    Ok(())
}
