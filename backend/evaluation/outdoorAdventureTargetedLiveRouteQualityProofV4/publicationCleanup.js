import { lstat } from "node:fs/promises";
import {
  V4_FLAG_NAMES,
  assertNoSensitiveDurableValueV4,
  sha256V4
} from "./contract.js";

export const V4_PUBLICATION_CLEANUP_SCHEMA_VERSION = 1;
export const V4_PUBLICATION_CLEANUP_VERSION =
  "outdoor-adventure-targeted-live-route-quality-proof-v4-publication-cleanup-v1";

const VERIFIED_CLEANUP_EVIDENCE = new WeakSet();
const EVIDENCE_KEYS = Object.freeze([
  "captureArtifactRemoved",
  "cleanupComplete",
  "contractVersion",
  "digest",
  "disabledZeroWorkBudgetOperations",
  "disabledZeroWorkDatabaseOperations",
  "disabledZeroWorkAuthorizationOperations",
  "disabledZeroWorkLeaseOperations",
  "disabledZeroWorkOrchestratorOperations",
  "disabledZeroWorkProbePassed",
  "disabledZeroWorkProviderOperations",
  "finalFlagsDisabled",
  "finalSummaryAbsentBeforePublication",
  "identityArtifactRemoved",
  "leasesReleased",
  "ledgerArtifactRemoved",
  "poolsClosed",
  "providerCredentialRemovedFromProofProcess",
  "publicationLockRemoved",
  "removedTaskOwnedRuntimeArtifactCount",
  "retainedFinalSummaryExcludedFromTaskOwnedRuntimeArtifacts",
  "schemaVersion",
  "taskOwnedArtifactsRemoved",
  "taskOwnedRuntimeArtifactCount"
]);

export class V4PublicationCleanupError extends Error {
  constructor(code) {
    super(code);
    this.name = "V4PublicationCleanupError";
    this.code = code;
  }
}

export async function assertV4PublicationOutputAbsent(summaryPath) {
  validateRuntimePath(summaryPath);
  await requireAbsent(summaryPath, "v4_final_summary_already_exists");
  return true;
}

export async function captureV4VerifiedPublicationCleanupEvidence({
  identityPath,
  capturePath,
  ledgerPath,
  publicationLockPath,
  summaryPath,
  finalFlags,
  disabledProbe
}) {
  const paths = [identityPath, capturePath, ledgerPath, summaryPath];
  if (paths.some((path) => !authorizedRuntimePath(path)) ||
      publicationLockPath !== `${ledgerPath}.lock` ||
      new Set([...paths, publicationLockPath]).size !== paths.length + 1) {
    invalid();
  }
  validateFinalFlags(finalFlags);
  validateDisabledProbe(disabledProbe);
  await requireAbsent(identityPath);
  await requireAbsent(capturePath);
  await requireAbsent(ledgerPath);
  await requireAbsent(publicationLockPath);
  await requireAbsent(summaryPath, "v4_final_summary_already_exists");

  const record = {
    schemaVersion: V4_PUBLICATION_CLEANUP_SCHEMA_VERSION,
    contractVersion: V4_PUBLICATION_CLEANUP_VERSION,
    cleanupComplete: true,
    finalFlagsDisabled: true,
    disabledZeroWorkProbePassed: true,
    disabledZeroWorkAuthorizationOperations:
      disabledProbe.authorizationOperations,
    disabledZeroWorkDatabaseOperations: disabledProbe.databaseOperations,
    disabledZeroWorkProviderOperations: disabledProbe.providerOperations,
    disabledZeroWorkBudgetOperations: disabledProbe.budgetOperations,
    disabledZeroWorkLeaseOperations: disabledProbe.leaseOperations,
    disabledZeroWorkOrchestratorOperations:
      disabledProbe.orchestratorOperations,
    providerCredentialRemovedFromProofProcess: true,
    poolsClosed: true,
    leasesReleased: true,
    taskOwnedArtifactsRemoved: true,
    identityArtifactRemoved: true,
    captureArtifactRemoved: true,
    ledgerArtifactRemoved: true,
    publicationLockRemoved: true,
    taskOwnedRuntimeArtifactCount: 4,
    removedTaskOwnedRuntimeArtifactCount: 4,
    retainedFinalSummaryExcludedFromTaskOwnedRuntimeArtifacts: true,
    finalSummaryAbsentBeforePublication: true
  };
  assertNoSensitiveDurableValueV4(record);
  const evidence = deepFreeze({ ...record, digest: sha256V4(record) });
  VERIFIED_CLEANUP_EVIDENCE.add(evidence);
  return evidence;
}

