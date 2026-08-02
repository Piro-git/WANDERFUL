import { writeFile } from "node:fs/promises";
import {
  OUTDOOR_ADVENTURE_STAGING_PROOF_AUTHORIZATION_STATES_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_CASE_IDS_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_EVIDENCE_SOURCES_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_MANIFEST_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_MANIFEST_DIGEST_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_PROVIDER_TRAFFIC_STATES_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_RESPONSE_STATES_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_RETRY_FRESHNESS_STATES_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_ROUTE_QUALITY_STATES_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_ROUTING_SOURCES_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_STAGE_NAMES_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_TERMINAL_STATES_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_VERSION_V1,
  loadOutdoorAdventureStagingProofManifestV1,
  outdoorAdventureStagingProofManifestDigestV1,
  stableSerializeOutdoorAdventureStagingProofV1,
  validateOutdoorAdventureStagingProofManifestV1
} from "./manifest.js";
import {
  OUTDOOR_ADVENTURE_STAGING_PROOF_TIMING_BUCKETS_V1
} from "./evaluator.js";

export const OUTDOOR_ADVENTURE_STAGING_PROOF_BLOCKERS_V1 = Object.freeze([
  "live_execution_not_requested",
  "bounded_live_graphhopper_not_authorized",
  "credential_containment_not_confirmed",
  "disposable_database_not_confirmed",
  "database_configuration_missing",
  "graphhopper_configuration_missing",
  "operational_case_driver_missing",
  "causal_pipeline_capture_missing",
  "app_attest_receipt_integration_missing",
  "ios_runtime_receipt_integration_missing"
]);

export const OUTDOOR_ADVENTURE_STAGING_PROOF_ERROR_CODES_V1 = Object.freeze([
  "aborted_after_timeout",
  "authorization_mismatch",
  "captured_candidate_plan_invalid",
  "captured_dossier_invalid",
  "evaluation_exception",
  "evidence_linkage_invalid",
  "evidence_source_lineage_invalid",
  "evidence_source_mismatch",
  "input_fixture_mismatch",
  "ios_runtime_receipt_missing",
  "legacy_fallback_count_mismatch",
  "limitation_cause_mismatch",
  "malformed_case_result",
  "malformed_observation",
  "malformed_response",
  "malformed_response_not_rejected",
  "mixed_evidence_sources",
  "mixed_routing_sources",
  "not_run",
  "provider_traffic_mismatch",
  "provenance_linkage_invalid",
  "response_state_mismatch",
  "result_id_mismatch",
  "retry_freshness_mismatch",
  "route_quality_mismatch",
  "routing_provenance_invalid",
  "routing_source_mismatch",
  "semantic_expectation_mismatch",
  "stage_timing_missing",
  "terminal_state_mismatch",
  "timeout",
  "unexpected_response",
  "unexpected_skip",
  "waypoint_visit_invalid"
]);

const RESULT_FIELDS = Object.freeze([
  "id",
  "executed",
  "passed",
  "skipped",
  "terminalState",
  "responseState",
  "evidenceSource",
  "routingSource",
  "providerTraffic",
  "authorization",
  "routeQuality",
  "retryFreshness",
  "legacyFallbackCount",
  "stageTimings",
  "errorCodes"
]);
const SUMMARY_FIELDS = Object.freeze([
  "schemaVersion",
  "proofVersion",
  "manifestDigest",
  "status",
  "blockers",
  "metrics",
  "caseResults"
]);
const METRIC_FIELDS = Object.freeze([
  "configuredCases",
  "executedCases",
  "passedCases",
  "failedCases",
  "skippedCases",
  "notRunCases",
  "realPostgisCases",
  "realGraphHopperCases",
  "liveGraphHopperAttemptCases",
  "syntheticCases",
  "legacyFallbackCases",
  "clarificationCases",
  "partialCases",
  "unsupportedCases",
  "appAttestSessionCases",
  "developmentSessionCases"
]);
const BLOCKER_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_BLOCKERS_V1);
const ERROR_CODE_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_ERROR_CODES_V1);
const TERMINAL_STATE_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_TERMINAL_STATES_V1);
const RESPONSE_STATE_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_RESPONSE_STATES_V1);
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
const TIMING_BUCKET_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_TIMING_BUCKETS_V1);

export class OutdoorAdventureStagingProofHarnessError extends Error {
  constructor(code) {
    super(code);
    this.name = "OutdoorAdventureStagingProofHarnessError";
    this.code = code;
  }
}

