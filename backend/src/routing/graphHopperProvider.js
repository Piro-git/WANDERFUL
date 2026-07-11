import { RouteError, routeError } from "./routeErrors.js";

const DEFAULT_BASE_URL = "https://graphhopper.com/api/1";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 60_000;
const SAFE_INSTRUCTION_FIELDS = Object.freeze([
  "text", "street_name", "distance", "time", "interval", "sign"
]);
const SAFE_DETAIL_FIELDS = Object.freeze(["surface", "road_class", "hike_rating"]);

export function createGraphHopperProvider(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;

  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");

  return {
    async route(request, context = {}) {
      const configuration = providerConfiguration(env);
      const upstreamRequest = buildGraphHopperRequest(request, configuration);
      const controller = new AbortController();
      let timedOut = false;
      const abortFromClient = () => controller.abort();

      if (context.signal?.aborted) throw routeError("request_cancelled");
      context.signal?.addEventListener("abort", abortFromClient, { once: true });
      if (context.signal?.aborted) {
        context.signal.removeEventListener("abort", abortFromClient);
        throw routeError("request_cancelled");
      }
      const timeout = setTimeoutImpl(() => {
        timedOut = true;
        controller.abort();
      }, configuration.timeoutMs);

      try {
        const response = await fetchImpl(upstreamRequest.url, {
          ...upstreamRequest.init,
          signal: controller.signal
        });
        return await normalizeGraphHopperResponse(response);
      } catch (error) {
        if (timedOut) throw routeError("route_timed_out", { cause: error });
        if (context.signal?.aborted) throw routeError("request_cancelled", { cause: error });
        if (error instanceof RouteError) throw error;
        throw routeError("routing_unavailable", { cause: error });
      } finally {
        clearTimeoutImpl(timeout);
        context.signal?.removeEventListener("abort", abortFromClient);
      }
    }
  };
}

