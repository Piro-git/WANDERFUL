const CODES = new Set([
  "configuration_missing",
  "cancelled",
  "timed_out",
  "rate_limited",
  "provider_rejected",
  "provider_unavailable",
  "redirect_rejected",
  "invalid_content_type",
  "response_too_large",
  "invalid_response",
  "incomplete_response",
  "refusal",
  "geocoder_no_results",
  "geocoder_low_confidence",
  "geocoder_ambiguous"
]);

export class LLMPlanningAdapterError extends Error {
  constructor(code) {
    const safeCode = CODES.has(code) ? code : "provider_unavailable";
    super(`llm_planning_adapter_${safeCode}`);
    this.name = "LLMPlanningAdapterError";
    this.code = safeCode;
  }
}

export function llmPlanningAdapterError(code) {
  return new LLMPlanningAdapterError(code);
}
