import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  V4_COMMITTED_HISTORICAL_RECEIPTS,
  validateCommittedV4HistoricalMarkdown,
  validateCommittedV4HistoricalSummary,
  validateV4HistoricalSummaryObject
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/historicalReceipt.js";

const REPOSITORY_ROOT = new URL("../../", import.meta.url);

describe("committed V4 historical receipt compatibility", () => {
  it("validates Attempts 1-5 byte-exactly through explicit adapters", async () => {
    for (const expected of V4_COMMITTED_HISTORICAL_RECEIPTS) {
      const markdown = await readFile(new URL(
        expected.markdownPath,
        REPOSITORY_ROOT
      ));
      const summary = await readFile(new URL(
        expected.summaryPath,
        REPOSITORY_ROOT
      ));
      assert.equal(validateCommittedV4HistoricalMarkdown(
        expected.attemptNumber,
        markdown
      ), true);
      assert.equal(validateCommittedV4HistoricalSummary(
        expected.attemptNumber,
        summary
      ), true);
    }
  });

  it("rejects byte mutation without rewriting historical receipts", async () => {
    const expected = V4_COMMITTED_HISTORICAL_RECEIPTS[0];
    const summary = await readFile(new URL(
      expected.summaryPath,
      REPOSITORY_ROOT
    ));
    const mutated = Buffer.from(summary);
    mutated[mutated.length - 2] = mutated[mutated.length - 2] === 32 ? 10 : 32;
    assert.throws(() => validateCommittedV4HistoricalSummary(
      expected.attemptNumber,
      mutated
    ), hasCode("historical_v4_receipt_mismatch"));
  });

  it("never converts any historical receipt to passed by changing status", async () => {
    for (const expected of V4_COMMITTED_HISTORICAL_RECEIPTS) {
      const receipt = JSON.parse(await readFile(new URL(
        expected.summaryPath,
        REPOSITORY_ROOT
      ), "utf8"));
      receipt.status = "passed";
      assert.throws(
        () => validateV4HistoricalSummaryObject(
          expected.attemptNumber,
          receipt
        ),
        undefined,
        `Attempt ${expected.attemptNumber}`
      );
    }
  });
});

function hasCode(code) {
  return (error) => error?.code === code;
}
