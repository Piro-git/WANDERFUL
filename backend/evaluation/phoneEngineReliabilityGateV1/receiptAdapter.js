import {
  PHONE_ENGINE_RELIABILITY_GATE_ID_V1,
  validatePhoneEngineReliabilityManifestV1
} from "./manifest.js";

const OBSERVATION_FIELDS = Object.freeze([
  "assertions", "executed", "id", "productQualityOutcome",
  "providerCallCount", "runtimeMilliseconds", "skipped",
  "technicalPipelineOutcome", "terminalState"
]);
const TEST_RESULT_FIELDS = Object.freeze(["result", "selector"]);

export function createPhoneEngineReliabilityReceiptV1({
  manifest,
  proofClassification,
  providerAuthorization,
  caseObservations,
  testResults
}) {
  validatePhoneEngineReliabilityManifestV1(manifest);
  if (!Array.isArray(caseObservations) || !Array.isArray(testResults)) {
    throw new TypeError("phone_gate_adapter_input_invalid");
  }
  const expectedSelectors = [...new Set(
    manifest.cases.flatMap((item) => item.sourceTestSelectors)
  )].sort();
  const observedSelectors = testResults.map((item) => {
    exactObject(item, TEST_RESULT_FIELDS);
    return item.selector;
  });
  if (!sameArray([...observedSelectors].sort(), expectedSelectors) ||
    new Set(observedSelectors).size !== observedSelectors.length) {
    throw new TypeError("phone_gate_test_results_incomplete");
  }
  const testResultBySelector = new Map(
    testResults.map((item) => [item.selector, item.result])
  );
  const expectedIds = manifest.cases.map((item) => item.id);
  if (!sameArray(caseObservations.map((item) => item?.id), expectedIds)) {
    throw new TypeError("phone_gate_observations_incomplete");
  }

  const cases = manifest.cases.map((contract, index) => {
    const observation = caseObservations[index];
    exactObject(observation, OBSERVATION_FIELDS);
    try {
      exactObject(observation.assertions, contract.requiredAssertionIds);
    } catch {
      throw new TypeError("phone_gate_assertions_incomplete");
    }
    if (!Object.values(observation.assertions).every((value) =>
      typeof value === "boolean")) {
      throw new TypeError("phone_gate_assertions_incomplete");
    }
    return {
      id: contract.id,
      executed: observation.executed,
      skipped: observation.skipped,
      terminalState: observation.terminalState,
      technicalPipelineOutcome: observation.technicalPipelineOutcome,
      productQualityOutcome: observation.productQualityOutcome,
      assertions: contract.requiredAssertionIds.map((id) => ({
        id,
        passed: observation.assertions[id]
      })),
      testEvidence: contract.sourceTestSelectors.map((selector) => ({
        selector,
        result: testResultBySelector.get(selector)
      })),
      providerCallCount: observation.providerCallCount,
      runtimeMilliseconds: observation.runtimeMilliseconds
    };
  });
  return {
    schemaVersion: 1,
    gateId: PHONE_ENGINE_RELIABILITY_GATE_ID_V1,
    proofClassification,
    providerAuthorization,
    totalRuntimeMilliseconds: cases.reduce(
      (total, item) => total + item.runtimeMilliseconds,
      0
    ),
    cases
  };
}

function exactObject(value, fields) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    !sameArray(Object.keys(value).sort(), [...fields].sort())) {
    throw new TypeError("phone_gate_adapter_fields_invalid");
  }
}

function sameArray(left, right) {
  return Array.isArray(left) && left.length === right.length &&
    left.every((value, index) => value === right[index]);
}
