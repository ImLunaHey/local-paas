ALTER TABLE services DROP CONSTRAINT services_kind_check;
ALTER TABLE services ADD CONSTRAINT services_kind_check CHECK(kind IN ('oci-service','celld-service','postgres-service'));
CREATE TABLE volumes (
 id uuid PRIMARY KEY REFERENCES services(id),
 node_id uuid NOT NULL REFERENCES nodes(id),
 slot integer NOT NULL CHECK(slot BETWEEN 0 AND 3),
 size_gib integer NOT NULL CHECK(size_gib BETWEEN 1 AND 2),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(node_id,slot)
);
CREATE TABLE database_connections (
 service_id uuid PRIMARY KEY REFERENCES services(id),
 database_id uuid NOT NULL REFERENCES volumes(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(service_id<>database_id)
);
ALTER TABLE deployments ADD COLUMN database_ports integer[] NOT NULL DEFAULT '{}';
CREATE TRIGGER platform_audit AFTER INSERT OR UPDATE OR DELETE ON volumes FOR EACH ROW EXECUTE FUNCTION audit_record_change();
CREATE TRIGGER platform_audit AFTER INSERT OR UPDATE OR DELETE ON database_connections FOR EACH ROW EXECUTE FUNCTION audit_record_change();
