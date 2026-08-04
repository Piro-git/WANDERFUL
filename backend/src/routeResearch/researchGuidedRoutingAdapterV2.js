import { createGraphHopperProvider } from "../routing/graphHopperProvider.js";
import { RouteError } from "../routing/routeErrors.js";
import { validateRouteRequest } from "../routing/routeValidation.js";
import { validateResearchGuidedRouteCandidatePlanV2 } from "./researchGuidedRouteCandidatePlannerV2.js";
import {
  closestPointOnPath,
  deriveResearchGuidedRouteAttemptIdV2,
  deriveResearchGuidedRouteLineageIdV2,
  deriveResearchGuidedRouteResultIdV2,
  validateResearchGuidedRoutedAlternativesV2
} from "./routedAlternativesContractV2.js";
import { validateResearchGuidedRoutePathV1 } from "./routedAlternativesContract.js";
import { ResearchGuidedRoutingAdapterError } from "./routedAlternativesErrors.js";
import { RESEARCH_GUIDED_ROUTED_ALTERNATIVES_POLICY_V2 } from "./routedAlternativesPolicyV2.js";

const POLICY = RESEARCH_GUIDED_ROUTED_ALTERNATIVES_POLICY_V2;
const RESPONSE_FIELDS = new Set(["provider", "paths", "snapped_waypoints"]);
const PATH_FIELDS = new Set([
  "distance", "time", "ascend", "descend", "points", "instructions",
  "details", "snapped_waypoints"
]);

export async function routeResearchGuidedCandidatesV2(
  candidatePlan,
  dependencies = {},
  options = {}
) {
  const plan = validatedPlan(candidatePlan);
  const deps = validatedDependencies(dependencies);
  const settings = validatedOptions(options);
  if (
    ["unsupported", "insufficient_evidence"].includes(plan.state) ||
    plan.proposals.length === 0 || plan.anchor.state !== "resolved"
  ) return emptyEnvelope(plan);

  const prepared = plan.proposals.map((proposal, index) =>
    prepareAttempt(plan, proposal, index, deps.validateRouteRequest)
  );
  if (plan.normalizedIntent.routeType !== "loop") {
    return finalizedEnvelope(plan, prepared.map((item) => ({
      attemptId: item.attemptId,
      proposalIndex: item.proposalIndex,
      state: "unsupported",
      provenance: item.provenance,
      routeResults: [],
      failureCode: plan.normalizedIntent.routeType === "point_to_point"
        ? "unsupported_point_to_point" : "unsupported_out_and_back"
    })));
  }

  if (settings.signal?.aborted) throw cancelled();
  const controller = new AbortController();
  const abort = () => controller.abort();
  settings.signal?.addEventListener("abort", abort, { once: true });
  try {
    const attempts = await runWorkers(prepared, deps, settings, controller.signal);
    if (settings.signal?.aborted) throw cancelled();
    return finalizedEnvelope(plan, attempts);
  } finally {
    controller.abort();
    settings.signal?.removeEventListener("abort", abort);
  }
}

function validatedPlan(value) {
  try { return validateResearchGuidedRouteCandidatePlanV2(value); }
  catch (error) {
    throw new ResearchGuidedRoutingAdapterError("invalid_candidate_plan", { cause: error });
  }
}

function validatedDependencies(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => ![
        "provider", "validateRouteRequest", "setTimeoutImpl", "clearTimeoutImpl"
      ].includes(key))) {
    throw new ResearchGuidedRoutingAdapterError("invalid_dependencies");
  }
  const result = {
    provider: value.provider ?? createGraphHopperProvider(),
    validateRouteRequest: value.validateRouteRequest ?? validateRouteRequest,
    setTimeoutImpl: value.setTimeoutImpl ?? setTimeout,
    clearTimeoutImpl: value.clearTimeoutImpl ?? clearTimeout
  };
  if (typeof result.provider?.route !== "function" ||
      typeof result.validateRouteRequest !== "function" ||
      typeof result.setTimeoutImpl !== "function" ||
      typeof result.clearTimeoutImpl !== "function") {
    throw new ResearchGuidedRoutingAdapterError("invalid_dependencies");
  }
  return result;
}

