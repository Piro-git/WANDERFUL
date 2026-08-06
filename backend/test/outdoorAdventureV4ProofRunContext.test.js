import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  V4_CASE_BINDINGS,
  V4_MANIFEST_DIGEST
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/contract.js";
import {
  captureV4ProofRunContextAfterImports,
  reconcileV4DatabaseClockEvidence,
  runV4DatabasePlanningClockGate
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/databaseGate.js";
import {
  V4_PROOF_FRESHNESS_LIMIT_MILLISECONDS,
  V4_PROOF_RUN_CONTEXT_SCHEMA_VERSION,
  V4_PROOF_RUN_CONTEXT_VERSION,
  admitV4ProviderAfterClockReconciliation,
  bindV4FutureReceiptClock,
  canonicalProofTimestampV4,
  createV4DatabaseClockDiagnostic,
  createV4ProofClockBinding,
  createV4ProofRunContext,
  validateV4FutureReceiptClock,
  validateV4ProofRunContext
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/proofRunContext.js";

const PROOF_AS_OF = "2026-08-06T20:45:00.000Z";
const OBSERVED_AT = "2026-08-06T20:45:00.000Z";

describe("V4 run-scoped proof clock", () => {
  it("accepts and seals one canonical UTC proofAsOf", () => {
    const context = contextFixture();
    assert.equal(validateV4ProofRunContext(context), true);
    assert.equal(context.proofAsOf, PROOF_AS_OF);
    assert.equal(context.clock().toISOString(), PROOF_AS_OF);
    assert.equal(Object.isFrozen(context), true);
    assert.equal(Object.isFrozen(context.evidenceSnapshots), true);
  });

  it("rejects malformed, impossible, ambiguous, offset and noncanonical clocks", () => {
    const invalid = [
      "2026-02-30T12:00:00.000Z",
      "2026-08-06T20:45:00Z",
      "2026-08-06T20:45:00.00Z",
      "2026-08-06T20:45:00.0000Z",
      "2026-08-06T20:45:00.000+00:00",
      "2026-08-06T22:45:00.000+02:00",
      "2026-08-06 20:45:00.000Z",
      "2026-08-06T20:45:00.000Z trailing",
      "not-a-date"
    ];
    for (const value of invalid) {
      assert.throws(() => canonicalProofTimestampV4(value),
        hasCode("invalid_proof_timestamp"), value);
    }
    assert.throws(() => canonicalProofTimestampV4(new Date(Number.NaN)),
      hasCode("invalid_proof_timestamp"));
  });

  it("rejects proofAsOf before each evaluated temporal boundary", () => {
    const cases = [
      ["proof_before_source_data", "2026-08-05T19:00:00.000Z"],
      ["proof_before_retrieval", "2026-08-06T19:55:00.000Z"],
      ["proof_before_import", "2026-08-06T20:05:00.000Z"],
      ["proof_before_active_snapshot", "2026-08-06T20:15:00.000Z"]
    ];
    for (const [code, proofAsOf] of cases) {
      assert.throws(() => contextFixture({ proofAsOf }), hasCode(code));
    }
  });

  it("preserves Attempt 5's exact historical fixed-clock failure", () => {
    assert.throws(
      () => contextFixture({ proofAsOf: "2026-08-05T21:30:00.000Z" }),
      hasCode("proof_before_retrieval")
    );
  });

  it("rejects stale evidence even when proofAsOf is current", () => {
    const stale = snapshotsFixture().map((snapshot) => ({
      ...snapshot,
      sourceDataAt: "2026-07-20T20:21:23.000Z"
    }));
    assert.throws(() => contextFixture({ evidenceSnapshots: stale }),
      hasCode("stale_proof_evidence"));
  });

  it("rejects excessive future skew without clamping the supplied clock", () => {
    assert.throws(() => contextFixture({
      proofAsOf: "2026-08-06T20:10:00.000Z",
      observedAt: "2026-08-06T20:00:00.000Z",
      evidenceSnapshots: snapshotsFixture().map((snapshot) => ({
        ...snapshot,
        retrievedAt: "2026-08-06T19:30:00.000Z",
        importedAt: "2026-08-06T19:40:00.000Z",
        activeSnapshotAt: "2026-08-06T19:50:00.000Z"
      }))
    }), hasCode("proof_clock_future_skew"));
  });

  it("captures only after active snapshot evidence is read and only once", async () => {
    const events = [];
    const pool = poolFixture(databaseRows(), () => events.push("query"));
    const context = await captureV4ProofRunContextAfterImports({
      pool,
      authorizationReference: "USER_AUTHORIZED_FUTURE_V4_TEST",
      ledgerNamespace: "outdoor-adventure-v4-future-test",
      clock() {
        events.push("clock");
        return new Date(PROOF_AS_OF);
      }
    });
    assert.deepEqual(events, ["query", "clock"]);
    assert.equal(context.proofAsOf, PROOF_AS_OF);
  });

  it("checks a captured clock against the database observation skew bound", async () => {
    await assert.rejects(() => captureV4ProofRunContextAfterImports({
      pool: poolFixture(databaseRows()),
      authorizationReference: "USER_AUTHORIZED_FUTURE_V4_TEST",
      ledgerNamespace: "outdoor-adventure-v4-future-test",
      clock: () => new Date("2026-08-06T20:51:00.000Z")
    }), hasCode("proof_clock_future_skew"));
  });

  it("uses the identical sealed clock across every canonical case", async () => {
    const context = contextFixture();
    const observed = [];
    const cases = V4_CASE_BINDINGS.map(({ caseId }) => ({ id: caseId }));
    const intents = new Map(cases.map(({ id }) => [id, { id }]));
    const diagnostic = await runV4DatabasePlanningClockGate({
      runContext: context,
      cases,
      intents,
      repository: {},
      ...planningStubs(),
      async researchAdventure(_intent, dependencies) {
        observed.push(dependencies.clock().toISOString());
        return { state: "ready" };
      }
    });
    assert.deepEqual(observed, Array(4).fill(PROOF_AS_OF));
    assert(diagnostic.cases.every((record) =>
      record.proofAsOf === PROOF_AS_OF && record.researchState === "ready" &&
      record.planningState === "ready" && record.proposalCount === 1
    ));
  });

  it("lets Attempt 6-style current imports reach deterministic ready planning", async () => {
    const context = contextFixture();
    const cases = V4_CASE_BINDINGS.map(({ caseId }) => ({ id: caseId }));
    const intents = new Map(cases.map(({ id }) => [id, { id }]));
    const diagnostic = await runV4DatabasePlanningClockGate({
      runContext: context,
      cases,
      intents,
      repository: {},
      ...planningStubs(),
      async researchAdventure(_intent, dependencies) {
        const proof = dependencies.clock().getTime();
        const newestImport = Math.max(...context.evidenceSnapshots.map(
          (snapshot) => new Date(snapshot.importedAt).getTime()
        ));
        return { state: proof >= newestImport ? "ready" : "unsupported" };
      }
    });
    assert.equal(diagnostic.cases.length, 4);
    assert(diagnostic.cases.every((record) =>
      record.researchState === "ready" && record.planningState === "ready"
    ));
  });

  it("rejects Harz/Innsbruck, diagnostic, and receipt clock mismatches", () => {
    const context = contextFixture();
    assert.throws(() => createV4DatabaseClockDiagnostic(context, []),
      hasCode("database_diagnostic_clock_mismatch"));
    assert.throws(() => createV4DatabaseClockDiagnostic(context, [
      { caseId: "harz", proofAsOf: PROOF_AS_OF },
      { caseId: "innsbruck", proofAsOf: "2026-08-06T20:45:01.000Z" }
    ]), hasCode("database_diagnostic_clock_mismatch"));

    const diagnostic = diagnosticFixture(context);
    const binding = createV4ProofClockBinding(context, diagnostic);
    const receipt = bindV4FutureReceiptClock(
      { receiptVersion: "future-v4-test" },
      context,
      diagnostic,
      binding
    );
    assert.equal(validateV4FutureReceiptClock(
      receipt, context, diagnostic
    ), true);
    assert.throws(() => validateV4FutureReceiptClock({
      ...receipt,
      proofAsOf: "2026-08-06T20:45:01.000Z"
    }, context, diagnostic), hasCode("receipt_clock_mismatch"));
    assert.throws(() => createV4ProofClockBinding(context, {
      ...diagnostic,
      proofAsOf: "2026-08-06T20:45:01.000Z"
    }), hasCode("database_diagnostic_clock_mismatch"));
  });

  it("binds proofAsOf and all retrieval/import times into the semantic digest", () => {
    const first = receiptFixture(contextFixture());
    const changedSnapshots = snapshotsFixture().map((snapshot, index) =>
      index === 0 ? {
        ...snapshot,
        retrievedAt: "2026-08-06T19:50:01.000Z"
      } : snapshot
    );
    const second = receiptFixture(contextFixture({
      evidenceSnapshots: changedSnapshots
    }));
    assert.notEqual(first.proofRunContextDigest, second.proofRunContextDigest);
    assert.notEqual(first.semanticReceiptSha256,
      second.semanticReceiptSha256);
    assert.throws(() => validateV4FutureReceiptClock({
      ...first,
      semanticReceiptSha256: "0".repeat(64)
    }, contextFixture(), diagnosticFixture(contextFixture())),
    hasCode("semantic_receipt_digest_mismatch"));
  });

  it("reconciles the sealed active snapshots immediately before admission", async () => {
    const context = contextFixture();
    assert.equal(await reconcileV4DatabaseClockEvidence(
      poolFixture(databaseRows()), context
    ), true);
    const changed = databaseRows();
    changed[0].active_snapshot_at = "2026-08-06T20:40:01.000Z";
    await assert.rejects(
      () => reconcileV4DatabaseClockEvidence(poolFixture(changed), context),
      hasCode("database_snapshot_changed_after_clock_seal")
    );
  });

  it("fails missing or mismatched clocks before any provider admission", async () => {
    const context = contextFixture();
    const diagnostic = diagnosticFixture(context);
    const binding = createV4ProofClockBinding(context, diagnostic);
    const invalidInputs = [
      {},
      { runContext: context, databaseDiagnostic: diagnostic },
      {
        runContext: context,
        databaseDiagnostic: diagnostic,
        proofClockBinding: { ...binding, proofAsOf: "2026-08-06T20:45:01.000Z" }
      }
    ];
    for (const input of invalidInputs) {
      let providerCalls = 0;
      await assert.rejects(
        () => admitV4ProviderAfterClockReconciliation(input, async () => {
          providerCalls += 1;
        })
      );
      assert.equal(providerCalls, 0);
    }
  });

  it("keeps provider calls at zero when a planning clock gate fails", async () => {
    const context = contextFixture();
    const cases = V4_CASE_BINDINGS.map(({ caseId }) => ({ id: caseId }));
    const intents = new Map(cases.map(({ id }) => [id, { id }]));
    let providerCalls = 0;
    await assert.rejects(() => runV4DatabasePlanningClockGate({
      runContext: context,
      cases,
      intents,
      repository: {},
      async researchAdventure() { return { state: "unsupported" }; }
    }), hasCode("database_preprovider_plan_unsupported"));
    assert.equal(providerCalls, 0);
  });
});

function contextFixture(overrides = {}) {
  const observedAt = overrides.observedAt ?? OBSERVED_AT;
  return createV4ProofRunContext({
    schemaVersion: V4_PROOF_RUN_CONTEXT_SCHEMA_VERSION,
    contractVersion: V4_PROOF_RUN_CONTEXT_VERSION,
    authorizationReference: "USER_AUTHORIZED_FUTURE_V4_TEST",
    ledgerNamespace: "outdoor-adventure-v4-future-test",
    caseManifestDigest: V4_MANIFEST_DIGEST,
    proofAsOf: PROOF_AS_OF,
    evidenceSnapshots: snapshotsFixture(),
    ...without(overrides, "observedAt")
  }, { observedAt });
}

function snapshotsFixture() {
  return ["harz-v1", "innsbruck-alps-v1"].map((regionId) => ({
    regionId,
    sourceDataAt: "2026-08-05T20:21:23.000Z",
    retrievedAt: "2026-08-06T20:00:00.000Z",
    importedAt: "2026-08-06T20:10:00.000Z",
    activeSnapshotAt: "2026-08-06T20:20:00.000Z",
    freshnessLimitMilliseconds: V4_PROOF_FRESHNESS_LIMIT_MILLISECONDS
  }));
}

function databaseRows() {
  return snapshotsFixture().map((snapshot) => ({
    region_id: snapshot.regionId,
    source_data_at: snapshot.sourceDataAt,
    retrieved_at: snapshot.retrievedAt,
    imported_at: snapshot.importedAt,
    active_snapshot_at: snapshot.activeSnapshotAt,
    observed_at: PROOF_AS_OF,
    freshness_limit_days: 14
  }));
}

function poolFixture(rows, observer = () => {}) {
  return {
    async query() {
      observer();
      return { rows: structuredClone(rows) };
    }
  };
}

function receiptFixture(context) {
  const diagnostic = diagnosticFixture(context);
  const binding = createV4ProofClockBinding(context, diagnostic);
  return bindV4FutureReceiptClock(
    { receiptVersion: "future-v4-test" },
    context,
    diagnostic,
    binding
  );
}

function diagnosticFixture(context) {
  return createV4DatabaseClockDiagnostic(
    context,
    V4_CASE_BINDINGS.map(({ caseId }) => ({
      caseId,
      proofAsOf: context.proofAsOf,
      researchState: "ready",
      planningState: "ready",
      proposalCount: 1
    }))
  );
}

function planningStubs() {
  return {
    buildCandidatePlan: () => ({ state: "ready", proposals: [{}] }),
    validateCandidatePlan: (plan) => plan,
    validateCandidatePlanForResearch: () => true
  };
}

function without(value, key) {
  const result = { ...value };
  delete result[key];
  return result;
}

function hasCode(code) {
  return (error) => error?.code === code;
}
