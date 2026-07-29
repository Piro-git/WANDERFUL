import {
  EVIDENCE_PREDICATES,
  OUTDOOR_RESEARCH_LIMITS
} from "../../src/outdoorResearch/contracts.js";
import {
  resolveEvidenceClaimsV1
} from "../../src/outdoorResearch/evidenceResolution.js";
import {
  assembleAdventureResearchDossierV1
} from "../../src/outdoorResearch/dossierAssembler.js";
import {
  planOutdoorResearchV1
} from "../../src/outdoorResearch/researchPlanner.js";
import {
  validateAdventureResearchDossierV1,
  validateAdventureResearchIntentV1,
  validateEvidenceClaimV1
} from "../../src/outdoorResearch/validation.js";
import {
  OUTDOOR_ADVENTURE_ORCHESTRATION_POLICY_V1
} from "../../src/outdoorAdventure/orchestrationPolicy.js";
import {
  validateOutdoorAdventurePlanningResponseV1
} from "../../src/outdoorAdventure/orchestrationContract.js";
import {
  RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V1
} from "../../src/routeResearch/policy.js";
import {
  routeResearchGuidedCandidatesV1
} from "../../src/routeResearch/researchGuidedRoutingAdapter.js";
import {
  RESEARCH_GUIDED_ROUTED_ALTERNATIVES_POLICY_V1
} from "../../src/routeResearch/routedAlternativesPolicy.js";
import {
  serializeResearchGuidedRoutedAlternativesV1,
  validateResearchGuidedRoutedAlternativesV1
} from "../../src/routeResearch/routedAlternativesContract.js";
import {
  serializeResearchGuidedRouteCandidatePlanV1,
  validateResearchGuidedRouteCandidatePlanV1
} from "../../src/routeResearch/validation.js";
import { routeError } from "../../src/routing/routeErrors.js";
import {
  SYNTHETIC_EVALUATION_CLOCK_V1,
  syntheticAdventureResearchDossierV1,
  syntheticAdventureResearchIntentV1,
  syntheticEvaluationCapabilitiesV1,
  syntheticEvidenceClaimV1,
  syntheticGraphHopperResponseV1,
  syntheticResearchGuidedCandidatePlanV1
} from "./syntheticFixtures.js";

export async function evaluateOutdoorAdventureQualityCaseV1(evaluationCase) {
  const context = createEvaluationContext(evaluationCase);
  switch (evaluationCase.operation) {
    case "planner":
      evaluatePlannerCase(context);
      break;
    case "evidence":
      evaluateEvidenceCase(context);
      break;
    case "candidate":
      evaluateCandidateCase(context);
      break;
    case "routing":
      await evaluateRoutingCase(context);
      break;
    case "contract":
      await evaluateContractCase(context);
      break;
    default:
      context.record("contract_not_rejected", "bounds");
      context.state = "unsupported";
  }
  if (context.state !== evaluationCase.expected.outcomeState) {
    context.record("actual_state_mismatch");
  }
  return context.result();
}

