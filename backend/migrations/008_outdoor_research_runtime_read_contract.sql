-- The application runtime receives EXECUTE only on these bounded operations.
-- Base tables remain RLS-protected and receive no runtime grants. Each function
-- is owner-executed with a fixed trusted search path and repeats the production
-- active-projection, region, lifecycle, source-policy and quarantine boundary.

DO $migration$
DECLARE
    owner_role pg_catalog.pg_roles%ROWTYPE;
    application_schema text := pg_catalog.current_schema();
BEGIN
    SELECT *
      INTO owner_role
      FROM pg_catalog.pg_roles
     WHERE rolname = CURRENT_USER;

    IF owner_role.rolname IS NULL OR
       owner_role.rolcanlogin OR
       owner_role.rolinherit OR
       owner_role.rolsuper OR
       owner_role.rolcreatedb OR
       owner_role.rolcreaterole OR
       owner_role.rolreplication OR
       owner_role.rolbypassrls THEN
        RAISE EXCEPTION USING
          ERRCODE = '42501',
          MESSAGE = 'migration 008 requires a NOLOGIN NOINHERIT least-privilege owner';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_auth_members membership
         WHERE membership.member = owner_role.oid
    ) THEN
        RAISE EXCEPTION USING
          ERRCODE = '42501',
          MESSAGE = 'migration 008 owner must not inherit or SET ROLE to another role';
    END IF;

    IF application_schema IS NULL OR NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_namespace namespace
         WHERE namespace.nspname = application_schema
           AND namespace.nspowner = owner_role.oid
    ) THEN
        RAISE EXCEPTION USING
          ERRCODE = '42501',
          MESSAGE = 'migration 008 owner must own the application schema';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_namespace namespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(
              namespace.nspacl,
              pg_catalog.acldefault('n', namespace.nspowner)
            )
          ) privilege
         WHERE namespace.nspname = ANY(
           ARRAY[application_schema, 'public']::text[]
         )
           AND privilege.privilege_type = 'CREATE'
           AND privilege.grantee NOT IN (
             owner_role.oid,
             namespace.nspowner
           )
    ) THEN
        RAISE EXCEPTION USING
          ERRCODE = '42501',
          MESSAGE = 'migration 008 search path contains a writable untrusted schema';
    END IF;
END
$migration$;

SELECT pg_catalog.set_config(
  'search_path',
  CASE
    WHEN pg_catalog.current_schema() = 'public'
      THEN 'public,pg_catalog,pg_temp'
    ELSE pg_catalog.quote_ident(pg_catalog.current_schema()) ||
      ',pg_catalog,public,pg_temp'
  END,
  true
);

