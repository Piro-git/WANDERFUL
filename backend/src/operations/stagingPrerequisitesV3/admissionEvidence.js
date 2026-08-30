import { resolve } from "node:path";
import {
  AUDITOR_ROLE,
  HEX_40,
  HEX_64,
  TARGET_PROJECT_NAME,
  UUID
} from "./constants.js";
import {
  canonicalJson,
  canonicalSha256,
  exactKeys,
  strictParseJson
} from "./canonicalJson.js";
import { catalogAssertionProgramSha256 } from "./catalogAssertion.js";
import { verifyPinnedCaFile } from "./caPin.js";
import { blocked } from "./errors.js";
import { compileExpectedManifest } from "./expectedManifest.js";
import {
  MIGRATION_PROFILE_SCHEMA_VERSION,
  SUPABASE_PHASE1_PROFILE_ID
} from "./migrationProfiles.js";
import {
  buildReadinessContract,
  flattenReviewedPins
} from "./readiness.js";
import { verifyCanonicalReceipt } from "./signing.js";

export const STAGING_ADMISSION_EVIDENCE_SCHEMA_VERSION = 1;
export const STAGING_ADMISSION_MAXIMUM_AGE_MILLISECONDS = 5 * 60 * 1_000;
export const STAGING_ADMISSION_MAXIMUM_FUTURE_SKEW_MILLISECONDS = 30 * 1_000;
export const STAGING_PHASE1_V2_PROJECT_REF = "mbvzwsrtqcrwhvykugcd";

const APPLICATION_NAME = /^trailmind_p1v2_auditor_[a-f0-9]{32}$/;
export function validateStagingInitializationEvidence(input, {
  declarationPath,
  now = () => new Date(),
  repositoryRoot = resolve(import.meta.dirname, "../../../../"),
  replayStore,
  consume = false
} = {}) {
  const evidence = parseEvidence(input);
  validateEvidenceHeader(evidence);
  const readiness = buildReadinessContract({
    declarationPath,
    repositoryRoot,
    reviewedPins: evidence.reviewedPins
  });
  if (readiness.contract.status !== "offline_prerequisites_ready" ||
      readiness.contract.issueCodes.length !== 0 ||
      readiness.contract.reviewReceiptCount !== 5) {
    blocked("reviewed_pins_not_ready");
  }
  const pins = flattenReviewedPins(evidence.reviewedPins);
  if (new Set(evidence.reviewedPins.reviewReceipts.map(
    ({ reviewSha256 }) => reviewSha256
  )).size !== 5) blocked("review_receipt_duplicate");

  const manifest = compileExpectedManifest({ declarationPath, repositoryRoot });
  const programSha256 = catalogAssertionProgramSha256();
  if (manifest.manifest.targetProjectName !== TARGET_PROJECT_NAME ||
      manifest.manifest.migrationProfile.profileId !==
        SUPABASE_PHASE1_PROFILE_ID ||
      readiness.contract.candidateEvidence.independentExpectedManifestSha256 !==
        manifest.sha256 ||
      readiness.contract.candidateEvidence.independentCatalogAssertionProgramSha256 !==
        programSha256 ||
      pins["staticGate.independentExpectedManifestSha256"] !== manifest.sha256 ||
      pins["staticGate.independentCatalogAssertionProgramSha256"] !==
        programSha256) {
    blocked("static_evidence_binding");
  }

  const caPin = pins["auditorContract.connection.sslrootcertSha256"];
  verifyPinnedCaFile({
    caCertificatePath: evidence.caCertificatePath,
    reviewedSslrootcertSha256: caPin
  });
  const keyId = pins["artifactContract.key.keyId"];
  const publicKeyPin =
    pins["artifactContract.key.requiredPinnedPublicKeySpkiSha256"];
  const signedArtifact = typeof evidence.signedArtifact === "string" ||
      Buffer.isBuffer(evidence.signedArtifact)
    ? strictParseJson(evidence.signedArtifact)
    : strictParseJson(canonicalJson(evidence.signedArtifact));
  const verification = verifyCanonicalReceipt({
    envelope: signedArtifact,
    publicKeyPath: evidence.publicKeyPath,
    requiredKeyId: keyId,
    requiredPublicKeySpkiSha256: publicKeyPin
  });
  if (!replayStore || typeof replayStore.has !== "function" ||
      (consume && typeof replayStore.add !== "function")) {
    blocked("replay_store");
  }
  if (replayStore.has(verification.artifactSha256)) {
    blocked("evidence_replay");
  }

  const sessionProof = validateSessionProof(evidence.sessionProof);
  const receipt = signedArtifact.receipt;
  validateReceiptBindings(receipt, {
    caPin,
    evidence,
    manifestSha256: manifest.sha256,
    programSha256,
    sessionProof
  });
  validateFreshness(receipt.observedAt, now);
  const evidenceBundleSha256 = canonicalSha256(evidenceBundle({
    caPin,
    evidence,
    manifestSha256: manifest.sha256,
    programSha256,
    sessionProof
  }));
  if (receipt.result.digest !== evidenceBundleSha256) {
    blocked("evidence_bundle_digest");
  }
  if (consume) {
    replayStore.add(verification.artifactSha256);
    if (!replayStore.has(verification.artifactSha256)) {
      blocked("replay_store");
    }
  }
  return Object.freeze({
    artifactSha256: verification.artifactSha256,
    authenticityProved: true,
    evidenceBundleSha256,
    expectedManifestSha256: manifest.sha256,
    freshnessProvedByBoundedTimestamp: true,
    initializationKind: evidence.initialization.initializationKind,
    integrityProved: true,
    migrationProfileId: SUPABASE_PHASE1_PROFILE_ID,
    programSha256,
    sessionCount: 3,
    targetProjectName: TARGET_PROJECT_NAME,
    truthProvedBySignature: false
  });
}

