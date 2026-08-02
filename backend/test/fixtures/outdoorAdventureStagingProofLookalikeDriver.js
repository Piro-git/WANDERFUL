import { writeFileSync } from "node:fs";

const sentinelPath =
  process.env.TRAILMIND_PROOF_DRIVER_IMPORT_SENTINEL;

if (typeof sentinelPath === "string" && sentinelPath.length > 0) {
  writeFileSync(sentinelPath, "imported", "utf8");
}

export async function createOutdoorAdventureStagingProofCaseDriverV1() {
  return Object.freeze({
    async runCase() {
      throw new Error("A lookalike driver must never execute.");
    }
  });
}
