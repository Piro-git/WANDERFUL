#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import {
  runOfflineStagingReadinessV1,
  stagingReadinessReceiptExitCodeV1,
  validateStagingReadinessReceiptV1,
  writeStagingReadinessReceiptAtomicV1
} from "../evaluation/stagingReadinessV1/index.js";
import { loadStagingReadinessPolicyV1 } from
  "../evaluation/stagingReadinessV1/policy.js";

export async function mainStagingReadinessV1(argv = process.argv.slice(2), options = {}) {
  let parsed;
  try {
    parsed = parseStagingReadinessArgumentsV1(argv);
  } catch (error) {
    writeSafeOutcome({
      classification: "NO_GO",
      errorCode: safeErrorCode(error),
      providerCalls: 0
    }, options.stdout ?? process.stdout);
    return 2;
  }
  if (parsed.help) {
    (options.stdout ?? process.stdout).write(`${usage()}\n`);
    return 0;
  }
  if (parsed.executeLive) {
    writeSafeOutcome({
      classification: "NO_GO",
      errorCode: "live_execution_prerequisites_not_supplied",
      providerCalls: 0
    }, options.stdout ?? process.stdout);
    return 2;
  }

  try {
    const trustedNow = options.trustedNow ?? new Date().toISOString();
    const { receipt } = await (options.runOfflineImpl ??
      runOfflineStagingReadinessV1)({
      baselineCommit: parsed.baselineCommit,
      candidateCommit: parsed.candidateCommit,
      proofAsOf: parsed.proofAsOf,
      trustedNow,
      timeoutMilliseconds: parsed.timeoutMilliseconds,
      signal: options.signal
    });
    if (receipt?.evidenceMode !== "offline_contract" ||
        receipt?.summary?.finalClassification !== "NO_GO") {
      const error = new Error("live_execution_not_admitted");
      error.code = "live_execution_not_admitted";
      throw error;
    }
    const policy = await loadStagingReadinessPolicyV1();
    validateStagingReadinessReceiptV1(receipt, { trustedNow, policy });
    await (options.writeReceiptImpl ?? writeStagingReadinessReceiptAtomicV1)(
      parsed.outputPath,
      receipt
    );
    writeSafeOutcome({
      classification: receipt.summary.finalClassification,
      semanticReceiptSha256: receipt.semanticReceiptSha256,
      executedCases: receipt.summary.executedCases,
      mandatoryNonPassGates: receipt.summary.mandatoryNonPassGates,
      providerCalls: 0
    }, options.stdout ?? process.stdout);
    return stagingReadinessReceiptExitCodeV1(receipt);
  } catch (error) {
    writeSafeOutcome({
      classification: "NO_GO",
      errorCode: safeErrorCode(error),
      providerCalls: 0
    }, options.stdout ?? process.stdout);
    return 2;
  }
}

export function parseStagingReadinessArgumentsV1(argv) {
  if (!Array.isArray(argv) || argv.length > 12 ||
      argv.some((value) => typeof value !== "string" || value.length > 600)) {
    throw argumentError("arguments_invalid");
  }
  if (argv.length === 1 && argv[0] === "--help") return { help: true };
  const result = {
    help: false,
    executeLive: false,
    baselineCommit: null,
    candidateCommit: null,
    proofAsOf: null,
    outputPath: null,
    timeoutMilliseconds: 15_000
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--execute-live") {
      if (seen.has(name)) throw argumentError("arguments_duplicate");
      seen.add(name);
      result.executeLive = true;
      continue;
    }
    const target = new Map([
      ["--baseline-commit", "baselineCommit"],
      ["--candidate-commit", "candidateCommit"],
      ["--proof-as-of", "proofAsOf"],
      ["--output", "outputPath"],
      ["--timeout-ms", "timeoutMilliseconds"]
    ]).get(name);
    if (!target || index + 1 >= argv.length || seen.has(name)) {
      throw argumentError(target ? "arguments_duplicate" : "arguments_unknown");
    }
    seen.add(name);
    const value = argv[index + 1];
    index += 1;
    if (target === "timeoutMilliseconds") {
      if (!/^\d{3,5}$/.test(value)) {
        throw argumentError("timeout_argument_invalid");
      }
      result.timeoutMilliseconds = Number(value);
    } else {
      result[target] = value;
    }
  }
  if (!/^[a-f0-9]{40}$/.test(result.baselineCommit ?? "") ||
      !/^[a-f0-9]{40}$/.test(result.candidateCommit ?? "") ||
      typeof result.proofAsOf !== "string" ||
      typeof result.outputPath !== "string" ||
      !Number.isInteger(result.timeoutMilliseconds) ||
      result.timeoutMilliseconds < 100 || result.timeoutMilliseconds > 30_000) {
    throw argumentError("arguments_missing_or_malformed");
  }
  return result;
}

function safeErrorCode(error) {
  return typeof error?.code === "string" &&
    /^[a-z][a-z0-9_]{0,95}$/.test(error.code)
    ? error.code
    : "staging_readiness_run_failed";
}

function writeSafeOutcome(value, stdout) {
  stdout.write(`${JSON.stringify(value)}\n`);
}

function argumentError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function usage() {
  return "node backend/scripts/run-staging-readiness-v1.js --baseline-commit <40-hex> --candidate-commit <40-hex> --proof-as-of <UTC> --output /private/tmp/TrailMindStagingReadinessV1-<id>.json [--timeout-ms 15000]";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await mainStagingReadinessV1();
}
