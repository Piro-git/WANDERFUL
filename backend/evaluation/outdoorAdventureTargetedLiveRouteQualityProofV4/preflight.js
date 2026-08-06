import { execFile } from "node:child_process";
import { statfs } from "node:fs/promises";
import { promisify } from "node:util";
import {
  createOutdoorAdventurePlanningEndpoint
} from "../../src/outdoorAdventure/outdoorAdventureEndpoint.js";
import {
  V4_FLAG_NAMES,
  V4ProofContractError
} from "./contract.js";

const execFileAsync = promisify(execFile);

export const V4_REQUIRED_SETTLED_FREE_GIB = 10;
export const V4_STORAGE_SAMPLE_COUNT = 2;
export const V4_STORAGE_SETTLE_MILLISECONDS = 2_000;

const PROCESS_CHECKS = Object.freeze([
  { name: "osm_import", arguments: ["-x", "osm2pgsql"] },
  { name: "postgres", arguments: ["-x", "postgres"] },
  { name: "xcode_build", arguments: ["-x", "xcodebuild"] },
  {
    name: "provider_proof",
    arguments: ["-f", "run-outdoor-adventure.*proof"]
  },
  { name: "node_test", arguments: ["-f", "node --test"] }
]);

export function disabledV4FlagSnapshot(env = process.env) {
  const flags = {};
  for (const name of V4_FLAG_NAMES) {
    const value = env[name];
    if (value !== undefined && value !== "false") {
      throw new V4ProofContractError("v4_flag_not_exact_false");
    }
    flags[name] = false;
  }
  return Object.freeze({
    exactAdmissionVerified: true,
    flags: Object.freeze(flags)
  });
}

export async function sampleSettledFreeStorageV4({
  path,
  sampleCount = V4_STORAGE_SAMPLE_COUNT,
  settleMilliseconds = V4_STORAGE_SETTLE_MILLISECONDS,
  statfsImpl = statfs,
  sleep = (milliseconds) => new Promise((resolve) =>
    setTimeout(resolve, milliseconds)
  )
}) {
  if (
    typeof path !== "string" || path.length < 1 ||
    !Number.isInteger(sampleCount) || sampleCount < 2 || sampleCount > 5 ||
    !Number.isInteger(settleMilliseconds) || settleMilliseconds < 0 ||
    settleMilliseconds > 10_000 || typeof statfsImpl !== "function" ||
    typeof sleep !== "function"
  ) {
    throw new V4ProofContractError("invalid_storage_preflight");
  }
  const samples = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const result = await statfsImpl(path, { bigint: true });
    const freeBytes = result.bavail * result.bsize;
    if (freeBytes < 0n) {
      throw new V4ProofContractError("invalid_storage_preflight");
    }
    samples.push(Number(freeBytes) / 1024 ** 3);
    if (index + 1 < sampleCount) await sleep(settleMilliseconds);
  }
  const settledFreeGiB = Math.min(...samples);
  return Object.freeze({
    sampleCount,
    settledFreeGiB: round(settledFreeGiB, 3),
    requiredFreeGiB: V4_REQUIRED_SETTLED_FREE_GIB,
    passed: settledFreeGiB >= V4_REQUIRED_SETTLED_FREE_GIB
  });
}

export async function scanConflictingProcessesV4({
  execFileImpl = execFileAsync,
  ignoredProcessIds = [process.pid, process.ppid]
} = {}) {
  if (typeof execFileImpl !== "function" ||
      !Array.isArray(ignoredProcessIds) ||
      ignoredProcessIds.some((value) =>
        !Number.isInteger(value) || value < 1
      )) {
    throw new V4ProofContractError("invalid_process_preflight");
  }
  const ignored = new Set(ignoredProcessIds);
  const conflicts = [];
  for (const check of PROCESS_CHECKS) {
    let stdout;
    try {
      ({ stdout } = await execFileImpl("pgrep", check.arguments, {
        encoding: "utf8",
        timeout: 2_000,
        maxBuffer: 8_192
      }));
    } catch (error) {
      if (error?.code === 1) continue;
      throw new V4ProofContractError("process_preflight_unavailable");
    }
    const otherProcessIds = stdout.split(/\s+/).filter(Boolean)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && !ignored.has(value));
    if (otherProcessIds.length > 0) conflicts.push(check.name);
  }
  return Object.freeze({
    checkedClassCount: PROCESS_CHECKS.length,
    conflictClassCount: conflicts.length,
    conflictClasses: Object.freeze([...new Set(conflicts)].sort()),
    passed: conflicts.length === 0
  });
}

export async function runDisabledZeroWorkEndpointProbeV4() {
  const counts = {
    authorizationOperations: 0,
    databaseOperations: 0,
    providerOperations: 0,
    budgetOperations: 0,
    leaseOperations: 0,
    orchestratorOperations: 0
  };
  const endpoint = createOutdoorAdventurePlanningEndpoint({
    env: Object.fromEntries(V4_FLAG_NAMES.map((name) => [name, "false"])),
    authorizer: {
      async authorize() {
        counts.authorizationOperations += 1;
        return {
          limitsConsumed: false,
          rateLimitKey: "disabled",
          async release() { counts.leaseOperations += 1; }
        };
      }
    },
    rateLimiter: {
      async consume() {
        counts.budgetOperations += 1;
        return { allowed: true };
      }
    },
    repository: {
      async withConsistentSnapshot() { counts.databaseOperations += 1; }
    },
    provider: {
      async route() { counts.providerOperations += 1; }
    },
    orchestratorV2: async () => { counts.orchestratorOperations += 1; }
  });
  const result = await endpoint({ schemaVersion: 2 });
  const zeroWork = Object.values(counts).every((value) => value === 0);
  if (
    result?.statusCode !== 503 ||
    result?.payload?.error?.code !== "feature_unavailable" ||
    !zeroWork
  ) {
    throw new V4ProofContractError("disabled_zero_work_probe_failed");
  }
  return Object.freeze({
    passed: true,
    ...counts
  });
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
