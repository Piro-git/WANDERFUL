import { validateAdventureResearchDossierV1 } from "../outdoorResearch/validation.js";
import { resolveValidatedEvidenceClaimsV1 } from "../outdoorResearch/evidenceResolutionCore.js";
import {
  aggregateResearchGuidedRouteRequirementsV1,
  aggregateResearchGuidedRouteVerificationV1,
  canonicalizeResearchGuidedRouteIntentV1,
  deriveResearchGuidedRoutePlanStateV1,
  deriveResearchGuidedRouteProposalIdV1,
  deriveResearchGuidedRouteProposalVerificationV1,
  isResearchGuidedRouteHighStakesVerificationV1,
  researchGuidedRouteProposalMeetsReadyConditionV1
} from "./contractSemantics.js";
import { ResearchGuidedRouteCandidateError } from "./errors.js";
import { RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V1 } from "./policy.js";
import {
  validateResearchGuidedRouteCandidatePlanV1
} from "./validation.js";

const POLICY = RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V1;
const HUT_CATEGORIES = new Set(["alpine_hut", "wilderness_hut"]);
const CONDITIONAL_ACCESS_RESTRICTIONS = new Set([
  "restricted",
  "conditional",
  "permit_required"
]);
const CANDIDATE_DECISION_PREDICATES = [
  "entity_category",
  "public_access",
  "access_restriction",
  "closure_status",
  "trail_difficulty",
  "trail_visibility",
  "current_opening",
  "seasonal_opening",
  "overnight_permission",
  "bookability",
  "drinking_water_availability",
  "viewpoint_presence",
  "waterfall_presence",
  "mapped_hiking_route_membership"
];
export function buildResearchGuidedRouteCandidatePlanV1(
  dossierInput,
  optionsInput = {}
) {
  const dossier = validatedDossier(dossierInput);
  const options = validatedOptions(optionsInput);
  assertPolicyConsistency();
  const normalizedIntent = canonicalizeResearchGuidedRouteIntentV1(
    dossier.normalizedIntent
  );
  const canonicalDossier = canonicalizeDossier(dossier, normalizedIntent);

  if (!POLICY.supportedActivities.includes(normalizedIntent.activity)) {
    return validatedPlan({
      schemaVersion: 1,
      state: "unsupported",
      normalizedIntent,
      anchor: normalizedIntent.geographicAnchor,
      proposals: [],
      unmetRequirements: [],
      requiredVerification: [],
      evidenceGaps: [gap("unsupported_activity")],
      policyVersion: POLICY.policyVersion
    });
  }

  if (normalizedIntent.geographicAnchor.state !== "resolved") {
    return validatedPlan({
      schemaVersion: 1,
      state: "unsupported",
      normalizedIntent,
      anchor: normalizedIntent.geographicAnchor,
      proposals: [],
      unmetRequirements: [],
      requiredVerification: [],
      evidenceGaps: [gap("unresolved_geography")],
      policyVersion: POLICY.policyVersion
    });
  }

  if (canonicalDossier.regionCoverage.state === "unsupported") {
    return validatedPlan({
      schemaVersion: 1,
      state: "unsupported",
      normalizedIntent,
      anchor: normalizedIntent.geographicAnchor,
      proposals: [],
      unmetRequirements: [],
      requiredVerification: [],
      evidenceGaps: normalizeGaps([
        ...dossierGaps(canonicalDossier),
        gap("unsupported_region")
      ]),
      policyVersion: POLICY.policyVersion
    });
  }

  const context = createContext(canonicalDossier);
  const prepared = prepareCandidates(context);
  context.usableCandidates = prepared.usable;
  const mappedNetworkPreparation = prepareMappedNetworkCandidates(context);

  if (prepared.usable.length === 0) {
    return validatedPlan({
      schemaVersion: 1,
      state: "insufficient_evidence",
      normalizedIntent,
      anchor: normalizedIntent.geographicAnchor,
      proposals: [],
      unmetRequirements: [],
      requiredVerification: [],
      evidenceGaps: normalizeGaps([
        ...dossierGaps(canonicalDossier),
        ...prepared.excludedGaps,
        gap("no_usable_candidates")
      ]),
      policyVersion: POLICY.policyVersion
    });
  }

  const candidateSets = exploreCandidateSets(context, prepared.usable);
  if (candidateSets.length === 0) {
    return validatedPlan({
      schemaVersion: 1,
      state: "insufficient_evidence",
      normalizedIntent,
      anchor: normalizedIntent.geographicAnchor,
      proposals: [],
      unmetRequirements: [],
      requiredVerification: [],
      evidenceGaps: normalizeGaps([
        ...dossierGaps(canonicalDossier),
        ...prepared.excludedGaps,
        gap("no_usable_candidates")
      ]),
      policyVersion: POLICY.policyVersion
    });
  }

  const proposalRecords = candidateSets.map((candidateSet) =>
    buildProposalRecord(
      context,
      candidateSet,
      mappedNetworkPreparation.usable
    )
  );
  const maximumMustHaveSatisfaction = Math.max(
    ...proposalRecords.map((record) => record.metrics.mustHaveIncluded)
  );
  const orderedRecords = proposalRecords
    .filter((record) =>
      record.metrics.mustHaveIncluded === maximumMustHaveSatisfaction
    )
    .sort(compareProposalRecords);
  const diverseRecords = selectDiverseRecords(
    orderedRecords,
    options.maximumProposals
  );
  const proposals = diverseRecords.map((record) => record.proposal);

  const unmetRequirements = aggregateResearchGuidedRouteRequirementsV1(
    proposals.flatMap((proposal) => proposal.unsatisfiedRequirements),
    "maximum_shortfall"
  );
  const requiredVerification = aggregateResearchGuidedRouteVerificationV1(
    proposals
  );
  const generatedGaps = [
    ...prepared.excludedGaps,
    ...mappedNetworkPreparation.excludedGaps,
    ...diverseRecords.flatMap((record) => record.gaps)
  ];
  const evidenceGaps = normalizeGaps([
    ...dossierGaps(canonicalDossier),
    ...generatedGaps
  ]);
  const state = deriveResearchGuidedRoutePlanStateV1(
    proposals,
    evidenceGaps
  );

  return validatedPlan({
    schemaVersion: 1,
    state,
    normalizedIntent,
    anchor: normalizedIntent.geographicAnchor,
    proposals,
    unmetRequirements,
    requiredVerification,
    evidenceGaps,
    policyVersion: POLICY.policyVersion
  });
}

