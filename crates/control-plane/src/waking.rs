//! Per-service waking templates. Uploaded documents are only served on application ingress.
use crate::ApiError;
use axum::{
    Json,
    extract::{Path, State},
};
use platform_domain::{ServiceSpec, scaling::ScalingPolicy};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row, types::Json as DbJson};
use uuid::Uuid;

pub const MAX_HTML_BYTES: usize = 128 * 1024;
const TEMPLATE: &str = include_str!("waking.html");
const VARIABLES: &[&str] = &[
    "service_name",
    "retry_after_seconds",
    "readiness_script",
    "csp_nonce",
];

pub(crate) struct Page {
    pub service_id: Uuid,
    pub enabled: bool,
    pub service_name: String,
    pub html: Option<String>,
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigureWakingPage {
    operation_id: Uuid,
    expected_version: i32,
    /// A complete UTF-8 HTML template, or null to restore the platform default.
    html: Option<String>,
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WakingPageState {
    version: i32,
    html: Option<String>,
    starter_template: String,
}

#[utoipa::path(get, path = "/api/services/{id}/waking-page", params(("id" = Uuid, Path)), responses((status = 200, body = WakingPageState)), operation_id = "getServiceWakingPage")]
pub async fn get(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<WakingPageState>, ApiError> {
    let row = sqlx::query("SELECT coalesce(w.version,0) AS version,w.html FROM services s LEFT JOIN service_waking_pages w ON w.service_id=s.id WHERE s.id=$1")
        .bind(id).fetch_optional(&pool).await?.ok_or(ApiError::NotFound)?;
    Ok(Json(WakingPageState {
        version: row.get("version"),
        html: row.get("html"),
        starter_template: TEMPLATE.to_owned(),
    }))
}

#[utoipa::path(put, path = "/api/services/{id}/waking-page", params(("id" = Uuid, Path)), request_body = ConfigureWakingPage, responses((status = 200, body = WakingPageState)), operation_id = "configureServiceWakingPage")]
pub async fn configure(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(input): Json<ConfigureWakingPage>,
) -> Result<Json<WakingPageState>, ApiError> {
    if let Some(html) = &input.html {
        validate(html).map_err(ApiError::Conflict)?;
    }
    let hash = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&input.html).expect("string serialization"))
    );
    let mut tx = pool.begin().await?;
    let spec: DbJson<ServiceSpec> =
        sqlx::query_scalar("SELECT spec FROM services WHERE id=$1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(ApiError::NotFound)?;
    if let Some(row) = sqlx::query("SELECT service_id,expected_version,content_hash FROM waking_page_operations WHERE operation_id=$1")
        .bind(input.operation_id).fetch_optional(&mut *tx).await? {
        if row.get::<Uuid,_>("service_id") != id || row.get::<i32,_>("expected_version") != input.expected_version || row.get::<String,_>("content_hash") != hash {
            return Err(ApiError::Conflict("operation ID belongs to another waking page update"));
        }
        tx.commit().await?;
        return get(State(pool), Path(id)).await;
    }
    if input.html.is_some() && !ScalingPolicy::eligible(&spec) {
        return Err(ApiError::Conflict(
            "custom waking pages require an eligible stateless HTTP service",
        ));
    }
    let version: Option<i32> =
        sqlx::query_scalar("SELECT version FROM service_waking_pages WHERE service_id=$1")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    if version.unwrap_or(0) != input.expected_version {
        return Err(ApiError::Conflict(
            "waking page changed; reload before saving",
        ));
    }
    sqlx::query("INSERT INTO service_waking_pages(service_id,html) VALUES($1,$2) ON CONFLICT(service_id) DO UPDATE SET html=EXCLUDED.html,version=service_waking_pages.version+1")
        .bind(id).bind(&input.html).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO waking_page_operations(operation_id,service_id,expected_version,content_hash) VALUES($1,$2,$3,$4)")
        .bind(input.operation_id).bind(id).bind(input.expected_version).bind(&hash).execute(&mut *tx).await?;
    // Never copy uploaded HTML into audit events or logs.
    sqlx::query("INSERT INTO audit_log(actor,action,outcome,target_type,target_id,details,organization_id) SELECT 'platform','service.waking_page.updated','succeeded','service',$1,$2,p.organization_id FROM services s JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id WHERE s.id=$1::uuid")
        .bind(id.to_string()).bind(DbJson(serde_json::json!({"operationId":input.operation_id,"custom":input.html.is_some(),"bytes":input.html.as_ref().map_or(0, String::len),"contentHash":hash})))
        .execute(&mut *tx).await?;
    tx.commit().await?;
    get(State(pool), Path(id)).await
}

fn validate(html: &str) -> Result<(), &'static str> {
    if html.trim().is_empty() || html.len() > MAX_HTML_BYTES || html.contains('\0') {
        return Err("upload a UTF-8 HTML template between 1 byte and 128 KiB");
    }
    if html.matches("{{readiness_script}}").count() != 1 {
        return Err("include {{readiness_script}} exactly once, before </body>");
    }
    let mut rest = html;
    while let Some((_, tail)) = rest.split_once("{{") {
        let Some((variable, tail)) = tail.split_once("}}") else {
            return Err("unclosed waking page template variable");
        };
        if !VARIABLES.contains(&variable) {
            return Err("unknown waking page template variable");
        }
        rest = tail;
    }
    Ok(())
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub(crate) fn render(template: Option<&str>, service_name: &str, nonce: &str) -> String {
    let script = format!(
        "<noscript><meta http-equiv=\"refresh\" content=\"5\"></noscript><script nonce=\"{nonce}\">{}</script>",
        include_str!("waking.js")
    );
    let name = escape(service_name);
    let mut rest = template.unwrap_or(TEMPLATE);
    let mut result = String::with_capacity(rest.len() + script.len());
    // Single pass: a service name or other replacement cannot introduce tokens.
    while let Some((before, tail)) = rest.split_once("{{") {
        result.push_str(before);
        let Some((variable, tail)) = tail.split_once("}}") else {
            result.push_str("{{");
            result.push_str(tail);
            return result;
        };
        result.push_str(match variable {
            "service_name" => &name,
            "retry_after_seconds" => "5",
            "readiness_script" => &script,
            "csp_nonce" => nonce,
            _ => "",
        });
        rest = tail;
    }
    result.push_str(rest);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_templates_and_renders_variables_without_recursive_expansion() {
        assert!(validate(TEMPLATE).is_ok());
        for invalid in [
            "",
            "{{readiness_script}}{{readiness_script}}",
            "{{readiness_script}}{{unknown}}",
            "{{readiness_script}}{{",
            "<h1>Missing script</h1>",
        ] {
            assert!(validate(invalid).is_err());
        }
        assert!(
            validate(&format!(
                "{{{{readiness_script}}}}{}",
                "x".repeat(MAX_HTML_BYTES)
            ))
            .is_err()
        );
        let html = render(
            Some("<h1>{{service_name}}</h1>{{retry_after_seconds}}{{readiness_script}}"),
            "<script>\"{{readiness_script}}",
            "test-nonce",
        );
        assert!(html.contains("&lt;script&gt;&quot;{{readiness_script}}"));
        assert_eq!(html.matches("<script nonce=\"test-nonce\">").count(), 1);
        assert!(html.contains("X-Local-Paas-Wake-Check"));
        assert!(html.contains("location.reload()"));
    }
}
