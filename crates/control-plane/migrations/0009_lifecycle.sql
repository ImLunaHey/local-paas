CREATE TABLE instance_starts (
    instance_id uuid NOT NULL REFERENCES instances(id),
    started_at timestamptz NOT NULL,
    PRIMARY KEY(instance_id,started_at)
);
