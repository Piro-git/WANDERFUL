import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGraphHopperProvider } from "../src/routing/graphHopperProvider.js";
import { validateRouteRequest } from "../src/routing/routeValidation.js";
import {
  graphHopperResponse,
  pointToPointRequest
} from "./routeTestSupport.js";

const API_KEY = "provider-runtime-secret-for-tests";
const SUCCESS_LIMIT = 65_536;
const ERROR_LIMIT = 1_024;
const request = validateRouteRequest(pointToPointRequest());

describe("GraphHopper provider runtime bounds", () => {
  it("accepts an actual streamed success body exactly at the byte ceiling", async () => {
    const body = successBodyWithBytes(SUCCESS_LIMIT);
    const provider = providerWith(async () => new Response(body, {
      headers: { "Content-Length": String(SUCCESS_LIMIT) }
    }));

    const result = await provider.route(request);
    assert.equal(result.provider, "graphhopper");
    assert.equal(result.paths.length, 1);
  });

  it("rejects one actual streamed byte over the success ceiling before decoding", async () => {
    const body = successBodyWithBytes(SUCCESS_LIMIT + 1);
    const provider = providerWith(async () => new Response(body, {
      headers: { "Content-Length": "1" }
    }));

    await assert.rejects(provider.route(request), safeUnavailable);
  });

  it("uses Content-Length only for early rejection and actual bytes as authoritative", async () => {
    const validBody = successBodyWithBytes(SUCCESS_LIMIT);
    const declaredTooLarge = providerWith(async () => new Response(validBody, {
      headers: { "Content-Length": String(SUCCESS_LIMIT + 1) }
    }));
    await assert.rejects(declaredTooLarge.route(request), safeUnavailable);

    for (const headers of [
      {},
      { "Content-Length": "invalid" },
      { "Content-Length": "4", "Transfer-Encoding": "chunked" }
    ]) {
      const provider = providerWith(async () => streamedResponse(
        [validBody.slice(0, 31_000), validBody.slice(31_000)],
        { headers }
      ));
      const result = await provider.route(request);
      assert.equal(result.paths.length, 1);
    }
  });

  it("keeps provider error bodies on the smaller independent ceiling", async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.alloc(800, 120));
        controller.enqueue(Buffer.alloc(800, 120));
      },
      cancel() { cancelled = true; }
    });
    const provider = providerWith(async () => new Response(stream, { status: 500 }));

    await assert.rejects(provider.route(request), safeUnavailable);
    await Promise.resolve();
    assert.equal(cancelled, true);
  });

  it("rejects malformed successful JSON without decoding a route", async () => {
    const provider = providerWith(async () => new Response("{malformed-provider-json"));
    await assert.rejects(provider.route(request), safeUnavailable);
  });

  it("settles timeout before a fetch implementation can return a late success", async () => {
    let resolveFetch;
    let bodyReads = 0;
    const provider = providerWith(
      async () => new Promise((resolve) => { resolveFetch = resolve; }),
      {
        setTimeoutImpl(callback) {
          queueMicrotask(callback);
          return 1;
        },
        clearTimeoutImpl() {}
      }
    );
    const pending = provider.route(request);
    await Promise.resolve();
    resolveFetch({
      status: 200,
      ok: true,
      headers: { get() { return null; } },
      get body() {
        bodyReads += 1;
        return streamedResponse([successBodyWithBytes(SUCCESS_LIMIT)]).body;
      }
    });

    await assert.rejects(pending, (error) => error.code === "route_timed_out");
    assert.equal(bodyReads, 0);
  });

  it("cancels a response stream when the caller disconnects", async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      cancel() { cancelled = true; }
    });
    const provider = providerWith(async () => new Response(stream));
    const client = new AbortController();
    const pending = provider.route(request, { signal: client.signal });
    await Promise.resolve();
    client.abort();

    await assert.rejects(pending, (error) => error.code === "request_cancelled");
    await Promise.resolve();
    assert.equal(cancelled, true);
  });

  it("keeps caller cancellation neutral when timeout and disconnect race", async () => {
    const provider = providerWith(
      async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(abortError()), { once: true });
      }),
      {
        setTimeoutImpl(callback) {
          queueMicrotask(callback);
          return 1;
        },
        clearTimeoutImpl() {}
      }
    );
    const client = new AbortController();
    const pending = provider.route(request, { signal: client.signal });
    client.abort();

    await assert.rejects(pending, (error) => error.code === "request_cancelled");
  });
});

