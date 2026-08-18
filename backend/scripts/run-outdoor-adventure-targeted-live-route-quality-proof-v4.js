import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import {
  loadServerLiveProofCasesV1,
  serverLiveProofCanonicalIntentV1,
  serverLiveProofRegionForCaseIdV1
} from "../evaluation/outdoorAdventureServerLiveProof/manifest.js";
import {
  V4_CASE_BINDINGS,
  V4_PROTECTED_RECEIPTS,
  V4_PROVIDER_CALL_LIMIT,
  assertNoSensitiveDurableValueV4,
  stableSerializeV4,
  validateV4CaseRecords
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/contract.js";
import {
  bindV4DurableRunReceiptIdentity,
  readAndVerifyV4DurableProofRunIdentity,
  validateV4DurableRunReceiptIdentity,
  writeCanonicalV4ArtifactExclusive,
  writeV4DurableProofRunIdentityArtifact
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/durableProofRunIdentity.js";
import {
  captureV4ProofRunContextAfterImports,
  reconcileV4DatabaseClockEvidence,
  runV4DatabasePlanningClockGate
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/databaseGate.js";
import {
  disableV4ProofProcessEnvironment,
  disabledV4FlagSnapshot,
  enableAndCaptureV4ExecutionFlags,
  runDisabledZeroWorkEndpointProbeV4
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/preflight.js";
import {
  attestV4GitCandidate
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/gitCandidateAttestation.js";
import {
  V4ProviderLedger,
  V4ProviderScheduler,
  createV4MeteredGraphHopperProvider,
  providerAccountingFromLedgerV4
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/providerControl.js";
import {
  evaluateV4Case,
  notRunV4CaseRecord
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/quality.js";
import {
  bindV4FutureReceiptClock,
  createV4ProofClockBinding,
  validateV4FutureReceiptClock
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/proofRunContext.js";
import {
  V4_GOLDEN_SET_MANIFEST_DIGEST,
  V4_GOLDEN_SET_POLICY_VERSION,
  V4_PRODUCT_SHAPING_POLICY_DIGEST,
  V4_PRODUCT_SHAPING_POLICY_VERSION,
  V4_REGIONAL_SOURCE_MANIFEST_DIGEST,
  admitV4ProviderAfterProofIdentityReconciliation,
  buildV4RunManifestRecord,
  createV4ProofRunIdentity
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/proofRunIdentity.js";
import {
  planAndRouteOutdoorAdventureV2
} from "../src/outdoorAdventure/outdoorAdventureOrchestratorV2.js";
import {
  PostgresOutdoorResearchRepository
} from "../src/outdoorResearch/postgresOutdoorResearchRepository.js";
import {
  researchOutdoorAdventureWithTrailAccessV1
} from "../src/outdoorResearch/outdoorResearchExecutor.js";
import {
  providerConfiguration
} from "../src/routing/graphHopperProvider.js";

const { Pool } = pg;
const REPOSITORY_ROOT = resolve(
  new URL("../..", import.meta.url).pathname
);
const FORBIDDEN_CLAIM_KEYS = new Set([
  "isguaranteedsafe",
  "legalcampingverified",
  "scenicqualityverified",
  "trailsafetyguaranteed",
  "wateravailabilityverified"
]);

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(
  import.meta.url
).pathname)) {
  await main();
}

async function main() {
  let ledger;
  let pool;
  let cancellationPool;
  try {
    const options = parseArguments(process.argv.slice(2));
    const gitAttestation = await attestV4GitCandidate({
      baselineCommit: options.baselineCommit,
      candidateCommit: options.candidateCommit
    });
    await assertProtectedHistoricalReceipts();
    const databaseUrl = process.env.TRAILMIND_V4_RUN_DATABASE_URL;
    validateLoopbackProofDatabaseUrl(databaseUrl);
    const initialFlags = disabledV4FlagSnapshot(process.env);
    await runDisabledZeroWorkEndpointProbeV4();

    pool = new Pool({
      connectionString: databaseUrl,
      max: 3,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
      application_name: "trailmind_v4_run_scoped_live_proof"
    });
    cancellationPool = new Pool({
      connectionString: databaseUrl,
      max: 2,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
      application_name: "trailmind_v4_run_scoped_live_cancel"
    });
    const repository = new PostgresOutdoorResearchRepository({
      pool,
      cancellationPool,
      statementTimeoutMs: 2_500
    });
    const cases = await loadServerLiveProofCasesV1({
      caseIds: V4_CASE_BINDINGS.map((item) => item.caseId)
    });
    const intents = new Map(cases.map((evaluationCase) => [
      evaluationCase.id,
      serverLiveProofCanonicalIntentV1(evaluationCase.input)
    ]));
    const manifest = buildV4RunManifestRecord(options.authorizationReference);
    const runContext = await captureV4ProofRunContextAfterImports({
      pool,
      authorizationReference: options.authorizationReference,
      ledgerNamespace: options.ledgerNamespace,
      caseManifestDigest: manifest.digest
    });
    const runIdentity = createV4ProofRunIdentity({
      baselineCommit: options.baselineCommit,
      candidateCommit: options.candidateCommit,
      authorizationReference: options.authorizationReference,
      ledgerNamespace: options.ledgerNamespace,
      providerCallLimit: V4_PROVIDER_CALL_LIMIT,
      caseManifest: manifest,
      proofRunContext: runContext,
      gitCandidateAttestationDigest: gitAttestation.digest,
      goldenSetManifestDigest: V4_GOLDEN_SET_MANIFEST_DIGEST,
      goldenSetPolicyVersion: V4_GOLDEN_SET_POLICY_VERSION,
      productShapingPolicyVersion: V4_PRODUCT_SHAPING_POLICY_VERSION,
      productShapingPolicyDigest: V4_PRODUCT_SHAPING_POLICY_DIGEST,
      regionalSourceManifestDigest: V4_REGIONAL_SOURCE_MANIFEST_DIGEST
    });
    const identityArtifactDigest =
      await writeV4DurableProofRunIdentityArtifact(
        options.identityPath,
        runIdentity,
        runContext
      );
    const durableRun = await readAndVerifyV4DurableProofRunIdentity(
      options.identityPath,
      {
        artifactDigest: identityArtifactDigest,
        baselineCommit: options.baselineCommit,
        candidateCommit: options.candidateCommit,
        authorizationReference: options.authorizationReference,
        ledgerNamespace: options.ledgerNamespace,
        providerCallLimit: V4_PROVIDER_CALL_LIMIT,
        gitCandidateAttestationDigest: gitAttestation.digest
      }
    );
    await assertDatabaseAdmission(pool);
    const databaseDiagnostic = await runV4DatabasePlanningClockGate({
      runContext,
      cases,
      intents,
      repository,
      researchAdventure: researchOutdoorAdventureWithTrailAccessV1
    });
    await reconcileV4DatabaseClockEvidence(pool, runContext);
    const proofClockBinding = createV4ProofClockBinding(
      runContext,
      databaseDiagnostic
    );

    // Credential validation is deliberately after every database admission
    // gate and its returned configuration is never retained.
    const executionFlags = enableAndCaptureV4ExecutionFlags(process.env);
    await admitV4ProviderAfterProofIdentityReconciliation({
      runIdentity: durableRun.identity,
      runContext: durableRun.runContext,
      databaseDiagnostic,
      proofClockBinding
    }, () => providerConfiguration(process.env));

    ledger = new V4ProviderLedger(options.ledgerPath, {
      authorizationReference: options.authorizationReference,
      ledgerNamespace: options.ledgerNamespace,
      proofRunIdentityDigest: durableRun.identity.digest,
      proofRunIdentityArtifactDigest: durableRun.artifactDigest
    });
    const initialLedger = await ledger.initialize();
    if (initialLedger.calls.length !== 0) throw proofError("ledger_not_fresh");

    const scheduler = new V4ProviderScheduler();
    const records = [];

    for (const evaluationCase of cases) {
      if (scheduler.circuitOpened) {
        records.push(notRunV4CaseRecord(
          evaluationCase.id,
          "provider_circuit_open"
        ));
        continue;
      }
      const before = await ledger.snapshot();
      let response = null;
      let executionErrorCode = null;
      try {
        response = await planAndRouteOutdoorAdventureV2(
          {
            schemaVersion: 2,
            intent: serverLiveProofCanonicalIntentV1(evaluationCase.input)
          },
          {
            repository,
            clock: runContext.clock,
            provider: createV4MeteredGraphHopperProvider({
              caseId: evaluationCase.id,
              controlledFailureAfterFirstSuccess:
                evaluationCase.id === V4_CASE_BINDINGS[0].caseId,
              env: process.env,
              ledger,
              scheduler
            })
          },
          {
            maximumProposals: 3,
            maximumConcurrency: 1
          }
        );
      } catch (error) {
        executionErrorCode = safeErrorCode(error);
      }
      const after = await ledger.snapshot();
      const caseCalls = after.calls.slice(before.calls.length);
      const controlledCall = caseCalls.find((call) =>
        call.controlledPostSuccessFailure === true
      );
      const record = await evaluateV4Case({
        evaluationCase,
        routedAlternatives: response?.routedAlternatives,
        observedPlanningState: response?.state ?? executionErrorCode ?? "failed",
        providerExecuted: caseCalls.length > 0,
        providerAttemptCount: caseCalls.length,
        controlledProviderState: evaluationCase.id ===
            V4_CASE_BINDINGS[0].caseId
          ? {
              injectionArmed: controlledCall !== undefined,
              genuineProviderSuccessBeforeInjection:
                controlledCall?.outcome === "success"
            }
          : null,
        regionContainsRoute: (coordinates) => regionContainsRoute(
          pool,
          serverLiveProofRegionForCaseIdV1(evaluationCase.id),
          coordinates
        ),
        falseClaimCountForRoute
      });
      records.push(record);
    }

    validateV4CaseRecords(records);
    const settledLedger = await ledger.snapshot();
    const ledgerSha256 = createHash("sha256").update(
      await readFile(options.ledgerPath)
    ).digest("hex");
    const providerAccounting = {
      ...providerAccountingFromLedgerV4(
        settledLedger,
        scheduler.receipt(),
        {
          authorizationReference: options.authorizationReference,
          ledgerNamespace: options.ledgerNamespace,
          proofRunIdentityDigest: durableRun.identity.digest,
          proofRunIdentityArtifactDigest: durableRun.artifactDigest
        }
      ),
      authorizationReference: options.authorizationReference,
      ledgerNamespace: options.ledgerNamespace,
      proofRunIdentityDigest: durableRun.identity.digest,
      proofRunIdentityArtifactDigest: durableRun.artifactDigest,
      ledgerSha256,
      providerCredentialAdmitted: true,
      providerEgressAdmitted: true
    };
    const captureIdentity = bindV4DurableRunReceiptIdentity({
      receiptVersion:
        "outdoor-adventure-targeted-live-route-quality-proof-v4-run-context-v2-capture",
      ledgerSha256,
      status: records.every((record) =>
        record.caseEvaluationOutcome === "pass"
      ) ? "passed" : "failed",
      databaseAdmissionPassed: true,
      databaseDiagnostic,
      providerAccounting,
      cases: records,
      featureFlags: {
        initial: initialFlags,
        execution: executionFlags
      },
      privacy: {
        forbiddenFieldCount: 0,
        rawProviderMaterialRetained: false,
        routeShapeRetained: false,
        preciseLocationRetained: false,
        providerUrlRetained: false,
        credentialRetained: false,
        promptRetained: false,
        databaseUrlRetained: false,
        appAttestMaterialRetained: false,
        unboundedErrorRetained: false
      }
    }, durableRun);
    const capture = bindV4FutureReceiptClock(
      captureIdentity,
      durableRun.runContext,
      databaseDiagnostic,
      proofClockBinding
    );
    validateV4DurableRunReceiptIdentity(capture, durableRun);
    validateV4FutureReceiptClock(
      capture,
      durableRun.runContext,
      databaseDiagnostic
    );
    assertNoSensitiveDurableValueV4(capture);
    await writeCanonicalV4ArtifactExclusive(options.capturePath, capture);
    process.stdout.write(`${stableSerializeV4({
      status: capture.status,
      attempted: providerAccounting.attempted,
      successful: providerAccounting.successful,
      failed: providerAccounting.failed,
      timedOut: providerAccounting.timedOut,
      cancelled: providerAccounting.cancelled,
      unused: providerAccounting.unused,
      circuitOpened: providerAccounting.circuitOpened,
      gitCandidateAttestationDigest: gitAttestation.digest,
      proofRunIdentityDigest: durableRun.identity.digest,
      proofRunIdentityArtifactDigest: durableRun.artifactDigest,
      caseOutcomes: records.map((record) => ({
        caseId: record.caseId,
        technical: record.technicalPipelineOutcome,
        product: record.productQualityOutcome,
        evaluation: record.caseEvaluationOutcome
      }))
    })}\n`);
  } catch (error) {
    process.stdout.write(`${stableSerializeV4({
      status: "not_run",
      errorCode: safeErrorCode(error),
      attempted: await safeAttemptedCount(ledger)
    })}\n`);
    process.exitCode = 1;
  } finally {
    await cleanupV4ProofProcess({
      cancellationPool,
      pool,
      ledger,
      env: process.env
    });
  }
}

export async function cleanupV4ProofProcess({
  cancellationPool,
  pool,
  ledger,
  env
}) {
  await cancellationPool?.end().catch(() => {});
  await pool?.end().catch(() => {});
  disableV4ProofProcessEnvironment(env);
  await ledger?.close().catch(() => {});
}

async function assertDatabaseAdmission(pool) {
  const result = await pool.query(
    `SELECT
       (SELECT count(*) FROM trailmind_schema_migrations) AS migrations,
       (SELECT count(*) FROM outdoor_evidence_regions region
          JOIN outdoor_evidence_imports import
            ON import.import_id = region.active_import_id
           AND import.region_id = region.region_id
           AND import.status = 'active'
          JOIN outdoor_research_active_projection_runs run
            ON run.region_id = region.region_id
           AND run.input_import_id = import.import_id
         WHERE region.region_id IN ('harz-v1', 'innsbruck-alps-v1')) AS snapshots,
       (SELECT count(*) FROM outdoor_research_projection_quarantines)
         AS quarantines,
       (SELECT count(*) FROM pg_index postgres_index
          JOIN pg_class index ON index.oid = postgres_index.indexrelid
         WHERE index.relname IN (
           'outdoor_research_projection_entities_trail_point_gist_idx',
           'outdoor_research_projection_entities_trail_geography_gist_idx'
         ) AND postgres_index.indisvalid AND postgres_index.indisready)
         AS route_indexes,
       (SELECT NOT (rolsuper OR rolcreatedb OR rolcreaterole OR
                    rolreplication OR rolbypassrls)
          FROM pg_roles WHERE rolname = current_user) AS least_privilege`
  );
  const row = result.rows[0];
  if (Number(row?.migrations) !== 7 || Number(row?.snapshots) !== 2 ||
      Number(row?.quarantines) !== 0 || Number(row?.route_indexes) !== 2 ||
      row?.least_privilege !== true) {
    throw proofError("database_admission_failed");
  }
}

async function assertProtectedHistoricalReceipts() {
  for (const receipt of V4_PROTECTED_RECEIPTS) {
    const digest = createHash("sha256").update(await readFile(resolve(
      REPOSITORY_ROOT,
      receipt.repoRelativePath
    ))).digest("hex");
    if (digest !== receipt.sha256) {
      throw proofError("protected_receipt_mismatch");
    }
  }
}

async function regionContainsRoute(pool, regionId, coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return false;
  const route = {
    type: "LineString",
    coordinates: coordinates.map((coordinate) =>
      Array.isArray(coordinate) ? coordinate.slice(0, 2) : coordinate
    )
  };
  const result = await pool.query(
    `SELECT ST_CoveredBy(
       ST_SetSRID(ST_GeomFromGeoJSON($2), 4326),
       region.boundary
     ) AS contained
       FROM outdoor_evidence_regions region
      WHERE region.region_id = $1
        AND region.enabled = true`,
    [regionId, JSON.stringify(route)]
  );
  return result.rowCount === 1 && result.rows[0].contained === true;
}

function falseClaimCountForRoute({ attempt, result }) {
  let count = 0;
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
      if (FORBIDDEN_CLAIM_KEYS.has(normalized) && child === true) count += 1;
      visit(child);
    }
  };
  visit(attempt?.provenance);
  visit({
    geometryProvider: result?.geometryProvider,
    routingStrategy: result?.routingStrategy,
    verificationState: result?.verificationState,
    distanceVerification: result?.distanceVerification
  });
  return count;
}

function parseArguments(values) {
  if (values.length !== 14 || values[0] !== "--baseline-commit" ||
      values[2] !== "--candidate-commit" ||
      values[4] !== "--authorization-reference" ||
      values[6] !== "--ledger-namespace" || values[8] !== "--ledger" ||
      values[10] !== "--capture" || values[12] !== "--identity" ||
      !commitIdentifier(values[1]) ||
      !commitIdentifier(values[3]) || !runIdentifier(values[5]) ||
      !runIdentifier(values[7]) || !absoluteTemporaryPath(values[9]) ||
      !absoluteTemporaryPath(values[11]) ||
      !absoluteTemporaryPath(values[13]) ||
      new Set([values[9], values[11], values[13]]).size !== 3) {
    throw proofError("invalid_arguments");
  }
  return {
    baselineCommit: values[1],
    candidateCommit: values[3],
    authorizationReference: values[5],
    ledgerNamespace: values[7],
    ledgerPath: values[9],
    capturePath: values[11],
    identityPath: values[13]
  };
}

function absoluteTemporaryPath(value) {
  return typeof value === "string" &&
    value.startsWith("/private/tmp/TrailMindV4RunRuntime-") &&
    !value.includes("..") && value.length <= 500;
}

function runIdentifier(value) {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
}

function commitIdentifier(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}

function validateLoopbackProofDatabaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw proofError("database_unavailable"); }
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname) ||
      !/v4.*proof/i.test(url.pathname) ||
      !/proof/i.test(decodeURIComponent(url.username))) {
    throw proofError("database_unavailable");
  }
}

async function safeAttemptedCount(ledger) {
  try { return (await ledger?.snapshot())?.calls?.length ?? 0; }
  catch { return 0; }
}

function safeErrorCode(error) {
  const code = error?.code;
  return typeof code === "string" && /^[a-z0-9_]{1,80}$/.test(code)
    ? code : "v4_run_scoped_proof_failed";
}

function proofError(code) {
  return Object.assign(new Error(code), { code });
}