function validatedOptions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => ![
        "signal", "maximumConcurrency", "operationTimeoutMilliseconds"
      ].includes(key))) {
    throw new ResearchGuidedRoutingAdapterError("invalid_options");
  }
  const maximumConcurrency = value.maximumConcurrency ?? POLICY.limits.maximumConcurrency;
  const operationTimeoutMilliseconds = value.operationTimeoutMilliseconds ??
    POLICY.limits.defaultOperationTimeoutMilliseconds;
  if (!Number.isInteger(maximumConcurrency) || maximumConcurrency < 1 ||
      maximumConcurrency > POLICY.limits.maximumConcurrency ||
      !Number.isInteger(operationTimeoutMilliseconds) ||
      operationTimeoutMilliseconds < 1 || operationTimeoutMilliseconds >
        POLICY.limits.maximumOperationTimeoutMilliseconds ||
      (value.signal !== undefined &&
        (typeof value.signal?.aborted !== "boolean" ||
         typeof value.signal?.addEventListener !== "function"))) {
    throw new ResearchGuidedRoutingAdapterError("invalid_options");
  }
  return { signal: value.signal, maximumConcurrency, operationTimeoutMilliseconds };
}

function prepareAttempt(plan, proposal, proposalIndex, requestValidator) {
  const unsigned = {
    proposalId: proposal.proposalId,
    sourceProposalId: proposal.sourceProposalId,
    strategy: proposal.strategy,
    activity: proposal.activity,
    routeType: proposal.routeType,
    selectedHighlights: proposal.selectedHighlights,
    mappedNetworkCandidates: proposal.mappedNetworkCandidates,
    evidenceClaimIds: proposal.evidenceClaimIds,
    requiredVerification: proposal.requiredVerification,
    knownLimitations: proposal.knownLimitations,
    sourceCandidatePlanPolicyVersion: plan.policyVersion,
    trailAccessPolicyVersion: plan.trailAccessResolution.policyVersion
  };
  const provenance = {
    ...unsigned,
    lineageId: deriveResearchGuidedRouteLineageIdV2(unsigned)
  };
  const attemptId = deriveResearchGuidedRouteAttemptIdV2(
    proposal.proposalId,
    provenance.lineageId
  );
  const points = [
    plan.anchor.coordinate,
    ...proposal.selectedHighlights.map((item) => item.routingCoordinate),
    plan.anchor.coordinate
  ];
  const keys = points.slice(1, -1).map(keyForCoordinate);
  if (keys.includes(keyForCoordinate(points[0])) || new Set(keys).size !== keys.length) {
    throw new ResearchGuidedRoutingAdapterError("invalid_candidate_plan");
  }
  let request;
  try {
    request = requestValidator({
      profile: "foot",
      routeType: "loop",
      points,
      locale: "en",
      includeElevation: true,
      includeInstructions: true,
      includePathDetails: ["surface", "road_class", "hike_rating"]
    });
  } catch (error) {
    throw new ResearchGuidedRoutingAdapterError("invalid_candidate_plan", { cause: error });
  }
  return {
    attemptId,
    proposalIndex,
    provenance,
    request,
    intentDistanceRangeKm: plan.normalizedIntent.distanceRangeKm
  };
}

async function runWorkers(prepared, deps, settings, signal) {
  const output = new Array(prepared.length);
  let next = 0;
  const worker = async () => {
    while (next < prepared.length) {
      if (signal.aborted || settings.signal?.aborted) throw cancelled();
      const index = next++;
      output[index] = await routeOne(prepared[index], deps, settings, signal);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(settings.maximumConcurrency, prepared.length) },
    worker
  ));
  return output;
}

