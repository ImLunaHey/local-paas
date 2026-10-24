ALTER TABLE deployments ADD COLUMN parent_deployment_id uuid UNIQUE REFERENCES deployments(id);
ALTER TABLE deployments ADD CONSTRAINT release_job_has_options CHECK (parent_deployment_id IS NULL OR job_options IS NOT NULL);
ALTER TABLE deployments DROP CONSTRAINT deployments_status_check;
ALTER TABLE deployments ADD CONSTRAINT deployments_status_check CHECK(status IN
 ('releasing','waiting','preparing','active','failed','stopped','superseded','job','succeeded','cancelled','timed_out','uncertain'));
DROP INDEX one_pending_deployment;
CREATE UNIQUE INDEX one_pending_deployment ON deployments(service_id) WHERE status IN ('releasing','waiting','preparing');
