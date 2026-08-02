import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  reconcileServerLiveProofSummaryV1,
  writeStableJsonAtomicV1
} from "../evaluation/outdoorAdventureServerLiveProof/reconciliation.js";
import { safeProofDigestV1, stableSerialize } from
  "../evaluation/outdoorAdventureServerLiveProof/manifest.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  await main();
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    await requireExistingDirectory(options.cleanupRoot);
    const [summary, ledger, diagnosticSummary] = await Promise.all([
      readJson(options.summaryPath),
      readJson(options.ledgerPath),
      readJson(options.diagnosticPath)
    ]);
    const reconciled = reconcileServerLiveProofSummaryV1({
      summary,
      ledger,
      diagnosticSummary,
      cleanupArtifactDigest: safeProofDigestV1(
        options.cleanupRoot,
        "cleanup"
      )
    });
    await writeStableJsonAtomicV1(options.summaryPath, reconciled);
    process.stdout.write(`${stableSerialize({
      proofClassification: reconciled.proofClassification,
      status: reconciled.status,
      exactProviderCalls: reconciled.providerCalls.exactAttempted,
      cleanupStatus: reconciled.disposableArtifacts.status
    })}\n`);
  } catch (error) {
    process.stdout.write(`${stableSerialize({
      proofClassification: "server_side_live_pipeline_proof",
      status: "reconciliation_failed",
      errorCode: safeErrorCode(error)
    })}\n`);
    process.exitCode = 1;
  }
}

function parseArguments(args) {
  const options = {
    summaryPath: null,
    ledgerPath: null,
    diagnosticPath: null,
    cleanupRoot: null
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === "--summary" && value) {
      options.summaryPath = resolve(value);
    } else if (argument === "--usage-ledger" && value) {
      options.ledgerPath = resolve(value);
    } else if (argument === "--diagnostic" && value) {
      options.diagnosticPath = resolve(value);
    } else if (argument === "--cleanup-root" && value) {
      options.cleanupRoot = validateCleanupRoot(value);
    } else {
      throw proofError("invalid_arguments");
    }
    index += 1;
  }
  if (Object.values(options).some((value) => value === null)) {
    throw proofError("invalid_arguments");
  }
  return options;
}

function validateCleanupRoot(value) {
  const cleanupRoot = resolve(value);
  if (!cleanupRoot.startsWith("/private/tmp/trailmind-server-live-proof/run.")) {
    throw proofError("invalid_cleanup_root");
  }
  return cleanupRoot;
}

async function requireExistingDirectory(path) {
  let state;
  try {
    state = await lstat(path);
  } catch {
    throw proofError("cleanup_state_unavailable");
  }
  if (!state.isDirectory() || state.isSymbolicLink()) {
    throw proofError("cleanup_state_unavailable");
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw proofError("input_unavailable");
  }
}

function safeErrorCode(error) {
  return [
    "input_unavailable",
    "cleanup_state_unavailable",
    "invalid_arguments",
    "invalid_base_summary",
    "invalid_provider_diagnostic",
    "invalid_provider_ledger",
    "invalid_reconciliation_time",
    "invalid_cleanup_artifact_digest",
    "invalid_cleanup_root"
  ].includes(error?.code) ? error.code : "reconciliation_unavailable";
}

function proofError(code) {
  return Object.assign(new Error(code), { code });
}
