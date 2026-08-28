-- TrailMind Outdoor Staging V1 Phase 1 Supabase PostGIS-isolation V2 post-step.
-- LOCAL REVIEW CANDIDATE ONLY: this turn did not authorize remote execution.
-- Run only after the exact V2 policy 001-007 + 009 has committed in
-- trailmind_app as trailmind_app_owner. Never pair this with historical 008.

BEGIN;

SET LOCAL statement_timeout = '30s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('trailmind-phase-1-foundation', 0)
);

DO $foundation$
BEGIN
  IF session_user <> 'postgres' OR current_user <> 'postgres' OR
     NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_roles role_record
        WHERE role_record.rolname = current_user
          AND NOT role_record.rolsuper
          AND role_record.rolcreaterole
          AND NOT role_record.rolreplication
          AND NOT role_record.rolbypassrls
     ) OR (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_auth_members membership
         JOIN pg_catalog.pg_roles member ON member.oid = membership.member
         JOIN pg_catalog.pg_roles target ON target.oid = membership.roleid
        WHERE member.rolname = current_user
          AND target.rolname IN (
            'trailmind_app_owner', 'trailmind_control_owner'
          )
          AND NOT membership.inherit_option
          AND NOT membership.set_option
          AND membership.admin_option
     ) <> 2 OR (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_auth_members membership
         JOIN pg_catalog.pg_roles member ON member.oid = membership.member
         JOIN pg_catalog.pg_roles target ON target.oid = membership.roleid
        WHERE member.rolname = current_user
          AND target.rolname IN (
            'trailmind_app_owner', 'trailmind_control_owner'
          )
          AND NOT membership.inherit_option
          AND membership.set_option
          AND NOT membership.admin_option
     ) <> 2 OR NOT pg_catalog.pg_has_role(
       current_user, 'migration_role', 'SET'
     ) OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_namespace namespace
         JOIN pg_catalog.pg_roles owner ON owner.oid = namespace.nspowner
        WHERE namespace.nspname = 'trailmind_app'
          AND owner.rolname = 'trailmind_app_owner'
     ) OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_namespace namespace
         JOIN pg_catalog.pg_roles owner ON owner.oid = namespace.nspowner
        WHERE namespace.nspname = 'trailmind_control'
          AND owner.rolname = 'trailmind_control_owner'
     ) OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_namespace namespace
        WHERE namespace.nspname IN ('trailmind_gis', 'trailmind_phase1_guard')
          AND pg_catalog.pg_get_userbyid(namespace.nspowner) = current_user
        GROUP BY pg_catalog.pg_get_userbyid(namespace.nspowner)
       HAVING pg_catalog.count(*) = 2
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'TrailMind V2 post-step operator/owner transition guard failed';
  END IF;
END
$foundation$;

SET LOCAL ROLE trailmind_app_owner;
SET LOCAL search_path = trailmind_app, pg_catalog, trailmind_gis, pg_temp;

DO $foundation$
BEGIN
  IF session_user = current_user OR current_user <> 'trailmind_app_owner' OR
     pg_catalog.replace(
       pg_catalog.replace(current_setting('search_path'), ' ', ''), '"', ''
     ) <> 'trailmind_app,pg_catalog,trailmind_gis,pg_temp' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'TrailMind V2 post-step application-owner transition failed';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(version ORDER BY applied_at, version)
      FROM trailmind_app.trailmind_schema_migrations
  ) IS DISTINCT FROM ARRAY[
    '001_app_attest.sql',
    '002_outdoor_evidence.sql',
    '003_outdoor_research_graph.sql',
    '004_osm_outdoor_research_projection.sql',
    '005_outdoor_research_projection_geometry.sql',
    '006_outdoor_route_membership_point_index.sql',
    '007_routable_highlight_access_geography_index.sql',
    '009_supabase_postgis_isolated_runtime_read_contract.sql'
  ]::text[] THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'TrailMind canonical migration ledger is incomplete or reordered';
  END IF;
END
$foundation$;

RESET ROLE;

