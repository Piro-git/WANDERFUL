import {validateConditionRecheck,recheckConditions} from '../dynamicResearch/recheck.js';
import {createConditionLookup} from '../dynamicResearch/conditionSources.js';
import {validateDynamicRequest} from '../dynamicResearch/contract.js';
import {planDynamicResearch} from '../dynamicResearch/planner.js';
import {createDynamicDependencies,createCurrentInformationDependency} from '../dynamicResearch/composition.js';
import { RouteError } from "../routing/routeErrors.js";
import { OUTDOOR_ADVENTURE_ORCHESTRATION_POLICY_V2 } from "../outdoorAdventure/orchestrationPolicyV2.js";
import { createOutdoorAdventurePlanningEndpoint } from "../outdoorAdventure/outdoorAdventureEndpoint.js";
import { planAndRouteOutdoorAdventureV2 } from "../outdoorAdventure/outdoorAdventureOrchestratorV2.js";
import { createResearchLedRouting, createResearchItinerarySelector, validatePlanningContext } from "./researchLedItinerary.js";
import { randomUUID } from "node:crypto";
import { AppAttestError, appAttestErrorResult } from "../appAttest/appAttestErrors.js";
import { createRouteSessionAuthorizer } from "../appAttest/routeSessionAuthorizer.js";
import {
  outdoorAdventureOrchestrationError,
  outdoorAdventureOrchestrationErrorResult
} from "../outdoorAdventure/orchestrationErrors.js";
import {
  outdoorAdventureDurationBucket,
  outdoorAdventureInsecureLocalEnabled
} from "../outdoorAdventure/orchestrationPolicy.js";
import { createGraphHopperProvider } from "../routing/graphHopperProvider.js";
import {
  authorizeRouteRequest,
  createDevelopmentRouteAuthorizer
} from "../routing/routeAuthorization.js";
import { InMemoryRouteRateLimiter } from "../routing/routeRateLimiter.js";
import { LLMPlanningAdapterError } from "./adapters/adapterErrors.js";
import { createProductionLLMPlanningAdapters } from "./adapters/productionAdapterComposition.js";
import { validateLLMFirstPlanningRequestV1 } from "./llmFirstPlanningContract.js";
import { planLLMFirstAdventureV1 } from "./llmFirstPlanningOrchestrator.js";
import {
  LLM_FIRST_PLANNING_POLICY_V1,
  llmFirstPlanningEnabled
} from "./llmFirstPlanningPolicy.js";
import { dynamicResearchBudgetConfiguration, dynamicResearchExecutionLimits } from "../operations/dynamicResearchBudget.js";

const POLICY = LLM_FIRST_PLANNING_POLICY_V1;
const AUTHORIZATION_COST = 12;

