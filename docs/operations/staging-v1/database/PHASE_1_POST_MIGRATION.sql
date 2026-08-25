-- TrailMind Outdoor Staging V1 Phase 1 post-migration least-privilege grants.
-- Run only after the exact backend migrations 001-008 have committed in the
-- trailmind_app schema as trailmind_app_owner.

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('trailmind-phase-1-foundation', 0)
);

DO $foundation$
BEGIN
  IF (
    SELECT pg_catalog.array_agg(version ORDER BY version)
      FROM trailmind_app.trailmind_schema_migrations
  ) IS DISTINCT FROM ARRAY[
    '001_app_attest.sql',
    '002_outdoor_evidence.sql',
    '003_outdoor_research_graph.sql',
    '004_osm_outdoor_research_projection.sql',
    '005_outdoor_research_projection_geometry.sql',
    '006_outdoor_route_membership_point_index.sql',
    '007_routable_highlight_access_geography_index.sql',
    '008_outdoor_research_runtime_read_contract.sql'
  ]::text[] THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'TrailMind canonical migration ledger is incomplete or reordered';
  END IF;
END
$foundation$;

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
REVOKE CREATE ON SCHEMA trailmind_control FROM PUBLIC, anon, authenticated, service_role;
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

