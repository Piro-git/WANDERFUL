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

const { Pool } = pg;
const connectionString = process.env.TRAILMIND_ROUTE_MEMBERSHIP_PERF_DATABASE_URL;
const operatorConnectionString =
  process.env.TRAILMIND_ROUTE_MEMBERSHIP_PERF_OPERATOR_DATABASE_URL;
const caseIds = Object.freeze([
  "case-04-harz-brocken-must-have-landmark",
  "case-07-innsbruck-viewpoint-loop",
  "case-08-innsbruck-easy-conservative-loop",
  "case-15-partial-provider-failure-survivor"
]);

describe("mapped route membership current-volume performance", {
  skip: !connectionString || !operatorConnectionString
}, () => {
  let pool;
  let operatorPool;
  let cases;

  before(async () => {
    const url = new URL(connectionString);
    const operatorUrl = new URL(operatorConnectionString);
    if (!new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname) ||
        url.search !== "" || url.hash !== "" ||
        operatorUrl.search !== "" || operatorUrl.hash !== "" ||
        !/membership.*perf/i.test(url.pathname) ||
        operatorUrl.hostname !== url.hostname ||
        operatorUrl.port !== url.port ||
        operatorUrl.pathname !== url.pathname ||
        operatorUrl.username === url.username) {
      throw new Error(
        "The runtime and operator URLs must name separate roles on the same loopback disposable performance database."
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
    if (operatorPool) await operatorPool.end();
  });

  it("has current regional volume and the valid bounded point index", async () => {
    const counts = await operatorPool.query(
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
    const index = await operatorPool.query(
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
      const anchor = reviewed.normalizedIntent.geographicAnchor.coordinate;
      const snapshot = await pool.query(
        outdoorResearchRuntimeQueriesForTesting.snapshotContext,
        [regionId, anchor.longitude, anchor.latitude]
      );
      assert.equal(snapshot.rowCount, 1);
      assert.equal(snapshot.rows[0].runtime_row.region_id, regionId);
      const values = [
        snapshot.rows[0].runtime_row.projection_run_id,
        regionId,
        anchor.longitude,
        anchor.latitude,
        deriveResearchSearchRadiusMetersV1(reviewed.normalizedIntent),
        24,
        1
      ];
      const measurements = [];
      let expectedRows;
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
            outdoorResearchRuntimeQueriesForTesting.routeMemberships,
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
          await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
          await client.query("SELECT set_config('statement_timeout', '2500ms', true)");
          const startedAt = performance.now();
          const result = await client.query(
            outdoorResearchRuntimeQueriesForTesting.routeMemberships,
            values
          );
          measurements.push(performance.now() - startedAt);
          assert(result.rowCount > 0,
            "RLS or runtime grants must not collapse a valid case to zero rows");
          assert(result.rowCount <= 24);
          const rows = result.rows.map((row) => row.runtime_row);
          if (expectedRows === undefined) expectedRows = rows;
          else assert.deepEqual(rows, expectedRows);
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
        outdoorResearchRepositoryQueriesForTesting.routeMemberships,
        values
      );
      assert.deepEqual(
        normalizeRows(expectedRows),
        normalizeRows(operatorRows.rows)
      );
      const plan = await operatorPool.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
${outdoorResearchRepositoryQueriesForTesting.routeMemberships}`,
        values
      );
      assert.equal(plan.rows.length, 1);
      const planDocument = plan.rows[0]["QUERY PLAN"][0];
      const root = planDocument.Plan;
      const nodes = flattenPlan(root);
      assert(Number(planDocument["Execution Time"]) < 1_500);
      assert(nodes.some((node) =>
        Number.isFinite(Number(node["Shared Hit Blocks"])) ||
        Number.isFinite(Number(node["Shared Read Blocks"]))
      ));
      assert(nodes.some((node) => [
        "outdoor_research_projection_entities_trail_point_gist_idx",
        "outdoor_research_projection_entities_trail_geography_gist_idx"
      ].includes(node["Index Name"])));
      assert.equal(nodes.some((node) =>
        node["Node Type"] === "Seq Scan" &&
        node["Relation Name"] === "outdoor_research_projection_entities"
      ), false);
      assert(nodes.some((node) =>
        node["Index Name"] ===
          "outdoor_research_projection_relationships_subject_idx"
      ));
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
