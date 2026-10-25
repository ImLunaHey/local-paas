use axum::{
    Json,
    extract::{MatchedPath, Request, State},
    http::{Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use lucid_auth::{
    AdminPlugin, AuthConfig, AuthService, OrganizationDynamicAccessControlConfig,
    OrganizationPermissions, OrganizationPlugin, OrganizationPluginConfig, OrganizationTeamsConfig,
    UsernamePlugin, postgres::PostgresStore,
};
use serde_json::json;
use sqlx::PgPool;
use std::{collections::BTreeMap, sync::Arc};

pub const PERMISSION_RESOURCES: &[(&str, &[&str])] = &[
    ("project", &["read", "create", "update", "delete"]),
    ("service", &["read", "create", "update", "delete"]),
    ("build", &["read", "execute", "cancel"]),
    ("deployment", &["read", "execute", "stop"]),
    ("secret", &["read", "manage"]),
    ("node", &["read", "manage"]),
    ("job", &["read", "execute", "manage"]),
    ("backup", &["read", "manage"]),
    ("audit", &["read"]),
    ("domain", &["read", "manage"]),
    ("storage", &["read", "manage"]),
    ("source", &["read", "manage"]),
];

#[derive(Clone)]
pub struct Runtime {
    pub service: Arc<AuthService>,
    pub store: Arc<PostgresStore>,
}

#[derive(Clone, Debug)]
pub struct Context {
    pub actor_id: String,
    pub user_id: String,
    pub username: String,
    pub organization_id: Option<String>,
    pub is_superuser: bool,
}

#[derive(Clone)]
pub struct GuardState {
    pub pool: PgPool,
    pub service: Arc<AuthService>,
}

impl Context {
    pub fn testing() -> Self {
        Self {
            actor_id: "test-operator".into(),
            user_id: "test-operator".into(),
            username: "test-operator".into(),
            organization_id: Some("test-organization".into()),
            is_superuser: true,
        }
    }

    pub fn audit_actor(&self) -> String {
        if self.actor_id.starts_with("api-key:") {
            self.actor_id.clone()
        } else {
            format!("user:{}", self.actor_id)
        }
    }
}

pub fn build(
    pool: PgPool,
    secret: Vec<u8>,
    base_url: &str,
    browser_origins: &[String],
) -> Result<Runtime, lucid_auth::AuthError> {
    let mut config = AuthConfig::new(secret)?;
    config.set_base_url(base_url)?;
    for origin in browser_origins {
        config.trust_origin(origin)?;
    }
    config.email_and_password.enabled = true;
    config.email_and_password.disable_sign_up = true;
    config.add_plugin(UsernamePlugin::default())?;
    config.add_plugin(AdminPlugin::default())?;

    let store = Arc::new(PostgresStore::new(pool, Default::default()));
    let organization = OrganizationPluginConfig {
        roles: platform_roles(),
        teams: OrganizationTeamsConfig {
            enabled: true,
            default_team_enabled: true,
            maximum_teams: Some(100),
            maximum_members_per_team: Some(1_000),
            allow_removing_all_teams: false,
        },
        dynamic_access_control: OrganizationDynamicAccessControlConfig {
            enabled: true,
            maximum_roles_per_organization: Some(100),
        },
        membership_limit: 10_000,
        ..OrganizationPluginConfig::default()
    };
    config.add_plugin(OrganizationPlugin::with_config(store.clone(), organization))?;
    let service = Arc::new(AuthService::try_new(store.clone(), config)?);
    Ok(Runtime { service, store })
}

pub async fn migrate(runtime: &Runtime) -> Result<(), lucid_auth::AuthError> {
    let report = runtime
        .store
        .migrate_all(&runtime.service.plugin_migrations())
        .await?;
    if report.compatible {
        Ok(())
    } else {
        Err(lucid_auth::AuthError::InvalidConfiguration(format!(
            "authentication schema is incompatible: {:?}",
            report.issues
        )))
    }
}

pub async fn check(runtime: &Runtime) -> Result<(), lucid_auth::AuthError> {
    let report = runtime
        .store
        .diagnose_schema(&runtime.service.plugin_migrations())
        .await?;
    if report.compatible {
        Ok(())
    } else {
        Err(lucid_auth::AuthError::InvalidConfiguration(
            "authentication schema does not match this release; run platform-migrate".into(),
        ))
    }
}

pub async fn require_operator(
    State(state): State<GuardState>,
    mut request: Request,
    next: Next,
) -> Response {
    let service = state.service.clone();
    let path = request.uri().path();
    let api_token = request
        .headers()
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|value| value.starts_with("lp_"))
        .map(str::to_owned);
    if api_token.is_some() && (path.starts_with("/api/auth/") || path.starts_with("/api/api-keys"))
    {
        return auth_error(
            StatusCode::FORBIDDEN,
            "browser_session_required",
            "Use a signed-in browser session to manage credentials",
        );
    }
    if public_path(path) {
        return next.run(request).await;
    }
    let matched_path = request
        .extensions()
        .get::<MatchedPath>()
        .map(|path| path.as_str().to_owned())
        .unwrap_or_default();
    let request_path = request.uri().path().to_owned();
    let (session, key_identity) = if let Some(token) = api_token {
        match crate::api_keys::authenticate(&state, &token).await {
            Some((session, identity)) => (session, Some(identity)),
            None => {
                return auth_error(
                    StatusCode::UNAUTHORIZED,
                    "invalid_api_key",
                    "API key is invalid, expired, or revoked",
                );
            }
        }
    } else {
        let Some(token) = lucid_auth::axum::session_token(&service, request.headers()) else {
            return auth_error(
                StatusCode::UNAUTHORIZED,
                "authentication_required",
                "Sign in required",
            );
        };
        match service.principal(&token).await {
            Ok(Some(_)) => {}
            Ok(None) => {
                return auth_error(
                    StatusCode::UNAUTHORIZED,
                    "invalid_session",
                    "Session is invalid or expired",
                );
            }
            Err(_) => {
                return auth_error(
                    StatusCode::UNAUTHORIZED,
                    "invalid_session",
                    "Session is invalid or expired",
                );
            }
        };
        let session = match service.session(&token).await {
            Ok(Some(session)) => session,
            _ => {
                return auth_error(
                    StatusCode::UNAUTHORIZED,
                    "invalid_session",
                    "Session is invalid or expired",
                );
            }
        };
        (session, None)
    };
    let principal = session.principal();
    let is_superuser = key_identity.is_none()
        && session
            .user
            .role
            .split(',')
            .map(str::trim)
            .any(|role| role == "admin");
    let organization_id = session
        .session
        .additional_fields
        .get("activeOrganizationId")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    if !is_superuser {
        let Some(organization_id) = organization_id.as_ref() else {
            return auth_error(
                StatusCode::FORBIDDEN,
                "organization_required",
                "Select an organization before accessing the platform",
            );
        };
        // Credential management still requires current membership, even though
        // it is not itself a service read/update operation.
        if request_path.starts_with("/api/api-keys")
            && !service
                .has_organization_permission(
                    &session,
                    Some(organization_id.clone()),
                    BTreeMap::new(),
                )
                .await
                .unwrap_or(false)
        {
            return auth_error(
                StatusCode::FORBIDDEN,
                "permission_denied",
                "Current organization membership is required",
            );
        }
        if let Some((resource, action)) =
            required_permission(&request).filter(|_| !request_path.starts_with("/api/api-keys"))
        {
            let mut permissions = BTreeMap::from([(resource.into(), vec![action.into()])]);
            // Managing source credentials alone must not grant automated deployment rights.
            if matched_path.ends_with("/preview-policy") && request.method() == Method::PUT {
                permissions.insert("project".into(), vec!["create".into()]);
                permissions.insert("service".into(), vec!["create".into()]);
                permissions.insert("build".into(), vec!["execute".into()]);
                permissions.insert("deployment".into(), vec!["execute".into(), "stop".into()]);
            } else if matched_path.ends_with("/previews/{preview_id}")
                && request.method() == Method::DELETE
            {
                permissions.insert("deployment".into(), vec!["stop".into()]);
            }
            if key_identity
                .as_ref()
                .is_some_and(|key| !crate::api_keys::permits(&key.permissions, &permissions))
            {
                return auth_error(
                    StatusCode::FORBIDDEN,
                    "api_key_scope_denied",
                    "This API key does not permit this action",
                );
            }
            match service
                .has_organization_permission(&session, Some(organization_id.clone()), permissions)
                .await
            {
                Ok(true) => {}
                Ok(false) => {
                    return auth_error(
                        StatusCode::FORBIDDEN,
                        "permission_denied",
                        "Your organization role does not allow this action",
                    );
                }
                Err(_) => {
                    return auth_error(
                        StatusCode::FORBIDDEN,
                        "permission_denied",
                        "Organization membership could not be authorized",
                    );
                }
            }
        }
        match resource_belongs_to_organization(
            &state.pool,
            &matched_path,
            &request_path,
            organization_id,
        )
        .await
        {
            Ok(true) => {}
            Ok(false) => {
                return auth_error(StatusCode::NOT_FOUND, "not_found", "Resource not found");
            }
            Err(_) => {
                return auth_error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "authorization_unavailable",
                    "Authorization data is unavailable",
                );
            }
        }
    }
    if request_path.starts_with("/api/api-keys") {
        request
            .extensions_mut()
            .insert(crate::api_keys::BrowserSession(session.clone()));
        request.extensions_mut().insert(service.clone());
    }
    request.extensions_mut().insert(Context {
        actor_id: key_identity
            .map(|key| format!("api-key:{}", key.id))
            .unwrap_or(principal.actor_id),
        user_id: principal.subject_id,
        username: session
            .user
            .username
            .unwrap_or_else(|| session.user.email.clone()),
        organization_id,
        is_superuser,
    });
    next.run(request).await
}

