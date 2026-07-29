import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const CASE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CATEGORY_PATTERN = /^[a-z][a-z0-9_]*$/;
const REGION_VALUES = new Set(["harz", "innsbruck_alps", "cross_region", "none"]);
const OPERATION_VALUES = new Set([
  "planner",
  "evidence",
  "candidate",
  "routing",
  "contract"
]);
const CASE_STATES = new Set(["ready", "partial", "clarification", "unsupported"]);
const RESULT_FIELDS = new Set([
  "id",
  "category",
  "state",
  "passed",
  "skipped",
  "errorCodes",
  "violations"
]);
const SUMMARY_FIELDS = new Set([
  "schemaVersion",
  "evaluationVersion",
  "corpusName",
  "corpusClassification",
  "fixtureDigest",
  "status",
  "categoryCounts",
  "metrics",
  "caseResults"
]);
const SUMMARY_METRIC_FIELDS = new Set([
  "configuredCases",
  "executedCases",
  "passedCases",
  "failedCases",
  "skippedCases",
  "readyCases",
  "partialCases",
  "clarificationCases",
  "unsupportedCases",
  "falseClaimViolations",
  "highStakesAuthorityViolations",
  "provenanceViolations",
  "mustHaveViolations",
  "routeVerificationViolations",
  "waypointConnectionViolations",
  "determinismViolations",
  "boundsViolations"
]);
const SUMMARY_VIOLATION_METRIC_FIELDS = Object.freeze([
  "falseClaimViolations",
  "highStakesAuthorityViolations",
  "provenanceViolations",
  "mustHaveViolations",
  "routeVerificationViolations",
  "waypointConnectionViolations",
  "determinismViolations",
  "boundsViolations"
]);

export const OUTDOOR_ADVENTURE_QUALITY_EVALUATION_VERSION_V1 =
  "outdoor-adventure-quality-evaluation-v1";

export const OUTDOOR_ADVENTURE_QUALITY_ERROR_CODES_V1 = Object.freeze([
  "actual_state_mismatch",
  "authority_gate_failed",
  "bounds_not_enforced",
  "candidate_requirement_mismatch",
  "claim_resolution_mismatch",
  "contract_not_rejected",
  "determinism_mismatch",
  "duplicate_proposal_accepted",
  "evaluation_exception",
  "evidence_gap_missing",
  "fabricated_claim_accepted",
  "geometry_invented",
  "intent_not_preserved",
  "malformed_fixture",
  "missing_fixture",
  "operation_missing",
  "provenance_not_preserved",
  "result_id_mismatch",
  "route_not_verified",
  "summary_write_failed",
  "timeout",
  "unexpected_skip",
  "waypoint_connection_mismatch"
]);

export const OUTDOOR_ADVENTURE_QUALITY_VIOLATION_KINDS_V1 = Object.freeze([
  "false_claim",
  "high_stakes_authority",
  "provenance",
  "must_have",
  "route_verification",
  "waypoint_connection",
  "determinism",
  "bounds"
]);

const ERROR_CODE_SET = new Set(OUTDOOR_ADVENTURE_QUALITY_ERROR_CODES_V1);
const VIOLATION_KIND_SET = new Set(
  OUTDOOR_ADVENTURE_QUALITY_VIOLATION_KINDS_V1
);

export class OutdoorAdventureQualityHarnessError extends Error {
  constructor(code) {
    super(messageForHarnessError(code));
    this.name = "OutdoorAdventureQualityHarnessError";
    this.code = code;
  }
}

export async function loadOutdoorAdventureQualityManifestV1(filePath) {
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch {
    throw new OutdoorAdventureQualityHarnessError("missing_fixture");
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new OutdoorAdventureQualityHarnessError("malformed_fixture");
  }
  return validateOutdoorAdventureQualityManifestV1(parsed);
}

