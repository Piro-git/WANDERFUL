const ERROR_DEFINITIONS = Object.freeze({
  app_attest_unsupported: [400, "This device cannot use app verification."],
  app_attest_not_registered: [401, "This app installation is not registered."],
  app_attest_invalid: [401, "App verification failed."],
  app_attest_environment_mismatch: [401, "App verification failed."],
  app_attest_challenge_expired: [410, "The verification challenge expired."],
  app_attest_challenge_reused: [409, "The verification challenge was already used."],
  app_attest_counter_replayed: [409, "App verification failed."],
  app_attest_rate_limited: [429, "Too many verification attempts. Try again later."],
  route_session_expired: [401, "The route session expired."],
  route_session_exhausted: [429, "The route session has no remaining capacity."],
  route_session_invalid: [401, "The route session is invalid."],
  request_replayed: [409, "This route request was already used."],
  authorization_unavailable: [503, "App verification is temporarily unavailable."]
});

export class AppAttestError extends Error {
  constructor(code, options = {}) {
    const definition = ERROR_DEFINITIONS[code] ?? ERROR_DEFINITIONS.authorization_unavailable;
    super(definition[1], { cause: options.cause });
    this.name = "AppAttestError";
    this.code = ERROR_DEFINITIONS[code] ? code : "authorization_unavailable";
    this.statusCode = options.statusCode ?? definition[0];
    this.retryAfterSeconds = boundedRetryAfter(options.retryAfterSeconds);
  }
}

export function appAttestError(code, options) {
  return new AppAttestError(code, options);
}

export function appAttestErrorResult(error) {
  const safeError = error instanceof AppAttestError
    ? error
    : appAttestError("authorization_unavailable", { cause: error });
  const result = {
    statusCode: safeError.statusCode,
    payload: { error: { code: safeError.code, message: safeError.message } }
  };
  if (safeError.retryAfterSeconds !== undefined) {
    result.headers = { "Retry-After": String(safeError.retryAfterSeconds) };
  }
  return result;
}

function boundedRetryAfter(value) {
  if (!Number.isFinite(value)) return undefined;
  return Math.min(Math.max(Math.ceil(value), 1), 3_600);
}
