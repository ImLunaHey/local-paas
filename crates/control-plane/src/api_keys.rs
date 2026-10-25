//! Personal organization credentials. Raw keys are returned once and never stored.
use crate::{
    ApiError,
    auth::{Context, GuardState},
};
use axum::{
    Extension, Json,
    extract::{Path, State},
    http::{HeaderMap, header},
};
use chrono::{DateTime, Duration, Utc};
use lucid_auth::{
    AuthSession, AuthStore, OrganizationPermissions, SessionWithUser, postgres::PostgresStore,
};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, types::Json as DbJson};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateKey {
    #[schema(min_length = 1, max_length = 80)]
    pub name: String,
    #[schema(minimum = 1, maximum = 90)]
    pub expires_in_days: u32,
    pub permissions: OrganizationPermissions,
}

#[derive(Serialize, ToSchema, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct KeyMetadata {
    pub id: Uuid,
    pub name: String,
    pub prefix: String,
    #[schema(value_type = std::collections::BTreeMap<String, Vec<String>>)]
    pub permissions: DbJson<OrganizationPermissions>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatedKey {
    pub key: String,
    pub metadata: KeyMetadata,
}

#[derive(Clone)]
pub struct BrowserSession(pub SessionWithUser);

#[derive(Clone)]
pub struct KeyIdentity {
    pub id: Uuid,
    pub permissions: OrganizationPermissions,
}

pub fn validate(input: &CreateKey) -> Result<(), ApiError> {
    if input.name.trim().is_empty()
        || input.name.chars().count() > 80
        || !(1..=90).contains(&input.expires_in_days)
    {
        return Err(ApiError::Conflict(
            "use a name of 1–80 characters and an expiry of 1–90 days",
        ));
    }
    if input.permissions.is_empty()
        || input.permissions.iter().any(|(resource, actions)| {
            actions.is_empty()
                || !crate::auth::PERMISSION_RESOURCES
                    .iter()
                    .any(|(r, allowed)| {
                        r == resource
                            && actions
                                .iter()
                                .all(|action| allowed.contains(&action.as_str()))
                    })
        })
    {
        return Err(ApiError::Conflict(
            "select explicit supported API permissions",
        ));
    }
    Ok(())
}

fn no_store() -> HeaderMap {
    HeaderMap::from_iter([(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    )])
}

#[utoipa::path(post, path="/api/api-keys", request_body=CreateKey, responses((status=200, body=CreatedKey)), operation_id="createApiKey")]
pub async fn create(
    State(pool): State<PgPool>,
    Extension(context): Extension<Context>,
    Extension(BrowserSession(session)): Extension<BrowserSession>,
    Extension(service): Extension<std::sync::Arc<lucid_auth::AuthService>>,
    Json(input): Json<CreateKey>,
) -> Result<(HeaderMap, Json<CreatedKey>), ApiError> {
    validate(&input)?;
    let organization = crate::auth::required_organization(&context)?;
    if session.session.actor_user_id.is_some()
        || !service
            .has_organization_permission(
                &session,
                Some(organization.into()),
                input.permissions.clone(),
            )
            .await
            .unwrap_or(false)
    {
        return Err(ApiError::Conflict(
            "keys require your own organization membership and cannot exceed your role",
        ));
    }
    let id = Uuid::now_v7();
    let key = format!("lp_{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let hash = crate::runtime::token_hash(&key);
    let mut tx = pool.begin().await?;
    // Serialize creation per owner to enforce a bounded active-key count.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("api-keys:{}:{organization}", context.user_id))
        .execute(&mut *tx)
        .await?;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM personal_api_keys WHERE user_id=$1 AND organization_id=$2 AND revoked_at IS NULL AND expires_at>now()")
        .bind(&context.user_id).bind(organization).fetch_one(&mut *tx).await?;
    if count >= 20 {
        return Err(ApiError::Conflict(
            "revoke an existing key before creating more than 20 active keys",
        ));
    }
    let metadata = sqlx::query_as::<_,KeyMetadata>("INSERT INTO personal_api_keys(id,user_id,organization_id,name,token_hash,prefix,permissions,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,name,prefix,permissions,created_at,expires_at,revoked_at")
        .bind(id).bind(&context.user_id).bind(organization).bind(input.name.trim()).bind(hash).bind(&key[..11])
        .bind(DbJson(input.permissions)).bind(Utc::now()+Duration::days(i64::from(input.expires_in_days))).fetch_one(&mut *tx).await?;
    audit(&mut tx, &context, id, "api_key.create").await?;
    tx.commit().await?;
    Ok((no_store(), Json(CreatedKey { key, metadata })))
}

#[utoipa::path(get, path="/api/api-keys", responses((status=200, body=[KeyMetadata])), operation_id="listApiKeys")]
pub async fn list(
    State(pool): State<PgPool>,
    Extension(context): Extension<Context>,
) -> Result<(HeaderMap, Json<Vec<KeyMetadata>>), ApiError> {
    let organization = crate::auth::required_organization(&context)?;
    let rows = sqlx::query_as("SELECT id,name,prefix,permissions,created_at,expires_at,revoked_at FROM personal_api_keys WHERE user_id=$1 AND organization_id=$2 ORDER BY created_at DESC LIMIT 100")
        .bind(&context.user_id).bind(organization).fetch_all(&pool).await?;
    Ok((no_store(), Json(rows)))
}

#[utoipa::path(delete, path="/api/api-keys/{id}", params(("id"=Uuid,Path)), responses((status=200)), operation_id="revokeApiKey")]
pub async fn revoke(
    State(pool): State<PgPool>,
    Extension(context): Extension<Context>,
    Path(id): Path<Uuid>,
) -> Result<(HeaderMap, Json<serde_json::Value>), ApiError> {
    let organization = crate::auth::required_organization(&context)?;
    let mut tx = pool.begin().await?;
    let result=sqlx::query("UPDATE personal_api_keys SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1 AND user_id=$2 AND organization_id=$3")
        .bind(id).bind(&context.user_id).bind(organization).execute(&mut *tx).await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }
    audit(&mut tx, &context, id, "api_key.revoke").await?;
    tx.commit().await?;
    Ok((no_store(), Json(serde_json::json!({"revoked":true}))))
}