DO $foundation$
BEGIN
  IF (
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
      MESSAGE = 'TrailMind V2 shared ACL changed after the pre-step snapshot';
  END IF;
END
$foundation$;

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
  ) OR NOT EXISTS (
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
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_namespace namespace
      JOIN pg_catalog.pg_roles candidate
        ON candidate.oid <> namespace.nspowner
       AND NOT candidate.rolsuper
       AND pg_catalog.pg_has_role(
             candidate.oid, namespace.nspowner, 'SET'
           )
     WHERE namespace.nspname = 'trailmind_gis'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'V2 PostGIS isolation, ownership, or GIS write boundary is invalid';
  END IF;
END
$foundation$;

DO $foundation$
DECLARE
  preserved record;
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC',
    pg_catalog.current_database()
  );
  REVOKE USAGE, CREATE ON SCHEMA public FROM PUBLIC;
  REVOKE USAGE, CREATE ON SCHEMA extensions FROM PUBLIC;

  FOR preserved IN
    SELECT principal_name, object_kind, object_name, privilege_name
      FROM trailmind_phase1_guard.shared_acl_principal_snapshot
     WHERE effective
       AND (
         (object_kind = 'database' AND privilege_name = 'TEMPORARY') OR
         (object_kind = 'schema' AND privilege_name IN ('USAGE', 'CREATE'))
       )
     ORDER BY object_kind, object_name, principal_name, privilege_name
  LOOP
    IF preserved.object_kind = 'database' THEN
      EXECUTE pg_catalog.format(
        'GRANT TEMPORARY ON DATABASE %I TO %I',
        pg_catalog.current_database(), preserved.principal_name
      );
    ELSE
      EXECUTE pg_catalog.format(
        'GRANT %s ON SCHEMA %I TO %I',
        preserved.privilege_name,
        preserved.object_name,
        preserved.principal_name
      );
    END IF;
  END LOOP;

  EXECUTE pg_catalog.format(
    'GRANT CREATE ON DATABASE %I TO regional_import_role',
    pg_catalog.current_database()
  );
END
$foundation$;

REVOKE USAGE, CREATE ON SCHEMA public FROM
  platform_provisioner,
  migration_role,
  regional_import_role,
  projection_role,
  app_security_runtime_role,
  outdoor_research_runtime_role,
  outdoor_research_cancellation_control_role,
  pruner_role,
  readonly_auditor_role;
REVOKE USAGE, CREATE ON SCHEMA extensions FROM
  platform_provisioner,
  migration_role,
  regional_import_role,
  projection_role,
  app_security_runtime_role,
  outdoor_research_runtime_role,
  outdoor_research_cancellation_control_role,
  pruner_role,
  readonly_auditor_role;

REVOKE USAGE, CREATE ON SCHEMA public FROM PUBLIC;
REVOKE USAGE, CREATE ON SCHEMA public FROM
  platform_provisioner,
  migration_role,
  regional_import_role,
  projection_role,
  app_security_runtime_role,
  outdoor_research_runtime_role,
  outdoor_research_cancellation_control_role,
  pruner_role,
  readonly_auditor_role;

REVOKE ALL ON SCHEMA trailmind_gis
  FROM PUBLIC, anon, authenticated, service_role;
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
REVOKE CREATE ON SCHEMA trailmind_gis
  FROM trailmind_app_owner, regional_import_role, projection_role;

SET LOCAL ROLE trailmind_app_owner;
SET LOCAL search_path = pg_catalog, trailmind_app, trailmind_gis, pg_temp;

ALTER DEFAULT PRIVILEGES IN SCHEMA trailmind_app
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA trailmind_app
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA trailmind_app
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

REVOKE ALL ON SCHEMA trailmind_app FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA trailmind_app
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA trailmind_app
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA trailmind_app
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON ALL TABLES IN SCHEMA trailmind_app FROM
  platform_provisioner,
  migration_role,
  regional_import_role,
  projection_role,
  app_security_runtime_role,
  outdoor_research_runtime_role,
  outdoor_research_cancellation_control_role,
  pruner_role,
  readonly_auditor_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA trailmind_app FROM
  platform_provisioner,
  migration_role,
  regional_import_role,
  projection_role,
  app_security_runtime_role,
  outdoor_research_runtime_role,
  outdoor_research_cancellation_control_role,
  pruner_role,
  readonly_auditor_role;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA trailmind_app FROM
  platform_provisioner,
  migration_role,
  regional_import_role,
  projection_role,
  app_security_runtime_role,
  outdoor_research_runtime_role,
  outdoor_research_cancellation_control_role,
  pruner_role,
  readonly_auditor_role;

