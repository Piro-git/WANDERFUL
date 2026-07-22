import { outdoorEvidenceError } from "./outdoorEvidenceErrors.js";

const CORRIDOR_QUERY = `
WITH input AS (
  SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)::geometry(LineString, 4326) AS route_wgs84,
         $2::double precision AS corridor_width_meters
), region_intersections AS (
  SELECT r.region_id, r.name AS region_name, r.metric_srid, r.boundary,
         r.freshness_threshold_days, r.path_match_tolerance_meters,
         r.active_import_id AS import_id,
         i.source_dataset_name, i.source_identifier, i.source_data_at,
         i.imported_at, i.status AS import_status,
         input.route_wgs84, input.corridor_width_meters,
         ST_CollectionExtract(ST_Intersection(input.route_wgs84, r.boundary), 2)
           AS covered_route_wgs84
    FROM outdoor_evidence_regions r
    CROSS JOIN input
    LEFT JOIN outdoor_evidence_imports i ON i.import_id = r.active_import_id
   WHERE r.enabled = true
     AND ST_Intersects(r.boundary, input.route_wgs84)
), region_context AS (
  SELECT region_intersections.*,
         ST_Length(covered_route_wgs84::geography)::double precision AS covered_length_meters,
         row_number() OVER (
           ORDER BY ST_Length(covered_route_wgs84::geography) DESC, region_id
         ) AS selection_rank
    FROM region_intersections
   WHERE NOT ST_IsEmpty(covered_route_wgs84)
     AND ST_Length(covered_route_wgs84::geography) > 0
), route_context AS (
  SELECT input.route_wgs84, input.corridor_width_meters,
         ST_Length(input.route_wgs84::geography)::double precision AS route_length_meters,
         ST_UnaryUnion(ST_Collect(region_context.covered_route_wgs84)) AS covered_route_wgs84
    FROM input
    LEFT JOIN region_context ON true
   GROUP BY input.route_wgs84, input.corridor_width_meters
), route_pieces AS (
  SELECT row_number() OVER (ORDER BY line.path, segment.path) AS piece_id,
         segment.geom::geometry(LineString, 4326) AS geom,
         ST_Length(segment.geom::geography)::double precision AS length_meters
    FROM route_context context
    CROSS JOIN LATERAL ST_Dump(
      ST_CollectionExtract(context.covered_route_wgs84, 2)
    ) AS line
    CROSS JOIN LATERAL ST_DumpSegments(
      ST_Segmentize(line.geom::geography, 25)::geometry
    ) AS segment
   WHERE context.covered_route_wgs84 IS NOT NULL
), assigned_pieces AS (
  SELECT piece.piece_id, piece.length_meters,
         matched.osm_id AS segment_osm_id,
         matched.highway_class, matched.surface, matched.trail_visibility,
         matched.sac_scale, matched.access_tag, matched.foot_tag,
         matched.access_conditional, matched.foot_conditional,
         matched.seasonal_tag, matched.permit_tag,
         CASE WHEN matched.osm_id IS NULL THEN false ELSE EXISTS (
           SELECT 1
             FROM outdoor_evidence_hiking_relation_members member
            WHERE member.import_id = matched.import_id
              AND member.segment_osm_type = 'way'
              AND member.segment_osm_id = matched.osm_id
         ) END AS mapped_hiking_relation
    FROM route_pieces piece
    LEFT JOIN LATERAL (
      SELECT segment.*, context.selection_rank,
             ST_Distance(
               segment.geom_metric,
               ST_Transform(piece.geom, context.metric_srid)
             ) AS match_distance
        FROM region_context context
        JOIN outdoor_evidence_trail_segments segment
          ON context.import_status = 'active'
         AND segment.region_id = context.region_id
         AND segment.import_id = context.import_id
         AND ST_SRID(segment.geom_metric) = context.metric_srid
       WHERE ST_DWithin(context.covered_route_wgs84::geography, piece.geom::geography, 1)
         AND segment.geom_metric && ST_Expand(
               ST_Transform(piece.geom, context.metric_srid),
               LEAST(context.corridor_width_meters, context.path_match_tolerance_meters)
             )
         AND ST_DWithin(
               segment.geom_metric,
               ST_Transform(piece.geom, context.metric_srid),
               LEAST(context.corridor_width_meters, context.path_match_tolerance_meters)
             )
       ORDER BY match_distance, context.selection_rank, segment.osm_id
       LIMIT 1
    ) matched ON true
), summary AS (
  SELECT COALESCE(sum(length_meters), 0)::double precision AS covered_length_meters,
         COALESCE(sum(length_meters) FILTER (WHERE segment_osm_id IS NOT NULL), 0)::double precision
           AS highway_coverage_meters,
         COALESCE(sum(length_meters) FILTER (WHERE surface IS NOT NULL), 0)::double precision
           AS surface_coverage_meters,
         COALESCE(sum(length_meters) FILTER (WHERE trail_visibility IS NOT NULL), 0)::double precision
           AS trail_visibility_coverage_meters,
         COALESCE(sum(length_meters) FILTER (WHERE sac_scale IS NOT NULL), 0)::double precision
           AS sac_scale_coverage_meters,
         COALESCE(sum(length_meters) FILTER (
           WHERE access_tag IS NOT NULL OR foot_tag IS NOT NULL OR
                 access_conditional IS NOT NULL OR foot_conditional IS NOT NULL OR
                 seasonal_tag IS NOT NULL OR permit_tag IS NOT NULL
         ), 0)::double precision AS access_coverage_meters,
         COALESCE(sum(length_meters) FILTER (WHERE mapped_hiking_relation), 0)::double precision
           AS mapped_hiking_relation_meters,
         max(CASE sac_scale
           WHEN 'strolling' THEN 1 WHEN 'hiking' THEN 2 WHEN 'mountain_hiking' THEN 3
           WHEN 'demanding_mountain_hiking' THEN 4 WHEN 'alpine_hiking' THEN 5
           WHEN 'demanding_alpine_hiking' THEN 6 WHEN 'difficult_alpine_hiking' THEN 7
           ELSE NULL END) AS maximum_sac_scale_rank
    FROM assigned_pieces
), highway_breakdown AS (
  SELECT highway_class AS value, sum(length_meters)::double precision AS length_meters
    FROM assigned_pieces WHERE segment_osm_id IS NOT NULL
   GROUP BY highway_class ORDER BY highway_class
), surface_breakdown AS (
  SELECT surface AS value, sum(length_meters)::double precision AS length_meters
    FROM assigned_pieces WHERE surface IS NOT NULL
   GROUP BY surface ORDER BY surface
), visibility_breakdown AS (
  SELECT trail_visibility AS value, sum(length_meters)::double precision AS length_meters
    FROM assigned_pieces WHERE trail_visibility IS NOT NULL
   GROUP BY trail_visibility ORDER BY trail_visibility
), sac_breakdown AS (
  SELECT sac_scale AS value, sum(length_meters)::double precision AS length_meters
    FROM assigned_pieces WHERE sac_scale IS NOT NULL
   GROUP BY sac_scale ORDER BY sac_scale
), restriction_segments AS (
  SELECT DISTINCT ON (segment_osm_id)
         segment_osm_id, access_tag, foot_tag,
         (access_conditional IS NOT NULL OR foot_conditional IS NOT NULL) AS conditional,
         COALESCE(seasonal_tag = 'yes', false) AS seasonal,
         COALESCE(permit_tag IN ('yes', 'required'), false) AS permit_required
    FROM assigned_pieces
   WHERE segment_osm_id IS NOT NULL
     AND (
       access_tag IN ('no', 'private', 'customers', 'delivery', 'agricultural', 'forestry', 'permit', 'use_sidepath') OR
       foot_tag IN ('no', 'private', 'customers', 'delivery', 'agricultural', 'forestry', 'permit', 'use_sidepath') OR
       access_conditional IS NOT NULL OR foot_conditional IS NOT NULL OR
       seasonal_tag = 'yes' OR permit_tag IN ('yes', 'required')
     )
   ORDER BY segment_osm_id, access_tag NULLS LAST, foot_tag NULLS LAST
), nearby_poi_candidates AS (
  SELECT poi.osm_type, poi.osm_id, poi.category, poi.name,
         context.region_id, context.import_id, context.source_dataset_name,
         context.selection_rank,
         ST_Distance(
           poi.geom_metric,
           ST_Transform(context.covered_route_wgs84, context.metric_srid)
         )::double precision AS distance_meters,
         ST_X(ST_Transform(ST_PointOnSurface(poi.geom_metric), 4326))::double precision AS longitude,
         ST_Y(ST_Transform(ST_PointOnSurface(poi.geom_metric), 4326))::double precision AS latitude,
         poi.source_version, poi.source_timestamp
    FROM region_context context
    JOIN outdoor_evidence_pois poi
      ON context.import_status = 'active'
     AND poi.region_id = context.region_id
     AND poi.import_id = context.import_id
     AND ST_SRID(poi.geom_metric) = context.metric_srid
     AND poi.geom_metric && ST_Expand(
           ST_Transform(context.covered_route_wgs84, context.metric_srid),
           context.corridor_width_meters
         )
     AND ST_DWithin(
           poi.geom_metric,
           ST_Transform(context.covered_route_wgs84, context.metric_srid),
           context.corridor_width_meters
         )
), deduplicated_pois AS (
  SELECT *
    FROM (
      SELECT candidate.*,
             row_number() OVER (
               PARTITION BY osm_type, osm_id
               ORDER BY distance_meters, selection_rank, import_id
             ) AS identity_rank
        FROM nearby_poi_candidates candidate
    ) ranked
   WHERE identity_rank = 1
), poi_counts AS (
  SELECT category, count(*)::integer AS count
    FROM deduplicated_pois GROUP BY category ORDER BY category
), bounded_pois AS (
  SELECT * FROM deduplicated_pois
   ORDER BY distance_meters, category, osm_type, osm_id
   LIMIT $3
), region_payload AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', region_id,
           'name', region_name,
           'coveredLengthMeters', covered_length_meters,
           'freshnessThresholdDays', freshness_threshold_days,
           'importId', import_id,
           'importStatus', import_status,
           'sourceDataset', source_dataset_name,
           'sourceIdentifier', source_identifier,
           'sourceDataTimestamp', source_data_at,
           'importedTimestamp', imported_at
         ) ORDER BY selection_rank), '[]'::jsonb) AS regions
    FROM region_context
)
SELECT context.route_length_meters,
       summary.covered_length_meters,
       summary.highway_coverage_meters,
       summary.surface_coverage_meters,
       summary.trail_visibility_coverage_meters,
       summary.sac_scale_coverage_meters,
       summary.access_coverage_meters,
       summary.mapped_hiking_relation_meters,
       summary.maximum_sac_scale_rank,
       region_payload.regions,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'value', value, 'lengthMeters', length_meters
       ) ORDER BY value) FROM highway_breakdown), '[]'::jsonb) AS highway_breakdown,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'value', value, 'lengthMeters', length_meters
       ) ORDER BY value) FROM surface_breakdown), '[]'::jsonb) AS surface_breakdown,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'value', value, 'lengthMeters', length_meters
       ) ORDER BY value) FROM visibility_breakdown), '[]'::jsonb) AS trail_visibility_breakdown,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'value', value, 'lengthMeters', length_meters
       ) ORDER BY value) FROM sac_breakdown), '[]'::jsonb) AS sac_scale_breakdown,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'osmType', 'way', 'osmId', segment_osm_id::text, 'access', access_tag,
         'foot', foot_tag, 'conditional', conditional, 'seasonal', seasonal,
         'permitRequired', permit_required
       ) ORDER BY segment_osm_id) FROM (
         SELECT * FROM restriction_segments ORDER BY segment_osm_id LIMIT 25
       ) restrictions), '[]'::jsonb) AS explicit_access_restrictions,
       COALESCE((SELECT jsonb_object_agg(category, count) FROM poi_counts), '{}'::jsonb)
         AS mapped_poi_counts,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'osmType', osm_type, 'osmId', osm_id::text, 'category', category, 'name', name,
         'latitude', latitude, 'longitude', longitude,
         'distanceFromRouteMeters', distance_meters,
         'regionId', region_id, 'importId', import_id::text,
         'sourceDataset', source_dataset_name,
         'sourceVersion', source_version, 'sourceTimestamp', source_timestamp
       ) ORDER BY distance_meters, category, osm_type, osm_id) FROM bounded_pois), '[]'::jsonb)
         AS mapped_pois
  FROM route_context context
  CROSS JOIN summary
  CROSS JOIN region_payload`;

