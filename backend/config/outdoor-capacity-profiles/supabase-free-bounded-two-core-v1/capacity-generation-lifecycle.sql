-- Explicit, staging-only capacity lifecycle for the bounded two-core profile.
-- Apply only after the exact 001-007, 009, 010 migration ledger and the
-- reviewed Phase 1 V2 post-step. This file is not a migration and is never
-- applied implicitly by the importer or projector.
--
-- Rollback (only before the profile contains data): drop the two functions and
-- contract table created below, then restore outdoor_research_reject_audit_mutation
-- from migration 003. Never run that rollback against a populated profile.

BEGIN;

SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('trailmind-capacity-profile-foundation-v1', 0)
);

DO $profile$
BEGIN
  IF session_user <> 'postgres' OR current_user <> 'postgres' OR
     NOT pg_catalog.pg_has_role(
       current_user, 'trailmind_app_owner', 'SET'
     ) OR (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_roles role_record
        WHERE role_record.rolname IN (
          'regional_import_role', 'projection_role', 'trailmind_app_owner'
        )
     ) <> 3 THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Capacity profile lifecycle operator/role guard failed';
  END IF;
END
$profile$;

SET LOCAL ROLE trailmind_app_owner;
SET LOCAL search_path = trailmind_app, pg_catalog, trailmind_gis, pg_temp;

DO $profile$
BEGIN
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
    '009_supabase_postgis_isolated_runtime_read_contract.sql',
    '010_bounded_outdoor_import_schema_provisioning.sql'
  ]::text[] THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Capacity profile migration identity is incomplete or reordered';
  END IF;
END
$profile$;

