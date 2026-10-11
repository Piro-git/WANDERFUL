const policy = {
  schemaVersion: 1,
  policyVersion: "llm-first-route-planning-v1",
  endpointPath: "/api/llm-plan-route",
  limits: {
    maximumRequestBytes: 16_384,
    maximumResponseBytes: 4 * 1_024 * 1_024,
    maximumPromptCharacters: 1_000,
    maximumCandidates: 3,
    maximumNamedStopsPerCandidate: 3,
    maximumGeocoderResults: 5,
    maximumConcurrentGeocodes: 2,
    maximumConcurrentRoutes: 2,
    maximumGeocoderQueries: 5,
    maximumGraphHopperCalls: 4,
    defaultLLMTimeoutMs: 4_000,
    defaultGeocodeTimeoutMs: 3_000,
    defaultRouteTimeoutMs: 8_000,
    defaultTotalTimeoutMs: 25_000,
    maximumTotalTimeoutMs: 45_000,
    minimumGeocoderConfidence: 0.72,
    ambiguityConfidenceGap: 0.08,
    ambiguitySeparationMeters: 10_000,
    maximumWaypointSnapMeters: 150,
    maximumWaypointApproachMeters: 150,
    maximumLoopClosureMeters: 220,
    minimumLoopSpreadMeters: 250,
    maximumTargetDistanceDeviationRatio: 0.45,
    maximumPointToPointDetourRatio: 2.5,
    maximumLoopDetourRatio: 3.25,
    maximumPointToPointBacktrackingRatio: 0.35,
    maximumLoopBacktrackingRatio: 0.45
  }
};

export const LLM_FIRST_PLANNING_POLICY_V1 = deepFreeze(policy);

export function llmFirstPlanningEnabled(env = process.env) {
  return env?.LLM_FIRST_PLANNING_ENABLED === "true" &&
    env?.INTENT_PROVIDER_ENABLED === "true" &&
    env?.ROUTE_PROVIDER_ENABLED === "true";
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