function validatedDossier(input) {
  try {
    return validateAdventureResearchDossierV1(input);
  } catch {
    throw new ResearchGuidedRouteCandidateError("invalid_dossier");
  }
}

function validatedOptions(input) {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("options");
    }
    const serialized = JSON.stringify(input);
    if (
      serialized === undefined ||
      Buffer.byteLength(serialized, "utf8") >
        POLICY.limits.maximumOptionsBytes ||
      Object.keys(input).some((key) => key !== "maximumProposals")
    ) {
      throw new TypeError("options");
    }
    const maximumProposals =
      input.maximumProposals ?? POLICY.limits.maximumProposals;
    if (
      !Number.isInteger(maximumProposals) ||
      maximumProposals < 1 ||
      maximumProposals > POLICY.limits.maximumProposals
    ) {
      throw new TypeError("options");
    }
    return Object.freeze({ maximumProposals });
  } catch {
    throw new ResearchGuidedRouteCandidateError("invalid_options");
  }
}

function assertPolicyConsistency() {
  if (
    !Object.isFrozen(POLICY) ||
    !Object.isFrozen(POLICY.limits) ||
    POLICY.schemaVersion !== 1 ||
    POLICY.limits.maximumProposals < 1 ||
    POLICY.limits.maximumViaCandidatesPerProposal < 1 ||
    POLICY.limits.maximumExploredCombinations < POLICY.limits.maximumProposals ||
    POLICY.preliminaryDistance.heuristicMinimumMultiplier < 1 ||
    POLICY.preliminaryDistance.heuristicMaximumMultiplier <
      POLICY.preliminaryDistance.heuristicMinimumMultiplier
  ) {
    throw new ResearchGuidedRouteCandidateError("policy_inconsistent");
  }
}

function canonicalizeDossier(dossier, normalizedIntent) {
  return {
    ...dossier,
    normalizedIntent,
    evidenceClaims: [...dossier.evidenceClaims].sort(
      (left, right) => compareText(left.claimId, right.claimId)
    ),
    candidateHighlights: dossier.candidateHighlights
      .map((candidate) => ({
        ...candidate,
        evidenceClaimIds: [...candidate.evidenceClaimIds].sort(compareText),
        knownLimitations: [...candidate.knownLimitations].sort(compareText)
      }))
      .sort((left, right) => compareText(left.entityId, right.entityId)),
    mappedOrOfficialRouteCandidates: dossier.mappedOrOfficialRouteCandidates
      .map(canonicalEntityCandidate)
      .sort((left, right) => compareText(left.entityId, right.entityId)),
    overnightCandidates: dossier.overnightCandidates
      .map(canonicalEntityCandidate)
      .sort((left, right) => compareText(left.entityId, right.entityId)),
    evidenceGaps: [...dossier.evidenceGaps].sort(
      (left, right) => compareText(canonical(left), canonical(right))
    )
  };
}

function canonicalEntityCandidate(candidate) {
  return {
    ...candidate,
    evidenceClaimIds: [...candidate.evidenceClaimIds].sort(compareText),
    knownLimitations: [...candidate.knownLimitations].sort(compareText)
  };
}

function createContext(dossier) {
  const claimsByEntity = new Map();
  for (const claim of dossier.evidenceClaims) {
    if (!claimsByEntity.has(claim.entityId)) claimsByEntity.set(claim.entityId, []);
    claimsByEntity.get(claim.entityId).push(claim);
  }
  return {
    dossier,
    intent: dossier.normalizedIntent,
    claimsByEntity,
    generatedAt: dossier.generatedAt,
    anchor: dossier.normalizedIntent.geographicAnchor.coordinate,
    overnightEntityIds: new Set(
      dossier.overnightCandidates.map((candidate) => candidate.entityId)
    ),
    mappedNetworkEntityIds: new Set(
      dossier.mappedOrOfficialRouteCandidates.map(
        (candidate) => candidate.entityId
      )
    )
  };
}

function prepareCandidates(context) {
  const usable = [];
  const excludedGaps = [];
  for (const candidate of context.dossier.candidateHighlights) {
    if (
      candidate.suitabilityState === "ineligible" ||
      !hasCurrentCategoryEvidence(context, candidate)
    ) {
      excludedGaps.push(gap("no_usable_candidates", candidate.entityId));
      continue;
    }
    const exclusion = entityExclusion(context, candidate.entityId);
    if (exclusion !== null) {
      excludedGaps.push(gap(
        exclusion.gapCode,
        candidate.entityId,
        exclusion.predicate
      ));
      continue;
    }
    const evidenceClaimIds = decisionClaimIds(
      context,
      candidate.entityId,
      candidate.evidenceClaimIds
    );
    if (
      evidenceClaimIds.length >
      POLICY.limits.maximumEvidenceReferencesPerCandidate
    ) {
      excludedGaps.push(gap("no_usable_candidates", candidate.entityId));
      continue;
    }
    usable.push({
      ...candidate,
      evidenceClaimIds,
      distanceFromAnchorKm: haversineKm(context.anchor, candidate.coordinate),
      membershipRouteIds: mappedMembershipRouteIds(context, candidate.entityId)
    });
  }
  return { usable, excludedGaps };
}

function hasCurrentCategoryEvidence(context, candidate) {
  const predicates = candidate.highlightCategory === "viewpoint"
    ? ["entity_category", "viewpoint_presence"]
    : candidate.highlightCategory === "waterfall"
      ? ["entity_category", "waterfall_presence"]
      : ["entity_category"];
  for (const predicate of predicates) {
    const resolved = resolve(context, candidate.entityId, predicate);
    if (
      resolved.state === "known" &&
      (
        (
          predicate === "entity_category" &&
          resolved.value.type === "text" &&
          resolved.value.value === candidate.highlightCategory
        ) ||
        (
          predicate !== "entity_category" &&
          resolved.value.type === "boolean" &&
          resolved.value.value === true
        )
      )
    ) {
      return true;
    }
  }
  return false;
}

