import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

export const OUTDOOR_ADVENTURE_STAGING_PROOF_VERSION_V1 =
  "outdoor-adventure-staging-proof-v1";
export const OUTDOOR_ADVENTURE_STAGING_PROOF_MANIFEST_DIGEST_V1 =
  "283a4f5c6210dbbc77516e3d6de684bfda800391c4f4aa3d08290193e77638a0";

export const OUTDOOR_ADVENTURE_STAGING_PROOF_CASE_IDS_V1 = Object.freeze([
  "case-01-harz-ilsenburg-loop-viewpoints-forest",
  "case-02-harz-schierke-easy-loop-paths-avoid-roads",
  "case-03-harz-trail-running-loop",
  "case-04-harz-brocken-must-have-landmark",
  "case-05-harz-unsatisfied-must-have-highlight",
  "case-06-outside-imported-coverage",
  "case-07-innsbruck-viewpoint-loop",
  "case-08-innsbruck-easy-conservative-loop",
  "case-09-broad-alps-requires-clarification",
  "case-10-innsbruck-missing-official-current-evidence",
  "case-11-biking-unsupported-legacy-once",
  "case-12-point-to-point-unsupported-documented-fallback",
  "case-13-cancel-during-postgis-research",
  "case-14-timeout-during-graphhopper",
  "case-15-partial-provider-failure-survivor",
  "case-16-malformed-backend-response-rejected-by-ios",
  "case-17-feature-disabled-zero-research-work",
  "case-18-retry-does-not-reuse-stale-state"
]);

export const OUTDOOR_ADVENTURE_STAGING_PROOF_TERMINAL_STATES_V1 =
  Object.freeze([
    "routed",
    "partial",
    "clarification",
    "unsupported",
    "legacy_fallback",
    "cancelled",
    "timed_out",
    "rejected",
    "disabled",
    "retry_succeeded",
    "not_run",
    "failed"
  ]);

export const OUTDOOR_ADVENTURE_STAGING_PROOF_RESPONSE_EXPECTATIONS_V1 =
  Object.freeze([
    "routed_alternatives",
    "partial",
    "clarification",
    "unsupported",
    "no_viable_route",
    "malformed_rejected",
    "not_applicable"
  ]);

export const OUTDOOR_ADVENTURE_STAGING_PROOF_RESPONSE_STATES_V1 =
  Object.freeze([
    "routed",
    "partial",
    "clarification",
    "unsupported",
    "no_viable_route",
    "malformed",
    "none"
  ]);

export const OUTDOOR_ADVENTURE_STAGING_PROOF_EVIDENCE_SOURCES_V1 =
  Object.freeze(["real_postgis", "synthetic", "none"]);

export const OUTDOOR_ADVENTURE_STAGING_PROOF_ROUTING_SOURCES_V1 =
  Object.freeze([
    "real_graphhopper",
    "synthetic",
    "legacy_fallback",
    "none"
  ]);

export const OUTDOOR_ADVENTURE_STAGING_PROOF_PROVIDER_TRAFFIC_STATES_V1 =
  Object.freeze(["live_attempted", "synthetic_attempted", "none"]);

export const OUTDOOR_ADVENTURE_STAGING_PROOF_AUTHORIZATION_STATES_V1 =
  Object.freeze(["app_attest_session", "development_session", "none"]);

export const OUTDOOR_ADVENTURE_STAGING_PROOF_ROUTE_QUALITY_STATES_V1 =
  Object.freeze(["evaluated", "not_evaluated"]);

export const OUTDOOR_ADVENTURE_STAGING_PROOF_RETRY_FRESHNESS_STATES_V1 =
  Object.freeze(["fresh", "stale", "not_applicable"]);

export const OUTDOOR_ADVENTURE_STAGING_PROOF_STAGE_NAMES_V1 = Object.freeze([
  "authorization",
  "research_planning",
  "postgis_evidence",
  "dossier_assembly",
  "candidate_planning",
  "graphhopper_attempt",
  "response_validation",
  "response_conversion",
  "route_quality",
  "end_to_end"
]);