CREATE TABLE IF NOT EXISTS trailmind_app.outdoor_capacity_profile_contracts (
  profile_id text PRIMARY KEY CHECK (
    profile_id = 'supabase-free-bounded-two-core-v1'
  ),
  profile_identity_sha256 text NOT NULL CHECK (
    profile_identity_sha256 ~ '^[a-f0-9]{64}$'
  ),
  maximum_retained_generations integer NOT NULL CHECK (
    maximum_retained_generations = 2
  ),
  hard_limit_bytes bigint NOT NULL CHECK (hard_limit_bytes = 500000000),
  safety_reserve_bytes bigint NOT NULL CHECK (safety_reserve_bytes = 40000000),
  installed_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

ALTER TABLE trailmind_app.outdoor_capacity_profile_contracts
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE trailmind_app.outdoor_capacity_profile_contracts
  FROM PUBLIC, anon, authenticated, service_role, regional_import_role,
       projection_role, outdoor_research_runtime_role;

INSERT INTO trailmind_app.outdoor_capacity_profile_contracts (
  profile_id,
  profile_identity_sha256,
  maximum_retained_generations,
  hard_limit_bytes,
  safety_reserve_bytes
) VALUES (
  'supabase-free-bounded-two-core-v1',
  'c5da9580a96eba5d18aeb8f8346926c016b71b8fd2340002529a1cb03c7e2afc',
  2,
  500000000,
  40000000
)
ON CONFLICT (profile_id) DO NOTHING;

DO $profile$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM trailmind_app.outdoor_capacity_profile_contracts contract
     WHERE contract.profile_id = 'supabase-free-bounded-two-core-v1'
       AND contract.profile_identity_sha256 = 'c5da9580a96eba5d18aeb8f8346926c016b71b8fd2340002529a1cb03c7e2afc'
       AND contract.maximum_retained_generations = 2
       AND contract.hard_limit_bytes = 500000000
       AND contract.safety_reserve_bytes = 40000000
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Capacity profile contract identity mismatch';
  END IF;
END
$profile$;

-- Once this profile is installed, bounded import/projection generation rows
-- can be created or advanced only by the connection holding the reviewed
-- capacity lease. The trigger also makes the two-generation ceiling a database
-- invariant instead of relying only on the operator CLI.
CREATE OR REPLACE FUNCTION
  trailmind_app.outdoor_capacity_enforce_generation_admission_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  contract trailmind_app.outdoor_capacity_profile_contracts%ROWTYPE;
  capacity_lock_id bigint := pg_catalog.hashtextextended(
    'trailmind-capacity-profile:supabase-free-bounded-two-core-v1', 0
  );
  operation text;
  other_generations integer;
  expected_context text;
BEGIN
  IF TG_OP NOT IN ('INSERT', 'UPDATE') OR TG_TABLE_SCHEMA <> 'trailmind_app' OR
     TG_TABLE_NAME NOT IN (
       'outdoor_evidence_imports', 'outdoor_research_projection_runs'
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Capacity generation admission trigger context is invalid';
  END IF;
  IF NEW.region_id NOT IN ('harz-v1', 'innsbruck-alps-v1') THEN
    RETURN NEW;
  END IF;

  SELECT profile.*
    INTO contract
    FROM trailmind_app.outdoor_capacity_profile_contracts profile
   WHERE profile.profile_id = 'supabase-free-bounded-two-core-v1';
  IF NOT FOUND OR
     contract.profile_identity_sha256 <>
       'c5da9580a96eba5d18aeb8f8346926c016b71b8fd2340002529a1cb03c7e2afc' OR
     contract.maximum_retained_generations <> 2 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Capacity generation profile identity is invalid';
  END IF;

  IF TG_TABLE_NAME = 'outdoor_evidence_imports' THEN
    operation := 'import';
    IF session_user <> 'regional_import_role' THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'Capacity import generation role is invalid';
    END IF;
    SELECT pg_catalog.count(*)::integer
      INTO other_generations
      FROM trailmind_app.outdoor_evidence_imports import_record
     WHERE import_record.region_id = NEW.region_id
       AND import_record.status <> 'failed'
       AND import_record.import_id <> NEW.import_id;
  ELSE
    operation := 'project';
    IF session_user <> 'projection_role' THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'Capacity projection generation role is invalid';
    END IF;
    SELECT pg_catalog.count(*)::integer
      INTO other_generations
      FROM trailmind_app.outdoor_research_projection_runs run
     WHERE run.region_id = NEW.region_id
       AND run.status <> 'failed'
       AND run.projection_run_id <> NEW.projection_run_id;
  END IF;

  expected_context := contract.profile_identity_sha256 || ':' ||
    NEW.region_id || ':' || operation;
  IF pg_catalog.current_setting(
       'trailmind.capacity_admission_v1', true
     ) IS DISTINCT FROM expected_context OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_locks held_lock
        WHERE held_lock.locktype = 'advisory'
          AND held_lock.pid = pg_catalog.pg_backend_pid()
          AND held_lock.mode = 'ExclusiveLock'
          AND held_lock.granted
          AND held_lock.classid =
            ((capacity_lock_id >> 32) & 4294967295)::oid
          AND held_lock.objid = (capacity_lock_id & 4294967295)::oid
          AND held_lock.objsubid = 1
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Capacity generation mutation lacks an admitted lease';
  END IF;

  IF NEW.status <> 'failed' AND
     other_generations >= contract.maximum_retained_generations THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Capacity generation limit reached';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION
  trailmind_app.outdoor_capacity_enforce_generation_admission_v1()
  FROM PUBLIC, anon, authenticated, service_role,
       outdoor_research_runtime_role, app_security_runtime_role,
       pruner_role, readonly_auditor_role, migration_role,
       platform_provisioner, trailmind_import_schema_owner,
       regional_import_role, projection_role;

DO $profile$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger trigger_record
     WHERE trigger_record.tgrelid =
             'trailmind_app.outdoor_evidence_imports'::regclass
       AND trigger_record.tgname =
             'outdoor_capacity_import_generation_admission_v1'
       AND NOT trigger_record.tgisinternal
  ) THEN
    CREATE TRIGGER outdoor_capacity_import_generation_admission_v1
      BEFORE INSERT OR UPDATE ON trailmind_app.outdoor_evidence_imports
      FOR EACH ROW EXECUTE FUNCTION
        trailmind_app.outdoor_capacity_enforce_generation_admission_v1();
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger trigger_record
     WHERE trigger_record.tgrelid =
             'trailmind_app.outdoor_research_projection_runs'::regclass
       AND trigger_record.tgname =
             'outdoor_capacity_projection_generation_admission_v1'
       AND NOT trigger_record.tgisinternal
  ) THEN
    CREATE TRIGGER outdoor_capacity_projection_generation_admission_v1
      BEFORE INSERT OR UPDATE
      ON trailmind_app.outdoor_research_projection_runs
      FOR EACH ROW EXECUTE FUNCTION
        trailmind_app.outdoor_capacity_enforce_generation_admission_v1();
  END IF;
