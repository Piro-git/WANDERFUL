import { createServer } from "node:http";
import { AppAttestError, appAttestErrorResult } from "./appAttest/appAttestErrors.js";
import { createAppAttestRuntime } from "./appAttest/appAttestRuntime.js";
import { createIntentSessionEndpoint } from "./appAttest/intentSessionEndpoint.js";
import { intentError, intentErrorResult } from "./parseIntent.js";
import { createOutdoorAdventurePlanningEndpoint } from "./outdoorAdventure/outdoorAdventureEndpoint.js";
import {
  OutdoorAdventureOrchestrationError,
  outdoorAdventureOrchestrationError,
  outdoorAdventureOrchestrationErrorResult
} from "./outdoorAdventure/orchestrationErrors.js";
import {
  OUTDOOR_ADVENTURE_ORCHESTRATION_POLICY_V1,
  outdoorAdventureOrchestrationConfigurationV1,
  outdoorAdventurePlanningEnabled
} from "./outdoorAdventure/orchestrationPolicy.js";
import { createOutdoorEvidenceEndpoint } from "./outdoorEvidence/outdoorEvidenceEndpoint.js";
import {
  OutdoorEvidenceError,
  outdoorEvidenceError,
  outdoorEvidenceErrorResult
} from "./outdoorEvidence/outdoorEvidenceErrors.js";
import { postgresOutdoorEvidenceRepositoryFromRuntime } from "./outdoorEvidence/postgresOutdoorEvidenceRepository.js";
import { createRouteEndpoint } from "./routing/routeEndpoint.js";
import { RouteError, routeError, routeErrorResult } from "./routing/routeErrors.js";

export function createIntentServer(options = {}) {
  return createServer(createIntentRequestHandler(options));
}

