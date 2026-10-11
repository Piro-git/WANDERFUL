import { createHash, randomUUID } from "node:crypto";
import { authorizeRouteRequest } from "../routing/routeAuthorization.js";
import { validateRouteRequest } from "../routing/routeValidation.js";

const ACTIVITIES = new Set(["hiking", "trailRunning", "biking"]);
const ROUTE_TYPES = new Set(["loop", "pointToPoint"]);
const DIFFICULTIES = new Set(["easy", "moderate", "hard"]);
const CANDIDATE_FIELDS = new Set(["start", "stops", "end"]);
const OUTPUT_FIELDS = new Set(["schemaVersion", "intent", "candidates"]);
const INTENT_FIELDS = new Set([
  "activity", "routeType", "targetDistanceKm", "maximumDifficulty"
]);
const PATH_FIELDS = new Set([
  "distance", "time", "ascend", "descend", "points", "instructions",
  "details", "snapped_waypoints"
]);
const RESPONSE_FIELDS = new Set(["provider", "paths", "snapped_waypoints"]);

export const LLM_FIRST_SAFETY_POLICY_V1 = deepFreeze({
  schemaVersion: 1,
  policyVersion: "llm-first-safety-gated-planner-v1",
  featureFlag: "LLM_FIRST_SAFETY_GATED_PLANNING_ENABLED",
  limits: {
    maximumCandidates: 4,
    maximumStops: 3,
    maximumNameLength: 120,
    minimumGeocoderConfidence: 0.8,
    maximumGeocoderAlternatives: 1,
    maximumSnapDistanceMeters: 125,
    maximumWaypointApproachMeters: 125,
    maximumTargetDistanceDeviationRatio: 0.35,
    maximumStatisticsDistanceDeviationRatio: 0.08,
    maximumBacktrackingRatio: 0.2,
    maximumLoopClosureMeters: 150,
    minimumPointToPointSeparationMeters: 250,
    operationTimeoutMs: 8_000,
    totalTimeoutMs: 25_000
  }
});

export const LLM_FIRST_REJECTION_CODES_V1 = Object.freeze([
  "invalid_provenance", "invalid_schema", "implausible_coordinate",
  "geocoder_low_confidence", "geocoder_ambiguous", "duplicate_candidate",
  "wrong_activity_profile", "difficulty_unverified", "access_unverified",
  "route_not_found", "provider_timed_out", "provider_failed",
  "malformed_geometry", "malformed_statistics", "statistics_inconsistent",
  "waypoint_not_reached", "waypoint_order_invalid", "snap_distance_exceeded",
  "target_distance_exceeded", "excessive_backtracking", "invalid_loop_shape",
  "invalid_point_to_point_shape", "duplicate_route"
]);

export function llmFirstSafetyGatedPlanningEnabled(env = process.env) {
  const value = env?.[LLM_FIRST_SAFETY_POLICY_V1.featureFlag];
  return typeof value === "string" && ["1", "true", "yes"].includes(
    value.trim().toLowerCase()
  );
}

export class LLMFirstPlanningError extends Error {
  constructor(code, options = {}) {
    super(safeErrorMessage(code), { cause: options.cause });
    this.name = "LLMFirstPlanningError";
    this.code = code;
    this.statusCode = code === "invalid_request" ? 400
      : code === "cancelled" ? 499
        : code === "timed_out" ? 504 : 503;
  }
}

