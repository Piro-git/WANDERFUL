import { AppAttestError, appAttestErrorResult } from "./appAttestErrors.js";
import {
  createIntentSessionAuthorizer,
  intentAuthorizationConfiguration
} from "./routeSessionAuthorizer.js";
import {
  intentError,
  intentErrorResult,
  parseIntentEndpoint
} from "../parseIntent.js";

export function createIntentSessionEndpoint(options = {}) {
  const env = options.env ?? process.env;
  const authorizer = options.intentAuthorizer ?? createIntentSessionAuthorizer({
    repository: options.appAttestRepository,
    env
  });
  const configuration = intentAuthorizationConfiguration(env);
  const parseIntent = options.parseIntent ?? parseIntentEndpoint;
  const logger = options.logger ?? { warn() {} };
  const insecureLocalParsing =
    (env.NODE_ENV === "development" || env.NODE_ENV === "test") &&
    env.INTENT_ALLOW_INSECURE_LOCAL_PARSING === "true";

  return async function intentSessionEndpoint(body, context = {}) {
    let access;
    let result;
    try {
      if (context.signal?.aborted) throw intentError("request_cancelled");
      if (!insecureLocalParsing) {
        access = await authorizer.authorize({
          headers: context.headers,
          cost: configuration.requestCost,
          signal: context.signal
        });
      }
      if (context.signal?.aborted) throw intentError("request_cancelled");
      const payload = await parseIntent(body, { ...options, signal: context.signal });
      if (context.signal?.aborted) throw intentError("request_cancelled");
      result = { statusCode: 200, payload };
    } catch (error) {
      result = error instanceof AppAttestError
        ? appAttestErrorResult(error)
        : intentErrorResult(error);
    } finally {
      try {
        await access?.release?.();
      } catch {
        try {
          logger.warn({ event: "intent_lease_release_failed" });
        } catch {
          // Operational logging must never alter or expose an intent response.
        }
      }
    }

    if (result.statusCode === 200 && context.signal?.aborted) {
      return intentErrorResult(intentError("request_cancelled"));
    }
    return result;
  };
}
