import {
  analyzeRouteGeometryV1,
  pairwiseSimilarityV1
} from "../outdoorAdventureServerLiveProof/quality.js";
import {
  V4_CASE_BINDINGS,
  sha256V4,
  V4ProofContractError
} from "./contract.js";

const MAXIMUM_TECHNICAL_DISTANCE_RATIO = 1.75;
const MINIMUM_TECHNICAL_DISTANCE_RATIO = 0.55;
const MAXIMUM_TECHNICAL_DURATION_RATIO = 2.5;
const MINIMUM_TECHNICAL_DURATION_RATIO = 0.4;
const MAXIMUM_TECHNICAL_REPETITION = 0.55;
const MINIMUM_LOOP_SHAPE = 0.025;
const MAXIMUM_PRODUCT_REPETITION = 0.35;
const NEAR_DUPLICATE_SIMILARITY = 0.86;
const REQUIRED_HIGHLIGHT_ROLES = new Set([
  "must_have", "facility_candidate", "overnight_candidate"
]);

export async function evaluateV4Case({
  evaluationCase,
  routedAlternatives,
  observedPlanningState,
  providerExecuted,
  providerAttemptCount,
  controlledProviderState = null,
  regionContainsRoute = async () => false,
  falseClaimCountForRoute = () => 0
}) {
  const binding = V4_CASE_BINDINGS.find((item) =>
    item.caseId === evaluationCase?.id
  );
  if (!binding || typeof regionContainsRoute !== "function" ||
      typeof falseClaimCountForRoute !== "function" ||
      typeof providerExecuted !== "boolean" ||
      !Number.isInteger(providerAttemptCount) || providerAttemptCount < 0 ||
      providerAttemptCount > 3) invalid();
  const routed = routedAlternatives?.attempts?.flatMap((attempt) =>
    attempt.routeResults.map((result) => ({ attempt, result }))
  ) ?? [];
  const evaluated = [];
  for (const item of routed) {
    evaluated.push(await evaluateRoute({
      ...item,
      evaluationCase,
      binding,
      regionContainsRoute,
      falseClaimCountForRoute
    }));
  }
  const selected = selectDistinctTechnicalRoutes(evaluated, binding);
  const selectedIds = new Set(selected.map((item) => item.resultDigest));
  const routes = evaluated.map(({ _geometry, ...route }) => ({
    ...route,
    selected: selectedIds.has(route.resultDigest)
  }));
  const technicalRoutes = routes.filter((route) => route.technicalEligible);
  const productRoutes = routes.filter((route) =>
    qualifiesForProductPass(route, binding)
  );
  const technicalPipelineOutcome = !providerExecuted
    ? "not_run" : technicalRoutes.length > 0 ? "pass" : "fail";
  let productQualityOutcome;
  if (!providerExecuted) {
    productQualityOutcome = "not_applicable";
  } else if (productRoutes.length > 0) {
    productQualityOutcome = "pass";
  } else if (routes.length > 0 && observedPlanningState === "partial") {
    productQualityOutcome = "partial";
  } else {
    productQualityOutcome = "fail";
  }
  const caseEvaluationOutcome =
    observedPlanningState === binding.expectedPlanningState &&
    technicalPipelineOutcome === binding.expectedTechnicalPipelineOutcome &&
    productQualityOutcome === binding.expectedProductQualityOutcome
      ? "pass" : "fail";
  const controlledSurvivor = binding.controlledSurvivor
    ? controlledSurvivorRecord({
      controlledProviderState,
      technicalRoutes,
      productRoutes
    })
    : null;
  return Object.freeze({
    caseId: binding.caseId,
    goldenCaseId: binding.goldenCaseId,
    fixtureDigest: binding.fixtureDigest,
    goldenCaseDigest: binding.goldenCaseDigest,
    executed: true,
    skipped: false,
    providerExecuted,
    observedPlanningState,
    expectedPlanningState: binding.expectedPlanningState,
    technicalPipelineOutcome,
    expectedTechnicalPipelineOutcome:
      binding.expectedTechnicalPipelineOutcome,
    productQualityOutcome,
    expectedProductQualityOutcome:
      binding.expectedProductQualityOutcome,
    caseEvaluationOutcome,
    providerAttemptCount,
    routes: Object.freeze(routes),
    controlledSurvivor,
    manualExpertReview: "not_completed"
  });
}

