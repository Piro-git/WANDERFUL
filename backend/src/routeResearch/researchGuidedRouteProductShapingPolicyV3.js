const policy = {
  policyVersion: "research-guided-route-product-shaping-v3",
  supportedRouteTypes: ["loop"],
  limits: {
    maximumSearchStates: 384,
    maximumDominanceComparisons: 384 * 384,
    maximumOptionalSubsetStates: 32,
    maximumAccessCandidatesPerEntity: 3,
    maximumAccessAssignmentsPerSelection: 11,
    maximumOrderingsPerSelection: 10,
    maximumSelectedHighlightsPerProposal: 5,
    maximumProposals: 6
  },
  accessSelection: {
    minimumNormalizedTargetImprovement: 0.02,
    minimumRiskImprovement: 10
  },
  distance: {
    heuristicRouteMultiplier: 1.4,
    materialRequiredTargetExcessRatio: 0.15
  },
  shape: {
    collinearAreaRatio: 0.025,
    maximumRadialAngularSpreadDegrees: 20,
    nearDuplicateAccessMeters: 50,
    sameMappedSegmentMeters: 250
  }
};

export const RESEARCH_GUIDED_ROUTE_PRODUCT_SHAPING_POLICY_V3 =
  deepFreeze(policy);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