pub fn required_organization(context: &Context) -> Result<&str, crate::ApiError> {
    context
        .organization_id
        .as_deref()
        .ok_or(crate::ApiError::Conflict("select an organization first"))
}

async fn resource_belongs_to_organization(
    pool: &PgPool,
    route: &str,
    path: &str,
    organization_id: &str,
) -> Result<bool, sqlx::Error> {
    let segments: Vec<_> = path.split('/').collect();
    let Some(identifier) = segments.get(3) else {
        return Ok(true);
    };
    if route.starts_with("/api/services/{id}") {
        let Ok(id) = identifier.parse::<uuid::Uuid>() else {
            return Ok(false);
        };
        return sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM services s JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id WHERE s.id=$1 AND p.organization_id=$2)")
            .bind(id).bind(organization_id).fetch_one(pool).await;
    }
    if route.starts_with("/api/projects/{id}") {
        let Ok(id) = identifier.parse::<uuid::Uuid>() else {
            return Ok(false);
        };
        return sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id=$1 AND organization_id=$2)",
        )
        .bind(id)
        .bind(organization_id)
        .fetch_one(pool)
        .await;
    }
    if route.starts_with("/api/nodes/{id}") {
        let Ok(id) = identifier.parse::<uuid::Uuid>() else {
            return Ok(false);
        };
        return sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM nodes WHERE id=$1 AND organization_id=$2)",
        )
        .bind(id)
        .bind(organization_id)
        .fetch_one(pool)
        .await;
    }
    if route.starts_with("/api/builds/{id}") {
        let Ok(id) = identifier.parse::<uuid::Uuid>() else {
            return Ok(false);
        };
        return sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM builds b JOIN services s ON s.id=b.service_id JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id WHERE b.id=$1 AND p.organization_id=$2)")
            .bind(id).bind(organization_id).fetch_one(pool).await;
    }
    if route.starts_with("/api/deployments/{id}") {
        let Ok(id) = identifier.parse::<uuid::Uuid>() else {
            return Ok(false);
        };
        return sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM deployments d JOIN services s ON s.id=d.service_id JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id WHERE d.id=$1 AND p.organization_id=$2)")
            .bind(id).bind(organization_id).fetch_one(pool).await;
    }
    if route.starts_with("/api/domains/{hostname}") {
        return sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM domains WHERE hostname=$1 AND organization_id=$2)",
        )
        .bind(identifier)
        .bind(organization_id)
        .fetch_one(pool)
        .await;
    }
    if route.starts_with("/api/source-connections/{id}") {
        let Ok(id) = identifier.parse::<uuid::Uuid>() else {
            return Ok(false);
        };
        return sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM source_connections WHERE id=$1 AND organization_id=$2)",
        )
        .bind(id)
        .bind(organization_id)
        .fetch_one(pool)
        .await;
    }
    Ok(true)
}

