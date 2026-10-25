-- Store only a SHA-256 verifier for high-entropy personal credentials.
CREATE TABLE personal_api_keys (
    id uuid PRIMARY KEY,
    user_id text NOT NULL,
    organization_id text NOT NULL,
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    token_hash text NOT NULL UNIQUE,
    prefix text NOT NULL,
    permissions jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz
);
CREATE INDEX personal_api_keys_owner ON personal_api_keys (user_id, organization_id);
