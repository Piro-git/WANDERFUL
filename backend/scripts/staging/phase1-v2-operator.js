import { pathToFileURL } from "node:url";
import { runAuthorizedStagingPhase1V2SingleSession } from
  "../../src/operations/stagingPhase1V2SingleSessionAdapter.js";

export async function main(boundaries, dependencies) {
  return runAuthorizedStagingPhase1V2SingleSession(boundaries, dependencies);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  throw new Error(
    "trailmind_phase1_v2_remote_adapter_required_and_execution_not_authorized"
  );
}