describe("GraphHopper ordinary-runtime circuit", () => {
  it("opens exactly at the failure threshold and performs zero fetch work while open", async () => {
    let calls = 0;
    const events = [];
    const provider = circuitProvider(async () => {
      calls += 1;
      return Response.json({ message: "private-provider-error" }, { status: 500 });
    }, { events });

    await assert.rejects(provider.route(request), safeUnavailable);
    assert.equal(calls, 1);
    await assert.rejects(provider.route(request), safeUnavailable);
    assert.equal(calls, 2);
    await assert.rejects(provider.route(request), safeUnavailable);
    assert.equal(calls, 2);
    assert.deepEqual(events, [
      {
        event: "provider_circuit_state_changed",
        state: "open",
        reason: "failure_threshold"
      }
    ]);
  });

  it("allows one half-open probe, rejects concurrent probes, and closes on success", async () => {
    let now = 0;
    let calls = 0;
    let resolveProbe;
    const events = [];
    const provider = circuitProvider(async () => {
      calls += 1;
      if (calls <= 2) return Response.json({}, { status: 500 });
      if (calls === 3) {
        return new Promise((resolve) => { resolveProbe = resolve; });
      }
      return Response.json(graphHopperResponse());
    }, { events, now: () => now });

    await assert.rejects(provider.route(request), safeUnavailable);
    await assert.rejects(provider.route(request), safeUnavailable);
    now = 1_000;
    const probe = provider.route(request);
    await Promise.resolve();
    const concurrent = provider.route(request);
    await assert.rejects(concurrent, safeUnavailable);
    assert.equal(calls, 3);
    resolveProbe(Response.json(graphHopperResponse()));
    assert.equal((await probe).paths.length, 1);
    assert.equal((await provider.route(request)).paths.length, 1);
    assert.equal(calls, 4);
    assert.deepEqual(events.map(({ state, reason }) => [state, reason]), [
      ["open", "failure_threshold"],
      ["half_open", "cooldown_elapsed"],
      ["closed", "probe_succeeded"]
    ]);
  });

  it("reopens after a failed half-open probe and requires a new cooldown", async () => {
    let now = 0;
    let calls = 0;
    const provider = circuitProvider(async () => {
      calls += 1;
      if (calls <= 3) return Response.json({}, { status: 500 });
      return Response.json(graphHopperResponse());
    }, { now: () => now });

    await assert.rejects(provider.route(request), safeUnavailable);
    await assert.rejects(provider.route(request), safeUnavailable);
    now = 1_000;
    await assert.rejects(provider.route(request), safeUnavailable);
    await assert.rejects(provider.route(request), safeUnavailable);
    assert.equal(calls, 3);
    now = 2_000;
    assert.equal((await provider.route(request)).paths.length, 1);
    assert.equal(calls, 4);
  });

  it("reopens without incrementing health failures when a half-open caller cancels", async () => {
    let now = 0;
    let calls = 0;
    const events = [];
    const provider = circuitProvider(async (_url, init) => {
      calls += 1;
      if (calls <= 2) return Response.json({}, { status: 500 });
      if (calls === 3) {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(abortError()), { once: true });
        });
      }
      return Response.json(graphHopperResponse());
    }, { events, now: () => now });

    await assert.rejects(provider.route(request), safeUnavailable);
    await assert.rejects(provider.route(request), safeUnavailable);
    now = 1_000;
    const client = new AbortController();
    const probe = provider.route(request, { signal: client.signal });
    client.abort();
    await assert.rejects(probe, (error) => error.code === "request_cancelled");
    await assert.rejects(provider.route(request), safeUnavailable);
    assert.equal(calls, 3);
    assert.deepEqual(events.at(-1), {
      event: "provider_circuit_state_changed",
      state: "open",
      reason: "probe_abandoned"
    });
    now = 2_000;
    assert.equal((await provider.route(request)).paths.length, 1);
  });

  it("counts malformed settled provider successes toward the circuit threshold", async () => {
    let calls = 0;
    const provider = circuitProvider(async () => {
      calls += 1;
      return new Response("{malformed");
    });

    await assert.rejects(provider.route(request), safeUnavailable);
    await assert.rejects(provider.route(request), safeUnavailable);
    await assert.rejects(provider.route(request), safeUnavailable);
    assert.equal(calls, 2);
  });

  it("keeps caller cancellation, rate limiting, and configuration rejection neutral", async () => {
    let calls = 0;
    const env = circuitEnv();
    delete env.GRAPHHOPPER_API_KEY;
    const provider = createGraphHopperProvider({
      env,
      fetchImpl: async (_url, init) => {
        calls += 1;
        if (calls === 1) throw new Error("network unavailable");
        if (calls === 2) {
          return new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(abortError()), { once: true });
          });
        }
        if (calls === 3) return Response.json({}, { status: 429 });
        return Response.json(graphHopperResponse());
      }
    });

    await assert.rejects(provider.route(request), (error) => error.code === "configuration_missing");
    assert.equal(calls, 0);
    env.GRAPHHOPPER_API_KEY = API_KEY;
    await assert.rejects(provider.route(request), safeUnavailable);
    const client = new AbortController();
    const cancelled = provider.route(request, { signal: client.signal });
    client.abort();
    await assert.rejects(cancelled, (error) => error.code === "request_cancelled");
    await assert.rejects(provider.route(request), (error) => error.code === "routing_rate_limited");
    assert.equal((await provider.route(request)).paths.length, 1);
    assert.equal(calls, 4);
  });

  it("emits only coarse allowlisted circuit transitions", async () => {
    const events = [];
    const readiness = [];
    const provider = circuitProvider(
      async () => Response.json({
        message: API_KEY,
        coordinates: [10.678, 51.866],
        providerUrl: `https://${API_KEY}.invalid`
      }, { status: 500 }),
      {
        events,
        operationalState: { setProviderReady(value) { readiness.push(value); } }
      }
    );
    await assert.rejects(provider.route(request), safeUnavailable);
    await assert.rejects(provider.route(request), safeUnavailable);

    const serialized = JSON.stringify(events);
    assert.equal(serialized.includes(API_KEY), false);
    assert.equal(serialized.includes("coordinates"), false);
    assert.equal(serialized.includes("providerUrl"), false);
    assert.deepEqual(readiness, [false]);
  });

  it("marks configuration/authentication unavailable without opening the circuit", async () => {
    const env = circuitEnv();
    delete env.GRAPHHOPPER_API_KEY;
    let calls = 0;
    const readiness = [];
    const events = [];
    const provider = createGraphHopperProvider({
      env,
      operationalState: { setProviderReady(value) { readiness.push(value); } },
      logger: { info(event) { events.push(event); } },
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return Response.json({}, { status: 401 });
        return Response.json(graphHopperResponse());
      }
    });

    await assert.rejects(provider.route(request), (error) => error.code === "configuration_missing");
    env.GRAPHHOPPER_API_KEY = API_KEY;
    await assert.rejects(provider.route(request), (error) => error.code === "configuration_missing");
    assert.equal((await provider.route(request)).paths.length, 1);
    assert.equal(calls, 2);
    assert.deepEqual(readiness, [false, false, true]);
    assert.equal(events.length, 0);
  });
});