function evaluatePlannerCase(context) {
  const { input, expected } = context.evaluationCase;
  const intent = mutatedIntent(
    syntheticAdventureResearchIntentV1({
      region: input.region ?? context.evaluationCase.region,
      anchorState: input.anchorState,
      intent: input.intent ?? {}
    }),
    input.mutation
  );
  const capabilities = capabilitiesFor(input.capabilityMode);
  if (expected.rejected === true) {
    if (!throws(() => planOutdoorResearchV1(intent, capabilities))) {
      context.record(
        "contract_not_rejected",
        input.mutation?.includes("oversized") ? "bounds" : "false_claim"
      );
    }
    context.state = "unsupported";
    return;
  }

  let planning;
  try {
    planning = planOutdoorResearchV1(intent, capabilities);
  } catch {
    context.record("evaluation_exception");
    context.state = "unsupported";
    return;
  }
  context.state = plannerOutcomeState(planning.state);
  if (expected.plannerState && planning.state !== expected.plannerState) {
    context.record("actual_state_mismatch");
  }
  if (
    expected.intentPreserved &&
    !isSubset(planning.normalizedIntent, expected.intentPreserved)
  ) {
    context.record("intent_not_preserved", "must_have");
  }
  const gapCodes = planning.planningGaps.map((gap) => gap.code);
  for (const code of expected.requiredGapCodes ?? []) {
    if (!gapCodes.includes(code)) context.record("evidence_gap_missing");
  }
  for (const code of expected.forbiddenGapCodes ?? []) {
    if (gapCodes.includes(code)) context.record("fabricated_claim_accepted", "false_claim");
  }
  const operationTypes = planning.plan?.operations.map(
    (operation) => operation.operationType
  ) ?? [];
  for (const operationType of expected.requiredOperationTypes ?? []) {
    if (!operationTypes.includes(operationType)) {
      context.record("operation_missing");
    }
  }
  if (expected.mustHavePreserved === true) {
    if (!sameValue(
      planning.normalizedIntent.mustHaveExperiences,
      [...intent.mustHaveExperiences].sort((left, right) =>
        left.experience.localeCompare(right.experience) ||
        left.minimumCount - right.minimumCount
      )
    )) {
      context.record("intent_not_preserved", "must_have");
    }
  }
  if (expected.preferencesPreserved === true) {
    if (!sameValue(
      planning.normalizedIntent.preferredExperiences,
      [...intent.preferredExperiences].sort()
    )) {
      context.record("intent_not_preserved", "must_have");
    }
  }
  if (
    expected.noCentroidGuess === true &&
    planning.normalizedIntent.geographicAnchor.state !== "unresolved"
  ) {
    context.record("fabricated_claim_accepted", "false_claim");
  }
  if (expected.deterministic === true) {
    const repeated = planOutdoorResearchV1(intent, capabilities);
    if (JSON.stringify(planning) !== JSON.stringify(repeated)) {
      context.record("determinism_mismatch", "determinism");
    }
  }
}

function evaluateEvidenceCase(context) {
  const { input, expected } = context.evaluationCase;
  let claims = (input.claims ?? [{}]).map((spec, index) =>
    syntheticEvidenceClaimV1(spec, index + 1)
  );
  claims = mutateClaims(claims, input.mutation);
  if (expected.rejected === true) {
    const action = () => {
      if (input.mutation === "oversized_claim_array") {
        resolveEvidenceClaimsV1(claims, {
          now: SYNTHETIC_EVALUATION_CLOCK_V1,
          entityId: claims[0]?.entityId ?? syntheticEvidenceClaimV1().entityId,
          predicate: input.targetPredicate ?? claims[0]?.predicate ?? "public_access"
        });
      } else {
        claims.forEach(validateEvidenceClaimV1);
      }
    };
    if (!throws(action)) {
      const highStakes = claims.some((claim) =>
        [
          "public_access",
          "access_restriction",
          "current_opening",
          "seasonal_opening",
          "overnight_permission",
          "bookability",
          "drinking_water_availability",
          "closure_status"
        ].includes(claim.predicate)
      );
      context.record(
        input.mutation?.includes("oversized")
          ? "bounds_not_enforced"
          : "contract_not_rejected",
        highStakes ? "high_stakes_authority" : "bounds"
      );
    }
    context.state = "unsupported";
    return;
  }

  let resolution;
  try {
    resolution = resolveEvidenceClaimsV1(claims, {
      now: SYNTHETIC_EVALUATION_CLOCK_V1,
      entityId: input.targetEntity === "other"
        ? syntheticEvidenceClaimV1({ entityIndex: 99 }, 99).entityId
        : claims[0].entityId,
      predicate: input.targetPredicate ?? claims[0].predicate
    });
  } catch {
    context.record("evaluation_exception");
    context.state = "unsupported";
    return;
  }
  context.state = resolution.state === "known" ? "ready" : "partial";
  if (
    expected.resolutionState &&
    resolution.state !== expected.resolutionState
  ) {
    context.record(
      "claim_resolution_mismatch",
      expected.authorityCritical === true
        ? "high_stakes_authority"
        : "false_claim"
    );
  }
  if (
    expected.value !== undefined &&
    !sameValue(resolution.value, expected.value)
  ) {
    context.record("claim_resolution_mismatch", "false_claim");
  }
  for (const limitation of expected.requiredLimitationCodes ?? []) {
    if (!resolution.limitationCodes.includes(limitation)) {
      context.record("authority_gate_failed", "high_stakes_authority");
    }
  }
  if (
    expected.noConfidencePercentage === true &&
    Object.hasOwn(resolution, "confidencePercentage")
  ) {
    context.record("fabricated_claim_accepted", "false_claim");
  }
  if (expected.deterministic === true) {
    const repeated = resolveEvidenceClaimsV1(claims, {
      now: SYNTHETIC_EVALUATION_CLOCK_V1,
      entityId: input.targetEntity === "other"
        ? syntheticEvidenceClaimV1({ entityIndex: 99 }, 99).entityId
        : claims[0].entityId,
      predicate: input.targetPredicate ?? claims[0].predicate
    });
    if (JSON.stringify(resolution) !== JSON.stringify(repeated)) {
      context.record("determinism_mismatch", "determinism");
    }
  }
}