function entityExclusion(context, entityId) {
  const publicAccess = resolve(context, entityId, "public_access");
  if (
    publicAccess.state === "known" &&
    publicAccess.value.type === "boolean" &&
    publicAccess.value.value === false
  ) {
    return {
      gapCode: "candidate_access_denied",
      predicate: "public_access"
    };
  }
  const accessRestriction = resolve(context, entityId, "access_restriction");
  if (
    accessRestriction.state === "known" &&
    accessRestriction.value.type === "text" &&
    accessRestriction.value.value === "prohibited"
  ) {
    return {
      gapCode: "candidate_access_denied",
      predicate: "access_restriction"
    };
  }
  const closure = resolve(context, entityId, "closure_status");
  if (
    closure.state === "known" &&
    closure.value.type === "text" &&
    closure.value.value === "closed"
  ) {
    return {
      gapCode: "candidate_currently_closed",
      predicate: "closure_status"
    };
  }
  const maximum = context.intent.maximumTechnicalDifficulty;
  if (maximum !== null) {
    const difficulty = resolve(context, entityId, "trail_difficulty");
    if (
      difficulty.state === "known" &&
      difficulty.value.type === "text" &&
      difficultyIndex(difficulty.value.value) > difficultyIndex(maximum)
    ) {
      return {
        gapCode: "incompatible_difficulty",
        predicate: "trail_difficulty"
      };
    }
  }
  return null;
}

function prepareMappedNetworkCandidates(context) {
  const prepared = [];
  const excludedGaps = [];
  for (const candidate of context.dossier.mappedOrOfficialRouteCandidates) {
    const exclusion = entityExclusion(context, candidate.entityId);
    if (exclusion !== null) {
      excludedGaps.push(gap(
        exclusion.gapCode,
        candidate.entityId,
        exclusion.predicate
      ));
      continue;
    }
    const evidenceClaimIds = decisionClaimIds(
      context,
      candidate.entityId,
      candidate.evidenceClaimIds
    );
    if (
      evidenceClaimIds.length >
      POLICY.limits.maximumEvidenceReferencesPerCandidate
    ) {
      excludedGaps.push(gap("no_usable_candidates", candidate.entityId));
      continue;
    }
    const verification = [
      "connectivity_required",
      ...entityAccessVerification(context, candidate.entityId),
      ...(!knownText(context, candidate.entityId, "closure_status", "open")
        ? ["closure_status_required"]
        : []),
      "official_status_required"
    ];
    const difficulty = resolve(context, candidate.entityId, "trail_difficulty");
    if (difficulty.state !== "known") {
      verification.push("trail_difficulty_required");
    }
    prepared.push({
      entityId: candidate.entityId,
      sourceBasis: candidate.sourceBasis,
      evidenceClaimIds,
      knownLimitations: ordered([
        ...candidate.knownLimitations,
        "route_connection_unverified",
        "official_status_unverified",
        ...(candidate.sourceBasis === "mapped" ? ["mapped_presence_only"] : []),
        ...limitationsForVerification(verification)
      ], POLICY.limitationCodes),
      requiredVerification: ordered(verification, POLICY.verificationCodes)
    });
  }
  return {
    usable: prepared.slice(
      0,
      POLICY.limits.maximumMappedNetworkCandidatesPerProposal
    ),
    excludedGaps
  };
}

function exploreCandidateSets(context, usableCandidates) {
  const pools = categoryPools(usableCandidates);
  const unique = new Map();
  let explored = 0;
  const maximumRotations = Math.min(usableCandidates.length, 32);
  for (const strategy of POLICY.strategies) {
    for (let rotation = 0; rotation < maximumRotations; rotation += 1) {
      if (explored >= POLICY.limits.maximumExploredCombinations) break;
      explored += 1;
      const selected = selectCandidateSet(
        context,
        usableCandidates,
        pools,
        strategy,
        rotation
      );
      if (selected.length === 0) continue;
      const entityIds = selected.map((candidate) => candidate.entityId).sort(compareText);
      const key = entityIds.join(":");
      if (!unique.has(key)) {
        unique.set(key, { strategy, candidates: selected, entityIds });
      }
    }
  }
  return [...unique.values()];
}

function selectCandidateSet(
  context,
  usableCandidates,
  pools,
  strategy,
  rotation
) {
  const selected = [];
  const selectedIds = new Set();
  const selectedClaimIds = new Set();
  const maximum = POLICY.limits.maximumViaCandidatesPerProposal;
  const addFromPool = (pool, localOffset = 0) => {
    if (!pool || pool.length === 0 || selected.length >= maximum) return;
    const orderedPool = strategy === "minimal_preliminary_detour"
      ? [...pool].sort(
        (left, right) =>
          left.distanceFromAnchorKm - right.distanceFromAnchorKm ||
          compareText(left.entityId, right.entityId)
      )
      : pool;
    for (let index = 0; index < orderedPool.length; index += 1) {
      const candidate =
        orderedPool[(rotation + localOffset + index) % orderedPool.length];
      const combinedClaimCount = new Set([
        ...selectedClaimIds,
        ...candidate.evidenceClaimIds
      ]).size;
      if (
        !selectedIds.has(candidate.entityId) &&
        combinedClaimCount <=
          POLICY.limits.maximumEvidenceReferencesPerProposal
      ) {
        selected.push(candidate);
        selectedIds.add(candidate.entityId);
        for (const claimId of candidate.evidenceClaimIds) {
          selectedClaimIds.add(claimId);
        }
        return;
      }
    }
  };

  const overnightPool = usableCandidates.filter(
    (candidate) =>
      context.overnightEntityIds.has(candidate.entityId) &&
      context.intent.overnightRequirements.allowedAccommodationTypes.includes(
        candidate.highlightCategory
      )
  );
  const facilityPool = usableCandidates.filter((candidate) =>
    candidateMatchesAnyFacility(candidate, context.intent.requiredFacilities)
  );
  const networkLinkedPool = usableCandidates.filter((candidate) =>
    candidate.membershipRouteIds.some((entityId) =>
      context.mappedNetworkEntityIds.has(entityId)
    )
  );

  if (strategy === "overnight_candidate_first") {
    for (let index = 0; index < overnightPool.length && selected.length < maximum; index += 1) {
      addFromPool(overnightPool, index);
    }
  }
  if (strategy === "mapped_network_first") {
    addFromPool(networkLinkedPool);
  }

  const requirements = [...context.intent.mustHaveExperiences];
  const units = [];
  if (strategy === "balanced_experiences") {
    const maximumCount = Math.max(
      0,
      ...requirements.map((requirement) => requirement.minimumCount)
    );
    for (let count = 0; count < maximumCount; count += 1) {
      for (const requirement of rotate(requirements, rotation)) {
        if (count < requirement.minimumCount) units.push(requirement.experience);
      }
    }
  } else {
    for (const requirement of requirements) {
      for (let count = 0; count < requirement.minimumCount; count += 1) {
        units.push(requirement.experience);
      }
    }
  }
  for (const [index, experience] of units.entries()) {
    if (selected.length >= maximum) break;
    const category = POLICY.experienceCategoryMap[experience];
    if (category) addFromPool(pools.get(category), index);
  }

  for (let index = 0; index < facilityPool.length && selected.length < maximum; index += 1) {
    addFromPool(facilityPool, index);
  }
  for (let index = 0; index < overnightPool.length && selected.length < maximum; index += 1) {
    addFromPool(overnightPool, index);
  }
  for (const [index, experience] of context.intent.preferredExperiences.entries()) {
    if (selected.length >= maximum) break;
    const category = POLICY.experienceCategoryMap[experience];
    if (category) addFromPool(pools.get(category), index);
  }
  if (selected.length === 0) addFromPool(usableCandidates);
  return selected;
}

