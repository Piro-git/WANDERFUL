import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  evaluateLLMRouteCandidateV1,
  planLLMFirstAdventureV1
} from "../src/llmPlanning/llmFirstPlanningOrchestrator.js";
import {
  validateLLMFirstPlanningRequestV1,
  validateLLMRoutePlanV1
} from "../src/llmPlanning/llmFirstPlanningContract.js";

const START = coordinate(51.8660, 10.6640);
const STOP_ONE = coordinate(51.8610, 10.6760);
const STOP_TWO = coordinate(51.8700, 10.6850);
const STOP_THREE = coordinate(51.8780, 10.6720);
const FINISH = coordinate(51.8750, 10.6940);
const LOOP = [START, STOP_ONE, STOP_TWO, STOP_THREE, START];
const REQUEST = Object.freeze({
  schemaVersion: 1,
  prompt: "Build a loop from Ilsenburg with three named stops.",
  locale: "en",
  userLocationHint: null
});

const corpus = JSON.parse(await readFile(
  new URL("./fixtures/llmFirstPlanningCorpusV1.json", import.meta.url),
  "utf8"
));

test("LLM-first contract is strict and forbids geometry or safety claims", () => {
  assert.deepEqual(validateLLMFirstPlanningRequestV1(REQUEST), REQUEST);
  assert.throws(() => validateLLMRoutePlanV1({
    ...loopPlan(),
    geometry: { type: "LineString", coordinates: [] }
  }));
  assert.throws(() => validateLLMRoutePlanV1({
    ...loopPlan(),
    intent: { ...loopPlan().intent, safetyVerified: true }
  }));
  const plan = loopPlan();
  assert.throws(() => validateLLMRoutePlanV1({
    ...plan,
    candidates: [plan.candidates[0], {
      stops: [{ role: "stop", kind: "landmark", name: "Fourth Stop" }]
    }]
  }));
});

test("rejects non-GraphHopper provenance and route-type metadata mismatches", () => {
  const intent = loopPlan().intent;
  const request = routeRequestFor(intent, LOOP);
  assert.equal(evaluateLLMRouteCandidateV1({
    intent,
    routeRequest: request,
    requestedWaypoints: LOOP,
    providerResponse: { ...providerResponse(LOOP, LOOP), provider: "fixture" }
  }).reasonCode, "invalid_provider_provenance");
  assert.equal(evaluateLLMRouteCandidateV1({
    intent,
    routeRequest: { ...request, routeType: "pointToPoint" },
    requestedWaypoints: LOOP,
    providerResponse: providerResponse(LOOP, LOOP)
  }).reasonCode, "route_type_mismatch");
});

test("offline LLM-first corpus covers every required deterministic case", async (context) => {
  assert.equal(corpus.schemaVersion, 1);
  assert.equal(corpus.policyVersion, "llm-first-route-planning-v1");
  const required = new Set([
    "useful_three_stop_loop", "hallucinated_start", "ambiguous_start",
    "empty_llm_candidates_fallback", "duplicate_candidates",
    "provider_failure_and_fallback_exhaustion", "llm_timeout", "cancelled",
    "reordered_stops", "unreachable_stop", "bad_snapping", "excessive_detour",
    "excessive_backtracking", "malformed_statistics", "malformed_geometry",
    "wrong_activity_profile", "target_distance_deviation", "invalid_loop_shape",
    "difficulty_evidence_conflict", "access_evidence_conflict"
  ]);
  assert.deepEqual(new Set(corpus.cases.map((item) => item.id)), required);

  for (const fixture of corpus.cases) {
    await context.test(fixture.id, async () => {
      if (fixture.mode === "orchestrator") {
        await assertOrchestratorFixture(fixture);
      } else {
        const evaluation = evaluateFixture(fixture.id);
        assert.equal(evaluation.accepted, false);
        assert.equal(evaluation.reasonCode, fixture.expectedReason);
      }
    });
  }
});

