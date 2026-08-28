import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { createIntentSessionEndpoint } from "../src/appAttest/intentSessionEndpoint.js";
import { InMemoryAppAttestRepository } from "../src/appAttest/appAttestRepository.js";
import {
  createIntentSessionAuthorizer,
  createRouteSessionAuthorizer,
  intentAuthorizationConfiguration,
  routeAuthorizationConfiguration
} from "../src/appAttest/routeSessionAuthorizer.js";
import { hashOpaqueValue } from "../src/appAttest/clientData.js";
import { createRouteEndpoint } from "../src/routing/routeEndpoint.js";
import { graphHopperResponse, loopRequest } from "./routeTestSupport.js";

const ACCEPTED_VALUES = ["true", "TRUE", " true ", "yes", "YES", " yes ", "1", " 1 "];
const REJECTED_VALUES = [
  undefined,
  "",
  " ",
  "false",
  "FALSE",
  "0",
  "no",
  "off",
  "on",
  "enabled",
  "tru",
  "yesplease",
  1,
  true,
  {},
  []
];

describe("fail-closed provider feature flags", () => {
  it("enables the route provider only for reviewed explicit string values", () => {
    for (const value of ACCEPTED_VALUES) {
      assert.equal(routeConfiguration(value).providerEnabled, true, String(value));
    }
  });

  it("disables the route provider for missing, false, malformed, and non-string values", () => {
    for (const value of REJECTED_VALUES) {
      assert.equal(routeConfiguration(value).providerEnabled, false, String(value));
    }
  });

  it("enables the intent provider only for reviewed explicit string values", () => {
    for (const value of ACCEPTED_VALUES) {
      assert.equal(intentConfiguration(value).providerEnabled, true, String(value));
    }
  });

  it("disables the intent provider for missing, false, malformed, and non-string values", () => {
    for (const value of REJECTED_VALUES) {
      assert.equal(intentConfiguration(value).providerEnabled, false, String(value));
    }
  });

  it("keeps route and intent authorization independent", async () => {
    const cases = [
      ["true", "false", true, false],
      ["false", "true", false, true],
      ["false", "false", false, false],
      ["true", "true", true, true],
      [undefined, "true", false, true],
      ["true", "enabled", true, false],
      ["yesplease", undefined, false, false]
    ];

    for (const [routeValue, intentValue, routeAllowed, intentAllowed] of cases) {
      const { repository, token } = await sessionRepository();
      const env = { NODE_ENV: "test" };
      if (routeValue !== undefined) env.ROUTE_PROVIDER_ENABLED = routeValue;
      if (intentValue !== undefined) env.INTENT_PROVIDER_ENABLED = intentValue;

      const routeResult = await authorizationResult(
        createRouteSessionAuthorizer({ repository, env }),
        token
      );
      const intentResult = await authorizationResult(
        createIntentSessionAuthorizer({ repository, env }),
        token
      );

      assert.equal(routeResult.allowed, routeAllowed, `route ${String(routeValue)}`);
      assert.equal(intentResult.allowed, intentAllowed, `intent ${String(intentValue)}`);
      if (!routeAllowed) assert.equal(routeResult.errorCode, "authorization_unavailable");
      if (!intentAllowed) assert.equal(intentResult.errorCode, "authorization_unavailable");

      const consumedCost = Number(routeAllowed) + Number(intentAllowed);
      assert.equal(sessionRecord(repository, token).remainingCost, 12 - consumedCost);
    }
  });

  it("uses identical provider-flag semantics in production and test configuration", () => {
    for (const value of [...ACCEPTED_VALUES, ...REJECTED_VALUES]) {
      assert.equal(
        routeConfiguration(value, "production").providerEnabled,
        routeConfiguration(value, "test").providerEnabled,
        `route ${String(value)}`
      );
      assert.equal(
        intentConfiguration(value, "production").providerEnabled,
        intentConfiguration(value, "test").providerEnabled,
        `intent ${String(value)}`
      );
    }
  });

  it("returns a safe route error without provider work or budget consumption when disabled", async () => {
    const malformedValue = "enabled-sensitive-sentinel";
    const { repository, token } = await sessionRepository();
    let providerCalls = 0;
    const endpoint = createRouteEndpoint({
      env: { NODE_ENV: "test", ROUTE_PROVIDER_ENABLED: malformedValue },
      appAttestRepository: repository,
      provider: {
        async route() {
          providerCalls += 1;
          return { provider: "graphhopper", ...graphHopperResponse() };
        }
      }
    });

    const result = await endpoint(loopRequest(), {
      headers: sessionHeaders(token)
    });

    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.error.code, "authorization_unavailable");
    assert.equal("remainingCost" in result.payload, false);
    assert.equal(providerCalls, 0);
    assert.equal(sessionRecord(repository, token).remainingCost, 12);
    assert.equal(sessionRecord(repository, token).requestIds.size, 0);
    assert.equal(repository.rateWindows.size, 0);
    assert.equal(repository.routeLeases.size, 0);
    assert.equal(repository.globalActiveByScope.size, 0);
    assert.equal(JSON.stringify(result).includes(malformedValue), false);
  });

  it("returns before route or intent authorization when provider features are disabled", async () => {
    let routeAuthorizationCalls = 0;
    let routeProviderCalls = 0;
    const routeEndpoint = createRouteEndpoint({
      env: { NODE_ENV: "production", ROUTE_PROVIDER_ENABLED: "false" },
      authorizer: {
        async authorize() {
          routeAuthorizationCalls += 1;
          return { authorized: true, rateLimitKey: "must-not-run" };
        }
      },
      provider: {
        async route() {
          routeProviderCalls += 1;
          return graphHopperResponse();
        }
      }
    });
    const routeResult = await routeEndpoint(loopRequest(), {});

    let intentAuthorizationCalls = 0;
    let intentProviderCalls = 0;
    const intentEndpoint = createIntentSessionEndpoint({
      env: { NODE_ENV: "production", INTENT_PROVIDER_ENABLED: "false" },
      intentAuthorizer: {
        async authorize() {
          intentAuthorizationCalls += 1;
          return { authorized: true };
        }
      },
      parseIntent: async () => {
        intentProviderCalls += 1;
        return { ok: true };
      }
    });
    const intentResult = await intentEndpoint({ prompt: "15 km loop" }, {});

    assert.equal(routeResult.statusCode, 503);
    assert.equal(routeResult.payload.error.code, "authorization_unavailable");
    assert.equal(routeAuthorizationCalls, 0);
    assert.equal(routeProviderCalls, 0);
    assert.equal(intentResult.statusCode, 503);
    assert.equal(intentResult.payload.error.code, "authorization_unavailable");
    assert.equal(intentAuthorizationCalls, 0);
    assert.equal(intentProviderCalls, 0);
  });

  it("performs zero fetch, circuit-clock, or circuit-event work when routing is disabled", async () => {
    const { repository, token } = await sessionRepository();
    let fetchCalls = 0;
    let circuitClockReads = 0;
    const events = [];
    const endpoint = createRouteEndpoint({
      env: {
        NODE_ENV: "test",
        ROUTE_PROVIDER_ENABLED: "false",
        GRAPHHOPPER_API_KEY: "unused-provider-secret"
      },
      appAttestRepository: repository,
      fetchImpl: async () => {
        fetchCalls += 1;
        return Response.json(graphHopperResponse());
      },
      providerCircuitNow() {
        circuitClockReads += 1;
        return 0;
      },
      logger: { info(event) { events.push(event); } }
    });

    const result = await endpoint(loopRequest(), { headers: sessionHeaders(token) });
    assert.equal(result.payload.error.code, "authorization_unavailable");
    assert.equal(fetchCalls, 0);
    assert.equal(circuitClockReads, 0);
    assert.equal(
      events.some((event) => event.event === "provider_circuit_state_changed"),
      false
    );
    assert.equal(sessionRecord(repository, token).remainingCost, 12);
  });

  it("returns a safe intent error without provider work or budget consumption when disabled", async () => {
    const malformedValue = "enabled-sensitive-sentinel";
    const { repository, token } = await sessionRepository();
    let providerCalls = 0;
    const endpoint = createIntentSessionEndpoint({
      env: { NODE_ENV: "test", INTENT_PROVIDER_ENABLED: malformedValue },
      appAttestRepository: repository,
      parseIntent: async () => {
        providerCalls += 1;
        return { ok: true };
      }
    });

    const result = await endpoint(
      { prompt: "15 km loop" },
      { headers: sessionHeaders(token) }
    );

    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.error.code, "authorization_unavailable");
    assert.equal("remainingCost" in result.payload, false);
    assert.equal(providerCalls, 0);
    assert.equal(sessionRecord(repository, token).remainingCost, 12);
    assert.equal(sessionRecord(repository, token).requestIds.size, 0);
    assert.equal(repository.rateWindows.size, 0);
    assert.equal(repository.routeLeases.size, 0);
    assert.equal(repository.globalActiveByScope.size, 0);
    assert.equal(JSON.stringify(result).includes(malformedValue), false);
  });

  it("tracks fail-closed provider defaults in the example configuration", async () => {
    const configuration = await readFile(new URL("../config.example.env", import.meta.url), "utf8");
    assert.match(configuration, /^ROUTE_PROVIDER_ENABLED=false$/m);
    assert.match(configuration, /^INTENT_PROVIDER_ENABLED=false$/m);
    assert.match(configuration, /^ROUTE_PROVIDER_MAX_RESPONSE_BYTES=2097152$/m);
    assert.match(configuration, /^ROUTE_PROVIDER_MAX_ERROR_RESPONSE_BYTES=32768$/m);
    assert.match(configuration, /^ROUTE_PROVIDER_CIRCUIT_FAILURE_THRESHOLD=3$/m);
    assert.match(configuration, /^ROUTE_PROVIDER_CIRCUIT_OPEN_MS=30000$/m);
    assert.doesNotMatch(configuration, /^ROUTE_PROVIDER_ENABLED=true$/m);
    assert.doesNotMatch(configuration, /^INTENT_PROVIDER_ENABLED=true$/m);
  });

  it("keeps the operational JSON contracts NO_GO and coherent with the corrected parser", async () => {
    const matrix = JSON.parse(await readFile(
      new URL(
        "../../docs/operations/closed-beta-readiness-v1/feature-flag-state-matrix-v1.json",
        import.meta.url
      ),
      "utf8"
    ));
    const checklist = JSON.parse(await readFile(
      new URL(
        "../../docs/operations/closed-beta-readiness-v1/go-no-go-checklist-v1.json",
        import.meta.url
      ),
      "utf8"
    ));

    assert.equal(matrix.currentClassification, "production_off");
    assert.equal(matrix.currentDecision, "NO_GO");
    for (const id of ["backend_route_provider", "backend_intent_provider"]) {
      const flag = matrix.flags.find((candidate) => candidate.id === id);
      assert.deepEqual(flag.currentAcceptedTrueValues, ["true", "yes", "1"]);
      assert.equal(flag.trackedDefault, false);
      assert.equal(flag.missingOrMalformedEffectiveValue, false);
      assert.equal(flag.currentContractCompliant, true);
    }

    assert.equal(checklist.currentDecision, "NO_GO");
    assert.equal(
      checklist.currentDecisionReasons.includes(
        "provider_flags_not_fail_closed_for_missing_or_malformed_values"
      ),
      false
    );
    const providerDomain = checklist.domains.find((domain) => domain.id === "domain-provider");
    const flagRequirement = providerDomain.requirements.find(
      (requirement) => requirement.id === "provider-exact-fail-closed-flags"
    );
    assert.equal(flagRequirement.currentState, "partial");
    assert.equal(flagRequirement.liveActionExecuted, false);
    assert.equal(flagRequirement.blocker.includes("default open"), false);
  });
});

