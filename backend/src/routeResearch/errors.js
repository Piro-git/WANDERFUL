const SAFE_MESSAGES = Object.freeze({
  invalid_dossier: "Research dossier is invalid.",
  invalid_options: "Route candidate options are invalid.",
  invalid_plan: "Route candidate plan is invalid.",
  policy_inconsistent: "Route candidate policy is inconsistent.",
  output_too_large: "Route candidate plan exceeds its size limit."
});

export class ResearchGuidedRouteCandidateError extends Error {
  constructor(code) {
    super(SAFE_MESSAGES[code] ?? SAFE_MESSAGES.invalid_plan);
    this.name = "ResearchGuidedRouteCandidateError";
    this.code = Object.hasOwn(SAFE_MESSAGES, code) ? code : "invalid_plan";
  }
}

export const RESEARCH_GUIDED_ROUTE_CANDIDATE_ERROR_CODES_V1 =
  Object.freeze(Object.keys(SAFE_MESSAGES));
