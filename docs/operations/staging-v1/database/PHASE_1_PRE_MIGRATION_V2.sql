-- TrailMind Outdoor Staging V1 Phase 1 Supabase PostGIS-isolation V2 candidate.
-- LOCAL REVIEW CANDIDATE ONLY: this turn did not authorize remote execution.
-- If independently approved later, run only on the exact authorized empty staging
-- project, inside one transaction, before the V2 migration policy 001-007 + 009.
-- Never run this file after the historical blocked V1 operator path.

BEGIN;

SET LOCAL statement_timeout = '30s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('trailmind-phase-1-foundation', 0)
);

DO $foundation$
DECLARE
  role_name text;
BEGIN
  IF session_user <> 'postgres' OR current_user <> 'postgres' OR
     NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_roles role_record
        WHERE role_record.rolname = current_user
          AND role_record.rolcreaterole
          AND NOT role_record.rolreplication
          AND NOT role_record.rolbypassrls
     ) OR pg_catalog.pg_get_userbyid((
       SELECT database_record.datdba
         FROM pg_catalog.pg_database database_record
        WHERE database_record.datname = pg_catalog.current_database()
     )) <> 'postgres' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'TrailMind Phase 1 V2 requires the exact managed postgres operator and database owner';
  END IF;

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
     WHERE nspname IN (
       'trailmind_app',
       'trailmind_control',
       'trailmind_gis',
       'trailmind_phase1_guard'
     )
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'postgis'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'TrailMind Phase 1 V2 requires empty schemas and absent PostGIS';
  END IF;

  IF pg_catalog.to_regnamespace('extensions') IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'TrailMind Phase 1 V2 requires the managed extensions schema';
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
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
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

-- PostgreSQL 17 gives a non-superuser CREATEROLE creator an immutable,
-- bootstrap-granted ADMIN membership with INHERIT FALSE and SET FALSE.
-- Trying to rewrite that row with ADMIN TRUE fails with SQLSTATE 0LP01.
-- Keep it intact and add separate, explicitly self-granted SET-only rows for
-- the three bounded identities that this one-session operator may assume.
GRANT trailmind_app_owner TO CURRENT_USER
  WITH INHERIT FALSE, SET TRUE, ADMIN FALSE GRANTED BY CURRENT_USER;
GRANT trailmind_control_owner TO CURRENT_USER
  WITH INHERIT FALSE, SET TRUE, ADMIN FALSE GRANTED BY CURRENT_USER;
GRANT migration_role TO CURRENT_USER
  WITH INHERIT FALSE, SET TRUE, ADMIN FALSE GRANTED BY CURRENT_USER;

GRANT trailmind_app_owner TO migration_role
  WITH INHERIT FALSE, SET TRUE, ADMIN FALSE GRANTED BY CURRENT_USER;
GRANT pg_signal_backend TO trailmind_control_owner
  WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;

-- Snapshot the exact shared ACL representation and its normalized semantics
-- before provisioning changes any shared privilege. The post-step consumes
-- this snapshot; pre-ledger compensation requires byte and semantic equality.
CREATE SCHEMA trailmind_phase1_guard;
COMMENT ON SCHEMA trailmind_phase1_guard IS
  'trailmind:mbvzwsrtqcrwhvykugcd:phase1-v2:acl-snapshot';
REVOKE ALL ON SCHEMA trailmind_phase1_guard FROM PUBLIC;
CREATE TABLE trailmind_phase1_guard.shared_acl_snapshot (
  object_kind text NOT NULL CHECK (object_kind IN ('database', 'schema')),
  object_name text NOT NULL,
  owner_name text NOT NULL,
  raw_acl text,
  semantic_acl jsonb NOT NULL,
  PRIMARY KEY (object_kind, object_name)
);
COMMENT ON TABLE trailmind_phase1_guard.shared_acl_snapshot IS
  'trailmind:mbvzwsrtqcrwhvykugcd:phase1-v2:acl-snapshot';
REVOKE ALL ON TABLE trailmind_phase1_guard.shared_acl_snapshot FROM PUBLIC;
CREATE TABLE trailmind_phase1_guard.shared_acl_principal_snapshot (
  principal_name text NOT NULL,
  object_kind text NOT NULL CHECK (object_kind IN ('database', 'schema')),
  object_name text NOT NULL,
  privilege_name text NOT NULL,
  effective boolean NOT NULL,
  PRIMARY KEY (
    principal_name, object_kind, object_name, privilege_name
  )
);
COMMENT ON TABLE trailmind_phase1_guard.shared_acl_principal_snapshot IS
  'trailmind:mbvzwsrtqcrwhvykugcd:phase1-v2:acl-principals';
REVOKE ALL ON TABLE
  trailmind_phase1_guard.shared_acl_principal_snapshot FROM PUBLIC;