export function outdoorAdventureStagingProofReadinessBlockersV1(input = {}) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    return Object.freeze(["live_execution_not_requested"]);
  }
  if (input.executeLive !== true) {
    return Object.freeze(["live_execution_not_requested"]);
  }
  const blockers = [];
  if (input.boundedLiveGraphHopperAuthorized !== true) {
    blockers.push("bounded_live_graphhopper_not_authorized");
  }
  if (input.credentialContainmentConfirmed !== true) {
    blockers.push("credential_containment_not_confirmed");
  }
  if (input.disposableDatabaseConfirmed !== true) {
    blockers.push("disposable_database_not_confirmed");
  }
  if (input.databaseConfigured !== true) {
    blockers.push("database_configuration_missing");
  }
  if (input.graphHopperConfigured !== true) {
    blockers.push("graphhopper_configuration_missing");
  }
  if (input.operationalCaseDriverConfigured !== true) {
    blockers.push("operational_case_driver_missing");
  }
  if (input.causalPipelineCaptureConfigured !== true) {
    blockers.push("causal_pipeline_capture_missing");
  }
  if (input.appAttestReceiptIntegrationConfigured !== true) {
    blockers.push("app_attest_receipt_integration_missing");
  }
  if (input.iosRuntimeReceiptIntegrationConfigured !== true) {
    blockers.push("ios_runtime_receipt_integration_missing");
  }
  return Object.freeze(blockers);
}

export async function executeOutdoorAdventureStagingProofCasesV1({
  manifest: manifestInput,
  evaluateCase,
  caseTimeoutMilliseconds = 45_000
}) {
  const manifest =
    validateOutdoorAdventureStagingProofManifestV1(manifestInput);
  if (
    typeof evaluateCase !== "function" ||
    !Number.isInteger(caseTimeoutMilliseconds) ||
    caseTimeoutMilliseconds < 1 ||
    caseTimeoutMilliseconds > 120_000
  ) {
    throw new OutdoorAdventureStagingProofHarnessError(
      "malformed_case_result"
    );
  }
  const results = [];
  for (let index = 0; index < manifest.cases.length; index += 1) {
    const evaluationCase = manifest.cases[index];
    const controller = new AbortController();
    try {
      const result = await withTimeout(
        Promise.resolve(evaluateCase(evaluationCase, {
          signal: controller.signal
        })),
        caseTimeoutMilliseconds,
        controller
      );
      results.push(validateCaseResult(result, evaluationCase));
    } catch (error) {
      const errorCode = error?.code === "timeout" ? "timeout" :
        error?.code === "malformed_case_result"
          ? "malformed_case_result"
          : "evaluation_exception";
      results.push(failedCaseResult(
        evaluationCase.id,
        errorCode
      ));
      if (errorCode === "timeout") {
        for (
          let remaining = index + 1;
          remaining < manifest.cases.length;
          remaining += 1
        ) {
          results.push(abortedAfterTimeoutCaseResult(
            manifest.cases[remaining].id
          ));
        }
        break;
      }
    }
  }
  return deepFreeze(results);
}

export function summarizeOutdoorAdventureStagingProofV1(
  manifestInput,
  resultsInput,
  blockersInput = []
) {
  const manifest =
    validateOutdoorAdventureStagingProofManifestV1(manifestInput);
  const blockers = validateBlockers(blockersInput);
  if (!Array.isArray(resultsInput)) {
    throw new OutdoorAdventureStagingProofHarnessError(
      "malformed_case_result"
    );
  }
  if (resultsInput.length !== manifest.cases.length) {
    throw new OutdoorAdventureStagingProofHarnessError(
      "result_id_mismatch"
    );
  }
  const results = resultsInput.map((result, index) =>
    validateCaseResult(result, manifest.cases[index], true)
  );
  const actualIds = results.map((result) => result.id);
  if (
    actualIds.some((id, index) => id !== manifest.cases[index].id) ||
    new Set(actualIds).size !== actualIds.length
  ) {
    throw new OutdoorAdventureStagingProofHarnessError(
      "result_id_mismatch"
    );
  }

  const metrics = metricsFor(results);
  const status = metrics.executedCases === 0
    ? "not_run"
    : blockers.length === 0 &&
      metrics.configuredCases > 0 &&
      metrics.executedCases === metrics.configuredCases &&
      metrics.passedCases === metrics.configuredCases &&
      metrics.failedCases === 0 &&
      metrics.skippedCases === 0 &&
      metrics.notRunCases === 0 &&
      metrics.developmentSessionCases === 0
      ? "passed"
      : "failed";
  return deepFreeze({
    schemaVersion: 1,
    proofVersion: OUTDOOR_ADVENTURE_STAGING_PROOF_VERSION_V1,
    manifestDigest:
      outdoorAdventureStagingProofManifestDigestV1(manifest),
    status,
    blockers,
    metrics,
    caseResults: results
  });
}

