import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { appAttestError } from "../src/appAttest/appAttestErrors.js";
import {
  InMemoryAppAttestRepository
} from "../src/appAttest/appAttestRepository.js";
import {
  encodeBase64Url,
  hashOpaqueValue
} from "../src/appAttest/clientData.js";
import {
  createOutdoorAdventurePlanningEndpoint
} from "../src/outdoorAdventure/outdoorAdventureEndpoint.js";
import {
  outdoorAdventureOrchestrationConfigurationV1
} from "../src/outdoorAdventure/orchestrationPolicy.js";
import {
  completeAdventureResearchIntent,
  minimalAdventureResearchIntent
} from "./outdoorResearchTestSupport.js";

describe("outdoor-adventure planning endpoint v1", () => {
  it("stays disabled for missing, false and malformed feature flags", async () => {
    for (const value of [
      undefined,
      "",
      "false",
      "0",
      "enabled",
      "2",
      " true-ish "
    ]) {
      let authorizationCalls = 0;
      let orchestratorCalls = 0;
      const endpoint = createOutdoorAdventurePlanningEndpoint({
        env: enabledEnv({ OUTDOOR_RESEARCH_PLANNING_ENABLED: value }),
        authorizer: {
          async authorize() {
            authorizationCalls += 1;
            assert.fail("authorization called");
          }
        },
        repository: {
          async withConsistentSnapshot() {
            assert.fail("repository called");
          }
        },
        provider: {
          async route() {
            assert.fail("provider called");
          }
        },
        orchestrator: async () => {
          orchestratorCalls += 1;
          assert.fail("orchestrator called");
        }
      });
      const result = await endpoint(request(resolvedIntent()));
      assert.equal(result.statusCode, 503);
      assert.equal(result.payload.error.code, "feature_unavailable");
      assert.equal(authorizationCalls, 0);
      assert.equal(orchestratorCalls, 0);
    }
  });

  it("accepts only explicit case-insensitive true, yes or 1 values", async () => {
    for (const value of ["true", " TRUE ", "yes", "YeS", "1", " 1 "]) {
      const endpoint = successfulEndpoint({
        env: enabledEnv({ OUTDOOR_RESEARCH_PLANNING_ENABLED: value })
      });
      const result = await endpoint(request(unresolvedIntent()));
      assert.equal(result.statusCode, 200);
      assert.equal(result.payload.state, "clarification_required");
    }
  });

  it("authorizes before orchestration with one fixed maximum cost and releases once", async () => {
    const order = [];
    let authorizationContext;
    let releases = 0;
    const endpoint = successfulEndpoint({
      authorizer: {
        async authorize(context) {
          order.push("authorize");
          authorizationContext = context;
          return {
            authorized: true,
            rateLimitKey: "installation",
            limitsConsumed: true,
            async release() {
              releases += 1;
            }
          };
        }
      },
      orchestrator: async (_request, _dependencies, options) => {
        order.push("orchestrate");
        assert.equal(options.maximumProposals, 3);
        assert.equal(options.maximumConcurrency, 2);
        return clarificationResponse(unresolvedIntent());
      }
    });
    const result = await endpoint(request(unresolvedIntent()), {
      headers: {
        authorization: "private-session",
        "x-trailmind-request-id":
          "11111111-1111-4111-8111-111111111111"
      }
    });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(order, ["authorize", "orchestrate"]);
    assert.equal(authorizationContext.cost, 12);
    assert.equal("body" in authorizationContext, false);
    assert.equal("intent" in authorizationContext, false);
    assert.equal(releases, 1);
  });

  it("releases authorization exactly once on orchestration failure and ignores release failure", async () => {
    let releases = 0;
    const endpoint = successfulEndpoint({
      authorizer: {
        async authorize() {
          return {
            authorized: true,
            rateLimitKey: "installation",
            limitsConsumed: true,
            async release() {
              releases += 1;
              throw new Error("private release detail");
            }
          };
        }
      },
      orchestrator: async () => {
        throw new Error("private internal detail");
      }
    });
    const result = await endpoint(request(unresolvedIntent()));
    assert.equal(result.statusCode, 500);
    assert.equal(result.payload.error.code, "internal_failure");
    assert.equal(JSON.stringify(result).includes("private"), false);
    assert.equal(releases, 1);
  });

  it("maps session, replay, durable-unavailable and rate-limit failures safely", async () => {
    for (const [sourceCode, expectedCode] of [
      ["route_session_invalid", "authorization_failed"],
      ["route_session_expired", "authorization_failed"],
      ["route_session_exhausted", "authorization_failed"],
      ["request_replayed", "authorization_failed"],
      ["authorization_unavailable", "authorization_unavailable"],
      ["app_attest_rate_limited", "rate_limited"]
    ]) {
      const endpoint = successfulEndpoint({
        authorizer: {
          async authorize() {
            throw appAttestError(sourceCode);
          }
        }
      });
      const result = await endpoint(request(unresolvedIntent()));
      assert.equal(result.payload.error.code, expectedCode);
      if (sourceCode !== expectedCode) {
        assert.equal(JSON.stringify(result).includes(sourceCode), false);
      }
    }
  });

  it("rejects a replay through the existing route-session authorization contract", async () => {
    const appAttestRepository = new InMemoryAppAttestRepository();
    const token = encodeBase64Url(randomBytes(32));
    await appAttestRepository.createRouteSession({
      tokenHash: hashOpaqueValue(token),
      installationId: randomUUID(),
      expiresAt: Date.now() + 60_000,
      maximumCost: 24
    });
    let orchestratorCalls = 0;
    const endpoint = createOutdoorAdventurePlanningEndpoint({
      env: enabledEnv(),
      appAttestRepository,
      repository: {},
      provider: {},
      orchestrator: async (planningRequest) => {
        orchestratorCalls += 1;
        return clarificationResponse(planningRequest.intent);
      }
    });
    const headers = {
      authorization: `TrailMindRouteSession ${token}`,
      "x-trailmind-request-id": randomUUID()
    };
    const first = await endpoint(request(unresolvedIntent()), { headers });
    const replay = await endpoint(request(unresolvedIntent()), { headers });
    assert.equal(first.statusCode, 200);
    assert.equal(replay.statusCode, 401);
    assert.equal(replay.payload.error.code, "authorization_failed");
    assert.equal(orchestratorCalls, 1);
  });

  it("fails closed in production without durable route-session authorization", async () => {
    const endpoint = createOutdoorAdventurePlanningEndpoint({
      env: enabledEnv({ NODE_ENV: "production" }),
      repository: {},
      provider: {},
      orchestrator: async () => assert.fail("orchestrator called")
    });
    const result = await endpoint(request(unresolvedIntent()));
    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.error.code, "authorization_unavailable");
  });

  it("requires a dedicated explicit local insecure opt-in", async () => {
    const blocked = successfulEndpoint({
      env: enabledEnv({
        NODE_ENV: "test",
        ROUTE_ALLOW_INSECURE_LOCAL_ROUTING: "true",
        OUTDOOR_RESEARCH_PLANNING_ALLOW_INSECURE_LOCAL: "false"
      }),
      authorizer: undefined
    });
    const blockedResult = await blocked(request(unresolvedIntent()));
    assert.equal(blockedResult.payload.error.code, "authorization_unavailable");

    const allowed = successfulEndpoint({
      env: enabledEnv({
        NODE_ENV: "test",
        OUTDOOR_RESEARCH_PLANNING_ALLOW_INSECURE_LOCAL: "true"
      }),
      authorizer: undefined
    });
    const allowedResult = await allowed(request(unresolvedIntent()));
    assert.equal(allowedResult.statusCode, 200);
  });

  it("uses fallback limiting only outside durable accounting and fails closed on exhaustion", async () => {
    let limiterCalls = 0;
    const endpoint = successfulEndpoint({
      authorizer: {
        async authorize() {
          return {
            authorized: true,
            rateLimitKey: "installation",
            limitsConsumed: false
          };
        }
      },
      rateLimiter: {
        consume(input) {
          limiterCalls += 1;
          assert.equal(input.cost, 12);
          return { allowed: false };
        }
      },
      orchestrator: async () => assert.fail("orchestrator called")
    });
    const result = await endpoint(request(unresolvedIntent()));
    assert.equal(result.statusCode, 429);
    assert.equal(result.payload.error.code, "rate_limited");
    assert.equal(limiterCalls, 1);
  });

  it("performs zero authorization work for an already-cancelled caller", async () => {
    const controller = new AbortController();
    controller.abort();
    let authorizationCalls = 0;
    const endpoint = successfulEndpoint({
      authorizer: {
        async authorize() {
          authorizationCalls += 1;
          assert.fail("authorization called");
        }
      }
    });
    const result = await endpoint(
      request(unresolvedIntent()),
      { signal: controller.signal }
    );
    assert.equal(result.statusCode, 499);
    assert.equal(result.payload.error.code, "cancelled");
    assert.equal(authorizationCalls, 0);
  });

  it("fails closed for invalid production bounds and enforces deadline-to-lease margin", async () => {
    const invalidValues = [
      { OUTDOOR_RESEARCH_PLANNING_REQUEST_COST: "6" },
      { OUTDOOR_RESEARCH_PLANNING_MAX_PROPOSALS: "7" },
      { OUTDOOR_RESEARCH_PLANNING_MAX_GRAPHHOPPER_CALLS: "0" },
      { OUTDOOR_RESEARCH_PLANNING_MAX_CONCURRENCY: "3" },
      { OUTDOOR_RESEARCH_PLANNING_TOTAL_TIMEOUT_MS: "not-a-number" },
      {
        OUTDOOR_RESEARCH_PLANNING_TOTAL_TIMEOUT_MS: "25000",
        ROUTE_GLOBAL_LEASE_TTL_SECONDS: "25"
      },
      {
        APP_ATTEST_ROUTE_SESSION_MAX_COST: "11"
      },
      {
        APP_ATTEST_INSTALLATION_MAX_COST: "11"
      },
      {
        ROUTE_GLOBAL_MAX_COST: "11"
      }
    ];
    for (const values of invalidValues) {
      let authorizationCalls = 0;
      const endpoint = successfulEndpoint({
        env: enabledEnv({ NODE_ENV: "production", ...values }),
        authorizer: {
          async authorize() {
            authorizationCalls += 1;
            assert.fail("authorization called");
          }
        }
      });
      const result = await endpoint(request(unresolvedIntent()));
      assert.equal(
        ["feature_unavailable", "authorization_unavailable"]
          .includes(result.payload.error.code),
        true
      );
      assert.equal(authorizationCalls, 0);
    }

    const configuration =
      outdoorAdventureOrchestrationConfigurationV1(enabledEnv());
    assert(
      configuration.totalDeadlineMs <
      configuration.authorizationLeaseTtlMs
    );
    assert(
      configuration.totalDeadlineMs <=
      configuration.authorizationLeaseTtlMs - 1_000
    );
  });

  it("logs only allowlisted coarse metadata and fixed classifications", async () => {
    const logs = [];
    const intent = resolvedIntent();
    const endpoint = successfulEndpoint({
      logger: {
        info(value) {
          logs.push(value);
        }
      }
    });
    const result = await endpoint(request(intent), {
      headers: {
        authorization: "secret-session-value",
        "x-trailmind-request-id":
          "11111111-1111-4111-8111-111111111111"
      }
    });
    assert.equal(result.statusCode, 200);
    assert.equal(logs.length, 1);
    assert.deepEqual(
      Object.keys(logs[0]).sort(),
      [
        "activity",
        "attemptCount",
        "durationBucket",
        "errorCode",
        "event",
        "proposalCount",
        "regionId",
        "requestId",
        "resultState",
        "routeResultCount",
        "routeType"
      ].sort()
    );
    const serialized = JSON.stringify(logs);
    for (const forbidden of [
      "Harz private location",
      "51.8",
      "10.6",
      "secret-session-value",
      "private raw prompt",
      "graphhopper"
    ]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  });
});