GRANT USAGE ON SCHEMA trailmind_app TO
  regional_import_role,
  projection_role,
  app_security_runtime_role,
  outdoor_research_runtime_role,
  pruner_role;

GRANT SELECT, INSERT, UPDATE ON
  trailmind_app.app_attest_challenges,
  trailmind_app.app_attest_keys,
  trailmind_app.app_attest_route_sessions,
  trailmind_app.app_attest_rate_windows,
  trailmind_app.app_attest_provider_leases
  TO app_security_runtime_role;
GRANT INSERT ON trailmind_app.app_attest_request_ids
  TO app_security_runtime_role;

GRANT DELETE ON
  trailmind_app.app_attest_challenges,
  trailmind_app.app_attest_route_sessions,
  trailmind_app.app_attest_rate_windows,
  trailmind_app.app_attest_provider_leases
  TO pruner_role;

GRANT SELECT, INSERT ON
  trailmind_app.outdoor_evidence_pois,
  trailmind_app.outdoor_evidence_trail_segments,
  trailmind_app.outdoor_evidence_hiking_relations,
  trailmind_app.outdoor_evidence_hiking_relation_members
  TO regional_import_role;
GRANT SELECT, INSERT, UPDATE ON
  trailmind_app.outdoor_evidence_imports,
  trailmind_app.outdoor_evidence_regions
  TO regional_import_role;

GRANT SELECT ON
  trailmind_app.outdoor_evidence_imports,
  trailmind_app.outdoor_evidence_regions,
  trailmind_app.outdoor_evidence_pois,
  trailmind_app.outdoor_evidence_trail_segments,
  trailmind_app.outdoor_evidence_hiking_relations,
  trailmind_app.outdoor_evidence_hiking_relation_members
  TO projection_role;

GRANT SELECT, INSERT, UPDATE ON
  trailmind_app.outdoor_research_sources,
  trailmind_app.outdoor_research_source_authority_scopes,
  trailmind_app.outdoor_research_source_policies,
  trailmind_app.outdoor_research_source_policy_scopes,
  trailmind_app.outdoor_research_source_policy_relationship_scopes,
  trailmind_app.outdoor_research_entities,
  trailmind_app.outdoor_research_source_entities,
  trailmind_app.outdoor_research_osm_entity_identities,
  trailmind_app.outdoor_research_projection_runs,
  trailmind_app.outdoor_research_projection_entities,
  trailmind_app.outdoor_research_projection_assertions,
  trailmind_app.outdoor_research_projection_relationships,
  trailmind_app.outdoor_research_projection_quarantines
  TO projection_role;
GRANT SELECT, INSERT ON
  trailmind_app.outdoor_research_assertions,
  trailmind_app.outdoor_research_relationships
  TO projection_role;
GRANT SELECT ON
  trailmind_app.outdoor_research_active_projection_runs,
  trailmind_app.outdoor_research_active_assertions,
  trailmind_app.outdoor_research_active_relationships,
  trailmind_app.outdoor_research_active_entities,
  trailmind_app.outdoor_research_active_source_entities
  TO projection_role;
GRANT EXECUTE ON FUNCTION
  trailmind_app.outdoor_research_deterministic_uuid_v3(text, text)
  TO projection_role;

ALTER VIEW trailmind_app.outdoor_research_active_projection_runs
  SET (security_invoker = true);
ALTER VIEW trailmind_app.outdoor_research_active_assertions
  SET (security_invoker = true);
ALTER VIEW trailmind_app.outdoor_research_active_relationships
  SET (security_invoker = true);
ALTER VIEW trailmind_app.outdoor_research_active_entities
  SET (security_invoker = true);
ALTER VIEW trailmind_app.outdoor_research_active_source_entities
  SET (security_invoker = true);

