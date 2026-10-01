import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  OUTDOOR_ADVENTURE_STAGING_PROOF_CASE_IDS_V1
} from "../outdoorAdventureStagingProof/manifest.js";
import {
  RESEARCH_GUIDED_ROUTED_ALTERNATIVES_POLICY_V2
} from "../../src/routeResearch/routedAlternativesPolicyV2.js";

export const PHONE_ENGINE_RELIABILITY_GATE_ID_V1 =
  "phone-engine-reliability-gate-v1";
export const PHONE_ENGINE_RELIABILITY_GATE_CLASSIFICATION_V1 =
  "launch_acceptance_contract";
export const PHONE_ENGINE_RELIABILITY_GATE_CASE_MINIMUM_V1 = 12;
export const PHONE_ENGINE_RELIABILITY_GATE_CASE_MAXIMUM_V1 = 20;

const DEFAULT_FIXTURE_PATH = fileURLToPath(new URL(
  "./fixtures/casesV1.json",
  import.meta.url
));
const GOLDEN_FIXTURE_PATH = fileURLToPath(new URL(
  "../../../docs/route-quality/golden-set-v1/golden-cases-v1.json",
  import.meta.url
));
const TOP_LEVEL_FIELDS = Object.freeze([
  "cases", "classification", "gateId", "limits", "policyVersions",
  "schemaVersion"
]);
const LIMIT_FIELDS = Object.freeze([
  "caseCount", "maximumCaseRuntimeMilliseconds",
  "maximumSummaryBytes", "maximumTotalRuntimeMilliseconds"
]);
const CASE_FIELDS = Object.freeze([
  "expectedProductQualityOutcome", "expectedTechnicalPipelineOutcome",
  "expectedTerminalState", "id", "requiredAssertionIds",
  "sourceCaseIds", "sourceTestSelectors"
]);
const TECHNICAL_OUTCOMES = new Set(["pass", "fail", "not_run"]);
const PRODUCT_OUTCOMES = new Set(["pass", "fail", "not_applicable"]);
const ID_PATTERN = /^phone-[0-9]{2}-[a-z0-9-]+$/;
const ASSERTION_PATTERN = /^[a-z][a-z0-9_]+$/;
const TEST_SELECTOR_PATTERN = /^TrailMind(?:UI)?Tests\/[A-Za-z0-9]+Tests\/test[A-Za-z0-9]+$/;
const SERVER_LIVE_QUALITY_POLICY_VERSION =
  "hiking-route-quality-v1-server-proof-projection";

export class PhoneEngineReliabilityManifestError extends Error {
  constructor(code) {
    super(code);
    this.name = "PhoneEngineReliabilityManifestError";
    this.code = code;
  }
}

export async function loadPhoneEngineReliabilityManifestV1({
  fixturePath = DEFAULT_FIXTURE_PATH,
  goldenFixturePath = GOLDEN_FIXTURE_PATH
} = {}) {
  let manifest;
  let golden;
  try {
    [manifest, golden] = await Promise.all([
      readJSON(fixturePath),
      readJSON(goldenFixturePath)
    ]);
  } catch {
    invalid("fixture_unavailable");
  }
  const reviewedCaseIds = new Set([
    ...OUTDOOR_ADVENTURE_STAGING_PROOF_CASE_IDS_V1,
    ...(Array.isArray(golden?.cases)
      ? golden.cases.map((item) => item?.caseId)
      : [])
  ]);
  validatePhoneEngineReliabilityManifestV1(manifest, { reviewedCaseIds });
  return deepFreeze(structuredClone(manifest));
}

