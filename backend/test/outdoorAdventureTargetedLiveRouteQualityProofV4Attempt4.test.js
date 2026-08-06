import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  V4_ATTEMPT_FOUR_AUTHORIZATION_REFERENCE,
  V4_ATTEMPT_FOUR_LEDGER_NAMESPACE,
  V4_ATTEMPT_FOUR_LEDGER_SHA256,
  V4_ATTEMPT_FOUR_PRIOR_RECEIPTS,
  validateV4AttemptFourReceipt
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/attempt4Contract.js";
import {
  V4_CASE_BINDINGS,
  V4_PROVIDER_CALL_LIMIT
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/contract.js";
import {
  V4ProviderLedger,
  V4ProviderScheduler,
  createV4MeteredGraphHopperProvider,
  providerAccountingFromLedgerV4,
  validateV4ProviderLedger
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/providerControl.js";
import {
  outdoorResearchRepositoryQueriesForTesting
} from "../src/outdoorResearch/postgresOutdoorResearchRepository.js";
import { routeError } from "../src/routing/routeErrors.js";
import { validateRouteRequest } from "../src/routing/routeValidation.js";
import {
  graphHopperResponse,
  multiPointLoopRequest
} from "./routeTestSupport.js";

const RECEIPT_URL = new URL(
  "../../docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4_ATTEMPT_4.summary.json",
  import.meta.url
);
const PROVIDER_ENV = Object.freeze({
  GRAPHHOPPER_API_KEY: "attempt-four-test-only-key"
});

describe("V4 Attempt 4 receipt and fail-closed regressions", () => {
  it("validates the distinct credential-blocked Attempt 4 receipt", async () => {
    const receipt = await loadReceipt();
    assert.equal(validateV4AttemptFourReceipt(receipt), true);
    assert.equal(receipt.ledgerSha256, V4_ATTEMPT_FOUR_LEDGER_SHA256);
    assert.equal(receipt.providerAccounting.attempted, 0);
    assert.equal(receipt.providerAccounting.unused, 15);
  });

  it("rejects mutation of all three prior attempts", async () => {
    for (const attemptName of ["attemptOne", "attemptTwo", "attemptThree"]) {
      const receipt = await loadReceipt();
      receipt.priorAttempts[attemptName].summarySha256 = "0".repeat(64);
      assert.throws(() => validateV4AttemptFourReceipt(receipt));
    }
    assert.equal(
      V4_ATTEMPT_FOUR_PRIOR_RECEIPTS.attemptThree.summarySha256,
      "9bd4fb94f67c997961254d70fbe58317dd40b4ef6ec111de90a81e3c3b5e2522"
    );
  });

  it("rejects provider or route-quality promotion after credential admission failed", async () => {
    const provider = await loadReceipt();
    provider.providerAccounting.attempted = 1;
    provider.providerAccounting.failed = 1;
    provider.providerAccounting.unused = 14;
    assert.throws(() => validateV4AttemptFourReceipt(provider));

    const route = await loadReceipt();
    route.decisions.routeQuality = "failed";
    assert.throws(() => validateV4AttemptFourReceipt(route));
  });

  it("rejects a database false-green, cleanup failure, or sensitive durable value", async () => {
    const database = await loadReceipt();
    database.databasePreflightEvidence.projections.harz
      .repeatStatus = "active";
    assert.throws(() => validateV4AttemptFourReceipt(database));

    const cleanup = await loadReceipt();
    cleanup.cleanup.temporaryLedgerRemoved = false;
    assert.throws(() => validateV4AttemptFourReceipt(cleanup));

    const sensitive = await loadReceipt();
    sensitive.debug = { providerUrl: "redacted" };
    assert.throws(() => validateV4AttemptFourReceipt(sensitive));
  });

  it("rejects mutation of performance, publisher, or verification evidence", async () => {
    const performance = await loadReceipt();
    performance.databasePreflightEvidence.queryAndPerformance
      .accessP95ThresholdMilliseconds = 999_999;
    assert.throws(() => validateV4AttemptFourReceipt(performance));

    const publisher = await loadReceipt();
    publisher.databasePreflightEvidence.publisherInputs[0].verified = false;
    assert.throws(() => validateV4AttemptFourReceipt(publisher));

    const verification = await loadReceipt();
    verification.verification.goldenSetCaseCount = 0;
    assert.throws(() => validateV4AttemptFourReceipt(verification));
  });

  it("materializes requested highlights before containment and spatial access", () => {
    const query = outdoorResearchRepositoryQueriesForTesting
      .trailAccessCandidates;
    assert.match(query, /requested AS MATERIALIZED/);
    assert.match(query, /requested_highlights AS MATERIALIZED/);
    assert(
      query.indexOf("requested_highlights AS MATERIALIZED") <
      query.indexOf("highlights AS MATERIALIZED")
    );
    assert.match(
      query,
      /outdoor_research_projection_entities_trail_geography_gist_idx|projected_geometry::geography/
    );
  });

  it("rolls back a ledger I/O failure without recording a provider start", async () => {
    const fixture = await ledgerFixture();
    let fetchCount = 0;
    const provider = createV4MeteredGraphHopperProvider({
      caseId: V4_CASE_BINDINGS[0].caseId,
      controlledFailureAfterFirstSuccess: false,
      env: PROVIDER_ENV,
      ledger: fixture.ledger,
      scheduler: fixture.scheduler,
      fetchImpl: async () => {
        fetchCount += 1;
        return Response.json(graphHopperResponse());
      }
    });
    const ledgerPath = fixture.ledger.path;
    try {
      fixture.ledger.path = fixture.root;
      await assert.rejects(
        provider.route(request()),
        (error) => error?.code === "invalid_provider_ledger"
      );
      fixture.ledger.path = ledgerPath;

      const emptySnapshot = await fixture.ledger.snapshot();
      const emptyAccounting = providerAccountingFromLedgerV4(
        emptySnapshot,
        fixture.scheduler.receipt(),
        ledgerIdentity()
      );
      assert.equal(fetchCount, 0);
      assert.equal(emptyAccounting.attempted, 0);
      assert.equal(fixture.scheduler.active, 0);
      assert.equal(
        fixture.scheduler.receipt().maximumConcurrencyObserved,
        0
      );
      assert.equal(
        fixture.scheduler.receipt().minimumObservedStartSpacingMilliseconds,
        null
      );

      const result = await provider.route(request());
      assert.equal(result.provider, "graphhopper");
      const recoveredSnapshot = await fixture.ledger.snapshot();
      assert.equal(fetchCount, 1);
      assert.equal(recoveredSnapshot.calls.length, 1);
      assert.equal(recoveredSnapshot.calls[0].proposalOrdinal, 1);
      assert.equal(recoveredSnapshot.calls[0].outcome, "success");
      assert.equal(fixture.scheduler.active, 0);
      assert.equal(
        fixture.scheduler.receipt().minimumObservedStartSpacingMilliseconds,
        null
      );
    } finally {
      fixture.ledger.path = ledgerPath;
      await fixture.dispose();
    }
  });

  it("rolls back a locked ledger reservation rejection", async () => {
    await assertLockedReservationRollsBack();
  });

  it("rolls back the ledger hard-limit rejection", async () => {
    await assertHardLimitReservationRollsBack();
  });

  it("uses scheduler admissions as foreign-safe single-use tokens", async () => {
    let now = 0;
    const scheduler = new V4ProviderScheduler({
      nowMilliseconds: () => now,
      sleep: async (milliseconds) => { now += milliseconds; }
    });
    const foreignScheduler = new V4ProviderScheduler({
      nowMilliseconds: () => now,
      sleep: async (milliseconds) => { now += milliseconds; }
    });
    const caseId = V4_CASE_BINDINGS[0].caseId;

    const rolledBack = await scheduler.beforeCall(caseId);
    assert.throws(
      () => foreignScheduler.rollbackAdmission(rolledBack),
      schedulerError
    );
    scheduler.rollbackAdmission(rolledBack);
    assert.throws(
      () => scheduler.rollbackAdmission(rolledBack),
      schedulerError
    );

    const observed = await scheduler.beforeCall(caseId);
    scheduler.commitAdmission(observed);
    assert.throws(
      () => scheduler.rollbackAdmission(observed),
      schedulerError
    );
    scheduler.observe(observed, {
      caseId,
      outcome: "success",
      failureCode: null,
      durationMilliseconds: 100,
      retryAfterHeader: null
    });
    assert.throws(
      () => scheduler.rollbackAdmission(observed),
      schedulerError
    );

    const pending = await scheduler.beforeCall(caseId);
    assert.throws(
      () => scheduler.rollbackAdmission(observed),
      schedulerError
    );
    scheduler.rollbackAdmission(pending);
    assert.equal(scheduler.active, 0);
  });

  it("preserves ordinary metered-provider outcomes", async () => {
    const scenarios = [
      {
        name: "success",
        response: async () => Response.json(graphHopperResponse()),
        expectedOutcome: "success",
        expectedFailureCode: null,
        expectedErrorCode: null
      },
      {
        name: "provider failure",
        response: async () => Response.json(
          { message: "unavailable" }, { status: 503 }
        ),
        expectedOutcome: "failed",
        expectedFailureCode: "routing_unavailable",
        expectedErrorCode: "routing_unavailable"
      },
      {
        name: "timeout",
        response: async () => { throw routeError("route_timed_out"); },
        expectedOutcome: "timed_out",
        expectedFailureCode: "route_timed_out",
        expectedErrorCode: "route_timed_out"
      },
      {
        name: "cancellation",
        response: async ({ controller }) => {
          controller.abort();
          throw new Error("cancelled");
        },
        expectedOutcome: "cancelled",
        expectedFailureCode: "request_cancelled",
        expectedErrorCode: "request_cancelled"
      },
      {
        name: "rate limiting",
        response: async () => Response.json(
          { message: "rate limited" },
          { status: 429, headers: { "Retry-After": "2.5" } }
        ),
        expectedOutcome: "failed",
        expectedFailureCode: "routing_rate_limited",
        expectedErrorCode: "routing_rate_limited"
      }
    ];

    for (const scenario of scenarios) {
      const fixture = await ledgerFixture();
      const controller = new AbortController();
      let fetchCount = 0;
      const provider = createV4MeteredGraphHopperProvider({
        caseId: V4_CASE_BINDINGS[0].caseId,
        controlledFailureAfterFirstSuccess: false,
        env: PROVIDER_ENV,
        ledger: fixture.ledger,
        scheduler: fixture.scheduler,
        fetchImpl: async () => {
          fetchCount += 1;
          return scenario.response({ controller });
        }
      });
      try {
        if (scenario.expectedErrorCode === null) {
          const result = await provider.route(request(), {
            signal: controller.signal
          });
          assert.equal(result.provider, "graphhopper", scenario.name);
        } else {
          await assert.rejects(
            provider.route(request(), { signal: controller.signal }),
            (error) => error?.code === scenario.expectedErrorCode
          );
        }
        const snapshot = await fixture.ledger.snapshot();
        assert.equal(fetchCount, 1, scenario.name);
        assert.equal(snapshot.calls.length, 1, scenario.name);
        assert.equal(snapshot.calls[0].outcome,
          scenario.expectedOutcome, scenario.name);
        assert.equal(snapshot.calls[0].failureCode,
          scenario.expectedFailureCode, scenario.name);
        assert.equal(fixture.scheduler.active, 0, scenario.name);
        assert.equal(
          fixture.scheduler.receipt().maximumConcurrencyObserved,
          1,
          scenario.name
        );
      } finally {
        await fixture.dispose();
      }
    }
  });

  it("injects the controlled failure after the first genuine success, not the first ordinal", async () => {
    const fixture = await ledgerFixture();
    let fetchCount = 0;
    const provider = createV4MeteredGraphHopperProvider({
      caseId: V4_CASE_BINDINGS[0].caseId,
      controlledFailureAfterFirstSuccess: true,
      env: PROVIDER_ENV,
      ledger: fixture.ledger,
      scheduler: fixture.scheduler,
      fetchImpl: async () => {
        fetchCount += 1;
        return fetchCount === 1
          ? Response.json({ message: "unavailable" }, { status: 503 })
          : Response.json(graphHopperResponse());
      }
    });
    try {
      await assert.rejects(
        provider.route(request()),
        (error) => error?.code === "routing_unavailable"
      );
      await assert.rejects(
        provider.route(request()),
        (error) => error?.code === "routing_unavailable"
      );
      const survivor = await provider.route(request());
      assert.equal(survivor.provider, "graphhopper");
      const snapshot = await fixture.ledger.snapshot();
      assert.equal(validateV4ProviderLedger(snapshot, ledgerIdentity()), true);
      assert.deepEqual(snapshot.calls.map((call) => ({
        outcome: call.outcome,
        controlled: call.controlledPostSuccessFailure
      })), [
        { outcome: "failed", controlled: false },
        { outcome: "success", controlled: true },
        { outcome: "success", controlled: false }
      ]);
    } finally {
      await fixture.dispose();
    }
  });

  it("opens after two matching immediate rate limits and performs no later egress", async () => {
    const fixture = await ledgerFixture();
    let fetchCount = 0;
    const provider = createV4MeteredGraphHopperProvider({
      caseId: V4_CASE_BINDINGS[0].caseId,
      controlledFailureAfterFirstSuccess: false,
      env: PROVIDER_ENV,
      ledger: fixture.ledger,
      scheduler: fixture.scheduler,
      fetchImpl: async () => {
        fetchCount += 1;
        return Response.json({ message: "rate limited" }, { status: 429 });
      }
    });
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await assert.rejects(
          provider.route(request()),
          (error) => error?.code === "routing_rate_limited"
        );
      }
      await assert.rejects(
        provider.route(request()),
        (error) => error?.code === "provider_circuit_open"
      );
      assert.equal(fetchCount, 2);
      assert.equal((await fixture.ledger.snapshot()).calls.length, 2);
      assert.deepEqual(fixture.scheduler.receipt(), {
        maximumConcurrencyObserved: 1,
        minimumObservedStartSpacingMilliseconds: 2_000,
        circuitOpened: true,
        circuitStopHonored: true,
        probesAfterCircuitOpen: 0,
        invalidRetryAfterObserved: false,
        invalidRetryAfterStoppedCase: false
      });
    } finally {
      await fixture.dispose();
    }
  });
});