export function createLLMFirstPlanningEndpoint(options = {}) {
  const env = options.env ?? process.env;
  const logger = options.logger ?? { info() {} };
  const now = options.now ?? Date.now;
  let provider = options.provider;
  let llmPlanGenerator = options.llmPlanGenerator;
  let locationGeocoder = options.locationGeocoder;

  return async function llmFirstPlanningEndpoint(body, context = {}) {
    const requestId = safeRequestId(context) ?? randomUUID();
    const startedAt = now();
    let authorization;
    let resultState;
    let acceptedCount;
    let rejectedCount;
    let fallbackAttemptCount;
    let errorCode;
    try {
      if (!llmFirstPlanningEnabled(env)) {
        throw outdoorAdventureOrchestrationError("feature_unavailable");
      }
      if (context.signal?.aborted) {
        throw outdoorAdventureOrchestrationError("cancelled");
      }
      if (body?.schemaVersion === 2) {
        if (Object.keys(body).sort().join(",") !== "intent,planningContext,schemaVersion") {
          throw outdoorAdventureOrchestrationError("invalid_request");
        }
        let planningContext;
        try { planningContext = validatePlanningContext(body.planningContext); }
        catch { throw outdoorAdventureOrchestrationError("invalid_request"); }
        const researchedEndpoint = createOutdoorAdventurePlanningEndpoint({
          ...options,
          orchestratorV2: (request, dependencies, settings) =>
            planningContext.hardAvoidances.some(x => ["crowds", "steepClimbs"].includes(x))
              ? { schemaVersion: 2, policyVersion: OUTDOOR_ADVENTURE_ORCHESTRATION_POLICY_V2.policyVersion,
                  state: "unsupported", normalizedIntent: request.intent, planningGaps: [],
                  clarificationQuestions: [], routedAlternatives: null }
              : planAndRouteOutdoorAdventureV2(
            request, { ...dependencies, routeCandidates: createResearchLedRouting({
              selectItinerary: options.itinerarySelector ?? createResearchItinerarySelector({ ...options, env }),
              planningContext
            }) }, { ...settings, maximumConcurrency: 1 }
          )
        });
        return await researchedEndpoint({ schemaVersion: 2, intent: body.intent }, context);
      }
      const recheck = body?.schemaVersion === 4;
      const dynamic = body?.schemaVersion === 3 || recheck;
      if (dynamic && env.DYNAMIC_RESEARCH_ENABLED !== "true") {
        throw outdoorAdventureOrchestrationError("feature_unavailable");
      }
      let request;
      try { request = recheck ? validateConditionRecheck(body) : dynamic ? validateDynamicRequest(body) : validateLLMFirstPlanningRequestV1(body); }
      catch { throw outdoorAdventureOrchestrationError("invalid_request"); }
      if ((llmPlanGenerator !== undefined && typeof llmPlanGenerator !== "function") ||
          (locationGeocoder !== undefined && typeof locationGeocoder !== "function")) {
        throw outdoorAdventureOrchestrationError("feature_unavailable");
      }
      const authorizer = resolveAuthorizer(options, env);
      authorization = await authorizeRouteRequest(authorizer, {
        ...context,
        requestId,
        cost: AUTHORIZATION_COST
      });
      if (dynamic) {
        const budget = dynamicResearchBudgetConfiguration(env);
        logger.info({
          event: "dynamic_research_admitted",
          requestCostUnits: budget.requestCost,
          dailyRequestLimit: budget.dailyRequestLimit
        });
      }
      if (authorization.limitsConsumed !== true) {
        const limiter = resolveRateLimiter(options, env);
        const limit = await limiter.consume({
          key: authorization.rateLimitKey,
          cost: AUTHORIZATION_COST,
          requestId
        });
        if (!limit?.allowed) {
          throw outdoorAdventureOrchestrationError("rate_limited");
        }
      }

      if (recheck) {
        const conditions = options.dynamicResearchDependencies?.conditions ?? createConditionLookup({fetchImpl:options.fetchImpl,userAgent:env.DYNAMIC_RESEARCH_USER_AGENT});
        const currentInformation = options.dynamicResearchDependencies?.currentInformation ??
          (options.dynamicResearchDependencies === undefined && env.DYNAMIC_WEB_RESEARCH_ENABLED === "true"
            ? createCurrentInformationDependency({env,fetchImpl:options.fetchImpl}) : undefined);
        const payload = await recheckConditions(request,conditions,{signal:context.signal,currentInformation});
        resultState = "checked";
        return {statusCode:200,payload};
      }
      if (dynamic) {
        const webResearchEnabled = request.researchMode === "web_and_map";
        if (webResearchEnabled && env.DYNAMIC_WEB_RESEARCH_ENABLED !== "true") throw outdoorAdventureOrchestrationError("feature_unavailable");
        if (request.constraints.hardAvoidances.some(x => ["crowds", "steepClimbs"].includes(x))) {
          throw outdoorAdventureOrchestrationError("unsupported");
        }
        provider ??= createGraphHopperProvider({ ...options, env });
        const dependencies = options.dynamicResearchDependencies ?? createDynamicDependencies({ ...options, env, provider, webResearchEnabled });
        // Schema 3 never falls back to an unresearched planner. Record the
        // explicit zero in the privacy-safe completion receipt as well.
        fallbackAttemptCount = 0;
        const route = await planDynamicResearch(request, dependencies, {
          signal: context.signal, limits: dynamicResearchExecutionLimits(env)
        });
        const payload = { schemaVersion: 3, state: "routed", route };
        if (Buffer.byteLength(JSON.stringify(payload), "utf8") > POLICY.limits.maximumResponseBytes) {
          throw outdoorAdventureOrchestrationError("response_too_large");
        }
        resultState = "routed"; acceptedCount = 1; fallbackAttemptCount = 0;
        return { statusCode: 200, payload };
      }

      if (typeof llmPlanGenerator !== "function" ||
          typeof locationGeocoder !== "function") {
        const adapters = createProductionLLMPlanningAdapters({ ...options, env });
        llmPlanGenerator ??= adapters.llmPlanGenerator;
        locationGeocoder ??= adapters.locationGeocoder;
      }

      provider ??= createGraphHopperProvider({ ...options, env });
      const payload = await (options.orchestrator ?? planLLMFirstAdventureV1)(
        request,
        {
          generatePlan: llmPlanGenerator,
          geocode: locationGeocoder,
          provider
        },
        {
          signal: context.signal,
          llmTimeoutMs: boundedEnvironmentInteger(
            env.LLM_FIRST_PLANNING_LLM_TIMEOUT_MS,
            POLICY.limits.defaultLLMTimeoutMs,
            100,
            30_000
          ),
          geocodeTimeoutMs: boundedEnvironmentInteger(
            env.LLM_FIRST_PLANNING_GEOCODE_TIMEOUT_MS,
            POLICY.limits.defaultGeocodeTimeoutMs,
            100,
            15_000
          ),
          routeTimeoutMs: boundedEnvironmentInteger(
            env.LLM_FIRST_PLANNING_ROUTE_TIMEOUT_MS,
            POLICY.limits.defaultRouteTimeoutMs,
            500,
            30_000
          ),
          totalTimeoutMs: boundedEnvironmentInteger(
            env.LLM_FIRST_PLANNING_TOTAL_TIMEOUT_MS,
            POLICY.limits.defaultTotalTimeoutMs,
            1_000,
            POLICY.limits.maximumTotalTimeoutMs
          ),
          maximumConcurrentRoutes: POLICY.limits.maximumConcurrentRoutes
        }
      );
      const serialized = JSON.stringify(payload);
      if (Buffer.byteLength(serialized, "utf8") > POLICY.limits.maximumResponseBytes) {
        throw outdoorAdventureOrchestrationError("response_too_large");
      }
      resultState = payload.state;
      const llmFailure = payload.rejections.some((item) => [
        "llm_provider_failure",
        "llm_timed_out",
        "invalid_llm_output"
      ].includes(item.code));
      options.operationalState?.setLLMPlanningReady?.(!llmFailure);
      acceptedCount = payload.diagnostics.acceptedCount;
      rejectedCount = payload.diagnostics.rejectedCount;
      fallbackAttemptCount = payload.diagnostics.fallbackAttemptCount;
      return { statusCode: 200, payload };
    } catch (error) {
      // Preserve exact pre-provider session outcomes for the schema-3 transport.
      // Only expiry is renewable; replay, exhausted budget and denial never become retries.
      if ([3,4].includes(body?.schemaVersion) && error instanceof AppAttestError) {
        const result = appAttestErrorResult(error);
        errorCode = result.payload.error.code;
        return result;
      }
      const safeError = normalizeEndpointError(error);
      const result = outdoorAdventureOrchestrationErrorResult(safeError);
      errorCode = result.payload.error.code;
      return result;
    } finally {
      try {
        await authorization?.release?.();
      } catch {
        // Lease release is operational and must not alter the user response.
      }
      try {
        logger.info({
          event: "llm_first_planning_completed",
          requestId,
          resultState,
          acceptedCount,
          rejectedCount,
          fallbackAttemptCount,
          durationBucket: outdoorAdventureDurationBucket(Math.max(0, now() - startedAt)),
          errorCode
        });
      } catch {
        // Diagnostics intentionally exclude prompts, names, and coordinates.
      }
    }
  };
}

