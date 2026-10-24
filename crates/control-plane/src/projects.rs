use crate::{
    ApiError,
    openapi::{EnvironmentSummary, ProjectDetail, ProjectList, ProjectSummary},
};
use axum::{
    Extension, Json,
    extract::{Path, State},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;
pub fn valid_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 63
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && s.as_bytes()[0].is_ascii_alphanumeric()
}
fn validate_project_name(value: &str, _: &()) -> garde::Result {
    if valid_name(value) {
        Ok(())
    } else {
        Err(garde::Error::new("invalid project name"))
    }
}

#[utoipa::path(get, path = "/api/projects", responses((status = 200, body = crate::openapi::ProjectList)), operation_id = "listProjects")]
pub async fn list(
    State(pool): State<PgPool>,
    Extension(context): Extension<crate::auth::Context>,
) -> Result<Json<ProjectList>, ApiError> {
    let items = sqlx::query_as::<_, ProjectSummary>(r#"
        SELECT p.id, p.name,
          (SELECT count(*) FROM environments e WHERE e.project_id=p.id) AS environments,
          (SELECT count(DISTINCT s.name) FROM services s JOIN environments e ON e.id=s.environment_id WHERE e.project_id=p.id) AS services
        FROM projects p WHERE ($1::text IS NULL OR p.organization_id=$1) ORDER BY p.name
    "#).bind(context.organization_id.as_deref()).fetch_all(&pool).await?;
    Ok(Json(ProjectList { items }))
}
#[derive(Deserialize, utoipa::ToSchema, garde::Validate)]
#[serde(deny_unknown_fields)]
#[schema(as = ProjectCreate)]
#[serde(rename_all = "camelCase")]
pub struct Create {
    #[garde(custom(validate_project_name))]
    name: String,
}
#[utoipa::path(post, path = "/api/projects", request_body = Create, responses((status = 200, body = crate::openapi::ProjectIdentity), (status = 409, body = crate::openapi::ErrorResponse)), operation_id = "createProject")]
pub async fn create(
    State(pool): State<PgPool>,
    Extension(context): Extension<crate::auth::Context>,
    Json(input): Json<Create>,
) -> Result<Json<Value>, ApiError> {
    if garde::Validate::validate(&input).is_err() {
        return Err(ApiError::Conflict(
            "use a lowercase project name up to 63 characters",
        ));
    }
    let mut tx = pool.begin().await?;
    let organization = crate::auth::required_organization(&context)?;
    let id: Uuid = sqlx::query_scalar("INSERT INTO projects(id,organization_id,name) VALUES($1,$2,$3) ON CONFLICT(organization_id,name) DO UPDATE SET name=excluded.name RETURNING id")
        .bind(Uuid::now_v7())
        .bind(organization)
        .bind(&input.name)
        .fetch_one(&mut *tx)
        .await?;
    for name in ["production", "development"] {
        sqlx::query!(
            "INSERT INTO environments(id,project_id,name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            Uuid::now_v7(),
            id,
            name
        )
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"id":id,"name":input.name})))
}
#[utoipa::path(get, path = "/api/projects/{id}", params(("id" = Uuid, Path)), responses((status = 200, body = crate::openapi::ProjectDetail), (status = 404, body = crate::openapi::ErrorResponse)), operation_id = "getProject")]
pub async fn get(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ProjectDetail>, ApiError> {
    let name = sqlx::query_scalar!("SELECT name FROM projects WHERE id=$1", id)
        .fetch_optional(&pool)
        .await?
        .ok_or(ApiError::NotFound)?;
    let environments = sqlx::query_as!(
        EnvironmentSummary,
        r#"
        SELECT e.id, e.name, $2::text AS "project!", e.parent_id,
          p.name AS "parent_name?",
          (SELECT count(*) FROM services s WHERE s.environment_id=e.id) AS "service_count!"
        FROM environments e LEFT JOIN environments p ON p.id=e.parent_id
        WHERE e.project_id=$1 ORDER BY e.name
    "#,
        id,
        &name
    )
    .fetch_all(&pool)
    .await?;
    Ok(Json(ProjectDetail {
        id,
        name,
        environments,
    }))
}

#[derive(Deserialize, utoipa::ToSchema, garde::Validate)]
#[serde(deny_unknown_fields)]
#[schema(as = ProjectUpdate)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    #[garde(custom(validate_project_name))]
    name: String,
    #[garde(skip)]
    expected_name: String,
}
#[utoipa::path(put, path = "/api/projects/{id}", params(("id" = Uuid, Path)), request_body = Update, responses((status = 200, body = crate::openapi::ProjectIdentity), (status = 409, body = crate::openapi::ErrorResponse)), operation_id = "updateProject")]
pub async fn update(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(input): Json<Update>,
) -> Result<Json<Value>, ApiError> {
    if garde::Validate::validate(&input).is_err() {
        return Err(ApiError::Conflict(
            "use a lowercase project name up to 63 characters",
        ));
    }
    let mut tx = pool.begin().await?;
    let (name, organization_id): (String, Option<String>) =
        sqlx::query_as("SELECT name,organization_id FROM projects WHERE id=$1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(ApiError::NotFound)?;
    if name != input.expected_name && name != input.name {
        return Err(ApiError::Conflict(
            "project changed; reload settings before saving",
        ));
    }
    let taken: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE organization_id IS NOT DISTINCT FROM $1 AND name=$2 AND id<>$3)",
    )
    .bind(organization_id)
    .bind(&input.name)
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    if taken {
        return Err(ApiError::Conflict("another project already uses this name"));
    }
    if name != input.name {
        sqlx::query!("UPDATE projects SET name=$2 WHERE id=$1", id, &input.name)
            .execute(&mut *tx)
            .await?;
        // Desired configuration follows the new name; historical build/deployment snapshots remain immutable.
        sqlx::query!("UPDATE services SET spec=jsonb_set(spec,'{project}',to_jsonb($2::text)),version=version+1 WHERE environment_id IN (SELECT id FROM environments WHERE project_id=$1)", id, &input.name).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"id":id,"name":input.name})))
}
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Search {
    #[serde(default)]
    q: String,
}
pub async fn search(
    State(pool): State<PgPool>,
    Extension(context): Extension<crate::auth::Context>,
    axum::extract::Query(input): axum::extract::Query<Search>,
) -> Result<Json<Value>, ApiError> {
    if input.q.len() > 128 {
        return Err(ApiError::Conflict("search must be at most 128 characters"));
    }
    let items: Vec<Value> = sqlx::query_scalar("SELECT to_jsonb(result) FROM (SELECT 'project' AS kind,p.id,p.name,p.id AS \"projectId\",p.name AS project,NULL::text AS environment FROM projects p WHERE ($2::text IS NULL OR p.organization_id=$2) AND strpos(lower(p.name),lower($1))>0 UNION ALL SELECT 'service',s.id,s.name,p.id,p.name,e.name FROM services s JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id WHERE ($2::text IS NULL OR p.organization_id=$2) AND strpos(lower(s.name||' '||p.name||' '||e.name),lower($1))>0 ORDER BY kind,name LIMIT 30) result")
        .bind(input.q.trim())
        .bind(context.organization_id.as_deref())
        .fetch_all(&pool)
        .await?;
    Ok(Json(json!({"items":items})))
}
