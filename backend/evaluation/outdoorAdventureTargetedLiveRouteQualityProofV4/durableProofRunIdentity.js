import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  open,
  readFile,
  unlink
} from "node:fs/promises";
import { dirname } from "node:path";
import {
  V4_PROVIDER_CALL_LIMIT,
  assertNoSensitiveDurableValueV4,
  sha256V4,
  stableSerializeV4
} from "./contract.js";
import {
  V4_PROOF_RUN_CONTEXT_SCHEMA_VERSION,
  V4_PROOF_RUN_CONTEXT_VERSION,
  createV4ProofRunContext,
  serializeV4ProofRunContext,
  validateV4ProofRunContext
} from "./proofRunContext.js";
import {
  V4_GOLDEN_SET_MANIFEST_DIGEST,
  V4_GOLDEN_SET_POLICY_VERSION,
  V4_PRODUCT_SHAPING_POLICY_DIGEST,
  V4_PRODUCT_SHAPING_POLICY_VERSION,
  V4_REGIONAL_SOURCE_MANIFEST_DIGEST,
  bindV4RunReceiptIdentity,
  bindV4RunSummaryIdentity,
  createV4ProofRunIdentity,
  validateV4ProofRunIdentity,
  validateV4ProofRunIdentityForContext,
  validateV4RunReceiptIdentity,
  validateV4RunSummary,
  v4ProofRunIdentityReceiptBinding
} from "./proofRunIdentity.js";

export const V4_DURABLE_PROOF_RUN_IDENTITY_SCHEMA_VERSION = 1;
export const V4_DURABLE_PROOF_RUN_IDENTITY_VERSION =
  "outdoor-adventure-targeted-live-route-quality-proof-v4-durable-identity-v1";

const HEX_40 = /^[a-f0-9]{40}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const MAXIMUM_ARTIFACT_BYTES = 131_072;
const VERIFIED_DURABLE_RUNS = new WeakSet();
const EXPECTED_KEYS = Object.freeze([
  "artifactDigest",
  "authorizationReference",
  "baselineCommit",
  "candidateCommit",
  "gitCandidateAttestationDigest",
  "ledgerNamespace",
  "providerCallLimit"
]);

export class V4DurableProofRunIdentityError extends Error {
  constructor(code) {
    super(code);
    this.name = "V4DurableProofRunIdentityError";
    this.code = code;
  }
}

export function buildV4DurableProofRunIdentityArtifact(identity, runContext) {
  validateV4ProofRunIdentityForContext(identity, runContext);
  const record = {
    schemaVersion: V4_DURABLE_PROOF_RUN_IDENTITY_SCHEMA_VERSION,
    contractVersion: V4_DURABLE_PROOF_RUN_IDENTITY_VERSION,
    identity: v4ProofRunIdentityReceiptBinding(identity),
    runContext: JSON.parse(serializeV4ProofRunContext(runContext))
  };
  assertNoSensitiveDurableValueV4(record);
  return deepFreeze({ ...record, artifactDigest: sha256V4(record) });
}

export async function writeV4DurableProofRunIdentityArtifact(
  path,
  identity,
  runContext
) {
  if (!authorizedRuntimePath(path)) invalid("invalid_v4_identity_path");
  const artifact = buildV4DurableProofRunIdentityArtifact(identity, runContext);
  await writeCanonicalV4ArtifactExclusive(path, artifact);
  return artifact.artifactDigest;
}

export async function readAndVerifyV4DurableProofRunIdentity(
  path,
  expected
) {
  if (!authorizedRuntimePath(path)) invalid("invalid_v4_identity_path");
  const serialized = await readPermissionBoundArtifact(path);
  return parseAndVerifyV4DurableProofRunIdentity(serialized, expected);
}

