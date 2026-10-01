#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import {
  evaluatePhoneEngineReliabilityReceiptV1,
  serializePhoneEngineReliabilitySummaryV1
} from "../evaluation/phoneEngineReliabilityGateV1/evaluator.js";
import {
  loadPhoneEngineReliabilityManifestV1
} from "../evaluation/phoneEngineReliabilityGateV1/manifest.js";

const MAXIMUM_RECEIPT_BYTES = 256 * 1_024;

try {
  const receiptPath = parseArguments(process.argv.slice(2));
  const metadata = await stat(receiptPath);
  if (!metadata.isFile() || metadata.size < 2 ||
    metadata.size > MAXIMUM_RECEIPT_BYTES) {
    throw new Error("receipt_size_invalid");
  }
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  const manifest = await loadPhoneEngineReliabilityManifestV1();
  const summary = evaluatePhoneEngineReliabilityReceiptV1({ manifest, receipt });
  process.stdout.write(serializePhoneEngineReliabilitySummaryV1(summary));
  if (summary.finalStatus !== "passed") process.exitCode = 1;
} catch (error) {
  process.stderr.write(`phone-engine-reliability-gate-v1: ${safeCode(error)}\n`);
  process.exitCode = 1;
}

function parseArguments(arguments_) {
  if (arguments_.length !== 2 || arguments_[0] !== "--receipt" ||
    arguments_[1].length === 0) {
    throw new Error("usage: --receipt <normalized-receipt.json>");
  }
  return arguments_[1];
}

function safeCode(error) {
  const candidate = error?.code ?? error?.message;
  return typeof candidate === "string" && /^[a-z0-9_: .<>/-]+$/i.test(candidate)
    ? candidate.slice(0, 160)
    : "evaluation_failed";
}
