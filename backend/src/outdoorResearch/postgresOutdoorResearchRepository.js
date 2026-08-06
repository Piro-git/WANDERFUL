import {
  OUTDOOR_RESEARCH_EXECUTOR_POLICY_V1,
  boundedExecutorTimeout,
  OutdoorResearchExecutorError,
  outdoorResearchExecutorError,
  strictExecutorDateV1
} from "./executorPolicy.js";
import {
  exactRelationshipScopeSetMatches,
  exactScopeSetMatches,
  recognizedOsmProjectionPolicy
} from "./osmProjectionPolicy.js";
import { validateResearchPlannerCapabilitiesV1 } from "./researchPlanner.js";
import {
  RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1
} from "../routeResearch/trailAccessCandidatePolicy.js";

const TRANSACTION_LIFECYCLE_OBSERVERS = new WeakMap();
const TRANSACTION_LIFECYCLE_EVENTS = new Set([
  "began",
  "query_cancelled_after_abort",
  "rollback_completed_after_cancel"
]);

const SNAPSHOT_CONTEXT_QUERY = `
WITH anchor AS (
  SELECT ST_SetSRID(ST_MakePoint($2, $3), 4326)::geometry(Point, 4326) AS point
)
SELECT region.region_id,
       region.enabled AS region_enabled,
       region.active_import_id,
       region.freshness_threshold_days,
       ST_Covers(region.boundary, anchor.point) AS anchor_inside,
       CASE WHEN ST_Covers(region.boundary, anchor.point)
         THEN ST_Distance(
           anchor.point::geography,
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
  FROM outdoor_evidence_regions region
  CROSS JOIN anchor
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
 WHERE region.region_id = $1
 ORDER BY run.completed_at DESC NULLS LAST, run.projection_run_id
 LIMIT 1`;

const HIGHLIGHT_QUERY = `
WITH anchor AS (
  SELECT ST_SetSRID(ST_MakePoint($3, $4), 4326)::geometry(Point, 4326) AS point
), candidates AS (
  SELECT projection.entity_id,
         projection.entity_category,
         projection.source_version,
         projection.record_provenance,
         ST_PointOnSurface(projection.projected_geometry) AS candidate_point,
         ST_Distance(
           ST_PointOnSurface(projection.projected_geometry)::geography,
           anchor.point::geography
         )::double precision AS distance_meters
     FROM outdoor_research_projection_entities projection
     JOIN outdoor_research_active_projection_runs active_run
       ON active_run.projection_run_id = projection.projection_run_id
      AND active_run.region_id = $2
     JOIN outdoor_evidence_regions region
       ON region.region_id = active_run.region_id
      AND region.enabled = true
      AND region.active_import_id = active_run.input_import_id
     JOIN outdoor_research_entities projected_entity
       ON projected_entity.entity_id = projection.entity_id
      AND projected_entity.lifecycle_state = 'active'
     CROSS JOIN anchor
    WHERE projection.projection_run_id = $1
      AND projection.entity_category = ANY($5::text[])
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
       anchor.point,
       $6::double precision / (
         111000.0 * GREATEST(
           COS(RADIANS(ST_Y(anchor.point))),
           0.01
         )
       ),
       $6::double precision / 110000.0
     )
     AND ST_DWithin(
       ST_PointOnSurface(projection.projected_geometry)::geography,
       anchor.point::geography,
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
          assertion.assertion_id`;

