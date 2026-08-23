import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateProductionConfiguration
} from "./productionConfiguration.js";

export function runProductionPreflight(options = {}) {
  const env = options.env ?? process.env;
  const write = options.write ?? process.stdout.write.bind(process.stdout);
  const report = evaluateProductionConfiguration(env);
  write(`${JSON.stringify(report)}\n`);
  return report.decision === "ready" ? 0 : 1;
}

const isMain =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) process.exitCode = runProductionPreflight();
