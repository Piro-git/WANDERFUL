import { createGraphHopperProvider } from "../routing/graphHopperProvider.js";
import { RouteError } from "../routing/routeErrors.js";
import { validateRouteRequest } from "../routing/routeValidation.js";
import {
  validateResearchGuidedRouteCandidatePlanV1
} from "./validation.js";
import {
  deriveResearchGuidedRouteAttemptIdV1,
  deriveResearchGuidedRouteLineageIdV1,
  deriveResearchGuidedRouteResultIdV1,
  validateResearchGuidedRoutedAlternativesV1,
  validateResearchGuidedRoutePathV1
} from "./routedAlternativesContract.js";
import {
  ResearchGuidedRoutingAdapterError
} from "./routedAlternativesErrors.js";
import {
  RESEARCH_GUIDED_ROUTED_ALTERNATIVES_POLICY_V1
} from "./routedAlternativesPolicy.js";

const POLICY = RESEARCH_GUIDED_ROUTED_ALTERNATIVES_POLICY_V1;
const PROVIDER_RESPONSE_FIELDS =
  new Set(["provider", "paths", "snapped_waypoints"]);
const PROVIDER_PATH_FIELDS = new Set([
  "distance",
  "time",
  "ascend",
  "descend",
  "points",
  "instructions",
  "details",
  "snapped_waypoints"
]);