export async function planLLMFirstSafetyGatedV1(input, dependencies, options = {}) {
  const request = validateInput(input);
  const deps = validateDependencies(dependencies);
  const settings = validateOptions(options);
  return withDeadline(settings, async (signal) => {
    throwIfCancelled(signal);
    let parsed;
    try {
      const raw = await boundedCall(
        (operationSignal) => deps.llm.generate({
          prompt: request.prompt,
          idempotencyKey: request.idempotencyKey,
          signal: operationSignal
        }),
        settings.operationTimeoutMs,
        signal
      );
      throwIfCancelled(signal);
      parsed = validateLLMOutput(raw);
    } catch (error) {
      if (error instanceof LLMFirstPlanningError && error.code === "cancelled") throw error;
      const code = error instanceof OperationTimedOut ? "provider_timed_out"
        : error instanceof LLMFirstPlanningError && error.code === "invalid_schema"
          ? "invalid_schema" : "provider_failed";
      return await recoverOnce({ request, deps, settings, signal, code });
    }
    const planId = stableId("llmplanv1", {
      idempotencyKey: request.idempotencyKey,
      intent: parsed.intent,
      candidates: parsed.candidates
    });
    const rejected = [];
    const prepared = [];
    const seenCandidates = new Set();

    for (let index = 0; index < parsed.candidates.length; index += 1) {
      const candidate = parsed.candidates[index];
      const candidateId = stableId("llmcandv1", { planId, candidate });
      const key = canonicalCandidate(candidate);
      if (seenCandidates.has(key)) {
        rejected.push(rejection(candidateId, "duplicate_candidate", "candidate"));
        continue;
      }
      seenCandidates.add(key);
      try {
        prepared.push(await prepareCandidate(
          candidate, candidateId, parsed.intent, deps, settings, signal
        ));
      } catch (error) {
        if (error instanceof CandidateRejected) {
          rejected.push(rejection(candidateId, error.code, error.stage));
          continue;
        }
        throw error;
      }
    }

    const accepted = [];
    const seenRoutes = new Set();
    for (const candidate of prepared) {
      throwIfCancelled(signal);
      try {
        const response = await boundedCall(
          (operationSignal) => deps.router.route(
            candidate.routeRequest,
            { signal: operationSignal }
          ),
          settings.operationTimeoutMs,
          signal
        );
        const assessed = assessProviderResponse(candidate, response, parsed.intent);
        if (seenRoutes.has(assessed.geometryFingerprint)) {
          rejected.push(rejection(candidate.candidateId, "duplicate_route", "route"));
          continue;
        }
        seenRoutes.add(assessed.geometryFingerprint);
        accepted.push(assessed);
      } catch (error) {
        if (error instanceof CandidateRejected) {
          rejected.push(rejection(candidate.candidateId, error.code, error.stage));
          continue;
        }
        if (error instanceof OperationTimedOut) {
          rejected.push(rejection(candidate.candidateId, "provider_timed_out", "routing"));
          continue;
        }
        if (error?.code === "route_not_found") {
          rejected.push(rejection(candidate.candidateId, "route_not_found", "routing"));
          continue;
        }
        rejected.push(rejection(candidate.candidateId, "provider_failed", "routing"));
      }
    }

    accepted.sort(compareAccepted);
    if (accepted.length === 0) {
      const fallbackCandidate = prepared[0];
      const fallbackAttempted = Boolean(deps.fallback && fallbackCandidate);
      let fallback = null;
      if (fallbackAttempted) {
        try {
          const response = await boundedCall(
            (operationSignal) => deps.fallback.planOnce({
              intent: parsed.intent,
              routeRequest: fallbackCandidate.routeRequest,
              idempotencyKey: request.idempotencyKey,
              signal: operationSignal
            }),
            settings.operationTimeoutMs,
            signal
          );
          throwIfCancelled(signal);
          fallback = publicRoute(assessProviderResponse(
            fallbackCandidate, response, parsed.intent
          ));
        } catch (error) {
          if (error instanceof LLMFirstPlanningError && error.code === "cancelled") throw error;
          fallback = null;
        }
      }
      return resultEnvelope({
        state: fallback ? "recovered" : "no_viable_route",
        planId,
        routes: fallback ? [fallback] : [],
        rejected,
        fallbackAttempted
      });
    }

    return resultEnvelope({
      state: rejected.length > 0 ? "partial" : "routed",
      planId,
      routes: accepted.map(publicRoute),
      rejected,
      fallbackAttempted: false
    });
  });
}

export function createLLMFirstSafetyGatedEndpoint(options = {}) {
  const env = options.env ?? process.env;
  return async (body, context = {}) => {
    let authorization;
    try {
      if (!llmFirstSafetyGatedPlanningEnabled(env)) {
        return errorResult(new LLMFirstPlanningError("feature_unavailable"));
      }
      authorization = await authorizeRouteRequest(options.authorizer, {
        ...context,
        requestId: context.requestId ?? randomUUID(),
        cost: 1
      });
      const payload = await planLLMFirstSafetyGatedV1(body, {
        llm: options.llm,
        geocoder: options.geocoder,
        router: options.router,
        fallback: options.fallback
      }, { signal: context.signal });
      return { statusCode: 200, payload };
    } catch (error) {
      return errorResult(error);
    } finally {
      try { await authorization?.release?.(); } catch { /* operational only */ }
    }
  };
}

