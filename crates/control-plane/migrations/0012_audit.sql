CREATE TABLE audit_log (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 timestamp timestamptz NOT NULL DEFAULT now(),
 request_id uuid,
 actor text NOT NULL,
 action text NOT NULL,
 outcome text NOT NULL,
 target_type text,
 target_id text,
 service_id uuid,
 project_id uuid,
 environment_id uuid,
 details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_log_project ON audit_log(project_id,sequence DESC);
CREATE INDEX audit_log_service ON audit_log(service_id,sequence DESC);
CREATE INDEX audit_log_time ON audit_log(timestamp DESC);
CREATE FUNCTION audit_record_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 current_row jsonb := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 old_row jsonb := CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
 sid uuid; eid uuid; pid uuid; target text; detail jsonb;
BEGIN
 -- Only approved metadata is copied; never specs, request bodies or secret values.
 SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO detail
 FROM jsonb_each(current_row)
 WHERE key IN ('name','kind','status','version','generation','desired_state','state','cordoned','parent_id')
 AND (TG_OP<>'UPDATE' OR old_row->key IS DISTINCT FROM value);
 IF TG_OP='UPDATE' AND detail='{}'::jsonb THEN RETURN NEW; END IF;
 target:=coalesce(current_row->>'id',current_row->>'authority',current_row->>'service_id',current_row->>'instance_id');
 IF TG_TABLE_NAME='services' THEN sid:=(current_row->>'id')::uuid;
 ELSIF current_row ? 'service_id' THEN sid:=(current_row->>'service_id')::uuid;
 ELSIF current_row ? 'deployment_id' THEN SELECT service_id INTO sid FROM deployments WHERE id=(current_row->>'deployment_id')::uuid;
 ELSIF current_row ? 'instance_id' THEN SELECT d.service_id INTO sid FROM instances i JOIN deployments d ON d.id=i.deployment_id WHERE i.id=(current_row->>'instance_id')::uuid;
 END IF;
 IF sid IS NOT NULL THEN SELECT s.environment_id,e.project_id INTO eid,pid FROM services s JOIN environments e ON e.id=s.environment_id WHERE s.id=sid;
 ELSIF TG_TABLE_NAME='environments' THEN eid:=(current_row->>'id')::uuid;pid:=(current_row->>'project_id')::uuid;
 ELSIF TG_TABLE_NAME='projects' THEN pid:=(current_row->>'id')::uuid;
 END IF;
 INSERT INTO audit_log(actor,action,outcome,target_type,target_id,service_id,environment_id,project_id,details)
 VALUES('platform',TG_TABLE_NAME||'.'||lower(TG_OP),'committed',TG_TABLE_NAME,target,sid,eid,pid,detail);
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['projects','environments','services','builds','revisions','deployments','instances','nodes','secret_sets','preview_routes','instance_starts'] LOOP
 EXECUTE format('CREATE TRIGGER platform_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_record_change()',tab);
 END LOOP;
END $$;
-- Preserve prior recorded actions, marking their actor as unknown rather than inventing one.
INSERT INTO audit_log(timestamp,actor,action,outcome,target_type,target_id,service_id,environment_id,project_id,details)
 SELECT v.created_at,'historical / unknown',v.kind,'recorded','service',v.service_id::text,v.service_id,s.environment_id,e.project_id,jsonb_build_object('event_id',v.id)
 FROM events v JOIN services s ON s.id=v.service_id JOIN environments e ON e.id=s.environment_id ORDER BY v.created_at,v.id;
CREATE FUNCTION audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit log is append only'; END $$;
CREATE TRIGGER audit_no_change BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_append_only();