export async function routeResearchGuidedCandidatesV1(
  candidatePlan,
  dependencies = {},
  options = {}
) {
  const plan = validatedPlan(candidatePlan);
  const deps = validatedDependencies(dependencies);
  const settings = validatedOptions(options);

  if (
    plan.state === "unsupported" ||
    plan.state === "insufficient_evidence" ||
    plan.proposals.length === 0 ||
    plan.anchor.state !== "resolved"
  ) {
    return validateResearchGuidedRoutedAlternativesV1({
      schemaVersion: POLICY.schemaVersion,
      state: plan.state === "unsupported"
        ? "unsupported"
        : "no_viable_route",
      normalizedIntent: plan.normalizedIntent,
      candidatePlanPolicyVersion: plan.policyVersion,
      routingAdapterPolicyVersion: POLICY.policyVersion,
      attempts: [],
      remainingLimitations: plan.state === "unsupported"
        ? ["candidate_plan_unsupported", "candidate_plan_not_routable"]
        : ["candidate_plan_not_routable"]
    });
  }

  const prepared = plan.proposals.map((proposal, proposalIndex) =>
    prepareAttempt(plan, proposal, proposalIndex, deps.validateRouteRequest)
  );
  if (plan.normalizedIntent.routeType !== "loop") {
    const attempts = prepared.map((item) =>
      unsupportedAttempt(item, plan.normalizedIntent.routeType)
    );
    return finalizedEnvelope(plan, attempts);
  }

  const internalController = new AbortController();
  const abortFromCaller = () => internalController.abort();
  if (settings.signal?.aborted) {
    throw new ResearchGuidedRoutingAdapterError("cancelled");
  }
  settings.signal?.addEventListener("abort", abortFromCaller, {
    once: true
  });
  if (settings.signal?.aborted) {
    settings.signal.removeEventListener("abort", abortFromCaller);
    throw new ResearchGuidedRoutingAdapterError("cancelled");
  }

  try {
    const attempts = await routePreparedAttempts(
      prepared,
      deps,
      settings,
      internalController.signal
    );
    return finalizedEnvelope(plan, attempts);
  } catch (error) {
    internalController.abort();
    if (
      error instanceof ResearchGuidedRoutingAdapterError &&
      error.code === "cancelled"
    ) {
      throw error;
    }
    throw error;
  } finally {
    settings.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function validatedPlan(input) {
  try {
    return validateResearchGuidedRouteCandidatePlanV1(input);
  } catch (error) {
    throw new ResearchGuidedRoutingAdapterError(
      "invalid_candidate_plan",
      { cause: error }
    );
  }
}

function validatedDependencies(input) {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    throw new ResearchGuidedRoutingAdapterError("invalid_dependencies");
  }
  const allowed = new Set([
    "provider",
    "validateRouteRequest",
    "setTimeoutImpl",
    "clearTimeoutImpl"
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new ResearchGuidedRoutingAdapterError("invalid_dependencies");
  }
  const provider = input.provider ?? createGraphHopperProvider();
  const validator = input.validateRouteRequest ?? validateRouteRequest;
  const setTimeoutImpl = input.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = input.clearTimeoutImpl ?? clearTimeout;
  if (
    !provider ||
    typeof provider.route !== "function" ||
    typeof validator !== "function" ||
    typeof setTimeoutImpl !== "function" ||
    typeof clearTimeoutImpl !== "function"
  ) {
    throw new ResearchGuidedRoutingAdapterError("invalid_dependencies");
  }
  return {
    provider,
    validateRouteRequest: validator,
    setTimeoutImpl,
    clearTimeoutImpl
  };
}

function validatedOptions(input) {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    throw new ResearchGuidedRoutingAdapterError("invalid_options");
  }
  const allowed = new Set([
    "signal",
    "maximumConcurrency",
    "operationTimeoutMilliseconds"
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new ResearchGuidedRoutingAdapterError("invalid_options");
  }
  const maximumConcurrency = input.maximumConcurrency ??
    POLICY.limits.maximumConcurrency;
  const operationTimeoutMilliseconds =
    input.operationTimeoutMilliseconds ??
    POLICY.limits.defaultOperationTimeoutMilliseconds;
  if (
    !Number.isInteger(maximumConcurrency) ||
    maximumConcurrency < 1 ||
    maximumConcurrency > POLICY.limits.maximumConcurrency ||
    !Number.isInteger(operationTimeoutMilliseconds) ||
    operationTimeoutMilliseconds < 1 ||
    operationTimeoutMilliseconds >
      POLICY.limits.maximumOperationTimeoutMilliseconds ||
    (
      input.signal !== undefined &&
      (
        !input.signal ||
        typeof input.signal.aborted !== "boolean" ||
        typeof input.signal.addEventListener !== "function" ||
        typeof input.signal.removeEventListener !== "function"
      )
    )
  ) {
    throw new ResearchGuidedRoutingAdapterError("invalid_options");
  }
  return {
    signal: input.signal,
    maximumConcurrency,
    operationTimeoutMilliseconds
  };
}

function prepareAttempt(plan, proposal, proposalIndex, requestValidator) {
  const provenance = proposalProvenance(plan, proposal);
  const attemptId =
    deriveResearchGuidedRouteAttemptIdV1(proposal.proposalId);
  if (proposal.routeType !== "loop") {
    return {
      attemptId,
      proposalIndex,
      provenance,
      request: null
    };
  }

  const points = [
    plan.anchor.coordinate,
    ...proposal.viaCandidates.map((candidate) => candidate.coordinate),
    plan.anchor.coordinate
  ];
  assertTruthfulPointChain(points);
  const rawRequest = {
    profile: "foot",
    routeType: "loop",
    points,
    locale: "en",
    includeElevation: true,
    includeInstructions: true,
    includePathDetails: ["surface", "road_class", "hike_rating"]
  };
  let request;
  try {
    request = requestValidator(rawRequest);
  } catch (error) {
    throw new ResearchGuidedRoutingAdapterError(
      "invalid_candidate_plan",
      { cause: error }
    );
  }
  return { attemptId, proposalIndex, provenance, request };
}

function assertTruthfulPointChain(points) {
  const viaPoints = points.slice(1, -1);
  const keys = viaPoints.map(coordinateKey);
  if (
    keys.some((key) => key === coordinateKey(points[0])) ||
    new Set(keys).size !== keys.length
  ) {
    throw new ResearchGuidedRoutingAdapterError(
      "invalid_candidate_plan"
    );
  }
}

function coordinateKey(point) {
  return `${point.latitude.toFixed(7)}:${point.longitude.toFixed(7)}`;
}

function proposalProvenance(plan, proposal) {
  const provenance = {
    proposalId: proposal.proposalId,
    strategy: proposal.strategy,
    activity: proposal.activity,
    routeType: proposal.routeType,
    selectedWaypoints: proposal.viaCandidates.map((candidate) => ({
      entityId: candidate.entityId,
      coordinate: candidate.coordinate,
      highlightCategory: candidate.highlightCategory,
      role: candidate.role,
      evidenceClaimIds: candidate.evidenceClaimIds,
      selectionReasons: candidate.selectionReasons,
      requiredVerification: candidate.requiredVerification,
      knownLimitations: candidate.knownLimitations
    })),
    mappedNetworkCandidates:
      proposal.mappedNetworkCandidates.map((candidate) => ({
        entityId: candidate.entityId,
        sourceBasis: candidate.sourceBasis,
        evidenceClaimIds: candidate.evidenceClaimIds,
        requiredVerification: candidate.requiredVerification,
        knownLimitations: candidate.knownLimitations
      })),
    evidenceClaimIds: proposal.evidenceClaimIds,
    requiredVerification: proposal.requiredVerification,
    knownLimitations: proposal.knownLimitations,
    sourceCandidatePlanPolicyVersion: plan.policyVersion
  };
  return {
    ...provenance,
    lineageId: deriveResearchGuidedRouteLineageIdV1(provenance)
  };
}

function unsupportedAttempt(prepared, routeType) {
  const failureCode = routeType === "point_to_point"
    ? "unsupported_point_to_point"
    : routeType === "out_and_back"
      ? "unsupported_out_and_back"
      : "unsupported_candidate_plan";
  return {
    attemptId: prepared.attemptId,
    proposalIndex: prepared.proposalIndex,
    state: "unsupported",
    provenance: prepared.provenance,
    routeResults: [],
    failureCode
  };
}

async function routePreparedAttempts(
  prepared,
  dependencies,
  settings,
  signal
) {
  const results = new Array(prepared.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      if (signal.aborted) {
        throw new ResearchGuidedRoutingAdapterError("cancelled");
      }
      const index = nextIndex;
      nextIndex += 1;
      if (index >= prepared.length) return;
      const result = await routePreparedAttempt(
        prepared[index],
        dependencies,
        settings,
        signal
      );
      if (signal.aborted) {
        throw new ResearchGuidedRoutingAdapterError("cancelled");
      }
      results[index] = result;
    }
  };
  const workerCount = Math.min(
    settings.maximumConcurrency,
    prepared.length
  );
  await Promise.all(
    Array.from({ length: workerCount }, () => worker())
  );
  return results;
}

async function routePreparedAttempt(
  prepared,
  dependencies,
  settings,
  signal
) {
  try {
    const response = await providerRouteWithBounds(
      dependencies.provider,
      prepared.request,
      signal,
      settings.operationTimeoutMilliseconds,
      dependencies.setTimeoutImpl,
      dependencies.clearTimeoutImpl
    );
    const routeResults = providerRouteResults(prepared, response);
    return {
      attemptId: prepared.attemptId,
      proposalIndex: prepared.proposalIndex,
      state: "routed",
      provenance: prepared.provenance,
      routeResults,
      failureCode: null
    };
  } catch (error) {
    if (
      signal.aborted ||
      (
        error instanceof ResearchGuidedRoutingAdapterError &&
        error.code === "cancelled"
      )
    ) {
      throw new ResearchGuidedRoutingAdapterError("cancelled");
    }
    return {
      attemptId: prepared.attemptId,
      proposalIndex: prepared.proposalIndex,
      state: "failed",
      provenance: prepared.provenance,
      routeResults: [],
      failureCode: safeFailureCode(error)
    };
  }
}

function providerRouteWithBounds(
  provider,
  request,
  parentSignal,
  timeoutMilliseconds,
  setTimeoutImpl,
  clearTimeoutImpl
) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (parentSignal.aborted) {
    return Promise.reject(
      new ResearchGuidedRoutingAdapterError("cancelled")
    );
  }
  parentSignal.addEventListener("abort", abortFromParent, { once: true });
  let timeout;
  const providerPromise = Promise.resolve().then(() =>
    provider.route(request, { signal: controller.signal })
  );
  providerPromise.catch(() => {
    // A provider may ignore cancellation. Its late result is deliberately
    // detached and can no longer mutate the ordered attempt array.
  });
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeoutImpl(() => {
      controller.abort();
      reject(new OperationTimedOutError());
    }, timeoutMilliseconds);
  });
  const cancellationPromise = new Promise((_, reject) => {
    if (parentSignal.aborted) {
      reject(new ResearchGuidedRoutingAdapterError("cancelled"));
      return;
    }
    parentSignal.addEventListener(
      "abort",
      () => reject(new ResearchGuidedRoutingAdapterError("cancelled")),
      { once: true }
    );
  });
  return Promise.race([
    providerPromise,
    timeoutPromise,
    cancellationPromise
  ]).finally(() => {
    if (timeout !== undefined) clearTimeoutImpl(timeout);
    parentSignal.removeEventListener("abort", abortFromParent);
  });
}

