import {
  V4_CASE_BINDINGS,
  V4_FLAG_NAMES,
  V4_PROVIDER_CALL_LIMIT,
  assertNoSensitiveDurableValueV4,
  sha256V4,
  validateProtectedReceipts,
  validateProviderAccounting,
  validateV4CaseRecords
} from "./contract.js";

export const V4_ATTEMPT_FOUR_BASELINE_COMMIT =
  "a4cd746dbd7ba401124bdb6388757f769f68024a";
export const V4_ATTEMPT_FOUR_AUTHORIZATION_REFERENCE =
  "USER_AUTHORIZED_V4_ATTEMPT_4_2026-08-05_15_CALLS";
export const V4_ATTEMPT_FOUR_RECEIPT_VERSION =
  "outdoor-adventure-targeted-live-route-quality-proof-v4-attempt-4";
export const V4_ATTEMPT_FOUR_LEDGER_NAMESPACE =
  "outdoor-adventure-v4-attempt-4-2026-08-05";
export const V4_ATTEMPT_FOUR_LEDGER_SHA256 =
  "7abe78ab24a402bfd17d586246f0cec05166f04b5e834a2a6382f9d9ab79e524";
export const V4_ATTEMPT_FOUR_MANIFEST_DIGEST =
  "5adca280a0da8c2bc4b6ead299a6c69d6141af8c2027b3976da0857d538a621a";
export const V4_ATTEMPT_FOUR_PUBLISHED_RECEIPT_DIGEST =
  "f5b7afdefa652309cec75dd2a4914780ccf3b865efb0366649aca47fbc8f3117";

export const V4_ATTEMPT_FOUR_PRIOR_RECEIPTS = Object.freeze({
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
  }),
  attemptThree: Object.freeze({
    markdownSha256:
      "3e11f9bdee5fa0da85a5f6f33d33d1065c10db017d8d078dc79afcfeca681690",
    summarySha256:
      "9bd4fb94f67c997961254d70fbe58317dd40b4ef6ec111de90a81e3c3b5e2522"
  })
});

export class V4AttemptFourContractError extends Error {
  constructor(code) {
    super(code);
    this.name = "V4AttemptFourContractError";
    this.code = code;
  }
}

export function validateV4AttemptFourReceipt(receipt) {
  if (!plainObject(receipt) || receipt.schemaVersion !== 1 ||
      receipt.receiptVersion !== V4_ATTEMPT_FOUR_RECEIPT_VERSION ||
      receipt.authorizationReference !==
        V4_ATTEMPT_FOUR_AUTHORIZATION_REFERENCE ||
      receipt.baselineCommit !== V4_ATTEMPT_FOUR_BASELINE_COMMIT ||
      receipt.candidateCommit !== V4_ATTEMPT_FOUR_BASELINE_COMMIT ||
      receipt.attemptNumber !== 4 || receipt.status !== "blocked" ||
      receipt.blockedReasonCode !== "credential_unavailable" ||
      receipt.ledgerNamespace !== V4_ATTEMPT_FOUR_LEDGER_NAMESPACE ||
      receipt.ledgerSha256 !== V4_ATTEMPT_FOUR_LEDGER_SHA256 ||
      receipt.physicalAppAttestProved !== false ||
      receipt.humanReviewCompleted !== false ||
      receipt.closedBetaEligible !== false || receipt.deployed !== false ||
      receipt.released !== false || receipt.committed !== false ||
      receipt.pushed !== false || receipt.staged !== false ||
      receipt.enabled !== false) invalid();

  validatePriorAttempts(receipt.priorAttempts);
  validateManifest(receipt.manifest);
  validatePreflight(receipt.preflight);
  validateDatabase(receipt.databasePreflightEvidence);
  validateDecisions(receipt.decisions);
  validateCases(receipt.cases);
  validateAccounting(receipt.providerAccounting);
  validateFlags(receipt.featureFlags);
  validateTests(receipt.verification);
  validateCleanup(receipt.cleanup);
  validateGitStatus(receipt.gitStatusExact);
  validateProtectedReceipts(receipt.protectedHistoricalReceipts);
  if (!plainObject(receipt.privacy) ||
      receipt.privacy.forbiddenFieldCount !== 0 ||
      receipt.privacy.rawProviderMaterialRetained !== false ||
      receipt.privacy.routeShapeRetained !== false ||
      receipt.privacy.preciseLocationRetained !== false ||
      receipt.privacy.providerUrlRetained !== false ||
      receipt.privacy.credentialRetained !== false ||
      receipt.privacy.promptRetained !== false ||
      receipt.privacy.databaseUrlRetained !== false ||
      receipt.privacy.appAttestMaterialRetained !== false ||
      receipt.privacy.unboundedErrorRetained !== false) invalid();
  if (receipt.blockers?.length !== 1 ||
      receipt.blockers[0] !== "credential_unavailable" ||
      receipt.nextAction !==
        "rerun_in_a_new_authorized_attempt_with_an_approved_process_environment_credential") {
    invalid();
  }
  assertNoSensitiveDurableValueV4(receipt);
  if (sha256V4(receipt) !== V4_ATTEMPT_FOUR_PUBLISHED_RECEIPT_DIGEST) {
    invalid();
  }
  return true;
}