export function validatePhoneEngineReliabilityManifestV1(
  manifest,
  { reviewedCaseIds } = {}
) {
  exactObject(manifest, TOP_LEVEL_FIELDS, "manifest_fields_invalid");
  if (
    manifest.schemaVersion !== 1 ||
    manifest.gateId !== PHONE_ENGINE_RELIABILITY_GATE_ID_V1 ||
    manifest.classification !==
      PHONE_ENGINE_RELIABILITY_GATE_CLASSIFICATION_V1
  ) {
    invalid("manifest_identity_invalid");
  }
  exactObject(manifest.limits, LIMIT_FIELDS, "manifest_limits_invalid");
  const limits = manifest.limits;
  if (
    !integerBetween(limits.caseCount, PHONE_ENGINE_RELIABILITY_GATE_CASE_MINIMUM_V1,
      PHONE_ENGINE_RELIABILITY_GATE_CASE_MAXIMUM_V1) ||
    !positiveInteger(limits.maximumCaseRuntimeMilliseconds) ||
    !positiveInteger(limits.maximumTotalRuntimeMilliseconds) ||
    limits.maximumTotalRuntimeMilliseconds <
      limits.maximumCaseRuntimeMilliseconds ||
    !integerBetween(limits.maximumSummaryBytes, 1_024, 1_048_576) ||
    !Array.isArray(manifest.cases) ||
    manifest.cases.length !== limits.caseCount
  ) {
    invalid("manifest_limits_invalid");
  }
  const expectedPolicies = [
    "golden-set-v1-schema-2",
    SERVER_LIVE_QUALITY_POLICY_VERSION,
    RESEARCH_GUIDED_ROUTED_ALTERNATIVES_POLICY_V2.policyVersion,
    "foreground-route-guidance-temporal-integrity-v1"
  ];
  if (!sameArray(manifest.policyVersions, expectedPolicies)) {
    invalid("manifest_policy_binding_invalid");
  }
  const ids = new Set();
  for (const [index, item] of manifest.cases.entries()) {
    exactObject(item, CASE_FIELDS, "case_fields_invalid");
    if (
      !ID_PATTERN.test(item.id) ||
      item.id.slice(6, 8) !== String(index + 1).padStart(2, "0") ||
      ids.has(item.id)
    ) {
      invalid("case_id_invalid");
    }
    ids.add(item.id);
    if (
      typeof item.expectedTerminalState !== "string" ||
      item.expectedTerminalState.length < 1 ||
      !TECHNICAL_OUTCOMES.has(item.expectedTechnicalPipelineOutcome) ||
      !PRODUCT_OUTCOMES.has(item.expectedProductQualityOutcome) ||
      !nonEmptyUniqueStrings(item.sourceCaseIds) ||
      !nonEmptyUniqueStrings(item.sourceTestSelectors) ||
      !nonEmptyUniqueStrings(item.requiredAssertionIds) ||
      !item.requiredAssertionIds.every((id) => ASSERTION_PATTERN.test(id)) ||
      !item.sourceTestSelectors.every((value) =>
        TEST_SELECTOR_PATTERN.test(value))
    ) {
      invalid("case_contract_invalid");
    }
    if (
      reviewedCaseIds &&
      !item.sourceCaseIds.every((id) => reviewedCaseIds.has(id))
    ) {
      invalid("unreviewed_source_case");
    }
  }
  return manifest;
}

export function phoneEngineReliabilityManifestDigestV1(manifest) {
  return createHash("sha256")
    .update(stableSerializePhoneEngineReliabilityV1(manifest))
    .digest("hex");
}

export function stableSerializePhoneEngineReliabilityV1(value) {
  return JSON.stringify(sortValue(value));
}

async function readJSON(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function exactObject(value, fields, code) {
  if (!plainObject(value) || !sameArray(Object.keys(value).sort(), [...fields].sort())) {
    invalid(code);
  }
}

function plainObject(value) {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function nonEmptyUniqueStrings(value) {
  return Array.isArray(value) && value.length > 0 &&
    value.every((item) => typeof item === "string" && item.length > 0) &&
    new Set(value).size === value.length;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function integerBetween(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function sameArray(left, right) {
  return Array.isArray(left) && left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!plainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortValue(value[key])])
  );
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function invalid(code) {
  throw new PhoneEngineReliabilityManifestError(code);
}