function buildProposalRecord(context, candidateSet, mappedNetworkCandidates) {
  const orderedCandidates = orderViaCandidates(
    context.anchor,
    candidateSet.candidates
  );
  const viaCandidates = orderedCandidates.map((candidate) =>
    materializeViaCandidate(context, candidate)
  );
  const boundedMappedNetworkCandidates = mappedCandidatesWithinEvidenceBudget(
    viaCandidates,
    mappedNetworkCandidates
  );
  const requirements = evaluateRequirements(context, viaCandidates);
  const preliminaryDistanceEnvelope = distanceEnvelope(
    context,
    viaCandidates
  );
  const gaps = requirementGaps(context, requirements.unsatisfied);
  for (const candidate of [
    ...viaCandidates,
    ...boundedMappedNetworkCandidates
  ]) {
    if (
      entityAccessDecision(context, candidate.entityId).state === "conditional"
    ) {
      gaps.push(gap(
        "access_restriction_unverified",
        candidate.entityId,
        "access_restriction"
      ));
    }
  }
  const knownLimitations = [
    "requires_real_routing",
    ...dossierFreshnessLimitations(context.dossier.freshnessState),
    ...context.dossier.regionCoverage.limitationCodes,
    ...viaCandidates.flatMap((candidate) => candidate.knownLimitations),
    ...boundedMappedNetworkCandidates.flatMap(
      (candidate) => candidate.knownLimitations
    )
  ];
  if (
    preliminaryDistanceEnvelope.feasibilityState ===
    "lower_bound_exceeds_target"
  ) {
    const distanceRequirement = requirement(
      "route_constraint",
      "distance_target",
      1,
      0,
      0
    );
    requirements.unsatisfied.push(distanceRequirement);
    gaps.push(gap("distance_lower_bound_exceeds_target"));
    knownLimitations.push("lower_bound_exceeds_target");
  }
  if (context.intent.routeType === "point_to_point") {
    requirements.unsatisfied.push(
      requirement(
        "route_constraint",
        "route_endpoint",
        1,
        0,
        0
      )
    );
    gaps.push(gap("route_endpoint_unavailable"));
    knownLimitations.push("endpoint_unavailable");
  }

  const requiredVerification =
    deriveResearchGuidedRouteProposalVerificationV1(
      context.intent,
      viaCandidates,
      boundedMappedNetworkCandidates
    );
  const evidenceClaimIds = [
    ...new Set([
      ...viaCandidates.flatMap((candidate) => candidate.evidenceClaimIds),
      ...boundedMappedNetworkCandidates.flatMap(
        (candidate) => candidate.evidenceClaimIds
      )
    ])
  ].sort(compareText);
  knownLimitations.push(...limitationsForVerification(requiredVerification));
  const strategy = candidateSet.strategy;
  const proposalId = deriveResearchGuidedRouteProposalIdV1({
    normalizedIntent: context.intent,
    viaEntityIds: viaCandidates.map((candidate) => candidate.entityId),
    mappedNetworkEntityIds: boundedMappedNetworkCandidates.map(
      (candidate) => candidate.entityId
    ),
    strategy
  });
  const proposal = {
    proposalId,
    strategy,
    activity: context.intent.activity,
    routeType: context.intent.routeType,
    targetDistanceRangeKm: context.intent.distanceRangeKm,
    targetDurationRangeMinutes: context.intent.durationRangeMinutes,
    maximumElevationGainMeters: context.intent.maximumElevationGainMeters,
    maximumTechnicalDifficulty: context.intent.maximumTechnicalDifficulty,
    viaCandidates,
    mappedNetworkCandidates: boundedMappedNetworkCandidates,
    satisfiedRequirements: aggregateResearchGuidedRouteRequirementsV1(
      requirements.satisfied,
      "maximum_included"
    ),
    unsatisfiedRequirements: aggregateResearchGuidedRouteRequirementsV1(
      requirements.unsatisfied,
      "maximum_shortfall"
    ),
    requiredVerification,
    preliminaryDistanceEnvelope,
    evidenceClaimIds,
    knownLimitations: ordered(knownLimitations, POLICY.limitationCodes)
  };
  const mustHaveIncluded = proposal.satisfiedRequirements
    .concat(proposal.unsatisfiedRequirements)
    .filter((item) => item.requirementType === "must_have_experience")
    .reduce((sum, item) => sum + item.includedCount, 0);
  const preferredIncluded = proposal.satisfiedRequirements
    .filter((item) => item.requirementType === "preferred_experience")
    .reduce((sum, item) => sum + item.includedCount, 0);
  const unresolvedHighStakes =
    researchGuidedRouteProposalMeetsReadyConditionV1(proposal)
      ? 0
      : requiredVerification.filter((code) =>
        isResearchGuidedRouteHighStakesVerificationV1(code)
      ).length;
  return {
    proposal,
    gaps,
    metrics: {
      mustHaveIncluded,
      unresolvedHighStakes,
      preferredIncluded,
      lowerBoundKm: preliminaryDistanceEnvelope.lowerBoundKm,
      entityIds: candidateSet.entityIds,
      stableKey: candidateSet.entityIds.join(":")
    }
  };
}

