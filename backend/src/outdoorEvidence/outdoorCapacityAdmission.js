import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SUPPORTED_PROFILE_ID = "supabase-free-bounded-two-core-v1";
const CONTRACT_RELATIVE_PATH =
  "config/outdoor-capacity-profiles/supabase-free-bounded-two-core-v1/" +
  "capacity-contract-v1.json";
const CONTRACT_SHA256 =
  "98deebe62e49b3a23c4cb30da5d1594b55852e0889342d63c9fe8fbf6af8c3c5";
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const REGION_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CAPACITY_LOCK_KEY =
  "trailmind-capacity-profile:supabase-free-bounded-two-core-v1";
const CAPACITY_CONTEXT_SETTING = "trailmind.capacity_admission_v1";
const OPERATIONS = new Set(["import", "project", "retire"]);

export class OutdoorCapacityAdmissionError extends Error {
  constructor(decision, publicResult, options = {}) {
    super(`outdoor_capacity_${String(decision).toLowerCase()}`, options);
    this.name = "OutdoorCapacityAdmissionError";
    this.decision = decision;
    this.publicResult = Object.freeze({ ...publicResult });
  }
}

export async function loadOutdoorCapacityContract(profileId) {
  if (profileId !== SUPPORTED_PROFILE_ID) {
    throw capacityError("PROFILE_INVALID", {
      profileId: normalizedPublicProfile(profileId)
    });
  }
  const contractPath = resolve(BACKEND_ROOT, CONTRACT_RELATIVE_PATH);
  const contractBytes = await readFile(contractPath);
  if (sha256(contractBytes) !== CONTRACT_SHA256) {
    throw capacityError("PROFILE_INVALID", { profileId });
  }

  let contract;
  try {
    contract = JSON.parse(contractBytes.toString("utf8"));
  } catch (cause) {
    throw capacityError("PROFILE_INVALID", { profileId }, { cause });
  }
  validateContractShape(contract, profileId);
  await assertBoundFiles(contract);
  const calculatedIdentity = sha256(JSON.stringify(contract.identityFiles));
  if (calculatedIdentity !== contract.profileIdentitySha256) {
    throw capacityError("PROFILE_INVALID", { profileId });
  }
  return deepFreeze(contract);
}