function metricsFor(results) {
  const executed = results.filter((result) => result.executed);
  const passed = executed.filter((result) => result.passed);
  const failed = executed.filter((result) => !result.passed);
  const skipped = results.filter((result) => result.skipped);
  const notRun = results.filter((result) => !result.executed);
  return {
    configuredCases: results.length,
    executedCases: executed.length,
    passedCases: passed.length,
    failedCases: failed.length,
    skippedCases: skipped.length,
    notRunCases: notRun.length,
    realPostgisCases: count(results, "evidenceSource", "real_postgis"),
    realGraphHopperCases:
      count(results, "routingSource", "real_graphhopper"),
    liveGraphHopperAttemptCases:
      count(results, "providerTraffic", "live_attempted"),
    syntheticCases: results.filter((result) =>
      result.evidenceSource === "synthetic" ||
      result.routingSource === "synthetic" ||
      result.providerTraffic === "synthetic_attempted"
    ).length,
    legacyFallbackCases: results.filter((result) =>
      result.legacyFallbackCount === 1
    ).length,
    clarificationCases:
      count(results, "responseState", "clarification"),
    partialCases: count(results, "responseState", "partial"),
    unsupportedCases: count(results, "responseState", "unsupported"),
    appAttestSessionCases:
      count(results, "authorization", "app_attest_session"),
    developmentSessionCases:
      count(results, "authorization", "development_session")
  };
}

export function createNotRunOutdoorAdventureStagingProofSummaryV1(
  manifestInput,
  blockersInput
) {
  const manifest =
    validateOutdoorAdventureStagingProofManifestV1(manifestInput);
  const blockers = validateBlockers(blockersInput);
  if (blockers.length === 0) {
    throw new OutdoorAdventureStagingProofHarnessError(
      "malformed_case_result"
    );
  }
  return summarizeOutdoorAdventureStagingProofV1(
    manifest,
    manifest.cases.map((evaluationCase) =>
      notRunCaseResult(evaluationCase.id)
    ),
    blockers
  );
}

export async function runOutdoorAdventureStagingProofV1({
  manifestPath,
  outputPath,
  evaluateCase,
  blockers = ["live_execution_not_requested"],
  caseTimeoutMilliseconds = 45_000,
  writeSummary = defaultWriteSummary
}) {
  const manifest =
    await loadOutdoorAdventureStagingProofManifestV1(manifestPath);
  const validatedBlockers = validateBlockers(blockers);
  const summary = validatedBlockers.length > 0
    ? createNotRunOutdoorAdventureStagingProofSummaryV1(
      manifest,
      validatedBlockers
    )
    : summarizeOutdoorAdventureStagingProofV1(
      manifest,
      await executeOutdoorAdventureStagingProofCasesV1({
        manifest,
        evaluateCase,
        caseTimeoutMilliseconds
      })
    );
  try {
    await writeSummary(
      outputPath,
      `${stableSerializeOutdoorAdventureStagingProofV1(summary)}\n`
    );
  } catch {
    throw new OutdoorAdventureStagingProofHarnessError(
      "summary_write_failed"
    );
  }
  return summary;
}

export function outdoorAdventureStagingProofExitCodeV1(summary) {
  return isCoherentPassingSummary(summary) ? 0 : 1;
}

