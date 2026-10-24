//! Explicit deployment-time database migration; application startup only verifies schema.
use sqlx::postgres::PgPoolOptions;
use std::{fs, path::PathBuf};
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
        .map_err(|error| match error {
            sqlx::migrate::MigrateError::ExecuteMigration(_, 27) => "contract reset requires a fresh platform database and node state; see docs/upgrades.md",
            _ => "database migration failed; review schema and migration history",
        })?;
    let secret_file = std::env::var("BETTER_AUTH_SECRET_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(".local/auth.secret"));
    let secret = fs::read(secret_file)
        .map_err(|_| "BETTER_AUTH_SECRET_FILE is required; run make db or setup-install")?;
    let public_origin = std::env::var("PUBLIC_ORIGIN").unwrap_or_default();
    let browser_origin =
        std::env::var("BROWSER_ORIGIN").unwrap_or_else(|_| "http://localhost:5188".into());
    let origins = if public_origin.is_empty() {
        vec![browser_origin.clone()]
    } else {
        vec![browser_origin.clone(), public_origin.clone()]
    };
    let base_url = if public_origin.is_empty() {
        browser_origin
    } else {
        public_origin
    };
    let auth = control_plane::auth::build(pool.clone(), secret, &base_url, &origins)?;
    control_plane::auth::migrate(&auth).await?;
    println!("Database migrations applied.");
    Ok(())
}
