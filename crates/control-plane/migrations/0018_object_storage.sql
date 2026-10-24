ALTER TABLE services DROP CONSTRAINT services_kind_check;
ALTER TABLE services ADD CONSTRAINT services_kind_check CHECK(kind IN ('oci-service','celld-service','postgres-service','redis-service','rustfs-service'));
CREATE TABLE storage_buckets (
 id uuid PRIMARY KEY,
 operation_id uuid NOT NULL UNIQUE,
 service_id uuid NOT NULL REFERENCES volumes(id),
 name text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(service_id,name)
);
CREATE TABLE storage_bindings (
 service_id uuid PRIMARY KEY REFERENCES services(id),
 bucket_id uuid NOT NULL REFERENCES storage_buckets(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER platform_audit AFTER INSERT OR UPDATE OR DELETE ON storage_buckets FOR EACH ROW EXECUTE FUNCTION audit_record_change();
CREATE TRIGGER platform_audit AFTER INSERT OR UPDATE OR DELETE ON storage_bindings FOR EACH ROW EXECUTE FUNCTION audit_record_change();
ALTER TABLE storage_bindings ADD COLUMN read_only boolean NOT NULL DEFAULT false;
