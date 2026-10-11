-- Additive private Owner bootstrap for selected project mbvzwsrtqcrwhvykugcd.
-- Independent QA must approve the exact SHA256 before remote execution.
-- No password literal, reset, public owner enrollment or changes outside this lane.
BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wanderful_owner_runtime') OR
     EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='wanderful_owner_v1') THEN
    RAISE EXCEPTION 'Owner bootstrap refuses existing role/schema';
  END IF;
END $$;
CREATE ROLE wanderful_owner_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4 PASSWORD NULL;
ALTER ROLE wanderful_owner_runtime SET search_path = wanderful_owner_v1, pg_catalog;
ALTER ROLE wanderful_owner_runtime SET statement_timeout = '5s';
ALTER ROLE wanderful_owner_runtime SET idle_in_transaction_session_timeout = '10s';
CREATE SCHEMA wanderful_owner_v1;
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
-- Operator-owned invoker trigger: the runtime cannot undo the fixed wave even
-- through direct SQL. Ordinary expiring authentication windows remain unchanged.
CREATE FUNCTION wanderful_owner_v1.guard_planning_wave() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE cap integer; old_wave boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_wave := OLD.scope IN ('wanderful-live-wave-20261003:requests',
      'wanderful-live-wave-20261003:google','wanderful-live-wave-20261003:graphhopper');
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF old_wave THEN RAISE EXCEPTION 'Fixed planning wave cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  cap := CASE NEW.scope WHEN 'wanderful-live-wave-20261003:requests' THEN 2
    WHEN 'wanderful-live-wave-20261003:google' THEN 16
    WHEN 'wanderful-live-wave-20261003:graphhopper' THEN 10 END;
  IF old_wave AND (NEW.scope <> OLD.scope OR NEW.identity_hash <> OLD.identity_hash
      OR NEW.cost < OLD.cost OR NEW.reset_at <> OLD.reset_at) THEN
    RAISE EXCEPTION 'Fixed planning wave cannot be reset or renamed';
  END IF;
  IF cap IS NOT NULL THEN
    IF NEW.identity_hash <> 'global' OR NEW.reset_at <> 'infinity'::timestamptz
        OR NEW.cost > cap OR (TG_OP = 'UPDATE' AND NOT old_wave) THEN
      RAISE EXCEPTION 'Invalid fixed planning wave';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION wanderful_owner_v1.guard_planning_wave() FROM PUBLIC;
CREATE TRIGGER guard_planning_wave BEFORE INSERT OR UPDATE OR DELETE
ON wanderful_owner_v1.windows FOR EACH ROW
EXECUTE FUNCTION wanderful_owner_v1.guard_planning_wave();
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
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA wanderful_owner_v1 FROM %I',api_role);
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
