import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLLMFirstPlanningEndpoint } from "../src/llmPlanning/llmFirstPlanningEndpoint.js";

const REQUEST = Object.freeze({
  schemaVersion: 1,
  prompt: "A calm loop from Ilsenburg",
  locale: "en",
  userLocationHint: null
});

describe("LLM-first planning endpoint", () => {
  it("is default-off before authorization, LLM, geocoding, or routing", async () => {
    for (const value of [
      undefined, "", "false", "0", "enabled", "2", "yes", "1", "TRUE", " true "
    ]) {
      const calls = { authorization: 0, llm: 0, geocode: 0, route: 0 };
      const endpoint = createLLMFirstPlanningEndpoint({
        env: {
          NODE_ENV: "test",
          LLM_FIRST_PLANNING_ENABLED: value,
          INTENT_PROVIDER_ENABLED: "true",
          ROUTE_PROVIDER_ENABLED: "true"
        },
        authorizer: {
          async authorize() { calls.authorization += 1; assert.fail("authorization called"); }
        },
        llmPlanGenerator: async () => { calls.llm += 1; assert.fail("LLM called"); },
        locationGeocoder: async () => { calls.geocode += 1; assert.fail("geocoder called"); },
        provider: { async route() { calls.route += 1; assert.fail("route called"); } }
      });
      const result = await endpoint(REQUEST);
      assert.equal(result.statusCode, 503);
      assert.equal(result.payload.error.code, "feature_unavailable");
      assert.deepEqual(calls, { authorization: 0, llm: 0, geocode: 0, route: 0 });
    }
  });

  it("requires both existing provider gates before any work", async () => {
    for (const missing of ["INTENT_PROVIDER_ENABLED", "ROUTE_PROVIDER_ENABLED"]) {
      const env = enabledEnvironment();
      env[missing] = "false";
      let authorizationCalls = 0;
      const endpoint = createLLMFirstPlanningEndpoint({
        env,
        authorizer: { async authorize() { authorizationCalls += 1; } },
        llmPlanGenerator: async () => assert.fail("LLM called"),
        locationGeocoder: async () => assert.fail("geocoder called"),
        provider: { async route() { assert.fail("route called"); } }
      });
      const result = await endpoint(REQUEST);
      assert.equal(result.payload.error.code, "feature_unavailable");
      assert.equal(authorizationCalls, 0);
    }
  });

  it("checks production adapter configuration only after authorization and admission", async () => {
    let authorizationCalls = 0;
    const endpoint = createLLMFirstPlanningEndpoint({
      env: enabledEnvironment(),
      authorizer: {
        async authorize() {
          authorizationCalls += 1;
          return { authorized: true, rateLimitKey: "unused" };
        }
      },
      provider: { async route() { assert.fail("route called"); } }
    });
    const result = await endpoint(REQUEST);
    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.error.code, "feature_unavailable");
    assert.equal(authorizationCalls, 1);
  });

  it("reuses weighted App Attest authorization and logs no prompt or coordinates", async () => {
    const logs = [];
    const authorizationContexts = [];
    let releases = 0;
    const endpoint = createLLMFirstPlanningEndpoint({
      env: enabledEnvironment(),
      logger: { info(entry) { logs.push(entry); } },
      now: (() => { let value = 100; return () => value++; })(),
      authorizer: {
        async authorize(context) {
          authorizationContexts.push(context);
          return {
            authorized: true,
            limitsConsumed: true,
            rateLimitKey: "attested-installation",
            async release() { releases += 1; }
          };
        }
      },
      llmPlanGenerator: async () => { assert.fail("stub orchestrator owns execution"); },
      locationGeocoder: async () => { assert.fail("stub orchestrator owns execution"); },
      provider: { async route() { assert.fail("stub orchestrator owns execution"); } },
      orchestrator: async (_request, dependencies, options) => {
        assert.equal(typeof dependencies.generatePlan, "function");
        assert.equal(typeof dependencies.geocode, "function");
        assert.equal(typeof dependencies.provider.route, "function");
        assert.equal(options.maximumConcurrentRoutes, 2);
        return {
          schemaVersion: 1,
          policyVersion: "llm-first-route-planning-v1",
          state: "recovery",
          intent: null,
          routes: [],
          rejections: [{ candidateId: "plan", code: "empty_llm_output", stage: "llm" }],
          diagnostics: {
            acceptedCount: 0,
            rejectedCount: 1,
            rejectionCounts: { empty_llm_output: 1 },
            fallbackAttempted: false,
            fallbackAttemptCount: 0
          },
          recovery: {
            code: "no_verified_route_candidates",
            message: "Use standard planning."
          }
        };
      }
    });
    const result = await endpoint(REQUEST, {
      headers: { authorization: "TrailMindRouteSession opaque" },
      requestId: "11111111-1111-4111-8111-111111111111"
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.state, "recovery");
    assert.equal(authorizationContexts.length, 1);
    assert.equal(authorizationContexts[0].cost, 12);
    assert.equal("body" in authorizationContexts[0], false);
    assert.equal("prompt" in authorizationContexts[0], false);
    assert.equal(releases, 1);
    const serializedLogs = JSON.stringify(logs);
    assert.equal(serializedLogs.includes(REQUEST.prompt), false);
    assert.equal(serializedLogs.includes("Ilsenburg"), false);
    assert.equal(serializedLogs.includes("coordinate"), false);
    assert.equal(logs[0].acceptedCount, 0);
    assert.equal(logs[0].fallbackAttemptCount, 0);
  });

  it("never logs an untrusted request ID", async () => {
    const logs = [];
    const endpoint = createLLMFirstPlanningEndpoint({
      env: enabledEnvironment(),
      logger: { info(entry) { logs.push(entry); } },
      authorizer: {
        async authorize() {
          return { authorized: true, limitsConsumed: true, rateLimitKey: "test" };
        }
      },
      llmPlanGenerator: async () => {},
      locationGeocoder: async () => {},
      provider: { async route() {} },
      orchestrator: async () => orchestrationResult("empty_llm_output")
    });
    const untrusted = "Ilsenburg 51.866,10.664";
    await endpoint(REQUEST, { requestId: untrusted });
    assert.equal(JSON.stringify(logs).includes(untrusted), false);
    assert.match(logs[0].requestId, /^[0-9a-f-]{36}$/);
  });

  it("rejects a rate-limited request before LLM, geocoding, or routing", async () => {
    const calls = { llm: 0, geocode: 0, route: 0 };
    const endpoint = createLLMFirstPlanningEndpoint({
      env: enabledEnvironment(),
      authorizer: {
        async authorize() {
          return { authorized: true, rateLimitKey: "limited-installation" };
        }
      },
      rateLimiter: { async consume() { return { allowed: false }; } },
      llmPlanGenerator: async () => { calls.llm += 1; },
      locationGeocoder: async () => { calls.geocode += 1; },
      provider: { async route() { calls.route += 1; } }
    });
    const result = await endpoint(REQUEST);
    assert.equal(result.statusCode, 429);
    assert.equal(result.payload.error.code, "rate_limited");
    assert.deepEqual(calls, { llm: 0, geocode: 0, route: 0 });
  });

  it("marks LLM readiness from verified orchestration outcomes", async () => {
    const readiness = [];
    let invocation = 0;
    const endpoint = createLLMFirstPlanningEndpoint({
      env: enabledEnvironment(),
      operationalState: {
        setLLMPlanningReady(value) { readiness.push(value); }
      },
      authorizer: {
        async authorize() {
          return { authorized: true, limitsConsumed: true, rateLimitKey: "test-installation" };
        }
      },
      llmPlanGenerator: async () => {},
      locationGeocoder: async () => {},
      provider: { async route() {} },
      orchestrator: async () => {
        invocation += 1;
        return orchestrationResult(invocation === 1 ? "llm_provider_failure" : "no_route_found");
      }
    });

    assert.equal((await endpoint(REQUEST)).statusCode, 200);
    assert.equal((await endpoint(REQUEST)).statusCode, 200);
    assert.deepEqual(readiness, [false, true]);
  });
});