export function notRunV4CaseRecord(caseId, reasonCode) {
  const binding = V4_CASE_BINDINGS.find((item) => item.caseId === caseId);
  if (!binding || typeof reasonCode !== "string" || reasonCode.length < 1) {
    invalid();
  }
  return Object.freeze({
    caseId: binding.caseId,
    goldenCaseId: binding.goldenCaseId,
    fixtureDigest: binding.fixtureDigest,
    goldenCaseDigest: binding.goldenCaseDigest,
    executed: true,
    skipped: false,
    providerExecuted: false,
    observedPlanningState: "not_run",
    expectedPlanningState: binding.expectedPlanningState,
    technicalPipelineOutcome: "not_run",
    expectedTechnicalPipelineOutcome:
      binding.expectedTechnicalPipelineOutcome,
    productQualityOutcome: "not_applicable",
    expectedProductQualityOutcome:
      binding.expectedProductQualityOutcome,
    caseEvaluationOutcome: "fail",
    providerAttemptCount: 0,
    routes: Object.freeze([]),
    controlledSurvivor: binding.controlledSurvivor
      ? Object.freeze({
        injectionArmed: false,
        genuineProviderSuccessBeforeInjection: false,
        successRelabelledAsFailure: false,
        independentSurvivorTechnicalPass: false,
        independentSurvivorProductPass: false,
        resultCode: reasonCode
      })
      : null,
    manualExpertReview: "not_completed"
  });
}

