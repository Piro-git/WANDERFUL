import { routeError } from "./routeErrors.js";
import { createRouteSessionAuthorizer } from "../appAttest/routeSessionAuthorizer.js";

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
  return {
    async authorize() {
      return { authorized: true, rateLimitKey: "local-development" };
    }
  };
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
