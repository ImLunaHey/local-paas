ALTER TABLE services DROP CONSTRAINT services_kind_check;
ALTER TABLE services ADD CONSTRAINT services_kind_check CHECK(kind IN ('oci-service','celld-service','postgres-service','redis-service'));
ALTER TABLE database_connections ADD COLUMN secret_name text NOT NULL DEFAULT 'DATABASE_URL' CHECK(secret_name IN ('DATABASE_URL','REDIS_URL'));
ALTER TABLE database_connections DROP CONSTRAINT database_connections_pkey;
ALTER TABLE database_connections ADD PRIMARY KEY(service_id,secret_name);
ALTER TABLE nodes ADD COLUMN capabilities text[] NOT NULL DEFAULT '{}';
