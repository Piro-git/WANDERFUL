import {
  lstatSync,
  realpathSync
} from "node:fs";
import {
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import {
  createControlledOutdoorAdventureStagingProofEvaluatorV1,
  createOutdoorAdventureStagingProofLaneDispatcherV1,
  createLiveOutdoorAdventureStagingProofEvaluatorV1
} from "../evaluation/outdoorAdventureStagingProof/evaluator.js";
import {
  createOutdoorAdventureStagingProofCaseDriverV1,
  inspectOutdoorAdventureStagingProofLiveDriverV1
} from "../evaluation/outdoorAdventureStagingProof/operationalCaseDriver.js";
import {
  isCanonicalOutdoorAdventureStagingProofSummaryV1,
  outdoorAdventureStagingProofExitCodeV1,
  outdoorAdventureStagingProofReadinessBlockersV1,
  runOutdoorAdventureStagingProofV1
} from "../evaluation/outdoorAdventureStagingProof/harness.js";
import {
  stableSerializeOutdoorAdventureStagingProofV1
} from "../evaluation/outdoorAdventureStagingProof/manifest.js";

const BACKEND_ROOT = fileURLToPath(new URL("../", import.meta.url));
const APPROVED_DRIVER_PATH = fileURLToPath(new URL(
  "../evaluation/outdoorAdventureStagingProof/operationalCaseDriver.js",
  import.meta.url
));
const APPROVED_DRIVER_REALPATH = realpathSync(APPROVED_DRIVER_PATH);
const DEFAULT_MANIFEST_PATH = fileURLToPath(new URL(
  "../evaluation/outdoorAdventureStagingProof/fixtures/mandatoryCasesV1.json",
  import.meta.url
));
const DEFAULT_OUTPUT_PATH =
  "/tmp/trailmind-outdoor-adventure-staging-proof-v1.summary.json";
const RUNNER_PATH = fileURLToPath(import.meta.url);

if (
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === RUNNER_PATH
) {
  await main();
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    await invalidateCanonicalSummary(options.outputPath);
  } catch {
    process.stderr.write("Outdoor adventure staging proof failed.\n");
    process.exitCode = 1;
    return;
  }

  const acknowledged = options.executeLive &&
    options.boundedLiveGraphHopperAuthorized &&
    options.credentialContainmentConfirmed &&
    options.disposableDatabaseConfirmed;
  const databaseUrl = acknowledged
    ? boundedSecret(process.env.TRAILMIND_STAGING_PROOF_DATABASE_URL, 8_192)
    : "";
  const graphHopperKey = acknowledged
    ? boundedSecret(process.env.GRAPHHOPPER_API_KEY, 2_048)
    : "";
  const driverPath = acknowledged && options.driverModule
    ? safeDriverPath(options.driverModule)
    : null;
  const liveDriver =
    acknowledged &&
    validPostgresConfiguration(databaseUrl) &&
    graphHopperKey.length > 0 &&
    driverPath !== null
      ? await loadApprovedLiveDriver(driverPath)
      : null;
  const readiness = {
    executeLive: options.executeLive,
    boundedLiveGraphHopperAuthorized:
      options.boundedLiveGraphHopperAuthorized,
    credentialContainmentConfirmed:
      options.credentialContainmentConfirmed,
    disposableDatabaseConfirmed:
      options.disposableDatabaseConfirmed,
    databaseConfigured: validPostgresConfiguration(databaseUrl),
    graphHopperConfigured: graphHopperKey.length > 0,
    operationalCaseDriverConfigured: liveDriver !== null,
    causalPipelineCaptureConfigured:
      liveDriver?.causalPipelineCaptureConfigured === true,
    appAttestReceiptIntegrationConfigured:
      liveDriver?.appAttestReceiptIntegrationConfigured === true,
    iosRuntimeReceiptIntegrationConfigured:
      liveDriver?.iosRuntimeReceiptIntegrationConfigured === true
  };
  let blockers = outdoorAdventureStagingProofReadinessBlockersV1(readiness);
  let pool = null;
  let postgresCancellationControlPool = null;
  let summary = null;
  let summaryContents = null;
  let executionFailed = false;
  try {
    let evaluateCase;
    if (blockers.length === 0) {
      pool = new Pool({
        connectionString: databaseUrl,
        max: 2,
        connectionTimeoutMillis: 2_000,
        allowExitOnIdle: true,
        application_name: "trailmind_staging_proof_v1"
      });
      postgresCancellationControlPool = new Pool({
        connectionString: databaseUrl,
        max: 1,
        connectionTimeoutMillis: 2_000,
        allowExitOnIdle: true,
        application_name:
          "trailmind_staging_proof_control_v1"
      });
      const evaluateLiveCase =
        createLiveOutdoorAdventureStagingProofEvaluatorV1({
          pool,
          postgresCancellationControlPool,
          env: process.env,
          runCase: liveDriver.runLiveCase
        });
      const evaluateControlledCase =
        createControlledOutdoorAdventureStagingProofEvaluatorV1({
          runCase: liveDriver.runControlledCase,
          requireIOSRuntimeReceipt: true
        });
      evaluateCase = createOutdoorAdventureStagingProofLaneDispatcherV1({
        evaluateLiveCase,
        evaluateControlledCase
      });
    }
    summary = await runOutdoorAdventureStagingProofV1({
      manifestPath: options.manifestPath,
      outputPath: options.outputPath,
      evaluateCase,
      blockers,
      caseTimeoutMilliseconds: options.caseTimeoutMilliseconds,
      async writeSummary(outputPath, contents) {
        if (
          outputPath !== options.outputPath ||
          summaryContents !== null ||
          typeof contents !== "string" ||
          contents.length === 0
        ) {
          throw new TypeError("Invalid pending staging proof summary.");
        }
        summaryContents = contents;
      }
    });
  } catch {
    executionFailed = true;
  }

  const outcome =
    await finalizeOutdoorAdventureStagingProofRunV1({
      summary: executionFailed ? null : summary,
      summaryContents: executionFailed ? null : summaryContents,
      outputPath: options.outputPath,
      cleanupOperations: [
        liveDriver ? () => liveDriver.close() : null,
        postgresCancellationControlPool
          ? () => postgresCancellationControlPool.end()
          : null,
        pool ? () => pool.end() : null
      ],
      writeStdout: (contents) => process.stdout.write(contents)
    });
  if (outcome.infrastructureFailure) {
    process.stderr.write("Outdoor adventure staging proof failed.\n");
  }
  process.exitCode = outcome.exitCode;
  if (outcome.requiresForcedExit) process.exit(outcome.exitCode);
}

