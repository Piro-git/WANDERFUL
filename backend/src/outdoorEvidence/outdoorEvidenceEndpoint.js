import { randomUUID } from "node:crypto";
import { AppAttestError, appAttestErrorResult } from "../appAttest/appAttestErrors.js";
import { authorizeRouteRequest, createDefaultRouteAuthorizer } from "../routing/routeAuthorization.js";
import { InMemoryRouteRateLimiter } from "../routing/routeRateLimiter.js";
import { OutdoorEvidenceError, outdoorEvidenceError, outdoorEvidenceErrorResult } from "./outdoorEvidenceErrors.js";
import { createOutdoorEvidenceService } from "./outdoorEvidenceService.js";
import {
  distanceBucket,
  pointCountBucket,
  validateOutdoorEvidenceRequest
} from "./outdoorEvidenceValidation.js";

export function createOutdoorEvidenceEndpoint(options = {}) {
  const env = options.env ?? process.env;
  let authorizer = options.authorizer;
  let rateLimiter = options.rateLimiter;
  let service = options.service;
  const logger = options.logger ?? { info() {} };
  const now = options.now ?? Date.now;

  return async function outdoorEvidenceEndpoint(body, context = {}) {
    const requestId = safeRequestId(context) ?? randomUUID();
    const startedAt = now();
    let authorization;
    let safeMetadata;
    let statusCode = 500;
    let errorCode;
    let matchedRegions;

    try {
      if (!explicitlyEnabled(env.OUTDOOR_EVIDENCE_PROVIDER_ENABLED)) {
        throw outdoorEvidenceError("evidence_unavailable");
      }
      const request = validateOutdoorEvidenceRequest(body, {
        maximumCoordinates: integer(env.OUTDOOR_EVIDENCE_MAX_COORDINATES, 2_000, 2, 5_000),
        maximumDistanceMeters: integer(env.OUTDOOR_EVIDENCE_MAX_DISTANCE_METERS, 200_000, 1_000, 500_000)
      });
      safeMetadata = {
        pointCountBucket: pointCountBucket(request.geometry.length),
        distanceBucket: distanceBucket(request.distanceMeters),
        corridorWidthMeters: request.corridorWidthMeters
      };
      const requestCost = integer(env.OUTDOOR_EVIDENCE_REQUEST_COST, 4, 1, 12);
      authorizer ??= createDefaultRouteAuthorizer(env, options);
      authorization = await authorizeRouteRequest(authorizer, { ...context, requestId, cost: requestCost });
      if (authorization.limitsConsumed !== true) {
        rateLimiter ??= defaultRateLimiter(env, options.rateLimit);
        const limit = await rateLimiter.consume({
          key: authorization.rateLimitKey,
          cost: requestCost,
          requestId
        });
        if (!limit?.allowed) throw outdoorEvidenceError("evidence_rate_limited");
      }
      service ??= createOutdoorEvidenceService(options);
      const payload = await service.corridor(request, { signal: context.signal, requestId });
      matchedRegions = Array.isArray(payload.regions)
        ? payload.regions.slice(0, 8).map((region) => region.id).join(",") || undefined
        : undefined;
      statusCode = 200;
      return { statusCode, payload };
    } catch (error) {
      if (error instanceof AppAttestError) {
        const result = appAttestErrorResult(error);
        statusCode = result.statusCode;
        errorCode = result.payload.error.code;
        return result;
      }
      const result = outdoorEvidenceErrorResult(error);
      statusCode = result.statusCode;
      errorCode = result.payload.error.code;
      return result;
    } finally {
      try { await authorization?.release?.(); } catch {}
      try {
        logger.info({
          event: "outdoor_evidence_request_completed",
          requestId,
          ...safeMetadata,
          regions: matchedRegions,
          statusCode,
          errorCode,
          durationMs: Math.max(0, now() - startedAt)
        });
      } catch {}
    }
  };
}

function defaultRateLimiter(env, options) {
  if (env.NODE_ENV === "production") {
    return { consume() { throw outdoorEvidenceError("evidence_unavailable"); } };
  }
  return new InMemoryRouteRateLimiter(options);
}

function safeRequestId(context) {
  const header = context.headers?.["x-trailmind-request-id"];
  const value = Array.isArray(header) ? undefined : header;
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : context.requestId;
}

function integer(value, fallback, minimum, maximum) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new OutdoorEvidenceError("evidence_unavailable");
  }
  return number;
}

function explicitlyEnabled(value) {
  return typeof value === "string" && ["1", "true", "yes"].includes(value.trim().toLowerCase());
}
