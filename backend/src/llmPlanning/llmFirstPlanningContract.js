import { outdoorAdventureOrchestrationError } from "../outdoorAdventure/orchestrationErrors.js";
import { LLM_FIRST_PLANNING_POLICY_V1 } from "./llmFirstPlanningPolicy.js";

const POLICY = LLM_FIRST_PLANNING_POLICY_V1;
const ACTIVITIES = new Set(["hiking", "trailRunning", "biking"]);
const ROUTE_TYPES = new Set(["loop", "pointToPoint"]);
const DIFFICULTIES = new Set(["easy", "moderate", "hard"]);
const FEATURES = new Set([
  "viewpoint", "forest", "water", "quiet", "sunset", "lowRepeat", "loop"
]);
const AVOID = new Set(["majorRoads", "steepClimbs", "crowds", "repeatedPath"]);
const STOP_ROLES = new Set(["highlight", "stop"]);
const STOP_KINDS = new Set([
  "viewpoint", "peak", "water", "forest", "landmark", "stop", "unknown"
]);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export function validateLLMFirstPlanningRequestV1(input) {
  try {
    enforceBytes(input, POLICY.limits.maximumRequestBytes);
    const value = strict(input, ["schemaVersion", "prompt", "locale", "userLocationHint"]);
    if (value.schemaVersion !== 1) invalid();
    const prompt = text(value.prompt, 1, POLICY.limits.maximumPromptCharacters);
    const locale = value.locale === null ? null : enumeration(value.locale, new Set(["de", "en"]));
    const userLocationHint = value.userLocationHint === null
      ? null
      : text(value.userLocationHint, 1, 120);
    return deepFreeze({ schemaVersion: 1, prompt, locale, userLocationHint });
  } catch (error) {
    if (error?.code === "invalid_request") throw error;
    throw outdoorAdventureOrchestrationError("invalid_request", { cause: error });
  }
}

export function validateLLMRoutePlanV1(input) {
  const value = strict(input, ["schemaVersion", "intent", "candidates"]);
  if (value.schemaVersion !== 1) invalid();
  const intentValue = strict(value.intent, [
    "activityType", "routeType", "startLocationName", "endLocationName",
    "targetDistanceKm", "targetDurationMinutes", "difficulty",
    "requestedFeatures", "avoidFeatures"
  ]);
  const routeType = enumeration(intentValue.routeType, ROUTE_TYPES);
  const startLocationName = intentValue.startLocationName === null
    ? null
    : text(intentValue.startLocationName, 1, 120);
  const endLocationName = intentValue.endLocationName === null
    ? null
    : text(intentValue.endLocationName, 1, 120);
  if (routeType === "loop" && endLocationName !== null) invalid();
  const intent = {
    activityType: enumeration(intentValue.activityType, ACTIVITIES),
    routeType,
    startLocationName,
    endLocationName,
    targetDistanceKm: nullableNumber(intentValue.targetDistanceKm, 1, 200),
    targetDurationMinutes: nullableInteger(intentValue.targetDurationMinutes, 10, 1_440),
    difficulty: intentValue.difficulty === null
      ? null
      : enumeration(intentValue.difficulty, DIFFICULTIES),
    requestedFeatures: uniqueEnums(intentValue.requestedFeatures, FEATURES, 8),
    avoidFeatures: uniqueEnums(intentValue.avoidFeatures, AVOID, 8)
  };
  const candidates = boundedArray(
    value.candidates,
    0,
    POLICY.limits.maximumCandidates
  ).map((candidate) => {
    const candidateValue = strict(candidate, ["stops"]);
    const stops = boundedArray(
      candidateValue.stops,
      1,
      POLICY.limits.maximumNamedStopsPerCandidate
    ).map((stop) => {
      const stopValue = strict(stop, ["role", "kind", "name"]);
      return {
        role: enumeration(stopValue.role, STOP_ROLES),
        kind: enumeration(stopValue.kind, STOP_KINDS),
        name: text(stopValue.name, 1, 120)
      };
    });
    if (new Set(stops.map((stop) => normalized(stop.name))).size !== stops.length) invalid();
    return { stops };
  });
  if (candidates.reduce((total, candidate) => total + candidate.stops.length, 0) >
      POLICY.limits.maximumNamedStopsPerCandidate) invalid();
  if ((startLocationName === null ||
       (routeType === "pointToPoint" && endLocationName === null)) &&
      candidates.length > 0) invalid();
  return deepFreeze({ schemaVersion: 1, intent, candidates });
}

export function validateGeocoderCandidatesV1(input) {
  return boundedArray(input, 0, POLICY.limits.maximumGeocoderResults).map((candidate) => {
    const value = strict(candidate, [
      "displayName", "coordinate", "confidence", "provider", "providerRank"
    ]);
    const coordinate = strict(value.coordinate, ["latitude", "longitude"]);
    return {
      displayName: text(value.displayName, 1, 180),
      coordinate: {
        latitude: finiteNumber(coordinate.latitude, -90, 90),
        longitude: finiteNumber(coordinate.longitude, -180, 180)
      },
      confidence: finiteNumber(value.confidence, 0, 1),
      provider: enumeration(value.provider, new Set(["apple", "fixture", "graphhopper"])),
      providerRank: integer(value.providerRank, 0, 100)
    };
  });
}

export function safeLLMIntentV1(intent) {
  return deepFreeze({
    activityType: intent.activityType,
    routeType: intent.routeType,
    targetDistanceKm: intent.targetDistanceKm,
    targetDurationMinutes: intent.targetDurationMinutes,
    difficulty: intent.difficulty,
    requestedFeatures: [...intent.requestedFeatures],
    avoidFeatures: [...intent.avoidFeatures]
  });
}

function strict(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const keys = Object.keys(value);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key)) ||
      fields.some((field) => !Object.hasOwn(value, field))) invalid();
  return value;
}

function text(value, minimum, maximum) {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum ||
      value !== value.trim() || CONTROL_CHARACTER_PATTERN.test(value) || !wellFormed(value)) invalid();
  return value;
}

function wellFormed(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function enumeration(value, allowed) {
  if (!allowed.has(value)) invalid();
  return value;
}

function uniqueEnums(input, allowed, maximum) {
  const values = boundedArray(input, 0, maximum).map((value) => enumeration(value, allowed));
  if (new Set(values).size !== values.length) invalid();
  return values;
}

function boundedArray(value, minimum, maximum) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) invalid();
  return value;
}

function nullableNumber(value, minimum, maximum) {
  return value === null ? null : finiteNumber(value, minimum, maximum);
}

function nullableInteger(value, minimum, maximum) {
  return value === null ? null : integer(value, minimum, maximum);
}

function finiteNumber(value, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) invalid();
  return value;
}

function integer(value, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) invalid();
  return value;
}

function enforceBytes(value, maximum) {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string" || Buffer.byteLength(serialized, "utf8") > maximum) {
    invalid();
  }
}

function normalized(value) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function invalid() {
  throw new TypeError("invalid LLM-first planning contract");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
