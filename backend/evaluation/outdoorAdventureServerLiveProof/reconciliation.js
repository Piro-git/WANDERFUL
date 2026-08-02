import { randomUUID } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import {
  SERVER_LIVE_PROOF_CASE_IDS,
  SERVER_LIVE_PROOF_CLASSIFICATION,
  SERVER_LIVE_PROOF_PROVIDER_CALL_LIMIT,
  SERVER_LIVE_PROOF_SCHEMA_VERSION,
  stableSerialize,
  validateServerLiveProofPublishedSummaryV1
} from "./manifest.js";

const SETTLED_PROVIDER_OUTCOMES = new Set([
  "success",
  "failed",
  "timed_out",
  "cancelled"
]);
const DIAGNOSTIC_CASE_ID = "case-07-innsbruck-viewpoint-loop";

export function reconcileServerLiveProofSummaryV1({
  summary,
  ledger,
  diagnosticSummary,
  cleanupArtifactDigest,
  now = () => new Date()
}) {
  validateBaseSummary(summary, 24);
  validateLedger(ledger);
  const diagnosticCase = validateDiagnosticSummary(diagnosticSummary, ledger);
  validateCleanupArtifactDigest(cleanupArtifactDigest);
  const providerCalls = providerCallCounts(ledger.calls);
  const baseCaseSummaryAttemptCount =
    summary.reconciliation?.baseCaseSummaryAttemptCount ??
    summary.providerCalls.exactAttempted;
  const retainedCaseReceiptCallCount = summary.cases.reduce(
    (total, item) => total + item.providerCallCount,
    0
  );
  if (
    !Number.isInteger(baseCaseSummaryAttemptCount) ||
    baseCaseSummaryAttemptCount < retainedCaseReceiptCallCount
  ) {
    throw proofError("invalid_base_summary");
  }
  const priorFailedCalls = ledger.calls.filter((call) =>
    call.callId >= 16 && call.callId <= 24 && call.outcome === "failed"
  );
  const priorFailureBytes = [...new Set(priorFailedCalls.map(
    (call) => call.responseBytes
  ))];
  const priorFailureLatencies = priorFailedCalls.map(
    (call) => call.latencyMilliseconds
  );
  const baseProviderCalls = providerCallCounts(ledger.calls.slice(0, 24));
  if (
    baseCaseSummaryAttemptCount !== 24 ||
    retainedCaseReceiptCallCount !== 21 ||
    baseProviderCalls.successful !== 15 ||
    baseProviderCalls.failed !== 9 ||
    baseProviderCalls.timedOut !== 0 ||
    baseProviderCalls.cancelled !== 0 ||
    providerCalls.successful !== 16 ||
    providerCalls.failed !== 9 ||
    providerCalls.timedOut !== 0 ||
    providerCalls.cancelled !== 0 ||
    priorFailedCalls.length !== 9 ||
    priorFailureBytes.length !== 1 ||
    priorFailureLatencies.some((value) =>
      !Number.isFinite(value) || value < 0
    )
  ) {
    throw proofError("invalid_provider_ledger");
  }

  const reconciled = Object.freeze({
    ...structuredClone(summary),
    status: "failed",
    generatedAt: validDate(now()).toISOString(),
    providerCalls: Object.freeze({
      limit: SERVER_LIVE_PROOF_PROVIDER_CALL_LIMIT,
      exactAttempted: ledger.calls.length,
      ...providerCalls
    }),
    providerDiagnostic: Object.freeze({
      purpose: "single_call_post_burst_diagnostic",
      caseId: diagnosticCase.caseId,
      terminalState: diagnosticCase.terminalState,
      passed: diagnosticCase.passed,
      failureReasons: Object.freeze([...diagnosticCase.failureReasons]),
      providerOutcomes: Object.freeze({ ...diagnosticCase.providerOutcomes }),
      pipeline: Object.freeze(structuredClone(diagnosticCase.pipeline)),
      routeQuality: Object.freeze(structuredClone(diagnosticCase.routeQuality)),
      priorBurstObservation: Object.freeze({
        callCount: priorFailedCalls.length,
        allFailed: priorFailedCalls.length === 9,
        safeErrorCodeAvailable: priorFailedCalls.some(
          (call) => typeof call.errorCode === "string"
        ),
        identicalResponseByteCount:
          priorFailureBytes.length === 1 ? priorFailureBytes[0] : null,
        latencyMilliseconds: Object.freeze({
          minimum: Math.min(...priorFailureLatencies),
          maximum: Math.max(...priorFailureLatencies)
        })
      }),
      conclusion:
        "single_call_succeeded_after_prior_burst_transient_rejection_consistent_but_unconfirmed"
    }),
    reconciliation: Object.freeze({
      accountingSource: "sanitized_atomic_provider_usage_ledger_v1",
      baseCaseSummaryAttemptCount,
      retainedCaseReceiptCallCount,
      supersededCanaryCallCount:
        baseCaseSummaryAttemptCount - retainedCaseReceiptCallCount,
      supersededCanaryReason:
        "initial_canary_preceded_target_aware_candidate_shaping_correction",
      postRunDiagnosticCallCount: diagnosticCase.providerCallCount,
      rawProviderResponsesRetained: false
    }),
    disposableArtifacts: Object.freeze({
      status: "pending_cleanup",
      rootPathRetainedInSummary: false,
      cleanupArtifactDigest
    }),
    closedBetaEligible: false,
    limitations: Object.freeze([...new Set([
      ...summary.limitations,
      "provider_budget_exhausted_no_further_live_rerun",
      "innsbruck_live_route_observed_but_quality_rejected"
    ])].sort()),
    failureReasons: Object.freeze([...new Set([
      ...summary.failureReasons,
      "provider_call_budget_exhausted_without_innsbruck_quality_route"
    ])].sort())
  });
  validateServerLiveProofPublishedSummaryV1(reconciled);
  return reconciled;
}

