import {
  createPublicKey,
  verify as verifySignature
} from "node:crypto";
import {
  CANONICAL_CASES,
  CANONICAL_GATE_DEFINITIONS,
  LIVE_OBSERVATION_CASE_IDS,
  MAXIMUM_CLOCK_SKEW_MILLISECONDS,
  STAGING_READINESS_PROOF_VERSION,
  STAGING_READINESS_SCHEMA_VERSION
} from "./constants.js";
import {
  stagingReadinessCandidateBindingRecordV1,
  validateStagingReadinessObservationsV1
} from "./observations.js";
import { stagingReadinessPolicyReceiptBindingV1 } from "./policy.js";
import {
  deepFreezeStagingReadinessV1,
  sha256StagingReadinessV1,
  stableSerializeStagingReadinessV1
} from "./serialization.js";
import {
  HEX_40,
  HEX_64,
  SAFE_CODE,
  assertBoundedArray,
  assertDigest,
  assertExactOrderedIds,
  assertSafeCodes,
  assertSafeReceiptValue,
  exactKeys,
  invalidStagingReadinessV1,
  plainObject,
  timestampMilliseconds
} from "./validation.js";

const TOP_LEVEL_KEYS = Object.freeze([
  "schemaVersion",
  "proofVersion",
  "evidenceMode",
  "generatedAt",
  "proofAsOf",
  "clockPolicy",
  "policy",
  "candidate",
  "candidateBindingSha256",
  "observations",
  "cases",
  "gates",
  "findings",
  "summary",
  "semanticReceiptSha256",
  "authenticity"
]);

const CASE_STATES = new Set(["passed", "failed", "blocked", "not_run"]);
const EVIDENCE_KINDS = new Set([
  "immutable_source",
  "independent_live_observation",
  "derived_attestation",
  "external_blocker"
]);
const STATIC_CASE_IDS = new Set([
  "git_candidate_attestation",
  "policy_contract_attestation",
  "historical_receipts_immutable"
]);
const FINAL_CASE_ID = "staging_prerequisite_reconciliation";

export async function sealStagingReadinessReceiptV1(record, options = {}) {
  if (!plainObject(record) || Object.hasOwn(record, "semanticReceiptSha256") ||
      Object.hasOwn(record, "authenticity")) {
    invalidStagingReadinessV1("receipt_seal_input_invalid");
  }
  assertSafeReceiptValue(record);
  const semanticReceiptSha256 = sha256StagingReadinessV1(record);
  let authenticity = {
    scheme: "none",
    observerKeyIdSha256: null,
    signatureBase64url: null
  };
  if (options.signer !== undefined) {
    if (typeof options.signer !== "function") {
      invalidStagingReadinessV1("receipt_signer_invalid");
    }
    let signed;
    try {
      signed = await options.signer(
        stagingReadinessSignaturePayloadV1(semanticReceiptSha256)
      );
    } catch {
      invalidStagingReadinessV1("receipt_signing_failed");
    }
    if (!plainObject(signed) ||
        !HEX_64.test(signed.observerKeyIdSha256 ?? "") ||
        typeof signed.signatureBase64url !== "string" ||
        !/^[A-Za-z0-9_-]{64,192}$/.test(signed.signatureBase64url)) {
      invalidStagingReadinessV1("receipt_signing_failed");
    }
    authenticity = {
      scheme: "ed25519-sha256-v1",
      observerKeyIdSha256: signed.observerKeyIdSha256,
      signatureBase64url: signed.signatureBase64url
    };
  }
  return deepFreezeStagingReadinessV1({
    ...record,
    semanticReceiptSha256,
    authenticity
  });
}