const ROUTE_MEMBERSHIP_QUERY = `
WITH anchor AS (
  SELECT ST_SetSRID(ST_MakePoint($3, $4), 4326)::geometry(Point, 4326) AS point
), membership_segment_ids AS MATERIALIZED (
  SELECT DISTINCT projected_relationship.subject_entity_id AS entity_id
    FROM outdoor_research_projection_relationships projected_relationship
   WHERE projected_relationship.projection_run_id = $1
     AND projected_relationship.relationship_type =
       'trail_segment_member_of_route'
), candidate_segments AS MATERIALIZED (
  SELECT segment.projection_run_id,
         segment.entity_id,
         ST_PointOnSurface(segment.projected_geometry) AS candidate_point
    FROM membership_segment_ids membership
    JOIN outdoor_research_projection_entities segment
      ON segment.projection_run_id = $1
     AND segment.entity_id = membership.entity_id
    JOIN outdoor_research_active_projection_runs active_run
      ON active_run.projection_run_id = segment.projection_run_id
     AND active_run.region_id = $2
    JOIN outdoor_research_entities segment_entity
      ON segment_entity.entity_id = segment.entity_id
     AND segment_entity.lifecycle_state = 'active'
    JOIN outdoor_evidence_regions region
      ON region.region_id = active_run.region_id
     AND region.enabled = true
     AND region.active_import_id = active_run.input_import_id
    CROSS JOIN anchor
   WHERE segment.projection_run_id = $1
     AND segment.entity_category = 'trail_segment'
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
       anchor.point,
       $5::double precision / (
         111000.0 * GREATEST(
           COS(RADIANS(ST_Y(anchor.point))),
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
           anchor.point::geography
         )::double precision AS distance_meters
    FROM candidate_segments segment
    CROSS JOIN anchor
   WHERE ST_DWithin(
     segment.candidate_point::geography,
     anchor.point::geography,
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
    FROM nearby_segments segment
    JOIN outdoor_research_projection_relationships projected_relationship
      ON projected_relationship.projection_run_id = segment.projection_run_id
     AND projected_relationship.subject_entity_id = segment.entity_id
    JOIN outdoor_research_active_relationships relationship
      ON relationship.relationship_id = projected_relationship.relationship_id
     AND relationship.relationship_type = 'trail_segment_member_of_route'
    JOIN outdoor_research_active_projection_runs active_run
      ON active_run.projection_run_id = projected_relationship.projection_run_id
     AND active_run.source_id = relationship.source_id
     AND active_run.region_id = $2
    JOIN outdoor_research_projection_entities projected_segment
      ON projected_segment.projection_run_id = projected_relationship.projection_run_id
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
   WHERE projected_relationship.projection_run_id = $1
     AND NOT EXISTS (
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
  FROM nearby
  JOIN outdoor_research_active_projection_runs run
    ON run.projection_run_id = $1
   AND run.region_id = $2
  JOIN outdoor_research_sources source
    ON source.source_id = run.source_id
   AND source.source_id = nearby.source_id
 WHERE nearby.membership_rank <= $7
 ORDER BY nearby.distance_meters,
          nearby.route_entity_id,
          nearby.membership_rank,
          nearby.segment_entity_id,
          nearby.relationship_id
 LIMIT $6`;

const ROUTE_ASSERTION_QUERY = `
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
  FROM outdoor_research_projection_entities projection
  JOIN outdoor_research_projection_assertions projected_assertion
    ON projected_assertion.projection_run_id = projection.projection_run_id
   AND projected_assertion.entity_id = projection.entity_id
  JOIN outdoor_research_active_assertions assertion
    ON assertion.assertion_id = projected_assertion.assertion_id
   AND assertion.predicate = ANY($3::text[])
  JOIN outdoor_research_active_projection_runs run
    ON run.projection_run_id = projection.projection_run_id
  JOIN outdoor_research_sources source
    ON source.source_id = assertion.source_id
   AND source.source_id = run.source_id
 WHERE projection.projection_run_id = $1
   AND projection.entity_id = ANY($2::uuid[])
 ORDER BY projection.entity_category,
          projection.entity_id,
          assertion.predicate,
          assertion.assertion_id
 LIMIT $4`;

const TRAIL_ACCESS_CANDIDATE_QUERY = `
WITH requested AS MATERIALIZED (
  SELECT unnest($3::uuid[]) AS entity_id
), requested_highlights AS MATERIALIZED (
  SELECT highlight.*
    FROM requested
    JOIN outdoor_research_projection_entities highlight
      ON highlight.projection_run_id = $1
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
    FROM outdoor_research_active_projection_runs run
    JOIN outdoor_evidence_regions region
      ON region.region_id = run.region_id
     AND region.enabled = true
     AND region.active_import_id = run.input_import_id
    JOIN outdoor_evidence_imports import
      ON import.import_id = run.input_import_id
     AND import.region_id = run.region_id
     AND import.status = 'active'
   WHERE run.projection_run_id = $1
     AND run.region_id = $2
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
         ST_Y(highlight.evidence_point)::double precision AS evidence_latitude,
         ST_X(highlight.evidence_point)::double precision AS evidence_longitude,
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
              ON projected_category.projection_run_id = trail.projection_run_id
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
                   ON restriction.assertion_id = restriction_link.assertion_id
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
         AND eligible.poi_to_access_distance_meters <= $4::double precision
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
 LIMIT $8`;

