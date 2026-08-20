import { createHash } from "node:crypto";
import {
  V4_CASE_BINDINGS,
  V4_FLAG_NAMES,
  assertNoSensitiveDurableValueV4,
  sha256V4,
  validateProtectedReceipts,
  validateProviderAccounting,
  validatePublishedV4AttemptOneReceipt
} from "./contract.js";
import {
  validateV4AttemptThreeReceipt
} from "./attempt3Contract.js";
import {
  validateV4AttemptFourReceipt
} from "./attempt4Contract.js";
import {
  validateV4ResumeReceipt
} from "./resumeContract.js";

export const V4_COMMITTED_HISTORICAL_RECEIPTS = deepFreeze([
  {
    attemptNumber: 1,
    markdownPath:
      "docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4.md",
    markdownSha256:
      "fc1e00c7063b794136c2368bc3c950f5677077934c45905c25391973abfc5a14",
    summaryPath:
      "docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4.summary.json",
    summarySha256:
      "5477240eb9a2569cb0ffbf167f61c1edb87ededa7e8c420e271833e4c7f0063c"
  },
  {
    attemptNumber: 2,
    markdownPath:
      "docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4_ATTEMPT_2.md",
    markdownSha256:
      "76650b3392885ba4683d6fdcd336aca3273e2b4040e359fb9aab0bd031b1f09b",
    summaryPath:
      "docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4_ATTEMPT_2.summary.json",
    summarySha256:
      "7aa8a4b992514ded013ef5ebc6a6218f87b559997220a3c240e7fc39a436d737"
  },
  {
    attemptNumber: 3,
    markdownPath:
      "docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4_ATTEMPT_3.md",
    markdownSha256:
      "3e11f9bdee5fa0da85a5f6f33d33d1065c10db017d8d078dc79afcfeca681690",
    summaryPath:
      "docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4_ATTEMPT_3.summary.json",
    summarySha256:
      "9bd4fb94f67c997961254d70fbe58317dd40b4ef6ec111de90a81e3c3b5e2522"
  },
  {
    attemptNumber: 4,
    markdownPath:
      "docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4_ATTEMPT_4.md",
    markdownSha256:
      "c36f664d25e8c4641419f0848d0b117d93207249d336030c37d905a7da245b69",
    summaryPath:
      "docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4_ATTEMPT_4.summary.json",
    summarySha256:
      "f35c64f6cecf5cfb63ecb412e2ad6ae8b2671e2709c90139a4022938fe871119"
  },
  {
    attemptNumber: 5,
    markdownPath:
      "docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4_ATTEMPT_5.md",
    markdownSha256:
      "b44709a907eae3227ebd7b84c09a9d48b41e304967bccb241bbfff534ba41372",
    summaryPath:
      "docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4_ATTEMPT_5.summary.json",
    summarySha256:
      "61191787a5b14b16196db11a6b25722a141de34b3fa21a76b563790ae839d83b"
  },
  {
    attemptNumber: 10,
    markdownPath:
      "docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4_ATTEMPT_10.md",
    markdownSha256:
      "948ec7a903c5b99357d76769f132c60dd7e4e9d269b6af41e8120f4124da4535",
    summaryPath:
      "docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4_ATTEMPT_10.summary.json",
    summarySha256:
      "7ba8346682360a8a095a24ee213fffa93fc88cb0586c7a911fed3e49acd7b275"
  }
]);

const ATTEMPT_FIVE_SEMANTIC_DIGEST =
  "7d1a405609f18ed575207b70e45ec228924019857d177f6af4b11470cb4a8822";
const ATTEMPT_TEN_SEMANTIC_DIGEST =
  "c3e24849fe4935b5cd61a0b9299a4dd3cb6201f030bd7efea3601e0f0a7fb257";

export class V4HistoricalReceiptError extends Error {
  constructor(code) {
    super(code);
    this.name = "V4HistoricalReceiptError";
    this.code = code;
  }
}

export function validateCommittedV4HistoricalMarkdown(
  attemptNumber,
  bytes
) {
  const expected = historicalAttempt(attemptNumber);
  if (!bytesLike(bytes) || sha256Bytes(bytes) !== expected.markdownSha256) {
    invalid();
  }
  return true;
}