async function prepareCandidate(candidate, candidateId, intent, deps, settings, signal) {
  const names = intent.routeType === "loop"
    ? [candidate.start, ...candidate.stops]
    : [candidate.start, ...candidate.stops, candidate.end];
  const resolved = [];
  for (const name of names) {
    let result;
    try {
      result = await boundedCall(
        (operationSignal) => deps.geocoder.resolve(
          name,
          { signal: operationSignal }
        ),
        settings.operationTimeoutMs,
        signal
      );
    } catch (error) {
      if (error instanceof OperationTimedOut) throw new CandidateRejected("provider_timed_out", "geocoding");
      throw new CandidateRejected("provider_failed", "geocoding");
    }
    resolved.push(validatedGeocode(result));
  }
  const points = resolved.map((item) => item.coordinate);
  if (intent.routeType === "loop") points.push(points[0]);
  const profile = intent.activity === "biking" ? "bike" : "foot";
  if (intent.maximumDifficulty !== null && resolved.some((item) =>
    item.difficultyEvidence !== "verified"
  )) throw new CandidateRejected("difficulty_unverified", "evidence");
  if (resolved.some((item) => item.accessEvidence !== "verified")) {
    throw new CandidateRejected("access_unverified", "evidence");
  }
  let routeRequest;
  try {
    routeRequest = validateRouteRequest({
      profile,
      routeType: intent.routeType,
      points,
      locale: "en",
      includeElevation: true,
      includeInstructions: true,
      includePathDetails: ["surface", "road_class", "hike_rating"],
      ...(intent.routeType === "pointToPoint" ? {
        preferences: {
          activityType: intent.activity,
          avoid: [],
          ...(intent.maximumDifficulty === "easy" ? { difficulty: "easy" } : {})
        }
      } : {})
    });
  } catch (error) {
    throw new CandidateRejected(
      error?.code === "unsupported_profile" ? "wrong_activity_profile" : "implausible_coordinate",
      "request"
    );
  }
  return { candidateId, routeRequest, requestedPoints: points };
}

function validatedGeocode(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      !exactFields(input, [
        "coordinate", "confidence", "alternativeCount", "accessEvidence",
        "difficultyEvidence"
      ])) throw new CandidateRejected("geocoder_low_confidence", "geocoding");
  const { coordinate } = input;
  if (!coordinate || typeof coordinate !== "object" || Array.isArray(coordinate) ||
      !exactFields(coordinate, ["latitude", "longitude"]) ||
      !Number.isFinite(coordinate.latitude) || coordinate.latitude < -90 || coordinate.latitude > 90 ||
      !Number.isFinite(coordinate.longitude) || coordinate.longitude < -180 || coordinate.longitude > 180) {
    throw new CandidateRejected("implausible_coordinate", "geocoding");
  }
  if (!Number.isFinite(input.confidence) ||
      input.confidence < LLM_FIRST_SAFETY_POLICY_V1.limits.minimumGeocoderConfidence) {
    throw new CandidateRejected("geocoder_low_confidence", "geocoding");
  }
  if (!Number.isInteger(input.alternativeCount) || input.alternativeCount < 1 ||
      input.alternativeCount > LLM_FIRST_SAFETY_POLICY_V1.limits.maximumGeocoderAlternatives) {
    throw new CandidateRejected("geocoder_ambiguous", "geocoding");
  }
  if (!["verified", "unknown"].includes(input.accessEvidence) ||
      !["verified", "unknown"].includes(input.difficultyEvidence)) {
    throw new CandidateRejected("invalid_provenance", "evidence");
  }
  return input;
}