CREATE OR REPLACE FUNCTION trailmind_runtime_outdoor_research_snapshot_context_v1(
    text,
    double precision,
    double precision
)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
STRICT
SECURITY DEFINER
SET search_path FROM CURRENT
SET jit = off
AS $function$
    SELECT to_jsonb(runtime_row)
      FROM (
        WITH request_guard AS MATERIALIZED (
          SELECT $1::text AS region_id,
                 ST_SetSRID(
                   ST_MakePoint($2::double precision, $3::double precision),
                   4326
                 )::geometry(Point, 4326) AS point
           WHERE $1 = ANY(ARRAY['harz-v1', 'innsbruck-alps-v1']::text[])
             AND $2 BETWEEN -180.0 AND 180.0
             AND $3 BETWEEN -90.0 AND 90.0
        )
        SELECT region.region_id,
               region.enabled AS region_enabled,
               region.active_import_id,
               region.freshness_threshold_days,
               ST_Covers(region.boundary, guard.point) AS anchor_inside,
               CASE WHEN ST_Covers(region.boundary, guard.point)
                 THEN ST_Distance(
                   guard.point::geography,
                   ST_Boundary(region.boundary)::geography
                 )::double precision
                 ELSE NULL
               END AS boundary_distance_meters,
               import.status AS import_status,
               import.source_data_at,
               import.retrieved_at AS import_retrieved_at,
               import.imported_at,
               run.projection_run_id,
               run.input_import_id,
               run.source_id,
               run.source_policy_id,
               run.source_policy_version,
               run.adapter_schema_version,
               source.source_key,
               source.source_category,
               source.license_identifier,
               source.attribution_requirements,
               source.expected_refresh_interval_seconds,
               source.last_successful_retrieval_at,
               source.lifecycle_state AS source_lifecycle_state,
               source.normalized_facts_allowed AS source_normalized_facts_allowed,
               policy.policy_schema_version,
               policy.maximum_input_age_days,
               policy.lifecycle_state AS policy_lifecycle_state,
               policy.normalized_facts_allowed AS policy_normalized_facts_allowed,
               policy.derived_features_allowed AS policy_derived_features_allowed,
               COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                   'predicate', scope.predicate,
                   'entityCategory', scope.entity_category
                 ) ORDER BY scope.predicate, scope.entity_category)
                   FROM outdoor_research_source_policy_scopes scope
                  WHERE scope.source_policy_id = run.source_policy_id
                    AND scope.lifecycle_state = 'active'
               ), '[]'::jsonb) AS policy_scopes,
               COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                   'predicate', authority.predicate,
                   'entityCategory', authority.entity_category
                 ) ORDER BY authority.predicate, authority.entity_category)
                   FROM outdoor_research_source_authority_scopes authority
                  WHERE authority.source_id = run.source_id
                    AND authority.lifecycle_state = 'active'
               ), '[]'::jsonb) AS authority_scopes,
               COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                   'relationshipType', scope.relationship_type,
                   'subjectEntityCategory', scope.subject_entity_category,
                   'objectEntityCategory', scope.object_entity_category
                 ) ORDER BY scope.relationship_type,
                            scope.subject_entity_category,
                            scope.object_entity_category)
                   FROM outdoor_research_source_policy_relationship_scopes scope
                  WHERE scope.source_policy_id = run.source_policy_id
                    AND scope.lifecycle_state = 'active'
               ), '[]'::jsonb) AS relationship_scopes
          FROM request_guard guard
          JOIN outdoor_evidence_regions region
            ON region.region_id = guard.region_id
          LEFT JOIN outdoor_evidence_imports import
            ON import.import_id = region.active_import_id
           AND import.region_id = region.region_id
          LEFT JOIN outdoor_research_active_projection_runs run
            ON run.region_id = region.region_id
           AND run.input_import_id = region.active_import_id
          LEFT JOIN outdoor_research_sources source
            ON source.source_id = run.source_id
          LEFT JOIN outdoor_research_source_policies policy
            ON policy.source_policy_id = run.source_policy_id
           AND policy.source_id = run.source_id
         ORDER BY run.completed_at DESC NULLS LAST, run.projection_run_id
         LIMIT 1
      ) runtime_row
$function$;

