import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PhoneEngineReliabilityEvaluationError,
  evaluatePhoneEngineReliabilityReceiptV1,
  serializePhoneEngineReliabilitySummaryV1
} from "../evaluation/phoneEngineReliabilityGateV1/evaluator.js";
import {
  PhoneEngineReliabilityManifestError,
  loadPhoneEngineReliabilityManifestV1,
  validatePhoneEngineReliabilityManifestV1
} from "../evaluation/phoneEngineReliabilityGateV1/manifest.js";
import {
  createPhoneEngineReliabilityReceiptV1
} from "../evaluation/phoneEngineReliabilityGateV1/receiptAdapter.js";

test("manifest binds exactly 18 ordered cases to reviewed fixtures", async () => {
  const manifest = await loadPhoneEngineReliabilityManifestV1();
  assert.equal(manifest.cases.length, 18);
  assert.deepEqual(
    manifest.cases.map((item) => item.id),
    Array.from({ length: 18 }, (_, index) =>
      `phone-${String(index + 1).padStart(2, "0")}-${[
        "clear-harz-loop", "broad-alps-clarification", "ambiguous-place",
        "point-to-point", "trail-run", "easy-demanding-output",
        "unverified-viewpoint", "badly-snapped-stop", "excessive-distance",
        "backtracking-loop", "malformed-or-empty-llm",
        "no-route-or-rate-limit", "cancellation-and-stale-response",
        "zero-survivors", "one-eligible-route",
        "foreground-navigation-lifecycle", "detail-and-saved-route",
        "gpx-provenance"
      ][index]}`
    )
  );
  assert.ok(manifest.cases.every((item) => item.sourceCaseIds.length > 0));
  assert.ok(manifest.cases.every((item) => item.sourceTestSelectors.length > 0));
});

test("complete deterministic receipt passes while preserving two-axis outcomes", async () => {
  const manifest = await loadPhoneEngineReliabilityManifestV1();
  const summary = evaluatePhoneEngineReliabilityReceiptV1({
    manifest,
    receipt: passingReceipt(manifest)
  });
  assert.equal(summary.finalStatus, "passed");
  assert.equal(summary.executedCaseCount, 18);
  assert.equal(summary.skippedCaseCount, 0);
  assert.equal(summary.providerCallCount, 0);
  assert.deepEqual(summary.technicalPipelineTotals, {
    pass: 7,
    fail: 8,
    not_run: 3
  });
  assert.deepEqual(summary.productQualityTotals, {
    pass: 7,
    fail: 6,
    not_applicable: 5
  });
  const safelyRejected = summary.cases.find((item) =>
    item.id === "phone-06-easy-demanding-output"
  );
  assert.equal(safelyRejected.technicalPipelineOutcome, "fail");
  assert.equal(safelyRejected.productQualityOutcome, "fail");
  assert.equal(safelyRejected.passed, true);
});

test("duplicate missing extra and reordered case identities are rejected", async () => {
  const manifest = await loadPhoneEngineReliabilityManifestV1();
  for (const mutate of [
    (receipt) => receipt.cases.pop(),
    (receipt) => receipt.cases.push(structuredClone(receipt.cases[0])),
    (receipt) => { receipt.cases[1].id = receipt.cases[0].id; },
    (receipt) => { [receipt.cases[0], receipt.cases[1]] =
      [receipt.cases[1], receipt.cases[0]]; }
  ]) {
    const receipt = passingReceipt(manifest);
    mutate(receipt);
    assert.throws(
      () => evaluatePhoneEngineReliabilityReceiptV1({ manifest, receipt }),
      PhoneEngineReliabilityEvaluationError
    );
  }
});

test("unexpected skip and zero execution cannot produce a green gate", async () => {
  const manifest = await loadPhoneEngineReliabilityManifestV1();
  const receipt = passingReceipt(manifest);
  receipt.cases[0].executed = false;
  receipt.cases[0].skipped = true;
  const summary = evaluatePhoneEngineReliabilityReceiptV1({ manifest, receipt });
  assert.equal(summary.finalStatus, "failed");
  assert.deepEqual(summary.cases[0].failures, ["not_executed", "unexpected_skip"]);
});