export function validateCommittedV4HistoricalSummary(attemptNumber, bytes) {
  const expected = historicalAttempt(attemptNumber);
  if (!bytesLike(bytes) || sha256Bytes(bytes) !== expected.summarySha256) {
    invalid();
  }
  let receipt;
  try {
    receipt = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    invalid();
  }
  return validateV4HistoricalSummaryObject(attemptNumber, receipt);
}

export function validateV4HistoricalSummaryObject(attemptNumber, receipt) {
  switch (attemptNumber) {
    case 1: return validatePublishedV4AttemptOneReceipt(receipt);
    case 2: return validateV4ResumeReceipt(receipt);
    case 3: return validateV4AttemptThreeReceipt(receipt);
    case 4: return validateV4AttemptFourReceipt(receipt);
    case 5: return validateAttemptFive(receipt);
    case 10: return validateAttemptTen(receipt);
    default: invalid();
  }
}

function validateAttemptFive(receipt) {
  if (!plainObject(receipt) || receipt.schemaVersion !== 1 ||
      receipt.receiptVersion !==
        "outdoor-adventure-targeted-live-route-quality-proof-v4-attempt-5" ||
      receipt.semanticReceiptSha256 !== ATTEMPT_FIVE_SEMANTIC_DIGEST ||
      receipt.baselineCommit !==
        "2c3e4e4c3ec319e6e5497cb83435c421fe3bf60f" ||
      receipt.candidateCommit !==
        "2c3e4e4c3ec319e6e5497cb83435c421fe3bf60f" ||
      receipt.authorizationReference !==
        "USER_AUTHORIZED_V4_ATTEMPT_5_2026-08-06_15_CALLS" ||
      receipt.ledgerNamespace !==
        "outdoor-adventure-v4-attempt-5-2026-08-06" ||
      receipt.status !== "blocked" ||
      receipt.blockedReasonCode !==
        "database_preprovider_plan_unsupported" ||
      receipt.providerAccounting?.attempted !== 0 ||
      receipt.providerAccounting?.unused !== 15 ||
      receipt.providerAccounting?.providerCredentialAdmitted !== false ||
      receipt.providerAccounting?.providerEgressAdmitted !== false ||
      receipt.decisions?.cleanupAndContainment !== "passed" ||
      receipt.cleanup?.cleanupComplete !== true ||
      receipt.cleanup?.finalFlagsDisabled !== true ||
      receipt.cleanup?.disabledZeroWorkProbePassed !== true ||
      receipt.closedBetaEligible !== false || receipt.deployed !== false ||
      receipt.released !== false || receipt.committed !== false ||
      receipt.pushed !== false || receipt.staged !== false ||
      receipt.enabled !== false) invalid();
  if (receipt.featureFlags?.initialAllFalse !== true ||
      receipt.featureFlags?.executionAllFalse !== true ||
      receipt.featureFlags?.finalAllFalse !== true ||
      receipt.featureFlags?.exactAdmissionVerified !== true ||
      JSON.stringify(receipt.featureFlags?.flagNames) !==
        JSON.stringify(V4_FLAG_NAMES)) invalid();
  const { semanticReceiptSha256, ...record } = receipt;
  if (sha256V4(record) !== semanticReceiptSha256) invalid();
  assertNoSensitiveDurableValueV4(receipt);
  return true;
}

