//! Explicit local bootstrap. Credentials are written privately, never printed.
use serde_json::{Value, json};
use std::{io::Write, os::unix::fs::OpenOptionsExt, path::PathBuf};
fn save(path: &std::path::Path, bytes: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}
async fn call(
    client: &reqwest::Client,
    path: &str,
    method: reqwest::Method,
    token: Option<&str>,
    body: Option<Value>,
) -> Result<Value, Box<dyn std::error::Error>> {
    let mut request = client.request(method, format!("https://127.0.0.1:18200/v1/{path}"));
    if let Some(token) = token {
        request = request.header("X-Vault-Token", token)
    }
    if let Some(body) = body {
        request = request
            .header("content-type", "application/json")
            .body(body.to_string())
    }
    let response = request
        .send()
        .await
        .map_err(|_| "OpenBao connection failed")?;
    if !response.status().is_success() {
        return Err("OpenBao bootstrap request failed; credentials were not printed".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "OpenBao response failed")?;
    if bytes.is_empty() {
        return Ok(Value::Null);
    }
    Ok(serde_json::from_slice(&bytes).map_err(|_| "invalid OpenBao response")?)
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("usage: initialize-openbao PRIVATE_SERVICE_DIRECTORY")?,
    );
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .tls_built_in_root_certs(false)
        .add_root_certificate(reqwest::Certificate::from_pem(&std::fs::read(
            root.join("tls/ca.pem"),
        )?)?)
        .timeout(std::time::Duration::from_secs(10))
        .build()?;
    let initialized =
        call(&client, "sys/init", reqwest::Method::GET, None, None).await?["initialized"] == true;
    let recovery = root.join("recovery/initialization.json");
    let credentials: Value = if initialized {
        serde_json::from_slice(&std::fs::read(&recovery).map_err(|_|"OpenBao already initialized; recovery file is required to unseal this local instance")?)?
    } else {
        if recovery.exists() {
            return Err("refusing to overwrite existing recovery credentials".into());
        }
        let result = call(
            &client,
            "sys/init",
            reqwest::Method::POST,
            None,
            Some(json!({"secret_shares":3,"secret_threshold":2})),
        )
        .await?;
        save(&recovery, &serde_json::to_vec(&result)?)?;
        result
    };
    let sealed =
        call(&client, "sys/seal-status", reqwest::Method::GET, None, None).await?["sealed"] == true;
    if sealed {
        for key in credentials["keys"]
            .as_array()
            .ok_or("invalid recovery material")?
            .iter()
            .take(2)
        {
            call(
                &client,
                "sys/unseal",
                reqwest::Method::POST,
                None,
                Some(json!({"key":key})),
            )
            .await?;
        }
    }
    let token = credentials["root_token"]
        .as_str()
        .ok_or("missing bootstrap identity")?;
    let mounts = call(
        &client,
        "sys/mounts",
        reqwest::Method::GET,
        Some(token),
        None,
    )
    .await?;
    if mounts["data"].get("platform/").is_none() {
        call(
            &client,
            "sys/mounts/platform",
            reqwest::Method::POST,
            Some(token),
            Some(json!({"type":"kv","options":{"version":"2"}})),
        )
        .await?;
    }
    // Retain prior versions for deployment rollback; expiry/deletion is explicit.
    call(
        &client,
        "platform/config",
        reqwest::Method::POST,
        Some(token),
        Some(json!({"max_versions":1000,"cas_required":true})),
    )
    .await?;
    let policy = r#"
path "platform/data/workloads/*" { capabilities = ["create","update","read"] }
path "sys/policies/acl/platform-workload-*" { capabilities = ["create","update"] }
path "auth/token/create/platform-workload" { capabilities = ["update"] }
path "auth/token/renew-self" { capabilities = ["update"] }
"#;
    call(
        &client,
        "sys/policies/acl/platform-controller",
        reqwest::Method::PUT,
        Some(token),
        Some(json!({"policy":policy})),
    )
    .await?;
    call(&client,"auth/token/roles/platform-workload",reqwest::Method::POST,Some(token),Some(json!({"allowed_policies_glob":["platform-workload-*"],"disallowed_policies":["root","default","platform-controller"],"orphan":true,"renewable":false,"token_explicit_max_ttl":60}))).await?;
    if !root.join("controller.token").exists() {
        let issued=call(&client,"auth/token/create",reqwest::Method::POST,Some(token),Some(json!({"policies":["platform-controller"],"no_default_policy":true,"period":"24h","display_name":"local-paas-controller"}))).await?;
        save(
            &root.join("controller.token"),
            issued["auth"]["client_token"]
                .as_str()
                .ok_or("controller identity was not issued")?
                .as_bytes(),
        )?;
    }
    println!(
        "Dedicated OpenBao initialized and unsealed. Controller identity and recovery material were saved privately; no credentials were printed."
    );
    Ok(())
}
