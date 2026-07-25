import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { describe, it } from "node:test";
import { buildGraphHopperRequest } from "../src/routing/graphHopperProvider.js";
import { routeError } from "../src/routing/routeErrors.js";
import { validateRouteRequest } from "../src/routing/routeValidation.js";
import {
  RESEARCH_GUIDED_ROUTED_ALTERNATIVES_POLICY_V1,
  ResearchGuidedRoutingAdapterError,
  buildResearchGuidedRouteCandidatePlanV1,
  routeResearchGuidedCandidatesV1,
  serializeResearchGuidedRoutedAlternativesV1,
  validateResearchGuidedRoutedAlternativesV1
} from "../src/routeResearch/index.js";
import {
  OUTDOOR_RESEARCH_TEST_IDS,
  adventureResearchDossier,
  completeAdventureResearchIntent,
  evidenceClaim,
  highlightCandidate,
  minimalAdventureResearchIntent
} from "./outdoorResearchTestSupport.js";

describe("research-guided routing adapter v1", () => {
  it("routes exact anchor-via-anchor order through the existing validator and provider", async () => {
    const plan = oneProposalPlan();
    let validatorCalls = 0;
    let receivedRequest;
    const envelope = await routeResearchGuidedCandidatesV1(plan, {
      validateRouteRequest(input) {
        validatorCalls += 1;
        return validateRouteRequest(input);
      },
      provider: {
        async route(request) {
          receivedRequest = request;
          return providerResponse(request);
        }
      }
    });

    const proposal = plan.proposals[0];
    assert.equal(validatorCalls, 1);
    assert.deepEqual(receivedRequest.points, [
      plan.anchor.coordinate,
      ...proposal.viaCandidates.map((item) => item.coordinate),
      plan.anchor.coordinate
    ]);
    assert.equal(receivedRequest.routeType, "loop");
    assert.equal(receivedRequest.algorithm, undefined);
    assert.equal(receivedRequest.profile, "foot");
    assert.equal(envelope.state, "routed");
    assert.equal(envelope.attempts[0].state, "routed");
    assert.equal(envelope.attempts[0].routeResults.length, 1);

    const upstream = buildGraphHopperRequest(receivedRequest, {
      baseUrl: "https://graphhopper.example",
      apiKey: "not-a-real-key",
      timeoutMs: 1_000
    });
    const payload = JSON.parse(upstream.init.body);
    assert.deepEqual(
      payload.points,
      receivedRequest.points.map((point) => [
        point.longitude,
        point.latitude
      ])
    );
    assert.equal(payload.algorithm, undefined);
  });

  it("preserves several selected highlights in their validated waypoint order", async () => {
    const plan = orderedHighlightPlan();
    let receivedPoints;
    const envelope = await routeResearchGuidedCandidatesV1(plan, {
      provider: {
        async route(request) {
          receivedPoints = request.points;
          return providerResponse(request);
        }
      }
    });
    const proposal = plan.proposals[0];
    assert.equal(proposal.viaCandidates.length, 2);
    assert.deepEqual(receivedPoints, [
      plan.anchor.coordinate,
      ...proposal.viaCandidates.map((candidate) => candidate.coordinate),
      plan.anchor.coordinate
    ]);
    assert.deepEqual(
      envelope.attempts[0].provenance.selectedWaypoints.map(
        (waypoint) => waypoint.entityId
      ),
      proposal.viaCandidates.map((candidate) => candidate.entityId)
    );
  });

  it("keeps hiking and trail-running semantics while both use foot routing", async () => {
    for (const activity of ["hiking", "trail_running"]) {
      const plan = oneProposalPlan({ activity });
      let request;
      const envelope = await routeResearchGuidedCandidatesV1(plan, {
        provider: {
          async route(value) {
            request = value;
            return providerResponse(value);
          }
        }
      });
      assert.equal(request.profile, "foot");
      assert.equal(
        envelope.attempts[0].provenance.activity,
        activity
      );
    }
  });

  it("makes zero provider calls for non-routable candidate-plan states", async () => {
    const unsupported = buildResearchGuidedRouteCandidatePlanV1(
      adventureResearchDossier({
        normalizedIntent: completeAdventureResearchIntent({
          activity: "biking"
        })
      })
    );
    const insufficient = buildResearchGuidedRouteCandidatePlanV1(
      adventureResearchDossier({
        evidenceClaims: [],
        candidateHighlights: [],
        mappedOrOfficialRouteCandidates: [],
        overnightCandidates: []
      })
    );
    const unresolved = buildResearchGuidedRouteCandidatePlanV1(
      adventureResearchDossier({
        normalizedIntent: minimalAdventureResearchIntent(),
        evidenceClaims: [],
        candidateHighlights: []
      })
    );
    let calls = 0;
    const provider = {
      async route() {
        calls += 1;
        assert.fail("provider must not be called");
      }
    };

    const results = [];
    for (const plan of [unsupported, insufficient, unresolved]) {
      results.push(
        await routeResearchGuidedCandidatesV1(plan, { provider })
      );
    }
    assert.equal(calls, 0);
    assert.deepEqual(
      results.map((result) => result.state),
      ["unsupported", "no_viable_route", "unsupported"]
    );
    assert.ok(results.every((result) => result.attempts.length === 0));
  });

  it("fails point-to-point and out-and-back closed without provider calls", async () => {
    let calls = 0;
    const provider = {
      async route() {
        calls += 1;
        assert.fail("provider must not be called");
      }
    };
    for (const routeType of ["point_to_point", "out_and_back"]) {
      const plan = oneProposalPlan({ routeType });
      const envelope = await routeResearchGuidedCandidatesV1(
        plan,
        { provider }
      );
      assert.equal(envelope.state, "unsupported");
      assert.ok(
        envelope.attempts.every(
          (attempt) => attempt.state === "unsupported"
        )
      );
      assert.ok(
        envelope.attempts.every(
          (attempt) =>
            attempt.failureCode ===
              (
                routeType === "point_to_point"
                  ? "unsupported_point_to_point"
                  : "unsupported_out_and_back"
              )
        )
      );
    }
    assert.equal(calls, 0);
  });

  it("bounds concurrency at two and preserves deterministic proposal order", async () => {
    const plan = twoProposalPlan();
    let active = 0;
    let maximumActive = 0;
    const completionOrder = [];
    const envelope = await routeResearchGuidedCandidatesV1(plan, {
      provider: {
        async route(request) {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          const isFirst =
            request.points[1].latitude ===
              plan.proposals[0].viaCandidates[0].coordinate.latitude;
          await delay(isFirst ? 20 : 1);
          completionOrder.push(isFirst ? 0 : 1);
          active -= 1;
          return providerResponse(request, {
            longitudeOffset: isFirst ? 0.01 : -0.01
          });
        }
      }
    });

    assert.equal(maximumActive, 2);
    assert.deepEqual(completionOrder, [1, 0]);
    assert.deepEqual(
      envelope.attempts.map((attempt) => attempt.proposalIndex),
      [0, 1]
    );
    assert.deepEqual(
      envelope.attempts.map(
        (attempt) => attempt.provenance.proposalId
      ),
      plan.proposals.map((proposal) => proposal.proposalId)
    );
  });

  it("keeps successful proposals when another provider operation fails", async () => {
    const plan = twoProposalPlan();
    let calls = 0;
    const envelope = await routeResearchGuidedCandidatesV1(
      plan,
      {
        provider: {
          async route(request) {
            calls += 1;
            if (calls === 1) throw routeError("route_not_found");
            return providerResponse(request);
          }
        }
      },
      { maximumConcurrency: 1 }
    );

    assert.equal(envelope.state, "partial");
    assert.deepEqual(
      envelope.attempts.map((attempt) => attempt.state),
      ["failed", "routed"]
    );
    assert.equal(
      envelope.attempts[0].failureCode,
      "route_not_found"
    );
    assert.equal(
      envelope.remainingLimitations.includes("provider_failure"),
      true
    );
  });

  it("fails closed when all provider operations return no route", async () => {
    const envelope = await routeResearchGuidedCandidatesV1(
      twoProposalPlan(),
      {
        provider: {
          async route() {
            throw routeError("route_not_found");
          }
        }
      }
    );
    assert.equal(envelope.state, "no_viable_route");
    assert.ok(
      envelope.attempts.every(
        (attempt) =>
          attempt.state === "failed" &&
          attempt.routeResults.length === 0
      )
    );
  });

  it("sanitizes malformed provider responses into a fixed failure code", async () => {
    const privateMarker =
      "provider-private-message-47.2692-11.4041-secret";
    const envelope = await routeResearchGuidedCandidatesV1(
      oneProposalPlan(),
      {
        provider: {
          async route() {
            return {
              provider: "graphhopper",
              paths: [{
                distance: 12_000,
                time: 7_200_000,
                points: { type: "LineString", coordinates: [] },
                instructions: [],
                providerMessage: privateMarker
              }]
            };
          }
        }
      }
    );
    const failure = envelope.attempts[0];
    assert.equal(envelope.state, "no_viable_route");
    assert.equal(failure.failureCode, "invalid_provider_response");
    assert.equal(JSON.stringify(failure.failureCode).includes(privateMarker), false);
    assert.equal("message" in failure, false);
  });

  it("preserves exact research lineage without turning mapped relations into points", async () => {
    const plan = mappedNetworkPlan();
    let request;
    const envelope = await routeResearchGuidedCandidatesV1(plan, {
      provider: {
        async route(value) {
          request = value;
          return providerResponse(value);
        }
      }
    });
    const proposal = plan.proposals[0];
    const provenance = envelope.attempts[0].provenance;
    assert.deepEqual(
      provenance.selectedWaypoints.map((item) => item.entityId),
      proposal.viaCandidates.map((item) => item.entityId)
    );
    assert.deepEqual(
      provenance.selectedWaypoints.map((item) => item.coordinate),
      proposal.viaCandidates.map((item) => item.coordinate)
    );
    assert.deepEqual(
      provenance.mappedNetworkCandidates,
      proposal.mappedNetworkCandidates
    );
    assert.deepEqual(
      provenance.evidenceClaimIds,
      proposal.evidenceClaimIds
    );
    assert.deepEqual(
      provenance.requiredVerification,
      proposal.requiredVerification
    );
    assert.deepEqual(
      provenance.knownLimitations,
      proposal.knownLimitations
    );
    assert.equal(
      request.points.length,
      proposal.viaCandidates.length + 2
    );
    assert.equal(
      request.points.some((point) =>
        provenance.mappedNetworkCandidates.some(
          (candidate) =>
            candidate.latitude === point.latitude ||
            candidate.longitude === point.longitude
        )
      ),
      false
    );
  });

  it("records excessive snapping without claiming the highlight was visited", async () => {
    const plan = oneProposalPlan();
    const envelope = await routeResearchGuidedCandidatesV1(plan, {
      provider: {
        async route(request) {
          const response = providerResponse(request);
          response.paths[0].snapped_waypoints.coordinates[1] = [
            request.points[1].longitude + 0.02,
            request.points[1].latitude + 0.02
          ];
          return response;
        }
      }
    });
    const visit =
      envelope.attempts[0].routeResults[0].waypointVisits[1];
    assert.equal(visit.role, "via");
    assert.equal(visit.withinVisitTolerance, false);
    assert.ok(visit.snapDistanceMeters > 100);
    assert.equal(
      envelope.remainingLimitations.includes(
        "snapping_exceeds_tolerance"
      ),
      true
    );
  });

  it("cancels outstanding work and ignores a provider completion after cancellation", async () => {
    const controller = new AbortController();
    let resolveProvider;
    let providerSignal;
    const providerCompletion = new Promise((resolve) => {
      resolveProvider = resolve;
    });
    const routing = routeResearchGuidedCandidatesV1(
      oneProposalPlan(),
      {
        provider: {
          async route(request, context) {
            providerSignal = context.signal;
            await providerCompletion;
            return providerResponse(request);
          }
        }
      },
      { signal: controller.signal }
    );
    await delay(1);
    controller.abort();
    await assert.rejects(
      routing,
      (error) =>
        error instanceof ResearchGuidedRoutingAdapterError &&
        error.code === "cancelled"
    );
    assert.equal(providerSignal.aborted, true);
    resolveProvider();
    await delay(1);
  });

  it("times out an ignoring provider with a fixed bounded result", async () => {
    const envelope = await routeResearchGuidedCandidatesV1(
      oneProposalPlan(),
      {
        provider: {
          async route() {
            return new Promise(() => {});
          }
        }
      },
      { operationTimeoutMilliseconds: 2 }
    );
    assert.equal(envelope.state, "no_viable_route");
    assert.equal(
      envelope.attempts[0].failureCode,
      "route_timed_out"
    );
  });

  it("revalidates the complete plan before any provider call", async () => {
    const tampered = structuredClone(oneProposalPlan());
    tampered.proposals[0].proposalId =
      `${tampered.proposals[0].proposalId.slice(0, -1)}a`;
    let calls = 0;
    await assert.rejects(
      routeResearchGuidedCandidatesV1(tampered, {
        provider: {
          async route() {
            calls += 1;
            assert.fail("provider must not be called");
          }
        }
      }),
      (error) =>
        error instanceof ResearchGuidedRoutingAdapterError &&
        error.code === "invalid_candidate_plan"
    );
    assert.equal(calls, 0);
  });
});

