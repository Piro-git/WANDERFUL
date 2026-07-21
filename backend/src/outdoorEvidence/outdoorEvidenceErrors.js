const ERROR_DEFINITIONS = Object.freeze({
  invalid_request: [400, "The outdoor-evidence request is invalid."],
  invalid_coordinates: [400, "One or more route coordinates are invalid."],
  request_too_large: [413, "The outdoor-evidence request is too large."],
  evidence_rejected: [422, "The outdoor-evidence request was rejected."],
  evidence_unavailable: [503, "Outdoor evidence is temporarily unavailable."],
  evidence_rate_limited: [503, "Outdoor evidence is temporarily busy. Please try again later."],
  response_too_large: [503, "The outdoor-evidence result exceeded its safety limit."],
  evidence_timed_out: [504, "The outdoor-evidence query timed out. Please try again."],
  request_cancelled: [499, "The outdoor-evidence request was cancelled."]
});

export class OutdoorEvidenceError extends Error {
  constructor(code, options = {}) {
    const definition = ERROR_DEFINITIONS[code] ?? ERROR_DEFINITIONS.evidence_unavailable;
    super(options.message ?? definition[1], { cause: options.cause });
    this.name = "OutdoorEvidenceError";
    this.code = ERROR_DEFINITIONS[code] ? code : "evidence_unavailable";
    this.statusCode = options.statusCode ?? definition[0];
  }
}

export function outdoorEvidenceError(code, options) {
  return new OutdoorEvidenceError(code, options);
}

export function outdoorEvidenceErrorResult(error) {
  const safeError = error instanceof OutdoorEvidenceError
    ? error
    : outdoorEvidenceError("evidence_unavailable", { cause: error });
  return {
    statusCode: safeError.statusCode,
    payload: { error: { code: safeError.code, message: safeError.message } }
  };
}
