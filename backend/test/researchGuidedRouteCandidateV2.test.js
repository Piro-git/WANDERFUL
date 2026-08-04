import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { describe, it } from "node:test";
import { routeError } from "../src/routing/routeErrors.js";
import {
  RESEARCH_GUIDED_ROUTED_ALTERNATIVES_POLICY_V2,
  ResearchGuidedRoutingAdapterError,
  buildResearchGuidedRouteCandidatePlanV1,
  buildResearchGuidedRouteCandidatePlanV2,
  deriveResearchTrailAccessCandidateIdV1,
  routeResearchGuidedCandidatesV2,
  serializeResearchGuidedRouteCandidatePlanV1,
  serializeResearchGuidedRouteCandidatePlanV2,
  serializeResearchGuidedRoutedAlternativesV2,
  validateResearchGuidedRouteCandidatePlanV1,
  validateResearchGuidedRouteCandidatePlanV2,
  validateResearchGuidedRouteCandidatePlanV2ForResearch,
  validateResearchGuidedRoutedAlternativesV2
} from "../src/routeResearch/index.js";
import {
  OUTDOOR_RESEARCH_TEST_IDS,
  adventureResearchDossier,
  completeAdventureResearchIntent,
  evidenceClaim,
  highlightCandidate
} from "./outdoorResearchTestSupport.js";