export function stagingInitializationEvidenceBundleDigest(input, {
  declarationPath,
  repositoryRoot = resolve(import.meta.dirname, "../../../../")
} = {}) {
  const evidence = parseEvidence(input);
  validateEvidenceHeader(evidence);
  const sessionProof = validateSessionProof(evidence.sessionProof);
  const manifest = compileExpectedManifest({ declarationPath, repositoryRoot });
  return canonicalSha256(evidenceBundle({
    caPin: flattenReviewedPins(evidence.reviewedPins)[
      "auditorContract.connection.sslrootcertSha256"
    ],
    evidence,
    manifestSha256: manifest.sha256,
    programSha256: catalogAssertionProgramSha256(),
    sessionProof
  }));
}

function parseEvidence(input) {
  try {
    return typeof input === "string" || Buffer.isBuffer(input)
      ? strictParseJson(input)
      : strictParseJson(canonicalJson(input));
  } catch (error) {
    if (error?.name === "StagingPrerequisitesV3Error") throw error;
    blocked("admission_evidence_parse");
  }
}

function validateEvidenceHeader(value) {
  exactKeys(value, [
    "caCertificatePath", "flags", "initialization", "migrationProfileId",
    "publicKeyPath", "restrictedObservations", "reviewedPins", "runBinding",
    "schemaVersion", "sessionProof", "signedArtifact", "target"
  ], "admission_evidence_keys");
  if (value.schemaVersion !== STAGING_ADMISSION_EVIDENCE_SCHEMA_VERSION ||
      value.migrationProfileId !== SUPABASE_PHASE1_PROFILE_ID ||
      typeof value.caCertificatePath !== "string" ||
      typeof value.publicKeyPath !== "string") {
    blocked("admission_evidence_header");
  }
  exactKeys(value.target, ["projectName", "projectRef"], "evidence_target_keys");
  if (value.target.projectName !== TARGET_PROJECT_NAME ||
      value.target.projectRef !== STAGING_PHASE1_V2_PROJECT_REF) {
    blocked("evidence_target");
  }
  exactKeys(value.runBinding, [
    "candidateGitCommit", "candidateGitTree", "runId"
  ], "evidence_run_keys");
  if (!HEX_40.test(value.runBinding.candidateGitCommit) ||
      !HEX_40.test(value.runBinding.candidateGitTree) ||
      !UUID.test(value.runBinding.runId)) blocked("evidence_run_binding");
  exactKeys(value.flags, [
    "insecureTransport", "migrationExecution", "productFeatures",
    "productionAdmission", "providerMutation", "remoteCalls"
  ], "evidence_flag_keys");
  if (Object.values(value.flags).some((flag) => flag !== false)) {
    blocked("evidence_flags_enabled");
  }
  exactKeys(value.initialization, [
    "databaseEmpty", "initializationKind", "previousInitializationCount",
    "requestedInitializationCount"
  ], "evidence_initialization_keys");
  if (value.initialization.databaseEmpty !== true ||
      value.initialization.initializationKind !== "empty_internal_disabled" ||
      value.initialization.previousInitializationCount !== 0 ||
      value.initialization.requestedInitializationCount !== 1) {
    blocked("evidence_initialization_scope");
  }
  exactKeys(value.restrictedObservations, [
    "advisorCausalFreshness", "computeSize", "exactInvoiceAmount",
    "exactUsageAmount", "freePlan", "providerSiblingIsolation",
    "selectedPaidAddons", "source"
  ], "restricted_observation_keys");
  const expected = {
    advisorCausalFreshness: "unproved",
    computeSize: "verified_nano",
    exactInvoiceAmount: "unavailable",
    exactUsageAmount: "unavailable",
    freePlan: "verified",
    providerSiblingIsolation: "unproved",
    selectedPaidAddons: "verified_none",
    source: "restricted_management_observation"
  };
  if (canonicalJson(value.restrictedObservations) !== canonicalJson(expected)) {
    blocked("restricted_observation_claim");
  }
}