function materializeViaCandidate(context, candidate) {
  const role = candidateRole(context, candidate);
  const selectionReasons = candidateSelectionReasons(context, candidate);
  const requiredVerification = entityVerification(context, candidate);
  return {
    entityId: candidate.entityId,
    coordinate: {
      latitude: candidate.coordinate.latitude,
      longitude: candidate.coordinate.longitude
    },
    highlightCategory: candidate.highlightCategory,
    role,
    evidenceClaimIds: [...candidate.evidenceClaimIds].sort(compareText),
    selectionReasons: ordered(selectionReasons, POLICY.selectionReasons),
    knownLimitations: ordered([
      ...candidate.knownLimitations,
      ...limitationsForVerification(requiredVerification)
    ], POLICY.limitationCodes),
    requiredVerification: ordered(
      requiredVerification,
      POLICY.verificationCodes
    )
  };
}

function candidateRole(context, candidate) {
  if (
    context.intent.mustHaveExperiences.some(
      (requirement) =>
        POLICY.experienceCategoryMap[requirement.experience] ===
        candidate.highlightCategory
    )
  ) {
    return "must_have";
  }
  if (
    context.intent.overnightRequirements.required &&
    context.overnightEntityIds.has(candidate.entityId)
  ) {
    return "overnight_candidate";
  }
  if (candidateMatchesAnyFacility(candidate, context.intent.requiredFacilities)) {
    return "facility_candidate";
  }
  if (
    context.intent.preferredExperiences.some(
      (experience) =>
        POLICY.experienceCategoryMap[experience] ===
        candidate.highlightCategory
    )
  ) {
    return "preferred";
  }
  return "available_candidate";
}

function candidateSelectionReasons(context, candidate) {
  const reasons = [];
  if (
    context.intent.mustHaveExperiences.some(
      (requirement) =>
        POLICY.experienceCategoryMap[requirement.experience] ===
        candidate.highlightCategory
    )
  ) {
    reasons.push("required_experience");
  }
  if (
    context.intent.preferredExperiences.some(
      (experience) =>
        POLICY.experienceCategoryMap[experience] ===
        candidate.highlightCategory
    )
  ) {
    reasons.push("preferred_experience");
  }
  if (candidateMatchesAnyFacility(candidate, context.intent.requiredFacilities)) {
    reasons.push("required_facility");
  }
  if (
    context.intent.overnightRequirements.required &&
    context.overnightEntityIds.has(candidate.entityId)
  ) {
    reasons.push("overnight_request");
  }
  if (
    candidate.membershipRouteIds.some((entityId) =>
      context.mappedNetworkEntityIds.has(entityId)
    )
  ) {
    reasons.push("mapped_network_context");
  }
  if (reasons.length === 0) reasons.push("available_research_candidate");
  return reasons;
}

function entityVerification(context, candidate) {
  const verification = [
    "connectivity_required",
    ...entityAccessVerification(context, candidate.entityId)
  ];
  if (!knownText(context, candidate.entityId, "closure_status", "open")) {
    verification.push("closure_status_required");
  }
  if (
    context.intent.maximumTechnicalDifficulty !== null &&
    resolve(context, candidate.entityId, "trail_difficulty").state !== "known"
  ) {
    verification.push("trail_difficulty_required");
  }
  if (context.intent.avoidedExperiences.includes("technical_terrain")) {
    verification.push("trail_difficulty_required", "trail_visibility_required");
  }
  if (context.intent.avoidedExperiences.includes("exposed_trails")) {
    verification.push("exposure_required");
  }
  if (context.intent.avoidedExperiences.includes("steep_climbs")) {
    verification.push("steep_climb_required");
  }
  if (
    context.intent.groupContext.experienceLevel === "beginner"
  ) {
    verification.push("beginner_suitability_required");
  }
  if (context.intent.groupContext.includesChildren) {
    verification.push("child_suitability_required");
  }
  if (context.intent.groupContext.mobility === "limited") {
    verification.push("mobility_suitability_required");
  }
  if (HUT_CATEGORIES.has(candidate.highlightCategory)) {
    if (!knownBoolean(context, candidate.entityId, "current_opening", true)) {
      verification.push("opening_status_required");
    }
    if (
      context.intent.dateOrSeason !== null &&
      resolve(context, candidate.entityId, "seasonal_opening").state !== "known"
    ) {
      verification.push("seasonal_operation_required");
    }
  }
  if (
    context.intent.overnightRequirements.required &&
    context.overnightEntityIds.has(candidate.entityId)
  ) {
    if (!knownBoolean(context, candidate.entityId, "overnight_permission", true)) {
      verification.push("overnight_permission_required", "legal_sleep_required");
    }
    if (!knownBoolean(context, candidate.entityId, "bookability", true)) {
      verification.push("booking_required");
    }
    if (!knownBoolean(context, candidate.entityId, "current_opening", true)) {
      verification.push("opening_status_required");
    }
    if (resolve(context, candidate.entityId, "seasonal_opening").state !== "known") {
      verification.push("seasonal_operation_required");
    }
  }
  if (
    context.intent.requiredFacilities.includes("drinking_water") &&
    !knownBoolean(
      context,
      candidate.entityId,
      "drinking_water_availability",
      true
    )
  ) {
    verification.push("water_status_required");
  }
  if (context.intent.dateOrSeason !== null) {
    verification.push("current_conditions_required");
  }
  return ordered(verification, POLICY.verificationCodes);
}

function entityAccessVerification(context, entityId) {
  const decision = entityAccessDecision(context, entityId);
  const verification = [];
  if (!decision.publicAccessVerified) {
    verification.push("public_access_required");
  }
  if (decision.state === "conditional") {
    verification.push("access_restriction_required");
  }
  return verification;
}