export class PostgresOutdoorResearchRepository {
  constructor(options = {}) {
    if (!options.pool?.connect) {
      throw outdoorResearchExecutorError("database_unavailable");
    }
    const policy = OUTDOOR_RESEARCH_EXECUTOR_POLICY_V1;
    this.pool = options.pool;
    if (
      options.cancellationPool !== undefined &&
      (
        !options.cancellationPool?.connect ||
        options.cancellationPool === options.pool
      )
    ) {
      throw outdoorResearchExecutorError("invalid_dependencies");
    }
    this.cancellationPool = options.cancellationPool;
    this.statementTimeoutMs = boundedExecutorTimeout(
      options.statementTimeoutMs,
      policy.defaultStatementTimeoutMs,
      policy.minimumStatementTimeoutMs,
      policy.maximumStatementTimeoutMs
    );
    if (
      options.transactionLifecycleObserver !== undefined &&
      typeof options.transactionLifecycleObserver !== "function"
    ) {
      throw outdoorResearchExecutorError("invalid_dependencies");
    }
    if (options.transactionLifecycleObserver) {
      TRANSACTION_LIFECYCLE_OBSERVERS.set(
        this,
        options.transactionLifecycleObserver
      );
    }
  }

  async withConsistentSnapshot(context, work) {
    if (typeof work !== "function") {
      throw outdoorResearchExecutorError("invalid_dependencies");
    }
    throwIfAborted(context?.signal);
    let client;
    try {
      client = await this.pool.connect();
    } catch (error) {
      throw outdoorResearchExecutorError("database_unavailable", { cause: error });
    }
    let transactionActive = false;
    let snapshotSession = null;
    let cancellationPromise = null;
    const observeAbort = () => {
      if (
        !this.cancellationPool ||
        !transactionActive ||
        cancellationPromise !== null ||
        snapshotSession?.queryActive !== true
      ) {
        return;
      }
      cancellationPromise = cancelActivePostgresQuery(
        this.cancellationPool,
        client.processID
      );
    };
    try {
      throwIfAborted(context?.signal);
      await client.query(
        "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
      );
      transactionActive = true;
      observeTransactionLifecycle(this, "began");
      await client.query("SELECT set_config('statement_timeout', $1, true)", [
        `${this.statementTimeoutMs}ms`
      ]);
      snapshotSession = new PostgresOutdoorResearchSnapshotSession(
        client,
        context?.signal
      );
      context?.signal?.addEventListener?.("abort", observeAbort, {
        once: true
      });
      if (context?.signal?.aborted) observeAbort();
      throwIfAborted(context?.signal);
      const result = await work(snapshotSession);
      throwIfAborted(context?.signal);
      await client.query("COMMIT");
      transactionActive = false;
      return result;
    } catch (error) {
      const cancellationAccepted = cancellationPromise === null
        ? false
        : await cancellationPromise;
      const queryCancellationObserved =
        cancellationAccepted &&
        snapshotSession?.queryCancelledAfterAbort === true;
      if (queryCancellationObserved) {
        observeTransactionLifecycle(
          this,
          "query_cancelled_after_abort"
        );
      }
      try {
        await client.query("ROLLBACK");
        transactionActive = false;
        if (queryCancellationObserved) {
          observeTransactionLifecycle(
            this,
            "rollback_completed_after_cancel"
          );
        }
      } catch {}
      throw normalizeRepositoryError(error, context?.signal);
    } finally {
      context?.signal?.removeEventListener?.("abort", observeAbort);
      client.release();
    }
  }

}

function observeTransactionLifecycle(repository, event) {
  if (!TRANSACTION_LIFECYCLE_EVENTS.has(event)) return;
  try {
    TRANSACTION_LIFECYCLE_OBSERVERS.get(repository)?.(event);
  } catch {}
}

class PostgresOutdoorResearchSnapshotSession {
  constructor(client, signal) {
    this.client = client;
    this.signal = signal;
    this.queryActive = false;
    this.queryCancelledAfterAbort = false;
  }

  async resolveCapabilities(binding, anchor, now) {
    const result = await this.query(SNAPSHOT_CONTEXT_QUERY, [
      binding.operationalRegionId,
      anchor.longitude,
      anchor.latitude
    ]);
    return deriveCapabilityResult(result.rows[0], binding, now);
  }

