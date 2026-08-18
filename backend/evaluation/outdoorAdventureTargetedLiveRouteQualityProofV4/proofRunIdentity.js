import {
  V4_CASE_BINDINGS,
  V4_PROOF_CLASSIFICATION,
  V4_PROOF_VERSION,
  V4_PROVIDER_CALL_LIMIT,
  V4_SCHEMA_VERSION,
  assertNoSensitiveDurableValueV4,
  sha256V4,
  stableSerializeV4,
  validateV4SummaryProtocol
} from "./contract.js";
import {
  validateV4ProofClockBinding,
  validateV4ProofRunContext
} from "./proofRunContext.js";
import {
  v4GitCandidateAttestationDigest
} from "./gitCandidateAttestation.js";

export const V4_PROOF_RUN_IDENTITY_SCHEMA_VERSION = 1;
export const V4_PROOF_RUN_IDENTITY_VERSION =
  "outdoor-adventure-targeted-live-route-quality-proof-v4-run-identity-v1";
export const V4_GOLDEN_SET_POLICY_VERSION =
  "golden-set-v1-evaluation-policy-r1";
export const V4_GOLDEN_SET_MANIFEST_DIGEST =
  "a006a775c2c791134281b322e431973e18fa252d2afa30347cb83419a93af521";
export const V4_PRODUCT_SHAPING_POLICY_VERSION =
  "research-guided-route-product-shaping-v3";
export const V4_PRODUCT_SHAPING_POLICY_DIGEST =
  "70a01b65b7c8a19077288bc09fcf47174a0ab1e0058e31a320a5e8e4a2eaba42";
export const V4_REGIONAL_SOURCE_MANIFEST_DIGEST =
  "99940abd1daf388574cab69fe71e69a74fb0d700c0899ed44ba3001756206329";

const HEX_40 = /^[a-f0-9]{40}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const SEALED_IDENTITIES = new WeakSet();
const CREATION_KEYS = Object.freeze([
  "authorizationReference",
  "baselineCommit",
  "candidateCommit",
  "caseManifest",
  "gitCandidateAttestationDigest",
  "goldenSetManifestDigest",
  "goldenSetPolicyVersion",
  "ledgerNamespace",
  "productShapingPolicyDigest",
  "productShapingPolicyVersion",
  "proofRunContext",
  "providerCallLimit",
  "regionalSourceManifestDigest"
]);
const RECORD_KEYS = Object.freeze([
  "authorizationReference",
  "baselineCommit",
  "candidateCommit",
  "canonicalCases",
  "caseManifestDigest",
  "contractVersion",
  "evidenceSnapshotsDigest",
  "gitCandidateAttestationDigest",
  "goldenSetManifestDigest",
  "goldenSetPolicyVersion",
  "ledgerNamespace",
  "productShapingPolicyDigest",
  "productShapingPolicyVersion",
  "proofAsOf",
  "proofClassification",
  "proofRunContextDigest",
  "proofSchemaVersion",
  "proofVersion",
  "providerCallLimit",
  "regionalSourceManifestDigest",
  "schemaVersion"
]);
const SUMMARY_CONTROLLED_KEYS = new Set([
  "authorizationReference",
  "baselineCommit",
  "candidateCommit",
  "generatedAt",
  "ledgerNamespace",
  "manifest",
  "proofAsOf",
  "proofClassification",
  "proofRunContextDigest",
  "proofRunIdentity",
  "proofRunIdentityArtifactDigest",
  "proofRunIdentityDigest",
  "proofVersion",
  "schemaVersion",
  "semanticReceiptSha256"
]);

export class V4ProofRunIdentityError extends Error {
  constructor(code) {
    super(code);
    this.name = "V4ProofRunIdentityError";
    this.code = code;
  }
}

export function buildV4RunManifestRecord(authorizationReference) {
  if (!boundedIdentifier(authorizationReference)) invalid();
  const bindings = canonicalCases();
  return deepFreeze({
    digest: sha256V4({ authorizationReference, bindings }),
    bindings
  });
}

