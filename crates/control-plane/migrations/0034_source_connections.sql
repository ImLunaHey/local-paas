-- Provider automation records policy and observations only. Provider and webhook
-- credentials remain in OpenBao; PostgreSQL retains their opaque path.
CREATE TABLE source_connections (
    id uuid PRIMARY KEY,
    service_id uuid NOT NULL UNIQUE REFERENCES services(id),
    organization_id text NOT NULL,
    provider text NOT NULL CHECK (provider IN ('github')),
    repository text NOT NULL,
    repository_key text NOT NULL,
    secret_path text NOT NULL UNIQUE,
    events text[] NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_delivery_at timestamptz,
    CHECK (cardinality(events) BETWEEN 1 AND 3),
    CHECK (events <@ ARRAY['push', 'tag', 'pull_request']::text[]),
    UNIQUE (organization_id, provider, repository_key, service_id)
);
CREATE INDEX source_connections_organization
    ON source_connections (organization_id, created_at DESC, id DESC);

-- Payloads and signatures may contain sensitive repository data and are never
-- retained. The digest makes conflicting delivery-ID reuse detectable.
CREATE TABLE webhook_deliveries (
    id uuid PRIMARY KEY,
    source_connection_id uuid NOT NULL REFERENCES source_connections(id),
    delivery_id text NOT NULL,
    event text NOT NULL,
    action text,
    source_ref text,
    resolved_commit text CHECK (
        resolved_commit IS NULL OR
        resolved_commit ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'
    ),
    status text NOT NULL CHECK (status IN ('accepted', 'ignored', 'blocked')),
    reason text NOT NULL,
    body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[a-f0-9]{64}$'),
    build_id uuid REFERENCES builds(id),
    received_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_connection_id, delivery_id)
);
CREATE INDEX webhook_deliveries_connection
    ON webhook_deliveries (source_connection_id, received_at DESC, id DESC);

CREATE TRIGGER platform_audit AFTER INSERT OR UPDATE OR DELETE ON source_connections
    FOR EACH ROW EXECUTE FUNCTION audit_record_change();
CREATE TRIGGER platform_audit AFTER INSERT OR UPDATE OR DELETE ON webhook_deliveries
    FOR EACH ROW EXECUTE FUNCTION audit_record_change();