export function parseAndVerifyV4DurableProofRunIdentity(serialized, expected) {
  if (typeof serialized !== "string" ||
      Buffer.byteLength(serialized) > MAXIMUM_ARTIFACT_BYTES ||
      !plainObject(expected) || !exactKeys(expected, EXPECTED_KEYS) ||
      !HEX_40.test(expected.baselineCommit ?? "") ||
      !HEX_40.test(expected.candidateCommit ?? "") ||
      !HEX_64.test(expected.artifactDigest ?? "") ||
      !HEX_64.test(expected.gitCandidateAttestationDigest ?? "") ||
      expected.providerCallLimit !== V4_PROVIDER_CALL_LIMIT ||
      !boundedIdentifier(expected.authorizationReference) ||
      !boundedIdentifier(expected.ledgerNamespace)) invalid();
  let artifact;
  try {
    artifact = JSON.parse(serialized);
  } catch {
    invalid();
  }
  if (!plainObject(artifact) || !exactKeys(artifact, [
    "artifactDigest", "contractVersion", "identity", "runContext",
    "schemaVersion"
  ]) || artifact.schemaVersion !==
      V4_DURABLE_PROOF_RUN_IDENTITY_SCHEMA_VERSION ||
      artifact.contractVersion !== V4_DURABLE_PROOF_RUN_IDENTITY_VERSION ||
      artifact.artifactDigest !== expected.artifactDigest ||
      `${stableSerializeV4(artifact)}\n` !== serialized) invalid();
  const { artifactDigest, ...artifactRecord } = artifact;
  if (sha256V4(artifactRecord) !== artifactDigest) invalid();

  const context = rehydrateContext(artifact.runContext);
  const identity = rehydrateIdentity(artifact.identity, context);
  if (identity.baselineCommit !== expected.baselineCommit ||
      identity.candidateCommit !== expected.candidateCommit ||
      identity.authorizationReference !== expected.authorizationReference ||
      identity.ledgerNamespace !== expected.ledgerNamespace ||
      identity.providerCallLimit !== expected.providerCallLimit ||
      identity.gitCandidateAttestationDigest !==
        expected.gitCandidateAttestationDigest) mismatch();
  validateV4ProofRunIdentityForContext(identity, context);
  const durableRun = deepFreeze({ artifactDigest, identity, runContext: context });
  VERIFIED_DURABLE_RUNS.add(durableRun);
  return durableRun;
}

export function validateV4DurableProofRun(durableRun) {
  if (!plainObject(durableRun) || !VERIFIED_DURABLE_RUNS.has(durableRun) ||
      !exactKeys(durableRun, ["artifactDigest", "identity", "runContext"]) ||
      !HEX_64.test(durableRun.artifactDigest ?? "")) invalid();
  validateV4ProofRunIdentityForContext(
    durableRun.identity,
    durableRun.runContext
  );
  const artifact = buildV4DurableProofRunIdentityArtifact(
    durableRun.identity,
    durableRun.runContext
  );
  if (artifact.artifactDigest !== durableRun.artifactDigest) mismatch();
  return true;
}

export function bindV4DurableRunReceiptIdentity(fields, durableRun) {
  validateV4DurableProofRun(durableRun);
  return bindV4RunReceiptIdentity(
    fields,
    durableRun.identity,
    durableRun.artifactDigest
  );
}

export function validateV4DurableRunReceiptIdentity(receipt, durableRun) {
  validateV4DurableProofRun(durableRun);
  validateV4RunReceiptIdentity(receipt, durableRun.identity);
  if (receipt.proofRunIdentityArtifactDigest !==
      durableRun.artifactDigest) mismatch();
  return true;
}

export function bindV4DurableRunSummaryIdentity(fields, durableRun) {
  validateV4DurableProofRun(durableRun);
  return bindV4RunSummaryIdentity(
    fields,
    durableRun.identity,
    durableRun.artifactDigest
  );
}

export function validateV4DurableRunSummary(summary, durableRun) {
  validateV4DurableProofRun(durableRun);
  validateV4RunSummary(summary, durableRun.identity);
  if (summary.proofRunIdentityArtifactDigest !==
      durableRun.artifactDigest) mismatch();
  return true;
}