export function createIntentRequestHandler(options = {}) {
  const appAttestRuntime = options.appAttestRuntime ?? createAppAttestRuntime(options);
  const appAttestEndpoint = options.appAttestEndpoint ?? appAttestRuntime.endpoint;
  const intentEndpoint = options.intentEndpoint ?? createIntentSessionEndpoint({
    ...options,
    appAttestRepository: appAttestRuntime.repository,
    intentAuthorizer: options.intentAuthorizer ?? appAttestRuntime.intentAuthorizer
  });
  const routeEndpoint = options.routeEndpoint ?? createRouteEndpoint({
    ...options,
    appAttestRepository: appAttestRuntime.repository,
    authorizer: options.authorizer ?? (appAttestRuntime.repository ? appAttestRuntime.routeAuthorizer : undefined)
  });
  const outdoorEvidenceRepository = options.outdoorEvidenceRepository ??
    postgresOutdoorEvidenceRepositoryFromRuntime({
      pool: options.postgresPool,
      appAttestRepository: appAttestRuntime.repository,
      statementTimeoutMs: outdoorEvidenceQueryTimeout(options.env)
    });
  const outdoorEvidenceEndpoint = options.outdoorEvidenceEndpoint ?? createOutdoorEvidenceEndpoint({
    ...options,
    repository: outdoorEvidenceRepository,
    appAttestRepository: appAttestRuntime.repository,
    authorizer: options.authorizer ?? (appAttestRuntime.repository ? appAttestRuntime.routeAuthorizer : undefined),
    maximumPois: outdoorEvidenceMaximumPois(options.env),
    maximumResponseBytes: outdoorEvidenceResponseLimit(options.env)
  });
  const outdoorAdventurePlanningEndpoint =
    options.outdoorAdventurePlanningEndpoint ??
    createOutdoorAdventurePlanningEndpoint({
      ...options,
      appAttestRepository: appAttestRuntime.repository,
      authorizer: options.authorizer ??
        (appAttestRuntime.repository
          ? appAttestRuntime.routeAuthorizer
          : undefined)
    });
  return async function intentRequestHandler(request, response) {
    const health = operationalHealthResult(
      request.method,
      request.url,
      options.operationalState
    );
    if (health) {
      return sendJson(response, health.statusCode, health.payload);
    }
    if (
      options.operationalState &&
      options.operationalState.isAccepting?.() !== true
    ) {
      const result = serviceUnavailableResult();
      return sendJson(response, result.statusCode, result.payload);
    }
    const cancellation = new AbortController();
    if (
      options.operationalState &&
      options.operationalState.register?.(cancellation) !== true
    ) {
      const result = serviceUnavailableResult();
      return sendJson(response, result.statusCode, result.payload);
    }
    const abortFromRequest = () => cancellation.abort();
    const abortFromResponse = () => {
      if (!response.writableEnded) cancellation.abort();
    };
    request.once("aborted", abortFromRequest);
    response.once("close", abortFromResponse);

    try {
      const knownPostRoute = request.method === "POST" && isKnownPostPath(request.url);
      let body = {};
      if (knownPostRoute) {
        if (
          request.url ===
            OUTDOOR_ADVENTURE_ORCHESTRATION_POLICY_V1.endpointPath &&
          !outdoorAdventurePlanningEnabled(options.env ?? process.env)
        ) {
          const result = await outdoorAdventurePlanningEndpoint({}, {
            headers: request.headers,
            signal: cancellation.signal
          });
          return sendJson(
            response,
            result.statusCode,
            result.payload,
            result.headers
          );
        }
        if (!isJsonMediaType(request.headers["content-type"])) {
          if (request.url === "/api/parse-intent") throw intentError("invalid_request");
          if (request.url === "/api/outdoor-evidence/corridor") {
            throw outdoorEvidenceError("invalid_request", { message: "Content-Type must be application/json." });
          }
          if (
            request.url ===
              OUTDOOR_ADVENTURE_ORCHESTRATION_POLICY_V1.endpointPath
          ) {
            throw outdoorAdventureOrchestrationError("invalid_request");
          }
          throw routeError("invalid_request", { message: "Content-Type must be application/json." });
        }
        body = await readJsonBody(
          request,
          bodyLimit(request.url, options.env),
          requestContract(request.url)
        );
      }
      const result = await handleIntentHttpRequest(
        {
          method: request.method,
          url: request.url,
          body,
          headers: request.headers,
          edgeIdentity: options.edgeIdentityResolver?.(request) ?? request.socket.remoteAddress ?? "unknown-edge",
          signal: cancellation.signal
        },
        {
          ...options,
          routeEndpoint,
          outdoorEvidenceEndpoint,
          outdoorAdventurePlanningEndpoint,
          appAttestEndpoint,
          intentEndpoint
        }
      );
      return sendJson(response, result.statusCode, result.payload, result.headers);
    } catch (error) {
      if (error instanceof AppAttestError) {
        const result = appAttestErrorResult(error);
        return sendJson(response, result.statusCode, result.payload, result.headers);
      }
      if (error instanceof RouteError) {
        const result = routeErrorResult(error);
        return sendJson(response, result.statusCode, result.payload);
      }
      if (error instanceof OutdoorEvidenceError) {
        const result = outdoorEvidenceErrorResult(error);
        return sendJson(response, result.statusCode, result.payload);
      }
      if (error instanceof OutdoorAdventureOrchestrationError) {
        const result = outdoorAdventureOrchestrationErrorResult(error);
        return sendJson(response, result.statusCode, result.payload);
      }
      if (request.url === "/api/parse-intent") {
        const result = intentErrorResult(error);
        return sendJson(response, result.statusCode, result.payload);
      }
      return sendJson(response, 500, { error: "Internal server error" });
    } finally {
      request.removeListener("aborted", abortFromRequest);
      response.removeListener("close", abortFromResponse);
      options.operationalState?.unregister?.(cancellation);
    }
  };
}

