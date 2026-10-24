//! API schemas shared with the generated dashboard client.
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};
use uuid::Uuid;

#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorResponse {
    pub code: String,
    pub error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issues: Option<Vec<platform_domain::ValidationIssue>>,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct ServiceList {
    pub items: Vec<crate::Service>,
    pub total: i64,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct ProjectIdentity {
    pub id: Uuid,
    pub name: String,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct ProjectSummary {
    pub id: Uuid,
    pub name: String,
    pub environments: i64,
    pub services: i64,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct ProjectList {
    pub items: Vec<ProjectSummary>,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct EnvironmentSummary {
    pub id: Uuid,
    pub name: String,
    pub project: String,
    pub parent_id: Option<Uuid>,
    pub parent_name: Option<String>,
    pub service_count: i64,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct ProjectDetail {
    pub id: Uuid,
    pub name: String,
    pub environments: Vec<EnvironmentSummary>,
}

#[derive(OpenApi)]
#[openapi(
    info(
        title = "local-paas management API",
        version = "0.1.0",
        description = "Private operator API. Existing v1 field names are retained for compatibility with persisted service specifications and agents."
    ),
    paths(
        crate::health,
        crate::validate_spec,
        crate::list_services,
        crate::get_service,
        crate::create_service,
        crate::projects::list,
        crate::projects::create,
        crate::projects::get,
        crate::projects::update
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
