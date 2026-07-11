import { appAttestError } from "./appAttestErrors.js";
import {
  assertRequestId,
  decodeBase64Url,
  hashOpaqueValue
} from "./clientData.js";

const AUTHORIZATION_PREFIX = "TrailMindRouteSession ";

export function createRouteSessionAuthorizer(options) {
  return createSessionAuthorizer(options, "route", routeAuthorizationConfiguration(options?.env ?? process.env));
}

export function createIntentSessionAuthorizer(options) {
  return createSessionAuthorizer(options, "intent", intentAuthorizationConfiguration(options?.env ?? process.env));
}

function createSessionAuthorizer(options, scope, configuration) {
  const repository = options?.repository;
  const env = options?.env ?? process.env;
  if (!repository || (env.NODE_ENV === "production" && repository.isDurable !== true)) {
    return unavailableAuthorizer();
  }

  return {
    async authorize(context) {
      const authorization = header(context.headers, "authorization");
      if (typeof authorization !== "string" || !authorization.startsWith(AUTHORIZATION_PREFIX)) {
        throw appAttestError("route_session_invalid");
      }
      const token = authorization.slice(AUTHORIZATION_PREFIX.length);
      decodeBase64Url(token, { expectedLength: 32, maxLength: 64 });
      const requestId = assertRequestId(header(context.headers, "x-trailmind-request-id"));
      if (!Number.isInteger(context.cost) || context.cost < 1) {
        throw appAttestError("route_session_invalid");
      }
      const access = await repository.consumeRouteAccess({
        scope,
        tokenHash: hashOpaqueValue(token),
        requestId,
        cost: context.cost,
        providerEnabled: configuration.providerEnabled,
        installationMaximumCost: configuration.installationMaximumCost,
        installationWindowMs: configuration.installationWindowMs,
        globalMaximumCost: configuration.globalMaximumCost,
        globalWindowMs: configuration.globalWindowMs,
        globalMaximumConcurrency: configuration.globalMaximumConcurrency
      });
      return {
        authorized: true,
        rateLimitKey: access.installationId,
        limitsConsumed: true,
        remainingCost: access.remainingCost,
        async release() {
          await repository.releaseRouteLease(access.leaseId);
        }
      };
    }
  };
}

export function routeAuthorizationConfiguration(env = process.env) {
  return {
    providerEnabled: env.ROUTE_PROVIDER_ENABLED !== "false",
    installationMaximumCost: integer(env.APP_ATTEST_INSTALLATION_MAX_COST, 60, 1, 10_000),
    installationWindowMs: integer(env.APP_ATTEST_INSTALLATION_WINDOW_SECONDS, 300, 10, 86_400) * 1_000,
    globalMaximumCost: integer(env.ROUTE_GLOBAL_MAX_COST, 5_000, 1, 1_000_000),
    globalWindowMs: integer(env.ROUTE_GLOBAL_WINDOW_SECONDS, 60, 1, 86_400) * 1_000,
    globalMaximumConcurrency: integer(env.ROUTE_GLOBAL_MAX_CONCURRENCY, 20, 1, 1_000)
  };
}

export function intentAuthorizationConfiguration(env = process.env) {
  return {
    providerEnabled: env.INTENT_PROVIDER_ENABLED !== "false",
    requestCost: integer(env.INTENT_REQUEST_COST, 3, 1, 12),
    installationMaximumCost: integer(env.APP_ATTEST_INTENT_INSTALLATION_MAX_COST, 30, 1, 10_000),
    installationWindowMs: integer(env.APP_ATTEST_INTENT_INSTALLATION_WINDOW_SECONDS, 300, 10, 86_400) * 1_000,
    globalMaximumCost: integer(env.INTENT_GLOBAL_MAX_COST, 1_000, 1, 1_000_000),
    globalWindowMs: integer(env.INTENT_GLOBAL_WINDOW_SECONDS, 60, 1, 86_400) * 1_000,
    globalMaximumConcurrency: integer(env.INTENT_GLOBAL_MAX_CONCURRENCY, 10, 1, 1_000)
  };
}

function unavailableAuthorizer() {
  return {
    async authorize() {
      throw appAttestError("authorization_unavailable");
    }
  };
}

function header(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? undefined : value;
}

function integer(value, fallback, minimum, maximum) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw appAttestError("authorization_unavailable");
  }
  return number;
}
