-- Organizations are owned by the authentication subsystem. Platform resources
-- retain only the opaque organization identifier and never authentication data.
ALTER TABLE projects ADD COLUMN organization_id text;
ALTER TABLE projects DROP CONSTRAINT projects_name_key;
CREATE UNIQUE INDEX projects_organization_name
    ON projects (organization_id, name) NULLS NOT DISTINCT;
CREATE INDEX projects_organization ON projects (organization_id, id);

ALTER TABLE domains ADD COLUMN organization_id text;
CREATE INDEX domains_organization ON domains (organization_id, hostname);

ALTER TABLE audit_log ADD COLUMN organization_id text;
CREATE INDEX audit_log_organization ON audit_log (organization_id, sequence DESC);

-- Existing installations must explicitly adopt unscoped resources through the
-- local bootstrap command. Until then only a global administrator can see them.
