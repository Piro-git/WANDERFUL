import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createOutdoorAdventureStagingProofPostgresCancellationGateV1,
  outdoorAdventureStagingProofPostgresCancellationGateForTesting
} from "../evaluation/outdoorAdventureStagingProof/postgresCancellationGate.js";
import {
  outdoorResearchRepositoryQueriesForTesting
} from "../src/outdoorResearch/postgresOutdoorResearchRepository.js";

const CASE_ID =
  "case-13-cancel-during-postgis-research";
const NONCE_DIGEST = "a".repeat(64);

describe("outdoor adventure staging proof PostgreSQL cancellation gate", () => {
  it("opens a disposable relation lock and settles only after the exact cancellation lifecycle", async () => {
    const harness = gateHarness({
      probeRows: [[{ pid: 42 }]]
    });
    const gate = await createGate(harness);
    gate.observeTransactionLifecycle("began");

    const active = await gate.wait(request("query_active"));
    assert.deepEqual(active, {
      schemaVersion: 1,
      state: "query_active"
    });
    assert.equal(JSON.stringify(active).includes(NONCE_DIGEST), false);
    assert.equal(JSON.stringify(active).includes("42"), false);

    const settled = gate.wait(request("cancel_settled"));
    gate.observeTransactionLifecycle(
      "query_cancelled_after_abort"
    );
    gate.observeTransactionLifecycle(
      "rollback_completed_after_cancel"
    );
    assert.deepEqual(await settled, {
      schemaVersion: 1,
      state: "cancel_settled"
    });

    assert.deepEqual(
      harness.calls.slice(0, 3).map((call) => call.text),
      [
        "BEGIN",
        "SELECT set_config('lock_timeout', $1, true)",
        "LOCK TABLE public.outdoor_evidence_regions IN ACCESS EXCLUSIVE MODE"
      ]
    );
    const probe = harness.calls.find((call) =>
      call.text ===
        outdoorAdventureStagingProofPostgresCancellationGateForTesting
          .activeQuery
    );
    assert.deepEqual(probe.values, [
      "trailmind_staging_proof_v1",
      outdoorAdventureStagingProofPostgresCancellationGateForTesting
        .snapshotQueryPrefix
    ]);
    assert.equal(
      outdoorAdventureStagingProofPostgresCancellationGateForTesting
        .snapshotQueryPrefix,
      outdoorResearchRepositoryQueriesForTesting.snapshotContext.slice(
        0,
        96
      )
    );
    assert(
      outdoorAdventureStagingProofPostgresCancellationGateForTesting
        .snapshotQueryPrefix.length < 1_024
    );
    assert.deepEqual(
      Object.entries(outdoorResearchRepositoryQueriesForTesting)
        .filter(([, query]) => query.startsWith(
          outdoorAdventureStagingProofPostgresCancellationGateForTesting
            .snapshotQueryPrefix
        ))
        .map(([name]) => name),
      ["snapshotContext"]
    );
    assert.match(
      probe.text,
      /left\(activity\.query, length\(\$2\)\) = \$2/
    );
    assert.equal(harness.calls.at(-1).text, "ROLLBACK");
    assert.equal(harness.releaseArguments.length, 1);
    assert.equal(harness.releaseArguments[0], undefined);

    await gate.dispose();
    assert.equal(harness.releaseArguments.length, 1);
  });

  it("binds both one-use phases to the exact case and nonce", async () => {
    const harness = gateHarness({ probeRows: [[{ pid: 42 }]] });
    const gate = await createGate(harness);
    gate.observeTransactionLifecycle("began");

    await assert.rejects(
      gate.wait({
        ...request("query_active"),
        nonceDigest: "b".repeat(64)
      }),
      hasCode("invalid_gate_binding")
    );
    await assert.rejects(
      gate.wait({
        ...request("query_active"),
        extra: true
      }),
      hasCode("invalid_gate_binding")
    );
    await assert.rejects(
      gate.wait({
        ...request("query_active"),
        caseId: "case-14-timeout-during-graphhopper"
      }),
      hasCode("invalid_gate_binding")
    );

    await gate.wait(request("query_active"));
    await assert.rejects(
      gate.wait(request("query_active")),
      hasCode("gate_phase_reused")
    );
    await gate.dispose();
  });

  it("requires a separate control pool and leaves two product slots for query cancellation", async () => {
    const sharedPool = {
      options: {
        max: 2,
        application_name: "trailmind_staging_proof_v1"
      },
      async connect() {
        throw new Error("must not connect");
      }
    };
    await assert.rejects(
      createOutdoorAdventureStagingProofPostgresCancellationGateV1({
        productPool: sharedPool,
        controlPool: sharedPool,
        caseId: CASE_ID,
        nonceDigest: NONCE_DIGEST
      }),
      hasCode("invalid_dependencies")
    );

    const harness = gateHarness({ productPoolMaximum: 1 });
    await assert.rejects(
      createGate(harness),
      hasCode("invalid_dependencies")
    );
    assert.equal(harness.connectCount(), 0);
  });

  it("fails closed and releases its lock when no exact active query is observed", async () => {
    const harness = gateHarness({ probeRows: [[]] });
    const gate = await createGate(harness, {
      maximumPollAttempts: 1
    });
    gate.observeTransactionLifecycle("began");

    await assert.rejects(
      gate.wait(request("query_active")),
      hasCode("postgres_query_not_active")
    );
    assert.equal(harness.calls.at(-1).text, "ROLLBACK");
    assert.equal(harness.releaseArguments.length, 1);
  });

  it("aborts a stalled activity probe and releases the lock", async () => {
    const harness = gateHarness({ unresolvedProbe: true });
    const gate = await createGate(harness, {
      queryTimeoutMilliseconds: 100
    });
    gate.observeTransactionLifecycle("began");
    const controller = new AbortController();
    const waiting = gate.wait(
      request("query_active"),
      { signal: controller.signal }
    );
    controller.abort();

    await assert.rejects(
      waiting,
      hasCode("gate_wait_cancelled")
    );
    assert.equal(harness.calls.at(-1).text, "ROLLBACK");
    assert.equal(harness.releaseArguments.length, 1);
  });

  it("does not acknowledge query-active after a deferred abort", async () => {
    const controller = new AbortController();
    const harness = gateHarness({
      probeThenableAbort: () => controller.abort()
    });
    const gate = await createGate(harness);
    gate.observeTransactionLifecycle("began");

    await assert.rejects(
      gate.wait(
        request("query_active"),
        { signal: controller.signal }
      ),
      hasCode("gate_wait_cancelled")
    );
    assert.equal(harness.releaseArguments.length, 1);
  });

  it("rejects ambiguous or malformed activity observations and cleans up", async () => {
    for (const [rows, code] of [
      [[{ pid: 41 }, { pid: 42 }], "postgres_query_ambiguous"],
      [[{ pid: "42" }], "postgres_query_observation_invalid"],
      [[{ pid: 42, query: "unexpected" }],
        "postgres_query_observation_invalid"]
    ]) {
      const harness = gateHarness({ probeRows: [rows] });
      const gate = await createGate(harness, {
        maximumPollAttempts: 1
      });
      gate.observeTransactionLifecycle("began");
      await assert.rejects(
        gate.wait(request("query_active")),
        hasCode(code)
      );
      assert.equal(harness.calls.at(-1).text, "ROLLBACK");
      assert.equal(harness.releaseArguments.length, 1);
    }
  });

  it("rejects an out-of-order cancellation lifecycle and cannot report settlement", async () => {
    const harness = gateHarness({ probeRows: [[{ pid: 42 }]] });
    const gate = await createGate(harness);
    gate.observeTransactionLifecycle("began");
    await gate.wait(request("query_active"));

    gate.observeTransactionLifecycle(
      "rollback_completed_after_cancel"
    );
    await assert.rejects(
      gate.wait(request("cancel_settled")),
      hasCode("postgres_cancellation_lifecycle_invalid")
    );
    assert.equal(harness.calls.at(-1).text, "ROLLBACK");
    assert.equal(harness.releaseArguments.length, 1);
  });

  it("rejects duplicate lifecycle events after cancellation settlement", async () => {
    const harness = gateHarness({ probeRows: [[{ pid: 42 }]] });
    const gate = await createGate(harness);
    gate.observeTransactionLifecycle("began");
    await gate.wait(request("query_active"));
    gate.observeTransactionLifecycle(
      "query_cancelled_after_abort"
    );
    gate.observeTransactionLifecycle(
      "rollback_completed_after_cancel"
    );
    await gate.wait(request("cancel_settled"));

    assert.throws(
      () => gate.observeTransactionLifecycle(
        "rollback_completed_after_cancel"
      ),
      hasCode("postgres_cancellation_lifecycle_invalid")
    );
    await assert.rejects(
      gate.dispose(),
      hasCode("postgres_cancellation_lifecycle_invalid")
    );
  });

  it("does not acknowledge cancellation settlement after a deferred abort", async () => {
    const controller = new AbortController();
    const harness = gateHarness({
      probeRows: [[{ pid: 42 }]],
      rollbackThenableAbort: () => controller.abort()
    });
    const gate = await createGate(harness);
    gate.observeTransactionLifecycle("began");
    await gate.wait(request("query_active"));
    gate.observeTransactionLifecycle(
      "query_cancelled_after_abort"
    );
    gate.observeTransactionLifecycle(
      "rollback_completed_after_cancel"
    );

    await assert.rejects(
      gate.wait(
        request("cancel_settled"),
        { signal: controller.signal }
      ),
      hasCode("gate_wait_cancelled")
    );
  });

  it("destroys the control connection and fails when lock cleanup fails", async () => {
    const cleanupFailure = new Error("private cleanup detail");
    const harness = gateHarness({
      probeRows: [[{ pid: 42 }]],
      rollbackError: cleanupFailure
    });
    const gate = await createGate(harness, {
      maximumPollAttempts: 3
    });
    gate.observeTransactionLifecycle("began");
    await gate.wait(request("query_active"));
    const settled = gate.wait(request("cancel_settled"));
    gate.observeTransactionLifecycle(
      "query_cancelled_after_abort"
    );
    gate.observeTransactionLifecycle(
      "rollback_completed_after_cancel"
    );

    await assert.rejects(settled, hasCode("gate_cleanup_failed"));
    assert.equal(harness.releaseArguments.length, 1);
    assert.equal(harness.releaseArguments[0], cleanupFailure);
  });

  it("bounds a stalled rollback and destroys the control connection", async () => {
    const harness = gateHarness({ unresolvedRollback: true });
    const gate = await createGate(harness, {
      queryTimeoutMilliseconds: 10
    });

    await assert.rejects(
      gate.dispose(),
      hasCode("gate_cleanup_failed")
    );
    assert.equal(harness.releaseArguments.length, 1);
    assert.equal(
      harness.releaseArguments[0]?.code,
      "postgres_control_query_timeout"
    );
  });

  it("rolls back and releases when acquiring the disposable lock fails", async () => {
    const harness = gateHarness({
      lockError: new Error("private lock detail")
    });
    await assert.rejects(
      createGate(harness),
      hasCode("postgres_lock_unavailable")
    );
    assert.deepEqual(
      harness.calls.map((call) => call.text),
      [
        "BEGIN",
        "SELECT set_config('lock_timeout', $1, true)",
        "LOCK TABLE public.outdoor_evidence_regions IN ACCESS EXCLUSIVE MODE",
        "ROLLBACK"
      ]
    );
    assert.equal(harness.releaseArguments.length, 1);
  });
});