const RUN_ID = "88888888-8888-4888-8888-888888888888";
const IMPORT_ID = "99999999-9999-4999-8999-999999999999";
const POLICY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TRAIL_CLAIM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("ResearchGuidedRouteCandidatePlanV2", () => {
  it("preserves the V1 source plan and routes through access coordinates", () => {
    const dossier = singleMustHaveDossier();
    const sourcePlan = buildResearchGuidedRouteCandidatePlanV1(dossier);
    const plan = buildResearchGuidedRouteCandidatePlanV2(
      dossier,
      accessResolution(dossier.candidateHighlights)
    );
    const selected = plan.proposals[0].selectedHighlights[0];

    assert.equal(
      serializeResearchGuidedRouteCandidatePlanV1(plan.sourcePlan),
      serializeResearchGuidedRouteCandidatePlanV1(sourcePlan)
    );
    assert.deepEqual(selected.evidenceCoordinate, {
      latitude: 47.28,
      longitude: 11.42
    });
    assert.notDeepEqual(selected.routingCoordinate, selected.evidenceCoordinate);
    assert.deepEqual(
      selected.routingCoordinate,
      selected.trailAccessCandidate.routingCoordinate
    );
    assert(plan.knownLimitations.includes("provider_verification_required"));
  });

  it("keeps a required highlight as a typed shortfall when access is absent", () => {
    const dossier = singleMustHaveDossier();
    const resolution = accessResolution(dossier.candidateHighlights, {
      candidates: [],
      shortfalls: dossier.candidateHighlights.map((item) => ({
        entityId: item.entityId,
        highlightCategory: item.highlightCategory,
        evidenceCoordinate: item.coordinate,
        code: "no_eligible_mapped_trail_within_radius",
        knownLimitations: [
          "mapped_trail_only",
          "provider_connectivity_unverified",
          "provider_access_unverified"
        ]
      }))
    });
    const plan = buildResearchGuidedRouteCandidatePlanV2(
      dossier,
      resolution
    );

    assert.equal(plan.state, "insufficient_evidence");
    assert.equal(plan.proposals.length, 0);
    assert.equal(
      plan.accessShortfalls[0].code,
      "required_access_candidate_unavailable"
    );
    assert.deepEqual(
      plan.accessShortfalls[0].evidenceCoordinate,
      dossier.candidateHighlights[0].coordinate
    );
  });

  it("removes optional target-distance detours without displacing must-haves", () => {
    const dossier = multiHighlightDossier({
      distanceRangeKm: { min: 2, max: 2 },
      mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 1 }],
      preferredExperiences: ["waterfall"]
    });
    const plan = buildResearchGuidedRouteCandidatePlanV2(
      dossier,
      accessResolution(dossier.candidateHighlights, {
        distinctTrailSegments: true
      })
    );
    const proposal = plan.proposals[0];

    assert(proposal.selectedHighlights.some((item) =>
      item.role === "must_have" && item.highlightCategory === "viewpoint"
    ));
    assert(plan.accessShortfalls.some((item) =>
      item.code === "optional_removed_for_target_distance"
    ));
  });

  it("removes duplicate optional mapped-corridor points and preserves hard ones", () => {
    const dossier = multiHighlightDossier({
      distanceRangeKm: null,
      mustHaveExperiences: [
        { experience: "viewpoint", minimumCount: 1 },
        { experience: "waterfall", minimumCount: 1 }
      ],
      preferredExperiences: ["peak"]
    });
    const plan = buildResearchGuidedRouteCandidatePlanV2(
      dossier,
      accessResolution(dossier.candidateHighlights, {
        sameRoutingCoordinate: true
      })
    );
    const proposal = plan.proposals[0];

    assert.equal(
      proposal.selectedHighlights.filter((item) => item.role === "must_have")
        .length,
      2
    );
    assert.equal(
      proposal.backtrackingRisk.state,
      "required_mapped_corridor_risk"
    );
    assert(plan.accessShortfalls.some((item) =>
      item.code === "optional_near_duplicate_access_candidate"
    ));
  });

  it("changes proposal identity when access lineage changes", () => {
    const dossier = singleMustHaveDossier();
    const first = buildResearchGuidedRouteCandidatePlanV2(
      dossier,
      accessResolution(dossier.candidateHighlights)
    );
    const second = buildResearchGuidedRouteCandidatePlanV2(
      dossier,
      accessResolution(dossier.candidateHighlights, {
        sourceTrailSegmentEntityId:
          "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
      })
    );
    assert.notEqual(
      first.proposals[0].proposalId,
      second.proposals[0].proposalId
    );
  });

  it("keeps V1 and V2 strict and version-declared", () => {
    const dossier = singleMustHaveDossier();
    const plan = buildResearchGuidedRouteCandidatePlanV2(
      dossier,
      accessResolution(dossier.candidateHighlights)
    );
    assert.doesNotThrow(() => validateResearchGuidedRouteCandidatePlanV2(plan));
    assert.throws(() => validateResearchGuidedRouteCandidatePlanV1(plan));
    assert.throws(() => validateResearchGuidedRouteCandidatePlanV2(
      plan.sourcePlan
    ));
    assert.throws(() => validateResearchGuidedRouteCandidatePlanV2({
      ...plan,
      verifiedRoutable: true
    }));
    assert.equal(
      serializeResearchGuidedRouteCandidatePlanV2(plan),
      serializeResearchGuidedRouteCandidatePlanV2(reverseKeys(plan))
    );
  });

  it("rejects self-consistent provenance tampering against the research snapshot", () => {
    const dossier = singleMustHaveDossier();
    const researchResolution = accessResolution(dossier.candidateHighlights);
    const unauthorizedImport =
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const forgedResolution = structuredClone(researchResolution);
    forgedResolution.sourceSnapshot.importId = unauthorizedImport;
    forgedResolution.candidates = forgedResolution.candidates.map((candidate) => {
      candidate.sourceSnapshot.importId = unauthorizedImport;
      candidate.sourceTrailRecord.importId = unauthorizedImport;
      candidate.candidateId = deriveResearchTrailAccessCandidateIdV1(
        candidate
      );
      return candidate;
    });
    const forgedPlan = buildResearchGuidedRouteCandidatePlanV2(
      dossier,
      forgedResolution
    );

    assert.doesNotThrow(
      () => validateResearchGuidedRouteCandidatePlanV2(forgedPlan)
    );
    assert.throws(() =>
      validateResearchGuidedRouteCandidatePlanV2ForResearch(
        forgedPlan,
        dossier,
        researchResolution
      )
    );
  });
});

