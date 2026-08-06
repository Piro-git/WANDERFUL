import {
  V4_BASELINE_COMMIT,
  V4_CASE_BINDINGS,
  V4_FLAG_NAMES,
  V4_PROVIDER_CALL_LIMIT,
  assertNoSensitiveDurableValueV4,
  sha256V4,
  validateProtectedReceipts,
  validateProviderAccounting
} from "./contract.js";

export const V4_ATTEMPT_THREE_AUTHORIZATION_REFERENCE =
  "USER_AUTHORIZED_V4_ATTEMPT_3_2026-08-05_15_CALLS";
export const V4_ATTEMPT_THREE_RECEIPT_VERSION =
  "outdoor-adventure-targeted-live-route-quality-proof-v4-attempt-3";
export const V4_ATTEMPT_THREE_LEDGER_NAMESPACE =
  "outdoor-adventure-v4-attempt-3-2026-08-05";
export const V4_ATTEMPT_THREE_MANIFEST_DIGEST =
  "2391ffef6b77e8ede539c7ecd4c96f40ce840457c94ba8fe5662a2a9d8adb1e0";
export const V4_ATTEMPT_THREE_LEDGER_SHA256 =
  "dd646af7866a77f82ed595549c4d50a1f2bbf8f3ea3e62768afe9477d163f29f";
export const V4_ATTEMPT_THREE_PUBLISHED_RECEIPT_DIGEST =
  "885a389d02ac9d8e0e0f43232bdc367b2c92f689cea3145df5be852190995e86";

export const V4_PRIOR_ATTEMPT_RECEIPTS = Object.freeze({
  attemptOne: Object.freeze({
    markdownSha256:
      "fc1e00c7063b794136c2368bc3c950f5677077934c45905c25391973abfc5a14",
    summarySha256:
      "5477240eb9a2569cb0ffbf167f61c1edb87ededa7e8c420e271833e4c7f0063c"
  }),
  attemptTwo: Object.freeze({
    markdownSha256:
      "76650b3392885ba4683d6fdcd336aca3273e2b4040e359fb9aab0bd031b1f09b",
    summarySha256:
      "7aa8a4b992514ded013ef5ebc6a6218f87b559997220a3c240e7fc39a436d737"
  })
});

export const V4_ATTEMPT_THREE_DELETION_RECORDS = Object.freeze([
  Object.freeze({ name: "WanderfulReleaseDerivedData", diskUsageKiB: 806_656 }),
  Object.freeze({ name: "WanderfulDerivedData", diskUsageKiB: 961_736 }),
  Object.freeze({
    name: "TrailMindDerivedData-RoutableAccess-Final",
    diskUsageKiB: 1_063_192
  }),
  Object.freeze({
    name: "TrailMindDerivedData-RoutableAccess-Release",
    diskUsageKiB: 1_237_948
  }),
  Object.freeze({
    name: "TrailMindDerivedData-RoutableAccess-Debug",
    diskUsageKiB: 1_411_208
  }),
  Object.freeze({
    name: "TrailMindDerivedData-RoutableAccess",
    diskUsageKiB: 1_447_736
  })
]);

export class V4AttemptThreeContractError extends Error {
  constructor(code) {
    super(code);
    this.name = "V4AttemptThreeContractError";
    this.code = code;
  }
}

export function validateV4AttemptThreeReceipt(receipt) {
  if (!plainObject(receipt) || receipt.schemaVersion !== 1 ||
      receipt.receiptVersion !== V4_ATTEMPT_THREE_RECEIPT_VERSION ||
      receipt.authorizationReference !==
        V4_ATTEMPT_THREE_AUTHORIZATION_REFERENCE ||
      receipt.baselineCommit !== V4_BASELINE_COMMIT ||
      receipt.candidateCommit !== V4_BASELINE_COMMIT ||
      receipt.attemptNumber !== 3 || receipt.status !== "failed" ||
      receipt.failureReasonCode !== "database_projection_timed_out" ||
      receipt.ledgerNamespace !== V4_ATTEMPT_THREE_LEDGER_NAMESPACE ||
      receipt.ledgerSha256 !== V4_ATTEMPT_THREE_LEDGER_SHA256 ||
      receipt.closedBetaEligible !== false || receipt.deployed !== false ||
      receipt.released !== false || receipt.committed !== false ||
      receipt.pushed !== false) invalid();

  validatePriorAttempts(receipt.priorAttempts);
  validateStorageRecovery(receipt.storageRecovery);
  validateManifest(receipt.manifest);
  validateDecisions(receipt.decisions);
  validateDatabaseEvidence(receipt.databasePreflightEvidence);
  validateCases(receipt.cases);
  validateProviderAccounting(receipt.providerAccounting);
  if (receipt.providerAccounting.authorizationReference !==
        V4_ATTEMPT_THREE_AUTHORIZATION_REFERENCE ||
      receipt.providerAccounting.ledgerNamespace !==
        V4_ATTEMPT_THREE_LEDGER_NAMESPACE ||
      receipt.providerAccounting.ledgerSha256 !==
        V4_ATTEMPT_THREE_LEDGER_SHA256 ||
      receipt.providerAccounting.attempted !== 0 ||
      receipt.providerAccounting.unused !== V4_PROVIDER_CALL_LIMIT ||
      receipt.providerAccounting.providerEgressAdmitted !== false ||
      receipt.providerAccounting.providerCredentialAdmitted !== false) {
    invalid();
  }
  validateAllFalseFlags(receipt.featureFlags);
  validateCleanup(receipt.cleanup);
  validateProtectedReceipts(receipt.protectedHistoricalReceipts);
  if (receipt.physicalAppAttest !== "not_run" ||
      receipt.manualExpertReview?.completed !== false ||
      receipt.manualExpertReview?.classification !== "not_completed") {
    invalid();
  }
  if (receipt.privacy?.forbiddenFieldCount !== 0 ||
      receipt.privacy?.rawProviderMaterialRetained !== false ||
      receipt.privacy?.routeShapeRetained !== false ||
      receipt.privacy?.preciseLocationRetained !== false ||
      receipt.privacy?.appAttestMaterialRetained !== false ||
      receipt.privacy?.unboundedErrorRetained !== false) invalid();
  assertNoSensitiveDurableValueV4(receipt);
  if (sha256V4(receipt) !== V4_ATTEMPT_THREE_PUBLISHED_RECEIPT_DIGEST) {
    invalid();
  }
  return true;
}