function evaluateCandidateCase(context) {
  const { input, expected } = context.evaluationCase;
  const dossier = mutatedDossier(
    syntheticAdventureResearchDossierV1(candidateDossierSpec(
      input,
      context.evaluationCase.region
    )),
    input.dossierMutation
  );
  if (expected.rejected === true && input.dossierMutation) {
    if (!throws(() => validateAdventureResearchDossierV1(dossier))) {
      context.record(
        input.dossierMutation.includes("oversized")
          ? "bounds_not_enforced"
          : "contract_not_rejected",
        input.dossierMutation.includes("oversized") ? "bounds" : "provenance"
      );
    }
    context.state = "unsupported";
    return;
  }

  let plan;
  try {
    plan = syntheticResearchGuidedCandidatePlanV1({
      ...candidateDossierSpec(input, context.evaluationCase.region),
      maximumProposals: input.maximumProposals
    });
  } catch {
    if (expected.rejected === true) {
      context.state = "unsupported";
      return;
    }
    context.record("evaluation_exception");
    context.state = "unsupported";
    return;
  }
  plan = mutateCandidatePlan(plan, input.planMutation);
  if (expected.rejected === true) {
    if (!throws(() => validateResearchGuidedRouteCandidatePlanV1(plan))) {
      context.record(
        input.planMutation === "duplicate_proposal_id"
          ? "duplicate_proposal_accepted"
          : "contract_not_rejected",
        input.planMutation?.includes("oversized") ? "bounds" : "provenance"
      );
    }
    context.state = "unsupported";
    return;
  }

  let validated;
  try {
    validated = validateResearchGuidedRouteCandidatePlanV1(plan);
  } catch {
    context.record("evaluation_exception");
    context.state = "unsupported";
    return;
  }
  context.state = candidateOutcomeState(validated.state);
  if (expected.candidateState && validated.state !== expected.candidateState) {
    context.record("actual_state_mismatch");
  }
  if (
    Number.isInteger(expected.proposalCount) &&
    validated.proposals.length !== expected.proposalCount
  ) {
    context.record("bounds_not_enforced", "bounds");
  }
  if (
    Number.isInteger(expected.minimumProposalCount) &&
    validated.proposals.length < expected.minimumProposalCount
  ) {
    context.record("candidate_requirement_mismatch", "must_have");
  }
  if (
    Number.isInteger(expected.maximumProposalCount) &&
    validated.proposals.length > expected.maximumProposalCount
  ) {
    context.record("bounds_not_enforced", "bounds");
  }
  const unmet = validated.unmetRequirements;
  for (const requirement of expected.requiredUnmet ?? []) {
    const match = unmet.find((item) =>
      item.requirementType === requirement.requirementType &&
      item.value === requirement.value
    );
    if (
      !match ||
      (
        requirement.shortfallCount !== undefined &&
        match.shortfallCount !== requirement.shortfallCount
      )
    ) {
      context.record("candidate_requirement_mismatch", "must_have");
    }
  }
  for (const requirement of expected.forbiddenUnmet ?? []) {
    if (unmet.some((item) =>
      item.requirementType === requirement.requirementType &&
      item.value === requirement.value
    )) {
      context.record("candidate_requirement_mismatch", "must_have");
    }
  }
  for (const code of expected.requiredVerificationCodes ?? []) {
    if (!validated.requiredVerification.includes(code)) {
      context.record("route_not_verified", "route_verification");
    }
  }
  const gapCodes = validated.evidenceGaps.map((gap) => gap.code);
  for (const code of expected.requiredGapCodes ?? []) {
    if (!gapCodes.includes(code)) {
      context.record("evidence_gap_missing", "must_have");
    }
  }
  if (expected.mustHaveRolesFirst === true) {
    const requested = input.intent?.mustHaveExperiences ?? [];
    const availableCategories = new Set(input.candidateCategories ?? []);
    const satisfiable = requested.filter((requirement) =>
      availableCategories.has(requirement.experience)
    );
    if (
      satisfiable.some((requirement) =>
        validated.proposals.some((proposal) =>
          !proposal.viaCandidates.some((candidate) =>
            candidate.highlightCategory === requirement.experience &&
            candidate.role === "must_have"
          )
        )
      )
    ) {
      context.record("candidate_requirement_mismatch", "must_have");
    }
  }
  if (expected.distinctProposals === true) {
    const signatures = validated.proposals.map((proposal) =>
      proposal.viaCandidates.map((candidate) => candidate.entityId).sort().join("|")
    );
    if (new Set(signatures).size !== signatures.length) {
      context.record("duplicate_proposal_accepted", "bounds");
    }
  }
  if (
    expected.noGeometry === true &&
    recursivelyHasAnyKey(validated, ["geometry", "points", "polyline"])
  ) {
    context.record("geometry_invented", "route_verification");
  }
  if (expected.straightLineLowerBound === true) {
    if (validated.proposals.some((proposal) =>
      proposal.preliminaryDistanceEnvelope.kind !==
        "straight_line_lower_bound" ||
      proposal.preliminaryDistanceEnvelope.limitationCode !==
        "requires_real_routing"
    )) {
      context.record("route_not_verified", "route_verification");
    }
  }
  if (expected.mappedNotOfficial === true) {
    const mapped = validated.proposals.flatMap(
      (proposal) => proposal.mappedNetworkCandidates
    );
    if (
      mapped.length === 0 ||
      mapped.some((candidate) =>
        candidate.sourceBasis !== "mapped" ||
        !candidate.requiredVerification.includes("official_status_required")
      )
    ) {
      context.record("fabricated_claim_accepted", "high_stakes_authority");
    }
  }
  if (expected.deterministic === true) {
    const first = serializeResearchGuidedRouteCandidatePlanV1(validated);
    const second = serializeResearchGuidedRouteCandidatePlanV1(validated);
    if (first !== second) {
      context.record("determinism_mismatch", "determinism");
    }
  }
}

