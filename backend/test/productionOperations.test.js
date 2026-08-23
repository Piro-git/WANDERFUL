import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createIntentServer } from "../src/server.js";
import { operationalEvent, createOperationalLogger } from "../src/operations/operationalEvents.js";
import {
  assertProductionConfiguration,
  evaluateProductionConfiguration,
  httpServerConfiguration,
  ProductionConfigurationError
} from "../src/operations/productionConfiguration.js";
import { runProductionPreflight } from "../src/operations/preflight.js";
import {
  configureHttpServer,
  createOperationalState,
  drainAndShutdown,
  installSignalHandlers,
  probeRequiredPools,
  startStandaloneIntentService
} from "../src/operations/serviceLifecycle.js";

const servers = new Set();

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(resolve);
  })));
  servers.clear();
});

describe("production operations", () => {
  it("emits a bounded presence-only production preflight report", () => {
    const env = productionEnv();
    const report = assertProductionConfiguration(env);
    const serialized = JSON.stringify(report);
    assert.equal(report.decision, "ready");
    assert.equal(report.checks.every((check) => check.status === "pass"), true);
    assert.equal(serialized.includes(env.APP_ATTEST_DATABASE_URL), false);
    assert.equal(serialized.includes(env.APP_ATTEST_APP_ID_PREFIX), false);
    assert.equal(serialized.includes("secret-sentinel"), false);
  });

  it("blocks missing durable configuration, malformed flags and unsafe production modes", () => {
    const cases = [
      { APP_ATTEST_DATABASE_URL: "" },
      { ROUTE_PROVIDER_ENABLED: "yes" },
      { ROUTE_PROVIDER_ENABLED: "enabled" },
      { APP_ATTEST_ALLOW_IN_MEMORY: "true" },
      { ROUTE_MAX_BODY_BYTES: "unbounded" },
      { NODE_ENV: "development" }
    ];
    for (const overrides of cases) {
      const report = evaluateProductionConfiguration(productionEnv(overrides));
      assert.equal(report.decision, "blocked", JSON.stringify(overrides));
      assert.throws(
        () => assertProductionConfiguration(productionEnv(overrides)),
        ProductionConfigurationError
      );
    }
  });

  it("requires coherent provider and research dependencies without printing them", () => {
    const enabled = productionEnv({
      ROUTE_PROVIDER_ENABLED: "true",
      OUTDOOR_RESEARCH_PLANNING_ENABLED: "true",
      GRAPHHOPPER_API_KEY: "graphhopper-secret-sentinel",
      OUTDOOR_RESEARCH_DATABASE_URL:
        "postgresql://research_user:research-secret@example.invalid/trailmind",
      OUTDOOR_RESEARCH_CANCELLATION_DATABASE_URL:
        "postgresql://cancel_user:cancel-secret@example.invalid/trailmind"
    });
    const report = evaluateProductionConfiguration(enabled);
    assert.equal(report.decision, "ready");
    assert.equal(
      report.capabilities.find((item) => item.id === "outdoor_research").state,
      "enabled"
    );
    const output = JSON.stringify(report);
    assert.equal(output.includes("graphhopper-secret-sentinel"), false);
    assert.equal(output.includes("research-secret"), false);

    const aliased = evaluateProductionConfiguration({
      ...enabled,
      OUTDOOR_RESEARCH_CANCELLATION_DATABASE_URL:
        enabled.OUTDOOR_RESEARCH_DATABASE_URL
    });
    assert.equal(aliased.decision, "blocked");
  });

  it("keeps the remote intent and evidence providers outside the closed-beta surface", () => {
    const report = evaluateProductionConfiguration(productionEnv({
      INTENT_PROVIDER_ENABLED: "true",
      AI_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "intent-secret-sentinel"
    }));
    assert.equal(report.decision, "blocked");
    assert.equal(JSON.stringify(report).includes("intent-secret-sentinel"), false);
  });

  it("returns nonzero from the deterministic preflight CLI contract", () => {
    let output = "";
    const exitCode = runProductionPreflight({
      env: productionEnv({ APP_ATTEST_DATABASE_URL: "" }),
      write(value) { output += value; }
    });
    assert.equal(exitCode, 1);
    assert.deepEqual(JSON.parse(output), evaluateProductionConfiguration(
      productionEnv({ APP_ATTEST_DATABASE_URL: "" })
    ));
  });

  it("sanitizes operational events before writing structured JSON", () => {
    const sentinel = "sensitive-sentinel";
    let output = "";
    const logger = createOperationalLogger({
      now: () => Date.parse("2026-08-23T10:00:00.000Z"),
      write(value) { output += value; }
    });
    assert.equal(logger.info({
      event: "route_request_completed",
      requestId: sentinel,
      prompt: sentinel,
      coordinates: [1, 2],
      providerUrl: `https://${sentinel}.invalid`,
      routeType: "loop",
      profile: "foot",
      pointCount: 3,
      statusCode: 200,
      providerLatencyMs: 640
    }), true);
    assert.equal(output.includes(sentinel), false);
    const event = JSON.parse(output);
    assert.equal(event.eventName, "route_request_completed");
    assert.equal(event.pointCount, "2_to_3");
    assert.equal(event.providerLatencyMs, "250ms_to_1s");
    assert.equal("requestId" in event, false);
    assert.equal(operationalEvent({ event: "unknown", prompt: sentinel }), undefined);
  });

  it("serves zero-detail liveness and fail-closed cached readiness", async () => {
    let endpointCalls = 0;
    const state = createOperationalState();
    const server = await startServer({
      operationalState: state,
      appAttestRuntime: inertAppAttestRuntime(),
      routeEndpoint: async () => { endpointCalls += 1; },
      intentEndpoint: async () => { endpointCalls += 1; },
      outdoorEvidenceEndpoint: async () => { endpointCalls += 1; },
      outdoorAdventurePlanningEndpoint: async () => { endpointCalls += 1; }
    });

    const live = await fetch(`${server.url}/health/live`);
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: "live" });
    const notReady = await fetch(`${server.url}/health/ready`);
    assert.equal(notReady.status, 503);
    assert.deepEqual(await notReady.json(), { status: "not_ready" });

    state.setDependencyReady(true);
    state.markStarted();
    const ready = await fetch(`${server.url}/health/ready`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { status: "ready" });
    assert.equal(endpointCalls, 0);
  });

  it("rejects late work before parsing or endpoint authorization once draining", async () => {
    let endpointCalls = 0;
    const state = createOperationalState();
    state.setDependencyReady(true);
    state.markStarted();
    state.beginDrain();
    const server = await startServer({
      operationalState: state,
      appAttestRuntime: inertAppAttestRuntime(),
      routeEndpoint: async () => { endpointCalls += 1; }
    });
    const response = await fetch(`${server.url}/api/route`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "sensitive-sentinel"
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "service_unavailable");
    assert.equal(endpointCalls, 0);
  });

  it("configures bounded Node HTTP timeouts and probes only required pools", async () => {
    const server = { };
    configureHttpServer(server, httpServerConfiguration(productionEnv()));
    assert.equal(server.headersTimeout, 10_000);
    assert.equal(server.requestTimeout, 45_000);
    assert.equal(server.maxHeadersCount, 64);
    let queries = 0;
    await probeRequiredPools([
      { async query(text) { queries += 1; assert.equal(text, "SELECT 1"); } },
      { async query(text) { queries += 1; assert.equal(text, "SELECT 1"); } }
    ], 1_000);
    assert.equal(queries, 2);
  });

  it("drains gracefully, closes pools and aborts in-flight work at the deadline", async () => {
    const gracefulState = createOperationalState();
    gracefulState.setDependencyReady(true);
    gracefulState.markStarted();
    let poolClosed = false;
    const gracefulServer = fakeClosingServer({ complete: true });
    const graceful = await drainAndShutdown({
      server: gracefulServer,
      pools: [{ async end() { poolClosed = true; } }],
      operationalState: gracefulState,
      monitor: { stop() {} },
      logger: { info() {} },
      reason: "test",
      deadlineMs: 1_000,
      options: {}
    });
    assert.equal(graceful.outcome, "graceful");
    assert.equal(poolClosed, true);
    assert.equal(gracefulState.isAccepting(), false);

    const deadlineState = createOperationalState();
    deadlineState.setDependencyReady(true);
    deadlineState.markStarted();
    const controller = new AbortController();
    assert.equal(deadlineState.register(controller), true);
    const deadlineServer = fakeClosingServer({ complete: false });
    const immediateTimers = {
      setTimeoutImpl(callback) {
        queueMicrotask(callback);
        return { unref() {} };
      },
      clearTimeoutImpl() {}
    };
    const deadline = await drainAndShutdown({
      server: deadlineServer,
      pools: [{ async end() {} }],
      operationalState: deadlineState,
      monitor: { stop() {} },
      logger: { info() { throw new Error("logging unavailable"); } },
      reason: "test",
      deadlineMs: 1,
      options: immediateTimers
    });
    assert.equal(deadline.outcome, "deadline_exceeded");
    assert.equal(controller.signal.aborted, true);
    assert.equal(deadlineServer.closeAllConnectionsCalled, true);
  });

  it("uses one total shutdown budget and cleans up partial pool construction", async () => {
    const delays = [];
    const deadlineState = createOperationalState();
    deadlineState.setDependencyReady(true);
    deadlineState.markStarted();
    const times = [0, 0, 1_000];
    const server = fakeClosingServer({ complete: false });
    await drainAndShutdown({
      server,
      pools: [{ async end() {} }],
      operationalState: deadlineState,
      monitor: { stop() {} },
      logger: { info() {} },
      reason: "test",
      deadlineMs: 1_000,
      options: {
        now: () => times.shift() ?? 1_000,
        setTimeoutImpl(callback, delay) {
          delays.push(delay);
          queueMicrotask(callback);
          return { unref() {} };
        },
        clearTimeoutImpl() {}
      }
    });
    assert.deepEqual(delays, [1_000, 0]);

    let constructed = 0;
    let closed = 0;
    class PartiallyFailingPool {
      constructor() {
        constructed += 1;
        if (constructed === 3) throw new Error("pool construction failed");
      }
      connect() {}
      query() {}
      async end() { closed += 1; }
    }
    await assert.rejects(
      startStandaloneIntentService({
        env: productionEnv({
          ROUTE_PROVIDER_ENABLED: "true",
          OUTDOOR_RESEARCH_PLANNING_ENABLED: "true",
          GRAPHHOPPER_API_KEY: "provider-secret-sentinel",
          OUTDOOR_RESEARCH_DATABASE_URL:
            "postgresql://research_user:secret@example.invalid/trailmind",
          OUTDOOR_RESEARCH_CANCELLATION_DATABASE_URL:
            "postgresql://cancel_user:secret@example.invalid/trailmind"
        }),
        PoolClass: PartiallyFailingPool,
        logger: { info() { throw new Error("logging unavailable"); } }
      }),
      /pool construction failed/
    );
    assert.equal(closed, 2);
  });

  it("forces a nonzero process exit after a signal drain deadline", async () => {
    const handlers = new Map();
    let exitCode;
    const processObject = {
      once(signal, handler) { handlers.set(signal, handler); },
      removeListener(signal) { handlers.delete(signal); },
      exit(code) { exitCode = code; }
    };
    const remove = installSignalHandlers(
      processObject,
      async () => ({ outcome: "deadline_exceeded" })
    );
    handlers.get("SIGTERM")();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(processObject.exitCode, 1);
    assert.equal(exitCode, 1);
    remove();
  });
});

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    TRAILMIND_RELEASE_STAGE: "closed_beta",
    HOST: "127.0.0.1",
    APP_ATTEST_DATABASE_URL:
      "postgresql://app_user:secret-sentinel@example.invalid/trailmind",
    APP_ATTEST_APP_ID_PREFIX: "ABCDE12345",
    APP_ATTEST_BUNDLE_ID: "com.trailmind.app",
    APP_ATTEST_ENVIRONMENT: "production",
    APP_ATTEST_ALLOWED_VALIDATION_CATEGORIES: "3",
    APP_ATTEST_ALLOWED_BUNDLE_VERSIONS: "1",
    ROUTE_PROVIDER_ENABLED: "false",
    INTENT_PROVIDER_ENABLED: "false",
    OUTDOOR_EVIDENCE_PROVIDER_ENABLED: "false",
    OUTDOOR_RESEARCH_PLANNING_ENABLED: "false",
    OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED: "false",
    ROUTE_ALLOW_INSECURE_LOCAL_ROUTING: "false",
    INTENT_ALLOW_INSECURE_LOCAL_PARSING: "false",
    INTENT_ALLOW_DETERMINISTIC_MOCK: "false",
    OUTDOOR_RESEARCH_PLANNING_ALLOW_INSECURE_LOCAL: "false",
    APP_ATTEST_ALLOW_IN_MEMORY: "false",
    ...overrides
  };
}

function inertAppAttestRuntime() {
  return {
    repository: undefined,
    endpoint: async () => ({ statusCode: 503, payload: { error: "unavailable" } }),
    routeAuthorizer: undefined,
    intentAuthorizer: undefined
  };
}

async function startServer(options) {
  const server = createIntentServer(options);
  servers.add(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}` };
}

function fakeClosingServer({ complete }) {
  return {
    listening: true,
    closeAllConnectionsCalled: false,
    close(callback) {
      this.listening = false;
      if (complete) queueMicrotask(() => callback());
    },
    closeIdleConnections() {},
    closeAllConnections() { this.closeAllConnectionsCalled = true; }
  };
}