fn public_path(path: &str) -> bool {
    matches!(path, "/api/health" | "/api/openapi.json")
        || path.starts_with("/api/auth/")
        || path.starts_with("/api/agent/")
        || path.starts_with("/api/webhooks/github/")
}

fn required_permission(request: &Request) -> Option<(&'static str, &'static str)> {
    let route = request.extensions().get::<MatchedPath>()?.as_str();
    Some(permission_for(route, request.method()))
}

fn permission_for(route: &str, method: &Method) -> (&'static str, &'static str) {
    let write = !matches!(method, &Method::GET | &Method::HEAD);
    if route == "/api/audit" {
        ("audit", "read")
    } else if route == "/api/projects" || route == "/api/environments" {
        ("project", if write { "create" } else { "read" })
    } else if route.starts_with("/api/projects/") {
        ("project", if write { "update" } else { "read" })
    } else if route.starts_with("/api/builds/") {
        (
            "build",
            if route.ends_with("/cancel") && write {
                "cancel"
            } else {
                "read"
            },
        )
    } else if route.contains("/builds") {
        ("build", if write { "execute" } else { "read" })
    } else if route.contains("/deployments") {
        (
            "deployment",
            if route.ends_with("/stop") && write {
                "stop"
            } else if write {
                "execute"
            } else {
                "read"
            },
        )
    } else if route.contains("/secrets") {
        ("secret", if write { "manage" } else { "read" })
    } else if route.starts_with("/api/nodes") || route == "/api/hosts" {
        ("node", if write { "manage" } else { "read" })
    } else if route.contains("/jobs") || route.contains("/job-schedule") {
        ("job", if write { "execute" } else { "read" })
    } else if route.contains("backup") {
        ("backup", if write { "manage" } else { "read" })
    } else if route.starts_with("/api/domains") || route.contains("/networking") {
        ("domain", if write { "manage" } else { "read" })
    } else if route.contains("storage") || route.contains("volume") || route.contains("bucket") {
        ("storage", if write { "manage" } else { "read" })
    } else if route.starts_with("/api/source-connections") {
        ("source", if write { "manage" } else { "read" })
    } else if route == "/api/services" {
        ("service", if write { "create" } else { "read" })
    } else {
        ("service", if write { "update" } else { "read" })
    }
}

