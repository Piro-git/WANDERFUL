import { AppAttestError, appAttestErrorResult } from "./appAttestErrors.js";
import {
  createIntentSessionAuthorizer,
  intentAuthorizationConfiguration
} from "./routeSessionAuthorizer.js";
import { IntentParseError, parseIntentEndpoint } from "../parseIntent.js";

export function createIntentSessionEndpoint(options = {}) {
  const env = options.env ?? process.env;
  const authorizer = options.intentAuthorizer ?? createIntentSessionAuthorizer({
    repository: options.appAttestRepository,
    env
  });
  const configuration = intentAuthorizationConfiguration(env);
  const parseIntent = options.parseIntent ?? parseIntentEndpoint;
  const insecureLocalParsing =
    (env.NODE_ENV === "development" || env.NODE_ENV === "test") &&
    env.INTENT_ALLOW_INSECURE_LOCAL_PARSING === "true";

  return async function intentSessionEndpoint(body, context = {}) {
    let access;
    try {
      if (!insecureLocalParsing) {
        access = await authorizer.authorize({
          headers: context.headers,
          cost: configuration.requestCost
        });
      }
      const payload = await parseIntent(body, { ...options, signal: context.signal });
      return { statusCode: 200, payload };
    } catch (error) {
      if (error instanceof AppAttestError) return appAttestErrorResult(error);
      const statusCode = error instanceof IntentParseError ? error.statusCode : 500;
      return {
        statusCode,
        payload: { error: error instanceof Error ? error.message : "Unknown error" }
      };
    } finally {
      await access?.release?.();
    }
  };
}
