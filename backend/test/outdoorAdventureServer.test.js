import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  createOutdoorAdventurePlanningEndpoint
} from "../src/outdoorAdventure/outdoorAdventureEndpoint.js";
import { createIntentServer } from "../src/server.js";
import {
  minimalAdventureResearchIntent
} from "./outdoorResearchTestSupport.js";

const PATH = "/api/outdoor-research/plan-route";
const servers = new Set();

afterEach(async () => {
  await Promise.all(
    [...servers].map((server) =>
      new Promise((resolve) => server.close(resolve))
    )
  );
  servers.clear();
});

describe("outdoor-adventure planning HTTP server", () => {
  it("returns fixed unavailable without parsing or authorizing while disabled", async () => {
    let endpointCalls = 0;
    const endpoint = createOutdoorAdventurePlanningEndpoint({
      env: {
        NODE_ENV: "test",
        OUTDOOR_RESEARCH_PLANNING_ENABLED: "false"
      },
      authorizer: {
        async authorize() {
          assert.fail("authorization called");
        }
      },
      orchestrator: async () => assert.fail("orchestrator called")
    });
    const server = await startServer({
      env: {
        NODE_ENV: "test",
        OUTDOOR_RESEARCH_PLANNING_ENABLED: "false"
      },
      outdoorAdventurePlanningEndpoint: async (...arguments_) => {
        endpointCalls += 1;
        return endpoint(...arguments_);
      }
    });
    const response = await fetch(`${server.url}${PATH}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "not-json"
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "feature_unavailable");
    assert.equal(endpointCalls, 1);
  });

  it("enforces JSON media type and rejects prefix lookalikes", async () => {
    const endpoint = successfulEndpoint();
    const server = await startServer({
      env: enabledEnv(),
      outdoorAdventurePlanningEndpoint: endpoint
    });
    for (const contentType of [
      "text/plain",
      "application/json-malicious"
    ]) {
      const response = await fetch(`${server.url}${PATH}`, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: JSON.stringify(request())
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "invalid_request");
    }
  });

  it("enforces the dedicated body-size limit", async () => {
    const server = await startServer({
      env: enabledEnv({
        OUTDOOR_RESEARCH_PLANNING_MAX_BODY_BYTES: "4096"
      }),
      outdoorAdventurePlanningEndpoint: successfulEndpoint()
    });
    const response = await fetch(
      `${server.url}${PATH}`,
      jsonRequest({
        ...request(),
        padding: "x".repeat(5_000)
      })
    );
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, "invalid_request");
  });

  it("rejects raw prompts, client dossiers and unknown request fields", async () => {
    const endpoint = successfulEndpoint();
    const server = await startServer({
      env: enabledEnv(),
      outdoorAdventurePlanningEndpoint: endpoint
    });
    for (const body of [
      { schemaVersion: 1, prompt: "private raw prompt" },
      {
        ...request(),
        dossier: { fabricated: true }
      },
      {
        ...request(),
        provider: "client-choice"
      }
    ]) {
      const response = await fetch(
        `${server.url}${PATH}`,
        jsonRequest(body)
      );
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "invalid_request");
    }
  });

  it("serves the strict endpoint and preserves no-store security headers", async () => {
    let receivedBody;
    const server = await startServer({
      env: enabledEnv(),
      outdoorAdventurePlanningEndpoint: async (body) => {
        receivedBody = body;
        return {
          statusCode: 200,
          payload: clarificationResponse(body.intent)
        };
      }
    });
    const response = await fetch(
      `${server.url}${PATH}`,
      jsonRequest(request())
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.state, "clarification_required");
    assert.equal(receivedBody.schemaVersion, 1);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(
      response.headers.get("x-content-type-options"),
      "nosniff"
    );
  });

  it("propagates client disconnect cancellation to endpoint work", async () => {
    let startedResolve;
    let abortedResolve;
    const started = new Promise((resolve) => {
      startedResolve = resolve;
    });
    const aborted = new Promise((resolve) => {
      abortedResolve = resolve;
    });
    const server = await startServer({
      env: enabledEnv(),
      outdoorAdventurePlanningEndpoint: async (_body, context) => {
        startedResolve();
        return new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () => {
            abortedResolve();
            reject(new Error("cancelled"));
          }, { once: true });
        });
      }
    });
    const controller = new AbortController();
    const pending = fetch(`${server.url}${PATH}`, {
      ...jsonRequest(request()),
      signal: controller.signal
    });
    await started;
    controller.abort();
    await assert.rejects(pending);
    await aborted;
  });

  it("keeps health and unknown-path behavior unchanged", async () => {
    const server = await startServer({
      env: enabledEnv(),
      outdoorAdventurePlanningEndpoint: successfulEndpoint()
    });
    const health = await fetch(`${server.url}/health`);
    assert.deepEqual(await health.json(), { ok: true });
    const missing = await fetch(`${server.url}/api/not-found`, {
      method: "POST"
    });
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "Not found" });
  });
});

function successfulEndpoint() {
  return createOutdoorAdventurePlanningEndpoint({
    env: enabledEnv(),
    authorizer: {
      async authorize() {
        return {
          authorized: true,
          rateLimitKey: "test",
          limitsConsumed: true
        };
      }
    },
    repository: {},
    provider: {},
    orchestrator: async (planningRequest) =>
      clarificationResponse(planningRequest.intent)
  });
}

async function startServer(options) {
  const server = createIntentServer(options);
  servers.add(server);
  await new Promise((resolve) =>
    server.listen(0, "127.0.0.1", resolve)
  );
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}`
  };
}

function enabledEnv(overrides = {}) {
  return {
    NODE_ENV: "test",
    OUTDOOR_RESEARCH_PLANNING_ENABLED: "true",
    ...overrides
  };
}

function request() {
  return {
    schemaVersion: 1,
    intent: minimalAdventureResearchIntent()
  };
}

function clarificationResponse(intent) {
  return {
    schemaVersion: 1,
    policyVersion: "outdoor-adventure-orchestration-v1",
    state: "clarification_required",
    normalizedIntent: intent,
    planningGaps: [],
    clarificationQuestions: intent.unresolvedClarificationQuestions,
    routedAlternatives: null
  };
}

function jsonRequest(body) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}
