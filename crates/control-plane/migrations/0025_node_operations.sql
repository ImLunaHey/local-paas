ALTER TABLE nodes ADD COLUMN draining boolean NOT NULL DEFAULT false;
ALTER TABLE services ADD COLUMN relocation_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE instances ADD COLUMN routing_enabled boolean NOT NULL DEFAULT true;
CREATE TABLE node_operations (
 operation_id uuid PRIMARY KEY,
 target_id uuid NOT NULL,
 action text NOT NULL,
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE relocations (
 id uuid PRIMARY KEY,
 old_instance uuid NOT NULL REFERENCES instances(id),
 new_instance uuid NOT NULL UNIQUE REFERENCES instances(id),
 reason text NOT NULL CHECK(reason IN ('drain','node_lost')),
 state text NOT NULL CHECK(state IN ('preparing','draining','completed','failed','cancelled')),
 diagnostic text,
 deadline timestamptz NOT NULL DEFAULT now()+interval '180 seconds',
 drain_after timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_relocation_per_instance ON relocations(old_instance) WHERE state<>'cancelled';