async function evaluateRoutingCase(context) {
  const { input, expected } = context.evaluationCase;
  let plan;
  try {
    plan = syntheticResearchGuidedCandidatePlanV1(
      candidateDossierSpec(input, context.evaluationCase.region)
    );
  } catch {
    context.record("evaluation_exception");
    context.state = "unsupported";
    return;
  }
  const runRouting = () => {
    const provider = syntheticProvider(input.providerBehavior);
    return routeResearchGuidedCandidatesV1(
      plan,
      { provider },
      { maximumConcurrency: input.maximumConcurrency ?? 1 }
    );
  };
  let envelope;
  try {
    envelope = await runRouting();
  } catch {
    context.record("evaluation_exception");
    context.state = "unsupported";
    return;
  }
  envelope = mutateRoutedEnvelope(envelope, input.envelopeMutation);
  if (expected.rejected === true) {
    if (!throws(() => validateResearchGuidedRoutedAlternativesV1(envelope))) {
      context.record("contract_not_rejected", "provenance");
    }
    context.state = "unsupported";
    return;
  }

  let validated;
  try {
    validated = validateResearchGuidedRoutedAlternativesV1(envelope);
  } catch {
    context.record("evaluation_exception");
    context.state = "unsupported";
    return;
  }
  context.state = routingOutcomeState(validated.state);
  if (expected.routingState && validated.state !== expected.routingState) {
    context.record("actual_state_mismatch");
  }
  if (
    expected.attemptStates &&
    !sameValue(
      validated.attempts.map((attempt) => attempt.state),
      expected.attemptStates
    )
  ) {
    context.record("actual_state_mismatch");
  }
  const routeResults = validated.attempts.flatMap(
    (attempt) => attempt.routeResults
  );
  if (
    Number.isInteger(expected.routeResultCount) &&
    routeResults.length !== expected.routeResultCount
  ) {
    context.record("route_not_verified", "route_verification");
  }
  if (
    expected.graphHopperProvenance === true &&
    routeResults.some((result) =>
      result.geometryProvider !== "graphhopper" ||
      result.routingStrategy !== "backend"
    )
  ) {
    context.record("provenance_not_preserved", "provenance");
  }
  if (expected.routedOnlyEligible === true) {
    if (validated.attempts.some((attempt) =>
      attempt.state !== "routed" && attempt.routeResults.length > 0
    )) {
      context.record("route_not_verified", "route_verification");
    }
  }
  if (
    expected.withinVisitTolerance !== undefined &&
    routeResults.flatMap((result) => result.waypointVisits)
      .filter((visit) => visit.role === "via")
      .some((visit) =>
        visit.withinVisitTolerance !== expected.withinVisitTolerance
      )
  ) {
    context.record("waypoint_connection_mismatch", "waypoint_connection");
  }
  for (const limitation of expected.requiredLimitationCodes ?? []) {
    if (!validated.remainingLimitations.includes(limitation)) {
      context.record("waypoint_connection_mismatch", "waypoint_connection");
    }
  }
  if (expected.proposalAssociation === true) {
    if (validated.attempts.some((attempt, index) =>
      attempt.provenance.proposalId !== plan.proposals[index].proposalId ||
      !sameValue(
        attempt.provenance.evidenceClaimIds,
        plan.proposals[index].evidenceClaimIds
      )
    )) {
      context.record("provenance_not_preserved", "provenance");
    }
  }
  if (expected.activityCompatibility === true) {
    if (validated.attempts.some((attempt) =>
      attempt.provenance.activity !== plan.normalizedIntent.activity ||
      attempt.provenance.routeType !== plan.normalizedIntent.routeType
    )) {
      context.record("intent_not_preserved", "route_verification");
    }
  }
  if (expected.deterministic === true) {
    const repeated = await runRouting();
    if (
      serializeResearchGuidedRoutedAlternativesV1(validated) !==
      serializeResearchGuidedRoutedAlternativesV1(repeated)
    ) {
      context.record("determinism_mismatch", "determinism");
    }
  }
}