function validatePriorAttempts(value) {
  const expected = [
    ["attemptOne", "blocked", "insufficient_settled_free_storage", "not_run"],
    ["attemptTwo", "blocked", "authorized_cleanup_candidates_contain_git_metadata", "not_run"],
    ["attemptThree", "failed", "database_projection_timed_out", "not_run"]
  ];
  for (const [name, status, reasonCode, routeQuality] of expected) {
    const attempt = value?.[name];
    const hashes = V4_ATTEMPT_FOUR_PRIOR_RECEIPTS[name];
    if (!plainObject(attempt) || attempt.preserved !== true ||
        attempt.status !== status || attempt.reasonCode !== reasonCode ||
        attempt.routeQuality !== routeQuality ||
        attempt.markdownSha256 !== hashes.markdownSha256 ||
        attempt.summarySha256 !== hashes.summarySha256 ||
        attempt.providerAttempted !== 0 || attempt.providerUnused !== 15 ||
        attempt.cleanupComplete !== true ||
        attempt.finalFlagsDisabled !== true) {
      throw new V4AttemptFourContractError(`${name}_not_preserved`);
    }
  }
}

function validateManifest(value) {
  if (!plainObject(value) ||
      value.digest !== V4_ATTEMPT_FOUR_MANIFEST_DIGEST ||
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
    authorizationReference: V4_ATTEMPT_FOUR_AUTHORIZATION_REFERENCE,
    bindings: value.bindings
  }) !== value.digest) invalid();
}

function validatePreflight(value) {
  if (!plainObject(value) || value.headMatchedOriginMain !== true ||
      value.isolatedDetachedWorktree !== true ||
      value.initialWorktreeClean !== true ||
      value.equivalentAttemptFourFound !== false ||
      value.conflictingAgentFound !== false ||
      value.conflictingProcessCount !== 0 ||
      value.initialSettledStorageSampleCount !== 2 ||
      value.initialSettledFreeKiB !== 13_799_636 ||
      value.requiredFreeKiB !== 10 * 1_048_576 ||
      value.storageGatePassed !== true ||
      value.preservedWorktreeReadOnly !== true ||
      value.localConfigurationInspected !== false ||
      value.thresholdChanged !== false) invalid();
}

