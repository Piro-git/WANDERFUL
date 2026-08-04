const policy = {
  schemaVersion: 1,
  policyVersion: "research-trail-access-candidates-v1",
  derivationAlgorithm: "postgis-st-closest-point-v1",
  maximumPoiToTrailDistanceMeters: 75,
  limits: {
    maximumResolutionBytes: 512 * 1_024,
    maximumCandidateBytes: 16 * 1_024,
    maximumRequestedHighlights: 32,
    maximumCandidatesPerHighlight: 3,
    maximumCandidates: 96,
    maximumTrailEvidenceClaimIds: 8,
    maximumKnownLimitations: 8,
    maximumRequiredVerification: 8,
    maximumStringLength: 160,
    maximumOperationalRegionIdLength: 80,
    coordinateDistanceToleranceMeters: 0.75
  },
  highlightCategories: [
    "viewpoint",
    "waterfall",
    "peak",
    "lake",
    "alpine_hut",
    "wilderness_hut",
    "landmark"
  ],
  eligibleHighwayClasses: [
    "path",
    "footway",
    "track",
    "steps",
    "bridleway",
    "pedestrian"
  ],
  lifecycleStates: ["current"],
  accessCandidateStates: ["candidate"],
  freshnessStates: ["current"],
  knownLimitations: [
    "mapped_trail_only",
    "provider_connectivity_unverified",
    "provider_access_unverified",
    "public_access_unverified"
  ],
  requiredVerification: [
    "provider_routing_required",
    "provider_snap_required",
    "route_geometry_approach_required",
    "public_access_required"
  ],
  shortfallCodes: [
    "no_eligible_mapped_trail_within_radius",
    "inconsistent_highlight_projection"
  ]
};

export const RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1 =
  deepFreeze(policy);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