export function sealServerLiveProofCleanupV1({
  summary,
  cleanupArtifactDigest,
  now = () => new Date()
}) {
  validateBaseSummary(summary, SERVER_LIVE_PROOF_PROVIDER_CALL_LIMIT);
  validateCleanupArtifactDigest(cleanupArtifactDigest);
  if (
    summary.providerCalls?.exactAttempted !== SERVER_LIVE_PROOF_PROVIDER_CALL_LIMIT ||
    summary.disposableArtifacts?.status !== "pending_cleanup" ||
    summary.disposableArtifacts?.cleanupArtifactDigest !==
      cleanupArtifactDigest
  ) {
    throw proofError("summary_not_ready_for_cleanup_seal");
  }
  const sealed = Object.freeze({
    ...structuredClone(summary),
    generatedAt: validDate(now()).toISOString(),
    disposableArtifacts: Object.freeze({
      status: "removed",
      rootPathRetainedInSummary: false,
      cleanupArtifactDigest,
      verifiedAt: validDate(now()).toISOString()
    })
  });
  validateServerLiveProofPublishedSummaryV1(sealed);
  return sealed;
}

export async function writeStableJsonAtomicV1(path, value) {
  if (typeof path !== "string" || path.length < 1) {
    throw proofError("invalid_output_path");
  }
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporaryPath, `${stableSerialize(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  await rename(temporaryPath, path);
}

function validateBaseSummary(summary, expectedProviderAttempts) {
  validateServerLiveProofPublishedSummaryV1(summary);
  if (
    summary.status !== "failed" ||
    summary.executedCaseCount !== SERVER_LIVE_PROOF_CASE_IDS.length ||
    summary.passedCaseCount !== 4 ||
    summary.failedCaseCount !== 4 ||
    summary.notRunCaseCount !== 0 ||
    summary.providerCalls.exactAttempted !== expectedProviderAttempts
  ) {
    throw proofError("invalid_base_summary");
  }
}

function validateLedger(ledger) {
  if (
    !ledger ||
    ledger.schemaVersion !== 1 ||
    ledger.limit !== SERVER_LIVE_PROOF_PROVIDER_CALL_LIMIT ||
    !Array.isArray(ledger.calls) ||
    ledger.calls.length !== SERVER_LIVE_PROOF_PROVIDER_CALL_LIMIT
  ) {
    throw proofError("invalid_provider_ledger");
  }
  for (let index = 0; index < ledger.calls.length; index += 1) {
    const call = ledger.calls[index];
    if (
      call?.callId !== index + 1 ||
      !SERVER_LIVE_PROOF_CASE_IDS.includes(call.caseId) ||
      !SETTLED_PROVIDER_OUTCOMES.has(call.outcome) ||
      !["returned_to_pipeline", "controlled_failure_after_success", "provider_error"]
        .includes(call.pipelineDisposition) ||
      (
        call.errorCode !== null &&
        ![
          "configuration_missing",
          "flexible_mode_unavailable",
          "invalid_request",
          "request_cancelled",
          "route_not_found",
          "route_timed_out",
          "routing_rate_limited",
          "routing_unavailable"
        ].includes(call.errorCode)
      ) ||
      (
        call.responseBytes !== null &&
        (
          !Number.isInteger(call.responseBytes) ||
          call.responseBytes < 0 ||
          call.responseBytes > 10_000_000
        )
      ) ||
      !Number.isInteger(call.latencyMilliseconds) ||
      call.latencyMilliseconds < 0 ||
      call.latencyMilliseconds > 300_000
    ) {
      throw proofError("invalid_provider_ledger");
    }
  }
}

function validateDiagnosticSummary(summary, ledger) {
  try {
    validateServerLiveProofPublishedSummaryV1(summary);
  } catch {
    throw proofError("invalid_provider_diagnostic");
  }
  const diagnosticCase = summary?.cases?.[0];
  const finalCall = ledger.calls.at(-1);
  if (
    !summary ||
    summary.schemaVersion !== SERVER_LIVE_PROOF_SCHEMA_VERSION ||
    summary.proofClassification !== SERVER_LIVE_PROOF_CLASSIFICATION ||
    !["in_progress", "failed"].includes(summary.status) ||
    summary.executedCaseCount !== 1 ||
    summary.providerCalls?.exactAttempted !== ledger.calls.length ||
    summary.cases?.length !== 1 ||
    diagnosticCase?.caseId !== DIAGNOSTIC_CASE_ID ||
    diagnosticCase.providerCallCount !== 1 ||
    diagnosticCase.providerOutcomes?.successful !== 1 ||
    diagnosticCase.passed !== false ||
    finalCall?.caseId !== DIAGNOSTIC_CASE_ID ||
    finalCall.outcome !== "success"
  ) {
    throw proofError("invalid_provider_diagnostic");
  }
  return diagnosticCase;
}

function providerCallCounts(calls) {
  return Object.freeze({
    successful: calls.filter((call) => call.outcome === "success").length,
    failed: calls.filter((call) => call.outcome === "failed").length,
    timedOut: calls.filter((call) => call.outcome === "timed_out").length,
    cancelled: calls.filter((call) => call.outcome === "cancelled").length,
    controlledFailureAfterSuccess: calls.filter((call) =>
      call.pipelineDisposition === "controlled_failure_after_success"
    ).length
  });
}

function validDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw proofError("invalid_reconciliation_time");
  }
  return value;
}

function validateCleanupArtifactDigest(value) {
  if (typeof value !== "string" || !/^cleanup_[a-f0-9]{24}$/.test(value)) {
    throw proofError("invalid_cleanup_artifact_digest");
  }
}

function proofError(code) {
  return Object.assign(new Error(code), { code });
}
