CREATE TABLE source_uploads (
 project_id uuid NOT NULL REFERENCES projects(id),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 archive_bytes bigint NOT NULL CHECK(archive_bytes BETWEEN 22 AND 33554432),
 expanded_bytes bigint NOT NULL CHECK(expanded_bytes BETWEEN 0 AND 134217728),
 file_count integer NOT NULL CHECK(file_count BETWEEN 1 AND 10000),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,digest)
);
CREATE TRIGGER platform_audit AFTER INSERT OR UPDATE OR DELETE ON source_uploads FOR EACH ROW EXECUTE FUNCTION audit_record_change();