function validateSessionProof(value) {
  exactKeys(value, [
    "authorizationEligible", "cleanupObservations", "primaryResultSha256",
    "proofMode", "proofSchemaVersion", "resultSha256",
    "sampleSeparationMilliseconds", "sessionCount", "sessionIdentities",
    "snapshotsFresh", "status"
  ], "session_proof_keys");
  if (value.authorizationEligible !== true ||
      value.proofMode !== "catalog-admission" ||
      value.proofSchemaVersion !== 1 || value.sessionCount !== 3 ||
      value.snapshotsFresh !== true || value.status !== "pass" ||
      !HEX_64.test(value.primaryResultSha256) ||
      !HEX_64.test(value.resultSha256) ||
      !Number.isSafeInteger(value.sampleSeparationMilliseconds) ||
      value.sampleSeparationMilliseconds < 100 ||
      value.sampleSeparationMilliseconds > 5_000 ||
      !Array.isArray(value.sessionIdentities) ||
      value.sessionIdentities.length !== 3 ||
      !Array.isArray(value.cleanupObservations) ||
      value.cleanupObservations.length !== 2) {
    blocked("session_proof_shape");
  }
  const identities = value.sessionIdentities.map(validateSessionIdentity);
  if (new Set(identities.map(({ applicationName }) => applicationName)).size !== 3 ||
      new Set(identities.map(({ backendPid }) => backendPid)).size !== 3 ||
      new Set(identities.map(({ sessionIdentitySha256 }) =>
        sessionIdentitySha256)).size !== 3) {
    blocked("independent_sessions");
  }
  value.cleanupObservations.forEach((observation, index) => {
    exactKeys(observation, [
      "applicationName", "backendPid", "sessionIdentitySha256",
      "snapshotSha256", "zeroLeak"
    ], "cleanup_observation_keys");
    if (observation.zeroLeak !== true || canonicalJson({
      applicationName: observation.applicationName,
      backendPid: observation.backendPid,
      sessionIdentitySha256: observation.sessionIdentitySha256,
      snapshotSha256: observation.snapshotSha256
    }) !== canonicalJson(identities[index + 1])) {
      blocked("cleanup_observation_binding");
    }
  });
  const unsigned = Object.fromEntries(Object.entries(value).filter(
    ([key]) => key !== "resultSha256"
  ));
  if (canonicalSha256(unsigned) !== value.resultSha256) {
    blocked("session_proof_digest");
  }
  return value;
}