function entityAccessDecision(context, entityId) {
  const publicAccess = resolve(context, entityId, "public_access");
  const accessRestriction = resolve(
    context,
    entityId,
    "access_restriction"
  );
  const publicAccessVerified = (
    publicAccess.state === "known" &&
    publicAccess.value.type === "boolean" &&
    publicAccess.value.value === true
  );
  if (
    (
      publicAccess.state === "known" &&
      publicAccess.value.type === "boolean" &&
      publicAccess.value.value === false
    ) ||
    (
      accessRestriction.state === "known" &&
      accessRestriction.value.type === "text" &&
      accessRestriction.value.value === "prohibited"
    )
  ) {
    return { state: "denied", publicAccessVerified };
  }
  if (
    accessRestriction.state === "known" &&
    accessRestriction.value.type === "text" &&
    CONDITIONAL_ACCESS_RESTRICTIONS.has(accessRestriction.value.value)
  ) {
    return { state: "conditional", publicAccessVerified };
  }
  return {
    state: publicAccessVerified ? "verified" : "unverified",
    publicAccessVerified
  };
}

function evaluateRequirements(context, viaCandidates) {
  const satisfied = [];
  const unsatisfied = [];
  const put = (item) =>
    (item.shortfallCount === 0 ? satisfied : unsatisfied).push(item);

  for (const requested of context.intent.mustHaveExperiences) {
    const category = POLICY.experienceCategoryMap[requested.experience];
    const availableCount = category
      ? context.usableCandidates.filter(
        (candidate) => candidate.highlightCategory === category
      ).length
      : 0;
    const includedCount = category
      ? viaCandidates.filter(
        (candidate) => candidate.highlightCategory === category
      ).length
      : 0;
    put(requirement(
      "must_have_experience",
      requested.experience,
      requested.minimumCount,
      availableCount,
      Math.min(includedCount, requested.minimumCount)
    ));
  }

  for (const experience of context.intent.preferredExperiences) {
    const category = POLICY.experienceCategoryMap[experience];
    const availableCount = category
      ? context.dossier.candidateHighlights.filter(
        (candidate) => candidate.highlightCategory === category
      ).length
      : 0;
    const includedCount = category
      ? Math.min(
        1,
        viaCandidates.filter(
          (candidate) => candidate.highlightCategory === category
        ).length
      )
      : 0;
    put(requirement(
      "preferred_experience",
      experience,
      1,
      availableCount,
      includedCount
    ));
  }

  for (const facility of context.intent.requiredFacilities) {
    const matching = viaCandidates.filter((candidate) =>
      candidateMatchesFacility(candidate, facility)
    );
    const verifiedCount = matching.filter((candidate) =>
      facilityIsVerified(context, candidate, facility)
    ).length;
    put(requirement(
      "required_facility",
      facility,
      1,
      matching.length,
      Math.min(1, verifiedCount)
    ));
  }

  if (context.intent.overnightRequirements.required) {
    const requested = context.intent.overnightRequirements.nights;
    const matching = viaCandidates.filter(
      (candidate) =>
        context.overnightEntityIds.has(candidate.entityId) &&
        context.intent.overnightRequirements.allowedAccommodationTypes.includes(
          candidate.highlightCategory
        )
    );
    const verified = matching.filter((candidate) =>
      overnightIsVerified(context, candidate.entityId)
    ).length;
    put(requirement(
      "overnight",
      "overnight_stay",
      requested,
      matching.length,
      Math.min(requested, verified)
    ));
  }

  for (const avoidance of context.intent.avoidedExperiences) {
    put(requirement("avoidance", avoidance, 1, 0, 0));
  }
  if (context.intent.groupContext.experienceLevel === "beginner") {
    put(requirement(
      "group_safeguard",
      "beginner_group",
      1,
      0,
      0
    ));
  }
  if (context.intent.groupContext.includesChildren) {
    put(requirement(
      "group_safeguard",
      "children_group",
      1,
      0,
      0
    ));
  }
  if (context.intent.groupContext.mobility === "limited") {
    put(requirement(
      "group_safeguard",
      "limited_mobility_group",
      1,
      0,
      0
    ));
  }
  if (context.intent.transportRequirements.publicTransportRequired) {
    put(requirement(
      "transport",
      "public_transport",
      1,
      0,
      0
    ));
  }
  if (context.intent.dateOrSeason !== null) {
    put(requirement(
      "date_or_season",
      context.intent.dateOrSeason.kind === "date" ? "exact_date" : "season",
      1,
      0,
      0
    ));
  }
  if (context.intent.maximumTechnicalDifficulty !== null) {
    const knownCompatible = viaCandidates.filter((candidate) => {
      const result = resolve(context, candidate.entityId, "trail_difficulty");
      return (
        result.state === "known" &&
        result.value.type === "text" &&
        difficultyIndex(result.value.value) <=
          difficultyIndex(context.intent.maximumTechnicalDifficulty)
      );
    }).length;
    put(requirement(
      "route_constraint",
      "maximum_technical_difficulty",
      viaCandidates.length,
      knownCompatible,
      knownCompatible
    ));
  }

  const accessVerified = viaCandidates.filter(
    (candidate) =>
      entityAccessDecision(context, candidate.entityId).state === "verified"
  ).length;
  put(requirement(
    "candidate_verification",
    "candidate_public_access",
    viaCandidates.length,
    accessVerified,
    accessVerified
  ));
  const closureVerified = viaCandidates.filter((candidate) =>
    knownText(context, candidate.entityId, "closure_status", "open")
  ).length;
  put(requirement(
    "candidate_verification",
    "candidate_closure_status",
    viaCandidates.length,
    closureVerified,
    closureVerified
  ));

  if (context.dossier.regionCoverage.state !== "full") {
    put(requirement(
      "region_coverage",
      "full_region_coverage",
      1,
      0,
      0
    ));
  }
  return { satisfied, unsatisfied };
}

function mappedCandidatesWithinEvidenceBudget(viaCandidates, candidates) {
  const evidenceClaimIds = new Set(
    viaCandidates.flatMap((candidate) => candidate.evidenceClaimIds)
  );
  const selected = [];
  for (const candidate of candidates) {
    const combined = new Set([
      ...evidenceClaimIds,
      ...candidate.evidenceClaimIds
    ]);
    if (
      combined.size >
      POLICY.limits.maximumEvidenceReferencesPerProposal
    ) {
      continue;
    }
    selected.push(candidate);
    for (const claimId of candidate.evidenceClaimIds) {
      evidenceClaimIds.add(claimId);
    }
  }
  return selected;
}

