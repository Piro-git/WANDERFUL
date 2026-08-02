import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OutdoorAdventureStagingProofIOSReceiptError,
  outdoorAdventureStagingProofIOSResultDigestV1,
  outdoorAdventureStagingProofIOSReceiptAttachmentFilesV1,
  validateOutdoorAdventureStagingProofXCResultTestRunV1,
  validateOutdoorAdventureStagingProofIOSReceiptCausalityV1,
  validateOutdoorAdventureStagingProofIOSReceiptV1
} from "../evaluation/outdoorAdventureStagingProof/iosRuntimeReceipt.js";
import {
  OUTDOOR_ADVENTURE_STAGING_PROOF_MANIFEST_DIGEST_V1,
  loadOutdoorAdventureStagingProofManifestV1
} from "../evaluation/outdoorAdventureStagingProof/manifest.js";

const MANIFEST_PATH = new URL(
  "../evaluation/outdoorAdventureStagingProof/fixtures/mandatoryCasesV1.json",
  import.meta.url
);
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);
const DIGEST_D = "d".repeat(64);

describe("outdoor adventure staging proof iOS receipt", () => {
  it("strictly validates the exact redacted receipt contract", () => {
    const receipt = case16Receipt();
    const validated =
      validateOutdoorAdventureStagingProofIOSReceiptV1(
        receipt,
        {
          expectedCaseId: receipt.caseId,
          expectedInputFixtureId: receipt.inputFixtureId,
          expectedLane: "controlled",
          expectedNonceDigest: DIGEST_A
        }
      );
    assert.notEqual(validated, receipt);
    assert(Object.isFrozen(validated));

    assertReceiptError(
      () => validateOutdoorAdventureStagingProofIOSReceiptV1({
        ...receipt,
        unexpected: true
      }),
      "ios_runtime_receipt_invalid"
    );
    assertReceiptError(
      () => validateOutdoorAdventureStagingProofIOSReceiptV1({
        ...receipt,
        blockerCode: "causal_server_binding_missing",
        proofTerminalState: "failed"
      }),
      "ios_runtime_receipt_blocked"
    );
    assertReceiptError(
      () => validateOutdoorAdventureStagingProofIOSReceiptV1(
        receipt,
        { expectedNonceDigest: DIGEST_D }
      ),
      "ios_runtime_receipt_nonce_mismatch"
    );
  });

  it("accepts a bounded combined xcresult attachment manifest", () => {
    const xcode26Name =
      "TrailMind Outdoor Adventure Staging Proof Receipt v1_" +
      "0_EB6880B6-D608-4C4F-947F-27C7423D6912.json";
    const files =
      outdoorAdventureStagingProofIOSReceiptAttachmentFilesV1([
        attachmentEntry("testCase01", "receipt-case01.json"),
        attachmentEntry(
          "testCase16",
          "receipt-case16.json",
          xcode26Name
        )
      ]);
    assert.deepEqual(
      files,
      ["receipt-case01.json", "receipt-case16.json"]
    );
    assertReceiptError(
      () =>
        outdoorAdventureStagingProofIOSReceiptAttachmentFilesV1([
          attachmentEntry("testCase16", "../receipt.json")
        ]),
      "xcresult_attachment_manifest_invalid"
    );
    assertReceiptError(
      () =>
        outdoorAdventureStagingProofIOSReceiptAttachmentFilesV1([
          attachmentEntry(
            "testCase16",
            "receipt-case16.json",
            "TrailMind Outdoor Adventure Staging Proof Receipt " +
              "v1_0_not-a-uuid.json"
          )
        ]),
      "ios_runtime_receipt_missing"
    );
  });

  it("binds a receipt attachment to the exact test and destination", () => {
    const expectedTestIdentifier =
      "TrailMindStagingProofUITests/testCase16()";
    const expectedDeviceId = "controlled-simulator";
    const target = attachmentEntry(
      expectedTestIdentifier,
      "receipt-case16.json",
      "TrailMind Outdoor Adventure Staging Proof Receipt v1",
      {
        testIdentifierURL: "test://trailmind/case16",
        deviceId: expectedDeviceId
      }
    );
    const foreign = attachmentEntry(
      "TrailMindStagingProofUITests/testCase01()",
      "receipt-case01.json",
      "TrailMind Outdoor Adventure Staging Proof Receipt v1",
      { deviceId: "other-device" }
    );
    assert.deepEqual(
      outdoorAdventureStagingProofIOSReceiptAttachmentFilesV1(
        [foreign, target],
        { expectedTestIdentifier, expectedDeviceId }
      ),
      ["receipt-case16.json"]
    );
    assertReceiptError(
      () =>
        outdoorAdventureStagingProofIOSReceiptAttachmentFilesV1(
          [target],
          {
            expectedTestIdentifier: `${expectedTestIdentifier}Wrong`,
            expectedDeviceId
          }
        ),
      "xcresult_test_identifier_mismatch"
    );
    assertReceiptError(
      () =>
        outdoorAdventureStagingProofIOSReceiptAttachmentFilesV1(
          [target],
          {
            expectedTestIdentifier,
            expectedDeviceId: "wrong-device"
          }
        ),
      "xcresult_device_mismatch"
    );
    assertReceiptError(
      () =>
        outdoorAdventureStagingProofIOSReceiptAttachmentFilesV1(
          [attachmentEntry(
            expectedTestIdentifier,
            "receipt-case16.json",
            "TrailMind Outdoor Adventure Staging Proof Receipt v1",
            {
              deviceId: expectedDeviceId,
              isAssociatedWithFailure: true
            }
          )],
          { expectedTestIdentifier, expectedDeviceId }
        ),
      "xcresult_attachment_failure_associated"
    );
    assertReceiptError(
      () =>
        outdoorAdventureStagingProofIOSReceiptAttachmentFilesV1([
          attachmentEntry(
            expectedTestIdentifier,
            "receipt-case16.json",
            "TrailMind Outdoor Adventure Staging Proof Receipt v1",
            { configurationName: "" }
          )
        ]),
      "xcresult_attachment_manifest_invalid"
    );
  });

  it("requires one passed XCTest on the preselected destination", () => {
    const expectedTestIdentifier =
      "TrailMindStagingProofUITests/testCase16()";
    const expectedDeviceId = "controlled-simulator";
    const input = xcresultTestResults({
      expectedTestIdentifier,
      expectedDeviceId
    });
    assert.deepEqual(
      validateOutdoorAdventureStagingProofXCResultTestRunV1({
        testResults: input,
        expectedTestIdentifier,
        expectedDeviceId,
        expectedDestination: "simulator"
      }),
      { testIdentifierURL: "test://trailmind/case16" }
    );
    for (const result of [
      "Failed",
      "Skipped",
      "Expected Failure",
      "unknown"
    ]) {
      assertReceiptError(
        () =>
          validateOutdoorAdventureStagingProofXCResultTestRunV1({
            testResults: xcresultTestResults({
              expectedTestIdentifier,
              expectedDeviceId,
              result
            }),
            expectedTestIdentifier,
            expectedDeviceId,
            expectedDestination: "simulator"
          }),
        "xcresult_test_not_passed"
      );
    }
    assertReceiptError(
      () =>
        validateOutdoorAdventureStagingProofXCResultTestRunV1({
          testResults: xcresultTestResults({
            expectedTestIdentifier,
            expectedDeviceId,
            extraTest: true
          }),
          expectedTestIdentifier,
          expectedDeviceId,
          expectedDestination: "simulator"
        }),
      "xcresult_extra_test"
    );
    assertReceiptError(
      () =>
        validateOutdoorAdventureStagingProofXCResultTestRunV1({
          testResults: input,
          expectedTestIdentifier,
          expectedDeviceId: "wrong-device",
          expectedDestination: "simulator"
        }),
      "xcresult_device_mismatch"
    );
    assertReceiptError(
      () =>
        validateOutdoorAdventureStagingProofXCResultTestRunV1({
          testResults: input,
          expectedTestIdentifier,
          expectedDeviceId,
          expectedDestination: "physical"
        }),
      "xcresult_destination_mismatch"
    );
  });

  it("requires case16 to match its one production-client request", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const evaluationCase = manifest.cases[15];
    const receipt = validateOutdoorAdventureStagingProofIOSReceiptV1(
      case16Receipt()
    );
    const capture = {
      caseId: evaluationCase.id,
      executions: [{
        completed: true,
        intentBound: true,
        requestIdDigest: DIGEST_B,
        statusCode: 200,
        deliveredOutcome: "controlled_malformed_endpoint_result",
        payload: { schemaVersion: 1 }
      }]
    };
    assert.equal(
      validateOutdoorAdventureStagingProofIOSReceiptCausalityV1({
        receipt,
        capture,
        evaluationCase
      }),
      true
    );
    assertReceiptError(
      () =>
        validateOutdoorAdventureStagingProofIOSReceiptCausalityV1({
          receipt: withResultDigest({
            ...receipt,
            requestIdDigest: DIGEST_C
          }),
          capture,
          evaluationCase
        }),
      "ios_runtime_receipt_request_id_mismatch"
    );
  });

  it("requires retry attempts, requests, and result binding to be fresh", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const evaluationCase = manifest.cases[17];
    const currentResultDigest = DIGEST_D;
    const receiptInput = {
      ...baseReceipt({
        caseId: evaluationCase.id,
        inputFixtureId: evaluationCase.input.fixtureId,
        lane: "live",
        requestIdDigest: DIGEST_C,
        proofTerminalState: "retry_succeeded",
        plannerTerminalState: "suggestions_ready",
        adapterState: "ready",
        researchOutcome: "partial",
        researchCoordinatorRequestCount: 2,
        legacyRoutingRequestCount: 1,
        plannerAttemptCount: 2,
        semanticObservationIds: [
          "canonical_intent_bound",
          "fresh_retry_after_failure",
          "legacy_fallback_once",
          "real_route_quality_ranked",
          "research_waypoints_visited"
        ],
        limitationCauseIds: [
          "access_unverified",
          "prior_attempt_failed"
        ]
      }),
      retry: {
        priorAttemptDigest: DIGEST_A,
        currentAttemptDigest: DIGEST_B,
        priorRequestIdDigest: DIGEST_B,
        currentRequestIdDigest: DIGEST_C,
        priorResultDigest: DIGEST_A,
        priorTerminalState: "no_routes",
        currentTerminalState: "suggestions_ready",
        currentResultDigest,
        postResetPlannerTerminalState: "generating",
        postResetSuggestionCount: 0,
        postResetResearchContextDigest: null,
        postResetClarificationDigest: null,
        postResetRecoveryDigest: null
      }
    };
    receiptInput.diagnosticChecks.retryFreshness = "passed";
    const receipt = validateOutdoorAdventureStagingProofIOSReceiptV1(
      withResultDigest(receiptInput)
    );
    const capture = {
      caseId: evaluationCase.id,
      executions: [
        {
          completed: true,
          intentBound: true,
          requestIdDigest: DIGEST_B,
          statusCode: 503,
          deliveredOutcome:
            "controlled_failure_after_production_execution",
          payload: {
            error: { code: "internal_failure" }
          }
        },
        {
          completed: true,
          intentBound: true,
          requestIdDigest: DIGEST_C,
          statusCode: 200,
          deliveredOutcome: "production_endpoint_result",
          payload: { state: "partial" }
        }
      ]
    };
    assert.equal(
      validateOutdoorAdventureStagingProofIOSReceiptCausalityV1({
        receipt,
        capture,
        evaluationCase
      }),
      true
    );
    assertReceiptError(
      () =>
        validateOutdoorAdventureStagingProofIOSReceiptCausalityV1({
          receipt: withResultDigest({
            ...receipt,
            retry: {
              ...receipt.retry,
              currentAttemptDigest: receipt.retry.priorAttemptDigest
            }
          }),
          capture,
          evaluationCase
        }),
      "ios_runtime_receipt_retry_causality_invalid"
    );
  });

  it("binds case output, diagnostics, and reset evidence into every result digest", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const mutations = new Map([
      [3, (receipt) => {
        receipt.semanticObservationIds =
          receipt.semanticObservationIds.filter(
            (id) => id !== "named_brocken_must_have_satisfied"
          );
      }],
      [4, (receipt) => {
        receipt.limitationCauseIds = [];
      }],
      [12, (receipt) => {
        receipt.cancellation.postCancelCoordinatorResultCount = 1;
      }],
      [13, (receipt) => {
        receipt.proofTerminalState = "failed";
      }],
      [15, (receipt) => {
        receipt.adapterState = "not_observed";
      }],
      [16, (receipt) => {
        receipt.plannerTerminalState = "generating";
      }]
    ]);
    for (const [index, mutate] of mutations) {
      const receipt = digestBoundReceipt(manifest.cases[index]);
      validateOutdoorAdventureStagingProofIOSReceiptV1(receipt);
      const changed = structuredClone(receipt);
      mutate(changed);
      assertReceiptError(
        () =>
          validateOutdoorAdventureStagingProofIOSReceiptV1(changed),
        "ios_runtime_receipt_result_digest_mismatch"
      );
    }

    const cancellation = digestBoundReceipt(manifest.cases[12]);
    const forgedDiagnostic = structuredClone(cancellation);
    forgedDiagnostic.diagnosticChecks.cancellation =
      "not_applicable";
    assertReceiptError(
      () =>
        validateOutdoorAdventureStagingProofIOSReceiptV1(
          withResultDigest(forgedDiagnostic)
        ),
      "ios_runtime_receipt_result_digest_mismatch"
    );

    const retry = withResultDigest({
      ...baseReceipt({
        caseId: manifest.cases[17].id,
        inputFixtureId: manifest.cases[17].input.fixtureId,
        lane: "live",
        requestIdDigest: DIGEST_C,
        proofTerminalState: "retry_succeeded",
        plannerTerminalState: "suggestions_ready",
        adapterState: "ready",
        researchOutcome: "partial",
        researchCoordinatorRequestCount: 2,
        legacyRoutingRequestCount: 1,
        plannerAttemptCount: 2,
        semanticObservationIds: [
          ...manifest.cases[17].expected.semanticExpectationIds
        ],
        limitationCauseIds: [
          ...manifest.cases[17].expected.requiredLimitationCauseIds
        ]
      }),
      retry: retryEvidence({
        postResetSuggestionCount: 1
      })
    });
    retry.diagnosticChecks.retryFreshness = "passed";
    retry.resultDigest =
      outdoorAdventureStagingProofIOSResultDigestV1(retry);
    assertReceiptError(
      () => validateOutdoorAdventureStagingProofIOSReceiptV1(retry),
      "ios_runtime_receipt_result_digest_mismatch"
    );
  });
});

