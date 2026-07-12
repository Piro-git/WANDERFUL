CREATE TABLE IF NOT EXISTS app_attest_challenges (
    challenge_id text PRIMARY KEY,
    purpose text NOT NULL CHECK (purpose IN ('registration', 'routeSession')),
    challenge bytea NOT NULL CHECK (octet_length(challenge) >= 32),
    key_id_hash text,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS app_attest_challenges_expiry_idx
    ON app_attest_challenges (expires_at);

CREATE TABLE IF NOT EXISTS app_attest_keys (
    environment text NOT NULL CHECK (environment IN ('development', 'production')),
    key_id_hash text NOT NULL,
    installation_id text NOT NULL,
    public_key_pem text NOT NULL,
    receipt bytea NOT NULL,
    assertion_counter bigint NOT NULL CHECK (assertion_counter >= 0),
    validation_category smallint NOT NULL,
    bundle_version text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (environment, key_id_hash),
    UNIQUE (environment, installation_id)
);

CREATE TABLE IF NOT EXISTS app_attest_route_sessions (
    token_hash text PRIMARY KEY,
    installation_id text NOT NULL,
    expires_at timestamptz NOT NULL,
    remaining_cost integer NOT NULL CHECK (remaining_cost >= 0),
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS app_attest_route_sessions_expiry_idx
    ON app_attest_route_sessions (expires_at);

CREATE TABLE IF NOT EXISTS app_attest_request_ids (
    token_hash text NOT NULL REFERENCES app_attest_route_sessions(token_hash) ON DELETE CASCADE,
    request_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (token_hash, request_id)
);

CREATE TABLE IF NOT EXISTS app_attest_rate_windows (
    scope text NOT NULL,
    identity_hash text NOT NULL,
    cost integer NOT NULL CHECK (cost >= 0),
    reset_at timestamptz NOT NULL,
    PRIMARY KEY (scope, identity_hash)
);

CREATE INDEX IF NOT EXISTS app_attest_rate_windows_expiry_idx
    ON app_attest_rate_windows (reset_at);

CREATE TABLE IF NOT EXISTS app_attest_provider_leases (
    lease_id uuid PRIMARY KEY,
    scope text NOT NULL CHECK (scope IN ('route', 'intent')),
    expires_at timestamptz NOT NULL,
    released_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS app_attest_provider_leases_active_idx
    ON app_attest_provider_leases (scope, expires_at)
    WHERE released_at IS NULL;
