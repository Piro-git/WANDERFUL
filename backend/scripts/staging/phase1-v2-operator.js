import { pathToFileURL } from "node:url";
import { runStagingPhase1V2Operator } from
  "../../src/operations/stagingPhase1V2Operator.js";

export async function main(dependencies) {
  return runStagingPhase1V2Operator(dependencies);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  throw new Error(
    "trailmind_phase1_v2_remote_adapter_required_and_execution_not_authorized"
  );
}