CREATE OR REPLACE FUNCTION trailmind_runtime_outdoor_research_route_memberships_v1(
    uuid,
    text,
    double precision,
    double precision,
    double precision,
    integer,
    integer
)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
STRICT
SECURITY DEFINER
SET search_path FROM CURRENT
SET jit = off
AS $function$
    SELECT to_jsonb(runtime_row)
      FROM (
        WITH request_guard AS MATERIALIZED (
          SELECT $1::uuid AS projection_run_id,
                 $2::text AS region_id,
                 ST_SetSRID(
                   ST_MakePoint($3::double precision, $4::double precision),
                   4326
                 )::geometry(Point, 4326) AS point
           WHERE $2 = ANY(ARRAY['harz-v1', 'innsbruck-alps-v1']::text[])
             AND $3 BETWEEN -180.0 AND 180.0
             AND $4 BETWEEN -90.0 AND 90.0
             AND $5 BETWEEN 5000.0 AND 50000.0
             AND $6 BETWEEN 1 AND 24
             AND $7 = 1
        ), membership_segment_ids AS MATERIALIZED (
          SELECT DISTINCT projected_relationship.subject_entity_id AS entity_id
            FROM request_guard guard
            JOIN outdoor_research_projection_relationships projected_relationship
              ON projected_relationship.projection_run_id = guard.projection_run_id
           WHERE projected_relationship.relationship_type =
             'trail_segment_member_of_route'
        ), candidate_segments AS MATERIALIZED (
          SELECT segment.projection_run_id,
                 segment.entity_id,
                 ST_PointOnSurface(segment.projected_geometry) AS candidate_point
            FROM request_guard guard
            JOIN membership_segment_ids membership ON true
            JOIN outdoor_research_projection_entities segment
              ON segment.projection_run_id = guard.projection_run_id
             AND segment.entity_id = membership.entity_id
            JOIN outdoor_research_active_projection_runs active_run
              ON active_run.projection_run_id = segment.projection_run_id
             AND active_run.region_id = guard.region_id
            JOIN outdoor_research_entities segment_entity
              ON segment_entity.entity_id = segment.entity_id
             AND segment_entity.lifecycle_state = 'active'
            JOIN outdoor_evidence_regions region
              ON region.region_id = active_run.region_id
             AND region.enabled = true
             AND region.active_import_id = active_run.input_import_id
            JOIN outdoor_evidence_imports import
              ON import.import_id = active_run.input_import_id
             AND import.region_id = active_run.region_id
             AND import.status = 'active'
           WHERE segment.entity_category = 'trail_segment'
             AND segment.projected_geometry IS NOT NULL
             AND NOT EXISTS (
               SELECT 1
                 FROM outdoor_research_projection_quarantines quarantine
                WHERE quarantine.projection_run_id = segment.projection_run_id
                  AND quarantine.osm_type = segment.osm_type
                  AND quarantine.osm_id = segment.osm_id
             )
             AND ST_CoveredBy(segment.projected_geometry, region.boundary)
             AND ST_PointOnSurface(segment.projected_geometry) && ST_Expand(
               guard.point,
               $5::double precision / (
                 111000.0 * GREATEST(
                   COS(RADIANS(ST_Y(guard.point))),
                   0.01
                 )
               ),
               $5::double precision / 110000.0
             )
        ), nearby_segments AS MATERIALIZED (
          SELECT segment.projection_run_id,
                 segment.entity_id,
                 ST_Distance(
                   segment.candidate_point::geography,
                   guard.point::geography
                 )::double precision AS distance_meters
            FROM request_guard guard
            JOIN candidate_segments segment ON true
           WHERE ST_DWithin(
             segment.candidate_point::geography,
             guard.point::geography,
             $5::double precision
           )
        ), nearby AS (
          SELECT relationship.relationship_id,
                 relationship.subject_entity_id AS segment_entity_id,
                 relationship.object_entity_id AS route_entity_id,
                 relationship.evidence_class,
                 relationship.observed_at,
                 relationship.retrieved_at,
                 relationship.valid_from,
                 relationship.valid_until,
                 relationship.freshness_state,
                 relationship.provenance_identifier,
                 projected_relationship.record_provenance,
                 relationship.source_id,
                 segment.distance_meters,
                 row_number() OVER (
                   PARTITION BY relationship.object_entity_id
                   ORDER BY segment.distance_meters,
                            relationship.subject_entity_id,
                            relationship.relationship_id
                 ) AS membership_rank
            FROM request_guard guard
            JOIN nearby_segments segment ON true
            JOIN outdoor_research_projection_relationships projected_relationship
              ON projected_relationship.projection_run_id = segment.projection_run_id
             AND projected_relationship.subject_entity_id = segment.entity_id
            JOIN outdoor_research_active_relationships relationship
              ON relationship.relationship_id = projected_relationship.relationship_id
             AND relationship.relationship_type = 'trail_segment_member_of_route'
            JOIN outdoor_research_active_projection_runs active_run
              ON active_run.projection_run_id = projected_relationship.projection_run_id
             AND active_run.source_id = relationship.source_id
             AND active_run.region_id = guard.region_id
            JOIN outdoor_research_projection_entities projected_segment
              ON projected_segment.projection_run_id =
                   projected_relationship.projection_run_id
             AND projected_segment.entity_id = relationship.subject_entity_id
             AND projected_segment.entity_category = 'trail_segment'
            JOIN outdoor_research_projection_entities route
              ON route.projection_run_id = projected_relationship.projection_run_id
             AND route.entity_id = relationship.object_entity_id
             AND route.entity_category = 'hiking_route'
            JOIN outdoor_research_entities route_entity
              ON route_entity.entity_id = route.entity_id
             AND route_entity.lifecycle_state = 'active'
            JOIN outdoor_evidence_regions region
              ON region.region_id = active_run.region_id
             AND region.enabled = true
             AND region.active_import_id = active_run.input_import_id
            JOIN outdoor_evidence_imports import
              ON import.import_id = active_run.input_import_id
             AND import.region_id = active_run.region_id
             AND import.status = 'active'
           WHERE NOT EXISTS (
             SELECT 1
               FROM outdoor_research_projection_quarantines quarantine
              WHERE quarantine.projection_run_id = route.projection_run_id
                AND quarantine.osm_type = route.osm_type
                AND quarantine.osm_id = route.osm_id
           )
        )
        SELECT nearby.relationship_id,
               nearby.segment_entity_id,
               nearby.route_entity_id,
               nearby.evidence_class,
               nearby.observed_at,
               nearby.retrieved_at,
               nearby.valid_from,
               nearby.valid_until,
               nearby.freshness_state,
               nearby.provenance_identifier,
               nearby.record_provenance,
               nearby.distance_meters,
               source.source_id,
               source.source_key,
               source.source_category,
               source.license_identifier,
               source.attribution_requirements,
               run.adapter_schema_version
          FROM request_guard guard
          JOIN nearby ON true
          JOIN outdoor_research_active_projection_runs run
            ON run.projection_run_id = guard.projection_run_id
           AND run.region_id = guard.region_id
          JOIN outdoor_research_sources source
            ON source.source_id = run.source_id
           AND source.source_id = nearby.source_id
         WHERE nearby.membership_rank <= $7
         ORDER BY nearby.distance_meters,
                  nearby.route_entity_id,
                  nearby.membership_rank,
                  nearby.segment_entity_id,
                  nearby.relationship_id
         LIMIT $6
      ) runtime_row