describe("research-guided routing adapter v2", () => {
  it("routes via mapped access coordinates and verifies the original highlight separately", async () => {
    const dossier = singleMustHaveDossier();
    const plan = buildResearchGuidedRouteCandidatePlanV2(
      dossier,
      accessResolution(dossier.candidateHighlights)
    );
    let request;
    const result = await routeResearchGuidedCandidatesV2(plan, {
      provider: { async route(value) {
        request = value;
        return providerResponse(value);
      } }
    });
    const highlight = plan.proposals[0].selectedHighlights[0];
    const verification = result.attempts[0].routeResults[0]
      .highlightVerifications[0];

    assert.deepEqual(request.points[1], highlight.routingCoordinate);
    assert.notDeepEqual(request.points[1], highlight.evidenceCoordinate);
    assert.equal(verification.providerVerifiedAccess, true);
    assert.equal(verification.approachState, "reached");
    assert.equal(result.state, "routed");
  });

  it("distinguishes passes-near from reached using route geometry to evidence", async () => {
    const dossier = singleMustHaveDossier();
    const plan = buildResearchGuidedRouteCandidatePlanV2(
      dossier,
      accessResolution(dossier.candidateHighlights, {
        routingLatitudeOffset: 0.00055
      })
    );
    const result = await routeResearchGuidedCandidatesV2(plan, {
      provider: { async route(value) { return providerResponse(value); } }
    });
    const route = result.attempts[0].routeResults[0];

    assert.equal(route.highlightVerifications[0].approachState, "passes_near");
    assert.equal(route.verificationState, "ineligible");
    assert.equal(result.state, "partial");
    assert(result.remainingLimitations.includes("selected_highlight_passes_near"));
  });

  it("keeps access unverified when the provider omits snapped waypoints", async () => {
    const dossier = singleMustHaveDossier();
    const plan = buildResearchGuidedRouteCandidatePlanV2(
      dossier,
      accessResolution(dossier.candidateHighlights)
    );
    const result = await routeResearchGuidedCandidatesV2(plan, {
      provider: { async route(value) {
        return providerResponse(value, { includeSnaps: false });
      } }
    });
    const verification = result.attempts[0].routeResults[0]
      .highlightVerifications[0];

    assert.equal(verification.providerVerifiedAccess, false);
    assert.equal(verification.approachState, "unverified");
    assert.equal(result.attempts[0].routeResults[0].verificationState, "unverified");
    assert(result.remainingLimitations.includes("provider_access_snap_unavailable"));
  });

  it("fails access verification when the provider snap exceeds tolerance", async () => {
    const dossier = singleMustHaveDossier();
    const plan = buildResearchGuidedRouteCandidatePlanV2(
      dossier,
      accessResolution(dossier.candidateHighlights)
    );
    const result = await routeResearchGuidedCandidatesV2(plan, {
      provider: { async route(value) {
        const response = providerResponse(value);
        response.snapped_waypoints.coordinates[1] = [
          value.points[1].longitude + 0.02,
          value.points[1].latitude + 0.02
        ];
        return response;
      } }
    });
    const route = result.attempts[0].routeResults[0];

    assert.equal(route.waypointSnaps[1].withinAccessTolerance, false);
    assert(route.waypointSnaps[1].snapDistanceMeters > 100);
    assert.equal(route.highlightVerifications[0].providerVerifiedAccess, false);
    assert.equal(route.highlightVerifications[0].approachState, "unverified");
    assert.equal(route.verificationState, "unverified");
    assert.equal(result.state, "partial");
    assert(result.remainingLimitations.includes(
      "provider_access_snap_exceeds_tolerance"
    ));
  });

  it("verifies final routed distance against the exact requested range", async () => {
    const dossier = multiHighlightDossier({
      distanceRangeKm: { min: 2, max: 2 },
      mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 1 }],
      preferredExperiences: []
    });
    const plan = buildResearchGuidedRouteCandidatePlanV2(
      dossier,
      accessResolution(dossier.candidateHighlights)
    );
    const result = await routeResearchGuidedCandidatesV2(plan, {
      provider: { async route(value) {
        return providerResponse(value, { distance: 2_500 });
      } }
    });
    const distance = result.attempts[0].routeResults[0].distanceVerification;
    assert.deepEqual(distance, {
      routeDistanceKm: 2.5,
      targetRangeKm: { min: 2, max: 2 },
      state: "outside_target",
      deviationKm: 0.5
    });
  });

  it("changes result identity when provider-derived route content changes", async () => {
    const dossier = singleMustHaveDossier();
    const plan = buildResearchGuidedRouteCandidatePlanV2(
      dossier,
      accessResolution(dossier.candidateHighlights)
    );
    const routeAtDistance = (distance) => routeResearchGuidedCandidatesV2(
      plan,
      {
        provider: {
          async route(value) {
            return providerResponse(value, { distance });
          }
        }
      }
    );
    const first = await routeAtDistance(4_000);
    const second = await routeAtDistance(4_500);

    assert.notEqual(
      first.attempts[0].routeResults[0].routeResultId,
      second.attempts[0].routeResults[0].routeResultId
    );
  });

  it("fails closed for malformed provider geometry and preserves a typed failure", async () => {
    const dossier = singleMustHaveDossier();
    const plan = buildResearchGuidedRouteCandidatePlanV2(
      dossier,
      accessResolution(dossier.candidateHighlights)
    );
    const result = await routeResearchGuidedCandidatesV2(plan, {
      provider: { async route(value) {
        const response = providerResponse(value);
        response.paths[0].points.coordinates = [[11.4, 47.2]];
        return response;
      } }
    });
    assert.equal(result.state, "no_viable_route");
    assert.equal(result.attempts[0].failureCode, "invalid_provider_response");
  });

  it("fails closed for malformed provider waypoint data", async () => {
    const dossier = singleMustHaveDossier();
    const plan = buildResearchGuidedRouteCandidatePlanV2(
      dossier,
      accessResolution(dossier.candidateHighlights)
    );
    const result = await routeResearchGuidedCandidatesV2(plan, {
      provider: { async route(value) {
        const response = providerResponse(value);
        response.snapped_waypoints.coordinates[1] = ["private", 47.28];
        return response;
      } }
    });

    assert.equal(result.state, "no_viable_route");
    assert.equal(result.attempts[0].failureCode, "invalid_provider_response");
    assert.equal(JSON.stringify(result).includes("private"), false);
  });

  it("fails closed for oversized route geometry", async () => {
    const dossier = singleMustHaveDossier();
    const plan = buildResearchGuidedRouteCandidatePlanV2(
      dossier,
      accessResolution(dossier.candidateHighlights)
    );
    const maximum = RESEARCH_GUIDED_ROUTED_ALTERNATIVES_POLICY_V2.limits
      .maximumCoordinatesPerPath ?? 100_000;
    const result = await routeResearchGuidedCandidatesV2(plan, {
      provider: { async route(value) {
        const response = providerResponse(value);
        response.paths[0].points.coordinates = Array.from(
          { length: maximum + 1 },
          (_, index) => [
            value.points[0].longitude + (index % 2) * 0.000001,
            value.points[0].latitude + (index % 2) * 0.000001
          ]
        );
        return response;
      } }
    });

    assert.equal(result.state, "no_viable_route");
    assert.equal(result.attempts[0].failureCode, "invalid_provider_response");
  });

  it("keeps an independent eligible survivor after a partial provider failure", async () => {
    const plan = twoProposalV2Plan();
    assert.equal(plan.proposals.length, 2);
    let calls = 0;
    const result = await routeResearchGuidedCandidatesV2(plan, {
      provider: { async route(value) {
        calls += 1;
        if (calls === 1) throw routeError("route_not_found");
        return providerResponse(value);
      } }
    }, { maximumConcurrency: 1 });

    assert.equal(result.state, "partial");
    assert.deepEqual(result.attempts.map((item) => item.state), [
      "failed", "routed"
    ]);
    assert.equal(result.attempts[0].failureCode, "route_not_found");
    assert.equal(
      result.attempts[1].routeResults[0].verificationState,
      "eligible"
    );
  });

  it("does not let an optional access failure poison reached must-haves", async () => {
    const dossier = multiHighlightDossier({
      distanceRangeKm: null,
      mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 1 }],
      preferredExperiences: ["waterfall"]
    });
    const plan = buildResearchGuidedRouteCandidatePlanV2(
      dossier,
      accessResolution(dossier.candidateHighlights, {
        distinctTrailSegments: true
      })
    );
    const selected = plan.proposals[0].selectedHighlights;
    const optionalIndex = selected.findIndex((item) => item.role === "preferred");
    assert(optionalIndex >= 0);

    const result = await routeResearchGuidedCandidatesV2(plan, {
      provider: { async route(value) {
        const response = providerResponse(value);
        response.snapped_waypoints.coordinates[optionalIndex + 1] = [
          value.points[optionalIndex + 1].longitude + 0.02,
          value.points[optionalIndex + 1].latitude + 0.02
        ];
        return response;
      } }
    });
    const route = result.attempts[0].routeResults[0];

    assert.equal(route.verificationState, "eligible");
    assert.equal(result.state, "routed");
    assert.equal(
      route.highlightVerifications[optionalIndex].providerVerifiedAccess,
      false
    );
    assert(result.remainingLimitations.includes(
      "provider_access_snap_exceeds_tolerance"
    ));
  });

  it("cancels provider work and rejects any late completion", async () => {
    const dossier = singleMustHaveDossier();
    const plan = buildResearchGuidedRouteCandidatePlanV2(
      dossier,
      accessResolution(dossier.candidateHighlights)
    );
    const controller = new AbortController();
    let providerSignal;
    let resolveProvider;
    const completion = new Promise((resolve) => { resolveProvider = resolve; });
    const routing = routeResearchGuidedCandidatesV2(plan, {
      provider: { async route(value, context) {
        providerSignal = context.signal;
        await completion;
        return providerResponse(value);
      } }
    }, { signal: controller.signal });

    await delay(1);
    controller.abort();
    await assert.rejects(routing, (error) =>
      error instanceof ResearchGuidedRoutingAdapterError &&
      error.code === "cancelled"
    );
    assert.equal(providerSignal.aborted, true);
    resolveProvider();
    await delay(1);
  });

  it("times out and aborts a provider that ignores cancellation", async () => {
    const dossier = singleMustHaveDossier();
    const plan = buildResearchGuidedRouteCandidatePlanV2(
      dossier,
      accessResolution(dossier.candidateHighlights)
    );
    let providerSignal;
    const result = await routeResearchGuidedCandidatesV2(plan, {
      provider: { async route(_value, context) {
        providerSignal = context.signal;
        return new Promise(() => {});
      } }
    }, { operationTimeoutMilliseconds: 2 });

    assert.equal(result.state, "no_viable_route");
    assert.equal(result.attempts[0].failureCode, "route_timed_out");
    assert.equal(providerSignal.aborted, true);
  });

  it("does not fully verify a route that misses its required highlight", async () => {
    const dossier = singleMustHaveDossier();
    const plan = buildResearchGuidedRouteCandidatePlanV2(
      dossier,
      accessResolution(dossier.candidateHighlights, {
        routingLatitudeOffset: 0.00055
      })
    );
    const result = await routeResearchGuidedCandidatesV2(plan, {
      provider: { async route(value) {
        const response = providerResponse(value);
        const displaced = [
          value.points[1].longitude,
          value.points[1].latitude + 0.00055
        ];
        response.paths[0].points.coordinates = [
          displaced,
          [displaced[0] + 0.000001, displaced[1]]
        ];
        return response;
      } }
    });
    const route = result.attempts[0].routeResults[0];

    assert.equal(route.highlightVerifications[0].providerVerifiedAccess, true);
    assert.equal(route.highlightVerifications[0].approachState, "not_reached");
    assert.equal(route.verificationState, "ineligible");
    assert.equal(result.state, "partial");
  });

  it("rejects unknown fields and identity or verification tampering", async () => {
    const dossier = singleMustHaveDossier();
    const plan = buildResearchGuidedRouteCandidatePlanV2(
      dossier,
      accessResolution(dossier.candidateHighlights)
    );
    const result = await routeResearchGuidedCandidatesV2(plan, {
      provider: { async route(value) { return providerResponse(value); } }
    });
    assert.equal(
      serializeResearchGuidedRoutedAlternativesV2(result),
      serializeResearchGuidedRoutedAlternativesV2(reverseKeys(result))
    );
    assert.throws(() => validateResearchGuidedRoutedAlternativesV2({
      ...result,
      verifiedScenic: true
    }));
    const tampered = structuredClone(result);
    tampered.attempts[0].routeResults[0]
      .highlightVerifications[0].approachState = "not_reached";
    assert.throws(() => validateResearchGuidedRoutedAlternativesV2(tampered));
  });
});

