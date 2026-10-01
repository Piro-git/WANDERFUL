import { createHash } from "node:crypto";
import { outdoorAdventureOrchestrationError } from "../outdoorAdventure/orchestrationErrors.js";
import { validateResearchGuidedRoutePathV1 } from "../routeResearch/routedAlternativesContract.js";
import { validateRouteRequest } from "../routing/routeValidation.js";
import {
  safeLLMIntentV1,
  validateGeocoderCandidatesV1,
  validateLLMFirstPlanningRequestV1,
  validateLLMRoutePlanV1
} from "./llmFirstPlanningContract.js";
import { LLM_FIRST_PLANNING_POLICY_V1 } from "./llmFirstPlanningPolicy.js";

const POLICY = LLM_FIRST_PLANNING_POLICY_V1;

export const LLM_FIRST_REJECTION_CODES_V1 = Object.freeze([
  "invalid_llm_output",
  "empty_llm_output",
  "llm_provider_failure",
  "llm_timed_out",
  "geocoder_failure",
  "geocoder_timed_out",
  "geocoder_no_results",
  "geocoder_low_confidence",
  "geocoder_ambiguous",
  "implausible_coordinate",
  "duplicate_candidate",
  "duplicate_route",
  "routing_failure",
  "routing_timed_out",
  "invalid_provider_provenance",
  "activity_profile_mismatch",
  "route_type_mismatch",
  "malformed_geometry",
  "invalid_statistics",
  "target_distance_deviation",
  "waypoint_snap_unavailable",
  "waypoint_snap_exceeded",
  "waypoint_not_reached",
  "waypoint_order_invalid",
  "excessive_detour",
  "excessive_backtracking",
  "loop_shape_invalid",
  "point_to_point_shape_invalid",
  "difficulty_evidence_conflict",
  "access_evidence_conflict",
  "fallback_exhausted",
  "clarification_required"
]);

export async function planLLMFirstAdventureV1(
  requestInput,
  dependencies,
  options = {}
) {
  const request = validateLLMFirstPlanningRequestV1(requestInput);
  const deps = validateDependencies(dependencies);
  const settings = validateOptions(options);
  if (settings.signal?.aborted) throw cancelled();

  return withTotalDeadline(settings, deps, async (signal) => {
    let plan;
    try {
      const rawPlan = await boundedOperation(
        (operationSignal) => deps.generatePlan(request, { signal: operationSignal }),
        settings.llmTimeoutMs,
        signal,
        deps
      );
      plan = validateLLMRoutePlanV1(rawPlan);
    } catch (error) {
      if (isCancelled(error, settings.signal, signal)) throw cancelled();
      const code = error instanceof OperationTimedOut || error?.code === "timed_out"
        ? "llm_timed_out"
        : error instanceof TypeError
          ? "invalid_llm_output"
          : "llm_provider_failure";
      return recoveryResponse(null, [rejection("plan", code, "llm")], false);
    }

    if (plan.intent.startLocationName === null ||
        (plan.intent.routeType === "pointToPoint" && plan.intent.endLocationName === null)) {
      return recoveryResponse(plan.intent, [
        rejection("plan", "clarification_required", "intent")
      ], false);
    }

    const prepared = prepareCandidates(plan);
    const resolutions = await resolveNamedLocations(
      plan,
      prepared,
      request,
      deps,
      settings,
      signal
    );
    const rejections = [...prepared.duplicateRejections];
    const routable = [];
    for (const candidate of prepared.uniqueCandidates) {
      const issue = firstResolutionIssue(candidate.queries, resolutions);
      if (issue) {
        rejections.push(rejection(candidate.candidateId, issue, "geocoding"));
      } else {
        routable.push(materializeCandidate(candidate, plan.intent, resolutions));
      }
    }

    const routed = await routeCandidates(routable, deps, settings, signal);
    rejections.push(...routed.rejections);
    let accepted = deduplicateAndRank(routed.accepted, plan.intent, rejections);
    let fallbackAttempted = false;

    if (accepted.length === 0) {
      const fallback = materializeFallback(plan.intent, resolutions);
      if (fallback) {
        fallbackAttempted = true;
        const result = await routeOne(fallback, deps, settings, signal);
        if (result.accepted) accepted = [result.accepted];
        else rejections.push(result.rejection);
      }
    }

    if (accepted.length === 0) {
      if (plan.candidates.length === 0) {
        rejections.unshift(rejection("plan", "empty_llm_output", "llm"));
      }
      if (fallbackAttempted) {
        rejections.push(rejection("fallback", "fallback_exhausted", "fallback"));
      }
      return recoveryResponse(plan.intent, rejections, fallbackAttempted);
    }

    return routedResponse(plan.intent, accepted, rejections, fallbackAttempted);
  });
}