export async function finalizeOutdoorAdventureStagingProofRunV1({
  summary,
  summaryContents,
  outputPath,
  cleanupOperations,
  writeStdout = (contents) => process.stdout.write(contents),
  writeCanonicalSummary = atomicWriteCanonicalSummary,
  invalidateSummary = invalidateCanonicalSummary,
  cleanupTimeoutMilliseconds = 5_000
}) {
  const cleanupTimeoutIsValid =
    Number.isInteger(cleanupTimeoutMilliseconds) &&
    cleanupTimeoutMilliseconds >= 1 &&
    cleanupTimeoutMilliseconds <= 30_000;
  const effectiveCleanupTimeoutMilliseconds = cleanupTimeoutIsValid
    ? cleanupTimeoutMilliseconds
    : 5_000;
  let cleanupFailed = !cleanupTimeoutIsValid;
  let cleanupTimedOut = false;
  for (const operation of cleanupOperations ?? []) {
    if (operation === null) continue;
    if (typeof operation !== "function") {
      cleanupFailed = true;
      continue;
    }
    const cleanupResult = await cleanupWithinDeadline(
      operation,
      effectiveCleanupTimeoutMilliseconds
    );
    if (cleanupResult !== "completed") {
      cleanupFailed = true;
      cleanupTimedOut ||= cleanupResult === "timed_out";
    }
  }

  const summaryPairIsCoherent = coherentSummaryPair(
    summary,
    summaryContents
  );

  if (
    cleanupFailed ||
    !summaryPairIsCoherent
  ) {
    try {
      await invalidateSummary(outputPath);
    } catch {}
    return Object.freeze({
      exitCode: 1,
      published: false,
      infrastructureFailure: true,
      requiresForcedExit: cleanupTimedOut
    });
  }

  try {
    await writeCanonicalSummary(outputPath, summaryContents);
  } catch {
    try {
      await invalidateSummary(outputPath);
    } catch {}
    return Object.freeze({
      exitCode: 1,
      published: false,
      infrastructureFailure: true,
      requiresForcedExit: false
    });
  }

  writeStdout(`${JSON.stringify({
    status: summary.status,
    configuredCases: summary.metrics.configuredCases,
    executedCases: summary.metrics.executedCases,
    passedCases: summary.metrics.passedCases,
    failedCases: summary.metrics.failedCases,
    skippedCases: summary.metrics.skippedCases
  })}\n`);
  return Object.freeze({
    exitCode: outdoorAdventureStagingProofExitCodeV1(summary),
    published: true,
    infrastructureFailure: false,
    requiresForcedExit: false
  });
}