export function validateOutdoorAdventureQualityManifestV1(input) {
  try {
    exactObject(input, ["schemaVersion", "corpus", "cases"]);
    if (input.schemaVersion !== 1) invalidManifest();
    const corpus = validateCorpus(input.corpus);
    if (!Array.isArray(input.cases) || input.cases.length > 256) {
      invalidManifest();
    }
    const cases = input.cases.map(validateCase).sort(compareById);
    assertUnique(cases.map((item) => item.id));
    return deepFreeze({ schemaVersion: 1, corpus, cases });
  } catch (error) {
    if (error instanceof OutdoorAdventureQualityHarnessError) throw error;
    throw new OutdoorAdventureQualityHarnessError("malformed_fixture");
  }
}

export async function executeOutdoorAdventureQualityCasesV1({
  manifest,
  evaluateCase,
  caseTimeoutMilliseconds = 5_000
}) {
  const validated = validateOutdoorAdventureQualityManifestV1(manifest);
  if (typeof evaluateCase !== "function") {
    throw new OutdoorAdventureQualityHarnessError("malformed_fixture");
  }
  if (
    !Number.isInteger(caseTimeoutMilliseconds) ||
    caseTimeoutMilliseconds < 1 ||
    caseTimeoutMilliseconds > 60_000
  ) {
    throw new OutdoorAdventureQualityHarnessError("malformed_fixture");
  }

  const results = [];
  for (const evaluationCase of validated.cases) {
    try {
      const result = await withTimeout(
        Promise.resolve(evaluateCase(evaluationCase)),
        caseTimeoutMilliseconds
      );
      results.push(validateCaseResult(result, evaluationCase));
    } catch (error) {
      results.push(failedCaseResult(
        evaluationCase,
        error?.code === "timeout" ? "timeout" : "evaluation_exception"
      ));
    }
  }
  return deepFreeze(results);
}

export function summarizeOutdoorAdventureQualityV1(manifestInput, resultsInput) {
  const manifest = validateOutdoorAdventureQualityManifestV1(manifestInput);
  if (!Array.isArray(resultsInput)) {
    throw new OutdoorAdventureQualityHarnessError("result_id_mismatch");
  }
  const results = resultsInput.map((result, index) =>
    validateCaseResult(result, manifest.cases[index])
  );
  const expectedIds = manifest.cases.map((item) => item.id);
  const actualIds = results.map((item) => item.id);
  if (
    expectedIds.length !== actualIds.length ||
    expectedIds.some((id, index) => actualIds[index] !== id)
  ) {
    throw new OutdoorAdventureQualityHarnessError("result_id_mismatch");
  }

  const executed = results.filter((result) => !result.skipped);
  const passed = executed.filter((result) => result.passed);
  const failed = executed.filter((result) => !result.passed);
  const skipped = results.filter((result) => result.skipped);
  const metrics = {
    configuredCases: manifest.cases.length,
    executedCases: executed.length,
    passedCases: passed.length,
    failedCases: failed.length,
    skippedCases: skipped.length,
    readyCases: countState(executed, "ready"),
    partialCases: countState(executed, "partial"),
    clarificationCases: countState(executed, "clarification"),
    unsupportedCases: countState(executed, "unsupported"),
    falseClaimViolations: countViolation(executed, "false_claim"),
    highStakesAuthorityViolations:
      countViolation(executed, "high_stakes_authority"),
    provenanceViolations: countViolation(executed, "provenance"),
    mustHaveViolations: countViolation(executed, "must_have"),
    routeVerificationViolations:
      countViolation(executed, "route_verification"),
    waypointConnectionViolations:
      countViolation(executed, "waypoint_connection"),
    determinismViolations: countViolation(executed, "determinism"),
    boundsViolations: countViolation(executed, "bounds")
  };
  const violationTotal = OUTDOOR_ADVENTURE_QUALITY_VIOLATION_KINDS_V1
    .reduce((total, kind) => total + countViolation(executed, kind), 0);
  const errorCodeTotal = results.reduce(
    (total, result) => total + result.errorCodes.length,
    0
  );
  const coherentCleanPasses = results.filter(isCoherentCleanPass).length;
  const status = metrics.configuredCases === 0 || metrics.executedCases === 0
    ? "not_run"
    : metrics.executedCases === metrics.configuredCases &&
      metrics.passedCases === metrics.configuredCases &&
      metrics.failedCases === 0 &&
      metrics.skippedCases === 0 &&
      violationTotal === 0 &&
      errorCodeTotal === 0 &&
      coherentCleanPasses === metrics.configuredCases
      ? "passed"
      : "failed";
  const categoryCounts = Object.fromEntries(
    [...new Set(manifest.cases.map((item) => item.category))]
      .sort()
      .map((category) => [
        category,
        manifest.cases.filter((item) => item.category === category).length
      ])
  );
  const summary = {
    schemaVersion: 1,
    evaluationVersion: OUTDOOR_ADVENTURE_QUALITY_EVALUATION_VERSION_V1,
    corpusName: manifest.corpus.name,
    corpusClassification: manifest.corpus.classification,
    fixtureDigest: digest(stableSerialize(manifest)),
    status,
    categoryCounts,
    metrics,
    caseResults: results.map((result) => ({
      id: result.id,
      category: result.category,
      state: result.state,
      passed: result.passed,
      skipped: result.skipped,
      errorCodes: result.errorCodes,
      violations: result.violations
    }))
  };
  return deepFreeze(summary);
}