export function evaluateLLMRouteCandidateV1(input) {
  try {
    const maximumWaypointApproachMeters = input.maximumWaypointApproachMeters ??
      POLICY.limits.maximumWaypointApproachMeters;
    if (!Number.isFinite(maximumWaypointApproachMeters) || maximumWaypointApproachMeters <= 0 ||
        maximumWaypointApproachMeters > POLICY.limits.maximumWaypointApproachMeters) {
      reject("malformed_geometry");
    }
    const expectedProfile = profileFor(input.intent.activityType);
    if (input.routeRequest.profile !== expectedProfile) reject("activity_profile_mismatch");
    const expectedRouteType = input.intent.routeType;
    if (input.routeRequest.routeType !== expectedRouteType) reject("route_type_mismatch");
    if (!input.providerResponse || input.providerResponse.provider !== "graphhopper") {
      reject("invalid_provider_provenance");
    }
    if (!Array.isArray(input.providerResponse.paths) || input.providerResponse.paths.length < 1) {
      reject("routing_failure");
    }

    let path;
    try {
      const { snapped_waypoints: _, ...pathInput } = input.providerResponse.paths[0];
      path = validateResearchGuidedRoutePathV1(pathInput);
    } catch {
      reject("malformed_geometry");
    }
    const coordinates = path.points.coordinates.map(decodeCoordinate);
    const geometricDistanceMeters = polylineDistance(coordinates);
    if (!Number.isFinite(geometricDistanceMeters) || geometricDistanceMeters < 10 ||
        path.distance / geometricDistanceMeters < 0.72 ||
        path.distance / geometricDistanceMeters > 1.38) {
      reject("invalid_statistics");
    }
    const instructionDistance = path.instructions.reduce(
      (total, instruction) => total + instruction.distance,
      0
    );
    if (path.instructions.length > 0 && instructionDistance > 0 &&
        (instructionDistance / path.distance < 0.65 ||
         instructionDistance / path.distance > 1.35)) {
      reject("invalid_statistics");
    }

    const snaps = providerSnaps(input.providerResponse.paths[0], input.providerResponse);
    if (!snaps || snaps.length !== input.requestedWaypoints.length) {
      reject("waypoint_snap_unavailable");
    }
    const waypointChecks = verifyWaypoints(input.requestedWaypoints, snaps, coordinates,
      maximumWaypointApproachMeters);

    const target = input.intent.targetDistanceKm;
    const targetDeviationRatio = target === null
      ? null
      : Math.abs(path.distance / 1_000 - target) / target;
    if (targetDeviationRatio !== null &&
        targetDeviationRatio > POLICY.limits.maximumTargetDistanceDeviationRatio) {
      reject("target_distance_deviation");
    }

    if (expectedRouteType === "loop") validateLoopShape(coordinates);
    else validatePointToPointShape(coordinates, input.requestedWaypoints);

    const requestedMinimumDistance = polylineDistance(input.requestedWaypoints);
    const detourRatio = input.routeRequest.algorithm === "round_trip"
      ? 1
      : path.distance / Math.max(requestedMinimumDistance, 1);
    const maximumDetour = expectedRouteType === "loop"
      ? POLICY.limits.maximumLoopDetourRatio
      : POLICY.limits.maximumPointToPointDetourRatio;
    if (detourRatio > maximumDetour) reject("excessive_detour");

    const backtrackingRatio = routeBacktrackingRatio(coordinates);
    const maximumBacktracking = expectedRouteType === "loop"
      ? POLICY.limits.maximumLoopBacktrackingRatio
      : POLICY.limits.maximumPointToPointBacktrackingRatio;
    if (backtrackingRatio > maximumBacktracking) reject("excessive_backtracking");

    validateAvailableDifficultyAndAccessEvidence(path, input.intent);

    return {
      accepted: true,
      path,
      waypointChecks,
      metrics: {
        targetDeviationRatio,
        detourRatio,
        backtrackingRatio
      }
    };
  } catch (error) {
    if (error instanceof CandidateRejected) {
      return { accepted: false, reasonCode: error.reasonCode,
        ...(error.failedWaypointIndex === undefined ? {} : { failedWaypointIndex: error.failedWaypointIndex }) };
    }
    return { accepted: false, reasonCode: "malformed_geometry" };
  }
}