export async function writeCanonicalV4ArtifactExclusive(path, value) {
  if (!authorizedRuntimePath(path)) invalid("invalid_v4_identity_path");
  assertNoSensitiveDurableValueV4(value);
  const serialized = `${stableSerializeV4(value)}\n`;
  if (Buffer.byteLength(serialized) > MAXIMUM_ARTIFACT_BYTES) invalid();
  const temporaryPath = `${path}.pending-${process.pid}-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await link(temporaryPath, path);
    await syncDirectory(dirname(path));
  } catch {
    invalid("v4_identity_artifact_write_failed");
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
  }
}

export async function removeV4RuntimeArtifact(path) {
  if (!authorizedRuntimePath(path)) invalid("invalid_v4_identity_path");
  try {
    await unlink(path);
    await syncDirectory(dirname(path));
  } catch {
    invalid("v4_runtime_artifact_removal_failed");
  }
}

function rehydrateContext(recordWithDigest) {
  if (!plainObject(recordWithDigest) ||
      recordWithDigest.schemaVersion !== V4_PROOF_RUN_CONTEXT_SCHEMA_VERSION ||
      recordWithDigest.contractVersion !== V4_PROOF_RUN_CONTEXT_VERSION ||
      !HEX_64.test(recordWithDigest.digest ?? "")) invalid();
  const { digest, ...record } = recordWithDigest;
  const context = createV4ProofRunContext(record, {
    observedAt: record.proofAsOf
  });
  if (context.digest !== digest) mismatch();
  validateV4ProofRunContext(context);
  return context;
}

function rehydrateIdentity(recordWithDigest, context) {
  if (!plainObject(recordWithDigest) ||
      !HEX_64.test(recordWithDigest.digest ?? "")) invalid();
  const identity = createV4ProofRunIdentity({
    baselineCommit: recordWithDigest.baselineCommit,
    candidateCommit: recordWithDigest.candidateCommit,
    authorizationReference: recordWithDigest.authorizationReference,
    ledgerNamespace: recordWithDigest.ledgerNamespace,
    providerCallLimit: recordWithDigest.providerCallLimit,
    caseManifest: {
      digest: recordWithDigest.caseManifestDigest,
      bindings: recordWithDigest.canonicalCases
    },
    proofRunContext: context,
    gitCandidateAttestationDigest:
      recordWithDigest.gitCandidateAttestationDigest,
    goldenSetManifestDigest: V4_GOLDEN_SET_MANIFEST_DIGEST,
    goldenSetPolicyVersion: V4_GOLDEN_SET_POLICY_VERSION,
    productShapingPolicyVersion: V4_PRODUCT_SHAPING_POLICY_VERSION,
    productShapingPolicyDigest: V4_PRODUCT_SHAPING_POLICY_DIGEST,
    regionalSourceManifestDigest: V4_REGIONAL_SOURCE_MANIFEST_DIGEST
  });
  validateV4ProofRunIdentity(identity);
  if (stableSerializeV4(v4ProofRunIdentityReceiptBinding(identity)) !==
      stableSerializeV4(recordWithDigest)) mismatch();
  return identity;
}

async function readPermissionBoundArtifact(path) {
  let stats;
  try {
    stats = await lstat(path);
  } catch {
    invalid("v4_identity_artifact_unavailable");
  }
  if (!stats.isFile() || stats.isSymbolicLink() ||
      (stats.mode & 0o077) !== 0 || stats.size > MAXIMUM_ARTIFACT_BYTES) {
    invalid("v4_identity_artifact_permissions_invalid");
  }
  try {
    return await readFile(path, "utf8");
  } catch {
    invalid("v4_identity_artifact_unavailable");
  }
}

async function syncDirectory(path) {
  let handle;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch (error) {
    if (!new Set(["EINVAL", "ENOTSUP"]).has(error?.code)) throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function authorizedRuntimePath(value) {
  return typeof value === "string" &&
    value.startsWith("/private/tmp/TrailMindV4RunRuntime-") &&
    !value.includes("..") && !value.includes("\0") && value.length <= 500;
}

function boundedIdentifier(value) {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length &&
    actual.every((key, index) => key === sorted[index]);
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

function invalid(code = "invalid_v4_durable_proof_run_identity") {
  throw new V4DurableProofRunIdentityError(code);
}

function mismatch() {
  throw new V4DurableProofRunIdentityError(
    "v4_durable_proof_run_identity_mismatch"
  );
}