export function validateStagingReadinessReceiptV1(receipt, options = {}) {
  assertSafeReceiptValue(receipt);
  exactKeys(receipt, TOP_LEVEL_KEYS);
  if (receipt.schemaVersion !== STAGING_READINESS_SCHEMA_VERSION ||
      receipt.proofVersion !== STAGING_READINESS_PROOF_VERSION ||
      !new Set(["offline_contract", "live_staging"]).has(receipt.evidenceMode) ||
      receipt.generatedAt !== receipt.proofAsOf) {
    invalidStagingReadinessV1("receipt_header_invalid");
  }
  const proofAsOfMs = timestampMilliseconds(receipt.proofAsOf);
  const trustedNowMs = timestampMilliseconds(options.trustedNow);
  if (proofAsOfMs > trustedNowMs + MAXIMUM_CLOCK_SKEW_MILLISECONDS) {
    invalidStagingReadinessV1("receipt_clock_in_future");
  }
  validateClockPolicy(receipt.clockPolicy, receipt.evidenceMode, proofAsOfMs, trustedNowMs);
  validatePolicy(receipt.policy, options.policy);
  validateCandidate(receipt.candidate);

  if (receipt.evidenceMode === "live_staging") {
    assertDigest(receipt.candidateBindingSha256, "candidate_binding_missing");
  } else if (receipt.candidateBindingSha256 !== null) {
    invalidStagingReadinessV1("offline_receipt_claims_live_candidate_binding");
  }

  const context = {
    evidenceMode: receipt.evidenceMode,
    proofAsOfMs,
    trustedNowMs,
    maximumReceiptAgeSeconds: receipt.clockPolicy.maximumReceiptAgeSeconds,
    policy: options.policy,
    candidate: receipt.candidate,
    candidateBindingSha256: receipt.candidateBindingSha256,
    sha256: sha256StagingReadinessV1
  };
  validateStagingReadinessObservationsV1(receipt.observations, context);
  if (receipt.evidenceMode === "live_staging") {
    const expectedBinding = sha256StagingReadinessV1(
      stagingReadinessCandidateBindingRecordV1(
        receipt.observations,
        receipt.candidate
      )
    );
    if (expectedBinding !== receipt.candidateBindingSha256) {
      invalidStagingReadinessV1("candidate_binding_digest_mismatch");
    }
  }

  validateCases(receipt.cases, receipt);
  validateGates(receipt.gates, receipt.cases);
  validateFindings(receipt.findings, receipt.summary.finalClassification);
  validateSummary(receipt.summary, receipt);

  const {
    semanticReceiptSha256,
    authenticity,
    ...semanticRecord
  } = receipt;
  assertDigest(semanticReceiptSha256, "receipt_semantic_digest_invalid");
  if (sha256StagingReadinessV1(semanticRecord) !== semanticReceiptSha256) {
    invalidStagingReadinessV1("receipt_semantic_digest_mismatch");
  }
  validateAuthenticity(authenticity, receipt.evidenceMode, semanticReceiptSha256, options);
  if (receipt.evidenceMode === "live_staging") {
    invalidStagingReadinessV1("live_execution_not_admitted");
  }
  return true;
}

export function buildStagingReadinessGatesV1(cases) {
  return CANONICAL_GATE_DEFINITIONS.map((definition) => {
    const selected = definition.caseIds.map((id) =>
      cases.find((candidate) => candidate.id === id)
    );
    if (selected.some((item) => !item)) {
      invalidStagingReadinessV1("receipt_case_missing");
    }
    const state = derivedState(selected.map((item) => item.state));
    const errorCodes = sortedUnique(selected.flatMap((item) => item.errorCodes));
    const violationCodes = sortedUnique(selected.flatMap((item) => item.violationCodes));
    const blockerCodes = sortedUnique(selected.flatMap((item) => item.blockerCodes));
    const record = {
      id: definition.id,
      mandatory: true,
      state,
      caseIds: [...definition.caseIds],
      errorCodes,
      violationCodes,
      blockerCodes
    };
    return {
      ...record,
      evidenceSha256: sha256StagingReadinessV1(record)
    };
  });
}