function prepareCandidates(plan) {
  const uniqueCandidates = [];
  const duplicateRejections = [];
  const seen = new Set();
  for (const candidate of plan.candidates) {
    const key = candidateKey(plan.intent, candidate.stops);
    const candidateId = stableId("candidate", key);
    if (seen.has(key)) {
      duplicateRejections.push(rejection(candidateId, "duplicate_candidate", "deduplication"));
      continue;
    }
    seen.add(key);
    uniqueCandidates.push({
      candidateId,
      source: "llm",
      stops: candidate.stops,
      queries: [
        plan.intent.startLocationName,
        ...candidate.stops.map((stop) => stop.name),
        ...(plan.intent.endLocationName ? [plan.intent.endLocationName] : [])
      ]
    });
  }
  return { uniqueCandidates, duplicateRejections };
}

async function resolveNamedLocations(plan, prepared, request, deps, settings, signal) {
  const names = [
    plan.intent.startLocationName,
    ...(plan.intent.endLocationName ? [plan.intent.endLocationName] : []),
    ...prepared.uniqueCandidates.flatMap((candidate) => candidate.stops.map((stop) => stop.name))
  ];
  const queries = [...new Map(names.map((name) => [normalizeName(name), name])).values()];
  const output = new Map();
  let next = 0;
  const worker = async () => {
    while (next < queries.length) {
      if (signal.aborted) throw cancelled();
      const name = queries[next++];
      output.set(normalizeName(name), await resolveOne(name, request, deps, settings, signal));
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(POLICY.limits.maximumConcurrentGeocodes, queries.length) },
    worker
  ));
  return output;
}

async function resolveOne(name, request, deps, settings, signal) {
  try {
    const raw = await boundedOperation(
      (operationSignal) => deps.geocode(name, {
        locale: request.locale,
        userLocationHint: request.userLocationHint,
        signal: operationSignal
      }),
      settings.geocodeTimeoutMs,
      signal,
      deps
    );
    const candidates = validateGeocoderCandidatesV1(raw).sort((left, right) =>
      right.confidence - left.confidence || left.providerRank - right.providerRank ||
      left.displayName.localeCompare(right.displayName, "en")
    );
    if (candidates.length === 0) return { state: "geocoder_no_results" };
    const best = candidates[0];
    if (best.confidence < POLICY.limits.minimumGeocoderConfidence) {
      return { state: "geocoder_low_confidence" };
    }
    const alternative = candidates[1];
    if (alternative && best.confidence - alternative.confidence <
        POLICY.limits.ambiguityConfidenceGap &&
        haversine(best.coordinate, alternative.coordinate) >
          POLICY.limits.ambiguitySeparationMeters) {
      return { state: "geocoder_ambiguous" };
    }
    return { state: "resolved", candidate: best };
  } catch (error) {
    if (signal.aborted) throw cancelled();
    if (error instanceof OperationTimedOut || error?.code === "timed_out") {
      return { state: "geocoder_timed_out" };
    }
    if ([
      "geocoder_no_results", "geocoder_low_confidence", "geocoder_ambiguous"
    ].includes(error?.code)) return { state: error.code };
    if (error instanceof TypeError) return { state: "implausible_coordinate" };
    return { state: "geocoder_failure" };
  }
}

function firstResolutionIssue(queries, resolutions) {
  for (const query of queries) {
    const resolution = resolutions.get(normalizeName(query));
    if (!resolution || resolution.state !== "resolved") {
      return resolution?.state ?? "geocoder_failure";
    }
  }
  return null;
}

function materializeCandidate(candidate, intent, resolutions) {
  const start = resolvedCoordinate(intent.startLocationName, resolutions);
  const stops = candidate.stops.map((stop) => ({
    ...stop,
    displayName: resolvedCandidate(stop.name, resolutions).displayName,
    coordinate: resolvedCoordinate(stop.name, resolutions)
  }));
  const finish = intent.routeType === "loop"
    ? start
    : resolvedCoordinate(intent.endLocationName, resolutions);
  return {
    candidateId: candidate.candidateId,
    source: "llm",
    intent,
    startDisplayName: resolvedCandidate(intent.startLocationName, resolutions).displayName,
    endDisplayName: intent.routeType === "loop"
      ? resolvedCandidate(intent.startLocationName, resolutions).displayName
      : resolvedCandidate(intent.endLocationName, resolutions).displayName,
    stops,
    requestedWaypoints: [start, ...stops.map((stop) => stop.coordinate), finish]
  };
}