export async function runOutdoorAdventureQualityEvaluationV1({
  fixturePath,
  outputPath,
  evaluateCase,
  caseTimeoutMilliseconds = 5_000,
  writeSummary = defaultWriteSummary
}) {
  const manifest =
    await loadOutdoorAdventureQualityManifestV1(fixturePath);
  const results = await executeOutdoorAdventureQualityCasesV1({
    manifest,
    evaluateCase,
    caseTimeoutMilliseconds
  });
  const summary = summarizeOutdoorAdventureQualityV1(manifest, results);
  try {
    await writeSummary(outputPath, `${stableSerialize(summary)}\n`);
  } catch {
    throw new OutdoorAdventureQualityHarnessError("summary_write_failed");
  }
  return summary;
}

export function outdoorAdventureQualityExitCodeV1(summary) {
  return isCoherentPassingSummary(summary) ? 0 : 1;
}

export function stableSerialize(value) {
  return JSON.stringify(sortKeys(value), null, 2);
}

function validateCorpus(input) {
  exactObject(input, [
    "name",
    "classification",
    "fixedClock",
    "disclaimers"
  ]);
  if (
    input.name !== "TrailMind Outdoor Adventure Quality V1" ||
    input.classification !== "synthetic_contract_evaluation_data" ||
    input.fixedClock !== "2026-07-22T10:00:00Z" ||
    !Array.isArray(input.disclaimers) ||
    input.disclaimers.length !== 4 ||
    input.disclaimers.some((item) =>
      typeof item !== "string" || item.length < 8 || item.length > 160
    )
  ) {
    invalidManifest();
  }
  return {
    name: input.name,
    classification: input.classification,
    fixedClock: input.fixedClock,
    disclaimers: [...input.disclaimers]
  };
}

function validateCase(input) {
  exactObject(input, [
    "id",
    "category",
    "region",
    "operation",
    "input",
    "expected",
    "tags"
  ]);
  if (
    typeof input.id !== "string" ||
    !CASE_ID_PATTERN.test(input.id) ||
    input.id.length > 96 ||
    typeof input.category !== "string" ||
    !CATEGORY_PATTERN.test(input.category) ||
    !REGION_VALUES.has(input.region) ||
    !OPERATION_VALUES.has(input.operation) ||
    !plainObject(input.input) ||
    !plainObject(input.expected) ||
    !CASE_STATES.has(input.expected.outcomeState) ||
    !Array.isArray(input.tags) ||
    input.tags.length < 1 ||
    input.tags.length > 16 ||
    input.tags.some((tag) =>
      typeof tag !== "string" || !CASE_ID_PATTERN.test(tag) || tag.length > 48
    )
  ) {
    invalidManifest();
  }
  assertUnique(input.tags);
  const serialized = JSON.stringify(input);
  if (
    serialized === undefined ||
    Buffer.byteLength(serialized, "utf8") > 32 * 1_024
  ) {
    invalidManifest();
  }
  return {
    id: input.id,
    category: input.category,
    region: input.region,
    operation: input.operation,
    input: structuredClone(input.input),
    expected: structuredClone(input.expected),
    tags: [...input.tags].sort()
  };
}

