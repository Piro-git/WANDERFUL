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

const { Pool } = pg;
const connectionString = process.env.TRAILMIND_ROUTE_MEMBERSHIP_PERF_DATABASE_URL;
const caseIds = Object.freeze([
  "case-04-harz-brocken-must-have-landmark",
  "case-07-innsbruck-viewpoint-loop",
  "case-08-innsbruck-easy-conservative-loop",
  "case-15-partial-provider-failure-survivor"
]);

describe("mapped route membership current-volume performance", {
  skip: !connectionString
}, () => {
  let pool;
  let cases;

  before(async () => {
    const url = new URL(connectionString);
    if (!new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname) ||
        !/membership.*perf/i.test(url.pathname)) {
      throw new Error(
        "TRAILMIND_ROUTE_MEMBERSHIP_PERF_DATABASE_URL must name a loopback disposable performance database."
      );
    }
    pool = new Pool({
      connectionString,
      max: 2,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true
    });
    const corpus = JSON.parse(await readFile(
      new URL(
        "../evaluation/outdoorAdventureStagingProof/fixtures/mandatoryCasesV1.json",
        import.meta.url
      ),
      "utf8"
    ));
    cases = caseIds.map((caseId) => {
      const evaluationCase = corpus.cases.find((candidate) => candidate.id === caseId);
      assert.ok(evaluationCase, caseId);
      return evaluationCase;
    });
  });

  after(async () => {
    if (pool) await pool.end();
  });

  it("has current regional volume and the valid bounded point index", async () => {
    const counts = await pool.query(
      `SELECT run.region_id,
              (SELECT count(*)::integer
                 FROM outdoor_research_projection_entities entity
                WHERE entity.projection_run_id = run.projection_run_id
                  AND entity.entity_category = 'trail_segment') AS trail_segments,
              (SELECT count(*)::integer
                 FROM outdoor_research_projection_relationships relationship
                WHERE relationship.projection_run_id = run.projection_run_id
                  AND relationship.relationship_type =
                    'trail_segment_member_of_route') AS memberships
         FROM outdoor_research_active_projection_runs run
        WHERE run.region_id = ANY($1::text[])
        ORDER BY run.region_id`,
      [["harz-v1", "innsbruck-alps-v1"]]
    );
    assert.equal(counts.rowCount, 2);
    const byRegion = new Map(counts.rows.map((row) => [row.region_id, row]));
    assert(byRegion.get("harz-v1").trail_segments >= 100_000);
    assert(byRegion.get("harz-v1").memberships >= 20_000);
    assert(byRegion.get("innsbruck-alps-v1").trail_segments >= 50_000);
    assert(byRegion.get("innsbruck-alps-v1").memberships >= 5_000);
    const index = await pool.query(
      `SELECT index.indisvalid, index.indisready
         FROM pg_index index
         JOIN pg_class relation ON relation.oid = index.indexrelid
        WHERE relation.relname =
          'outdoor_research_projection_entities_trail_point_gist_idx'`
    );
    assert.deepEqual(index.rows, [{ indisvalid: true, indisready: true }]);
  });

  it("keeps all reviewed cases below the application gate with the intended plan", async (context) => {
    for (const evaluationCase of cases) {
      const intent = outdoorAdventureStagingProofCanonicalIntentV1(evaluationCase.input);
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
      const values = [
        run.rows[0].projection_run_id,
        regionId,
        reviewed.normalizedIntent.geographicAnchor.coordinate.longitude,
        reviewed.normalizedIntent.geographicAnchor.coordinate.latitude,
        deriveResearchSearchRadiusMetersV1(reviewed.normalizedIntent),
        24,
        1
      ];
      const measurements = [];
      let expectedRows;
      for (let iteration = 0; iteration < 5; iteration += 1) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
          await client.query("SELECT set_config('statement_timeout', '2500ms', true)");
          const startedAt = performance.now();
          const result = await client.query(
            outdoorResearchRepositoryQueriesForTesting.routeMemberships,
            values
          );
          measurements.push(performance.now() - startedAt);
          assert(result.rowCount <= 24);
          if (expectedRows === undefined) expectedRows = result.rows;
          else assert.deepEqual(result.rows, expectedRows);
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
        `EXPLAIN (FORMAT JSON)
         ${outdoorResearchRepositoryQueriesForTesting.routeMemberships}`,
        values
      );
      const root = plan.rows[0]["QUERY PLAN"][0].Plan;
      const nodes = flattenPlan(root);
      assert(nodes.some((node) =>
        node["Index Name"] ===
          "outdoor_research_projection_entities_trail_point_gist_idx"
      ));
      assert.equal(nodes.some((node) =>
        node["Node Type"] === "Seq Scan" &&
        node["Relation Name"] === "outdoor_research_projection_entities"
      ), false);
      context.diagnostic(`${evaluationCase.id}: ${JSON.stringify({
        maximumMs: round(Math.max(...measurements)),
        medianMs: round(percentile(measurements, 0.5)),
        p95Ms: round(percentile(measurements, 0.95)),
        rowCount: expectedRows.length
      })}`);
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

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function round(value) {
  return Math.round(value * 10) / 10;
}
