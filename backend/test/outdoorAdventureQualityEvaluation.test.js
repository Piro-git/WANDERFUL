import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  executeOutdoorAdventureQualityCasesV1,
  loadOutdoorAdventureQualityManifestV1,
  stableSerialize,
  summarizeOutdoorAdventureQualityV1
} from "../evaluation/outdoorAdventureQuality/harness.js";
import {
  evaluateOutdoorAdventureQualityCaseV1
} from "../evaluation/outdoorAdventureQuality/evaluator.js";

const FIXTURE_PATH = resolve(
  "test/fixtures/outdoorAdventureQualityV1.json"
);

describe("outdoor adventure quality evaluation v1", () => {
  it("executes the complete synthetic corpus through real contracts", async () => {
    const manifest =
      await loadOutdoorAdventureQualityManifestV1(FIXTURE_PATH);
    const results = await executeOutdoorAdventureQualityCasesV1({
      manifest,
      evaluateCase: evaluateOutdoorAdventureQualityCaseV1
    });
    const summary = summarizeOutdoorAdventureQualityV1(
      manifest,
      results
    );

    assert.equal(summary.status, "passed");
    assert.deepEqual(summary.categoryCounts, {
      candidate_quality: 13,
      core_intent: 12,
      high_stakes_trust: 12,
      location_coverage: 11,
      malformed_adversarial: 20,
      must_have_preference: 10,
      routed_result_trust: 12,
      users_trip_context: 11
    });
    assert.deepEqual(summary.metrics, {
      configuredCases: 101,
      executedCases: 101,
      passedCases: 101,
      failedCases: 0,
      skippedCases: 0,
      readyCases: 39,
      partialCases: 37,
      clarificationCases: 2,
      unsupportedCases: 23,
      falseClaimViolations: 0,
      highStakesAuthorityViolations: 0,
      provenanceViolations: 0,
      mustHaveViolations: 0,
      routeVerificationViolations: 0,
      waypointConnectionViolations: 0,
      determinismViolations: 0,
      boundsViolations: 0
    });
  });

  it("produces semantically identical summaries on repeated runs", async () => {
    const manifest =
      await loadOutdoorAdventureQualityManifestV1(FIXTURE_PATH);
    const first = summarizeOutdoorAdventureQualityV1(
      manifest,
      await executeOutdoorAdventureQualityCasesV1({
        manifest,
        evaluateCase: evaluateOutdoorAdventureQualityCaseV1
      })
    );
    const second = summarizeOutdoorAdventureQualityV1(
      manifest,
      await executeOutdoorAdventureQualityCasesV1({
        manifest,
        evaluateCase: evaluateOutdoorAdventureQualityCaseV1
      })
    );
    assert.equal(stableSerialize(first), stableSerialize(second));
  });

  it("labels the corpus synthetic and covers both initial regions", async () => {
    const manifest =
      await loadOutdoorAdventureQualityManifestV1(FIXTURE_PATH);
    assert.equal(
      manifest.corpus.classification,
      "synthetic_contract_evaluation_data"
    );
    assert.equal(manifest.corpus.disclaimers.length, 4);
    assert.equal(
      manifest.cases.filter((item) => item.region === "harz").length > 30,
      true
    );
    assert.equal(
      manifest.cases.filter(
        (item) => item.region === "innsbruck_alps"
      ).length > 30,
      true
    );
    const tags = new Set(manifest.cases.flatMap((item) => item.tags));
    for (const required of [
      "hiking",
      "trail-running",
      "exact-distance",
      "exact-duration",
      "overnight",
      "public-transport",
      "closure",
      "water",
      "provenance",
      "no-geometry",
      "determinism",
      "redaction"
    ]) {
      assert.equal(tags.has(required), true, required);
    }
  });

  it("keeps machine output bounded to identifiers and safe codes", async () => {
    const manifest =
      await loadOutdoorAdventureQualityManifestV1(FIXTURE_PATH);
    const summary = summarizeOutdoorAdventureQualityV1(
      manifest,
      await executeOutdoorAdventureQualityCasesV1({
        manifest,
        evaluateCase: evaluateOutdoorAdventureQualityCaseV1
      })
    );
    const serialized = stableSerialize(summary);
    for (const forbidden of [
      "originalPrompt",
      "authorization",
      "databaseUrl",
      "providerPrivateError",
      "synthetic-private-provider-sentinel",
      "\"latitude\"",
      "\"longitude\"",
      "\"geometry\""
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });
});
