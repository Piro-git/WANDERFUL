import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vercelHandler, { handleIntentHttpRequest } from "../src/server.js";

describe("intent server", () => {
  it("exports a Vercel-compatible request handler", () => {
    assert.equal(typeof vercelHandler, "function");
  });

  it("serves POST /api/parse-intent", async () => {
    const result = await handleIntentHttpRequest(
      {
        method: "POST",
        url: "/api/parse-intent",
        body: {
          prompt:
            "Ich will eine entspannte 15 km Rundwanderung um Schierke mit wenig gleicher Strecke zurück",
          locale: "de"
        }
      },
      {
        env: {
          NODE_ENV: "test",
          INTENT_ALLOW_INSECURE_LOCAL_PARSING: "true",
          INTENT_ALLOW_DETERMINISTIC_MOCK: "true"
        }
      }
    );

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.routeType, "loop");
    assert.equal(result.payload.startLocationQuery, "Schierke");
    assert.equal("geometry" in result.payload, false);
    assert.equal("path" in result.payload, false);
    assert.equal("coordinates" in result.payload, false);
  });

  it("dispatches POST /api/llm-plan-route through the injected boundary", async () => {
    const calls = [];
    const result = await handleIntentHttpRequest(
      {
        method: "POST",
        url: "/api/llm-plan-route",
        body: { schemaVersion: 1 },
        headers: { authorization: "TrailMindRouteSession opaque" },
        requestId: "11111111-1111-4111-8111-111111111111"
      },
      {
        llmFirstPlanningEndpoint: async (body, context) => {
          calls.push({ body, context });
          return { statusCode: 200, payload: { state: "recovery" } };
        }
      }
    );

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.state, "recovery");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, { schemaVersion: 1 });
    assert.equal(calls[0].context.requestId, "11111111-1111-4111-8111-111111111111");
    assert.equal("prompt" in calls[0].context, false);
  });
});