function singleMustHaveDossier() {
  return adventureResearchDossier({
    normalizedIntent: completeAdventureResearchIntent({
      distanceRangeKm: null,
      durationRangeMinutes: null,
      maximumElevationGainMeters: null,
      maximumTechnicalDifficulty: null,
      mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 1 }],
      preferredExperiences: [],
      avoidedExperiences: [],
      requiredFacilities: [],
      dateOrSeason: null
    }),
    regionCoverage: {
      state: "full",
      regionEntityIds: [OUTDOOR_RESEARCH_TEST_IDS.region],
      limitationCodes: []
    },
    evidenceGaps: [],
    freshnessState: "current"
  });
}

function multiHighlightDossier(intentOverrides) {
  const definitions = [
    {
      entityId: "11111111-1111-4111-8111-111111111111",
      claimId: "66666666-6666-4666-8666-666666666666",
      category: "viewpoint",
      coordinate: { latitude: 47.28, longitude: 11.42 }
    },
    {
      entityId: "22222222-2222-4222-8222-222222222222",
      claimId: "77777777-7777-4777-8777-777777777777",
      category: "waterfall",
      coordinate: { latitude: 47.2808, longitude: 11.42 }
    },
    {
      entityId: "34343434-3434-4434-8434-343434343434",
      claimId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      category: "peak",
      coordinate: { latitude: 47.2812, longitude: 11.42 }
    }
  ];
  const claims = definitions.map((item) => evidenceClaim({
    claimId: item.claimId,
    entityId: item.entityId,
    value: { type: "text", value: item.category }
  }));
  const highlights = definitions.map((item) => highlightCandidate({
    entityId: item.entityId,
    highlightCategory: item.category,
    coordinate: item.coordinate,
    relevanceReasons: [{
      code: item.category === "viewpoint"
        ? "mapped_viewpoint"
        : "request_preference",
      evidenceClaimIds: [item.claimId]
    }],
    evidenceClaimIds: [item.claimId]
  }));
  return adventureResearchDossier({
    normalizedIntent: completeAdventureResearchIntent({
      durationRangeMinutes: null,
      maximumElevationGainMeters: null,
      maximumTechnicalDifficulty: null,
      avoidedExperiences: [],
      requiredFacilities: [],
      dateOrSeason: null,
      ...intentOverrides
    }),
    regionCoverage: {
      state: "full",
      regionEntityIds: [OUTDOOR_RESEARCH_TEST_IDS.region],
      limitationCodes: []
    },
    evidenceClaims: claims,
    candidateHighlights: highlights,
    evidenceGaps: [],
    freshnessState: "current"
  });
}