function validatePriorAttempts(value) {
  for (const [name, status, reason] of [
    ["attemptOne", "blocked", "insufficient_settled_free_storage"],
    ["attemptTwo", "blocked", "authorized_cleanup_candidates_contain_git_metadata"]
  ]) {
    const attempt = value?.[name];
    const hashes = V4_PRIOR_ATTEMPT_RECEIPTS[name];
    if (!plainObject(attempt) || attempt.preserved !== true ||
        attempt.status !== status || attempt.reasonCode !== reason ||
        attempt.markdownSha256 !== hashes.markdownSha256 ||
        attempt.summarySha256 !== hashes.summarySha256 ||
        attempt.databaseWorkCount !== 0 || attempt.providerAttempted !== 0 ||
        attempt.providerUnused !== V4_PROVIDER_CALL_LIMIT ||
        attempt.finalFlagsDisabled !== true ||
        attempt.cleanupComplete !== true ||
        attempt.routeQuality !== "not_run") {
      throw new V4AttemptThreeContractError(`${name}_not_preserved`);
    }
  }
}

function validateStorageRecovery(value) {
  if (!plainObject(value) || value.authorizationScopeExact !== true ||
      value.activeConflictProcessCount !== 0 || value.openHandleCount !== 0 ||
      value.outsideCheckoutGitDirectoryCount !== 0 ||
      value.cleanPackageCheckoutCount !== 12 ||
      value.candidateCount !== V4_ATTEMPT_THREE_DELETION_RECORDS.length ||
      value.deletedCandidateCount !== V4_ATTEMPT_THREE_DELETION_RECORDS.length ||
      value.totalCandidateDiskUsageKiB !== 6_928_476 ||
      value.beforeSettledFreeKiB !== 8_145_472 ||
      value.afterSettledFreeKiB !== 13_931_980 ||
      value.settledRecoveredKiB !== 5_786_508 ||
      value.requiredFreeKiB !== 10 * 1_048_576 ||
      value.storageGatePassed !== true || value.deletionPermanent !== true ||
      value.rebuildableDerivedDataOnly !== true ||
      value.proofWorktreePreserved !== true ||
      value.priorReceiptsPreserved !== true ||
      !Array.isArray(value.candidates) ||
      value.candidates.length !== V4_ATTEMPT_THREE_DELETION_RECORDS.length) {
    invalid();
  }
  value.candidates.forEach((candidate, index) => {
    const expected = V4_ATTEMPT_THREE_DELETION_RECORDS[index];
    if (!plainObject(candidate) || candidate.name !== expected.name ||
        candidate.diskUsageKiB !== expected.diskUsageKiB ||
        candidate.deleted !== true) invalid();
  });
}

function validateManifest(value) {
  if (!plainObject(value) || value.digest !== V4_ATTEMPT_THREE_MANIFEST_DIGEST ||
      !Array.isArray(value.bindings) ||
      value.bindings.length !== V4_CASE_BINDINGS.length) invalid();
  value.bindings.forEach((binding, index) => {
    const expected = V4_CASE_BINDINGS[index];
    for (const key of [
      "caseId", "goldenCaseId", "fixtureDigest", "goldenCaseDigest"
    ]) {
      if (binding?.[key] !== expected[key]) invalid();
    }
  });
  if (sha256V4({
    authorizationReference: V4_ATTEMPT_THREE_AUTHORIZATION_REFERENCE,
    bindings: value.bindings
  }) !== value.digest) invalid();
}