  async discoverHighlights(request) {
    const policy = OUTDOOR_RESEARCH_EXECUTOR_POLICY_V1;
    const limit = boundedLimit(
      request.limit,
      policy.maximumHighlightsPerOperation
    );
    const result = await this.query(HIGHLIGHT_QUERY, [
      request.projectionRunId,
      request.operationalRegionId,
      request.anchor.longitude,
      request.anchor.latitude,
      request.entityCategories,
      request.searchRadiusMeters,
      request.predicates,
      limit,
      policy.maximumHighlightTrailSeparationMeters
    ]);
    if (result.rows.length > policy.maximumRepositoryRowsPerOperation) {
      throw outdoorResearchExecutorError("result_too_large");
    }
    return result.rows;
  }

  async retrieveMappedHikingRoutes(request) {
    const policy = OUTDOOR_RESEARCH_EXECUTOR_POLICY_V1;
    const routeLimit = boundedLimit(
      request.limit,
      policy.maximumRoutesPerOperation
    );
    const memberships = await this.query(ROUTE_MEMBERSHIP_QUERY, [
      request.projectionRunId,
      request.operationalRegionId,
      request.anchor.longitude,
      request.anchor.latitude,
      request.searchRadiusMeters,
      routeLimit,
      policy.maximumMembershipsPerRoute
    ]);
    if (memberships.rows.length > policy.maximumRepositoryRowsPerOperation) {
      throw outdoorResearchExecutorError("result_too_large");
    }
    if (memberships.rows.length === 0) {
      return { memberships: [], assertions: [] };
    }
    const entityIds = [...new Set(memberships.rows.flatMap((row) => [
      row.route_entity_id,
      row.segment_entity_id
    ]))].sort();
    const assertionPredicates = request.predicates.filter((predicate) =>
      predicate !== "mapped_hiking_route_membership"
    );
    const assertions = assertionPredicates.length === 0
      ? { rows: [] }
      : await this.query(ROUTE_ASSERTION_QUERY, [
        request.projectionRunId,
        entityIds,
        assertionPredicates,
        policy.maximumRepositoryRowsPerOperation
      ]);
    if (assertions.rows.length > policy.maximumRepositoryRowsPerOperation) {
      throw outdoorResearchExecutorError("result_too_large");
    }
    return { memberships: memberships.rows, assertions: assertions.rows };
  }

  async resolveTrailAccessCandidates(request) {
    const policy = OUTDOOR_RESEARCH_EXECUTOR_POLICY_V1;
    const accessPolicy = RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1;
    if (
      !request ||
      typeof request !== "object" ||
      Array.isArray(request) ||
      Object.keys(request).some((key) => ![
        "projectionRunId",
        "operationalRegionId",
        "highlights",
        "maximumDistanceMeters",
        "maximumCandidatesPerHighlight",
        "eligibleHighwayClasses",
        "highlightCategories",
        "maximumRows"
      ].includes(key)) ||
      !Array.isArray(request.highlights) ||
      request.highlights.length < 1 ||
      request.highlights.length > policy.maximumHighlightsPerOperation ||
      request.maximumDistanceMeters !==
        accessPolicy.maximumPoiToTrailDistanceMeters ||
      !Number.isInteger(request.maximumCandidatesPerHighlight) ||
      request.maximumCandidatesPerHighlight < 1 ||
      request.maximumCandidatesPerHighlight >
        accessPolicy.limits.maximumCandidatesPerHighlight ||
      !Number.isInteger(request.maximumRows) ||
      request.maximumRows < 1 ||
      request.maximumRows > accessPolicy.limits.maximumCandidates ||
      !Array.isArray(request.eligibleHighwayClasses) ||
      request.eligibleHighwayClasses.length !==
        accessPolicy.eligibleHighwayClasses.length ||
      request.eligibleHighwayClasses.some(
        (value, index) =>
          value !== accessPolicy.eligibleHighwayClasses[index]
      ) ||
      !Array.isArray(request.highlightCategories) ||
      request.highlightCategories.length !==
        accessPolicy.highlightCategories.length ||
      request.highlightCategories.some(
        (value, index) => value !== accessPolicy.highlightCategories[index]
      )
    ) {
      throw outdoorResearchExecutorError("operation_scope_violation");
    }
    const entityIds = request.highlights.map((item) => item.entityId);
    if (new Set(entityIds).size !== entityIds.length) {
      throw outdoorResearchExecutorError("operation_scope_violation");
    }
    const result = await this.query(TRAIL_ACCESS_CANDIDATE_QUERY, [
      request.projectionRunId,
      request.operationalRegionId,
      entityIds,
      request.maximumDistanceMeters,
      request.maximumCandidatesPerHighlight,
      request.eligibleHighwayClasses,
      request.highlightCategories,
      request.maximumRows
    ]);
    if (result.rows.length > request.maximumRows) {
      throw outdoorResearchExecutorError("result_too_large");
    }
    return result.rows;
  }