async function evaluateContractCase(context) {
  const { input, expected } = context.evaluationCase;
  const scenario = input.scenario;
  if (scenario === "dossier_round_trip") {
    const dossier = syntheticAdventureResearchDossierV1({
      region: context.evaluationCase.region,
      intent: input.intent ?? {}
    });
    const validated = validateAdventureResearchDossierV1(dossier);
    context.state = "ready";
    if (JSON.stringify(validated) !== JSON.stringify(
      validateAdventureResearchDossierV1(dossier)
    )) {
      context.record("determinism_mismatch", "determinism");
    }
  } else if (scenario === "no_safety_or_scenic_predicate") {
    context.state = "partial";
    if (
      EVIDENCE_PREDICATES.includes("scenic_quality") ||
      EVIDENCE_PREDICATES.includes("safety") ||
      EVIDENCE_PREDICATES.includes("child_suitability")
    ) {
      context.record("fabricated_claim_accepted", "false_claim");
    }
  } else if (scenario === "routed_state_requires_geometry") {
    const response = {
      schemaVersion: 1,
      policyVersion: OUTDOOR_ADVENTURE_ORCHESTRATION_POLICY_V1.policyVersion,
      state: "routed",
      normalizedIntent: syntheticAdventureResearchIntentV1({
        region: context.evaluationCase.region
      }),
      planningGaps: [],
      clarificationQuestions: [],
      routedAlternatives: null
    };
    context.state = "unsupported";
    if (!throws(() => validateOutdoorAdventurePlanningResponseV1(response))) {
      context.record("route_not_verified", "route_verification");
    }
  } else if (scenario === "policy_bounds") {
    context.state = "ready";
    if (
      RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V1.limits.maximumProposals !== 6 ||
      RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V1
        .limits.maximumViaCandidatesPerProposal !== 5 ||
      RESEARCH_GUIDED_ROUTED_ALTERNATIVES_POLICY_V1
        .limits.waypointVisitToleranceMeters !== 100
    ) {
      context.record("bounds_not_enforced", "bounds");
    }
  } else if (scenario === "dossier_assembly") {
    const intent = syntheticAdventureResearchIntentV1({
      region: context.evaluationCase.region,
      intent: {
        mustHaveExperiences: [
          { experience: "viewpoint", minimumCount: 1 }
        ]
      }
    });
    const claim = syntheticEvidenceClaimV1({
      predicate: "entity_category",
      category: "viewpoint",
      source: "mapped"
    });
    const dossier = assembleAdventureResearchDossierV1({
      normalizedIntent: intent,
      planningGaps: [],
      binding: {
        regionEntityId: intent.geographicAnchor.regionEntityId
      },
      snapshot: {
        boundaryDistanceMeters: 50_000,
        sourceDataAt: "2026-07-22T09:00:00Z",
        freshnessLimitMilliseconds: 86_400_000
      },
      searchRadiusMeters: 10_000,
      generatedAt: SYNTHETIC_EVALUATION_CLOCK_V1,
      evidenceRecords: [{
        claim,
        sourceMetadata: {
          sourceId: claim.sourceReference.sourceId,
          sourceKey: claim.sourceReference.sourceKey,
          sourceCategory: claim.sourceReference.sourceCategory,
          evidenceClass: claim.evidenceClass,
          licenseIdentifier: "synthetic-evaluation-only",
          attributionRequired: false,
          retrievedAt: claim.retrievedAt
        },
        entityCategory: "viewpoint",
        coordinate: { latitude: 51.81, longitude: 10.62 },
        distanceMeters: 1_000,
        relationship: false
      }]
    });
    context.state = "ready";
    if (
      dossier.candidateHighlights.length !== 1 ||
      dossier.evidenceClaims.length !== 1 ||
      dossier.sourceProvenanceSummary.length !== 1
    ) {
      context.record("provenance_not_preserved", "provenance");
    }
  } else if (scenario === "invalid_intent_direct") {
    const intent = mutatedIntent(
      syntheticAdventureResearchIntentV1({
        region: context.evaluationCase.region
      }),
      input.mutation
    );
    context.state = "unsupported";
    if (!throws(() => validateAdventureResearchIntentV1(intent))) {
      context.record("contract_not_rejected", "bounds");
    }
  } else if (scenario === "summary_vocabulary_boundary") {
    context.state = "ready";
    const sentinel = "synthetic-secret-redaction-sentinel";
    try {
      throw new Error(sentinel);
    } catch {
      const boundedCode = "evaluation_exception";
      if (boundedCode.includes(sentinel)) {
        context.record("fabricated_claim_accepted", "provenance");
      }
    }
  } else {
    context.state = "unsupported";
    context.record("contract_not_rejected", "bounds");
  }
  if (expected.rejected === true && context.state !== "unsupported") {
    context.record("contract_not_rejected", "bounds");
  }
}

