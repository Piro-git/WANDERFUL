const ERROR_DEFINITIONS = Object.freeze({
  invalid_candidate_plan: "Research-guided route candidate plan is invalid.",
  invalid_dependencies: "Research-guided routing dependencies are invalid.",
  invalid_options: "Research-guided routing options are invalid.",
  invalid_envelope: "Research-guided routed alternatives are invalid.",
  output_too_large: "Research-guided routed alternatives are too large.",
  cancelled: "Research-guided routing was cancelled."
});

export const RESEARCH_GUIDED_ROUTING_ADAPTER_ERROR_CODES_V1 =
  Object.freeze(Object.keys(ERROR_DEFINITIONS));

export class ResearchGuidedRoutingAdapterError extends Error {
  constructor(code, options = {}) {
    const safeCode = Object.hasOwn(ERROR_DEFINITIONS, code)
      ? code
      : "invalid_envelope";
    super(ERROR_DEFINITIONS[safeCode], { cause: options.cause });
    this.name = "ResearchGuidedRoutingAdapterError";
    this.code = safeCode;
  }
}
