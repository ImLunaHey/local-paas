-- NULL identifies platform-owned capacity. Organization-owned nodes are visible
-- and manageable only inside the owning organization.
ALTER TABLE nodes ADD COLUMN organization_id text;
CREATE INDEX nodes_organization ON nodes (organization_id, name);