function providerRouteResults(prepared, input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !PROVIDER_RESPONSE_FIELDS.has(key)) ||
    input.provider !== "graphhopper" ||
    !Array.isArray(input.paths) ||
    input.paths.length < 1 ||
    input.paths.length > POLICY.limits.maximumPathsPerAttempt
  ) {
    throw new InvalidProviderResponseError();
  }
  return input.paths.map((providerPath, pathIndex) => {
    if (
      !providerPath ||
      typeof providerPath !== "object" ||
      Array.isArray(providerPath) ||
      Object.keys(providerPath).some(
        (key) => !PROVIDER_PATH_FIELDS.has(key)
      )
    ) {
      throw new InvalidProviderResponseError();
    }
    const {
      snapped_waypoints: pathSnappedWaypoints,
      ...pathWithoutSnapping
    } = providerPath;
    let path;
    try {
      path = validateResearchGuidedRoutePathV1(pathWithoutSnapping);
    } catch {
      throw new InvalidProviderResponseError();
    }
    const snapped = pathSnappedWaypoints ?? input.snapped_waypoints;
    const waypointVisits = waypointVisitsFor(
      prepared,
      snapped
    );
    return {
      routeResultId: deriveResearchGuidedRouteResultIdV1(
        prepared.attemptId,
        pathIndex
      ),
      pathIndex,
      geometryProvider: "graphhopper",
      routingStrategy: "backend",
      path,
      waypointVisits
    };
  });
}