export function createV4ProofRunIdentity(input) {
  if (!plainObject(input) || !exactKeys(input, CREATION_KEYS)) invalid();
  validateV4ProofRunContext(input.proofRunContext);
  const manifest = normalizeManifest(
    input.caseManifest,
    input.authorizationReference
  );
  if (!HEX_40.test(input.baselineCommit ?? "") ||
      !HEX_40.test(input.candidateCommit ?? "") ||
      !boundedIdentifier(input.authorizationReference) ||
      !boundedIdentifier(input.ledgerNamespace) ||
      input.providerCallLimit !== V4_PROVIDER_CALL_LIMIT ||
      input.gitCandidateAttestationDigest !==
        v4GitCandidateAttestationDigest({
          baselineCommit: input.baselineCommit,
          candidateCommit: input.candidateCommit
        }) ||
      input.goldenSetManifestDigest !== V4_GOLDEN_SET_MANIFEST_DIGEST ||
      input.goldenSetPolicyVersion !== V4_GOLDEN_SET_POLICY_VERSION ||
      input.productShapingPolicyVersion !==
        V4_PRODUCT_SHAPING_POLICY_VERSION ||
      input.productShapingPolicyDigest !==
        V4_PRODUCT_SHAPING_POLICY_DIGEST ||
      input.regionalSourceManifestDigest !==
        V4_REGIONAL_SOURCE_MANIFEST_DIGEST ||
      input.proofRunContext.authorizationReference !==
        input.authorizationReference ||
      input.proofRunContext.ledgerNamespace !== input.ledgerNamespace ||
      input.proofRunContext.caseManifestDigest !== manifest.digest) {
    mismatch();
  }
  const record = {
    schemaVersion: V4_PROOF_RUN_IDENTITY_SCHEMA_VERSION,
    contractVersion: V4_PROOF_RUN_IDENTITY_VERSION,
    proofSchemaVersion: V4_SCHEMA_VERSION,
    proofVersion: V4_PROOF_VERSION,
    proofClassification: V4_PROOF_CLASSIFICATION,
    baselineCommit: input.baselineCommit,
    candidateCommit: input.candidateCommit,
    authorizationReference: input.authorizationReference,
    providerCallLimit: input.providerCallLimit,
    ledgerNamespace: input.ledgerNamespace,
    proofAsOf: input.proofRunContext.proofAsOf,
    canonicalCases: manifest.bindings,
    caseManifestDigest: manifest.digest,
    goldenSetManifestDigest: input.goldenSetManifestDigest,
    goldenSetPolicyVersion: input.goldenSetPolicyVersion,
    productShapingPolicyVersion: input.productShapingPolicyVersion,
    productShapingPolicyDigest: input.productShapingPolicyDigest,
    regionalSourceManifestDigest: input.regionalSourceManifestDigest,
    proofRunContextDigest: input.proofRunContext.digest,
    evidenceSnapshotsDigest: sha256V4(
      input.proofRunContext.evidenceSnapshots
    ),
    gitCandidateAttestationDigest: input.gitCandidateAttestationDigest
  };
  const identity = deepFreeze({ ...record, digest: sha256V4(record) });
  SEALED_IDENTITIES.add(identity);
  return identity;
}

export function validateV4ProofRunIdentity(identity) {
  if (!plainObject(identity) || !SEALED_IDENTITIES.has(identity) ||
      !exactKeys(identity, [...RECORD_KEYS, "digest"]) ||
      !HEX_64.test(identity.digest ?? "")) invalid();
  const record = normalizeIdentityRecord(identity);
  if (sha256V4(record) !== identity.digest) mismatch();
  return true;
}

export function serializeV4ProofRunIdentity(identity) {
  validateV4ProofRunIdentity(identity);
  return stableSerializeV4(identityRecordWithDigest(identity));
}

export function v4ProofRunIdentityReceiptBinding(identity) {
  validateV4ProofRunIdentity(identity);
  return deepFreeze(identityRecordWithDigest(identity));
}

export function validateV4ProofRunIdentityForContext(identity, runContext) {
  validateV4ProofRunIdentity(identity);
  validateV4ProofRunContext(runContext);
  if (identity.proofRunContextDigest !== runContext.digest ||
      identity.proofAsOf !== runContext.proofAsOf ||
      identity.authorizationReference !== runContext.authorizationReference ||
      identity.ledgerNamespace !== runContext.ledgerNamespace ||
      identity.caseManifestDigest !== runContext.caseManifestDigest ||
      identity.evidenceSnapshotsDigest !==
        sha256V4(runContext.evidenceSnapshots)) mismatch();
  return true;
}

