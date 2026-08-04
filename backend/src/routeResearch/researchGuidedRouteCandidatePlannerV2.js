import { createHash } from "node:crypto";
import {
  buildResearchGuidedRouteCandidatePlanV1
} from "./researchGuidedRouteCandidatePlanner.js";
import {
  validateResearchGuidedRouteCandidatePlanV1
} from "./validation.js";
import {
  validateResearchTrailAccessResolutionV1
} from "./trailAccessCandidateContract.js";
import {
  RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V2
} from "./researchGuidedRouteCandidatePolicyV2.js";

const POLICY = RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V2;

export function buildResearchGuidedRouteCandidatePlanV2(
  dossier,
  trailAccessResolution,
  options = {}
) {
  const settings = validateOptions(options);
  const sourcePlan = buildResearchGuidedRouteCandidatePlanV1(dossier, {
    maximumProposals: settings.maximumProposals
  });
  const resolution = validateResearchTrailAccessResolutionV1(
    trailAccessResolution
  );
  return materializePlan(sourcePlan, resolution);
}

export function validateResearchGuidedRouteCandidatePlanV2(input) {
  try {
    enforceBytes(input);
    const value = strictObject(input, [
      "schemaVersion",
      "state",
      "normalizedIntent",
      "anchor",
      "sourcePlan",
      "trailAccessResolution",
      "proposals",
      "accessShortfalls",
      "knownLimitations",
      "policyVersion"
    ]);
    if (
      value.schemaVersion !== POLICY.schemaVersion ||
      value.policyVersion !== POLICY.policyVersion
    ) {
      invalid();
    }
    const sourcePlan = validateResearchGuidedRouteCandidatePlanV1(
      value.sourcePlan
    );
    const resolution = validateResearchTrailAccessResolutionV1(
      value.trailAccessResolution
    );
    const expected = materializePlan(sourcePlan, resolution);
    if (canonical(value) !== canonical(expected)) invalid();
    return expected;
  } catch {
    throw new TypeError("invalid ResearchGuidedRouteCandidatePlanV2");
  }
}

export function serializeResearchGuidedRouteCandidatePlanV2(input) {
  return canonical(validateResearchGuidedRouteCandidatePlanV2(input));
}

export function validateResearchGuidedRouteCandidatePlanV2ForResearch(
  input,
  dossier,
  trailAccessResolution,
  options = {}
) {
  const settings = validateOptions(options);
  const plan = validateResearchGuidedRouteCandidatePlanV2(input);
  const expectedSourcePlan = buildResearchGuidedRouteCandidatePlanV1(
    dossier,
    { maximumProposals: settings.maximumProposals }
  );
  const expectedResolution = validateResearchTrailAccessResolutionV1(
    trailAccessResolution
  );
  if (
    canonical(plan.sourcePlan) !== canonical(expectedSourcePlan) ||
    canonical(plan.trailAccessResolution) !== canonical(expectedResolution)
  ) {
    throw new TypeError(
      "ResearchGuidedRouteCandidatePlanV2 does not match research snapshot"
    );
  }
  return plan;
}

export function deriveResearchGuidedRouteProposalIdV2(input) {
  const identity = {
    policyVersion: POLICY.policyVersion,
    normalizedIntent: identityValue(input.normalizedIntent),
    sourceProposalId: input.sourceProposalId,
    strategy: input.strategy,
    orderedSelection: input.selectedHighlights.map((item) => ({
      entityId: item.entityId,
      evidenceCoordinate: fixedCoordinate(item.evidenceCoordinate),
      routingCoordinate: fixedCoordinate(item.routingCoordinate),
      accessCandidateId: item.trailAccessCandidate.candidateId,
      role: item.role
    })),
    mappedNetworkEntityIds: input.mappedNetworkCandidates.map(
      (item) => item.entityId
    )
  };
  return `rrcpv2_${createHash("sha256")
    .update(canonical(identity))
    .digest("hex")
    .slice(0, 32)}`;
}