WITH shared_object AS (
  SELECT 'database'::text AS object_kind,
         database_record.datname AS object_name,
         database_record.datdba AS owner_oid,
         database_record.datacl AS object_acl,
         'd'::"char" AS acl_kind
    FROM pg_catalog.pg_database database_record
   WHERE database_record.datname = pg_catalog.current_database()
  UNION ALL
  SELECT 'schema'::text,
         namespace.nspname,
         namespace.nspowner,
         namespace.nspacl,
         'n'::"char"
    FROM pg_catalog.pg_namespace namespace
   WHERE namespace.nspname IN ('public', 'extensions')
), normalized AS (
  SELECT shared_object.object_kind,
         shared_object.object_name,
         pg_catalog.pg_get_userbyid(shared_object.owner_oid) AS owner_name,
         shared_object.object_acl::text AS raw_acl,
         (
           SELECT COALESCE(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'grantee', CASE
                   WHEN exploded.grantee = 0 THEN 'PUBLIC'
                   ELSE pg_catalog.pg_get_userbyid(exploded.grantee)
                 END,
                 'grantor', pg_catalog.pg_get_userbyid(exploded.grantor),
                 'privilege', exploded.privilege_type,
                 'grantable', exploded.is_grantable
               ) ORDER BY exploded.grantee, exploded.grantor,
                          exploded.privilege_type, exploded.is_grantable
             ),
             '[]'::jsonb
           )
             FROM pg_catalog.aclexplode(
               COALESCE(
                 shared_object.object_acl,
                 pg_catalog.acldefault(
                   shared_object.acl_kind, shared_object.owner_oid
                 )
               )
             ) exploded
         ) AS semantic_acl
    FROM shared_object
)
INSERT INTO trailmind_phase1_guard.shared_acl_snapshot(
  object_kind, object_name, owner_name, raw_acl, semantic_acl
)
SELECT object_kind, object_name, owner_name, raw_acl, semantic_acl
  FROM normalized;