END
$profile$;

CREATE OR REPLACE FUNCTION trailmind_app.outdoor_capacity_admission_snapshot_v1(
  requested_profile_id text,
  requested_region_id text,
  requested_import_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  contract trailmind_app.outdoor_capacity_profile_contracts%ROWTYPE;
  active_import_id uuid;
  selected_import_id uuid;
  result jsonb;
BEGIN
  IF session_user NOT IN (
       'regional_import_role', 'projection_role', 'postgres'
     ) OR current_user <> 'trailmind_app_owner' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Capacity admission caller is not admitted';
  END IF;
  IF requested_profile_id <> 'supabase-free-bounded-two-core-v1' OR
     requested_region_id NOT IN ('harz-v1', 'innsbruck-alps-v1') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Capacity admission profile or region is not bounded';
  END IF;

  SELECT profile.*
    INTO contract
    FROM trailmind_app.outdoor_capacity_profile_contracts profile
   WHERE profile.profile_id = requested_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Capacity profile contract is not installed';
  END IF;

  SELECT region.active_import_id
    INTO active_import_id
    FROM trailmind_app.outdoor_evidence_regions region
   WHERE region.region_id = requested_region_id;
  selected_import_id := COALESCE(requested_import_id, active_import_id);

  SELECT pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'profileId', contract.profile_id,
    'profileIdentitySha256', contract.profile_identity_sha256,
    'hardLimitBytes', contract.hard_limit_bytes,
    'safetyReserveBytes', contract.safety_reserve_bytes,
    'currentDatabaseBytes', pg_catalog.pg_database_size(
      pg_catalog.current_database()
    ),
    'migrations', (
      SELECT pg_catalog.jsonb_agg(ledger.version ORDER BY ledger.applied_at, ledger.version)
        FROM trailmind_app.trailmind_schema_migrations ledger
    ),
    'regionId', requested_region_id,
    'activeImportId', active_import_id,
    'selectedImportId', selected_import_id,
    'retainedImports', (
      SELECT pg_catalog.count(*)
        FROM trailmind_app.outdoor_evidence_imports import_record
       WHERE import_record.region_id = requested_region_id
         AND import_record.status IN ('active', 'superseded')
    ),
    'inFlightImports', (
      SELECT pg_catalog.count(*)
        FROM trailmind_app.outdoor_evidence_imports import_record
       WHERE import_record.region_id = requested_region_id
         AND import_record.status IN ('pending', 'loading', 'ready')
    ),
    'retainedProjections', (
      SELECT pg_catalog.count(*)
        FROM trailmind_app.outdoor_research_projection_runs run
       WHERE run.region_id = requested_region_id
         AND run.status IN ('active', 'superseded')
    ),
    'inFlightProjections', (
      SELECT pg_catalog.count(*)
        FROM trailmind_app.outdoor_research_projection_runs run
       WHERE run.region_id = requested_region_id
         AND run.status IN ('loading', 'validating')
    ),
    'selectedImportProjections', (
      SELECT pg_catalog.count(*)
        FROM trailmind_app.outdoor_research_projection_runs run
       WHERE run.region_id = requested_region_id
         AND run.input_import_id = selected_import_id
         AND run.status IN ('active', 'superseded')
    ),
    'quarantines', (
      SELECT pg_catalog.count(*)
        FROM trailmind_app.outdoor_research_projection_quarantines quarantine
        JOIN trailmind_app.outdoor_research_projection_runs run
          ON run.projection_run_id = quarantine.projection_run_id
       WHERE run.region_id = requested_region_id
    )
  ) INTO result;
  RETURN result;
END
$function$;

