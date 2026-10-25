use control_plane::builds::{self, Completion};
use platform_build_runner::{Config, Request};
use sqlx::{Connection, PgConnection, postgres::PgPoolOptions};
use std::{env, time::Duration};
use tokio::{sync::mpsc, task::JoinSet};
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    platform_telemetry::init()?;
    let config = Config::from_env()?;
    let database_url = env::var("DATABASE_URL").map_err(|_| "DATABASE_URL is required")?;
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&database_url)
        .await
        .map_err(|_| "cannot connect to PostgreSQL")?;
    control_plane::check_migrations(&pool)
        .await
        .map_err(|_| "database migration failed")?;
    // One active build worker. This session lock is never returned to a pool.
    let mut lock = PgConnection::connect(&database_url)
        .await
        .map_err(|_| "cannot acquire worker connection")?;
    let acquired: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock(712184550)")
        .fetch_one(&mut lock)
        .await?;
    if !acquired {
        return Err("another build worker is already active".into());
    }
    let worker_id = Uuid::now_v7();
    let work = async {
        loop {
            sqlx::query("SELECT 1").execute(&mut lock).await?;
            builds::heartbeat(&pool, worker_id).await?;
            builds::expire(&pool).await?;
            if let Some(build) = builds::claim(&pool).await? {
                let completion = {
                    let (sender, mut receiver) = mpsc::channel(16);
                    let mut request = Request {
                        build_id: build.id,
                        service_id: build.service_id,
                        spec: build.spec.0.clone(),
                        no_cache: build.no_cache,
                        local_context: None,
                        inspection_context: None,
                        git_auth_token: None,
                    };
                    // The runner must keep progressing while lease queries await
                    // its short transactions. Polling both inline can deadlock.
                    // JoinSet aborts the task on every early-return/shutdown path.
                    let mut runner = JoinSet::new();
                    let runner_pool = pool.clone();
                    let runner_build = build.clone();
                    let runner_config = config.clone();
                    runner.spawn(async move {
                        let pool = runner_pool;
                        let build = runner_build;
                        let config = runner_config;
                        let uploaded = if let Some(digest) = &request.spec.source.upload {
                            Some(platform_build_runner::uploaded_context(digest).await?)
                        } else { None };
                        request.local_context = uploaded.as_ref().map(|dir|dir.path().to_owned());
                        let _verified = if !request.spec.workload.is_managed()
                            && uploaded.is_none()
                        {
                            let token = if let Some(connection_id) = build.source_connection_id {
                                control_plane::source_connections::github_build_token(
                                    &pool,
                                    connection_id,
                                )
                                .await?
                            } else {
                                None
                            };
                            let commit = platform_build_runner::resolve_commit_authenticated(
                                &config,
                                &request.spec,
                                token.as_ref(),
                            )
                            .await?;
                            if !builds::record_resolution(&pool, &build, &commit)
                                .await
                                .map_err(|_| platform_build_runner::Error::Lease)?
                            {
                                return Err(platform_build_runner::Error::Lease);
                            }
                            request.spec.source.pin(commit);
                            let verified = if build.source_connection_id.is_some() {
                                Some(
                                    platform_build_runner::verified_github_context(
                                        &config,
                                        &request.spec,
                                        token.as_ref(),
                                    )
                                    .await?,
                                )
                            } else {
                                None
                            };
                            request.inspection_context =
                                verified.as_ref().map(|dir| dir.path().to_owned());
                            request.git_auth_token = token;
                            verified
                        } else {
                            None
                        };
                        sender
                            .send("Inspecting build source…\n".into())
                            .await
                            .map_err(|_| platform_build_runner::Error::Client)?;
                        let plan = platform_build_runner::plan(&config, &request).await?;
                        if !builds::record_plan(&pool, &build, &plan)
                            .await
                            .map_err(|_| platform_build_runner::Error::Lease)?
                        {
                            return Err(platform_build_runner::Error::Lease);
                        }
                        sender.send(match &plan {
                            platform_build_runner::BuildPlan::Dockerfile { .. } => "Using repository Dockerfile.\n".into(),
                            platform_build_runner::BuildPlan::Generated { runtime, package_manager, .. } => format!("Generated Dockerfile: {runtime}, {package_manager}; install → build (if present) → start.\n"),
                        }).await.map_err(|_| platform_build_runner::Error::Client)?;
                        platform_build_runner::run(&config, request, &plan, sender).await
                    });
                    let mut interval = tokio::time::interval(Duration::from_secs(5));
                    let mut logs_open = true;
                    let completion = loop {
                        tokio::select! {
                            joined = runner.join_next() => {
                                let result = joined.and_then(Result::ok).unwrap_or(Err(platform_build_runner::Error::Client));
                                while let Ok(message) = receiver.try_recv() { builds::append_log(&pool, &build, &message).await?; }
                                break match result {
                                    Ok(output) => Completion::Succeeded { repository: output.repository, digest: output.digest },
                                    Err(error) => Completion::Failed(error.code()),
                                };
                            }
                            message = receiver.recv(), if logs_open => {
                                if let Some(message) = message { builds::append_log(&pool, &build, &message).await?; }
                                else { logs_open = false; }
                            }
                            _ = interval.tick() => {
                                sqlx::query("SELECT 1").execute(&mut lock).await?;
                                builds::heartbeat(&pool, worker_id).await?;
                                match builds::renew(&pool, &build).await? {
                                    Some(false) => {},
                                    Some(true) => break Completion::Cancelled,
                                    None => break Completion::Failed("worker_lease_lost"),
                                }
                            }
                        }
                    };
                    runner.abort_all();
                    while runner.join_next().await.is_some() {}
                    // Aborting drops buildctl before persisting cancellation.
                    completion
                };
                builds::finish(&pool, &build, completion).await?;
            } else {
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
        #[allow(unreachable_code)]
        Ok::<(), sqlx::Error>(())
    };
    tokio::select! {
        result = work => { result.map_err(|_| "build worker lost database connectivity")?; }
        _ = shutdown() => {}
    }
    sqlx::query("DELETE FROM build_workers WHERE id=$1")
        .bind(worker_id)
        .execute(&pool)
        .await?;
    // In-flight jobs expire as interrupted. They require an explicit new request.
    Ok(())
}

async fn shutdown() {
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install signal handler");
        tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = term.recv() => {} }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