$function$;

CREATE OR REPLACE FUNCTION trailmind_runtime_outdoor_research_route_assertions_v1(
    uuid,
    uuid[],
    text[],
    integer
)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
STRICT
SECURITY DEFINER
SET search_path FROM CURRENT
SET jit = off
AS $function$
    SELECT to_jsonb(runtime_row)
      FROM (
        WITH request_guard AS MATERIALIZED (
          SELECT $1::uuid AS projection_run_id
           WHERE cardinality($2) BETWEEN 1 AND 48
             AND cardinality($3) BETWEEN 1 AND 10
             AND $3 <@ ARRAY[
               'access_restriction', 'entity_category', 'name', 'operator',
               'trail_difficulty', 'trail_visibility', 'viewpoint_presence',
               'waterfall_presence'
             ]::text[]
             AND $4 BETWEEN 1 AND 160
        )
        SELECT projection.entity_id,
               projection.entity_category,
               projection.source_version,
               projection.record_provenance,
               assertion.assertion_id,
               assertion.predicate,
               assertion.value_type,
               assertion.value_text,
               assertion.value_boolean,
               assertion.value_number,
               assertion.value_integer,
               assertion.value_timestamp,
               assertion.value_entity_id,
               assertion.evidence_class,
               assertion.observed_at,
               assertion.retrieved_at,
               assertion.valid_from,
               assertion.valid_until,
               assertion.freshness_state,
               assertion.provenance_identifier,
               source.source_id,
               source.source_key,
               source.source_category,
               source.license_identifier,
               source.attribution_requirements,
               run.adapter_schema_version
          FROM request_guard guard
          JOIN outdoor_research_projection_entities projection
            ON projection.projection_run_id = guard.projection_run_id
          JOIN outdoor_research_entities canonical_entity
            ON canonical_entity.entity_id = projection.entity_id
           AND canonical_entity.lifecycle_state = 'active'
          JOIN outdoor_research_projection_assertions projected_assertion
            ON projected_assertion.projection_run_id = projection.projection_run_id
           AND projected_assertion.entity_id = projection.entity_id
          JOIN outdoor_research_active_assertions assertion
            ON assertion.assertion_id = projected_assertion.assertion_id
           AND assertion.predicate = ANY($3::text[])
          JOIN outdoor_research_active_projection_runs run
            ON run.projection_run_id = projection.projection_run_id
          JOIN outdoor_evidence_regions region
            ON region.region_id = run.region_id
           AND region.enabled = true
           AND region.active_import_id = run.input_import_id
           AND run.region_id = ANY(
             ARRAY['harz-v1', 'innsbruck-alps-v1']::text[]
           )
          JOIN outdoor_evidence_imports import
            ON import.import_id = run.input_import_id
           AND import.region_id = run.region_id
           AND import.status = 'active'
          JOIN outdoor_research_sources source
            ON source.source_id = assertion.source_id
           AND source.source_id = run.source_id
         WHERE projection.entity_id = ANY($2::uuid[])
           AND NOT EXISTS (
             SELECT 1
               FROM outdoor_research_projection_quarantines quarantine
              WHERE quarantine.projection_run_id = projection.projection_run_id
                AND quarantine.osm_type = projection.osm_type
                AND quarantine.osm_id = projection.osm_id
           )
         ORDER BY projection.entity_category,
                  projection.entity_id,
                  assertion.predicate,
                  assertion.assertion_id
         LIMIT $4
      ) runtime_row
$function$;