function waypointVisitsFor(prepared, geometry) {
  const requested = [
    {
      role: "anchor",
      entityId: null,
      coordinate: prepared.request.points[0]
    },
    ...prepared.provenance.selectedWaypoints.map((waypoint) => ({
      role: "via",
      entityId: waypoint.entityId,
      coordinate: waypoint.coordinate
    })),
    {
      role: "return_anchor",
      entityId: null,
      coordinate:
        prepared.request.points[prepared.request.points.length - 1]
    }
  ];
  let snappedCoordinates = null;
  if (geometry !== undefined) {
    if (
      !geometry ||
      typeof geometry !== "object" ||
      Array.isArray(geometry) ||
      Object.keys(geometry).some(
        (key) => !["type", "coordinates"].includes(key)
      ) ||
      geometry.type !== "LineString" ||
      !Array.isArray(geometry.coordinates) ||
      geometry.coordinates.length !== requested.length
    ) {
      throw new InvalidProviderResponseError();
    }
    snappedCoordinates = geometry.coordinates.map(
      decodeSnappedCoordinate
    );
  }
  return requested.map((waypoint, index) => {
    const snappedCoordinate = snappedCoordinates?.[index] ?? null;
    const snapDistanceMeters = snappedCoordinate === null
      ? null
      : haversineDistance(waypoint.coordinate, snappedCoordinate);
    return {
      waypointIndex: index,
      role: waypoint.role,
      entityId: waypoint.entityId,
      requestedCoordinate: waypoint.coordinate,
      snappedCoordinate,
      snapDistanceMeters,
      withinVisitTolerance:
        snapDistanceMeters !== null &&
        snapDistanceMeters <=
          POLICY.limits.waypointVisitToleranceMeters
    };
  });
}

function decodeSnappedCoordinate(input) {
  if (
    !Array.isArray(input) ||
    (input.length !== 2 && input.length !== 3) ||
    !input.every(Number.isFinite) ||
    input[0] < -180 ||
    input[0] > 180 ||
    input[1] < -90 ||
    input[1] > 90 ||
    (
      input.length === 3 &&
      Math.abs(input[2]) >
        POLICY.limits.maximumAbsoluteElevationMeters
    )
  ) {
    throw new InvalidProviderResponseError();
  }
  const coordinate = {
    latitude: input[1],
    longitude: input[0]
  };
  if (input.length === 3) coordinate.elevationMeters = input[2];
  return coordinate;
}