function materializeFallback(intent, resolutions) {
  const queries = [
    intent.startLocationName,
    ...(intent.endLocationName ? [intent.endLocationName] : [])
  ];
  if (firstResolutionIssue(queries, resolutions)) return null;
  const start = resolvedCoordinate(intent.startLocationName, resolutions);
  const finish = intent.routeType === "loop"
    ? start
    : resolvedCoordinate(intent.endLocationName, resolutions);
  return {
    candidateId: "fallback",
    source: "fallback",
    intent,
    startDisplayName: resolvedCandidate(intent.startLocationName, resolutions).displayName,
    endDisplayName: intent.routeType === "loop"
      ? resolvedCandidate(intent.startLocationName, resolutions).displayName
      : resolvedCandidate(intent.endLocationName, resolutions).displayName,
    stops: [],
    requestedWaypoints: intent.routeType === "loop" ? [start] : [start, finish]
  };
}

async function routeCandidates(candidates, deps, settings, signal) {
  const accepted = [];
  const rejections = [];
  let next = 0;
  const worker = async () => {
    while (next < candidates.length) {
      if (signal.aborted) throw cancelled();
      const candidate = candidates[next++];
      const result = await routeOne(candidate, deps, settings, signal);
      if (result.accepted) accepted.push(result.accepted);
      else rejections.push(result.rejection);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(settings.maximumConcurrentRoutes, candidates.length) },
    worker
  ));
  return { accepted, rejections };
}

async function routeOne(candidate, deps, settings, signal) {
  try {
    const routeRequest = routeRequestFor(candidate);
    const providerResponse = await boundedOperation(
      (operationSignal) => deps.provider.route(routeRequest, { signal: operationSignal }),
      settings.routeTimeoutMs,
      signal,
      deps
    );
    const evaluation = evaluateLLMRouteCandidateV1({
      intent: candidate.intent,
      routeRequest,
      requestedWaypoints: candidate.requestedWaypoints,
      providerResponse
    });
    if (!evaluation.accepted) {
      return {
        rejection: rejection(candidate.candidateId, evaluation.reasonCode, "eligibility")
      };
    }
    const route = {
      routeId: stableId("route", canonical({
        candidateId: candidate.candidateId,
        profile: routeRequest.profile,
        path: evaluation.path
      })),
      candidateId: candidate.candidateId,
      source: candidate.source,
      geometryProvider: "graphhopper",
      profile: routeRequest.profile,
      routeType: candidate.intent.routeType,
      activityType: candidate.intent.activityType,
      startDisplayName: candidate.startDisplayName,
      endDisplayName: candidate.endDisplayName,
      stops: candidate.stops.map((stop) => ({
        role: stop.role,
        kind: stop.kind,
        displayName: stop.displayName
      })),
      path: evaluation.path,
      waypointChecks: evaluation.waypointChecks,
      metrics: evaluation.metrics,
      limitations: [
        "access_not_verified",
        "current_conditions_unknown",
        "requested_features_unverified",
        "safety_not_verified"
      ]
    };
    return { accepted: route };
  } catch (error) {
    if (signal.aborted) throw cancelled();
    return {
      rejection: rejection(
        candidate.candidateId,
        error instanceof OperationTimedOut ? "routing_timed_out" : "routing_failure",
        "routing"
      )
    };
  }
}

function routeRequestFor(candidate) {
  const intent = candidate.intent;
  const common = {
    profile: profileFor(intent.activityType),
    routeType: intent.routeType,
    points: candidate.requestedWaypoints,
    locale: "en",
    includeElevation: true,
    includeInstructions: true,
    includePathDetails: ["surface", "road_class", "hike_rating"]
  };
  if (candidate.source === "fallback" && intent.routeType === "loop") {
    return validateRouteRequest({
      ...common,
      algorithm: "round_trip",
      roundTrip: {
        distanceMeters: Math.round((intent.targetDistanceKm ?? 10) * 1_000),
        seed: 11
      }
    });
  }
  const preferences = intent.routeType === "pointToPoint" ? {
    activityType: intent.activityType,
    avoid: intent.avoidFeatures.filter((item) => ["majorRoads", "steepClimbs"].includes(item)),
    ...(intent.difficulty === "easy" ? { difficulty: "easy" } : {})
  } : undefined;
  return validateRouteRequest({ ...common, preferences });
}

