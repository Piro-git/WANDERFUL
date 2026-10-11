import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LLMFirstPlanningError,
  createLLMFirstSafetyGatedEndpoint,
  llmFirstSafetyGatedPlanningEnabled,
  planLLMFirstSafetyGatedV1
} from "../src/llmPlanning/llmFirstSafetyGatedPlanner.js";

const corpus = JSON.parse(readFileSync(
  new URL("./fixtures/llmFirstSafetyGatedCorpusV1.json", import.meta.url)
));

const coordinates = Object.freeze({
  A: { latitude: 51, longitude: 10 },
  A2: { latitude: 51, longitude: 10 },
  B: { latitude: 51, longitude: 10.01 },
  B2: { latitude: 51, longitude: 10.01 },
  C: { latitude: 51.01, longitude: 10.01 },
  D: { latitude: 51.01, longitude: 10 },
  E: { latitude: 51.02, longitude: 10.02 }
});

test("offline LLM-first safety corpus is complete and deterministic", async (t) => {
  assert.equal(corpus.schemaVersion, 1);
  assert.equal(corpus.cases.length, 21);
  for (const fixture of corpus.cases) {
    await t.test(fixture.id, async () => {
      const { result, fallbackCalls = 0 } = await executeFixture(fixture.id);
      if (fixture.expected) assert.equal(result.state, fixture.expected);
      if (fixture.expectedRejection) {
        assert.ok(
          result.rejected.some((item) => item.code === fixture.expectedRejection),
          `${fixture.id}: ${JSON.stringify(result.rejected)}`
        );
      }
      assert.equal(result.evidence.supabase, "disabled");
      const diagnostics = JSON.stringify(result.rejected);
      assert.equal(diagnostics.includes("51."), false);
      assert.equal(diagnostics.includes("start"), false);
      if (fixture.id === "fallback-exhaustion") {
        assert.equal(fallbackCalls, 1);
        assert.deepEqual(result.fallback, { attempted: true, exhausted: true });
      }
    });
  }
});

test("three-stop loop uses foot GraphHopper request and remains idempotent", async () => {
  const requests = [];
  const dependencies = baseDependencies({
    router: {
      async route(request) {
        requests.push(request);
        return routeResponse(request.points);
      }
    }
  });
  const input = request();
  const first = await planLLMFirstSafetyGatedV1(input, dependencies);
  const second = await planLLMFirstSafetyGatedV1(input, dependencies);
  assert.equal(first.planId, second.planId);
  assert.equal(first.routes[0].candidateId, second.routes[0].candidateId);
  assert.equal(first.routes[0].geometryProvider, "graphhopper");
  assert.equal(requests[0].profile, "foot");
  assert.equal(requests[0].routeType, "loop");
  assert.deepEqual(requests[0].points, [
    coordinates.A, coordinates.B, coordinates.C, coordinates.D, coordinates.A
  ]);
});

test("biking point-to-point maps only to the bike profile", async () => {
  let routedRequest;
  const output = llmOutput({
    intent: { activity: "biking", routeType: "pointToPoint",
      targetDistanceKm: null, maximumDifficulty: null },
    candidates: [{ start: "A", stops: [], end: "D" }]
  });
  const result = await planLLMFirstSafetyGatedV1(request(), baseDependencies({
    llm: { async generate() { return output; } },
    router: { async route(value) {
      routedRequest = value;
      return routeResponse(value.points);
    } }
  }));
  assert.equal(result.state, "routed");
  assert.equal(routedRequest.profile, "bike");
  assert.equal(routedRequest.preferences.activityType, "biking");
});

test("fallback routes pass the same geometry and target gates", async () => {
  for (const invalid of [true, { legacy: true }, { provider: "graphhopper", paths: [] }]) {
    const result = await planLLMFirstSafetyGatedV1(request(), baseDependencies({
      router: { async route() { throw new Error("unavailable"); } },
      fallback: { async planOnce() { return invalid; } }
    }));
    assert.equal(result.state, "no_viable_route");
    assert.deepEqual(result.routes, []);
  }
  const recovered = await planLLMFirstSafetyGatedV1(request(), baseDependencies({
    router: { async route() { throw new Error("unavailable"); } },
    fallback: { async planOnce({ routeRequest }) { return routeResponse(routeRequest.points); } }
  }));
  assert.equal(recovered.state, "recovered");
  assert.equal(recovered.routes[0].geometryProvider, "graphhopper");
});