async fn audit(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    context: &Context,
    id: Uuid,
    action: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO audit_log(request_id,actor,action,outcome,target_type,target_id,organization_id,details) VALUES($1,$2,$3,'succeeded','api_key',$4,$5,'{}')")
        .bind(Uuid::now_v7()).bind(context.audit_actor()).bind(action).bind(id.to_string()).bind(&context.organization_id).execute(&mut **tx).await?;
    Ok(())
}

/// Re-check account and organization permissions on every use, including role removal.
pub async fn authenticate(
    state: &GuardState,
    token: &str,
) -> Option<(SessionWithUser, KeyIdentity)> {
    if token.len() != 67
        || !token.starts_with("lp_")
        || !token[3..].bytes().all(|c| c.is_ascii_hexdigit())
    {
        return None;
    }
    let row: (Uuid,String,String,DbJson<OrganizationPermissions>,DateTime<Utc>) = sqlx::query_as("SELECT id,user_id,organization_id,permissions,expires_at FROM personal_api_keys WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()")
        .bind(crate::runtime::token_hash(token)).fetch_optional(&state.pool).await.ok()??;
    let store = PostgresStore::new(state.pool.clone(), Default::default());
    store
        .bind_schema(std::sync::Arc::new(state.service.database_schema().clone()))
        .ok()?;
    let user = store.find_user_by_id(&row.1).await.ok()??;
    if user.banned || user.is_anonymous {
        return None;
    }
    let now = Utc::now();
    let session = AuthSession {
        id: row.0.to_string(),
        user_id: user.id.clone(),
        token: String::new(),
        actor_user_id: None,
        authentication_method: None,
        expires_at: row.4,
        created_at: now,
        updated_at: now,
        ip_address: None,
        user_agent: None,
        additional_fields: serde_json::Map::from_iter([(
            "activeOrganizationId".into(),
            serde_json::Value::String(row.2),
        )]),
    };
    Some((
        SessionWithUser { session, user },
        KeyIdentity {
            id: row.0,
            permissions: row.3.0,
        },
    ))
}

pub fn permits(available: &OrganizationPermissions, required: &OrganizationPermissions) -> bool {
    required.iter().all(|(resource, actions)| {
        available
            .get(resource)
            .is_some_and(|allowed| actions.iter().all(|action| allowed.contains(action)))
    })
}
