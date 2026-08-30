import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HEX_64,
  PIN_PATHS,
  READINESS_SCHEMA_VERSION,
  SAFE_ID,
  TARGET_PROJECT_NAME
} from "./constants.js";
import { canonicalJson, exactKeys, sha256Bytes, strictParseJson } from "./canonicalJson.js";
import { catalogAssertionProgramSha256 } from "./catalogAssertion.js";
import { blocked } from "./errors.js";
import { compileExpectedManifest } from "./expectedManifest.js";
import { readSafeRegularFile } from "./safeFiles.js";
import { stableKeyId } from "./signing.js";

const packageDirectory = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REVIEWED_PINS_PATH = resolve(
  packageDirectory,
  "reviewed-pins-v1.json"
);

export function buildReadinessContract({
  reviewedPins,
  reviewedPinsPath = DEFAULT_REVIEWED_PINS_PATH,
  repositoryRoot = resolve(packageDirectory, "../../../../"),
  declarationPath
} = {}) {
  const pins = reviewedPins === undefined
    ? strictParseJson(readSafeRegularFile(resolve(reviewedPinsPath), {
      maximumBytes: 32 * 1024
    }), { maximumBytes: 32 * 1024 })
    : strictParseJson(canonicalJson(reviewedPins), { maximumBytes: 32 * 1024 });
  validateReviewedPins(pins);
  const manifest = compileExpectedManifest({ declarationPath, repositoryRoot });
  const programSha256 = catalogAssertionProgramSha256();
  const flattened = flattenReviewedPins(pins);
  const missing = PIN_PATHS.filter((path) => flattened[path] === null);
  const issueCodes = [...missing.map((path) => `missing:${path}`)];
  if (flattened[PIN_PATHS[3]] !== null &&
      flattened[PIN_PATHS[3]] !== programSha256) {
    issueCodes.push("mismatch:staticGate.independentCatalogAssertionProgramSha256");
  }
  if (flattened[PIN_PATHS[4]] !== null &&
      flattened[PIN_PATHS[4]] !== manifest.sha256) {
    issueCodes.push("mismatch:staticGate.independentExpectedManifestSha256");
  }
  if (flattened[PIN_PATHS[0]] !== null && flattened[PIN_PATHS[1]] !== null &&
      stableKeyId(flattened[PIN_PATHS[1]]) !== flattened[PIN_PATHS[0]]) {
    issueCodes.push("mismatch:artifactContract.key.keyId");
  }
  const reviewedPaths = new Set(pins.reviewReceipts.map(
    ({ artifact }) => artifact.pinPath
  ));
  for (const path of PIN_PATHS) {
    if (flattened[path] !== null && !reviewedPaths.has(path)) {
      issueCodes.push(`unreviewed:${path}`);
    }
  }
  const uniqueIssues = [...new Set(issueCodes)].sort();
  const status = uniqueIssues.length === 0
    ? "offline_prerequisites_ready"
    : "not_ready";
  const contract = {
    candidateEvidence: {
      artifactContractKeyId: null,
      artifactContractPublicKeySpkiSha256: null,
      auditorSslrootcertSha256: null,
      independentCatalogAssertionProgramSha256: programSha256,
      independentExpectedManifestSha256: manifest.sha256,
      migrationProfileId: manifest.manifest.migrationProfile.profileId,
      targetProjectName: manifest.manifest.targetProjectName
    },
    externalLimitations: {
      advisorCausalFreshnessEstablished: false,
      exactInvoiceOrUsageEstablished: false,
      liveSupabaseStateEstablished: false,
      signaturesEstablishFreshnessOrTruth: false
    },
    issueCodes: uniqueIssues,
    reviewReceiptCount: pins.reviewReceipts.length,
    reviewedPins: clone(pins),
    schemaVersion: READINESS_SCHEMA_VERSION,
    status,
    targetProjectName: TARGET_PROJECT_NAME
  };
  const canonical = canonicalJson(contract);
  return Object.freeze({
    canonical,
    contract: deepFreeze(contract),
    sha256: sha256Bytes(canonical)
  });
}