function digestBoundReceipt(evaluationCase) {
  if (
    evaluationCase.id ===
      "case-16-malformed-backend-response-rejected-by-ios"
  ) {
    return case16Receipt();
  }
  const isFeatureDisabled =
    evaluationCase.id ===
      "case-17-feature-disabled-zero-research-work";
  const plannerTerminalState = {
    "case-04-harz-brocken-must-have-landmark":
      "suggestions_ready",
    "case-05-harz-unsatisfied-must-have-highlight":
      "no_routes",
    "case-13-cancel-during-postgis-research":
      "cancelled",
    "case-14-timeout-during-graphhopper":
      "suggestions_ready",
    "case-17-feature-disabled-zero-research-work":
      "idle"
  }[evaluationCase.id];
  const researchOutcome = {
    "case-04-harz-brocken-must-have-landmark": "partial",
    "case-05-harz-unsatisfied-must-have-highlight":
      "no_viable_route",
    "case-13-cancel-during-postgis-research": "failure",
    "case-14-timeout-during-graphhopper": "failure",
    "case-17-feature-disabled-zero-research-work": "none"
  }[evaluationCase.id];
  const receipt = baseReceipt({
    caseId: evaluationCase.id,
    inputFixtureId: evaluationCase.input.fixtureId,
    lane: "live",
    requestIdDigest: isFeatureDisabled ? null : DIGEST_B,
    proofTerminalState: evaluationCase.expected.terminalState,
    plannerTerminalState,
    adapterState: isFeatureDisabled ? "not_observed" : "ready",
    researchOutcome,
    researchCoordinatorRequestCount: isFeatureDisabled ? 0 : 1,
    legacyRoutingRequestCount:
      evaluationCase.expected.legacyFallbackCount,
    plannerAttemptCount: isFeatureDisabled ? 0 : 1,
    semanticObservationIds: [
      ...evaluationCase.expected.semanticExpectationIds
    ],
    limitationCauseIds: [
      ...evaluationCase.expected.requiredLimitationCauseIds
    ]
  });
  const responseConversionExpected = new Set([
    "case-04-harz-brocken-must-have-landmark",
    "case-05-harz-unsatisfied-must-have-highlight"
  ]).has(evaluationCase.id);
  receipt.iosStageTimings.response_conversion =
    responseConversionExpected ? ["under_100ms"] : [];
  receipt.diagnosticChecks.productionClientPath =
    isFeatureDisabled ? "not_applicable" : "passed";
  if (
    evaluationCase.id ===
      "case-13-cancel-during-postgis-research"
  ) {
    receipt.cancellation = {
      attemptDigest: DIGEST_C,
      postCancelTerminalState: "cancelled",
      postCancelCoordinatorResultCount: 0,
      postCancelLegacyRoutingCount: 0
    };
    receipt.diagnosticChecks.cancellation = "passed";
  }
  return withResultDigest(receipt);
}