describe("research-guided routed-alternatives contract v1", () => {
  it("validates the shared cross-language fixture corpus and scenario manifest", () => {
    const fixture = JSON.parse(readFileSync(
      new URL(
        "../../TrailMindTests/Fixtures/research_guided_routed_alternatives_v1.json",
        import.meta.url
      ),
      "utf8"
    ));
    assert.equal(fixture.schemaVersion, 1);
    assert.equal(fixture.contractSchemaVersion, 1);
    assert.equal(fixture.requiredScenarioIDs.length, 19);
    assert.equal(
      new Set(fixture.requiredScenarioIDs).size,
      fixture.requiredScenarioIDs.length
    );
    for (const required of [
      "valid_loop_one_highlight",
      "valid_loop_ordered_highlights",
      "multiple_proposals_out_of_order",
      "partial_provider_failure",
      "all_providers_no_route",
      "malformed_graphhopper_response",
      "tampered_proposal_id",
      "mismatched_evidence_or_entity",
      "unsupported_point_to_point",
      "unsupported_out_and_back",
      "unsupported_activity_contract_compatibility",
      "mapped_relation_advisory_only",
      "excessive_snapping_distance",
      "cancelled_and_late_response",
      "duplicate_routed_geometry",
      "all_quality_rejected",
      "quality_reduced_and_ranked",
      "oversized_arrays_and_response",
      "sanitized_failure_no_details"
    ]) {
      assert.equal(fixture.requiredScenarioIDs.includes(required), true);
    }
    for (const envelope of Object.values(fixture.envelopes)) {
      assert.deepEqual(
        validateResearchGuidedRoutedAlternativesV1(envelope),
        envelope
      );
    }
  });

  it("is deterministic, strict, and rejects provenance tampering", async () => {
    const envelope = await routeResearchGuidedCandidatesV1(
      oneProposalPlan(),
      {
        provider: {
          async route(request) {
            return providerResponse(request);
          }
        }
      }
    );
    const serialized =
      serializeResearchGuidedRoutedAlternativesV1(envelope);
    assert.equal(
      serialized,
      serializeResearchGuidedRoutedAlternativesV1(
        reverseObjectKeys(envelope)
      )
    );

    const unknown = structuredClone(envelope);
    unknown.unexpected = true;
    assertSafeEnvelopeError(unknown, "invalid_envelope");

    const proposalTamper = structuredClone(envelope);
    proposalTamper.attempts[0].provenance.proposalId =
      `rrcpv1_${"a".repeat(32)}`;
    assertSafeEnvelopeError(proposalTamper, "invalid_envelope");

    const evidenceTamper = structuredClone(envelope);
    evidenceTamper.attempts[0].provenance.evidenceClaimIds[0] =
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    assertSafeEnvelopeError(evidenceTamper, "invalid_envelope");

    const entityTamper = structuredClone(envelope);
    entityTamper.attempts[0].provenance.selectedWaypoints[0].entityId =
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    assertSafeEnvelopeError(entityTamper, "invalid_envelope");

    const duplicateResult = structuredClone(envelope);
    duplicateResult.attempts[0].routeResults.push(
      duplicateResult.attempts[0].routeResults[0]
    );
    assertSafeEnvelopeError(duplicateResult, "invalid_envelope");
  });

  it("rejects oversized envelopes with a safe non-reflective error", () => {
    const marker = "private-prompt-coordinate-provider-secret";
    const oversized = {
      marker: marker.repeat(
        RESEARCH_GUIDED_ROUTED_ALTERNATIVES_POLICY_V1.limits
          .maximumEnvelopeBytes
      )
    };
    assert.throws(
      () => validateResearchGuidedRoutedAlternativesV1(oversized),
      (error) => {
        assert.ok(error instanceof ResearchGuidedRoutingAdapterError);
        assert.equal(error.code, "output_too_large");
        assert.equal(error.message.includes(marker), false);
        assert.equal(error.stack.includes(marker), false);
        return true;
      }
    );
  });
});

