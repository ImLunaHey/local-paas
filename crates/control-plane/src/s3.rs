//! Minimal signed S3/admin transport. Endpoints are platform-owned loopback ports.
use crate::ApiError;
use aws_credential_types::Credentials;
use aws_sigv4::{
    http_request::{PayloadChecksumKind, SignableBody, SignableRequest, SigningSettings, sign},
    sign::v4,
};
use reqwest::{Method, Response};
use std::time::{Duration, SystemTime};
pub(crate) struct Client {
    port: u16,
    access: String,
    secret: String,
}
impl Client {
    pub fn new(port: i32, access: String, secret: String) -> Result<Self, ApiError> {
        if !u16::try_from(port).is_ok_and(platform_protocol::valid_node_port) {
            return Err(ApiError::Conflict("invalid storage endpoint"));
        }
        Ok(Self {
            port: port as u16,
            access,
            secret,
        })
    }
    pub async fn request(
        &self,
        method: Method,
        path: &str,
        body: Vec<u8>,
    ) -> Result<Response, ApiError> {
        self.request_headers(method, path, body, &[]).await
    }
    pub async fn request_headers(
        &self,
        method: Method,
        path: &str,
        body: Vec<u8>,
        headers: &[(&str, &str)],
    ) -> Result<Response, ApiError> {
        let url = format!("http://127.0.0.1:{}{path}", self.port);
        let identity =
            Credentials::new(&self.access, &self.secret, None, None, "platform-storage").into();
        let mut settings = SigningSettings::default();
        settings.payload_checksum_kind = PayloadChecksumKind::XAmzSha256;
        settings.percent_encoding_mode = aws_sigv4::http_request::PercentEncodingMode::Single;
        settings.uri_path_normalization_mode =
            aws_sigv4::http_request::UriPathNormalizationMode::Disabled;
        let params = v4::SigningParams::builder()
            .identity(&identity)
            .region("us-east-1")
            .name("s3")
            .time(SystemTime::now())
            .settings(settings)
            .build()
            .map_err(|_| ApiError::Database)?
            .into();
        let request = SignableRequest::new(
            method.as_str(),
            &url,
            headers.iter().copied(),
            SignableBody::Bytes(&body),
        )
        .map_err(|_| ApiError::Database)?;
        let (instructions, _) = sign(request, &params)
            .map_err(|_| ApiError::Database)?
            .into_parts();
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| ApiError::Database)?;
        let mut req = client.request(method, url).body(body);
        for (name, value) in headers {
            req = req.header(*name, *value);
        }
        for (name, value) in instructions.headers() {
            req = req.header(name, value);
        }
        req.send()
            .await
            .map_err(|_| ApiError::Unavailable("RustFS is unavailable; check its deployment"))
    }
    pub async fn put(&self, path: &str, body: Vec<u8>) -> Result<(), ApiError> {
        let r = self.request(Method::PUT, path, body).await?;
        if !r.status().is_success() {
            return Err(ApiError::Unavailable(
                "RustFS rejected provisioning; retained metadata allows retry",
            ));
        }
        Ok(())
    }
}