function validateDatabase(value) {
  const harzImport = value?.imports?.harz;
  const innsbruckImport = value?.imports?.innsbruck;
  const harzProjection = value?.projections?.harz;
  const innsbruckProjection = value?.projections?.innsbruck;
  if (!plainObject(value) || value.status !== "passed" ||
      value.environmentClassification !== "disposable_loopback_postgis" ||
      value.loopbackOnly !== true || value.proofRoleLeastPrivilege !== true ||
      value.projNetworkDisabled !== true ||
      value.postgresVersion !== "17.10" ||
      value.postgisVersion !== "3.6.4" ||
      value.migrations?.firstRunAppliedCount !== 7 ||
      value.migrations?.secondRunAppliedCount !== 0 ||
      value.migrations?.ledgerRowCount !== 7 ||
      value.migrations?.secondRunTrueNoOp !== true ||
      value.activeImportCount !== 2 || value.activeProjectionCount !== 2 ||
      value.publisherChecksumVerificationPassed !== true ||
      value.boundedInputDigestVerificationPassed !== true ||
      value.sourceFreshnessPassed !== true ||
      value.promotedQuarantineRowCount !== 0 ||
      value.snapshotInconsistencyCount !== 0 ||
      value.entityLineageViolationCount !== 0 ||
      value.assertionScopeViolationCount !== 0 ||
      value.relationshipScopeViolationCount !== 0 ||
      value.forbiddenActiveAssertionCount !== 0 ||
      value.freshnessViolationCount !== 0 ||
      value.providerCallsBeforeDatabaseGates !== 0 ||
      value.productionProjectionTimeoutMilliseconds !== 120_000 ||
      value.projectionTimeoutChanged !== false ||
      value.queryThresholdChanged !== false ||
      value.policyBypassUsed !== false ||
      value.allDatabaseGatesPassed !== true) invalid();
  if (harzImport?.boundedInputSha256 !==
        "4ea0d1394b2f1bc41983ba206b22ee194eae196b298689aee0534fe2503b4b5d" ||
      harzImport?.sourceTimestamp !== "2026-08-04T20:20:51Z" ||
      harzImport?.poiCount !== 2_951 ||
      harzImport?.trailSegmentCount !== 140_623 ||
      harzImport?.hikingRelationCount !== 887 ||
      harzImport?.routeMemberCount !== 29_525 ||
      innsbruckImport?.boundedInputSha256 !==
        "edc3ad6604d87007aaf81cd23bec99308d80cc9308ae156a6567901ef5f4a55c" ||
      innsbruckImport?.sourceTimestamp !== "2026-08-04T20:20:51Z" ||
      innsbruckImport?.poiCount !== 1_619 ||
      innsbruckImport?.trailSegmentCount !== 74_740 ||
      innsbruckImport?.hikingRelationCount !== 500 ||
      innsbruckImport?.routeMemberCount !== 7_785) invalid();
  validateProjection(harzProjection, {
    dry: 11_967, persistent: 64_595, entities: 144_461,
    assertions: 167_372, relationships: 29_309
  });
  validateProjection(innsbruckProjection, {
    dry: 25_419, persistent: 45_831, entities: 76_859,
    assertions: 91_477, relationships: 7_763
  });
  if (value.queryAndPerformance?.requiredGistIndexCount !== 6 ||
      value.queryAndPerformance?.allRequiredIndexesValidReady !== true ||
      value.queryAndPerformance?.corridorExecutionMilliseconds !== 65 ||
      value.queryAndPerformance?.corridorThresholdMilliseconds !== 2_500 ||
      value.queryAndPerformance?.membershipP95MaximumMilliseconds !== 551.5 ||
      value.queryAndPerformance?.accessP95MaximumMilliseconds !== 72 ||
      value.queryAndPerformance?.fullCase15AccessBeforeFixMilliseconds !==
        6_214.2 ||
      value.queryAndPerformance?.fullCase15AccessAfterFixMilliseconds !==
        149.1 ||
      value.queryAndPerformance?.productionStatementTimeoutMilliseconds !==
        2_500 ||
      value.queryAndPerformance?.allPerformanceGatesPassed !== true ||
      value.regionalIsolation?.regionBoundaryOverlap !== false ||
      value.regionalIsolation?.crossRegionQueryRowCount !== 0 ||
      value.regionalIsolation?.completeWaysBoundaryCrossingSourceCount
        ?.harz !== 817 ||
      value.regionalIsolation?.completeWaysBoundaryCrossingSourceCount
        ?.innsbruck !== 336 ||
      value.regionalIsolation?.crossingSourceGeometryFilteredByCoveredBy !==
        true ||
      value.cancellationAndRollback?.cancelledQueryClassified !== true ||
      value.cancellationAndRollback?.rollbackLifecycleComplete !== true ||
      value.cancellationAndRollback?.leakedTransactionCount !== 0 ||
      value.cancellationAndRollback?.projectionTransactionsAtomic !== true ||
      value.cancellationAndRollback?.partialProjectionCommitCount !== 0 ||
      value.preProviderPlanning?.caseCount !== 4 ||
      value.preProviderPlanning?.maximumProposalCount !== 3 ||
      value.preProviderPlanning?.accessLineageComplete !== true) invalid();
}

function validateProjection(value, expected) {
  if (!plainObject(value) || value.dryRunStatus !== "passed" ||
      value.dryRunDurationMilliseconds !== expected.dry ||
      value.persistentStatus !== "active" ||
      value.persistentDurationMilliseconds !== expected.persistent ||
      value.entityCount !== expected.entities ||
      value.assertionCount !== expected.assertions ||
      value.relationshipCount !== expected.relationships ||
      value.stableSourceLinkCount !== expected.entities ||
      value.quarantinedCount !== 0 ||
      value.repeatStatus !== "unchanged" ||
      value.provenanceComplete !== true ||
      value.rollbackBehaviorVerified !== true ||
      value.partialCommitCount !== 0) invalid();
}

function validateDecisions(value) {
  if (!plainObject(value) || value.storagePreflight !== "passed" ||
      value.databasePreflight !== "passed" ||
      value.physicalAppAttest !== "not_run" ||
      value.providerCredentialAdmission !== "blocked" ||
      value.providerProof !== "not_run" || value.routeQuality !== "not_run" ||
      value.cleanupAndContainment !== "passed") invalid();
}

function validateCases(value) {
  validateV4CaseRecords(value);
  value.forEach((record) => {
    if (record.providerExecuted !== false || record.providerAttemptCount !== 0 ||
        record.technicalPipelineOutcome !== "not_run" ||
        record.productQualityOutcome !== "not_applicable" ||
        record.caseEvaluationOutcome !== "fail" ||
        record.routes.length !== 0 ||
        record.resultReasonCode !== "credential_unavailable") invalid();
  });
}