CREATE OR REPLACE FUNCTION trailmind_runtime_outdoor_research_highlights_v1(
    uuid,
    text,
    double precision,
    double precision,
    text[],
    double precision,
    text[],
    integer,
    double precision
)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
STRICT
SECURITY DEFINER
SET search_path FROM CURRENT
SET jit = off
AS $function$
    SELECT to_jsonb(runtime_row)
      FROM (
        WITH request_guard AS MATERIALIZED (
          SELECT $1::uuid AS projection_run_id,
                 $2::text AS region_id,
                 ST_SetSRID(
                   ST_MakePoint($3::double precision, $4::double precision),
                   4326
                 )::geometry(Point, 4326) AS point
           WHERE $2 = ANY(ARRAY['harz-v1', 'innsbruck-alps-v1']::text[])
             AND $3 BETWEEN -180.0 AND 180.0
             AND $4 BETWEEN -90.0 AND 90.0
             AND cardinality($5) BETWEEN 1 AND 8
             AND $5 <@ ARRAY[
               'viewpoint', 'waterfall', 'peak', 'lake', 'alpine_hut',
               'wilderness_hut', 'landmark', 'trail_segment', 'hiking_route'
             ]::text[]
             AND $6 BETWEEN 1.0 AND 50000.0
             AND cardinality($7) BETWEEN 1 AND 10
             AND $7 <@ ARRAY[
               'access_restriction', 'entity_category', 'name', 'operator',
               'trail_difficulty', 'trail_visibility', 'viewpoint_presence',
               'waterfall_presence'
             ]::text[]
             AND $8 BETWEEN 1 AND 32
             AND $9 = 75.0
        ), candidates AS (
          SELECT projection.entity_id,
                 projection.entity_category,
                 projection.source_version,
                 projection.record_provenance,
                 ST_PointOnSurface(projection.projected_geometry) AS candidate_point,
                 ST_Distance(
                   ST_PointOnSurface(projection.projected_geometry)::geography,
                   guard.point::geography
                 )::double precision AS distance_meters
            FROM request_guard guard
            JOIN outdoor_research_projection_entities projection
              ON projection.projection_run_id = guard.projection_run_id
            JOIN outdoor_research_active_projection_runs active_run
              ON active_run.projection_run_id = projection.projection_run_id
             AND active_run.region_id = guard.region_id
            JOIN outdoor_evidence_regions region
              ON region.region_id = active_run.region_id
             AND region.enabled = true
             AND region.active_import_id = active_run.input_import_id
            JOIN outdoor_evidence_imports import
              ON import.import_id = active_run.input_import_id
             AND import.region_id = active_run.region_id
             AND import.status = 'active'
            JOIN outdoor_research_entities projected_entity
              ON projected_entity.entity_id = projection.entity_id
             AND projected_entity.lifecycle_state = 'active'
           WHERE projection.entity_category = ANY($5::text[])
             AND projection.projected_geometry IS NOT NULL
             AND NOT EXISTS (
               SELECT 1
                 FROM outdoor_research_projection_quarantines quarantine
                WHERE quarantine.projection_run_id = projection.projection_run_id
                  AND quarantine.osm_type = projection.osm_type
                  AND quarantine.osm_id = projection.osm_id
             )
             AND ST_CoveredBy(projection.projected_geometry, region.boundary)
             AND projection.projected_geometry && ST_Expand(
               guard.point,
               $6::double precision / (
                 111000.0 * GREATEST(
                   COS(RADIANS(ST_Y(guard.point))),
                   0.01
                 )
               ),
               $6::double precision / 110000.0
             )
             AND ST_DWithin(
               ST_PointOnSurface(projection.projected_geometry)::geography,
               guard.point::geography,
               $6::double precision
             )
             AND EXISTS (
               SELECT 1
                 FROM outdoor_research_projection_entities trail
                 JOIN outdoor_research_entities trail_entity
                   ON trail_entity.entity_id = trail.entity_id
                  AND trail_entity.lifecycle_state = 'active'
                WHERE trail.projection_run_id = projection.projection_run_id
                  AND trail.entity_category = 'trail_segment'
                  AND trail.projected_geometry IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1
                      FROM outdoor_research_projection_quarantines quarantine
                     WHERE quarantine.projection_run_id = trail.projection_run_id
                       AND quarantine.osm_type = trail.osm_type
                       AND quarantine.osm_id = trail.osm_id
                  )
                  AND ST_CoveredBy(trail.projected_geometry, region.boundary)
                  AND trail.projected_geometry && ST_Expand(
                    ST_PointOnSurface(projection.projected_geometry),
                    $9::double precision / (
                      111000.0 * GREATEST(
                        COS(RADIANS(ST_Y(
                          ST_PointOnSurface(projection.projected_geometry)
                        ))),
                        0.01
                      )
                    ),
                    $9::double precision / 110000.0
                  )
                  AND ST_DWithin(
                    trail.projected_geometry::geography,
                    ST_PointOnSurface(projection.projected_geometry)::geography,
                    $9::double precision
                  )
             )
           ORDER BY distance_meters, projection.entity_id
           LIMIT $8
        )
        SELECT candidate.entity_id,
               candidate.entity_category,
               ST_Y(candidate.candidate_point)::double precision AS latitude,
               ST_X(candidate.candidate_point)::double precision AS longitude,
               candidate.distance_meters,
               candidate.source_version,
               candidate.record_provenance,
               assertion.assertion_id,
               assertion.predicate,
               assertion.value_type,
               assertion.value_text,
               assertion.value_boolean,
               assertion.value_number,
               assertion.value_integer,
               assertion.value_timestamp,
               assertion.value_entity_id,
               assertion.evidence_class,
               assertion.observed_at,
               assertion.retrieved_at,
               assertion.valid_from,
               assertion.valid_until,
               assertion.freshness_state,
               assertion.provenance_identifier,
               source.source_id,
               source.source_key,
               source.source_category,
               source.license_identifier,
               source.attribution_requirements,
               run.adapter_schema_version
          FROM candidates candidate
          JOIN outdoor_research_projection_assertions projected_assertion
            ON projected_assertion.projection_run_id = $1
           AND projected_assertion.entity_id = candidate.entity_id
          JOIN outdoor_research_active_assertions assertion
            ON assertion.assertion_id = projected_assertion.assertion_id
           AND assertion.predicate = ANY($7::text[])
          JOIN outdoor_research_active_projection_runs run
            ON run.projection_run_id = $1
           AND run.region_id = $2
          JOIN outdoor_research_sources source
            ON source.source_id = assertion.source_id
           AND source.source_id = run.source_id
         ORDER BY candidate.distance_meters,
                  candidate.entity_category,
                  candidate.entity_id,
                  assertion.predicate,
                  assertion.assertion_id
      ) runtime_row
