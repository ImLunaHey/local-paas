-- GitHub App identifiers are non-secret routing metadata. The private key stays
-- at the existing opaque OpenBao path; builds retain only the connection used.
ALTER TABLE source_connections
    ADD COLUMN github_app_id bigint CHECK (github_app_id > 0),
    ADD COLUMN github_installation_id bigint CHECK (github_installation_id > 0),
    ADD COLUMN authentication_status text NOT NULL DEFAULT 'public'
        CHECK (authentication_status IN ('public', 'configured', 'active', 'error')),
    ADD COLUMN authentication_error text,
    ADD COLUMN last_authenticated_at timestamptz,
    ADD CHECK ((github_app_id IS NULL) = (github_installation_id IS NULL)),
    ADD CHECK (
        (github_app_id IS NULL AND authentication_status = 'public') OR
        (github_app_id IS NOT NULL AND authentication_status <> 'public')
    );

ALTER TABLE builds
    ADD COLUMN source_connection_id uuid REFERENCES source_connections(id);

CREATE INDEX builds_source_connection
    ON builds (source_connection_id, created_at DESC)
    WHERE source_connection_id IS NOT NULL;