function assessProviderResponse(candidate, input, intent) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => !RESPONSE_FIELDS.has(key)) ||
      input.provider !== "graphhopper" || !Array.isArray(input.paths) ||
      input.paths.length !== 1) throw new CandidateRejected("invalid_provenance", "routing");
  const path = input.paths[0];
  if (!path || typeof path !== "object" || Array.isArray(path) ||
      Object.keys(path).some((key) => !PATH_FIELDS.has(key))) {
    throw new CandidateRejected("malformed_geometry", "route");
  }
  const coordinates = decodeLineString(path.points, 2);
  if (!Number.isFinite(path.distance) || path.distance <= 0 ||
      !Number.isFinite(path.time) || path.time <= 0 ||
      (path.ascend !== undefined && (!Number.isFinite(path.ascend) || path.ascend < 0)) ||
      (path.descend !== undefined && (!Number.isFinite(path.descend) || path.descend < 0))) {
    throw new CandidateRejected("malformed_statistics", "route");
  }
  const calculatedDistance = polylineDistance(coordinates);
  if (relativeDifference(path.distance, calculatedDistance) >
      LLM_FIRST_SAFETY_POLICY_V1.limits.maximumStatisticsDistanceDeviationRatio) {
    throw new CandidateRejected("statistics_inconsistent", "route");
  }
  if (intent.routeType === "loop") {
    if (haversine(coordinates[0], coordinates.at(-1)) >
        LLM_FIRST_SAFETY_POLICY_V1.limits.maximumLoopClosureMeters) {
      throw new CandidateRejected("invalid_loop_shape", "route");
    }
  } else if (haversine(coordinates[0], coordinates.at(-1)) <
      LLM_FIRST_SAFETY_POLICY_V1.limits.minimumPointToPointSeparationMeters) {
    throw new CandidateRejected("invalid_point_to_point_shape", "route");
  }
  const snapped = decodeLineString(
    path.snapped_waypoints ?? input.snapped_waypoints,
    candidate.requestedPoints.length
  );
  for (let index = 0; index < candidate.requestedPoints.length; index += 1) {
    if (haversine(candidate.requestedPoints[index], snapped[index]) >
        LLM_FIRST_SAFETY_POLICY_V1.limits.maximumSnapDistanceMeters) {
      throw new CandidateRejected("snap_distance_exceeded", "route");
    }
  }
  const approaches = candidate.requestedPoints.map((point, index) =>
    intent.routeType === "loop" && index === candidate.requestedPoints.length - 1
      ? { index: coordinates.length - 1, distance: haversine(point, coordinates.at(-1)) }
      : closestIndex(point, coordinates)
  );
  if (approaches.some((item) => item.distance >
      LLM_FIRST_SAFETY_POLICY_V1.limits.maximumWaypointApproachMeters)) {
    throw new CandidateRejected("waypoint_not_reached", "route");
  }
  if (approaches.some((item, index) => index > 0 && item.index < approaches[index - 1].index)) {
    throw new CandidateRejected("waypoint_order_invalid", "route");
  }
  const targetDeviation = intent.targetDistanceKm === null ? 0
    : Math.abs(path.distance / 1_000 - intent.targetDistanceKm) / intent.targetDistanceKm;
  if (targetDeviation > LLM_FIRST_SAFETY_POLICY_V1.limits.maximumTargetDistanceDeviationRatio) {
    throw new CandidateRejected("target_distance_exceeded", "route");
  }
  const backtrackingRatio = repeatedSegmentRatio(coordinates);
  if (backtrackingRatio > LLM_FIRST_SAFETY_POLICY_V1.limits.maximumBacktrackingRatio) {
    throw new CandidateRejected("excessive_backtracking", "route");
  }
  return {
    candidateId: candidate.candidateId,
    geometryProvider: "graphhopper",
    path,
    geometryFingerprint: stableId("geometryv1", coordinates.map(coordinateKey)),
    metrics: { targetDeviation, backtrackingRatio, distanceMeters: path.distance }
  };
}

function validateLLMOutput(input) {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        !exactFields(input, [...OUTPUT_FIELDS]) || input.schemaVersion !== 1) invalidSchema();
    const intent = input.intent;
    if (!intent || typeof intent !== "object" || Array.isArray(intent) ||
        !exactFields(intent, [...INTENT_FIELDS]) ||
        !ACTIVITIES.has(intent.activity) || !ROUTE_TYPES.has(intent.routeType) ||
        !(intent.targetDistanceKm === null ||
          (Number.isFinite(intent.targetDistanceKm) && intent.targetDistanceKm >= 1 && intent.targetDistanceKm <= 200)) ||
        !(intent.maximumDifficulty === null || DIFFICULTIES.has(intent.maximumDifficulty))) invalidSchema();
    if (!Array.isArray(input.candidates) || input.candidates.length < 1 ||
        input.candidates.length > LLM_FIRST_SAFETY_POLICY_V1.limits.maximumCandidates) invalidSchema();
    const candidates = input.candidates.map((candidate) => validateCandidate(candidate, intent.routeType));
    return deepFreeze({ schemaVersion: 1, intent: { ...intent }, candidates });
  } catch (error) {
    if (error instanceof LLMFirstPlanningError) throw error;
    throw new LLMFirstPlanningError("invalid_schema", { cause: error });
  }
}

function validateCandidate(input, routeType) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      !exactFields(input, [...CANDIDATE_FIELDS])) invalidSchema();
  const start = name(input.start);
  const stops = Array.isArray(input.stops) ? input.stops.map(name) : invalidSchema();
  if (stops.length > LLM_FIRST_SAFETY_POLICY_V1.limits.maximumStops) invalidSchema();
  const end = input.end === null ? null : name(input.end);
  if ((routeType === "loop" && end !== null) || (routeType === "pointToPoint" && end === null)) invalidSchema();
  return { start, stops, end };
}

function validateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      !exactFields(input, ["prompt", "idempotencyKey"]) ||
      typeof input.prompt !== "string" || input.prompt.trim().length < 1 ||
      input.prompt.length > 2_000 || typeof input.idempotencyKey !== "string" ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(input.idempotencyKey)) {
    throw new LLMFirstPlanningError("invalid_request");
  }
  return { prompt: input.prompt.trim(), idempotencyKey: input.idempotencyKey };
}

function validateDependencies(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => !["llm", "geocoder", "router", "fallback"].includes(key)) ||
      typeof input.llm?.generate !== "function" ||
      typeof input.geocoder?.resolve !== "function" ||
      typeof input.router?.route !== "function" ||
      (input.fallback !== undefined && typeof input.fallback?.planOnce !== "function")) {
    throw new LLMFirstPlanningError("feature_unavailable");
  }
  return input;
}

function validateOptions(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => !["signal", "operationTimeoutMs", "totalTimeoutMs"].includes(key))) {
    throw new LLMFirstPlanningError("feature_unavailable");
  }
  const operationTimeoutMs = boundedInteger(input.operationTimeoutMs,
    LLM_FIRST_SAFETY_POLICY_V1.limits.operationTimeoutMs, 10, 30_000);
  const totalTimeoutMs = boundedInteger(input.totalTimeoutMs,
    LLM_FIRST_SAFETY_POLICY_V1.limits.totalTimeoutMs, 50, 45_000);
  if (operationTimeoutMs >= totalTimeoutMs ||
      (input.signal !== undefined && (typeof input.signal?.aborted !== "boolean" ||
       typeof input.signal?.addEventListener !== "function"))) {
    throw new LLMFirstPlanningError("feature_unavailable");
  }
  return { signal: input.signal, operationTimeoutMs, totalTimeoutMs };
}

async function withDeadline(settings, work) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  settings.signal?.addEventListener("abort", abort, { once: true });
  if (settings.signal?.aborted) abort();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new LLMFirstPlanningError("timed_out"));
    }, settings.totalTimeoutMs);
  });
  try {
    return await Promise.race([work(controller.signal), deadline]);
  } catch (error) {
    if (settings.signal?.aborted) throw new LLMFirstPlanningError("cancelled");
    if (controller.signal.aborted && !(error instanceof LLMFirstPlanningError)) {
      throw new LLMFirstPlanningError("timed_out", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
    settings.signal?.removeEventListener("abort", abort);
  }
}

async function boundedCall(operation, milliseconds, parentSignal) {
  throwIfCancelled(parentSignal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  parentSignal.addEventListener("abort", abort, { once: true });
  let timer;
  let cancel;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new OperationTimedOut());
        }, milliseconds);
      }),
      new Promise((_, reject) => {
        cancel = () => reject(new LLMFirstPlanningError("cancelled"));
        parentSignal.addEventListener("abort", cancel, { once: true });
      })
    ]);
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener("abort", abort);
    if (cancel) parentSignal.removeEventListener("abort", cancel);
  }
}

async function recoverOnce({ request, signal, code }) {
  throwIfCancelled(signal);
  const planId = stableId("llmplanv1", {
    idempotencyKey: request.idempotencyKey,
    failure: code
  });
  // No validated intent/anchors exist, so a fallback cannot be assessed against
  // the requested route. Leave recovery to the caller's clarification flow.
  return resultEnvelope({
    state: "no_viable_route",
    planId,
    routes: [],
    rejected: [rejection(stableId("llmstagev1", planId), code, "llm")],
    fallbackAttempted: false
  });
}

function decodeLineString(input, minimum) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      input.type !== "LineString" || !Array.isArray(input.coordinates) ||
      input.coordinates.length < minimum) throw new CandidateRejected("malformed_geometry", "route");
  return input.coordinates.map((pair) => {
    if (!Array.isArray(pair) || pair.length < 2 || pair.length > 3 ||
        !Number.isFinite(pair[0]) || pair[0] < -180 || pair[0] > 180 ||
        !Number.isFinite(pair[1]) || pair[1] < -90 || pair[1] > 90) {
      throw new CandidateRejected("malformed_geometry", "route");
    }
    return { latitude: pair[1], longitude: pair[0] };
  });
}

