import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { CANONICAL_GATE_DEFINITIONS } from
  "../evaluation/stagingReadinessV1/constants.js";
import {
  stagingReadinessReceiptExitCodeV1
} from "../evaluation/stagingReadinessV1/contract.js";
import {
  attestHistoricalStagingProofReceiptsV1
} from "../evaluation/stagingReadinessV1/gitEvidence.js";
import {
  readStagingReadinessReceiptV1,
  writeStagingReadinessReceiptAtomicV1
} from "../evaluation/stagingReadinessV1/io.js";
import { runOfflineStagingReadinessV1 } from
  "../evaluation/stagingReadinessV1/offlineHarness.js";
import { loadStagingReadinessPolicyV1 } from
  "../evaluation/stagingReadinessV1/policy.js";
import {
  sha256StagingReadinessV1,
  stableSerializeStagingReadinessV1
} from "../evaluation/stagingReadinessV1/serialization.js";
import {
  mainStagingReadinessV1,
  parseStagingReadinessArgumentsV1
} from "../scripts/run-staging-readiness-v1.js";

const BASELINE = "fc7ea47968aebd7c1c9be747d2abe97c707e4636";
const CANDIDATE = "2".repeat(40);
const PROOF_AS_OF = "2026-08-24T10:00:00.000Z";