export async function handleIntentHttpRequest(request, options = {}) {
  try {
    if (request.method === "GET" && request.url === "/health") {
      return { statusCode: 200, payload: { ok: true } };
    }
    if (request.method === "GET" && request.url === "/health/live") {
      return { statusCode: 200, payload: { status: "live" } };
    }
    if (request.method === "GET" && request.url === "/health/ready") {
      const ready = options.operationalState?.isReady?.() === true;
      return {
        statusCode: ready ? 200 : 503,
        payload: { status: ready ? "ready" : "not_ready" }
      };
    }
    if (
      options.operationalState &&
      options.operationalState.isAccepting?.() !== true
    ) {
      return serviceUnavailableResult();
    }

    if (request.method === "POST" && request.url === "/api/route") {
      const routeEndpoint = options.routeEndpoint ?? createRouteEndpoint(options);
      return await routeEndpoint(request.body, {
        headers: request.headers,
        signal: request.signal,
        requestId: request.requestId
      });
    }

    if (request.method === "POST" && request.url === "/api/outdoor-evidence/corridor") {
      const endpoint = options.outdoorEvidenceEndpoint ?? createOutdoorEvidenceEndpoint(options);
      return await endpoint(request.body, {
        headers: request.headers,
        signal: request.signal,
        requestId: request.requestId
      });
    }

    if (
      request.method === "POST" &&
      request.url ===
        OUTDOOR_ADVENTURE_ORCHESTRATION_POLICY_V1.endpointPath
    ) {
      const endpoint = options.outdoorAdventurePlanningEndpoint ??
        createOutdoorAdventurePlanningEndpoint(options);
      return await endpoint(request.body, {
        headers: request.headers,
        signal: request.signal,
        requestId: request.requestId
      });
    }

    if (request.method === "POST" && request.url?.startsWith("/api/app-attest/")) {
      const appAttestEndpoint = options.appAttestEndpoint ?? createAppAttestRuntime(options).endpoint;
      return await appAttestEndpoint(request.url, request.body, {
        edgeIdentity: request.edgeIdentity,
        headers: request.headers,
        signal: request.signal
      });
    }

    if (request.method !== "POST" || request.url !== "/api/parse-intent") {
      return { statusCode: 404, payload: { error: "Not found" } };
    }

    const intentEndpoint = options.intentEndpoint ?? createIntentSessionEndpoint(options);
    return await intentEndpoint(request.body, {
      headers: request.headers,
      signal: request.signal
    });
  } catch (error) {
    if (request.url === "/api/parse-intent") return intentErrorResult(error);
    if (error instanceof AppAttestError) return appAttestErrorResult(error);
    if (error instanceof RouteError) return routeErrorResult(error);
    if (error instanceof OutdoorEvidenceError) return outdoorEvidenceErrorResult(error);
    if (error instanceof OutdoorAdventureOrchestrationError) {
      return outdoorAdventureOrchestrationErrorResult(error);
    }
    return { statusCode: 500, payload: { error: "Internal server error" } };
  }
}

function readJsonBody(request, maxBytes, contract) {
  return new Promise((resolve, reject) => {
    let data = "";
    let byteCount = 0;
    let settled = false;

    const cleanup = () => {
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("error", onError);
      request.removeListener("aborted", onAborted);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onData = (chunk) => {
      byteCount += Buffer.byteLength(chunk, "utf8");
      if (byteCount > maxBytes) {
        finish(
          reject,
          bodyError(contract, "tooLarge")
        );
        request.resume();
        return;
      }
      data += chunk;
    };
    const onEnd = () => {
      try {
        finish(resolve, data ? JSON.parse(data) : {});
      } catch {
        finish(
          reject,
          bodyError(contract, "invalidJson")
        );
      }
    };
    const onError = (error) => finish(reject, error);
    const onAborted = () => finish(
      reject,
      bodyError(contract, "cancelled")
    );

    request.setEncoding("utf8");
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
    request.on("aborted", onAborted);
  });
}

function sendJson(response, statusCode, payload, additionalHeaders = {}) {
  if (response.destroyed || response.writableEnded) return;
  const serialized = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(serialized, "utf8"),
    "X-Content-Type-Options": "nosniff",
    ...safeAdditionalHeaders(additionalHeaders)
  });
  response.end(serialized);
}

function operationalHealthResult(method, url, operationalState) {
  if (method === "GET" && url === "/health") {
    return { statusCode: 200, payload: { ok: true } };
  }
  if (method === "GET" && url === "/health/live") {
    return { statusCode: 200, payload: { status: "live" } };
  }
  if (method === "GET" && url === "/health/ready") {
    const ready = operationalState?.isReady?.() === true;
    return {
      statusCode: ready ? 200 : 503,
      payload: { status: ready ? "ready" : "not_ready" }
    };
  }
  return undefined;
}

function serviceUnavailableResult() {
  return {
    statusCode: 503,
    payload: {
      error: {
        code: "service_unavailable",
        message: "The service is temporarily unavailable."
      }
    }
  };
}