test("successful planning is deterministic, bounded, and diagnostic-safe", async () => {
  const routeRequests = [];
  const result = await planLLMFirstAdventureV1(
    REQUEST,
    dependencies({
      provider: {
        async route(request) {
          routeRequests.push(request);
          return providerResponse(LOOP, request.points);
        }
      }
    })
  );
  assert.equal(result.state, "routed");
  assert.equal(result.routes.length, 1);
  assert.equal(result.routes[0].geometryProvider, "graphhopper");
  assert.equal(result.routes[0].profile, "foot");
  assert.equal(result.routes[0].stops.length, 3);
  assert.equal(result.diagnostics.fallbackAttemptCount, 0);
  assert.equal(routeRequests.length, 1);
  assert.equal(routeRequests[0].points.length, 5);
  assert.equal(JSON.stringify(result.diagnostics).includes("Ilsenburg"), false);
  assert.equal(JSON.stringify(result.rejections).includes("10.664"), false);
});

test("asks for clarification before geocoding when required place anchors are uncertain", async () => {
  const plan = loopPlan();
  plan.intent.startLocationName = null;
  plan.candidates = [];
  let geocodeCalls = 0;
  let routeCalls = 0;
  const result = await planLLMFirstAdventureV1(REQUEST, dependencies({
    generatePlan: async () => plan,
    geocode: async () => { geocodeCalls += 1; return []; },
    provider: { async route() { routeCalls += 1; } }
  }));
  assert.equal(result.state, "clarification");
  assert.equal(result.recovery.code, "clarification_required");
  assert.equal(geocodeCalls, 0);
  assert.equal(routeCalls, 0);
});

test("routes hiking and trail-running loops and point-to-point plans through GraphHopper", async (context) => {
  for (const activityType of ["hiking", "trailRunning"]) {
    for (const routeType of ["loop", "pointToPoint"]) {
      await context.test(`${activityType}_${routeType}`, async () => {
        const plan = loopPlan();
        plan.intent.activityType = activityType;
        plan.intent.routeType = routeType;
        plan.intent.endLocationName = routeType === "loop" ? null : "Schierke";
        if (routeType === "pointToPoint") {
          plan.candidates[0].stops = [plan.candidates[0].stops[0]];
        }
        const path = routeType === "loop"
          ? LOOP
          : [START, STOP_ONE, FINISH];
        const result = await planLLMFirstAdventureV1(REQUEST, dependencies({
          generatePlan: async () => plan,
          geocode: async (name) => name === "Schierke"
            ? [geocoderCandidate(name, FINISH, 0.95, 0)]
            : geocoderResults(name),
          provider: {
            async route(request) {
              assert.equal(request.profile, "foot");
              assert.equal(request.routeType, routeType);
              return providerResponse(path, request.points);
            }
          }
        }));
        assert.equal(result.state, "routed");
        assert.equal(result.routes.length, 1);
        assert.equal(result.routes[0].activityType, activityType);
        assert.equal(result.routes[0].routeType, routeType);
      });
    }
  }
});

test("ignores stale LLM completion after timeout and performs no downstream work", async () => {
  let finishLLM;
  let geocodeCalls = 0;
  let routeCalls = 0;
  const result = await planLLMFirstAdventureV1(REQUEST, dependencies({
    generatePlan: () => new Promise((resolve) => { finishLLM = resolve; }),
    geocode: async () => { geocodeCalls += 1; return []; },
    provider: { async route() { routeCalls += 1; return providerResponse(LOOP, LOOP); } }
  }), { llmTimeoutMs: 100 });
  finishLLM(loopPlan());
  await Promise.resolve();
  assert.equal(result.state, "recovery");
  assert.ok(result.rejections.some((item) => item.code === "llm_timed_out"));
  assert.equal(geocodeCalls, 0);
  assert.equal(routeCalls, 0);
});

