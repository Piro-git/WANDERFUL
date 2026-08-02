import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { describe, it } from "node:test";
import {
  planAndRouteOutdoorAdventureV1
} from "../src/outdoorAdventure/outdoorAdventureOrchestrator.js";
import {
  serializeOutdoorAdventurePlanningResponseV1,
  validateOutdoorAdventurePlanningRequestV1,
  validateOutdoorAdventurePlanningResponseV1
} from "../src/outdoorAdventure/orchestrationContract.js";
import {
  buildResearchGuidedRouteCandidatePlanV1
} from "../src/routeResearch/researchGuidedRouteCandidatePlanner.js";
import {
  routeResearchGuidedCandidatesV1
} from "../src/routeResearch/researchGuidedRoutingAdapter.js";
import { routeError } from "../src/routing/routeErrors.js";
import {
  OUTDOOR_RESEARCH_TEST_IDS,
  adventureResearchDossier,
  completeAdventureResearchIntent,
  evidenceClaim,
  highlightCandidate,
  minimalAdventureResearchIntent
} from "./outdoorResearchTestSupport.js";

const HARZ_REGION_ID = "30000000-0000-4000-8000-000000000002";
const SECOND_ENTITY_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_CLAIM_ID = "77777777-7777-4777-8777-777777777777";

