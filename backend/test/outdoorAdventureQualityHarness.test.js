import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  OUTDOOR_ADVENTURE_QUALITY_ERROR_CODES_V1,
  OUTDOOR_ADVENTURE_QUALITY_VIOLATION_KINDS_V1,
  OutdoorAdventureQualityHarnessError,
  executeOutdoorAdventureQualityCasesV1,
  loadOutdoorAdventureQualityManifestV1,
  outdoorAdventureQualityExitCodeV1,
  runOutdoorAdventureQualityEvaluationV1,
  stableSerialize,
  summarizeOutdoorAdventureQualityV1,
  validateOutdoorAdventureQualityManifestV1
} from "../evaluation/outdoorAdventureQuality/harness.js";

describe("outdoor adventure quality harness false-green defenses", () => {
  it("accepts controlled complete success only", async () => {
    const source = manifest([evaluationCase("controlled-success")]);
    const results = await executeOutdoorAdventureQualityCasesV1({
      manifest: source,
      evaluateCase: passResult
    });
    const summary = summarizeOutdoorAdventureQualityV1(source, results);
    assert.equal(summary.status, "passed");
    assert.equal(summary.metrics.executedCases, 1);
    assert.equal(outdoorAdventureQualityExitCodeV1(summary), 0);
  });

  it("rejects a deliberate evaluation failure", () => {
    const source = manifest([evaluationCase("deliberate-failure")]);
    const summary = summarizeOutdoorAdventureQualityV1(source, [
      {
        ...passResult(source.cases[0]),
        passed: false,
        errorCodes: ["actual_state_mismatch"],
        violations: ["false_claim"]
      }
    ]);
    assert.equal(summary.status, "failed");
    assert.equal(summary.metrics.failedCases, 1);
    assert.equal(summary.metrics.falseClaimViolations, 1);
    assert.equal(outdoorAdventureQualityExitCodeV1(summary), 1);
  });

  it("rejects a deliberate skip and zero executed cases", () => {
    const source = manifest([evaluationCase("deliberate-skip")]);
    const summary = summarizeOutdoorAdventureQualityV1(source, [{
      ...passResult(source.cases[0]),
      passed: false,
      skipped: true,
      errorCodes: ["unexpected_skip"]
    }]);
    assert.equal(summary.status, "not_run");
    assert.equal(summary.metrics.executedCases, 0);
    assert.equal(summary.metrics.skippedCases, 1);
    assert.equal(outdoorAdventureQualityExitCodeV1(summary), 1);
  });

  it("rejects zero configured cases", async () => {
    const source = manifest([]);
    const results = await executeOutdoorAdventureQualityCasesV1({
      manifest: source,
      evaluateCase: passResult
    });
    const summary = summarizeOutdoorAdventureQualityV1(source, results);
    assert.equal(summary.status, "not_run");
    assert.equal(summary.metrics.configuredCases, 0);
    assert.equal(outdoorAdventureQualityExitCodeV1(summary), 1);
  });

  it("rejects a passed result with an error code", async () => {
    const source = manifest([evaluationCase("pass-with-error")]);
    const incoherentResult = {
      ...passResult(source.cases[0]),
      errorCodes: ["actual_state_mismatch"]
    };
    assertRejectedCaseResult(source, incoherentResult);

    const executed = await executeOutdoorAdventureQualityCasesV1({
      manifest: source,
      evaluateCase: () => incoherentResult
    });
    const summary = summarizeOutdoorAdventureQualityV1(source, executed);
    assert.equal(summary.status, "failed");
    assert.deepEqual(executed[0].errorCodes, ["evaluation_exception"]);
    assert.equal(outdoorAdventureQualityExitCodeV1(summary), 1);
  });

  it("rejects a passed result with a violation", () => {
    const source = manifest([evaluationCase("pass-with-violation")]);
    assertRejectedCaseResult(source, {
      ...passResult(source.cases[0]),
      violations: ["false_claim"]
    });
  });

  it("rejects a failed result without a failure reason", () => {
    const source = manifest([evaluationCase("failure-without-reason")]);
    assertRejectedCaseResult(source, {
      ...passResult(source.cases[0]),
      passed: false
    });
  });

  it("rejects duplicate error codes", () => {
    const source = manifest([evaluationCase("duplicate-error-codes")]);
    assertRejectedCaseResult(source, {
      ...passResult(source.cases[0]),
      passed: false,
      errorCodes: ["actual_state_mismatch", "actual_state_mismatch"]
    });
  });

  it("rejects duplicate violations", () => {
    const source = manifest([evaluationCase("duplicate-violations")]);
    assertRejectedCaseResult(source, {
      ...passResult(source.cases[0]),
      passed: false,
      violations: ["false_claim", "false_claim"]
    });
  });

  it("rejects oversized error-code arrays", () => {
    const source = manifest([evaluationCase("oversized-error-codes")]);
    assertRejectedCaseResult(source, {
      ...passResult(source.cases[0]),
      passed: false,
      errorCodes: [
        ...OUTDOOR_ADVENTURE_QUALITY_ERROR_CODES_V1,
        OUTDOOR_ADVENTURE_QUALITY_ERROR_CODES_V1[0]
      ]
    });
  });

  it("rejects oversized violation arrays", () => {
    const source = manifest([evaluationCase("oversized-violations")]);
    assertRejectedCaseResult(source, {
      ...passResult(source.cases[0]),
      passed: false,
      violations: [
        ...OUTDOOR_ADVENTURE_QUALITY_VIOLATION_KINDS_V1,
        OUTDOOR_ADVENTURE_QUALITY_VIOLATION_KINDS_V1[0]
      ]
    });
  });

  it("rejects a skipped result without unexpected_skip", () => {
    const source = manifest([evaluationCase("skip-without-code")]);
    assertRejectedCaseResult(source, {
      ...passResult(source.cases[0]),
      passed: false,
      skipped: true,
      errorCodes: ["evaluation_exception"]
    });
  });

  it("rejects a skipped result that also passed", () => {
    const source = manifest([evaluationCase("skip-and-pass")]);
    assertRejectedCaseResult(source, {
      ...passResult(source.cases[0]),
      skipped: true,
      errorCodes: ["unexpected_skip"]
    });
  });

  it("returns nonzero for a forged passed-status object", () => {
    assert.equal(outdoorAdventureQualityExitCodeV1({
      status: "passed"
    }), 1);
  });

  it("returns zero for a valid generated passing summary", async () => {
    const source = manifest([evaluationCase("valid-exit-summary")]);
    const results = await executeOutdoorAdventureQualityCasesV1({
      manifest: source,
      evaluateCase: passResult
    });
    const summary = summarizeOutdoorAdventureQualityV1(source, results);
    assert.equal(outdoorAdventureQualityExitCodeV1(summary), 0);
  });

  it("rejects missing, extra, duplicate, and reordered result IDs", () => {
    const source = manifest([
      evaluationCase("case-a"),
      evaluationCase("case-b")
    ]);
    assertHarnessCode(
      () => summarizeOutdoorAdventureQualityV1(source, []),
      "result_id_mismatch"
    );
    assertHarnessCode(
      () => summarizeOutdoorAdventureQualityV1(source, [
        passResult(source.cases[0]),
        passResult(source.cases[1]),
        passResult(source.cases[1])
      ]),
      "result_id_mismatch"
    );
    assertHarnessCode(
      () => summarizeOutdoorAdventureQualityV1(source, [
        passResult(source.cases[0]),
        passResult(source.cases[0])
      ]),
      "result_id_mismatch"
    );
    assertHarnessCode(
      () => summarizeOutdoorAdventureQualityV1(source, [
        passResult(source.cases[1]),
        passResult(source.cases[0])
      ]),
      "result_id_mismatch"
    );
  });

  it("rejects duplicate fixture case IDs", () => {
    assertHarnessCode(
      () => validateOutdoorAdventureQualityManifestV1(
        manifest([
          evaluationCase("duplicate-case"),
          evaluationCase("duplicate-case")
        ])
      ),
      "malformed_fixture"
    );
  });

  it("fails a timed-out case without reporting passed", async () => {
    const source = manifest([evaluationCase("timeout-case")]);
    const results = await executeOutdoorAdventureQualityCasesV1({
      manifest: source,
      evaluateCase: () => new Promise(() => {}),
      caseTimeoutMilliseconds: 5
    });
    const summary = summarizeOutdoorAdventureQualityV1(source, results);
    assert.equal(summary.status, "failed");
    assert.deepEqual(results[0].errorCodes, ["timeout"]);
    assert.equal(summary.metrics.determinismViolations, 1);
  });

  it("sanitizes thrown secrets into a fixed error code", async () => {
    const marker = "credential-coordinate-private-sentinel";
    const source = manifest([evaluationCase("secret-sentinel")]);
    const results = await executeOutdoorAdventureQualityCasesV1({
      manifest: source,
      evaluateCase() {
        throw new Error(marker);
      }
    });
    const summary = summarizeOutdoorAdventureQualityV1(source, results);
    const serialized = stableSerialize(summary);
    assert.equal(serialized.includes(marker), false);
    assert.deepEqual(results[0].errorCodes, ["evaluation_exception"]);
    assert.equal(summary.status, "failed");
  });

  it("rejects a missing fixture and malformed JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "trailmind-eval-"));
    await assert.rejects(
      loadOutdoorAdventureQualityManifestV1(
        join(directory, "missing.json")
      ),
      hasHarnessCode("missing_fixture")
    );
    const malformedPath = join(directory, "malformed.json");
    await writeFile(malformedPath, "{not-json", "utf8");
    await assert.rejects(
      loadOutdoorAdventureQualityManifestV1(malformedPath),
      hasHarnessCode("malformed_fixture")
    );
  });

  it("fails when the deterministic summary cannot be written", async () => {
    const directory = await mkdtemp(join(tmpdir(), "trailmind-eval-"));
    const fixturePath = join(directory, "fixture.json");
    await writeFile(
      fixturePath,
      JSON.stringify(manifest([evaluationCase("write-failure")])),
      "utf8"
    );
    await assert.rejects(
      runOutdoorAdventureQualityEvaluationV1({
        fixturePath,
        outputPath: join(directory, "summary.json"),
        evaluateCase: passResult,
        writeSummary: async () => {
          throw new Error("private filesystem detail");
        }
      }),
      hasHarnessCode("summary_write_failed")
    );
  });
});

