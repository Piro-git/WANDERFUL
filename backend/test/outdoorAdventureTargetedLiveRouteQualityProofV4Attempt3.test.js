import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  V4_ATTEMPT_THREE_LEDGER_SHA256,
  V4_PRIOR_ATTEMPT_RECEIPTS,
  validateV4AttemptThreeReceipt
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/attempt3Contract.js";

const RECEIPT_URL = new URL(
  "../../docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4_ATTEMPT_3.summary.json",
  import.meta.url
);

describe("V4 attempt-three database-gated receipt", () => {
  it("validates the distinct published failed receipt", async () => {
    const receipt = await loadReceipt();
    assert.equal(validateV4AttemptThreeReceipt(receipt), true);
    assert.equal(receipt.ledgerSha256, V4_ATTEMPT_THREE_LEDGER_SHA256);
    assert.equal(receipt.providerAccounting.attempted, 0);
    assert.equal(receipt.providerAccounting.unused, 15);
  });

  it("rejects mutation or reinterpretation of either prior attempt", async () => {
    const attemptOne = await loadReceipt();
    attemptOne.priorAttempts.attemptOne.markdownSha256 = "0".repeat(64);
    assert.throws(
      () => validateV4AttemptThreeReceipt(attemptOne),
      (error) => error?.code === "attemptOne_not_preserved"
    );

    const attemptTwo = await loadReceipt();
    attemptTwo.priorAttempts.attemptTwo.routeQuality = "failed";
    assert.throws(
      () => validateV4AttemptThreeReceipt(attemptTwo),
      (error) => error?.code === "attemptTwo_not_preserved"
    );
    assert.equal(
      V4_PRIOR_ATTEMPT_RECEIPTS.attemptTwo.summarySha256,
      "7aa8a4b992514ded013ef5ebc6a6218f87b559997220a3c240e7fc39a436d737"
    );
  });

  it("rejects incomplete or broadened storage recovery", async () => {
    const receipt = await loadReceipt();
    receipt.storageRecovery.candidates[0].name = "unreviewed-target";
    assert.throws(() => validateV4AttemptThreeReceipt(receipt));
  });

  it("rejects a false database pass after the projection timeout", async () => {
    const receipt = await loadReceipt();
    receipt.decisions.databasePreflight = "passed";
    assert.throws(() => validateV4AttemptThreeReceipt(receipt));

    const rollback = await loadReceipt();
    rollback.databasePreflightEvidence.projection.harzRealRun
      .transactionRollbackVerified = false;
    assert.throws(() => validateV4AttemptThreeReceipt(rollback));
  });

  it("rejects provider accounting after the failed database gate", async () => {
    const receipt = await loadReceipt();
    receipt.providerAccounting.attempted = 1;
    receipt.providerAccounting.failed = 1;
    receipt.providerAccounting.unused = 14;
    assert.throws(() => validateV4AttemptThreeReceipt(receipt));
  });

  it("rejects route quality promotion when no canonical route ran", async () => {
    const receipt = await loadReceipt();
    receipt.cases[1].productQualityOutcome = "pass";
    assert.throws(() => validateV4AttemptThreeReceipt(receipt));

    const golden = await loadReceipt();
    golden.cases[1].caseEvaluationOutcome = "pass";
    assert.throws(() => validateV4AttemptThreeReceipt(golden));
  });

  it("rejects cleanup failure and sensitive durable output", async () => {
    const cleanup = await loadReceipt();
    cleanup.cleanup.temporaryLedgerRemoved = false;
    assert.throws(() => validateV4AttemptThreeReceipt(cleanup));

    const sensitive = await loadReceipt();
    sensitive.databasePreflightEvidence.requestUrl = "https://example.invalid";
    assert.throws(() => validateV4AttemptThreeReceipt(sensitive));
  });

  it("rejects mutation of otherwise-unenumerated published fields", async () => {
    const receipt = await loadReceipt();
    receipt.generatedAt = "2026-08-05T00:00:00Z";
    assert.throws(() => validateV4AttemptThreeReceipt(receipt));
  });
});

async function loadReceipt() {
  return JSON.parse(await readFile(RECEIPT_URL, "utf8"));
}
