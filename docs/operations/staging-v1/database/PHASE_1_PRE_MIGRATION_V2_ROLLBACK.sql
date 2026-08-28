-- Guarded compensation for PHASE_1_PRE_MIGRATION_V2.sql only.
-- LOCAL REVIEW CANDIDATE ONLY. This refuses any applied migration ledger,
-- application object, unexpected GIS/control object, or active TrailMind session.
-- It is not a general foundation rollback and must never remove an applied V2.

BEGIN;

SET LOCAL statement_timeout = '30s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('trailmind-phase-1-foundation', 0)
);

DO $rollback$
DECLARE
  role_name text;
  owner_name text;
BEGIN
  IF pg_catalog.current_database() <> 'postgres' OR
     pg_catalog.current_setting(
       'trailmind.phase_1_v2_rollback_confirmation', true
     ) IS DISTINCT FROM 'mbvzwsrtqcrwhvykugcd:pre-only' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'V2 rollback database/session identity guard failed';
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
    IF pg_catalog.to_regrole(role_name) IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'V2 rollback role identity guard failed';
    END IF;
  END LOOP;

  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles member ON member.oid = membership.member
      JOIN pg_catalog.pg_roles target ON target.oid = membership.roleid
     WHERE member.rolname = ANY(ARRAY[
       'trailmind_app_owner', 'trailmind_control_owner',
       'platform_provisioner', 'migration_role', 'regional_import_role',
       'projection_role', 'app_security_runtime_role',
       'outdoor_research_runtime_role',
       'outdoor_research_cancellation_control_role', 'pruner_role',
       'readonly_auditor_role'
     ]::text[])
        OR target.rolname = ANY(ARRAY[
       'trailmind_app_owner', 'trailmind_control_owner',
       'platform_provisioner', 'migration_role', 'regional_import_role',
       'projection_role', 'app_security_runtime_role',
       'outdoor_research_runtime_role',
       'outdoor_research_cancellation_control_role', 'pruner_role',
       'readonly_auditor_role'
     ]::text[])
  ) <> 16 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles member ON member.oid = membership.member
      JOIN pg_catalog.pg_roles target ON target.oid = membership.roleid
     WHERE (member.rolname = ANY(ARRAY[
              'trailmind_app_owner', 'trailmind_control_owner',
              'platform_provisioner', 'migration_role',
              'regional_import_role', 'projection_role',
              'app_security_runtime_role', 'outdoor_research_runtime_role',
              'outdoor_research_cancellation_control_role', 'pruner_role',
              'readonly_auditor_role'
            ]::text[])
         OR target.rolname = ANY(ARRAY[
              'trailmind_app_owner', 'trailmind_control_owner',
              'platform_provisioner', 'migration_role',
              'regional_import_role', 'projection_role',
              'app_security_runtime_role', 'outdoor_research_runtime_role',
              'outdoor_research_cancellation_control_role', 'pruner_role',
              'readonly_auditor_role'
            ]::text[]))
       AND (member.rolname, target.rolname,
            membership.inherit_option, membership.set_option,
            membership.admin_option) NOT IN (
         ('migration_role', 'trailmind_app_owner', false, true, false),
         ('trailmind_control_owner', 'pg_signal_backend', true, false, false),
         ('postgres', 'trailmind_app_owner', false, false, true),
         ('postgres', 'trailmind_app_owner', false, true, false),
         ('postgres', 'trailmind_control_owner', false, false, true),
         ('postgres', 'trailmind_control_owner', false, true, false),
         ('postgres', 'platform_provisioner', false, false, true),
         ('postgres', 'migration_role', false, false, true),
         ('postgres', 'migration_role', false, true, false),
         ('postgres', 'regional_import_role', false, false, true),
         ('postgres', 'projection_role', false, false, true),
         ('postgres', 'app_security_runtime_role', false, false, true),
         ('postgres', 'outdoor_research_runtime_role', false, false, true),
         ('postgres', 'outdoor_research_cancellation_control_role', false, false, true),
         ('postgres', 'pruner_role', false, false, true),
         ('postgres', 'readonly_auditor_role', false, false, true)
       )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'V2 rollback role membership inventory guard failed';
  END IF;

  FOREACH role_name IN ARRAY ARRAY[
    'trailmind_app',
    'trailmind_control',
    'trailmind_gis',
    'trailmind_phase1_guard'
  ]::text[]
  LOOP
    IF pg_catalog.obj_description(
         pg_catalog.to_regnamespace(role_name), 'pg_namespace'
       ) IS DISTINCT FROM
       (CASE role_name
         WHEN 'trailmind_phase1_guard' THEN
           'trailmind:mbvzwsrtqcrwhvykugcd:phase1-v2:acl-snapshot'
         ELSE 'trailmind:mbvzwsrtqcrwhvykugcd:phase1-v2:pre-foundation'
       END) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'V2 rollback schema receipt guard failed';
    END IF;
  END LOOP;

  SELECT owner.rolname
    INTO owner_name
    FROM pg_catalog.pg_namespace namespace
    JOIN pg_catalog.pg_roles owner ON owner.oid = namespace.nspowner
   WHERE namespace.nspname = 'trailmind_app';
  IF owner_name IS DISTINCT FROM 'trailmind_app_owner' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'V2 rollback application ownership guard failed';
  END IF;

  SELECT owner.rolname
    INTO owner_name
    FROM pg_catalog.pg_namespace namespace
    JOIN pg_catalog.pg_roles owner ON owner.oid = namespace.nspowner
   WHERE namespace.nspname = 'trailmind_control';
  IF owner_name IS DISTINCT FROM 'trailmind_control_owner' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'V2 rollback control ownership guard failed';
  END IF;

  SELECT owner.rolname
    INTO owner_name
    FROM pg_catalog.pg_namespace namespace
    JOIN pg_catalog.pg_roles owner ON owner.oid = namespace.nspowner
   WHERE namespace.nspname = 'trailmind_gis';
  IF owner_name IS DISTINCT FROM CURRENT_USER THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'V2 rollback GIS schema ownership guard failed';
  END IF;

  SELECT owner.rolname
    INTO owner_name
    FROM pg_catalog.pg_namespace namespace
    JOIN pg_catalog.pg_roles owner ON owner.oid = namespace.nspowner
   WHERE namespace.nspname = 'trailmind_phase1_guard';
  IF owner_name IS DISTINCT FROM CURRENT_USER THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'V2 rollback ACL snapshot ownership guard failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_extension extension
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = extension.extnamespace
     WHERE extension.extname = 'postgis'
       AND namespace.nspname = 'trailmind_gis'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'V2 rollback PostGIS identity guard failed';
  END IF;

  IF pg_catalog.obj_description(
       'trailmind_phase1_guard.shared_acl_snapshot'::pg_catalog.regclass,
       'pg_class'
     ) IS DISTINCT FROM
       'trailmind:mbvzwsrtqcrwhvykugcd:phase1-v2:acl-snapshot' OR
     pg_catalog.obj_description(
       'trailmind_phase1_guard.shared_acl_principal_snapshot'::pg_catalog.regclass,
       'pg_class'
     ) IS DISTINCT FROM
       'trailmind:mbvzwsrtqcrwhvykugcd:phase1-v2:acl-principals' OR
     (
       SELECT pg_catalog.count(*)
         FROM trailmind_phase1_guard.shared_acl_snapshot
     ) <> 3 OR EXISTS (
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
    SELECT 1
      FROM normalized current_acl
      FULL JOIN trailmind_phase1_guard.shared_acl_snapshot snapshot
        USING (object_kind, object_name)
     WHERE current_acl.object_kind IS NULL OR snapshot.object_kind IS NULL
        OR current_acl.owner_name IS DISTINCT FROM snapshot.owner_name
        OR current_acl.raw_acl IS DISTINCT FROM snapshot.raw_acl
        OR current_acl.semantic_acl IS DISTINCT FROM snapshot.semantic_acl
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'V2 rollback shared ACL byte/semantic equality guard failed';
  END IF;

  IF EXISTS (
       SELECT 1
         FROM pg_catalog.pg_class relation
         JOIN pg_catalog.pg_namespace namespace
           ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'trailmind_app'
     ) OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc procedure
         JOIN pg_catalog.pg_namespace namespace
           ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'trailmind_app'
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'V2 rollback refuses an application object or migration ledger';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_type data_type
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = data_type.typnamespace
     WHERE namespace.nspname = 'trailmind_app'
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_operator operator_record
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = operator_record.oprnamespace
     WHERE namespace.nspname = 'trailmind_app'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'V2 rollback refuses unexpected application typed objects';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'trailmind_control'
  ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc procedure
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'trailmind_control'
       AND procedure.proname =
         'cancel_active_outdoor_research_backend_integer'
       AND pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
         'target_pid integer'
  ) <> 1 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc procedure
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'trailmind_control'
       AND (
         procedure.proname <>
           'cancel_active_outdoor_research_backend_integer' OR
         pg_catalog.pg_get_function_identity_arguments(procedure.oid) <>
           'target_pid integer'
       )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'V2 rollback refuses unexpected control objects';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_type data_type
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = data_type.typnamespace
     WHERE namespace.nspname = 'trailmind_control'
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_operator operator_record
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = operator_record.oprnamespace
     WHERE namespace.nspname = 'trailmind_control'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'V2 rollback refuses unexpected control typed objects';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(
      relation.relname::text ORDER BY relation.relname::text
    )
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'trailmind_phase1_guard'
       AND relation.relkind IN ('r', 'p')
  ) IS DISTINCT FROM ARRAY[
    'shared_acl_principal_snapshot', 'shared_acl_snapshot'
  ]::text[] OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'trailmind_phase1_guard'
       AND (relation.relname, relation.relkind) NOT IN (
         ('shared_acl_principal_snapshot', 'r'),
         ('shared_acl_principal_snapshot_pkey', 'i'),
         ('shared_acl_snapshot', 'r'),
         ('shared_acl_snapshot_pkey', 'i')
       )
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc procedure
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'trailmind_phase1_guard'
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_type data_type
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = data_type.typnamespace
     WHERE namespace.nspname = 'trailmind_phase1_guard'
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.pg_class expected_relation
          WHERE expected_relation.relnamespace = namespace.oid
            AND expected_relation.relname IN (
              'shared_acl_principal_snapshot', 'shared_acl_snapshot'
            )
            AND (
              expected_relation.reltype = data_type.oid OR
              expected_relation.reltype = data_type.typelem
            )
       )
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_operator operator_record
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = operator_record.oprnamespace
     WHERE namespace.nspname = 'trailmind_phase1_guard'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'V2 rollback refuses unexpected ACL snapshot objects';
  END IF;

  IF EXISTS (
    WITH RECURSIVE postgis_objects(classid, objid) AS (
      SELECT dependency.classid, dependency.objid
        FROM pg_catalog.pg_depend dependency
        JOIN pg_catalog.pg_extension extension
          ON extension.oid = dependency.refobjid
       WHERE extension.extname = 'postgis'
         AND dependency.deptype = 'e'
      UNION
      SELECT dependency.classid, dependency.objid
        FROM pg_catalog.pg_depend dependency
        JOIN postgis_objects parent
          ON parent.classid = dependency.refclassid
         AND parent.objid = dependency.refobjid
    ), gis_objects(classid, objid) AS (
      SELECT 'pg_catalog.pg_class'::pg_catalog.regclass, relation.oid
        FROM pg_catalog.pg_class relation
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'trailmind_gis'
      UNION ALL
      SELECT 'pg_catalog.pg_proc'::pg_catalog.regclass, procedure.oid
        FROM pg_catalog.pg_proc procedure
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'trailmind_gis'
      UNION ALL
      SELECT 'pg_catalog.pg_type'::pg_catalog.regclass, data_type.oid
        FROM pg_catalog.pg_type data_type
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = data_type.typnamespace
       WHERE namespace.nspname = 'trailmind_gis'
      UNION ALL
      SELECT 'pg_catalog.pg_operator'::pg_catalog.regclass, operator.oid
        FROM pg_catalog.pg_operator operator
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = operator.oprnamespace
       WHERE namespace.nspname = 'trailmind_gis'
      UNION ALL
      SELECT 'pg_catalog.pg_opclass'::pg_catalog.regclass, operator_class.oid
        FROM pg_catalog.pg_opclass operator_class
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = operator_class.opcnamespace
       WHERE namespace.nspname = 'trailmind_gis'
      UNION ALL
      SELECT 'pg_catalog.pg_opfamily'::pg_catalog.regclass, operator_family.oid
        FROM pg_catalog.pg_opfamily operator_family
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = operator_family.opfnamespace
       WHERE namespace.nspname = 'trailmind_gis'
      UNION ALL
      SELECT 'pg_catalog.pg_collation'::pg_catalog.regclass, collation_record.oid
        FROM pg_catalog.pg_collation collation_record
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = collation_record.collnamespace
       WHERE namespace.nspname = 'trailmind_gis'
      UNION ALL
      SELECT 'pg_catalog.pg_conversion'::pg_catalog.regclass, conversion_record.oid
        FROM pg_catalog.pg_conversion conversion_record
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = conversion_record.connamespace
       WHERE namespace.nspname = 'trailmind_gis'
    )
    SELECT 1
      FROM gis_objects object
      LEFT JOIN postgis_objects extension_object
        ON extension_object.classid = object.classid
       AND extension_object.objid = object.objid
     WHERE extension_object.objid IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'V2 rollback refuses non-extension GIS objects';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_stat_activity
     WHERE datname = pg_catalog.current_database()
       AND pid <> pg_catalog.pg_backend_pid()
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
      MESSAGE = 'V2 rollback detected an active TrailMind session';
  END IF;
END
$rollback$;

SET LOCAL ROLE trailmind_control_owner;
DROP FUNCTION
  trailmind_control.cancel_active_outdoor_research_backend_integer(integer);
DROP SCHEMA trailmind_control;
RESET ROLE;

SET LOCAL ROLE trailmind_app_owner;
DROP SCHEMA trailmind_app;
RESET ROLE;

DROP EXTENSION postgis;
DROP SCHEMA trailmind_gis;

DROP TABLE trailmind_phase1_guard.shared_acl_principal_snapshot;
DROP TABLE trailmind_phase1_guard.shared_acl_snapshot;
DROP SCHEMA trailmind_phase1_guard;

REVOKE trailmind_app_owner FROM migration_role GRANTED BY CURRENT_USER;
REVOKE trailmind_app_owner FROM CURRENT_USER GRANTED BY CURRENT_USER;
REVOKE trailmind_control_owner FROM CURRENT_USER GRANTED BY CURRENT_USER;
REVOKE migration_role FROM CURRENT_USER GRANTED BY CURRENT_USER;
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

COMMIT;