export function buildStagingReadinessSummaryV1({
  evidenceMode,
  cases,
  gates,
  findings = []
}) {
  const caseCounts = countStates(cases);
  const gateCounts = countStates(gates);
  const mandatoryNonPassGates = gates.filter((gate) =>
    gate.mandatory && gate.state !== "passed"
  ).length;
  const errorCount = cases.reduce((sum, item) => sum + item.errorCodes.length, 0);
  const violationCount = cases.reduce(
    (sum, item) => sum + item.violationCodes.length,
    0
  );
  const blockerCount = cases.reduce((sum, item) => sum + item.blockerCodes.length, 0);
  const allMandatoryPassed = mandatoryNonPassGates === 0 &&
    cases.every((item) => !item.mandatory || item.state === "passed");
  const finalClassification = evidenceMode === "live_staging" &&
    allMandatoryPassed && errorCount === 0 && violationCount === 0 &&
    blockerCount === 0 && findings.length === 0
    ? "GO"
    : "NO_GO";
  return {
    totalCases: cases.length,
    executedCases: caseCounts.passed + caseCounts.failed,
    passedCases: caseCounts.passed,
    failedCases: caseCounts.failed,
    blockedCases: caseCounts.blocked,
    notRunCases: caseCounts.not_run,
    totalGates: gates.length,
    passedGates: gateCounts.passed,
    failedGates: gateCounts.failed,
    blockedGates: gateCounts.blocked,
    notRunGates: gateCounts.not_run,
    mandatoryNonPassGates,
    errorCount,
    violationCount,
    blockerCount,
    finalClassification,
    readyForPhysicalAppAttest: finalClassification === "GO",
    stagingInfrastructureReadyForLaterAttempt13: finalClassification === "GO",
    attempt13Authorized: false,
    providerCalls: 0,
    productionMutations: 0,
    secretExposures: 0
  };
}

export function stagingReadinessSignaturePayloadV1(semanticReceiptSha256) {
  if (!HEX_64.test(semanticReceiptSha256 ?? "")) {
    invalidStagingReadinessV1("receipt_semantic_digest_invalid");
  }
  return Buffer.from(
    `${STAGING_READINESS_PROOF_VERSION}:${semanticReceiptSha256}`,
    "utf8"
  );
}

export function stagingReadinessObserverKeyIdV1(publicKeyInput) {
  let key;
  try {
    key = normalizePublicKey(publicKeyInput);
  } catch {
    invalidStagingReadinessV1("observer_public_key_invalid");
  }
  if (key.asymmetricKeyType !== "ed25519") {
    invalidStagingReadinessV1("observer_public_key_invalid");
  }
  return sha256StagingReadinessV1(key.export({ type: "spki", format: "der" }));
}

export function stagingReadinessReceiptExitCodeV1(receipt) {
  return receipt?.evidenceMode === "offline_contract" &&
    receipt?.summary?.finalClassification === "NO_GO"
    ? 1
    : 2;
}

export function makeStagingReadinessCaseV1({
  id,
  state,
  evidenceKind,
  evidenceSha256 = null,
  observedAt = null,
  candidateBindingSha256 = null,
  errorCodes = [],
  violationCodes = [],
  blockerCodes = []
}) {
  const definition = CANONICAL_CASES.find((item) => item.id === id);
  if (!definition) invalidStagingReadinessV1("receipt_case_unknown");
  return {
    id,
    gateId: definition.gateId,
    mandatory: true,
    state,
    evidenceKind,
    evidenceSha256,
    observedAt,
    candidateBindingSha256,
    errorCodes: [...errorCodes],
    violationCodes: [...violationCodes],
    blockerCodes: [...blockerCodes]
  };
}

