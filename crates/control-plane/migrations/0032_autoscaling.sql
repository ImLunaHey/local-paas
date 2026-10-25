CREATE TABLE scaling_policies (
 service_id uuid PRIMARY KEY REFERENCES services(id),
 policy jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1,
 desired_replicas integer NOT NULL CHECK(desired_replicas BETWEEN 0 AND 32),
 last_scaled_at timestamptz,
 evaluated_at timestamptz,
 direction integer NOT NULL DEFAULT 0,
 stable_since timestamptz NOT NULL DEFAULT now(),
 condition text NOT NULL DEFAULT 'awaiting_evaluation',
 last_request_at timestamptz NOT NULL DEFAULT now(),
 ingress_seen_at timestamptz,
 failure_latched boolean NOT NULL DEFAULT false,
 wake_requested boolean NOT NULL DEFAULT false
);
CREATE TABLE scaling_operations (
 operation_id uuid PRIMARY KEY,
 service_id uuid NOT NULL REFERENCES services(id),
 version integer NOT NULL,
 policy jsonb NOT NULL
);
CREATE TABLE scaling_decisions (
 id uuid PRIMARY KEY,
 service_id uuid NOT NULL REFERENCES services(id),
 timestamp timestamptz NOT NULL DEFAULT now(),
 current_replicas integer NOT NULL,
 recommended_replicas integer NOT NULL,
 desired_replicas integer NOT NULL,
 cpu_percent double precision,
 reason text NOT NULL,
 estimated_capacity integer
);
CREATE INDEX scaling_decisions_retention ON scaling_decisions(timestamp);
CREATE INDEX scaling_decisions_service ON scaling_decisions(service_id,timestamp DESC);
ALTER TABLE instances ADD COLUMN scaling_deadline timestamptz;
ALTER TABLE instances ADD COLUMN scale_down_after timestamptz;
-- Operator-wide caps apply to all occupied slots, including jobs, old revisions and cleanup.
CREATE TABLE scaling_limits (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT true,
 max_services integer NOT NULL DEFAULT 16 CHECK(max_services BETWEEN 1 AND 256),
 max_instances integer NOT NULL DEFAULT 64 CHECK(max_instances BETWEEN 1 AND 1024),
 max_cpu_millis bigint NOT NULL DEFAULT 16000 CHECK(max_cpu_millis > 0),
 max_memory_mib bigint NOT NULL DEFAULT 32768 CHECK(max_memory_mib > 0)
);
INSERT INTO scaling_limits DEFAULT VALUES;