WITH preserved_principal AS (
  SELECT role_record.rolname
    FROM pg_catalog.pg_roles role_record
   WHERE role_record.rolname <> ALL(ARRAY[
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
), expected_privilege(object_kind, object_name, privilege_name) AS (
  VALUES
    ('database', pg_catalog.current_database(), 'CONNECT'),
    ('database', pg_catalog.current_database(), 'CREATE'),
    ('database', pg_catalog.current_database(), 'TEMPORARY'),
    ('schema', 'public', 'USAGE'),
    ('schema', 'public', 'CREATE'),
    ('schema', 'extensions', 'USAGE'),
    ('schema', 'extensions', 'CREATE')
)
INSERT INTO trailmind_phase1_guard.shared_acl_principal_snapshot(
  principal_name, object_kind, object_name, privilege_name, effective
)
SELECT principal.rolname,
       privilege.object_kind,
       privilege.object_name,
       privilege.privilege_name,
       CASE privilege.object_kind
         WHEN 'database' THEN pg_catalog.has_database_privilege(
           principal.rolname,
           privilege.object_name,
           privilege.privilege_name
         )
         ELSE pg_catalog.has_schema_privilege(
           principal.rolname,
           privilege.object_name,
           privilege.privilege_name
         )
       END
  FROM preserved_principal principal
 CROSS JOIN expected_privilege privilege;

-- PostGIS is installed directly into the locked schema. The extension is
-- non-relocatable, so public is never an intermediate or fallback location.
CREATE SCHEMA trailmind_gis;
COMMENT ON SCHEMA trailmind_gis IS
  'trailmind:mbvzwsrtqcrwhvykugcd:phase1-v2:pre-foundation';
REVOKE ALL ON SCHEMA trailmind_gis FROM PUBLIC, anon, authenticated, service_role;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA trailmind_gis;

CREATE SCHEMA trailmind_app AUTHORIZATION trailmind_app_owner;
CREATE SCHEMA trailmind_control AUTHORIZATION trailmind_control_owner;

SET LOCAL ROLE trailmind_app_owner;
COMMENT ON SCHEMA trailmind_app IS
  'trailmind:mbvzwsrtqcrwhvykugcd:phase1-v2:pre-foundation';
REVOKE ALL ON SCHEMA trailmind_app FROM PUBLIC, anon, authenticated, service_role;
RESET ROLE;

SET LOCAL ROLE trailmind_control_owner;
COMMENT ON SCHEMA trailmind_control IS
  'trailmind:mbvzwsrtqcrwhvykugcd:phase1-v2:pre-foundation';
REVOKE ALL ON SCHEMA trailmind_control FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA trailmind_control
  TO outdoor_research_cancellation_control_role;
RESET ROLE;

REVOKE ALL ON SCHEMA trailmind_gis FROM
  platform_provisioner,
  migration_role,
  app_security_runtime_role,
  outdoor_research_runtime_role,
  outdoor_research_cancellation_control_role,
  pruner_role,
  readonly_auditor_role;
GRANT USAGE ON SCHEMA trailmind_gis
  TO trailmind_app_owner, regional_import_role, projection_role;
REVOKE CREATE ON SCHEMA trailmind_gis FROM
  trailmind_app_owner,
  platform_provisioner,
  migration_role,
  regional_import_role,
  projection_role,
  app_security_runtime_role,
  outdoor_research_runtime_role,
  outdoor_research_cancellation_control_role,
  pruner_role,
  readonly_auditor_role;

DO $foundation$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_extension extension
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = extension.extnamespace
     WHERE extension.extname = 'postgis'
       AND namespace.nspname = 'trailmind_gis'
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_extension extension
      JOIN pg_catalog.pg_depend dependency
        ON dependency.refobjid = extension.oid
       AND dependency.deptype = 'e'
      JOIN pg_catalog.pg_proc procedure
        ON dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
       AND dependency.objid = procedure.oid
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = procedure.pronamespace
     WHERE extension.extname = 'postgis'
       AND namespace.nspname = 'public'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'PostGIS isolation installation contract failed';
  END IF;

  IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_extension extension
        JOIN pg_catalog.pg_roles extension_owner
          ON extension_owner.oid = extension.extowner
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = extension.extnamespace
        JOIN pg_catalog.pg_roles schema_owner
          ON schema_owner.oid = namespace.nspowner
       WHERE extension.extname = 'postgis'
         AND namespace.nspname = 'trailmind_gis'
         AND schema_owner.rolname = 'postgres'
         AND extension_owner.rolname IN ('postgres', 'supabase_admin')
         AND (
           extension_owner.oid = namespace.nspowner OR
           extension_owner.rolname = 'supabase_admin'
         )
  ) OR EXISTS (
      WITH topology AS (
        SELECT extension.extowner, namespace.oid AS namespace_oid
          FROM pg_catalog.pg_extension extension
          JOIN pg_catalog.pg_namespace namespace
            ON namespace.oid = extension.extnamespace
         WHERE extension.extname = 'postgis'
           AND namespace.nspname = 'trailmind_gis'
      ), owned_objects AS (
        SELECT procedure.proowner AS owner_oid
          FROM topology JOIN pg_catalog.pg_proc procedure
            ON procedure.pronamespace = topology.namespace_oid
        UNION ALL SELECT relation.relowner
          FROM topology JOIN pg_catalog.pg_class relation
            ON relation.relnamespace = topology.namespace_oid
        UNION ALL SELECT type_record.typowner
          FROM topology JOIN pg_catalog.pg_type type_record
            ON type_record.typnamespace = topology.namespace_oid
        UNION ALL SELECT operator_record.oprowner
          FROM topology JOIN pg_catalog.pg_operator operator_record
            ON operator_record.oprnamespace = topology.namespace_oid
        UNION ALL SELECT operator_class.opcowner
          FROM topology JOIN pg_catalog.pg_opclass operator_class
            ON operator_class.opcnamespace = topology.namespace_oid
        UNION ALL SELECT operator_family.opfowner
          FROM topology JOIN pg_catalog.pg_opfamily operator_family
            ON operator_family.opfnamespace = topology.namespace_oid
        UNION ALL SELECT collation_record.collowner
          FROM topology JOIN pg_catalog.pg_collation collation_record
            ON collation_record.collnamespace = topology.namespace_oid
        UNION ALL SELECT conversion_record.conowner
          FROM topology JOIN pg_catalog.pg_conversion conversion_record
            ON conversion_record.connamespace = topology.namespace_oid
        UNION ALL SELECT configuration.cfgowner
          FROM topology JOIN pg_catalog.pg_ts_config configuration
            ON configuration.cfgnamespace = topology.namespace_oid
        UNION ALL SELECT dictionary.dictowner
          FROM topology JOIN pg_catalog.pg_ts_dict dictionary
            ON dictionary.dictnamespace = topology.namespace_oid
      )
      SELECT 1
        FROM owned_objects CROSS JOIN topology
       WHERE owned_objects.owner_oid <> topology.extowner
  ) OR EXISTS (
      SELECT 1
        FROM pg_catalog.pg_namespace namespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(
            namespace.nspacl,
            pg_catalog.acldefault('n', namespace.nspowner)
          )
        ) privilege
       WHERE namespace.nspname = 'trailmind_gis'
         AND privilege.privilege_type = 'CREATE'
         AND privilege.grantee <> namespace.nspowner
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'PostGIS ownership or GIS write boundary is not the reviewed managed topology';
  END IF;
END
$foundation$;

ALTER ROLE migration_role
  SET search_path = trailmind_app, pg_catalog, trailmind_gis, pg_temp;
ALTER ROLE regional_import_role
  SET search_path = pg_catalog, trailmind_app, trailmind_gis, pg_temp;
ALTER ROLE projection_role
  SET search_path = pg_catalog, trailmind_app, trailmind_gis, pg_temp;
ALTER ROLE app_security_runtime_role
  SET search_path = pg_catalog, trailmind_app, pg_temp;
ALTER ROLE outdoor_research_runtime_role
  SET search_path = pg_catalog, trailmind_app, pg_temp;
ALTER ROLE pruner_role
  SET search_path = pg_catalog, trailmind_app, pg_temp;
ALTER ROLE readonly_auditor_role
  SET search_path = pg_catalog, pg_temp;
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

COMMIT;