function providerWith(fetchImpl, overrides = {}) {
  return createGraphHopperProvider({
    env: {
      GRAPHHOPPER_API_KEY: API_KEY,
      ROUTE_PROVIDER_MAX_RESPONSE_BYTES: String(SUCCESS_LIMIT),
      ROUTE_PROVIDER_MAX_ERROR_RESPONSE_BYTES: String(ERROR_LIMIT)
    },
    fetchImpl,
    ...overrides
  });
}

function circuitProvider(fetchImpl, options = {}) {
  return createGraphHopperProvider({
    env: circuitEnv(),
    fetchImpl,
    now: options.now,
    logger: { info(event) { options.events?.push(event); } },
    operationalState: options.operationalState
  });
}

function circuitEnv() {
  return {
    GRAPHHOPPER_API_KEY: API_KEY,
    ROUTE_PROVIDER_MAX_RESPONSE_BYTES: String(SUCCESS_LIMIT),
    ROUTE_PROVIDER_MAX_ERROR_RESPONSE_BYTES: String(ERROR_LIMIT),
    ROUTE_PROVIDER_CIRCUIT_FAILURE_THRESHOLD: "2",
    ROUTE_PROVIDER_CIRCUIT_OPEN_MS: "1000"
  };
}

function successBodyWithBytes(targetBytes) {
  const payload = { ...graphHopperResponse(), padding: "" };
  const base = JSON.stringify(payload);
  const paddingBytes = targetBytes - Buffer.byteLength(base, "utf8");
  assert.ok(paddingBytes >= 0);
  payload.padding = "x".repeat(paddingBytes);
  const body = JSON.stringify(payload);
  assert.equal(Buffer.byteLength(body, "utf8"), targetBytes);
  return body;
}

function streamedResponse(chunks, options = {}) {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Buffer.from(chunk));
      controller.close();
    }
  });
  return new Response(stream, options);
}

function safeUnavailable(error) {
  return error.code === "routing_unavailable" &&
    error.statusCode === 503 &&
    !error.message.includes(API_KEY);
}

function abortError() {
  return Object.assign(new Error("aborted"), { name: "AbortError" });
}