function facilityIsVerified(context, candidate, facility) {
  if (facility === "lunch_hut") {
    return (
      HUT_CATEGORIES.has(candidate.highlightCategory) &&
      knownBoolean(context, candidate.entityId, "current_opening", true) &&
      entityAccessDecision(context, candidate.entityId).state === "verified" &&
      knownText(context, candidate.entityId, "closure_status", "open")
    );
  }
  if (facility === "drinking_water") {
    return knownBoolean(
      context,
      candidate.entityId,
      "drinking_water_availability",
      true
    );
  }
  return false;
}

function overnightIsVerified(context, entityId) {
  return (
    entityAccessDecision(context, entityId).state === "verified" &&
    knownBoolean(context, entityId, "current_opening", true) &&
    knownBoolean(context, entityId, "overnight_permission", true) &&
    knownBoolean(context, entityId, "bookability", true) &&
    knownText(context, entityId, "closure_status", "open") &&
    resolve(context, entityId, "seasonal_opening").state === "known"
  );
}

function candidateMatchesAnyFacility(candidate, facilities) {
  return facilities.some((facility) =>
    candidateMatchesFacility(candidate, facility)
  );
}

function candidateMatchesFacility(candidate, facility) {
  if (facility === "lunch_hut") {
    return HUT_CATEGORIES.has(candidate.highlightCategory);
  }
  return false;
}

function requirement(
  requirementType,
  value,
  requestedCount,
  availableCount,
  includedCount
) {
  return {
    requirementType,
    value,
    requestedCount,
    availableCount,
    includedCount,
    shortfallCount: requestedCount - includedCount
  };
}

function requirementGaps(context, unsatisfiedRequirements) {
  const gaps = [];
  for (const item of unsatisfiedRequirements) {
    if (item.requirementType === "must_have_experience") {
      gaps.push(gap(
        POLICY.experienceCategoryMap[item.value]
          ? "must_have_shortfall"
          : "unsupported_experience",
        null,
        null,
        item.value,
        item.requestedCount,
        item.includedCount
      ));
      if (
        item.availableCount >= item.requestedCount &&
        item.includedCount < item.requestedCount
      ) {
        gaps.push(gap(
          "waypoint_budget_exceeded",
          null,
          null,
          item.value,
          item.requestedCount,
          item.includedCount
        ));
      }
    } else if (item.requirementType === "required_facility") {
      gaps.push(gap("facility_unverified", null, null, item.value));
    } else if (item.requirementType === "overnight") {
      gaps.push(gap("overnight_unverified"));
    } else if (item.requirementType === "transport") {
      gaps.push(gap("transport_unverified"));
    } else if (item.requirementType === "date_or_season") {
      gaps.push(gap("date_or_season_unverified"));
    } else if (item.requirementType === "avoidance") {
      gaps.push(gap("terrain_constraint_unverified", null, null, item.value));
    } else if (item.requirementType === "group_safeguard") {
      gaps.push(gap("group_suitability_unverified", null, null, item.value));
    } else if (
      item.requirementType === "route_constraint" &&
      item.value === "maximum_technical_difficulty"
    ) {
      gaps.push(gap("terrain_constraint_unverified"));
    }
  }
  return gaps;
}

function distanceEnvelope(context, viaCandidates) {
  let lowerBoundKm = 0;
  let previous = context.anchor;
  for (const candidate of viaCandidates) {
    lowerBoundKm += haversineKm(previous, candidate.coordinate);
    previous = candidate.coordinate;
  }
  if (
    context.intent.routeType === "loop" ||
    context.intent.routeType === "out_and_back"
  ) {
    lowerBoundKm += haversineKm(previous, context.anchor);
  }
  lowerBoundKm = roundDistance(lowerBoundKm);
  if (!Number.isFinite(lowerBoundKm)) {
    throw new ResearchGuidedRouteCandidateError("policy_inconsistent");
  }
  const targetRangeKm = context.intent.distanceRangeKm;
  const feasibilityState = targetRangeKm === null
    ? "target_unspecified"
    : lowerBoundKm > targetRangeKm.max
      ? "lower_bound_exceeds_target"
      : "not_ruled_out";
  return {
    kind: POLICY.preliminaryDistance.kind,
    lowerBoundKm,
    heuristicRangeKm: {
      min: roundDistance(
        lowerBoundKm *
          POLICY.preliminaryDistance.heuristicMinimumMultiplier
      ),
      max: roundDistance(
        lowerBoundKm *
          POLICY.preliminaryDistance.heuristicMaximumMultiplier
      )
    },
    targetRangeKm,
    feasibilityState,
    limitationCode: POLICY.preliminaryDistance.limitationCode
  };
}

function orderViaCandidates(anchor, candidates) {
  const remaining = [...candidates];
  const result = [];
  let previous = anchor;
  while (remaining.length > 0) {
    remaining.sort(
      (left, right) =>
        haversineKm(previous, left.coordinate) -
          haversineKm(previous, right.coordinate) ||
        compareText(left.entityId, right.entityId)
    );
    const next = remaining.shift();
    result.push(next);
    previous = next.coordinate;
  }
  return result;
}

function compareProposalRecords(left, right) {
  return (
    right.metrics.mustHaveIncluded - left.metrics.mustHaveIncluded ||
    left.metrics.unresolvedHighStakes - right.metrics.unresolvedHighStakes ||
    right.metrics.preferredIncluded - left.metrics.preferredIncluded ||
    left.metrics.lowerBoundKm - right.metrics.lowerBoundKm ||
    compareText(left.metrics.stableKey, right.metrics.stableKey) ||
    compareText(left.proposal.proposalId, right.proposal.proposalId)
  );
}

function selectDiverseRecords(records, maximum) {
  const selected = [];
  for (const record of records) {
    if (selected.length >= maximum) break;
    if (
      selected.every((existing) =>
        entitySetOverlap(
          existing.metrics.entityIds,
          record.metrics.entityIds
        ) <= POLICY.maximumProposalEntitySetOverlap
      )
    ) {
      selected.push(record);
    }
  }
  if (selected.length === 0 && records.length > 0) selected.push(records[0]);
  return selected;
}