  async query(text, values) {
    throwIfAborted(this.signal);
    let result;
    this.queryActive = true;
    try {
      result = await this.client.query(text, values);
    } catch (error) {
      if (
        this.signal?.aborted === true &&
        error?.code === "57014"
      ) {
        this.queryCancelledAfterAbort = true;
      }
      throw normalizeRepositoryError(error, this.signal);
    } finally {
      this.queryActive = false;
    }
    throwIfAborted(this.signal);
    return result;
  }
}

async function cancelActivePostgresQuery(pool, processId) {
  if (!Number.isInteger(processId) || processId < 1) return false;
  let cancellationClient;
  try {
    cancellationClient = await pool.connect();
    const result = await cancellationClient.query(
      "SELECT pg_cancel_backend($1) AS cancelled",
      [processId]
    );
    return result.rows?.[0]?.cancelled === true;
  } catch {
    return false;
  } finally {
    cancellationClient?.release();
  }
}

function deriveCapabilityResult(row, binding, nowInput) {
  const emptyCapabilities = () => validateResearchPlannerCapabilitiesV1({});
  if (!row) {
    return freeze({
      availabilityState: "source_unavailable",
      capabilities: emptyCapabilities(),
      snapshot: null
    });
  }
  if (row.anchor_inside !== true) {
    return freeze({
      availabilityState: "outside_region",
      capabilities: emptyCapabilities(),
      snapshot: null
    });
  }
  const now = validDate(nowInput, "invalid_dependencies");
  const sourceDataAt = dateOrUndefined(row.source_data_at);
  const retrievedAt = dateOrUndefined(row.import_retrieved_at);
  const importedAt = dateOrUndefined(row.imported_at);
  const policy = recognizedOsmProjectionPolicy(row.source_policy_version);
  const activeState =
    row.region_enabled === true &&
    row.active_import_id &&
    row.import_status === "active" &&
    row.projection_run_id &&
    row.input_import_id === row.active_import_id &&
    row.source_key === "osm_foundational_data" &&
    row.source_category === "openstreetmap_open_mapping" &&
    row.source_lifecycle_state === "active" &&
    row.source_normalized_facts_allowed === true &&
    row.policy_lifecycle_state === "active" &&
    row.policy_normalized_facts_allowed === true &&
    row.policy_derived_features_allowed === false &&
    policy &&
    Number.isInteger(Number(row.freshness_threshold_days)) &&
    Number(row.freshness_threshold_days) >= 1 &&
    Number(row.freshness_threshold_days) <= 365 &&
    Number(row.maximum_input_age_days) === policy.maximumInputAgeDays &&
    row.policy_schema_version === policy.policySchemaVersion &&
    row.adapter_schema_version === policy.adapterSchemaVersion &&
    exactScopeSetMatches(row.policy_scopes) &&
    exactScopeSetMatches(row.authority_scopes) &&
    exactRelationshipScopeSetMatches(row.relationship_scopes);
  if (!activeState || !sourceDataAt || !retrievedAt || !importedAt ||
      sourceDataAt > retrievedAt || retrievedAt > importedAt || importedAt > now) {
    return freeze({
      availabilityState: "source_unavailable",
      capabilities: emptyCapabilities(),
      snapshot: null
    });
  }
  const maximumAgeMilliseconds = minimumFreshnessMilliseconds(row, policy);
  if (!Number.isFinite(maximumAgeMilliseconds) ||
      now.getTime() - sourceDataAt.getTime() > maximumAgeMilliseconds ||
      sourceDataAt > now) {
    return freeze({
      availabilityState: "source_stale",
      capabilities: emptyCapabilities(),
      snapshot: null
    });
  }

  const policyPredicates = new Set(row.policy_scopes.map((scope) => scope.predicate));
  const supportedEvidencePredicates = [
    "entity_category",
    "name",
    "operator",
    "access_restriction",
    "trail_difficulty",
    "trail_visibility",
    "viewpoint_presence",
    "waterfall_presence"
  ].filter((predicate) => policyPredicates.has(predicate));
  if (row.relationship_scopes.some((scope) =>
    scope.relationshipType === "trail_segment_member_of_route" &&
    scope.subjectEntityCategory === "trail_segment" &&
    scope.objectEntityCategory === "hiking_route"
  )) {
    supportedEvidencePredicates.push("mapped_hiking_route_membership");
  }
  const enabledOperationTypes = [];
  if (supportedEvidencePredicates.includes("entity_category")) {
    enabledOperationTypes.push("discover_highlights");
  }
  if (supportedEvidencePredicates.includes("entity_category") &&
      supportedEvidencePredicates.includes("mapped_hiking_route_membership")) {
    enabledOperationTypes.push("retrieve_mapped_hiking_routes");
  }
  const capabilities = validateResearchPlannerCapabilitiesV1({
    supportedRegionIds: [binding.regionEntityId],
    availableSourceCategories: ["openstreetmap_open_mapping"],
    supportedEvidencePredicates,
    enabledOperationTypes
  });
  return freeze({
    availabilityState: "active",
    capabilities,
    snapshot: {
      schemaVersion: 1,
      regionEntityId: binding.regionEntityId,
      operationalRegionId: binding.operationalRegionId,
      projectionRunId: row.projection_run_id,
      sourceId: row.source_id,
      sourcePolicyId: row.source_policy_id,
      sourcePolicyVersion: row.source_policy_version,
      adapterSchemaVersion: row.adapter_schema_version,
      importId: row.active_import_id,
      sourceDataAt: sourceDataAt.toISOString(),
      retrievedAt: retrievedAt.toISOString(),
      importedAt: importedAt.toISOString(),
      boundaryDistanceMeters: Math.max(
        0,
        Number(row.boundary_distance_meters)
      ),
      freshnessLimitMilliseconds: maximumAgeMilliseconds,
      source: {
        sourceId: row.source_id,
        sourceKey: row.source_key,
        sourceCategory: row.source_category,
        licenseIdentifier: row.license_identifier,
        attributionRequired: Boolean(row.attribution_requirements)
      }
    }
  });
}