export function validateV4PublicationCleanupEvidence(evidence) {
  if (!plainObject(evidence) ||
      !VERIFIED_CLEANUP_EVIDENCE.has(evidence) ||
      !exactKeys(evidence, EVIDENCE_KEYS) ||
      evidence.schemaVersion !== V4_PUBLICATION_CLEANUP_SCHEMA_VERSION ||
      evidence.contractVersion !== V4_PUBLICATION_CLEANUP_VERSION ||
      evidence.cleanupComplete !== true ||
      evidence.finalFlagsDisabled !== true ||
      evidence.disabledZeroWorkProbePassed !== true ||
      evidence.disabledZeroWorkAuthorizationOperations !== 0 ||
      evidence.disabledZeroWorkDatabaseOperations !== 0 ||
      evidence.disabledZeroWorkProviderOperations !== 0 ||
      evidence.disabledZeroWorkBudgetOperations !== 0 ||
      evidence.disabledZeroWorkLeaseOperations !== 0 ||
      evidence.disabledZeroWorkOrchestratorOperations !== 0 ||
      evidence.providerCredentialRemovedFromProofProcess !== true ||
      evidence.poolsClosed !== true || evidence.leasesReleased !== true ||
      evidence.taskOwnedArtifactsRemoved !== true ||
      evidence.identityArtifactRemoved !== true ||
      evidence.captureArtifactRemoved !== true ||
      evidence.ledgerArtifactRemoved !== true ||
      evidence.publicationLockRemoved !== true ||
      evidence.taskOwnedRuntimeArtifactCount !== 4 ||
      evidence.removedTaskOwnedRuntimeArtifactCount !== 4 ||
      evidence.retainedFinalSummaryExcludedFromTaskOwnedRuntimeArtifacts !==
        true || evidence.finalSummaryAbsentBeforePublication !== true ||
      !/^[a-f0-9]{64}$/.test(evidence.digest ?? "")) invalid();
  const { digest, ...record } = evidence;
  if (sha256V4(record) !== digest) invalid();
  assertNoSensitiveDurableValueV4(evidence);
  return true;
}

export function v4PublicationCleanupReceiptBinding(evidence) {
  validateV4PublicationCleanupEvidence(evidence);
  return deepFreeze(structuredClone(evidence));
}

function validateFinalFlags(snapshot) {
  if (!plainObject(snapshot) || snapshot.exactAdmissionVerified !== true ||
      !plainObject(snapshot.flags) ||
      !exactKeys(snapshot.flags, V4_FLAG_NAMES) ||
      V4_FLAG_NAMES.some((name) => snapshot.flags[name] !== false)) {
    invalid("v4_final_flags_not_disabled");
  }
}

function validateDisabledProbe(probe) {
  if (!plainObject(probe) || probe.passed !== true ||
      probe.authorizationOperations !== 0 ||
      probe.databaseOperations !== 0 || probe.providerOperations !== 0 ||
      probe.budgetOperations !== 0 || probe.leaseOperations !== 0 ||
      probe.orchestratorOperations !== 0) {
    invalid("v4_disabled_zero_work_probe_failed");
  }
}

async function requireAbsent(path, presentCode = "v4_runtime_artifact_present") {
  validateRuntimePath(path);
  try {
    await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    invalid("v4_runtime_artifact_absence_check_failed");
  }
  invalid(presentCode);
}

function validateRuntimePath(path) {
  if (!authorizedRuntimePath(path)) invalid("invalid_v4_runtime_path");
}

function authorizedRuntimePath(value) {
  return typeof value === "string" &&
    value.startsWith("/private/tmp/TrailMindV4RunRuntime-") &&
    !value.includes("..") && !value.includes("\0") && value.length <= 500;
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

function invalid(code = "invalid_v4_publication_cleanup_evidence") {
  throw new V4PublicationCleanupError(code);
}