async function ledgerFixture() {
  const root = await mkdtemp(join(tmpdir(), "trailmind-v4a4-ledger-"));
  let now = 0;
  const ledger = new V4ProviderLedger(join(root, "ledger.json"), {
    nowMilliseconds: () => now,
    ...ledgerIdentity()
  });
  await ledger.initialize();
  const scheduler = new V4ProviderScheduler({
    nowMilliseconds: () => now,
    sleep: async (milliseconds) => { now += milliseconds; }
  });
  return {
    root,
    ledger,
    scheduler,
    async dispose() {
      await ledger.close().catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  };
}

async function assertLockedReservationRollsBack() {
  const fixture = await ledgerFixture();
  let fetchCount = 0;
  const sequence = await fixture.ledger.reserve({
    caseId: V4_CASE_BINDINGS[0].caseId,
    proposalOrdinal: 1
  });
  const provider = createV4MeteredGraphHopperProvider({
    caseId: V4_CASE_BINDINGS[0].caseId,
    controlledFailureAfterFirstSuccess: false,
    env: PROVIDER_ENV,
    ledger: fixture.ledger,
    scheduler: fixture.scheduler,
    fetchImpl: async () => {
      fetchCount += 1;
      return Response.json(graphHopperResponse());
    }
  });
  try {
    await assert.rejects(
      provider.route(request()),
      (error) => error?.code === "provider_concurrency_exceeded"
    );
    const snapshot = await fixture.ledger.snapshot();
    assert.equal(fetchCount, 0);
    assert.equal(snapshot.calls.length, 1);
    assert.equal(snapshot.calls[0].sequence, sequence);
    assert.equal(snapshot.calls[0].outcome, "reserved");
    assert.equal(fixture.scheduler.active, 0);
    assert.equal(fixture.scheduler.receipt().maximumConcurrencyObserved, 0);
    assert.equal(
      fixture.scheduler.receipt().minimumObservedStartSpacingMilliseconds,
      null
    );
    await fixture.ledger.settle(sequence, {
      outcome: "cancelled",
      durationMilliseconds: 0,
      failureCode: "request_cancelled"
    });
  } finally {
    await fixture.dispose();
  }
}

async function assertHardLimitReservationRollsBack() {
  const fixture = await ledgerFixture();
  let fetchCount = 0;
  const fullLedger = fullProviderLedger();
  await writeFile(
    fixture.ledger.path,
    `${JSON.stringify(fullLedger)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  const provider = createV4MeteredGraphHopperProvider({
    caseId: V4_CASE_BINDINGS.at(-1).caseId,
    controlledFailureAfterFirstSuccess: false,
    env: PROVIDER_ENV,
    ledger: fixture.ledger,
    scheduler: fixture.scheduler,
    fetchImpl: async () => {
      fetchCount += 1;
      return Response.json(graphHopperResponse());
    }
  });
  try {
    assert.equal((await fixture.ledger.snapshot()).calls.length,
      V4_PROVIDER_CALL_LIMIT);
    await assert.rejects(
      provider.route(request()),
      (error) => error?.code === "provider_call_limit_reached"
    );
    const snapshot = await fixture.ledger.snapshot();
    const accounting = providerAccountingFromLedgerV4(
      snapshot,
      fixture.scheduler.receipt(),
      ledgerIdentity()
    );
    assert.equal(fetchCount, 0);
    assert.equal(accounting.attempted, V4_PROVIDER_CALL_LIMIT);
    assert.equal(accounting.unused, 0);
    assert.equal(fixture.scheduler.active, 0);
    assert.equal(fixture.scheduler.receipt().maximumConcurrencyObserved, 0);
    assert.equal(
      fixture.scheduler.receipt().minimumObservedStartSpacingMilliseconds,
      null
    );
  } finally {
    await fixture.dispose();
  }
}

function fullProviderLedger() {
  const counts = [3, 3, 3, V4_PROVIDER_CALL_LIMIT - 9];
  let sequence = 0;
  return {
    schemaVersion: 1,
    ...ledgerIdentity(),
    hardLimit: V4_PROVIDER_CALL_LIMIT,
    calls: V4_CASE_BINDINGS.flatMap((binding, caseIndex) =>
      Array.from({ length: counts[caseIndex] }, (_, ordinalIndex) => ({
        sequence: ++sequence,
        caseId: binding.caseId,
        proposalOrdinal: ordinalIndex + 1,
        reservationTimeBucket: "minute_0",
        outcome: "success",
        durationBucket: "under_1s",
        failureCode: null,
        controlledPostSuccessFailure: false
      })))
  };
}

function schedulerError(error) {
  return error?.code === "invalid_provider_scheduler";
}

function ledgerIdentity() {
  return {
    authorizationReference: V4_ATTEMPT_FOUR_AUTHORIZATION_REFERENCE,
    ledgerNamespace: V4_ATTEMPT_FOUR_LEDGER_NAMESPACE
  };
}

function request() {
  return validateRouteRequest(multiPointLoopRequest());
}

async function loadReceipt() {
  return JSON.parse(await readFile(RECEIPT_URL, "utf8"));
}
