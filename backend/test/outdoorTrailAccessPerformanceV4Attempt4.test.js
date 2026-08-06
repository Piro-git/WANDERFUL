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
  outdoorResearchRepositoryQueriesForTesting
} from "../src/outdoorResearch/postgresOutdoorResearchRepository.js";
import {
  bindOutdoorResearchIntentToReviewedRegionV1
} from "../src/outdoorResearch/regionBindings.js";
import {
  RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1
} from "../src/routeResearch/trailAccessCandidatePolicy.js";

const { Pool } = pg;
const connectionString = process.env.TRAILMIND_V4_ATTEMPT4_DATABASE_URL;
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
  skip: !connectionString
}, () => {
  let pool;
  let fixtures;

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
      max: 2,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true
    });
    const corpus = JSON.parse(await readFile(new URL(
      "../evaluation/outdoorAdventureStagingProof/fixtures/mandatoryCasesV1.json",
      import.meta.url
    ), "utf8"));
    fixtures = new Map(corpus.cases.map((item) => [item.id, item]));
  });

  after(async () => {
    if (pool) await pool.end();
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
      const run = await pool.query(
        `SELECT projection_run_id
           FROM outdoor_research_active_projection_runs
          WHERE region_id = $1`,
        [regionId]
      );
      assert.equal(run.rowCount, 1);
      const runId = run.rows[0].projection_run_id;
      const anchor = reviewed.normalizedIntent.geographicAnchor.coordinate;
      const highlights = await pool.query(
        outdoorResearchRepositoryQueriesForTesting.highlights,
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
        row.entity_id
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
      for (let iteration = 0; iteration < 5; iteration += 1) {
        const client = await pool.connect();
        try {
          await client.query(
            "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
          );
          await client.query("SELECT set_config('statement_timeout', '2500ms', true)");
          const started = performance.now();
          const result = await client.query(
            outdoorResearchRepositoryQueriesForTesting.trailAccessCandidates,
            values
          );
          measurements.push(performance.now() - started);
          assert(result.rowCount > 0);
          assert(result.rowCount <= 64);
          assert(result.rows.every((row) =>
            Number(row.poi_to_access_distance_meters) <=
              RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1
                .maximumPoiToTrailDistanceMeters &&
            Array.isArray(row.trail_category_evidence_claim_ids) &&
            row.trail_category_evidence_claim_ids.length > 0
          ));
          if (expected === undefined) expected = result.rows;
          else assert.deepEqual(result.rows, expected);
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
      const plan = await pool.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
         ${outdoorResearchRepositoryQueriesForTesting.trailAccessCandidates}`,
        values
      );
      const root = plan.rows[0]["QUERY PLAN"][0];
      const nodes = flattenPlan(root.Plan);
      assert(nodes.some((node) => node["Index Name"] ===
        "outdoor_research_projection_entities_trail_geography_gist_idx"));
      assert.equal(nodes.some((node) =>
        node["Node Type"] === "Seq Scan" &&
        node["Relation Name"] === "outdoor_research_projection_entities"
      ), false);
      assert(root["Execution Time"] < 2_000);
      context.diagnostic(JSON.stringify({
        regionId,
        highlightCount: entityIds.length,
        rowCount: expected.length,
        maximumMs: round(Math.max(...measurements)),
        p95Ms: round(percentile(measurements, 0.95)),
        explainExecutionMs: round(root["Execution Time"])
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
