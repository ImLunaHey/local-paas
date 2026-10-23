CREATE TABLE projects (
    id uuid PRIMARY KEY,
    name text NOT NULL UNIQUE
);

CREATE TABLE environments (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES projects(id),
    name text NOT NULL,
    UNIQUE (project_id, name)
);

-- A registered specification is not a built image revision or deployment.
-- This increment intentionally has no runtime-state or health fabrication.
CREATE TABLE services (
    id uuid PRIMARY KEY,
    environment_id uuid NOT NULL REFERENCES environments(id),
    name text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('oci-service', 'celld-service')),
    operation_id uuid NOT NULL UNIQUE,
    spec jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (environment_id, name)
);
CREATE INDEX services_created_at ON services (created_at DESC, id DESC);

CREATE TABLE events (
    id uuid PRIMARY KEY,
    service_id uuid NOT NULL REFERENCES services(id),
    operation_id uuid NOT NULL UNIQUE,
    kind text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_service_id ON events (service_id, created_at DESC);