function validateDecisions(value) {
  if (!plainObject(value) || value.storageRecovery !== "passed" ||
      value.databasePreflight !== "failed" ||
      value.physicalAppAttest !== "not_run" ||
      value.providerProof !== "not_run" ||
      value.routeQuality !== "not_run" ||
      value.cleanupAndContainment !== "passed") invalid();
}

function validateDatabaseEvidence(value) {
  const harz = value?.activeImports?.harz;
  const innsbruck = value?.activeImports?.innsbruck;
  const dryRun = value?.projection?.harzDryRun;
  const realRun = value?.projection?.harzRealRun;
  if (!plainObject(value) || value.environmentClassification !==
        "disposable_loopback_postgis" ||
      value.loopbackOnly !== true || value.proofRoleLeastPrivilege !== true ||
      value.projNetworkDisabled !== true ||
      value.providerCallsBeforeDatabaseGates !== 0 ||
      value.migrations?.firstRunAppliedCount !== 7 ||
      value.migrations?.secondRunAppliedCount !== 0 ||
      value.migrations?.ledgerRowCount !== 7 ||
      value.migrations?.secondRunTrueNoOp !== true ||
      value.activeImportCount !== 2 || value.sourceFreshnessPassed !== true ||
      value.publisherChecksumVerificationPassed !== true ||
      value.promotedQuarantineRowCount !== 0 ||
      harz?.trailSegments !== 140_623 || harz?.routeMembers !== 29_525 ||
      harz?.sourceCurrent !== true || harz?.checksumVerified !== true ||
      innsbruck?.trailSegments !== 75_996 ||
      innsbruck?.routeMembers !== 8_101 ||
      innsbruck?.sourceCurrent !== true ||
      innsbruck?.checksumVerified !== true ||
      dryRun?.status !== "passed" || dryRun?.entityCount !== 144_461 ||
      dryRun?.relationshipCount !== 29_309 ||
      dryRun?.quarantinedCount !== 0 ||
      realRun?.status !== "failed" ||
      realRun?.failureCode !== "projection_timed_out" ||
      realRun?.durationMilliseconds !== 128_634 ||
      realRun?.transactionRollbackVerified !== true ||
      realRun?.activeProjectionCount !== 0 ||
      realRun?.projectionEntityCount !== 0 ||
      realRun?.quarantinedCount !== 0 ||
      realRun?.stagingSchemaCount !== 0 ||
      value.providerAdmissionPassed !== false ||
      value.remainingGatesClassification !==
        "not_run_after_projection_failure") invalid();
}

function validateCases(cases) {
  if (!Array.isArray(cases) || cases.length !== V4_CASE_BINDINGS.length) {
    invalid();
  }
  cases.forEach((item, index) => {
    const expected = V4_CASE_BINDINGS[index];
    if (!plainObject(item) || item.caseId !== expected.caseId ||
        item.goldenCaseId !== expected.goldenCaseId ||
        item.fixtureDigest !== expected.fixtureDigest ||
        item.goldenCaseDigest !== expected.goldenCaseDigest ||
        item.evaluationRecordCreated !== true ||
        item.providerExecuted !== false || item.providerAttemptCount !== 0 ||
        item.technicalPipelineOutcome !== "not_run" ||
        item.productQualityOutcome !== "not_applicable" ||
        item.caseEvaluationOutcome !== "fail" ||
        item.resultReasonCode !== "database_preflight_failed") invalid();
  });
}

function validateAllFalseFlags(value) {
  for (const phase of ["initial", "execution", "final"]) {
    const snapshot = value?.[phase];
    if (!plainObject(snapshot) || snapshot.exactAdmissionVerified !== true ||
        !plainObject(snapshot.flags) ||
        Object.keys(snapshot.flags).length !== V4_FLAG_NAMES.length ||
        V4_FLAG_NAMES.some((name) => snapshot.flags[name] !== false)) invalid();
  }
}

function validateCleanup(value) {
  if (!plainObject(value) || value.cleanupComplete !== true ||
      value.finalFlagsDisabled !== true ||
      value.databaseResourcesCreated !== 1 ||
      value.databaseResourcesRemoved !== 1 ||
      value.providerResourcesCreated !== 0 ||
      value.providerResourcesRemoved !== 0 ||
      value.proofProcessesRemaining !== 0 ||
      value.taskOwnedRuntimeKiBRemoved !== 2_891_948 ||
      value.taskOwnedDataRemoved !== true || value.temporaryLedgerRemoved !== true ||
      value.disabledZeroWorkProbePassed !== true ||
      value.disabledZeroWorkDatabaseOperations !== 0 ||
      value.disabledZeroWorkProviderOperations !== 0 ||
      value.disabledZeroWorkBudgetOperations !== 0 ||
      value.disabledZeroWorkLeaseOperations !== 0 ||
      value.finalSettledFreeKiB < 10 * 1_048_576) invalid();
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalid() {
  throw new V4AttemptThreeContractError("invalid_v4_attempt_three_receipt");
}

export const V4_ATTEMPT_THREE_BASELINE_COMMIT = V4_BASELINE_COMMIT;
