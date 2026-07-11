import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleIntentHttpRequest } from "../src/server.js";

describe("intent server", () => {
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
      { env: { NODE_ENV: "test", INTENT_ALLOW_INSECURE_LOCAL_PARSING: "true" } }
    );

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.routeType, "loop");
    assert.equal(result.payload.startLocationQuery, "Schierke");
    assert.equal("geometry" in result.payload, false);
    assert.equal("path" in result.payload, false);
    assert.equal("coordinates" in result.payload, false);
  });
});