function entitySetOverlap(leftValues, rightValues) {
  const left = new Set(leftValues);
  const right = new Set(rightValues);
  const intersection = [...left].filter((value) => right.has(value)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 1 : intersection / union;
}

function mappedMembershipRouteIds(context, entityId) {
  return (context.claimsByEntity.get(entityId) ?? [])
    .filter(
      (claim) =>
        claim.predicate === "mapped_hiking_route_membership" &&
        claim.resolutionState === "known" &&
        claim.freshness === "current" &&
        claim.value.type === "entity_reference"
    )
    .map((claim) => claim.value.value)
    .sort(compareText);
}

function decisionClaimIds(context, entityId, initialClaimIds) {
  const claimIds = new Set(initialClaimIds);
  for (const predicate of CANDIDATE_DECISION_PREDICATES) {
    const result = resolve(context, entityId, predicate);
    for (const claimId of result.claimIds ?? []) claimIds.add(claimId);
  }
  return [...claimIds].sort(compareText);
}

function resolve(context, entityId, predicate) {
  return resolveValidatedEvidenceClaimsV1(
    context.claimsByEntity.get(entityId) ?? [],
    { now: context.generatedAt, entityId, predicate }
  );
}

function knownBoolean(context, entityId, predicate, expected) {
  const result = resolve(context, entityId, predicate);
  return (
    result.state === "known" &&
    result.value.type === "boolean" &&
    result.value.value === expected
  );
}

function knownText(context, entityId, predicate, expected) {
  const result = resolve(context, entityId, predicate);
  return (
    result.state === "known" &&
    result.value.type === "text" &&
    result.value.value === expected
  );
}

function difficultyIndex(value) {
  const index = POLICY.difficultyOrder.indexOf(value);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function categoryPools(candidates) {
  const pools = new Map();
  for (const candidate of candidates) {
    if (!pools.has(candidate.highlightCategory)) {
      pools.set(candidate.highlightCategory, []);
    }
    pools.get(candidate.highlightCategory).push(candidate);
  }
  for (const pool of pools.values()) {
    pool.sort((left, right) => compareText(left.entityId, right.entityId));
  }
  return pools;
}

function rotate(values, offset) {
  if (values.length === 0) return [];
  const normalized = offset % values.length;
  return [...values.slice(normalized), ...values.slice(0, normalized)];
}

function requestLimitationCode(verificationCode) {
  return {
    public_access_required: "access_unverified",
    access_restriction_required: "access_restriction_unverified",
    closure_status_required: "current_conditions_unavailable",
    trail_difficulty_required: "trail_difficulty_unverified",
    exposure_required: "exposure_unverified",
    opening_status_required: "opening_unverified",
    seasonal_operation_required: "seasonal_status_unverified",
    overnight_permission_required: "overnight_legality_unverified",
    legal_sleep_required: "overnight_legality_unverified",
    booking_required: "bookability_unverified",
    water_status_required: "water_availability_unverified",
    current_conditions_required: "current_conditions_unavailable",
    transport_required: "transport_unverified",
    mobility_suitability_required: "mobility_suitability_unverified",
    child_suitability_required: "child_suitability_unverified",
    beginner_suitability_required: "beginner_suitability_unverified",
    connectivity_required: "route_connection_unverified",
    official_status_required: "official_status_unverified"
  }[verificationCode] ?? null;
}

function limitationsForVerification(verificationCodes) {
  return verificationCodes
    .map(requestLimitationCode)
    .filter((code) => code !== null);
}

function dossierFreshnessLimitations(freshnessState) {
  if (freshnessState === "current") return [];
  if (freshnessState === "stale" || freshnessState === "expired") {
    return ["source_stale"];
  }
  return ["insufficient_evidence"];
}

function dossierGaps(dossier) {
  const result = dossier.evidenceGaps.map((item) => {
    if (item.code === "insufficient_candidate_count") {
      return gap(
        item.code,
        null,
        null,
        item.experience,
        item.requiredMinimumCount,
        item.foundCount
      );
    }
    return gap(
      item.code,
      item.entityId,
      item.predicate
    );
  });
  if (dossier.regionCoverage.state === "partial") {
    result.push(gap("partial_region_coverage"));
  }
  if (dossier.freshnessState !== "current") {
    result.push(gap("dossier_freshness_not_current"));
  }
  return result;
}

function gap(
  code,
  entityId = null,
  predicate = null,
  experience = null,
  requiredCount = null,
  availableCount = null
) {
  return {
    code,
    entityId,
    predicate,
    experience,
    requiredCount,
    availableCount
  };
}

function normalizeGaps(gaps) {
  const unique = new Map();
  for (const item of gaps) {
    const key = canonical(item);
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].sort(
    (left, right) =>
      POLICY.evidenceGapCodes.indexOf(left.code) -
        POLICY.evidenceGapCodes.indexOf(right.code) ||
      compareText(left.entityId ?? "", right.entityId ?? "") ||
      compareText(left.predicate ?? "", right.predicate ?? "") ||
      compareText(left.experience ?? "", right.experience ?? "") ||
      (left.requiredCount ?? -1) - (right.requiredCount ?? -1) ||
      (left.availableCount ?? -1) - (right.availableCount ?? -1)
  ).slice(0, POLICY.limits.maximumEvidenceGaps);
}

function ordered(values, vocabulary) {
  return [...new Set(values)].sort(
    (left, right) =>
      vocabulary.indexOf(left) - vocabulary.indexOf(right) ||
      compareText(left, right)
  );
}

function haversineKm(left, right) {
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const leftLatitude = toRadians(left.latitude);
  const rightLatitude = toRadians(right.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) *
      Math.cos(rightLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  const result = 6_371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  if (!Number.isFinite(result)) {
    throw new ResearchGuidedRouteCandidateError("policy_inconsistent");
  }
  return result;
}

function roundDistance(value) {
  const factor = 10 ** POLICY.preliminaryDistance.roundingDecimals;
  return Math.round(value * factor) / factor;
}

function canonical(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort(compareText).map((key) => [key, sortKeys(value[key])])
  );
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function validatedPlan(input) {
  try {
    return validateResearchGuidedRouteCandidatePlanV1(input);
  } catch (error) {
    if (
      error instanceof ResearchGuidedRouteCandidateError &&
      error.code === "output_too_large"
    ) {
      throw error;
    }
    throw new ResearchGuidedRouteCandidateError("policy_inconsistent");
  }
}

export const researchGuidedRouteCandidatePlannerInternalsForTesting =
  Object.freeze({
    haversineKm,
    entitySetOverlap,
    maximumExploredCombinations: POLICY.limits.maximumExploredCombinations
  });