function verifyWaypoints(requested, snapped, path, maximumApproachMeters) {
  const checks = [];
  let minimumProgress = 0;
  for (let index = 0; index < requested.length; index += 1) {
    const snapDistanceMeters = haversine(requested[index], snapped[index]);
    if (snapDistanceMeters > POLICY.limits.maximumWaypointSnapMeters) {
      reject("waypoint_snap_exceeded", index);
    }
    const approach = closestPathPoint(path, snapped[index], minimumProgress, maximumApproachMeters);
    if (approach.distanceMeters > maximumApproachMeters) {
      const globalApproach = closestPathPoint(path, snapped[index], 0);
      const outOfOrder = globalApproach.distanceMeters <= maximumApproachMeters &&
        globalApproach.progress < minimumProgress;
      reject(outOfOrder ? "waypoint_order_invalid" : "waypoint_not_reached",
        outOfOrder ? undefined : index);
    }
    // A tolerated source-to-snap gap plus a tolerated snap-to-line gap must not
    // double the actual source waypoint's approach allowance.
    const sourceApproach = closestPathPoint(path, requested[index], minimumProgress, maximumApproachMeters);
    if (sourceApproach.distanceMeters > maximumApproachMeters) {
      const globalApproach = closestPathPoint(path, requested[index], 0);
      const outOfOrder = globalApproach.distanceMeters <= maximumApproachMeters &&
        globalApproach.progress < minimumProgress;
      reject(outOfOrder ? "waypoint_order_invalid" : "waypoint_not_reached",
        outOfOrder ? undefined : index);
    }
    minimumProgress = Math.max(approach.progress, sourceApproach.progress);
    checks.push({
      waypointIndex: index,
      snapDistanceMeters: round(snapDistanceMeters, 3),
      routeApproachMeters: round(Math.max(approach.distanceMeters, sourceApproach.distanceMeters), 3),
      routePointIndex: Math.ceil(minimumProgress)
    });
  }
  if (checks.some((check, index) => index > 0 &&
      check.routePointIndex < checks[index - 1].routePointIndex)) {
    reject("waypoint_order_invalid");
  }
  return checks;
}

function providerSnaps(path, response) {
  const geometry = path.snapped_waypoints ?? response.snapped_waypoints;
  if (!geometry || geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) {
    return null;
  }
  try {
    return geometry.coordinates.map(decodeCoordinate);
  } catch {
    reject("implausible_coordinate");
  }
}

function validateLoopShape(coordinates) {
  if (haversine(coordinates[0], coordinates.at(-1)) >
      POLICY.limits.maximumLoopClosureMeters) reject("loop_shape_invalid");
  const spread = coordinates.reduce(
    (maximum, coordinate) => Math.max(maximum, haversine(coordinates[0], coordinate)),
    0
  );
  if (spread < POLICY.limits.minimumLoopSpreadMeters) reject("loop_shape_invalid");
}

function validatePointToPointShape(coordinates, requested) {
  if (requested.length < 2 || haversine(requested[0], requested.at(-1)) < 100 ||
      haversine(coordinates[0], coordinates.at(-1)) < 100) {
    reject("point_to_point_shape_invalid");
  }
}

function validateAvailableDifficultyAndAccessEvidence(path, intent) {
  const details = path.details ?? {};
  if (intent.difficulty === "easy" && (details.hike_rating ?? []).some((entry) => {
    const rating = typeof entry[2] === "number" ? entry[2] : Number(entry[2]);
    return Number.isFinite(rating) && rating >= 3 && entry[1] > entry[0];
  })) reject("difficulty_evidence_conflict");
  if ((details.road_class ?? []).some((entry) =>
    ["motorway", "trunk"].includes(String(entry[2]).toLowerCase()) && entry[1] > entry[0]
  )) reject("access_evidence_conflict");
}

function deduplicateAndRank(routes, intent, rejections) {
  const selected = [];
  const signatures = new Set();
  for (const route of [...routes].sort((left, right) => rank(left, right, intent))) {
    const signature = geometrySignature(route.path.points.coordinates);
    if (signatures.has(signature)) {
      rejections.push(rejection(route.candidateId, "duplicate_route", "deduplication"));
      continue;
    }
    signatures.add(signature);
    selected.push(route);
  }
  return selected.slice(0, POLICY.limits.maximumCandidates);
}

function rank(left, right, intent) {
  const leftTarget = left.metrics.targetDeviationRatio ?? 0;
  const rightTarget = right.metrics.targetDeviationRatio ?? 0;
  return leftTarget - rightTarget ||
    left.metrics.backtrackingRatio - right.metrics.backtrackingRatio ||
    left.metrics.detourRatio - right.metrics.detourRatio ||
    (left.path.ascend ?? Number.MAX_SAFE_INTEGER) -
      (right.path.ascend ?? Number.MAX_SAFE_INTEGER) ||
    left.path.time - right.path.time ||
    left.candidateId.localeCompare(right.candidateId, "en");
}

