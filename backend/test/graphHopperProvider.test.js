import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGraphHopperRequest,
  createGraphHopperProvider
} from "../src/routing/graphHopperProvider.js";
import { validateRouteRequest } from "../src/routing/routeValidation.js";
import {
  alternativeRouteRequest,
  graphHopperResponse,
  loopRequest,
  multiPointLoopRequest,
  pointToPointRequest,
  routePath
} from "./routeTestSupport.js";

const API_KEY = "provider-secret-for-tests";
const CONFIGURATION = {
  apiKey: API_KEY,
  baseUrl: "https://graphhopper.com/api/1",
  timeoutMs: 30_000
};

describe("GraphHopper provider", () => {
  it("converts named coordinates to longitude/latitude upstream", () => {
    const request = validateRouteRequest(pointToPointRequest());
    const upstream = buildGraphHopperRequest(request, CONFIGURATION);
    const body = JSON.parse(upstream.init.body);
    assert.deepEqual(body.points, [[10.678, 51.866], [10.653, 51.765]]);
    assert.equal(body.points_encoded, false);
    assert.equal(body.elevation, true);
    assert.equal(body.instructions, true);
  });

  it("constructs supported alternative-route settings and flexible routing", () => {
    const request = validateRouteRequest(alternativeRouteRequest());
    const body = JSON.parse(buildGraphHopperRequest(request, CONFIGURATION).init.body);
    assert.equal(body.algorithm, "alternative_route");
    assert.equal(body["alternative_route.max_paths"], 3);
    assert.equal(body["alternative_route.max_weight_factor"], 1.4);
    assert.equal(body["alternative_route.max_share_factor"], 0.65);
    assert.equal(body["ch.disable"], true);
  });

  it("constructs supported round-trip settings and flexible routing", () => {
    const request = validateRouteRequest(loopRequest());
    const body = JSON.parse(buildGraphHopperRequest(request, CONFIGURATION).init.body);
    assert.equal(body.algorithm, "round_trip");
    assert.equal(body["round_trip.distance"], 15_000);
    assert.equal(body["round_trip.seed"], 11);
    assert.equal(body["ch.disable"], true);
  });

  it("keeps standard multi-point loop fallbacks out of flexible mode", () => {
    const request = validateRouteRequest(multiPointLoopRequest());
    const body = JSON.parse(buildGraphHopperRequest(request, CONFIGURATION).init.body);
    assert.deepEqual(body.points, [
      [10.678, 51.866],
      [10.72, 51.89],
      [10.71, 51.84],
      [10.678, 51.866]
    ]);
    assert.equal("algorithm" in body, false);
    assert.equal("round_trip.distance" in body, false);
    assert.equal("ch.disable" in body, false);
    assert.equal("custom_model" in body, false);
  });

  it("constructs a server-owned custom model from typed preferences", () => {
    const request = validateRouteRequest(alternativeRouteRequest({
      preferences: {
        activityType: "trailRunning",
        avoid: ["majorRoads", "steepClimbs"],
        difficulty: "easy"
      }
    }));
    const body = JSON.parse(buildGraphHopperRequest(request, CONFIGURATION).init.body);
    assert.equal(body["ch.disable"], true);
    assert.ok(body.custom_model.priority.some((item) => item.if.includes("TRACK")));
    assert.ok(body.custom_model.priority.some((item) => item.if.includes("max_slope")));
    assert.equal(body.custom_model.distance_influence, 70);
    assert.equal(body["alternative_route.max_share_factor"], 0.65);
  });

  it("adds the API key only to the fixed upstream URL", async () => {
    const calls = [];
    const provider = createGraphHopperProvider({
      env: { GRAPHHOPPER_API_KEY: API_KEY },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return Response.json(graphHopperResponse());
      }
    });
    const result = await provider.route(validateRouteRequest(pointToPointRequest()));
    assert.equal(calls[0].url.origin, "https://graphhopper.com");
    assert.equal(calls[0].url.pathname, "/api/1/route");
    assert.equal(calls[0].url.searchParams.get("key"), API_KEY);
    assert.equal(calls[0].init.redirect, "manual");
    assert.equal(calls[0].init.body.includes(API_KEY), false);
    assert.equal(JSON.stringify(result).includes(API_KEY), false);
  });

  it("preserves successful geometry and route statistics unchanged", async () => {
    const path = routePath();
    const snapped = { type: "MultiPoint", coordinates: [[10.678, 51.866], [10.653, 51.765]] };
    const provider = providerReturning(graphHopperResponse([path], { snapped_waypoints: snapped }));
    const result = await provider.route(validateRouteRequest(pointToPointRequest()));
    assert.deepEqual(result.paths[0], path);
    assert.deepEqual(result.snapped_waypoints, snapped);
  });

  it("drops unexpected provider fields rather than reflecting secrets", async () => {
    const provider = providerReturning(graphHopperResponse([{ ...routePath(), debug: API_KEY }], { debug: API_KEY }));
    const result = await provider.route(validateRouteRequest(pointToPointRequest()));
    assert.equal(JSON.stringify(result).includes(API_KEY), false);
    assert.equal("debug" in result.paths[0], false);
  });

  it("returns a safe missing-configuration error", async () => {
    const provider = createGraphHopperProvider({ env: {}, fetchImpl: async () => assert.fail("fetch called") });
    await assert.rejects(
      provider.route(validateRouteRequest(pointToPointRequest())),
      (error) => error.code === "configuration_missing" && !error.message.includes(API_KEY)
    );
  });

  it("normalizes provider timeouts", async () => {
    const provider = createGraphHopperProvider({
      env: { GRAPHHOPPER_API_KEY: API_KEY, ROUTE_REQUEST_TIMEOUT_MS: "1000" },
      setTimeoutImpl(callback) {
        queueMicrotask(callback);
        return 1;
      },
      clearTimeoutImpl() {},
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(abortError()), { once: true });
      })
    });
    await assert.rejects(
      provider.route(validateRouteRequest(pointToPointRequest())),
      (error) => error.code === "route_timed_out" && error.statusCode === 504
    );
  });

  it("normalizes provider rate limits", async () => {
    const provider = providerReturning({ message: "quota details" }, 429);
    await assert.rejects(
      provider.route(validateRouteRequest(pointToPointRequest())),
      (error) => error.code === "routing_rate_limited" && !error.message.includes("quota")
    );
  });

  it("normalizes provider authentication failures as server configuration", async () => {
    for (const status of [401, 403]) {
      const provider = providerReturning({ message: "provider credential rejected" }, status);
      await assert.rejects(
        provider.route(validateRouteRequest(pointToPointRequest())),
        (error) => error.code === "configuration_missing" && error.statusCode === 503
      );
    }
  });

  it("preserves flexible-mode failures for routing fallback", async () => {
    const provider = providerReturning({ message: "Flexible mode unavailable" }, 400);
    await assert.rejects(
      provider.route(validateRouteRequest(pointToPointRequest())),
      (error) => error.code === "flexible_mode_unavailable" && error.statusCode === 422
    );
  });

  it("normalizes provider no-route responses", async () => {
    const provider = providerReturning({ message: "Connection not found between points" }, 400);
    await assert.rejects(
      provider.route(validateRouteRequest(pointToPointRequest())),
      (error) => error.code === "route_not_found" && error.statusCode === 422
    );
  });

  it("keeps supported-parameter rejections fallback-compatible", async () => {
    const provider = providerReturning({ message: "custom model rejected" }, 400);
    await assert.rejects(
      provider.route(validateRouteRequest(pointToPointRequest())),
      (error) => error.code === "invalid_request" && error.statusCode === 400
    );
  });

  it("normalizes malformed successful responses", async () => {
    for (const payload of [{ paths: "invalid" }, { paths: [{}] }]) {
      const provider = providerReturning(payload);
      await assert.rejects(
        provider.route(validateRouteRequest(pointToPointRequest())),
        (error) => error.code === "routing_unavailable"
      );
    }
  });

  it("rejects successful responses with out-of-range geometry", async () => {
    const provider = providerReturning(graphHopperResponse([
      routePath({
        points: { type: "LineString", coordinates: [[181, 51], [10, 51]] }
      })
    ]));
    await assert.rejects(
      provider.route(validateRouteRequest(pointToPointRequest())),
      (error) => error.code === "routing_unavailable"
    );
  });

  it("handles an already-aborted request without calling the provider", async () => {
    let fetchCalled = false;
    const provider = createGraphHopperProvider({
      env: { GRAPHHOPPER_API_KEY: API_KEY },
      fetchImpl: async () => {
        fetchCalled = true;
        return Response.json(graphHopperResponse());
      }
    });
    const client = new AbortController();
    client.abort();
    await assert.rejects(
      provider.route(validateRouteRequest(pointToPointRequest()), { signal: client.signal }),
      (error) => error.code === "request_cancelled"
    );
    assert.equal(fetchCalled, false);
  });

  it("normalizes provider server errors without leaking provider bodies or keys", async () => {
    const provider = providerReturning({ message: `internal ${API_KEY}` }, 500);
    await assert.rejects(
      provider.route(validateRouteRequest(pointToPointRequest())),
      (error) => error.code === "routing_unavailable" && !error.message.includes(API_KEY)
    );
  });

  it("aborts upstream fetch when the client disconnects", async () => {
    let upstreamAborted = false;
    const provider = createGraphHopperProvider({
      env: { GRAPHHOPPER_API_KEY: API_KEY },
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          upstreamAborted = true;
          reject(abortError());
        }, { once: true });
      })
    });
    const client = new AbortController();
    const pending = provider.route(validateRouteRequest(pointToPointRequest()), { signal: client.signal });
    client.abort();
    await assert.rejects(pending, (error) => error.code === "request_cancelled");
    assert.equal(upstreamAborted, true);
  });
});

function providerReturning(payload, status = 200) {
  return createGraphHopperProvider({
    env: { GRAPHHOPPER_API_KEY: API_KEY },
    fetchImpl: async () => Response.json(payload, { status })
  });
}

function abortError() {
  return Object.assign(new Error("aborted"), { name: "AbortError" });
}
