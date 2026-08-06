import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import {
  loadServerLiveProofCasesV1,
  serverLiveProofCanonicalIntentV1,
  serverLiveProofRegionForCaseIdV1
} from "../evaluation/outdoorAdventureServerLiveProof/manifest.js";
import {
  V4_CASE_BINDINGS,
  assertNoSensitiveDurableValueV4,
  stableSerializeV4,
  validateV4CaseRecords
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/contract.js";
import {
  disabledV4FlagSnapshot
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/preflight.js";
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
  planAndRouteOutdoorAdventureV2
} from "../src/outdoorAdventure/outdoorAdventureOrchestratorV2.js";
import {
  PostgresOutdoorResearchRepository
} from "../src/outdoorResearch/postgresOutdoorResearchRepository.js";
import {
  providerConfiguration
} from "../src/routing/graphHopperProvider.js";

export const V4_ATTEMPT_FOUR_AUTHORIZATION_REFERENCE =
  "USER_AUTHORIZED_V4_ATTEMPT_4_2026-08-05_15_CALLS";
export const V4_ATTEMPT_FOUR_LEDGER_NAMESPACE =
  "outdoor-adventure-v4-attempt-4-2026-08-05";

const { Pool } = pg;
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
    const databaseUrl = process.env.TRAILMIND_V4_ATTEMPT4_DATABASE_URL;
    validateLoopbackProofDatabaseUrl(databaseUrl);
    const initialFlags = disabledV4FlagSnapshot(process.env);

    pool = new Pool({
      connectionString: databaseUrl,
      max: 3,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
      application_name: "trailmind_v4_attempt4_live_proof"
    });
    cancellationPool = new Pool({
      connectionString: databaseUrl,
      max: 2,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
      application_name: "trailmind_v4_attempt4_live_cancel"
    });
    await assertDatabaseAdmission(pool);

    // Credential validation is deliberately after every database admission
    // gate and its returned configuration is never retained.
    providerConfiguration(process.env);

    ledger = new V4ProviderLedger(options.ledgerPath, {
      authorizationReference: V4_ATTEMPT_FOUR_AUTHORIZATION_REFERENCE,
      ledgerNamespace: V4_ATTEMPT_FOUR_LEDGER_NAMESPACE
    });
    const initialLedger = await ledger.initialize();
    if (initialLedger.calls.length !== 0) throw proofError("ledger_not_fresh");

    const scheduler = new V4ProviderScheduler();
    const repository = new PostgresOutdoorResearchRepository({
      pool,
      cancellationPool,
      statementTimeoutMs: 2_500
    });
    const cases = await loadServerLiveProofCasesV1({
      caseIds: V4_CASE_BINDINGS.map((item) => item.caseId)
    });
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
          authorizationReference: V4_ATTEMPT_FOUR_AUTHORIZATION_REFERENCE,
          ledgerNamespace: V4_ATTEMPT_FOUR_LEDGER_NAMESPACE
        }
      ),
      authorizationReference: V4_ATTEMPT_FOUR_AUTHORIZATION_REFERENCE,
      ledgerNamespace: V4_ATTEMPT_FOUR_LEDGER_NAMESPACE,
      ledgerSha256,
      providerCredentialAdmitted: true,
      providerEgressAdmitted: true
    };
    const executionFlags = disabledV4FlagSnapshot(process.env);
    const capture = {
      schemaVersion: 1,
      receiptVersion:
        "outdoor-adventure-targeted-live-route-quality-proof-v4-attempt-4-capture",
      generatedAt: new Date().toISOString(),
      authorizationReference: V4_ATTEMPT_FOUR_AUTHORIZATION_REFERENCE,
      ledgerNamespace: V4_ATTEMPT_FOUR_LEDGER_NAMESPACE,
      ledgerSha256,
      status: records.every((record) =>
        record.caseEvaluationOutcome === "pass"
      ) ? "passed" : "failed",
      databaseAdmissionPassed: true,
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
    };
    assertNoSensitiveDurableValueV4(capture);
    await writeFile(options.capturePath, `${stableSerializeV4(capture)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    process.stdout.write(`${stableSerializeV4({
      status: capture.status,
      attempted: providerAccounting.attempted,
      successful: providerAccounting.successful,
      failed: providerAccounting.failed,
      timedOut: providerAccounting.timedOut,
      cancelled: providerAccounting.cancelled,
      unused: providerAccounting.unused,
      circuitOpened: providerAccounting.circuitOpened,
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
    await ledger?.close().catch(() => {});
    await cancellationPool?.end().catch(() => {});
    await pool?.end().catch(() => {});
  }
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
  if (values.length !== 4 || values[0] !== "--ledger" ||
      values[2] !== "--capture" || !absoluteTemporaryPath(values[1]) ||
      !absoluteTemporaryPath(values[3]) || values[1] === values[3]) {
    throw proofError("invalid_arguments");
  }
  return { ledgerPath: values[1], capturePath: values[3] };
}

function absoluteTemporaryPath(value) {
  return typeof value === "string" &&
    value.startsWith("/private/tmp/TrailMindV4Attempt4Runtime-") &&
    !value.includes("..") && value.length <= 500;
}

function validateLoopbackProofDatabaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw proofError("database_unavailable"); }
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname) ||
      !/v4a4.*membership.*perf/i.test(url.pathname) ||
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
    ? code : "v4_attempt4_failed";
}

function proofError(code) {
  return Object.assign(new Error(code), { code });
}
