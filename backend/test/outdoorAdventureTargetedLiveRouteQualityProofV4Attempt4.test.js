import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
  V4_CASE_BINDINGS
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/contract.js";
import {
  V4ProviderLedger,
  V4ProviderScheduler,
  createV4MeteredGraphHopperProvider,
  validateV4ProviderLedger
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/providerControl.js";
import {
  outdoorResearchRepositoryQueriesForTesting
} from "../src/outdoorResearch/postgresOutdoorResearchRepository.js";
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
    ledger,
    scheduler,
    async dispose() {
      await ledger.close().catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  };
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
