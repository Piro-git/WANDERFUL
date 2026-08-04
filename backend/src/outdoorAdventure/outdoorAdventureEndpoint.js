import { randomUUID } from "node:crypto";
import { AppAttestError } from "../appAttest/appAttestErrors.js";
import {
  createRouteSessionAuthorizer
} from "../appAttest/routeSessionAuthorizer.js";
import {
  PostgresOutdoorResearchRepository
} from "../outdoorResearch/postgresOutdoorResearchRepository.js";
import { createGraphHopperProvider } from "../routing/graphHopperProvider.js";
import {
  authorizeRouteRequest,
  createDevelopmentRouteAuthorizer
} from "../routing/routeAuthorization.js";
import { InMemoryRouteRateLimiter } from "../routing/routeRateLimiter.js";
import {
  serializeOutdoorAdventurePlanningResponseV1,
  validateOutdoorAdventurePlanningRequestV1
} from "./orchestrationContract.js";
import {
  serializeOutdoorAdventurePlanningResponseV2,
  validateOutdoorAdventurePlanningRequestV2
} from "./orchestrationContractV2.js";
import {
  OutdoorAdventureOrchestrationError,
  outdoorAdventureOrchestrationError,
  outdoorAdventureOrchestrationErrorResult
} from "./orchestrationErrors.js";
import {
  planAndRouteOutdoorAdventureV1
} from "./outdoorAdventureOrchestrator.js";
import {
  planAndRouteOutdoorAdventureV2
} from "./outdoorAdventureOrchestratorV2.js";
import {
  outdoorAdventureDurationBucket,
  outdoorAdventureInsecureLocalEnabled,
  outdoorAdventureOrchestrationConfigurationV1,
  outdoorAdventurePlanningEnabled
} from "./orchestrationPolicy.js";
import {
  routableHighlightAccessEnabled
} from "./orchestrationPolicyV2.js";

export function createOutdoorAdventurePlanningEndpoint(options = {}) {
  const env = options.env ?? process.env;
  const logger = options.logger ?? { info() {} };
  const now = options.now ?? Date.now;

  return async function outdoorAdventurePlanningEndpoint(
    body,
    context = {}
  ) {
    const requestId = safeRequestId(context) ?? randomUUID();
    const startedAt = now();
    let authorization;
    let safeMetadata;
    let resultState;
    let errorCode;
    let attemptCount;
    let routeResultCount;

    try {
      if (!outdoorAdventurePlanningEnabled(env)) {
        throw outdoorAdventureOrchestrationError("feature_unavailable");
      }
      if (context.signal?.aborted) {
        throw outdoorAdventureOrchestrationError("cancelled");
      }
      const configuration =
        outdoorAdventureOrchestrationConfigurationV1(env);
      const useTrailAccessV2 = body?.schemaVersion === 2;
      if (useTrailAccessV2 && !routableHighlightAccessEnabled(env)) {
        throw outdoorAdventureOrchestrationError("feature_unavailable");
      }
      const request = useTrailAccessV2
        ? validateOutdoorAdventurePlanningRequestV2(body)
        : validateOutdoorAdventurePlanningRequestV1(body);
      safeMetadata = metadataFromIntent(request.intent);
      const authorizer = resolveAuthorizer(options, env);
      authorization = await authorizeRouteRequest(authorizer, {
        ...context,
        requestId,
        cost: configuration.authorizationCost
      });
      if (authorization.limitsConsumed !== true) {
        const rateLimiter = resolveRateLimiter(options, env);
        const limit = await rateLimiter.consume({
          key: authorization.rateLimitKey,
          cost: configuration.authorizationCost,
          requestId
        });
        if (!limit?.allowed) {
          throw outdoorAdventureOrchestrationError("rate_limited");
        }
      }

      const dependencies = resolveDependencies(
        options,
        configuration
      );
      const orchestrator = useTrailAccessV2
        ? options.orchestratorV2 ?? options.orchestrator ??
          planAndRouteOutdoorAdventureV2
        : options.orchestrator ?? planAndRouteOutdoorAdventureV1;
      const payload = await orchestrator(
        request,
        dependencies,
        {
          signal: context.signal,
          maximumProposals: configuration.maximumProposals,
          maximumConcurrency: configuration.maximumConcurrency,
          researchTimeoutMs: configuration.researchTimeoutMs,
          graphHopperAttemptTimeoutMs:
            configuration.graphHopperAttemptTimeoutMs,
          totalDeadlineMs: configuration.totalDeadlineMs
        }
      );
      const serialized = useTrailAccessV2
        ? serializeOutdoorAdventurePlanningResponseV2(payload)
        : serializeOutdoorAdventurePlanningResponseV1(payload);
      if (
        Buffer.byteLength(serialized, "utf8") >
        configuration.responseBytes
      ) {
        throw outdoorAdventureOrchestrationError("response_too_large");
      }
      const responsePayload = JSON.parse(serialized);
      resultState = responsePayload.state;
      attemptCount =
        responsePayload.routedAlternatives?.attempts.length ?? 0;
      routeResultCount =
        responsePayload.routedAlternatives?.attempts.reduce(
          (total, attempt) => total + attempt.routeResults.length,
          0
        ) ?? 0;
      return { statusCode: 200, payload: responsePayload };
    } catch (error) {
      const safeError = normalizeEndpointError(error);
      const result =
        outdoorAdventureOrchestrationErrorResult(safeError);
      errorCode = result.payload.error.code;
      return result;
    } finally {
      try {
        await authorization?.release?.();
      } catch {
        // Lease-release failures are operational only and never alter output.
      }
      try {
        logger.info({
          event: "outdoor_adventure_planning_completed",
          requestId,
          resultState,
          ...safeMetadata,
          proposalCount: attemptCount,
          attemptCount,
          routeResultCount,
          durationBucket: outdoorAdventureDurationBucket(
            Math.max(0, now() - startedAt)
          ),
          errorCode
        });
      } catch {
        // Logging must never alter an endpoint response.
      }
    }
  };
}

