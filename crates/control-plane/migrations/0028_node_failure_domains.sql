-- Metadata records physical placement; distinctNodes still means node anti-affinity.
ALTER TABLE nodes ADD COLUMN failure_domain text NOT NULL DEFAULT 'unspecified';
