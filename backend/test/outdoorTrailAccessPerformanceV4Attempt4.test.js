import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import {
  outdoorAdventureStagingProofCanonicalIntentV1
} from "../evaluation/outdoorAdventureStagingProof/operationalBackendCapture.js";
import {
  deriveResearchSearchRadiusMetersV1
} from "../src/outdoorResearch/executorPolicy.js";
import {
  outdoorResearchRepositoryQueriesForTesting,
  outdoorResearchRuntimeQueriesForTesting
} from "../src/outdoorResearch/postgresOutdoorResearchRepository.js";
import {
  bindOutdoorResearchIntentToReviewedRegionV1
} from "../src/outdoorResearch/regionBindings.js";
import {
  RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1
} from "../src/routeResearch/trailAccessCandidatePolicy.js";

const { Pool } = pg;
const connectionString = process.env.TRAILMIND_V4_ATTEMPT4_DATABASE_URL;
const operatorConnectionString =
  process.env.TRAILMIND_V4_ATTEMPT4_OPERATOR_DATABASE_URL;
const CASES = Object.freeze([
  Object.freeze({
    caseId: "case-15-partial-provider-failure-survivor",
    categories: RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1
      .highlightCategories,
    predicates: Object.freeze([
      "entity_category", "name", "viewpoint_presence", "waterfall_presence"
    ]),
    highlightLimit: 32,
    requestedHighlightCount: 32
  }),
  Object.freeze({
    caseId: "case-04-harz-brocken-must-have-landmark",
    categories: Object.freeze(["peak"]),
    predicates: Object.freeze(["entity_category", "name", "operator"]),
    highlightLimit: 12,
    requestedHighlightCount: 4
  }),
  Object.freeze({
    caseId: "case-07-innsbruck-viewpoint-loop",
    categories: Object.freeze(["viewpoint"]),
    predicates: Object.freeze([
      "entity_category", "name", "operator", "viewpoint_presence"
    ]),
    highlightLimit: 12,
    requestedHighlightCount: 4
  })
]);

