//! Local-only closed-registration bootstrap for the first administrator and organization user.
use lucid_auth::{NewOrganization, NewOrganizationInvitation, NewPasswordUser};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use std::{fs, io, net::IpAddr, path::PathBuf};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let database_url = std::env::var("DATABASE_URL").map_err(|_| "DATABASE_URL is required")?;
    require_local_database(&database_url)?;
    let mut passwords = String::new();
    io::Read::read_to_string(&mut io::stdin().lock(), &mut passwords)?;
    let mut passwords = passwords.lines();
    let root_password = passwords
        .next()
        .ok_or("root password is required on stdin")?;
    let member_password = passwords
        .next()
        .ok_or("organization user password is required on stdin")?;
    if passwords.next().is_some() {
        return Err("expected exactly two password lines on stdin".into());
    }

    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await?;
    let secret_file = std::env::var("BETTER_AUTH_SECRET_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(".local/auth.secret"));
    let secret = fs::read(secret_file)?;
    let browser_origin =
        std::env::var("BROWSER_ORIGIN").unwrap_or_else(|_| "http://localhost:5188".into());
    let runtime = control_plane::auth::build(
        pool.clone(),
        secret,
        &browser_origin,
        std::slice::from_ref(&browser_origin),
    )?;
    control_plane::auth::check(&runtime).await?;

    runtime
        .service
        .provision_password_user(NewPasswordUser {
            username: "root".into(),
            name: "root".into(),
            email: None,
            password: root_password.into(),
            role: "admin".into(),
        })
        .await?;
    let member = runtime
        .service
        .provision_password_user(NewPasswordUser {
            username: "imlunahey".into(),
            name: "imlunahey".into(),
            email: None,
            password: member_password.into(),
            role: "user".into(),
        })
        .await?;
    let root = runtime
        .service
        .sign_in_username("root", root_password.into(), None, None)
        .await?;
    let organization = match runtime
        .service
        .list_organizations(&root.session)
        .await?
        .into_iter()
        .find(|organization| organization.slug == "imlunahey")
    {
        Some(organization) => organization,
        None => {
            runtime
                .service
                .create_organization(
                    &root.session,
                    NewOrganization {
                        name: "imlunahey".into(),
                        slug: "imlunahey".into(),
                        logo: None,
                        metadata: None,
                        keep_current_active_organization: false,
                    },
                )
                .await?
                .organization
        }
    };
    let existing_member = runtime
        .service
        .list_organization_members(&root.session, Some(organization.id.clone()))
        .await?
        .into_iter()
        .find(|organization_member| organization_member.user_id == member.id);
    if let Some(existing_member) = existing_member {
        if existing_member.role != "operator" {
            runtime
                .service
                .update_organization_member_role(
                    &root.session,
                    Some(organization.id.clone()),
                    existing_member.id,
                    "operator".into(),
                )
                .await?;
        }
    } else {
        let invitation = runtime
            .service
            .invite_organization_member(
                &root.session,
                NewOrganizationInvitation {
                    email: member.email.clone(),
                    role: "operator".into(),
                    organization_id: Some(organization.id.clone()),
                    team_ids: Vec::new(),
                    resend: false,
                },
            )
            .await?;
        let member_session = runtime
            .service
            .sign_in_username("imlunahey", member_password.into(), None, None)
            .await?;
        runtime
            .service
            .accept_organization_invitation(&member_session.session, invitation.id)
            .await?;
    }

    sqlx::query("UPDATE projects SET organization_id=$1 WHERE organization_id IS NULL")
        .bind(&organization.id)
        .execute(&pool)
        .await?;
    sqlx::query("UPDATE domains SET organization_id=$1 WHERE organization_id IS NULL")
        .bind(&organization.id)
        .execute(&pool)
        .await?;
    println!("Local authentication bootstrap complete for organization imlunahey.");
    Ok(())
}

fn require_local_database(url: &str) -> Result<(), &'static str> {
    let options = url
        .parse::<PgConnectOptions>()
        .map_err(|_| "DATABASE_URL is not a valid PostgreSQL connection string")?;
    let host = options
        .get_host()
        .strip_prefix('[')
        .and_then(|host| host.strip_suffix(']'))
        .unwrap_or_else(|| options.get_host());
    let local = host == "localhost"
        || host.starts_with('/')
        || host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback());
    if local {
        Ok(())
    } else {
        Err("platform-auth-bootstrap only accepts a local PostgreSQL connection")
    }
}

#[cfg(test)]
mod tests {
    use super::require_local_database;

    #[test]
    fn accepts_local_postgres_connections() {
        for url in [
            "postgresql:///local_paas",
            "postgres://user:password@localhost:5432/platform_test",
            "postgres://user:password@127.0.0.1:5432/platform_test",
            "postgres://user:password@[::1]:5432/platform_test",
            "postgresql:///local_paas?host=%2Fsrv%2Fplatform%2Fsocket",
        ] {
            assert!(require_local_database(url).is_ok(), "rejected {url}");
        }
    }

    #[test]
    fn rejects_remote_postgres_connections() {
        for url in [
            "postgres://user:password@database.example.com:5432/platform",
            "postgres://user:password@10.0.2.2:5432/platform",
            "postgres://user:password@localhost.example.com:5432/platform",
        ] {
            assert!(require_local_database(url).is_err(), "accepted {url}");
        }
    }
}
