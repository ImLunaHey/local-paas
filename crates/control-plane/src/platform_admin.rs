use crate::ApiError;
use axum::{Extension, Json, extract::State};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    organizations: Vec<Organization>,
    organization_count: i64,
    user_count: i64,
    project_count: i64,
    service_count: i64,
    billing: Billing,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct Organization {
    id: String,
    name: String,
    slug: String,
    created_at: DateTime<Utc>,
    member_count: i64,
    project_count: i64,
    service_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Billing {
    configured: bool,
    provider: Option<String>,
}

pub async fn overview(
    State(pool): State<PgPool>,
    Extension(context): Extension<crate::auth::Context>,
) -> Result<Json<Overview>, ApiError> {
    if !context.is_superuser {
        return Err(ApiError::Forbidden);
    }
    let organizations = sqlx::query_as::<_, Organization>(
        r#"SELECT o.id,
                  o.name,
                  o.slug,
                  o."createdAt" AS created_at,
                  (SELECT count(*) FROM member m WHERE m."organizationId" = o.id) AS member_count,
                  (SELECT count(*) FROM projects p WHERE p.organization_id = o.id) AS project_count,
                  (SELECT count(*)
                     FROM services s
                     JOIN environments e ON e.id = s.environment_id
                     JOIN projects p ON p.id = e.project_id
                    WHERE p.organization_id = o.id) AS service_count
             FROM organization o
         ORDER BY o."createdAt" DESC, o.id DESC"#,
    )
    .fetch_all(&pool)
    .await?;
    let user_count = sqlx::query_scalar::<_, i64>(r#"SELECT count(*) FROM "user""#)
        .fetch_one(&pool)
        .await?;
    let project_count = sqlx::query_scalar::<_, i64>("SELECT count(*) FROM projects")
        .fetch_one(&pool)
        .await?;
    let service_count = sqlx::query_scalar::<_, i64>("SELECT count(*) FROM services")
        .fetch_one(&pool)
        .await?;
    Ok(Json(Overview {
        organization_count: organizations.len() as i64,
        organizations,
        user_count,
        project_count,
        service_count,
        billing: Billing {
            configured: false,
            provider: None,
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::overview;
    use crate::{ApiError, auth::Context};
    use axum::{Extension, extract::State};
    use sqlx::postgres::PgPoolOptions;

    #[tokio::test]
    async fn organization_administrators_cannot_read_platform_admin_data() {
        let pool = PgPoolOptions::new()
            .connect_lazy("postgresql:///not-contacted")
            .unwrap();
        let context = Context {
            actor_id: "member".into(),
            user_id: "member".into(),
            username: "member".into(),
            organization_id: Some("organization".into()),
            is_superuser: false,
        };
        let result = overview(State(pool), Extension(context)).await;
        assert!(matches!(result, Err(ApiError::Forbidden)));
    }
}
