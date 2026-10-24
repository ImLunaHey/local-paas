ALTER TABLE deployments DROP CONSTRAINT deployments_status_check;
ALTER TABLE deployments ADD CONSTRAINT deployments_status_check
 CHECK(status IN ('waiting','preparing','active','failed','stopped','superseded'));
DROP INDEX one_preparing_deployment;
CREATE UNIQUE INDEX one_pending_deployment ON deployments(service_id)
 WHERE status IN ('waiting','preparing');