function createEvaluationContext(evaluationCase) {
  const errorCodes = new Set();
  const violations = [];
  return {
    evaluationCase,
    state: "unsupported",
    record(errorCode, violationKind) {
      errorCodes.add(errorCode);
      if (violationKind) violations.push(violationKind);
    },
    result() {
      return {
        id: evaluationCase.id,
        category: evaluationCase.category,
        state: this.state,
        passed: errorCodes.size === 0,
        skipped: false,
        errorCodes: [...errorCodes].sort(),
        violations: [...violations].sort()
      };
    }
  };
}

function capabilitiesFor(mode) {
  const capabilities = syntheticEvaluationCapabilitiesV1();
  if (mode === "missing_operational_coverage") {
    return { ...capabilities, supportedRegionIds: [] };
  }
  if (mode === "missing_mapped_source") {
    return {
      ...capabilities,
      availableSourceCategories:
        capabilities.availableSourceCategories.filter(
          (value) => value !== "openstreetmap_open_mapping"
        )
    };
  }
  if (mode === "missing_official_source") {
    return {
      ...capabilities,
      availableSourceCategories:
        capabilities.availableSourceCategories.filter(
          (value) =>
            value !== "official_authority" &&
            value !== "official_operator"
        )
    };
  }
  if (mode === "missing_current_operation") {
    return {
      ...capabilities,
      enabledOperationTypes: capabilities.enabledOperationTypes.filter(
        (value) => value !== "check_current_status"
      )
    };
  }
  if (mode === "missing_closure_predicate") {
    return {
      ...capabilities,
      supportedEvidencePredicates:
        capabilities.supportedEvidencePredicates.filter(
          (value) => value !== "closure_status"
        )
    };
  }
  return capabilities;
}

