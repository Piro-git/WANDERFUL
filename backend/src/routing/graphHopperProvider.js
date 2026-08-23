import { RouteError, routeError } from "./routeErrors.js";

const DEFAULT_BASE_URL = "https://graphhopper.com/api/1";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2_097_152;
const MIN_MAX_RESPONSE_BYTES = 65_536;
const MAX_MAX_RESPONSE_BYTES = 8_388_608;
const DEFAULT_MAX_ERROR_RESPONSE_BYTES = 32_768;
const MIN_MAX_ERROR_RESPONSE_BYTES = 1_024;
const MAX_MAX_ERROR_RESPONSE_BYTES = 65_536;
const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 3;
const MIN_CIRCUIT_FAILURE_THRESHOLD = 2;
const MAX_CIRCUIT_FAILURE_THRESHOLD = 20;
const DEFAULT_CIRCUIT_OPEN_MS = 30_000;
const MIN_CIRCUIT_OPEN_MS = 1_000;
const MAX_CIRCUIT_OPEN_MS = 300_000;
const SAFE_INSTRUCTION_FIELDS = Object.freeze([
  "text", "street_name", "distance", "time", "interval", "sign"
]);
const SAFE_DETAIL_FIELDS = Object.freeze(["surface", "road_class", "hike_rating"]);

