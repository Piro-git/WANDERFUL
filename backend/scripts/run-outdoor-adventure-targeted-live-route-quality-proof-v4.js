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
const DATABASE_STATEMENT_TIMEOUT_MS = 2_500;
const DATABASE_QUERY_TIMEOUT_MS = 3_000;
const CANCELLATION_QUERY_TIMEOUT_MS = 1_000;
const NORMALIZED_DATABASE_SERVER_ADDRESS_SQL =
  "host(inet_server_addr())";
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
  let operatorPool;
  const databaseFailureState = { failed: false };
  try {
    const options = parseArguments(process.argv.slice(2));
    const gitAttestation = await attestV4GitCandidate({
      baselineCommit: options.baselineCommit,
      candidateCommit: options.candidateCommit
    });
    await assertProtectedHistoricalReceipts();
    const databaseUrl = process.env.TRAILMIND_V4_RUN_DATABASE_URL;
    const operatorDatabaseUrl =
      process.env.TRAILMIND_V4_OPERATOR_DATABASE_URL;
    const databaseIdentities = validateLoopbackProofDatabaseUrls(
      databaseUrl,
      operatorDatabaseUrl
    );
    const initialFlags = disabledV4FlagSnapshot(process.env);
    await runDisabledZeroWorkEndpointProbeV4();

    pool = new Pool({
      connectionString: databaseUrl,
      max: 3,
      connectionTimeoutMillis: 10_000,
      query_timeout: DATABASE_QUERY_TIMEOUT_MS,
      statement_timeout: DATABASE_STATEMENT_TIMEOUT_MS,
      allowExitOnIdle: true,
      application_name: "trailmind_v4_run_scoped_live_proof"
    });
    monitorV4ProofPool(pool, databaseFailureState);
    cancellationPool = new Pool({
      connectionString: databaseUrl,
      max: 2,
      connectionTimeoutMillis: 10_000,
      query_timeout: CANCELLATION_QUERY_TIMEOUT_MS,
      statement_timeout: CANCELLATION_QUERY_TIMEOUT_MS,
      allowExitOnIdle: true,
      application_name: "trailmind_v4_run_scoped_live_cancel"
    });
    monitorV4ProofPool(cancellationPool, databaseFailureState);
    operatorPool = new Pool({
      connectionString: operatorDatabaseUrl,
      max: 2,
      connectionTimeoutMillis: 10_000,
      query_timeout: DATABASE_QUERY_TIMEOUT_MS,
      statement_timeout: DATABASE_STATEMENT_TIMEOUT_MS,
      allowExitOnIdle: true,
      application_name: "trailmind_v4_run_scoped_database_audit"
    });
    monitorV4ProofPool(operatorPool, databaseFailureState);
    const repository = new PostgresOutdoorResearchRepository({
      pool,
      cancellationPool,
      runtimeSchema: "public",
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
      pool: operatorPool,
      authorizationReference: options.authorizationReference,
      ledgerNamespace: options.ledgerNamespace,
      caseManifestDigest: manifest.digest
    });
    throwIfV4ProofPoolFailed(databaseFailureState);
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
    await runV4DatabaseAdmissionBoundary({
      runtimePool: pool,
      operatorPool,
      databaseIdentities,
      nextGate: async () => {
        throwIfV4ProofPoolFailed(databaseFailureState);
      }
    });
    const databaseDiagnostic = await runV4DatabasePlanningClockGate({
      runContext,
      cases,
      intents,
      repository,
      researchAdventure: researchOutdoorAdventureWithTrailAccessV1
    });
    throwIfV4ProofPoolFailed(databaseFailureState);
    await reconcileV4DatabaseClockEvidence(operatorPool, runContext);
    throwIfV4ProofPoolFailed(databaseFailureState);
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
          operatorPool,
          serverLiveProofRegionForCaseIdV1(evaluationCase.id),
          coordinates
        ),
        falseClaimCountForRoute
      });
      throwIfV4ProofPoolFailed(databaseFailureState);
      records.push(record);
    }

    validateV4CaseRecords(records);
    throwIfV4ProofPoolFailed(databaseFailureState);
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
      operatorPool,
      pool,
      ledger,
      env: process.env
    });
  }
}