function routedResponse(intent, routes, rejections, fallbackAttempted) {
  return deepFreeze({
    schemaVersion: 1,
    policyVersion: POLICY.policyVersion,
    state: "routed",
    intent: safeLLMIntentV1(intent),
    routes,
    rejections: canonicalRejections(rejections),
    diagnostics: diagnostics(routes, rejections, fallbackAttempted),
    recovery: null
  });
}

function recoveryResponse(intent, rejections, fallbackAttempted) {
  const clarification = rejections.some((item) => [
    "clarification_required", "geocoder_no_results", "geocoder_low_confidence",
    "geocoder_ambiguous"
  ].includes(item.code));
  return deepFreeze({
    schemaVersion: 1,
    policyVersion: POLICY.policyVersion,
    state: clarification ? "clarification" : "recovery",
    intent: intent ? safeLLMIntentV1(intent) : null,
    routes: [],
    rejections: canonicalRejections(rejections),
    diagnostics: diagnostics([], rejections, fallbackAttempted),
    recovery: {
      code: clarification ? "clarification_required" : "no_verified_route_candidates",
      message: clarification
        ? "Add or confirm specific nearby place names before route planning."
        : "Wanderful couldn’t verify a routed option from those suggestions. Try nearby named places or use standard route planning."
    }
  });
}

function diagnostics(routes, rejections, fallbackAttempted) {
  const rejectionCounts = {};
  for (const item of rejections) {
    rejectionCounts[item.code] = (rejectionCounts[item.code] ?? 0) + 1;
  }
  return {
    acceptedCount: routes.length,
    rejectedCount: rejections.length,
    rejectionCounts: Object.fromEntries(Object.entries(rejectionCounts).sort()),
    fallbackAttempted,
    fallbackAttemptCount: fallbackAttempted ? 1 : 0
  };
}

function canonicalRejections(values) {
  return [...values].sort((left, right) =>
    left.candidateId.localeCompare(right.candidateId, "en") ||
    left.stage.localeCompare(right.stage, "en") ||
    left.code.localeCompare(right.code, "en")
  );
}

function rejection(candidateId, code, stage) {
  if (!LLM_FIRST_REJECTION_CODES_V1.includes(code)) code = "routing_failure";
  return { candidateId, code, stage };
}

function validateDependencies(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => ![
        "generatePlan", "geocode", "provider", "setTimeoutImpl", "clearTimeoutImpl"
      ].includes(key)) || typeof input.generatePlan !== "function" ||
      typeof input.geocode !== "function" || typeof input.provider?.route !== "function") {
    throw outdoorAdventureOrchestrationError("feature_unavailable");
  }
  return {
    generatePlan: input.generatePlan,
    geocode: input.geocode,
    provider: input.provider,
    setTimeoutImpl: input.setTimeoutImpl ?? setTimeout,
    clearTimeoutImpl: input.clearTimeoutImpl ?? clearTimeout
  };
}

function validateOptions(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => ![
        "signal", "llmTimeoutMs", "geocodeTimeoutMs", "routeTimeoutMs",
        "totalTimeoutMs", "maximumConcurrentRoutes"
      ].includes(key))) throw outdoorAdventureOrchestrationError("feature_unavailable");
  const settings = {
    signal: input.signal,
    llmTimeoutMs: boundedInteger(input.llmTimeoutMs, POLICY.limits.defaultLLMTimeoutMs, 100, 30_000),
    geocodeTimeoutMs: boundedInteger(input.geocodeTimeoutMs, POLICY.limits.defaultGeocodeTimeoutMs, 100, 15_000),
    routeTimeoutMs: boundedInteger(input.routeTimeoutMs, POLICY.limits.defaultRouteTimeoutMs, 500, 30_000),
    totalTimeoutMs: boundedInteger(input.totalTimeoutMs, POLICY.limits.defaultTotalTimeoutMs, 1_000, POLICY.limits.maximumTotalTimeoutMs),
    maximumConcurrentRoutes: boundedInteger(
      input.maximumConcurrentRoutes,
      POLICY.limits.maximumConcurrentRoutes,
      1,
      POLICY.limits.maximumConcurrentRoutes
    )
  };
  if (settings.llmTimeoutMs >= settings.totalTimeoutMs ||
      settings.geocodeTimeoutMs >= settings.totalTimeoutMs ||
      settings.routeTimeoutMs >= settings.totalTimeoutMs) {
    throw outdoorAdventureOrchestrationError("feature_unavailable");
  }
  return settings;
}

