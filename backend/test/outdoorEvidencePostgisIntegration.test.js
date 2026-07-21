import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { PostgresOutdoorEvidenceRepository } from "../src/outdoorEvidence/postgresOutdoorEvidenceRepository.js";
import { normalizeCorridorRow } from "../src/outdoorEvidence/outdoorEvidenceService.js";
import { validateOutdoorEvidenceRequest } from "../src/outdoorEvidence/outdoorEvidenceValidation.js";
import { outdoorEvidenceRequest } from "./outdoorEvidenceTestSupport.js";

const { Pool } = pg;
const connectionString = process.env.TRAILMIND_TEST_POSTGIS_DATABASE_URL;

describe("outdoor evidence PostGIS integration", { skip: !connectionString }, () => {
  let administrativePool;
  let testPool;
  let schemaName;

  before(async () => {
    const url = new URL(connectionString);
    if (!/test/i.test(url.pathname)) {
      throw new Error("TRAILMIND_TEST_POSTGIS_DATABASE_URL must name an explicitly disposable test database.");
    }
    schemaName = `trailmind_outdoor_test_${randomUUID().replaceAll("-", "_")}`;
    administrativePool = new Pool({ connectionString, max: 2, allowExitOnIdle: true });
    await administrativePool.query(`CREATE SCHEMA "${schemaName}"`);
    testPool = new Pool({
      connectionString,
      options: `-c search_path=${schemaName},public`,
      max: 3,
      allowExitOnIdle: true
    });
    const migration = await readFile(new URL("../migrations/002_outdoor_evidence.sql", import.meta.url), "utf8");
    await testPool.query(migration);
    await testPool.query(migration);
    await seedFixture(testPool);
  });

  after(async () => {
    if (testPool) await testPool.end();
    if (administrativePool && schemaName) {
      await administrativePool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    }
    if (administrativePool) await administrativePool.end();
  });

  it("uses real metric intersection, route-piece assignment and ST_DWithin", async () => {
    const request = validateOutdoorEvidenceRequest(outdoorEvidenceRequest({
      geometry: [
        { latitude: 51.80, longitude: 10.60 },
        { latitude: 51.80, longitude: 10.62 }
      ]
    }));
    const repository = new PostgresOutdoorEvidenceRepository({ pool: testPool, statementTimeoutMs: 5_000 });
    const row = await repository.queryCorridor(request, { maximumPois: 40 });
    const response = normalizeCorridorRow(request, row, {
      now: new Date("2026-07-20T00:00:00Z"), maximumPois: 40
    });
    assert.equal(response.evidenceStatus, "known");
    assert(response.regions[0].routeCoverageRatio > 0.999);
    assert(response.mappedHikingRouteCoverageRatio > 0.99);
    assert(response.mappedHikingRouteCoverageRatio <= 1);
    assert.equal(response.mappedPoiCounts.viewpoint, 1);
    assert.equal(response.mappedPois[0].sourceIdentity.osmId, "9001");
    assert.equal(response.explicitAccessRestrictions.length, 1);
  });

  it("computes partial regional coverage instead of returning a false zero", async () => {
    const request = validateOutdoorEvidenceRequest(outdoorEvidenceRequest({
      geometry: [
        { latitude: 51.80, longitude: 10.29 },
        { latitude: 51.80, longitude: 10.31 }
      ]
    }));
    const row = await new PostgresOutdoorEvidenceRepository({ pool: testPool })
      .queryCorridor(request, { maximumPois: 40 });
    const response = normalizeCorridorRow(request, row, {
      now: new Date("2026-07-20T00:00:00Z"), maximumPois: 40
    });
    assert.equal(response.regions[0].coverageStatus, "partial");
    assert(response.regions[0].routeCoverageRatio > 0.45 && response.regions[0].routeCoverageRatio < 0.55);
    assert(response.overallRegionalCoverageRatio > 0.45 && response.overallRegionalCoverageRatio < 0.55);
  });

  it("has GiST indexes available for corridor query predicates", async () => {
    const indexes = await testPool.query(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = $1 AND indexname LIKE 'outdoor_evidence_%_gist_idx'
        ORDER BY indexname`,
      [schemaName]
    );
    assert(indexes.rows.some((row) => row.indexname.includes("trail_segments_geom_metric")));
    assert(indexes.rows.some((row) => row.indexname.includes("pois_geom_metric")));
    await testPool.query("SET enable_seqscan = off");
    const plan = await testPool.query(
      `EXPLAIN SELECT osm_id FROM outdoor_evidence_trail_segments
        WHERE geom_metric && ST_Expand(ST_SetSRID(ST_MakePoint(614000, 5740000), 25832), 25)
          AND ST_DWithin(geom_metric, ST_SetSRID(ST_MakePoint(614000, 5740000), 25832), 25)`
    );
    assert.match(plan.rows.map((row) => row["QUERY PLAN"]).join("\n"), /Index Scan|Bitmap Index Scan/);
  });
});

async function seedFixture(pool) {
  const importId = "11111111-1111-4111-8111-111111111111";
  const boundary = {
    type: "Polygon",
    coordinates: [[[10.30, 51.45], [11.35, 51.45], [11.35, 51.98], [10.30, 51.98], [10.30, 51.45]]]
  };
  await pool.query(
    `INSERT INTO outdoor_evidence_regions
       (region_id, name, definition_version, boundary_kind, coordinate_reference_system,
        metric_srid, boundary, boundary_metric, supported_feature_classes,
        freshness_threshold_days, path_match_tolerance_meters)
     VALUES ('harz-v1', 'Harz v1', 1, 'trailmind-operational-polygon', 'EPSG:4326', 25832,
       ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)),
       ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), 25832)),
       ARRAY['viewpoint','trailSegment','hikingRouteRelation'], 14, 25)`,
    [JSON.stringify(boundary)]
  );
  await pool.query(
    `INSERT INTO outdoor_evidence_imports
       (import_id, region_id, source_dataset_name, source_identifier, source_data_at,
        retrieved_at, imported_at, tool_version, import_schema_version, status)
     VALUES ($1, 'harz-v1', 'synthetic-test', 'local-fixture', '2026-07-19T00:00:00Z',
       '2026-07-19T01:00:00Z', '2026-07-19T02:00:00Z', 'test 1.0', 1, 'active')`,
    [importId]
  );
  await pool.query("UPDATE outdoor_evidence_regions SET active_import_id = $1 WHERE region_id = 'harz-v1'", [importId]);
  await pool.query(
    `INSERT INTO outdoor_evidence_trail_segments
       (import_id, region_id, osm_id, highway_class, surface, trail_visibility, sac_scale,
        access_tag, geom, geom_metric)
     VALUES ($1, 'harz-v1', 8001, 'path', 'ground', 'good', 'hiking', 'private',
       ST_Multi(ST_GeomFromText('LINESTRING(10.60 51.80, 10.62 51.80)', 4326)),
       ST_Multi(ST_Transform(ST_GeomFromText('LINESTRING(10.60 51.80, 10.62 51.80)', 4326), 25832)))`,
    [importId]
  );
  for (const relationId of [7001, 7002]) {
    await pool.query(
      `INSERT INTO outdoor_evidence_hiking_relations
         (import_id, region_id, osm_id, route_type, network, state)
       VALUES ($1, 'harz-v1', $2, 'hiking', 'rwn', 'current')`,
      [importId, relationId]
    );
    await pool.query(
      `INSERT INTO outdoor_evidence_hiking_relation_members
         (import_id, region_id, relation_osm_id, segment_osm_id, member_sequence)
       VALUES ($1, 'harz-v1', $2, 8001, 0)`,
      [importId, relationId]
    );
  }
  await pool.query(
    `INSERT INTO outdoor_evidence_pois
       (import_id, region_id, osm_type, osm_id, category, name, geom, geom_metric)
     VALUES ($1, 'harz-v1', 'node', 9001, 'viewpoint', 'Synthetic mapped viewpoint',
       ST_SetSRID(ST_MakePoint(10.61, 51.8001), 4326),
       ST_Transform(ST_SetSRID(ST_MakePoint(10.61, 51.8001), 4326), 25832))`,
    [importId]
  );
}
