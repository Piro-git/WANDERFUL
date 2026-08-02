import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  sealServerLiveProofCleanupV1,
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
    await requireMissing(options.cleanupRoot);
    const summary = await readJson(options.summaryPath);
    const sealed = sealServerLiveProofCleanupV1({
      summary,
      cleanupArtifactDigest: safeProofDigestV1(
        options.cleanupRoot,
        "cleanup"
      )
    });
    await writeStableJsonAtomicV1(options.summaryPath, sealed);
    process.stdout.write(`${stableSerialize({
      proofClassification: sealed.proofClassification,
      status: sealed.status,
      cleanupStatus: sealed.disposableArtifacts.status
    })}\n`);
  } catch (error) {
    process.stdout.write(`${stableSerialize({
      proofClassification: "server_side_live_pipeline_proof",
      status: "cleanup_seal_failed",
      errorCode: safeErrorCode(error)
    })}\n`);
    process.exitCode = 1;
  }
}

function parseArguments(args) {
  if (
    args.length !== 4 ||
    args[0] !== "--summary" ||
    !args[1] ||
    args[2] !== "--cleanup-root" ||
    !args[3]
  ) {
    throw proofError("invalid_arguments");
  }
  const cleanupRoot = resolve(args[3]);
  if (!cleanupRoot.startsWith("/private/tmp/trailmind-server-live-proof/run.")) {
    throw proofError("invalid_cleanup_root");
  }
  return {
    summaryPath: resolve(args[1]),
    cleanupRoot
  };
}

async function requireMissing(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw proofError("cleanup_state_unavailable");
  }
  throw proofError("cleanup_root_still_exists");
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw proofError("summary_unavailable");
  }
}

function safeErrorCode(error) {
  return [
    "cleanup_root_still_exists",
    "cleanup_state_unavailable",
    "invalid_arguments",
    "invalid_base_summary",
    "invalid_cleanup_artifact_digest",
    "invalid_cleanup_root",
    "summary_not_ready_for_cleanup_seal",
    "summary_unavailable"
  ].includes(error?.code) ? error.code : "cleanup_seal_unavailable";
}

function proofError(code) {
  return Object.assign(new Error(code), { code });
}
