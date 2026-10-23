CREATE TABLE secret_sets (
 service_id uuid PRIMARY KEY REFERENCES services(id),
 version integer NOT NULL,
 names text[] NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE deployments ADD COLUMN secret_version integer;