GRANT EXECUTE ON FUNCTION
  trailmind_app.trailmind_runtime_outdoor_research_snapshot_context_v1(
    text, double precision, double precision
  ),
  trailmind_app.trailmind_runtime_outdoor_research_highlights_v1(
    uuid, text, double precision, double precision, text[], double precision,
    text[], integer, double precision
  ),
  trailmind_app.trailmind_runtime_outdoor_research_route_memberships_v1(
    uuid, text, double precision, double precision, double precision, integer,
    integer
  ),
  trailmind_app.trailmind_runtime_outdoor_research_route_assertions_v1(
    uuid, uuid[], text[], integer
  ),
  trailmind_app.trailmind_runtime_outdoor_research_trail_access_candidates_v1(
    uuid, text, uuid[], double precision, integer, text[], text[], integer
  )
  TO outdoor_research_runtime_role;

DO $foundation$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'app_attest_challenges',
    'app_attest_keys',
    'app_attest_route_sessions',
    'app_attest_request_ids',
    'app_attest_rate_windows',
    'app_attest_provider_leases'
  ]::text[]
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS app_security_runtime_select ON trailmind_app.%I',
      table_name
    );
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS app_security_runtime_insert ON trailmind_app.%I',
      table_name
    );
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS app_security_runtime_update ON trailmind_app.%I',
      table_name
    );
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS pruner_delete ON trailmind_app.%I',
      table_name
    );
  END LOOP;
END
$foundation$;

CREATE POLICY app_security_runtime_select
  ON trailmind_app.app_attest_challenges FOR SELECT
  TO app_security_runtime_role USING (true);
CREATE POLICY app_security_runtime_insert
  ON trailmind_app.app_attest_challenges FOR INSERT
  TO app_security_runtime_role WITH CHECK (true);
CREATE POLICY app_security_runtime_update
  ON trailmind_app.app_attest_challenges FOR UPDATE
  TO app_security_runtime_role USING (true) WITH CHECK (true);
CREATE POLICY pruner_delete
  ON trailmind_app.app_attest_challenges FOR DELETE
  TO pruner_role USING (true);

CREATE POLICY app_security_runtime_select
  ON trailmind_app.app_attest_keys FOR SELECT
  TO app_security_runtime_role USING (true);
CREATE POLICY app_security_runtime_insert
  ON trailmind_app.app_attest_keys FOR INSERT
  TO app_security_runtime_role WITH CHECK (true);
CREATE POLICY app_security_runtime_update
  ON trailmind_app.app_attest_keys FOR UPDATE
  TO app_security_runtime_role USING (true) WITH CHECK (true);

CREATE POLICY app_security_runtime_select
  ON trailmind_app.app_attest_route_sessions FOR SELECT
  TO app_security_runtime_role USING (true);
CREATE POLICY app_security_runtime_insert
  ON trailmind_app.app_attest_route_sessions FOR INSERT
  TO app_security_runtime_role WITH CHECK (true);
CREATE POLICY app_security_runtime_update
  ON trailmind_app.app_attest_route_sessions FOR UPDATE
  TO app_security_runtime_role USING (true) WITH CHECK (true);
CREATE POLICY pruner_delete
  ON trailmind_app.app_attest_route_sessions FOR DELETE
  TO pruner_role USING (true);

CREATE POLICY app_security_runtime_insert
  ON trailmind_app.app_attest_request_ids FOR INSERT
  TO app_security_runtime_role WITH CHECK (true);

CREATE POLICY app_security_runtime_select
  ON trailmind_app.app_attest_rate_windows FOR SELECT
  TO app_security_runtime_role USING (true);
CREATE POLICY app_security_runtime_insert
  ON trailmind_app.app_attest_rate_windows FOR INSERT
  TO app_security_runtime_role WITH CHECK (true);
CREATE POLICY app_security_runtime_update
  ON trailmind_app.app_attest_rate_windows FOR UPDATE
  TO app_security_runtime_role USING (true) WITH CHECK (true);
CREATE POLICY pruner_delete
  ON trailmind_app.app_attest_rate_windows FOR DELETE
  TO pruner_role USING (true);

CREATE POLICY app_security_runtime_select
  ON trailmind_app.app_attest_provider_leases FOR SELECT
  TO app_security_runtime_role USING (true);
CREATE POLICY app_security_runtime_insert
  ON trailmind_app.app_attest_provider_leases FOR INSERT
  TO app_security_runtime_role WITH CHECK (true);