function validateClockPolicy(value, evidenceMode, proofAsOfMs, trustedNowMs) {
  exactKeys(value, [
    "maximumReceiptAgeSeconds",
    "ownerDecisionDigest",
    "trustedObservationAt"
  ]);
  const trustedObservationMs = timestampMilliseconds(value.trustedObservationAt);
  if (trustedObservationMs !== trustedNowMs) {
    invalidStagingReadinessV1("trusted_clock_substitution");
  }
  if (evidenceMode === "live_staging") {
    assertDigest(value.ownerDecisionDigest, "clock_owner_decision_missing");
    if (!Number.isInteger(value.maximumReceiptAgeSeconds) ||
        value.maximumReceiptAgeSeconds < 60 ||
        value.maximumReceiptAgeSeconds > 86_400 ||
        trustedNowMs - proofAsOfMs > value.maximumReceiptAgeSeconds * 1_000) {
      invalidStagingReadinessV1("receipt_clock_stale");
    }
  } else if (value.maximumReceiptAgeSeconds !== null ||
      value.ownerDecisionDigest !== null) {
    invalidStagingReadinessV1("offline_clock_policy_claim_invalid");
  } else if (trustedNowMs - proofAsOfMs > MAXIMUM_CLOCK_SKEW_MILLISECONDS) {
    invalidStagingReadinessV1("receipt_clock_stale");
  }
}

function validatePolicy(binding, policy) {
  if (!policy || !plainObject(policy)) {
    invalidStagingReadinessV1("receipt_policy_context_missing");
  }
  const expected = stagingReadinessPolicyReceiptBindingV1(policy);
  if (stableSerializeStagingReadinessV1(binding) !==
      stableSerializeStagingReadinessV1(expected)) {
    invalidStagingReadinessV1("receipt_policy_digest_mismatch");
  }
}

function validateCandidate(value) {
  exactKeys(value, [
    "baselineCommit", "candidateCommit", "headCommit", "treeDigest",
    "indexTreeDigest", "indexClean", "worktreeClean", "baselineExists",
    "baselineAncestorOfCandidate", "candidateAttestationSha256"
  ]);
  for (const key of ["baselineCommit", "candidateCommit", "headCommit", "treeDigest", "indexTreeDigest"]) {
    if (!HEX_40.test(value[key] ?? "")) {
      invalidStagingReadinessV1("candidate_git_identity_invalid");
    }
  }
  if (value.headCommit !== value.candidateCommit ||
      value.treeDigest !== value.indexTreeDigest ||
      value.indexClean !== true || value.worktreeClean !== true ||
      value.baselineExists !== true || value.baselineAncestorOfCandidate !== true) {
    invalidStagingReadinessV1("candidate_git_attestation_failed");
  }
  assertDigest(value.candidateAttestationSha256);
  const { candidateAttestationSha256, ...record } = value;
  if (sha256StagingReadinessV1(record) !== candidateAttestationSha256) {
    invalidStagingReadinessV1("candidate_git_attestation_digest_mismatch");
  }
}