fn platform_roles() -> BTreeMap<String, OrganizationPermissions> {
    let all = permissions(PERMISSION_RESOURCES);
    let organization = [
        ("organization", &["update", "delete"][..]),
        ("member", &["create", "update", "delete"][..]),
        ("invitation", &["create", "cancel"][..]),
        ("team", &["create", "update", "delete"][..]),
        ("ac", &["create", "read", "update", "delete"][..]),
    ];
    let mut owner = all.clone();
    owner.extend(permissions(&organization));
    let mut admin = all;
    admin.extend(permissions(&[
        ("organization", &["update"]),
        ("member", &["create", "update", "delete"]),
        ("invitation", &["create", "cancel"]),
        ("team", &["create", "update", "delete"]),
        ("ac", &["create", "read", "update", "delete"]),
    ]));
    let operator = permissions(&[
        ("project", &["read", "create", "update"]),
        ("service", &["read", "create", "update", "delete"]),
        ("build", &["read", "execute", "cancel"]),
        ("deployment", &["read", "execute", "stop"]),
        ("secret", &["read", "manage"]),
        ("node", &["read"]),
        ("job", &["read", "execute", "manage"]),
        ("backup", &["read"]),
        ("audit", &["read"]),
        ("domain", &["read", "manage"]),
        ("storage", &["read", "manage"]),
        ("source", &["read", "manage"]),
        ("ac", &["read"]),
    ]);
    let viewer = permissions(&[
        ("project", &["read"]),
        ("service", &["read"]),
        ("build", &["read"]),
        ("deployment", &["read"]),
        ("secret", &["read"]),
        ("node", &["read"]),
        ("job", &["read"]),
        ("backup", &["read"]),
        ("audit", &["read"]),
        ("domain", &["read"]),
        ("storage", &["read"]),
        ("source", &["read"]),
        ("ac", &["read"]),
    ]);
    BTreeMap::from([
        ("owner".into(), owner),
        ("admin".into(), admin),
        ("operator".into(), operator),
        ("viewer".into(), viewer),
        ("member".into(), permissions(&[("ac", &["read"])])),
    ])
}