function oneProposalPlan({
  activity = "hiking",
  routeType = "loop"
} = {}) {
  return buildResearchGuidedRouteCandidatePlanV1(
    adventureResearchDossier({
      normalizedIntent: completeAdventureResearchIntent({
        activity,
        routeType
      })
    })
  );
}

function twoProposalPlan() {
  const intent = completeAdventureResearchIntent({
    distanceRangeKm: { min: 5, max: 30 },
    durationRangeMinutes: null,
    maximumElevationGainMeters: null,
    maximumTechnicalDifficulty: null,
    mustHaveExperiences: [
      { experience: "viewpoint", minimumCount: 1 }
    ],
    preferredExperiences: [],
    avoidedExperiences: [],
    requiredFacilities: [],
    groupContext: {
      partySize: 1,
      includesChildren: false,
      youngestAge: null,
      mobility: "standard",
      experienceLevel: "intermediate"
    },
    dateOrSeason: null,
    transportRequirements: {
      arrivalMode: "walking",
      returnToStart: true,
      publicTransportRequired: false
    }
  });
  const secondClaim = evidenceClaim({
    claimId: OUTDOOR_RESEARCH_TEST_IDS.secondClaim,
    entityId: OUTDOOR_RESEARCH_TEST_IDS.secondEntity,
    provenance: {
      identifier: "node/456",
      adapterVersion: "osm-graph-v1",
      recordVersion: 1
    }
  });
  const secondCandidate = highlightCandidate({
    entityId: OUTDOOR_RESEARCH_TEST_IDS.secondEntity,
    coordinate: { latitude: 47.29, longitude: 11.45 },
    relevanceReasons: [{
      code: "mapped_viewpoint",
      evidenceClaimIds: [OUTDOOR_RESEARCH_TEST_IDS.secondClaim]
    }],
    evidenceClaimIds: [OUTDOOR_RESEARCH_TEST_IDS.secondClaim]
  });
  const baseline = adventureResearchDossier();
  return buildResearchGuidedRouteCandidatePlanV1(
    adventureResearchDossier({
      normalizedIntent: intent,
      regionCoverage: {
        state: "full",
        regionEntityIds: [OUTDOOR_RESEARCH_TEST_IDS.region],
        limitationCodes: []
      },
      evidenceClaims: [evidenceClaim(), secondClaim],
      candidateHighlights: [
        highlightCandidate(),
        secondCandidate
      ],
      evidenceGaps: [],
      sourceProvenanceSummary: baseline.sourceProvenanceSummary
    })
  );
}