CREATE POLICY app_security_runtime_update
  ON trailmind_app.app_attest_provider_leases FOR UPDATE
  TO app_security_runtime_role USING (true) WITH CHECK (true);
CREATE POLICY pruner_delete
  ON trailmind_app.app_attest_provider_leases FOR DELETE
  TO pruner_role USING (true);

DO $foundation$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'outdoor_evidence_imports',
    'outdoor_evidence_regions',
    'outdoor_evidence_pois',
    'outdoor_evidence_trail_segments',
    'outdoor_evidence_hiking_relations',
    'outdoor_evidence_hiking_relation_members'
  ]::text[]
  LOOP
    EXECUTE pg_catalog.format(
      'CREATE POLICY regional_import_all ON trailmind_app.%I FOR ALL TO regional_import_role USING (true) WITH CHECK (true)',
      table_name
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY projection_read ON trailmind_app.%I FOR SELECT TO projection_role USING (true)',
      table_name
    );
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY[
    'outdoor_research_sources',
    'outdoor_research_source_authority_scopes',
    'outdoor_research_source_policies',
    'outdoor_research_source_policy_scopes',
    'outdoor_research_source_policy_relationship_scopes',
    'outdoor_research_entities',
    'outdoor_research_source_entities',
    'outdoor_research_assertions',
    'outdoor_research_relationships',
    'outdoor_research_osm_entity_identities',
    'outdoor_research_projection_runs',
    'outdoor_research_projection_entities',
    'outdoor_research_projection_assertions',
    'outdoor_research_projection_relationships',
    'outdoor_research_projection_quarantines'
  ]::text[]
  LOOP
    EXECUTE pg_catalog.format(
      'CREATE POLICY projection_all ON trailmind_app.%I FOR ALL TO projection_role USING (true) WITH CHECK (true)',
      table_name
    );
  END LOOP;
END
$foundation$;

REVOKE CREATE ON SCHEMA trailmind_app FROM PUBLIC, anon, authenticated, service_role;
REVOKE CREATE ON SCHEMA trailmind_app FROM
  platform_provisioner,
  migration_role,
  regional_import_role,
  projection_role,
  app_security_runtime_role,
  outdoor_research_runtime_role,
  outdoor_research_cancellation_control_role,
  pruner_role,
  readonly_auditor_role;

RESET ROLE;

SET LOCAL ROLE trailmind_control_owner;
SET LOCAL search_path = pg_catalog, trailmind_control, pg_temp;

DO $foundation$
BEGIN
  IF session_user = current_user OR current_user <> 'trailmind_control_owner' OR
     pg_catalog.replace(
       pg_catalog.replace(current_setting('search_path'), ' ', ''), '"', ''
     ) <> 'pg_catalog,trailmind_control,pg_temp' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'TrailMind V2 post-step control-owner transition failed';
  END IF;
END
$foundation$;

ALTER DEFAULT PRIVILEGES IN SCHEMA trailmind_control
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE CREATE ON SCHEMA trailmind_control
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE CREATE ON SCHEMA trailmind_control FROM
  platform_provisioner,
  migration_role,
  regional_import_role,
  projection_role,
  app_security_runtime_role,
  outdoor_research_runtime_role,
  outdoor_research_cancellation_control_role,
  pruner_role,
  readonly_auditor_role;

RESET ROLE;

DO $foundation$
DECLARE
  denied_role text;
  shared_denied_role text;
  allowed_role text;
