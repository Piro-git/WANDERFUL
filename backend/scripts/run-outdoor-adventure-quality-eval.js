import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  outdoorAdventureQualityExitCodeV1,
  runOutdoorAdventureQualityEvaluationV1,
  stableSerialize
} from "../evaluation/outdoorAdventureQuality/harness.js";
import {
  evaluateOutdoorAdventureQualityCaseV1
} from "../evaluation/outdoorAdventureQuality/evaluator.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const backendDirectory = resolve(scriptDirectory, "..");

try {
  const options = commandLineOptions(process.argv.slice(2));
  const fixturePath = options.fixturePath ?? join(
    backendDirectory,
    "test",
    "fixtures",
    "outdoorAdventureQualityV1.json"
  );
  const outputPath = options.outputPath ?? join(
    tmpdir(),
    "trailmind-outdoor-adventure-quality-v1.summary.json"
  );
  const summary = await runOutdoorAdventureQualityEvaluationV1({
    fixturePath,
    outputPath,
    evaluateCase: evaluateOutdoorAdventureQualityCaseV1
  });
  process.stdout.write(`${stableSerialize({
    status: summary.status,
    categoryCounts: summary.categoryCounts,
    metrics: summary.metrics
  })}\n`);
  process.exitCode = outdoorAdventureQualityExitCodeV1(summary);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    status: "not_run",
    errorCode: safeErrorCode(error)
  })}\n`);
  process.exitCode = 1;
}

function commandLineOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === "--fixture" && value) {
      options.fixturePath = resolve(value);
      index += 1;
    } else if (argument === "--output" && value) {
      options.outputPath = resolve(value);
      index += 1;
    } else {
      throw new TypeError("invalid arguments");
    }
  }
  return options;
}

function safeErrorCode(error) {
  const allowed = new Set([
    "malformed_fixture",
    "missing_fixture",
    "result_id_mismatch",
    "summary_write_failed"
  ]);
  return allowed.has(error?.code) ? error.code : "evaluation_exception";
}
