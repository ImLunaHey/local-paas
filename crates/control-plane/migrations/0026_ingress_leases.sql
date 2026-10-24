-- Ingress may outlive the controller; cached endpoints must fence slot reuse.
CREATE TABLE ingress_route_leases (
 instance_id uuid PRIMARY KEY REFERENCES instances(id),
 expires_at timestamptz NOT NULL
);