function validateCases(cases, receipt) {
  assertExactOrderedIds(cases, CANONICAL_CASES.map((item) => item.id));
  cases.forEach((item, index) => {
    exactKeys(item, [
      "id", "gateId", "mandatory", "state", "evidenceKind", "evidenceSha256",
      "observedAt", "candidateBindingSha256", "errorCodes", "violationCodes",
      "blockerCodes"
    ]);
    const expected = CANONICAL_CASES[index];
    if (item.gateId !== expected.gateId || item.mandatory !== true ||
        !CASE_STATES.has(item.state) || !EVIDENCE_KINDS.has(item.evidenceKind)) {
      invalidStagingReadinessV1("receipt_case_schema_invalid");
    }
    assertSafeCodes(item.errorCodes);
    assertSafeCodes(item.violationCodes);
    assertSafeCodes(item.blockerCodes);
    const issueCount = item.errorCodes.length + item.violationCodes.length +
      item.blockerCodes.length;
    if (item.state === "passed") {
      assertDigest(item.evidenceSha256, "passed_case_evidence_missing");
      validateCaseClock(item.observedAt, receipt);
      if (issueCount !== 0) invalidStagingReadinessV1("passed_case_has_issue");
      if (STATIC_CASE_IDS.has(item.id)) {
        if (item.evidenceKind !== "immutable_source" ||
            item.candidateBindingSha256 !== receipt.candidate.candidateAttestationSha256) {
          invalidStagingReadinessV1("static_case_binding_invalid");
        }
      } else if (item.id === FINAL_CASE_ID) {
        if (item.evidenceKind !== "derived_attestation" ||
            item.candidateBindingSha256 !== receipt.candidateBindingSha256) {
          invalidStagingReadinessV1("derived_case_binding_invalid");
        }
      } else if (item.evidenceKind !== "independent_live_observation" ||
          item.candidateBindingSha256 !== receipt.candidateBindingSha256) {
        invalidStagingReadinessV1("live_case_binding_invalid");
      }
    } else if (item.state === "failed") {
      if (item.errorCodes.length + item.violationCodes.length === 0 ||
          item.evidenceSha256 === null || item.observedAt === null) {
        invalidStagingReadinessV1("failed_case_missing_evidence");
      }
      assertDigest(item.evidenceSha256);
      validateCaseClock(item.observedAt, receipt);
    } else {
      if (item.blockerCodes.length === 0 || item.evidenceKind !== "external_blocker" ||
          item.evidenceSha256 !== null || item.observedAt !== null ||
          item.candidateBindingSha256 !== null) {
        invalidStagingReadinessV1("blocked_or_not_run_case_invalid");
      }
    }
  });
  if (receipt.evidenceMode === "offline_contract" &&
      LIVE_OBSERVATION_CASE_IDS.some((id) =>
        cases.find((item) => item.id === id)?.state === "passed"
      )) {
    invalidStagingReadinessV1("offline_fake_claims_live_staging_pass");
  }
  const prerequisite = cases.find((item) => item.id === FINAL_CASE_ID);
  const priorPassed = cases.filter((item) => item.id !== FINAL_CASE_ID)
    .every((item) => item.state === "passed");
  if ((prerequisite.state === "passed") !== priorPassed) {
    invalidStagingReadinessV1("staging_prerequisite_reconciliation_invalid");
  }
  if (prerequisite.state === "passed") {
    const expectedDigest = sha256StagingReadinessV1(
      cases.filter((item) => item.id !== FINAL_CASE_ID).map((item) => ({
        id: item.id,
        state: item.state,
        evidenceSha256: item.evidenceSha256
      }))
    );
    if (prerequisite.evidenceSha256 !== expectedDigest) {
      invalidStagingReadinessV1("staging_prerequisite_digest_mismatch");
    }
  }
}

function validateCaseClock(value, receipt) {
  const milliseconds = timestampMilliseconds(value);
  const proofAsOf = timestampMilliseconds(receipt.proofAsOf);
  const trusted = timestampMilliseconds(receipt.clockPolicy.trustedObservationAt);
  if (milliseconds > proofAsOf ||
      milliseconds > trusted + MAXIMUM_CLOCK_SKEW_MILLISECONDS) {
    invalidStagingReadinessV1("case_clock_outside_proof_window");
  }
}

function validateGates(gates, cases) {
  assertExactOrderedIds(gates, CANONICAL_GATE_DEFINITIONS.map((item) => item.id));
  const expected = buildStagingReadinessGatesV1(cases);
  if (stableSerializeStagingReadinessV1(gates) !==
      stableSerializeStagingReadinessV1(expected)) {
    invalidStagingReadinessV1("receipt_gate_summary_inconsistent");
  }
}

function validateFindings(findings, finalClassification) {
  assertBoundedArray(findings, 32, "receipt_findings_invalid");
  const seen = new Set();
  findings.forEach((finding) => {
    exactKeys(finding, ["code", "severity", "state", "correctionSha256"]);
    if (!SAFE_CODE.test(finding.code ?? "") || seen.has(finding.code) ||
        !new Set(["P1", "P2"]).has(finding.severity) ||
        !new Set(["open", "corrected"]).has(finding.state)) {
      invalidStagingReadinessV1("receipt_findings_invalid");
    }
    seen.add(finding.code);
    if (finding.state === "corrected") assertDigest(finding.correctionSha256);
    else if (finding.correctionSha256 !== null) {
      invalidStagingReadinessV1("receipt_findings_invalid");
    }
  });
  if (finalClassification === "GO" && findings.length !== 0) {
    invalidStagingReadinessV1("go_receipt_has_findings");
  }
}

