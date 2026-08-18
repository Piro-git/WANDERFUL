import { createHash } from "node:crypto";
import {
  V4_FLAG_NAMES,
  assertNoSensitiveDurableValueV4,
  sha256V4,
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
  }
]);

const ATTEMPT_FIVE_SEMANTIC_DIGEST =
  "7d1a405609f18ed575207b70e45ec228924019857d177f6af4b11470cb4a8822";

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