export class PostgresOutdoorEvidenceRepository {
  isDurable = true;

  constructor(options = {}) {
    if (!options.pool?.connect || !options.pool?.query) {
      throw outdoorEvidenceError("evidence_unavailable");
    }
    this.pool = options.pool;
    this.statementTimeoutMs = boundedInteger(options.statementTimeoutMs, 2_500, 100, 15_000);
  }

  async queryCorridor(request, context = {}) {
    if (context.signal?.aborted) throw outdoorEvidenceError("request_cancelled");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SELECT set_config('statement_timeout', $1, true)", [
        `${this.statementTimeoutMs}ms`
      ]);
      if (context.signal?.aborted) throw outdoorEvidenceError("request_cancelled");
      const result = await client.query(CORRIDOR_QUERY, [
        JSON.stringify(request.routeGeoJSON),
        request.corridorWidthMeters,
        context.maximumPois ?? 40
      ]);
      if (context.signal?.aborted) throw outdoorEvidenceError("request_cancelled");
      await client.query("COMMIT");
      return result.rows[0];
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      if (error instanceof Error && error.name === "OutdoorEvidenceError") throw error;
      if (context.signal?.aborted) throw outdoorEvidenceError("request_cancelled");
      if (error?.code === "57014") throw outdoorEvidenceError("evidence_timed_out");
      throw outdoorEvidenceError("evidence_unavailable", { cause: error });
    } finally {
      client.release();
    }
  }
}

export function postgresOutdoorEvidenceRepositoryFromRuntime(options = {}) {
  const pool = options.pool ?? options.appAttestRepository?.pool;
  if (!pool) return undefined;
  return new PostgresOutdoorEvidenceRepository({
    pool,
    statementTimeoutMs: options.statementTimeoutMs
  });
}

export const outdoorEvidenceCorridorQueryForTesting = CORRIDOR_QUERY;

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined) return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}