$function$;

CREATE OR REPLACE FUNCTION trailmind_runtime_outdoor_research_trail_access_candidates_v1(
    uuid,
    text,
    uuid[],
    double precision,
    integer,
    text[],
    text[],
    integer
)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
STRICT
SECURITY DEFINER
SET search_path FROM CURRENT
SET jit = off
AS $function$
    SELECT to_jsonb(runtime_row)
      FROM (
        WITH request_guard AS MATERIALIZED (
          SELECT $1::uuid AS projection_run_id,
                 $2::text AS region_id
           WHERE $2 = ANY(ARRAY['harz-v1', 'innsbruck-alps-v1']::text[])
             AND cardinality($3) BETWEEN 1 AND 32
             AND $4 = 75.0
             AND $5 BETWEEN 1 AND 3
             AND $6 = ARRAY[
               'path', 'footway', 'track', 'steps', 'bridleway', 'pedestrian'
             ]::text[]
             AND $7 = ARRAY[
               'viewpoint', 'waterfall', 'peak', 'lake', 'alpine_hut',
               'wilderness_hut', 'landmark'
             ]::text[]
             AND $8 BETWEEN 1 AND 96
        ), requested AS MATERIALIZED (
          SELECT unnest($3::uuid[]) AS entity_id
            FROM request_guard
        ), requested_highlights AS MATERIALIZED (
          SELECT highlight.*
            FROM request_guard guard
            JOIN requested ON true
            JOIN outdoor_research_projection_entities highlight
              ON highlight.projection_run_id = guard.projection_run_id
             AND highlight.entity_id = requested.entity_id
        ), snapshot AS MATERIALIZED (
          SELECT run.projection_run_id,
                 run.region_id,
                 run.input_import_id,
                 run.source_id,
                 run.source_policy_id,
                 run.source_policy_version,
                 run.adapter_schema_version,
                 run.input_source_data_at,
                 run.input_retrieved_at,
                 region.boundary
            FROM request_guard guard
            JOIN outdoor_research_active_projection_runs run
              ON run.projection_run_id = guard.projection_run_id
             AND run.region_id = guard.region_id
            JOIN outdoor_evidence_regions region
              ON region.region_id = run.region_id
             AND region.enabled = true
             AND region.active_import_id = run.input_import_id
            JOIN outdoor_evidence_imports import
              ON import.import_id = run.input_import_id
             AND import.region_id = run.region_id
             AND import.status = 'active'
        ), highlights AS MATERIALIZED (
          SELECT highlight.entity_id,
                 highlight.entity_category,
                 ST_PointOnSurface(highlight.projected_geometry) AS evidence_point,
                 snapshot.*,
                 name_assertion.value_text AS display_name
            FROM requested_highlights highlight
            JOIN outdoor_research_entities highlight_entity
              ON highlight_entity.entity_id = highlight.entity_id
             AND highlight_entity.lifecycle_state = 'active'
            JOIN outdoor_research_source_entities highlight_source_entity
              ON highlight_source_entity.source_entity_link_id =
                   highlight.source_entity_link_id
             AND highlight_source_entity.entity_id = highlight.entity_id
             AND highlight_source_entity.source_id = highlight.source_id
             AND highlight_source_entity.matching_status = 'matched'
            CROSS JOIN snapshot
            LEFT JOIN LATERAL (
              SELECT assertion.value_text
                FROM outdoor_research_projection_assertions projection_assertion
                JOIN outdoor_research_active_assertions assertion
                  ON assertion.assertion_id = projection_assertion.assertion_id
                 AND assertion.entity_id = highlight.entity_id
                 AND assertion.source_id = snapshot.source_id
                 AND assertion.predicate = 'name'
                 AND assertion.value_type = 'text'
                 AND assertion.freshness_state = 'current'
               WHERE projection_assertion.projection_run_id = $1
                 AND projection_assertion.entity_id = highlight.entity_id
               ORDER BY assertion.assertion_id
               LIMIT 1
            ) name_assertion ON true
           WHERE highlight.source_id = snapshot.source_id
             AND highlight.entity_category = ANY($7::text[])
             AND highlight.projected_geometry IS NOT NULL
             AND GeometryType(highlight.projected_geometry) IN (
               'POINT', 'POLYGON', 'MULTIPOLYGON'
             )
             AND ST_SRID(highlight.projected_geometry) = 4326
             AND ST_NDims(highlight.projected_geometry) = 2
             AND NOT ST_IsEmpty(highlight.projected_geometry)
             AND ST_IsValid(highlight.projected_geometry)
             AND ST_CoveredBy(highlight.projected_geometry, snapshot.boundary)
             AND NOT EXISTS (
               SELECT 1
                 FROM outdoor_research_projection_quarantines quarantine
                WHERE quarantine.projection_run_id = highlight.projection_run_id
                  AND quarantine.osm_type = highlight.osm_type
                  AND quarantine.osm_id = highlight.osm_id
             )
        ), candidates AS (
          SELECT highlight.entity_id AS highlight_entity_id,
                 highlight.entity_category AS highlight_category,
                 ST_Y(highlight.evidence_point)::double precision
                   AS evidence_latitude,
                 ST_X(highlight.evidence_point)::double precision
                   AS evidence_longitude,
                 access.trail_entity_id,
                 ST_Y(access.routing_point)::double precision AS routing_latitude,
                 ST_X(access.routing_point)::double precision AS routing_longitude,
                 access.poi_to_access_distance_meters,
                 access.highway_class,
                 access.trail_category_evidence_claim_ids,
                 access.trail_osm_type,
                 access.trail_osm_id,
                 highlight.display_name,
                 highlight.region_id AS operational_region_id,
                 highlight.projection_run_id,
                 highlight.input_import_id AS import_id,
                 highlight.source_id,
                 highlight.source_policy_id,
                 highlight.source_policy_version,
                 highlight.adapter_schema_version,
                 highlight.input_source_data_at AS source_data_at,
                 highlight.input_retrieved_at AS retrieved_at
            FROM highlights highlight
            CROSS JOIN LATERAL (
              SELECT eligible.trail_entity_id,
                     eligible.routing_point,
                     eligible.poi_to_access_distance_meters,
                     eligible.highway_class,
                     eligible.trail_category_evidence_claim_ids,
                     eligible.trail_osm_type,
                     eligible.trail_osm_id
                FROM (
                  WITH nearby_trails AS MATERIALIZED (
                    SELECT trail.*
                      FROM outdoor_research_projection_entities trail
                     WHERE trail.projection_run_id = highlight.projection_run_id
                       AND trail.source_id = highlight.source_id
                       AND trail.entity_category = 'trail_segment'
                       AND trail.projected_geometry IS NOT NULL
                       AND GeometryType(trail.projected_geometry) IN (
                         'LINESTRING', 'MULTILINESTRING'
                       )
                       AND ST_SRID(trail.projected_geometry) = 4326
                       AND ST_NDims(trail.projected_geometry) = 2
                       AND NOT ST_IsEmpty(trail.projected_geometry)
                       AND ST_IsValid(trail.projected_geometry)
                       AND ST_DWithin(
                         trail.projected_geometry::geography,
                         highlight.evidence_point::geography,
                         $4::double precision
                       )
                  )
                  SELECT trail.entity_id AS trail_entity_id,
                         ST_ClosestPoint(
                           trail.projected_geometry,
                           highlight.evidence_point
                         ) AS routing_point,
                         ST_Distance(
                           highlight.evidence_point::geography,
                           ST_ClosestPoint(
                             trail.projected_geometry,
                             highlight.evidence_point
                           )::geography
                         )::double precision AS poi_to_access_distance_meters,
                         source_trail.highway_class,
                         source_trail.osm_type AS trail_osm_type,
                         source_trail.osm_id::text AS trail_osm_id,
                         ARRAY[category_assertion.assertion_id]
                           AS trail_category_evidence_claim_ids
                    FROM nearby_trails trail
                    JOIN outdoor_research_entities trail_entity
                      ON trail_entity.entity_id = trail.entity_id
                     AND trail_entity.lifecycle_state = 'active'
                    JOIN outdoor_research_source_entities trail_source_entity
                      ON trail_source_entity.source_entity_link_id =
                           trail.source_entity_link_id
                     AND trail_source_entity.entity_id = trail.entity_id
                     AND trail_source_entity.source_id = trail.source_id
                     AND trail_source_entity.matching_status = 'matched'
                    JOIN outdoor_evidence_trail_segments source_trail
                      ON source_trail.import_id = highlight.input_import_id
                     AND source_trail.region_id = highlight.region_id
                     AND source_trail.osm_type = trail.osm_type
                     AND source_trail.osm_id = trail.osm_id
                     AND source_trail.highway_class = ANY($6::text[])
                    JOIN outdoor_research_projection_assertions projected_category
                      ON projected_category.projection_run_id =
                           trail.projection_run_id
                     AND projected_category.entity_id = trail.entity_id
                     AND projected_category.predicate = 'entity_category'
                    JOIN outdoor_research_active_assertions category_assertion
                      ON category_assertion.assertion_id =
                           projected_category.assertion_id
                     AND category_assertion.entity_id = trail.entity_id
                     AND category_assertion.source_id = highlight.source_id
                     AND category_assertion.predicate = 'entity_category'
                     AND category_assertion.value_type = 'text'
                     AND category_assertion.value_text = 'trail_segment'
                     AND category_assertion.freshness_state = 'current'
                   WHERE ST_CoveredBy(trail.projected_geometry, highlight.boundary)
                     AND NOT EXISTS (
                       SELECT 1
                         FROM outdoor_research_projection_quarantines quarantine
                        WHERE quarantine.projection_run_id = trail.projection_run_id
                          AND quarantine.osm_type = trail.osm_type
                          AND quarantine.osm_id = trail.osm_id
                     )
                     AND NOT EXISTS (
                       SELECT 1
                         FROM outdoor_research_projection_assertions restriction_link
                         JOIN outdoor_research_active_assertions restriction
                           ON restriction.assertion_id =
                                restriction_link.assertion_id
                          AND restriction.entity_id = trail.entity_id
                          AND restriction.source_id = highlight.source_id
                          AND restriction.freshness_state = 'current'
                        WHERE restriction_link.projection_run_id =
                                trail.projection_run_id
                          AND restriction_link.entity_id = trail.entity_id
                          AND (
                            restriction.predicate = 'access_restriction' OR
                            (
                              restriction.predicate = 'closure_status' AND
                              (
                                restriction.value_type <> 'text' OR
                                restriction.value_text IS DISTINCT FROM 'open'
                              )
                            )
                          )
                     )
                ) eligible
               WHERE ST_CoveredBy(eligible.routing_point, highlight.boundary)
                 AND eligible.poi_to_access_distance_meters <=
                   $4::double precision
               ORDER BY eligible.poi_to_access_distance_meters,
                        eligible.trail_entity_id
               LIMIT $5
            ) access
        )
        SELECT *
          FROM candidates
         ORDER BY highlight_entity_id,
                  poi_to_access_distance_meters,
                  trail_entity_id
         LIMIT $8
      ) runtime_row
$function$;

REVOKE ALL ON FUNCTION
  trailmind_runtime_outdoor_research_snapshot_context_v1(
    text, double precision, double precision
  ) FROM PUBLIC;
REVOKE ALL ON FUNCTION
  trailmind_runtime_outdoor_research_highlights_v1(
    uuid, text, double precision, double precision, text[], double precision,
    text[], integer, double precision
  ) FROM PUBLIC;
REVOKE ALL ON FUNCTION
  trailmind_runtime_outdoor_research_route_memberships_v1(
    uuid, text, double precision, double precision, double precision, integer,
    integer
  ) FROM PUBLIC;
REVOKE ALL ON FUNCTION
  trailmind_runtime_outdoor_research_route_assertions_v1(
    uuid, uuid[], text[], integer
  ) FROM PUBLIC;
REVOKE ALL ON FUNCTION
  trailmind_runtime_outdoor_research_trail_access_candidates_v1(
    uuid, text, uuid[], double precision, integer, text[], text[], integer
  ) FROM PUBLIC;
