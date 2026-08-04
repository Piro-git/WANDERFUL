const policy = {
  schemaVersion: 2,
  policyVersion: "research-guided-routing-adapter-v2",
  sourceCandidatePlanPolicyVersion: "research-guided-route-candidates-v2",
  trailAccessPolicyVersion: "research-trail-access-candidates-v1",
  limits: {
    maximumEnvelopeBytes: 8 * 1_024 * 1_024,
    maximumProposals: 6,
    maximumPathsPerAttempt: 3,
    maximumCoordinatesPerPath: 100_000,
    maximumConcurrency: 2,
    defaultOperationTimeoutMilliseconds: 30_000,
    maximumOperationTimeoutMilliseconds: 60_000,
    providerAccessSnapToleranceMeters: 100,
    routeAccessToleranceMeters: 100,
    reachedEvidenceToleranceMeters: 25,
    passesNearEvidenceToleranceMeters: 100,
    calculationToleranceMeters: 0.75
  },
  states: ["routed", "partial", "no_viable_route", "unsupported"],
  attemptStates: ["routed", "failed", "unsupported"],
  verificationStates: ["eligible", "ineligible", "unverified"],
  approachStates: ["reached", "passes_near", "not_reached", "unverified"],
  distanceVerificationStates: [
    "target_unspecified",
    "within_target",
    "outside_target"
  ],
  failureCodes: [
    "route_not_found",
    "route_timed_out",
    "routing_unavailable",
    "routing_rate_limited",
    "invalid_provider_response",
    "invalid_route_request",
    "unsupported_point_to_point",
    "unsupported_out_and_back",
    "unsupported_candidate_plan"
  ],
  adapterLimitationCodes: [
    "provider_access_snap_unavailable",
    "provider_access_snap_exceeds_tolerance",
    "route_misses_access_coordinate",
    "selected_highlight_not_reached",
    "selected_highlight_passes_near",
    "target_distance_not_met",
    "provider_failure",
    "route_type_unsupported",
    "candidate_plan_unsupported",
    "candidate_plan_not_routable"
  ]
};

export const RESEARCH_GUIDED_ROUTED_ALTERNATIVES_POLICY_V2 =
  deepFreeze(policy);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