async function evaluateRoute({
  attempt,
  result,
  evaluationCase,
  binding,
  regionContainsRoute,
  falseClaimCountForRoute
}) {
  let analysis;
  try {
    analysis = analyzeRouteGeometryV1(result.path.points.coordinates);
  } catch {
    analysis = null;
  }
  const path = result?.path;
  const distanceKm = finiteOr(path?.distance / 1_000, 0);
  const durationMinutes = finiteOr(path?.time / 60_000, 0);
  const ascentMeters = finiteOr(path?.ascend, 0);
  const descentMeters = finiteOr(path?.descend, 0);
  const technicalDistanceRatio = evaluationCase.input.targetDistanceKm > 0
    ? distanceKm / evaluationCase.input.targetDistanceKm : 1;
  const technicalDurationTarget =
    Number.isFinite(evaluationCase.input.targetDurationMinutes)
      ? evaluationCase.input.targetDurationMinutes : null;
  const technicalDurationRatio = technicalDurationTarget === null
    ? 1 : durationMinutes / technicalDurationTarget;
  const distanceStructuralFit = technicalDistanceRatio >=
    MINIMUM_TECHNICAL_DISTANCE_RATIO && technicalDistanceRatio <=
      MAXIMUM_TECHNICAL_DISTANCE_RATIO;
  const durationStructuralFit = technicalDurationRatio >=
    MINIMUM_TECHNICAL_DURATION_RATIO && technicalDurationRatio <=
      MAXIMUM_TECHNICAL_DURATION_RATIO;
  const distanceProductFit = withinRange(
    distanceKm, binding.distanceRangeKm
  );
  const durationProductFit = binding.durationRangeMinutes === null
    ? null : withinRange(durationMinutes, binding.durationRangeMinutes);
  const highlights = Array.isArray(attempt?.provenance?.selectedHighlights)
    ? attempt.provenance.selectedHighlights : [];
  const verifications = Array.isArray(result?.highlightVerifications)
    ? result.highlightVerifications : [];
  const requiredHighlights = highlights.filter((item) =>
    REQUIRED_HIGHLIGHT_ROLES.has(item?.role)
  );
  const requiredVerifications = requiredHighlights.flatMap((highlight) => {
    const verification = verifications.find((item) =>
      item?.entityId === highlight?.entityId
    );
    return verification ? [verification] : [];
  });
  const highlightApproachStates = requiredVerifications.map((item) =>
    item.approachState
  );
  const strictlyReachedRequiredHighlightCount =
    highlightApproachStates.filter((state) => state === "reached").length;
  const accessLineageComplete = completeAccessLineage({
    attempt, result, highlights, verifications,
    requiredHighlightCount: binding.requiredHighlightCount
  });
  const provenanceComplete = completeProvenance(attempt, result);
  const waypointOrderVerified = orderedWaypoints(result);
  const regionContained = analysis !== null && await regionContainsRoute(
    result.path.points.coordinates,
    evaluationCase.id
  ) === true;
  const characteristics = technicalCharacteristics(
    path?.details ?? {}, analysis?.decoded ?? []
  );
  const difficultyCompatible = binding.requiresVerifiedEasyDifficulty
    ? characteristics.hikeRatingCoverageRatio >= 0.60 &&
      characteristics.maximumKnownHikeRating !== null &&
      characteristics.maximumKnownHikeRating <= 1 &&
      characteristics.demandingTechnicalDistanceMeters < 100
    : true;
  const falseClaimCount = falseClaimCountForRoute({
    attempt, result, evaluationCase, binding
  });
  const providerSnaps = (result?.waypointSnaps ?? []).flatMap((item) =>
    Number.isFinite(item?.snapDistanceMeters) ? [item.snapDistanceMeters] : []
  );
  const routeToAccessDistances = verifications.flatMap((item) =>
    Number.isFinite(item?.routeGeometryDistanceToAccessMeters)
      ? [item.routeGeometryDistanceToAccessMeters] : []
  );
  const routeToEvidenceDistances = verifications.flatMap((item) =>
    Number.isFinite(item?.routeGeometryDistanceToEvidenceMeters)
      ? [item.routeGeometryDistanceToEvidenceMeters] : []
  );
  const verifiedGeometry = analysis !== null &&
    analysis.decoded.length >= 4 && analysis.geometryLengthMeters >= 100 &&
    Number.isFinite(path?.distance) && path.distance > 0 &&
    Number.isFinite(path?.time) && path.time > 0;
  const loopClosureVerified = analysis?.isClosedLoop === true;
  const selfBacktrackingRatio = round(analysis?.selfBacktrackingRatio ?? 1, 4);
  const selfOverlapRatio = round(analysis?.selfOverlapRatio ?? 1, 4);
  const loopShapeQuality = round(analysis?.shapeQuality ?? 0, 4);
  const rejectionCodes = [];
  if (!verifiedGeometry) rejectionCodes.push("invalid_geometry");
  if (!loopClosureVerified) rejectionCodes.push("open_loop");
  if (!regionContained) rejectionCodes.push("outside_region");
  if (!provenanceComplete) rejectionCodes.push("incomplete_provenance");
  if (!accessLineageComplete) rejectionCodes.push("incomplete_access_lineage");
  if (!waypointOrderVerified) rejectionCodes.push("waypoint_order_invalid");
  if (!distanceStructuralFit) rejectionCodes.push("distance_outside_structural_envelope");
  if (!durationStructuralFit) rejectionCodes.push("duration_outside_structural_envelope");
  if (selfBacktrackingRatio > MAXIMUM_TECHNICAL_REPETITION) {
    rejectionCodes.push("excessive_backtracking");
  }
  if (selfOverlapRatio > MAXIMUM_TECHNICAL_REPETITION) {
    rejectionCodes.push("excessive_overlap");
  }
  if (loopShapeQuality < MINIMUM_LOOP_SHAPE) {
    rejectionCodes.push("degenerate_loop_shape");
  }
  if (strictlyReachedRequiredHighlightCount !==
      binding.requiredHighlightCount) {
    rejectionCodes.push("required_highlight_not_reached");
  }
  if (requiredHighlights.length !== binding.requiredHighlightCount) {
    rejectionCodes.push("required_highlight_selection_count_mismatch");
  }
  if (binding.requiresVerifiedEasyDifficulty && !difficultyCompatible) {
    rejectionCodes.push("difficulty_above_or_unverified_for_easy_request");
  }
  if (binding.maximumElevationGainMeters !== null &&
      ascentMeters > binding.maximumElevationGainMeters) {
    rejectionCodes.push("maximum_elevation_gain_exceeded");
  }
  if (falseClaimCount !== 0) rejectionCodes.push("forbidden_claim");
  const technicalEligible = rejectionCodes.length === 0;
  const limitationCodes = new Set([
    ...(attempt?.provenance?.knownLimitations ?? []),
    ...(!distanceProductFit ? ["target_distance_not_met"] : []),
    ...(durationProductFit === false ? ["target_duration_not_met"] : []),
    ...(selfBacktrackingRatio > MAXIMUM_PRODUCT_REPETITION
      ? ["product_backtracking_above_35_percent"] : []),
    ...(selfOverlapRatio > MAXIMUM_PRODUCT_REPETITION
      ? ["product_overlap_above_35_percent"] : []),
    ...(!difficultyCompatible ? ["difficulty_not_verified_compatible"] : []),
    ...(binding.maximumElevationGainMeters !== null &&
        ascentMeters > binding.maximumElevationGainMeters
      ? ["maximum_elevation_gain_exceeded"] : [])
  ]);
  const route = {
    resultDigest: `result_${sha256V4({
      caseId: binding.caseId,
      routeResultId: result?.routeResultId,
      distanceMeters: Math.round(path?.distance ?? 0),
      durationMilliseconds: Math.round(path?.time ?? 0)
    }).slice(0, 24)}`,
    technicalEligible,
    selected: false,
    verifiedGeometry,
    regionContained,
    provenanceComplete,
    accessLineageComplete,
    waypointOrderVerified,
    loopClosureVerified,
    distanceStructuralFit,
    durationStructuralFit,
    distanceKm: round(distanceKm, 3),
    durationMinutes: round(durationMinutes, 1),
    ascentMeters: round(ascentMeters, 1),
    descentMeters: round(descentMeters, 1),
    targetDistanceDeviationRatio: round(Math.abs(
      technicalDistanceRatio - 1
    ), 4),
    targetDurationDeviationRatio: technicalDurationTarget === null
      ? null : round(Math.abs(technicalDurationRatio - 1), 4),
    maximumProviderSnapDistanceMeters: round(maximum(providerSnaps), 1),
    aggregateProviderSnapDistanceMeters: round(sum(providerSnaps), 1),
    maximumRouteToAccessDistanceMeters:
      nullableRoundedMaximum(routeToAccessDistances),
    maximumRouteToEvidenceDistanceMeters:
      nullableRoundedMaximum(routeToEvidenceDistances),
    providerSnapCount: providerSnaps.length,
    selectedWaypointCount: highlights.length,
    reachedWaypointCount: verifications.filter((item) =>
      item?.approachState === "reached"
    ).length,
    selfBacktrackingRatio,
    selfOverlapRatio,
    loopShapeQuality,
    distanceProductFit,
    durationProductFit,
    difficultyCompatible,
    requiredHighlightCount: binding.requiredHighlightCount,
    selectedRequiredHighlightCount: requiredHighlights.length,
    strictlyReachedRequiredHighlightCount,
    highlightApproachStates: Object.freeze(highlightApproachStates),
    allHighlightApproachStates: Object.freeze(verifications.map((item) =>
      item.approachState
    )),
    evidenceLineageDigest: `lineage_${sha256V4(highlights.map((item) => ({
      entityId: item?.entityId,
      evidenceClaimIds: item?.evidenceClaimIds
    }))).slice(0, 24)}`,
    accessLineageDigest: `lineage_${sha256V4(highlights.map((item) => ({
      entityId: item?.entityId,
      candidateId: item?.trailAccessCandidate?.candidateId,
      sourceTrailSegmentEntityId:
        item?.trailAccessCandidate?.sourceTrailSegmentEntityId,
      sourceTrailCategoryEvidenceClaimIds:
        item?.trailAccessCandidate?.sourceTrailCategoryEvidenceClaimIds
    }))).slice(0, 24)}`,
    falseClaimCount,
    rejectionCodes: Object.freeze([...new Set(rejectionCodes)].sort()),
    limitationCodes: Object.freeze([...limitationCodes].sort()),
    _geometry: result.path.points.coordinates
  };
  route.providerResultClassification = route.technicalEligible
    ? "technically_eligible" : "rejected_by_quality_policy";
  return Object.freeze(route);
}

