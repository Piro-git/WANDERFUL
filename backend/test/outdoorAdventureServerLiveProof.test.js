import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ProviderUsageLedgerV1,
  createMeteredGraphHopperProviderV1,
  reassessSanitizedCaseReceiptV1,
  validateServerLiveProofLedgerContinuityV1
} from "../evaluation/outdoorAdventureServerLiveProof/harness.js";
import {
  reconcileServerLiveProofSummaryV1,
  sealServerLiveProofCleanupV1
} from "../evaluation/outdoorAdventureServerLiveProof/reconciliation.js";
import {
  SERVER_LIVE_PROOF_CASE_IDS,
  SERVER_LIVE_PROOF_AUTHORIZATION_V1,
  SERVER_LIVE_PROOF_FEATURE_FLAGS,
  loadServerLiveProofCasesV1,
  safeProofDigestV1,
  serverLiveProofCanonicalIntentV1,
  validateDisposableLoopbackDatabaseUrlV1,
  validateServerLiveProofAuthorizationV1,
  validateServerLiveProofPublishedSummaryV1
} from "../evaluation/outdoorAdventureServerLiveProof/manifest.js";
import {
  evaluateServerLiveRouteQualityV1,
  pairwiseSimilarityV1
} from "../evaluation/outdoorAdventureServerLiveProof/quality.js";

