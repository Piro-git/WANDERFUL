import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { InMemoryAppAttestRepository } from "../src/appAttest/appAttestRepository.js";
import { hashOpaqueValue } from "../src/appAttest/clientData.js";
import {
  createRouteSessionAuthorizer,
  routeAuthorizationConfiguration
} from "../src/appAttest/routeSessionAuthorizer.js";
import { createRouteEndpoint } from "../src/routing/routeEndpoint.js";
import { graphHopperResponse, loopRequest } from "./routeTestSupport.js";

describe("route-session integration", () => {
  it("rejects a route timeout that can outlive its provider lease", () => {
    assert.throws(
      () => routeAuthorizationConfiguration({
        ROUTE_REQUEST_TIMEOUT_MS: "60000",
        ROUTE_GLOBAL_LEASE_TTL_SECONDS: "10"
      }),
      (error) => error.code === "authorization_unavailable"
    );
    assert.doesNotThrow(() => routeAuthorizationConfiguration({
      ROUTE_REQUEST_TIMEOUT_MS: "9000",
      ROUTE_GLOBAL_LEASE_TTL_SECONDS: "10"
    }));
  });

  it("allows several loop variants concurrently through one assertion session", async () => {
    const repository = new InMemoryAppAttestRepository();
    const token = Buffer.alloc(32, 6).toString("base64url");
    await repository.createRouteSession({
      tokenHash: hashOpaqueValue(token),
      installationId: "attested-installation",
      expiresAt: Date.now() + 120_000,
      maximumCost: 12
    });
    const authorizer = createRouteSessionAuthorizer({
      repository,
      env: { NODE_ENV: "test", ROUTE_PROVIDER_ENABLED: "true" }
    });
    let active = 0;
    let maximumActive = 0;
    const endpoint = createRouteEndpoint({
      env: { NODE_ENV: "production" },
      authorizer,
      provider: {
        async route(request) {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolve) => setImmediate(resolve));
          active -= 1;
          return { provider: "graphhopper", ...graphHopperResponse([], { seed: request.roundTrip.seed }) };
        }
      }
    });

    const results = await Promise.all([11, 29, 47].map((seed) => endpoint(
      loopRequest({ roundTrip: { distanceMeters: 15_000, seed } }),
      {
        headers: {
          authorization: `TrailMindRouteSession ${token}`,
          "x-trailmind-request-id": randomUUID()
        }
      }
    )));
    assert.deepEqual(results.map((result) => result.statusCode), [200, 200, 200]);
    assert.ok(maximumActive > 1);
    assert.equal(repository.sessions.get(hashOpaqueValue(token)).remainingCost, 6);
    assert.equal(repository.globalActiveByScope.get("route"), 0);
  });

  it("never calls GraphHopper when the request ID is replayed", async () => {
    const repository = new InMemoryAppAttestRepository();
    const token = Buffer.alloc(32, 7).toString("base64url");
    await repository.createRouteSession({
      tokenHash: hashOpaqueValue(token),
      installationId: "attested-installation",
      expiresAt: Date.now() + 120_000,
      maximumCost: 12
    });
    const authorizer = createRouteSessionAuthorizer({
      repository,
      env: { NODE_ENV: "test", ROUTE_PROVIDER_ENABLED: "true" }
    });
    let providerCalls = 0;
    const endpoint = createRouteEndpoint({
      env: { NODE_ENV: "production" },
      authorizer,
      provider: {
        async route() {
          providerCalls += 1;
          return { provider: "graphhopper", ...graphHopperResponse() };
        }
      }
    });
    const requestId = randomUUID();
    const context = {
      headers: {
        authorization: `TrailMindRouteSession ${token}`,
        "x-trailmind-request-id": requestId
      }
    };
    assert.equal((await endpoint(loopRequest(), context)).statusCode, 200);
    const replay = await endpoint(loopRequest(), context);
    assert.equal(replay.statusCode, 409);
    assert.equal(replay.payload.error.code, "request_replayed");
    assert.equal(providerCalls, 1);
  });
});