function completeAccessLineage({
  attempt,
  result,
  highlights,
  verifications,
  requiredHighlightCount
}) {
  if (requiredHighlightCount > highlights.length ||
      requiredHighlightCount > verifications.length ||
      highlights.length !== verifications.length) return false;
  return highlights.every((highlight, index) => {
    const access = highlight?.trailAccessCandidate;
    const verification = verifications[index];
    return typeof highlight?.entityId === "string" &&
      typeof access?.candidateId === "string" &&
      access.originalHighlightEntityId === highlight.entityId &&
      typeof access.sourceTrailSegmentEntityId === "string" &&
      Array.isArray(access.sourceTrailCategoryEvidenceClaimIds) &&
      access.sourceTrailCategoryEvidenceClaimIds.length > 0 &&
      verification?.entityId === highlight.entityId &&
      Number.isFinite(verification.providerSnapDistanceMeters) &&
      Number.isFinite(verification.routeGeometryDistanceToAccessMeters) &&
      Number.isFinite(verification.routeGeometryDistanceToEvidenceMeters) &&
      typeof attempt?.attemptId === "string" &&
      typeof result?.routeResultId === "string";
  });
}

function completeProvenance(attempt, result) {
  const provenance = attempt?.provenance;
  return typeof attempt?.attemptId === "string" &&
    typeof result?.routeResultId === "string" &&
    typeof provenance?.lineageId === "string" &&
    typeof provenance?.proposalId === "string" &&
    typeof provenance?.sourceProposalId === "string" &&
    typeof provenance?.sourceCandidatePlanPolicyVersion === "string" &&
    typeof provenance?.trailAccessPolicyVersion === "string" &&
    Array.isArray(provenance?.evidenceClaimIds) &&
    provenance.evidenceClaimIds.length > 0;
}