export async function acquireOutdoorCapacityAdmission({
  pool,
  profileId,
  regionId,
  operation,
  importId,
  willRetainGeneration = true
}) {
  if (!pool?.connect || typeof pool.connect !== "function") {
    throw capacityError("DATABASE_IDENTITY_MISMATCH", {
      profileId: normalizedPublicProfile(profileId),
      regionId: normalizedPublicRegion(regionId),
      operation: normalizedPublicOperation(operation)
    });
  }
  validateAdmissionRequest({
    profileId, regionId, operation, importId, willRetainGeneration
  });
  const contract = await loadOutdoorCapacityContract(profileId);
  if (!Object.hasOwn(contract.coverageContract, regionId)) {
    throw capacityError("PROFILE_INVALID", {
      profileId, regionId, operation
    });
  }

  const client = await pool.connect();
  let lockAcquired = false;
  let ownerRoleAssumed = false;
  let contextInstalled = false;
  let released = false;
  try {
    if (operation === "retire") {
      await client.query("SET ROLE trailmind_app_owner");
      ownerRoleAssumed = true;
    }
    const lock = await client.query(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
      [CAPACITY_LOCK_KEY]
    );
    lockAcquired = lock.rowCount === 1 && lock.rows[0]?.acquired === true;
    if (!lockAcquired) {
      throw capacityError("CONCURRENT_OPERATION", {
        profileId, regionId, operation
      });
    }

    const result = await client.query(
      `SELECT trailmind_app.outdoor_capacity_activate_admission_v1(
         $1::text, $2::text, $3::uuid, $4::text, $5::boolean
       ) AS admission`,
      [
        profileId, regionId, importId ?? null, operation,
        willRetainGeneration
      ]
    );
    const activation = result.rows[0]?.admission;
    if (result.rowCount !== 1 || !activation ||
        activation.schemaVersion !== 1 ||
        typeof activation.decision !== "string" || !activation.snapshot) {
      throw capacityError("DATABASE_IDENTITY_MISMATCH", {
        profileId, regionId, operation
      });
    }
    contextInstalled = activation.decision === "ADMITTED";
    const summary = evaluateOutdoorCapacityAdmission({
      contract,
      snapshot: activation.snapshot,
      operation,
      willRetainGeneration
    });
    if (activation.decision !== summary.decision) {
      throw capacityError("DATABASE_IDENTITY_MISMATCH", {
        profileId, regionId, operation
      });
    }

    return Object.freeze({
      client,
      contract,
      summary,
      async release() {
        if (released) return;
        released = true;
        let releaseError;
        try {
          if (contextInstalled) {
            const cleared = await client.query(
              `SELECT trailmind_app.outdoor_capacity_release_admission_v1()
                 AS released`
            );
            if (cleared.rowCount !== 1 ||
                cleared.rows[0]?.released !== true) {
              throw new Error("outdoor_capacity_release_failed");
            }
            contextInstalled = false;
          }
        } catch (error) {
          releaseError = error;
        }
        try {
          if (lockAcquired) {
            const unlocked = await client.query(
              "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
              [CAPACITY_LOCK_KEY]
            );
            if (unlocked.rowCount !== 1 || unlocked.rows[0]?.unlocked !== true) {
              throw new Error("outdoor_capacity_unlock_failed");
            }
          }
        } catch (error) {
          releaseError ??= error;
        } finally {
          try {
            if (ownerRoleAssumed) await client.query("RESET ROLE");
          } catch (error) {
            releaseError ??= error;
          } finally {
            client.release(releaseError);
          }
        }
        if (releaseError) throw releaseError;
      }
    });
  } catch (error) {
    let cleanupFailed = false;
    try {
      if (contextInstalled) {
        const cleared = await client.query(
          `SELECT trailmind_app.outdoor_capacity_release_admission_v1()
             AS released`
        );
        if (cleared.rowCount !== 1 || cleared.rows[0]?.released !== true) {
          cleanupFailed = true;
        }
      }
    } catch { cleanupFailed = true; }
    try {
      if (lockAcquired) {
        const unlocked = await client.query(
          `SELECT pg_advisory_unlock(hashtextextended($1, 0))
             AS unlocked`,
          [CAPACITY_LOCK_KEY]
        );
        if (unlocked.rowCount !== 1 ||
            unlocked.rows[0]?.unlocked !== true) {
          cleanupFailed = true;
        }
      }
    } catch { cleanupFailed = true; }
    try {
      if (ownerRoleAssumed) await client.query("RESET ROLE");
    } catch { cleanupFailed = true; }
    client.release(cleanupFailed ?
      new Error("outdoor_capacity_cleanup_failed") : undefined);
    if (error instanceof OutdoorCapacityAdmissionError) throw error;
    throw capacityError("DATABASE_IDENTITY_MISMATCH", {
      profileId, regionId, operation
    }, { cause: error });
  }
}