export function isCanonicalOutdoorAdventureStagingProofSummaryV1(summary) {
  if (
    !exactObject(summary, SUMMARY_FIELDS) ||
    summary.schemaVersion !== 1 ||
    summary.proofVersion !==
      OUTDOOR_ADVENTURE_STAGING_PROOF_VERSION_V1 ||
    summary.manifestDigest !==
      OUTDOOR_ADVENTURE_STAGING_PROOF_MANIFEST_DIGEST_V1 ||
    !["not_run", "passed", "failed"].includes(summary.status) ||
    !Array.isArray(summary.blockers) ||
    summary.blockers.some((value) => !BLOCKER_SET.has(value)) ||
    new Set(summary.blockers).size !== summary.blockers.length ||
    !exactObject(summary.metrics, METRIC_FIELDS) ||
    Object.values(summary.metrics).some((value) =>
      !Number.isInteger(value) || value < 0
    ) ||
    !Array.isArray(summary.caseResults) ||
    summary.caseResults.length !==
      OUTDOOR_ADVENTURE_STAGING_PROOF_CASE_IDS_V1.length
  ) {
    return false;
  }

  for (let index = 0; index < summary.caseResults.length; index += 1) {
    const result = summary.caseResults[index];
    if (
      !structurallyValidCaseResult(result) ||
      result.id !== OUTDOOR_ADVENTURE_STAGING_PROOF_CASE_IDS_V1[index]
    ) {
      return false;
    }
  }
  if (!sameMetrics(metricsFor(summary.caseResults), summary.metrics)) {
    return false;
  }

  const metrics = summary.metrics;
  const fullyPassed =
    summary.blockers.length === 0 &&
    metrics.configuredCases > 0 &&
    metrics.executedCases === metrics.configuredCases &&
    metrics.passedCases === metrics.configuredCases &&
    metrics.failedCases === 0 &&
    metrics.skippedCases === 0 &&
    metrics.notRunCases === 0 &&
    metrics.developmentSessionCases === 0;
  const derivedStatus = metrics.executedCases === 0
    ? "not_run"
    : fullyPassed
      ? "passed"
      : "failed";
  if (summary.status !== derivedStatus) return false;
  return derivedStatus !== "passed" || isCoherentPassingSummary(summary);
}

function structurallyValidCaseResult(result) {
  if (
    !exactObject(result, RESULT_FIELDS) ||
    typeof result.id !== "string" ||
    typeof result.executed !== "boolean" ||
    typeof result.passed !== "boolean" ||
    typeof result.skipped !== "boolean" ||
    !TERMINAL_STATE_SET.has(result.terminalState) ||
    !RESPONSE_STATE_SET.has(result.responseState) ||
    !EVIDENCE_SOURCE_SET.has(result.evidenceSource) ||
    !ROUTING_SOURCE_SET.has(result.routingSource) ||
    !PROVIDER_TRAFFIC_SET.has(result.providerTraffic) ||
    !AUTHORIZATION_SET.has(result.authorization) ||
    !ROUTE_QUALITY_SET.has(result.routeQuality) ||
    !RETRY_FRESHNESS_SET.has(result.retryFreshness) ||
    !Number.isInteger(result.legacyFallbackCount) ||
    result.legacyFallbackCount < 0 ||
    result.legacyFallbackCount > 1 ||
    !validStageTimings(result.stageTimings) ||
    !validVocabularyArray(result.errorCodes, ERROR_CODE_SET)
  ) {
    return false;
  }
  if (!result.executed) {
    return !result.passed &&
      !result.skipped &&
      result.terminalState === "not_run" &&
      result.responseState === "none" &&
      result.evidenceSource === "none" &&
      result.routingSource === "none" &&
      result.providerTraffic === "none" &&
      result.authorization === "none" &&
      result.routeQuality === "not_evaluated" &&
      result.retryFreshness === "not_applicable" &&
      result.legacyFallbackCount === 0 &&
      Object.keys(result.stageTimings).length === 0 &&
      (
        sameValue(result.errorCodes, ["not_run"]) ||
        sameValue(result.errorCodes, ["aborted_after_timeout"])
      );
  }
  if (result.passed) {
    return !result.skipped &&
      result.errorCodes.length === 0 &&
      !["failed", "not_run"].includes(result.terminalState);
  }
  return result.errorCodes.length > 0;
}

