ALTER TABLE deployments
 ADD COLUMN runtime_health text NOT NULL DEFAULT 'healthy'
 CHECK (runtime_health IN ('healthy', 'recovering', 'degraded')),
 ADD COLUMN runtime_health_reason text;

ALTER TABLE relocations DROP CONSTRAINT relocations_reason_check;
ALTER TABLE relocations
 ADD CONSTRAINT relocations_reason_check CHECK (reason IN ('drain', 'node_lost', 'health')),
 ADD COLUMN retry_after timestamptz;

CREATE TABLE instance_health_events (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 instance_id uuid NOT NULL REFERENCES instances(id),
 observed_at timestamptz NOT NULL,
 process text NOT NULL CHECK (process IN ('running', 'exited', 'unknown')),
 startup text NOT NULL CHECK (startup IN ('not_configured', 'pending', 'passing', 'failing', 'unknown')),
 readiness text NOT NULL CHECK (readiness IN ('not_configured', 'pending', 'passing', 'failing', 'unknown')),
 liveness text NOT NULL CHECK (liveness IN ('not_configured', 'pending', 'passing', 'failing', 'unknown')),
 recovery text NOT NULL CHECK (recovery IN ('stable', 'backoff', 'restarting', 'exhausted', 'disabled')),
 restart_attempts integer NOT NULL CHECK (restart_attempts BETWEEN 0 AND 20),
 retry_at timestamptz,
 diagnostic text,
 UNIQUE (instance_id, observed_at)
);
CREATE INDEX instance_health_events_recent
 ON instance_health_events(instance_id, observed_at DESC);