export function validateReviewedPins(value) {
  exactKeys(value, [
    "artifactContract", "auditorContract", "reviewReceipts", "staticGate"
  ], "pins_keys");
  exactKeys(value.artifactContract, ["key"], "pins_artifact_keys");
  exactKeys(value.artifactContract.key, [
    "keyId", "requiredPinnedPublicKeySpkiSha256"
  ], "pins_key_keys");
  exactKeys(value.auditorContract, ["connection"], "pins_auditor_keys");
  exactKeys(value.auditorContract.connection, [
    "sslrootcertSha256"
  ], "pins_connection_keys");
  exactKeys(value.staticGate, [
    "independentCatalogAssertionProgramSha256",
    "independentExpectedManifestSha256"
  ], "pins_static_keys");
  const flattened = flattenReviewedPins(value);
  for (const path of PIN_PATHS) {
    const pin = flattened[path];
    if (pin === null) continue;
    if (typeof pin !== "string") blocked("pin_format");
    if (path.endsWith("keyId")) {
      if (!validKeyIdOrNull(path, pin)) blocked("pin_format");
    } else if (!HEX_64.test(pin)) blocked("pin_format");
  }
  if (!Array.isArray(value.reviewReceipts) || value.reviewReceipts.length > 5) {
    blocked("review_receipts");
  }
  value.reviewReceipts.forEach((receipt) => validateReviewReceipt(
    receipt, flattened
  ));
  const paths = value.reviewReceipts.map(({ artifact }) => artifact.pinPath);
  const reviewIds = value.reviewReceipts.map(({ reviewId }) => reviewId);
  const reviewDigests = value.reviewReceipts.map(({ reviewSha256 }) =>
    reviewSha256);
  const reviewerIds = value.reviewReceipts.map(({ reviewer }) =>
    reviewer.reviewerId);
  const reviewerDigests = value.reviewReceipts.map(({ reviewer }) =>
    reviewer.reviewerIdentitySha256);
  if (new Set(paths).size !== paths.length ||
      new Set(reviewIds).size !== reviewIds.length ||
      new Set(reviewDigests).size !== reviewDigests.length ||
      new Set(reviewerIds).size !== reviewerIds.length ||
      new Set(reviewerDigests).size !== reviewerDigests.length ||
      paths.some((path, index) => index > 0 && path <= paths[index - 1])) {
    blocked("review_receipt_order");
  }
  return value;
}

export function createReviewReceipt({
  pinPath,
  pinValue,
  reviewId,
  reviewerId
}) {
  const unsigned = {
    artifact: { pinPath, pinValue },
    reviewId,
    reviewer: {
      reviewerId,
      reviewerIdentitySha256: reviewerIdentitySha256(reviewerId)
    }
  };
  const receipt = {
    ...unsigned,
    reviewSha256: sha256Bytes(canonicalJson(unsigned))
  };
  validateReviewReceipt(receipt, { [pinPath]: pinValue });
  return deepFreeze(receipt);
}

export function flattenReviewedPins(value) {
  validateReviewedPinsShape(value);
  return {
    [PIN_PATHS[0]]: value.artifactContract.key.keyId,
    [PIN_PATHS[1]]: value.artifactContract.key.requiredPinnedPublicKeySpkiSha256,
    [PIN_PATHS[2]]: value.auditorContract.connection.sslrootcertSha256,
    [PIN_PATHS[3]]: value.staticGate.independentCatalogAssertionProgramSha256,
    [PIN_PATHS[4]]: value.staticGate.independentExpectedManifestSha256
  };
}

function validateReviewedPinsShape(value) {
  if (!value || typeof value !== "object" || !value.artifactContract?.key ||
      !value.auditorContract?.connection || !value.staticGate) {
    blocked("pins_keys");
  }
}

function validateReviewReceipt(receipt, flattened) {
  exactKeys(receipt, [
    "artifact", "reviewId", "reviewSha256", "reviewer"
  ], "review_receipt_keys");
  exactKeys(receipt.artifact, ["pinPath", "pinValue"],
    "review_receipt_artifact_keys");
  exactKeys(receipt.reviewer, ["reviewerId", "reviewerIdentitySha256"],
    "review_receipt_reviewer_keys");
  const { pinPath, pinValue } = receipt.artifact;
  if (!PIN_PATHS.includes(pinPath) || flattened[pinPath] === null ||
      pinValue !== flattened[pinPath] ||
      typeof receipt.reviewId !== "string" || !SAFE_ID.test(receipt.reviewId) ||
      typeof receipt.reviewer.reviewerId !== "string" ||
      !SAFE_ID.test(receipt.reviewer.reviewerId) ||
      receipt.reviewer.reviewerIdentitySha256 !==
        reviewerIdentitySha256(receipt.reviewer.reviewerId) ||
      typeof receipt.reviewSha256 !== "string" ||
      !HEX_64.test(receipt.reviewSha256)) {
    blocked("review_receipt");
  }
  const unsigned = {
    artifact: receipt.artifact,
    reviewId: receipt.reviewId,
    reviewer: receipt.reviewer
  };
  if (receipt.reviewSha256 !== sha256Bytes(canonicalJson(unsigned))) {
    blocked("review_receipt_digest");
  }
}

function reviewerIdentitySha256(reviewerId) {
  if (typeof reviewerId !== "string" || !SAFE_ID.test(reviewerId)) {
    blocked("reviewer_identity");
  }
  return sha256Bytes(canonicalJson({ reviewerId }));
}

function validKeyIdOrNull(path, value) {
  if (!path.endsWith("keyId")) return true;
  return typeof value === "string" &&
    /^trailmind-observer-ed25519-[a-f0-9]{24}$/.test(value);
}

function clone(value) {
  return strictParseJson(canonicalJson(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}
