use crate::{ApiError, s3, secrets};
use axum::{
    Json,
    extract::{Path, State},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, types::Json as DbJson};
use std::collections::BTreeMap;
use uuid::Uuid;

pub async fn list(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    crate::runtime::service_exists(&pool, id).await?;
    let buckets:Vec<DbJson<Value>>=sqlx::query_scalar("SELECT jsonb_build_object('id',b.id,'name',b.name,'status',b.status,'storage_id',s.id,'storage',s.name) FROM storage_buckets b JOIN services s ON s.id=b.service_id WHERE s.environment_id=(SELECT environment_id FROM services WHERE id=$1) ORDER BY s.name,b.name").bind(id).fetch_all(&pool).await?;
    let binding:Option<DbJson<Value>>=sqlx::query_scalar("SELECT jsonb_build_object('bucket_id',b.bucket_id,'status',b.status,'read_only',b.read_only) FROM storage_bindings b WHERE b.service_id=$1").bind(id).fetch_optional(&pool).await?;
    Ok(Json(json!({"buckets":buckets,"binding":binding})))
}
async fn endpoint(pool: &PgPool, id: Uuid) -> Result<i32, ApiError> {
    sqlx::query_scalar("SELECT n.endpoint_base+v.slot FROM volumes v JOIN nodes n ON n.id=v.node_id JOIN services s ON s.id=v.id WHERE v.id=$1 AND s.kind='rustfs-service' AND EXISTS(SELECT 1 FROM deployments d JOIN instances i ON i.deployment_id=d.id WHERE d.service_id=s.id AND d.status='active' AND i.state='ready' AND i.observed_at>now()-interval '30 seconds')").bind(id).fetch_optional(pool).await?.ok_or(ApiError::Conflict("deploy RustFS and wait for readiness before creating or attaching buckets"))
}
async fn admin(pool: &PgPool, id: Uuid) -> Result<s3::Client, ApiError> {
    let port = endpoint(pool, id).await?;
    let secret = secrets::database_password(pool, id).await?;
    s3::Client::new(port, id.simple().to_string(), secret)
}
fn bucket_name(s: &str) -> bool {
    (3..=63).contains(&s.len())
        && !s.starts_with('-')
        && !s.ends_with('-')
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && s.parse::<std::net::IpAddr>().is_err()
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Create {
    operation_id: Uuid,
    name: String,
}
pub async fn create(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(input): Json<Create>,
) -> Result<Json<Value>, ApiError> {
    if !bucket_name(&input.name) {
        return Err(ApiError::Conflict(
            "bucket names need 3–63 lowercase letters, digits or interior hyphens",
        ));
    }
    let client = admin(&pool, id).await?;
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(input.operation_id.to_string())
        .execute(&mut *tx)
        .await?;
    let bucket = if let Some((bucket, storage, name)) = sqlx::query_as::<_, (Uuid, Uuid, String)>(
        "SELECT id,service_id,name FROM storage_buckets WHERE operation_id=$1",
    )
    .bind(input.operation_id)
    .fetch_optional(&mut *tx)
    .await?
    {
        if storage != id || name != input.name {
            return Err(ApiError::Conflict("operation ID belongs to another bucket"));
        }
        bucket
    } else {
        let bucket = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO storage_buckets(id,operation_id,service_id,name) VALUES($1,$2,$3,$4)",
        )
        .bind(bucket)
        .bind(input.operation_id)
        .bind(id)
        .bind(&input.name)
        .execute(&mut *tx)
        .await?;
        bucket
    };
    tx.commit().await?;
    // The bucket is private by default. Deterministic names make retries safe after a lost response.
    let result = client
        .request(reqwest::Method::HEAD, &format!("/{}", input.name), vec![])
        .await?;
    if !result.status().is_success() {
        client.put(&format!("/{}", input.name), vec![]).await?;
    }
    sqlx::query("UPDATE storage_buckets SET status='ready' WHERE id=$1")
        .bind(bucket)
        .execute(&pool)
        .await?;
    Ok(Json(json!({"id":bucket,"status":"ready"})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Connect {
    bucket_id: Uuid,
    read_only: bool,
    expected_secret_version: i32,
}
fn policy(bucket: &str, read_only: bool) -> Value {
    let actions = if read_only {
        vec!["s3:GetObject"]
    } else {
        vec![
            "s3:GetObject",
            "s3:PutObject",
            "s3:DeleteObject",
            "s3:AbortMultipartUpload",
            "s3:ListMultipartUploadParts",
        ]
    };
    json!({"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:ListBucket","s3:GetBucketLocation","s3:ListBucketMultipartUploads"],"Resource":[format!("arn:aws:s3:::{bucket}")]},{"Effect":"Allow","Action":actions,"Resource":[format!("arn:aws:s3:::{bucket}/*")]}]})
}
pub async fn connect(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(input): Json<Connect>,
) -> Result<Json<Value>, ApiError> {
    let mut tx = pool.begin().await?;
    // Same lock as deployment placement: no deployment observes partially provisioned attachments.
    sqlx::query("SELECT pg_advisory_xact_lock(712184551)")
        .execute(&mut *tx)
        .await?;
    let row:Option<(Uuid,String)>=sqlx::query_as("SELECT b.service_id,b.name FROM storage_buckets b JOIN services s ON s.id=b.service_id JOIN services a ON a.environment_id=s.environment_id WHERE b.id=$2 AND a.id=$1 AND a.kind='oci-service' AND b.status='ready'").bind(id).bind(input.bucket_id).fetch_optional(&mut *tx).await?;
    let (storage, bucket) = row.ok_or(ApiError::Conflict(
        "choose a ready bucket in this project environment",
    ))?;
    if let Some((old, read_only)) = sqlx::query_as::<_, (Uuid, bool)>(
        "SELECT bucket_id,read_only FROM storage_bindings WHERE service_id=$1",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
        && (old != input.bucket_id || read_only != input.read_only)
    {
        return Err(ApiError::Conflict(
            "detach the existing bucket before changing its identity or permissions",
        ));
    }
    let port = endpoint(&pool, storage).await?;
    let client = admin(&pool, storage).await?;
    let (version, values) = secrets::own_values(&pool, id).await?;
    if version != input.expected_secret_version {
        return Err(ApiError::Conflict(
            "secrets changed; refresh before attaching storage",
        ));
    }
    let access = format!("app{}", id.simple());
    let secret = if values.get("AWS_ACCESS_KEY_ID") == Some(&access) {
        values
            .get("AWS_SECRET_ACCESS_KEY")
            .cloned()
            .ok_or(ApiError::Conflict(
                "restore the missing storage credential before retrying",
            ))?
    } else {
        format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
    };
    let changes = BTreeMap::from([
        ("AWS_ACCESS_KEY_ID".into(), Some(access.clone())),
        ("AWS_SECRET_ACCESS_KEY".into(), Some(secret.clone())),
        ("AWS_REGION".into(), Some("us-east-1".into())),
        (
            "S3_ENDPOINT".into(),
            Some(format!("http://10.0.2.2:{port}")),
        ),
        ("S3_BUCKET".into(), Some(bucket.clone())),
    ]);
    // Persist credentials first so a failed/retried IAM operation reuses the same identity.
    let _ = secrets::update_bundle(&pool, id, version, changes).await?;
    client
        .put(
            &format!("/rustfs/admin/v3/add-user?accessKey={access}"),
            json!({"secretKey":secret,"status":"enabled"})
                .to_string()
                .into_bytes(),
        )
        .await?;
    client
        .put(
            &format!("/rustfs/admin/v3/add-canned-policy?name={access}"),
            policy(&bucket, input.read_only).to_string().into_bytes(),
        )
        .await?;
    client.put(&format!("/rustfs/admin/v3/set-user-or-group-policy?policyName={access}&userOrGroup={access}&isGroup=false"),vec![]).await?;
    let app = s3::Client::new(port, access, secret)?;
    if !app
        .request(reqwest::Method::HEAD, &format!("/{bucket}"), vec![])
        .await?
        .status()
        .is_success()
        || app
            .request(reqwest::Method::GET, "/rustfs/admin/v3/list-users", vec![])
            .await?
            .status()
            != reqwest::StatusCode::FORBIDDEN
    {
        return Err(ApiError::Unavailable(
            "RustFS credential policy verification failed; attachment remains inactive",
        ));
    }
    sqlx::query("INSERT INTO storage_bindings(service_id,bucket_id,read_only,status) VALUES($1,$2,$3,'ready') ON CONFLICT(service_id) DO UPDATE SET status='ready'").bind(id).bind(input.bucket_id).bind(input.read_only).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"saved":true,"redeploy_required":true})))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scoped_policy_has_no_admin_or_cross_bucket_access() {
        let p = policy("uploads", false).to_string();
        assert!(!p.contains("admin:"));
        assert!(!p.contains("s3:*"));
        assert!(!policy("uploads", true).to_string().contains("s3:PutObject"));
        assert!(bucket_name("my-uploads"));
        assert!(!bucket_name("../files"));
        assert!(!bucket_name("127.0.0.1"));
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Detach {
    expected_secret_version: i32,
}
pub async fn detach(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(input): Json<Detach>,
) -> Result<Json<Value>, ApiError> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(712184551)")
        .execute(&mut *tx)
        .await?;
    let storage:Uuid=sqlx::query_scalar("SELECT b.service_id FROM storage_bindings c JOIN storage_buckets b ON b.id=c.bucket_id WHERE c.service_id=$1").bind(id).fetch_optional(&mut *tx).await?.ok_or(ApiError::NotFound)?;
    let (version, values) = secrets::own_values(&pool, id).await?;
    if version != input.expected_secret_version {
        return Err(ApiError::Conflict(
            "secrets changed; refresh before detaching storage",
        ));
    }
    let access = format!("app{}", id.simple());
    let response = admin(&pool, storage)
        .await?
        .request(
            reqwest::Method::DELETE,
            &format!("/rustfs/admin/v3/remove-user?accessKey={access}"),
            vec![],
        )
        .await?;
    if !response.status().is_success() {
        return Err(ApiError::Unavailable(
            "RustFS could not revoke the storage credential; attachment retained",
        ));
    }
    if values.get("AWS_ACCESS_KEY_ID") == Some(&access) {
        let _ = secrets::update_bundle(
            &pool,
            id,
            version,
            [
                "AWS_ACCESS_KEY_ID",
                "AWS_SECRET_ACCESS_KEY",
                "AWS_REGION",
                "S3_ENDPOINT",
                "S3_BUCKET",
            ]
            .into_iter()
            .map(|k| (k.into(), None))
            .collect(),
        )
        .await?;
    }
    sqlx::query("DELETE FROM storage_bindings WHERE service_id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({"detached":true,"redeploy_required":true})))
}

#[cfg(test)]
mod live_tests {
    use super::*;
    #[tokio::test]
    #[ignore = "requires explicit PLATFORM_STORAGE_SMOKE_APP and disposable development services"]
    async fn rustfs_credentials_enforce_bucket_isolation_and_persist_restarts() {
        let Ok(id) = std::env::var("PLATFORM_STORAGE_SMOKE_APP") else {
            return;
        };
        let id: Uuid = id.parse().unwrap();
        let pool = PgPool::connect(&std::env::var("DATABASE_URL").unwrap())
            .await
            .unwrap();
        let project:String=sqlx::query_scalar("SELECT p.name FROM services s JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id WHERE s.id=$1").bind(id).fetch_one(&pool).await.unwrap();
        assert_eq!(
            project, "platform-storage-canary",
            "only disposable storage canaries may be restarted by this test"
        );
        let (storage,bucket):(Uuid,String)=sqlx::query_as("SELECT b.service_id,b.name FROM storage_bindings c JOIN storage_buckets b ON b.id=c.bucket_id WHERE c.service_id=$1").bind(id).fetch_one(&pool).await.unwrap();
        let (version, values) = secrets::own_values(&pool, id)
            .await
            .map_err(|_| "OpenBao read failed")
            .unwrap();
        assert!(version > 0);
        let port = endpoint(&pool, storage)
            .await
            .map_err(|_| "endpoint unavailable")
            .unwrap();
        let app = s3::Client::new(
            port,
            values["AWS_ACCESS_KEY_ID"].clone(),
            values["AWS_SECRET_ACCESS_KEY"].clone(),
        )
        .map_err(|_| "client invalid")
        .unwrap();
        let other = format!("scope-test-{}", Uuid::new_v4().simple());
        let _ = create(
            State(pool.clone()),
            Path(storage),
            Json(Create {
                operation_id: Uuid::new_v4(),
                name: other.clone(),
            }),
        )
        .await
        .map_err(|_| "bucket create failed")
        .unwrap();
        assert_eq!(
            app.request(reqwest::Method::HEAD, &format!("/{other}"), vec![])
                .await
                .map_err(|_| "request failed")
                .unwrap()
                .status(),
            reqwest::StatusCode::FORBIDDEN
        );
        assert_eq!(
            app.request(reqwest::Method::GET, "/rustfs/admin/v3/list-users", vec![])
                .await
                .map_err(|_| "request failed")
                .unwrap()
                .status(),
            reqwest::StatusCode::FORBIDDEN
        );
        let key = format!("/{bucket}/restart-{}.txt", Uuid::new_v4().simple());
        app.put(&key, b"retained object".to_vec())
            .await
            .map_err(|_| "write failed")
            .unwrap();
        let (deployment, revision): (Uuid, Uuid) = sqlx::query_as(
            "SELECT id,revision_id FROM deployments WHERE service_id=$1 AND status='active'",
        )
        .bind(storage)
        .fetch_one(&pool)
        .await
        .unwrap();
        let _ = crate::runtime::stop(State(pool.clone()), Path(deployment))
            .await
            .map_err(|_| "stop failed")
            .unwrap();
        let mut stopped = false;
        for _ in 0..60 {
            stopped=sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM instances WHERE deployment_id=$1 AND state<>'stopped')").bind(deployment).fetch_one(&pool).await.unwrap();
            if stopped {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
        assert!(stopped, "shutdown must be confirmed");
        let _ = crate::runtime::deploy(
            State(pool.clone()),
            Path(storage),
            Json(crate::runtime::DeployRequest {
                operation_id: Uuid::new_v4(),
                revision_id: revision,
            }),
        )
        .await
        .map_err(|_| "redeploy failed")
        .unwrap();
        let mut ready = false;
        for _ in 0..90 {
            ready = endpoint(&pool, storage).await.is_ok();
            if ready {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
        assert!(ready, "RustFS should become ready after restart");
        let response = app
            .request(reqwest::Method::GET, &key, vec![])
            .await
            .map_err(|_| "read failed")
            .unwrap();
        assert!(response.status().is_success());
        assert_eq!(response.bytes().await.unwrap().as_ref(), b"retained object");
    }
}
