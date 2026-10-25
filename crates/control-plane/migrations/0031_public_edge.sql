-- Desired and observed routes are separate: an API write is never an edge ACK.
ALTER TABLE domains ADD COLUMN edge_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE domains ADD COLUMN ownership_token uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE domains ADD COLUMN edge_generation bigint NOT NULL DEFAULT 0;
ALTER TABLE domains ADD COLUMN edge_deployment uuid REFERENCES deployments(id);
ALTER TABLE domains ADD COLUMN acknowledged_generation bigint;
ALTER TABLE domains ADD COLUMN acknowledged_deployment uuid REFERENCES deployments(id);
ALTER TABLE domains ADD COLUMN verified_at timestamptz;
ALTER TABLE domains ADD COLUMN edge_lease_expires_at timestamptz;
ALTER TABLE domains ADD COLUMN certificate_expires_at timestamptz;
ALTER TABLE domains ADD COLUMN edge_error text;
ALTER TABLE domains ADD COLUMN edge_retry_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX domains_edge_id ON domains(edge_id);

-- Only these opaque, short-lived authorities can select a candidate revision.
-- They are accepted by the private application gateway, never the admin API.
CREATE TABLE edge_targets (
 authority text PRIMARY KEY,
 hostname text NOT NULL REFERENCES domains(hostname),
 generation bigint NOT NULL,
 deployment_id uuid NOT NULL REFERENCES deployments(id),
 expires_at timestamptz NOT NULL,
 UNIQUE(hostname,generation)
);
CREATE TABLE edge_rollouts (
 deployment_id uuid PRIMARY KEY REFERENCES deployments(id),
 service_id uuid NOT NULL REFERENCES services(id),
 previous_deployment uuid REFERENCES deployments(id),
 phase text NOT NULL CHECK(phase IN ('promoting','draining','rolling_back','rollback_draining','complete','failed')),
 drain_after timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_edge_rollout ON edge_rollouts(service_id)
 WHERE phase NOT IN ('complete','failed');
CREATE FUNCTION audit_edge_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (OLD.edge_generation,OLD.acknowledged_generation,OLD.edge_error)
   IS NOT DISTINCT FROM (NEW.edge_generation,NEW.acknowledged_generation,NEW.edge_error) THEN RETURN NEW; END IF;
 INSERT INTO audit_log(actor,action,outcome,target_type,target_id,service_id,organization_id,details)
 VALUES('edge-controller','edge.route','committed','domain',NEW.hostname,NEW.service_id,NEW.organization_id,
 jsonb_build_object('generation',NEW.edge_generation,'deployment_id',NEW.edge_deployment,
 'acknowledged_generation',NEW.acknowledged_generation,'acknowledged_deployment',NEW.acknowledged_deployment,'error_code',NEW.edge_error));
 RETURN NEW;
END $$;
CREATE TRIGGER edge_audit AFTER UPDATE ON domains FOR EACH ROW EXECUTE FUNCTION audit_edge_change();
CREATE FUNCTION audit_edge_rollout() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.phase=NEW.phase THEN RETURN NEW; END IF;
 INSERT INTO audit_log(actor,action,outcome,target_type,target_id,service_id,project_id,environment_id,organization_id,details)
 SELECT 'edge-controller','edge.rollout','committed','deployment',NEW.deployment_id::text,NEW.service_id,p.id,e.id,p.organization_id,
 jsonb_build_object('phase',NEW.phase,'previous_deployment',NEW.previous_deployment)
 FROM services s JOIN environments e ON e.id=s.environment_id JOIN projects p ON p.id=e.project_id WHERE s.id=NEW.service_id;
 RETURN NEW;
END $$;
CREATE TRIGGER platform_audit AFTER INSERT OR UPDATE ON edge_rollouts FOR EACH ROW EXECUTE FUNCTION audit_edge_rollout();

-- Existing declarations remain pending until the real edge worker observes them.
UPDATE domains SET edge_generation=1,edge_deployment=d.id
 FROM deployments d WHERE domains.service_id=d.service_id AND d.status='active'
 AND d.spec->'workload'->>'kind'='oci-service'
 AND coalesce(d.spec->'workload'->>'execution','http')='http';