describe("outdoor-adventure orchestrator v1", () => {
  it("composes ready research, candidate planning and real routed output", async () => {
    const dossier = routableDossier();
    const calls = [];
    const result = await planAndRouteOutdoorAdventureV1(
      request(dossier.normalizedIntent),
      dependencies(dossier, {
        researchAdventure: async () => {
          calls.push("research");
          return readyResearch(dossier);
        },
        buildCandidatePlan(value, options) {
          calls.push("candidate");
          return buildResearchGuidedRouteCandidatePlanV1(value, options);
        },
        provider: {
          async route(routeRequest) {
            calls.push("provider");
            return providerResponse(routeRequest);
          }
        }
      })
    );

    assert.equal(result.state, "partial");
    assert.equal(result.routedAlternatives.state, "routed");
    assert.equal(result.routedAlternatives.attempts[0].routeResults.length, 1);
    assert.deepEqual(calls, ["research", "candidate", "provider"]);
    assert.doesNotThrow(() =>
      validateOutdoorAdventurePlanningResponseV1(result)
    );
  });

  it("routes a generic loop through mapped fallback evidence without request semantics", async () => {
    const intent = researchIntent({
      mustHaveExperiences: [],
      preferredExperiences: []
    });
    const dossier = routableDossier({ normalizedIntent: intent });
    let providerCalls = 0;
    const result = await planAndRouteOutdoorAdventureV1(
      request(intent),
      dependencies(dossier, {
        provider: {
          async route(routeRequest) {
            providerCalls += 1;
            assert.deepEqual(routeRequest.points[1], {
              latitude: 51.81,
              longitude: 10.62
            });
            return providerResponse(routeRequest);
          }
        }
      })
    );

    assert.equal(result.state, "partial");
    assert.equal(result.routedAlternatives.state, "routed");
    assert.equal(providerCalls, 1);
    assert.deepEqual(result.normalizedIntent.mustHaveExperiences, []);
    assert.deepEqual(result.normalizedIntent.preferredExperiences, []);
    const selected =
      result.routedAlternatives.attempts[0].provenance.selectedWaypoints[0];
    assert.deepEqual(selected.selectionReasons, [
      "available_research_candidate"
    ]);
    assert.equal(selected.role, "available_candidate");
    assert.notEqual(selected.role, "preferred");
    assert.notEqual(selected.role, "must_have");
    assert.equal(selected.highlightCategory, "viewpoint");
    const serialized = serializeOutdoorAdventurePlanningResponseV1(result);
    for (const forbidden of [
      "required_experience",
      "preferred_experience",
      "scenic",
      "public_access_verified",
      "safe"
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });

  it("returns the server-owned reviewed region binding for a nil request binding", async () => {
    const dossier = routableDossier();
    const intent = researchIntent({
      geographicAnchor: {
        state: "resolved",
        name: "Harz",
        coordinate: { latitude: 51.8, longitude: 10.6 },
        regionEntityId: null
      }
    });
    const result = await planAndRouteOutdoorAdventureV1(
      request(intent),
      dependencies(dossier)
    );
    assert.equal(
      result.normalizedIntent.geographicAnchor.regionEntityId,
      HARZ_REGION_ID
    );
    assert.equal(
      result.routedAlternatives.normalizedIntent.geographicAnchor.regionEntityId,
      HARZ_REGION_ID
    );
  });

  it("permits deterministic set ordering without changing intent meaning", async () => {
    const dossier = routableDossier();
    const intent = researchIntent({
      preferredExperiences: ["peak", "forest"],
      avoidedExperiences: ["steep_climbs", "crowds"]
    });
    const result = await planAndRouteOutdoorAdventureV1(
      request(intent),
      dependencies(dossier, {
        researchAdventure: async (normalizedIntent) => {
          assert.deepEqual(
            normalizedIntent.preferredExperiences,
            ["forest", "peak"]
          );
          assert.deepEqual(
            normalizedIntent.avoidedExperiences,
            ["crowds", "steep_climbs"]
          );
          return {
            state: "unsupported",
            normalizedIntent,
            planningGaps: [],
            availabilityState: "unsupported_activity"
          };
        }
      })
    );
    assert.equal(result.state, "unsupported");
    assert.deepEqual(result.normalizedIntent.preferredExperiences, [
      "forest",
      "peak"
    ]);
  });

  it("returns clarification with zero research-repository and provider calls", async () => {
    let repositoryCalls = 0;
    let providerCalls = 0;
    const intent = minimalAdventureResearchIntent();
    const result = await planAndRouteOutdoorAdventureV1(
      request(intent),
      {
        repository: {
          async withConsistentSnapshot() {
            repositoryCalls += 1;
            assert.fail("repository called");
          }
        },
        provider: {
          async route() {
            providerCalls += 1;
            assert.fail("provider called");
          }
        }
      }
    );
    assert.equal(result.state, "clarification_required");
    assert.deepEqual(
      result.clarificationQuestions,
      intent.unresolvedClarificationQuestions
    );
    assert.equal(repositoryCalls, 0);
    assert.equal(providerCalls, 0);
  });

  it("returns unsupported outside reviewed coverage with zero repository and provider calls", async () => {
    let repositoryCalls = 0;
    let providerCalls = 0;
    const intent = completeAdventureResearchIntent({
      geographicAnchor: {
        state: "resolved",
        name: "Outside reviewed coverage",
        coordinate: { latitude: 45, longitude: 8 },
        regionEntityId: null
      }
    });
    const result = await planAndRouteOutdoorAdventureV1(
      request(intent),
      {
        repository: {
          async withConsistentSnapshot() {
            repositoryCalls += 1;
            assert.fail("repository called");
          }
        },
        provider: {
          async route() {
            providerCalls += 1;
            assert.fail("provider called");
          }
        }
      }
    );
    assert.equal(result.state, "unsupported");
    assert.equal(result.routedAlternatives, null);
    assert.equal(repositoryCalls, 0);
    assert.equal(providerCalls, 0);
  });

  it("returns no viable route for insufficient evidence without provider work", async () => {
    const intent = researchIntent({
      mustHaveExperiences: [],
      preferredExperiences: []
    });
    const dossier = routableDossier({
      normalizedIntent: intent,
      evidenceClaims: [],
      candidateHighlights: [],
      sourceProvenanceSummary: [],
      freshnessState: "unknown"
    });
    let providerCalls = 0;
    const result = await planAndRouteOutdoorAdventureV1(
      request(dossier.normalizedIntent),
      dependencies(dossier, {
        provider: {
          async route() {
            providerCalls += 1;
            assert.fail("provider called");
          }
        }
      })
    );
    assert.equal(result.state, "no_viable_route");
    assert.equal(result.routedAlternatives, null);
    assert.equal(providerCalls, 0);
  });

  it("keeps unsupported biking decodable and performs zero provider work", async () => {
    const dossier = routableDossier({
      normalizedIntent: researchIntent({
        activity: "biking",
        mustHaveExperiences: [],
        preferredExperiences: []
      })
    });
    let providerCalls = 0;
    const result = await planAndRouteOutdoorAdventureV1(
      request(dossier.normalizedIntent),
      dependencies(dossier, {
        provider: {
          async route() {
            providerCalls += 1;
            assert.fail("provider called");
          }
        }
      })
    );
    assert.equal(result.state, "unsupported");
    assert.equal(result.routedAlternatives, null);
    assert.equal(providerCalls, 0);
  });

  it("fails point-to-point and out-and-back closed without loop conversion", async () => {
    for (const routeType of ["point_to_point", "out_and_back"]) {
      const dossier = routableDossier({
        normalizedIntent: researchIntent({
          routeType,
          mustHaveExperiences: [],
          preferredExperiences: []
        })
      });
      let providerCalls = 0;
      const result = await planAndRouteOutdoorAdventureV1(
        request(dossier.normalizedIntent),
        dependencies(dossier, {
          provider: {
            async route() {
              providerCalls += 1;
              assert.fail("provider called");
            }
          }
        })
      );
      assert.equal(result.state, "unsupported");
      assert.equal(result.routedAlternatives.state, "unsupported");
      assert.equal(providerCalls, 0);
      assert(result.routedAlternatives.attempts.every((attempt) =>
        attempt.failureCode === (
          routeType === "point_to_point"
            ? "unsupported_point_to_point"
            : "unsupported_out_and_back"
        )
      ));
    }
  });

  it("bounds provider concurrency at two and preserves proposal order", async () => {
    const dossier = diverseRoutableDossier();
    let active = 0;
    let maximumActive = 0;
    const completionOrder = [];
    const result = await planAndRouteOutdoorAdventureV1(
      request(dossier.normalizedIntent),
      dependencies(dossier, {
        provider: {
          async route(routeRequest) {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            const first = routeRequest.points[1].longitude === 10.62;
            await delay(first ? 20 : 1);
            completionOrder.push(first ? "first" : "second");
            active -= 1;
            return providerResponse(routeRequest, {
              offset: first ? 0.01 : -0.01
            });
          }
        }
      }),
      { maximumProposals: 2, maximumConcurrency: 2 }
    );
    assert.equal(result.routedAlternatives.attempts.length, 2);
    assert.equal(maximumActive, 2);
    assert.deepEqual(
      result.routedAlternatives.attempts.map((attempt) =>
        attempt.proposalIndex
      ),
      [0, 1]
    );
    assert.equal(completionOrder.length, 2);
  });

  it("preserves a real route and limitations after partial provider failure", async () => {
    const dossier = diverseRoutableDossier();
    let calls = 0;
    const result = await planAndRouteOutdoorAdventureV1(
      request(dossier.normalizedIntent),
      dependencies(dossier, {
        provider: {
          async route(routeRequest) {
            calls += 1;
            if (calls === 1) throw routeError("route_not_found");
            return providerResponse(routeRequest);
          }
        }
      }),
      { maximumProposals: 2, maximumConcurrency: 1 }
    );
    assert.equal(result.state, "partial");
    assert.equal(result.routedAlternatives.state, "partial");
    assert.deepEqual(
      result.routedAlternatives.attempts.map((attempt) => attempt.state),
      ["failed", "routed"]
    );
    assert(result.routedAlternatives.remainingLimitations
      .includes("provider_failure"));
  });

  it("never reports success when every provider attempt fails", async () => {
    const dossier = diverseRoutableDossier();
    const result = await planAndRouteOutdoorAdventureV1(
      request(dossier.normalizedIntent),
      dependencies(dossier, {
        provider: {
          async route() {
            throw routeError("route_not_found");
          }
        }
      }),
      { maximumProposals: 2 }
    );
    assert.equal(result.state, "no_viable_route");
    assert.equal(result.routedAlternatives.state, "no_viable_route");
    assert.equal(
      result.routedAlternatives.attempts.some((attempt) =>
        attempt.state === "routed"
      ),
      false
    );
  });

  it("rejects tampered intermediate output at the next validator boundary", async () => {
    const dossier = routableDossier();
    let providerCalls = 0;
    await assert.rejects(
      () => planAndRouteOutdoorAdventureV1(
        request(dossier.normalizedIntent),
        dependencies(dossier, {
          buildCandidatePlan(value, options) {
            const plan = structuredClone(
              buildResearchGuidedRouteCandidatePlanV1(value, options)
            );
            plan.proposals[0].proposalId =
              "rrcpv1_00000000000000000000000000000000";
            return plan;
          },
          provider: {
            async route() {
              providerCalls += 1;
              assert.fail("provider called");
            }
          }
        })
      ),
      hasCode("internal_failure")
    );
    assert.equal(providerCalls, 0);
  });

  it("rejects injected intent substitution at every orchestration boundary", async () => {
    const dossier = routableDossier();
    const substitutedDossier = routableDossier({
      normalizedIntent: researchIntent({
        preferredExperiences: ["forest"]
      })
    });

    let providerCalls = 0;
    const provider = {
      async route(routeRequest) {
        providerCalls += 1;
        return providerResponse(routeRequest);
      }
    };

    await assert.rejects(
      () => planAndRouteOutdoorAdventureV1(
        request(dossier.normalizedIntent),
        dependencies(substitutedDossier, { provider })
      ),
      hasCode("internal_failure")
    );
    assert.equal(providerCalls, 0);

    await assert.rejects(
      () => planAndRouteOutdoorAdventureV1(
        request(dossier.normalizedIntent),
        dependencies(dossier, {
          buildCandidatePlan(_value, options) {
            return buildResearchGuidedRouteCandidatePlanV1(
              substitutedDossier,
              options
            );
          },
          provider
        })
      ),
      hasCode("internal_failure")
    );
    assert.equal(providerCalls, 0);

    await assert.rejects(
      () => planAndRouteOutdoorAdventureV1(
        request(dossier.normalizedIntent),
        dependencies(dossier, {
          async routeCandidates(candidatePlan, routeDependencies, options) {
            const routed = await routeResearchGuidedCandidatesV1(
              candidatePlan,
              routeDependencies,
              options
            );
            return {
              ...routed,
              normalizedIntent: substitutedDossier.normalizedIntent
            };
          },
          provider
        })
      ),
      hasCode("internal_failure")
    );
    assert.equal(providerCalls, 1);
  });

  it("cancels before execution and while research or routing is active", async () => {
    const dossier = routableDossier();
    const alreadyCancelled = new AbortController();
    alreadyCancelled.abort();
    let researchCalls = 0;
    await assert.rejects(
      () => planAndRouteOutdoorAdventureV1(
        request(dossier.normalizedIntent),
        dependencies(dossier, {
          researchAdventure: async () => {
            researchCalls += 1;
            return readyResearch(dossier);
          }
        }),
        { signal: alreadyCancelled.signal }
      ),
      hasCode("cancelled")
    );
    assert.equal(researchCalls, 0);

    const researchCancellation = new AbortController();
    let researchStarted;
    const researchDidStart = new Promise((resolve) => {
      researchStarted = resolve;
    });
    const duringResearch = planAndRouteOutdoorAdventureV1(
      request(dossier.normalizedIntent),
      dependencies(dossier, {
        researchAdventure: async (_intent, deps) => {
          researchStarted();
          await abortablePending(deps.signal);
        }
      }),
      { signal: researchCancellation.signal }
    );
    await researchDidStart;
    researchCancellation.abort();
    await assert.rejects(duringResearch, hasCode("cancelled"));

    const routingCancellation = new AbortController();
    let providerStarted;
    const providerDidStart = new Promise((resolve) => {
      providerStarted = resolve;
    });
    const duringRouting = planAndRouteOutdoorAdventureV1(
      request(dossier.normalizedIntent),
      dependencies(dossier, {
        provider: {
          async route(_routeRequest, context) {
            providerStarted();
            await abortablePending(context.signal);
          }
        }
      }),
      { signal: routingCancellation.signal }
    );
    await providerDidStart;
    routingCancellation.abort();
    await assert.rejects(duringRouting, hasCode("cancelled"));
  });

  it("enforces the overall deadline and detaches a late dependency result", async () => {
    const dossier = routableDossier();
    let lateResolve;
    const lateResearch = new Promise((resolve) => {
      lateResolve = resolve;
    });
    const pending = planAndRouteOutdoorAdventureV1(
      request(dossier.normalizedIntent),
      dependencies(dossier, {
        researchAdventure: async () => lateResearch
      }),
      {
        totalDeadlineMs: 1_000,
        researchTimeoutMs: 500,
        graphHopperAttemptTimeoutMs: 1_000 - 1
      }
    );
    await assert.rejects(pending, hasCode("feature_unavailable"));

    const timed = planAndRouteOutdoorAdventureV1(
      request(dossier.normalizedIntent),
      dependencies(dossier, {
        researchAdventure: async () => lateResearch
      }),
      {
        totalDeadlineMs: 1_001,
        researchTimeoutMs: 500,
        graphHopperAttemptTimeoutMs: 1_000
      }
    );
    await assert.rejects(timed, hasCode("timed_out"));
    lateResolve(readyResearch(dossier));
    await delay(5);
  });

  it("strictly rejects raw prompts and unknown fields and serializes deterministically", async () => {
    assert.throws(
      () => validateOutdoorAdventurePlanningRequestV1({
        schemaVersion: 1,
        intent: researchIntent(),
        prompt: "private raw prompt"
      }),
      hasCode("invalid_request")
    );
    assert.throws(
      () => validateOutdoorAdventurePlanningRequestV1({
        schemaVersion: 1,
        prompt: "private raw prompt"
      }),
      hasCode("invalid_request")
    );
    assert.throws(
      () => validateOutdoorAdventurePlanningRequestV1({
        ...request(researchIntent()),
        padding: "x".repeat(132_000)
      }),
      hasCode("invalid_request")
    );

    const dossier = routableDossier();
    const result = await planAndRouteOutdoorAdventureV1(
      request(dossier.normalizedIntent),
      dependencies(dossier)
    );
    const reversed = reverseObjectKeys(result);
    assert.equal(
      serializeOutdoorAdventurePlanningResponseV1(result),
      serializeOutdoorAdventurePlanningResponseV1(reversed)
    );
    assert.throws(
      () => validateOutdoorAdventurePlanningResponseV1({
        ...result,
        padding: "x".repeat(10 * 1_024 * 1_024)
      }),
      hasCode("response_too_large")
    );
    assert.throws(
      () => validateOutdoorAdventurePlanningResponseV1({
        ...result,
        state: "routed",
        routedAlternatives: null
      }),
      hasCode("internal_failure")
    );
    assert.throws(
      () => validateOutdoorAdventurePlanningResponseV1({
        ...result,
        state: "routed",
        planningGaps: [{
          code: "unsupported_evidence_dimension",
          affectedField: "preferredExperiences",
          affectedValue: "forest",
          reason: "contract_dimension_missing",
          requiresClarification: false,
          requiresCapability: false
        }]
      }),
      hasCode("internal_failure")
    );
  });
});

function request(intent) {
  return { schemaVersion: 1, intent };
}

function dependencies(dossier, overrides = {}) {
  return {
    repository: {
      async withConsistentSnapshot() {
        assert.fail("injected research should not use repository");
      }
    },
    provider: {
      async route(routeRequest) {
        return providerResponse(routeRequest);
      }
    },
    researchAdventure: async () => readyResearch(dossier),
    ...overrides
  };
}

function readyResearch(dossier) {
  return {
    state: "ready",
    normalizedIntent: dossier.normalizedIntent,
    planningGaps: [],
    dossier
  };
}

function researchIntent(overrides = {}) {
  return completeAdventureResearchIntent({
    geographicAnchor: {
      state: "resolved",
      name: "Harz",
      coordinate: { latitude: 51.8, longitude: 10.6 },
      regionEntityId: HARZ_REGION_ID
    },
    distanceRangeKm: { min: 10, max: 14 },
    durationRangeMinutes: null,
    maximumElevationGainMeters: null,
    maximumTechnicalDifficulty: null,
    mustHaveExperiences: [
      { experience: "viewpoint", minimumCount: 1 }
    ],
    preferredExperiences: [],
    avoidedExperiences: [],
    requiredFacilities: [],
    dateOrSeason: null,
    transportRequirements: {
      arrivalMode: "walking",
      returnToStart: true,
      publicTransportRequired: false
    },
    ...overrides
  });
}

function routableDossier(overrides = {}) {
  return adventureResearchDossier({
    normalizedIntent: researchIntent(),
    regionCoverage: {
      state: "full",
      regionEntityIds: [HARZ_REGION_ID],
      limitationCodes: []
    },
    candidateHighlights: [highlightCandidate({
      coordinate: { latitude: 51.81, longitude: 10.62 }
    })],
    evidenceGaps: [],
    ...overrides
  });
}

function diverseRoutableDossier() {
  const secondClaim = evidenceClaim({
    claimId: SECOND_CLAIM_ID,
    entityId: SECOND_ENTITY_ID,
    provenance: {
      identifier: "node/456",
      adapterVersion: "osm-graph-v1",
      recordVersion: 2
    }
  });
  const secondHighlight = highlightCandidate({
    entityId: SECOND_ENTITY_ID,
    coordinate: { latitude: 51.82, longitude: 10.64 },
    relevanceReasons: [{
      code: "mapped_viewpoint",
      evidenceClaimIds: [SECOND_CLAIM_ID]
    }],
    evidenceClaimIds: [SECOND_CLAIM_ID]
  });
  return routableDossier({
    evidenceClaims: [evidenceClaim(), secondClaim],
    candidateHighlights: [highlightCandidate({
      coordinate: { latitude: 51.81, longitude: 10.62 }
    }), secondHighlight],
    sourceProvenanceSummary: [{
      sourceId: OUTDOOR_RESEARCH_TEST_IDS.source,
      sourceKey: "openstreetmap.harz-v1",
      sourceCategory: "openstreetmap_open_mapping",
      evidenceClasses: ["mapped"],
      licenseIdentifier: "ODbL-1.0",
      attributionRequired: true,
      retrievedAt: "2026-07-20T09:00:00Z"
    }]
  });
}

function providerResponse(routeRequest, { offset = 0.01 } = {}) {
  const start = routeRequest.points[0];
  const via = routeRequest.points[1];
  return {
    provider: "graphhopper",
    paths: [{
      distance: 12_000,
      time: 10_800_000,
      ascend: 400,
      descend: 400,
      points: {
        type: "LineString",
        coordinates: [
          [start.longitude, start.latitude, 500],
          [via.longitude, via.latitude, 650],
          [start.longitude + offset, start.latitude - 0.01, 575],
          [start.longitude, start.latitude, 500]
        ]
      },
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
        coordinates: routeRequest.points.map((point) => [
          point.longitude,
          point.latitude
        ])
      }
    }]
  };
}

function abortablePending(signal) {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
      return;
    }
    signal.addEventListener("abort", () => {
      reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
    }, { once: true });
  });
}

function hasCode(code) {
  return (error) => {
    assert.equal(error.code, code);
    assert.equal(error.message.length < 120, true);
    return true;
  };
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