function validateCaseResult(input, evaluationCase) {
  if (!evaluationCase || !plainObject(input)) {
    invalidResult();
  }
  if (!hasExactFields(input, RESULT_FIELDS)) {
    invalidResult();
  }
  if (
    input.id !== evaluationCase.id ||
    input.category !== evaluationCase.category ||
    !CASE_STATES.has(input.state) ||
    typeof input.passed !== "boolean" ||
    typeof input.skipped !== "boolean" ||
    !isBoundedUniqueVocabularyArray(input.errorCodes, ERROR_CODE_SET) ||
    !isBoundedUniqueVocabularyArray(input.violations, VIOLATION_KIND_SET)
  ) {
    invalidResult();
  }
  const hasErrors = input.errorCodes.length > 0;
  const hasViolations = input.violations.length > 0;
  if (input.skipped) {
    if (
      input.passed ||
      input.errorCodes.length !== 1 ||
      input.errorCodes[0] !== "unexpected_skip" ||
      hasViolations
    ) {
      invalidResult();
    }
  } else if (input.passed) {
    if (hasErrors || hasViolations) invalidResult();
  } else if (!hasErrors && !hasViolations) {
    invalidResult();
  }
  return {
    id: input.id,
    category: input.category,
    state: input.state,
    passed: input.passed,
    skipped: input.skipped,
    errorCodes: [...input.errorCodes].sort(),
    violations: [...input.violations].sort()
  };
}

function isCoherentCleanPass(result) {
  return result.passed === true &&
    result.skipped === false &&
    result.errorCodes.length === 0 &&
    result.violations.length === 0;
}

function isCoherentPassingSummary(summary) {
  if (
    !plainObject(summary) ||
    !hasExactFields(summary, SUMMARY_FIELDS) ||
    summary.schemaVersion !== 1 ||
    summary.evaluationVersion !==
      OUTDOOR_ADVENTURE_QUALITY_EVALUATION_VERSION_V1 ||
    summary.corpusName !== "TrailMind Outdoor Adventure Quality V1" ||
    summary.corpusClassification !==
      "synthetic_contract_evaluation_data" ||
    typeof summary.fixtureDigest !== "string" ||
    !/^[0-9a-f]{64}$/.test(summary.fixtureDigest) ||
    summary.status !== "passed" ||
    !plainObject(summary.categoryCounts) ||
    !plainObject(summary.metrics) ||
    !hasExactFields(summary.metrics, SUMMARY_METRIC_FIELDS) ||
    !Array.isArray(summary.caseResults)
  ) {
    return false;
  }

  const metrics = summary.metrics;
  if (
    Object.values(metrics).some((value) =>
      !Number.isInteger(value) || value < 0
    ) ||
    metrics.configuredCases <= 0 ||
    metrics.executedCases !== metrics.configuredCases ||
    metrics.passedCases !== metrics.configuredCases ||
    metrics.failedCases !== 0 ||
    metrics.skippedCases !== 0 ||
    SUMMARY_VIOLATION_METRIC_FIELDS.some(
      (field) => metrics[field] !== 0
    ) ||
    metrics.readyCases +
      metrics.partialCases +
      metrics.clarificationCases +
      metrics.unsupportedCases !== metrics.executedCases ||
    summary.caseResults.length !== metrics.configuredCases
  ) {
    return false;
  }

  const categoryEntries = Object.entries(summary.categoryCounts);
  if (
    categoryEntries.length === 0 ||
    categoryEntries.some(([category, count]) =>
      !CATEGORY_PATTERN.test(category) ||
      !Number.isInteger(count) ||
      count <= 0
    ) ||
    categoryEntries.reduce((total, [, count]) => total + count, 0) !==
      metrics.configuredCases
  ) {
    return false;
  }

  const resultIds = new Set();
  const actualCategoryCounts = new Map();
  const actualStateCounts = new Map(
    [...CASE_STATES].map((state) => [state, 0])
  );
  let previousId = null;
  for (const result of summary.caseResults) {
    if (
      !plainObject(result) ||
      !hasExactFields(result, RESULT_FIELDS) ||
      typeof result.id !== "string" ||
      !CASE_ID_PATTERN.test(result.id) ||
      result.id.length > 96 ||
      typeof result.category !== "string" ||
      !CATEGORY_PATTERN.test(result.category) ||
      !CASE_STATES.has(result.state) ||
      !isBoundedUniqueVocabularyArray(
        result.errorCodes,
        ERROR_CODE_SET
      ) ||
      !isBoundedUniqueVocabularyArray(
        result.violations,
        VIOLATION_KIND_SET
      ) ||
      !isCoherentCleanPass(result) ||
      resultIds.has(result.id) ||
      (previousId !== null && previousId >= result.id)
    ) {
      return false;
    }
    previousId = result.id;
    resultIds.add(result.id);
    actualCategoryCounts.set(
      result.category,
      (actualCategoryCounts.get(result.category) ?? 0) + 1
    );
    actualStateCounts.set(
      result.state,
      actualStateCounts.get(result.state) + 1
    );
  }

  if (
    categoryEntries.some(([category, count]) =>
      actualCategoryCounts.get(category) !== count
    ) ||
    actualCategoryCounts.size !== categoryEntries.length ||
    actualStateCounts.get("ready") !== metrics.readyCases ||
    actualStateCounts.get("partial") !== metrics.partialCases ||
    actualStateCounts.get("clarification") !==
      metrics.clarificationCases ||
    actualStateCounts.get("unsupported") !== metrics.unsupportedCases
  ) {
    return false;
  }
  return true;
}