describe("outdoor adventure server live proof", () => {
  it("loads only the bounded reviewed fixture subset", async () => {
    const cases = await loadServerLiveProofCasesV1();
    assert.deepEqual(cases.map((item) => item.id), SERVER_LIVE_PROOF_CASE_IDS);
    const intent = serverLiveProofCanonicalIntentV1(cases[0].input);
    assert.equal(intent.activity, "hiking");
    assert.equal(intent.routeType, "loop");
    assert.equal(intent.geographicAnchor.name, "Ilsenburg");
    assert.deepEqual(intent.preferredExperiences, ["forest", "viewpoint"]);
  });

  it("requires exact live authorization and a disposable loopback database", () => {
    const authorization = {
      liveTraffic: SERVER_LIVE_PROOF_AUTHORIZATION_V1.liveTraffic,
      credentialContainment:
        SERVER_LIVE_PROOF_AUTHORIZATION_V1.credentialContainment,
      providerCallBudget: 25,
      reviewedFixtureManifest:
        SERVER_LIVE_PROOF_AUTHORIZATION_V1.reviewedFixtureManifest,
      disposableDatabase:
        SERVER_LIVE_PROOF_AUTHORIZATION_V1.disposableDatabase
    };
    assert.equal(validateServerLiveProofAuthorizationV1(authorization), true);
    for (const override of [
      { liveTraffic: null },
      { credentialContainment: "" },
      { providerCallBudget: 24 },
      { reviewedFixtureManifest: "unreviewed" },
      { disposableDatabase: "" }
    ]) {
      assert.throws(
        () => validateServerLiveProofAuthorizationV1({
          ...authorization,
          ...override
        }),
        hasCode("live_authorization_missing")
      );
    }
    for (const accepted of [
      "postgresql://proof@127.0.0.1/trailmind_server_proof",
      "postgresql://proof@[::1]/trailmind_disposable_test"
    ]) {
      assert.equal(validateDisposableLoopbackDatabaseUrlV1(accepted), true);
    }
    for (const rejected of [
      "postgresql://proof@db.example.com/trailmind_server_proof",
      "postgresql://proof@localhost/trailmind_production",
      "postgresql://proof@localhost/trailmind",
      "not-a-database-url"
    ]) {
      assert.throws(
        () => validateDisposableLoopbackDatabaseUrlV1(rejected),
        (error) => [
          "database_configuration_missing",
          "database_not_disposable_loopback"
        ].includes(error?.code)
      );
    }
  });

  it("imports every proof script without executing live work", async () => {
    await Promise.all([
      import("../scripts/run-outdoor-adventure-server-live-proof.js"),
      import("../scripts/reconcile-outdoor-adventure-server-live-proof.js"),
      import("../scripts/seal-outdoor-adventure-server-live-proof-cleanup.js")
    ]);
  });

  it("schema-validates publication and rejects sensitive durable fields", () => {
    const summary = failedBaseSummary();
    assert.equal(validateServerLiveProofPublishedSummaryV1(summary), summary);
    for (const sensitive of [
      { databaseUrl: "postgresql://user:secret@localhost/trailmind_test" },
      { evidence: { acquisition: { latitude: 51.0 } } },
      { providerDiagnostic: { authorization_token: "must-not-persist" } }
    ]) {
      assert.throws(
        () => validateServerLiveProofPublishedSummaryV1({
          ...summary,
          ...sensitive
        }),
        hasCode("invalid_published_summary")
      );
    }
    assert.throws(
      () => validateServerLiveProofPublishedSummaryV1({
        ...summary,
        cases: summary.cases.map((receipt, index) => index === 0
          ? { ...receipt, region: "innsbruck-alps-v1" }
          : receipt)
      }),
      hasCode("invalid_published_summary")
    );
    assert.throws(
      () => validateServerLiveProofPublishedSummaryV1({
        ...summary,
        status: "passed",
        failureReasons: []
      }),
      hasCode("invalid_published_summary")
    );
  });

  it("validates the durable failed proof without geometry or live approval", async () => {
    const summary = JSON.parse(await readFile(new URL(
      "../../docs/release/OUTDOOR_ADVENTURE_SERVER_SIDE_LIVE_PIPELINE_PROOF_V1.summary.json",
      import.meta.url
    ), "utf8"));
    assert.equal(validateServerLiveProofPublishedSummaryV1(summary), summary);
    assert.equal(summary.status, "failed");
    assert.equal(summary.closedBetaEligible, false);
    assert.deepEqual(summary.providerCalls, {
      limit: 25,
      exactAttempted: 25,
      successful: 16,
      failed: 9,
      timedOut: 0,
      cancelled: 0,
      controlledFailureAfterSuccess: 0
    });
    assert.equal(JSON.stringify(summary).includes("coordinates"), false);
  });

  it("derives structural, waypoint, path-detail, and ranking receipts without geometry output", () => {
    const geometry = [
      [10.0000, 51.0000],
      [10.0200, 51.0000],
      [10.0200, 51.0150],
      [10.0000, 51.0150],
      [10.0000, 51.0000]
    ];
    const reversed = [...geometry].reverse();
    assert.ok(pairwiseSimilarityV1(geometry, reversed) > 0.95);
    const result = evaluateServerLiveRouteQualityV1({
      caseId: SERVER_LIVE_PROOF_CASE_IDS[0],
      input: {
        targetDistanceKm: 6,
        maximumTechnicalDifficulty: null,
        preferredExperiences: ["viewpoint"],
        avoidedExperiences: []
      },
      routedAlternatives: {
        attempts: [
          {
            state: "routed",
            provenance: {
              proposalId: "rrcpv1_0123456789abcdef0123456789abcdef",
              selectedWaypoints: [{ evidenceClaimIds: [crypto.randomUUID()] }],
              mappedNetworkCandidates: [{ sourceBasis: "mapped" }],
              knownLimitations: ["access_unverified"]
            },
            routeResults: [{
              routeResultId: "rrrav1_0123456789abcdef0123456789abcdef_path_1",
              geometryProvider: "graphhopper",
              routingStrategy: "backend",
              path: {
                distance: 6_100,
                time: 5_400_000,
                ascend: 250,
                descend: 250,
                points: { type: "LineString", coordinates: geometry },
                details: {
                  surface: [[0, 4, "ground"]],
                  road_class: [[0, 4, "path"]],
                  hike_rating: [[0, 4, "1"]]
                }
              },
              waypointVisits: [
                visit(0, "anchor", null, 4),
                visit(1, "via", crypto.randomUUID(), 6),
                visit(2, "return_anchor", null, 3)
              ]
            }]
          },
          {
            state: "routed",
            provenance: {
              proposalId: "rrcpv1_1123456789abcdef0123456789abcdef",
              selectedWaypoints: [{ evidenceClaimIds: [crypto.randomUUID()] }],
              mappedNetworkCandidates: [{ sourceBasis: "mapped" }],
              knownLimitations: ["access_unverified"]
            },
            routeResults: [
              {
                routeResultId: "rrrav1_1123456789abcdef0123456789abcdef_path_1",
                geometryProvider: "graphhopper",
                routingStrategy: "backend",
                path: {
                  distance: 6_000,
                  time: 5_000_000,
                  points: {
                    type: "LineString",
                    coordinates: [
                      [10.0000, 51.0000],
                      [10.0200, 51.0000],
                      [10.0000, 51.0000],
                      [10.0200, 51.0000],
                      [10.0000, 51.0000]
                    ]
                  },
                  details: {}
                },
                waypointVisits: [
                  visit(0, "anchor", null, 4),
                  visit(1, "via", crypto.randomUUID(), 150),
                  visit(2, "return_anchor", null, 3)
                ]
              },
              {
                routeResultId: "rrrav1_1123456789abcdef0123456789abcdef_path_2",
                geometryProvider: "graphhopper",
                routingStrategy: "backend",
                path: {
                  distance: 20_000,
                  time: 9_000_000,
                  points: { type: "LineString", coordinates: geometry },
                  details: {}
                },
                waypointVisits: [
                  visit(0, "anchor", null, 4),
                  visit(1, "via", crypto.randomUUID(), 5),
                  visit(2, "return_anchor", null, 3)
                ]
              }
            ]
          },
          {
            state: "failed",
            provenance: {
              proposalId: "rrcpv1_2123456789abcdef0123456789abcdef",
              selectedWaypoints: [],
              mappedNetworkCandidates: [],
              knownLimitations: ["provider_failure"]
            },
            routeResults: [],
            failureCode: "provider_failure"
          }
        ]
      }
    });
    assert.equal(result.providerOrderUsedAsRanking, false);
    assert.equal(result.eligibleCount, 1);
    assert.equal(result.selectedCount, 1);
    assert.equal(result.rejectionCount, 2);
    assert.equal(result.routes[0].genuineLoop, true);
    assert.equal(result.routes[0].reachedSelectedWaypointRatio, 1);
    assert.ok(result.routes[0].pathAndTrackRatio > 0.9);
    assert.equal(result.routes[0].maximumKnownHikeRating, 1);
    assert.ok(Array.isArray(result.routes[0]._geometry));
    assert.ok(result.routes[1].rejectionReasons.includes(
      "excessive_backtracking"
    ));
    assert.ok(result.routes[1].rejectionReasons.includes("excessive_snapping"));
    assert.ok(result.routes[2].rejectionReasons.includes(
      "distance_outside_hard_envelope"
    ));
  });

  it("meters a real provider-shaped response before a controlled pipeline failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "trailmind-live-proof-test-"));
    const ledgerPath = join(directory, "usage.json");
    let ledger;
    try {
      ledger = new ProviderUsageLedgerV1(ledgerPath);
      await ledger.initialize();
      const provider = createMeteredGraphHopperProviderV1({
        caseId: SERVER_LIVE_PROOF_CASE_IDS.at(-1),
        controlledFailureAfterFirstSuccess: true,
        env: {
          GRAPHHOPPER_API_KEY: "test-only-placeholder",
          GRAPHHOPPER_BASE_URL: "https://graphhopper.com/api/1"
        },
        ledger,
        async fetchImpl() {
          return new Response(JSON.stringify({
            paths: [{
              distance: 1_000,
              time: 600_000,
              ascend: 30,
              descend: 30,
              points: {
                type: "LineString",
                coordinates: [[10, 51], [10.01, 51], [10, 51]]
              },
              instructions: [],
              details: {
                surface: [[0, 2, "ground"]],
                road_class: [[0, 2, "path"]],
                hike_rating: [[0, 2, "1"]]
              }
            }],
            snapped_waypoints: {
              type: "LineString",
              coordinates: [[10, 51]]
            }
          }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
      });
      await assert.rejects(
        provider.route({
          profile: "foot",
          routeType: "loop",
          points: [{ latitude: 51, longitude: 10 }],
          algorithm: "round_trip",
          roundTrip: { distanceMeters: 1_000, seed: 11 },
          locale: "en",
          includePathDetails: ["surface", "road_class", "hike_rating"]
        }),
        (error) => error?.code === "routing_unavailable"
      );
      const snapshot = await ledger.snapshot();
      assert.equal(snapshot.calls.length, 1);
      assert.equal(snapshot.calls[0].outcome, "success");
      assert.equal(
        snapshot.calls[0].pipelineDisposition,
        "controlled_failure_after_success"
      );
      assert.ok(snapshot.calls[0].responseBytes > 0);
      assert.equal(snapshot.calls[0].returnedPathCount, 1);
      const serialized = await readFile(ledgerPath, "utf8");
      assert.doesNotMatch(serialized, /test-only-placeholder/);
      assert.doesNotMatch(serialized, /graphhopper\.com/);
      assert.doesNotMatch(serialized, /coordinates/);
    } finally {
      await ledger?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reserves the hard provider budget atomically under concurrency", async () => {
    const directory = await mkdtemp(join(tmpdir(), "trailmind-live-proof-budget-"));
    const ledgerPath = join(directory, "usage.json");
    let ledger;
    try {
      ledger = new ProviderUsageLedgerV1(ledgerPath);
      await ledger.initialize();
      const competingLedger = new ProviderUsageLedgerV1(ledgerPath);
      await assert.rejects(
        competingLedger.initialize(),
        hasCode("invalid_usage_ledger")
      );
      const callIds = await Promise.all(Array.from({ length: 25 }, (_, index) =>
        ledger.reserve({
          caseId: SERVER_LIVE_PROOF_CASE_IDS[index %
            SERVER_LIVE_PROOF_CASE_IDS.length],
          callDigest: `call_${String(index + 1).padStart(24, "0")}`,
          requestedWaypointCount: 3
        })
      ));
      assert.deepEqual(callIds, Array.from({ length: 25 }, (_, index) => index + 1));
      await assert.rejects(
        ledger.reserve({
          caseId: SERVER_LIVE_PROOF_CASE_IDS[0],
          callDigest: "call_over_budget",
          requestedWaypointCount: 3
        }),
        hasCode("provider_call_limit_reached")
      );
      assert.equal((await ledger.snapshot()).calls.length, 25);
      await ledger.close();
      ledger = null;
      await competingLedger.initialize();
      await competingLedger.close();
    } finally {
      await ledger?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("cannot reset or detach the provider ledger across phased and diagnostic runs", () => {
    const priorSummary = failedBaseSummary();
    const calls = Array.from({ length: 24 }, (_, index) => ({
      callId: index + 1,
      caseId: SERVER_LIVE_PROOF_CASE_IDS[index %
        SERVER_LIVE_PROOF_CASE_IDS.length],
      outcome: index < 15 ? "success" : "failed"
    }));
    assert.throws(
      () => validateServerLiveProofLedgerContinuityV1({
        cases: [{ id: SERVER_LIVE_PROOF_CASE_IDS[0] }],
        priorSummary: null,
        diagnosticMode: false,
        maximumProposals: 3,
        ledger: { calls }
      }),
      hasCode("invalid_usage_ledger_transition")
    );
    assert.doesNotThrow(() => validateServerLiveProofLedgerContinuityV1({
      cases: [{ id: "case-07-innsbruck-viewpoint-loop" }],
      priorSummary: null,
      diagnosticMode: true,
      maximumProposals: 1,
      ledger: { calls }
    }));
    assert.throws(
      () => validateServerLiveProofLedgerContinuityV1({
        cases: [{ id: "case-07-innsbruck-viewpoint-loop" }],
        priorSummary: null,
        diagnosticMode: true,
        maximumProposals: 1,
        ledger: { calls: calls.slice(0, 23) }
      }),
      hasCode("invalid_usage_ledger_transition")
    );
    assert.throws(
      () => validateServerLiveProofLedgerContinuityV1({
        cases: [{ id: SERVER_LIVE_PROOF_CASE_IDS.at(-1) }],
        priorSummary,
        diagnosticMode: false,
        maximumProposals: 3,
        ledger: { calls: calls.slice(0, 23) }
      }),
      hasCode("invalid_usage_ledger_transition")
    );
  });

  it("does not let one rejected proposal poison an eligible survivor", () => {
    const reassessed = reassessSanitizedCaseReceiptV1({
      caseId: SERVER_LIVE_PROOF_CASE_IDS[0],
      region: "harz-v1",
      executed: true,
      terminalState: "partial",
      errorCode: null,
      providerCallCount: 2,
      providerOutcomes: {
        successful: 2,
        failed: 0,
        timedOut: 0,
        cancelled: 0,
        controlledFailureAfterSuccess: 0
      },
      pipeline: { selectedHighlightCategories: ["viewpoint"] },
      limitations: ["access_unverified"],
      routeQuality: {
        routeCount: 2,
        eligibleCount: 1,
        selectedCount: 1,
        rejectionCount: 1,
        routes: [
          {
            eligible: true,
            selected: true,
            geometryProvider: "graphhopper",
            routingStrategy: "backend",
            researchProvenanceDistinctFromRoutingProvenance: true,
            waypointOrderPreserved: true,
            reachedSelectedWaypointRatio: 1,
            excessiveSnapping: false
          },
          {
            eligible: false,
            selected: false,
            geometryProvider: "graphhopper",
            routingStrategy: "backend",
            researchProvenanceDistinctFromRoutingProvenance: true,
            waypointOrderPreserved: true,
            reachedSelectedWaypointRatio: 0.5,
            excessiveSnapping: true
          }
        ]
      },
      passed: false,
      failureReasons: ["route_provenance_or_waypoint_validation_failed"]
    });
    assert.equal(reassessed.passed, true);
    assert.deepEqual(reassessed.failureReasons, []);
  });

  it("rejects inconsistent survivor counters instead of trusting a prior receipt", () => {
    assert.throws(
      () => reassessSanitizedCaseReceiptV1({
        caseId: SERVER_LIVE_PROOF_CASE_IDS[0],
        region: "harz-v1",
        executed: true,
        terminalState: "partial",
        errorCode: null,
        providerCallCount: 1,
        providerOutcomes: {
          successful: 1,
          failed: 0,
          timedOut: 0,
          cancelled: 0,
          controlledFailureAfterSuccess: 0
        },
        pipeline: {},
        limitations: [],
        failureReasons: [],
        routeQuality: {
          routeCount: 1,
          eligibleCount: 1,
          selectedCount: 1,
          rejectionCount: 0,
          routes: [{ eligible: false, selected: true }]
        }
      }),
      hasCode("invalid_prior_summary")
    );
  });

  it("reconciles the final diagnostic without turning a failed proof green", () => {
    const cleanupArtifactDigest = safeProofDigestV1(
      "/private/tmp/trailmind-server-live-proof/run.reviewed",
      "cleanup"
    );
    const ledger = {
      schemaVersion: 1,
      limit: 25,
      calls: Array.from({ length: 25 }, (_, index) => ({
        callId: index + 1,
        caseId: index === 24
          ? "case-07-innsbruck-viewpoint-loop"
          : SERVER_LIVE_PROOF_CASE_IDS[index % SERVER_LIVE_PROOF_CASE_IDS.length],
        outcome: index === 24 ? "success" : index < 15 ? "success" : "failed",
        pipelineDisposition: "returned_to_pipeline",
        errorCode: null,
        responseBytes: index >= 15 && index < 24 ? 144 : 1_000,
        latencyMilliseconds: index >= 15 && index < 24 ? 30 : 100
      }))
    };
    const summary = failedBaseSummary();
    const diagnosticCase = {
      caseId: "case-07-innsbruck-viewpoint-loop",
      terminalState: "partial",
      providerCallCount: 1,
      providerOutcomes: {
        successful: 1,
        failed: 0,
        timedOut: 0,
        cancelled: 0,
        controlledFailureAfterSuccess: 0
      },
      pipeline: { realPostgisEvidence: true },
      routeQuality: { eligibleCount: 0, selectedCount: 0, routes: [] },
      passed: false,
      failureReasons: ["no_quality_eligible_route"]
    };
    const diagnosticSummary = diagnosticPublishedSummary(diagnosticCase);
    const reconciled = reconcileServerLiveProofSummaryV1({
      summary,
      ledger,
      diagnosticSummary,
      cleanupArtifactDigest,
      now: () => new Date("2026-08-02T18:00:00.000Z")
    });
    assert.equal(reconciled.status, "failed");
    assert.equal(reconciled.closedBetaEligible, false);
    assert.deepEqual(reconciled.providerCalls, {
      limit: 25,
      exactAttempted: 25,
      successful: 16,
      failed: 9,
      timedOut: 0,
      cancelled: 0,
      controlledFailureAfterSuccess: 0
    });
    assert.equal(
      reconciled.providerDiagnostic.priorBurstObservation
        .identicalResponseByteCount,
      144
    );
    assert.match(
      reconciled.providerDiagnostic.conclusion,
      /unconfirmed$/
    );
    assert.equal(reconciled.reconciliation.supersededCanaryCallCount, 3);
    assert.equal(reconciled.disposableArtifacts.status, "pending_cleanup");
    assert.equal(
      reconciled.disposableArtifacts.cleanupArtifactDigest,
      cleanupArtifactDigest
    );

    assert.throws(
      () => reconcileServerLiveProofSummaryV1({
        summary,
        ledger,
        diagnosticSummary: {
          ...diagnosticSummary,
          providerDiagnostic: { raw_geometry: [[11, 47]] }
        },
        cleanupArtifactDigest,
        now: () => new Date("2026-08-02T18:00:00.000Z")
      }),
      hasCode("invalid_provider_diagnostic")
    );

    assert.throws(
      () => reconcileServerLiveProofSummaryV1({
        summary,
        ledger: {
          ...ledger,
          calls: ledger.calls.map((call, index) => index === 15
            ? { ...call, responseBytes: "raw-provider-body" }
            : call)
        },
        diagnosticSummary,
        cleanupArtifactDigest,
        now: () => new Date("2026-08-02T18:00:00.000Z")
      }),
      hasCode("invalid_provider_ledger")
    );

    assert.throws(
      () => sealServerLiveProofCleanupV1({
        summary: reconciled,
        cleanupArtifactDigest: safeProofDigestV1(
          "/private/tmp/trailmind-server-live-proof/run.wrong",
          "cleanup"
        ),
        now: () => new Date("2026-08-02T18:01:00.000Z")
      }),
      hasCode("summary_not_ready_for_cleanup_seal")
    );

    const sealed = sealServerLiveProofCleanupV1({
      summary: reconciled,
      cleanupArtifactDigest,
      now: () => new Date("2026-08-02T18:01:00.000Z")
    });
    assert.equal(sealed.status, "failed");
    assert.equal(sealed.disposableArtifacts.status, "removed");
  });
});

function failedBaseSummary() {
  const cases = SERVER_LIVE_PROOF_CASE_IDS.map((caseId, index) => {
    const providerCallCount = index === 4 ? 0 : 3;
    const providerOutcomes = index <= 4
      ? {
        successful: providerCallCount,
        failed: 0,
        timedOut: 0,
        cancelled: 0,
        controlledFailureAfterSuccess: 0
      }
      : {
        successful: 0,
        failed: providerCallCount,
        timedOut: 0,
        cancelled: 0,
        controlledFailureAfterSuccess: 0
      };
    return {
      caseId,
      region: index >= 5 && index <= 6 ? "innsbruck-alps-v1" : "harz-v1",
      executed: true,
      passed: [0, 1, 2, 4].includes(index),
      terminalState: index === 4 ? "no_viable_route" : "partial",
      errorCode: null,
      providerCallCount,
      providerOutcomes,
      stageTimings: {},
      pipeline: {},
      routeQuality: {
        policyVersion: "hiking-route-quality-v1-server-proof-projection",
        providerOrderUsedAsRanking: false,
        routeCount: 0,
        eligibleCount: 0,
        selectedCount: 0,
        rejectionCount: 0,
        nearDuplicateRejectionCount: 0,
        maximumPairwiseSimilarity: 0,
        routes: []
      },
      limitations: [],
      failureReasons: []
    };
  });
  return {
    schemaVersion: 1,
    proofClassification: "server_side_live_pipeline_proof",
    status: "failed",
    configuredCaseCount: SERVER_LIVE_PROOF_CASE_IDS.length,
    executedCaseCount: SERVER_LIVE_PROOF_CASE_IDS.length,
    passedCaseCount: 4,
    failedCaseCount: 4,
    notRunCaseCount: 0,
    notRunCaseIds: [],
    cases,
    providerCalls: {
      limit: 25,
      exactAttempted: 24,
      successful: 15,
      failed: 9,
      timedOut: 0,
      cancelled: 0,
      controlledFailureAfterSuccess: 0
    },
    officialCanonical18CaseSummary: {
      status: "not_run",
      caseCount: 18,
      executedCaseCount: 0,
      providerCallCount: 0
    },
    featureFlags: SERVER_LIVE_PROOF_FEATURE_FLAGS.map((name) => ({
      name,
      enabled: false
    })),
    limitations: [],
    failureReasons: ["case_failed"],
    closedBetaEligible: false,
    physicalIPhoneAppAttestProven: false
  };
}

function diagnosticPublishedSummary(diagnosticCase) {
  const base = failedBaseSummary();
  const caseId = diagnosticCase.caseId;
  return {
    ...base,
    status: "failed",
    executedCaseCount: 1,
    passedCaseCount: 0,
    failedCaseCount: 1,
    notRunCaseCount: SERVER_LIVE_PROOF_CASE_IDS.length - 1,
    notRunCaseIds: SERVER_LIVE_PROOF_CASE_IDS.filter((id) => id !== caseId),
    cases: [{
      ...diagnosticCase,
      region: "innsbruck-alps-v1",
      executed: true,
      errorCode: null,
      stageTimings: {},
      limitations: [],
      routeQuality: {
        policyVersion: "hiking-route-quality-v1-server-proof-projection",
        providerOrderUsedAsRanking: false,
        routeCount: 0,
        eligibleCount: 0,
        selectedCount: 0,
        rejectionCount: 0,
        nearDuplicateRejectionCount: 0,
        maximumPairwiseSimilarity: 0,
        routes: []
      }
    }],
    providerCalls: {
      limit: 25,
      exactAttempted: 25,
      successful: 16,
      failed: 9,
      timedOut: 0,
      cancelled: 0,
      controlledFailureAfterSuccess: 0
    }
  };
}

function visit(waypointIndex, role, entityId, snapDistanceMeters) {
  return {
    waypointIndex,
    role,
    entityId,
    snapDistanceMeters,
    withinVisitTolerance: true
  };
}

function hasCode(code) {
  return (error) => error?.code === code;
}
