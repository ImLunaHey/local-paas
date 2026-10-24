use sqlx::postgres::PgPoolOptions;
use std::{
    env,
    net::{Ipv4Addr, SocketAddrV4},
    time::Duration,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    platform_telemetry::init()?;
    let database_url =
        env::var("DATABASE_URL").map_err(|_| "DATABASE_URL is required; see README.md")?;
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&database_url)
        .await
        .map_err(|_| "cannot connect to PostgreSQL")?;
    control_plane::check_migrations(&pool)
        .await
        .map_err(|_| "database migration failed")?;
    let port = env::var("PORT")
        .unwrap_or_else(|_| "8080".into())
        .parse::<u16>()?;
    let mut browser_origins =
        vec![env::var("BROWSER_ORIGIN").unwrap_or_else(|_| "http://localhost:5188".into())];
    if let Ok(public_origin) = env::var("PUBLIC_ORIGIN")
        && !public_origin.is_empty()
    {
        browser_origins.push(public_origin);
    }
    let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
    let listener = tokio::net::TcpListener::bind(address).await?;
    tracing::info!(%address, "local development control API listening");
    let host_metrics = tokio::spawn(control_plane::host_metrics::run(pool.clone()));
    let upkeep_pool = pool.clone();
    let upkeep = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            if control_plane::builds::expire(&upkeep_pool).await.is_err() {
                tracing::error!("build lease reconciliation failed");
            }
            if control_plane::runtime::reconcile(&upkeep_pool)
                .await
                .is_err()
            {
                tracing::error!("runtime reconciliation failed");
            }
        }
    });
    let schedule_pool = pool.clone();
    let schedules = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            if control_plane::jobs::tick(&schedule_pool).await.is_err() {
                tracing::error!("job schedule reconciliation failed");
            }
        }
    });
    let renewal = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(3600));
        loop {
            interval.tick().await;
            if control_plane::secrets::renew().await.is_err() {
                tracing::error!("OpenBao controller identity renewal failed");
            }
        }
    });
    let archive_pool = pool.clone();
    let archive = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            if control_plane::logging::archive(&archive_pool)
                .await
                .is_err()
            {
                tracing::error!("log archive unavailable; retaining queued output");
            }
        }
    });
    axum::serve(
        listener,
        control_plane::router(pool.clone(), browser_origins),
    )
    .with_graceful_shutdown(shutdown())
    .await?;
    host_metrics.abort();
    upkeep.abort();
    schedules.abort();
    archive.abort();
    renewal.abort();
    pool.close().await;
    Ok(())
}

async fn shutdown() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("install SIGTERM handler");
        tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