function orderedHighlightPlan() {
  const dossier = adventureResearchDossier();
  const secondClaim = evidenceClaim({
    claimId: OUTDOOR_RESEARCH_TEST_IDS.secondClaim,
    entityId: OUTDOOR_RESEARCH_TEST_IDS.secondEntity,
    value: { type: "text", value: "waterfall" },
    provenance: {
      identifier: "node/456",
      adapterVersion: "osm-graph-v1",
      recordVersion: 1
    }
  });
  const secondCandidate = highlightCandidate({
    entityId: OUTDOOR_RESEARCH_TEST_IDS.secondEntity,
    highlightCategory: "waterfall",
    coordinate: { latitude: 47.29, longitude: 11.45 },
    relevanceReasons: [{
      code: "mapped_waterfall",
      evidenceClaimIds: [OUTDOOR_RESEARCH_TEST_IDS.secondClaim]
    }],
    evidenceClaimIds: [OUTDOOR_RESEARCH_TEST_IDS.secondClaim]
  });
  dossier.normalizedIntent = completeAdventureResearchIntent({
    distanceRangeKm: { min: 5, max: 30 },
    durationRangeMinutes: null,
    maximumElevationGainMeters: null,
    maximumTechnicalDifficulty: null,
    mustHaveExperiences: [
      { experience: "viewpoint", minimumCount: 1 },
      { experience: "waterfall", minimumCount: 1 }
    ],
    preferredExperiences: [],
    avoidedExperiences: [],
    requiredFacilities: [],
    dateOrSeason: null
  });
  dossier.regionCoverage = {
    state: "full",
    regionEntityIds: [OUTDOOR_RESEARCH_TEST_IDS.region],
    limitationCodes: []
  };
  dossier.evidenceClaims = [evidenceClaim(), secondClaim];
  dossier.candidateHighlights = [
    highlightCandidate(),
    secondCandidate
  ];
  dossier.evidenceGaps = [];
  return buildResearchGuidedRouteCandidatePlanV1(dossier);
}