function mutatedIntent(intent, mutation) {
  if (!mutation) return intent;
  const mutated = structuredClone(intent);
  if (mutation === "unknown_field") mutated.unknownField = true;
  if (mutation === "duplicate_must_have") {
    mutated.mustHaveExperiences = [
      { experience: "viewpoint", minimumCount: 1 },
      { experience: "viewpoint", minimumCount: 2 }
    ];
  }
  if (mutation === "impossible_date") {
    mutated.dateOrSeason = { kind: "date", date: "2026-02-30" };
  }
  if (mutation === "invalid_coordinate") {
    mutated.geographicAnchor.coordinate.latitude = 120;
  }
  if (mutation === "nan_elevation") {
    mutated.maximumElevationGainMeters = Number.NaN;
  }
  if (mutation === "infinite_distance") {
    mutated.distanceRangeKm = { min: 1, max: Number.POSITIVE_INFINITY };
  }
  if (mutation === "oversized_preferences") {
    mutated.preferredExperiences = Array.from(
      { length: OUTDOOR_RESEARCH_LIMITS.maximumIntentItems + 1 },
      (_, index) => index % 2 === 0 ? "viewpoint" : "lake"
    );
  }
  return mutated;
}

function mutateClaims(claims, mutation) {
  if (!mutation) return claims;
  if (mutation === "oversized_claim_array") {
    return Array.from(
      { length: OUTDOOR_RESEARCH_LIMITS.maximumEvidenceClaims + 1 },
      (_, index) => syntheticEvidenceClaimV1({
        claimId: stableDirectUuid(8, index + 1),
        entityId: stableDirectUuid(9, index + 1)
      }, index + 1)
    );
  }
  const mutated = structuredClone(claims);
  if (mutation === "missing_provenance") delete mutated[0].provenance;
  if (mutation === "unknown_field") mutated[0].rawProviderPayload = true;
  if (mutation === "invalid_timestamp") {
    mutated[0].retrievedAt = "not-a-timestamp";
  }
  if (mutation === "fabricated_mapped_known") {
    mutated[0] = syntheticEvidenceClaimV1({
      predicate: "closure_status",
      source: "mapped",
      resolutionState: "known",
      value: { type: "text", value: "open" }
    }, 1);
  }
  if (mutation === "invalid_value") {
    mutated[0].value = { type: "text", value: "definitely_safe" };
  }
  return mutated;
}

function candidateDossierSpec(input, region) {
  const categories = input.candidateCategories ??
    Array.from(
      { length: input.candidateCount ?? 1 },
      () => "viewpoint"
    );
  return {
    region: input.region ?? region,
    intent: input.intent ?? {
      mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 1 }],
      preferredExperiences: [],
      avoidedExperiences: [],
      requiredFacilities: [],
      maximumTechnicalDifficulty: null,
      dateOrSeason: null,
      durationRangeMinutes: null,
      groupContext: {
        partySize: 1,
        includesChildren: false,
        youngestAge: null,
        mobility: "standard",
        experienceLevel: "intermediate"
      }
    },
    candidates: categories.map((category, index) => ({
      category,
      coordinate: region === "innsbruck_alps"
        ? {
          latitude: 47.27 + index * 0.01,
          longitude: 11.41 + index * 0.015
        }
        : {
          latitude: 51.81 + index * 0.01,
          longitude: 10.62 + index * 0.015
        }
    })),
    mappedRoute: input.mappedRoute === true,
    coverageState: input.coverageState ?? "full",
    evidenceGaps: input.evidenceGaps ?? [],
    freshnessState: input.freshnessState ?? "current"
  };
}