function finalizedEnvelope(plan, attempts) {
  const routedCount = attempts.filter(
    (attempt) => attempt.state === "routed"
  ).length;
  let state;
  if (routedCount === attempts.length && attempts.length > 0) {
    state = "routed";
  } else if (routedCount > 0) {
    state = "partial";
  } else if (
    attempts.length > 0 &&
    attempts.every((attempt) => attempt.state === "unsupported")
  ) {
    state = "unsupported";
  } else {
    state = "no_viable_route";
  }
  const limitations = [
    ...attempts.flatMap(
      (attempt) => attempt.provenance.knownLimitations
    )
  ];
  if (attempts.some((attempt) => attempt.state === "failed")) {
    limitations.push("provider_failure");
  }
  if (attempts.some((attempt) => attempt.state === "unsupported")) {
    limitations.push("route_type_unsupported");
  }
  const visits = attempts.flatMap((attempt) =>
    attempt.routeResults.flatMap((result) => result.waypointVisits)
  );
  if (
    visits.some((visit) =>
      visit.role === "via" && visit.snappedCoordinate === null
    )
  ) {
    limitations.push("snapping_unavailable");
  }
  if (
    visits.some((visit) =>
      visit.role === "via" &&
      visit.snappedCoordinate !== null &&
      !visit.withinVisitTolerance
    )
  ) {
    limitations.push("snapping_exceeds_tolerance");
  }
  return validateResearchGuidedRoutedAlternativesV1({
    schemaVersion: POLICY.schemaVersion,
    state,
    normalizedIntent: plan.normalizedIntent,
    candidatePlanPolicyVersion: plan.policyVersion,
    routingAdapterPolicyVersion: POLICY.policyVersion,
    attempts,
    remainingLimitations: orderedLimitations(limitations)
  });
}

function orderedLimitations(values) {
  const vocabulary = [
    "access_unverified",
    "access_restriction_unverified",
    "opening_unverified",
    "overnight_legality_unverified",
    "water_availability_unverified",
    "current_conditions_unavailable",
    "source_stale",
    "source_timestamp_unavailable",
    "conflicting_authoritative_evidence",
    "mapped_presence_only",
    "terrain_derived_only",
    "partial_regional_coverage",
    "official_status_unverified",
    "route_connection_unverified",
    "insufficient_evidence",
    "requires_real_routing",
    "endpoint_unavailable",
    "lower_bound_exceeds_target",
    "trail_difficulty_unverified",
    "exposure_unverified",
    "bookability_unverified",
    "seasonal_status_unverified",
    "transport_unverified",
    "mobility_suitability_unverified",
    "child_suitability_unverified",
    "beginner_suitability_unverified",
    ...POLICY.adapterLimitationCodes
  ];
  return [...new Set(values)].sort(
    (left, right) =>
      vocabulary.indexOf(left) - vocabulary.indexOf(right) ||
      left.localeCompare(right)
  );
}

function safeFailureCode(error) {
  if (error instanceof OperationTimedOutError) {
    return "route_timed_out";
  }
  if (error instanceof InvalidProviderResponseError) {
    return "invalid_provider_response";
  }
  if (error instanceof RouteError) {
    switch (error.code) {
    case "route_not_found":
      return "route_not_found";
    case "route_timed_out":
      return "route_timed_out";
    case "routing_rate_limited":
      return "routing_rate_limited";
    case "invalid_request":
    case "invalid_coordinates":
    case "unsupported_profile":
    case "unsupported_algorithm":
      return "invalid_route_request";
    default:
      return "routing_unavailable";
    }
  }
  return "routing_unavailable";
}

function haversineDistance(start, finish) {
  const earthRadiusMeters = 6_371_000;
  const radians = Math.PI / 180;
  const latitudeDelta =
    (finish.latitude - start.latitude) * radians;
  const longitudeDelta =
    (finish.longitude - start.longitude) * radians;
  const startLatitude = start.latitude * radians;
  const finishLatitude = finish.latitude * radians;
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) *
      Math.cos(finishLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMeters * 2 *
    Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}

class OperationTimedOutError extends Error {}
class InvalidProviderResponseError extends Error {}