function validateSummary(summary, receipt) {
  exactKeys(summary, [
    "totalCases", "executedCases", "passedCases", "failedCases", "blockedCases",
    "notRunCases", "totalGates", "passedGates", "failedGates", "blockedGates",
    "notRunGates", "mandatoryNonPassGates", "errorCount", "violationCount",
    "blockerCount", "finalClassification", "readyForPhysicalAppAttest",
    "stagingInfrastructureReadyForLaterAttempt13", "attempt13Authorized",
    "providerCalls", "productionMutations", "secretExposures"
  ]);
  const expected = buildStagingReadinessSummaryV1({
    evidenceMode: receipt.evidenceMode,
    cases: receipt.cases,
    gates: receipt.gates,
    findings: receipt.findings
  });
  if (stableSerializeStagingReadinessV1(summary) !==
      stableSerializeStagingReadinessV1(expected) || summary.executedCases === 0 ||
      summary.providerCalls !== 0 || summary.productionMutations !== 0 ||
      summary.secretExposures !== 0 || summary.attempt13Authorized !== false) {
    invalidStagingReadinessV1("receipt_summary_inconsistent");
  }
  if (summary.finalClassification === "GO") {
    if (receipt.evidenceMode !== "live_staging" ||
        receipt.gates.some((gate) => gate.mandatory && gate.state !== "passed") ||
        summary.errorCount !== 0 || summary.violationCount !== 0 ||
        summary.blockerCount !== 0 ||
        receipt.observations.providerAccounting.attempted !== 0 ||
        receipt.observations.cleanup.residualResourceDigests.length !== 0) {
      invalidStagingReadinessV1("false_green_summary_rejected");
    }
  }
}

function validateAuthenticity(authenticity, evidenceMode, semanticDigest, options) {
  exactKeys(authenticity, [
    "scheme",
    "observerKeyIdSha256",
    "signatureBase64url"
  ]);
  if (evidenceMode === "offline_contract") {
    if (authenticity.scheme !== "none" || authenticity.observerKeyIdSha256 !== null ||
        authenticity.signatureBase64url !== null) {
      invalidStagingReadinessV1("offline_receipt_authenticity_invalid");
    }
    return;
  }
  if (authenticity.scheme !== "ed25519-sha256-v1" ||
      !HEX_64.test(authenticity.observerKeyIdSha256 ?? "") ||
      typeof authenticity.signatureBase64url !== "string" ||
      !options.observerPublicKey ||
      authenticity.observerKeyIdSha256 !== options.expectedObserverKeyIdSha256 ||
      stagingReadinessObserverKeyIdV1(options.observerPublicKey) !==
        options.expectedObserverKeyIdSha256) {
    invalidStagingReadinessV1("live_receipt_authenticity_invalid");
  }
  let verified = false;
  try {
    verified = verifySignature(
      null,
      stagingReadinessSignaturePayloadV1(semanticDigest),
      normalizePublicKey(options.observerPublicKey),
      Buffer.from(authenticity.signatureBase64url, "base64url")
    );
  } catch {
    verified = false;
  }
  if (!verified) invalidStagingReadinessV1("live_receipt_signature_invalid");
}

function normalizePublicKey(value) {
  return value?.type === "public" ? value : createPublicKey(value);
}

function derivedState(states) {
  if (states.every((state) => state === "passed")) return "passed";
  if (states.includes("failed")) return "failed";
  if (states.includes("blocked")) return "blocked";
  return "not_run";
}

function countStates(items) {
  const counts = { passed: 0, failed: 0, blocked: 0, not_run: 0 };
  items.forEach((item) => { counts[item.state] += 1; });
  return counts;
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}