function validateCaseResult(input, evaluationCase, preserveNotRun = false) {
  if (
    !exactObject(input, RESULT_FIELDS) ||
    input.id !== evaluationCase.id ||
    typeof input.executed !== "boolean" ||
    typeof input.passed !== "boolean" ||
    typeof input.skipped !== "boolean" ||
    !TERMINAL_STATE_SET.has(input.terminalState) ||
    !RESPONSE_STATE_SET.has(input.responseState) ||
    !EVIDENCE_SOURCE_SET.has(input.evidenceSource) ||
    !ROUTING_SOURCE_SET.has(input.routingSource) ||
    !PROVIDER_TRAFFIC_SET.has(input.providerTraffic) ||
    !AUTHORIZATION_SET.has(input.authorization) ||
    !ROUTE_QUALITY_SET.has(input.routeQuality) ||
    !RETRY_FRESHNESS_SET.has(input.retryFreshness) ||
    !Number.isInteger(input.legacyFallbackCount) ||
    input.legacyFallbackCount < 0 ||
    input.legacyFallbackCount > 1 ||
    !validStageTimings(input.stageTimings) ||
    !validVocabularyArray(input.errorCodes, ERROR_CODE_SET)
  ) {
    throw new OutdoorAdventureStagingProofHarnessError(
      "malformed_case_result"
    );
  }
  if (!input.executed) {
    if (
      !preserveNotRun ||
      input.passed ||
      input.skipped ||
      input.terminalState !== "not_run" ||
      input.responseState !== "none" ||
      input.evidenceSource !== "none" ||
      input.routingSource !== "none" ||
      input.providerTraffic !== "none" ||
      input.authorization !== "none" ||
      input.routeQuality !== "not_evaluated" ||
      input.retryFreshness !== "not_applicable" ||
      input.legacyFallbackCount !== 0 ||
      Object.keys(input.stageTimings).length !== 0 ||
      !(
        sameValue(input.errorCodes, ["not_run"]) ||
        sameValue(input.errorCodes, ["aborted_after_timeout"])
      )
    ) {
      throw new OutdoorAdventureStagingProofHarnessError(
        "malformed_case_result"
      );
    }
  } else if (input.passed) {
    if (
      input.skipped ||
      input.errorCodes.length !== 0 ||
      !resultMatchesExpected(input, evaluationCase.expected)
    ) {
      throw new OutdoorAdventureStagingProofHarnessError(
        "malformed_case_result"
      );
    }
  } else if (input.errorCodes.length === 0) {
    throw new OutdoorAdventureStagingProofHarnessError(
      "malformed_case_result"
    );
  }
  return deepFreeze({
    id: input.id,
    executed: input.executed,
    passed: input.passed,
    skipped: input.skipped,
    terminalState: input.terminalState,
    responseState: input.responseState,
    evidenceSource: input.evidenceSource,
    routingSource: input.routingSource,
    providerTraffic: input.providerTraffic,
    authorization: input.authorization,
    routeQuality: input.routeQuality,
    retryFreshness: input.retryFreshness,
    legacyFallbackCount: input.legacyFallbackCount,
    stageTimings: Object.fromEntries(
      OUTDOOR_ADVENTURE_STAGING_PROOF_STAGE_NAMES_V1
        .filter((stage) => Object.hasOwn(input.stageTimings, stage))
        .map((stage) => [stage, [...input.stageTimings[stage]]])
    ),
    errorCodes: [...input.errorCodes]
  });
}

function resultMatchesExpected(result, expected) {
  return result.terminalState === expected.terminalState &&
    responseMatchesExpectation(
      result.responseState,
      expected.responseExpectation
    ) &&
    result.evidenceSource === expected.evidenceSource &&
    result.routingSource === expected.routingSource &&
    result.providerTraffic === expected.providerTraffic &&
    result.authorization === expected.authorization &&
    result.routeQuality === expected.routeQuality &&
    result.retryFreshness === expected.retryFreshness &&
    result.legacyFallbackCount === expected.legacyFallbackCount &&
    expected.requiredStages.every((stage) =>
      Object.hasOwn(result.stageTimings, stage)
    );
}

function responseMatchesExpectation(state, expectation) {
  if (expectation === "routed_alternatives") {
    return state === "routed" || state === "partial";
  }
  if (expectation === "malformed_rejected") return state === "malformed";
  if (expectation === "not_applicable") return state === "none";
  return state === expectation;
}

function failedCaseResult(id, errorCode) {
  return deepFreeze({
    id,
    executed: true,
    passed: false,
    skipped: false,
    terminalState: "failed",
    responseState: "none",
    evidenceSource: "none",
    routingSource: "none",
    providerTraffic: "none",
    authorization: "none",
    routeQuality: "not_evaluated",
    retryFreshness: "not_applicable",
    legacyFallbackCount: 0,
    stageTimings: {},
    errorCodes: [errorCode]
  });
}

function notRunCaseResult(id) {
  return deepFreeze({
    id,
    executed: false,
    passed: false,
    skipped: false,
    terminalState: "not_run",
    responseState: "none",
    evidenceSource: "none",
    routingSource: "none",
    providerTraffic: "none",
    authorization: "none",
    routeQuality: "not_evaluated",
    retryFreshness: "not_applicable",
    legacyFallbackCount: 0,
    stageTimings: {},
    errorCodes: ["not_run"]
  });
}

