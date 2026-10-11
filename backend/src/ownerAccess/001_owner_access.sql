-- Dedicated owner lane. Run once using a migration operator, never the web role.
-- Provision the NOINHERIT runtime login wanderful_owner_runtime separately.
BEGIN;
CREATE SCHEMA IF NOT EXISTS wanderful_owner_v1;
REVOKE ALL ON SCHEMA wanderful_owner_v1 FROM PUBLIC;
CREATE TABLE wanderful_owner_v1.owners (
  installation_id text PRIMARY KEY CHECK (installation_id ~ '^owner:[A-Za-z0-9_-]{16,128}$'),
  revoked_at timestamptz
);
CREATE TABLE wanderful_owner_v1.keys (
  key_id text PRIMARY KEY,
  installation_id text NOT NULL REFERENCES wanderful_owner_v1.owners,
  public_key_spki bytea NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE wanderful_owner_v1.challenges (
  challenge_id text PRIMARY KEY,
  key_id text NOT NULL REFERENCES wanderful_owner_v1.keys,
  installation_id text NOT NULL REFERENCES wanderful_owner_v1.owners,
  challenge bytea NOT NULL CHECK (octet_length(challenge)=32),
  origin text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE TABLE wanderful_owner_v1.sessions (
  token_hash text PRIMARY KEY,
  key_id text NOT NULL REFERENCES wanderful_owner_v1.keys,
  installation_id text NOT NULL REFERENCES wanderful_owner_v1.owners,
  expires_at timestamptz NOT NULL,
  remaining_cost integer NOT NULL CHECK (remaining_cost>=0),
  revoked_at timestamptz
);
CREATE TABLE wanderful_owner_v1.requests (
  token_hash text NOT NULL REFERENCES wanderful_owner_v1.sessions,
  request_id uuid NOT NULL,
  PRIMARY KEY(token_hash,request_id)
);
CREATE TABLE wanderful_owner_v1.windows (
  scope text NOT NULL,
  identity_hash text NOT NULL,
  cost integer NOT NULL CHECK(cost>=0),
  reset_at timestamptz NOT NULL,
  PRIMARY KEY(scope,identity_hash)
);
CREATE TABLE wanderful_owner_v1.leases (
  lease_id uuid PRIMARY KEY,
  token_hash text NOT NULL REFERENCES wanderful_owner_v1.sessions,
  installation_id text NOT NULL REFERENCES wanderful_owner_v1.owners,
  scope text NOT NULL CHECK(scope IN ('route','intent')),
  expires_at timestamptz NOT NULL,
  released_at timestamptz
);
CREATE INDEX ON wanderful_owner_v1.challenges(expires_at);
CREATE INDEX ON wanderful_owner_v1.sessions(expires_at);
CREATE INDEX ON wanderful_owner_v1.windows(reset_at);
CREATE INDEX ON wanderful_owner_v1.leases(expires_at) WHERE released_at IS NULL;
DO $$
DECLARE table_name text; api_role text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='wanderful_owner_runtime' AND NOT rolsuper
      AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolinherit AND NOT rolreplication) THEN
    RAISE EXCEPTION 'Provision a restricted wanderful_owner_runtime role first';
  END IF;
  FOREACH table_name IN ARRAY ARRAY['owners','keys','challenges','sessions','requests','windows','leases'] LOOP
    EXECUTE format('ALTER TABLE wanderful_owner_v1.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON wanderful_owner_v1.%I FROM PUBLIC', table_name);
    EXECUTE format('CREATE POLICY owner_runtime ON wanderful_owner_v1.%I TO wanderful_owner_runtime USING (true) WITH CHECK (true)', table_name);
  END LOOP;
  -- Managed databases may add default grants beyond PUBLIC. Remove these from
  -- this isolated schema without modifying existing application tables.
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA wanderful_owner_v1 FROM %I',api_role);
      EXECUTE format('REVOKE ALL ON SCHEMA wanderful_owner_v1 FROM %I',api_role);
    END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA wanderful_owner_v1 TO wanderful_owner_runtime;
GRANT SELECT ON wanderful_owner_v1.owners,wanderful_owner_v1.keys TO wanderful_owner_runtime;
GRANT SELECT,INSERT,UPDATE ON wanderful_owner_v1.challenges,wanderful_owner_v1.sessions,
  wanderful_owner_v1.windows,wanderful_owner_v1.leases TO wanderful_owner_runtime;
GRANT SELECT,INSERT ON wanderful_owner_v1.requests TO wanderful_owner_runtime;
COMMIT;
