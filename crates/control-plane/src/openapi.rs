//! API schemas shared with the generated dashboard client.
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};
use uuid::Uuid;

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ErrorResponse {
    pub code: String,
    pub error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issues: Option<Vec<platform_domain::ValidationIssue>>,
}
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ServiceList {
    pub items: Vec<crate::Service>,
    pub total: i64,
}
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIdentity {
    pub id: Uuid,
    pub name: String,
}
#[derive(Serialize, Deserialize, ToSchema, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: Uuid,
    pub name: String,
    pub environments: i64,
    pub services: i64,
}
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectList {
    pub items: Vec<ProjectSummary>,
}
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentSummary {
    pub id: Uuid,
    pub name: String,
    pub project: String,
    pub parent_id: Option<Uuid>,
    pub parent_name: Option<String>,
    pub service_count: i64,
}
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetail {
    pub id: Uuid,
    pub name: String,
    pub environments: Vec<EnvironmentSummary>,
}

#[derive(OpenApi)]
#[openapi(
    info(
        title = "local-paas management API",
        version = "0.2.0",
        description = "Private operator API with camelCase fields. Controller, dashboard and protocol v2 agents must be upgraded together."
    ),
    paths(
        crate::health,
        crate::validate_spec,
        crate::list_services,
        crate::get_service,
        crate::list_events,
        crate::configuration::update,
        crate::create_service,
        crate::projects::list,
        crate::projects::create,
        crate::projects::get,
        crate::projects::update,
        crate::domains::list,
        crate::domains::create,
        crate::domains::update,
        crate::edge::rollout::rollback
    ),
    components(schemas(
        ErrorResponse,
        ServiceList,
        ProjectIdentity,
        ProjectSummary,
        ProjectList,
        EnvironmentSummary,
        ProjectDetail
    ))
)]
pub struct ApiDoc;
pub async fn document() -> Json<utoipa::openapi::OpenApi> {
    Json(ApiDoc::openapi())
}
