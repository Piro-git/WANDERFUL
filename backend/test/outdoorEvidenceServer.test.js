import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createIntentServer, handleIntentHttpRequest } from "../src/server.js";
import { outdoorEvidenceRequest } from "./outdoorEvidenceTestSupport.js";

const servers = new Set();
afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve) => server.close(resolve))));
  servers.clear();
});

describe("outdoor evidence HTTP route", () => {
  it("dispatches the corridor endpoint", async () => {
    const result = await handleIntentHttpRequest({
      method: "POST", url: "/api/outdoor-evidence/corridor", body: outdoorEvidenceRequest()
    }, {
      outdoorEvidenceEndpoint: async () => ({ statusCode: 200, payload: { schemaVersion: 2 } })
    });
    assert.equal(result.statusCode, 200);
  });

  it("enforces content type and the dedicated body ceiling", async () => {
    const server = createIntentServer({
      env: { NODE_ENV: "test", OUTDOOR_EVIDENCE_MAX_BODY_BYTES: "4096" },
      outdoorEvidenceEndpoint: async () => ({ statusCode: 200, payload: {} })
    });
    servers.add(server);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/api/outdoor-evidence/corridor`;
    const wrongType = await fetch(url, {
      method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}"
    });
    assert.equal(wrongType.status, 400);
    assert.equal((await wrongType.json()).error.code, "invalid_request");
    const oversized = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(5_000) })
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error.code, "request_too_large");
  });
});