function safeAdditionalHeaders(headers) {
  const retryAfter = headers?.["Retry-After"] ?? headers?.["retry-after"];
  return typeof retryAfter === "string" && /^\d{1,4}$/.test(retryAfter)
    ? { "Retry-After": retryAfter }
    : {};
}

function isKnownPostPath(url) {
  return url === "/api/parse-intent" || url === "/api/route" ||
    url === "/api/outdoor-evidence/corridor" ||
    url === OUTDOOR_ADVENTURE_ORCHESTRATION_POLICY_V1.endpointPath ||
    url === "/api/app-attest/challenge" || url === "/api/app-attest/register" ||
    url === "/api/app-attest/route-session";
}

function bodyLimit(url, env) {
  if (url === "/api/route") return routeBodyLimit(env);
  if (url === "/api/outdoor-evidence/corridor") return outdoorEvidenceBodyLimit(env);
  if (url === OUTDOOR_ADVENTURE_ORCHESTRATION_POLICY_V1.endpointPath) {
    return outdoorAdventureOrchestrationConfigurationV1(env).requestBytes;
  }
  if (url?.startsWith("/api/app-attest/")) return 262_144;
  return 16_384;
}

function requestContract(url) {
  if (url === "/api/parse-intent") return "intent";
  if (url === "/api/outdoor-evidence/corridor") return "outdoorEvidence";
  if (url === OUTDOOR_ADVENTURE_ORCHESTRATION_POLICY_V1.endpointPath) {
    return "outdoorAdventure";
  }
  return "route";
}

function bodyError(contract, reason) {
  if (contract === "intent") {
    return reason === "cancelled"
      ? intentError("request_cancelled")
      : intentError("invalid_request", reason === "tooLarge" ? { statusCode: 413 } : undefined);
  }
  if (contract === "outdoorEvidence") {
    if (reason === "tooLarge") return outdoorEvidenceError("request_too_large");
    if (reason === "cancelled") return outdoorEvidenceError("request_cancelled");
    return outdoorEvidenceError("invalid_request", { message: "Request body must be valid JSON." });
  }
  if (contract === "outdoorAdventure") {
    if (reason === "tooLarge") {
      return outdoorAdventureOrchestrationError("invalid_request", {
        statusCode: 413
      });
    }
    if (reason === "cancelled") {
      return outdoorAdventureOrchestrationError("cancelled");
    }
    return outdoorAdventureOrchestrationError("invalid_request");
  }
  if (reason === "tooLarge") return routeError("request_too_large");
  if (reason === "cancelled") return routeError("request_cancelled");
  return routeError("invalid_request", { message: "Request body must be valid JSON." });
}

function isJsonMediaType(value) {
  const mediaType = String(value ?? "").split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json";
}

function routeBodyLimit(env = process.env) {
  const rawValue = env?.ROUTE_MAX_BODY_BYTES;
  if (rawValue === undefined || rawValue === "") return 32_768;
  const value = Number(rawValue);
  return Number.isInteger(value) && value >= 1_024 && value <= 262_144 ? value : 32_768;
}

function outdoorEvidenceBodyLimit(env = process.env) {
  return boundedEnvironmentInteger(env?.OUTDOOR_EVIDENCE_MAX_BODY_BYTES, 131_072, 4_096, 262_144);
}

function outdoorEvidenceResponseLimit(env = process.env) {
  return boundedEnvironmentInteger(env?.OUTDOOR_EVIDENCE_MAX_RESPONSE_BYTES, 524_288, 8_192, 2_097_152);
}

function outdoorEvidenceMaximumPois(env = process.env) {
  return boundedEnvironmentInteger(env?.OUTDOOR_EVIDENCE_MAX_POIS, 40, 1, 100);
}

function outdoorEvidenceQueryTimeout(env = process.env) {
  return boundedEnvironmentInteger(env?.OUTDOOR_EVIDENCE_QUERY_TIMEOUT_MS, 2_500, 100, 15_000);
}

function boundedEnvironmentInteger(rawValue, fallback, minimum, maximum) {
  if (rawValue === undefined || rawValue === "") return fallback;
  const value = Number(rawValue);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

export default createIntentRequestHandler();