function isBoundedUniqueVocabularyArray(input, vocabulary) {
  return Array.isArray(input) &&
    input.length <= vocabulary.size &&
    input.every((value) => vocabulary.has(value)) &&
    new Set(input).size === input.length;
}

function failedCaseResult(evaluationCase, errorCode) {
  return {
    id: evaluationCase.id,
    category: evaluationCase.category,
    state: "unsupported",
    passed: false,
    skipped: false,
    errorCodes: [errorCode],
    violations: errorCode === "timeout" ? ["determinism"] : []
  };
}

function withTimeout(promise, milliseconds) {
  let timeoutId;
  const timeout = new Promise((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new OutdoorAdventureQualityHarnessError("timeout"));
    }, milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function defaultWriteSummary(outputPath, contents) {
  await writeFile(outputPath, contents, { encoding: "utf8", flag: "w" });
}

function countState(results, state) {
  return results.filter((result) => result.state === state).length;
}

function countViolation(results, kind) {
  return results.reduce(
    (total, result) =>
      total + result.violations.filter((value) => value === kind).length,
    0
  );
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!plainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])])
  );
}

function exactObject(input, fields) {
  if (!plainObject(input)) invalidManifest();
  const expected = new Set(fields);
  const keys = Object.keys(input);
  if (
    keys.length !== fields.length ||
    keys.some((key) => !expected.has(key))
  ) {
    invalidManifest();
  }
}

function hasExactFields(input, expectedFields) {
  if (!plainObject(input)) return false;
  const keys = Object.keys(input);
  return keys.length === expectedFields.size &&
    keys.every((key) => expectedFields.has(key));
}

function plainObject(value) {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function assertUnique(values) {
  if (new Set(values).size !== values.length) invalidManifest();
}

function compareById(left, right) {
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function invalidManifest() {
  throw new OutdoorAdventureQualityHarnessError("malformed_fixture");
}

function invalidResult() {
  throw new OutdoorAdventureQualityHarnessError("result_id_mismatch");
}

function messageForHarnessError(code) {
  const messages = {
    malformed_fixture: "Evaluation fixture is malformed.",
    missing_fixture: "Evaluation fixture is missing.",
    result_id_mismatch: "Evaluation result identifiers do not match.",
    summary_write_failed: "Evaluation summary could not be written.",
    timeout: "Evaluation case timed out."
  };
  return messages[code] ?? "Evaluation harness failed.";
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
