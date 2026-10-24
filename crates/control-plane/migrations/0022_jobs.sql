ALTER TABLE deployments ADD COLUMN job_options jsonb;
ALTER TABLE deployments ADD COLUMN job_result jsonb;
ALTER TABLE deployments ADD COLUMN completed_at timestamptz;
ALTER TABLE deployments DROP CONSTRAINT deployments_status_check;
ALTER TABLE deployments ADD CONSTRAINT deployments_status_check CHECK(status IN
 ('waiting','preparing','active','failed','stopped','superseded','job','succeeded','cancelled','timed_out','uncertain'));
CREATE UNIQUE INDEX one_pending_job ON deployments(service_id) WHERE status='job';
CREATE TABLE job_schedules (
 id uuid PRIMARY KEY REFERENCES services(id),
 service_id uuid NOT NULL UNIQUE REFERENCES services(id),
 operation_id uuid NOT NULL UNIQUE,
 version bigint NOT NULL DEFAULT 1,
 revision_id uuid NOT NULL REFERENCES revisions(id),
 options jsonb NOT NULL,
 interval_minutes integer NOT NULL CHECK(interval_minutes BETWEEN 1 AND 10080),
 status text NOT NULL CHECK(status IN ('enabled','paused')),
 next_run_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE job_occurrences (
 id uuid PRIMARY KEY,
 service_id uuid NOT NULL REFERENCES services(id),
 schedule_id uuid NOT NULL REFERENCES job_schedules(id),
 scheduled_at timestamptz NOT NULL,
 status text NOT NULL,
 deployment_id uuid REFERENCES deployments(id),
 skipped_count bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(schedule_id,scheduled_at)
);
CREATE TRIGGER platform_audit AFTER INSERT OR UPDATE ON job_schedules FOR EACH ROW EXECUTE FUNCTION audit_record_change();
CREATE TRIGGER platform_audit AFTER INSERT ON job_occurrences FOR EACH ROW EXECUTE FUNCTION audit_record_change();
