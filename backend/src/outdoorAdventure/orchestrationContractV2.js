import { validateAdventureResearchIntentV1 } from "../outdoorResearch/validation.js";
import { validateResearchGuidedRoutedAlternativesV2 } from "../routeResearch/routedAlternativesContractV2.js";
import { validateOutdoorAdventurePlanningGapsV1 } from "./orchestrationContract.js";
import { outdoorAdventureOrchestrationError } from "./orchestrationErrors.js";
import { OUTDOOR_ADVENTURE_ORCHESTRATION_POLICY_V2 } from "./orchestrationPolicyV2.js";

const POLICY = OUTDOOR_ADVENTURE_ORCHESTRATION_POLICY_V2;
const STATES = [
  "clarification_required", "unsupported", "no_viable_route", "partial", "routed"
];

export function validateOutdoorAdventurePlanningRequestV2(input) {
  try {
    enforceBytes(input, POLICY.limits.maximumRequestBytes);
    const value = strict(input, ["schemaVersion", "intent"]);
    if (value.schemaVersion !== 2) invalid();
    return deepFreeze({
      schemaVersion: 2,
      intent: validateAdventureResearchIntentV1(value.intent)
    });
  } catch (error) {
    throw outdoorAdventureOrchestrationError("invalid_request", { cause: error });
  }
}

export function validateOutdoorAdventurePlanningResponseV2(input) {
  try {
    enforceBytes(input, POLICY.limits.maximumResponseBytes);
    const value = strict(input, [
      "schemaVersion", "policyVersion", "state", "normalizedIntent",
      "planningGaps", "clarificationQuestions", "routedAlternatives"
    ]);
    if (value.schemaVersion !== 2 || value.policyVersion !== POLICY.policyVersion ||
        !STATES.includes(value.state)) invalid();
    const normalizedIntent = validateAdventureResearchIntentV1(value.normalizedIntent);
    const planningGaps = validateOutdoorAdventurePlanningGapsV1(value.planningGaps);
    const clarificationQuestions = validateQuestions(value.clarificationQuestions);
    const routedAlternatives = value.routedAlternatives === null
      ? null
      : validateResearchGuidedRoutedAlternativesV2(value.routedAlternatives);
    if (routedAlternatives && canonical(routedAlternatives.normalizedIntent) !==
        canonical(normalizedIntent)) invalid();
    enforceState(
      value.state,
      normalizedIntent,
      planningGaps,
      clarificationQuestions,
      routedAlternatives
    );
    const result = {
      schemaVersion: 2,
      policyVersion: POLICY.policyVersion,
      state: value.state,
      normalizedIntent,
      planningGaps,
      clarificationQuestions,
      routedAlternatives
    };
    enforceBytes(result, POLICY.limits.maximumResponseBytes);
    return deepFreeze(result);
  } catch (error) {
    if (error?.code === "response_too_large") throw error;
    throw outdoorAdventureOrchestrationError("internal_failure", { cause: error });
  }
}

export function serializeOutdoorAdventurePlanningResponseV2(input) {
  const result = canonical(validateOutdoorAdventurePlanningResponseV2(input));
  if (Buffer.byteLength(result, "utf8") > POLICY.limits.maximumResponseBytes) {
    throw outdoorAdventureOrchestrationError("response_too_large");
  }
  return result;
}

function validateQuestions(value) {
  if (!Array.isArray(value) || value.length > 16) invalid();
  const result = value.map((item) => {
    const question = strict(item, ["code", "field"]);
    if (![question.code, question.field].every((text) =>
      typeof text === "string" && text.length > 0 && text.length <= 64
    )) invalid();
    return { code: question.code, field: question.field };
  });
  if (new Set(result.map((item) => `${item.code}:${item.field}`)).size !== result.length) invalid();
  return result;
}

function enforceState(state, intent, gaps, questions, routed) {
  const results = routed?.attempts.flatMap((attempt) => attempt.routeResults) ?? [];
  const count = results.length;
  const eligibleCount = results.filter(
    (result) => result.verificationState === "eligible"
  ).length;
  if (state === "clarification_required") {
    if (routed !== null || questions.length === 0 ||
        canonical(questions) !== canonical(intent.unresolvedClarificationQuestions)) invalid();
    return;
  }
  if (questions.length !== 0) invalid();
  if (state === "unsupported") {
    if (routed !== null && (routed.state !== "unsupported" || count !== 0)) invalid();
  } else if (state === "no_viable_route") {
    if (routed !== null && (routed.state !== "no_viable_route" || count !== 0)) invalid();
  } else if (state === "routed") {
    if (!routed || routed.state !== "routed" || eligibleCount === 0 ||
        gaps.length !== 0) invalid();
  } else if (state === "partial") {
    if (!routed || !["partial", "routed"].includes(routed.state) || count === 0) invalid();
  }
}

function strict(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const keys = Object.keys(value);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key)) ||
      fields.some((field) => !Object.hasOwn(value, field))) invalid();
  return value;
}

function enforceBytes(value, maximum) {
  const size = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (size > maximum) throw outdoorAdventureOrchestrationError("response_too_large");
}

function canonical(value) { return JSON.stringify(sort(value)); }
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sort(value[key])]));
}
function invalid() { throw new TypeError("invalid outdoor adventure V2 contract"); }
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
