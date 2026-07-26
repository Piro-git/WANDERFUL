import {
  validateAdventureResearchIntentV1
} from "../outdoorResearch/validation.js";
import {
  RESEARCH_PLANNER_AFFECTED_FIELDS_V1,
  RESEARCH_PLANNER_GAP_CODES_V1,
  RESEARCH_PLANNER_GAP_REASONS_V1
} from "../outdoorResearch/researchPlannerPolicy.js";
import {
  validateResearchGuidedRoutedAlternativesV1
} from "../routeResearch/routedAlternativesContract.js";
import {
  OUTDOOR_ADVENTURE_ORCHESTRATION_POLICY_V1
} from "./orchestrationPolicy.js";
import {
  outdoorAdventureOrchestrationError
} from "./orchestrationErrors.js";

const POLICY = OUTDOOR_ADVENTURE_ORCHESTRATION_POLICY_V1;
const RESPONSE_FIELDS = Object.freeze([
  "schemaVersion",
  "policyVersion",
  "state",
  "normalizedIntent",
  "planningGaps",
  "clarificationQuestions",
  "routedAlternatives"
]);
const RESPONSE_STATES = Object.freeze([
  "clarification_required",
  "unsupported",
  "no_viable_route",
  "partial",
  "routed"
]);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export function validateOutdoorAdventurePlanningRequestV1(input) {
  try {
    enforceBytes(input, POLICY.limits.maximumRequestBytes, "invalid_request");
    const value = strictObject(input, ["schemaVersion", "intent"]);
    if (value.schemaVersion !== POLICY.schemaVersion) invalidRequest();
    return deepFreeze({
      schemaVersion: POLICY.schemaVersion,
      intent: validateAdventureResearchIntentV1(value.intent)
    });
  } catch (error) {
    if (error?.code === "invalid_request") throw error;
    throw outdoorAdventureOrchestrationError("invalid_request", {
      cause: error
    });
  }
}

export function validateOutdoorAdventurePlanningResponseV1(input) {
  try {
    enforceBytes(
      input,
      POLICY.limits.maximumResponseBytes,
      "response_too_large"
    );
    const value = strictObject(input, RESPONSE_FIELDS);
    if (
      value.schemaVersion !== POLICY.schemaVersion ||
      value.policyVersion !== POLICY.policyVersion ||
      !RESPONSE_STATES.includes(value.state)
    ) {
      invalidResponse();
    }
    const normalizedIntent =
      validateAdventureResearchIntentV1(value.normalizedIntent);
    const planningGaps =
      validateOutdoorAdventurePlanningGapsV1(value.planningGaps);
    const clarificationQuestions = boundedArray(
      value.clarificationQuestions,
      0,
      16
    ).map(validateClarificationQuestion);
    assertUnique(
      clarificationQuestions.map((question) =>
        `${question.code}:${question.field}`
      )
    );
    const routedAlternatives = value.routedAlternatives === null
      ? null
      : validateResearchGuidedRoutedAlternativesV1(
        value.routedAlternatives
      );
    if (
      routedAlternatives !== null &&
      canonical(routedAlternatives.normalizedIntent) !==
        canonical(normalizedIntent)
    ) {
      invalidResponse();
    }
    enforceStateInvariants({
      state: value.state,
      normalizedIntent,
      planningGaps,
      clarificationQuestions,
      routedAlternatives
    });
    const response = {
      schemaVersion: POLICY.schemaVersion,
      policyVersion: POLICY.policyVersion,
      state: value.state,
      normalizedIntent,
      planningGaps,
      clarificationQuestions,
      routedAlternatives
    };
    enforceBytes(
      response,
      POLICY.limits.maximumResponseBytes,
      "response_too_large"
    );
    return deepFreeze(response);
  } catch (error) {
    if (error?.code === "response_too_large") throw error;
    if (error?.code === "internal_failure") throw error;
    throw outdoorAdventureOrchestrationError("internal_failure", {
      cause: error
    });
  }
}

export function validateOutdoorAdventurePlanningGapsV1(input) {
  try {
    const planningGaps = boundedArray(input, 0, 64)
      .map(validatePlanningGap);
    assertUnique(planningGaps.map((gap) => canonical(gap)));
    return deepFreeze(planningGaps);
  } catch (error) {
    if (error?.code === "internal_failure") throw error;
    throw outdoorAdventureOrchestrationError("internal_failure", {
      cause: error
    });
  }
}

export function serializeOutdoorAdventurePlanningResponseV1(input) {
  const serialized = canonical(
    validateOutdoorAdventurePlanningResponseV1(input)
  );
  if (
    Buffer.byteLength(serialized, "utf8") >
    POLICY.limits.maximumResponseBytes
  ) {
    throw outdoorAdventureOrchestrationError("response_too_large");
  }
  return serialized;
}

