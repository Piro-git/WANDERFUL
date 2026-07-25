const policy = {
  schemaVersion: 1,
  policyVersion: "research-guided-routing-adapter-v1",
  sourceCandidatePlanPolicyVersion: "research-guided-route-candidates-v1",
  limits: {
    maximumEnvelopeBytes: 8 * 1_024 * 1_024,
    maximumProposals: 6,
    maximumPathsPerAttempt: 3,
    maximumCoordinatesPerPath: 100_000,
    maximumInstructionsPerPath: 25_000,
    maximumPathDetailsPerPath: 100_000,
    maximumSelectedWaypoints: 5,
    maximumMappedNetworkCandidates: 8,
    maximumEvidenceClaimIds: 64,
    maximumVerificationCodes: 32,
    maximumKnownLimitations: 32,
    maximumStringLength: 512,
    maximumAbsoluteElevationMeters: 100_000,
    maximumRouteDistanceMeters: 1_000_000,
    maximumRouteDurationMilliseconds: 30 * 24 * 60 * 60 * 1_000,
    maximumConcurrency: 2,
    defaultOperationTimeoutMilliseconds: 30_000,
    maximumOperationTimeoutMilliseconds: 60_000,
    waypointVisitToleranceMeters: 100
  },
  states: ["routed", "partial", "no_viable_route", "unsupported"],
  attemptStates: ["routed", "failed", "unsupported"],
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
    "snapping_unavailable",
    "snapping_exceeds_tolerance",
    "provider_failure",
    "route_type_unsupported",
    "candidate_plan_unsupported",
    "candidate_plan_not_routable"
  ]
};

export const RESEARCH_GUIDED_ROUTED_ALTERNATIVES_POLICY_V1 =
  deepFreeze(policy);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
