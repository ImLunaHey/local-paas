//! Caddy's scoped JSON API; no process reload and no whole-config replacement.
use super::{Edge, Failure, Observation, Route};
use chrono::{DateTime, Utc};
use hickory_resolver::{TokioResolver, proto::rr::RData};
use reqwest::{Client, Method, StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{net::SocketAddr, path::PathBuf, time::Duration};

#[cfg(test)]
mod tests;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    /// Permissioned local Unix socket, or HTTPS with a client identity below.
    pub admin_socket: Option<PathBuf>,
    pub admin_url: Option<String>,
    pub admin_ca_file: Option<PathBuf>,
    pub admin_identity_file: Option<PathBuf>,
    pub public_address: SocketAddr,
    /// Optional private development CA; never disables hostname verification.
    pub probe_ca_file: Option<PathBuf>,
    pub gateway_address: SocketAddr,
    pub gateway_server_name: String,
    /// These paths are resolved on the Caddy host, not on the controller.
    pub gateway_ca_file: PathBuf,
    pub gateway_certificate_file: PathBuf,
    pub gateway_key_file: PathBuf,
    #[serde(default = "ingress_port")]
    pub ingress_port: u16,
}

pub struct Caddy {
    config: Config,
    admin: Client,
    admin_url: String,
    dns: TokioResolver,
    probe_ca: Option<reqwest::Certificate>,
}
const ROUTES: &str = "/config/apps/http/servers/platform/routes";

impl Caddy {
    pub fn new(config: Config) -> Result<Self, Failure> {
        let mut builder = client();
        let admin_url = if let Some(socket) = &config.admin_socket {
            if !socket.is_absolute() || config.admin_url.is_some() {
                return Err(Failure::Configuration);
            }
            builder = builder.unix_socket(socket.as_path());
            "http://localhost".to_string()
        } else {
            let url =
                reqwest::Url::parse(config.admin_url.as_deref().ok_or(Failure::Configuration)?)
                    .map_err(|_| Failure::Configuration)?;
            if url.scheme() != "https"
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
                || url.path() != "/"
            {
                return Err(Failure::Configuration);
            }
            let ca = std::fs::read(
                config
                    .admin_ca_file
                    .as_ref()
                    .ok_or(Failure::Configuration)?,
            )
            .map_err(|_| Failure::Configuration)?;
            let identity = std::fs::read(
                config
                    .admin_identity_file
                    .as_ref()
                    .ok_or(Failure::Configuration)?,
            )
            .map_err(|_| Failure::Configuration)?;
            builder = builder
                .add_root_certificate(
                    reqwest::Certificate::from_pem(&ca).map_err(|_| Failure::Configuration)?,
                )
                .identity(
                    reqwest::Identity::from_pem(&identity).map_err(|_| Failure::Configuration)?,
                );
            url.as_str().trim_end_matches('/').to_string()
        };
        if config.gateway_address.ip().is_unspecified()
            || config.public_address.ip().is_unspecified()
            || crate::domains::normalize(&config.gateway_server_name).is_none()
            || [
                &config.gateway_ca_file,
                &config.gateway_certificate_file,
                &config.gateway_key_file,
            ]
            .iter()
            .any(|p| !p.is_absolute())
        {
            return Err(Failure::Configuration);
        }
        let probe_ca = config
            .probe_ca_file
            .as_ref()
            .map(|path| {
                let pem = std::fs::read(path).map_err(|_| Failure::Configuration)?;
                reqwest::Certificate::from_pem(&pem).map_err(|_| Failure::Configuration)
            })
            .transpose()?;
        Ok(Self {
            config,
            admin: builder.build().map_err(|_| Failure::Configuration)?,
            admin_url,
            dns: TokioResolver::builder_tokio()
                .map_err(|_| Failure::Configuration)?
                .build()
                .map_err(|_| Failure::Configuration)?,
            probe_ca,
        })
    }

    async fn verify_dns(&self, route: &Route) -> Result<(), Failure> {
        let txt = self
            .dns
            .txt_lookup(format!("{}.", route.challenge_name()))
            .await
            .map_err(|_| Failure::Ownership)?;
        let expected = route.challenge_value();
        if !txt.answers().iter().any(|record| match &record.data {
            RData::TXT(value) => value
                .txt_data
                .iter()
                .flat_map(|part| part.iter().copied())
                .eq(expected.bytes()),
            _ => false,
        }) {
            return Err(Failure::Ownership);
        }
        let addresses = self
            .dns
            .lookup_ip(format!("{}.", route.hostname))
            .await
            .map_err(|_| Failure::Dns)?;
        // One explicitly configured edge address. A stray AAAA or round-robin
        // record is not evidence that every public path is safe and reachable.
        let addresses: Vec<_> = addresses.iter().collect();
        if addresses.is_empty()
            || addresses
                .iter()
                .any(|ip| *ip != self.config.public_address.ip())
        {
            return Err(Failure::Dns);
        }
        Ok(())
    }

    fn document(&self, route: &Route) -> Value {
        json!({
            "@id": format!("local-paas-{}",route.id.simple()),
            "match": [{"host":[route.hostname]}],
            "handle": [{"handler":"reverse_proxy",
                "upstreams":[{"dial":self.config.gateway_address.to_string()}],
                "headers":{"request":{"set":{"Host":[self.config.gateway_server_name],"X-Local-Paas-Route":[route.authority(route.generation)]}}},
                "flush_interval":-1,
                "stream_close_delay":120_000_000_000_i64,
                "transport":{"protocol":"http","dial_timeout":3_000_000_000_i64,
                    "response_header_timeout":30_000_000_000_i64,
                    "tls":{"server_name":self.config.gateway_server_name,
                        "ca":{"provider":"file","pem_files":[self.config.gateway_ca_file]},
                        "client_certificate_file":self.config.gateway_certificate_file,
                        "client_certificate_key_file":self.config.gateway_key_file}}
            }],
            "terminal":true
        })
    }