function validateSessionIdentity(value) {
  exactKeys(value, [
    "applicationName", "backendPid", "sessionIdentitySha256", "snapshotSha256"
  ], "session_identity_keys");
  if (!APPLICATION_NAME.test(value.applicationName) ||
      !Number.isSafeInteger(value.backendPid) || value.backendPid <= 0 ||
      !HEX_64.test(value.sessionIdentitySha256) ||
      !HEX_64.test(value.snapshotSha256)) blocked("session_identity");
  return value;
}

function validateReceiptBindings(receipt, {
  caPin,
  evidence,
  manifestSha256,
  programSha256,
  sessionProof
}) {
  const primary = sessionProof.sessionIdentities[0];
  if (receipt.auditorSslrootcertSha256 !== caPin ||
      receipt.candidateGitCommit !== evidence.runBinding.candidateGitCommit ||
      receipt.candidateGitTree !== evidence.runBinding.candidateGitTree ||
      receipt.catalogResultSha256 !== sessionProof.primaryResultSha256 ||
      receipt.expectedManifestSha256 !== manifestSha256 ||
      receipt.migrationProfileId !== SUPABASE_PHASE1_PROFILE_ID ||
      receipt.migrationProfileSchemaVersion !==
        MIGRATION_PROFILE_SCHEMA_VERSION ||
      receipt.programSha256 !== programSha256 ||
      receipt.runId !== evidence.runBinding.runId ||
      receipt.targetProjectName !== TARGET_PROJECT_NAME ||
      receipt.result.status !== "pass" ||
      canonicalJson(receipt.auditorIdentity) !== canonicalJson({
        applicationName: primary.applicationName,
        backendPid: primary.backendPid,
        roleName: AUDITOR_ROLE,
        sessionIdentitySha256: primary.sessionIdentitySha256
      })) {
    blocked("signed_receipt_binding");
  }
}

function evidenceBundle({
  caPin,
  evidence,
  manifestSha256,
  programSha256,
  sessionProof
}) {
  return {
    auditorSslrootcertSha256: caPin,
    catalogAssertionProgramSha256: programSha256,
    expectedManifestSha256: manifestSha256,
    flags: evidence.flags,
    initialization: evidence.initialization,
    migrationProfile: {
      profileId: SUPABASE_PHASE1_PROFILE_ID,
      schemaVersion: MIGRATION_PROFILE_SCHEMA_VERSION
    },
    restrictedObservations: evidence.restrictedObservations,
    runBinding: evidence.runBinding,
    schemaVersion: STAGING_ADMISSION_EVIDENCE_SCHEMA_VERSION,
    sessionProof,
    target: evidence.target
  };
}

function validateFreshness(observedAt, now) {
  const clock = now();
  if (!(clock instanceof Date) || Number.isNaN(clock.getTime())) blocked("time");
  const observed = new Date(observedAt);
  const age = clock.getTime() - observed.getTime();
  if (age < -STAGING_ADMISSION_MAXIMUM_FUTURE_SKEW_MILLISECONDS ||
      age > STAGING_ADMISSION_MAXIMUM_AGE_MILLISECONDS) {
    blocked("evidence_stale");
  }
}