export async function admitV4ProviderAfterProofIdentityReconciliation(
  input,
  admission
) {
  if (!plainObject(input) || !exactKeys(input, [
    "databaseDiagnostic", "proofClockBinding", "runContext", "runIdentity"
  ]) || typeof admission !== "function") invalidAdmission();
  validateV4ProofRunIdentityForContext(input.runIdentity, input.runContext);
  validateV4ProofClockBinding(
    input.runContext,
    input.databaseDiagnostic,
    input.proofClockBinding
  );
  return admission();
}

export function bindV4RunSummaryIdentity(
  fields,
  identity,
  proofRunIdentityArtifactDigest = null
) {
  validateV4ProofRunIdentity(identity);
  if (!plainObject(fields) ||
      Object.keys(fields).some((key) => SUMMARY_CONTROLLED_KEYS.has(key)) ||
      (proofRunIdentityArtifactDigest !== null &&
        !HEX_64.test(proofRunIdentityArtifactDigest)) ||
      !plainObject(fields.providerAccounting) ||
      fields.providerAccounting.hardLimit !== identity.providerCallLimit ||
      fields.providerAccounting.authorizationReference !==
        identity.authorizationReference ||
      fields.providerAccounting.ledgerNamespace !== identity.ledgerNamespace) {
    invalidSummaryIdentity();
  }
  const record = {
    ...fields,
    schemaVersion: identity.proofSchemaVersion,
    proofVersion: identity.proofVersion,
    proofClassification: identity.proofClassification,
    baselineCommit: identity.baselineCommit,
    candidateCommit: identity.candidateCommit,
    authorizationReference: identity.authorizationReference,
    ledgerNamespace: identity.ledgerNamespace,
    generatedAt: identity.proofAsOf,
    proofAsOf: identity.proofAsOf,
    proofRunContextDigest: identity.proofRunContextDigest,
    proofRunIdentityDigest: identity.digest,
    ...(proofRunIdentityArtifactDigest === null ? {} : {
      proofRunIdentityArtifactDigest
    }),
    proofRunIdentity: v4ProofRunIdentityReceiptBinding(identity),
    manifest: {
      digest: identity.caseManifestDigest,
      bindings: structuredClone(identity.canonicalCases)
    }
  };
  validateSummaryIdentityBinding(record, identity);
  validateV4SummaryProtocol(record, expectedSummaryManifest(identity));
  assertNoSensitiveDurableValueV4(record);
  return deepFreeze({
    ...record,
    semanticReceiptSha256: summaryDigest(record)
  });
}

export function bindV4RunReceiptIdentity(
  fields,
  identity,
  proofRunIdentityArtifactDigest = null
) {
  validateV4ProofRunIdentity(identity);
  if (!plainObject(fields) ||
      Object.keys(fields).some((key) => SUMMARY_CONTROLLED_KEYS.has(key)) ||
      (proofRunIdentityArtifactDigest !== null &&
        !HEX_64.test(proofRunIdentityArtifactDigest)) ||
      !plainObject(fields.providerAccounting) ||
      fields.providerAccounting.hardLimit !== identity.providerCallLimit ||
      fields.providerAccounting.authorizationReference !==
        identity.authorizationReference ||
      fields.providerAccounting.ledgerNamespace !== identity.ledgerNamespace) {
    invalidSummaryIdentity();
  }
  return deepFreeze({
    ...fields,
    schemaVersion: identity.proofSchemaVersion,
    proofVersion: identity.proofVersion,
    proofClassification: identity.proofClassification,
    baselineCommit: identity.baselineCommit,
    candidateCommit: identity.candidateCommit,
    authorizationReference: identity.authorizationReference,
    ledgerNamespace: identity.ledgerNamespace,
    generatedAt: identity.proofAsOf,
    proofAsOf: identity.proofAsOf,
    proofRunContextDigest: identity.proofRunContextDigest,
    proofRunIdentityDigest: identity.digest,
    ...(proofRunIdentityArtifactDigest === null ? {} : {
      proofRunIdentityArtifactDigest
    }),
    proofRunIdentity: v4ProofRunIdentityReceiptBinding(identity),
    manifest: {
      digest: identity.caseManifestDigest,
      bindings: structuredClone(identity.canonicalCases)
    }
  });
}