describe("staging readiness V1 offline runner and receipt I/O", () => {
  it("produces a deterministic NO-GO with explicit remote blockers and zero provider work", async () => {
    const first = await offlineRun();
    const second = await offlineRun();
    assert.equal(first.receipt.summary.finalClassification, "NO_GO");
    assert.equal(first.receipt.summary.executedCases, 3);
    assert.equal(first.receipt.summary.providerCalls, 0);
    assert.equal(first.receipt.observations.providerAccounting.attempted, 0);
    assert.equal(first.receipt.observations.featureFlags.allDeployedValuesObserved, false);
    assert.equal(stagingReadinessReceiptExitCodeV1(first.receipt), 1);
    assert.equal(first.receipt.semanticReceiptSha256, second.receipt.semanticReceiptSha256);
    assert.equal(
      stableSerializeStagingReadinessV1(first.receipt),
      stableSerializeStagingReadinessV1(second.receipt)
    );
  });

  it("rejects a stale or future offline proof clock against an independent clock", async () => {
    await assert.rejects(
      offlineRun({ proofAsOf: "2026-08-24T09:00:00.000Z" }),
      (error) => error?.code === "receipt_clock_stale"
    );
    await assert.rejects(
      offlineRun({ proofAsOf: "2026-08-24T10:06:00.000Z" }),
      (error) => error?.code === "receipt_clock_in_future"
    );
  });

  it("verifies every protected V4 receipt against the baseline byte-for-byte", async () => {
    const result = await attestHistoricalStagingProofReceiptsV1({
      baselineCommit: BASELINE,
      candidateCommit: BASELINE
    });
    assert.equal(result.receiptCount, 16);
    assert.ok(result.totalBytes > 0);
    assert.match(result.manifestSha256, /^[a-f0-9]{64}$/);
  });

  it("keeps the machine-readable evidence inventory canonical and NO-GO", async () => {
    const inventory = JSON.parse(await readFile(new URL(
      "../../docs/release/staging-v1/canonical-evidence-map-v1.json",
      import.meta.url
    ), "utf8"));
    assert.equal(inventory.currentClassification, "NO_GO");
    assert.equal(inventory.attempt13Authorized, false);
    assert.equal(inventory.providerCalls, 0);
    assert.deepEqual(
      inventory.gates.map((gate) => ({ id: gate.id, caseIds: gate.caseIds })),
      CANONICAL_GATE_DEFINITIONS.map((gate) => ({
        id: gate.id,
        caseIds: [...gate.caseIds]
      }))
    );
  });

  it("times out bounded work instead of publishing a partial receipt", async () => {
    const timers = immediateTimers();
    await assert.rejects(
      runOfflineStagingReadinessV1({
        baselineCommit: BASELINE,
        candidateCommit: CANDIDATE,
        proofAsOf: PROOF_AS_OF,
        timeoutMilliseconds: 100,
        policyLoader: () => new Promise(() => {}),
        timerApi: timers
      }),
      (error) => error?.code === "offline_run_timed_out"
    );
  });

  it("honors cancellation before evidence collection", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      runOfflineStagingReadinessV1({
        baselineCommit: BASELINE,
        candidateCommit: CANDIDATE,
        proofAsOf: PROOF_AS_OF,
        signal: controller.signal,
        policyLoader: async () => { throw new Error("must not run"); },
        gitAttester: async () => { throw new Error("must not run"); },
        historicalAttester: async () => { throw new Error("must not run"); }
      }),
      (error) => error?.code === "offline_run_cancelled"
    );
  });

  it("writes canonically, exclusively and with mode 0600", async () => {
    const { receipt } = await offlineRun();
    const output =
      `/private/tmp/TrailMindStagingReadinessV1-test-${randomUUID()}.json`;
    try {
      await writeStagingReadinessReceiptAtomicV1(output, receipt);
      const stats = await lstat(output);
      assert.equal(stats.mode & 0o077, 0);
      assert.equal(
        await readFile(output, "utf8"),
        `${stableSerializeStagingReadinessV1(receipt)}\n`
      );
      assert.deepEqual(await readStagingReadinessReceiptV1(output), receipt);
      await assert.rejects(
        writeStagingReadinessReceiptAtomicV1(output, receipt),
        (error) => error?.code === "receipt_atomic_write_failed"
      );
    } finally {
      await rm(output, { force: true });
    }
  });

  it("removes a linked receipt if durable publication fails afterward", async () => {
    const { receipt } = await offlineRun();
    const output =
      `/private/tmp/TrailMindStagingReadinessV1-sync-${randomUUID()}.json`;
    try {
      await assert.rejects(
        writeStagingReadinessReceiptAtomicV1(output, receipt, {
          syncDirectoryImpl: async () => { throw new Error("injected"); }
        }),
        (error) => error?.code === "receipt_atomic_write_failed"
      );
      await assert.rejects(lstat(output), (error) => error?.code === "ENOENT");
    } finally {
      await rm(output, { force: true });
    }
  });

  it("rejects noncanonical receipt bytes even when the JSON object is valid", async () => {
    const { receipt } = await offlineRun();
    const output =
      `/private/tmp/TrailMindStagingReadinessV1-noncanonical-${randomUUID()}.json`;
    try {
      await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, {
        mode: 0o600,
        flag: "wx"
      });
      await assert.rejects(
        readStagingReadinessReceiptV1(output),
        (error) => error?.code === "receipt_invalid_or_noncanonical_json"
      );
    } finally {
      await rm(output, { force: true });
    }
  });

  it("fails closed when the summary write cannot start", async () => {
    const { receipt } = await offlineRun();
    await assert.rejects(
      writeStagingReadinessReceiptAtomicV1(
        "/private/tmp/TrailMindStagingReadinessV1-write-failure.json",
        receipt,
        { openImpl: async () => { throw new Error("injected"); } }
      ),
      (error) => error?.code === "receipt_atomic_write_failed"
    );
  });

  it("refuses live execution without terminal immutable candidates and authorization", async () => {
    const output = captureOutput();
    const code = await mainStagingReadinessV1([
      "--execute-live",
      "--baseline-commit", BASELINE,
      "--candidate-commit", CANDIDATE,
      "--proof-as-of", PROOF_AS_OF,
      "--output", "/private/tmp/TrailMindStagingReadinessV1-live.json"
    ], {
      stdout: output,
      runOfflineImpl: async () => { throw new Error("must not run"); }
    });
    assert.equal(code, 2);
    assert.match(output.value, /live_execution_prerequisites_not_supplied/);
    assert.match(output.value, /"providerCalls":0/);
  });

  it("returns nonzero after atomically publishing a truthful offline NO-GO", async () => {
    const { receipt } = await offlineRun();
    const output = captureOutput();
    let writes = 0;
    const code = await mainStagingReadinessV1([
      "--baseline-commit", BASELINE,
      "--candidate-commit", CANDIDATE,
      "--proof-as-of", PROOF_AS_OF,
      "--output", "/private/tmp/TrailMindStagingReadinessV1-mocked.json"
    ], {
      stdout: output,
      trustedNow: PROOF_AS_OF,
      runOfflineImpl: async () => ({ receipt }),
      writeReceiptImpl: async () => { writes += 1; }
    });
    assert.equal(code, 1);
    assert.equal(writes, 1);
    assert.match(output.value, /"classification":"NO_GO"/);
    assert.match(output.value, /"providerCalls":0/);
  });

  it("returns nonzero and no green outcome on a publication failure", async () => {
    const { receipt } = await offlineRun();
    const output = captureOutput();
    const code = await mainStagingReadinessV1([
      "--baseline-commit", BASELINE,
      "--candidate-commit", CANDIDATE,
      "--proof-as-of", PROOF_AS_OF,
      "--output", "/private/tmp/TrailMindStagingReadinessV1-mocked.json"
    ], {
      stdout: output,
      trustedNow: PROOF_AS_OF,
      runOfflineImpl: async () => ({ receipt }),
      writeReceiptImpl: async () => {
        const error = new Error("not retained");
        error.code = "receipt_atomic_write_failed";
        throw error;
      }
    });
    assert.equal(code, 2);
    assert.doesNotMatch(output.value, /"classification":"GO"/);
    assert.match(output.value, /receipt_atomic_write_failed/);
  });

  it("cannot publish or exit zero for an injected live GO receipt", async () => {
    const policy = await loadStagingReadinessPolicyV1();
    const { generateKeyPairSync, sign } = await import("node:crypto");
    const { createCompleteSyntheticStagingReceiptV1 } = await import(
      "../evaluation/stagingReadinessV1/syntheticFixtures.js"
    );
    const { stagingReadinessObserverKeyIdV1 } = await import(
      "../evaluation/stagingReadinessV1/contract.js"
    );
    const keys = generateKeyPairSync("ed25519");
    const keyId = stagingReadinessObserverKeyIdV1(keys.publicKey);
    const liveReceipt = await createCompleteSyntheticStagingReceiptV1({
      policy,
      signer: async (payload) => ({
        observerKeyIdSha256: keyId,
        signatureBase64url: sign(null, payload, keys.privateKey).toString("base64url")
      })
    });
    const output = captureOutput();
    let writes = 0;
    const code = await mainStagingReadinessV1([
      "--baseline-commit", BASELINE,
      "--candidate-commit", CANDIDATE,
      "--proof-as-of", PROOF_AS_OF,
      "--output", "/private/tmp/TrailMindStagingReadinessV1-injected.json"
    ], {
      stdout: output,
      trustedNow: PROOF_AS_OF,
      runOfflineImpl: async () => ({ receipt: liveReceipt }),
      writeReceiptImpl: async () => { writes += 1; }
    });
    assert.equal(code, 2);
    assert.equal(writes, 0);
    assert.match(output.value, /live_execution_not_admitted/);
    assert.doesNotMatch(output.value, /"classification":"GO"/);
  });

  it("rejects duplicate, unknown and malformed command arguments", () => {
    assert.throws(() => parseStagingReadinessArgumentsV1([
      "--baseline-commit", BASELINE,
      "--baseline-commit", BASELINE
    ]));
    assert.throws(() => parseStagingReadinessArgumentsV1(["--unknown"]));
    assert.throws(() => parseStagingReadinessArgumentsV1([
      "--baseline-commit", "short"
    ]));
    assert.throws(() => parseStagingReadinessArgumentsV1([
      "--timeout-ms", "15000",
      "--timeout-ms", "15000"
    ]));
  });
});