function orderedWaypoints(result) {
  return Array.isArray(result?.waypointSnaps) &&
    result.waypointSnaps.every((item, index) =>
      item?.waypointIndex === index
    ) && Array.isArray(result?.highlightVerifications) &&
    result.highlightVerifications.every((item, index) =>
      item?.highlightIndex === index
    );
}

function selectDistinctTechnicalRoutes(routes, binding) {
  const ordered = routes.filter((route) => route.technicalEligible)
    .sort((left, right) =>
      distanceDelta(left.distanceKm, binding.distanceRangeKm) -
        distanceDelta(right.distanceKm, binding.distanceRangeKm) ||
      left.selfBacktrackingRatio - right.selfBacktrackingRatio ||
      left.selfOverlapRatio - right.selfOverlapRatio ||
      left.resultDigest.localeCompare(right.resultDigest)
    );
  const selected = [];
  for (const route of ordered) {
    if (selected.some((prior) =>
      pairwiseSimilarityV1(route._geometry, prior._geometry) >=
        NEAR_DUPLICATE_SIMILARITY
    )) continue;
    selected.push(route);
    if (selected.length === 3) break;
  }
  return selected;
}

function qualifiesForProductPass(route, binding) {
  return route.technicalEligible && route.selected &&
    route.distanceProductFit &&
    (binding.durationRangeMinutes === null || route.durationProductFit) &&
    route.selfBacktrackingRatio <= MAXIMUM_PRODUCT_REPETITION &&
    route.selfOverlapRatio <= MAXIMUM_PRODUCT_REPETITION &&
    route.strictlyReachedRequiredHighlightCount ===
      binding.requiredHighlightCount &&
    route.highlightApproachStates.every((state) => state === "reached") &&
    (!binding.requiresVerifiedEasyDifficulty || route.difficultyCompatible) &&
    (binding.maximumElevationGainMeters === null ||
      route.ascentMeters <= binding.maximumElevationGainMeters) &&
    route.falseClaimCount === 0;
}