export const OUTDOOR_ADVENTURE_STAGING_PROOF_SEMANTIC_EXPECTATION_IDS_V1 =
  Object.freeze([
    "broad_region_clarification",
    "brocken_anchor_returned",
    "cancelled_during_postgis",
    "canonical_intent_bound",
    "conservative_difficulty_applied",
    "feature_disabled_zero_research",
    "fresh_retry_after_failure",
    "graphhopper_timeout_observed",
    "legacy_fallback_once",
    "malformed_response_rejected_by_ios",
    "missing_official_current_evidence_visible",
    "must_have_shortfall_observed",
    "named_brocken_must_have_satisfied",
    "outside_coverage_unsupported",
    "partial_provider_failure_survivor",
    "path_and_road_preferences_preserved",
    "real_route_quality_ranked",
    "research_waypoints_visited",
    "trail_running_activity_preserved",
    "unsupported_biking_fallback",
    "unsupported_point_to_point_fallback",
    "viewpoint_forest_preferences_preserved",
    "viewpoint_preference_preserved"
  ]);

export const OUTDOOR_ADVENTURE_STAGING_PROOF_LIMITATION_CAUSE_IDS_V1 =
  Object.freeze([
    "access_unverified",
    "feature_disabled",
    "graphhopper_timeout",
    "malformed_response",
    "insufficient_candidate_count",
    "official_status_unverified",
    "prior_attempt_failed",
    "provider_failure",
    "unresolved_geography",
    "unsupported_activity",
    "unsupported_route_type",
    "unsupported_region"
  ]);

const INPUT_FIELDS = Object.freeze([
  "schemaVersion",
  "fixtureId",
  "flow",
  "activity",
  "routeType",
  "anchorFixture",
  "destinationFixture",
  "targetDistanceKm",
  "maximumTechnicalDifficulty",
  "mustHaveExperiences",
  "preferredExperiences",
  "avoidedExperiences",
  "executionModifiers"
]);
const EXPECTED_FIELDS = Object.freeze([
  "terminalState",
  "responseExpectation",
  "evidenceSource",
  "routingSource",
  "providerTraffic",
  "authorization",
  "routeQuality",
  "retryFreshness",
  "legacyFallbackCount",
  "requiresLinkage",
  "requiresWaypointVisits",
  "semanticExpectationIds",
  "requiredLimitationCauseIds",
  "requiredStages"
]);
const CASE_ID_PATTERN = /^case-(?:0[1-9]|1[0-8])-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIXTURE_ID_PATTERN =
  /^case-(?:0[1-9]|1[0-8])-[a-z0-9]+(?:-[a-z0-9]+)*-input-v1$/;
const INPUT_FLOW_SET = new Set([
  "controlled_rejection",
  "feature_disabled",
  "legacy_compatibility",
  "preflight_clarification",
  "research_guided",
  "retry"
]);
const INPUT_ACTIVITY_SET =
  new Set(["hiking", "trail_running", "biking"]);
const INPUT_ROUTE_TYPE_SET =
  new Set(["loop", "point_to_point"]);