async function offlineRun({ proofAsOf = PROOF_AS_OF } = {}) {
  const policy = await loadStagingReadinessPolicyV1();
  const candidateRecord = {
    baselineCommit: BASELINE,
    candidateCommit: CANDIDATE,
    headCommit: CANDIDATE,
    treeDigest: "3".repeat(40),
    indexTreeDigest: "3".repeat(40),
    indexClean: true,
    worktreeClean: true,
    baselineExists: true,
    baselineAncestorOfCandidate: true
  };
  const candidate = {
    ...candidateRecord,
    candidateAttestationSha256: sha256StagingReadinessV1(candidateRecord)
  };
  return runOfflineStagingReadinessV1({
    baselineCommit: BASELINE,
    candidateCommit: CANDIDATE,
    proofAsOf,
    trustedNow: PROOF_AS_OF,
    policyLoader: async () => policy,
    gitAttester: async () => candidate,
    historicalAttester: async () => ({
      receiptCount: 16,
      totalBytes: 1,
      manifestSha256: sha256StagingReadinessV1("historical-receipts")
    })
  });
}

function immediateTimers() {
  return {
    setTimeout(callback) {
      queueMicrotask(callback);
      return { unref() {} };
    },
    clearTimeout() {}
  };
}

function captureOutput() {
  return {
    value: "",
    write(chunk) { this.value += chunk; }
  };
}