function controlledSurvivorRecord({
  controlledProviderState,
  technicalRoutes,
  productRoutes
}) {
  const state = controlledProviderState ?? {};
  return Object.freeze({
    injectionArmed: state.injectionArmed === true,
    genuineProviderSuccessBeforeInjection:
      state.genuineProviderSuccessBeforeInjection === true,
    successRelabelledAsFailure: false,
    independentSurvivorTechnicalPass: technicalRoutes.length > 0,
    independentSurvivorProductPass: productRoutes.length > 0,
    resultCode: productRoutes.length > 0
      ? "independent_product_survivor"
      : technicalRoutes.length > 0
        ? "technical_survivor_only"
        : "no_independent_survivor"
  });
}

function technicalCharacteristics(details, coordinates) {
  const segmentDistances = coordinates.slice(1).map((point, index) =>
    haversine(coordinates[index], point)
  );
  const segmentRatings = Array(segmentDistances.length).fill(null);
  for (const detail of Array.isArray(details.hike_rating)
    ? details.hike_rating : []) {
    if (!Array.isArray(detail) || detail.length !== 3) continue;
    const rating = Number.parseInt(String(detail[2]), 10);
    if (!Number.isInteger(rating) || rating < 1 || rating > 6) continue;
    const from = Math.max(0, Math.min(segmentDistances.length, detail[0]));
    const to = Math.max(from, Math.min(segmentDistances.length, detail[1]));
    for (let index = from; index < to; index += 1) {
      if (segmentRatings[index] === null) segmentRatings[index] = rating;
    }
  }
  let knownMeters = 0;
  let demandingTechnicalDistanceMeters = 0;
  let maximumKnownHikeRating = null;
  segmentRatings.forEach((rating, index) => {
    if (rating === null) return;
    knownMeters += segmentDistances[index];
    maximumKnownHikeRating = Math.max(maximumKnownHikeRating ?? rating, rating);
    if (rating > 1) demandingTechnicalDistanceMeters +=
      segmentDistances[index];
  });
  const totalMeters = Math.max(
    1, segmentDistances.reduce((sum, value) => sum + value, 0)
  );
  return {
    hikeRatingCoverageRatio: knownMeters / totalMeters,
    maximumKnownHikeRating,
    demandingTechnicalDistanceMeters
  };
}

function withinRange(value, range) {
  return range === null || value >= range.min && value <= range.max;
}

function distanceDelta(value, range) {
  if (range === null || withinRange(value, range)) return 0;
  return value < range.min ? range.min - value : value - range.max;
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function maximum(values) {
  return values.length === 0 ? 0 : Math.max(...values);
}

function nullableRoundedMaximum(values) {
  return values.length === 0 ? null : round(maximum(values), 1);
}

function haversine(start, finish) {
  const r = Math.PI / 180;
  const dLat = (finish.latitude - start.latitude) * r;
  const dLon = (finish.longitude - start.longitude) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(start.latitude * r) *
    Math.cos(finish.latitude * r) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(
    Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))
  );
}

function invalid() {
  throw new V4ProofContractError("invalid_v4_quality_input");
}