function identityValue(value) {
  if (Array.isArray(value)) return value.map(identityValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, identityValue(child)])
    );
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid();
    return value.toFixed(7);
  }
  return value;
}

function materializePlan(sourcePlanInput, resolutionInput) {
  const sourcePlan = validateResearchGuidedRouteCandidatePlanV1(
    sourcePlanInput
  );
  const resolution = validateResearchTrailAccessResolutionV1(
    resolutionInput
  );
  assertResolutionMatchesSourcePlan(sourcePlan, resolution);
  const candidatesByEntity = groupAccessCandidates(resolution.candidates);
  const rawProposals = [];
  const shortfallRecords = [];

  for (const sourceProposal of sourcePlan.proposals) {
    const prepared = [];
    let requiredMissing = false;
    for (const via of sourceProposal.viaCandidates) {
      const accessCandidate = candidatesByEntity.get(via.entityId)?.[0];
      if (!accessCandidate) {
        const hard = isHardRole(via.role);
        shortfallRecords.push(shortfall(
          via,
          hard
            ? "required_access_candidate_unavailable"
            : "optional_access_candidate_unavailable",
          sourceProposal.proposalId,
          ["access_candidate_unavailable"]
        ));
        if (hard) requiredMissing = true;
        continue;
      }
      prepared.push(materializeHighlight(via, accessCandidate));
    }
    if (requiredMissing || prepared.length === 0) continue;

    const backtracking = applyBacktrackingGuard(
      prepared,
      sourceProposal.proposalId,
      shortfallRecords
    );
    const distanceGuarded = applyDistanceGuard(
      sourcePlan.anchor.coordinate,
      backtracking.selected,
      sourcePlan.normalizedIntent.distanceRangeKm,
      sourceProposal.proposalId,
      shortfallRecords
    );
    if (distanceGuarded.selected.length === 0) continue;

    const distanceAnalysis = distanceAnalysisFor(
      sourcePlan.anchor.coordinate,
      distanceGuarded.selected,
      sourcePlan.normalizedIntent.distanceRangeKm
    );
    const requiredRiskEntityIds = backtracking.requiredRiskEntityIds
      .filter((entityId) =>
        distanceGuarded.selected.some((item) => item.entityId === entityId)
      )
      .sort(compareText);
    const backtrackingRisk = {
      state: requiredRiskEntityIds.length > 0
        ? "required_mapped_corridor_risk"
        : "none",
      riskyEntityIds: requiredRiskEntityIds
    };
    const knownLimitations = orderedUnique([
      ...sourceProposal.knownLimitations,
      ...distanceGuarded.selected.flatMap(
        (item) => item.trailAccessCandidate.knownLimitations
      ),
      "provider_verification_required",
      ...(distanceAnalysis.state === "material_required_detour"
        ? ["material_required_detour"]
        : []),
      ...(backtrackingRisk.state === "required_mapped_corridor_risk"
        ? ["required_backtracking_risk"]
        : [])
    ]);
    const requiredVerification = orderedUnique([
      ...sourceProposal.requiredVerification,
      ...distanceGuarded.selected.flatMap(
        (item) => item.trailAccessCandidate.requiredVerification
      )
    ]);
    const evidenceClaimIds = orderedUnique([
      ...sourceProposal.evidenceClaimIds,
      ...distanceGuarded.selected.flatMap(
        (item) =>
          item.trailAccessCandidate.sourceTrailCategoryEvidenceClaimIds
      )
    ]);
    const base = {
      sourceProposalId: sourceProposal.proposalId,
      strategy: sourceProposal.strategy,
      activity: sourceProposal.activity,
      routeType: sourceProposal.routeType,
      selectedHighlights: distanceGuarded.selected,
      mappedNetworkCandidates: sourceProposal.mappedNetworkCandidates,
      distanceAnalysis,
      backtrackingRisk,
      evidenceClaimIds,
      requiredVerification,
      knownLimitations
    };
    rawProposals.push({
      proposalId: deriveResearchGuidedRouteProposalIdV2({
        normalizedIntent: sourcePlan.normalizedIntent,
        ...base
      }),
      ...base
    });
  }

  const proposalsById = new Map();
  for (const proposal of rawProposals) {
    if (!proposalsById.has(proposal.proposalId)) {
      proposalsById.set(proposal.proposalId, proposal);
    }
  }
  const proposals = [...proposalsById.values()].slice(
    0,
    POLICY.limits.maximumProposals
  );
  const accessShortfalls = aggregateShortfalls(shortfallRecords);
  const hasRequiredShortfall = accessShortfalls.some((item) =>
    item.code === "required_access_candidate_unavailable"
  );
  const hasRequiredRisk = proposals.some((item) =>
    item.backtrackingRisk.state === "required_mapped_corridor_risk" ||
    item.distanceAnalysis.state === "material_required_detour"
  );
  let state;
  if (["unsupported", "insufficient_evidence"].includes(sourcePlan.state)) {
    state = sourcePlan.state;
  } else if (proposals.length === 0) {
    state = "insufficient_evidence";
  } else if (
    sourcePlan.state === "partial" ||
    hasRequiredShortfall ||
    hasRequiredRisk
  ) {
    state = "partial";
  } else {
    state = "ready";
  }
  const knownLimitations = orderedUnique([
    ...proposals.flatMap((item) => item.knownLimitations),
    ...accessShortfalls.flatMap((item) => item.knownLimitations)
  ]);
  const result = {
    schemaVersion: POLICY.schemaVersion,
    state,
    normalizedIntent: sourcePlan.normalizedIntent,
    anchor: sourcePlan.anchor,
    sourcePlan,
    trailAccessResolution: resolution,
    proposals,
    accessShortfalls,
    knownLimitations,
    policyVersion: POLICY.policyVersion
  };
  enforceBytes(result);
  return deepFreeze(result);
}