function request(phase) {
  return {
    schemaVersion: 1,
    caseId: CASE_ID,
    nonceDigest: NONCE_DIGEST,
    phase
  };
}

async function createGate(harness, overrides = {}) {
  return createOutdoorAdventureStagingProofPostgresCancellationGateV1({
    productPool: harness.productPool,
    controlPool: harness.controlPool,
    caseId: CASE_ID,
    nonceDigest: NONCE_DIGEST,
    pollIntervalMilliseconds: 1,
    maximumPollAttempts: 2,
    ...overrides
  });
}

function gateHarness({
  probeRows = [],
  productPoolMaximum = 2,
  lockError = null,
  rollbackError = null,
  unresolvedProbe = false,
  unresolvedRollback = false,
  probeThenableAbort = null,
  rollbackThenableAbort = null
} = {}) {
  const calls = [];
  const releaseArguments = [];
  let probes = 0;
  let connections = 0;
  const client = {
    query(text, values) {
      calls.push({ text, values });
      if (
        text ===
        "LOCK TABLE public.outdoor_evidence_regions IN ACCESS EXCLUSIVE MODE" &&
        lockError
      ) {
        throw lockError;
      }
      if (
        text ===
        outdoorAdventureStagingProofPostgresCancellationGateForTesting
          .activeQuery
      ) {
        if (unresolvedProbe) return new Promise(() => {});
        if (probeThenableAbort) {
          return deferredAbortThenable(
            { rows: [{ pid: 42 }] },
            probeThenableAbort
          );
        }
        const rows = probeRows[Math.min(
          probes,
          Math.max(0, probeRows.length - 1)
        )] ?? [];
        probes += 1;
        return { rows };
      }
      if (text === "ROLLBACK" && unresolvedRollback) {
        return new Promise(() => {});
      }
      if (text === "ROLLBACK" && rollbackThenableAbort) {
        return deferredAbortThenable(
          { rows: [] },
          rollbackThenableAbort
        );
      }
      if (text === "ROLLBACK" && rollbackError) {
        throw rollbackError;
      }
      return { rows: [] };
    },
    release(error) {
      releaseArguments.push(error);
    }
  };
  const productPool = {
    options: {
      max: productPoolMaximum,
      application_name: "trailmind_staging_proof_v1"
    },
    async connect() {
      throw new Error("the gate must not consume a product connection");
    }
  };
  const controlPool = {
    options: { max: 1 },
    async connect() {
      connections += 1;
      return client;
    }
  };
  return {
    calls,
    releaseArguments,
    productPool,
    controlPool,
    connectCount: () => connections
  };
}

function deferredAbortThenable(value, abort) {
  return {
    then(resolve) {
      resolve(value);
      queueMicrotask(abort);
    }
  };
}

function hasCode(expected) {
  return (error) => error?.code === expected;
}
