ALTER TABLE services ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE services ADD COLUMN registered_spec jsonb;
UPDATE services SET registered_spec = spec;
ALTER TABLE services ALTER COLUMN registered_spec SET NOT NULL;

CREATE TABLE service_updates (
    operation_id uuid PRIMARY KEY,
    service_id uuid NOT NULL REFERENCES services(id),
    expected_version integer NOT NULL,
    spec jsonb NOT NULL,
    response jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE builds ADD COLUMN request_json jsonb;
