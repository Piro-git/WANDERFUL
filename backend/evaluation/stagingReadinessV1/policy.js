import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_ALERT_IDS,
  CANONICAL_CASES,
  CANONICAL_FLAG_BINDINGS,
  CANONICAL_GATE_DEFINITIONS,
  CANONICAL_MIGRATIONS,
  CANONICAL_OUTAGE_IDS,
  CANONICAL_PERFORMANCE_OPERATIONS,
  CANONICAL_REGION_IDS,
  CANONICAL_RESTORE_RECONCILIATIONS,
  CANONICAL_ROLE_CONTRACTS,
  CANONICAL_ROLE_IDS,
  CANONICAL_ROLE_SEPARATION_GUARD_IDS,
  POLICY_SOURCE_PATHS,
  REVIEWED_THRESHOLDS,
  STAGING_READINESS_POLICY_VERSION
} from "./constants.js";
import {
  deepFreezeStagingReadinessV1,
  sha256StagingReadinessV1
} from "./serialization.js";

export const STAGING_READINESS_REPOSITORY_ROOT = fileURLToPath(new URL(
  "../../../",
  import.meta.url
));

const MAXIMUM_POLICY_SOURCE_BYTES = 2_000_000;

export async function loadStagingReadinessPolicyV1(options = {}) {
  const readFileImpl = options.readFileImpl ?? readFile;
  const sources = [];
  for (const path of POLICY_SOURCE_PATHS) {
    const bytes = await readBoundedPolicySource(readFileImpl, path);
    sources.push({ path, sha256: sha256StagingReadinessV1(bytes) });
  }

  const matrix = await readJsonSource(
    readFileImpl,
    "docs/operations/closed-beta-readiness-v1/feature-flag-state-matrix-v1.json"
  );
  const regionConfigs = [];
  for (const regionId of CANONICAL_REGION_IDS) {
    const suffix = regionId === "harz-v1" ? "harz-v1" : "innsbruck-alps-v1";
    const path = `backend/config/outdoor-regions/${suffix}.json`;
    const value = await readJsonSource(readFileImpl, path);
    if (value.regionId !== regionId || value.freshnessThresholdDays !== 14) {
      throw policyError("policy_region_contract_mismatch");
    }
    regionConfigs.push({
      regionId,
      configSha256: sourceDigest(sources, path),
      boundarySha256: sourceDigest(
        sources,
        `backend/config/outdoor-regions/${suffix}.geojson`
      ),
      freshnessThresholdDays: value.freshnessThresholdDays
    });
  }

  const matrixBindings = matrix.flags?.map((flag) => [flag.id, flag.key]);
  if (JSON.stringify(matrixBindings) !== JSON.stringify(CANONICAL_FLAG_BINDINGS)) {
    throw policyError("policy_feature_flag_matrix_mismatch");
  }
  const stagingPhase = matrix.states?.find((phase) =>
    phase.id === "staging_infrastructure_verification"
  );
  if (!stagingPhase || CANONICAL_FLAG_BINDINGS.some(([id]) =>
    stagingPhase.flags?.[id] !== false
  ) || stagingPhase.hardProviderCallCeiling !== 0) {
    throw policyError("policy_staging_phase_not_provider_off");
  }

  const migrations = CANONICAL_MIGRATIONS.map((file, index) => ({
    ordinal: index + 1,
    file,
    sourceSha256: sourceDigest(sources, `backend/migrations/${file}`)
  }));
  const featureFlags = CANONICAL_FLAG_BINDINGS.map(([id, key]) => ({ id, key }));
  const semanticPolicy = {
    version: STAGING_READINESS_POLICY_VERSION,
    sources,
    migrations,
    regionConfigs,
    featureFlags,
    canonicalCases: CANONICAL_CASES,
    canonicalGates: CANONICAL_GATE_DEFINITIONS,
    canonicalRoles: CANONICAL_ROLE_IDS,
    canonicalRoleContracts: CANONICAL_ROLE_CONTRACTS,
    canonicalRoleSeparationGuards: CANONICAL_ROLE_SEPARATION_GUARD_IDS,
    canonicalPerformanceOperations: CANONICAL_PERFORMANCE_OPERATIONS,
    canonicalRestoreReconciliations: CANONICAL_RESTORE_RECONCILIATIONS,
    canonicalAlerts: CANONICAL_ALERT_IDS,
    canonicalOutages: CANONICAL_OUTAGE_IDS,
    thresholds: REVIEWED_THRESHOLDS
  };
  const policy = {
    ...semanticPolicy,
    sourceManifestSha256: sha256StagingReadinessV1(sources),
    policySha256: sha256StagingReadinessV1(semanticPolicy)
  };
  return deepFreezeStagingReadinessV1(policy);
}

export function stagingReadinessPolicyReceiptBindingV1(policy) {
  return {
    version: policy.version,
    policySha256: policy.policySha256,
    sourceManifestSha256: policy.sourceManifestSha256,
    sources: policy.sources.map((source) => ({ ...source }))
  };
}

async function readBoundedPolicySource(readFileImpl, path) {
  let bytes;
  try {
    bytes = await readFileImpl(new URL(`../../../${path}`, import.meta.url));
  } catch {
    throw policyError("policy_source_unavailable");
  }
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length === 0 || bytes.length > MAXIMUM_POLICY_SOURCE_BYTES) {
    throw policyError("policy_source_size_invalid");
  }
  return bytes;
}

async function readJsonSource(readFileImpl, path) {
  const bytes = await readBoundedPolicySource(readFileImpl, path);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw policyError("policy_json_invalid");
  }
}

function sourceDigest(sources, path) {
  const source = sources.find((candidate) => candidate.path === path);
  if (!source) throw policyError("policy_source_missing");
  return source.sha256;
}

function policyError(code) {
  const error = new Error(code);
  error.name = "StagingReadinessPolicyError";
  error.code = code;
  return error;
}