function assertResolutionMatchesSourcePlan(sourcePlan, resolution) {
  const dossierCandidates = new Map();
  for (const proposal of sourcePlan.proposals) {
    for (const candidate of proposal.viaCandidates) {
      const identity = {
        entityId: candidate.entityId,
        highlightCategory: candidate.highlightCategory,
        evidenceCoordinate: candidate.coordinate
      };
      const prior = dossierCandidates.get(candidate.entityId);
      if (prior && canonical(prior) !== canonical(identity)) invalid();
      dossierCandidates.set(candidate.entityId, identity);
    }
  }
  const requested = new Map(
    resolution.requestedHighlights.map((item) => [item.entityId, item])
  );
  for (const [entityId, candidate] of dossierCandidates) {
    const accessRequest = requested.get(entityId);
    if (
      !accessRequest ||
      accessRequest.highlightCategory !== candidate.highlightCategory ||
      canonical(accessRequest.evidenceCoordinate) !==
        canonical(candidate.evidenceCoordinate)
    ) {
      invalid();
    }
  }
}

function groupAccessCandidates(candidates) {
  const grouped = new Map();
  for (const candidate of candidates) {
    if (!grouped.has(candidate.originalHighlightEntityId)) {
      grouped.set(candidate.originalHighlightEntityId, []);
    }
    grouped.get(candidate.originalHighlightEntityId).push(candidate);
  }
  for (const values of grouped.values()) {
    values.sort((left, right) =>
      left.poiToAccessPointDistanceMeters -
        right.poiToAccessPointDistanceMeters ||
      compareText(
        left.sourceTrailSegmentEntityId,
        right.sourceTrailSegmentEntityId
      ) ||
      compareText(left.candidateId, right.candidateId)
    );
  }
  return grouped;
}

