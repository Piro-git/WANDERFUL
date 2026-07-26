const ERROR_DEFINITIONS = Object.freeze({
  invalid_request: [400, "The outdoor-adventure planning request is invalid."],
  feature_unavailable: [503, "Outdoor-adventure planning is unavailable."],
  authorization_failed: [401, "The outdoor-adventure planning session is not authorized."],
  authorization_unavailable: [503, "Outdoor-adventure planning authorization is unavailable."],
  rate_limited: [429, "Outdoor-adventure planning is temporarily busy. Please try again later."],
  unsupported: [422, "This outdoor-adventure planning request is not supported."],
  research_unavailable: [503, "Outdoor research is temporarily unavailable."],
  routing_unavailable: [503, "Outdoor routing is temporarily unavailable."],
  timed_out: [504, "Outdoor-adventure planning timed out. Please try again."],
  cancelled: [499, "The outdoor-adventure planning request was cancelled."],
  response_too_large: [503, "The outdoor-adventure planning result exceeded its safety limit."],
  internal_failure: [500, "Outdoor-adventure planning could not produce a valid result."]
});

export const OUTDOOR_ADVENTURE_ORCHESTRATION_ERROR_CODES_V1 =
  Object.freeze(Object.keys(ERROR_DEFINITIONS));

export class OutdoorAdventureOrchestrationError extends Error {
  constructor(code, options = {}) {
    const safeCode = Object.hasOwn(ERROR_DEFINITIONS, code)
      ? code
      : "internal_failure";
    super(ERROR_DEFINITIONS[safeCode][1], { cause: options.cause });
    this.name = "OutdoorAdventureOrchestrationError";
    this.code = safeCode;
    this.statusCode = options.statusCode ?? ERROR_DEFINITIONS[safeCode][0];
  }
}

export function outdoorAdventureOrchestrationError(code, options) {
  return new OutdoorAdventureOrchestrationError(code, options);
}

export function outdoorAdventureOrchestrationErrorResult(error) {
  const safeError = error instanceof OutdoorAdventureOrchestrationError
    ? error
    : outdoorAdventureOrchestrationError("internal_failure", { cause: error });
  return {
    statusCode: safeError.statusCode,
    payload: {
      error: {
        code: safeError.code,
        message: safeError.message
      }
    }
  };
}