function twoProposalV2Plan() {
  const first = {
    entityId: "11111111-1111-4111-8111-111111111111",
    claimId: "66666666-6666-4666-8666-666666666666",
    coordinate: { latitude: 47.28, longitude: 11.42 }
  };
  const second = {
    entityId: OUTDOOR_RESEARCH_TEST_IDS.secondEntity,
    claimId: OUTDOOR_RESEARCH_TEST_IDS.secondClaim,
    coordinate: { latitude: 47.29, longitude: 11.45 }
  };
  const definitions = [first, second];
  const dossier = adventureResearchDossier({
    normalizedIntent: completeAdventureResearchIntent({
      distanceRangeKm: null,
      durationRangeMinutes: null,
      maximumElevationGainMeters: null,
      maximumTechnicalDifficulty: null,
      mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 1 }],
      preferredExperiences: [],
      avoidedExperiences: [],
      requiredFacilities: [],
      dateOrSeason: null
    }),
    regionCoverage: {
      state: "full",
      regionEntityIds: [OUTDOOR_RESEARCH_TEST_IDS.region],
      limitationCodes: []
    },
    evidenceClaims: definitions.map((item, index) => evidenceClaim({
      claimId: item.claimId,
      entityId: item.entityId,
      provenance: {
        identifier: `node/${index + 1}`,
        adapterVersion: "osm-graph-v1",
        recordVersion: 1
      }
    })),
    candidateHighlights: definitions.map((item) => highlightCandidate({
      entityId: item.entityId,
      coordinate: item.coordinate,
      relevanceReasons: [{
        code: "mapped_viewpoint",
        evidenceClaimIds: [item.claimId]
      }],
      evidenceClaimIds: [item.claimId]
    })),
    evidenceGaps: [],
    freshnessState: "current"
  });
  return buildResearchGuidedRouteCandidatePlanV2(
    dossier,
    accessResolution(dossier.candidateHighlights, {
      distinctTrailSegments: true
    })
  );
}