function minimumFreshnessMilliseconds(row, policy) {
  const days = [
    Number(row.freshness_threshold_days),
    Number(row.maximum_input_age_days),
    Number(policy?.maximumInputAgeDays)
  ];
  if (days.some((value) =>
    !Number.isInteger(value) || value < 1 || value > 365
  )) {
    return Number.NaN;
  }
  const values = days.map((value) => value * 86_400_000);
  // expected_refresh_interval_seconds is the publisher acquisition cadence,
  // not a reviewed evidence-expiry policy. Daily extracts can legitimately be
  // older than 24 hours before the next publisher snapshot is available. The
  // projector and repository therefore enforce the same explicit region,
  // source-policy, and recognized-policy maximum-age limits.
  return values.length > 0 ? Math.min(...values) : Number.NaN;
}

function boundedLimit(value, maximum) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw outdoorResearchExecutorError("operation_scope_violation");
  }
  return value;
}

function validDate(value, code) {
  return strictExecutorDateV1(value, code);
}

function dateOrUndefined(value) {
  if (value === null || value === undefined) return undefined;
  return strictExecutorDateV1(value, "malformed_evidence");
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw outdoorResearchExecutorError("request_cancelled");
}

function normalizeRepositoryError(error, signal) {
  if (error instanceof OutdoorResearchExecutorError) return error;
  if (signal?.aborted || error?.name === "AbortError") {
    return outdoorResearchExecutorError("request_cancelled");
  }
  if (error?.code === "57014") {
    return outdoorResearchExecutorError("repository_timed_out", { cause: error });
  }
  return outdoorResearchExecutorError("repository_failed", { cause: error });
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

export const outdoorResearchRepositoryQueriesForTesting = Object.freeze({
  snapshotContext: SNAPSHOT_CONTEXT_QUERY,
  highlights: HIGHLIGHT_QUERY,
  routeMemberships: ROUTE_MEMBERSHIP_QUERY,
  routeAssertions: ROUTE_ASSERTION_QUERY,
  trailAccessCandidates: TRAIL_ACCESS_CANDIDATE_QUERY
});