async function routeOne(prepared, deps, settings, signal) {
  try {
    const response = await providerRouteWithBounds(
      deps.provider,
      prepared.request,
      signal,
      settings.operationTimeoutMilliseconds,
      deps
    );
    return {
      attemptId: prepared.attemptId,
      proposalIndex: prepared.proposalIndex,
      state: "routed",
      provenance: prepared.provenance,
      routeResults: providerResults(prepared, response),
      failureCode: null
    };
  } catch (error) {
    if (signal.aborted || settings.signal?.aborted || error?.code === "cancelled") {
      throw cancelled();
    }
    return {
      attemptId: prepared.attemptId,
      proposalIndex: prepared.proposalIndex,
      state: "failed",
      provenance: prepared.provenance,
      routeResults: [],
      failureCode: failureCode(error)
    };
  }
}

function providerRouteWithBounds(provider, request, parentSignal, milliseconds, deps) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (parentSignal.aborted) return Promise.reject(cancelled());
  parentSignal.addEventListener("abort", abortFromParent, { once: true });
  let timer;
  const providerPromise = Promise.resolve().then(() =>
    provider.route(request, { signal: controller.signal })
  );
  providerPromise.catch(() => {
    // A provider may ignore cancellation. Its late result is detached and
    // cannot mutate the ordered attempt array after this race settles.
  });
  const timeoutPromise = new Promise((_, reject) => {
    timer = deps.setTimeoutImpl(() => {
      controller.abort();
      reject(new TimedOut());
    }, milliseconds);
  });
  let rejectFromParent;
  const cancellationPromise = new Promise((_, reject) => {
    rejectFromParent = () => reject(cancelled());
    if (parentSignal.aborted) {
      rejectFromParent();
      return;
    }
    parentSignal.addEventListener("abort", rejectFromParent, { once: true });
  });
  return Promise.race([providerPromise, timeoutPromise, cancellationPromise])
    .finally(() => {
      if (timer !== undefined) deps.clearTimeoutImpl(timer);
      parentSignal.removeEventListener("abort", abortFromParent);
      parentSignal.removeEventListener("abort", rejectFromParent);
    });
}

function providerResults(prepared, input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => !RESPONSE_FIELDS.has(key)) ||
      input.provider !== "graphhopper" || !Array.isArray(input.paths) ||
      input.paths.length < 1 || input.paths.length > 3) invalidProvider();
  return input.paths.map((providerPath, pathIndex) => {
    if (!providerPath || typeof providerPath !== "object" || Array.isArray(providerPath) ||
        Object.keys(providerPath).some((key) => !PATH_FIELDS.has(key))) invalidProvider();
    const { snapped_waypoints: pathSnaps, ...pathInput } = providerPath;
    let path;
    try { path = validateResearchGuidedRoutePathV1(pathInput); }
    catch { invalidProvider(); }
    const snaps = waypointSnaps(prepared, pathSnaps ?? input.snapped_waypoints);
    const highlightVerifications = prepared.provenance.selectedHighlights.map(
      (highlight, index) => verificationFor(highlight, index, snaps[index + 1], path)
    );
    const result = {
      pathIndex,
      geometryProvider: "graphhopper",
      routingStrategy: "backend",
      verificationState: verificationState(prepared.provenance.selectedHighlights, highlightVerifications),
      path,
      waypointSnaps: snaps,
      highlightVerifications,
      distanceVerification: distanceVerification(
        path.distance,
        prepared.provenance,
        prepared
      )
    };
    return {
      routeResultId: deriveResearchGuidedRouteResultIdV2(
        prepared.attemptId,
        pathIndex,
        result
      ),
      ...result
    };
  });
}