function abortedAfterTimeoutCaseResult(id) {
  return deepFreeze({
    id,
    executed: false,
    passed: false,
    skipped: false,
    terminalState: "not_run",
    responseState: "none",
    evidenceSource: "none",
    routingSource: "none",
    providerTraffic: "none",
    authorization: "none",
    routeQuality: "not_evaluated",
    retryFreshness: "not_applicable",
    legacyFallbackCount: 0,
    stageTimings: {},
    errorCodes: ["aborted_after_timeout"]
  });
}

function isCoherentPassingSummary(summary) {
  if (
    !exactObject(summary, SUMMARY_FIELDS) ||
    summary.schemaVersion !== 1 ||
    summary.proofVersion !==
      OUTDOOR_ADVENTURE_STAGING_PROOF_VERSION_V1 ||
    summary.manifestDigest !==
      OUTDOOR_ADVENTURE_STAGING_PROOF_MANIFEST_DIGEST_V1 ||
    summary.status !== "passed" ||
    !Array.isArray(summary.blockers) ||
    summary.blockers.length !== 0 ||
    !exactObject(summary.metrics, METRIC_FIELDS) ||
    Object.values(summary.metrics).some((value) =>
      !Number.isInteger(value) || value < 0
    ) ||
    !Array.isArray(summary.caseResults) ||
    summary.caseResults.length !==
      OUTDOOR_ADVENTURE_STAGING_PROOF_CASE_IDS_V1.length
  ) {
    return false;
  }
  if (
    summary.metrics.configuredCases !==
      OUTDOOR_ADVENTURE_STAGING_PROOF_CASE_IDS_V1.length ||
    summary.metrics.executedCases !== summary.metrics.configuredCases ||
    summary.metrics.passedCases !== summary.metrics.configuredCases ||
    summary.metrics.failedCases !== 0 ||
    summary.metrics.skippedCases !== 0 ||
    summary.metrics.notRunCases !== 0 ||
    summary.metrics.developmentSessionCases !== 0 ||
    summary.metrics.realPostgisCases < 2 ||
    summary.metrics.realGraphHopperCases < 2 ||
    summary.metrics.appAttestSessionCases < 2
  ) {
    return false;
  }
  for (let index = 0; index < summary.caseResults.length; index += 1) {
    const result = summary.caseResults[index];
    const evaluationCase =
      OUTDOOR_ADVENTURE_STAGING_PROOF_MANIFEST_V1.cases[index];
    if (
      !structurallyValidCaseResult(result) ||
      result.executed !== true ||
      result.passed !== true ||
      result.skipped !== false ||
      result.errorCodes.length !== 0 ||
      result.id !== evaluationCase.id ||
      !resultMatchesExpected(result, evaluationCase.expected)
    ) {
      return false;
    }
  }
  const recalculated = metricsFor(summary.caseResults);
  return sameMetrics(recalculated, summary.metrics);
}

function validateBlockers(input) {
  if (
    !Array.isArray(input) ||
    input.some((value) => !BLOCKER_SET.has(value)) ||
    new Set(input).size !== input.length
  ) {
    throw new OutdoorAdventureStagingProofHarnessError(
      "malformed_case_result"
    );
  }
  return Object.freeze([...input].sort());
}

function validStageTimings(input) {
  return Boolean(
    input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    Object.keys(input).every((stage) => STAGE_NAME_SET.has(stage)) &&
    Object.values(input).every((values) =>
      Array.isArray(values) &&
      values.length >= 1 &&
      values.length <= 8 &&
      values.every((value) => TIMING_BUCKET_SET.has(value))
    )
  );
}

function validVocabularyArray(input, vocabulary) {
  return Array.isArray(input) &&
    input.length <= vocabulary.size &&
    input.every((value) => vocabulary.has(value)) &&
    new Set(input).size === input.length &&
    sameValue(input, [...input].sort());
}

function withTimeout(promise, milliseconds, controller) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new OutdoorAdventureStagingProofHarnessError("timeout"));
    }, milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function defaultWriteSummary(outputPath, contents) {
  await writeFile(outputPath, contents, { encoding: "utf8", flag: "w" });
}

function count(results, field, value) {
  return results.filter((result) => result[field] === value).length;
}

function exactObject(input, fields) {
  return Boolean(
    input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    Object.keys(input).length === fields.length &&
    Object.keys(input).every((key) => fields.includes(key)) &&
    fields.every((field) => Object.hasOwn(input, field))
  );
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameMetrics(left, right) {
  return METRIC_FIELDS.every((field) => left[field] === right[field]);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