export function createGraphHopperProvider(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
  const circuit = createProviderCircuit({
    logger: options.logger,
    operationalState: options.operationalState,
    now: options.providerCircuitNow ?? options.now ?? Date.now
  });

  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");

  return {
    async route(request, context = {}) {
      let configuration;
      try {
        configuration = providerConfiguration(env);
      } catch (error) {
        if (error instanceof RouteError && error.code === "configuration_missing") {
          circuit.configurationUnavailable();
        }
        throw error;
      }
      const upstreamRequest = buildGraphHopperRequest(request, configuration);

      if (context.signal?.aborted) throw routeError("request_cancelled");
      const circuitToken = circuit.acquire(configuration.circuit);
      if (!circuitToken) throw routeError("routing_unavailable");

      const controller = new AbortController();
      let timedOut = false;
      let timeout;
      const abortFromClient = () => controller.abort();

      context.signal?.addEventListener("abort", abortFromClient, { once: true });
      if (context.signal?.aborted) {
        context.signal.removeEventListener("abort", abortFromClient);
        circuit.settle(circuitToken, "neutral");
        throw routeError("request_cancelled");
      }

      try {
        try {
          timeout = setTimeoutImpl(() => {
            timedOut = true;
            controller.abort();
          }, configuration.timeoutMs);
        } catch (error) {
          circuit.settle(circuitToken, "neutral");
          throw routeError("routing_unavailable", { cause: error });
        }
        const response = await fetchImpl(upstreamRequest.url, {
          ...upstreamRequest.init,
          signal: controller.signal
        });
        assertProviderRequestActive({ timedOut, clientSignal: context.signal });
        const result = await normalizeGraphHopperResponse(response, {
          signal: controller.signal,
          maximumResponseBytes: configuration.maximumResponseBytes,
          maximumErrorResponseBytes: configuration.maximumErrorResponseBytes
        });
        assertProviderRequestActive({ timedOut, clientSignal: context.signal });
        circuit.settle(circuitToken, "success");
        return result;
      } catch (error) {
        const normalized = normalizeProviderError(error, {
          timedOut,
          clientSignal: context.signal
        });
        circuit.settle(circuitToken, providerCircuitOutcome(normalized));
        throw normalized;
      } finally {
        if (timeout !== undefined) clearTimeoutImpl(timeout);
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
  const maximumResponseBytes = boundedInteger(
    env.ROUTE_PROVIDER_MAX_RESPONSE_BYTES,
    DEFAULT_MAX_RESPONSE_BYTES,
    MIN_MAX_RESPONSE_BYTES,
    MAX_MAX_RESPONSE_BYTES
  );
  const maximumErrorResponseBytes = boundedInteger(
    env.ROUTE_PROVIDER_MAX_ERROR_RESPONSE_BYTES,
    DEFAULT_MAX_ERROR_RESPONSE_BYTES,
    MIN_MAX_ERROR_RESPONSE_BYTES,
    MAX_MAX_ERROR_RESPONSE_BYTES
  );
  if (maximumErrorResponseBytes >= maximumResponseBytes) {
    throw routeError("configuration_missing");
  }
  const circuit = Object.freeze({
    failureThreshold: boundedInteger(
      env.ROUTE_PROVIDER_CIRCUIT_FAILURE_THRESHOLD,
      DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
      MIN_CIRCUIT_FAILURE_THRESHOLD,
      MAX_CIRCUIT_FAILURE_THRESHOLD
    ),
    openMs: boundedInteger(
      env.ROUTE_PROVIDER_CIRCUIT_OPEN_MS,
      DEFAULT_CIRCUIT_OPEN_MS,
      MIN_CIRCUIT_OPEN_MS,
      MAX_CIRCUIT_OPEN_MS
    )
  });
  return Object.freeze({
    apiKey,
    baseUrl: parsedUrl.toString().replace(/\/$/, ""),
    timeoutMs,
    maximumResponseBytes,
    maximumErrorResponseBytes,
    circuit
  });
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

async function normalizeGraphHopperResponse(response, options) {
  if (!response || typeof response.status !== "number") throw routeError("routing_unavailable");
  if (!response.ok) {
    const providerPayload = await readProviderError(response, options);
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
    const body = await readBoundedProviderBody(
      response,
      options.maximumResponseBytes,
      options.signal
    );
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
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

async function readProviderError(response, options) {
  try {
    const body = await readBoundedProviderBody(
      response,
      options.maximumErrorResponseBytes,
      options.signal
    );
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

async function readBoundedProviderBody(response, maximumBytes, signal) {
  const declaredLength = contentLength(response);
  if (declaredLength !== undefined && declaredLength > maximumBytes) {
    cancelResponseBody(response);
    throw new RangeError("provider_response_too_large");
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    throw new TypeError("provider_response_body_unavailable");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await readProviderChunk(reader, signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new TypeError("provider_response_chunk_invalid");
      }
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        cancelReader(reader);
        throw new RangeError("provider_response_too_large");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    if (signal?.aborted) cancelReader(reader);
    try { reader.releaseLock(); } catch {}
  }
  return Buffer.concat(chunks, totalBytes);
}

function readProviderChunk(reader, signal) {
  if (!signal) return reader.read();
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(reader.read()).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error)
    );
  });
}

function contentLength(response) {
  let rawValue;
  try {
    rawValue = response.headers?.get?.("content-length");
  } catch {
    return undefined;
  }
  if (typeof rawValue !== "string" || !/^(0|[1-9]\d*)$/.test(rawValue.trim())) {
    return undefined;
  }
  const value = Number(rawValue.trim());
  return Number.isSafeInteger(value) ? value : undefined;
}

function cancelResponseBody(response) {
  try {
    const cancellation = response.body?.cancel?.();
    Promise.resolve(cancellation).catch(() => {});
  } catch {}
}

function cancelReader(reader) {
  try {
    const cancellation = reader.cancel();
    Promise.resolve(cancellation).catch(() => {});
  } catch {}
}

function abortError() {
  return Object.assign(new Error("provider_request_aborted"), { name: "AbortError" });
}

function assertProviderRequestActive({ timedOut, clientSignal }) {
  if (clientSignal?.aborted) throw routeError("request_cancelled");
  if (timedOut) throw routeError("route_timed_out");
}

function normalizeProviderError(error, { timedOut, clientSignal }) {
  if (clientSignal?.aborted) return routeError("request_cancelled", { cause: error });
  if (timedOut) return routeError("route_timed_out", { cause: error });
  if (error instanceof RouteError) return error;
  return routeError("routing_unavailable", { cause: error });
}

function providerCircuitOutcome(error) {
  if (error.code === "configuration_missing") return "configuration_failure";
  return ["routing_unavailable", "route_timed_out"].includes(error.code)
    ? "failure"
    : "neutral";
}

function createProviderCircuit(options) {
  const now = options.now;
  let state = "closed";
  let consecutiveFailures = 0;
  let openUntil = 0;
  let generation = 0;

  const setProviderReady = (value) => {
    try {
      options.operationalState?.setProviderReady?.(value);
    } catch {}
  };

  const transition = (nextState, reason) => {
    state = nextState;
    generation += 1;
    setProviderReady(nextState === "closed");
    try {
      options.logger?.info?.({
        event: "provider_circuit_state_changed",
        state: nextState,
        reason
      });
    } catch {}
  };

  return Object.freeze({
    configurationUnavailable() {
      setProviderReady(false);
    },
    acquire(policy) {
      if (state === "closed") {
        return { mode: "closed", generation, policy, settled: false };
      }
      if (state === "open" && now() >= openUntil) {
        transition("half_open", "cooldown_elapsed");
        return { mode: "half_open", generation, policy, settled: false };
      }
      return undefined;
    },
    settle(token, outcome) {
      if (!token || token.settled) return;
      token.settled = true;
      if (token.generation !== generation) return;

      if (token.mode === "half_open") {
        if (outcome === "success") {
          consecutiveFailures = 0;
          transition("closed", "probe_succeeded");
          return;
        }
        if (outcome === "configuration_failure") setProviderReady(false);
        openUntil = now() + token.policy.openMs;
        transition("open", outcome === "failure" ? "probe_failed" : "probe_abandoned");
        return;
      }
      if (state !== "closed") return;
      if (outcome === "success") {
        consecutiveFailures = 0;
        setProviderReady(true);
        return;
      }
      if (outcome === "configuration_failure") {
        setProviderReady(false);
        return;
      }
      if (outcome !== "failure") return;
      consecutiveFailures += 1;
      if (consecutiveFailures >= token.policy.failureThreshold) {
        openUntil = now() + token.policy.openMs;
        transition("open", "failure_threshold");
      }
    }
  });
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