test("caps unique geocodes at five and GraphHopper work at three proposals plus one fallback", async () => {
  const stopNames = Array.from({ length: 3 }, (_, index) => `Stop ${index + 1}`);
  const plan = {
    ...loopPlan(),
    intent: {
      ...loopPlan().intent,
      routeType: "pointToPoint",
      startLocationName: "Start",
      endLocationName: "Finish"
    },
    candidates: Array.from({ length: 3 }, (_, candidateIndex) => ({
      stops: [stopNames[candidateIndex]].map((name) => ({
        role: "stop",
        kind: "landmark",
        name
      }))
    }))
  };
  let geocodeCalls = 0;
  let routeCalls = 0;
  let activeRoutes = 0;
  let maximumActiveRoutes = 0;
  const result = await planLLMFirstAdventureV1(REQUEST, dependencies({
    generatePlan: async () => plan,
    geocode: async (name) => {
      geocodeCalls += 1;
      const index = ["Start", ...stopNames, "Finish"].indexOf(name);
      return [geocoderCandidate(name, coordinate(51.80 + index * 0.001, 10.60), 0.95, 0)];
    },
    provider: {
      async route() {
        routeCalls += 1;
        activeRoutes += 1;
        maximumActiveRoutes = Math.max(maximumActiveRoutes, activeRoutes);
        await new Promise((resolve) => setImmediate(resolve));
        activeRoutes -= 1;
        throw new Error("unavailable");
      }
    }
  }));
  assert.equal(result.state, "recovery");
  assert.equal(geocodeCalls, 5);
  assert.equal(routeCalls, 4);
  assert.equal(maximumActiveRoutes, 2);
  assert.equal(result.diagnostics.fallbackAttemptCount, 1);
});

test("caller cancellation aborts LLM work and never routes or falls back", async () => {
  const controller = new AbortController();
  let providerCalls = 0;
  const planning = planLLMFirstAdventureV1(
    REQUEST,
    dependencies({
      generatePlan: (_request, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
      provider: { async route() { providerCalls += 1; return providerResponse(LOOP, LOOP); } }
    }),
    { signal: controller.signal }
  );
  controller.abort();
  await assert.rejects(planning, (error) => error.code === "cancelled");
  assert.equal(providerCalls, 0);
});

test("maps inner adapter deadlines to the existing timeout rejection codes", async () => {
  const timeout = () => Object.assign(new Error("not reflected"), { code: "timed_out" });
  const llmResult = await planLLMFirstAdventureV1(
    REQUEST,
    dependencies({ generatePlan: async () => { throw timeout(); } })
  );
  assert.ok(llmResult.rejections.some((item) => item.code === "llm_timed_out"));

  const geocoderResult = await planLLMFirstAdventureV1(
    REQUEST,
    dependencies({ geocode: async () => { throw timeout(); } })
  );
  assert.ok(
    geocoderResult.rejections.some((item) => item.code === "geocoder_timed_out")
  );
  assert.equal(JSON.stringify(geocoderResult).includes("not reflected"), false);
});

async function assertOrchestratorFixture(fixture) {
  let providerCalls = 0;
  const overrides = {};
  if (fixture.id === "hallucinated_start") {
    overrides.geocode = async (name) => name === "Ilsenburg" ? [] : geocoderResults(name);
  }
  if (fixture.id === "ambiguous_start") {
    overrides.geocode = async (name) => name === "Ilsenburg"
      ? [
          geocoderCandidate("Ilsenburg, Germany", START, 0.90, 0),
          geocoderCandidate("Ilsenburg, Austria", coordinate(47.20, 11.40), 0.85, 1)
        ]
      : geocoderResults(name);
  }
  if (fixture.id === "empty_llm_candidates_fallback") {
    overrides.generatePlan = async () => ({ ...loopPlan(), candidates: [] });
  }
  if (fixture.id === "duplicate_candidates") {
    const plan = loopPlan();
    plan.candidates[0].stops = [plan.candidates[0].stops[0]];
    overrides.generatePlan = async () => ({
      ...plan,
      candidates: [plan.candidates[0], plan.candidates[0]]
    });
  }
  if (fixture.id === "provider_failure_and_fallback_exhaustion") {
    overrides.provider = { async route() { providerCalls += 1; throw new Error("offline"); } };
  }
  if (fixture.id === "llm_timeout") {
    overrides.generatePlan = async () => new Promise(() => {});
  }
  if (fixture.id === "cancelled") {
    const controller = new AbortController();
    const promise = planLLMFirstAdventureV1(
      REQUEST,
      dependencies({
        generatePlan: (_request, { signal }) => new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
        })
      }),
      { signal: controller.signal }
    );
    controller.abort();
    await assert.rejects(promise, (error) => error.code === fixture.expectedError);
    return;
  }
  if (!overrides.provider) {
    overrides.provider = {
      async route(request) {
        providerCalls += 1;
        return providerResponse(
          request.algorithm === "round_trip" ? LOOP : LOOP,
          request.points
        );
      }
    };
  }
  const options = fixture.id === "llm_timeout" ? { llmTimeoutMs: 100 } : {};
  const result = await planLLMFirstAdventureV1(REQUEST, dependencies(overrides), options);
  if (fixture.expectedState) assert.equal(result.state, fixture.expectedState);
  if (fixture.expectedReason) {
    assert.ok(result.rejections.some((item) => item.code === fixture.expectedReason));
  }
  if (["hallucinated_start", "ambiguous_start"].includes(fixture.id)) {
    assert.equal(result.state, "clarification");
  }
  if (fixture.id === "empty_llm_candidates_fallback") {
    assert.equal(result.routes[0].source, "fallback");
    assert.equal(result.diagnostics.fallbackAttemptCount, 1);
    assert.equal(providerCalls, 1);
  }
  if (fixture.id === "duplicate_candidates") {
    assert.equal(providerCalls, 1);
  }
  if (fixture.id === "provider_failure_and_fallback_exhaustion") {
    assert.equal(result.state, "recovery");
    assert.equal(result.diagnostics.fallbackAttemptCount, 1);
    assert.equal(providerCalls, 2);
  }
}

