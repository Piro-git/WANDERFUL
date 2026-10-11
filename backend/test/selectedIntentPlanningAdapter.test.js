import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSelectedIntentPlanningAdapter,
  parseSelectedPlanningResponse,
  selectedPlanningConfiguration
} from "../src/llmPlanning/adapters/selectedIntentPlanningAdapter.js";
import {
  planningRequestFixture,
  routePlanFixture
} from "./fixtures/llmPlanningAdapterFixturesV1.js";

describe("selected Gemini/OpenRouter planning adapter", () => {
  it("uses the existing OpenRouter selection and strict structured-output request", async () => {
    let calls = 0;
    const adapter = createSelectedIntentPlanningAdapter({
      env: openRouterEnvironment(),
      fetchImpl: async (url, init) => {
        calls += 1;
        assert.equal(url.toString(), "https://openrouter.ai/api/v1/chat/completions");
        assert.equal(init.redirect, "manual");
        assert.equal(init.headers.Authorization, "Bearer test-openrouter-key");
        const body = JSON.parse(init.body);
        assert.equal(body.model, "test/openrouter-model");
        assert.equal(body.response_format.type, "json_schema");
        assert.equal(body.response_format.json_schema.strict, true);
        assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
        return jsonResponse({
          choices: [{ message: { content: JSON.stringify(routePlanFixture()) } }]
        });
      }
    });
    assert.deepEqual(await adapter(planningRequestFixture()), routePlanFixture());
    assert.equal(calls, 1);
  });

  it("uses the existing Gemini selection without placing its key in the URL", async () => {
    const adapter = createSelectedIntentPlanningAdapter({
      env: googleEnvironment(),
      fetchImpl: async (url, init) => {
        assert.equal(url.toString(), "https://generativelanguage.googleapis.com/v1beta/interactions");
        assert.equal(url.search, "");
        assert.equal(init.headers["x-goog-api-key"], "test-google-key");
        const body = JSON.parse(init.body);
        assert.equal(body.model, "test-gemini-model");
        assert.equal(body.response_format.schema.additionalProperties, false);
        return jsonResponse({ output_text: JSON.stringify(routePlanFixture()) });
      }
    });
    assert.deepEqual(await adapter(planningRequestFixture()), routePlanFixture());
  });

  it("rejects unknown fields, geometry, coordinates, claims, provider metadata, and prompt reflection", () => {
    const prompt = planningRequestFixture().prompt;
    const mutations = [
      (plan) => { plan.unexpected = true; },
      (plan) => { plan.geometry = [[10.6, 51.8]]; },
      (plan) => { plan.intent.coordinates = { latitude: 51.8, longitude: 10.6 }; },
      (plan) => { plan.intent.safetyVerified = true; },
      (plan) => { plan.intent.waterAvailable = true; },
      (plan) => { plan.intent.providerMetadata = { model: "private" }; },
      (plan) => { plan.candidates[0].stops[0].routeGeometry = "encoded"; },
      (plan) => { plan.intent.startLocationName = prompt; }
    ];
    for (const mutate of mutations) {
      const plan = structuredClone(routePlanFixture());
      mutate(plan);
      assert.throws(
        () => parseSelectedPlanningResponse(openRouterResponse(plan), "openrouter", prompt),
        errorCode("invalid_response")
      );
    }
    assert.throws(
      () => parseSelectedPlanningResponse({ choices: [{ message: { content: "{malformed" } }] }, "openrouter", prompt),
      errorCode("invalid_response")
    );
  });

  it("enforces response ceilings, rejects redirects, and never retries", async () => {
    const oversized = createSelectedIntentPlanningAdapter({
      env: openRouterEnvironment({ INTENT_PROVIDER_MAX_RESPONSE_BYTES: "8192" }),
      fetchImpl: async () => new Response("x".repeat(8193), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    });
    await assert.rejects(oversized(planningRequestFixture()), errorCode("response_too_large"));

    const redirected = createSelectedIntentPlanningAdapter({
      env: openRouterEnvironment(),
      fetchImpl: async () => new Response(null, {
        status: 302,
        headers: { Location: "https://example.invalid" }
      })
    });
    await assert.rejects(redirected(planningRequestFixture()), errorCode("redirect_rejected"));

    let calls = 0;
    const bounded = createSelectedIntentPlanningAdapter({
      env: openRouterEnvironment({ INTENT_PROVIDER_MAX_ATTEMPTS: "2" }),
      fetchImpl: async () => {
        calls += 1;
        return new Response("private", { status: 503 });
      }
    });
    await assert.rejects(bounded(planningRequestFixture()), (error) =>
      error.code === "provider_unavailable" && !error.message.includes("private")
    );
    assert.equal(calls, 1);
  });

  it("propagates timeout and caller cancellation with safe errors", async () => {
    const timedOut = createSelectedIntentPlanningAdapter({
      env: openRouterEnvironment({ LLM_FIRST_PLANNING_LLM_TIMEOUT_MS: "100" }),
      fetchImpl: () => new Promise(() => {})
    });
    await assert.rejects(timedOut(planningRequestFixture()), errorCode("timed_out"));

    const controller = new AbortController();
    const cancelled = createSelectedIntentPlanningAdapter({
      env: openRouterEnvironment(),
      fetchImpl: () => new Promise(() => {})
    });
    const pending = cancelled(planningRequestFixture(), { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, errorCode("cancelled"));
  });

  it("requires a key for the explicitly selected provider", () => {
    for (const env of [
      openRouterEnvironment({ OPENROUTER_API_KEY: "" }),
      { ...openRouterEnvironment(), AI_PROVIDER: "unknown" }
    ]) {
      assert.throws(() => selectedPlanningConfiguration(env), errorCode("configuration_missing"));
    }
    assert.equal(
      selectedPlanningConfiguration(openRouterEnvironment({ GOOGLE_API_KEY: "unused-key" })).provider,
      "openrouter"
    );
  });
});

function openRouterEnvironment(overrides = {}) {
  return {
    AI_PROVIDER: "openrouter",
    OPENROUTER_API_KEY: "test-openrouter-key",
    OPENROUTER_MODEL: "test/openrouter-model",
    GOOGLE_API_KEY: "",
    INTENT_PROVIDER_MAX_RESPONSE_BYTES: "65536",
    INTENT_PROVIDER_MAX_ERROR_RESPONSE_BYTES: "4096",
    INTENT_PROVIDER_MAX_ATTEMPTS: "1",
    INTENT_PROVIDER_RETRY_DELAY_MS: "0",
    ...overrides
  };
}

function googleEnvironment(overrides = {}) {
  return {
    AI_PROVIDER: "google",
    GOOGLE_API_KEY: "test-google-key",
    GOOGLE_MODEL: "test-gemini-model",
    OPENROUTER_API_KEY: "",
    INTENT_PROVIDER_MAX_RESPONSE_BYTES: "65536",
    INTENT_PROVIDER_MAX_ERROR_RESPONSE_BYTES: "4096",
    INTENT_PROVIDER_MAX_ATTEMPTS: "1",
    ...overrides
  };
}

function openRouterResponse(plan) {
  return { choices: [{ message: { content: JSON.stringify(plan) } }] };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function errorCode(code) {
  return (error) => error?.code === code && !error.message.includes("test-");
}
