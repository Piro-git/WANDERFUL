const policy = {
  schemaVersion: 2,
  policyVersion: "research-guided-route-candidates-v2",
  sourceCandidatePlanPolicyVersion: "research-guided-route-candidates-v1",
  trailAccessPolicyVersion: "research-trail-access-candidates-v1",
  limits: {
    maximumPlanBytes: 2 * 1_024 * 1_024,
    maximumOptionsBytes: 1_024,
    maximumProposals: 6,
    maximumSelectedHighlightsPerProposal: 5,
    maximumAccessShortfalls: 64,
    maximumStringItems: 64
  },
  hardRoles: ["must_have", "facility_candidate", "overnight_candidate"],
  optionalRoles: ["preferred", "available_candidate"],
  accessShortfallCodes: [
    "required_access_candidate_unavailable",
    "optional_access_candidate_unavailable",
    "optional_removed_for_target_distance",
    "optional_near_duplicate_access_candidate",
    "optional_same_mapped_corridor_risk"
  ],
  knownLimitations: [
    "access_candidate_unavailable",
    "optional_access_removed",
    "material_required_detour",
    "required_backtracking_risk",
    "provider_verification_required"
  ],
  distanceAnalysisStates: [
    "target_unspecified",
    "not_ruled_out",
    "lower_bound_exceeds_target",
    "material_required_detour"
  ],
  backtrackingRiskStates: ["none", "required_mapped_corridor_risk"],
  detour: {
    materialRequiredTargetExcessRatio: 0.15
  },
  backtracking: {
    nearDuplicateAccessMeters: 50,
    sameMappedSegmentMeters: 250
  }
};

export const RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V2 = deepFreeze(policy);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
