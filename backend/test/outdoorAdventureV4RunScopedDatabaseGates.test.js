import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import {
  loadServerLiveProofCasesV1,
  serverLiveProofCanonicalIntentV1
} from "../evaluation/outdoorAdventureServerLiveProof/manifest.js";
import {
  V4_CASE_BINDINGS,
  V4_MANIFEST_DIGEST
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/contract.js";
import {
  captureV4ProofRunContextAfterImports,
  reconcileV4DatabaseClockEvidence,
  runV4DatabasePlanningClockGate
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/databaseGate.js";
import {
  createV4ProofClockBinding,
  validateV4ProofClockBinding
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/proofRunContext.js";
import {
  researchOutdoorAdventureWithTrailAccessV1
} from "../src/outdoorResearch/outdoorResearchExecutor.js";
import {
  PostgresOutdoorResearchRepository
} from "../src/outdoorResearch/postgresOutdoorResearchRepository.js";
import {
  validateLoopbackProofDatabaseUrls
} from "../scripts/run-outdoor-adventure-targeted-live-route-quality-proof-v4.js";

const { Pool } = pg;
const connectionString = process.env.TRAILMIND_V4_RUN_DATABASE_URL;
const operatorConnectionString =
  process.env.TRAILMIND_V4_OPERATOR_DATABASE_URL;
const enabled = Boolean(connectionString && operatorConnectionString);

describe("V4 run-scoped database planning clock integration", {
  skip: !enabled
}, () => {
  let pool;
  let cancellationPool;
  let operatorPool;
  let repository;
  let cases;
  let intents;

  before(async () => {
    validateLoopbackProofDatabaseUrls(
      connectionString,
      operatorConnectionString
    );
    pool = new Pool({
      connectionString,
      max: 3,
      query_timeout: 3_000,
      statement_timeout: 2_500,
      allowExitOnIdle: true,
      application_name: "trailmind_v4_run_clock_integration"
    });
    cancellationPool = new Pool({
      connectionString,
      max: 2,
      query_timeout: 1_000,
      statement_timeout: 1_000,
      allowExitOnIdle: true,
      application_name: "trailmind_v4_run_clock_integration_cancel"
    });
    operatorPool = new Pool({
      connectionString: operatorConnectionString,
      max: 2,
      query_timeout: 3_000,
      statement_timeout: 2_500,
      allowExitOnIdle: true,
      application_name: "trailmind_v4_run_clock_integration_audit"
    });
    repository = new PostgresOutdoorResearchRepository({
      pool,
      cancellationPool,
      runtimeSchema: "public",
      statementTimeoutMs: 2_500
    });
    cases = await loadServerLiveProofCasesV1({
      caseIds: V4_CASE_BINDINGS.map((binding) => binding.caseId)
    });
    intents = new Map(cases.map((evaluationCase) => [
      evaluationCase.id,
      serverLiveProofCanonicalIntentV1(evaluationCase.input)
    ]));
  });

  after(async () => {
    await cancellationPool?.end();
    await pool?.end();
    await operatorPool?.end();
  });

  it("uses a direct non-elevated runtime login without base-table or active-view reads", async () => {
    const url = new URL(connectionString);
    const result = await pool.query(
      `SELECT current_user, session_user,
              rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls,
              has_table_privilege(
                current_user,
                'outdoor_research_projection_entities',
                'SELECT'
              ) AS base_select,
              has_table_privilege(
                current_user,
                'outdoor_research_active_projection_runs',
                'SELECT'
              ) AS view_select
         FROM pg_roles
        WHERE rolname = current_user`
    );
    assert.deepEqual(result.rows, [{
      current_user: decodeURIComponent(url.username),
      session_user: decodeURIComponent(url.username),
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false,
      base_select: false,
      view_select: false
    }]);
    await assert.rejects(
      () => pool.query(
        "SELECT * FROM outdoor_research_projection_entities LIMIT 1"
      ),
      (error) => error?.code === "42501"
    );
  });

  it("captures after current imports and reconciles all canonical planning cases", async () => {
    const runContext = await captureV4ProofRunContextAfterImports({
      pool: operatorPool,
      authorizationReference: "USER_AUTHORIZED_V4_RUN_CLOCK_INTEGRATION",
      ledgerNamespace: "outdoor-adventure-v4-run-clock-integration",
      caseManifestDigest: V4_MANIFEST_DIGEST
    });
    const diagnostic = await runV4DatabasePlanningClockGate({
      runContext,
      cases,
      intents,
      repository,
      researchAdventure: researchOutdoorAdventureWithTrailAccessV1
    });
    assert.equal(diagnostic.cases.length, V4_CASE_BINDINGS.length);
    assert(diagnostic.cases.every((record) =>
      record.proofAsOf === runContext.proofAsOf &&
      record.researchState === "ready"
    ));
    assert.equal(await reconcileV4DatabaseClockEvidence(
      operatorPool,
      runContext
    ), true);
    const binding = createV4ProofClockBinding(runContext, diagnostic);
    assert.equal(validateV4ProofClockBinding(
      runContext,
      diagnostic,
      binding
    ), true);
  });
});