function manifest(cases) {
  return {
    schemaVersion: 1,
    corpus: {
      name: "TrailMind Outdoor Adventure Quality V1",
      classification: "synthetic_contract_evaluation_data",
      fixedClock: "2026-07-22T10:00:00Z",
      disclaimers: [
        "Synthetic contract and evaluation data only.",
        "Not proof of real geographic route quality.",
        "Not proof that any route is scenic, open, safe, or legal.",
        "Not a replacement for live Harz and Innsbruck Alps field evaluation."
      ]
    },
    cases
  };
}

function evaluationCase(id) {
  return {
    id,
    category: "harness_integrity",
    region: "none",
    operation: "contract",
    input: { scenario: "summary_vocabulary_boundary" },
    expected: { outcomeState: "ready" },
    tags: ["harness"]
  };
}

function passResult(evaluationCaseValue) {
  return {
    id: evaluationCaseValue.id,
    category: evaluationCaseValue.category,
    state: "ready",
    passed: true,
    skipped: false,
    errorCodes: [],
    violations: []
  };
}

function assertHarnessCode(action, code) {
  assert.throws(action, hasHarnessCode(code));
}

function assertRejectedCaseResult(source, result) {
  assertHarnessCode(
    () => summarizeOutdoorAdventureQualityV1(source, [result]),
    "result_id_mismatch"
  );
}

function hasHarnessCode(code) {
  return (error) => {
    assert.ok(error instanceof OutdoorAdventureQualityHarnessError);
    assert.equal(error.code, code);
    assert.equal(error.message.length < 80, true);
    return true;
  };
}
