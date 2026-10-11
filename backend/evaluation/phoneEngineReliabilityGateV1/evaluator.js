import {
  PHONE_ENGINE_RELIABILITY_GATE_ID_V1,
  phoneEngineReliabilityManifestDigestV1,
  stableSerializePhoneEngineReliabilityV1,
  validatePhoneEngineReliabilityManifestV1
} from "./manifest.js";

const RECEIPT_FIELDS = Object.freeze([
  "cases", "gateId", "proofClassification", "providerAuthorization",
  "schemaVersion", "totalRuntimeMilliseconds"
]);
const CASE_FIELDS = Object.freeze([
  "assertions", "executed", "id", "productQualityOutcome",
  "providerCallCount", "runtimeMilliseconds", "skipped",
  "technicalPipelineOutcome", "terminalState", "testEvidence"
]);
const ASSERTION_FIELDS = Object.freeze(["id", "passed"]);
const TEST_EVIDENCE_FIELDS = Object.freeze(["result", "selector"]);
const PROOF_CLASSIFICATIONS = new Set([
  "deterministic_contract_proof",
  "integrated_simulator_proof",
  "physical_device_live_proof"
]);
const PROVIDER_AUTHORIZATIONS = new Set(["none", "fresh_bounded"]);

export class PhoneEngineReliabilityEvaluationError extends Error {
  constructor(code) {
    super(code);
    this.name = "PhoneEngineReliabilityEvaluationError";
    this.code = code;
  }
}

export function evaluatePhoneEngineReliabilityReceiptV1({ manifest, receipt }) {
  validatePhoneEngineReliabilityManifestV1(manifest);
  validateReceiptShape(manifest, receipt);

  const cases = manifest.cases.map((contract, index) => {
    const observed = receipt.cases[index];
    const failures = [];
    if (!observed.executed) failures.push("not_executed");
    if (observed.skipped) failures.push("unexpected_skip");
    if (observed.terminalState !== contract.expectedTerminalState) {
      failures.push("terminal_state_mismatch");
    }
    if (
      observed.technicalPipelineOutcome !==
        contract.expectedTechnicalPipelineOutcome
    ) {
      failures.push("technical_pipeline_outcome_mismatch");
    }
    if (
      observed.productQualityOutcome !==
        contract.expectedProductQualityOutcome
    ) {
      failures.push("product_quality_outcome_mismatch");
    }
    if (observed.runtimeMilliseconds >
      manifest.limits.maximumCaseRuntimeMilliseconds) {
      failures.push("case_runtime_exceeded");
    }
    for (const assertion of observed.assertions) {
      if (!assertion.passed) failures.push(`assertion_failed:${assertion.id}`);
    }
    for (const evidence of observed.testEvidence) {
      if (evidence.result !== "passed") {
        failures.push(`source_test_not_passed:${evidence.selector}`);
      }
    }
    return Object.freeze({
      id: contract.id,
      passed: failures.length === 0,
      failures: Object.freeze(failures),
      technicalPipelineOutcome: observed.technicalPipelineOutcome,
      productQualityOutcome: observed.productQualityOutcome,
      terminalState: observed.terminalState,
      providerCallCount: observed.providerCallCount,
      runtimeMilliseconds: observed.runtimeMilliseconds
    });
  });

  const failedCaseIds = cases.filter((item) => !item.passed).map((item) => item.id);
  const executedCount = receipt.cases.filter((item) => item.executed).length;
  const skippedCount = receipt.cases.filter((item) => item.skipped).length;
  const providerCallCount = receipt.cases.reduce(
    (total, item) => total + item.providerCallCount,
    0
  );
  const runtimeExceeded = receipt.totalRuntimeMilliseconds >
    manifest.limits.maximumTotalRuntimeMilliseconds;
  const finalStatus = failedCaseIds.length === 0 && executedCount > 0 &&
    skippedCount === 0 && !runtimeExceeded ? "passed" : "failed";
  const summary = Object.freeze({
    schemaVersion: 1,
    gateId: PHONE_ENGINE_RELIABILITY_GATE_ID_V1,
    manifestDigest: phoneEngineReliabilityManifestDigestV1(manifest),
    proofClassification: receipt.proofClassification,
    providerAuthorization: receipt.providerAuthorization,
    providerCallCount,
    configuredCaseCount: manifest.cases.length,
    executedCaseCount: executedCount,
    passedCaseCount: cases.length - failedCaseIds.length,
    failedCaseCount: failedCaseIds.length,
    skippedCaseCount: skippedCount,
    technicalPipelineTotals: outcomeTotals(
      cases,
      "technicalPipelineOutcome",
      ["pass", "fail", "not_run"]
    ),
    productQualityTotals: outcomeTotals(
      cases,
      "productQualityOutcome",
      ["pass", "fail", "not_applicable"]
    ),
    totalRuntimeMilliseconds: receipt.totalRuntimeMilliseconds,
    runtimeExceeded,
    caseIds: Object.freeze(cases.map((item) => item.id)),
    failedCaseIds: Object.freeze(failedCaseIds),
    cases: Object.freeze(cases),
    finalStatus
  });
  const bytes = Buffer.byteLength(
    stableSerializePhoneEngineReliabilityV1(summary),
    "utf8"
  );
  if (bytes > manifest.limits.maximumSummaryBytes) {
    invalid("summary_output_exceeded");
  }
  return summary;
}

