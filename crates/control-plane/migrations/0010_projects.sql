ALTER TABLE environments ADD COLUMN parent_id uuid REFERENCES environments(id);
ALTER TABLE environments ADD CONSTRAINT environment_not_own_parent CHECK(parent_id IS DISTINCT FROM id);