-- Canonical audit rows remain append-only. Projection audit rows may be
-- deleted only by the exact, explicit postgres-session retirement below. Two
-- transaction-local settings bind that exception to one reviewed run.
CREATE OR REPLACE FUNCTION trailmind_app.outdoor_research_reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  allowed boolean := false;
BEGIN
  IF TG_OP = 'DELETE' AND session_user = 'postgres' AND
     current_user = 'trailmind_app_owner' AND
     pg_catalog.current_setting(
       'trailmind.capacity_retirement_v1', true
     ) = 'c5da9580a96eba5d18aeb8f8346926c016b71b8fd2340002529a1cb03c7e2afc'
  THEN
    IF TG_TABLE_NAME IN (
      'outdoor_research_projection_entities',
      'outdoor_research_projection_assertions',
      'outdoor_research_projection_relationships',
      'outdoor_research_projection_quarantines'
    ) THEN
      allowed := pg_catalog.current_setting(
        'trailmind.capacity_retirement_run_v1', true
      ) = OLD.projection_run_id::text;
    END IF;
    IF allowed THEN
      RETURN OLD;
    END IF;
  END IF;

  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END
$function$;

CREATE OR REPLACE FUNCTION trailmind_app.retire_superseded_outdoor_generation_v1(
  requested_profile_id text,
  requested_profile_identity_sha256 text,
  requested_region_id text,
  requested_import_id uuid,
  requested_projection_run_id uuid,
  operator_confirmation text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
STRICT
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  contract trailmind_app.outdoor_capacity_profile_contracts%ROWTYPE;
  preserved_active_import_id uuid;
  active_projection_run_id uuid;
  target_import trailmind_app.outdoor_evidence_imports%ROWTYPE;
  target_run trailmind_app.outdoor_research_projection_runs%ROWTYPE;
  retained_imports integer;
  retained_runs integer;
  removed_projection_entities integer;
  removed_projection_assertions integer;
  removed_projection_relationships integer;
  removed_quarantines integer;
  removed_canonical_assertions integer := 0;
  removed_canonical_relationships integer := 0;
  removed_pois integer;
  removed_trails integer;
  removed_relations integer;
  removed_members integer;
BEGIN
  IF session_user <> 'postgres' OR current_user <> 'trailmind_app_owner' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Capacity retirement caller is not admitted';
  END IF;
  IF operator_confirmation <>
       'RETIRE_SUPERSEDED_OUTDOOR_EVIDENCE_GENERATION_V1' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Capacity retirement confirmation is invalid';
  END IF;
  IF requested_profile_id <> 'supabase-free-bounded-two-core-v1' OR
     requested_region_id NOT IN ('harz-v1', 'innsbruck-alps-v1') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Capacity retirement profile or region is not bounded';
  END IF;

  SELECT profile.*
    INTO contract
    FROM trailmind_app.outdoor_capacity_profile_contracts profile
   WHERE profile.profile_id = requested_profile_id;
  IF NOT FOUND OR
     contract.profile_identity_sha256 <> requested_profile_identity_sha256 OR
     requested_profile_identity_sha256 <> 'c5da9580a96eba5d18aeb8f8346926c016b71b8fd2340002529a1cb03c7e2afc' OR
     contract.maximum_retained_generations <> 2 OR
     contract.hard_limit_bytes <> 500000000 OR
     contract.safety_reserve_bytes <> 40000000 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Capacity retirement profile identity mismatch';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'trailmind-capacity-profile:supabase-free-bounded-two-core-v1', 0
    )
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'trailmind-outdoor-import:' || requested_region_id, 0
    )
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'trailmind-osm-projection:' || requested_region_id, 0
    )
  );

  SELECT region.active_import_id
    INTO preserved_active_import_id
    FROM trailmind_app.outdoor_evidence_regions region
   WHERE region.region_id = requested_region_id
   FOR UPDATE;
  IF NOT FOUND OR preserved_active_import_id IS NULL OR
     preserved_active_import_id = requested_import_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Capacity retirement would affect the active import';
  END IF;

  SELECT import_record.*
    INTO target_import
    FROM trailmind_app.outdoor_evidence_imports import_record
   WHERE import_record.import_id = requested_import_id
     AND import_record.region_id = requested_region_id
   FOR UPDATE;
  IF NOT FOUND OR target_import.status <> 'superseded' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Capacity retirement import is not a superseded regional generation';
  END IF;

  SELECT run.*
    INTO target_run
    FROM trailmind_app.outdoor_research_projection_runs run
   WHERE run.projection_run_id = requested_projection_run_id
     AND run.region_id = requested_region_id
     AND run.input_import_id = requested_import_id
   FOR UPDATE;
  IF NOT FOUND OR target_run.status <> 'superseded' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Capacity retirement projection does not own the requested generation';
  END IF;

  SELECT run.projection_run_id
    INTO active_projection_run_id
    FROM trailmind_app.outdoor_research_projection_runs run
   WHERE run.region_id = requested_region_id
     AND run.status = 'active';
  IF NOT FOUND OR active_projection_run_id = requested_projection_run_id OR
     NOT EXISTS (
       SELECT 1
         FROM trailmind_app.outdoor_research_projection_runs active_run
        WHERE active_run.projection_run_id = active_projection_run_id
          AND active_run.input_import_id = preserved_active_import_id
          AND active_run.status = 'active'
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Capacity retirement active lineage is invalid';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO retained_imports
    FROM trailmind_app.outdoor_evidence_imports import_record
   WHERE import_record.region_id = requested_region_id
     AND import_record.status IN ('active', 'superseded');
  SELECT pg_catalog.count(*)::integer
    INTO retained_runs
    FROM trailmind_app.outdoor_research_projection_runs run
   WHERE run.region_id = requested_region_id
     AND run.status IN ('active', 'superseded');
  IF retained_imports <> 2 OR retained_runs <> 2 OR EXISTS (
    SELECT 1
      FROM trailmind_app.outdoor_evidence_imports import_record
     WHERE import_record.region_id = requested_region_id
       AND import_record.status IN ('pending', 'loading', 'ready')
  ) OR EXISTS (
    SELECT 1
      FROM trailmind_app.outdoor_research_projection_runs run
     WHERE run.region_id = requested_region_id
       AND run.status IN ('loading', 'validating')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Capacity retirement requires exactly two settled generations';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM trailmind_app.outdoor_evidence_imports older
     WHERE older.region_id = requested_region_id
       AND older.status IN ('active', 'superseded')
       AND (older.imported_at, older.created_at, older.import_id) <
           (target_import.imported_at, target_import.created_at, target_import.import_id)
  ) OR (
    SELECT pg_catalog.count(*)
      FROM trailmind_app.outdoor_research_projection_runs run
     WHERE run.region_id = requested_region_id
       AND run.input_import_id = requested_import_id
       AND run.status IN ('active', 'superseded')
  ) <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Capacity retirement target is not the oldest complete generation';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM trailmind_app.outdoor_research_projection_quarantines quarantine
      JOIN trailmind_app.outdoor_research_projection_runs run
        ON run.projection_run_id = quarantine.projection_run_id
     WHERE run.region_id = requested_region_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Capacity retirement refuses nonzero quarantine';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO removed_pois
    FROM trailmind_app.outdoor_evidence_pois
   WHERE import_id = requested_import_id;
  SELECT pg_catalog.count(*)::integer INTO removed_trails
    FROM trailmind_app.outdoor_evidence_trail_segments
   WHERE import_id = requested_import_id;
  SELECT pg_catalog.count(*)::integer INTO removed_relations
    FROM trailmind_app.outdoor_evidence_hiking_relations
   WHERE import_id = requested_import_id;
  SELECT pg_catalog.count(*)::integer INTO removed_members
    FROM trailmind_app.outdoor_evidence_hiking_relation_members
   WHERE import_id = requested_import_id;

  PERFORM pg_catalog.set_config(
    'trailmind.capacity_retirement_v1',
    requested_profile_identity_sha256,
    true
  );
  PERFORM pg_catalog.set_config(
    'trailmind.capacity_retirement_run_v1',
    requested_projection_run_id::text,
    true
  );

  DELETE FROM trailmind_app.outdoor_research_projection_quarantines
   WHERE projection_run_id = requested_projection_run_id;
  GET DIAGNOSTICS removed_quarantines = ROW_COUNT;
  DELETE FROM trailmind_app.outdoor_research_projection_relationships
   WHERE projection_run_id = requested_projection_run_id;
  GET DIAGNOSTICS removed_projection_relationships = ROW_COUNT;
  DELETE FROM trailmind_app.outdoor_research_projection_assertions
   WHERE projection_run_id = requested_projection_run_id;
  GET DIAGNOSTICS removed_projection_assertions = ROW_COUNT;
  DELETE FROM trailmind_app.outdoor_research_projection_entities
   WHERE projection_run_id = requested_projection_run_id;
  GET DIAGNOSTICS removed_projection_entities = ROW_COUNT;

  DELETE FROM trailmind_app.outdoor_research_projection_runs
   WHERE projection_run_id = requested_projection_run_id
     AND region_id = requested_region_id
     AND input_import_id = requested_import_id
     AND status = 'superseded';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Capacity retirement projection delete was not exact';
  END IF;

  DELETE FROM trailmind_app.outdoor_evidence_imports
   WHERE import_id = requested_import_id
     AND region_id = requested_region_id
     AND status = 'superseded';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Capacity retirement import delete was not exact';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM trailmind_app.outdoor_evidence_regions region
      JOIN trailmind_app.outdoor_evidence_imports active_import
        ON active_import.import_id = region.active_import_id
       AND active_import.region_id = region.region_id
       AND active_import.status = 'active'
      JOIN trailmind_app.outdoor_research_projection_runs active_run
        ON active_run.projection_run_id = active_projection_run_id
       AND active_run.region_id = region.region_id
       AND active_run.input_import_id = active_import.import_id
       AND active_run.status = 'active'
     WHERE region.region_id = requested_region_id
       AND region.active_import_id = preserved_active_import_id
  ) OR EXISTS (
    SELECT 1
      FROM trailmind_app.outdoor_evidence_imports import_record
     WHERE import_record.import_id = requested_import_id
        OR import_record.region_id <> requested_region_id
           AND import_record.import_id = requested_import_id
  ) OR EXISTS (
    SELECT 1
      FROM trailmind_app.outdoor_research_projection_runs run
     WHERE run.projection_run_id = requested_projection_run_id
  ) OR (
    SELECT pg_catalog.count(*)
      FROM trailmind_app.outdoor_evidence_imports import_record
     WHERE import_record.region_id = requested_region_id
       AND import_record.status IN ('active', 'superseded')
  ) <> 1 OR (
    SELECT pg_catalog.count(*)
      FROM trailmind_app.outdoor_research_projection_runs run
     WHERE run.region_id = requested_region_id
       AND run.status IN ('active', 'superseded')
  ) <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Capacity retirement active-generation preservation failed';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'decision', 'RETIRED_OLDEST_GENERATION',
    'regionId', requested_region_id,
    'removed', pg_catalog.jsonb_build_object(
      'projectionEntities', removed_projection_entities,
      'projectionAssertions', removed_projection_assertions,
      'projectionRelationships', removed_projection_relationships,
      'quarantines', removed_quarantines,
      'canonicalAssertions', removed_canonical_assertions,
      'canonicalRelationships', removed_canonical_relationships,
      'pois', removed_pois,
      'trails', removed_trails,
      'hikingRelations', removed_relations,
      'memberships', removed_members
    ),
    'activeGenerationPreserved', true,
    'retainedGenerationsAfter', 1
  );
END
$function$;

REVOKE ALL ON FUNCTION
  trailmind_app.outdoor_capacity_admission_snapshot_v1(text, text, uuid),
  trailmind_app.retire_superseded_outdoor_generation_v1(
    text, text, text, uuid, uuid, text
  )
  FROM PUBLIC, anon, authenticated, service_role,
       outdoor_research_runtime_role, app_security_runtime_role,
       pruner_role, readonly_auditor_role, migration_role,
       platform_provisioner, trailmind_import_schema_owner,
       regional_import_role, projection_role;

GRANT EXECUTE ON FUNCTION
  trailmind_app.outdoor_capacity_admission_snapshot_v1(text, text, uuid)
  TO regional_import_role, projection_role, postgres;
GRANT EXECUTE ON FUNCTION
  trailmind_app.retire_superseded_outdoor_generation_v1(
    text, text, text, uuid, uuid, text
  )
  TO postgres;

COMMIT;