function evaluateFixture(id) {
  const intent = { ...loopPlan().intent };
  let requestedWaypoints = LOOP;
  let coordinates = LOOP;
  let snaps = LOOP;
  let routeRequest = routeRequestFor(intent, requestedWaypoints);
  let response = providerResponse(coordinates, snaps);

  if (id === "reordered_stops") {
    coordinates = [START, STOP_TWO, STOP_ONE, STOP_THREE, START];
    response = providerResponse(coordinates, snaps);
  } else if (id === "unreachable_stop") {
    coordinates = [START, coordinate(51.8665, 10.6645), STOP_THREE, START];
    response = providerResponse(coordinates, snaps);
  } else if (id === "bad_snapping") {
    snaps = [coordinate(51.90, 10.70), STOP_ONE, STOP_TWO, STOP_THREE, START];
    response = providerResponse(coordinates, snaps);
  } else if (id === "excessive_detour") {
    intent.routeType = "pointToPoint";
    intent.targetDistanceKm = null;
    requestedWaypoints = [START, FINISH];
    coordinates = [START, coordinate(52.10, 10.20), FINISH];
    snaps = requestedWaypoints;
    routeRequest = routeRequestFor(intent, requestedWaypoints);
    response = providerResponse(coordinates, snaps);
  } else if (id === "excessive_backtracking") {
    intent.routeType = "pointToPoint";
    intent.targetDistanceKm = null;
    coordinates = [START, STOP_ONE, START, STOP_ONE, FINISH];
    requestedWaypoints = coordinates;
    snaps = coordinates;
    routeRequest = routeRequestFor(intent, requestedWaypoints);
    response = providerResponse(coordinates, snaps);
  } else if (id === "malformed_statistics") {
    response = providerResponse(coordinates, snaps);
    response.paths[0].distance *= 3;
    response.paths[0].instructions[0].distance = response.paths[0].distance;
  } else if (id === "malformed_geometry") {
    response = providerResponse(coordinates, snaps);
    response.paths[0].points.coordinates = [[10.664, 95], [10.665, 95]];
  } else if (id === "wrong_activity_profile") {
    routeRequest = { ...routeRequest, profile: "bike" };
  } else if (id === "target_distance_deviation") {
    intent.targetDistanceKm = 40;
  } else if (id === "invalid_loop_shape") {
    coordinates = [
      START,
      coordinate(51.8662, 10.6642),
      coordinate(51.8661, 10.6641),
      START
    ];
    requestedWaypoints = coordinates;
    snaps = coordinates;
    routeRequest = routeRequestFor(intent, requestedWaypoints);
    response = providerResponse(coordinates, snaps);
  } else if (id === "difficulty_evidence_conflict") {
    intent.difficulty = "easy";
    response.paths[0].details.hike_rating = [[0, coordinates.length - 1, 4]];
  } else if (id === "access_evidence_conflict") {
    response.paths[0].details.road_class = [[0, coordinates.length - 1, "motorway"]];
  }

  return evaluateLLMRouteCandidateV1({
    intent,
    routeRequest,
    requestedWaypoints,
    providerResponse: response
  });
}

