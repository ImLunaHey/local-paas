ALTER TABLE builds ADD COLUMN resolved_commit text
    CHECK (resolved_commit ~ '^([a-f0-9]{40}|[a-f0-9]{64})$');
UPDATE builds SET resolved_commit = spec->'source'->>'commit';