function validateAccounting(value) {
  validateProviderAccounting(value);
  if (value.authorizationReference !==
        V4_ATTEMPT_FOUR_AUTHORIZATION_REFERENCE ||
      value.ledgerNamespace !== V4_ATTEMPT_FOUR_LEDGER_NAMESPACE ||
      value.ledgerSha256 !== V4_ATTEMPT_FOUR_LEDGER_SHA256 ||
      value.attempted !== 0 || value.successful !== 0 || value.failed !== 0 ||
      value.timedOut !== 0 || value.cancelled !== 0 ||
      value.controlledPostSuccessFailures !== 0 ||
      value.unused !== V4_PROVIDER_CALL_LIMIT ||
      value.providerCredentialAdmitted !== false ||
      value.providerEgressAdmitted !== false ||
      value.credentialAdmissionReasonCode !== "credential_unavailable") {
    invalid();
  }
}

function validateFlags(value) {
  for (const phase of ["initial", "database", "admission", "final"]) {
    const snapshot = value?.[phase];
    if (!plainObject(snapshot) || snapshot.exactAdmissionVerified !== true ||
        !plainObject(snapshot.flags) ||
        Object.keys(snapshot.flags).length !== V4_FLAG_NAMES.length ||
        V4_FLAG_NAMES.some((name) => snapshot.flags[name] !== false)) invalid();
  }
}

function validateTests(value) {
  if (!plainObject(value) || value.focusedV4Passed !== true ||
      value.providerLedgerAndCircuitBreakerPassed !== true ||
      value.providerFeatureFlagsPassed !== true ||
      value.osmProjectionPerformancePassed !== true ||
      value.realPostgisIntegrationPassed !== true ||
      value.realPostgisIntegrationTestCount !== 49 ||
      value.completeBackendSuitePassed !== true ||
      !Number.isInteger(value.completeBackendPassedTestCount) ||
      value.completeBackendPassedTestCount < 650 ||
      value.backendBuildPassed !== true ||
      value.offlineQualityEvaluationPassed !== true ||
      value.goldenSetValidationPassed !== true ||
      value.receiptSchemaReconciliationPassed !== true ||
      value.diffCheckPassed !== true || value.whitespaceScanPassed !== true ||
      value.conflictMarkerScanPassed !== true ||
      value.highConfidenceCredentialScanPassed !== true ||
      value.generatedArtifactScanPassed !== true ||
      value.swiftOrXcodeFilesChanged !== false ||
      value.xcodeRunRequired !== false) invalid();
}

function validateCleanup(value) {
  if (!plainObject(value) || value.cleanupComplete !== true ||
      value.finalFlagsDisabled !== true ||
      value.databaseResourcesCreated !== 1 ||
      value.databaseResourcesRemoved !== 1 ||
      value.providerResourcesCreated !== 0 ||
      value.providerResourcesRemoved !== 0 ||
      value.proofProcessesRemaining !== 0 ||
      value.proofListenersRemaining !== 0 ||
      value.taskOwnedRuntimeKiBRemoved !== 4_361_040 ||
      value.taskOwnedDataRemoved !== true || value.downloadedPbfsRemoved !== true ||
      value.temporaryLedgerRemoved !== true ||
      value.rawCapturesRemoved !== true || value.poolsClosed !== true ||
      value.leasesReleased !== true || value.sourceWorktreePreserved !== true ||
      value.preservedV4WorktreeUnmodified !== true ||
      value.disabledZeroWorkProbePassed !== true ||
      value.disabledZeroWorkDatabaseOperations !== 0 ||
      value.disabledZeroWorkProviderOperations !== 0 ||
      value.disabledZeroWorkBudgetOperations !== 0 ||
      value.disabledZeroWorkLeaseOperations !== 0 ||
      value.finalSettledStorageSampleCount !== 2 ||
      value.finalSettledFreeKiB < 10 * 1_048_576) invalid();
}

function validateGitStatus(value) {
  if (!Array.isArray(value) || value.length < 20 ||
      value.some((line) => typeof line !== "string" ||
        line.length < 4 || (!line.startsWith(" M ") &&
          !line.startsWith("?? ")) || line.includes("/private/tmp/")) ||
      !value.includes(
        "?? docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4_ATTEMPT_4.md"
      ) ||
      !value.includes(
        "?? docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4_ATTEMPT_4.summary.json"
      )) invalid();
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" &&
    !Array.isArray(value);
}

function invalid() {
  throw new V4AttemptFourContractError(
    "invalid_v4_attempt_four_receipt"
  );
}