function retryEvidence(overrides = {}) {
  return {
    priorAttemptDigest: DIGEST_A,
    currentAttemptDigest: DIGEST_B,
    priorRequestIdDigest: DIGEST_B,
    currentRequestIdDigest: DIGEST_C,
    priorResultDigest: DIGEST_A,
    priorTerminalState: "no_routes",
    currentTerminalState: "suggestions_ready",
    currentResultDigest: DIGEST_D,
    postResetPlannerTerminalState: "generating",
    postResetSuggestionCount: 0,
    postResetResearchContextDigest: null,
    postResetClarificationDigest: null,
    postResetRecoveryDigest: null,
    ...overrides
  };
}

function case16Receipt() {
  return withResultDigest(baseReceipt({
    caseId:
      "case-16-malformed-backend-response-rejected-by-ios",
    inputFixtureId:
      "case-16-malformed-backend-response-rejected-by-ios-input-v1",
    lane: "controlled",
    requestIdDigest: DIGEST_B,
    proofTerminalState: "rejected",
    plannerTerminalState: "recoverable_error",
    adapterState: "ready",
    researchOutcome: "failure",
    researchCoordinatorRequestCount: 1,
    plannerAttemptCount: 1,
    semanticObservationIds: [
      "malformed_response_rejected_by_ios"
    ],
    limitationCauseIds: ["malformed_response"]
  }));
}

