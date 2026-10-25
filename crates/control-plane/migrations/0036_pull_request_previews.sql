-- Preview configuration is a sanitized snapshot; credentials stay in the source connection.
CREATE TABLE preview_policies (
    source_connection_id uuid PRIMARY KEY REFERENCES source_connections(id),
    enabled boolean NOT NULL,
    max_active integer NOT NULL CHECK (max_active BETWEEN 1 AND 10),
    max_builds integer NOT NULL CHECK (max_builds BETWEEN 1 AND 3),
    ttl_hours integer NOT NULL CHECK (ttl_hours BETWEEN 1 AND 168),
    spec jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pull_request_previews (
    id uuid PRIMARY KEY,
    source_connection_id uuid NOT NULL REFERENCES source_connections(id),
    number bigint NOT NULL CHECK (number > 0),
    event_at timestamptz NOT NULL,
    desired_open boolean NOT NULL,
    -- Manual deletion and expiry require an explicit newer reopen event.
    admitted boolean NOT NULL DEFAULT false,
    suppressed boolean NOT NULL DEFAULT false,
    head_commit text NOT NULL CHECK (head_commit ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'),
    environment_id uuid UNIQUE REFERENCES environments(id),
    service_id uuid UNIQUE REFERENCES services(id),
    build_id uuid REFERENCES builds(id),
    deployment_id uuid REFERENCES deployments(id),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','blocked','building','deploying','ready','degraded','failed','cleaning','closed')),
    reason text NOT NULL DEFAULT 'Preview requested',
    expires_at timestamptz NOT NULL,
    last_checked_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(source_connection_id, number)
);
CREATE INDEX pull_request_previews_pending ON pull_request_previews(updated_at) WHERE status <> 'closed';

-- Audit preview intent and policy changes, including before any service exists.
CREATE FUNCTION audit_preview_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 current_row jsonb := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 old_row jsonb := CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
 sid uuid; eid uuid; pid uuid; org text; detail jsonb;
BEGIN
 SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO detail FROM jsonb_each(current_row)
 WHERE key IN ('enabled','max_active','max_builds','ttl_hours','number','event_at','desired_open','suppressed','admitted','head_commit','status','reason','build_id','deployment_id','expires_at','service_id','environment_id')
 AND (TG_OP<>'UPDATE' OR old_row->key IS DISTINCT FROM value);
 IF TG_OP='UPDATE' AND detail='{}'::jsonb AND (old_row->'spec') IS NOT DISTINCT FROM (current_row->'spec') THEN RETURN NEW; END IF;
 SELECT c.service_id,c.organization_id,e.id,e.project_id INTO sid,org,eid,pid
 FROM source_connections c JOIN services s ON s.id=c.service_id JOIN environments e ON e.id=s.environment_id
 WHERE c.id=(current_row->>'source_connection_id')::uuid;
 INSERT INTO audit_log(actor,action,outcome,target_type,target_id,organization_id,service_id,environment_id,project_id,details)
 VALUES('platform',TG_TABLE_NAME||'.'||lower(TG_OP),'committed',TG_TABLE_NAME,coalesce(current_row->>'id',current_row->>'source_connection_id'),org,sid,eid,pid,detail);
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER platform_audit AFTER INSERT OR UPDATE OR DELETE ON preview_policies FOR EACH ROW EXECUTE FUNCTION audit_preview_change();
CREATE TRIGGER platform_audit AFTER INSERT OR UPDATE OR DELETE ON pull_request_previews FOR EACH ROW EXECUTE FUNCTION audit_preview_change();
