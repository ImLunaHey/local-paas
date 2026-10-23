CREATE TABLE domains (
 hostname text PRIMARY KEY CHECK(length(hostname) BETWEEN 3 AND 253),
 service_id uuid REFERENCES services(id),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER platform_audit AFTER INSERT OR UPDATE OR DELETE ON domains FOR EACH ROW EXECUTE FUNCTION audit_record_change();
-- Keep domain identity and both sides of reassignment in committed audit records.
DROP TRIGGER platform_audit ON domains;
CREATE FUNCTION audit_domain_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eid uuid; pid uuid;
BEGIN
 IF NEW.service_id IS NOT NULL THEN
  SELECT s.environment_id,e.project_id INTO eid,pid FROM services s JOIN environments e ON e.id=s.environment_id WHERE s.id=NEW.service_id;
 END IF;
 INSERT INTO audit_log(actor,action,outcome,target_type,target_id,service_id,environment_id,project_id,details)
 VALUES('platform','domains.'||lower(TG_OP),'committed','domains',NEW.hostname,NEW.service_id,eid,pid,
 jsonb_build_object('hostname',NEW.hostname,'service_id',NEW.service_id,'previous_service_id',CASE WHEN TG_OP='UPDATE' THEN OLD.service_id ELSE NULL END,'version',NEW.version,'routing_status','pending-edge'));
 RETURN NEW;
END $$;
CREATE TRIGGER platform_audit AFTER INSERT OR UPDATE ON domains FOR EACH ROW EXECUTE FUNCTION audit_domain_change();
