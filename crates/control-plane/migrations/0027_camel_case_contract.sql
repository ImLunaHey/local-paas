-- Deliberate development reset boundary: the dashboard, persisted JSON and node
-- protocol now share camelCase. There are no legacy readers or dual contracts.
-- Refuse an accidental in-place upgrade instead of partially interpreting old
-- runtime state. Provision a fresh platform database and agent state directories.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM services)
    OR EXISTS (SELECT 1 FROM nodes)
    OR EXISTS (SELECT 1 FROM host_metric_samples)
    OR EXISTS (SELECT 1 FROM audit_log) THEN
  RAISE EXCEPTION 'camelCase contract requires a fresh platform database and fresh node state; see docs/upgrades.md';
 END IF;
END $$;