function baseReceipt({
  caseId,
  inputFixtureId,
  lane,
  requestIdDigest,
  proofTerminalState,
  plannerTerminalState,
  adapterState,
  researchOutcome,
  researchCoordinatorRequestCount,
  legacyRoutingRequestCount = 0,
  plannerAttemptCount,
  semanticObservationIds,
  limitationCauseIds
}) {
  return {
    schemaVersion: 1,
    proofVersion: "outdoor-adventure-staging-proof-v1",
    manifestDigest:
      OUTDOOR_ADVENTURE_STAGING_PROOF_MANIFEST_DIGEST_V1,
    caseId,
    inputFixtureId,
    lane,
    nonceDigest: DIGEST_A,
    requestIdDigest,
    resultDigest: DIGEST_A,
    proofTerminalState,
    plannerTerminalState,
    adapterState,
    researchOutcome,
    researchCoordinatorRequestCount,
    legacyRoutingRequestCount,
    plannerAttemptCount,
    backendPlanningGapCodes: [],
    semanticObservationIds,
    limitationCauseIds,
    selectionState: null,
    sourceEnvelopeState: null,
    alternativeCount: 0,
    contractConversion: {
      coordinatorSelectionOrderDigest: null,
      plannerSuggestionOrderDigest: null,
      acceptedCount: 0,
      rejectedCount: 0
    },
    presentation: {
      inputOrderDigest: null,
      outputOrderDigest: null,
      count: 0,
      kinds: []
    },
    cancellation: {
      attemptDigest: null,
      postCancelTerminalState: null,
      postCancelCoordinatorResultCount: 0,
      postCancelLegacyRoutingCount: 0
    },
    retry: {
      priorAttemptDigest: null,
      currentAttemptDigest: null,
      priorRequestIdDigest: null,
      currentRequestIdDigest: null,
      priorResultDigest: null,
      priorTerminalState: null,
      currentTerminalState: null,
      currentResultDigest: null,
      postResetPlannerTerminalState: null,
      postResetSuggestionCount: 0,
      postResetResearchContextDigest: null,
      postResetClarificationDigest: null,
      postResetRecoveryDigest: null
    },
    iosStageTimings: {
      adapter_conversion: ["under_100ms"],
      research_coordinator: ["under_100ms"],
      legacy_routing: [],
      response_conversion: ["under_100ms"],
      route_quality: [],
      presentation_projection: ["under_100ms"],
      end_to_end: ["under_100ms"]
    },
    diagnosticChecks: {
      productionClientPath: "passed",
      contractConversion: "not_applicable",
      qualityRanking: "not_applicable",
      presentation: "not_applicable",
      cancellation: "not_applicable",
      retryFreshness: "not_applicable"
    },
    blockerCode: null
  };
}