function waypointSnaps(prepared, geometry) {
  const requested = [
    { role: "anchor", entityId: null, coordinate: prepared.request.points[0] },
    ...prepared.provenance.selectedHighlights.map((item) => ({
      role: "via_access", entityId: item.entityId, coordinate: item.routingCoordinate
    })),
    { role: "return_anchor", entityId: null, coordinate: prepared.request.points.at(-1) }
  ];
  let snapped = null;
  if (geometry !== undefined) {
    if (!geometry || typeof geometry !== "object" || Array.isArray(geometry) ||
        Object.keys(geometry).some((key) => !["type", "coordinates"].includes(key)) ||
        geometry.type !== "LineString" || !Array.isArray(geometry.coordinates) ||
        geometry.coordinates.length !== requested.length) invalidProvider();
    snapped = geometry.coordinates.map(decodeSnapped);
  }
  return requested.map((item, index) => {
    const coordinate = snapped?.[index] ?? null;
    const distance = coordinate === null ? null : haversine(item.coordinate, coordinate);
    return {
      waypointIndex: index,
      role: item.role,
      entityId: item.entityId,
      requestedCoordinate: item.coordinate,
      snappedCoordinate: coordinate,
      snapDistanceMeters: distance,
      withinAccessTolerance: distance !== null &&
        distance <= POLICY.limits.providerAccessSnapToleranceMeters
    };
  });
}

function verificationFor(highlight, index, snap, path) {
  if (!path?.points?.coordinates) invalidProvider();
  const evidenceClosest = closestPointOnPath(path.points.coordinates, highlight.evidenceCoordinate);
  const accessClosest = closestPointOnPath(path.points.coordinates, highlight.routingCoordinate);
  const verified = snap.withinAccessTolerance &&
    accessClosest.distanceMeters <= POLICY.limits.routeAccessToleranceMeters;
  return {
    highlightIndex: index,
    entityId: highlight.entityId,
    role: highlight.role,
    evidenceCoordinate: highlight.evidenceCoordinate,
    routingCoordinate: highlight.routingCoordinate,
    providerSnappedCoordinate: snap.snappedCoordinate,
    providerSnapDistanceMeters: snap.snapDistanceMeters,
    routeClosestApproachCoordinate: evidenceClosest.coordinate,
    routeGeometryDistanceToAccessMeters: accessClosest.distanceMeters,
    routeGeometryDistanceToEvidenceMeters: evidenceClosest.distanceMeters,
    providerVerifiedAccess: verified,
    approachState: !verified ? "unverified"
      : evidenceClosest.distanceMeters <= POLICY.limits.reachedEvidenceToleranceMeters
        ? "reached"
        : evidenceClosest.distanceMeters <= POLICY.limits.passesNearEvidenceToleranceMeters
          ? "passes_near" : "not_reached"
  };
}

function verificationState(highlights, verifications) {
  const hard = new Set(highlights.filter((item) => [
    "must_have", "facility_candidate", "overnight_candidate"
  ].includes(item.role)).map((item) => item.entityId));
  if (verifications.some((item) =>
    hard.has(item.entityId) && !item.providerVerifiedAccess
  )) return "unverified";
  return verifications.some((item) => hard.has(item.entityId) && item.approachState !== "reached")
    ? "ineligible" : "eligible";
}

function distanceVerification(distanceMeters, provenance, prepared) {
  const range = prepared.normalizedIntent?.distanceRangeKm ?? null;
  // The normalized intent is attached below before materialization.
  const target = range ?? prepared.intentDistanceRangeKm ?? null;
  const routeDistanceKm = Number((distanceMeters / 1_000).toFixed(3));
  if (target === null) return {
    routeDistanceKm, targetRangeKm: null,
    state: "target_unspecified", deviationKm: null
  };
  const within = routeDistanceKm >= target.min && routeDistanceKm <= target.max;
  const deviationKm = within ? 0 : routeDistanceKm < target.min
    ? Number((target.min - routeDistanceKm).toFixed(3))
    : Number((routeDistanceKm - target.max).toFixed(3));
  return {
    routeDistanceKm,
    targetRangeKm: target,
    state: within ? "within_target" : "outside_target",
    deviationKm
  };
}