describe("V4 Attempt 4 current-volume trail-access performance", {
  skip: !connectionString || !operatorConnectionString
}, () => {
  let pool;
  let operatorPool;
  let fixtures;

  before(async () => {
    const url = new URL(connectionString);
    const operatorUrl = new URL(operatorConnectionString);
    if (!new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname) ||
        url.search !== "" || url.hash !== "" ||
        operatorUrl.search !== "" || operatorUrl.hash !== "" ||
        !/v4a4.*membership.*perf/i.test(url.pathname) ||
        !/proof/i.test(decodeURIComponent(url.username)) ||
        operatorUrl.hostname !== url.hostname ||
        operatorUrl.port !== url.port ||
        operatorUrl.pathname !== url.pathname ||
        operatorUrl.username === url.username) {
      throw new Error(
        "The runtime and operator URLs must name separate roles on the same loopback proof database."
      );
    }
    pool = new Pool({
      connectionString,
      max: 2,
      connectionTimeoutMillis: 10_000,
      query_timeout: 3_000,
      statement_timeout: 2_500,
      allowExitOnIdle: true
    });
    operatorPool = new Pool({
      connectionString: operatorConnectionString,
      max: 2,
      connectionTimeoutMillis: 10_000,
      query_timeout: 3_000,
      statement_timeout: 2_500,
      allowExitOnIdle: true
    });
    const identity = await pool.query(
      `SELECT current_user, session_user,
              rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
         FROM pg_roles
        WHERE rolname = current_user`
    );
    assert.deepEqual(identity.rows, [{
      current_user: decodeURIComponent(url.username),
      session_user: decodeURIComponent(url.username),
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false
    }]);
    const corpus = JSON.parse(await readFile(new URL(
      "../evaluation/outdoorAdventureStagingProof/fixtures/mandatoryCasesV1.json",
      import.meta.url
    ), "utf8"));
    fixtures = new Map(corpus.cases.map((item) => [item.id, item]));
  });

  after(async () => {
    if (pool) await pool.end();
    if (operatorPool) await operatorPool.end();
  });

  for (const configuration of CASES) {
    it(`uses bounded access geometry for ${configuration.caseId}`, async (context) => {
      const evaluationCase = fixtures.get(configuration.caseId);
      assert.ok(evaluationCase);
      const intent = outdoorAdventureStagingProofCanonicalIntentV1(
        evaluationCase.input
      );
      const reviewed = bindOutdoorResearchIntentToReviewedRegionV1(intent);
      assert.ok(reviewed);
      const regionId = reviewed.binding.operationalRegionId;
      const anchor = reviewed.normalizedIntent.geographicAnchor.coordinate;
      const snapshot = await pool.query(
        outdoorResearchRuntimeQueriesForTesting.snapshotContext,
        [regionId, anchor.longitude, anchor.latitude]
      );
      assert.equal(snapshot.rowCount, 1);
      const runId = snapshot.rows[0].runtime_row.projection_run_id;
      const highlights = await pool.query(
        outdoorResearchRuntimeQueriesForTesting.highlights,
        [
          runId,
          regionId,
          anchor.longitude,
          anchor.latitude,
          configuration.categories,
          deriveResearchSearchRadiusMetersV1(reviewed.normalizedIntent),
          configuration.predicates,
          configuration.highlightLimit,
          RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1
            .maximumPoiToTrailDistanceMeters
        ]
      );
      const entityIds = [...new Set(highlights.rows.map((row) =>
        row.runtime_row.entity_id
      ))].slice(0, configuration.requestedHighlightCount);
      assert(entityIds.length > 0, "expected a current routable highlight");
      if (configuration.requestedHighlightCount === 32) {
        assert.equal(entityIds.length, 32,
          "expected the full case-15 requested highlight set");
      }
      const values = [
        runId,
        regionId,
        entityIds,
        RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1
          .maximumPoiToTrailDistanceMeters,
        RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1.limits
          .maximumCandidatesPerHighlight,
        RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1.eligibleHighwayClasses,
        RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1.highlightCategories,
        RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1.limits.maximumCandidates
      ];
      const measurements = [];
      let expected;
      {
        const client = await pool.connect();
        try {
          await client.query(
            "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
          );
          await client.query(
            "SELECT set_config('statement_timeout', '2500ms', true)"
          );
          const warmup = await client.query(
            outdoorResearchRuntimeQueriesForTesting.trailAccessCandidates,
            values
          );
          assert(warmup.rowCount > 0);
          await client.query("ROLLBACK");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          throw error;
        } finally {
          client.release();
        }
      }
      for (let iteration = 0; iteration < 5; iteration += 1) {
        const client = await pool.connect();
        try {
          await client.query(
            "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
          );
          await client.query("SELECT set_config('statement_timeout', '2500ms', true)");
          const started = performance.now();
          const result = await client.query(
            outdoorResearchRuntimeQueriesForTesting.trailAccessCandidates,
            values
          );
          measurements.push(performance.now() - started);
          assert(result.rowCount > 0);
          assert(result.rowCount <= values[7]);
          const rows = result.rows.map((row) => row.runtime_row);
          assert(rows.every((row) =>
            Number(row.poi_to_access_distance_meters) <=
              RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1
                .maximumPoiToTrailDistanceMeters &&
            Array.isArray(row.trail_category_evidence_claim_ids) &&
            row.trail_category_evidence_claim_ids.length > 0
          ));
          if (expected === undefined) expected = rows;
          else assert.deepEqual(rows, expected);
          await client.query("ROLLBACK");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          throw error;
        } finally {
          client.release();
        }
      }
      assert(measurements.every((duration) => duration < 2_000));
      assert(percentile(measurements, 0.95) < 1_500);
      const operatorRows = await operatorPool.query(
        outdoorResearchRepositoryQueriesForTesting.trailAccessCandidates,
        values
      );
      assert.deepEqual(normalizeRows(expected), normalizeRows(operatorRows.rows));
      const plan = await operatorPool.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
${outdoorResearchRepositoryQueriesForTesting.trailAccessCandidates}`,
        values
      );
      assert.equal(plan.rows.length, 1);
      const planDocument = plan.rows[0]["QUERY PLAN"][0];
      const nodes = flattenPlan(planDocument.Plan);
      assert(Number(planDocument["Execution Time"]) < 1_500);
      assert(nodes.some((node) =>
        Number.isFinite(Number(node["Shared Hit Blocks"])) ||
        Number.isFinite(Number(node["Shared Read Blocks"]))
      ));
      assert(nodes.some((node) => node["Index Name"] ===
        "outdoor_research_projection_entities_trail_geography_gist_idx"));
      assert.equal(nodes.some((node) =>
        node["Node Type"] === "Seq Scan" &&
        node["Relation Name"] === "outdoor_research_projection_entities"
      ), false);
      context.diagnostic(JSON.stringify({
        regionId,
        highlightCount: entityIds.length,
        rowCount: expected.length,
        maximumMs: round(Math.max(...measurements)),
        p50Ms: round(percentile(measurements, 0.5)),
        p95Ms: round(percentile(measurements, 0.95))
      }));
    });
  }
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

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function normalizeRows(rows) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(
    ([key, value]) => [
      key,
      value instanceof Date
        ? value.toISOString()
        : typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)
          ? new Date(value).toISOString()
          : value
    ]
  )));
}