function routeConfiguration(value, nodeEnv = "test") {
  const env = { NODE_ENV: nodeEnv };
  if (value !== undefined) env.ROUTE_PROVIDER_ENABLED = value;
  return routeAuthorizationConfiguration(env);
}

function intentConfiguration(value, nodeEnv = "test") {
  const env = { NODE_ENV: nodeEnv };
  if (value !== undefined) env.INTENT_PROVIDER_ENABLED = value;
  return intentAuthorizationConfiguration(env);
}

async function sessionRepository() {
  const repository = new InMemoryAppAttestRepository();
  const token = Buffer.alloc(32, 13).toString("base64url");
  await repository.createRouteSession({
    tokenHash: hashOpaqueValue(token),
    installationId: "provider-flag-test-installation",
    expiresAt: Date.now() + 120_000,
    maximumCost: 12
  });
  return { repository, token };
}

async function authorizationResult(authorizer, token) {
  try {
    const access = await authorizer.authorize({
      headers: sessionHeaders(token),
      cost: 1
    });
    await access.release();
    return { allowed: true };
  } catch (error) {
    return { allowed: false, errorCode: error.code };
  }
}

function sessionHeaders(token) {
  return {
    authorization: `TrailMindRouteSession ${token}`,
    "x-trailmind-request-id": randomUUID()
  };
}

function sessionRecord(repository, token) {
  return repository.sessions.get(hashOpaqueValue(token));
}