function resolveAuthorizer(options, env) {
  if (options.authorizer) return options.authorizer;
  if (options.appAttestRepository) {
    return createRouteSessionAuthorizer({ repository: options.appAttestRepository, env });
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
        throw outdoorAdventureOrchestrationError("authorization_unavailable");
      }
    };
  }
  return new InMemoryRouteRateLimiter(options.rateLimit);
}

function normalizeEndpointError(error) {
  if (error?.code === "research_no_acceptable_route") return outdoorAdventureOrchestrationError("research_no_acceptable_route");
  if (["research_timed_out", "timed_out", "route_timed_out"].includes(error?.code)) return outdoorAdventureOrchestrationError("timed_out");
  if (["request_cancelled", "cancelled"].includes(error?.code)) return outdoorAdventureOrchestrationError("cancelled");
  if (["research_budget_exhausted", "web_research_unverified", "web_research_unavailable", "invalid_route_evidence", "quality_review_unavailable", "invalid_quality_review", "active_official_restriction"].includes(error?.code)) return outdoorAdventureOrchestrationError("research_unavailable");

  if (error instanceof RouteError && error.code === "unauthorized") {
    return outdoorAdventureOrchestrationError("authorization_failed", { cause: error });
  }
  if (error?.name === "OutdoorAdventureOrchestrationError") return error;
  if (error instanceof LLMPlanningAdapterError) {
    if (error.code === "configuration_missing") {
      return outdoorAdventureOrchestrationError("feature_unavailable", { cause: error });
    }
    // Provider capacity and response failures are expected service outcomes, not app bugs.
    // Keep the native client's existing busy/unavailable handling reachable without
    // exposing provider text or silently falling back to an unresearched route.
    if (error.code === "rate_limited") {
      return outdoorAdventureOrchestrationError("rate_limited", { cause: error });
    }
    return outdoorAdventureOrchestrationError("research_unavailable", { cause: error });
  }
  if (error instanceof AppAttestError) {
    if (error.code === "app_attest_rate_limited") {
      return outdoorAdventureOrchestrationError("rate_limited", { cause: error });
    }
    if (error.code === "authorization_unavailable") {
      return outdoorAdventureOrchestrationError("authorization_unavailable", { cause: error });
    }
    return outdoorAdventureOrchestrationError("authorization_failed", { cause: error });
  }
  return outdoorAdventureOrchestrationError("internal_failure", { cause: error });
}

function safeRequestId(context) {
  const header = context.headers?.["x-trailmind-request-id"];
  const values = [Array.isArray(header) ? undefined : header, context.requestId];
  const value = values.find((candidate) => typeof candidate === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate));
  return value?.toLowerCase();
}

function boundedEnvironmentInteger(raw, fallback, minimum, maximum) {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw outdoorAdventureOrchestrationError("feature_unavailable");
  }
  return value;
}