function successfulEndpoint(overrides = {}) {
  return createOutdoorAdventurePlanningEndpoint({
    env: enabledEnv(),
    authorizer: {
      async authorize() {
        return {
          authorized: true,
          rateLimitKey: "installation",
          limitsConsumed: true,
          async release() {}
        };
      }
    },
    repository: {},
    provider: {},
    orchestrator: async (planningRequest) =>
      clarificationResponse(planningRequest.intent),
    ...overrides
  });
}

function enabledEnv(overrides = {}) {
  return {
    NODE_ENV: "test",
    OUTDOOR_RESEARCH_PLANNING_ENABLED: "true",
    ...overrides
  };
}

function request(intent) {
  return { schemaVersion: 1, intent };
}

function unresolvedIntent() {
  return minimalAdventureResearchIntent();
}

function resolvedIntent() {
  return completeAdventureResearchIntent({
    geographicAnchor: {
      state: "resolved",
      name: "Harz private location",
      coordinate: { latitude: 51.8, longitude: 10.6 },
      regionEntityId: "30000000-0000-4000-8000-000000000002"
    }
  });
}

function clarificationResponse(intent) {
  const normalizedIntent = intent.geographicAnchor.state === "unresolved"
    ? intent
    : minimalAdventureResearchIntent();
  return {
    schemaVersion: 1,
    policyVersion: "outdoor-adventure-orchestration-v1",
    state: "clarification_required",
    normalizedIntent,
    planningGaps: [],
    clarificationQuestions:
      normalizedIntent.unresolvedClarificationQuestions,
    routedAlternatives: null
  };
}