function validatePlanningGap(input) {
  const value = strictObject(input, [
    "code",
    "affectedField",
    "affectedValue",
    "reason",
    "requiresClarification",
    "requiresCapability"
  ]);
  if (
    !RESEARCH_PLANNER_GAP_CODES_V1.includes(value.code) ||
    !RESEARCH_PLANNER_AFFECTED_FIELDS_V1.includes(value.affectedField) ||
    !RESEARCH_PLANNER_GAP_REASONS_V1.includes(value.reason) ||
    typeof value.requiresClarification !== "boolean" ||
    typeof value.requiresCapability !== "boolean"
  ) {
    invalidResponse();
  }
  let affectedValue = null;
  if (value.affectedValue !== null) {
    if (
      typeof value.affectedValue !== "string" ||
      value.affectedValue.length < 1 ||
      value.affectedValue.length > 80 ||
      value.affectedValue !== value.affectedValue.trim() ||
      CONTROL_CHARACTER_PATTERN.test(value.affectedValue)
    ) {
      invalidResponse();
    }
    affectedValue = value.affectedValue;
  }
  return {
    code: value.code,
    affectedField: value.affectedField,
    affectedValue,
    reason: value.reason,
    requiresClarification: value.requiresClarification,
    requiresCapability: value.requiresCapability
  };
}

function validateClarificationQuestion(input) {
  const value = strictObject(input, ["code", "field"]);
  if (
    typeof value.code !== "string" ||
    typeof value.field !== "string" ||
    value.code.length < 1 ||
    value.code.length > 64 ||
    value.field.length < 1 ||
    value.field.length > 64 ||
    CONTROL_CHARACTER_PATTERN.test(value.code) ||
    CONTROL_CHARACTER_PATTERN.test(value.field)
  ) {
    invalidResponse();
  }
  return { code: value.code, field: value.field };
}

function enforceStateInvariants(input) {
  const {
    state,
    normalizedIntent,
    planningGaps,
    clarificationQuestions,
    routedAlternatives
  } = input;
  const routeResultCount = routedAlternatives?.attempts.reduce(
    (total, attempt) => total + attempt.routeResults.length,
    0
  ) ?? 0;
  if (state === "clarification_required") {
    if (
      routedAlternatives !== null ||
      clarificationQuestions.length === 0 ||
      canonical(clarificationQuestions) !==
        canonical(normalizedIntent.unresolvedClarificationQuestions)
    ) {
      invalidResponse();
    }
    return;
  }
  if (clarificationQuestions.length !== 0) invalidResponse();
  if (state === "unsupported") {
    if (
      routedAlternatives !== null &&
      (
        routedAlternatives.state !== "unsupported" ||
        routeResultCount !== 0
      )
    ) {
      invalidResponse();
    }
    return;
  }
  if (state === "no_viable_route") {
    if (
      routedAlternatives !== null &&
      (
        routedAlternatives.state !== "no_viable_route" ||
        routeResultCount !== 0
      )
    ) {
      invalidResponse();
    }
    return;
  }
  if (
    routedAlternatives === null ||
    routeResultCount < 1 ||
    !["routed", "partial"].includes(routedAlternatives.state)
  ) {
    invalidResponse();
  }
  if (
    state === "routed" &&
    (
      routedAlternatives.state !== "routed" ||
      planningGaps.length !== 0
    )
  ) {
    invalidResponse();
  }
}

function strictObject(input, fields) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    invalidResponse();
  }
  const keys = Object.keys(input);
  if (
    keys.length !== fields.length ||
    keys.some((key) => !fields.includes(key)) ||
    fields.some((field) => !Object.hasOwn(input, field))
  ) {
    invalidResponse();
  }
  return input;
}

function boundedArray(input, minimum, maximum) {
  if (
    !Array.isArray(input) ||
    input.length < minimum ||
    input.length > maximum
  ) {
    invalidResponse();
  }
  return input;
}

function assertUnique(values) {
  if (new Set(values).size !== values.length) invalidResponse();
}

function enforceBytes(value, maximum, errorCode) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw outdoorAdventureOrchestrationError(errorCode, { cause: error });
  }
  if (
    typeof serialized !== "string" ||
    Buffer.byteLength(serialized, "utf8") > maximum
  ) {
    throw outdoorAdventureOrchestrationError(errorCode);
  }
}

function canonical(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortKeys(value[key])])
  );
}

function invalidRequest() {
  throw outdoorAdventureOrchestrationError("invalid_request");
}

function invalidResponse() {
  throw outdoorAdventureOrchestrationError("internal_failure");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
