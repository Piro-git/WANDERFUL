import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { createIntentSessionEndpoint } from "../src/appAttest/intentSessionEndpoint.js";
import { InMemoryAppAttestRepository } from "../src/appAttest/appAttestRepository.js";
import {
  createIntentSessionAuthorizer,
  createRouteSessionAuthorizer
} from "../src/appAttest/routeSessionAuthorizer.js";
import { hashOpaqueValue } from "../src/appAttest/clientData.js";

describe("attested intent endpoint", () => {
  it("fails closed in production without durable authorization", async () => {
    let parseCalled = false;
    const endpoint = createIntentSessionEndpoint({
      env: { NODE_ENV: "production" },
      parseIntent: async () => {
        parseCalled = true;
        return {};
      }
    });
    const result = await endpoint({ prompt: "test" }, { headers: {} });
    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.error.code, "authorization_unavailable");
    assert.equal(parseCalled, false);
  });

  it("consumes weighted intent cost from the same opaque session used by routing", async () => {
    const repository = new InMemoryAppAttestRepository();
    const token = randomBytes(32).toString("base64url");
    await repository.createRouteSession({
      tokenHash: hashOpaqueValue(token),
      installationId: "installation-test",
      expiresAt: Date.now() + 120_000,
      maximumCost: 12
    });
    const env = { NODE_ENV: "test", INTENT_REQUEST_COST: "3" };
    const endpoint = createIntentSessionEndpoint({
      env,
      appAttestRepository: repository,
      intentAuthorizer: createIntentSessionAuthorizer({ repository, env }),
      parseIntent: async (body) => ({ promptLength: body.prompt.length })
    });
    const intentResult = await endpoint(
      { prompt: "15 km loop" },
      { headers: sessionHeaders(token, "00000000-0000-4000-8000-000000000001") }
    );
    assert.equal(intentResult.statusCode, 200);
    assert.deepEqual(intentResult.payload, { promptLength: 10 });

    const routeAuthorizer = createRouteSessionAuthorizer({ repository, env });
    const finalAccess = await routeAuthorizer.authorize({
      headers: sessionHeaders(token, "00000000-0000-4000-8000-000000000002"),
      cost: 9
    });
    await finalAccess.release();
    await assert.rejects(
      routeAuthorizer.authorize({
        headers: sessionHeaders(token, "00000000-0000-4000-8000-000000000003"),
        cost: 1
      }),
      (error) => error.code === "route_session_exhausted"
    );
  });

  it("allows unauthenticated parsing only with explicit local opt-in", async () => {
    const endpoint = createIntentSessionEndpoint({
      env: {
        NODE_ENV: "development",
        INTENT_ALLOW_INSECURE_LOCAL_PARSING: "true"
      },
      parseIntent: async () => ({ ok: true })
    });
    const result = await endpoint({}, { headers: {} });
    assert.deepEqual(result, { statusCode: 200, payload: { ok: true } });
  });
});

function sessionHeaders(token, requestId) {
  return {
    authorization: `TrailMindRouteSession ${token}`,
    "x-trailmind-request-id": requestId
  };
}