export function evaluateOutdoorCapacityAdmission({
  contract,
  snapshot,
  operation,
  willRetainGeneration = true
}) {
  const base = publicBase(contract, snapshot, operation);
  if (!contract || !snapshot || snapshot.schemaVersion !== 1 ||
      snapshot.profileId !== contract.profileId ||
      snapshot.profileIdentitySha256 !== contract.profileIdentitySha256 ||
      !sameArray(snapshot.migrations, contract.migrationPolicy.orderedVersions) ||
      snapshot.regionId !== base.regionId ||
      numeric(snapshot.hardLimitBytes) !== contract.officialLimit.hardLimitBytes ||
      numeric(snapshot.safetyReserveBytes) !== contract.safetyReserveBytes) {
    throw capacityError("DATABASE_IDENTITY_MISMATCH", base);
  }

  const currentDatabaseBytes = numeric(snapshot.currentDatabaseBytes);
  const retainedImports = numeric(snapshot.retainedImports);
  const retainedProjections = numeric(snapshot.retainedProjections);
  const inFlightImports = numeric(snapshot.inFlightImports);
  const inFlightProjections = numeric(snapshot.inFlightProjections);
  const selectedImportProjections = numeric(snapshot.selectedImportProjections);
  const quarantines = numeric(snapshot.quarantines);
  if ([
    currentDatabaseBytes, retainedImports, retainedProjections,
    inFlightImports, inFlightProjections, selectedImportProjections, quarantines
  ].some((value) => value === null)) {
    throw capacityError("DATABASE_MEASUREMENT_INVALID", base);
  }

  const measurements = Object.freeze({
    currentDatabaseBytes,
    transientGrowthBytes: contract.operationTransientGrowthBytes[operation],
    safetyReserveBytes: contract.safetyReserveBytes,
    estimatedTransientPeakBytes:
      currentDatabaseBytes + contract.operationTransientGrowthBytes[operation],
    hardLimitBytes: contract.officialLimit.hardLimitBytes
  });
  const generations = Object.freeze({
    retainedImports,
    retainedProjections,
    maximumRetainedPerRegion: contract.maximumRetainedGenerationsPerRegion
  });
  const decisionBase = { ...base, measurements, generations };

  if (inFlightImports !== 0 || inFlightProjections !== 0) {
    throw capacityError("IN_FLIGHT_OPERATION", decisionBase);
  }
  if (quarantines !== 0) {
    throw capacityError("QUARANTINE_PRESENT", decisionBase);
  }
  if (retainedImports > contract.maximumRetainedGenerationsPerRegion ||
      retainedProjections > contract.maximumRetainedGenerationsPerRegion) {
    throw capacityError("GENERATION_LIMIT", decisionBase);
  }

  if (operation === "import" &&
      retainedImports >= contract.maximumRetainedGenerationsPerRegion) {
    throw capacityError("GENERATION_LIMIT", decisionBase);
  }
  if (operation === "project" && willRetainGeneration &&
      retainedProjections >= contract.maximumRetainedGenerationsPerRegion) {
    throw capacityError("GENERATION_LIMIT", decisionBase);
  }
  if (operation === "retire" &&
      (retainedImports !== contract.maximumRetainedGenerationsPerRegion ||
       retainedProjections !== contract.maximumRetainedGenerationsPerRegion)) {
    throw capacityError("GENERATION_STATE_INVALID", decisionBase);
  }

  if (operation !== "retire" &&
      measurements.estimatedTransientPeakBytes +
        measurements.safetyReserveBytes > measurements.hardLimitBytes) {
    throw capacityError("PLATFORM_LIMIT", decisionBase);
  }

  return deepFreeze({
    schemaVersion: 1,
    status: "admitted",
    decision: "ADMITTED",
    ...decisionBase
  });
}

export function redactedOutdoorCapacityFailure(error) {
  if (error instanceof OutdoorCapacityAdmissionError) {
    return error.publicResult;
  }
  return Object.freeze({
    schemaVersion: 1,
    status: "refused",
    decision: "DATABASE_IDENTITY_MISMATCH"
  });
}

function validateAdmissionRequest({
  profileId, regionId, operation, importId, willRetainGeneration
}) {
  if (profileId !== SUPPORTED_PROFILE_ID ||
      typeof regionId !== "string" || !REGION_PATTERN.test(regionId) ||
      !OPERATIONS.has(operation) ||
      (importId !== undefined && importId !== null &&
       !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
         .test(importId)) ||
      typeof willRetainGeneration !== "boolean") {
    throw capacityError("PROFILE_INVALID", {
      profileId: normalizedPublicProfile(profileId),
      regionId: normalizedPublicRegion(regionId),
      operation: normalizedPublicOperation(operation)
    });
  }
}