function validateAttemptTen(receipt) {
  if (!plainObject(receipt) || receipt.schemaVersion !== 1 ||
      receipt.proofVersion !==
        "outdoor-adventure-targeted-live-route-quality-proof-v4" ||
      receipt.proofClassification !==
        "targeted_server_side_live_route_quality_proof" ||
      receipt.receiptVersion !==
        "outdoor-adventure-targeted-live-route-quality-proof-v4-attempt-10-blocked-v1" ||
      receipt.semanticReceiptSha256 !== ATTEMPT_TEN_SEMANTIC_DIGEST ||
      receipt.attemptNumber !== 10 ||
      receipt.generatedAt !== receipt.proofAsOf ||
      receipt.baselineCommit !==
        "abf3d6853d8f604f9701434d89c2e4fc892d19f9" ||
      receipt.candidateCommit !== receipt.baselineCommit ||
      receipt.authorizationReference !==
        "USER_AUTHORIZED_V4_ATTEMPT_10_2026-08-20_15_CALLS" ||
      receipt.ledgerNamespace !==
        "outdoor-adventure-v4-attempt-10-2026-08-20-zm0jul" ||
      receipt.status !== "blocked" ||
      receipt.blockedReasonCode !==
        "database_runtime_loopback_address_normalization_mismatch") invalid();
  if (receipt.decisions?.databasePreflight !== "failed" ||
      receipt.decisions?.providerCredentialAdmission !== "not_run" ||
      receipt.decisions?.providerProof !== "not_run" ||
      receipt.decisions?.routeQuality !== "not_run" ||
      receipt.decisions?.cleanupAndContainment !== "passed" ||
      receipt.databasePreflightEvidence?.committedRunnerAdmission?.status !==
        "failed" ||
      receipt.databasePreflightEvidence?.committedRunnerAdmission?.reasonCode !==
        "database_runtime_role_admission_failed" ||
      receipt.databasePreflightEvidence?.committedRunnerAdmission
        ?.specificCause !==
        "postgres_inet_text_includes_host_mask_but_runner_accepts_only_unmasked_loopback_literals" ||
      receipt.databasePreflightEvidence?.committedRunnerAdmission
        ?.ledgerCreated !== false ||
      receipt.databasePreflightEvidence?.committedRunnerAdmission
        ?.providerCalls !== 0) invalid();
  validateProviderAccounting(receipt.providerAccounting);
  if (receipt.providerAccounting.ledgerCreated !== false ||
      receipt.providerAccounting.providerCredentialAdmitted !== false ||
      receipt.providerAccounting.providerEgressAdmitted !== false ||
      receipt.providerAccounting.attempted !== 0 ||
      receipt.providerAccounting.unused !== 15 ||
      !Array.isArray(receipt.cases) ||
      receipt.cases.length !== V4_CASE_BINDINGS.length ||
      receipt.cases.some((item, index) =>
        item.caseId !== V4_CASE_BINDINGS[index].caseId ||
        item.executed !== false || item.providerExecuted !== false ||
        item.observedPlanningState !== "not_run" ||
        item.technicalPipelineOutcome !== "not_run" ||
        item.productQualityOutcome !== "not_applicable" ||
        item.caseEvaluationOutcome !== "fail" ||
        item.providerAttemptCount !== 0 ||
        !Array.isArray(item.routes) || item.routes.length !== 0
      )) invalid();
  if (receipt.featureFlags?.initialAllFalse !== true ||
      receipt.featureFlags?.executionAllFalse !== true ||
      receipt.featureFlags?.finalAllFalse !== true ||
      receipt.featureFlags?.exactAdmissionVerified !== true ||
      JSON.stringify(receipt.featureFlags?.flagNames) !==
        JSON.stringify(V4_FLAG_NAMES) ||
      receipt.cleanup?.cleanupComplete !== true ||
      receipt.cleanup?.finalFlagsDisabled !== true ||
      receipt.cleanup?.databaseResourcesCreated !== 1 ||
      receipt.cleanup?.databaseResourcesRemoved !== 1 ||
      receipt.cleanup?.providerResourcesCreated !== 0 ||
      receipt.cleanup?.providerResourcesRemoved !== 0 ||
      receipt.cleanup?.proofProcessesRemaining !== 0 ||
      receipt.cleanup?.proofListenersRemaining !== 0 ||
      receipt.cleanup?.identityArtifactRemoved !== true ||
      receipt.cleanup?.poolsClosed !== true ||
      receipt.cleanup?.disabledZeroWorkProbePassed !== true ||
      receipt.closedBetaEligible !== false || receipt.staged !== false ||
      receipt.committed !== false || receipt.pushed !== false ||
      receipt.deployed !== false || receipt.released !== false ||
      receipt.enabled !== false) invalid();
  validateProtectedReceipts(receipt.protectedHistoricalReceipts);
  const { semanticReceiptSha256, ...record } = receipt;
  if (sha256V4(record) !== semanticReceiptSha256) invalid();
  assertNoSensitiveDurableValueV4(receipt);
  return true;
}

function historicalAttempt(attemptNumber) {
  const entry = V4_COMMITTED_HISTORICAL_RECEIPTS.find((item) =>
    item.attemptNumber === attemptNumber
  );
  if (!entry) invalid();
  return entry;
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function bytesLike(value) {
  return typeof value === "string" || Buffer.isBuffer(value) ||
    value instanceof Uint8Array;
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" &&
    !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function invalid() {
  throw new V4HistoricalReceiptError("historical_v4_receipt_mismatch");
}
