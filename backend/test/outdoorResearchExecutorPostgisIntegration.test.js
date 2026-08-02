import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import {
  planAndRouteOutdoorAdventureV1
} from "../src/outdoorAdventure/outdoorAdventureOrchestrator.js";
import {
  validateOutdoorAdventurePlanningResponseV1
} from "../src/outdoorAdventure/orchestrationContract.js";
import {
  OSM_POLICY_ACTIVATION_CONFIRMATION,
  OSM_POLICY_REVOCATION_CONFIRMATION,
  OSM_PROJECTION_POLICY_VERSION
} from "../src/outdoorResearch/osmProjectionPolicy.js";
import {
  researchOutdoorAdventureV1
} from "../src/outdoorResearch/outdoorResearchExecutor.js";
import {
  outdoorResearchRepositoryQueriesForTesting,
  PostgresOutdoorResearchRepository
} from "../src/outdoorResearch/postgresOutdoorResearchRepository.js";
import {
  configureOsmProjectionPolicy
} from "../src/outdoorResearch/postgresOsmProjectionPolicyRepository.js";
import {
  OUTDOOR_RESEARCH_REGION_BINDINGS_V1
} from "../src/outdoorResearch/regionBindings.js";

const { Pool } = pg;
const connectionString = process.env.TRAILMIND_TEST_POSTGIS_DATABASE_URL;
const NOW = new Date("2026-07-24T10:30:00.000Z");
const REVIEWED_AT = "2026-07-20T09:00:00.000Z";
const REGIONS = Object.freeze([
  {
    operationalRegionId: "harz-v1",
    anchor: { latitude: 51.8, longitude: 10.6 },
    envelope: [10.4, 51.65, 10.8, 51.95],
    osmBase: 1000,
    hashCharacter: "a"
  },
  {
    operationalRegionId: "innsbruck-alps-v1",
    anchor: { latitude: 47.2692, longitude: 11.4041 },
    envelope: [11.2, 47.15, 11.6, 47.4],
    osmBase: 2000,
    hashCharacter: "b"
  }
]);