function validateContractShape(contract, profileId) {
  const exactTopLevel = [
    "admissionFormula", "contractId", "coverageContract", "deploymentClass",
    "identityFiles", "maximumRetainedGenerationsPerRegion",
    "measuredManagedEquivalentBytes", "migrationPolicy", "officialLimit",
    "operationTransientGrowthBytes", "operationalFiles", "profileId",
    "profileIdentitySha256", "safetyReserveBytes", "schemaVersion",
    "settledOperatingLimitBytes"
  ];
  if (!contract || typeof contract !== "object" || Array.isArray(contract) ||
      JSON.stringify(Object.keys(contract).sort()) !==
        JSON.stringify(exactTopLevel.sort()) ||
      contract.schemaVersion !== 1 || contract.profileId !== profileId ||
      contract.contractId !== "supabase-free-bounded-two-core-capacity-v1" ||
      contract.deploymentClass !== "staging-only-capacity-profile" ||
      !DIGEST_PATTERN.test(contract.profileIdentitySha256 ?? "") ||
      contract.officialLimit?.source !==
        "https://supabase.com/docs/guides/platform/database-size" ||
      contract.officialLimit?.hardLimitBytes !== 500_000_000 ||
      contract.safetyReserveBytes !== 40_000_000 ||
      contract.maximumRetainedGenerationsPerRegion !== 2 ||
      contract.settledOperatingLimitBytes !== 400_000_000 ||
      contract.operationTransientGrowthBytes?.import !== 43_794_432 ||
      contract.operationTransientGrowthBytes?.project !== 213_712_896 ||
      contract.operationTransientGrowthBytes?.retire !== 0 ||
      !Array.isArray(contract.identityFiles) || contract.identityFiles.length !== 15 ||
      !Array.isArray(contract.operationalFiles) ||
      contract.operationalFiles.length !== 1 ||
      !Array.isArray(contract.migrationPolicy?.orderedVersions) ||
      contract.migrationPolicy.orderedVersions.length !== 9) {
    throw capacityError("PROFILE_INVALID", { profileId });
  }
  const migrationFiles = contract.identityFiles
    .filter((file) => file.path.startsWith("migrations/"))
    .map((file) => file.path.slice("migrations/".length));
  if (!sameArray(migrationFiles, contract.migrationPolicy.orderedVersions)) {
    throw capacityError("PROFILE_INVALID", { profileId });
  }
}

async function assertBoundFiles(contract) {
  const root = await realpath(BACKEND_ROOT);
  const files = [...contract.identityFiles, ...contract.operationalFiles];
  for (const file of files) {
    if (!file || typeof file.path !== "string" ||
        !DIGEST_PATTERN.test(file.sha256 ?? "") ||
        file.path.startsWith("/") || file.path.includes("..")) {
      throw capacityError("PROFILE_INVALID", { profileId: contract.profileId });
    }
    const candidate = resolve(BACKEND_ROOT, file.path);
    const resolved = await realpath(candidate).catch(() => null);
    if (!resolved || (resolved !== root && !resolved.startsWith(`${root}${sep}`))) {
      throw capacityError("PROFILE_INVALID", { profileId: contract.profileId });
    }
    const bytes = await readFile(resolved);
    if (sha256(bytes) !== file.sha256) {
      throw capacityError("PROFILE_INVALID", { profileId: contract.profileId });
    }
  }
}

function publicBase(contract, snapshot, operation) {
  return Object.freeze({
    profileId: contract?.profileId ?? normalizedPublicProfile(snapshot?.profileId),
    regionId: normalizedPublicRegion(snapshot?.regionId),
    operation: normalizedPublicOperation(operation),
    coverage: contract?.coverageContract?.[snapshot?.regionId] ?? "bounded core only"
  });
}

function capacityError(decision, details = {}, options = {}) {
  return new OutdoorCapacityAdmissionError(decision, deepFreeze({
    schemaVersion: 1,
    status: "refused",
    decision,
    ...details
  }), options);
}

function normalizedPublicProfile(value) {
  return value === SUPPORTED_PROFILE_ID ? value : "unsupported";
}

function normalizedPublicRegion(value) {
  return typeof value === "string" && REGION_PATTERN.test(value)
    ? value
    : "unsupported";
}

function normalizedPublicOperation(value) {
  return OPERATIONS.has(value) ? value : "unsupported";
}

function numeric(value) {
  const parsed = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const outdoorCapacityAdmissionConstantsForTesting = Object.freeze({
  contractRelativePath: CONTRACT_RELATIVE_PATH,
  contractSha256: CONTRACT_SHA256,
  contextSetting: CAPACITY_CONTEXT_SETTING,
  lockKey: CAPACITY_LOCK_KEY,
  supportedProfileId: SUPPORTED_PROFILE_ID
});
