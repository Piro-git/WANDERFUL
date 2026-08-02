import { routeError } from "./routeErrors.js";
import { createRouteSessionAuthorizer } from "../appAttest/routeSessionAuthorizer.js";

const DEVELOPMENT_ROUTE_AUTHORIZERS = new WeakSet();

export function createDefaultRouteAuthorizer(env = process.env, options = {}) {
  if (options.appAttestRepository) {
    return createRouteSessionAuthorizer({ repository: options.appAttestRepository, env });
  }
  const localEnvironment = env.NODE_ENV === "development" || env.NODE_ENV === "test";
  if (localEnvironment && env.ROUTE_ALLOW_INSECURE_LOCAL_ROUTING === "true") {
    return createDevelopmentRouteAuthorizer();
  }
  return {
    async authorize() {
      throw routeError("configuration_missing");
    }
  };
}

export function createDevelopmentRouteAuthorizer() {
  const authorizer = {
    async authorize() {
      return { authorized: true, rateLimitKey: "local-development" };
    }
  };
  DEVELOPMENT_ROUTE_AUTHORIZERS.add(authorizer);
  return authorizer;
}

export function isDevelopmentRouteAuthorizer(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    DEVELOPMENT_ROUTE_AUTHORIZERS.has(value)
  );
}

export async function authorizeRouteRequest(authorizer, context) {
  const result = await authorizer.authorize({
    requestId: context.requestId,
    cost: context.cost,
    headers: context.headers ?? {},
    signal: context.signal
  });
  if (!result?.authorized || typeof result.rateLimitKey !== "string" || !result.rateLimitKey) {
    throw routeError("unauthorized");
  }
  return result;
}