function attachmentEntry(
  testIdentifier,
  exportedFileName,
  suggestedHumanReadableName =
    "TrailMind Outdoor Adventure Staging Proof Receipt v1",
  overrides = {}
) {
  return {
    testIdentifier,
    ...(overrides.testIdentifierURL === undefined
      ? {}
      : { testIdentifierURL: overrides.testIdentifierURL }),
    attachments: [{
      exportedFileName,
      suggestedHumanReadableName,
      isAssociatedWithFailure:
        overrides.isAssociatedWithFailure ?? false,
      configurationName: overrides.configurationName ?? "Test",
      deviceName: overrides.deviceName ?? "iPhone",
      deviceId: overrides.deviceId ?? "device"
    }]
  };
}

function xcresultTestResults({
  expectedTestIdentifier,
  expectedDeviceId,
  result = "Passed",
  extraTest = false
}) {
  const testCase = {
    nodeIdentifier: expectedTestIdentifier,
    nodeIdentifierURL: "test://trailmind/case16",
    nodeType: "Test Case",
    name: "testCase16",
    result
  };
  return {
    testPlanConfigurations: [{
      configurationId: "test",
      configurationName: "Test"
    }],
    devices: [{
      deviceId: expectedDeviceId,
      deviceName: "iPhone",
      architecture: "arm64",
      modelName: "iPhone",
      platform: "iOS Simulator",
      osVersion: "26.5"
    }],
    testNodes: [{
      nodeType: "Test Suite",
      name: "TrailMindStagingProofUITests",
      children: [
        testCase,
        ...(extraTest
          ? [{
            nodeIdentifier:
              "TrailMindStagingProofUITests/testCase01()",
            nodeType: "Test Case",
            name: "testCase01",
            result: "Passed"
          }]
          : [])
      ]
    }]
  };
}

function withResultDigest(receipt) {
  const value = structuredClone(receipt);
  value.resultDigest =
    outdoorAdventureStagingProofIOSResultDigestV1(value);
  return value;
}

function assertReceiptError(operation, expectedCode) {
  assert.throws(
    operation,
    (error) =>
      error instanceof OutdoorAdventureStagingProofIOSReceiptError &&
      error.code === expectedCode
  );
}