test("invalid model output cannot bypass validation through fallback", async () => {
  let calls = 0;
  const result = await planLLMFirstSafetyGatedV1(request(), baseDependencies({
    llm: { async generate() { return { invented: true }; } },
    fallback: { async planOnce() { calls += 1; return { legacy: true }; } }
  }));
  assert.equal(calls, 0);
  assert.equal(result.state, "no_viable_route");
  assert.deepEqual(result.routes, []);
});

test("caller cancellation propagates and never invokes fallback", async () => {
  const controller = new AbortController();
  let fallbackCalls = 0;
  const promise = planLLMFirstSafetyGatedV1(request(), baseDependencies({
    llm: { generate({ signal }) {
      return new Promise((_, reject) => signal.addEventListener("abort", reject, { once: true }));
    } },
    fallback: { async planOnce() { fallbackCalls += 1; return { legacy: true }; } }
  }), { signal: controller.signal, operationTimeoutMs: 100, totalTimeoutMs: 500 });
  controller.abort();
  await assert.rejects(promise, (error) =>
    error instanceof LLMFirstPlanningError && error.code === "cancelled"
  );
  assert.equal(fallbackCalls, 0);
});

test("endpoint is default-off and reuses route authorization when explicitly enabled", async () => {
  assert.equal(llmFirstSafetyGatedPlanningEnabled({}), false);
  let authorizationCalls = 0;
  const disabled = createLLMFirstSafetyGatedEndpoint({ env: {} });
  assert.equal((await disabled(request())).payload.error.code, "feature_unavailable");

  const endpoint = createLLMFirstSafetyGatedEndpoint({
    env: { LLM_FIRST_SAFETY_GATED_PLANNING_ENABLED: "true" },
    authorizer: { async authorize() {
      authorizationCalls += 1;
      return { authorized: true, rateLimitKey: "test-installation" };
    } },
    ...baseDependencies()
  });
  const response = await endpoint(request(), { requestId: "test-request" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.state, "routed");
  assert.equal(authorizationCalls, 1);
});

async function executeFixture(id) {
  let output = llmOutput();
  let fallbackCalls = 0;
  let geocodeOverride;
  let router = { async route(request) { return routeResponse(request.points); } };
  let fallback;

  if (id === "point-to-point") output = llmOutput({
    intent: { activity: "hiking", routeType: "pointToPoint",
      targetDistanceKm: null, maximumDifficulty: null },
    candidates: [{ start: "A", stops: [], end: "D" }]
  });
  if (id === "hallucinated-place") geocodeOverride = (name) =>
    name === "B" ? geocode(name, { confidence: 0.1 }) : geocode(name);
  if (id === "ambiguous-name") geocodeOverride = (name) =>
    name === "B" ? geocode(name, { alternativeCount: 2 }) : geocode(name);
  if (id === "unverified-access") geocodeOverride = (name) =>
    name === "B" ? geocode(name, { accessEvidence: "unknown" }) : geocode(name);
  if (id === "unverified-difficulty") {
    output = llmOutput({ intent: { activity: "hiking", routeType: "loop",
      targetDistanceKm: 4, maximumDifficulty: "moderate" } });
    geocodeOverride = (name) => geocode(name, { difficultyEvidence: "unknown" });
  }
  if (id === "unreachable-stop") router = { async route(request) {
    return routeResponse([request.points[0], request.points[2], request.points[3], request.points[4]], {
      snaps: request.points
    });
  } };
  if (id === "reordered-stops") router = { async route(request) {
    return routeResponse([
      request.points[0], request.points[2], request.points[1],
      request.points[3], request.points[4]
    ], { snaps: request.points });
  } };
  if (id === "excessive-detour") output = llmOutput({
    intent: { activity: "hiking", routeType: "loop",
      targetDistanceKm: 1, maximumDifficulty: null }
  });
  if (id === "bad-snapping") router = { async route(request) {
    const snaps = [...request.points];
    snaps[1] = { latitude: snaps[1].latitude + 0.01, longitude: snaps[1].longitude };
    return routeResponse(request.points, { snaps });
  } };
  if (id === "backtracking") router = { async route(request) {
    return routeResponse([
      request.points[0], request.points[1], request.points[0], request.points[1],
      request.points[2], request.points[3], request.points[4]
    ], { snaps: request.points });
  } };
  if (id === "malformed-statistics") router = { async route(request) {
    return routeResponse(request.points, { time: 0 });
  } };
  if (id === "inconsistent-statistics") router = { async route(request) {
    return routeResponse(request.points, { distanceMultiplier: 2 });
  } };
  if (id === "malformed-geometry") router = { async route(request) {
    const response = routeResponse(request.points);
    response.paths[0].points = { type: "LineString", coordinates: [[999, 999]] };
    return response;
  } };
  if (id === "wrong-activity-profile") output = llmOutput({
    intent: { activity: "skiing", routeType: "loop",
      targetDistanceKm: 4, maximumDifficulty: null }
  });
  if (id === "empty-llm-output") output = {};
  if (id === "provider-failure") router = { async route() { throw new Error("offline failure"); } };
  if (id === "provider-timeout") router = { route() { return new Promise(() => {}); } };
  if (id === "duplicate-candidate") {
    const candidate = { start: "A", stops: ["B", "C", "D"], end: null };
    output = llmOutput({ candidates: [candidate, candidate] });
  }
  if (id === "duplicate-route") output = llmOutput({ candidates: [
    { start: "A", stops: ["B", "C", "D"], end: null },
    { start: "A2", stops: ["B2", "C", "D"], end: null }
  ] });
  if (id === "fallback-exhaustion") {
    router = { async route() { throw new Error("unavailable"); } };
    fallback = { async planOnce() { fallbackCalls += 1; return null; } };
  }

  const result = await planLLMFirstSafetyGatedV1(request(), baseDependencies({
    llm: { async generate() { return output; } },
    geocoder: { async resolve(name) {
      return geocodeOverride ? geocodeOverride(name) : geocode(name);
    } },
    router,
    ...(fallback ? { fallback } : {})
  }), id === "provider-timeout"
    ? { operationTimeoutMs: 10, totalTimeoutMs: 100 }
    : {});
  return { result, fallbackCalls };
}

function request() {
  return { prompt: "Plan a bounded test route", idempotencyKey: "offline_case_001" };
}

function llmOutput(overrides = {}) {
  return {
    schemaVersion: 1,
    intent: { activity: "hiking", routeType: "loop",
      targetDistanceKm: 4, maximumDifficulty: null },
    candidates: [{ start: "A", stops: ["B", "C", "D"], end: null }],
    ...overrides
  };
}

function baseDependencies(overrides = {}) {
  return {
    llm: { async generate() { return llmOutput(); } },
    geocoder: { async resolve(name) { return geocode(name); } },
    router: { async route(value) { return routeResponse(value.points); } },
    ...overrides
  };
}

function geocode(name, overrides = {}) {
  return {
    coordinate: coordinates[name] ?? coordinates.E,
    confidence: 0.99,
    alternativeCount: 1,
    accessEvidence: "verified",
    difficultyEvidence: "verified",
    ...overrides
  };
}

function routeResponse(points, options = {}) {
  const distance = polylineDistance(points) * (options.distanceMultiplier ?? 1);
  return {
    provider: "graphhopper",
    paths: [{
      distance,
      time: options.time ?? Math.max(1, distance / 1.2 * 1_000),
      ascend: 100,
      descend: 100,
      points: line(points),
      snapped_waypoints: line(options.snaps ?? points),
      instructions: [],
      details: {}
    }]
  };
}

function line(points) {
  return {
    type: "LineString",
    coordinates: points.map((point) => [point.longitude, point.latitude])
  };
}

function polylineDistance(points) {
  return points.slice(1).reduce((total, point, index) =>
    total + haversine(points[index], point), 0
  );
}

function haversine(left, right) {
  const radians = Math.PI / 180;
  const dLat = (right.latitude - left.latitude) * radians;
  const dLon = (right.longitude - left.longitude) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(left.latitude * radians) *
    Math.cos(right.latitude * radians) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}
