import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import {
  loadServerLiveProofCasesV1,
  serverLiveProofCanonicalIntentV1
} from "../evaluation/outdoorAdventureServerLiveProof/manifest.js";
import {
  V4_CASE_BINDINGS
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/contract.js";
import {
  outdoorEvidenceCorridorQueryForTesting
} from "../src/outdoorEvidence/postgresOutdoorEvidenceRepository.js";
import {
  researchOutdoorAdventureWithTrailAccessV1
} from "../src/outdoorResearch/outdoorResearchExecutor.js";
import {
  PostgresOutdoorResearchRepository,
  outdoorResearchRepositoryQueriesForTesting
} from "../src/outdoorResearch/postgresOutdoorResearchRepository.js";
import {
  bindOutdoorResearchIntentToReviewedRegionV1
} from "../src/outdoorResearch/regionBindings.js";
import {
  buildResearchGuidedRouteCandidatePlanV2,
  validateResearchGuidedRouteCandidatePlanV2ForResearch
} from "../src/routeResearch/researchGuidedRouteCandidatePlannerV2.js";

const { Pool } = pg;
const connectionString = process.env.TRAILMIND_V4_ATTEMPT4_DATABASE_URL;
const EXPECTED_MIGRATIONS = Object.freeze([
  "001_app_attest.sql",
  "002_outdoor_evidence.sql",
  "003_outdoor_research_graph.sql",
  "004_osm_outdoor_research_projection.sql",
  "005_outdoor_research_projection_geometry.sql",
  "006_outdoor_route_membership_point_index.sql",
  "007_routable_highlight_access_geography_index.sql"
]);
const REQUIRED_GIST_INDEXES = Object.freeze([
  "outdoor_evidence_regions_boundary_gist_idx",
  "outdoor_evidence_pois_geom_metric_gist_idx",
  "outdoor_evidence_trail_segments_geom_metric_gist_idx",
  "outdoor_research_projection_entities_geometry_gist_idx",
  "outdoor_research_projection_entities_trail_point_gist_idx",
  "outdoor_research_projection_entities_trail_geography_gist_idx"
]);
const REGIONS = Object.freeze(["harz-v1", "innsbruck-alps-v1"]);

describe("V4 Attempt 4 disposable PostGIS gates", {
  skip: !connectionString
}, () => {
  let pool;
  let cancellationPool;
  let cases;
  let intents;
  let runs;

  before(async () => {
    const url = new URL(connectionString);
    if (!new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname) ||
        !/v4a4.*membership.*perf/i.test(url.pathname) ||
        !/proof/i.test(decodeURIComponent(url.username))) {
      throw new Error(
        "TRAILMIND_V4_ATTEMPT4_DATABASE_URL must name the loopback proof database."
      );
    }
    pool = new Pool({
      connectionString,
      max: 4,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
      application_name: "trailmind_v4_attempt4_database_gates"
    });
    cancellationPool = new Pool({
      connectionString,
      max: 2,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
      application_name: "trailmind_v4_attempt4_cancellation"
    });
    cases = await loadServerLiveProofCasesV1({
      caseIds: V4_CASE_BINDINGS.map((item) => item.caseId)
    });
    intents = new Map(cases.map((item) => [
      item.id,
      serverLiveProofCanonicalIntentV1(item.input)
    ]));
    const activeRuns = await pool.query(
      `SELECT region_id, projection_run_id
         FROM outdoor_research_active_projection_runs
        ORDER BY region_id`
    );
    runs = new Map(activeRuns.rows.map((row) => [
      row.region_id, row.projection_run_id
    ]));
  });

  after(async () => {
    await cancellationPool?.end();
    await pool?.end();
  });

  it("has the exact migration state, active snapshots, fresh inputs, and valid GiST indexes", async (context) => {
    const migrations = await pool.query(
      "SELECT version FROM trailmind_schema_migrations ORDER BY version"
    );
    assert.deepEqual(migrations.rows.map((row) => row.version),
      EXPECTED_MIGRATIONS);

    const role = await pool.query(
      `SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
         FROM pg_roles WHERE rolname = current_user`
    );
    assert.deepEqual(role.rows, [{
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false
    }]);

    const snapshots = await pool.query(
      `SELECT region.region_id,
              import.status AS import_status,
              run.status AS projection_status,
              run.duration_milliseconds,
              run.aggregate_counts,
              import.source_data_at,
              import.retrieved_at,
              import.imported_at,
              import.input_file_sha256,
              run.input_file_sha256 AS projected_input_file_sha256
         FROM outdoor_evidence_regions region
         JOIN outdoor_evidence_imports import
           ON import.import_id = region.active_import_id
          AND import.region_id = region.region_id
         JOIN outdoor_research_active_projection_runs run
           ON run.region_id = region.region_id
          AND run.input_import_id = import.import_id
        WHERE region.region_id = ANY($1::text[])
        ORDER BY region.region_id`,
      [REGIONS]
    );
    assert.deepEqual(snapshots.rows.map((row) => row.region_id),
      [...REGIONS].sort());
    assert(snapshots.rows.every((row) =>
      row.import_status === "active" &&
      row.projection_status === "active" &&
      Number(row.duration_milliseconds) < 120_000 &&
      row.input_file_sha256 === row.projected_input_file_sha256 &&
      /^[a-f0-9]{64}$/.test(row.input_file_sha256) &&
      new Date(row.source_data_at) <= new Date(row.retrieved_at) &&
      new Date(row.retrieved_at) <= new Date(row.imported_at)
    ));
    assert.equal(runs.size, 2);

    const quarantines = await pool.query(
      "SELECT count(*)::integer AS count FROM outdoor_research_projection_quarantines"
    );
    assert.equal(quarantines.rows[0].count, 0);
    const failedRuns = await pool.query(
      `SELECT count(*)::integer AS count
         FROM outdoor_research_projection_runs
        WHERE status IN ('loading', 'validating', 'failed')`
    );
    assert.equal(failedRuns.rows[0].count, 0);

    const indexes = await pool.query(
      `SELECT index.relname AS index_name,
              postgres_index.indisvalid,
              postgres_index.indisready
         FROM pg_index postgres_index
         JOIN pg_class index ON index.oid = postgres_index.indexrelid
        WHERE index.relname = ANY($1::text[])
        ORDER BY index.relname`,
      [REQUIRED_GIST_INDEXES]
    );
    assert.deepEqual(indexes.rows.map((row) => row.index_name),
      [...REQUIRED_GIST_INDEXES].sort());
    assert(indexes.rows.every((row) =>
      row.indisvalid === true && row.indisready === true
    ));
    context.diagnostic(JSON.stringify({
      migrationCount: migrations.rowCount,
      activeSnapshotCount: snapshots.rowCount,
      projectionDurationsMs: Object.fromEntries(snapshots.rows.map((row) => [
        row.region_id, Number(row.duration_milliseconds)
      ])),
      gistIndexCount: indexes.rowCount,
      quarantineCount: quarantines.rows[0].count
    }));
  });

  it("uses real GiST plans within the unchanged corridor timeout", async (context) => {
    const evaluationCase = cases.find((item) =>
      item.id === "case-04-harz-brocken-must-have-landmark"
    );
    const intent = intents.get(evaluationCase.id);
    const anchor = intent.geographicAnchor.coordinate;
    const route = {
      type: "LineString",
      coordinates: [
        [anchor.longitude - 0.001, anchor.latitude - 0.001],
        [anchor.longitude, anchor.latitude],
        [anchor.longitude + 0.001, anchor.latitude + 0.001]
      ]
    };
    const client = await pool.connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      await client.query("SET LOCAL enable_seqscan = off");
      await client.query("SELECT set_config('statement_timeout', '2500ms', true)");
      const started = performance.now();
      const plan = await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
         ${outdoorEvidenceCorridorQueryForTesting}`,
        [JSON.stringify(route), 100, 40]
      );
      const durationMs = performance.now() - started;
      const root = plan.rows[0]["QUERY PLAN"][0];
      const nodes = flattenPlan(root.Plan);
      const usedIndexes = new Set(nodes.flatMap((node) =>
        typeof node["Index Name"] === "string" ? [node["Index Name"]] : []
      ));
      assert(usedIndexes.has("outdoor_evidence_regions_boundary_gist_idx"));
      assert(usedIndexes.has("outdoor_evidence_trail_segments_geom_metric_gist_idx"));
      assert(usedIndexes.has("outdoor_evidence_pois_geom_metric_gist_idx"));
      assert(durationMs < 2_500);
      assert(Number(root["Execution Time"]) < 2_500);
      await client.query("ROLLBACK");
      context.diagnostic(JSON.stringify({
        wallClockMs: round(durationMs),
        executionMs: round(Number(root["Execution Time"])),
        requiredIndexesUsed: REQUIRED_GIST_INDEXES.filter((name) =>
          usedIndexes.has(name)
        )
      }));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });

  it("keeps reviewed regions and active projection runs strictly isolated", async (context) => {
    const overlap = await pool.query(
      `SELECT ST_Intersects(harz.boundary, innsbruck.boundary) AS overlaps
         FROM outdoor_evidence_regions harz
         JOIN outdoor_evidence_regions innsbruck ON true
        WHERE harz.region_id = 'harz-v1'
          AND innsbruck.region_id = 'innsbruck-alps-v1'`
    );
    assert.equal(overlap.rows[0].overlaps, false);

    const outcomes = [];
    for (const evaluationCase of cases) {
      const intent = intents.get(evaluationCase.id);
      const reviewed = bindOutdoorResearchIntentToReviewedRegionV1(intent);
      assert.ok(reviewed);
      const ownRegion = reviewed.binding.operationalRegionId;
      const foreignRegion = ownRegion === REGIONS[0] ? REGIONS[1] : REGIONS[0];
      const anchor = reviewed.normalizedIntent.geographicAnchor.coordinate;
      const covered = await pool.query(
        `SELECT count(*)::integer AS count
           FROM outdoor_evidence_regions
          WHERE enabled = true
            AND ST_Covers(
              boundary,
              ST_SetSRID(ST_MakePoint($1, $2), 4326)
            )`,
        [anchor.longitude, anchor.latitude]
      );
      assert.equal(covered.rows[0].count, 1);
      const mismatchedHighlights = await pool.query(
        outdoorResearchRepositoryQueriesForTesting.highlights,
        [
          runs.get(ownRegion), foreignRegion,
          anchor.longitude, anchor.latitude,
          ["viewpoint", "peak"], 50_000,
          ["entity_category", "name", "viewpoint_presence"], 12, 75
        ]
      );
      assert.equal(mismatchedHighlights.rowCount, 0);
      const mismatchedMemberships = await pool.query(
        outdoorResearchRepositoryQueriesForTesting.routeMemberships,
        [
          runs.get(ownRegion), foreignRegion,
          anchor.longitude, anchor.latitude,
          50_000, 12, 1
        ]
      );
      assert.equal(mismatchedMemberships.rowCount, 0);
      outcomes.push({ caseId: evaluationCase.id, isolated: true });
    }
    context.diagnostic(JSON.stringify({ regionOverlap: false, outcomes }));
  });

  it("produces bounded pre-provider research plans with complete access lineage", async (context) => {
    const repository = new PostgresOutdoorResearchRepository({
      pool,
      cancellationPool,
      statementTimeoutMs: 2_500
    });
    const records = [];
    for (const evaluationCase of cases) {
      context.diagnostic(JSON.stringify({
        preProviderCaseStarted: evaluationCase.id
      }));
      const started = performance.now();
      const research = await researchOutdoorAdventureWithTrailAccessV1(
        intents.get(evaluationCase.id),
        {
          repository,
          clock: () => new Date("2026-08-05T21:30:00.000Z"),
          totalTimeoutMs: 30_000
        }
      );
      assert.equal(research.state, "ready");
      const plan = buildResearchGuidedRouteCandidatePlanV2(
        research.dossier,
        research.trailAccessResolution,
        { maximumProposals: 3 }
      );
      validateResearchGuidedRouteCandidatePlanV2ForResearch(
        plan,
        research.dossier,
        research.trailAccessResolution,
        { maximumProposals: 3 }
      );
      assert(plan.proposals.length > 0 && plan.proposals.length <= 3);
      const selected = plan.proposals.flatMap((proposal) =>
        proposal.selectedHighlights
      );
      assert(selected.every((highlight) =>
        typeof highlight.entityId === "string" &&
        typeof highlight.trailAccessCandidate?.candidateId === "string" &&
        typeof highlight.trailAccessCandidate?.sourceTrailSegmentEntityId ===
          "string" &&
        highlight.trailAccessCandidate.poiToAccessPointDistanceMeters <= 75 &&
        Array.isArray(
          highlight.trailAccessCandidate.sourceTrailCategoryEvidenceClaimIds
        ) &&
        highlight.trailAccessCandidate.sourceTrailCategoryEvidenceClaimIds
          .length > 0 &&
        Array.isArray(highlight.evidenceClaimIds) &&
        highlight.evidenceClaimIds.length > 0
      ));
      records.push({
        caseId: evaluationCase.id,
        researchState: research.state,
        planState: plan.state,
        proposalCount: plan.proposals.length,
        selectedHighlightCount: selected.length,
        accessLineageComplete: true,
        durationMs: round(performance.now() - started)
      });
    }
    context.diagnostic(JSON.stringify(records));
  });

  it("cancels an in-flight current-database query and rolls its transaction back", async (context) => {
    const evaluationCase = cases[0];
    const reviewed = bindOutdoorResearchIntentToReviewedRegionV1(
      intents.get(evaluationCase.id)
    );
    const lockClient = await pool.connect();
    const events = [];
    const repository = new PostgresOutdoorResearchRepository({
      pool,
      cancellationPool,
      statementTimeoutMs: 2_500,
      transactionLifecycleObserver(event) { events.push(event); }
    });
    try {
      await lockClient.query("BEGIN");
      await lockClient.query(
        "LOCK TABLE outdoor_evidence_regions IN ACCESS EXCLUSIVE MODE"
      );
      const controller = new AbortController();
      const pending = repository.withConsistentSnapshot(
        { signal: controller.signal },
        (session) => session.resolveCapabilities(
          reviewed.binding,
          reviewed.normalizedIntent.geographicAnchor.coordinate,
          new Date("2026-08-05T21:30:00.000Z")
        )
      );
      setTimeout(() => controller.abort(), 50);
      await assert.rejects(pending, (error) =>
        error?.code === "request_cancelled"
      );
      assert.deepEqual(events, [
        "began",
        "query_cancelled_after_abort",
        "rollback_completed_after_cancel"
      ]);
      await lockClient.query("ROLLBACK");
      const leakedTransactions = await pool.query(
        `SELECT count(*)::integer AS count
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND usename = current_user
            AND pid <> pg_backend_pid()
            AND xact_start IS NOT NULL`
      );
      assert.equal(leakedTransactions.rows[0].count, 0);
      assert.deepEqual((await pool.query("SELECT 1 AS available")).rows,
        [{ available: 1 }]);
      context.diagnostic(JSON.stringify({
        events,
        leakedTransactions: leakedTransactions.rows[0].count,
        poolWaitingCount: pool.waitingCount,
        cancellationPoolWaitingCount: cancellationPool.waitingCount
      }));
    } finally {
      await lockClient.query("ROLLBACK").catch(() => {});
      lockClient.release();
    }
  });
});

function flattenPlan(root) {
  const nodes = [];
  const visit = (node) => {
    nodes.push(node);
    for (const child of node.Plans ?? []) visit(child);
  };
  visit(root);
  return nodes;
}

function round(value) {
  return Math.round(value * 10) / 10;
}
