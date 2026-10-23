-- Include meaningful routing, cancellation, image and process changes without payloads.
CREATE OR REPLACE FUNCTION audit_record_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 current_row jsonb := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 old_row jsonb := CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
 sid uuid; eid uuid; pid uuid; target text; detail jsonb;
BEGIN
 -- Only approved metadata is copied; never specs, request bodies or secret values.
 SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO detail
 FROM jsonb_each(current_row)
 WHERE key IN ('name','kind','status','version','generation','desired_state','state','cordoned','parent_id','cancel_requested','authority','service_id','revision_id','node_id','image_digest','started_at')
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