function accessResolution(highlights, options = {}) {
  const commonRoutingCoordinate = {
    latitude: (
      highlights[0]?.coordinate.latitude +
      highlights[highlights.length - 1]?.coordinate.latitude
    ) / 2,
    longitude: highlights[0]?.coordinate.longitude
  };
  const candidates = options.candidates ?? highlights.map((highlight, index) => {
    const routingCoordinate = options.sameRoutingCoordinate
      ? commonRoutingCoordinate
      : {
        latitude: highlight.coordinate.latitude +
          (options.routingLatitudeOffset ?? 0.00005),
        longitude: highlight.coordinate.longitude
      };
    const distance = distanceMeters(highlight.coordinate, routingCoordinate);
    const base = {
      schemaVersion: 1,
      originalHighlightEntityId: highlight.entityId,
      highlightCategory: highlight.highlightCategory,
      evidenceCoordinate: highlight.coordinate,
      routingCoordinate,
      sourceTrailSegmentEntityId:
        options.sourceTrailSegmentEntityId ??
        (options.distinctTrailSegments
          ? trailID(index)
          : "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
      sourceTrailCategoryEvidenceClaimIds: [TRAIL_CLAIM_ID],
      sourceSnapshot: {
        operationalRegionId: "innsbruck-alps-v1",
        projectionRunId: RUN_ID,
        importId: IMPORT_ID,
        sourceId: OUTDOOR_RESEARCH_TEST_IDS.source,
        sourcePolicyId: POLICY_ID,
        sourcePolicyVersion: "osm-foundational-v1",
        adapterSchemaVersion: "osm-evidence-graph-v1"
      },
      derivationPolicyVersion: "research-trail-access-candidates-v1",
      derivationAlgorithm: "postgis-st-closest-point-v1",
      poiToAccessPointDistanceMeters: distance,
      sourceTrailHighwayClass: "path",
      sourceTrailRecord: {
        importId: IMPORT_ID,
        operationalRegionId: "innsbruck-alps-v1",
        osmType: "way",
        osmId: String(index + 1),
        highwayClass: "path"
      },
      lifecycleState: "current",
      accessCandidateState: "candidate",
      knownLimitations: [
        "mapped_trail_only",
        "provider_connectivity_unverified",
        "provider_access_unverified",
        "public_access_unverified"
      ],
      requiredVerification: [
        "provider_routing_required",
        "provider_snap_required",
        "route_geometry_approach_required",
        "public_access_required"
      ],
      displayName: null,
      freshness: {
        state: "current",
        sourceDataDate: "2026-08-03",
        retrievedDate: "2026-08-04"
      }
    };
    return {
      candidateId: deriveResearchTrailAccessCandidateIdV1(base),
      ...base
    };
  });
  return {
    schemaVersion: 1,
    policyVersion: "research-trail-access-candidates-v1",
    operationalRegionId: "innsbruck-alps-v1",
    projectionRunId: RUN_ID,
    sourceSnapshot: {
      operationalRegionId: "innsbruck-alps-v1",
      projectionRunId: RUN_ID,
      importId: IMPORT_ID,
      sourceId: OUTDOOR_RESEARCH_TEST_IDS.source,
      sourcePolicyId: POLICY_ID,
      sourcePolicyVersion: "osm-foundational-v1",
      adapterSchemaVersion: "osm-evidence-graph-v1",
      freshness: {
        state: "current",
        sourceDataDate: "2026-08-03",
        retrievedDate: "2026-08-04"
      }
    },
    requestedHighlights: highlights.map((item) => ({
      entityId: item.entityId,
      highlightCategory: item.highlightCategory,
      evidenceCoordinate: item.coordinate
    })),
    candidates,
    shortfalls: options.shortfalls ?? []
  };
}

function providerResponse(request, options = {}) {
  const coordinates = request.points.map((point) => [
    point.longitude,
    point.latitude
  ]);
  const result = {
    provider: "graphhopper",
    paths: [{
      distance: options.distance ?? 4_000,
      time: 3_600_000,
      ascend: 150,
      descend: 150,
      points: { type: "LineString", coordinates },
      instructions: []
    }]
  };
  if (options.includeSnaps !== false) {
    result.snapped_waypoints = { type: "LineString", coordinates };
  }
  return result;
}

function trailID(index) {
  return [
    "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    "ffffffff-ffff-4fff-8fff-ffffffffffff",
    "12121212-1212-4212-8212-121212121212"
  ][index];
}

function distanceMeters(start, finish) {
  const radians = Math.PI / 180;
  const latitudeDelta = (finish.latitude - start.latitude) * radians;
  const longitudeDelta = (finish.longitude - start.longitude) * radians;
  const value = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(start.latitude * radians) *
      Math.cos(finish.latitude * radians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 *
    Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}

function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).reverse().map((key) => [key, reverseKeys(value[key])])
  );
}
