-- TrailMind Outdoor Staging V1 Phase 1 pre-migration foundation.
-- Run only on the authorized staging project, inside one transaction, before
-- backend migrations 001-008. This file contains no credentials or provider
-- configuration.

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('trailmind-phase-1-foundation', 0)
);

DO $foundation$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
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
  ]::text[]
  LOOP
    IF pg_catalog.to_regrole(role_name) IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'TrailMind Phase 1 role already exists: ' || role_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_namespace
     WHERE nspname IN ('trailmind_app', 'trailmind_control')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'TrailMind Phase 1 schema already exists';
  END IF;
END
$foundation$;

CREATE ROLE trailmind_app_owner
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE trailmind_control_owner
  NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

CREATE ROLE platform_provisioner
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE migration_role
  LOGIN PASSWORD NULL NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE regional_import_role
  LOGIN PASSWORD NULL NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE projection_role
  LOGIN PASSWORD NULL NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE app_security_runtime_role
  LOGIN PASSWORD NULL NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE outdoor_research_runtime_role
  LOGIN PASSWORD NULL NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE outdoor_research_cancellation_control_role
  LOGIN PASSWORD NULL CONNECTION LIMIT 1 NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE pruner_role
  LOGIN PASSWORD NULL NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE readonly_auditor_role
  LOGIN PASSWORD NULL NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- PostgreSQL 17 gives a non-superuser CREATEROLE creator ADMIN but SET FALSE
-- on new roles. Supabase's managed postgres role therefore needs an explicit,
-- auditable SET grant before it can create schemas or transfer function
-- ownership to the two NOLOGIN owners.
DO $foundation$
BEGIN
  EXECUTE pg_catalog.format(
    'GRANT trailmind_app_owner TO %I WITH INHERIT FALSE, SET TRUE',
    CURRENT_USER
  );
  EXECUTE pg_catalog.format(
    'GRANT trailmind_control_owner TO %I WITH INHERIT FALSE, SET TRUE',
    CURRENT_USER
  );
END
$foundation$;

GRANT trailmind_app_owner TO migration_role
  WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
GRANT pg_signal_backend TO trailmind_control_owner
  WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;

DO $foundation$
DECLARE
  preserved_role record;
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC',
    pg_catalog.current_database()
  );

  -- Preserve the provider-managed roles' pre-existing ability to use temporary
  -- objects. TrailMind roles remain explicitly outside this allow-list.
  FOR preserved_role IN
    SELECT rolname
      FROM pg_catalog.pg_roles
     WHERE rolname <> ALL(ARRAY[
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
     ]::text[])
  LOOP
    EXECUTE pg_catalog.format(
      'GRANT TEMPORARY ON DATABASE %I TO %I',
      pg_catalog.current_database(),
      preserved_role.rolname
    );
  END LOOP;

  EXECUTE pg_catalog.format(
    'GRANT CREATE ON DATABASE %I TO regional_import_role',
    pg_catalog.current_database()
  );
END
$foundation$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM anon, authenticated, service_role;
REVOKE CREATE ON SCHEMA public FROM
  platform_provisioner,
  migration_role,
  regional_import_role,
  projection_role,
  app_security_runtime_role,
  outdoor_research_runtime_role,
  outdoor_research_cancellation_control_role,
  pruner_role,
  readonly_auditor_role;

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;

CREATE SCHEMA trailmind_app AUTHORIZATION trailmind_app_owner;
CREATE SCHEMA trailmind_control AUTHORIZATION trailmind_control_owner;

SET LOCAL ROLE trailmind_app_owner;
REVOKE ALL ON SCHEMA trailmind_app FROM PUBLIC, anon, authenticated, service_role;
RESET ROLE;

SET LOCAL ROLE trailmind_control_owner;
REVOKE ALL ON SCHEMA trailmind_control FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA trailmind_control
  TO outdoor_research_cancellation_control_role;
RESET ROLE;

GRANT USAGE ON SCHEMA public TO
  trailmind_app_owner,
  migration_role,
  regional_import_role,
  projection_role,
  app_security_runtime_role,
  outdoor_research_runtime_role,
  pruner_role;

REVOKE ALL ON ALL TABLES IN SCHEMA public
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM
  platform_provisioner,
  migration_role,
  app_security_runtime_role,
  outdoor_research_runtime_role,
  outdoor_research_cancellation_control_role,
  pruner_role,
  readonly_auditor_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public
  TO trailmind_app_owner, regional_import_role, projection_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public
  TO trailmind_app_owner, regional_import_role, projection_role;

SET LOCAL ROLE trailmind_app_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA trailmind_app
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA trailmind_app
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA trailmind_app
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
RESET ROLE;

SET LOCAL ROLE trailmind_control_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA trailmind_control
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
RESET ROLE;
DO $foundation$
BEGIN
  EXECUTE pg_catalog.format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
    CURRENT_USER
  );
END
$foundation$;

ALTER ROLE migration_role
  SET search_path = trailmind_app, pg_catalog, public, pg_temp;
ALTER ROLE regional_import_role
  SET search_path = pg_catalog, trailmind_app, public, pg_temp;
ALTER ROLE projection_role
  SET search_path = pg_catalog, trailmind_app, public, pg_temp;
ALTER ROLE app_security_runtime_role
  SET search_path = pg_catalog, trailmind_app, public, pg_temp;
ALTER ROLE outdoor_research_runtime_role
  SET search_path = pg_catalog, trailmind_app, public, pg_temp;
ALTER ROLE pruner_role
  SET search_path = pg_catalog, trailmind_app, public, pg_temp;
ALTER ROLE outdoor_research_cancellation_control_role
  SET search_path = pg_catalog, trailmind_control, pg_temp;
ALTER ROLE outdoor_research_cancellation_control_role
  SET statement_timeout = '1000ms';

SET LOCAL ROLE trailmind_control_owner;
CREATE OR REPLACE FUNCTION trailmind_control.cancel_active_outdoor_research_backend_integer(
  target_pid integer
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
STRICT
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  target_is_outdoor_runtime boolean;
BEGIN
  IF target_pid = pg_catalog.pg_backend_pid() THEN
    RETURN false;
  END IF;

  SELECT pg_catalog.count(*) = 1
    INTO target_is_outdoor_runtime
    FROM pg_catalog.pg_stat_activity
   WHERE pid = target_pid
     AND datname = pg_catalog.current_database()
     AND usename = 'outdoor_research_runtime_role';

  IF NOT target_is_outdoor_runtime THEN
    RETURN false;
  END IF;

  RETURN pg_catalog.pg_cancel_backend(target_pid);
END
$function$;

REVOKE ALL ON FUNCTION
  trailmind_control.cancel_active_outdoor_research_backend_integer(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  trailmind_control.cancel_active_outdoor_research_backend_integer(integer)
  TO outdoor_research_cancellation_control_role;
RESET ROLE;
