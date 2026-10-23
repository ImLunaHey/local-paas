CREATE TABLE builds (
    id uuid PRIMARY KEY,
    service_id uuid NOT NULL REFERENCES services(id),
    operation_id uuid NOT NULL UNIQUE,
    spec jsonb NOT NULL,
    no_cache boolean NOT NULL,
    status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted')),
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz,
    claim_token uuid,
    lease_until timestamptz,
    cancel_requested boolean NOT NULL DEFAULT false,
    error_code text,
    log_bytes integer NOT NULL DEFAULT 0 CHECK (log_bytes BETWEEN 0 AND 524288),
    logs_truncated boolean NOT NULL DEFAULT false
);
CREATE INDEX builds_service ON builds (service_id, created_at DESC, id DESC);
CREATE INDEX builds_queue ON builds (created_at, id) WHERE status = 'queued';
CREATE UNIQUE INDEX builds_one_active_service ON builds (service_id)
    WHERE status IN ('queued', 'running');

CREATE TABLE build_logs (
    sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    build_id uuid NOT NULL REFERENCES builds(id),
    message text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX build_logs_cursor ON build_logs (build_id, sequence);

CREATE TABLE revisions (
    id uuid PRIMARY KEY,
    service_id uuid NOT NULL REFERENCES services(id),
    build_id uuid NOT NULL UNIQUE REFERENCES builds(id),
    spec jsonb NOT NULL,
    image_repository text NOT NULL,
    image_digest text NOT NULL CHECK (image_digest ~ '^sha256:[a-f0-9]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX revisions_service ON revisions (service_id, created_at DESC);

CREATE TABLE build_workers (
    id uuid PRIMARY KEY,
    last_seen timestamptz NOT NULL
);

ALTER TABLE events DROP CONSTRAINT events_operation_id_key;
ALTER TABLE events ADD CONSTRAINT events_operation_kind UNIQUE (operation_id, kind);
ALTER TABLE events ADD COLUMN build_id uuid REFERENCES builds(id);
