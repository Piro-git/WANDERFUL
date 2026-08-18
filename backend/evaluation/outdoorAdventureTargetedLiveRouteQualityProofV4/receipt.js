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
  assertNoSensitiveDurableValueV4,
  sha256V4,
  stableSerializeV4,
  validateProtectedReceipts,
  validateV4Summary
} from "./contract.js";
import {
  bindV4DurableRunSummaryIdentity,
  validateV4DurableProofRun,
  validateV4DurableRunReceiptIdentity,
  validateV4DurableRunSummary
} from "./durableProofRunIdentity.js";
import {
  validateV4FutureReceiptClock
} from "./proofRunContext.js";
import {
  validateV4ProviderLedger
} from "./providerControl.js";
import {
  v4PublicationCleanupReceiptBinding,
  validateV4PublicationCleanupEvidence
} from "./publicationCleanup.js";
import { notRunV4CaseRecord } from "./quality.js";

export function buildStorageBlockedV4Summary(input) {
  return buildHistoricalAttemptOneStorageBlockedV4Summary(input);
}

export function buildHistoricalAttemptOneStorageBlockedV4Summary({
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

export function buildV4FutureRunSummary({
  durableRun,
  capture,
  ledger,
  ledgerSerialized,
  finalFlags,
  disabledProbe,
  protectedHistoricalReceipts,
  cleanupEvidence
}) {
  validateV4FuturePublicationEvidence({
    durableRun,
    capture,
    ledger,
    ledgerSerialized,
    finalFlags,
    disabledProbe,
    protectedHistoricalReceipts
  });
  validateV4PublicationCleanupEvidence(cleanupEvidence);
  const cleanup = v4PublicationCleanupReceiptBinding(cleanupEvidence);
  const providerExecuted = capture.providerAccounting.attempted > 0;
  const routeQualityPassed = capture.status === "passed";
  const summary = bindV4DurableRunSummaryIdentity({
    receiptVersion:
      "outdoor-adventure-targeted-live-route-quality-proof-v4-future-summary-v1",
    status: capture.status,
    ...(capture.status === "failed" ? {
      failureReasonCode: "route_quality_or_provider_proof_failed"
    } : {}),
    decisions: {
      databasePreflight: "passed",
      physicalAppAttest: "not_run",
      providerProof: providerExecuted ? "passed" : "failed",
      routeQuality: routeQualityPassed ? "passed" : "failed",
      cleanupAndContainment: cleanup.cleanupComplete ? "passed" : "failed"
    },
    databaseDiagnostic: structuredClone(capture.databaseDiagnostic),
    proofClockBinding: structuredClone(capture.proofClockBinding),
    physicalAppAttestReceiptPresent: false,
    physicalAppAttestClassification:
      "not_run_no_reviewed_physical_receipt",
    cases: structuredClone(capture.cases),
    providerAccounting: structuredClone(capture.providerAccounting),
    featureFlags: {
      initial: structuredClone(capture.featureFlags.initial),
      execution: structuredClone(capture.featureFlags.execution),
      final: structuredClone(finalFlags)
    },
    cleanup,
    protectedHistoricalReceipts:
      structuredClone(protectedHistoricalReceipts),
    privacy: structuredClone(capture.privacy),
    manualExpertReview: {
      completed: false,
      classification: "not_completed"
    },
    closedBetaEligible: false,
    deployed: false,
    released: false,
    committed: false,
    pushed: false
  }, durableRun);
  validateV4FutureRunSummaryPublication({
    summary,
    durableRun,
    capture,
    ledger,
    ledgerSerialized,
    finalFlags,
    disabledProbe,
    protectedHistoricalReceipts,
    cleanupEvidence
  });
  return summary;
}

export function validateV4FutureRunSummaryPublication({
  summary,
  durableRun,
  capture,
  ledger,
  ledgerSerialized,
  finalFlags,
  disabledProbe,
  protectedHistoricalReceipts,
  cleanupEvidence
}) {
  validateV4FuturePublicationEvidence({
    durableRun,
    capture,
    ledger,
    ledgerSerialized,
    finalFlags,
    disabledProbe,
    protectedHistoricalReceipts
  });
  validateV4PublicationCleanupEvidence(cleanupEvidence);
  validateV4DurableRunSummary(summary, durableRun);
  validateV4FutureReceiptClock(
    summary,
    durableRun.runContext,
    summary.databaseDiagnostic
  );
  if (summary.status !== capture.status ||
      summary.proofRunIdentityArtifactDigest !==
        durableRun.artifactDigest ||
      !canonicallyEqual(summary.databaseDiagnostic, capture.databaseDiagnostic) ||
      !canonicallyEqual(summary.proofClockBinding, capture.proofClockBinding) ||
      !canonicallyEqual(summary.cases, capture.cases) ||
      !canonicallyEqual(
        summary.providerAccounting,
        capture.providerAccounting
      ) || !canonicallyEqual(summary.featureFlags.final, finalFlags) ||
      !canonicallyEqual(
        summary.protectedHistoricalReceipts,
        protectedHistoricalReceipts
      ) || !canonicallyEqual(
        summary.cleanup,
        v4PublicationCleanupReceiptBinding(cleanupEvidence)
      ) || summary.decisions.cleanupAndContainment !== "passed") {
    invalidFutureSummary();
  }
  assertNoSensitiveDurableValueV4(summary);
  return true;
}

export function validateV4FuturePublicationEvidence({
  durableRun,
  capture,
  ledger,
  ledgerSerialized,
  finalFlags,
  disabledProbe,
  protectedHistoricalReceipts
}) {
  validateV4DurableProofRun(durableRun);
  validateV4DurableRunReceiptIdentity(capture, durableRun);
  validateV4FutureReceiptClock(
    capture,
    durableRun.runContext,
    capture.databaseDiagnostic
  );
  if (!new Set(["passed", "failed"]).has(capture.status) ||
      capture.databaseAdmissionPassed !== true ||
      !plainObject(capture.featureFlags) || !plainObject(finalFlags) ||
      !plainObject(disabledProbe) || disabledProbe.passed !== true ||
      disabledProbe.authorizationOperations !== 0 ||
      disabledProbe.databaseOperations !== 0 ||
      disabledProbe.providerOperations !== 0 ||
      disabledProbe.budgetOperations !== 0 ||
      disabledProbe.leaseOperations !== 0 ||
      disabledProbe.orchestratorOperations !== 0 ||
      finalFlags.exactAdmissionVerified !== true ||
      !plainObject(finalFlags.flags) ||
      Object.keys(finalFlags.flags).length !== V4_FLAG_NAMES.length ||
      V4_FLAG_NAMES.some((name) => finalFlags.flags[name] !== false)) {
    invalidFutureSummary();
  }
  validateProtectedReceipts(protectedHistoricalReceipts);
  validateLedgerBinding({ durableRun, capture, ledger, ledgerSerialized });
  assertNoSensitiveDurableValueV4(capture);
}

function validateLedgerBinding({
  durableRun,
  capture,
  ledger,
  ledgerSerialized
}) {
  if (typeof ledgerSerialized !== "string" ||
      ledgerSerialized.length > 131_072) invalidFutureSummary();
  validateV4ProviderLedger(ledger, {
    authorizationReference: durableRun.identity.authorizationReference,
    ledgerNamespace: durableRun.identity.ledgerNamespace,
    proofRunIdentityDigest: durableRun.identity.digest,
    proofRunIdentityArtifactDigest: durableRun.artifactDigest
  });
  const ledgerSha256 = sha256V4(ledgerSerialized);
  const accounting = capture.providerAccounting;
  const counts = Object.fromEntries([
    "success", "failed", "timed_out", "cancelled"
  ].map((outcome) => [outcome, ledger.calls.filter((call) =>
    call.outcome === outcome
  ).length]));
  if (capture.ledgerSha256 !== ledgerSha256 ||
      accounting.ledgerSha256 !== ledgerSha256 ||
      accounting.proofRunIdentityDigest !== durableRun.identity.digest ||
      accounting.proofRunIdentityArtifactDigest !==
        durableRun.artifactDigest ||
      accounting.attempted !== ledger.calls.length ||
      accounting.successful !== counts.success ||
      accounting.failed !== counts.failed ||
      accounting.timedOut !== counts.timed_out ||
      accounting.cancelled !== counts.cancelled ||
      accounting.controlledPostSuccessFailures !== ledger.calls.filter(
        (call) => call.controlledPostSuccessFailure
      ).length || ledger.calls.some((call) => call.outcome === "reserved")) {
    invalidFutureSummary();
  }
}

function canonicallyEqual(left, right) {
  try {
    return stableSerializeV4(left) === stableSerializeV4(right);
  } catch {
    return false;
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" &&
    !Array.isArray(value);
}

function invalidFutureSummary() {
  throw new TypeError("invalid_v4_future_summary_publication");
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