const INPUT_ANCHOR_FIXTURE_SET = new Set([
  "alps-broad-region",
  "harz-brocken",
  "harz-ilsenburg",
  "harz-schierke",
  "innsbruck-hungerburg",
  "outside-reviewed-coverage"
]);
const INPUT_DESTINATION_FIXTURE_SET = new Set([
  "harz-schierke"
]);
const INPUT_DIFFICULTY_SET = new Set(["hiking"]);
const INPUT_EXPERIENCE_SET = new Set([
  "forest",
  "landmark",
  "peak",
  "quiet_trails",
  "viewpoint",
]);
const INPUT_AVOIDED_EXPERIENCE_SET = new Set([
  "major_roads",
  "steep_climbs"
]);
const INPUT_EXECUTION_MODIFIER_SET = new Set([
  "broad_anchor",
  "cancel_during_postgis",
  "failure_then_legacy_no_routes",
  "feature_disabled",
  "fresh_retry",
  "graphhopper_timeout_then_legacy_fallback",
  "malformed_backend_response",
  "missing_official_current_evidence",
  "normal",
  "one_provider_failure_with_survivor",
  "outside_reviewed_coverage",
  "unsupported_activity",
  "unsupported_route_type"
]);
const TERMINAL_STATE_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_TERMINAL_STATES_V1);
const RESPONSE_EXPECTATION_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_RESPONSE_EXPECTATIONS_V1);
const EVIDENCE_SOURCE_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_EVIDENCE_SOURCES_V1);
const ROUTING_SOURCE_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_ROUTING_SOURCES_V1);
const PROVIDER_TRAFFIC_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_PROVIDER_TRAFFIC_STATES_V1);
const AUTHORIZATION_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_AUTHORIZATION_STATES_V1);
const ROUTE_QUALITY_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_ROUTE_QUALITY_STATES_V1);
const RETRY_FRESHNESS_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_RETRY_FRESHNESS_STATES_V1);
const STAGE_NAME_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_STAGE_NAMES_V1);
const SEMANTIC_EXPECTATION_ID_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_SEMANTIC_EXPECTATION_IDS_V1);
const LIMITATION_CAUSE_ID_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_LIMITATION_CAUSE_IDS_V1);

export class OutdoorAdventureStagingProofManifestError extends Error {
  constructor(code) {
    super(code);
    this.name = "OutdoorAdventureStagingProofManifestError";
    this.code = code;
  }
}

export async function loadOutdoorAdventureStagingProofManifestV1(filePath) {
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch {
    throw new OutdoorAdventureStagingProofManifestError("manifest_missing");
  }
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new OutdoorAdventureStagingProofManifestError("manifest_malformed");
  }
  return validateOutdoorAdventureStagingProofManifestV1(parsed);
}

export function validateOutdoorAdventureStagingProofManifestV1(input) {
  try {
    exactObject(input, ["schemaVersion", "proofVersion", "cases"]);
    if (
      input.schemaVersion !== 1 ||
      input.proofVersion !== OUTDOOR_ADVENTURE_STAGING_PROOF_VERSION_V1 ||
      !Array.isArray(input.cases) ||
      input.cases.length !==
        OUTDOOR_ADVENTURE_STAGING_PROOF_CASE_IDS_V1.length
    ) {
      invalid();
    }
    const cases = input.cases.map((value, index) =>
      validateCase(value, index)
    );
    const ids = cases.map((value) => value.id);
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id, index) =>
        id !== OUTDOOR_ADVENTURE_STAGING_PROOF_CASE_IDS_V1[index]
      )
    ) {
      invalid();
    }
    const manifest = {
      schemaVersion: 1,
      proofVersion: OUTDOOR_ADVENTURE_STAGING_PROOF_VERSION_V1,
      cases
    };
    if (
      digestManifest(manifest) !==
        OUTDOOR_ADVENTURE_STAGING_PROOF_MANIFEST_DIGEST_V1
    ) {
      invalid();
    }
    return deepFreeze(manifest);
  } catch (error) {
    if (error instanceof OutdoorAdventureStagingProofManifestError) {
      throw error;
    }
    throw new OutdoorAdventureStagingProofManifestError(
      "manifest_malformed"
    );
  }
}

export const OUTDOOR_ADVENTURE_STAGING_PROOF_MANIFEST_V1 =
  loadBundledOutdoorAdventureStagingProofManifestV1();

export function outdoorAdventureStagingProofManifestDigestV1(manifestInput) {
  const manifest =
    validateOutdoorAdventureStagingProofManifestV1(manifestInput);
  return digestManifest(manifest);
}

export function stableSerializeOutdoorAdventureStagingProofV1(value) {
  return JSON.stringify(sortKeys(value), null, 2);
}

export function outdoorAdventureStagingProofInputDigestV1(input) {
  return digestValue(validateCanonicalInput(input));
}