test("missing extra reordered and failed assertions are false-green resistant", async () => {
  const manifest = await loadPhoneEngineReliabilityManifestV1();
  for (const mutate of [
    (receipt) => receipt.cases[0].assertions.pop(),
    (receipt) => receipt.cases[0].assertions.push({ id: "extra", passed: true }),
    (receipt) => receipt.cases[0].assertions.reverse()
  ]) {
    const receipt = passingReceipt(manifest);
    mutate(receipt);
    assert.throws(
      () => evaluatePhoneEngineReliabilityReceiptV1({ manifest, receipt }),
      PhoneEngineReliabilityEvaluationError
    );
  }
  const failed = passingReceipt(manifest);
  failed.cases[0].assertions[0].passed = false;
  const summary = evaluatePhoneEngineReliabilityReceiptV1({
    manifest,
    receipt: failed
  });
  assert.equal(summary.finalStatus, "failed");
  assert.deepEqual(summary.failedCaseIds, ["phone-01-clear-harz-loop"]);
});

test("test evidence must be exact, ordered, executed, and passing", async () => {
  const manifest = await loadPhoneEngineReliabilityManifestV1();
  const missing = passingReceipt(manifest);
  missing.cases[10].testEvidence.pop();
  assert.throws(
    () => evaluatePhoneEngineReliabilityReceiptV1({ manifest, receipt: missing }),
    PhoneEngineReliabilityEvaluationError
  );

  const skipped = passingReceipt(manifest);
  skipped.cases[0].testEvidence[0].result = "skipped";
  const summary = evaluatePhoneEngineReliabilityReceiptV1({
    manifest,
    receipt: skipped
  });
  assert.equal(summary.finalStatus, "failed");
  assert.match(summary.cases[0].failures[0], /^source_test_not_passed:/);
});

test("runtime totals and provider authorization must be coherent", async () => {
  const manifest = await loadPhoneEngineReliabilityManifestV1();
  const badTotal = passingReceipt(manifest);
  badTotal.totalRuntimeMilliseconds += 1;
  assert.throws(
    () => evaluatePhoneEngineReliabilityReceiptV1({ manifest, receipt: badTotal }),
    /receipt_runtime_totals_incoherent/
  );

  const unauthorized = passingReceipt(manifest);
  unauthorized.cases[0].providerCallCount = 1;
  assert.throws(
    () => evaluatePhoneEngineReliabilityReceiptV1({ manifest, receipt: unauthorized }),
    /provider_authorization_incoherent/
  );

  const live = passingReceipt(manifest);
  live.cases[0].providerCallCount = 1;
  live.proofClassification = "physical_device_live_proof";
  live.providerAuthorization = "fresh_bounded";
  assert.equal(
    evaluatePhoneEngineReliabilityReceiptV1({ manifest, receipt: live })
      .providerCallCount,
    1
  );
});

test("bounded runtimes fail and summaries remain bounded", async () => {
  const manifest = await loadPhoneEngineReliabilityManifestV1();
  const receipt = passingReceipt(manifest);
  receipt.cases[0].runtimeMilliseconds =
    manifest.limits.maximumCaseRuntimeMilliseconds + 1;
  receipt.totalRuntimeMilliseconds = receipt.cases.reduce(
    (total, item) => total + item.runtimeMilliseconds,
    0
  );
  const summary = evaluatePhoneEngineReliabilityReceiptV1({ manifest, receipt });
  assert.equal(summary.finalStatus, "failed");
  assert.ok(summary.cases[0].failures.includes("case_runtime_exceeded"));
  assert.ok(Buffer.byteLength(
    serializePhoneEngineReliabilitySummaryV1(summary)
  ) <= manifest.limits.maximumSummaryBytes + 1);
});

test("summary serialization is byte stable", async () => {
  const manifest = await loadPhoneEngineReliabilityManifestV1();
  const receipt = passingReceipt(manifest);
  const first = serializePhoneEngineReliabilitySummaryV1(
    evaluatePhoneEngineReliabilityReceiptV1({ manifest, receipt })
  );
  const second = serializePhoneEngineReliabilitySummaryV1(
    evaluatePhoneEngineReliabilityReceiptV1({
      manifest: structuredClone(manifest),
      receipt: structuredClone(receipt)
    })
  );
  assert.equal(first, second);
});