export function serializePhoneEngineReliabilitySummaryV1(summary) {
  return `${stableSerializePhoneEngineReliabilityV1(summary)}\n`;
}

function validateReceiptShape(manifest, receipt) {
  exactObject(receipt, RECEIPT_FIELDS, "receipt_fields_invalid");
  if (
    receipt.schemaVersion !== 1 ||
    receipt.gateId !== PHONE_ENGINE_RELIABILITY_GATE_ID_V1 ||
    !PROOF_CLASSIFICATIONS.has(receipt.proofClassification) ||
    !PROVIDER_AUTHORIZATIONS.has(receipt.providerAuthorization) ||
    !nonNegativeInteger(receipt.totalRuntimeMilliseconds) ||
    !Array.isArray(receipt.cases) ||
    receipt.cases.length !== manifest.cases.length
  ) {
    invalid("receipt_contract_invalid");
  }
  const ids = receipt.cases.map((item) => item?.id);
  const expectedIds = manifest.cases.map((item) => item.id);
  if (new Set(ids).size !== ids.length || !sameArray(ids, expectedIds)) {
    invalid("receipt_case_identity_invalid");
  }
  let runtimeTotal = 0;
  let providerCalls = 0;
  for (const [index, observed] of receipt.cases.entries()) {
    const contract = manifest.cases[index];
    exactObject(observed, CASE_FIELDS, "receipt_case_fields_invalid");
    if (
      typeof observed.executed !== "boolean" ||
      typeof observed.skipped !== "boolean" ||
      typeof observed.terminalState !== "string" ||
      typeof observed.technicalPipelineOutcome !== "string" ||
      typeof observed.productQualityOutcome !== "string" ||
      !nonNegativeInteger(observed.providerCallCount) ||
      !nonNegativeInteger(observed.runtimeMilliseconds)
    ) {
      invalid("receipt_case_contract_invalid");
    }
    validateAssertions(contract, observed.assertions);
    validateTestEvidence(contract, observed.testEvidence);
    runtimeTotal += observed.runtimeMilliseconds;
    providerCalls += observed.providerCallCount;
  }
  if (runtimeTotal !== receipt.totalRuntimeMilliseconds) {
    invalid("receipt_runtime_totals_incoherent");
  }
  if (
    (providerCalls === 0 && receipt.providerAuthorization !== "none") ||
    (providerCalls > 0 &&
      (receipt.providerAuthorization !== "fresh_bounded" ||
       receipt.proofClassification !== "physical_device_live_proof"))
  ) {
    invalid("provider_authorization_incoherent");
  }
}

function validateAssertions(contract, assertions) {
  if (!Array.isArray(assertions)) invalid("assertions_invalid");
  for (const assertion of assertions) {
    exactObject(assertion, ASSERTION_FIELDS, "assertion_fields_invalid");
    if (typeof assertion.id !== "string" || typeof assertion.passed !== "boolean") {
      invalid("assertion_contract_invalid");
    }
  }
  if (!sameArray(assertions.map((item) => item.id), contract.requiredAssertionIds)) {
    invalid("assertion_identity_invalid");
  }
}

function validateTestEvidence(contract, evidence) {
  if (!Array.isArray(evidence)) invalid("test_evidence_invalid");
  for (const item of evidence) {
    exactObject(item, TEST_EVIDENCE_FIELDS, "test_evidence_fields_invalid");
    if (typeof item.selector !== "string" ||
      !["passed", "failed", "skipped", "not_run"].includes(item.result)) {
      invalid("test_evidence_contract_invalid");
    }
  }
  if (!sameArray(
    evidence.map((item) => item.selector),
    contract.sourceTestSelectors
  )) {
    invalid("test_evidence_identity_invalid");
  }
}

function outcomeTotals(cases, field, values) {
  return Object.freeze(Object.fromEntries(values.map((value) => [
    value,
    cases.filter((item) => item[field] === value).length
  ])));
}

function exactObject(value, fields, code) {
  if (!plainObject(value) || !sameArray(Object.keys(value).sort(), [...fields].sort())) {
    invalid(code);
  }
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function sameArray(left, right) {
  return Array.isArray(left) && left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function invalid(code) {
  throw new PhoneEngineReliabilityEvaluationError(code);
}