function mutatedDossier(dossier, mutation) {
  if (!mutation) return dossier;
  const mutated = structuredClone(dossier);
  if (mutation === "unknown_field") mutated.rawPrompt = "forbidden";
  if (mutation === "duplicate_claim_id") {
    mutated.evidenceClaims.push(structuredClone(mutated.evidenceClaims[0]));
  }
  if (mutation === "missing_provenance") {
    delete mutated.evidenceClaims[0].provenance;
  }
  if (mutation === "invalid_coordinate") {
    mutated.candidateHighlights[0].coordinate.longitude = 190;
  }
  if (mutation === "nan_coordinate") {
    mutated.candidateHighlights[0].coordinate.latitude = Number.NaN;
  }
  if (mutation === "infinite_coordinate") {
    mutated.candidateHighlights[0].coordinate.longitude =
      Number.POSITIVE_INFINITY;
  }
  if (mutation === "oversized_candidates") {
    mutated.candidateHighlights = Array.from(
      { length: OUTDOOR_RESEARCH_LIMITS.maximumHighlightCandidates + 1 },
      () => structuredClone(mutated.candidateHighlights[0])
    );
  }
  return mutated;
}

function mutateCandidatePlan(plan, mutation) {
  if (!mutation) return plan;
  const mutated = structuredClone(plan);
  if (mutation === "unknown_field") mutated.rawDossier = true;
  if (mutation === "duplicate_proposal_id" && mutated.proposals.length > 0) {
    mutated.proposals.push(structuredClone(mutated.proposals[0]));
  }
  if (mutation === "duplicate_evidence_reference") {
    mutated.proposals[0].evidenceClaimIds.push(
      mutated.proposals[0].evidenceClaimIds[0]
    );
  }
  return mutated;
}

function syntheticProvider(behavior = "success") {
  let callCount = 0;
  return {
    async route(request) {
      callCount += 1;
      if (behavior === "all_failure") throw routeError("route_not_found");
      if (behavior === "first_failure" && callCount === 1) {
        throw routeError("route_not_found");
      }
      if (behavior === "malformed") {
        return syntheticGraphHopperResponseV1(request, { malformed: true });
      }
      if (behavior === "empty") {
        return syntheticGraphHopperResponseV1(request, { empty: true });
      }
      if (behavior === "excessive_snap") {
        return syntheticGraphHopperResponseV1(request, {
          snapOffsetDegrees: 0.02
        });
      }
      return syntheticGraphHopperResponseV1(request);
    }
  };
}

function mutateRoutedEnvelope(envelope, mutation) {
  if (!mutation) return envelope;
  const mutated = structuredClone(envelope);
  if (mutation === "unknown_field") mutated.providerPayload = true;
  if (mutation === "missing_geometry_provenance") {
    delete mutated.attempts[0].routeResults[0].geometryProvider;
  }
  if (mutation === "research_replaces_routing_provenance") {
    mutated.attempts[0].routeResults[0].geometryProvider = "research";
  }
  if (mutation === "wrong_evidence_association") {
    mutated.attempts[0].provenance.evidenceClaimIds = [
      stableDirectUuid(7, 77)
    ];
  }
  if (mutation === "empty_attempts_but_routed") mutated.attempts = [];
  if (mutation === "duplicate_result_id") {
    mutated.attempts[0].routeResults.push(
      structuredClone(mutated.attempts[0].routeResults[0])
    );
  }
  return mutated;
}

function plannerOutcomeState(state) {
  if (state === "ready") return "ready";
  if (state === "clarification_required") return "clarification";
  return "unsupported";
}

function candidateOutcomeState(state) {
  if (state === "unsupported") return "unsupported";
  if (state === "ready") return "ready";
  return "partial";
}

function routingOutcomeState(state) {
  if (state === "routed") return "ready";
  if (state === "unsupported") return "unsupported";
  return "partial";
}

function isSubset(actual, expected) {
  if (Array.isArray(expected)) return sameValue(actual, expected);
  if (!expected || typeof expected !== "object") return actual === expected;
  return Object.entries(expected).every(([key, value]) =>
    Object.hasOwn(actual, key) && isSubset(actual[key], value)
  );
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function recursivelyHasAnyKey(value, keys) {
  if (Array.isArray(value)) {
    return value.some((item) => recursivelyHasAnyKey(item, keys));
  }
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    keys.includes(key) || recursivelyHasAnyKey(child, keys)
  );
}

function throws(action) {
  try {
    action();
    return false;
  } catch {
    return true;
  }
}

function stableDirectUuid(namespace, index) {
  return `${String(namespace).padStart(8, "0")}-0000-4000-8000-${String(index)
    .padStart(12, "0")}`;
}
