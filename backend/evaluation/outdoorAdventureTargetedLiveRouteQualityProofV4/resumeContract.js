import {
  V4_BASELINE_COMMIT,
  V4_CASE_BINDINGS,
  V4_FLAG_NAMES,
  V4_PROTECTED_RECEIPTS,
  V4_PROVIDER_CALL_LIMIT,
  assertNoSensitiveDurableValueV4,
  sha256V4,
  validateProtectedReceipts,
  validateProviderAccounting
} from "./contract.js";

export const V4_RESUME_AUTHORIZATION_REFERENCE =
  "USER_AUTHORIZED_V4_RESUME_2026-08-05_15_CALLS";
export const V4_RESUME_RECEIPT_VERSION =
  "outdoor-adventure-targeted-live-route-quality-proof-v4-attempt-2";
export const V4_RESUME_LEDGER_NAMESPACE =
  "outdoor-adventure-v4-resume-2026-08-05-attempt-2";
export const V4_RESUME_PUBLISHED_RECEIPT_DIGEST =
  "6f2addf74a3a519a6f06f43abfc828f1baf8c9a7aa40940c2e517a8db2c579e6";
export const V4_ATTEMPT_ONE_RECEIPTS = Object.freeze({
  markdownSha256:
    "fc1e00c7063b794136c2368bc3c950f5677077934c45905c25391973abfc5a14",
  summarySha256:
    "5477240eb9a2569cb0ffbf167f61c1edb87ededa7e8c420e271833e4c7f0063c"
});
export const V4_RESUME_DELETION_CANDIDATES = Object.freeze([
  "WanderfulReleaseDerivedData",
  "WanderfulDerivedData",
  "TrailMindDerivedData-RoutableAccess-Final",
  "TrailMindDerivedData-RoutableAccess-Release",
  "TrailMindDerivedData-RoutableAccess-Debug",
  "TrailMindDerivedData-RoutableAccess"
]);

export class V4ResumeContractError extends Error {
  constructor(code) {
    super(code);
    this.name = "V4ResumeContractError";
    this.code = code;
  }
}

export function validateV4ResumeReceipt(receipt) {
  if (!plainObject(receipt) || receipt.schemaVersion !== 1 ||
      receipt.receiptVersion !== V4_RESUME_RECEIPT_VERSION ||
      receipt.authorizationReference !== V4_RESUME_AUTHORIZATION_REFERENCE ||
      receipt.baselineCommit !== V4_BASELINE_COMMIT ||
      receipt.candidateCommit !== V4_BASELINE_COMMIT ||
      receipt.attemptNumber !== 2 || receipt.status !== "blocked" ||
      receipt.blockedReasonCode !==
        "authorized_cleanup_candidates_contain_git_metadata" ||
      receipt.ledgerNamespace !== V4_RESUME_LEDGER_NAMESPACE ||
      receipt.closedBetaEligible !== false || receipt.deployed !== false ||
      receipt.released !== false || receipt.committed !== false ||
      receipt.pushed !== false) invalid();

  validateAttemptOne(receipt.attemptOne);
  validateStorageRecovery(receipt.storageRecovery);
  validateDecisions(receipt.decisions);
  validateCases(receipt.cases);
  validateProviderAccounting(receipt.providerAccounting);
  if (
    receipt.providerAccounting.authorizationReference !==
      V4_RESUME_AUTHORIZATION_REFERENCE ||
    receipt.providerAccounting.attempted !== 0 ||
    receipt.providerAccounting.unused !== V4_PROVIDER_CALL_LIMIT
  ) invalid();
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
  if (sha256V4(receipt) !== V4_RESUME_PUBLISHED_RECEIPT_DIGEST) invalid();
  return true;
}

function validateAttemptOne(value) {
  if (!plainObject(value) || value.preserved !== true ||
      value.status !== "blocked" ||
      value.blockedReasonCode !== "insufficient_settled_free_storage" ||
      value.markdownSha256 !== V4_ATTEMPT_ONE_RECEIPTS.markdownSha256 ||
      value.summarySha256 !== V4_ATTEMPT_ONE_RECEIPTS.summarySha256 ||
      value.databaseWorkCount !== 0 || value.providerAttempted !== 0 ||
      value.providerUnused !== V4_PROVIDER_CALL_LIMIT ||
      value.finalFlagsDisabled !== true || value.cleanupComplete !== true ||
      value.routeQualityClassification !== "not_run_no_route_execution") {
    throw new V4ResumeContractError("attempt_one_not_preserved");
  }
}

function validateStorageRecovery(value) {
  if (!plainObject(value) || value.activeConflictProcessCount !== 0 ||
      value.candidateCount !== V4_RESUME_DELETION_CANDIDATES.length ||
      value.deletionEligibleCount !== 0 || value.deletedCandidateCount !== 0 ||
      value.nestedGitDirectoryCount !== 12 ||
      value.openHandleCheckOutcome !==
        "not_run_after_content_safety_gate_failed" ||
      value.settledStorageSampleCount !== 2 ||
      !Number.isFinite(value.settledFreeGiB) ||
      value.settledFreeGiB >= 10 || value.requiredFreeGiB !== 10 ||
      value.preferredFreeGiB !== 12 ||
      !Number.isFinite(value.remainingShortfallGiB) ||
      value.storageGatePassed !== false ||
      !Array.isArray(value.candidates) ||
      value.candidates.length !== V4_RESUME_DELETION_CANDIDATES.length) {
    invalid();
  }
  value.candidates.forEach((candidate, index) => {
    if (!plainObject(candidate) ||
        candidate.name !== V4_RESUME_DELETION_CANDIDATES[index] ||
        candidate.nestedGitDirectoryCount !== 2 ||
        candidate.deletionEligible !== false || candidate.deleted !== false) {
      invalid();
    }
  });
}

function validateDecisions(value) {
  if (!plainObject(value) || value.storageRecovery !== "blocked" ||
      value.databasePreflight !== "not_run" ||
      value.physicalAppAttest !== "not_run" ||
      value.providerProof !== "not_run" || value.routeQuality !== "not_run" ||
      value.cleanupAndContainment !== "passed") invalid();
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
        item.providerExecuted !== false || item.providerAttemptCount !== 0 ||
        item.technicalPipelineOutcome !== "not_run" ||
        item.productQualityOutcome !== "not_applicable" ||
        item.caseEvaluationOutcome !== "not_run") invalid();
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
      value.finalFlagsDisabled !== true || value.databaseResourcesCreated !== 0 ||
      value.providerResourcesCreated !== 0 || value.proofProcessesRemaining !== 0 ||
      value.deletedCandidateCount !== 0 ||
      value.disabledZeroWorkProbe !== "not_run_after_storage_safety_gate") {
    invalid();
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalid() {
  throw new V4ResumeContractError("invalid_v4_resume_receipt");
}

export const V4_RESUME_PROTECTED_RECEIPTS = V4_PROTECTED_RECEIPTS;