export async function cleanupV4ProofProcess({
  cancellationPool,
  operatorPool,
  pool,
  ledger,
  env
}) {
  await cancellationPool?.end().catch(() => {});
  await pool?.end().catch(() => {});
  await operatorPool?.end().catch(() => {});
  disableV4ProofProcessEnvironment(env);
  await ledger?.close().catch(() => {});
}

export async function runV4DatabaseAdmissionBoundary({
  runtimePool,
  operatorPool,
  databaseIdentities,
  nextGate
}) {
  if (typeof nextGate !== "function") {
    throw proofError("database_runtime_role_admission_failed");
  }
  await assertDatabaseAdmission({
    runtimePool,
    operatorPool,
    databaseIdentities
  });
  return nextGate();
}

export async function assertDatabaseAdmission({
  runtimePool,
  operatorPool,
  databaseIdentities
}) {
  if (!runtimePool || !operatorPool || runtimePool === operatorPool) {
    throw proofError("database_runtime_role_admission_failed");
  }
  const result = await operatorPool.query(
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
         AS route_indexes`
  );
  const row = result.rows[0];
  if (Number(row?.migrations) !== 8 || Number(row?.snapshots) !== 2 ||
      Number(row?.quarantines) !== 0 || Number(row?.route_indexes) !== 2) {
    throw proofError("database_admission_failed");
  }
  const operator = await operatorPool.query(
    `SELECT current_user, session_user, current_database() AS database_name,
            ${NORMALIZED_DATABASE_SERVER_ADDRESS_SQL} AS server_address,
            inet_server_port() AS server_port,
            NOT (role.rolsuper OR role.rolcreatedb OR role.rolcreaterole OR
                 role.rolreplication OR role.rolbypassrls)
              AS bounded_read_auditor,
            NOT EXISTS (
              SELECT 1 FROM pg_auth_members membership
               WHERE membership.member = role.oid
            ) AS no_role_memberships,
            NOT has_database_privilege(
              current_user, current_database(), 'TEMPORARY'
            ) AS no_database_temporary,
            NOT EXISTS (
              SELECT 1 FROM pg_namespace namespace
               WHERE namespace.nspname NOT LIKE 'pg_temp_%'
                 AND has_schema_privilege(current_user, namespace.oid, 'CREATE')
            ) AS no_schema_create,
            NOT EXISTS (
              SELECT 1
                FROM pg_class relation
                JOIN pg_namespace namespace
                  ON namespace.oid = relation.relnamespace
               WHERE namespace.nspname = 'public'
                 AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
                 AND has_table_privilege(
                   current_user,
                   relation.oid,
                   'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
                 )
            ) AS no_relation_write,
            NOT EXISTS (
              SELECT 1 FROM pg_class relation
               WHERE relation.relowner = role.oid
            ) AND NOT EXISTS (
              SELECT 1 FROM pg_proc procedure
               WHERE procedure.proowner = role.oid
            ) AS owns_no_database_objects
       FROM pg_roles role
      WHERE role.rolname = current_user`
  );
  const runtime = await runtimePool.query(
    `SELECT current_user, session_user, current_database() AS database_name,
            ${NORMALIZED_DATABASE_SERVER_ADDRESS_SQL} AS server_address,
            inet_server_port() AS server_port,
            current_user = session_user AS direct_login,
            NOT (role.rolsuper OR role.rolcreatedb OR role.rolcreaterole OR
                 role.rolreplication OR role.rolbypassrls) AS least_privilege,
            role.rolinherit = false AS no_inherit,
            NOT EXISTS (
              SELECT 1 FROM pg_auth_members membership
               WHERE membership.member = role.oid
            ) AS no_role_memberships,
            NOT has_database_privilege(
              current_user, current_database(), 'TEMPORARY'
            ) AS no_database_temporary,
            NOT EXISTS (
              SELECT 1
                FROM pg_namespace namespace
               WHERE namespace.nspname NOT LIKE 'pg_temp_%'
                 AND has_schema_privilege(
                   current_user, namespace.oid, 'CREATE'
                 )
            ) AS no_schema_create,
            NOT has_table_privilege(
              current_user,
              'outdoor_research_projection_entities',
              'SELECT'
            ) AS no_projection_table_read,
            NOT has_table_privilege(
              current_user,
              'outdoor_research_active_projection_runs',
              'SELECT'
            ) AS no_active_view_read,
            NOT EXISTS (
              SELECT 1
                FROM pg_class relation
                JOIN pg_namespace namespace
                  ON namespace.oid = relation.relnamespace
               WHERE namespace.nspname = 'public'
                 AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
                 AND (
                   relation.relname LIKE 'outdoor\_%' ESCAPE '\' OR
                   relation.relname LIKE 'app\_attest\_%' ESCAPE '\' OR
                   relation.relname = 'trailmind_schema_migrations'
                 )
                 AND has_table_privilege(
                   current_user,
                   relation.oid,
                   'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
                 )
            ) AS no_operational_relation_privileges,
            NOT EXISTS (
              SELECT 1
                FROM pg_class relation
                JOIN pg_namespace namespace
                  ON namespace.oid = relation.relnamespace
               WHERE namespace.nspname = 'public'
                 AND relation.relkind = 'S'
                 AND has_sequence_privilege(
                   current_user, relation.oid, 'USAGE,SELECT,UPDATE'
                 )
            ) AS no_sequence_privileges,
            NOT EXISTS (
              SELECT 1 FROM pg_class relation
               WHERE relation.relowner = role.oid
            ) AND NOT EXISTS (
              SELECT 1 FROM pg_proc procedure
               WHERE procedure.proowner = role.oid
            ) AS owns_no_database_objects,
            has_function_privilege(
              current_user,
              'trailmind_runtime_outdoor_research_snapshot_context_v1(text,double precision,double precision)',
              'EXECUTE'
            ) AS snapshot_execute,
            has_function_privilege(
              current_user,
              'trailmind_runtime_outdoor_research_highlights_v1(uuid,text,double precision,double precision,text[],double precision,text[],integer,double precision)',
              'EXECUTE'
            ) AS highlights_execute,
            has_function_privilege(
              current_user,
              'trailmind_runtime_outdoor_research_route_memberships_v1(uuid,text,double precision,double precision,double precision,integer,integer)',
              'EXECUTE'
            ) AS memberships_execute,
            has_function_privilege(
              current_user,
              'trailmind_runtime_outdoor_research_route_assertions_v1(uuid,uuid[],text[],integer)',
              'EXECUTE'
            ) AS assertions_execute,
            has_function_privilege(
              current_user,
              'trailmind_runtime_outdoor_research_trail_access_candidates_v1(uuid,text,uuid[],double precision,integer,text[],text[],integer)',
              'EXECUTE'
            ) AS access_execute,
            NOT EXISTS (
              SELECT 1
                FROM pg_proc procedure
                JOIN pg_namespace namespace
                  ON namespace.oid = procedure.pronamespace
               WHERE namespace.nspname = 'public'
                 AND procedure.proname LIKE
                   'trailmind_runtime_outdoor_research_%_v1'
                 AND procedure.proname NOT IN (
                   'trailmind_runtime_outdoor_research_snapshot_context_v1',
                   'trailmind_runtime_outdoor_research_highlights_v1',
                   'trailmind_runtime_outdoor_research_route_memberships_v1',
                   'trailmind_runtime_outdoor_research_route_assertions_v1',
                   'trailmind_runtime_outdoor_research_trail_access_candidates_v1'
                 )
                 AND has_function_privilege(
                   current_user, procedure.oid, 'EXECUTE'
                 )
            ) AS no_unexpected_runtime_execute,
            (
              SELECT count(*) = 5 AND
                     count(DISTINCT owner.oid) = 1 AND
                     bool_and(
                       NOT owner.rolcanlogin AND
                       NOT owner.rolinherit AND
                       NOT owner.rolsuper AND
                       NOT owner.rolcreatedb AND
                       NOT owner.rolcreaterole AND
                       NOT owner.rolreplication AND
                       NOT owner.rolbypassrls AND
                       NOT EXISTS (
                         SELECT 1 FROM pg_auth_members membership
                          WHERE membership.member = owner.oid
                       )
                     )
                FROM pg_proc procedure
                JOIN pg_namespace namespace
                  ON namespace.oid = procedure.pronamespace
                JOIN pg_roles owner ON owner.oid = procedure.proowner
               WHERE namespace.nspname = 'public'
                 AND procedure.proname LIKE
                   'trailmind_runtime_outdoor_research_%_v1'
            ) AS constrained_function_owner
       FROM pg_roles role
      WHERE role.rolname = current_user`
  );
  return validateV4DatabaseAdmissionRows({
    operator,
    runtime,
    databaseIdentities
  });
}

export function validateV4DatabaseAdmissionRows({
  operator,
  runtime,
  databaseIdentities
}) {
  const operatorRow = operator?.rows?.[0];
  const runtimeRow = runtime?.rows?.[0];
  if (
    operator?.rowCount !== 1 || runtime?.rowCount !== 1 ||
    !operatorRow || !runtimeRow ||
    !databaseIdentities?.operator || !databaseIdentities?.runtime ||
    operatorRow.current_user !== operatorRow.session_user ||
    runtimeRow.current_user !== runtimeRow.session_user ||
    operatorRow.current_user !== databaseIdentities.operator.username ||
    runtimeRow.current_user !== databaseIdentities.runtime.username ||
    operatorRow.current_user === runtimeRow.current_user ||
    operatorRow.database_name !== databaseIdentities.operator.database ||
    runtimeRow.database_name !== databaseIdentities.runtime.database ||
    operatorRow.database_name !== runtimeRow.database_name ||
    operatorRow.server_address !== runtimeRow.server_address ||
    Number(operatorRow.server_port) !== Number(runtimeRow.server_port) ||
    String(operatorRow.server_port) !== databaseIdentities.operator.port ||
    String(runtimeRow.server_port) !== databaseIdentities.runtime.port ||
    !normalizedLoopbackServerAddress(operatorRow.server_address) ||
    operatorRow.bounded_read_auditor !== true ||
    operatorRow.no_role_memberships !== true ||
    operatorRow.no_database_temporary !== true ||
    operatorRow.no_schema_create !== true ||
    operatorRow.no_relation_write !== true ||
    operatorRow.owns_no_database_objects !== true ||
    Object.entries(runtimeRow).some(([key, value]) =>
      ![
        'current_user', 'session_user', 'database_name',
        'server_address', 'server_port'
      ].includes(key) && value !== true
    )
  ) {
    throw proofError("database_runtime_role_admission_failed");
  }
  return true;
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

export function validateLoopbackProofDatabaseUrls(
  runtimeValue,
  operatorValue
) {
  const runtime = strictProofDatabaseIdentity(runtimeValue);
  const operator = strictProofDatabaseIdentity(operatorValue);
  if (
    runtime.host !== operator.host ||
    runtime.port !== operator.port ||
    runtime.database !== operator.database ||
    runtime.username === operator.username
  ) {
    throw proofError("database_unavailable");
  }
  return Object.freeze({ runtime, operator });
}

function strictProofDatabaseIdentity(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw proofError("database_unavailable");
  }
  const rawHost = rawDatabaseUrlHost(value);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  let username;
  let database;
  try {
    username = decodeURIComponent(url.username);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw proofError("database_unavailable");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.search !== "" ||
    url.hash !== "" ||
    rawHost === null ||
    rawHost.toLowerCase() !== host ||
    !loopbackHost(host) ||
    !/v4.*proof/i.test(database) ||
    !/proof/i.test(username) ||
    username.length === 0 ||
    database.length === 0 ||
    database.includes("/") ||
    url.pathname.slice(1).includes("/")
  ) {
    throw proofError("database_unavailable");
  }
  return Object.freeze({
    host,
    port: url.port || "5432",
    database,
    username
  });
}

function rawDatabaseUrlHost(value) {
  if (typeof value !== "string") return null;
  const schemeEnd = value.indexOf("://");
  if (schemeEnd < 0) return null;
  const authorityStart = schemeEnd + 3;
  const pathStart = value.indexOf("/", authorityStart);
  if (pathStart < 0) return null;
  const authority = value.slice(authorityStart, pathStart);
  const hostAndPort = authority.slice(authority.lastIndexOf("@") + 1);
  if (hostAndPort.startsWith("[")) {
    const closingBracket = hostAndPort.indexOf("]");
    if (closingBracket < 0) return null;
    return hostAndPort.slice(1, closingBracket);
  }
  const colon = hostAndPort.lastIndexOf(":");
  return colon < 0 ? hostAndPort : hostAndPort.slice(0, colon);
}

function loopbackHost(value) {
  return new Set(["127.0.0.1", "localhost", "::1"]).has(value);
}

function normalizedLoopbackServerAddress(value) {
  return value === "127.0.0.1" || value === "::1";
}

function monitorV4ProofPool(pool, state) {
  pool.on("error", () => {
    state.failed = true;
  });
}

function throwIfV4ProofPoolFailed(state) {
  if (state.failed) throw proofError("database_unavailable");
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
