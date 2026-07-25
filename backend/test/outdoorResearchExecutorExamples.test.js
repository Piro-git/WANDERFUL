import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateAdventureResearchDossierV1,
  validateAdventureResearchIntentV1
} from "../src/outdoorResearch/validation.js";
import {
  HARZ_DOSSIER_EXAMPLE_V1,
  INNSBRUCK_DOSSIER_EXAMPLE_V1,
  INSUFFICIENT_EVIDENCE_DOSSIER_EXAMPLE_V1,
  STALE_SOURCE_RESULT_EXAMPLE_V1
} from "./fixtures/outdoorResearchExecutorExamplesV1.js";

describe("documented outdoor research executor examples", () => {
  it("keeps both regional and the insufficient-evidence dossiers contract-valid", () => {
    for (const dossier of [
      HARZ_DOSSIER_EXAMPLE_V1,
      INNSBRUCK_DOSSIER_EXAMPLE_V1,
      INSUFFICIENT_EVIDENCE_DOSSIER_EXAMPLE_V1
    ]) {
      assert.doesNotThrow(() => validateAdventureResearchDossierV1(dossier));
    }
    for (const dossier of [
      HARZ_DOSSIER_EXAMPLE_V1,
      INNSBRUCK_DOSSIER_EXAMPLE_V1
    ]) {
      assert(dossier.candidateHighlights.every((candidate) =>
        candidate.knownLimitations.includes("route_connection_unverified")
      ));
      assert(dossier.evidenceGaps.some((gap) =>
        gap.code === "missing_route_connection" &&
        gap.predicate === null
      ));
    }
    assert.equal(
      INSUFFICIENT_EVIDENCE_DOSSIER_EXAMPLE_V1.freshnessState,
      "unknown"
    );
  });

  it("keeps the stale-source example non-ready and without a fabricated dossier", () => {
    assert.equal(STALE_SOURCE_RESULT_EXAMPLE_V1.state, "unsupported");
    assert.equal(STALE_SOURCE_RESULT_EXAMPLE_V1.availabilityState, "source_stale");
    assert.equal(Object.hasOwn(STALE_SOURCE_RESULT_EXAMPLE_V1, "dossier"), false);
    assert.doesNotThrow(() => validateAdventureResearchIntentV1(
      STALE_SOURCE_RESULT_EXAMPLE_V1.normalizedIntent
    ));
  });
});
