CREATE TABLE nodes (
 id uuid PRIMARY KEY,
 name text NOT NULL UNIQUE,
 token_hash text NOT NULL,
 cpu_millis integer NOT NULL CHECK(cpu_millis > 0),
 memory_mib integer NOT NULL CHECK(memory_mib > 0),
 slots integer NOT NULL CHECK(slots BETWEEN 1 AND 4),
 endpoint_base integer NOT NULL CHECK(endpoint_base BETWEEN 1024 AND 65000),
 cordoned boolean NOT NULL DEFAULT false,
 last_seen timestamptz
);
CREATE TABLE deployments (
 id uuid PRIMARY KEY,
 operation_id uuid NOT NULL UNIQUE,
 service_id uuid NOT NULL REFERENCES services(id),
 revision_id uuid NOT NULL REFERENCES revisions(id),
 spec jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('preparing','active','failed','stopped','superseded')),
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 deadline timestamptz NOT NULL DEFAULT now() + interval '180 seconds'
);
CREATE UNIQUE INDEX one_preparing_deployment ON deployments(service_id) WHERE status='preparing';
CREATE UNIQUE INDEX one_active_deployment ON deployments(service_id) WHERE status='active';
CREATE TABLE instances (
 id uuid PRIMARY KEY,
 deployment_id uuid NOT NULL REFERENCES deployments(id),
 node_id uuid NOT NULL REFERENCES nodes(id),
 slot integer NOT NULL CHECK(slot BETWEEN 0 AND 3),
 generation bigint NOT NULL DEFAULT 1,
 desired_state text NOT NULL CHECK(desired_state IN ('running','stopped')),
 state text NOT NULL DEFAULT 'assigned' CHECK(state IN ('assigned','starting','ready','failed','stopped','unknown')),
 diagnostic text,
 observed_at timestamptz,
 cpu_millis double precision,
 memory_bytes bigint,
 pids bigint
);
-- Stopping allocations retain their slot until the node confirms cleanup.
CREATE UNIQUE INDEX occupied_node_slot ON instances(node_id,slot) WHERE state <> 'stopped';
CREATE TABLE runtime_logs (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 instance_id uuid NOT NULL REFERENCES instances(id),
 entry_key text NOT NULL,
 timestamp timestamptz NOT NULL,
 stream text NOT NULL CHECK(stream IN ('stdout','stderr')),
 line text NOT NULL,
 UNIQUE(instance_id,entry_key)
);
CREATE INDEX runtime_logs_instance ON runtime_logs(instance_id,sequence);
CREATE TABLE runtime_metrics (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 instance_id uuid NOT NULL REFERENCES instances(id),
 timestamp timestamptz NOT NULL DEFAULT now(),
 cpu_millis double precision NOT NULL,
 memory_bytes bigint NOT NULL,
 pids bigint NOT NULL
);
CREATE INDEX runtime_metrics_instance ON runtime_metrics(instance_id,timestamp DESC);
CREATE TABLE preview_routes (
 authority text PRIMARY KEY,
 service_id uuid NOT NULL UNIQUE REFERENCES services(id)
);