function resolveDependencies(options, configuration) {
  const pool = options.postgresPool ??
    options.appAttestRepository?.pool;
  const cancellationPool = options.postgresCancellationPool ??
    options.appAttestRepository?.cancellationPool;
  let repository = options.repository;
  if (!repository && pool?.connect) {
    repository = new PostgresOutdoorResearchRepository({
      pool,
      cancellationPool,
      statementTimeoutMs: configuration.statementTimeoutMs
    });
  }
  if (!repository) {
    throw outdoorAdventureOrchestrationError("research_unavailable");
  }
  const provider = options.provider ?? createGraphHopperProvider({
    ...options,
    env: options.env ?? process.env
  });
  return {
    repository,
    provider,
    clock: options.researchClock,
    regionBindings: options.regionBindings,
    ...(options.orchestrationDependencies ?? {})
  };
}

function resolveAuthorizer(options, env) {
  if (options.authorizer) return options.authorizer;
  if (options.appAttestRepository) {
    return createRouteSessionAuthorizer({
      repository: options.appAttestRepository,
      env
    });
  }
  if (outdoorAdventureInsecureLocalEnabled(env)) {
    return createDevelopmentRouteAuthorizer();
  }
  return createRouteSessionAuthorizer({ repository: undefined, env });
}

function resolveRateLimiter(options, env) {
  if (options.rateLimiter) return options.rateLimiter;
  if (env.NODE_ENV === "production") {
    return {
      consume() {
        throw outdoorAdventureOrchestrationError(
          "authorization_unavailable"
        );
      }
    };
  }
  return new InMemoryRouteRateLimiter(options.rateLimit);
}

function normalizeEndpointError(error) {
  if (error instanceof OutdoorAdventureOrchestrationError) {
    return error;
  }
  if (error instanceof AppAttestError) {
    if (error.code === "app_attest_rate_limited") {
      return outdoorAdventureOrchestrationError("rate_limited", {
        cause: error
      });
    }
    if (error.code === "authorization_unavailable") {
      return outdoorAdventureOrchestrationError(
        "authorization_unavailable",
        { cause: error }
      );
    }
    return outdoorAdventureOrchestrationError(
      "authorization_failed",
      { cause: error }
    );
  }
  return outdoorAdventureOrchestrationError("internal_failure", {
    cause: error
  });
}

function metadataFromIntent(intent) {
  return {
    activity: intent.activity,
    routeType: intent.routeType,
    regionId: intent.geographicAnchor.state === "resolved"
      ? intent.geographicAnchor.regionEntityId ?? undefined
      : undefined
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