export function validateV4RunReceiptIdentity(receipt, identity) {
  validateV4ProofRunIdentity(identity);
  if (!plainObject(receipt)) invalidSummaryIdentity();
  validateSummaryIdentityBinding(receipt, identity);
  return true;
}

export function validateV4RunSummary(summary, identity) {
  validateV4ProofRunIdentity(identity);
  if (!plainObject(summary) ||
      !HEX_64.test(summary.semanticReceiptSha256 ?? "")) {
    invalidSummaryIdentity();
  }
  validateSummaryIdentityBinding(summary, identity);
  validateV4SummaryProtocol(summary, expectedSummaryManifest(identity));
  assertNoSensitiveDurableValueV4(summary);
  const { semanticReceiptSha256, ...record } = summary;
  if (summaryDigest(record) !== semanticReceiptSha256) {
    throw new V4ProofRunIdentityError("v4_summary_semantic_digest_mismatch");
  }
  return true;
}

function validateSummaryIdentityBinding(summary, identity) {
  if (summary.schemaVersion !== identity.proofSchemaVersion ||
      summary.proofVersion !== identity.proofVersion ||
      summary.proofClassification !== identity.proofClassification ||
      summary.baselineCommit !== identity.baselineCommit ||
      summary.candidateCommit !== identity.candidateCommit ||
      summary.authorizationReference !== identity.authorizationReference ||
      summary.ledgerNamespace !== identity.ledgerNamespace ||
      summary.generatedAt !== identity.proofAsOf ||
      summary.proofAsOf !== identity.proofAsOf ||
      summary.proofRunContextDigest !== identity.proofRunContextDigest ||
      summary.proofRunIdentityDigest !== identity.digest ||
      !plainObject(summary.providerAccounting) ||
      summary.providerAccounting.hardLimit !== identity.providerCallLimit ||
      summary.providerAccounting.authorizationReference !==
        identity.authorizationReference ||
      summary.providerAccounting.ledgerNamespace !== identity.ledgerNamespace ||
      !canonicallyEqual(
        summary.proofRunIdentity,
        identityRecordWithDigest(identity)
      )) {
    mismatch();
  }
  validateSummaryManifest(summary.manifest, identity);
  if (!Array.isArray(summary.cases) ||
      summary.cases.length !== identity.canonicalCases.length ||
      summary.cases.some((record, index) => {
        const expected = identity.canonicalCases[index];
        return record?.caseId !== expected.caseId ||
          record?.goldenCaseId !== expected.goldenCaseId ||
          record?.fixtureDigest !== expected.fixtureDigest ||
          record?.goldenCaseDigest !== expected.goldenCaseDigest;
      })) mismatch();
}

function validateSummaryManifest(manifest, identity) {
  const normalized = normalizeManifest(
    manifest,
    identity.authorizationReference
  );
  if (normalized.digest !== identity.caseManifestDigest ||
      !canonicallyEqual(normalized.bindings, identity.canonicalCases)) {
    mismatch();
  }
  return true;
}

function expectedSummaryManifest(identity) {
  return {
    digest: identity.caseManifestDigest,
    bindings: structuredClone(identity.canonicalCases)
  };
}

function normalizeManifest(value, authorizationReference) {
  if (!plainObject(value) || !exactKeys(value, ["bindings", "digest"]) ||
      !HEX_64.test(value.digest ?? "") || !Array.isArray(value.bindings) ||
      value.bindings.length !== V4_CASE_BINDINGS.length) mismatch();
  const bindings = value.bindings.map((binding, index) => {
    const expected = V4_CASE_BINDINGS[index];
    if (!plainObject(binding) || !exactKeys(binding, [
      "caseId", "fixtureDigest", "goldenCaseDigest", "goldenCaseId"
    ]) || binding.caseId !== expected.caseId ||
        binding.goldenCaseId !== expected.goldenCaseId ||
        binding.fixtureDigest !== expected.fixtureDigest ||
        binding.goldenCaseDigest !== expected.goldenCaseDigest) mismatch();
    return { ...binding };
  });
  if (sha256V4({ authorizationReference, bindings }) !== value.digest) {
    mismatch();
  }
  return { digest: value.digest, bindings };
}