function materializeHighlight(via, accessCandidate) {
  if (
    via.entityId !== accessCandidate.originalHighlightEntityId ||
    via.highlightCategory !== accessCandidate.highlightCategory ||
    canonical(via.coordinate) !== canonical(accessCandidate.evidenceCoordinate)
  ) {
    invalid();
  }
  return {
    entityId: via.entityId,
    highlightCategory: via.highlightCategory,
    role: via.role,
    evidenceCoordinate: via.coordinate,
    routingCoordinate: accessCandidate.routingCoordinate,
    trailAccessCandidate: accessCandidate,
    evidenceClaimIds: via.evidenceClaimIds,
    selectionReasons: via.selectionReasons,
    requiredVerification: via.requiredVerification,
    knownLimitations: via.knownLimitations
  };
}

function applyBacktrackingGuard(selected, sourceProposalId, shortfalls) {
  const kept = [];
  const requiredRiskEntityIds = new Set();
  for (const candidate of selected) {
    const conflict = kept.find((existing) => {
      const distance = haversineKm(
        existing.routingCoordinate,
        candidate.routingCoordinate
      ) * 1_000;
      return distance <= POLICY.backtracking.nearDuplicateAccessMeters ||
        (
          existing.trailAccessCandidate.sourceTrailSegmentEntityId ===
            candidate.trailAccessCandidate.sourceTrailSegmentEntityId &&
          distance <= POLICY.backtracking.sameMappedSegmentMeters
        );
    });
    if (!conflict) {
      kept.push(candidate);
      continue;
    }
    if (!isHardRole(candidate.role)) {
      const distance = haversineKm(
        conflict.routingCoordinate,
        candidate.routingCoordinate
      ) * 1_000;
      shortfalls.push(shortfall(
        candidate,
        distance <= POLICY.backtracking.nearDuplicateAccessMeters
          ? "optional_near_duplicate_access_candidate"
          : "optional_same_mapped_corridor_risk",
        sourceProposalId,
        ["optional_access_removed"]
      ));
      continue;
    }
    if (isHardRole(conflict.role)) {
      requiredRiskEntityIds.add(conflict.entityId);
      requiredRiskEntityIds.add(candidate.entityId);
      kept.push(candidate);
      continue;
    }
    const conflictIndex = kept.indexOf(conflict);
    kept.splice(conflictIndex, 1, candidate);
    shortfalls.push(shortfall(
      conflict,
      "optional_same_mapped_corridor_risk",
      sourceProposalId,
      ["optional_access_removed"]
    ));
  }
  return { selected: kept, requiredRiskEntityIds: [...requiredRiskEntityIds] };
}

function applyDistanceGuard(
  anchor,
  selectedInput,
  targetRange,
  sourceProposalId,
  shortfalls
) {
  const selected = [...selectedInput];
  if (targetRange === null) return { selected };
  while (lowerBoundKm(anchor, selected) > targetRange.max) {
    const removable = selected
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !isHardRole(item.role));
    if (removable.length === 0) break;
    const current = lowerBoundKm(anchor, selected);
    removable.sort((left, right) => {
      const leftReduction = current - lowerBoundKm(
        anchor,
        selected.filter((_, index) => index !== left.index)
      );
      const rightReduction = current - lowerBoundKm(
        anchor,
        selected.filter((_, index) => index !== right.index)
      );
      return rightReduction - leftReduction ||
        compareText(left.item.entityId, right.item.entityId);
    });
    const removed = selected.splice(removable[0].index, 1)[0];
    shortfalls.push(shortfall(
      removed,
      "optional_removed_for_target_distance",
      sourceProposalId,
      ["optional_access_removed"]
    ));
  }
  return { selected };
}

function distanceAnalysisFor(anchor, selected, targetRange) {
  const value = roundDistance(lowerBoundKm(anchor, selected));
  let state;
  if (targetRange === null) {
    state = "target_unspecified";
  } else if (
    value > targetRange.max *
      (1 + POLICY.detour.materialRequiredTargetExcessRatio) &&
    selected.every((item) => isHardRole(item.role))
  ) {
    state = "material_required_detour";
  } else if (value > targetRange.max) {
    state = "lower_bound_exceeds_target";
  } else {
    state = "not_ruled_out";
  }
  return {
    kind: "straight_line_lower_bound",
    lowerBoundKm: value,
    targetRangeKm: targetRange,
    state,
    materialRequiredTargetExcessRatio:
      POLICY.detour.materialRequiredTargetExcessRatio,
    limitationCode: "requires_real_routing"
  };
}

