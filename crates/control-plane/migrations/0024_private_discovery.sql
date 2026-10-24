-- A stopped instance's published slot cannot be reused while any issued private
-- route lease could still be used to open a connection to it.
CREATE TABLE private_route_leases (
 instance_id uuid PRIMARY KEY REFERENCES instances(id),
 expires_at timestamptz NOT NULL
);