function enabledEnvironment() {
  return {
    NODE_ENV: "test",
    LLM_FIRST_PLANNING_ENABLED: "true",
    INTENT_PROVIDER_ENABLED: "true",
    ROUTE_PROVIDER_ENABLED: "true"
  };
}

function orchestrationResult(rejectionCode) {
  return {
    schemaVersion: 1,
    policyVersion: "llm-first-route-planning-v1",
    state: "recovery",
    intent: null,
    routes: [],
    rejections: [{ candidateId: "plan", code: rejectionCode, stage: "llm" }],
    diagnostics: {
      acceptedCount: 0,
      rejectedCount: 1,
      rejectionCounts: { [rejectionCode]: 1 },
      fallbackAttempted: false,
      fallbackAttemptCount: 0
    },
    recovery: {
      code: "no_verified_route_candidates",
      message: "Use standard planning."
    }
  };
}

it("does not inspect provider configuration before rejected admission", async () => {
  let configReads = 0;
  const env = enabledEnvironment();
  Object.defineProperty(env, "GOOGLE_API_KEY", { get() { configReads++; return undefined; } });
  const endpoint = createLLMFirstPlanningEndpoint({ env,
    authorizer: { authorize: async () => ({ authorized: false }) } });
  const result = await endpoint(REQUEST);
  assert.equal(result.statusCode, 401);
  assert.equal(configReads, 0);
});