function finalizedEnvelope(plan, attempts) {
  // Distance verification belongs to the request intent, not provider input.
  for (const attempt of attempts) {
    for (const result of attempt.routeResults) {
      result.distanceVerification = distanceVerification(
        result.path.distance,
        attempt.provenance,
        { intentDistanceRangeKm: plan.normalizedIntent.distanceRangeKm }
      );
    }
  }
  const results = attempts.flatMap((item) => item.routeResults);
  const state = results.some((item) => item.verificationState === "eligible") &&
      attempts.every((item) => item.state === "routed")
    ? "routed"
    : results.length > 0 ? "partial"
      : attempts.every((item) => item.state === "unsupported")
        ? "unsupported" : "no_viable_route";
  const draft = {
    schemaVersion: 2,
    state,
    normalizedIntent: plan.normalizedIntent,
    candidatePlanPolicyVersion: plan.policyVersion,
    routingAdapterPolicyVersion: POLICY.policyVersion,
    attempts,
    remainingLimitations: []
  };
  draft.remainingLimitations = limitationsForDraft(draft);
  return validateResearchGuidedRoutedAlternativesV2(draft);
}

function emptyEnvelope(plan) {
  const state = plan.state === "unsupported" ? "unsupported" : "no_viable_route";
  return validateResearchGuidedRoutedAlternativesV2({
    schemaVersion: 2,
    state,
    normalizedIntent: plan.normalizedIntent,
    candidatePlanPolicyVersion: plan.policyVersion,
    routingAdapterPolicyVersion: POLICY.policyVersion,
    attempts: [],
    remainingLimitations: [
      ...(state === "unsupported" ? ["candidate_plan_unsupported"] : []),
      "candidate_plan_not_routable"
    ].sort()
  });
}

function limitationsForDraft(envelope) {
  const values = envelope.attempts.flatMap((item) => item.provenance.knownLimitations);
  if (envelope.attempts.some((item) => item.state === "failed")) values.push("provider_failure");
  if (envelope.attempts.some((item) => item.state === "unsupported")) values.push("route_type_unsupported");
  for (const result of envelope.attempts.flatMap((item) => item.routeResults)) {
    for (const item of result.highlightVerifications) {
      if (item.providerSnappedCoordinate === null) values.push("provider_access_snap_unavailable");
      else if (!item.providerVerifiedAccess) values.push("provider_access_snap_exceeds_tolerance");
      if (item.routeGeometryDistanceToAccessMeters > POLICY.limits.routeAccessToleranceMeters) values.push("route_misses_access_coordinate");
      if (item.approachState === "passes_near") values.push("selected_highlight_passes_near");
      if (item.approachState === "not_reached") values.push("selected_highlight_not_reached");
    }
    if (result.distanceVerification.state === "outside_target") values.push("target_distance_not_met");
  }
  return [...new Set(values)].sort();
}

function decodeSnapped(input) {
  if (!Array.isArray(input) || (input.length !== 2 && input.length !== 3) ||
      !input.every(Number.isFinite) || input[0] < -180 || input[0] > 180 ||
      input[1] < -90 || input[1] > 90) invalidProvider();
  const result = { latitude: input[1], longitude: input[0] };
  if (input.length === 3) result.elevationMeters = input[2];
  return result;
}

function failureCode(error) {
  if (error instanceof TimedOut) return "route_timed_out";
  if (error instanceof InvalidProvider) return "invalid_provider_response";
  if (error instanceof RouteError) {
    return ({
      route_not_found: "route_not_found",
      route_timed_out: "route_timed_out",
      routing_rate_limited: "routing_rate_limited",
      invalid_request: "invalid_route_request",
      invalid_coordinates: "invalid_route_request",
      unsupported_profile: "invalid_route_request",
      unsupported_algorithm: "invalid_route_request"
    })[error.code] ?? "routing_unavailable";
  }
  return "routing_unavailable";
}

function keyForCoordinate(value) {
  return `${value.latitude.toFixed(7)}:${value.longitude.toFixed(7)}`;
}

function haversine(start, finish) {
  const r = Math.PI / 180;
  const dLat = (finish.latitude - start.latitude) * r;
  const dLon = (finish.longitude - start.longitude) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(start.latitude * r) *
    Math.cos(finish.latitude * r) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function cancelled() { return new ResearchGuidedRoutingAdapterError("cancelled"); }
function invalidProvider() { throw new InvalidProvider(); }
class TimedOut extends Error {}
class InvalidProvider extends Error {}