function mappedNetworkPlan() {
  const dossier = adventureResearchDossier();
  const entityId = "88888888-8888-4888-8888-888888888888";
  const claimId = "99999999-9999-4999-8999-999999999999";
  dossier.evidenceClaims.push(evidenceClaim({
    claimId,
    entityId,
    predicate: "entity_category",
    value: { type: "text", value: "hiking_route" },
    provenance: {
      identifier: "relation/1",
      adapterVersion: "osm-graph-v1",
      recordVersion: 1
    }
  }));
  dossier.mappedOrOfficialRouteCandidates = [{
    entityId,
    entityCategory: "hiking_route",
    sourceBasis: "mapped",
    evidenceClaimIds: [claimId],
    knownLimitations: [
      "mapped_presence_only",
      "route_connection_unverified"
    ]
  }];
  return buildResearchGuidedRouteCandidatePlanV1(dossier);
}

function providerResponse(request, { longitudeOffset = 0.01 } = {}) {
  const start = request.points[0];
  const via = request.points[1];
  const coordinates = [
    [start.longitude, start.latitude, 500],
    [via.longitude, via.latitude, 650],
    [
      start.longitude + longitudeOffset,
      start.latitude - 0.01,
      575
    ],
    [start.longitude, start.latitude, 500]
  ];
  return {
    provider: "graphhopper",
    paths: [{
      distance: 12_000,
      time: 10_800_000,
      ascend: 400,
      descend: 400,
      points: { type: "LineString", coordinates },
      instructions: [{
        text: "Continue",
        distance: 12_000,
        time: 10_800_000,
        interval: [0, 3],
        sign: 0
      }],
      details: {
        surface: [[0, 3, "ground"]],
        road_class: [[0, 3, "path"]],
        hike_rating: [[0, 3, "1"]]
      },
      snapped_waypoints: {
        type: "LineString",
        coordinates: request.points.map((point) => [
          point.longitude,
          point.latitude
        ])
      }
    }]
  };
}

function assertSafeEnvelopeError(value, code) {
  assert.throws(
    () => validateResearchGuidedRoutedAlternativesV1(value),
    (error) => {
      assert.ok(error instanceof ResearchGuidedRoutingAdapterError);
      assert.equal(error.code, code);
      assert.ok(error.message.length < 96);
      return true;
    }
  );
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, child]) => [key, reverseObjectKeys(child)])
  );
}