function loadBundledOutdoorAdventureStagingProofManifestV1() {
  let source;
  try {
    source = readFileSync(
      new URL("./fixtures/mandatoryCasesV1.json", import.meta.url),
      "utf8"
    );
  } catch {
    throw new OutdoorAdventureStagingProofManifestError(
      "manifest_missing"
    );
  }
  try {
    return validateOutdoorAdventureStagingProofManifestV1(
      JSON.parse(source)
    );
  } catch {
    throw new OutdoorAdventureStagingProofManifestError(
      "manifest_malformed"
    );
  }
}

function validateCase(input, expectedIndex) {
  exactObject(input, ["id", "input", "expected"]);
  if (
    typeof input.id !== "string" ||
    !CASE_ID_PATTERN.test(input.id) ||
    input.id !==
      OUTDOOR_ADVENTURE_STAGING_PROOF_CASE_IDS_V1[expectedIndex]
  ) {
    invalid();
  }
  const canonicalInput = validateCanonicalInput(input.input);
  if (canonicalInput.fixtureId !== `${input.id}-input-v1`) invalid();
  exactObject(input.expected, EXPECTED_FIELDS);
  const expected = input.expected;
  if (
    !TERMINAL_STATE_SET.has(expected.terminalState) ||
    ["not_run", "failed"].includes(expected.terminalState) ||
    !RESPONSE_EXPECTATION_SET.has(expected.responseExpectation) ||
    !EVIDENCE_SOURCE_SET.has(expected.evidenceSource) ||
    !ROUTING_SOURCE_SET.has(expected.routingSource) ||
    !PROVIDER_TRAFFIC_SET.has(expected.providerTraffic) ||
    !AUTHORIZATION_SET.has(expected.authorization) ||
    !ROUTE_QUALITY_SET.has(expected.routeQuality) ||
    !RETRY_FRESHNESS_SET.has(expected.retryFreshness) ||
    !Number.isInteger(expected.legacyFallbackCount) ||
    expected.legacyFallbackCount < 0 ||
    expected.legacyFallbackCount > 1 ||
    typeof expected.requiresLinkage !== "boolean" ||
    typeof expected.requiresWaypointVisits !== "boolean" ||
    !validVocabularyArray(
      expected.semanticExpectationIds,
      SEMANTIC_EXPECTATION_ID_SET,
      1
    ) ||
    !validVocabularyArray(
      expected.requiredLimitationCauseIds,
      LIMITATION_CAUSE_ID_SET,
      0
    ) ||
    !Array.isArray(expected.requiredStages) ||
    expected.requiredStages.length < 1 ||
    expected.requiredStages.length >
      OUTDOOR_ADVENTURE_STAGING_PROOF_STAGE_NAMES_V1.length ||
    expected.requiredStages.some((stage) => !STAGE_NAME_SET.has(stage)) ||
    new Set(expected.requiredStages).size !== expected.requiredStages.length ||
    expected.requiredStages.at(-1) !== "end_to_end"
  ) {
    invalid();
  }
  if (
    (
      expected.routingSource === "legacy_fallback" &&
      expected.legacyFallbackCount !== 1
    ) ||
    (
      expected.legacyFallbackCount === 1 &&
      expected.routingSource !== "legacy_fallback" &&
      !(
        expected.terminalState === "retry_succeeded" &&
        expected.routingSource === "real_graphhopper" &&
        expected.retryFreshness === "fresh"
      )
    ) ||
    (expected.routingSource === "real_graphhopper" &&
      expected.providerTraffic !== "live_attempted") ||
    (expected.routingSource === "synthetic" &&
      expected.providerTraffic !== "synthetic_attempted") ||
    (expected.routeQuality === "evaluated") !== expected.requiresLinkage ||
    expected.requiresWaypointVisits && !expected.requiresLinkage
  ) {
    invalid();
  }
  return {
    id: input.id,
    input: canonicalInput,
    expected: {
      terminalState: expected.terminalState,
      responseExpectation: expected.responseExpectation,
      evidenceSource: expected.evidenceSource,
      routingSource: expected.routingSource,
      providerTraffic: expected.providerTraffic,
      authorization: expected.authorization,
      routeQuality: expected.routeQuality,
      retryFreshness: expected.retryFreshness,
      legacyFallbackCount: expected.legacyFallbackCount,
      requiresLinkage: expected.requiresLinkage,
      requiresWaypointVisits: expected.requiresWaypointVisits,
      semanticExpectationIds: [...expected.semanticExpectationIds],
      requiredLimitationCauseIds: [
        ...expected.requiredLimitationCauseIds
      ],
      requiredStages: [...expected.requiredStages]
    }
  };
}

