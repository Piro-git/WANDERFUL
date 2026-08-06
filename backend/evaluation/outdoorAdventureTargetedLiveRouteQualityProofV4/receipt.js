import {
  V4_AUTHORIZATION_REFERENCE,
  V4_BASELINE_COMMIT,
  V4_CASE_BINDINGS,
  V4_FLAG_NAMES,
  V4_MANIFEST_DIGEST,
  V4_PROOF_CLASSIFICATION,
  V4_PROOF_VERSION,
  V4_PROTECTED_RECEIPTS,
  V4_PROVIDER_CALL_LIMIT,
  V4_SCHEMA_VERSION,
  validateV4Summary
} from "./contract.js";
import { notRunV4CaseRecord } from "./quality.js";

export function buildStorageBlockedV4Summary({
  generatedAt,
  storage,
  processPreflight,
  disabledProbe,
  protectedHistoricalReceipts
}) {
  if (
    typeof generatedAt !== "string" ||
    !storage || storage.passed !== false ||
    !Number.isFinite(storage.settledFreeGiB) ||
    storage.requiredFreeGiB !== 10 || storage.sampleCount < 2 ||
    !processPreflight || processPreflight.passed !== true ||
    processPreflight.conflictClassCount !== 0 ||
    !disabledProbe || disabledProbe.passed !== true ||
    !Array.isArray(protectedHistoricalReceipts)
  ) {
    throw new TypeError("invalid_storage_blocked_receipt_input");
  }
  const allFalse = Object.fromEntries(
    V4_FLAG_NAMES.map((name) => [name, false])
  );
  const summary = {
    schemaVersion: V4_SCHEMA_VERSION,
    proofVersion: V4_PROOF_VERSION,
    proofClassification: V4_PROOF_CLASSIFICATION,
    baselineCommit: V4_BASELINE_COMMIT,
    candidateCommit: V4_BASELINE_COMMIT,
    authorizationReference: V4_AUTHORIZATION_REFERENCE,
    generatedAt,
    status: "blocked",
    blockedReasonCode: "insufficient_settled_free_storage",
    manifest: {
      digest: V4_MANIFEST_DIGEST,
      bindings: V4_CASE_BINDINGS.map((item) => ({
        caseId: item.caseId,
        goldenCaseId: item.goldenCaseId,
        fixtureDigest: item.fixtureDigest,
        goldenCaseDigest: item.goldenCaseDigest
      }))
    },
    decisions: {
      databasePreflight: "blocked",
      physicalAppAttest: "not_run",
      providerProof: "not_run",
      routeQuality: "not_run",
      cleanupAndContainment: "passed"
    },
    databasePreflightEvidence: {
      processConflictGatePassed: true,
      checkedProcessClassCount: processPreflight.checkedClassCount,
      conflictingProcessClassCount: 0,
      settledStorageSampleCount: storage.sampleCount,
      settledFreeGiB: storage.settledFreeGiB,
      requiredFreeGiB: storage.requiredFreeGiB,
      storageGatePassed: false,
      disposablePostgisProvisioned: false,
      migrationFirstRunAppliedCount: 0,
      migrationSecondRunAppliedCount: 0,
      currentRegionalImportCount: 0,
      currentProjectionCount: 0,
      promotedQuarantineRowCount: 0,
      reviewedIndexCount: 0,
      membershipQueryCount: 0,
      accessResolutionQueryCount: 0,
      cancellationRollbackVerified: false,
      classification: "not_run_after_storage_gate"
    },
    physicalAppAttestReceiptPresent: false,
    physicalAppAttestClassification: "not_run_no_reviewed_physical_receipt",
    cases: V4_CASE_BINDINGS.map((item) =>
      structuredClone(notRunV4CaseRecord(
        item.caseId,
        "database_preflight_blocked"
      ))
    ),
    providerAccounting: zeroProviderAccounting(),
    featureFlags: {
      initial: { exactAdmissionVerified: true, flags: { ...allFalse } },
      execution: { exactAdmissionVerified: true, flags: { ...allFalse } },
      final: { exactAdmissionVerified: true, flags: { ...allFalse } }
    },
    cleanup: {
      cleanupComplete: true,
      finalFlagsDisabled: true,
      disabledZeroWorkProbePassed: true,
      disabledZeroWorkDatabaseOperations: disabledProbe.databaseOperations,
      disabledZeroWorkProviderOperations: disabledProbe.providerOperations,
      disabledZeroWorkBudgetOperations: disabledProbe.budgetOperations,
      disabledZeroWorkLeaseOperations: disabledProbe.leaseOperations,
      providerCredentialRemovedFromProofProcess: true,
      poolsClosed: true,
      leasesReleased: true,
      taskOwnedArtifactsRemoved: true
    },
    protectedHistoricalReceipts,
    privacy: {
      forbiddenFieldCount: 0,
      rawProviderMaterialRetained: false,
      routeShapeRetained: false,
      preciseLocationRetained: false,
      unboundedErrorRetained: false,
      appAttestMaterialRetained: false
    },
    manualExpertReview: {
      completed: false,
      classification: "not_completed"
    },
    closedBetaEligible: false,
    deployed: false,
    released: false,
    committed: false,
    pushed: false
  };
  validateV4Summary(summary);
  return summary;
}

function zeroProviderAccounting() {
  return {
    hardLimit: V4_PROVIDER_CALL_LIMIT,
    maximumConcurrencyAllowed: 1,
    minimumCallStartSpacingMilliseconds: 2_000,
    attempted: 0,
    successful: 0,
    failed: 0,
    timedOut: 0,
    cancelled: 0,
    controlledPostSuccessFailures: 0,
    unused: V4_PROVIDER_CALL_LIMIT,
    reconciled: true,
    maximumConcurrencyObserved: 0,
    minimumObservedStartSpacingMilliseconds: null,
    retriesAttempted: 0,
    probesAfterCircuitOpen: 0,
    attempt16Prevented: true,
    circuitOpened: false,
    circuitStopHonored: true,
    invalidRetryAfterObserved: false,
    invalidRetryAfterStoppedCase: false
  };
}
