-- Compensating rollback for the blocked TrailMind Outdoor Staging V1 Phase 1
-- pre-migration foundation. This is intentionally bounded to the state created
-- by PHASE_1_PRE_MIGRATION.sql before migrations 001-008 are applied.

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('trailmind-phase-1-foundation', 0)
);

DO $rollback$
DECLARE
  missing_roles text[];
BEGIN
  SELECT pg_catalog.array_agg(expected.role_name ORDER BY expected.role_name)
    INTO missing_roles
    FROM (
      VALUES
        ('trailmind_app_owner'),
        ('trailmind_control_owner'),
        ('platform_provisioner'),
        ('migration_role'),
        ('regional_import_role'),
        ('projection_role'),
        ('app_security_runtime_role'),
        ('outdoor_research_runtime_role'),
        ('outdoor_research_cancellation_control_role'),
        ('pruner_role'),
        ('readonly_auditor_role')
    ) AS expected(role_name)
   WHERE pg_catalog.to_regrole(expected.role_name) IS NULL;

  IF missing_roles IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Blocked rollback role guard failed';
  END IF;

  IF pg_catalog.to_regnamespace('trailmind_app') IS NULL
     OR pg_catalog.to_regnamespace('trailmind_control') IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Blocked rollback schema guard failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'postgis'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Blocked rollback PostGIS guard failed';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'trailmind_app'
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = routine.pronamespace
     WHERE namespace.nspname = 'trailmind_app'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Blocked rollback refuses to remove application objects';
  END IF;

  IF pg_catalog.to_regclass('trailmind_app.schema_migrations') IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Blocked rollback refuses to remove a migration ledger';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'trailmind_control'
  ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = routine.pronamespace
     WHERE namespace.nspname = 'trailmind_control'
       AND routine.proname =
         'cancel_active_outdoor_research_backend_integer'
       AND pg_catalog.pg_get_function_identity_arguments(routine.oid) = 'target_pid integer'
  ) <> 1 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = routine.pronamespace
     WHERE namespace.nspname = 'trailmind_control'
       AND (
         routine.proname <>
           'cancel_active_outdoor_research_backend_integer'
         OR pg_catalog.pg_get_function_identity_arguments(routine.oid) <>
           'target_pid integer'
       )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Blocked rollback refuses unexpected control objects';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_stat_activity
     WHERE datname = pg_catalog.current_database()
       AND pid <> pg_catalog.pg_backend_pid()
       AND backend_type = 'client backend'
       AND usename IN (
         'migration_role',
         'regional_import_role',
         'projection_role',
         'app_security_runtime_role',
         'outdoor_research_runtime_role',
         'outdoor_research_cancellation_control_role',
         'pruner_role',
         'readonly_auditor_role'
       )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Blocked rollback detected an active TrailMind session';
  END IF;
END
$rollback$;

SET LOCAL ROLE trailmind_control_owner;
DROP SCHEMA trailmind_control CASCADE;
DROP OWNED BY trailmind_control_owner;
RESET ROLE;

SET LOCAL ROLE trailmind_app_owner;
DROP SCHEMA trailmind_app;
DROP OWNED BY trailmind_app_owner;
RESET ROLE;

DROP EXTENSION postgis;

DO $rollback$
DECLARE
  preserved_role record;
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE CREATE ON DATABASE %I FROM regional_import_role',
    pg_catalog.current_database()
  );
  EXECUTE pg_catalog.format(
    'GRANT TEMPORARY ON DATABASE %I TO PUBLIC',
    pg_catalog.current_database()
  );

  -- The pre-migration script materialized PUBLIC's TEMPORARY privilege as an
  -- explicit grant on every provider role. Remove those redundant grants while
  -- preserving the two roles that carry explicit TEMPORARY in the baseline.
  FOR preserved_role IN
    SELECT rolname
      FROM pg_catalog.pg_roles
     WHERE rolname NOT IN (
       'postgres',
       'dashboard_user',
       'trailmind_app_owner',
       'trailmind_control_owner',
       'platform_provisioner',
       'migration_role',
       'regional_import_role',
       'projection_role',
       'app_security_runtime_role',
       'outdoor_research_runtime_role',
       'outdoor_research_cancellation_control_role',
       'pruner_role',
       'readonly_auditor_role'
     )
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE TEMPORARY ON DATABASE %I FROM %I',
      pg_catalog.current_database(),
      preserved_role.rolname
    );
  END LOOP;
END
$rollback$;

REVOKE ALL ON SCHEMA public FROM
  trailmind_app_owner,
  migration_role,
  regional_import_role,
  projection_role,
  app_security_runtime_role,
  outdoor_research_runtime_role,
  pruner_role;

REVOKE trailmind_app_owner FROM migration_role;
REVOKE trailmind_app_owner FROM CURRENT_USER;
REVOKE trailmind_control_owner FROM CURRENT_USER;
REVOKE pg_signal_backend FROM trailmind_control_owner;

DROP ROLE
  platform_provisioner,
  migration_role,
  regional_import_role,
  projection_role,
  app_security_runtime_role,
  outdoor_research_runtime_role,
  outdoor_research_cancellation_control_role,
  pruner_role,
  readonly_auditor_role,
  trailmind_app_owner,
  trailmind_control_owner;