function validateCanonicalInput(input) {
  exactObject(input, INPUT_FIELDS);
  if (
    input.schemaVersion !== 1 ||
    typeof input.fixtureId !== "string" ||
    !FIXTURE_ID_PATTERN.test(input.fixtureId) ||
    !INPUT_FLOW_SET.has(input.flow) ||
    !INPUT_ACTIVITY_SET.has(input.activity) ||
    !INPUT_ROUTE_TYPE_SET.has(input.routeType) ||
    !INPUT_ANCHOR_FIXTURE_SET.has(input.anchorFixture) ||
    (
      (input.routeType === "point_to_point") !==
        (input.destinationFixture !== null)
    ) ||
    (
      input.destinationFixture !== null &&
      !INPUT_DESTINATION_FIXTURE_SET.has(input.destinationFixture)
    ) ||
    (
      input.targetDistanceKm !== null &&
      (
        typeof input.targetDistanceKm !== "number" ||
        !Number.isFinite(input.targetDistanceKm) ||
        input.targetDistanceKm < 1 ||
        input.targetDistanceKm > 100
      )
    ) ||
    (
      input.maximumTechnicalDifficulty !== null &&
      !INPUT_DIFFICULTY_SET.has(input.maximumTechnicalDifficulty)
    ) ||
    !validVocabularyArray(
      input.mustHaveExperiences,
      INPUT_EXPERIENCE_SET,
      0
    ) ||
    !validVocabularyArray(
      input.preferredExperiences,
      INPUT_EXPERIENCE_SET,
      0
    ) ||
    !validVocabularyArray(
      input.avoidedExperiences,
      INPUT_AVOIDED_EXPERIENCE_SET,
      0
    ) ||
    !validVocabularyArray(
      input.executionModifiers,
      INPUT_EXECUTION_MODIFIER_SET,
      1
    )
  ) {
    invalid();
  }
  return {
    schemaVersion: 1,
    fixtureId: input.fixtureId,
    flow: input.flow,
    activity: input.activity,
    routeType: input.routeType,
    anchorFixture: input.anchorFixture,
    destinationFixture: input.destinationFixture,
    targetDistanceKm: input.targetDistanceKm,
    maximumTechnicalDifficulty: input.maximumTechnicalDifficulty,
    mustHaveExperiences: [...input.mustHaveExperiences],
    preferredExperiences: [...input.preferredExperiences],
    avoidedExperiences: [...input.avoidedExperiences],
    executionModifiers: [...input.executionModifiers]
  };
}

function validVocabularyArray(input, vocabulary, minimum) {
  return Array.isArray(input) &&
    input.length >= minimum &&
    input.length <= vocabulary.size &&
    input.every((value) => vocabulary.has(value)) &&
    new Set(input).size === input.length &&
    sameValue(input, [...input].sort());
}

function exactObject(input, fields) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some((key) => !fields.includes(key)) ||
    fields.some((field) => !Object.hasOwn(input, field))
  ) {
    invalid();
  }
}

function invalid() {
  throw new OutdoorAdventureStagingProofManifestError("manifest_malformed");
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])])
  );
}

function digestManifest(value) {
  return digestValue(value);
}

function digestValue(value) {
  return createHash("sha256")
    .update(stableSerializeOutdoorAdventureStagingProofV1(value))
    .digest("hex");
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
