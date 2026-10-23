use crate::{Config, containerd::Containerd};
use platform_protocol::Assignment;
use std::{collections::BTreeMap, os::unix::fs::PermissionsExt, path::PathBuf};
use uuid::Uuid;
pub type Values = BTreeMap<String, String>;
pub fn directory(id: Uuid) -> PathBuf {
    PathBuf::from("/run/local-paas-secrets").join(id.to_string())
}
pub async fn obtain(
    client: &reqwest::Client,
    config: &Config,
    a: &Assignment,
) -> Result<Values, ()> {
    if a.spec.secrets.is_empty() {
        return Ok(Values::new());
    }
    let response=client.post(format!("{}/api/agent/secrets",config.controller_url)).bearer_auth(&config.token).json(&serde_json::json!({"node_id":config.node_id,"instance_id":a.instance_id,"generation":a.generation})).send().await.map_err(|_|())?;
    if !response.status().is_success() {
        return Err(());
    }
    let value: serde_json::Value = response.json().await.map_err(|_| ())?;
    let values: Values = serde_json::from_value(value["values"].clone()).map_err(|_| ())?;
    if values.len() != a.spec.secrets.len()
        || a.spec.secrets.iter().any(|n| !values.contains_key(n))
    {
        return Err(());
    }
    Ok(values)
}
pub async fn install(runtime: &Containerd, id: Uuid, values: &Values) -> Result<(), ()> {
    let dir = directory(id);
    tokio::fs::create_dir_all(&dir).await.map_err(|_| ())?;
    // The VM remaps container UID 1000 to 101000. Other workloads have no mount here.
    let mut blob = Vec::new();
    for (name, value) in values {
        if name.is_empty()
            || !name
                .bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
            || value.contains('\0')
        {
            return Err(());
        }
        let path = dir.join(name);
        tokio::fs::write(&path, value).await.map_err(|_| ())?;
        std::os::unix::fs::chown(&path, Some(101000), Some(101000)).map_err(|_| ())?;
        tokio::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o400))
            .await
            .map_err(|_| ())?;
        blob.extend(name.bytes());
        blob.push(b'=');
        blob.extend(value.bytes());
        blob.push(0);
    }
    let env = dir.join(".environment");
    tokio::fs::write(&env, &blob).await.map_err(|_| ())?;
    blob.fill(0);
    std::os::unix::fs::chown(&env, Some(101000), Some(101000)).map_err(|_| ())?;
    tokio::fs::set_permissions(&env, std::fs::Permissions::from_mode(0o400))
        .await
        .map_err(|_| ())?;
    std::os::unix::fs::chown(&dir, Some(101000), Some(101000)).map_err(|_| ())?;
    tokio::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500))
        .await
        .map_err(|_| ())?;
    tokio::fs::write(runtime.root.join(format!("{id}.has-secrets")), b"")
        .await
        .map_err(|_| ())?;
    Ok(())
}
pub async fn clear(id: Uuid) {
    let dir = directory(id);
    if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Ok(metadata) = entry.metadata().await
                && metadata.is_file()
                && metadata.len() <= 65536
            {
                let _ = tokio::fs::write(entry.path(), vec![0; metadata.len() as usize]).await;
            }
        }
    }
    let _ = tokio::fs::remove_dir_all(dir).await;
}
pub fn redact(line: &str, values: &Values) -> String {
    fn text(input: &str, values: &Values) -> String {
        let mut result = input.to_owned();
        let mut replacements: Vec<&String> = values.values().filter(|v| !v.is_empty()).collect();
        replacements.sort_by_key(|v| std::cmp::Reverse(v.len()));
        for value in replacements {
            result = result.replace(value, "[REDACTED]")
        }
        result
    }
    fn walk(value: &mut serde_json::Value, values: &Values) {
        match value {
            serde_json::Value::String(s) => *s = text(s, values),
            serde_json::Value::Object(map) => {
                for v in map.values_mut() {
                    walk(v, values)
                }
            }
            serde_json::Value::Array(array) => {
                for v in array {
                    walk(v, values)
                }
            }
            _ => {}
        }
    }
    if values.is_empty() {
        return line.into();
    }
    if let Ok(mut value) = serde_json::from_str::<serde_json::Value>(line) {
        walk(&mut value, values);
        text(&value.to_string(), values)
    } else {
        text(line, values)
    }
}
pub async fn load(id: Uuid) -> Result<Values, ()> {
    let mut bytes = tokio::fs::read(directory(id).join(".environment"))
        .await
        .map_err(|_| ())?;
    let mut values = Values::new();
    for entry in bytes.split(|b| *b == 0).filter(|b| !b.is_empty()) {
        let (name, value) = std::str::from_utf8(entry)
            .map_err(|_| ())?
            .split_once('=')
            .ok_or(())?;
        values.insert(name.into(), value.into());
    }
    bytes.fill(0);
    Ok(values)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn redacts_plain_and_escaped_structured_values() {
        let values = BTreeMap::from([("TOKEN".into(), "secret\"value".into())]);
        assert_eq!(redact("token=secret\"value", &values), "token=[REDACTED]");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&redact(
                r#"{"message":"token=secret\"value"}"#,
                &values
            ))
            .unwrap()["message"],
            "token=[REDACTED]"
        );
    }
}