fn permissions(resources: &[(&str, &[&str])]) -> OrganizationPermissions {
    resources
        .iter()
        .map(|(resource, actions)| {
            (
                (*resource).to_owned(),
                actions.iter().map(|action| (*action).to_owned()).collect(),
            )
        })
        .collect()
}

fn auth_error(status: StatusCode, code: &'static str, message: &'static str) -> Response {
    (status, Json(json!({"code":code,"error":message}))).into_response()
}

#[cfg(test)]
mod tests {
    use super::permission_for;
    use axum::{
        body::Body,
        http::{Method, Request, StatusCode},
    };
    use sqlx::postgres::PgPoolOptions;
    use tower::ServiceExt;

    #[test]
    fn maps_management_routes_to_explicit_permissions() {
        let cases = [
            ("/api/projects", Method::GET, ("project", "read")),
            ("/api/projects", Method::POST, ("project", "create")),
            ("/api/environments", Method::GET, ("project", "read")),
            ("/api/projects/{id}", Method::PUT, ("project", "update")),
            ("/api/services", Method::POST, ("service", "create")),
            (
                "/api/services/{id}/builds",
                Method::POST,
                ("build", "execute"),
            ),
            ("/api/builds/{id}/cancel", Method::POST, ("build", "cancel")),
            (
                "/api/services/{id}/deployments",
                Method::POST,
                ("deployment", "execute"),
            ),
            (
                "/api/deployments/{id}/stop",
                Method::POST,
                ("deployment", "stop"),
            ),
            (
                "/api/services/{id}/secrets",
                Method::PUT,
                ("secret", "manage"),
            ),
            ("/api/nodes/{id}/actions", Method::POST, ("node", "manage")),
            ("/api/services/{id}/jobs", Method::POST, ("job", "execute")),
            ("/api/backups", Method::POST, ("backup", "manage")),
            ("/api/audit", Method::GET, ("audit", "read")),
            ("/api/domains", Method::POST, ("domain", "manage")),
            ("/api/volumes", Method::POST, ("storage", "manage")),
            (
                "/api/source-connections",
                Method::POST,
                ("source", "manage"),
            ),
        ];
        for (route, method, expected) in cases {
            assert_eq!(permission_for(route, &method), expected, "{route}");
        }
    }

    #[tokio::test]
    async fn anonymous_management_is_denied_before_database_access() {
        let pool = PgPoolOptions::new()
            .connect_lazy("postgresql:///unreachable")
            .expect("lazy PostgreSQL URL");
        let runtime = super::build(
            pool.clone(),
            vec![7; 32],
            "http://localhost:5188",
            &["http://localhost:5188".into()],
        )
        .expect("auth configuration");
        let response = crate::authenticated_router(
            pool,
            vec!["http://localhost:5188".into()],
            runtime.service,
        )
        .oneshot(
            Request::builder()
                .uri("/api/projects")
                .header("host", "localhost:8080")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}
