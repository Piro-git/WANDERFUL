import { createHash } from "node:crypto";
import { RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V1 } from "./policy.js";

const POLICY = RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V1;
const BASE_ROUTING_VERIFICATION = [
  "real_routing_required",
  "connectivity_required",
  "actual_distance_required",
  "actual_duration_required",
  "actual_elevation_required"
];

const HIGH_STAKES_VERIFICATION = new Set([
    "public_access_required",
    "access_restriction_required",
    "closure_status_required",
    "opening_status_required",
    "seasonal_operation_required",
    "overnight_permission_required",
    "booking_required",
    "water_status_required",
    "current_conditions_required",
    "transport_required",
    "mobility_suitability_required",
    "child_suitability_required",
    "beginner_suitability_required",
    "official_status_required",
    "legal_sleep_required"
  ]);

const PLAN_BLOCKER_GAPS = new Set(["dossier_freshness_not_current"]);

export function canonicalizeResearchGuidedRouteIntentV1(intent) {
  return {
    ...intent,
    mustHaveExperiences: [...intent.mustHaveExperiences].sort(
      (left, right) =>
        compareText(left.experience, right.experience) ||
        left.minimumCount - right.minimumCount
    ),
    preferredExperiences: [...intent.preferredExperiences].sort(compareText),
    avoidedExperiences: [...intent.avoidedExperiences].sort(compareText),
    requiredFacilities: [...intent.requiredFacilities].sort(compareText),
    overnightRequirements: {
      ...intent.overnightRequirements,
      allowedAccommodationTypes: [
        ...intent.overnightRequirements.allowedAccommodationTypes
      ].sort(compareText)
    },
    unresolvedClarificationQuestions: [
      ...intent.unresolvedClarificationQuestions
    ].sort(
      (left, right) =>
        compareText(left.code, right.code) ||
        compareText(left.field, right.field)
    )
  };
}

export function deriveResearchGuidedRouteProposalIdV1({
  normalizedIntent,
  viaEntityIds,
  mappedNetworkEntityIds,
  strategy
}) {
  const identity = canonical({
    policyVersion: POLICY.policyVersion,
    normalizedIntent: canonicalizeResearchGuidedRouteIntentV1(
      normalizedIntent
    ),
    viaEntityIds: uniqueOrdered(viaEntityIds),
    mappedNetworkEntityIds: uniqueOrdered(mappedNetworkEntityIds),
    strategy
  });
  return `rrcpv1_${createHash("sha256")
    .update(identity)
    .digest("hex")
    .slice(0, 32)}`;
}

export function aggregateResearchGuidedRouteRequirementsV1(
  items,
  mode
) {
  const grouped = new Map();
  for (const item of items) {
    const key = `${item.requirementType}:${item.value}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  const selected = [];
  for (const candidates of grouped.values()) {
    candidates.sort((left, right) =>
      compareRequirementPriority(left, right, mode)
    );
    selected.push(candidates[0]);
  }
  return selected.sort(compareRequirements);
}

export function aggregateResearchGuidedRouteVerificationV1(proposals) {
  return ordered(
    proposals.flatMap((proposal) => proposal.requiredVerification),
    POLICY.verificationCodes
  );
}

export function deriveResearchGuidedRouteProposalVerificationV1(
  intent,
  viaCandidates,
  mappedNetworkCandidates
) {
  return ordered([
    ...BASE_ROUTING_VERIFICATION,
    ...viaCandidates.flatMap(
      (candidate) => candidate.requiredVerification
    ),
    ...mappedNetworkCandidates.flatMap(
      (candidate) => candidate.requiredVerification
    ),
    ...(intent.routeType === "point_to_point"
      ? ["endpoint_coordinate_required"]
      : []),
    ...(intent.maximumElevationGainMeters !== null
      ? ["actual_elevation_required"]
      : []),
    ...requestVerification(intent)
  ], POLICY.verificationCodes);
}

export function researchGuidedRouteProposalMeetsReadyConditionV1(proposal) {
  return (
    proposal.unsatisfiedRequirements.length === 0 &&
    !proposal.requiredVerification.some((code) =>
      isResearchGuidedRouteHighStakesVerificationV1(code)
    )
  );
}

export function isResearchGuidedRouteHighStakesVerificationV1(code) {
  return HIGH_STAKES_VERIFICATION.has(code);
}

export function deriveResearchGuidedRoutePlanStateV1(
  proposals,
  evidenceGaps
) {
  if (proposals.length === 0) return null;
  const hasPlanBlocker = evidenceGaps.some((item) =>
    PLAN_BLOCKER_GAPS.has(item.code)
  );
  return (
    proposals.every(researchGuidedRouteProposalMeetsReadyConditionV1) &&
    !hasPlanBlocker
  )
    ? "ready"
    : "partial";
}

function compareRequirementPriority(left, right, mode) {
  if (mode === "maximum_shortfall") {
    return (
      right.shortfallCount - left.shortfallCount ||
      right.requestedCount - left.requestedCount ||
      left.includedCount - right.includedCount ||
      left.availableCount - right.availableCount ||
      compareText(canonical(left), canonical(right))
    );
  }
  if (mode === "maximum_included") {
    return (
      right.includedCount - left.includedCount ||
      right.requestedCount - left.requestedCount ||
      right.availableCount - left.availableCount ||
      left.shortfallCount - right.shortfallCount ||
      compareText(canonical(left), canonical(right))
    );
  }
  throw new TypeError("unsupported requirement aggregation");
}

function requestVerification(intent) {
  const verification = [];
  if (intent.maximumTechnicalDifficulty !== null) {
    verification.push("trail_difficulty_required");
  }
  if (intent.maximumElevationGainMeters !== null) {
    verification.push("actual_elevation_required");
  }
  if (intent.avoidedExperiences.includes("exposed_trails")) {
    verification.push("exposure_required");
  }
  if (intent.avoidedExperiences.includes("technical_terrain")) {
    verification.push(
      "trail_difficulty_required",
      "trail_visibility_required"
    );
  }
  if (intent.avoidedExperiences.includes("steep_climbs")) {
    verification.push("steep_climb_required");
  }
  if (intent.groupContext.experienceLevel === "beginner") {
    verification.push("beginner_suitability_required");
  }
  if (intent.groupContext.includesChildren) {
    verification.push("child_suitability_required");
  }
  if (intent.groupContext.mobility === "limited") {
    verification.push("mobility_suitability_required");
  }
  if (intent.transportRequirements.publicTransportRequired) {
    verification.push("transport_required");
  }
  if (intent.dateOrSeason !== null) {
    verification.push("current_conditions_required");
  }
  if (intent.requiredFacilities.includes("drinking_water")) {
    verification.push("water_status_required");
  }
  if (
    intent.mustHaveExperiences.some(
      (requirement) => requirement.experience === "official_hiking_route"
    )
  ) {
    verification.push("official_status_required");
  }
  return verification;
}

function compareRequirements(left, right) {
  return (
    POLICY.requirementTypes.indexOf(left.requirementType) -
      POLICY.requirementTypes.indexOf(right.requirementType) ||
    POLICY.requirementValues.indexOf(left.value) -
      POLICY.requirementValues.indexOf(right.value)
  );
}

function uniqueOrdered(values) {
  return [...new Set(values)].sort(compareText);
}

function ordered(values, vocabulary) {
  return [...new Set(values)].sort(
    (left, right) =>
      vocabulary.indexOf(left) - vocabulary.indexOf(right) ||
      compareText(left, right)
  );
}

function canonical(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort(compareText).map((key) => [
      key,
      sortKeys(value[key])
    ])
  );
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
