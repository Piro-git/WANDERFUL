import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createIntentServer, handleIntentHttpRequest } from "../src/server.js";
import { graphHopperResponse, pointToPointRequest } from "./routeTestSupport.js";

const servers = new Set();

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve) => server.close(resolve))));
  servers.clear();
});

describe("route HTTP server", () => {
  it("preserves /health without revealing GraphHopper configuration", async () => {
    const result = await handleIntentHttpRequest({ method: "GET", url: "/health" }, { env: {} });
    assert.deepEqual(result, { statusCode: 200, payload: { ok: true } });
    assert.equal("configuration" in result.payload, false);
  });

  it("preserves /api/parse-intent behavior", async () => {
    const result = await handleIntentHttpRequest({
      method: "POST",
      url: "/api/parse-intent",
      body: { prompt: "15 km Rundwanderung um Ilsenburg", locale: "de" }
    }, {
      env: {
        NODE_ENV: "test",
        INTENT_ALLOW_INSECURE_LOCAL_PARSING: "true",
        INTENT_ALLOW_DETERMINISTIC_MOCK: "true"
      }
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.routeType, "loop");
    assert.equal("geometry" in result.payload, false);
  });

  it("keeps unknown routes at 404", async () => {
    const result = await handleIntentHttpRequest({ method: "POST", url: "/api/unknown", body: {} });
    assert.deepEqual(result, { statusCode: 404, payload: { error: "Not found" } });
  });

  it("returns a safe route configuration error when the key is absent", async () => {
    const server = await startServer({ env: developmentEnv() });
    const response = await fetch(`${server.url}/api/route`, jsonRequest(pointToPointRequest()));
    const payload = await response.json();
    assert.equal(response.status, 503);
    assert.deepEqual(payload, {
      error: {
        code: "configuration_missing",
        message: "Routing is not configured on this server."
      }
    });
  });

  it("enforces the route body-size limit", async () => {
    const server = await startServer({
      env: developmentEnv({ ROUTE_MAX_BODY_BYTES: "1024" })
    });
    const response = await fetch(`${server.url}/api/route`, jsonRequest({ padding: "x".repeat(2_000) }));
    const payload = await response.json();
    assert.equal(response.status, 413);
    assert.equal(payload.error.code, "request_too_large");
  });

  it("requires JSON content type for route requests", async () => {
    const server = await startServer({ env: developmentEnv() });
    const response = await fetch(`${server.url}/api/route`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(pointToPointRequest())
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "invalid_request");
  });

  it("rejects content types that only begin with application/json", async () => {
    const server = await startServer({ env: developmentEnv() });
    const response = await fetch(`${server.url}/api/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json-malicious" },
      body: JSON.stringify(pointToPointRequest())
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "invalid_request");
  });

  it("serves a successful route through a mocked provider", async () => {
    let receivedRequest;
    const server = await startServer({
      env: developmentEnv(),
      provider: {
        async route(request) {
          receivedRequest = request;
          return { provider: "graphhopper", ...graphHopperResponse() };
        }
      }
    });
    const response = await fetch(`${server.url}/api/route`, jsonRequest(pointToPointRequest()));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(payload.provider, "graphhopper");
    assert.equal(receivedRequest.points[0].latitude, 51.866);
  });

  it("aborts mocked upstream work when the HTTP client disconnects", async () => {
    let providerStartedResolve;
    let providerAbortedResolve;
    const providerStarted = new Promise((resolve) => { providerStartedResolve = resolve; });
    const providerAborted = new Promise((resolve) => { providerAbortedResolve = resolve; });
    const server = await startServer({
      env: developmentEnv(),
      provider: {
        async route(_request, context) {
          providerStartedResolve();
          return new Promise((_resolve, reject) => {
            context.signal.addEventListener("abort", () => {
              providerAbortedResolve();
              reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
            }, { once: true });
          });
        }
      }
    });
    const client = new AbortController();
    const pending = fetch(`${server.url}/api/route`, {
      ...jsonRequest(pointToPointRequest()),
      signal: client.signal
    });
    await providerStarted;
    client.abort();
    await assert.rejects(pending);
    await providerAborted;
  });
});

async function startServer(options) {
  const server = createIntentServer(options);
  servers.add(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}` };
}

function jsonRequest(body) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

function developmentEnv(overrides = {}) {
  return {
    NODE_ENV: "development",
    ROUTE_PROVIDER_ENABLED: "true",
    ROUTE_ALLOW_INSECURE_LOCAL_ROUTING: "true",
    INTENT_ALLOW_INSECURE_LOCAL_PARSING: "true",
    ...overrides
  };
}
