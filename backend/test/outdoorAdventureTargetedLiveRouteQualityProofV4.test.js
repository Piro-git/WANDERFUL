import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  loadServerLiveProofCasesV1
} from "../evaluation/outdoorAdventureServerLiveProof/manifest.js";
import {
  V4_AUTHORIZATION_REFERENCE,
  V4_BASELINE_COMMIT,
  V4_CASE_BINDINGS,
  V4_FLAG_NAMES,
  V4_MANIFEST_DIGEST,
  V4_PROOF_CLASSIFICATION,
  V4_PROOF_VERSION,
  V4_PROTECTED_RECEIPTS,
  V4_PROVIDER_CALL_LIMIT,
  V4_SCHEMA_VERSION,
  buildV4ManifestRecord,
  validateProtectedReceipts,
  validateProviderAccounting,
  validatePublishedV4AttemptOneReceipt,
  validateV4ManifestRecord,
  validateV4Summary
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/contract.js";
import {
  V4ProviderLedger,
  V4ProviderScheduler,
  parseRetryAfterMillisecondsV4,
  providerAccountingFromLedgerV4,
  validateV4ProviderLedger
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/providerControl.js";
import {
  notRunV4CaseRecord
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/quality.js";
import {
  disabledV4FlagSnapshot,
  runDisabledZeroWorkEndpointProbeV4,
  sampleSettledFreeStorageV4,
  scanConflictingProcessesV4
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/preflight.js";
import {
  buildStorageBlockedV4Summary
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/receipt.js";

const GOLDEN_SET_URL = new URL(
  "../../docs/route-quality/golden-set-v1/golden-cases-v1.json",
  import.meta.url
);
const PUBLISHED_V4_SUMMARY_URL = new URL(
  "../../docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4.summary.json",
  import.meta.url
);

describe("bounded V4 route-quality proof contract", () => {
  it("binds the exact canonical order and immutable Golden Set fixtures", async () => {
    const cases = await loadServerLiveProofCasesV1({
      caseIds: V4_CASE_BINDINGS.map((item) => item.caseId)
    });
    const golden = JSON.parse(await readFile(GOLDEN_SET_URL, "utf8"));
    const record = buildV4ManifestRecord(cases, golden.cases);

    assert.equal(record.digest, V4_MANIFEST_DIGEST);
    assert.equal(validateV4ManifestRecord(record), true);

    assert.throws(
      () => buildV4ManifestRecord([...cases].reverse(), golden.cases),
      errorCode("manifest_mismatch")
    );
    assert.throws(
      () => buildV4ManifestRecord([
        { ...cases[0], input: { ...cases[0].input, targetDistanceKm: 11 } },
        ...cases.slice(1)
      ], golden.cases),
      errorCode("manifest_mismatch")
    );
    assert.throws(
      () => buildV4ManifestRecord([
        { ...cases[0], id: "case-04-harz-brocken-must-have-landmark" },
        ...cases.slice(1)
      ], golden.cases),
      errorCode("manifest_mismatch")
    );
  });

  it("accepts a truthful provider-not-run terminal receipt", () => {
    assert.equal(validateV4Summary(blockedSummary()), true);
  });

  it("validates the published blocked V4 receipt", async () => {
    const receipt = JSON.parse(await readFile(PUBLISHED_V4_SUMMARY_URL, "utf8"));
    assert.equal(validatePublishedV4AttemptOneReceipt(receipt), true);
    assert.equal(receipt.status, "blocked");
    assert.equal(receipt.providerAccounting.attempted, 0);
    assert.equal(receipt.closedBetaEligible, false);
  });

  it("rejects material mutation of the published Attempt 1 receipt", async () => {
    const receipt = JSON.parse(await readFile(PUBLISHED_V4_SUMMARY_URL, "utf8"));
    receipt.blockedReasonCode = "database_passed";
    receipt.databasePreflightEvidence.storageGatePassed = true;
    assert.throws(
      () => validatePublishedV4AttemptOneReceipt(receipt),
      errorCode("published_receipt_mismatch")
    );
  });

  it("rejects zero executed cases, skips, substitutions, and reordered cases", () => {
    const zero = blockedSummary();
    zero.cases = zero.cases.map((item) => ({ ...item, executed: false }));
    assert.throws(() => validateV4Summary(zero), errorCode("zero_executed_cases"));

    const skipped = blockedSummary();
    skipped.cases[0].skipped = true;
    assert.throws(() => validateV4Summary(skipped));

    const substitute = blockedSummary();
    substitute.cases[0].caseId = substitute.cases[1].caseId;
    assert.throws(() => validateV4Summary(substitute));

    const reordered = blockedSummary();
    [reordered.cases[0], reordered.cases[1]] =
      [reordered.cases[1], reordered.cases[0]];
    assert.throws(() => validateV4Summary(reordered));
  });

  it("rejects modified fixture and manifest hashes", () => {
    const fixture = blockedSummary();
    fixture.cases[0].fixtureDigest = "0".repeat(64);
    assert.throws(() => validateV4Summary(fixture));

    const manifest = blockedSummary();
    manifest.manifest.digest = "0".repeat(64);
    assert.throws(
      () => validateV4Summary(manifest),
      errorCode("manifest_mismatch")
    );
  });

  it("never promotes technical success to product success", () => {
    const summary = blockedSummary();
    summary.cases[1] = passingCaseRecord(1, {
      route: brockenRoute({ distanceProductFit: false, distanceKm: 23.799 }),
      productQualityOutcome: "pass"
    });
    assert.throws(
      () => validateV4Summary(summary),
      errorCode("false_product_quality_pass")
    );
  });

  it("rejects product pass outside distance or duration quality boundaries", () => {
    const distance = blockedSummary();
    distance.cases[1] = passingCaseRecord(1, {
      route: brockenRoute({ distanceProductFit: false }),
      productQualityOutcome: "pass"
    });
    assert.throws(() => validateV4Summary(distance));

    const duration = blockedSummary();
    duration.cases[3] = passingCaseRecord(3, {
      route: easyRoute({ durationMinutes: 90, durationProductFit: false }),
      productQualityOutcome: "pass"
    });
    assert.throws(() => validateV4Summary(duration));
  });

  it("rejects product pass above 35 percent accidental repetition", () => {
    for (const field of ["selfBacktrackingRatio", "selfOverlapRatio"]) {
      const summary = blockedSummary();
      summary.cases[1] = passingCaseRecord(1, {
        route: brockenRoute({ [field]: 0.3501 }),
        productQualityOutcome: "pass"
      });
      assert.throws(() => validateV4Summary(summary), field);
    }
  });

  it("never treats passes-near, not-reached, or unverified must-haves as reached", () => {
    for (const approachState of ["passes_near", "not_reached", "unverified"]) {
      const summary = blockedSummary();
      summary.cases[1] = passingCaseRecord(1, {
        route: brockenRoute({
          technicalEligible: false,
          strictlyReachedRequiredHighlightCount: 0,
          highlightApproachStates: [approachState],
          rejectionCodes: ["required_highlight_not_reached"]
        }),
        technicalPipelineOutcome: "fail",
        productQualityOutcome: "pass"
      });
      assert.throws(() => validateV4Summary(summary), approachState);
    }
  });

  it("rejects incomplete evidence, access, proposal, provider, result, or quality lineage", () => {
    for (const field of ["provenanceComplete", "accessLineageComplete"]) {
      const summary = blockedSummary();
      summary.cases[1] = passingCaseRecord(1, {
        route: brockenRoute({
          [field]: false,
          technicalEligible: false,
          rejectionCodes: ["incomplete_lineage"]
        }),
        technicalPipelineOutcome: "pass",
        productQualityOutcome: "partial"
      });
      assert.throws(() => validateV4Summary(summary), field);
    }
  });

  it("rejects call 16, concurrency above one, starts below 2 seconds, retries, and probes", () => {
    const mutations = [
      { attempted: 16 },
      { maximumConcurrencyObserved: 2 },
      { attempted: 2, successful: 2, unused: 13,
        minimumObservedStartSpacingMilliseconds: 1_999 },
      { retriesAttempted: 1 },
      { probesAfterCircuitOpen: 1 }
    ];
    for (const mutation of mutations) {
      const accounting = {
        ...providerAccounting(),
        ...mutation
      };
      assert.throws(() => validateProviderAccounting(accounting));
    }
  });

  it("rejects malformed or excessive Retry-After and accepts only positive bounded seconds", async () => {
    assert.equal(parseRetryAfterMillisecondsV4("0"), null);
    assert.equal(parseRetryAfterMillisecondsV4("-1"), null);
    assert.equal(parseRetryAfterMillisecondsV4("tomorrow"), null);
    assert.equal(parseRetryAfterMillisecondsV4("16"), null);
    assert.equal(parseRetryAfterMillisecondsV4("15"), 15_000);
    assert.equal(parseRetryAfterMillisecondsV4("2.5"), 2_500);

    let now = 0;
    const scheduler = new V4ProviderScheduler({
      nowMilliseconds: () => now,
      sleep: async (milliseconds) => { now += milliseconds; }
    });
    const caseId = V4_CASE_BINDINGS[0].caseId;
    await scheduler.beforeCall(caseId);
    scheduler.observe({
      caseId,
      outcome: "failed",
      failureCode: "routing_rate_limited",
      durationMilliseconds: 100,
      retryAfterHeader: "16"
    });
    await assert.rejects(
      scheduler.beforeCall(caseId),
      errorCode("provider_case_stopped")
    );
    assert.equal(scheduler.receipt().invalidRetryAfterStoppedCase, true);

    const summary = blockedSummary();
    summary.providerAccounting.invalidRetryAfterObserved = true;
    summary.providerAccounting.invalidRetryAfterStoppedCase = false;
    assert.throws(() => validateV4Summary(summary));
  });

  it("opens the circuit after two same-class immediate failures and makes no probe", async () => {
    let now = 0;
    const scheduler = new V4ProviderScheduler({
      nowMilliseconds: () => now,
      sleep: async (milliseconds) => { now += milliseconds; }
    });
    const caseId = V4_CASE_BINDINGS[0].caseId;
    for (let index = 0; index < 2; index += 1) {
      await scheduler.beforeCall(caseId);
      scheduler.observe({
        caseId,
        outcome: "failed",
        failureCode: "routing_rate_limited",
        durationMilliseconds: 100,
        retryAfterHeader: null
      });
    }
    const receipt = scheduler.receipt();
    assert.equal(receipt.circuitOpened, true);
    assert.equal(receipt.circuitStopHonored, true);
    assert.equal(receipt.probesAfterCircuitOpen, 0);
  });

  it("rejects an imbalanced ledger", () => {
    assert.throws(() => validateProviderAccounting({
      ...providerAccounting(),
      attempted: 1,
      unused: 14
    }), errorCode("provider_accounting_invalid"));
  });

  it("requires a genuine success before controlled failure and never relabels it", () => {
    const beforeSuccess = blockedSummary();
    beforeSuccess.cases[0].controlledSurvivor.injectionArmed = true;
    assert.throws(
      () => validateV4Summary(beforeSuccess),
      errorCode("controlled_failure_before_success")
    );

    const relabelled = blockedSummary();
    relabelled.cases[0].controlledSurvivor.successRelabelledAsFailure = true;
    assert.throws(
      () => validateV4Summary(relabelled),
      errorCode("controlled_success_relabelled")
    );

    assert.throws(() => validateProviderAccounting({
      ...providerAccounting(),
      attempted: 1,
      successful: 0,
      failed: 1,
      controlledPostSuccessFailures: 1,
      unused: 14
    }));
  });

  it("rejects cleanup failure and any final enabled flag", () => {
    const cleanup = blockedSummary();
    cleanup.cleanup.cleanupComplete = false;
    assert.throws(
      () => validateV4Summary(cleanup),
      errorCode("cleanup_failed")
    );

    const flag = blockedSummary();
    flag.featureFlags.final.flags.ROUTE_PROVIDER_ENABLED = true;
    assert.throws(() => validateV4Summary(flag));
  });

  it("rejects secrets, URLs, database URLs, prompts, coordinates, geometry, App Attest material, temporary paths, and unbounded errors", () => {
    const sentinels = [
      { rawPrompt: "private prompt" },
      { coordinates: [1, 2] },
      { geometry: [[1, 2], [3, 4]] },
      { providerUrl: "https://graphhopper.example" },
      { databaseUrl: "postgresql://example" },
      { credential: "secret" },
      { appAttestMaterial: "assertion" },
      { temporaryPath: "/private/tmp/v4" },
      { unbounded: "https://example.invalid/very-long-error" }
    ];
    for (const sentinel of sentinels) {
      const summary = blockedSummary();
      summary.privacy.sentinel = sentinel;
      assert.throws(() => validateV4Summary(summary), JSON.stringify(sentinel));
    }
  });

  it("rejects any mutation of a protected historical receipt", () => {
    const receipts = protectedReceipts();
    receipts[0].afterSha256 = "0".repeat(64);
    assert.throws(
      () => validateProtectedReceipts(receipts),
      errorCode("protected_receipt_mismatch")
    );

    const summary = blockedSummary();
    summary.protectedHistoricalReceipts[1].unchanged = false;
    assert.throws(() => validateV4Summary(summary));
  });

  it("admits only absent or exact-false V4 flags while blocked", () => {
    const snapshot = disabledV4FlagSnapshot({
      ROUTE_PROVIDER_ENABLED: "false"
    });
    assert.equal(snapshot.flags.ROUTE_PROVIDER_ENABLED, false);
    assert.throws(
      () => disabledV4FlagSnapshot({ ROUTE_PROVIDER_ENABLED: "0" }),
      errorCode("v4_flag_not_exact_false")
    );
    assert.throws(
      () => disabledV4FlagSnapshot({ ROUTE_PROVIDER_ENABLED: "true" }),
      errorCode("v4_flag_not_exact_false")
    );
  });

  it("samples settled storage and fails the hard 10 GiB gate closed", async () => {
    let calls = 0;
    const sample = await sampleSettledFreeStorageV4({
      path: "/proof",
      settleMilliseconds: 0,
      statfsImpl: async () => {
        calls += 1;
        return { bavail: calls === 1 ? 9n : 8n, bsize: 1024n ** 3n };
      },
      sleep: async () => {}
    });
    assert.deepEqual(sample, {
      sampleCount: 2,
      settledFreeGiB: 8,
      requiredFreeGiB: 10,
      passed: false
    });
  });

  it("proves the disabled V2 endpoint performs zero dependency work", async () => {
    const receipt = await runDisabledZeroWorkEndpointProbeV4();
    assert.equal(receipt.passed, true);
    assert.equal(receipt.authorizationOperations, 0);
    assert.equal(receipt.databaseOperations, 0);
    assert.equal(receipt.providerOperations, 0);
    assert.equal(receipt.budgetOperations, 0);
    assert.equal(receipt.leaseOperations, 0);
    assert.equal(receipt.orchestratorOperations, 0);
  });

  it("reports only bounded process classifications", async () => {
    const calls = [];
    const result = await scanConflictingProcessesV4({
      ignoredProcessIds: [42, 43],
      execFileImpl: async (file, args) => {
        calls.push([file, args]);
        if (args.includes("postgres")) return { stdout: "84\n" };
        const error = Object.assign(new Error("not found"), { code: 1 });
        throw error;
      }
    });
    assert.equal(calls.length, 5);
    assert.deepEqual(result.conflictClasses, ["postgres"]);
    assert.equal(result.passed, false);
  });

  it("builds a schema-valid blocked receipt without collapsing outcomes", () => {
    const summary = buildStorageBlockedV4Summary({
      generatedAt: "2026-08-04T22:57:25.000Z",
      storage: {
        sampleCount: 2,
        settledFreeGiB: 8.56,
        requiredFreeGiB: 10,
        passed: false
      },
      processPreflight: {
        checkedClassCount: 5,
        conflictClassCount: 0,
        conflictClasses: [],
        passed: true
      },
      disabledProbe: {
        passed: true,
        authorizationOperations: 0,
        databaseOperations: 0,
        providerOperations: 0,
        budgetOperations: 0,
        leaseOperations: 0,
        orchestratorOperations: 0
      },
      protectedHistoricalReceipts: protectedReceipts()
    });
    assert.equal(validateV4Summary(summary), true);
    assert.equal(summary.decisions.databasePreflight, "blocked");
    assert.equal(summary.cases[0].technicalPipelineOutcome, "not_run");
    assert.equal(summary.cases[0].productQualityOutcome, "not_applicable");
    assert.equal(summary.providerAccounting.attempted, 0);
  });
});

describe("bounded V4 provider ledger", () => {
  it("reserves atomically, enforces order/concurrency, and reconciles success", async () => {
    const root = await mkdtemp(join(tmpdir(), "trailmind-v4-ledger-"));
    const path = join(root, "provider-ledger.json");
    const ledger = new V4ProviderLedger(path, { nowMilliseconds: () => 0 });
    try {
      await ledger.initialize();
      const sequence = await ledger.reserve({
        caseId: V4_CASE_BINDINGS[0].caseId,
        proposalOrdinal: 1
      });
      await assert.rejects(
        ledger.reserve({
          caseId: V4_CASE_BINDINGS[0].caseId,
          proposalOrdinal: 2
        }),
        errorCode("provider_concurrency_exceeded")
      );
      await assert.rejects(
        ledger.markControlledPostSuccessFailure(sequence),
        errorCode("controlled_failure_before_success")
      );
      await ledger.settle(sequence, {
        outcome: "success",
        durationMilliseconds: 800,
        failureCode: null
      });
      await ledger.markControlledPostSuccessFailure(sequence);
      const snapshot = await ledger.snapshot();
      assert.equal(validateV4ProviderLedger(snapshot), true);
      const accounting = providerAccountingFromLedgerV4(snapshot, {
        maximumConcurrencyObserved: 1,
        minimumObservedStartSpacingMilliseconds: null,
        circuitOpened: false,
        circuitStopHonored: true,
        probesAfterCircuitOpen: 0,
        invalidRetryAfterObserved: false,
        invalidRetryAfterStoppedCase: false
      });
      assert.equal(accounting.successful, 1);
      assert.equal(accounting.failed, 0);
      assert.equal(accounting.controlledPostSuccessFailures, 1);
      assert.equal(validateProviderAccounting(accounting), true);
    } finally {
      await ledger.close().catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects provider call 16", () => {
    const calls = Array.from({ length: V4_PROVIDER_CALL_LIMIT + 1 },
      (_, index) => ({
        sequence: index + 1,
        caseId: V4_CASE_BINDINGS[Math.min(3, Math.floor(index / 3))].caseId,
        proposalOrdinal: index % 3 + 1,
        reservationTimeBucket: "minute_0",
        outcome: "success",
        durationBucket: "under_1s",
        failureCode: null,
        controlledPostSuccessFailure: false
      }));
    assert.throws(() => validateV4ProviderLedger({
      schemaVersion: 1,
      authorizationReference: V4_AUTHORIZATION_REFERENCE,
      hardLimit: V4_PROVIDER_CALL_LIMIT,
      calls
    }), errorCode("invalid_provider_ledger"));
  });

  it("spaces call starts by at least 2,000 ms", async () => {
    let now = 10_000;
    const scheduler = new V4ProviderScheduler({
      nowMilliseconds: () => now,
      sleep: async (milliseconds) => { now += milliseconds; }
    });
    const caseId = V4_CASE_BINDINGS[0].caseId;
    await scheduler.beforeCall(caseId);
    scheduler.observe({
      caseId,
      outcome: "success",
      failureCode: null,
      durationMilliseconds: 100,
      retryAfterHeader: null
    });
    now += 500;
    await scheduler.beforeCall(caseId);
    scheduler.observe({
      caseId,
      outcome: "success",
      failureCode: null,
      durationMilliseconds: 100,
      retryAfterHeader: null
    });
    assert.equal(
      scheduler.receipt().minimumObservedStartSpacingMilliseconds,
      2_000
    );
  });
});

function blockedSummary() {
  return {
    schemaVersion: V4_SCHEMA_VERSION,
    proofVersion: V4_PROOF_VERSION,
    proofClassification: V4_PROOF_CLASSIFICATION,
    baselineCommit: V4_BASELINE_COMMIT,
    candidateCommit: V4_BASELINE_COMMIT,
    authorizationReference: V4_AUTHORIZATION_REFERENCE,
    generatedAt: "2026-08-05T00:00:00.000Z",
    status: "blocked",
    manifest: manifestRecord(),
    decisions: {
      databasePreflight: "blocked",
      physicalAppAttest: "not_run",
      providerProof: "not_run",
      routeQuality: "not_run",
      cleanupAndContainment: "passed"
    },
    physicalAppAttestReceiptPresent: false,
    cases: V4_CASE_BINDINGS.map((item) =>
      structuredClone(notRunV4CaseRecord(item.caseId, "preflight_blocked"))
    ),
    providerAccounting: providerAccounting(),
    featureFlags: featureFlags(false),
    cleanup: {
      cleanupComplete: true,
      finalFlagsDisabled: true,
      disabledZeroWorkProbePassed: true,
      disabledZeroWorkDatabaseOperations: 0,
      disabledZeroWorkProviderOperations: 0,
      providerCredentialRemovedFromProofProcess: true,
      poolsClosed: true,
      leasesReleased: true,
      taskOwnedArtifactsRemoved: true
    },
    protectedHistoricalReceipts: protectedReceipts(),
    privacy: {
      forbiddenFieldCount: 0,
      rawProviderMaterialRetained: false,
      routeShapeRetained: false,
      preciseLocationRetained: false,
      unboundedErrorRetained: false,
      appAttestMaterialRetained: false
    },
    manualExpertReview: {
      completed: false,
      classification: "not_completed"
    },
    closedBetaEligible: false,
    deployed: false,
    released: false,
    committed: false,
    pushed: false
  };
}

function manifestRecord() {
  return {
    digest: V4_MANIFEST_DIGEST,
    bindings: V4_CASE_BINDINGS.map((item) => ({
      caseId: item.caseId,
      goldenCaseId: item.goldenCaseId,
      fixtureDigest: item.fixtureDigest,
      goldenCaseDigest: item.goldenCaseDigest
    }))
  };
}

function providerAccounting() {
  return {
    hardLimit: V4_PROVIDER_CALL_LIMIT,
    maximumConcurrencyAllowed: 1,
    minimumCallStartSpacingMilliseconds: 2_000,
    attempted: 0,
    successful: 0,
    failed: 0,
    timedOut: 0,
    cancelled: 0,
    controlledPostSuccessFailures: 0,
    unused: V4_PROVIDER_CALL_LIMIT,
    reconciled: true,
    maximumConcurrencyObserved: 0,
    minimumObservedStartSpacingMilliseconds: null,
    retriesAttempted: 0,
    probesAfterCircuitOpen: 0,
    attempt16Prevented: true,
    circuitOpened: false,
    circuitStopHonored: true,
    invalidRetryAfterObserved: false,
    invalidRetryAfterStoppedCase: false
  };
}

function featureFlags(execution) {
  const allFalse = Object.fromEntries(V4_FLAG_NAMES.map((name) => [name, false]));
  const executionFlags = { ...allFalse };
  if (execution) {
    executionFlags.OUTDOOR_RESEARCH_PLANNING_ENABLED = true;
    executionFlags.OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED = true;
    executionFlags.ROUTE_PROVIDER_ENABLED = true;
  }
  return {
    initial: { exactAdmissionVerified: true, flags: { ...allFalse } },
    execution: {
      exactAdmissionVerified: true,
      flags: executionFlags
    },
    final: { exactAdmissionVerified: true, flags: { ...allFalse } }
  };
}

function protectedReceipts() {
  return V4_PROTECTED_RECEIPTS.map((item) => ({
    repoRelativePath: item.repoRelativePath,
    beforeSha256: item.sha256,
    afterSha256: item.sha256,
    unchanged: true
  }));
}

function passingCaseRecord(index, {
  route,
  technicalPipelineOutcome = "pass",
  productQualityOutcome = "pass"
}) {
  const binding = V4_CASE_BINDINGS[index];
  return {
    caseId: binding.caseId,
    goldenCaseId: binding.goldenCaseId,
    fixtureDigest: binding.fixtureDigest,
    goldenCaseDigest: binding.goldenCaseDigest,
    executed: true,
    skipped: false,
    providerExecuted: true,
    observedPlanningState: binding.expectedPlanningState,
    expectedPlanningState: binding.expectedPlanningState,
    technicalPipelineOutcome,
    expectedTechnicalPipelineOutcome:
      binding.expectedTechnicalPipelineOutcome,
    productQualityOutcome,
    expectedProductQualityOutcome:
      binding.expectedProductQualityOutcome,
    caseEvaluationOutcome: "fail",
    providerAttemptCount: 1,
    routes: [{ ...route, selected: true }],
    controlledSurvivor: binding.controlledSurvivor ? {
      injectionArmed: true,
      genuineProviderSuccessBeforeInjection: true,
      successRelabelledAsFailure: false,
      independentSurvivorTechnicalPass: true,
      independentSurvivorProductPass: true,
      resultCode: "independent_product_survivor"
    } : null,
    manualExpertReview: "not_completed"
  };
}

function brockenRoute(overrides = {}) {
  return routeRecord({
    requiredHighlightCount: 1,
    selectedRequiredHighlightCount: 1,
    strictlyReachedRequiredHighlightCount: 1,
    highlightApproachStates: ["reached"],
    allHighlightApproachStates: ["reached"],
    selectedWaypointCount: 1,
    reachedWaypointCount: 1,
    maximumRouteToAccessDistanceMeters: 5,
    maximumRouteToEvidenceDistanceMeters: 5,
    distanceKm: 15,
    durationMinutes: 240,
    ascentMeters: 700,
    ...overrides
  });
}

function easyRoute(overrides = {}) {
  return routeRecord({
    requiredHighlightCount: 1,
    selectedRequiredHighlightCount: 1,
    strictlyReachedRequiredHighlightCount: 1,
    highlightApproachStates: ["reached"],
    allHighlightApproachStates: ["reached"],
    selectedWaypointCount: 1,
    reachedWaypointCount: 1,
    maximumRouteToAccessDistanceMeters: 5,
    maximumRouteToEvidenceDistanceMeters: 5,
    distanceKm: 2.8,
    durationMinutes: 60,
    ascentMeters: 150,
    ...overrides
  });
}

function routeRecord(overrides = {}) {
  return {
    resultDigest: "result_0123456789abcdef01234567",
    technicalEligible: true,
    selected: true,
    verifiedGeometry: true,
    regionContained: true,
    provenanceComplete: true,
    accessLineageComplete: true,
    waypointOrderVerified: true,
    loopClosureVerified: true,
    distanceStructuralFit: true,
    durationStructuralFit: true,
    distanceKm: 12,
    durationMinutes: 180,
    ascentMeters: 500,
    descentMeters: 500,
    targetDistanceDeviationRatio: 0,
    targetDurationDeviationRatio: null,
    maximumProviderSnapDistanceMeters: 10,
    aggregateProviderSnapDistanceMeters: 20,
    maximumRouteToAccessDistanceMeters: null,
    maximumRouteToEvidenceDistanceMeters: null,
    providerSnapCount: 2,
    selectedWaypointCount: 0,
    reachedWaypointCount: 0,
    selfBacktrackingRatio: 0.2,
    selfOverlapRatio: 0.2,
    loopShapeQuality: 0.2,
    distanceProductFit: true,
    durationProductFit: null,
    difficultyCompatible: true,
    requiredHighlightCount: 0,
    selectedRequiredHighlightCount: 0,
    strictlyReachedRequiredHighlightCount: 0,
    highlightApproachStates: [],
    allHighlightApproachStates: [],
    evidenceLineageDigest: "lineage_0123456789abcdef01234567",
    accessLineageDigest: "lineage_0123456789abcdef01234567",
    providerResultClassification: "technically_eligible",
    falseClaimCount: 0,
    rejectionCodes: [],
    limitationCodes: [],
    ...overrides
  };
}

function errorCode(code) {
  return (error) => error?.code === code;
}