function coherentSummaryPair(summary, summaryContents) {
  if (
    summary === null ||
    typeof summary !== "object" ||
    typeof summaryContents !== "string" ||
    summaryContents.length === 0
  ) {
    return false;
  }
  try {
    const expectedContents =
      `${stableSerializeOutdoorAdventureStagingProofV1(summary)}\n`;
    return summaryContents === expectedContents &&
      isCanonicalOutdoorAdventureStagingProofSummaryV1(summary) &&
      (
        summary.status !== "passed" ||
        outdoorAdventureStagingProofExitCodeV1(summary) === 0
      );
  } catch {
    return false;
  }
}

async function cleanupWithinDeadline(operation, timeoutMilliseconds) {
  if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds < 1) {
    return "failed";
  }
  let timer;
  const timeoutMarker = Symbol("cleanup_timeout");
  try {
    const result = await Promise.race([
      Promise.resolve().then(operation),
      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve(timeoutMarker),
          timeoutMilliseconds
        );
      })
    ]);
    return result === timeoutMarker ? "timed_out" : "completed";
  } catch {
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}

async function atomicWriteCanonicalSummary(outputPath, contents) {
  const temporaryPath =
    `${outputPath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryPath, contents, {
      encoding: "utf8",
      flag: "wx"
    });
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function invalidateCanonicalSummary(outputPath) {
  await rm(outputPath, { force: true });
}

async function loadApprovedLiveDriver(driverPath) {
  if (driverPath !== APPROVED_DRIVER_REALPATH) return null;
  try {
    const descriptor =
      await createOutdoorAdventureStagingProofCaseDriverV1();
    return inspectOutdoorAdventureStagingProofLiveDriverV1(
      descriptor
    );
  } catch {
    return null;
  }
}

function parseArguments(args) {
  const options = {
    executeLive: false,
    boundedLiveGraphHopperAuthorized: false,
    credentialContainmentConfirmed: false,
    disposableDatabaseConfirmed: false,
    driverModule: null,
    manifestPath: DEFAULT_MANIFEST_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    caseTimeoutMilliseconds: 45_000
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--execute-live") {
      options.executeLive = true;
    } else if (value === "--ack-bounded-live-graphhopper") {
      options.boundedLiveGraphHopperAuthorized = true;
    } else if (value === "--ack-credential-containment") {
      options.credentialContainmentConfirmed = true;
    } else if (value === "--confirm-disposable-database") {
      options.disposableDatabaseConfirmed = true;
    } else if (value === "--driver-module") {
      options.driverModule = requiredValue(args, ++index);
    } else if (value === "--manifest") {
      options.manifestPath = requiredValue(args, ++index);
    } else if (value === "--output") {
      options.outputPath = requiredValue(args, ++index);
    } else if (value === "--case-timeout-ms") {
      const parsed = Number(requiredValue(args, ++index));
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 120_000) {
        throw new TypeError("timeout");
      }
      options.caseTimeoutMilliseconds = parsed;
    } else {
      throw new TypeError("argument");
    }
  }
  return options;
}

function requiredValue(args, index) {
  const value = args[index];
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("argument");
  }
  return value;
}

function safeDriverPath(input) {
  const path = resolve(BACKEND_ROOT, input);
  if (path !== APPROVED_DRIVER_PATH) return null;
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    const canonicalPath = realpathSync(path);
    return canonicalPath === APPROVED_DRIVER_REALPATH
      ? canonicalPath
      : null;
  } catch {
    return null;
  }
}

function boundedSecret(value, maximumLength) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length <= maximumLength ? trimmed : "";
}

function validPostgresConfiguration(value) {
  return value.startsWith("postgres://") ||
    value.startsWith("postgresql://");
}
