-- A preview template may contain several source services. Secret grants contain
-- names only; values remain in OpenBao and are resolved through the explicit,
-- audited grant when a deployment snapshot is created.
ALTER TABLE preview_policies
    ADD COLUMN services jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE pull_request_previews
    ADD COLUMN provider_check_id bigint,
    ADD COLUMN provider_reported_state text,
    ADD COLUMN provider_status text NOT NULL DEFAULT 'pending'
        CHECK (provider_status IN ('pending','published','unavailable','failed')),
    ADD COLUMN provider_error text;

CREATE TABLE pull_request_preview_services (
    preview_id uuid NOT NULL REFERENCES pull_request_previews(id) ON DELETE CASCADE,
    source_service_id uuid NOT NULL REFERENCES services(id),
    service_id uuid NOT NULL UNIQUE REFERENCES services(id),
    build_id uuid REFERENCES builds(id),
    deployment_id uuid REFERENCES deployments(id),
    primary_route boolean NOT NULL DEFAULT false,
    position integer NOT NULL CHECK (position BETWEEN 0 AND 4),
    PRIMARY KEY (preview_id, source_service_id),
    UNIQUE (preview_id, position)
);

INSERT INTO pull_request_preview_services(
    preview_id, source_service_id, service_id, build_id, deployment_id, primary_route, position
)
SELECT p.id, c.service_id, p.service_id, p.build_id, p.deployment_id, true, 0
FROM pull_request_previews p
JOIN source_connections c ON c.id=p.source_connection_id
WHERE p.service_id IS NOT NULL;

CREATE UNIQUE INDEX pull_request_preview_primary_service
    ON pull_request_preview_services(preview_id) WHERE primary_route;

CREATE TABLE preview_secret_grants (
    preview_id uuid NOT NULL REFERENCES pull_request_previews(id) ON DELETE CASCADE,
    source_service_id uuid NOT NULL REFERENCES services(id),
    target_service_id uuid NOT NULL UNIQUE REFERENCES services(id),
    names text[] NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (preview_id, source_service_id, target_service_id)
);

CREATE FUNCTION audit_preview_secret_grant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 current_row preview_secret_grants := CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 org text; eid uuid; pid uuid;
BEGIN
 SELECT c.organization_id,s.environment_id,e.project_id INTO org,eid,pid
 FROM pull_request_previews p
 JOIN source_connections c ON c.id=p.source_connection_id
 JOIN services s ON s.id=current_row.target_service_id
 JOIN environments e ON e.id=s.environment_id
 WHERE p.id=current_row.preview_id;
 INSERT INTO audit_log(actor,action,outcome,target_type,target_id,organization_id,service_id,environment_id,project_id,details)
 VALUES('platform','preview_secret_grants.'||lower(TG_OP),'committed','preview_secret_grants',current_row.preview_id::text,org,current_row.target_service_id,eid,pid,
        jsonb_build_object('sourceServiceId',current_row.source_service_id,'names',current_row.names));
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER platform_audit AFTER INSERT OR UPDATE OR DELETE ON preview_secret_grants
FOR EACH ROW EXECUTE FUNCTION audit_preview_secret_grant();
