import { createServer } from "node:http";
import { AppAttestError, appAttestErrorResult } from "./appAttest/appAttestErrors.js";
import { createAppAttestRuntime } from "./appAttest/appAttestRuntime.js";
import { createIntentSessionEndpoint } from "./appAttest/intentSessionEndpoint.js";
import { IntentParseError } from "./parseIntent.js";
import { createRouteEndpoint } from "./routing/routeEndpoint.js";
import { RouteError, routeError, routeErrorResult } from "./routing/routeErrors.js";

const PORT = Number(process.env.PORT || 3000);

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
  return async function intentRequestHandler(request, response) {
    const cancellation = new AbortController();
    request.on("aborted", () => cancellation.abort());
    response.on("close", () => {
      if (!response.writableEnded) cancellation.abort();
    });

    try {
      const knownPostRoute = request.method === "POST" && isKnownPostPath(request.url);
      let body = {};
      if (knownPostRoute) {
        if (!isJsonMediaType(request.headers["content-type"])) {
          throw routeError("invalid_request", { message: "Content-Type must be application/json." });
        }
        body = await readJsonBody(
          request,
          bodyLimit(request.url, options.env),
          request.url !== "/api/parse-intent"
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
        { ...options, routeEndpoint, appAttestEndpoint, intentEndpoint }
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
      const statusCode = error instanceof IntentParseError ? error.statusCode : 500;
      return sendJson(response, statusCode, {
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  };
}

export async function handleIntentHttpRequest(request, options = {}) {
  try {
    if (request.method === "GET" && request.url === "/health") {
      return { statusCode: 200, payload: { ok: true } };
    }

    if (request.method === "POST" && request.url === "/api/route") {
      const routeEndpoint = options.routeEndpoint ?? createRouteEndpoint(options);
      return await routeEndpoint(request.body, {
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
    const statusCode = error instanceof IntentParseError ? error.statusCode : 500;
    return {
      statusCode,
      payload: {
        error: error instanceof Error ? error.message : "Unknown error"
      }
    };
  }
}

function readJsonBody(request, maxBytes, routeErrorContract) {
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
          routeErrorContract
            ? routeError("request_too_large")
            : new IntentParseError("Request body is too large.", 413)
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
          routeErrorContract
            ? routeError("invalid_request", { message: "Request body must be valid JSON." })
            : new IntentParseError("Request body must be valid JSON.", 400)
        );
      }
    };
    const onError = (error) => finish(reject, error);
    const onAborted = () => finish(
      reject,
      routeErrorContract
        ? routeError("request_cancelled")
        : new IntentParseError("Request was cancelled.", 400)
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
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...additionalHeaders
  });
  response.end(JSON.stringify(payload));
}

function isKnownPostPath(url) {
  return url === "/api/parse-intent" || url === "/api/route" ||
    url === "/api/app-attest/challenge" || url === "/api/app-attest/register" ||
    url === "/api/app-attest/route-session";
}

function bodyLimit(url, env) {
  if (url === "/api/route") return routeBodyLimit(env);
  if (url?.startsWith("/api/app-attest/")) return 262_144;
  return 16_384;
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

export default createIntentRequestHandler();

if (import.meta.url === `file://${process.argv[1]}`) {
  createIntentServer().listen(PORT, () => {
    console.log(`TrailMind backend listening on http://localhost:${PORT}`);
  });
}