function lowerBoundKm(anchor, selected) {
  let result = 0;
  let previous = anchor;
  for (const item of selected) {
    result += haversineKm(previous, item.routingCoordinate);
    previous = item.routingCoordinate;
  }
  if (selected.length > 0) result += haversineKm(previous, anchor);
  return result;
}

function shortfall(candidate, code, sourceProposalId, knownLimitations) {
  return {
    entityId: candidate.entityId,
    highlightCategory: candidate.highlightCategory,
    role: candidate.role,
    evidenceCoordinate:
      candidate.evidenceCoordinate ?? candidate.coordinate,
    code,
    sourceProposalIds: [sourceProposalId],
    knownLimitations
  };
}

function aggregateShortfalls(items) {
  const grouped = new Map();
  for (const item of items) {
    const key = [
      item.entityId,
      item.highlightCategory,
      item.role,
      item.code
    ].join(":");
    const prior = grouped.get(key);
    if (!prior) {
      grouped.set(key, { ...item });
      continue;
    }
    prior.sourceProposalIds = orderedUnique([
      ...prior.sourceProposalIds,
      ...item.sourceProposalIds
    ]);
    prior.knownLimitations = orderedUnique([
      ...prior.knownLimitations,
      ...item.knownLimitations
    ]);
  }
  return [...grouped.values()].sort((left, right) =>
    compareText(left.entityId, right.entityId) ||
    compareText(left.code, right.code) ||
    compareText(left.role, right.role)
  ).slice(0, POLICY.limits.maximumAccessShortfalls);
}

function isHardRole(role) {
  return POLICY.hardRoles.includes(role);
}

function validateOptions(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => key !== "maximumProposals") ||
    Buffer.byteLength(JSON.stringify(input), "utf8") >
      POLICY.limits.maximumOptionsBytes
  ) {
    invalid();
  }
  const maximumProposals = input.maximumProposals ??
    POLICY.limits.maximumProposals;
  if (
    !Number.isInteger(maximumProposals) ||
    maximumProposals < 1 ||
    maximumProposals > POLICY.limits.maximumProposals
  ) {
    invalid();
  }
  return { maximumProposals };
}

function haversineKm(start, finish) {
  const earthRadiusKm = 6_371;
  const radians = Math.PI / 180;
  const latitudeDelta = (finish.latitude - start.latitude) * radians;
  const longitudeDelta = (finish.longitude - start.longitude) * radians;
  const startLatitude = start.latitude * radians;
  const finishLatitude = finish.latitude * radians;
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(finishLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 *
    Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}

function fixedCoordinate(input) {
  return {
    latitude: Number(input.latitude).toFixed(7),
    longitude: Number(input.longitude).toFixed(7)
  };
}

function roundDistance(value) {
  return Number(value.toFixed(3));
}

function orderedUnique(values) {
  return [...new Set(values)].sort(compareText);
}

function strictObject(input, fields) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid();
  const keys = Object.keys(input);
  if (
    keys.length !== fields.length ||
    keys.some((key) => !fields.includes(key)) ||
    fields.some((field) => !Object.hasOwn(input, field))
  ) {
    invalid();
  }
  return input;
}

function enforceBytes(input) {
  let serialized;
  try {
    serialized = JSON.stringify(input);
  } catch {
    invalid();
  }
  if (
    typeof serialized !== "string" ||
    Buffer.byteLength(serialized, "utf8") > POLICY.limits.maximumPlanBytes
  ) {
    invalid();
  }
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

function invalid() {
  throw new TypeError("invalid ResearchGuidedRouteCandidatePlanV2");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