test("receipt adapter maps exact observations and rejects incomplete evidence", async () => {
  const manifest = await loadPhoneEngineReliabilityManifestV1();
  const seed = passingReceipt(manifest);
  const input = adapterInput(manifest, seed);
  const adapted = createPhoneEngineReliabilityReceiptV1(input);
  assert.deepEqual(adapted, seed);

  input.testResults.pop();
  assert.throws(
    () => createPhoneEngineReliabilityReceiptV1(input),
    /phone_gate_test_results_incomplete/
  );
});

test("manifest rejects an unreviewed source case", async () => {
  const manifest = structuredClone(await loadPhoneEngineReliabilityManifestV1());
  manifest.cases[0].sourceCaseIds = ["invented-case"];
  assert.throws(
    () => validatePhoneEngineReliabilityManifestV1(manifest, {
      reviewedCaseIds: new Set()
    }),
    PhoneEngineReliabilityManifestError
  );
});

test("CLI exits nonzero for malformed receipt and unexpected skip", async () => {
  const manifest = await loadPhoneEngineReliabilityManifestV1();
  const directory = await mkdtemp(join(tmpdir(), "phone-gate-v1-"));
  const malformedPath = join(directory, "malformed.json");
  await writeFile(malformedPath, "{}\n", "utf8");
  const malformed = runCLI(malformedPath);
  assert.notEqual(malformed.status, 0);

  const skippedReceipt = passingReceipt(manifest);
  skippedReceipt.cases[0].skipped = true;
  const skippedPath = join(directory, "skipped.json");
  await writeFile(skippedPath, `${JSON.stringify(skippedReceipt)}\n`, "utf8");
  const skipped = runCLI(skippedPath);
  assert.notEqual(skipped.status, 0);
  assert.equal(JSON.parse(skipped.stdout).finalStatus, "failed");
});

function passingReceipt(manifest) {
  const cases = manifest.cases.map((contract) => ({
    id: contract.id,
    executed: true,
    skipped: false,
    terminalState: contract.expectedTerminalState,
    technicalPipelineOutcome: contract.expectedTechnicalPipelineOutcome,
    productQualityOutcome: contract.expectedProductQualityOutcome,
    assertions: contract.requiredAssertionIds.map((id) => ({ id, passed: true })),
    testEvidence: contract.sourceTestSelectors.map((selector) => ({
      selector,
      result: "passed"
    })),
    providerCallCount: 0,
    runtimeMilliseconds: 1
  }));
  return {
    schemaVersion: 1,
    gateId: manifest.gateId,
    proofClassification: "deterministic_contract_proof",
    providerAuthorization: "none",
    totalRuntimeMilliseconds: cases.length,
    cases
  };
}

function runCLI(receiptPath) {
  return spawnSync(
    process.execPath,
    ["scripts/run-phone-engine-reliability-gate-v1.js", "--receipt", receiptPath],
    { cwd: new URL("../", import.meta.url), encoding: "utf8" }
  );
}

function adapterInput(manifest, receipt) {
  const bySelector = new Map();
  for (const item of receipt.cases.flatMap((entry) => entry.testEvidence)) {
    bySelector.set(item.selector, item.result);
  }
  return {
    manifest,
    proofClassification: receipt.proofClassification,
    providerAuthorization: receipt.providerAuthorization,
    caseObservations: receipt.cases.map((item) => ({
      id: item.id,
      executed: item.executed,
      skipped: item.skipped,
      terminalState: item.terminalState,
      technicalPipelineOutcome: item.technicalPipelineOutcome,
      productQualityOutcome: item.productQualityOutcome,
      assertions: Object.fromEntries(item.assertions.map((assertion) => [
        assertion.id,
        assertion.passed
      ])),
      providerCallCount: item.providerCallCount,
      runtimeMilliseconds: item.runtimeMilliseconds
    })),
    testResults: [...bySelector].map(([selector, result]) => ({
      selector,
      result
    }))
  };
}
