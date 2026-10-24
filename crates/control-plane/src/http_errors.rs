//! Normalize framework rejections without reflecting request bodies or credentials.
use axum::{
    Json,
    extract::Request,
    http::{StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};

pub async fn normalize(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let status = response.status();
    let is_json = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.split(';').next() == Some("application/json"));
    if (status.is_client_error() || status.is_server_error()) && !is_json {
        let (code, message) = match status {
            StatusCode::BAD_REQUEST => ("invalid_request", "Invalid request parameters or JSON."),
            StatusCode::UNAUTHORIZED => ("unauthorized", "Authentication required."),
            StatusCode::FORBIDDEN => ("forbidden", "This request is not permitted."),
            StatusCode::NOT_FOUND => ("not_found", "Resource not found."),
            StatusCode::METHOD_NOT_ALLOWED => {
                ("method_not_allowed", "This method is not supported.")
            }
            StatusCode::PAYLOAD_TOO_LARGE => {
                ("payload_too_large", "The request exceeds the size limit.")
            }
            StatusCode::UNSUPPORTED_MEDIA_TYPE => (
                "unsupported_media_type",
                "Use application/json for this request.",
            ),
            StatusCode::UNPROCESSABLE_ENTITY => (
                "validation_failed",
                "Request fields do not match the API contract.",
            ),
            StatusCode::SERVICE_UNAVAILABLE => (
                "dependency_unavailable",
                "The requested operation is temporarily unavailable.",
            ),
            _ => ("request_failed", "The request could not be completed."),
        };
        let body = Json(serde_json::json!({"code":code,"error":message}))
            .into_response()
            .into_body();
        *response.body_mut() = body;
        response.headers_mut().remove(header::CONTENT_LENGTH);
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            header::HeaderValue::from_static("application/json"),
        );
    }
    response
}
