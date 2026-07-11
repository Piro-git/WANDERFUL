import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRouteEndpoint } from "../src/routing/routeEndpoint.js";
import { InMemoryRouteRateLimiter } from "../src/routing/routeRateLimiter.js";
import {
  graphHopperResponse,
  multiPointLoopRequest,
  pointToPointRequest,
  routePath
} from "./routeTestSupport.js";

describe("route endpoint", () => {
  it("returns a normalized successful response through a mocked provider", async () => {
    const expected = { provider: "graphhopper", ...graphHopperResponse() };
    const endpoint = createRouteEndpoint({
      env: developmentEnv(),
      provider: { async route() { return expected; } }
    });
    const result = await endpoint(pointToPointRequest());
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.payload, expected);
  });

  it("accepts the existing standard multi-point loop fallback contract", async () => {
    let receivedRequest;
    const endpoint = createRouteEndpoint({
      env: developmentEnv(),
      provider: {
        async route(request) {
          receivedRequest = request;
          return { provider: "graphhopper", ...graphHopperResponse() };
        }
      }
    });
    const result = await endpoint(multiPointLoopRequest());
    assert.equal(result.statusCode, 200);
    assert.equal(receivedRequest.routeType, "loop");
    assert.equal(receivedRequest.algorithm, undefined);
    assert.equal(receivedRequest.points.length, 4);
  });

  it("adds no key to client responses or normalized errors", async () => {
    const secret = "endpoint-secret";
    const successEndpoint = createRouteEndpoint({
      env: developmentEnv({ GRAPHHOPPER_API_KEY: secret }),
      fetchImpl: async () => Response.json(graphHopperResponse())
    });
    const success = await successEndpoint(pointToPointRequest());
    assert.equal(JSON.stringify(success).includes(secret), false);

    const failureEndpoint = createRouteEndpoint({
      env: developmentEnv({ GRAPHHOPPER_API_KEY: secret }),
      fetchImpl: async () => Response.json({ message: secret }, { status: 500 })
    });
    const failure = await failureEndpoint(pointToPointRequest());
    assert.equal(failure.statusCode, 503);
    assert.equal(JSON.stringify(failure).includes(secret), false);
  });

  it("does not log keys, exact coordinates, request bodies, or geometry", async () => {
    const logs = [];
    const secret = "log-secret";
    const endpoint = createRouteEndpoint({
      env: developmentEnv({ GRAPHHOPPER_API_KEY: secret }),
      fetchImpl: async () => Response.json(graphHopperResponse([routePath()])),
      logger: { info(entry) { logs.push(entry); } },
      now: (() => { let value = 100; return () => value++; })()
    });
    await endpoint(pointToPointRequest());
    const serialized = JSON.stringify(logs);
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes("51.866"), false);
    assert.equal(serialized.includes("10.678"), false);
    assert.equal(serialized.includes("coordinates"), false);
    assert.equal(logs[0].pointCount, 2);
    assert.equal(logs[0].profile, "foot");
  });

  it("enforces local weighted rate limiting", async () => {
    const endpoint = createRouteEndpoint({
      env: developmentEnv(),
      provider: { async route() { return { provider: "graphhopper", ...graphHopperResponse() }; } },
      rateLimiter: new InMemoryRouteRateLimiter({ maxCost: 1 })
    });
    assert.equal((await endpoint(pointToPointRequest())).statusCode, 200);
    const limited = await endpoint(pointToPointRequest());
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.payload.error.code, "routing_rate_limited");
  });

  it("requires an injected production authorizer", async () => {
    const endpoint = createRouteEndpoint({
      env: { NODE_ENV: "production" },
      provider: { async route() { assert.fail("provider called"); } }
    });
    const result = await endpoint(pointToPointRequest());
    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.error.code, "configuration_missing");
  });

  it("does not silently enable development authorization when NODE_ENV is absent", async () => {
    const endpoint = createRouteEndpoint({
      env: { GRAPHHOPPER_API_KEY: "unused" },
      provider: { async route() { assert.fail("provider called"); } }
    });
    const result = await endpoint(pointToPointRequest());
    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.error.code, "configuration_missing");
  });

  it("requires an explicit opt-in for unauthenticated local routing", async () => {
    const endpoint = createRouteEndpoint({
      env: { NODE_ENV: "development" },
      provider: { async route() { assert.fail("provider called"); } }
    });
    const result = await endpoint(pointToPointRequest());
    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.error.code, "configuration_missing");
  });

  it("requires an injected production rate limiter", async () => {
    const endpoint = createRouteEndpoint({
      env: { NODE_ENV: "production" },
      authorizer: {
        async authorize() {
          return { authorized: true, rateLimitKey: "attested-installation" };
        }
      },
      provider: { async route() { assert.fail("provider called"); } }
    });
    const result = await endpoint(pointToPointRequest());
    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.error.code, "configuration_missing");
  });

  it("uses an injected production authorizer without passing location data", async () => {
    let authorizationContext;
    const endpoint = createRouteEndpoint({
      env: { NODE_ENV: "production" },
      authorizer: {
        async authorize(context) {
          authorizationContext = context;
          return { authorized: true, rateLimitKey: "attested-installation" };
        }
      },
      rateLimiter: { consume() { return { allowed: true }; } },
      provider: { async route() { return { provider: "graphhopper", ...graphHopperResponse() }; } }
    });
    const result = await endpoint(pointToPointRequest(), { headers: { authorization: "attestation" } });
    assert.equal(result.statusCode, 200);
    assert.equal("body" in authorizationContext, false);
    assert.equal("points" in authorizationContext, false);
  });

  it("keeps concurrent request data isolated", async () => {
    const endpoint = createRouteEndpoint({
      env: developmentEnv(),
      provider: {
        async route(request) {
          await Promise.resolve();
          return { provider: "graphhopper", paths: [{ distance: request.points[0].latitude }] };
        }
      },
      rateLimiter: { consume() { return { allowed: true }; } }
    });
    const firstRequest = pointToPointRequest();
    const secondRequest = pointToPointRequest({
      points: [{ latitude: 48.1, longitude: 11.5 }, { latitude: 48.2, longitude: 11.6 }]
    });
    const [first, second] = await Promise.all([endpoint(firstRequest), endpoint(secondRequest)]);
    assert.equal(first.payload.paths[0].distance, 51.866);
    assert.equal(second.payload.paths[0].distance, 48.1);
  });
});

function developmentEnv(overrides = {}) {
  return {
    NODE_ENV: "development",
    ROUTE_ALLOW_INSECURE_LOCAL_ROUTING: "true",
    ...overrides
  };
}
