import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { handleIntentHttpRequest } from "../src/server.js";

describe("dormant Supabase planning isolation", () => {
  it("keeps tracked outdoor evidence disabled", async () => {
    const configuration = await readFile(
      new URL("../../Configuration/Shared.xcconfig", import.meta.url),
      "utf8"
    );
    assert.match(configuration, /^OUTDOOR_EVIDENCE_ENABLED = false$/m);
  });

  it("routes the LLM intent and GraphHopper endpoints without touching dormant evidence", async () => {
    const calls = [];
    const forbidden = async () => {
      throw new Error("dormant Supabase dependency was invoked");
    };
    const options = {
      intentEndpoint: async () => {
        calls.push("intent");
        return { statusCode: 200, payload: { source: "llm" } };
      },
      routeEndpoint: async () => {
        calls.push("route");
        return {
          statusCode: 200,
          payload: { provider: "graphhopper", paths: [] }
        };
      },
      outdoorEvidenceEndpoint: forbidden,
      outdoorAdventurePlanningEndpoint: forbidden
    };

    const intent = await handleIntentHttpRequest({
      method: "POST", url: "/api/parse-intent", body: { prompt: "loop" },
      headers: {}
    }, options);
    const route = await handleIntentHttpRequest({
      method: "POST", url: "/api/route", body: {}, headers: {}
    }, options);

    assert.deepEqual(intent, {
      statusCode: 200, payload: { source: "llm" }
    });
    assert.deepEqual(route, {
      statusCode: 200,
      payload: { provider: "graphhopper", paths: [] }
    });
    assert.deepEqual(calls, ["intent", "route"]);
  });
});
