import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  V4_ATTEMPT_ONE_RECEIPTS,
  validateV4ResumeReceipt
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/resumeContract.js";

const RECEIPT_URL = new URL(
  "../../docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4_ATTEMPT_2.summary.json",
  import.meta.url
);

describe("V4 attempt-two storage-resume receipt", () => {
  it("validates the distinct published blocked receipt", async () => {
    const receipt = await loadReceipt();
    assert.equal(validateV4ResumeReceipt(receipt), true);
    assert.equal(receipt.attemptOne.markdownSha256,
      V4_ATTEMPT_ONE_RECEIPTS.markdownSha256);
    assert.equal(receipt.providerAccounting.attempted, 0);
    assert.equal(receipt.providerAccounting.unused, 15);
  });

  it("rejects reclassifying attempt one as a route-quality failure", async () => {
    const receipt = await loadReceipt();
    receipt.attemptOne.routeQualityClassification = "failed";
    assert.throws(
      () => validateV4ResumeReceipt(receipt),
      (error) => error?.code === "attempt_one_not_preserved"
    );
  });

  it("rejects deletion when a candidate contains nested Git metadata", async () => {
    const receipt = await loadReceipt();
    receipt.storageRecovery.candidates[0].deleted = true;
    receipt.storageRecovery.deletedCandidateCount = 1;
    assert.throws(() => validateV4ResumeReceipt(receipt));
  });

  it("rejects provider or route-quality work after the failed storage gate", async () => {
    const provider = await loadReceipt();
    provider.providerAccounting.attempted = 1;
    provider.providerAccounting.unused = 14;
    assert.throws(() => validateV4ResumeReceipt(provider));

    const routeQuality = await loadReceipt();
    routeQuality.cases[0].caseEvaluationOutcome = "fail";
    assert.throws(() => validateV4ResumeReceipt(routeQuality));
  });

  it("rejects mutation of otherwise-unenumerated published fields", async () => {
    const receipt = await loadReceipt();
    receipt.generatedAt = "2026-08-05T00:00:00Z";
    assert.throws(() => validateV4ResumeReceipt(receipt));
  });
});

async function loadReceipt() {
  return JSON.parse(await readFile(RECEIPT_URL, "utf8"));
}
