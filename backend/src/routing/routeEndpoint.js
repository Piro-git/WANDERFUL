import { randomUUID } from "node:crypto";
import { appAttestErrorResult, AppAttestError } from "../appAttest/appAttestErrors.js";
import { createDefaultRouteAuthorizer, authorizeRouteRequest } from "./routeAuthorization.js";
import { routeError, routeErrorResult } from "./routeErrors.js";
import { createGraphHopperProvider } from "./graphHopperProvider.js";
import { InMemoryRouteRateLimiter, routeRequestCost } from "./routeRateLimiter.js";
import { validateRouteRequest } from "./routeValidation.js";

export function createRouteEndpoint(options = {}) {
  const env = options.env ?? process.env;
  const provider = options.provider ?? createGraphHopperProvider(options);
  const authorizer = options.authorizer ?? createDefaultRouteAuthorizer(env, options);
  const rateLimiter = options.rateLimiter ?? defaultRateLimiter(env, options.rateLimit);
  const logger = options.logger ?? { info() {} };
  const now = options.now ?? Date.now;

  return async function routeEndpoint(body, context = {}) {
    const requestId = safeRequestId(context) ?? randomUUID();
    const startedAt = now();
    let authorization;
    let safeRequestMetadata;
    let statusCode = 500;
    let errorCode;

    try {
      const maxDistanceMeters = integerEnvironmentValue(
        env.ROUTE_MAX_DISTANCE_METERS, 200_000, 1_000, 200_000
      );
      const request = validateRouteRequest(body, { maxDistanceMeters });
      safeRequestMetadata = safeMetadata(request);
      const cost = routeRequestCost(request);
      authorization = await authorizeRouteRequest(authorizer, { ...context, requestId, cost });

      if (authorization.limitsConsumed !== true) {
        const rateLimit = await rateLimiter.consume({
          key: authorization.rateLimitKey,
          cost,
          requestId
        });
        if (!rateLimit?.allowed) {
          throw routeError("routing_rate_limited", {
            statusCode: 429,
            message: "Too many route requests. Please try again later."
          });
        }
      }

      const payload = await provider.route(request, { signal: context.signal, requestId });
      statusCode = 200;
      return { statusCode, payload };
    } catch (error) {
      if (error instanceof AppAttestError) {
        const result = appAttestErrorResult(error);
        statusCode = result.statusCode;
        errorCode = result.payload.error.code;
        return result;
      }
      const result = routeErrorResult(error);
      statusCode = result.statusCode;
      errorCode = result.payload.error.code;
      return result;
    } finally {
      try {
        await authorization?.release?.();
      } catch {
        // A leaked concurrency lease is operationally serious but must not expose data.
      }
      try {
        logger.info({
          event: "route_request_completed",
          requestId,
          ...safeRequestMetadata,
          statusCode,
          errorCode,
          providerLatencyMs: Math.max(0, now() - startedAt)
        });
      } catch {
        // Operational logging must never change a route response.
      }
    }
  };
}

function safeRequestId(context) {
  const header = context.headers?.["x-trailmind-request-id"];
  const value = Array.isArray(header) ? undefined : header;
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : context.requestId;
}

function defaultRateLimiter(env, options) {
  if (env.NODE_ENV === "production") {
    return {
      consume() {
        throw routeError("configuration_missing");
      }
    };
  }
  return new InMemoryRouteRateLimiter(options);
}

function safeMetadata(request) {
  return {
    routeType: request.routeType,
    profile: request.profile,
    pointCount: request.points.length,
    algorithm: request.algorithm ?? "standard",
    distanceCategory: distanceCategory(request.roundTrip?.distanceMeters)
  };
}

function distanceCategory(distanceMeters) {
  if (distanceMeters === undefined) return undefined;
  if (distanceMeters < 10_000) return "under_10km";
  if (distanceMeters < 50_000) return "10_to_50km";
  if (distanceMeters < 100_000) return "50_to_100km";
  return "100km_or_more";
}

function integerEnvironmentValue(rawValue, fallback, minimum, maximum) {
  if (rawValue === undefined || rawValue === "") return fallback;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw routeError("configuration_missing");
  }
  return value;
}