describe("outdoor research executor real PostGIS integration", {
  skip: !connectionString
}, () => {
  let administrativePool;
  let pool;
  let schemaName;
  let seeded;
  let sourceId;
  let policyId;

  before(async () => {
    const url = new URL(connectionString);
    if (!/test/i.test(url.pathname)) {
      throw new Error(
        "TRAILMIND_TEST_POSTGIS_DATABASE_URL must name a disposable test database."
      );
    }
    schemaName = `trailmind_executor_${randomUUID().replaceAll("-", "_")}`;
    administrativePool = new Pool({
      connectionString,
      max: 2,
      allowExitOnIdle: true
    });
    await administrativePool.query("CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public");
    await administrativePool.query(`CREATE SCHEMA "${schemaName}"`);
    pool = new Pool({
      connectionString,
      options: `-c search_path=${schemaName},public`,
      max: 6,
      allowExitOnIdle: true
    });
    for (const migrationName of [
      "002_outdoor_evidence.sql",
      "003_outdoor_research_graph.sql",
      "004_osm_outdoor_research_projection.sql",
      "005_outdoor_research_projection_geometry.sql"
    ]) {
      const migration = await readFile(
        new URL(`../migrations/${migrationName}`, import.meta.url),
        "utf8"
      );
      await pool.query(migration);
      await pool.query(migration);
    }
    const configured = await configureOsmProjectionPolicy({
      pool,
      mode: "activate",
      policyVersion: OSM_PROJECTION_POLICY_VERSION,
      operatorConfirmation: OSM_POLICY_ACTIVATION_CONFIRMATION,
      reviewReference: "tests/outdoor-research-executor-v1",
      reviewedAt: REVIEWED_AT,
      now: () => NOW
    });
    sourceId = configured.sourceId;
    const policy = await pool.query(
      `SELECT source_policy_id
         FROM outdoor_research_source_policies
        WHERE source_id = $1
          AND policy_version = $2
          AND lifecycle_state = 'active'`,
      [sourceId, OSM_PROJECTION_POLICY_VERSION]
    );
    policyId = policy.rows[0].source_policy_id;
    seeded = new Map();
    for (const region of REGIONS) {
      seeded.set(
        region.operationalRegionId,
        await seedRegion(pool, region, sourceId, policyId)
      );
    }
  });

  after(async () => {
    if (pool) await pool.end();
    if (administrativePool && schemaName) {
      await administrativePool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    }
    if (administrativePool) await administrativePool.end();
  });

  it("applies migrations 002/003/004 twice and retains spatial indexes", async () => {
    const relations = await pool.query(
      `SELECT to_regclass('outdoor_evidence_regions') IS NOT NULL AS regions,
              to_regclass('outdoor_research_sources') IS NOT NULL AS sources,
              to_regclass('outdoor_research_projection_runs') IS NOT NULL AS runs`
    );
    assert.deepEqual(relations.rows[0], {
      regions: true,
      sources: true,
      runs: true
    });
    const indexes = await pool.query(
      `SELECT indexname
         FROM pg_indexes
        WHERE schemaname = $1
          AND indexname IN (
            'outdoor_evidence_regions_boundary_gist_idx',
            'outdoor_research_projection_entities_geometry_gist_idx',
            'outdoor_research_projection_assertions_lookup_idx',
            'outdoor_research_projection_relationships_subject_idx'
          )`,
      [schemaName]
    );
    assert.equal(indexes.rowCount, 4);
  });

  it("resolves exact Harz and Innsbruck boundaries without cross-region leakage", async () => {
    for (const region of REGIONS) {
      const result = await execute(region);
      const ids = seeded.get(region.operationalRegionId);
      const other = seeded.get(REGIONS.find((item) =>
        item.operationalRegionId !== region.operationalRegionId
      ).operationalRegionId);
      assert.equal(result.state, "ready");
      assert.deepEqual(result.dossier.regionCoverage.regionEntityIds, [
        binding(region).regionEntityId
      ]);
      assert.deepEqual(
        result.dossier.candidateHighlights.map((candidate) => candidate.entityId),
        [ids.viewpointId, ids.hutId]
      );
      assert.equal(
        result.dossier.evidenceClaims.some((claim) =>
          Object.values(other).includes(claim.entityId)),
        false
      );
    }
  });

  it("orchestrates real Harz and Innsbruck snapshots through deterministic fake routing", async () => {
    for (const region of REGIONS) {
      const repository = new PostgresOutdoorResearchRepository({
        pool,
        statementTimeoutMs: 2_000
      });
      const result = await planAndRouteOutdoorAdventureV1(
        {
          schemaVersion: 1,
          intent: intent(region, {
            requiredFacilities: [],
            preferredExperiences: []
          })
        },
        {
          repository,
          clock: () => NOW,
          provider: {
            async route(request) {
              return deterministicProviderResponse(request);
            }
          }
        },
        {
          maximumProposals: 2,
          maximumConcurrency: 2,
          researchTimeoutMs: 5_000,
          graphHopperAttemptTimeoutMs: 5_000,
          totalDeadlineMs: 15_000
        }
      );
      assert(["partial", "routed"].includes(result.state));
      assert(result.routedAlternatives.attempts.length >= 1);
      assert(result.routedAlternatives.attempts.every((attempt) =>
        attempt.state === "routed"
      ));
      assert.doesNotThrow(() =>
        validateOutdoorAdventurePlanningResponseV1(result)
      );
    }
  });

  it("reads active projection assertions and mapped route memberships with provenance", async () => {
    const repository = new PostgresOutdoorResearchRepository({
      pool,
      statementTimeoutMs: 2_000
    });
    const rawRoutes = await repository.withConsistentSnapshot({}, async (session) => {
      const capabilities = await session.resolveCapabilities(
        binding(REGIONS[0]),
        REGIONS[0].anchor,
        NOW
      );
      return session.retrieveMappedHikingRoutes({
        projectionRunId: capabilities.snapshot.projectionRunId,
        operationalRegionId: "harz-v1",
        anchor: REGIONS[0].anchor,
        predicates: ["mapped_hiking_route_membership"],
        searchRadiusMeters: 10_000,
        limit: 1
      });
    });
    assert.equal(rawRoutes.memberships[0].evidence_class, "mapped");

    const result = await execute(REGIONS[0]);
    const ids = seeded.get("harz-v1");
    assert.equal(result.dossier.mappedOrOfficialRouteCandidates.length, 1);
    assert.equal(
      result.dossier.mappedOrOfficialRouteCandidates[0].entityId,
      ids.routeId
    );
    assert.equal(
      result.dossier.mappedOrOfficialRouteCandidates[0].sourceBasis,
      "mapped"
    );
    const membership = result.dossier.evidenceClaims.find((claim) =>
      claim.predicate === "mapped_hiking_route_membership"
    );
    assert.equal(membership.entityId, ids.routeId);
    assert.deepEqual(membership.value, {
      type: "entity_reference",
      value: ids.segmentId
    });
    assert.equal(membership.provenance.recordVersion, 7);
    assert.equal(
      result.dossier.sourceProvenanceSummary[0].licenseIdentifier,
      "ODbL-1.0"
    );
    assert(result.dossier.candidateHighlights.every((candidate) =>
      candidate.knownLimitations.includes("route_connection_unverified")
    ));
    assert(result.dossier.evidenceGaps.some((gap) =>
      gap.code === "missing_route_connection" &&
      gap.predicate === null
    ));
  });

  it("does not promote an evidence-valid highlight far from the mapped trail network", async () => {
    const region = REGIONS[0];
    const ids = seeded.get(region.operationalRegionId);
    const isolatedAnchor = {
      longitude: region.anchor.longitude + 0.05,
      latitude: region.anchor.latitude + 0.05
    };
    await insertProjectedViewpoint({
      pool,
      sourceId,
      projectionRunId: ids.runId,
      operationalRegionId: region.operationalRegionId,
      osmId: region.osmBase + 99,
      coordinate: isolatedAnchor
    });
    const repository = new PostgresOutdoorResearchRepository({
      pool,
      statementTimeoutMs: 2_000
    });
    const rows = await repository.withConsistentSnapshot({}, async (session) => {
      const capabilities = await session.resolveCapabilities(
        binding(region),
        region.anchor,
        NOW
      );
      return session.discoverHighlights({
        projectionRunId: capabilities.snapshot.projectionRunId,
        operationalRegionId: region.operationalRegionId,
        anchor: isolatedAnchor,
        entityCategories: ["viewpoint"],
        predicates: ["entity_category", "viewpoint_presence"],
        searchRadiusMeters: 500,
        limit: 12
      });
    });
    assert.deepEqual(rows, []);
  });

  it("enforces the 75 m mapped-trail boundary in metres without latitude prefilter loss", async () => {
    const region = REGIONS[0];
    const ids = seeded.get(region.operationalRegionId);
    const trailPoint = {
      longitude: region.anchor.longitude + 0.015,
      latitude: region.anchor.latitude
    };
    const distances = [74.9, 75, 75.1];
    const inserted = [];
    for (const [index, distanceMeters] of distances.entries()) {
      const coordinate = await projectCoordinate(
        pool,
        trailPoint,
        distanceMeters,
        0
      );
      inserted.push({
        distanceMeters,
        coordinate,
        entityId: await insertProjectedViewpoint({
          pool,
          sourceId,
          projectionRunId: ids.runId,
          operationalRegionId: region.operationalRegionId,
          osmId: region.osmBase + 110 + index,
          coordinate
        })
      });
    }
    const repository = new PostgresOutdoorResearchRepository({
      pool,
      statementTimeoutMs: 2_000
    });
    const rows = await repository.withConsistentSnapshot({}, async (session) => {
      const capabilities = await session.resolveCapabilities(
        binding(region),
        region.anchor,
        NOW
      );
      return session.discoverHighlights({
        projectionRunId: capabilities.snapshot.projectionRunId,
        operationalRegionId: region.operationalRegionId,
        anchor: trailPoint,
        entityCategories: ["viewpoint"],
        predicates: ["entity_category", "viewpoint_presence"],
        searchRadiusMeters: 500,
        limit: 12
      });
    });
    const returnedIds = new Set(rows.map((row) => row.entity_id));
    assert.equal(returnedIds.has(inserted[0].entityId), true);
    assert.equal(returnedIds.has(inserted[1].entityId), true);
    assert.equal(returnedIds.has(inserted[2].entityId), false);
    for (const expected of inserted.slice(0, 2)) {
      const row = rows.find((item) => item.entity_id === expected.entityId);
      assert.ok(row);
      assert.ok(Math.abs(row.latitude - expected.coordinate.latitude) < 1e-9);
      assert.ok(Math.abs(row.longitude - expected.coordinate.longitude) < 1e-9);
    }
  });

  it("keeps the candidate-radius GiST prefilter complete east-west", async () => {
    const region = REGIONS[0];
    const ids = seeded.get(region.operationalRegionId);
    const distances = [499.9, 500, 500.1];
    const inserted = [];
    for (const [index, distanceMeters] of distances.entries()) {
      const coordinate = await projectCoordinate(
        pool,
        region.anchor,
        distanceMeters,
        Math.PI / 2
      );
      inserted.push({
        entityId: await insertProjectedViewpoint({
          pool,
          sourceId,
          projectionRunId: ids.runId,
          operationalRegionId: region.operationalRegionId,
          osmId: region.osmBase + 120 + index,
          coordinate
        })
      });
    }
    const repository = new PostgresOutdoorResearchRepository({
      pool,
      statementTimeoutMs: 2_000
    });
    const rows = await repository.withConsistentSnapshot({}, async (session) => {
      const capabilities = await session.resolveCapabilities(
        binding(region),
        region.anchor,
        NOW
      );
      return session.discoverHighlights({
        projectionRunId: capabilities.snapshot.projectionRunId,
        operationalRegionId: region.operationalRegionId,
        anchor: region.anchor,
        entityCategories: ["viewpoint"],
        predicates: ["entity_category", "viewpoint_presence"],
        searchRadiusMeters: 500,
        limit: 12
      });
    });
    const returnedIds = new Set(rows.map((row) => row.entity_id));
    assert.equal(returnedIds.has(inserted[0].entityId), true);
    assert.equal(returnedIds.has(inserted[1].entityId), true);
    assert.equal(returnedIds.has(inserted[2].entityId), false);
  });

  it("cannot qualify a highlight through an overlapping but different region", async () => {
    const sourceRegion = REGIONS[0];
    const ids = seeded.get(sourceRegion.operationalRegionId);
    const overlappingRegionId = "overlap-test-v1";
    await pool.query(
      `INSERT INTO outdoor_evidence_regions
         (region_id, name, definition_version, boundary_kind,
          coordinate_reference_system, metric_srid, boundary,
          boundary_metric, supported_feature_classes,
          freshness_threshold_days, path_match_tolerance_meters,
          active_import_id, enabled)
       VALUES (
         $1, 'Overlapping test region', 1, 'trailmind-operational-polygon',
         'EPSG:4326', 25832,
         ST_Multi(ST_MakeEnvelope($2, $3, $4, $5, 4326)),
         ST_Transform(
           ST_Multi(ST_MakeEnvelope($2, $3, $4, $5, 4326)),
           25832
         ),
         ARRAY['viewpoint'], 14, 75, NULL, true
       )`,
      [overlappingRegionId, ...sourceRegion.envelope]
    );
    try {
      const repository = new PostgresOutdoorResearchRepository({ pool });
      const rows = await repository.withConsistentSnapshot({}, (session) =>
        session.discoverHighlights({
          projectionRunId: ids.runId,
          operationalRegionId: overlappingRegionId,
          anchor: sourceRegion.anchor,
          entityCategories: ["viewpoint"],
          predicates: ["entity_category", "viewpoint_presence"],
          searchRadiusMeters: 500,
          limit: 12
        })
      );
      assert.deepEqual(rows, []);
    } finally {
      await pool.query(
        "DELETE FROM outdoor_evidence_regions WHERE region_id = $1",
        [overlappingRegionId]
      );
    }
  });

  it("keeps official/current operations as gaps and mapped access unresolved", async () => {
    const result = await execute(REGIONS[0], {
      dateOrSeason: { kind: "date", date: "2026-07-25" },
      overnightRequirements: {
        required: true,
        nights: 1,
        allowedAccommodationTypes: ["alpine_hut"]
      }
    });
    assert.equal(result.state, "ready");
    const gapCodes = new Set(result.dossier.evidenceGaps.map((gap) => gap.code));
    for (const code of [
      "missing_access_evidence",
      "missing_current_conditions",
      "missing_opening_evidence",
      "missing_overnight_evidence",
      "missing_seasonal_evidence",
      "missing_water_evidence"
    ]) assert(gapCodes.has(code), code);
    const access = result.dossier.evidenceClaims.find((claim) =>
      claim.predicate === "access_restriction"
    );
    assert.equal(access.resolutionState, "unavailable");
    assert.equal(result.dossier.evidenceClaims.some((claim) =>
      ["public_access", "current_opening", "overnight_permission",
        "drinking_water_availability", "closure_status"].includes(claim.predicate)
    ), false);
  });

  it("is deterministic across repeated executions of one consistent snapshot", async () => {
    const first = await execute(REGIONS[1]);
    const second = await execute(REGIONS[1]);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  });

  it("removes capabilities when an exact authority scope is inactive", async () => {
    await pool.query(
      `UPDATE outdoor_research_source_authority_scopes
          SET lifecycle_state = 'retired'
        WHERE source_id = $1
          AND predicate = 'viewpoint_presence'
          AND entity_category = 'viewpoint'`,
      [sourceId]
    );
    try {
      const result = await execute(REGIONS[0]);
      assert.equal(result.state, "unsupported");
      assert.equal(result.availabilityState, "source_unavailable");
    } finally {
      await pool.query(
        `UPDATE outdoor_research_source_authority_scopes
            SET lifecycle_state = 'active'
          WHERE source_id = $1
            AND predicate = 'viewpoint_presence'
            AND entity_category = 'viewpoint'`,
        [sourceId]
      );
    }
  });

  it("does not present a stale import as current", async () => {
    const ids = seeded.get("harz-v1");
    await pool.query(
      `UPDATE outdoor_evidence_imports
          SET source_data_at = '2026-07-01T08:00:00Z'
        WHERE import_id = $1`,
      [ids.importId]
    );
    try {
      const result = await execute(REGIONS[0]);
      assert.equal(result.state, "unsupported");
      assert.equal(result.availabilityState, "source_stale");
      assert.equal(Object.hasOwn(result, "dossier"), false);
    } finally {
      await pool.query(
        `UPDATE outdoor_evidence_imports
            SET source_data_at = '2026-07-24T08:00:00Z'
          WHERE import_id = $1`,
        [ids.importId]
      );
    }
  });

  it("enforces real statement timeout and cancellation on a blocked query", async () => {
    const lockClient = await pool.connect();
    const repository = new PostgresOutdoorResearchRepository({
      pool,
      statementTimeoutMs: 100
    });
    try {
      await lockClient.query("BEGIN");
      await lockClient.query(
        "LOCK TABLE outdoor_evidence_regions IN ACCESS EXCLUSIVE MODE"
      );
      await assert.rejects(
        () => repository.withConsistentSnapshot({}, (session) =>
          session.resolveCapabilities(
            binding(REGIONS[0]),
            REGIONS[0].anchor,
            NOW
          )
        ),
        hasCode("repository_timed_out")
      );

      const controller = new AbortController();
      const pending = repository.withConsistentSnapshot(
        { signal: controller.signal },
        (session) => session.resolveCapabilities(
          binding(REGIONS[0]),
          REGIONS[0].anchor,
          NOW
        )
      );
      setTimeout(() => controller.abort(), 25);
      await assert.rejects(pending, hasCode("request_cancelled"));
    } finally {
      await lockClient.query("ROLLBACK");
      lockClient.release();
    }
  });

  it("uses the projection geometry GiST index for bounded spatial access", async () => {
    const ids = seeded.get("harz-v1");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL enable_seqscan = off");
      const plan = await client.query(
        `EXPLAIN (FORMAT JSON)
         ${outdoorResearchRepositoryQueriesForTesting.highlights}`,
        [
          ids.runId,
          REGIONS[0].operationalRegionId,
          REGIONS[0].anchor.longitude,
          REGIONS[0].anchor.latitude,
          ["viewpoint"],
          10_000,
          ["entity_category", "viewpoint_presence"],
          12,
          75
        ]
      );
      const text = JSON.stringify(plan.rows[0]["QUERY PLAN"]);
      assert.match(
        text,
        /outdoor_research_projection_entities_geometry_gist_idx/
      );
      assert.doesNotMatch(
        outdoorResearchRepositoryQueriesForTesting.highlights,
        /ST_AsGeoJSON|ST_AsText/
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("removes both regions after reviewed policy revocation", async () => {
    await configureOsmProjectionPolicy({
      pool,
      mode: "revoke",
      policyVersion: OSM_PROJECTION_POLICY_VERSION,
      operatorConfirmation: OSM_POLICY_REVOCATION_CONFIRMATION,
      reviewReference: "tests/outdoor-research-executor-v1/revocation",
      reviewedAt: "2026-07-24T10:00:00.000Z",
      now: () => NOW
    });
    for (const region of REGIONS) {
      const result = await execute(region);
      assert.equal(result.state, "unsupported");
      assert.equal(result.availabilityState, "source_unavailable");
    }
    const activeRuns = await pool.query(
      "SELECT count(*)::integer AS count FROM outdoor_research_active_projection_runs"
    );
    assert.equal(activeRuns.rows[0].count, 0);
  });

  async function execute(region, overrides = {}) {
    const repository = new PostgresOutdoorResearchRepository({
      pool,
      statementTimeoutMs: 2_000
    });
    return researchOutdoorAdventureV1(intent(region, overrides), {
      repository,
      clock: () => NOW,
      totalTimeoutMs: 5_000
    });
  }
});

async function seedRegion(pool, region, sourceId, policyId) {
  const ids = {
    importId: randomUUID(),
    runId: randomUUID(),
    viewpointId: randomUUID(),
    hutId: randomUUID(),
    routeId: randomUUID(),
    segmentId: randomUUID()
  };
  const [west, south, east, north] = region.envelope;
  await pool.query("BEGIN");
  try {
    await pool.query(
      `INSERT INTO outdoor_evidence_regions
         (region_id, name, definition_version, boundary_kind,
          coordinate_reference_system, metric_srid, boundary, boundary_metric,
          supported_feature_classes, freshness_threshold_days,
          path_match_tolerance_meters, enabled)
       VALUES (
         $1, $2, 1, 'trailmind-operational-polygon',
         'EPSG:4326', 25832,
         ST_Multi(ST_MakeEnvelope($3, $4, $5, $6, 4326)),
         ST_Transform(
           ST_Multi(ST_MakeEnvelope($3, $4, $5, $6, 4326)),
           25832
         ),
         ARRAY['viewpoint','alpineHut','hikingRoute','trailSegment'],
         14, 20, true
       )`,
      [
        region.operationalRegionId,
        region.operationalRegionId,
        west,
        south,
        east,
        north
      ]
    );
    await pool.query(
      `INSERT INTO outdoor_evidence_imports
         (import_id, region_id, source_dataset_name, source_identifier,
          source_data_at, retrieved_at, imported_at, tool_version,
          import_schema_version, status, aggregate_counts,
          acquisition_channel, input_file_sha256)
       VALUES (
         $1, $2, 'synthetic executor fixture', $3,
         '2026-07-24T08:00:00Z', '2026-07-24T08:30:00Z',
         '2026-07-24T09:00:00Z', 'executor-test-v1',
         1, 'active', '{}'::jsonb, 'operator_supplied_local', $4
       )`,
      [
        ids.importId,
        region.operationalRegionId,
        `synthetic:${region.operationalRegionId}`,
        region.hashCharacter.repeat(64)
      ]
    );
    await pool.query(
      `UPDATE outdoor_evidence_regions
          SET active_import_id = $2
        WHERE region_id = $1`,
      [region.operationalRegionId, ids.importId]
    );
    await pool.query(
      `INSERT INTO outdoor_research_projection_runs
         (projection_run_id, projection_key, source_id, source_policy_id,
          source_policy_version, adapter_schema_version, region_id,
          input_import_id, input_source_dataset_name, input_source_identifier,
          input_source_data_at, input_retrieved_at, input_imported_at,
          input_acquisition_channel, input_file_sha256, operator_invoked,
          started_at, completed_at, duration_milliseconds, status,
          aggregate_counts)
       VALUES (
         $1, $2, $3, $4, $5, 'osm-evidence-graph-v1', $6,
         $7, 'synthetic executor fixture', $8,
         '2026-07-24T08:00:00Z', '2026-07-24T08:30:00Z',
         '2026-07-24T09:00:00Z', 'operator_supplied_local', $9, true,
         '2026-07-24T09:30:00Z', '2026-07-24T09:31:00Z',
         60000, 'active', '{}'::jsonb
       )`,
      [
        ids.runId,
        `${region.hashCharacter.repeat(63)}1`,
        sourceId,
        policyId,
        OSM_PROJECTION_POLICY_VERSION,
        region.operationalRegionId,
        ids.importId,
        `synthetic:${region.operationalRegionId}`,
        region.hashCharacter.repeat(64)
      ]
    );
    const entities = [
      {
        key: "viewpoint",
        id: ids.viewpointId,
        category: "viewpoint",
        osmType: "node",
        osmId: region.osmBase + 1,
        geometry: `POINT(${region.anchor.longitude + 0.01} ${region.anchor.latitude})`
      },
      {
        key: "hut",
        id: ids.hutId,
        category: "alpine_hut",
        osmType: "node",
        osmId: region.osmBase + 2,
        geometry: `POINT(${region.anchor.longitude + 0.02} ${region.anchor.latitude})`
      },
      {
        key: "route",
        id: ids.routeId,
        category: "hiking_route",
        osmType: "relation",
        osmId: region.osmBase + 3,
        geometry: null
      },
      {
        key: "segment",
        id: ids.segmentId,
        category: "trail_segment",
        osmType: "way",
        osmId: region.osmBase + 4,
        geometry:
          `LINESTRING(${region.anchor.longitude - 0.01} ${region.anchor.latitude},` +
          `${region.anchor.longitude + 0.02} ${region.anchor.latitude})`
      }
    ];
    for (const entity of entities) {
      entity.linkId = randomUUID();
      await pool.query(
        `INSERT INTO outdoor_research_entities
           (entity_id, entity_category, canonical_geometry, lifecycle_state)
         VALUES (
           $1, $2,
           CASE WHEN $3::text IS NULL THEN NULL
                ELSE ST_GeomFromText($3, 4326) END,
           'active'
         )`,
        [entity.id, entity.category, entity.geometry]
      );
      await pool.query(
        `INSERT INTO outdoor_research_source_entities
           (source_entity_link_id, entity_id, source_id, external_type,
            external_id, matching_status, matching_method, matched_at,
            review_status, reviewed_at)
         VALUES (
           $1, $2, $3, $4, $5, 'matched', 'exact_external_id',
           '2026-07-24T09:00:00Z', 'confirmed', '2026-07-24T09:00:00Z'
         )`,
        [
          entity.linkId,
          entity.id,
          sourceId,
          `osm:${entity.osmType}`,
          String(entity.osmId)
        ]
      );
      await pool.query(
        `INSERT INTO outdoor_research_osm_entity_identities
           (source_id, osm_type, osm_id, entity_id, deterministic_id_version)
         VALUES ($1, $2, $3, $4, 'trailmind-osm-identity-v1')`,
        [sourceId, entity.osmType, entity.osmId, entity.id]
      );
      await pool.query(
        `INSERT INTO outdoor_research_projection_entities
           (projection_run_id, source_id, entity_id, source_entity_link_id,
            osm_type, osm_id, entity_category, projected_geometry,
            source_version, source_timestamp, record_provenance)
         VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           CASE WHEN $8::text IS NULL THEN NULL
                ELSE ST_GeomFromText($8, 4326) END,
           7, '2026-07-24T08:00:00Z',
           jsonb_build_object(
             'osm_version', 7,
             'adapter_version', 'osm-evidence-graph-v1',
             'region_id', $9::text
           )
         )`,
        [
          ids.runId,
          sourceId,
          entity.id,
          entity.linkId,
          entity.osmType,
          entity.osmId,
          entity.category,
          entity.geometry,
          region.operationalRegionId
        ]
      );
    }

    const assertions = [
      [entities[0], "entity_category", "text", "viewpoint"],
      [entities[0], "viewpoint_presence", "boolean", true],
      [entities[1], "entity_category", "text", "alpine_hut"],
      [entities[1], "name", "text", `${region.operationalRegionId} mapped hut`],
      [entities[2], "entity_category", "text", "hiking_route"],
      [entities[2], "name", "text", `${region.operationalRegionId} mapped relation`],
      [entities[3], "entity_category", "text", "trail_segment"],
      [entities[3], "trail_difficulty", "text", "mountain_hiking"],
      [entities[3], "trail_visibility", "text", "good"],
      [entities[3], "access_restriction", "text", "conditional"]
    ];
    for (const [entity, predicate, valueType, value] of assertions) {
      const assertionId = randomUUID();
      await pool.query(
        `INSERT INTO outdoor_research_assertions
           (assertion_id, entity_id, source_id, predicate, value_type,
            value_text, value_boolean, evidence_class, observed_at,
            retrieved_at, freshness_state, provenance_identifier,
            assertion_state, resolution_group_key)
         VALUES (
           $1, $2, $3, $4, $5,
           CASE WHEN $5 = 'text' THEN $6::text ELSE NULL END,
           CASE WHEN $5 = 'boolean' THEN $7::boolean ELSE NULL END,
           'mapped', '2026-07-24T08:00:00Z', '2026-07-24T08:30:00Z',
           'current', $8, 'asserted', $9
         )`,
        [
          assertionId,
          entity.id,
          sourceId,
          predicate,
          valueType,
          valueType === "text" ? value : null,
          valueType === "boolean" ? value : null,
          `osm:${entity.osmType}/${entity.osmId}@7#${predicate}`,
          `osm:${entity.osmType}:${entity.osmId}:${predicate}`
        ]
      );
      await pool.query(
        `INSERT INTO outdoor_research_projection_assertions
           (projection_run_id, assertion_id, entity_id, predicate,
            record_provenance)
         VALUES (
           $1, $2, $3, $4,
           jsonb_build_object('osm_version', 7, 'region_id', $5::text)
         )`,
        [
          ids.runId,
          assertionId,
          entity.id,
          predicate,
          region.operationalRegionId
        ]
      );
    }
    const relationshipId = randomUUID();
    await pool.query(
      `INSERT INTO outdoor_research_relationships
         (relationship_id, relationship_type, subject_entity_id,
          object_entity_id, source_id, evidence_class,
          provenance_identifier, observed_at, retrieved_at, freshness_state)
       VALUES (
         $1, 'trail_segment_member_of_route', $2, $3, $4, 'mapped',
         $5, '2026-07-24T08:00:00Z', '2026-07-24T08:30:00Z', 'current'
       )`,
      [
        relationshipId,
        ids.segmentId,
        ids.routeId,
        sourceId,
        `osm:relation/${region.osmBase + 3}@7/member/way/${region.osmBase + 4}`
      ]
    );
    await pool.query(
      `INSERT INTO outdoor_research_projection_relationships
         (projection_run_id, relationship_id, subject_entity_id,
          object_entity_id, relationship_type, record_provenance)
       VALUES (
         $1, $2, $3, $4, 'trail_segment_member_of_route',
         jsonb_build_object(
           'relation_osm_version', 7,
           'segment_osm_version', 7,
           'region_id', $5::text
         )
       )`,
      [
        ids.runId,
        relationshipId,
        ids.segmentId,
        ids.routeId,
        region.operationalRegionId
      ]
    );
    await pool.query("COMMIT");
    return ids;
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

async function insertProjectedViewpoint({
  pool,
  sourceId,
  projectionRunId,
  operationalRegionId,
  osmId,
  coordinate
}) {
  const client = await pool.connect();
  const entityId = randomUUID();
  const sourceEntityLinkId = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO outdoor_research_entities
         (entity_id, entity_category, canonical_geometry, lifecycle_state)
       VALUES (
         $1, 'viewpoint', ST_SetSRID(ST_MakePoint($2, $3), 4326), 'active'
       )`,
      [entityId, coordinate.longitude, coordinate.latitude]
    );
    await client.query(
      `INSERT INTO outdoor_research_source_entities
         (source_entity_link_id, entity_id, source_id, external_type,
          external_id, matching_status, matching_method, matched_at,
          review_status, reviewed_at)
       VALUES (
         $1, $2, $3, 'osm:node', $4, 'matched', 'exact_external_id',
         '2026-07-24T09:00:00Z', 'confirmed', '2026-07-24T09:00:00Z'
       )`,
      [sourceEntityLinkId, entityId, sourceId, String(osmId)]
    );
    await client.query(
      `INSERT INTO outdoor_research_osm_entity_identities
         (source_id, osm_type, osm_id, entity_id, deterministic_id_version)
       VALUES ($1, 'node', $2, $3, 'trailmind-osm-identity-v1')`,
      [sourceId, osmId, entityId]
    );
    await client.query(
      `INSERT INTO outdoor_research_projection_entities
         (projection_run_id, source_id, entity_id, source_entity_link_id,
          osm_type, osm_id, entity_category, projected_geometry,
          source_version, source_timestamp, record_provenance)
       VALUES (
         $1, $2, $3, $4, 'node', $5, 'viewpoint',
         ST_SetSRID(ST_MakePoint($6, $7), 4326),
         7, '2026-07-24T08:00:00Z',
         jsonb_build_object(
           'osm_version', 7,
           'adapter_version', 'osm-evidence-graph-v1',
           'region_id', $8::text
         )
       )`,
      [
        projectionRunId,
        sourceId,
        entityId,
        sourceEntityLinkId,
        osmId,
        coordinate.longitude,
        coordinate.latitude,
        operationalRegionId
      ]
    );
    for (const [predicate, valueType, value] of [
      ["entity_category", "text", "viewpoint"],
      ["viewpoint_presence", "boolean", true]
    ]) {
      const assertionId = randomUUID();
      await client.query(
        `INSERT INTO outdoor_research_assertions
           (assertion_id, entity_id, source_id, predicate, value_type,
            value_text, value_boolean, evidence_class, observed_at,
            retrieved_at, freshness_state, provenance_identifier,
            assertion_state, resolution_group_key)
         VALUES (
           $1, $2, $3, $4, $5,
           CASE WHEN $5 = 'text' THEN $6::text ELSE NULL END,
           CASE WHEN $5 = 'boolean' THEN $7::boolean ELSE NULL END,
           'mapped', '2026-07-24T08:00:00Z', '2026-07-24T08:30:00Z',
           'current', $8, 'asserted', $9
         )`,
        [
          assertionId,
          entityId,
          sourceId,
          predicate,
          valueType,
          valueType === "text" ? value : null,
          valueType === "boolean" ? value : null,
          `osm:node/${osmId}@7#${predicate}`,
          `osm:node:${osmId}:${predicate}`
        ]
      );
      await client.query(
        `INSERT INTO outdoor_research_projection_assertions
           (projection_run_id, assertion_id, entity_id, predicate,
            record_provenance)
         VALUES (
           $1, $2, $3, $4,
           jsonb_build_object('osm_version', 7, 'region_id', $5::text)
         )`,
        [
          projectionRunId,
          assertionId,
          entityId,
          predicate,
          operationalRegionId
        ]
      );
    }
    await client.query("COMMIT");
    return entityId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function projectCoordinate(pool, origin, distanceMeters, bearingRadians) {
  const result = await pool.query(
    `SELECT ST_Y(projected::geometry)::double precision AS latitude,
            ST_X(projected::geometry)::double precision AS longitude
       FROM (
         SELECT ST_Project(
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
           $3::double precision,
           $4::double precision
         ) AS projected
       ) value`,
    [origin.longitude, origin.latitude, distanceMeters, bearingRadians]
  );
  return result.rows[0];
}

function intent(region, overrides = {}) {
  return {
    schemaVersion: 1,
    activity: "hiking",
    geographicAnchor: {
      state: "resolved",
      name: binding(region).displayName,
      coordinate: region.anchor,
      regionEntityId: binding(region).regionEntityId
    },
    routeType: "loop",
    distanceRangeKm: { min: 10, max: 14 },
    durationRangeMinutes: null,
    maximumElevationGainMeters: null,
    maximumTechnicalDifficulty: null,
    mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 1 }],
    preferredExperiences: ["alpine_hut"],
    avoidedExperiences: [],
    requiredFacilities: ["lunch_hut"],
    groupContext: {
      partySize: 2,
      includesChildren: false,
      youngestAge: null,
      mobility: "standard",
      experienceLevel: "intermediate"
    },
    dateOrSeason: null,
    overnightRequirements: {
      required: false,
      nights: 0,
      allowedAccommodationTypes: []
    },
    transportRequirements: {
      arrivalMode: "walking",
      returnToStart: true,
      publicTransportRequired: false
    },
    unresolvedClarificationQuestions: [],
    ...overrides
  };
}

function binding(region) {
  return OUTDOOR_RESEARCH_REGION_BINDINGS_V1.find((item) =>
    item.operationalRegionId === region.operationalRegionId
  );
}

function hasCode(code) {
  return (error) => {
    assert.equal(error.code, code);
    assert.equal(error.message.length < 120, true);
    return true;
  };
}

function deterministicProviderResponse(request) {
  const coordinates = request.points.map((point, index) => [
    point.longitude,
    point.latitude,
    500 + index * 10
  ]);
  const finalIndex = coordinates.length - 1;
  return {
    provider: "graphhopper",
    paths: [{
      distance: 12_000,
      time: 10_800_000,
      ascend: 400,
      descend: 400,
      points: { type: "LineString", coordinates },
      instructions: [{
        text: "Continue",
        distance: 12_000,
        time: 10_800_000,
        interval: [0, finalIndex],
        sign: 0
      }],
      details: {
        surface: [[0, finalIndex, "ground"]],
        road_class: [[0, finalIndex, "path"]],
        hike_rating: [[0, finalIndex, "1"]]
      },
      snapped_waypoints: {
        type: "LineString",
        coordinates: request.points.map((point) => [
          point.longitude,
          point.latitude
        ])
      }
    }]
  };
}