function dependencies(overrides = {}) {
  return {
    generatePlan: overrides.generatePlan ?? (async () => loopPlan()),
    geocode: overrides.geocode ?? (async (name) => geocoderResults(name)),
    provider: overrides.provider ?? {
      async route(request) { return providerResponse(LOOP, request.points); }
    }
  };
}

function loopPlan() {
  return {
    schemaVersion: 1,
    intent: {
      activityType: "hiking",
      routeType: "loop",
      startLocationName: "Ilsenburg",
      endLocationName: null,
      targetDistanceKm: null,
      targetDurationMinutes: null,
      difficulty: null,
      requestedFeatures: ["viewpoint"],
      avoidFeatures: ["repeatedPath"]
    },
    candidates: [{
      stops: [
        { role: "highlight", kind: "viewpoint", name: "Lower View" },
        { role: "stop", kind: "landmark", name: "Forest Junction" },
        { role: "highlight", kind: "peak", name: "Upper Ridge" }
      ]
    }]
  };
}

function geocoderResults(name) {
  const points = {
    Ilsenburg: START,
    "Lower View": STOP_ONE,
    "Forest Junction": STOP_TWO,
    "Upper Ridge": STOP_THREE
  };
  return points[name] ? [geocoderCandidate(name, points[name], 0.95, 0)] : [];
}

function geocoderCandidate(displayName, point, confidence, providerRank) {
  return {
    displayName,
    coordinate: point,
    confidence,
    provider: "fixture",
    providerRank
  };
}

function routeRequestFor(intent, points) {
  return {
    profile: intent.activityType === "biking" ? "bike" : "foot",
    routeType: intent.routeType,
    points,
    algorithm: undefined,
    roundTrip: undefined,
    alternativeRoute: undefined,
    locale: "en",
    includeElevation: true,
    includeInstructions: true,
    includePathDetails: ["surface", "road_class", "hike_rating"],
    preferences: undefined
  };
}

function providerResponse(pathCoordinates, snappedCoordinates) {
  const distance = polylineDistance(pathCoordinates);
  return {
    provider: "graphhopper",
    paths: [{
      distance,
      time: Math.max(1, Math.round(distance / 1.2 * 1_000)),
      ascend: 120,
      descend: 120,
      points: geometry(pathCoordinates),
      instructions: [{
        text: "Continue on the mapped route",
        distance,
        time: Math.max(1, Math.round(distance / 1.2 * 1_000)),
        interval: [0, pathCoordinates.length - 1],
        sign: 0
      }],
      details: { surface: [], road_class: [], hike_rating: [] }
    }],
    snapped_waypoints: geometry(snappedCoordinates)
  };
}

function geometry(points) {
  return {
    type: "LineString",
    coordinates: points.map((point) => [point.longitude, point.latitude])
  };
}

function coordinate(latitude, longitude) {
  return { latitude, longitude };
}

function polylineDistance(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += haversine(points[index - 1], points[index]);
  }
  return total;
}

function haversine(start, finish) {
  const radians = Math.PI / 180;
  const latitudeDelta = (finish.latitude - start.latitude) * radians;
  const longitudeDelta = (finish.longitude - start.longitude) * radians;
  const a = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(start.latitude * radians) * Math.cos(finish.latitude * radians) *
    Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}
