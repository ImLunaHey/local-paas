use crate::ApiError;
use axum::{Extension, Json, extract::State};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, Row, types::Json as DbJson};
use uuid::Uuid;
pub(crate) async fn list(
    State(pool): State<PgPool>,
    Extension(context): Extension<crate::auth::Context>,
) -> Result<Json<Value>, ApiError> {
    let items:Vec<DbJson<Value>>=sqlx::query_scalar("SELECT jsonb_build_object('id',e.id,'project',p.name,'name',e.name,'serviceCount',(SELECT count(*) FROM services s WHERE s.environment_id=e.id)) FROM environments e JOIN projects p ON p.id=e.project_id WHERE ($1::text IS NULL OR p.organization_id=$1) ORDER BY p.name,e.name").bind(context.organization_id.as_deref()).fetch_all(&pool).await?;
    Ok(Json(json!({"items":items})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Create {
    project: String,
    name: String,
    parent_id: Option<Uuid>,
}
pub(crate) async fn create(
    State(pool): State<PgPool>,
    Extension(context): Extension<crate::auth::Context>,
    Json(input): Json<Create>,
) -> Result<Json<Value>, ApiError> {
    fn valid(s: &str) -> bool {
        !s.is_empty()
            && s.len() <= 63
            && s.bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            && s.as_bytes()[0].is_ascii_alphanumeric()
    }
    if !valid(&input.project) || !valid(&input.name) {
        return Err(ApiError::Conflict(
            "project and environment must be lowercase names up to 63 characters",
        ));
    }
    let mut tx = pool.begin().await?;
    let organization = crate::auth::required_organization(&context)?;
    let project:Uuid=sqlx::query_scalar("INSERT INTO projects(id,organization_id,name) VALUES($1,$2,$3) ON CONFLICT(organization_id,name) DO UPDATE SET name=excluded.name RETURNING id").bind(Uuid::now_v7()).bind(organization).bind(&input.project).fetch_one(&mut *tx).await?;
    if let Some(parent) = input.parent_id {
        crate::pr_previews::ensure_environment_writable(&mut tx, parent).await?;
        let valid: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM environments WHERE id=$1 AND project_id=$2 AND name<>$3)",
        )
        .bind(parent)
        .bind(project)
        .bind(&input.name)
        .fetch_one(&mut *tx)
        .await?;
        if !valid {
            return Err(ApiError::Conflict(
                "shadow source must be another environment in this project",
            ));
        }
        let depth: i32 = sqlx::query_scalar("WITH RECURSIVE chain AS (SELECT id,parent_id,0 AS depth FROM environments WHERE id=$1 UNION ALL SELECT e.id,e.parent_id,c.depth+1 FROM environments e JOIN chain c ON e.id=c.parent_id WHERE c.depth<8) SELECT max(depth) FROM chain")
            .bind(parent).fetch_one(&mut *tx).await?;
        if depth >= 8 {
            return Err(ApiError::Conflict(
                "environment shadowing supports at most eight ancestors",
            ));
        }
    }
    let existing: Option<(Uuid, Option<Uuid>)> =
        sqlx::query_as("SELECT id,parent_id FROM environments WHERE project_id=$1 AND name=$2")
            .bind(project)
            .bind(&input.name)
            .fetch_optional(&mut *tx)
            .await?;
    if let Some((id, parent)) = existing {
        if parent != input.parent_id {
            return Err(ApiError::Conflict(
                "environment already exists with a different source",
            ));
        }
        return Ok(Json(
            json!({"id":id,"project":input.project,"name":input.name}),
        ));
    }
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO environments(id,project_id,name,parent_id) VALUES($1,$2,$3,$4)")
        .bind(id)
        .bind(project)
        .bind(&input.name)
        .bind(input.parent_id)
        .execute(&mut *tx)
        .await?;
    if let Some(parent) = input.parent_id {
        let rows = sqlx::query("SELECT id,name,kind,spec FROM services WHERE environment_id=$1")
            .bind(parent)
            .fetch_all(&mut *tx)
            .await?;
        let ids: std::collections::HashMap<Uuid, Uuid> =
            rows.iter().map(|r| (r.get("id"), Uuid::now_v7())).collect();
        for row in rows {
            let DbJson(mut spec): DbJson<Value> = row.get("spec");
            spec["environment"] = json!(input.name);
            spec["domains"] = json!([]);
            // Shadow configuration, never attach the source environment's live filesystem.
            spec.as_object_mut().unwrap().remove("volume");
            if let Some(connections) = spec["workload"]["privateConnections"].as_array_mut() {
                for c in connections {
                    let old = c["serviceId"].as_str().and_then(|s| s.parse::<Uuid>().ok());
                    let new = old.and_then(|id| ids.get(&id)).ok_or(ApiError::Conflict(
                        "private connection cannot be shadowed outside its environment",
                    ))?;
                    c["serviceId"] = json!(new);
                }
            }
            let service = ids[&row.get::<Uuid, _>("id")];
            let operation = Uuid::now_v7();
            sqlx::query("INSERT INTO services(id,environment_id,name,kind,operation_id,spec,registered_spec) VALUES($1,$2,$3,$4,$5,$6,$6)").bind(service).bind(id).bind(row.get::<String,_>("name")).bind(row.get::<String,_>("kind")).bind(operation).bind(DbJson(spec)).execute(&mut *tx).await?;
            sqlx::query("INSERT INTO events(id,service_id,operation_id,kind) VALUES($1,$2,$3,'service.shadowed')").bind(Uuid::now_v7()).bind(service).bind(operation).execute(&mut *tx).await?;
        }
    }
    tx.commit().await?;
    Ok(Json(
        json!({"id":id,"project":input.project,"name":input.name}),
    ))
}