async function withTotalDeadline(settings, deps, work) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  settings.signal?.addEventListener("abort", abort, { once: true });
  let timer;
  const timeout = new Promise((_, rejectPromise) => {
    timer = deps.setTimeoutImpl(() => {
      controller.abort();
      rejectPromise(outdoorAdventureOrchestrationError("timed_out"));
    }, settings.totalTimeoutMs);
  });
  try {
    return await Promise.race([work(controller.signal), timeout]);
  } catch (error) {
    if (settings.signal?.aborted) throw cancelled();
    throw error;
  } finally {
    deps.clearTimeoutImpl(timer);
    controller.abort();
    settings.signal?.removeEventListener("abort", abort);
  }
}

function boundedOperation(operation, milliseconds, parentSignal, deps) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parentSignal.addEventListener("abort", abort, { once: true });
  let timer;
  const operationPromise = Promise.resolve().then(() => operation(controller.signal));
  operationPromise.catch(() => {});
  const timeout = new Promise((_, rejectPromise) => {
    timer = deps.setTimeoutImpl(() => {
      controller.abort();
      rejectPromise(new OperationTimedOut());
    }, milliseconds);
  });
  let rejectFromParent;
  const cancellation = new Promise((_, rejectPromise) => {
    rejectFromParent = () => rejectPromise(cancelled());
    if (parentSignal.aborted) rejectFromParent();
    else parentSignal.addEventListener("abort", rejectFromParent, { once: true });
  });
  return Promise.race([operationPromise, timeout, cancellation]).finally(() => {
    deps.clearTimeoutImpl(timer);
    parentSignal.removeEventListener("abort", abort);
    parentSignal.removeEventListener("abort", rejectFromParent);
  });
}

function routeBacktrackingRatio(coordinates) {
  const sampled = resample(coordinates, 160);
  const segments = sampled.slice(1).map((finish, index) => ({
    start: sampled[index],
    finish,
    midpoint: {
      latitude: (sampled[index].latitude + finish.latitude) / 2,
      longitude: (sampled[index].longitude + finish.longitude) / 2
    },
    bearing: bearing(sampled[index], finish)
  }));
  const matched = new Set();
  const minimumSeparation = segments.length < 12
    ? 1
    : Math.max(4, Math.floor(segments.length / 18));
  for (let left = 0; left < segments.length; left += 1) {
    for (let right = left + minimumSeparation; right < segments.length; right += 1) {
      if (haversine(segments[left].midpoint, segments[right].midpoint) > 45) continue;
      const delta = angularDifference(segments[left].bearing, segments[right].bearing);
      if (delta >= 135) {
        matched.add(left);
        matched.add(right);
      }
    }
  }
  return segments.length === 0 ? 1 : matched.size / segments.length;
}

function resample(coordinates, maximumCount) {
  if (coordinates.length <= maximumCount) return coordinates;
  const result = [];
  for (let index = 0; index < maximumCount; index += 1) {
    result.push(coordinates[Math.round(index * (coordinates.length - 1) / (maximumCount - 1))]);
  }
  return result;
}

function closestPathPoint(path, target, minimumProgress, firstWithinMeters) {
  let best = { progress: minimumProgress,
    distanceMeters: minimumProgress === path.length - 1 ? haversine(path.at(-1), target) : Number.POSITIVE_INFINITY };
  const point = unitVector(target);
  for (let index = Math.min(Math.floor(minimumProgress), path.length - 2); index < path.length - 1; index += 1) {
    const start = unitVector(path[index]), finish = unitVector(path[index + 1]);
    const normal = cross(start, finish);
    const normalLength = Math.sqrt(dot(normal, normal));
    const length = Math.atan2(normalLength, dot(start, finish));
    const lowerFraction = Math.max(0, minimumProgress - index);
    let fraction, closest;
    if (normalLength < 1e-12) {
      if (dot(start, finish) <= 0) continue; // Antipodal arc is ambiguous.
      fraction = lowerFraction;
      closest = start;
    } else {
      const tangent = cross(scale(normal, 1 / normalLength), start);
      const along = Math.atan2(dot(point, tangent), dot(point, start));
      const lower = length * lowerFraction;
      const angles = [lower, length];
      if (along >= lower && along <= length) angles.push(along);
      const candidates = angles.map(angle=>({angle,position:add(scale(start,Math.cos(angle)),scale(tangent,Math.sin(angle)))}));
      const nearest = candidates.reduce((chosen,candidate)=>dot(point,candidate.position)>dot(point,chosen.position)?candidate:chosen);
      fraction = nearest.angle / length;
      closest = nearest.position;
    }
    const progress = index + fraction;
    const separation = cross(point,closest);
    const distanceMeters = 6_371_000 * Math.atan2(Math.sqrt(dot(separation,separation)),dot(point,closest));
    const candidate = { progress, distanceMeters };
    if (firstWithinMeters !== undefined && distanceMeters <= firstWithinMeters) return candidate;
    if (distanceMeters < best.distanceMeters) best = candidate;
  }
  return best;
}

