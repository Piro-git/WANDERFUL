-- Separate reviewed application migration. Do not add this to the frozen
-- phase-1-v2 bootstrap migration list or apply through backend db:migrate.
-- Run in one approved operator session after the existing app-security schema.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE trailmind_app_owner;
DO $gate$ BEGIN
  IF current_user <> 'trailmind_app_owner'
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='trailmind_app'
      AND nspowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='trailmind_app_owner'))
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='app_security_runtime_role')
  THEN RAISE EXCEPTION 'route_weather_schema_gate_failed' USING ERRCODE='42501'; END IF;
END $gate$;
CREATE TABLE trailmind_app.route_weather_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  next_admit_at timestamptz NOT NULL DEFAULT 'epoch',
  blocked_until timestamptz NOT NULL DEFAULT 'epoch'
);
INSERT INTO trailmind_app.route_weather_control(singleton) VALUES (true);
CREATE TABLE trailmind_app.route_weather_cache (
  point_key text PRIMARY KEY CHECK (length(point_key) BETWEEN 3 AND 32),
  document jsonb CHECK (document IS NULL OR (jsonb_typeof(document)='object'
    AND octet_length(document::text)<=256000)),
  retrieved_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT 'epoch',
  modified text CHECK (modified IS NULL OR length(modified)<=100),
  lease_token uuid,
  lease_until timestamptz,
  CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
  CHECK (document IS NULL OR retrieved_at IS NOT NULL)
);
REVOKE ALL ON trailmind_app.route_weather_control, trailmind_app.route_weather_cache FROM PUBLIC;
ALTER TABLE trailmind_app.route_weather_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE trailmind_app.route_weather_cache ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON trailmind_app.route_weather_control TO app_security_runtime_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON trailmind_app.route_weather_cache TO app_security_runtime_role;
CREATE POLICY route_weather_control_runtime ON trailmind_app.route_weather_control
  FOR ALL TO app_security_runtime_role USING (true) WITH CHECK (true);
CREATE POLICY route_weather_cache_runtime ON trailmind_app.route_weather_cache
  FOR ALL TO app_security_runtime_role USING (true) WITH CHECK (true);
COMMIT;