function normalizeIdentityRecord(identity) {
  if (identity.schemaVersion !== V4_PROOF_RUN_IDENTITY_SCHEMA_VERSION ||
      identity.contractVersion !== V4_PROOF_RUN_IDENTITY_VERSION ||
      identity.proofSchemaVersion !== V4_SCHEMA_VERSION ||
      identity.proofVersion !== V4_PROOF_VERSION ||
      identity.proofClassification !== V4_PROOF_CLASSIFICATION ||
      !HEX_40.test(identity.baselineCommit ?? "") ||
      !HEX_40.test(identity.candidateCommit ?? "") ||
      !boundedIdentifier(identity.authorizationReference) ||
      identity.providerCallLimit !== V4_PROVIDER_CALL_LIMIT ||
      !boundedIdentifier(identity.ledgerNamespace) ||
      identity.goldenSetManifestDigest !== V4_GOLDEN_SET_MANIFEST_DIGEST ||
      identity.goldenSetPolicyVersion !== V4_GOLDEN_SET_POLICY_VERSION ||
      identity.productShapingPolicyVersion !==
        V4_PRODUCT_SHAPING_POLICY_VERSION ||
      identity.productShapingPolicyDigest !==
        V4_PRODUCT_SHAPING_POLICY_DIGEST ||
      identity.regionalSourceManifestDigest !==
        V4_REGIONAL_SOURCE_MANIFEST_DIGEST ||
      identity.gitCandidateAttestationDigest !==
        v4GitCandidateAttestationDigest({
          baselineCommit: identity.baselineCommit,
          candidateCommit: identity.candidateCommit
        }) ||
      !HEX_64.test(identity.proofRunContextDigest ?? "") ||
      !HEX_64.test(identity.evidenceSnapshotsDigest ?? "")) invalid();
  const manifest = normalizeManifest({
    digest: identity.caseManifestDigest,
    bindings: identity.canonicalCases
  }, identity.authorizationReference);
  return {
    schemaVersion: identity.schemaVersion,
    contractVersion: identity.contractVersion,
    proofSchemaVersion: identity.proofSchemaVersion,
    proofVersion: identity.proofVersion,
    proofClassification: identity.proofClassification,
    baselineCommit: identity.baselineCommit,
    candidateCommit: identity.candidateCommit,
    authorizationReference: identity.authorizationReference,
    providerCallLimit: identity.providerCallLimit,
    ledgerNamespace: identity.ledgerNamespace,
    proofAsOf: identity.proofAsOf,
    canonicalCases: manifest.bindings,
    caseManifestDigest: manifest.digest,
    goldenSetManifestDigest: identity.goldenSetManifestDigest,
    goldenSetPolicyVersion: identity.goldenSetPolicyVersion,
    productShapingPolicyVersion: identity.productShapingPolicyVersion,
    productShapingPolicyDigest: identity.productShapingPolicyDigest,
    regionalSourceManifestDigest: identity.regionalSourceManifestDigest,
    proofRunContextDigest: identity.proofRunContextDigest,
    evidenceSnapshotsDigest: identity.evidenceSnapshotsDigest,
    gitCandidateAttestationDigest: identity.gitCandidateAttestationDigest
  };
}

function identityRecordWithDigest(identity) {
  return structuredClone({ ...normalizeIdentityRecord(identity),
    digest: identity.digest });
}

function canonicalCases() {
  return V4_CASE_BINDINGS.map((binding) => ({
    caseId: binding.caseId,
    goldenCaseId: binding.goldenCaseId,
    fixtureDigest: binding.fixtureDigest,
    goldenCaseDigest: binding.goldenCaseDigest
  }));
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

function canonicallyEqual(left, right) {
  try {
    return stableSerializeV4(left) === stableSerializeV4(right);
  } catch {
    return false;
  }
}

function summaryDigest(value) {
  try {
    return sha256V4(value);
  } catch {
    throw new V4ProofRunIdentityError(
      "v4_summary_semantic_digest_mismatch"
    );
  }
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
  throw new V4ProofRunIdentityError("invalid_v4_proof_run_identity");
}

function mismatch() {
  throw new V4ProofRunIdentityError("v4_proof_run_identity_mismatch");
}

function invalidAdmission() {
  throw new V4ProofRunIdentityError("invalid_v4_provider_admission");
}

function invalidSummaryIdentity() {
  throw new V4ProofRunIdentityError("invalid_v4_run_summary_identity");
}