function repeatedSegmentRatio(points) {
  const counts = new Map();
  let total = 0;
  let repeated = 0;
  for (let index = 1; index < points.length; index += 1) {
    const length = haversine(points[index - 1], points[index]);
    const key = [coordinateKey(points[index - 1]), coordinateKey(points[index])].sort().join("|");
    if (counts.has(key)) repeated += length;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total += length;
  }
  return total === 0 ? 1 : repeated / total;
}

function closestIndex(point, line) {
  let best = { index: -1, distance: Infinity };
  line.forEach((candidate, index) => {
    const distance = haversine(point, candidate);
    if (distance < best.distance) best = { index, distance };
  });
  return best;
}

function polylineDistance(points) {
  return points.slice(1).reduce(
    (total, point, index) => total + haversine(points[index], point), 0
  );
}

function haversine(left, right) {
  const radians = Math.PI / 180;
  const dLat = (right.latitude - left.latitude) * radians;
  const dLon = (right.longitude - left.longitude) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(left.latitude * radians) *
    Math.cos(right.latitude * radians) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function compareAccepted(left, right) {
  return left.metrics.targetDeviation - right.metrics.targetDeviation ||
    left.metrics.backtrackingRatio - right.metrics.backtrackingRatio ||
    left.metrics.distanceMeters - right.metrics.distanceMeters ||
    left.candidateId.localeCompare(right.candidateId);
}

function publicRoute(value) {
  return {
    candidateId: value.candidateId,
    geometryProvider: value.geometryProvider,
    path: value.path,
    metrics: value.metrics,
    limitations: [
      "Conditions, access, and route suitability can change.",
      "Review weather, local rules, trail conditions, and water availability before starting."
    ]
  };
}

function resultEnvelope({ state, planId, routes, rejected, fallbackAttempted }) {
  return deepFreeze({
    schemaVersion: 1,
    policyVersion: LLM_FIRST_SAFETY_POLICY_V1.policyVersion,
    state,
    planId,
    routes,
    rejected,
    fallback: {
      attempted: fallbackAttempted,
      exhausted: fallbackAttempted && routes.length === 0
    },
    evidence: { supabase: "disabled", liveConditions: "not_checked" }
  });
}

function rejection(candidateId, code, stage) {
  return { candidateId, code, stage };
}

function canonicalCandidate(candidate) {
  return JSON.stringify({
    start: candidate.start.toLocaleLowerCase("en-US"),
    stops: candidate.stops.map((item) => item.toLocaleLowerCase("en-US")),
    end: candidate.end?.toLocaleLowerCase("en-US") ?? null
  });
}

function coordinateKey(point) {
  return `${point.latitude.toFixed(5)}:${point.longitude.toFixed(5)}`;
}

function stableId(prefix, value) {
  return `${prefix}_${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;
}

function relativeDifference(left, right) {
  return Math.abs(left - right) / Math.max(left, right, 1);
}

function name(value) {
  if (typeof value !== "string" || value.trim().length < 1 ||
      value.length > LLM_FIRST_SAFETY_POLICY_V1.limits.maximumNameLength ||
      /[\u0000-\u001f\u007f]/.test(value)) invalidSchema();
  return value.trim();
}

function invalidSchema() { throw new LLMFirstPlanningError("invalid_schema"); }
function exactFields(value, fields) {
  const keys = Object.keys(value);
  return keys.length === fields.length && keys.every((key) => fields.includes(key));
}
function boundedInteger(value, fallback, minimum, maximum) {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    throw new LLMFirstPlanningError("feature_unavailable");
  }
  return result;
}
function throwIfCancelled(signal) {
  if (signal.aborted) throw new LLMFirstPlanningError("cancelled");
}
function safeErrorMessage(code) {
  return ({
    invalid_request: "The planning request is invalid.",
    invalid_schema: "The planning assistant returned an invalid plan.",
    cancelled: "Planning was cancelled.",
    timed_out: "Planning timed out. Try a simpler request.",
    feature_unavailable: "AI-assisted planning is not available."
  })[code] ?? "AI-assisted planning is temporarily unavailable.";
}
function errorResult(error) {
  const safe = error instanceof LLMFirstPlanningError
    ? error : new LLMFirstPlanningError("feature_unavailable", { cause: error });
  return { statusCode: safe.statusCode, payload: { error: { code: safe.code, message: safe.message } } };
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

class CandidateRejected extends Error {
  constructor(code, stage) { super(code); this.code = code; this.stage = stage; }
}
class OperationTimedOut extends Error {}