BEGIN
  FOREACH denied_role IN ARRAY ARRAY[
    'public',
    'anon',
    'authenticated',
    'service_role',
    'platform_provisioner',
    'migration_role',
    'app_security_runtime_role',
    'outdoor_research_runtime_role',
    'outdoor_research_cancellation_control_role',
    'pruner_role',
    'readonly_auditor_role'
  ]::text[]
  LOOP
    IF pg_catalog.has_schema_privilege(denied_role, 'trailmind_gis', 'USAGE') OR
       pg_catalog.has_schema_privilege(denied_role, 'trailmind_gis', 'CREATE') OR
       pg_catalog.has_schema_privilege(denied_role, 'trailmind_gis', 'USAGE WITH GRANT OPTION') THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = denied_role || ' has forbidden trailmind_gis privileges';
    END IF;
  END LOOP;

  FOREACH shared_denied_role IN ARRAY ARRAY[
    'public',
    'platform_provisioner',
    'migration_role',
    'regional_import_role',
    'projection_role',
    'app_security_runtime_role',
    'outdoor_research_runtime_role',
    'outdoor_research_cancellation_control_role',
    'pruner_role',
    'readonly_auditor_role',
    'trailmind_app_owner'
  ]::text[]
  LOOP
    IF pg_catalog.has_schema_privilege(
         shared_denied_role, 'public', 'USAGE'
       ) OR pg_catalog.has_schema_privilege(
         shared_denied_role, 'public', 'CREATE'
       ) OR pg_catalog.has_schema_privilege(
         shared_denied_role, 'extensions', 'USAGE'
       ) OR pg_catalog.has_schema_privilege(
         shared_denied_role, 'extensions', 'CREATE'
       ) OR pg_catalog.has_database_privilege(
         shared_denied_role, pg_catalog.current_database(), 'TEMPORARY'
       ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = shared_denied_role ||
          ' has forbidden shared-schema or temporary capability';
    END IF;
  END LOOP;

  FOREACH allowed_role IN ARRAY ARRAY[
    'trailmind_app_owner',
    'regional_import_role',
    'projection_role'
  ]::text[]
  LOOP
    IF NOT pg_catalog.has_schema_privilege(allowed_role, 'trailmind_gis', 'USAGE') OR
       pg_catalog.has_schema_privilege(allowed_role, 'trailmind_gis', 'CREATE') OR
       pg_catalog.has_schema_privilege(allowed_role, 'trailmind_gis', 'USAGE WITH GRANT OPTION') THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = allowed_role || ' GIS privilege boundary is invalid';
    END IF;
  END LOOP;

END
$foundation$;

SET LOCAL ROLE trailmind_app_owner;
SET LOCAL search_path = pg_catalog, trailmind_app, trailmind_gis, pg_temp;

DO $foundation$
DECLARE
  expected_function regprocedure;
BEGIN
  FOREACH expected_function IN ARRAY ARRAY[
    'trailmind_app.trailmind_runtime_outdoor_research_snapshot_context_v1(text,double precision,double precision)'::regprocedure,
    'trailmind_app.trailmind_runtime_outdoor_research_highlights_v1(uuid,text,double precision,double precision,text[],double precision,text[],integer,double precision)'::regprocedure,
    'trailmind_app.trailmind_runtime_outdoor_research_route_memberships_v1(uuid,text,double precision,double precision,double precision,integer,integer)'::regprocedure,
    'trailmind_app.trailmind_runtime_outdoor_research_route_assertions_v1(uuid,uuid[],text[],integer)'::regprocedure,
    'trailmind_app.trailmind_runtime_outdoor_research_trail_access_candidates_v1(uuid,text,uuid[],double precision,integer,text[],text[],integer)'::regprocedure
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc procedure
       WHERE procedure.oid = expected_function
         AND procedure.prosecdef
         AND 'search_path=pg_catalog,trailmind_app,trailmind_gis,pg_temp' =
             ANY(procedure.proconfig)
         AND pg_catalog.has_function_privilege(
           'outdoor_research_runtime_role', procedure.oid, 'EXECUTE'
         )
         AND NOT pg_catalog.has_function_privilege(
           'outdoor_research_runtime_role', procedure.oid, 'EXECUTE WITH GRANT OPTION'
         )
         AND NOT pg_catalog.has_function_privilege(
           'public', procedure.oid, 'EXECUTE'
         )
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'outdoor runtime function boundary is invalid';
    END IF;
  END LOOP;
END
$foundation$;

RESET ROLE;

DO $foundation$
DECLARE
  expected record;
  actual boolean;
BEGIN
  FOR expected IN
    SELECT principal_name, object_kind, object_name,
           privilege_name, effective
      FROM trailmind_phase1_guard.shared_acl_principal_snapshot
     ORDER BY principal_name, object_kind, object_name, privilege_name
  LOOP
    IF pg_catalog.to_regrole(expected.principal_name) IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'TrailMind V2 provider-principal preservation failed';
    END IF;
    IF expected.object_kind = 'database' THEN
      actual := pg_catalog.has_database_privilege(
        expected.principal_name,
        expected.object_name,
        expected.privilege_name
      );
    ELSE
      actual := pg_catalog.has_schema_privilege(
        expected.principal_name,
        expected.object_name,
        expected.privilege_name
      );
    END IF;
    IF actual IS DISTINCT FROM expected.effective THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'TrailMind V2 provider effective ACL preservation failed';
    END IF;
  END LOOP;
END
$foundation$;

DROP TABLE trailmind_phase1_guard.shared_acl_principal_snapshot;
DROP TABLE trailmind_phase1_guard.shared_acl_snapshot;
DROP SCHEMA trailmind_phase1_guard;

-- Retain the exact PostgreSQL 17 managed CREATEROLE creator memberships.
-- Bootstrap ADMIN rows remain unchanged. Separate self-granted SET-only rows
-- permit bounded transitions to the two owners and migration_role; postgres
-- cannot assume any other operational identity.
DO $foundation$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles member ON member.oid = membership.member
      JOIN pg_catalog.pg_roles target ON target.oid = membership.roleid
     WHERE member.rolname = 'postgres'
       AND target.rolname IN (
         'trailmind_app_owner', 'trailmind_control_owner'
       )
       AND NOT membership.inherit_option
       AND NOT membership.set_option
       AND membership.admin_option
  ) <> 2 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles member ON member.oid = membership.member
      JOIN pg_catalog.pg_roles target ON target.oid = membership.roleid
     WHERE member.rolname = 'postgres'
       AND target.rolname IN (
         'trailmind_app_owner', 'trailmind_control_owner'
       )
       AND NOT membership.inherit_option
       AND membership.set_option
       AND NOT membership.admin_option
  ) <> 2 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles member ON member.oid = membership.member
      JOIN pg_catalog.pg_roles target ON target.oid = membership.roleid
     WHERE member.rolname = 'postgres'
       AND target.rolname = ANY(ARRAY[
         'platform_provisioner', 'migration_role', 'regional_import_role',
         'projection_role', 'app_security_runtime_role',
         'outdoor_research_runtime_role',
         'outdoor_research_cancellation_control_role', 'pruner_role',
         'readonly_auditor_role'
       ]::text[])
       AND NOT membership.inherit_option
       AND NOT membership.set_option
       AND membership.admin_option
  ) <> 9 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles member ON member.oid = membership.member
      JOIN pg_catalog.pg_roles target ON target.oid = membership.roleid
     WHERE member.rolname = 'postgres'
       AND target.rolname = 'migration_role'
       AND NOT membership.inherit_option
       AND membership.set_option
       AND NOT membership.admin_option
  ) <> 1 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles member ON member.oid = membership.member
      JOIN pg_catalog.pg_roles target ON target.oid = membership.roleid
     WHERE member.rolname = 'postgres'
       AND target.rolname = ANY(ARRAY[
         'trailmind_app_owner', 'trailmind_control_owner',
         'platform_provisioner', 'migration_role', 'regional_import_role',
         'projection_role', 'app_security_runtime_role',
         'outdoor_research_runtime_role',
         'outdoor_research_cancellation_control_role', 'pruner_role',
         'readonly_auditor_role'
       ]::text[])
       AND NOT (
         (target.rolname IN (
           'trailmind_app_owner', 'trailmind_control_owner'
         ) AND NOT membership.inherit_option AND (
           (NOT membership.set_option AND membership.admin_option) OR
           (membership.set_option AND NOT membership.admin_option)
         ))
         OR
         (target.rolname = ANY(ARRAY[
           'platform_provisioner', 'migration_role', 'regional_import_role',
           'projection_role', 'app_security_runtime_role',
           'outdoor_research_runtime_role',
           'outdoor_research_cancellation_control_role', 'pruner_role',
           'readonly_auditor_role'
         ]::text[]) AND NOT membership.inherit_option AND (
           (NOT membership.set_option AND membership.admin_option) OR
           (target.rolname = 'migration_role'
             AND membership.set_option AND NOT membership.admin_option)
         ))
       )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'TrailMind V2 post-step final owner memberships are not bounded';
  END IF;
END
$foundation$;

COMMIT;
