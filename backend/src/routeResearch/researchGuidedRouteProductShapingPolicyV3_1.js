const policy = {
  policyVersion: "research-guided-route-product-shaping-v3.1",
  supportedRouteTypes: ["loop"],
  limits: {
    maximumSearchStates: 384,
    maximumDominanceComparisons: 384 * 384,
    maximumOptionalSubsetStates: 32,
    maximumAccessCandidatesPerEntity: 3,
    maximumAccessAssignmentsPerSelection: 11,
    maximumAccessAssignmentFrontierStates: 56,
    maximumOrderingsPerSelection: 10,
    maximumSelectedHighlightsPerProposal: 5,
    maximumProposals: 6
  },
  accessSelection: {
    minimumNormalizedTargetImprovement: 0.02,
    minimumRiskImprovement: 10
  },
  distance: {
    heuristicMinimumMultiplier: 1.15,
    heuristicMaximumMultiplier: 1.65,
    materialRequiredTargetExcessRatio: 0.15
  },
  shape: {
    collinearAreaRatio: 0.025,
    maximumRadialAngularSpreadDegrees: 20,
    nearDuplicateAccessMeters: 50,
    sameMappedSegmentMeters: 250,
    minimumExcludableOptionalRiskScore: 45
  }
};

export const RESEARCH_GUIDED_ROUTE_PRODUCT_SHAPING_POLICY_V3_1 =
  deepFreeze(policy);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