export function buildGraphHopperRequest(request, configuration) {
  const url = new URL(`${configuration.baseUrl.replace(/\/+$/, "")}/route`);
  url.searchParams.set("key", configuration.apiKey);

  const payload = {
    profile: request.profile,
    points: request.points.map((point) => [point.longitude, point.latitude]),
    locale: request.locale,
    elevation: true,
    points_encoded: false,
    instructions: true,
    details: request.includePathDetails
  };

  if (request.algorithm) payload.algorithm = request.algorithm;
  if (request.algorithm === "round_trip") {
    payload["round_trip.distance"] = request.roundTrip.distanceMeters;
    payload["round_trip.seed"] = request.roundTrip.seed;
  }
  if (request.algorithm === "alternative_route") {
    payload["alternative_route.max_paths"] = request.alternativeRoute.maxPaths;
    payload["alternative_route.max_weight_factor"] = request.alternativeRoute.maxWeightFactor;
    payload["alternative_route.max_share_factor"] = request.alternativeRoute.maxShareFactor;
  }

  const customModel = buildCustomModel(request.preferences, request.algorithm);
  if (customModel) payload.custom_model = customModel;
  if (request.algorithm || customModel) payload["ch.disable"] = true;

  return {
    url,
    init: {
      method: "POST",
      redirect: "manual",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  };
}

export function providerConfiguration(env) {
  const apiKey = typeof env.GRAPHHOPPER_API_KEY === "string" ? env.GRAPHHOPPER_API_KEY.trim() : "";
  if (!apiKey) throw routeError("configuration_missing");

  const baseUrl = env.GRAPHHOPPER_BASE_URL || DEFAULT_BASE_URL;
  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch (error) {
    throw routeError("configuration_missing", { cause: error });
  }
  if (
    parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password ||
    parsedUrl.search || parsedUrl.hash
  ) {
    throw routeError("configuration_missing");
  }

  const timeoutMs = boundedInteger(env.ROUTE_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1_000, MAX_TIMEOUT_MS);
  return { apiKey, baseUrl: parsedUrl.toString().replace(/\/$/, ""), timeoutMs };
}

function buildCustomModel(preferences, algorithm) {
  if (!preferences) return undefined;
  const priority = [];

  if (preferences.activityType === "hiking") {
    priority.push(statement("road_class == PRIMARY", "0.85"));
    priority.push(statement("road_class == SECONDARY", "0.9"));
  } else if (preferences.activityType === "trailRunning") {
    priority.push(statement("road_class == PRIMARY", "0.75"));
    priority.push(statement("road_class == SECONDARY", "0.85"));
    priority.push(statement("road_class == TRACK || road_class == FOOTWAY", "1.05"));
  } else if (preferences.activityType === "biking") {
    priority.push(statement("road_class == PRIMARY", "0.9"));
    priority.push(statement("road_class == TRACK", "1.05"));
  }

  if (preferences.avoid.includes("majorRoads")) {
    priority.push(statement("road_class == TRUNK", "0.45"));
    priority.push(statement("road_class == PRIMARY", "0.65"));
    priority.push(statement("road_class == SECONDARY", "0.82"));
  }
  if (preferences.avoid.includes("steepClimbs") || preferences.difficulty === "easy") {
    priority.push(statement("max_slope > 12", "0.72"));
    priority.push(statement("max_slope > 20", "0.5"));
  }
  const customModel = { priority };
  if (algorithm === "alternative_route") customModel.distance_influence = 70;
  return customModel;
}

function statement(condition, multiplier) {
  return { if: condition, multiply_by: multiplier };
}

async function normalizeGraphHopperResponse(response) {
  if (!response || typeof response.status !== "number") throw routeError("routing_unavailable");
  if (!response.ok) {
    const providerPayload = await readProviderError(response);
    if (response.status === 429) throw routeError("routing_rate_limited");
    if (response.status === 401 || response.status === 403) {
      throw routeError("configuration_missing");
    }
    if (response.status >= 500) throw routeError("routing_unavailable");
    if (isFlexibleModePayload(providerPayload)) {
      throw routeError("flexible_mode_unavailable");
    }
    if (isNoRoutePayload(providerPayload)) throw routeError("route_not_found");
    if (response.status >= 400 && response.status < 500) {
      throw routeError("invalid_request", {
        message: "The routing provider rejected the supported route parameters."
      });
    }
    throw routeError("routing_unavailable");
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw routeError("routing_unavailable", { cause: error });
  }
  if (!payload || !Array.isArray(payload.paths)) throw routeError("routing_unavailable");
  if (payload.paths.length === 0) throw routeError("route_not_found");
  if (payload.paths.some((path) => !isValidPath(path))) {
    throw routeError("routing_unavailable");
  }
  if (payload.snapped_waypoints !== undefined && !isValidGeometry(payload.snapped_waypoints, 1)) {
    throw routeError("routing_unavailable");
  }

  const result = { provider: "graphhopper", paths: payload.paths.map(sanitizePath) };
  if (payload.snapped_waypoints !== undefined) {
    result.snapped_waypoints = sanitizeGeometry(payload.snapped_waypoints);
  }
  return result;
}

function sanitizePath(path) {
  const result = {
    distance: path.distance,
    time: path.time,
    points: sanitizeGeometry(path.points),
    instructions: path.instructions.map((instruction) => Object.fromEntries(
      SAFE_INSTRUCTION_FIELDS
        .filter((field) => instruction[field] !== undefined)
        .map((field) => [field, instruction[field]])
    ))
  };
  if (path.ascend !== undefined) result.ascend = path.ascend;
  if (path.descend !== undefined) result.descend = path.descend;
  if (path.details !== undefined) {
    result.details = Object.fromEntries(
      SAFE_DETAIL_FIELDS
        .filter((field) => path.details[field] !== undefined)
        .map((field) => [field, path.details[field]])
    );
  }
  if (path.snapped_waypoints !== undefined) {
    result.snapped_waypoints = sanitizeGeometry(path.snapped_waypoints);
  }
  return result;
}

function isValidPath(path) {
  return Boolean(
    path && typeof path === "object" && !Array.isArray(path) &&
    Number.isFinite(path.distance) && path.distance >= 0 &&
    Number.isFinite(path.time) && path.time >= 0 &&
    (path.ascend === undefined || Number.isFinite(path.ascend)) &&
    (path.descend === undefined || Number.isFinite(path.descend)) &&
    isValidGeometry(path.points, 2) &&
    Array.isArray(path.instructions) && path.instructions.every(isValidInstruction) &&
    (path.details === undefined || isValidDetails(path.details)) &&
    (path.snapped_waypoints === undefined || isValidGeometry(path.snapped_waypoints, 1))
  );
}

function isValidGeometry(geometry, minimumCoordinates) {
  return Boolean(
    geometry && typeof geometry === "object" && !Array.isArray(geometry) &&
    typeof geometry.type === "string" && Array.isArray(geometry.coordinates) &&
    geometry.coordinates.length >= minimumCoordinates &&
    geometry.coordinates.every((coordinate) =>
      Array.isArray(coordinate) && coordinate.length >= 2 && coordinate.length <= 3 &&
      Number.isFinite(coordinate[0]) && coordinate[0] >= -180 && coordinate[0] <= 180 &&
      Number.isFinite(coordinate[1]) && coordinate[1] >= -90 && coordinate[1] <= 90 &&
      (coordinate.length < 3 || Number.isFinite(coordinate[2]))
    )
  );
}

function sanitizeGeometry(geometry) {
  return { type: geometry.type, coordinates: geometry.coordinates };
}

function isValidInstruction(instruction) {
  return Boolean(
    instruction && typeof instruction === "object" && !Array.isArray(instruction) &&
    typeof instruction.text === "string" &&
    (instruction.street_name === undefined || typeof instruction.street_name === "string") &&
    Number.isFinite(instruction.distance) && Number.isFinite(instruction.time) &&
    Array.isArray(instruction.interval) && instruction.interval.length === 2 &&
    instruction.interval.every(Number.isInteger) && Number.isInteger(instruction.sign)
  );
}

function isValidDetails(details) {
  return Boolean(
    details && typeof details === "object" && !Array.isArray(details) &&
    SAFE_DETAIL_FIELDS.every((field) => details[field] === undefined || Array.isArray(details[field]))
  );
}

async function readProviderError(response) {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function isNoRoutePayload(payload) {
  return providerMessages(payload).some((message) =>
    /cannot find|could not find|connection not found|no route|route not found|point.*not found/i.test(message)
  );
}

function isFlexibleModePayload(payload) {
  return providerMessages(payload).some((message) =>
    /flexible mode|ch\.disable|custom model.*not (?:available|supported)/i.test(message)
  );
}

function providerMessages(payload) {
  const messages = [];
  if (typeof payload?.message === "string") messages.push(payload.message);
  if (Array.isArray(payload?.hints)) {
    for (const hint of payload.hints) {
      if (typeof hint?.message === "string") messages.push(hint.message);
      if (typeof hint?.details === "string") messages.push(hint.details);
    }
  }
  return messages;
}

function boundedInteger(rawValue, fallback, minimum, maximum) {
  if (rawValue === undefined || rawValue === "") return fallback;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw routeError("configuration_missing");
  }
  return value;
}