    async fn routes(&self) -> Result<(Value, String), Failure> {
        let mut response = self
            .admin
            .get(format!("{}{ROUTES}", self.admin_url))
            .send()
            .await
            .map_err(|_| Failure::Unavailable)?;
        if !response.status().is_success() {
            return Err(Failure::Configuration);
        }
        let etag = response
            .headers()
            .get("etag")
            .and_then(|h| h.to_str().ok())
            .ok_or(Failure::Configuration)?
            .to_string();
        if response.content_length().is_some_and(|n| n > 1024 * 1024) {
            return Err(Failure::Configuration);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| Failure::Unavailable)? {
            if bytes.len() + chunk.len() > 1024 * 1024 {
                return Err(Failure::Configuration);
            }
            bytes.extend_from_slice(&chunk);
        }
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| Failure::Configuration)?;
        if !value.is_array() {
            return Err(Failure::Configuration);
        }
        Ok((value, etag))
    }

    async fn apply(&self, route: &Route) -> Result<(), Failure> {
        let id = format!("local-paas-{}", route.id.simple());
        for _ in 0..3 {
            let (mut routes, etag) = self.routes().await?;
            let items = routes.as_array_mut().ok_or(Failure::Configuration)?;
            let position = items.iter().position(|value| value["@id"] == id);
            let desired = route.deployment.map(|_| self.document(route));
            match (position, desired) {
                (Some(index), Some(value)) if items[index] == value => return Ok(()),
                (Some(index), Some(value)) => items[index] = value,
                (None, Some(value)) => items.insert(0, value),
                (Some(index), None) => {
                    items.remove(index);
                }
                (None, None) => return Ok(()),
            }
            let response = self
                .admin
                .request(Method::PATCH, format!("{}{ROUTES}", self.admin_url))
                .header("if-match", etag)
                .header("content-type", "application/json")
                .body(routes.to_string())
                .send()
                .await
                .map_err(|_| Failure::Unavailable)?;
            if response.status() == StatusCode::PRECONDITION_FAILED {
                continue;
            }
            if !response.status().is_success() {
                return Err(Failure::Configuration);
            }
            // An authenticated readback confirms the exact applied generation or
            // removal. It also detects concurrent operator edits after PATCH.
            let (actual, _) = self.routes().await?;
            let actual = actual
                .as_array()
                .ok_or(Failure::Configuration)?
                .iter()
                .find(|value| value["@id"] == id);
            if actual.cloned() == route.deployment.map(|_| self.document(route)) {
                return Ok(());
            }
        }
        Err(Failure::Conflict)
    }

    async fn probe(&self, route: &Route) -> Result<Observation, Failure> {
        let mut builder = client()
            .resolve(&route.hostname, self.config.public_address)
            .tls_info(true);
        if let Some(ca) = &self.probe_ca {
            builder = builder.add_root_certificate(ca.clone());
        }
        let response = builder
            .build()
            .map_err(|_| Failure::Configuration)?
            .get(format!(
                "https://{}:{}/.well-known/local-paas/route",
                route.hostname,
                self.config.public_address.port()
            ))
            .send()
            .await
            .map_err(|_| Failure::Tls)?;
        if response.status() != StatusCode::NO_CONTENT
            || response
                .headers()
                .get("x-local-paas-generation")
                .and_then(|h| h.to_str().ok())
                != Some(route.generation.to_string().as_str())
            || response
                .headers()
                .get("x-local-paas-route")
                .and_then(|h| h.to_str().ok())
                != Some(route.authority(route.generation).as_str())
        {
            return Err(Failure::Health);
        }
        let der = response
            .extensions()
            .get::<reqwest::tls::TlsInfo>()
            .and_then(|tls| tls.peer_certificate())
            .ok_or(Failure::Tls)?;
        let (_, cert) = x509_parser::parse_x509_certificate(der).map_err(|_| Failure::Tls)?;
        let expires = DateTime::<Utc>::from_timestamp(cert.validity().not_after.timestamp(), 0)
            .ok_or(Failure::Tls)?;
        if expires <= Utc::now() + chrono::Duration::seconds(super::LEASE_SECONDS) {
            return Err(Failure::Tls);
        }
        Ok(Observation {
            certificate_expires_at: Some(expires),
        })
    }
}

impl Edge for Caddy {
    async fn verify(&self, route: &Route) -> Result<(), Failure> {
        if route.deployment.is_some() {
            self.verify_dns(route).await?;
        }
        Ok(())
    }
    async fn reconcile(&self, route: &Route) -> Result<Observation, Failure> {
        if route.deployment.is_some() {
            let healthy = client()
                .build()
                .map_err(|_| Failure::Configuration)?
                .get(format!(
                    "http://127.0.0.1:{}/.well-known/local-paas/route",
                    self.config.ingress_port
                ))
                .header("host", route.authority(route.generation))
                .send()
                .await
                .map_err(|_| Failure::Health)?;
            if healthy.status() != StatusCode::NO_CONTENT {
                return Err(Failure::Health);
            }
        }
        self.apply(route).await?;
        if route.deployment.is_none() {
            return Ok(Observation {
                certificate_expires_at: None,
            });
        }
        self.probe(route).await
    }
}

fn ingress_port() -> u16 {
    8090
}

fn client() -> reqwest::ClientBuilder {
    Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(4))
}
