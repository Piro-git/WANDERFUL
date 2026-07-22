import { HIGH_STAKES_PREDICATES, OUTDOOR_RESEARCH_LIMITS } from "./contracts.js";
import { resolveValidatedEvidenceClaimsV1 } from "./evidenceResolutionCore.js";
import { validateEvidenceClaimV1 } from "./validation.js";

const HIGH_STAKES = new Set(HIGH_STAKES_PREDICATES);

// Deliberately narrow: this resolver has no universal source score and emits no
// probability. It only resolves one entity/predicate cohort when current,
// temporally valid evidence is unambiguous and the high-stakes authority gate passes.
export function resolveEvidenceClaimsV1(claimInputs, options) {
  if (!Array.isArray(claimInputs) || claimInputs.length > OUTDOOR_RESEARCH_LIMITS.maximumEvidenceClaims) {
    throw new TypeError("claimInputs must be a bounded array.");
  }
  const claims = claimInputs.map(validateEvidenceClaimV1);
  return resolveValidatedEvidenceClaimsV1(claims, options);
}

export function isHighStakesEvidencePredicate(predicate) {
  return HIGH_STAKES.has(predicate);
}
