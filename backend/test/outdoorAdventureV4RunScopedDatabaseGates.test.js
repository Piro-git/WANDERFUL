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

const { Pool } = pg;
const connectionString = process.env.TRAILMIND_V4_RUN_DATABASE_URL;
const enabled = Boolean(connectionString);

describe("V4 run-scoped database planning clock integration", {
  skip: !enabled
}, () => {
  let pool;
  let cancellationPool;
  let repository;
  let cases;
  let intents;

  before(async () => {
    validateLoopbackProofDatabaseUrl(connectionString);
    pool = new Pool({
      connectionString,
      max: 3,
      allowExitOnIdle: true,
      application_name: "trailmind_v4_run_clock_integration"
    });
    cancellationPool = new Pool({
      connectionString,
      max: 2,
      allowExitOnIdle: true,
      application_name: "trailmind_v4_run_clock_integration_cancel"
    });
    repository = new PostgresOutdoorResearchRepository({
      pool,
      cancellationPool,
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
  });

  it("captures after current imports and reconciles all canonical planning cases", async () => {
    const runContext = await captureV4ProofRunContextAfterImports({
      pool,
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
      pool,
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

function validateLoopbackProofDatabaseUrl(value) {
  let url;
  try { url = new URL(value); } catch {
    throw new Error("TRAILMIND_V4_RUN_DATABASE_URL must be a URL.");
  }
  assert(new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname));
  assert.match(url.pathname, /v4.*proof/i);
  assert.match(decodeURIComponent(url.username), /proof/i);
}