function unitVector({latitude,longitude}) {
  const lat=latitude*Math.PI/180,lon=longitude*Math.PI/180;
  return {x:Math.cos(lat)*Math.cos(lon),y:Math.cos(lat)*Math.sin(lon),z:Math.sin(lat)};
}
function dot(a,b) {return a.x*b.x+a.y*b.y+a.z*b.z;}
function cross(a,b) {return {x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x};}
function scale(a,value) {return {x:a.x*value,y:a.y*value,z:a.z*value};}
function add(a,b) {return {x:a.x+b.x,y:a.y+b.y,z:a.z+b.z};}

function decodeCoordinate(input) {
  if (!Array.isArray(input) || (input.length !== 2 && input.length !== 3) ||
      !input.every(Number.isFinite) || input[0] < -180 || input[0] > 180 ||
      input[1] < -90 || input[1] > 90) reject("implausible_coordinate");
  return { latitude: input[1], longitude: input[0] };
}

function polylineDistance(coordinates) {
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    total += haversine(coordinates[index - 1], coordinates[index]);
  }
  return total;
}

function haversine(start, finish) {
  const radians = Math.PI / 180;
  const latitudeDelta = (finish.latitude - start.latitude) * radians;
  const longitudeDelta = (finish.longitude - start.longitude) * radians;
  const a = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(start.latitude * radians) * Math.cos(finish.latitude * radians) *
    Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function bearing(start, finish) {
  const radians = Math.PI / 180;
  const delta = (finish.longitude - start.longitude) * radians;
  const y = Math.sin(delta) * Math.cos(finish.latitude * radians);
  const x = Math.cos(start.latitude * radians) * Math.sin(finish.latitude * radians) -
    Math.sin(start.latitude * radians) * Math.cos(finish.latitude * radians) * Math.cos(delta);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function angularDifference(left, right) {
  const difference = Math.abs(left - right) % 360;
  return Math.min(difference, 360 - difference);
}

function profileFor(activity) {
  return activity === "biking" ? "bike" : "foot";
}

function resolvedCandidate(name, resolutions) {
  return resolutions.get(normalizeName(name)).candidate;
}

function resolvedCoordinate(name, resolutions) {
  return resolvedCandidate(name, resolutions).coordinate;
}

function candidateKey(intent, stops) {
  return canonical({
    activityType: intent.activityType,
    routeType: intent.routeType,
    start: normalizeName(intent.startLocationName),
    end: intent.endLocationName ? normalizeName(intent.endLocationName) : null,
    stops: stops.map((stop) => [stop.role, stop.kind, normalizeName(stop.name)])
  });
}

function geometrySignature(coordinates) {
  const sampled = resample(coordinates, 32).map((coordinate) => [
    Number(coordinate[0].toFixed(4)), Number(coordinate[1].toFixed(4))
  ]);
  return createHash("sha256").update(JSON.stringify(sampled)).digest("hex").slice(0, 24);
}

function stableId(prefix, value) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

function normalizeName(value) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function canonical(value) {
  return JSON.stringify(sort(value));
}

function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sort(value[key])]));
}

function boundedInteger(value, fallback, minimum, maximum) {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    throw outdoorAdventureOrchestrationError("feature_unavailable");
  }
  return result;
}

function round(value, places) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function reject(reasonCode, failedWaypointIndex) {
  throw new CandidateRejected(reasonCode, failedWaypointIndex);
}

function cancelled() {
  return outdoorAdventureOrchestrationError("cancelled");
}

function isCancelled(error, callerSignal, internalSignal) {
  return callerSignal?.aborted || internalSignal?.aborted || error?.code === "cancelled";
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

class CandidateRejected extends Error {
  constructor(reasonCode, failedWaypointIndex) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.failedWaypointIndex = failedWaypointIndex;
  }
}

class OperationTimedOut extends Error {}
