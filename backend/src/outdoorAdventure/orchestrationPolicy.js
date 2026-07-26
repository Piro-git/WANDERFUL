import { routeAuthorizationConfiguration } from "../appAttest/routeSessionAuthorizer.js";
import {
  outdoorAdventureOrchestrationError
} from "./orchestrationErrors.js";

const MEBIBYTE = 1_024 * 1_024;
const LEASE_SAFETY_MARGIN_MS = 1_000;

export const OUTDOOR_ADVENTURE_ORCHESTRATION_POLICY_V1 = deepFreeze({
  schemaVersion: 1,
  policyVersion: "outdoor-adventure-orchestration-v1",
  endpointPath: "/api/outdoor-research/plan-route",
  limits: {
    maximumRequestBytes: 131_072,
    defaultRequestBytes: 65_536,
    maximumResponseBytes: 9 * MEBIBYTE,
    defaultResponseBytes: 9 * MEBIBYTE,
    maximumProposals: 6,
    defaultMaximumProposals: 3,
    maximumGraphHopperCalls: 6,
    defaultMaximumGraphHopperCalls: 3,
    maximumConcurrency: 2,
    defaultMaximumConcurrency: 2,
    authorizationCost: 12,
    defaultTotalDeadlineMs: 25_000,
    maximumTotalDeadlineMs: 45_000,
    defaultResearchTimeoutMs: 7_500,
    maximumResearchTimeoutMs: 30_000,
    defaultStatementTimeoutMs: 2_500,
    maximumStatementTimeoutMs: 15_000,
    defaultGraphHopperAttemptTimeoutMs: 8_000,
    maximumGraphHopperAttemptTimeoutMs: 30_000,
    leaseSafetyMarginMs: LEASE_SAFETY_MARGIN_MS
  }
});

export function outdoorAdventurePlanningEnabled(env = process.env) {
  const value = env?.OUTDOOR_RESEARCH_PLANNING_ENABLED;
  return typeof value === "string" &&
    ["true", "yes", "1"].includes(value.trim().toLowerCase());
}

export function outdoorAdventureInsecureLocalEnabled(env = process.env) {
  const local = env?.NODE_ENV === "development" || env?.NODE_ENV === "test";
  const value = env?.OUTDOOR_RESEARCH_PLANNING_ALLOW_INSECURE_LOCAL;
  return local && typeof value === "string" &&
    ["true", "yes", "1"].includes(value.trim().toLowerCase());
}

export function outdoorAdventureOrchestrationConfigurationV1(
  env = process.env
) {
  const limits = OUTDOOR_ADVENTURE_ORCHESTRATION_POLICY_V1.limits;
  const requestBytes = integer(
    env?.OUTDOOR_RESEARCH_PLANNING_MAX_BODY_BYTES,
    limits.defaultRequestBytes,
    4_096,
    limits.maximumRequestBytes
  );
  const responseBytes = integer(
    env?.OUTDOOR_RESEARCH_PLANNING_MAX_RESPONSE_BYTES,
    limits.defaultResponseBytes,
    262_144,
    limits.maximumResponseBytes
  );
  const maximumProposals = integer(
    env?.OUTDOOR_RESEARCH_PLANNING_MAX_PROPOSALS,
    limits.defaultMaximumProposals,
    1,
    limits.maximumProposals
  );
  const maximumGraphHopperCalls = integer(
    env?.OUTDOOR_RESEARCH_PLANNING_MAX_GRAPHHOPPER_CALLS,
    limits.defaultMaximumGraphHopperCalls,
    1,
    limits.maximumGraphHopperCalls
  );
  const maximumConcurrency = integer(
    env?.OUTDOOR_RESEARCH_PLANNING_MAX_CONCURRENCY,
    limits.defaultMaximumConcurrency,
    1,
    limits.maximumConcurrency
  );
  const authorizationCost = fixedInteger(
    env?.OUTDOOR_RESEARCH_PLANNING_REQUEST_COST,
    limits.authorizationCost
  );
  const totalDeadlineMs = integer(
    env?.OUTDOOR_RESEARCH_PLANNING_TOTAL_TIMEOUT_MS,
    limits.defaultTotalDeadlineMs,
    1_000,
    limits.maximumTotalDeadlineMs
  );
  const researchTimeoutMs = integer(
    env?.OUTDOOR_RESEARCH_PLANNING_RESEARCH_TIMEOUT_MS,
    limits.defaultResearchTimeoutMs,
    250,
    limits.maximumResearchTimeoutMs
  );
  const statementTimeoutMs = integer(
    env?.OUTDOOR_RESEARCH_PLANNING_STATEMENT_TIMEOUT_MS,
    limits.defaultStatementTimeoutMs,
    100,
    limits.maximumStatementTimeoutMs
  );
  const graphHopperAttemptTimeoutMs = integer(
    env?.OUTDOOR_RESEARCH_PLANNING_GRAPHHOPPER_TIMEOUT_MS,
    limits.defaultGraphHopperAttemptTimeoutMs,
    1_000,
    limits.maximumGraphHopperAttemptTimeoutMs
  );

  let routeAuthorization;
  try {
    routeAuthorization = routeAuthorizationConfiguration(env);
  } catch (error) {
    throw outdoorAdventureOrchestrationError("authorization_unavailable", {
      cause: error
    });
  }
  const routeSessionMaximumCost = integer(
    env?.APP_ATTEST_ROUTE_SESSION_MAX_COST,
    12,
    1,
    100
  );
  if (
    maximumProposals > maximumGraphHopperCalls ||
    maximumConcurrency > maximumGraphHopperCalls ||
    routeSessionMaximumCost < authorizationCost ||
    routeAuthorization.installationMaximumCost < authorizationCost ||
    routeAuthorization.globalMaximumCost < authorizationCost ||
    statementTimeoutMs >= researchTimeoutMs ||
    researchTimeoutMs >= totalDeadlineMs ||
    graphHopperAttemptTimeoutMs >= totalDeadlineMs ||
    totalDeadlineMs >
      routeAuthorization.leaseTtlMs - limits.leaseSafetyMarginMs
  ) {
    throw outdoorAdventureOrchestrationError("feature_unavailable");
  }

  return deepFreeze({
    requestBytes,
    responseBytes,
    maximumProposals,
    maximumGraphHopperCalls,
    maximumConcurrency,
    authorizationCost,
    totalDeadlineMs,
    researchTimeoutMs,
    statementTimeoutMs,
    graphHopperAttemptTimeoutMs,
    authorizationLeaseTtlMs: routeAuthorization.leaseTtlMs
  });
}

export function outdoorAdventureDurationBucket(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "unknown";
  if (milliseconds < 250) return "under_250ms";
  if (milliseconds < 1_000) return "250ms_to_1s";
  if (milliseconds < 5_000) return "1s_to_5s";
  if (milliseconds < 15_000) return "5s_to_15s";
  if (milliseconds < 30_000) return "15s_to_30s";
  return "30s_or_more";
}

function integer(value, fallback, minimum, maximum) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw outdoorAdventureOrchestrationError("feature_unavailable");
  }
  return number;
}

function fixedInteger(value, expected) {
  if (value === undefined || value === "") return expected;
  const number = Number(value);
  if (!Number.isInteger(number) || number !== expected) {
    throw outdoorAdventureOrchestrationError("feature_unavailable");
  }
  return number;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
