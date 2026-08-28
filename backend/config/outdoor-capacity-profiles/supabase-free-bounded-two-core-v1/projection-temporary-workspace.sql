-- Staging-only prerequisite for the bounded two-core capacity profile.
-- The production projector creates transaction-scoped pg_temp candidate tables.
-- It cannot run as projection_role without this database privilege, and it must
-- not receive persistent database CREATE or broader application-table grants.
-- Rollback: REVOKE TEMPORARY ON DATABASE <database> FROM projection_role;

BEGIN;

SET LOCAL statement_timeout = '5s';

DO $profile$
DECLARE
  database_name text := pg_catalog.current_database();
BEGIN
  IF session_user <> 'postgres' OR current_user <> 'postgres' OR
     NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_roles
        WHERE rolname = 'projection_role'
          AND rolcanlogin
          AND NOT rolsuper
          AND NOT rolcreatedb
          AND NOT rolcreaterole
          AND NOT rolreplication
          AND NOT rolbypassrls
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Capacity profile projection TEMPORARY grant guard failed';
  END IF;

  EXECUTE pg_catalog.format(
    'GRANT TEMPORARY ON DATABASE %I TO projection_role',
    database_name
  );

  IF NOT pg_catalog.has_database_privilege(
       'projection_role', database_name, 'TEMPORARY'
     ) OR pg_catalog.has_database_privilege(
       'projection_role', database_name, 'CREATE'
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Capacity profile projection database privilege is not bounded';
  END IF;
END
$profile$;

COMMIT;
