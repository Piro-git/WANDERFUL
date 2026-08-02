import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  extname,
  join
} from "node:path";
import { promisify } from "node:util";
import {
  OUTDOOR_ADVENTURE_STAGING_PROOF_LIMITATION_CAUSE_IDS_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_MANIFEST_DIGEST_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_SEMANTIC_EXPECTATION_IDS_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_VERSION_V1
} from "./manifest.js";

export const OUTDOOR_ADVENTURE_STAGING_PROOF_IOS_RECEIPT_ATTACHMENT_V1 =
  "TrailMind Outdoor Adventure Staging Proof Receipt v1";
const XCODE_EXPORTED_IOS_RECEIPT_ATTACHMENT_NAME_PATTERN =
  /^TrailMind Outdoor Adventure Staging Proof Receipt v1_(?:0|[1-9][0-9]?)_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.json$/;

export const OUTDOOR_ADVENTURE_STAGING_PROOF_IOS_BLOCKER_CODES_V1 =
  Object.freeze([
    "backend_base_url_missing",
    "cancellation_authorization_not_observed",
    "causal_server_binding_missing",
    "controlled_case_requires_external_runner",
    "physical_device_required",
    "postgres_cancellation_gate_failed",
    "receipt_encoding_failed",
    "research_feature_disabled",
    "research_feature_unexpectedly_enabled",
    "retry_precondition_missing",
    "retry_stale_state",
    "simulator_development_session_non_proof",
    "unexpected_terminal"
  ]);

const execFileAsync = promisify(execFile);
const MAXIMUM_RECEIPT_BYTES = 64 * 1_024;
const MAXIMUM_MANIFEST_BYTES = 256 * 1_024;
const MAXIMUM_TEST_RESULTS_BYTES = 256 * 1_024;
const MAXIMUM_TEST_RESULT_NODES = 256;
const MAXIMUM_TEST_RESULT_DEPTH = 16;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CASE_ID_PATTERN =
  /^case-(?:0[1-9]|1[0-8])-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIXTURE_ID_PATTERN =
  /^case-(?:0[1-9]|1[0-8])-[a-z0-9]+(?:-[a-z0-9]+)*-input-v1$/;
const TOP_LEVEL_FIELDS = Object.freeze([
  "schemaVersion",
  "proofVersion",
  "manifestDigest",
  "caseId",
  "inputFixtureId",
  "lane",
  "nonceDigest",
  "requestIdDigest",
  "resultDigest",
  "proofTerminalState",
  "plannerTerminalState",
  "adapterState",
  "researchOutcome",
  "researchCoordinatorRequestCount",
  "legacyRoutingRequestCount",
  "plannerAttemptCount",
  "backendPlanningGapCodes",
  "semanticObservationIds",
  "limitationCauseIds",
  "selectionState",
  "sourceEnvelopeState",
  "alternativeCount",
  "contractConversion",
  "presentation",
  "cancellation",
  "retry",
  "iosStageTimings",
  "diagnosticChecks",
  "blockerCode"
]);
const CONTRACT_CONVERSION_FIELDS = Object.freeze([
  "coordinatorSelectionOrderDigest",
  "plannerSuggestionOrderDigest",
  "acceptedCount",
  "rejectedCount"
]);
const PRESENTATION_FIELDS = Object.freeze([
  "inputOrderDigest",
  "outputOrderDigest",
  "count",
  "kinds"
]);
const CANCELLATION_FIELDS = Object.freeze([
  "attemptDigest",
  "postCancelTerminalState",
  "postCancelCoordinatorResultCount",
  "postCancelLegacyRoutingCount"
]);
const RETRY_FIELDS = Object.freeze([
  "priorAttemptDigest",
  "currentAttemptDigest",
  "priorRequestIdDigest",
  "currentRequestIdDigest",
  "priorResultDigest",
  "priorTerminalState",
  "currentTerminalState",
  "currentResultDigest",
  "postResetPlannerTerminalState",
  "postResetSuggestionCount",
  "postResetResearchContextDigest",
  "postResetClarificationDigest",
  "postResetRecoveryDigest"
]);
const DIAGNOSTIC_CHECK_FIELDS = Object.freeze([
  "productionClientPath",
  "contractConversion",
  "qualityRanking",
  "presentation",
  "cancellation",
  "retryFreshness"
]);
const IOS_STAGE_NAMES = Object.freeze([
  "adapter_conversion",
  "research_coordinator",
  "legacy_routing",
  "response_conversion",
  "route_quality",
  "presentation_projection",
  "end_to_end"
]);
const IOS_RESULT_DIGEST_SCHEMA =
  "trailmind-ios-runtime-result-digest-v1";
const TIMING_BUCKET_SET = new Set([
  "under_100ms",
  "100ms_to_499ms",
  "500ms_to_999ms",
  "1s_to_4s",
  "5s_to_14s",
  "15s_or_more"
]);
const PROOF_TERMINAL_STATE_SET = new Set([
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
  "failed"
]);
const PLANNER_TERMINAL_STATE_SET = new Set([
  "idle",
  "generating",
  "clarification",
  "suggestions_ready",
  "no_routes",
  "recoverable_error",
  "cancelled"
]);
const ADAPTER_STATE_SET = new Set([
  "not_observed",
  "ready",
  "clarification_required",
  "unsupported"
]);
const RESEARCH_OUTCOME_SET = new Set([
  "none",
  "failure",
  "clarification_required",
  "unsupported",
  "no_viable_route",
  "partial",
  "routed"
]);
const ENVELOPE_STATE_SET = new Set([
  "routed",
  "partial",
  "no_viable_route",
  "unsupported"
]);
const CHECK_STATE_SET =
  new Set(["passed", "failed", "not_applicable"]);
const PRESENTATION_KIND_SET = new Set([
  "research_guided",
  "research_guided_partial",
  "standard_route_fallback",
  "standard_route",
  "clarification",
  "unsupported"
]);
const PLANNING_GAP_CODE_SET = new Set([
  "unsupported_region",
  "unsupported_evidence_dimension",
  "official_source_unavailable",
  "current_source_unavailable",
  "mapped_source_unavailable",
  "derived_source_unavailable",
  "operation_type_unavailable",
  "predicate_unavailable",
  "transport_evidence_not_modeled",
  "biking_network_not_modeled",
  "toilet_evidence_not_modeled",
  "scenic_quality_not_verifiable",
  "water_availability_source_missing"
]);
const SEMANTIC_OBSERVATION_ID_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_SEMANTIC_EXPECTATION_IDS_V1);
const LIMITATION_CAUSE_ID_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_LIMITATION_CAUSE_IDS_V1);
const BLOCKER_CODE_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_IOS_BLOCKER_CODES_V1);
const EXTRACTED_RECEIPTS = new WeakSet();
const CAUSALLY_VERIFIED_RECEIPTS = new WeakSet();
const SERVER_BOUND_CASE_IDS = new Set([
  "case-01-harz-ilsenburg-loop-viewpoints-forest",
  "case-02-harz-schierke-easy-loop-paths-avoid-roads",
  "case-03-harz-trail-running-loop",
  "case-04-harz-brocken-must-have-landmark",
  "case-05-harz-unsatisfied-must-have-highlight",
  "case-06-outside-imported-coverage",
  "case-07-innsbruck-viewpoint-loop",
  "case-08-innsbruck-easy-conservative-loop",
  "case-10-innsbruck-missing-official-current-evidence",
  "case-13-cancel-during-postgis-research",
  "case-14-timeout-during-graphhopper",
  "case-15-partial-provider-failure-survivor",
  "case-16-malformed-backend-response-rejected-by-ios",
  "case-18-retry-does-not-reuse-stale-state"
]);
const RESPONSE_CONVERSION_CASE_IDS = new Set([
  "case-01-harz-ilsenburg-loop-viewpoints-forest",
  "case-02-harz-schierke-easy-loop-paths-avoid-roads",
  "case-03-harz-trail-running-loop",
  "case-04-harz-brocken-must-have-landmark",
  "case-05-harz-unsatisfied-must-have-highlight",
  "case-06-outside-imported-coverage",
  "case-07-innsbruck-viewpoint-loop",
  "case-08-innsbruck-easy-conservative-loop",
  "case-10-innsbruck-missing-official-current-evidence",
  "case-15-partial-provider-failure-survivor",
  "case-16-malformed-backend-response-rejected-by-ios",
  "case-18-retry-does-not-reuse-stale-state"
]);

export class OutdoorAdventureStagingProofIOSReceiptError extends Error {
  constructor(code) {
    super(code);
    this.name = "OutdoorAdventureStagingProofIOSReceiptError";
    this.code = code;
  }
}

export async function extractOutdoorAdventureStagingProofIOSReceiptV1({
  xcresultPath,
  expectedCaseId,
  expectedInputFixtureId,
  expectedLane,
  expectedNonceDigest,
  expectedTestIdentifier,
  expectedDeviceId,
  expectedDestination,
  signal
}) {
  validateXCResultExpectations({
    expectedLane,
    expectedTestIdentifier,
    expectedDeviceId,
    expectedDestination
  });
  const sourcePath = await validatedXCResultPath(xcresultPath);
  const exportDirectory = await mkdtemp(
    join(tmpdir(), "trailmind-staging-proof-xcresult-")
  );
  try {
    await execFileAsync(
      "xcrun",
      [
        "xcresulttool",
        "export",
        "attachments",
        "--path",
        sourcePath,
        "--output-path",
        exportDirectory
      ],
      {
        encoding: "utf8",
        maxBuffer: MAXIMUM_MANIFEST_BYTES,
        timeout: 120_000,
        signal
      }
    );
    const manifestSource = await readBoundedUTF8File(
      join(exportDirectory, "manifest.json"),
      MAXIMUM_MANIFEST_BYTES,
      "xcresult_attachment_manifest_invalid"
    );
    assertNoDuplicateJSONKeys(manifestSource);
    let manifest;
    try {
      manifest = JSON.parse(manifestSource);
    } catch {
      invalid("xcresult_attachment_manifest_invalid");
    }
    const attachmentRecords =
      outdoorAdventureStagingProofIOSReceiptAttachmentRecordsV1(
        manifest,
        {
          expectedTestIdentifier,
          expectedDeviceId
        }
      );
    const { stdout: testResultsSource } = await execFileAsync(
      "xcrun",
      [
        "xcresulttool",
        "get",
        "test-results",
        "tests",
        "--path",
        sourcePath,
        "--compact"
      ],
      {
        encoding: "utf8",
        maxBuffer: MAXIMUM_TEST_RESULTS_BYTES,
        timeout: 120_000,
        signal
      }
    );
    if (
      typeof testResultsSource !== "string" ||
      Buffer.byteLength(testResultsSource, "utf8") >
        MAXIMUM_TEST_RESULTS_BYTES
    ) {
      invalid("xcresult_test_report_invalid");
    }
    assertNoDuplicateJSONKeys(testResultsSource);
    let testResults;
    try {
      testResults = JSON.parse(testResultsSource);
    } catch {
      invalid("xcresult_test_report_invalid");
    }
    const testRun =
      validateOutdoorAdventureStagingProofXCResultTestRunV1({
        testResults,
        expectedTestIdentifier,
        expectedDeviceId,
        expectedDestination
      });
    const attachment = attachmentRecords[0];
    if (
      attachment.testIdentifierURL !== null &&
      testRun.testIdentifierURL !== null &&
      attachment.testIdentifierURL !== testRun.testIdentifierURL
    ) {
      invalid("xcresult_test_identifier_url_mismatch");
    }
    const candidates = [];
    for (const attachmentRecord of attachmentRecords) {
      const attachmentPath = await validatedExportedAttachmentPath(
        exportDirectory,
        attachmentRecord.exportedFileName
      );
      const receiptSource = await readBoundedUTF8File(
        attachmentPath,
        MAXIMUM_RECEIPT_BYTES,
        "ios_runtime_receipt_invalid"
      );
      assertNoDuplicateJSONKeys(receiptSource);
      let parsed;
      try {
        parsed = JSON.parse(receiptSource);
      } catch {
        invalid("ios_runtime_receipt_invalid");
      }
      if (
        parsed?.caseId === expectedCaseId &&
        parsed?.inputFixtureId === expectedInputFixtureId &&
        parsed?.nonceDigest === expectedNonceDigest
      ) {
        candidates.push(parsed);
      }
    }
    if (candidates.length !== 1) {
      invalid(
        candidates.length === 0
          ? "ios_runtime_receipt_missing"
          : "ios_runtime_receipt_duplicate"
      );
    }
    const receipt = validateOutdoorAdventureStagingProofIOSReceiptV1(
      candidates[0],
      {
        expectedCaseId,
        expectedInputFixtureId,
        expectedLane,
        expectedNonceDigest
      }
    );
    EXTRACTED_RECEIPTS.add(receipt);
    return receipt;
  } catch (error) {
    if (error instanceof OutdoorAdventureStagingProofIOSReceiptError) {
      throw error;
    }
    invalid("xcresult_attachment_export_failed");
  } finally {
    await rm(exportDirectory, { recursive: true, force: true });
  }
}

export function outdoorAdventureStagingProofIOSReceiptAttachmentFileV1(
  manifest,
  expected = {}
) {
  const files =
    outdoorAdventureStagingProofIOSReceiptAttachmentFilesV1(
      manifest,
      expected
    );
  if (files.length !== 1) {
    invalid("ios_runtime_receipt_duplicate");
  }
  return files[0];
}

export function outdoorAdventureStagingProofIOSReceiptAttachmentFilesV1(
  manifest,
  expected = {}
) {
  return Object.freeze(
    outdoorAdventureStagingProofIOSReceiptAttachmentRecordsV1(
      manifest,
      expected
    ).map((record) => record.exportedFileName)
  );
}

export function outdoorAdventureStagingProofIOSReceiptAttachmentRecordsV1(
  manifest,
  expected = {}
) {
  if (!Array.isArray(manifest) || manifest.length === 0) {
    invalid("xcresult_attachment_manifest_invalid");
  }
  const expectedTestIdentifier =
    expected.expectedTestIdentifier;
  const expectedDeviceId = expected.expectedDeviceId;
  if (
    expectedTestIdentifier !== undefined &&
    !boundedString(expectedTestIdentifier, 1, 1_024)
  ) {
    invalid("xcresult_expectation_invalid");
  }
  if (
    expectedDeviceId !== undefined &&
    !boundedString(expectedDeviceId, 1, 255)
  ) {
    invalid("xcresult_expectation_invalid");
  }
  const matches = [];
  for (const test of manifest) {
    if (
      !allowedObject(
        test,
        ["testIdentifier", "attachments"],
        ["testIdentifierURL"]
      ) ||
      !boundedString(test.testIdentifier, 1, 1_024) ||
      (
        test.testIdentifierURL !== undefined &&
        !boundedString(test.testIdentifierURL, 1, 4_096)
      ) ||
      !Array.isArray(test.attachments)
    ) {
      invalid("xcresult_attachment_manifest_invalid");
    }
    for (const attachment of test.attachments) {
      if (
        !allowedObject(
          attachment,
          [
            "exportedFileName",
            "suggestedHumanReadableName",
            "isAssociatedWithFailure",
            "configurationName",
            "deviceName",
            "deviceId"
          ],
          ["timestamp", "repetitionNumber", "arguments"]
        ) ||
        !boundedString(attachment.exportedFileName, 1, 255) ||
        !boundedString(
          attachment.suggestedHumanReadableName,
          1,
          255
        ) ||
        typeof attachment.isAssociatedWithFailure !== "boolean" ||
        !boundedString(attachment.configurationName, 1, 255) ||
        !boundedString(attachment.deviceName, 1, 255) ||
        !boundedString(attachment.deviceId, 1, 255)
      ) {
        invalid("xcresult_attachment_manifest_invalid");
      }
      if (
        isIOSReceiptAttachmentName(
          attachment.suggestedHumanReadableName
        )
      ) {
        matches.push(Object.freeze({
          exportedFileName: attachment.exportedFileName,
          testIdentifier: test.testIdentifier,
          testIdentifierURL:
            test.testIdentifierURL ?? null,
          deviceId: attachment.deviceId,
          isAssociatedWithFailure:
            attachment.isAssociatedWithFailure
        }));
      }
    }
  }
  if (matches.length < 1) {
    invalid(
      "ios_runtime_receipt_missing"
    );
  }
  if (
    matches.length > 18 ||
    new Set(matches.map((match) =>
      match.exportedFileName
    )).size !== matches.length
  ) {
    invalid("ios_runtime_receipt_duplicate");
  }
  for (const match of matches) {
    const fileName = match.exportedFileName;
    if (
      basename(fileName) !== fileName ||
      extname(fileName).toLowerCase() !== ".json" ||
      fileName.includes("\\")
    ) {
      invalid("xcresult_attachment_manifest_invalid");
    }
  }
  let selected = matches;
  if (expectedTestIdentifier !== undefined) {
    selected = selected.filter((match) =>
      match.testIdentifier === expectedTestIdentifier
    );
    if (selected.length === 0) {
      invalid("xcresult_test_identifier_mismatch");
    }
  }
  if (expectedDeviceId !== undefined) {
    selected = selected.filter((match) =>
      match.deviceId === expectedDeviceId
    );
    if (selected.length === 0) {
      invalid("xcresult_device_mismatch");
    }
  }
  if (
    selected.some((match) =>
      match.isAssociatedWithFailure === true
    )
  ) {
    invalid("xcresult_attachment_failure_associated");
  }
  if (
    (
      expectedTestIdentifier !== undefined ||
      expectedDeviceId !== undefined
    ) &&
    selected.length !== 1
  ) {
    invalid("ios_runtime_receipt_duplicate");
  }
  return Object.freeze([...selected]);
}

export function validateOutdoorAdventureStagingProofXCResultTestRunV1({
  testResults,
  expectedTestIdentifier,
  expectedDeviceId,
  expectedDestination
}) {
  if (
    !boundedString(expectedTestIdentifier, 1, 1_024) ||
    !boundedString(expectedDeviceId, 1, 255) ||
    !["physical", "simulator"].includes(expectedDestination) ||
    !exactObject(testResults, [
      "testPlanConfigurations",
      "devices",
      "testNodes"
    ]) ||
    !Array.isArray(testResults.testPlanConfigurations) ||
    testResults.testPlanConfigurations.length !== 1 ||
    !Array.isArray(testResults.devices) ||
    testResults.devices.length !== 1 ||
    !Array.isArray(testResults.testNodes) ||
    testResults.testNodes.length === 0
  ) {
    invalid("xcresult_test_report_invalid");
  }
  const configuration = testResults.testPlanConfigurations[0];
  if (
    !exactObject(configuration, [
      "configurationId",
      "configurationName"
    ]) ||
    !boundedString(configuration.configurationId, 1, 255) ||
    !boundedString(configuration.configurationName, 1, 255)
  ) {
    invalid("xcresult_test_report_invalid");
  }
  const device = testResults.devices[0];
  if (
    !allowedObject(
      device,
      [
        "deviceId",
        "deviceName",
        "architecture",
        "modelName",
        "osVersion",
        "platform"
      ],
      ["osBuildNumber"]
    ) ||
    !boundedString(device.deviceId, 1, 255) ||
    !boundedString(device.deviceName, 1, 255) ||
    !boundedString(device.architecture, 1, 255) ||
    !boundedString(device.modelName, 1, 255) ||
    !boundedString(device.osVersion, 1, 255) ||
    !boundedString(device.platform, 1, 255) ||
    (
      device.osBuildNumber !== undefined &&
      !boundedString(device.osBuildNumber, 1, 255)
    )
  ) {
    invalid("xcresult_test_report_invalid");
  }
  if (device.deviceId !== expectedDeviceId) {
    invalid("xcresult_device_mismatch");
  }
  const expectedPlatform =
    expectedDestination === "physical"
      ? "iOS"
      : "iOS Simulator";
  if (device.platform !== expectedPlatform) {
    invalid("xcresult_destination_mismatch");
  }

  const testCases = [];
  let nodeCount = 0;
  for (const node of testResults.testNodes) {
    validateXCResultTestNode(node, 0, testCases, () => {
      nodeCount += 1;
      if (nodeCount > MAXIMUM_TEST_RESULT_NODES) {
        invalid("xcresult_test_report_invalid");
      }
    });
  }
  if (testCases.length !== 1) {
    invalid(
      testCases.length === 0
        ? "xcresult_test_identifier_mismatch"
        : "xcresult_extra_test"
    );
  }
  const testCase = testCases[0];
  if (testCase.nodeIdentifier !== expectedTestIdentifier) {
    invalid("xcresult_test_identifier_mismatch");
  }
  const runNodes = [];
  collectXCResultTestRunNodes(testCase, runNodes);
  if (runNodes.length > 1) {
    invalid("xcresult_extra_test");
  }
  const results = [
    testCase.result,
    ...runNodes.map((node) => node.result)
  ].filter((value) => value !== undefined);
  if (
    results.length === 0 ||
    results.some((result) => result !== "Passed")
  ) {
    invalid("xcresult_test_not_passed");
  }
  return Object.freeze({
    testIdentifierURL: testCase.nodeIdentifierURL ?? null
  });
}

function validateXCResultExpectations({
  expectedLane,
  expectedTestIdentifier,
  expectedDeviceId,
  expectedDestination
}) {
  if (
    !["live", "controlled"].includes(expectedLane) ||
    !boundedString(expectedTestIdentifier, 1, 1_024) ||
    !boundedString(expectedDeviceId, 1, 255) ||
    !["physical", "simulator"].includes(expectedDestination) ||
    (
      expectedLane === "live" &&
      expectedDestination !== "physical"
    ) ||
    (
      expectedLane === "controlled" &&
      expectedDestination !== "simulator"
    )
  ) {
    invalid("xcresult_expectation_invalid");
  }
}

function validateXCResultTestNode(
  node,
  depth,
  testCases,
  recordNode
) {
  const nodeTypes = new Set([
    "Test Plan",
    "Unit test bundle",
    "UI test bundle",
    "Test Suite",
    "Test Case",
    "Device",
    "Test Plan Configuration",
    "Arguments",
    "Repetition",
    "Test Case Run",
    "Failure Message",
    "Source Code Reference",
    "Attachment",
    "Expression",
    "Test Value",
    "Runtime Warning"
  ]);
  const resultValues = new Set([
    "Passed",
    "Failed",
    "Skipped",
    "Expected Failure",
    "unknown"
  ]);
  if (
    depth > MAXIMUM_TEST_RESULT_DEPTH ||
    !allowedObject(
      node,
      ["nodeType", "name"],
      [
        "nodeIdentifier",
        "nodeIdentifierURL",
        "details",
        "duration",
        "durationInSeconds",
        "result",
        "tags",
        "children"
      ]
    ) ||
    !nodeTypes.has(node.nodeType) ||
    !boundedString(node.name, 1, 1_024) ||
    (
      node.nodeIdentifier !== undefined &&
      !boundedString(node.nodeIdentifier, 1, 1_024)
    ) ||
    (
      node.nodeIdentifierURL !== undefined &&
      !boundedString(node.nodeIdentifierURL, 1, 4_096)
    ) ||
    (
      node.details !== undefined &&
      !boundedString(node.details, 1, 4_096)
    ) ||
    (
      node.duration !== undefined &&
      !boundedString(node.duration, 1, 255)
    ) ||
    (
      node.durationInSeconds !== undefined &&
      (
        typeof node.durationInSeconds !== "number" ||
        !Number.isFinite(node.durationInSeconds) ||
        node.durationInSeconds < 0
      )
    ) ||
    (
      node.result !== undefined &&
      !resultValues.has(node.result)
    ) ||
    (
      node.tags !== undefined &&
      (
        !Array.isArray(node.tags) ||
        node.tags.length > 32 ||
        node.tags.some((tag) => !boundedString(tag, 1, 255))
      )
    ) ||
    (
      node.children !== undefined &&
      !Array.isArray(node.children)
    )
  ) {
    invalid("xcresult_test_report_invalid");
  }
  recordNode();
  if (node.nodeType === "Test Case") {
    if (!boundedString(node.nodeIdentifier, 1, 1_024)) {
      invalid("xcresult_test_report_invalid");
    }
    testCases.push(node);
  }
  for (const child of node.children ?? []) {
    validateXCResultTestNode(
      child,
      depth + 1,
      testCases,
      recordNode
    );
  }
}

function collectXCResultTestRunNodes(node, output) {
  for (const child of node.children ?? []) {
    if (child.nodeType === "Test Case Run") output.push(child);
    collectXCResultTestRunNodes(child, output);
  }
}

function isIOSReceiptAttachmentName(value) {
  return value ===
    OUTDOOR_ADVENTURE_STAGING_PROOF_IOS_RECEIPT_ATTACHMENT_V1 ||
    XCODE_EXPORTED_IOS_RECEIPT_ATTACHMENT_NAME_PATTERN.test(value);
}

export function validateOutdoorAdventureStagingProofIOSReceiptV1(
  input,
  expected = {}
) {
  if (
    !exactObject(input, TOP_LEVEL_FIELDS) ||
    input.schemaVersion !== 1 ||
    input.proofVersion !==
      OUTDOOR_ADVENTURE_STAGING_PROOF_VERSION_V1 ||
    input.manifestDigest !==
      OUTDOOR_ADVENTURE_STAGING_PROOF_MANIFEST_DIGEST_V1 ||
    !CASE_ID_PATTERN.test(input.caseId) ||
    !FIXTURE_ID_PATTERN.test(input.inputFixtureId) ||
    !input.inputFixtureId.startsWith(`${input.caseId}-`) ||
    !["live", "controlled"].includes(input.lane) ||
    !validDigest(input.nonceDigest) ||
    !validOptionalDigest(input.requestIdDigest) ||
    !validDigest(input.resultDigest) ||
    !PROOF_TERMINAL_STATE_SET.has(input.proofTerminalState) ||
    !PLANNER_TERMINAL_STATE_SET.has(input.plannerTerminalState) ||
    !ADAPTER_STATE_SET.has(input.adapterState) ||
    !RESEARCH_OUTCOME_SET.has(input.researchOutcome) ||
    !boundedCount(input.researchCoordinatorRequestCount, 2) ||
    !boundedCount(input.legacyRoutingRequestCount, 1) ||
    !boundedCount(input.plannerAttemptCount, 2) ||
    !validVocabularyArray(
      input.backendPlanningGapCodes,
      PLANNING_GAP_CODE_SET
    ) ||
    !validVocabularyArray(
      input.semanticObservationIds,
      SEMANTIC_OBSERVATION_ID_SET
    ) ||
    !validVocabularyArray(
      input.limitationCauseIds,
      LIMITATION_CAUSE_ID_SET
    ) ||
    !validOptionalEnum(input.selectionState, ENVELOPE_STATE_SET) ||
    !validOptionalEnum(input.sourceEnvelopeState, ENVELOPE_STATE_SET) ||
    !boundedCount(input.alternativeCount, 32) ||
    !validContractConversion(input.contractConversion) ||
    !validPresentation(input.presentation) ||
    !validCancellation(input.cancellation) ||
    !validRetry(input.retry) ||
    !validIOSStageTimings(input.iosStageTimings) ||
    !validDiagnosticChecks(input.diagnosticChecks) ||
    !validOptionalEnum(input.blockerCode, BLOCKER_CODE_SET)
  ) {
    invalid("ios_runtime_receipt_invalid");
  }
  if (
    expected.expectedCaseId !== undefined &&
    input.caseId !== expected.expectedCaseId
  ) {
    invalid("ios_runtime_receipt_case_mismatch");
  }
  if (
    expected.expectedInputFixtureId !== undefined &&
    input.inputFixtureId !== expected.expectedInputFixtureId
  ) {
    invalid("ios_runtime_receipt_fixture_mismatch");
  }
  if (
    expected.expectedLane !== undefined &&
    input.lane !== expected.expectedLane
  ) {
    invalid("ios_runtime_receipt_lane_mismatch");
  }
  if (
    expected.expectedNonceDigest !== undefined &&
    input.nonceDigest !== expected.expectedNonceDigest
  ) {
    invalid("ios_runtime_receipt_nonce_mismatch");
  }
  if (input.blockerCode !== null) {
    invalid("ios_runtime_receipt_blocked");
  }
  if (
    !validCaseSpecificReceiptState(input) ||
    outdoorAdventureStagingProofIOSResultDigestV1(input) !==
      input.resultDigest
  ) {
    invalid("ios_runtime_receipt_result_digest_mismatch");
  }
  return deepFreeze(cloneReceipt(input));
}

export function verifyExtractedOutdoorAdventureStagingProofIOSReceiptV1({
  receipt,
  capture,
  evaluationCase
}) {
  if (!EXTRACTED_RECEIPTS.has(receipt)) {
    invalid("ios_runtime_receipt_not_extracted");
  }
  validateReceiptCausality(receipt, capture, evaluationCase);
  const verified = Object.freeze({ receipt, capture });
  CAUSALLY_VERIFIED_RECEIPTS.add(verified);
  return verified;
}

export function isVerifiedOutdoorAdventureStagingProofIOSReceiptV1(
  input
) {
  return Boolean(
    input &&
    typeof input === "object" &&
    CAUSALLY_VERIFIED_RECEIPTS.has(input)
  );
}

export function validateOutdoorAdventureStagingProofIOSReceiptCausalityV1({
  receipt,
  capture,
  evaluationCase
}) {
  validateReceiptCausality(receipt, capture, evaluationCase);
  return true;
}

export function outdoorAdventureStagingProofIOSResultDigestV1(
  receipt
) {
  const components = [IOS_RESULT_DIGEST_SCHEMA];
  const append = (label, value) => {
    components.push(label, value);
  };
  const appendOptional = (label, value) => {
    append(label, value ?? "null");
  };
  const appendList = (label, values) => {
    components.push(label, String(values.length), ...values);
  };

  append("schemaVersion", String(receipt.schemaVersion));
  append("proofVersion", receipt.proofVersion);
  append("manifestDigest", receipt.manifestDigest);
  append("caseId", receipt.caseId);
  append("inputFixtureId", receipt.inputFixtureId);
  append("lane", receipt.lane);
  append("nonceDigest", receipt.nonceDigest);
  appendOptional("requestIdDigest", receipt.requestIdDigest);
  append("proofTerminalState", receipt.proofTerminalState);
  append("plannerTerminalState", receipt.plannerTerminalState);
  append("adapterState", receipt.adapterState);
  append("researchOutcome", receipt.researchOutcome);
  append(
    "researchCoordinatorRequestCount",
    String(receipt.researchCoordinatorRequestCount)
  );
  append(
    "legacyRoutingRequestCount",
    String(receipt.legacyRoutingRequestCount)
  );
  append(
    "plannerAttemptCount",
    String(receipt.plannerAttemptCount)
  );
  appendList(
    "backendPlanningGapCodes",
    receipt.backendPlanningGapCodes
  );
  appendList(
    "semanticObservationIds",
    receipt.semanticObservationIds
  );
  appendList(
    "limitationCauseIds",
    receipt.limitationCauseIds
  );
  appendOptional("selectionState", receipt.selectionState);
  appendOptional(
    "sourceEnvelopeState",
    receipt.sourceEnvelopeState
  );
  append("alternativeCount", String(receipt.alternativeCount));
  appendOptional(
    "contractConversion.coordinatorSelectionOrderDigest",
    receipt.contractConversion.coordinatorSelectionOrderDigest
  );
  appendOptional(
    "contractConversion.plannerSuggestionOrderDigest",
    receipt.contractConversion.plannerSuggestionOrderDigest
  );
  append(
    "contractConversion.acceptedCount",
    String(receipt.contractConversion.acceptedCount)
  );
  append(
    "contractConversion.rejectedCount",
    String(receipt.contractConversion.rejectedCount)
  );
  appendOptional(
    "presentation.inputOrderDigest",
    receipt.presentation.inputOrderDigest
  );
  appendOptional(
    "presentation.outputOrderDigest",
    receipt.presentation.outputOrderDigest
  );
  append("presentation.count", String(receipt.presentation.count));
  appendList("presentation.kinds", receipt.presentation.kinds);
  appendOptional(
    "cancellation.attemptDigest",
    receipt.cancellation.attemptDigest
  );
  appendOptional(
    "cancellation.postCancelTerminalState",
    receipt.cancellation.postCancelTerminalState
  );
  append(
    "cancellation.postCancelCoordinatorResultCount",
    String(
      receipt.cancellation.postCancelCoordinatorResultCount
    )
  );
  append(
    "cancellation.postCancelLegacyRoutingCount",
    String(receipt.cancellation.postCancelLegacyRoutingCount)
  );
  appendOptional(
    "retry.priorAttemptDigest",
    receipt.retry.priorAttemptDigest
  );
  appendOptional(
    "retry.currentAttemptDigest",
    receipt.retry.currentAttemptDigest
  );
  appendOptional(
    "retry.priorRequestIdDigest",
    receipt.retry.priorRequestIdDigest
  );
  appendOptional(
    "retry.currentRequestIdDigest",
    receipt.retry.currentRequestIdDigest
  );
  appendOptional(
    "retry.priorResultDigest",
    receipt.retry.priorResultDigest
  );
  appendOptional(
    "retry.priorTerminalState",
    receipt.retry.priorTerminalState
  );
  appendOptional(
    "retry.currentTerminalState",
    receipt.retry.currentTerminalState
  );
  appendOptional(
    "retry.currentResultDigest",
    receipt.retry.currentResultDigest
  );
  appendOptional(
    "retry.postResetPlannerTerminalState",
    receipt.retry.postResetPlannerTerminalState
  );
  append(
    "retry.postResetSuggestionCount",
    String(receipt.retry.postResetSuggestionCount)
  );
  appendOptional(
    "retry.postResetResearchContextDigest",
    receipt.retry.postResetResearchContextDigest
  );
  appendOptional(
    "retry.postResetClarificationDigest",
    receipt.retry.postResetClarificationDigest
  );
  appendOptional(
    "retry.postResetRecoveryDigest",
    receipt.retry.postResetRecoveryDigest
  );
  for (const stage of IOS_STAGE_NAMES) {
    appendList(
      `iosStageTimings.${stage}`,
      receipt.iosStageTimings[stage]
    );
  }
  for (const field of DIAGNOSTIC_CHECK_FIELDS) {
    append(
      `diagnosticChecks.${field}`,
      receipt.diagnosticChecks[field]
    );
  }
  appendOptional("blockerCode", receipt.blockerCode);
  return joinedDigest(components);
}

function validateReceiptCausality(receipt, capture, evaluationCase) {
  if (
    !receipt ||
    !capture ||
    !evaluationCase ||
    receipt.caseId !== evaluationCase.id ||
    receipt.inputFixtureId !== evaluationCase.input?.fixtureId ||
    capture.caseId !== evaluationCase.id ||
    !Array.isArray(capture.executions)
  ) {
    invalid("ios_runtime_receipt_causality_invalid");
  }
  if (
    !validDigest(receipt.resultDigest) ||
    outdoorAdventureStagingProofIOSResultDigestV1(receipt) !==
      receipt.resultDigest
  ) {
    invalid("ios_runtime_receipt_result_digest_mismatch");
  }
  const serverBound = SERVER_BOUND_CASE_IDS.has(evaluationCase.id);
  const expectedRequestCount =
    evaluationCase.id ===
      "case-18-retry-does-not-reuse-stale-state"
      ? 2
      : serverBound ? 1 : 0;
  if (
    capture.executions.length !== expectedRequestCount ||
    receipt.researchCoordinatorRequestCount !== expectedRequestCount
  ) {
    invalid("ios_runtime_receipt_request_count_mismatch");
  }
  if (!serverBound) {
    if (
      receipt.requestIdDigest !== null ||
      receipt.retry.priorRequestIdDigest !== null ||
      receipt.retry.currentRequestIdDigest !== null
    ) {
      invalid("ios_runtime_receipt_request_id_mismatch");
    }
    return;
  }
  if (
    receipt.requestIdDigest === null ||
    capture.executions.some((execution) =>
      execution.completed !== true ||
      execution.intentBound !== true ||
      !validDigest(execution.requestIdDigest)
    )
  ) {
    invalid("ios_runtime_receipt_causal_server_binding_missing");
  }
  const latest =
    capture.executions[capture.executions.length - 1].requestIdDigest;
  if (receipt.requestIdDigest !== latest) {
    invalid("ios_runtime_receipt_request_id_mismatch");
  }
  if (
    evaluationCase.id ===
      "case-18-retry-does-not-reuse-stale-state"
  ) {
    const prior = capture.executions[0].requestIdDigest;
    const priorExecution = capture.executions[0];
    const currentExecution = capture.executions[1];
    if (
      prior === latest ||
      receipt.retry.priorRequestIdDigest !== prior ||
      receipt.retry.currentRequestIdDigest !== latest ||
      receipt.retry.priorAttemptDigest === null ||
      receipt.retry.currentAttemptDigest === null ||
      receipt.retry.priorAttemptDigest ===
        receipt.retry.currentAttemptDigest ||
      receipt.retry.priorResultDigest === null ||
      receipt.retry.currentResultDigest === null ||
      receipt.retry.priorResultDigest ===
        receipt.retry.currentResultDigest ||
      receipt.retry.priorTerminalState !== "no_routes" ||
      receipt.retry.currentTerminalState !== "suggestions_ready" ||
      receipt.retry.postResetPlannerTerminalState !== "generating" ||
      receipt.retry.postResetSuggestionCount !== 0 ||
      receipt.retry.postResetResearchContextDigest !== null ||
      receipt.retry.postResetClarificationDigest !== null ||
      receipt.retry.postResetRecoveryDigest !== null ||
      receipt.legacyRoutingRequestCount !== 1 ||
      priorExecution.statusCode !== 503 ||
      priorExecution.deliveredOutcome !==
        "controlled_failure_after_production_execution" ||
      priorExecution.payload?.error?.code !== "internal_failure" ||
      currentExecution.statusCode !== 200 ||
      currentExecution.deliveredOutcome !==
        "production_endpoint_result" ||
      !["routed", "partial"].includes(
        currentExecution.payload?.state
      )
    ) {
      invalid("ios_runtime_receipt_retry_causality_invalid");
    }
  } else if (
    evaluationCase.id ===
      "case-16-malformed-backend-response-rejected-by-ios"
  ) {
    const execution = capture.executions[0];
    if (
      execution.statusCode !== 200 ||
      execution.deliveredOutcome !==
        "controlled_malformed_endpoint_result" ||
      !sameValue(execution.payload, { schemaVersion: 1 })
    ) {
      invalid("ios_runtime_receipt_causality_invalid");
    }
  } else if (
    receipt.retry.priorRequestIdDigest !== null ||
    receipt.retry.currentRequestIdDigest !== null
  ) {
    invalid("ios_runtime_receipt_retry_causality_invalid");
  }
}

function validContractConversion(input) {
  return exactObject(input, CONTRACT_CONVERSION_FIELDS) &&
    validOptionalDigest(input.coordinatorSelectionOrderDigest) &&
    validOptionalDigest(input.plannerSuggestionOrderDigest) &&
    boundedCount(input.acceptedCount, 32) &&
    boundedCount(input.rejectedCount, 32) &&
    (
      input.acceptedCount === 0 ||
      (
        input.coordinatorSelectionOrderDigest !== null &&
        input.plannerSuggestionOrderDigest !== null
      )
    );
}

function validPresentation(input) {
  return exactObject(input, PRESENTATION_FIELDS) &&
    validOptionalDigest(input.inputOrderDigest) &&
    validOptionalDigest(input.outputOrderDigest) &&
    boundedCount(input.count, 32) &&
    Array.isArray(input.kinds) &&
    input.kinds.length === input.count &&
    input.kinds.every((kind) => PRESENTATION_KIND_SET.has(kind)) &&
    (
      (
        input.count === 0 &&
        input.inputOrderDigest === null &&
        input.outputOrderDigest === null
      ) ||
      (
        input.count === 1 &&
        sameValue(input.kinds, ["clarification"]) &&
        input.inputOrderDigest === null &&
        input.outputOrderDigest !== null
      ) ||
      (
        input.inputOrderDigest !== null &&
        input.outputOrderDigest !== null
      )
    );
}

function validCancellation(input) {
  return exactObject(input, CANCELLATION_FIELDS) &&
    validOptionalDigest(input.attemptDigest) &&
    (
      input.postCancelTerminalState === null ||
      PLANNER_TERMINAL_STATE_SET.has(input.postCancelTerminalState)
    ) &&
    boundedCount(input.postCancelCoordinatorResultCount, 2) &&
    boundedCount(input.postCancelLegacyRoutingCount, 1);
}

function validRetry(input) {
  return exactObject(input, RETRY_FIELDS) &&
    validOptionalDigest(input.priorAttemptDigest) &&
    validOptionalDigest(input.currentAttemptDigest) &&
    validOptionalDigest(input.priorRequestIdDigest) &&
    validOptionalDigest(input.currentRequestIdDigest) &&
    validOptionalDigest(input.priorResultDigest) &&
    (
      input.priorTerminalState === null ||
      PLANNER_TERMINAL_STATE_SET.has(input.priorTerminalState)
    ) &&
    (
      input.currentTerminalState === null ||
      PLANNER_TERMINAL_STATE_SET.has(input.currentTerminalState)
    ) &&
    validOptionalDigest(input.currentResultDigest) &&
    (
      input.postResetPlannerTerminalState === null ||
      PLANNER_TERMINAL_STATE_SET.has(
        input.postResetPlannerTerminalState
      )
    ) &&
    boundedCount(input.postResetSuggestionCount, 32) &&
    validOptionalDigest(input.postResetResearchContextDigest) &&
    validOptionalDigest(input.postResetClarificationDigest) &&
    validOptionalDigest(input.postResetRecoveryDigest);
}

function validIOSStageTimings(input) {
  return exactObject(input, IOS_STAGE_NAMES) &&
    IOS_STAGE_NAMES.every((stage) =>
      Array.isArray(input[stage]) &&
      input[stage].length <= 8 &&
      input[stage].every((bucket) => TIMING_BUCKET_SET.has(bucket))
    );
}

function validDiagnosticChecks(input) {
  return exactObject(input, DIAGNOSTIC_CHECK_FIELDS) &&
    DIAGNOSTIC_CHECK_FIELDS.every((field) =>
      CHECK_STATE_SET.has(input[field])
    );
}

function validCaseSpecificReceiptState(input) {
  if (input.iosStageTimings.end_to_end.length !== 1) return false;
  const expectedResponseConversionCount =
    RESPONSE_CONVERSION_CASE_IDS.has(input.caseId) ? 1 : 0;
  if (
    input.iosStageTimings.response_conversion.length !==
      expectedResponseConversionCount
  ) {
    return false;
  }

  const retryCase =
    input.caseId ===
      "case-18-retry-does-not-reuse-stale-state";
  if (retryCase) {
    if (
      !validDigest(input.retry.priorResultDigest) ||
      input.retry.priorResultDigest ===
        input.retry.currentResultDigest ||
      input.retry.postResetPlannerTerminalState !== "generating" ||
      input.retry.postResetSuggestionCount !== 0 ||
      input.retry.postResetResearchContextDigest !== null ||
      input.retry.postResetClarificationDigest !== null ||
      input.retry.postResetRecoveryDigest !== null
    ) {
      return false;
    }
  } else if (
    input.retry.priorAttemptDigest !== null ||
    input.retry.currentAttemptDigest !== null ||
    input.retry.priorRequestIdDigest !== null ||
    input.retry.currentRequestIdDigest !== null ||
    input.retry.priorResultDigest !== null ||
    input.retry.priorTerminalState !== null ||
    input.retry.currentTerminalState !== null ||
    input.retry.currentResultDigest !== null ||
    input.retry.postResetPlannerTerminalState !== null ||
    input.retry.postResetSuggestionCount !== 0 ||
    input.retry.postResetResearchContextDigest !== null ||
    input.retry.postResetClarificationDigest !== null ||
    input.retry.postResetRecoveryDigest !== null
  ) {
    return false;
  }

  const cancellationCase =
    input.caseId === "case-13-cancel-during-postgis-research";
  if (cancellationCase) {
    if (
      input.cancellation.attemptDigest === null ||
      input.cancellation.postCancelTerminalState !== "cancelled" ||
      input.cancellation.postCancelCoordinatorResultCount !== 0 ||
      input.cancellation.postCancelLegacyRoutingCount !== 0
    ) {
      return false;
    }
  } else if (
    input.cancellation.attemptDigest !== null ||
    input.cancellation.postCancelTerminalState !== null ||
    input.cancellation.postCancelCoordinatorResultCount !== 0 ||
    input.cancellation.postCancelLegacyRoutingCount !== 0
  ) {
    return false;
  }

  const contractApplicable =
    input.contractConversion
      .coordinatorSelectionOrderDigest !== null;
  const presentationApplicable = input.presentation.count > 0;
  const qualityApplicable =
    input.iosStageTimings.route_quality.length > 0;
  const expectedChecks = {
    productionClientPath:
      input.researchCoordinatorRequestCount > 0
        ? "passed"
        : "not_applicable",
    contractConversion:
      contractApplicable ? "passed" : "not_applicable",
    qualityRanking:
      qualityApplicable ? "passed" : "not_applicable",
    presentation:
      presentationApplicable ? "passed" : "not_applicable",
    cancellation:
      cancellationCase ? "passed" : "not_applicable",
    retryFreshness:
      retryCase ? "passed" : "not_applicable"
  };
  if (
    DIAGNOSTIC_CHECK_FIELDS.some((field) =>
      input.diagnosticChecks[field] !== expectedChecks[field]
    )
  ) {
    return false;
  }
  if (
    contractApplicable &&
    (
      input.contractConversion.plannerSuggestionOrderDigest !==
        input.contractConversion.coordinatorSelectionOrderDigest ||
      input.contractConversion.acceptedCount !==
        input.presentation.count
    )
  ) {
    return false;
  }
  if (
    presentationApplicable &&
    input.presentation.kinds[0] !== "clarification" &&
    input.presentation.inputOrderDigest !==
      input.contractConversion.plannerSuggestionOrderDigest
  ) {
    return false;
  }
  return true;
}

async function validatedXCResultPath(input) {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.length > 4_096 ||
    !input.endsWith(".xcresult")
  ) {
    invalid("xcresult_path_invalid");
  }
  let sourceInfo;
  let resolved;
  try {
    sourceInfo = await lstat(input);
    resolved = await realpath(input);
  } catch {
    invalid("xcresult_path_invalid");
  }
  if (
    !sourceInfo.isDirectory() ||
    !resolved.endsWith(".xcresult")
  ) {
    invalid("xcresult_path_invalid");
  }
  return resolved;
}

async function validatedExportedAttachmentPath(directory, fileName) {
  const exportRoot = await realpath(directory);
  const candidate = join(exportRoot, fileName);
  let resolved;
  let info;
  try {
    resolved = await realpath(candidate);
    info = await stat(resolved);
  } catch {
    invalid("ios_runtime_receipt_missing");
  }
  if (dirname(resolved) !== exportRoot || !info.isFile()) {
    invalid("xcresult_attachment_manifest_invalid");
  }
  return resolved;
}

async function readBoundedUTF8File(path, maximumBytes, errorCode) {
  let info;
  try {
    info = await stat(path);
  } catch {
    invalid(errorCode);
  }
  if (
    !info.isFile() ||
    info.size < 2 ||
    info.size > maximumBytes
  ) {
    invalid(errorCode);
  }
  let contents;
  try {
    contents = await readFile(path, "utf8");
  } catch {
    invalid(errorCode);
  }
  if (Buffer.byteLength(contents, "utf8") !== info.size) {
    invalid(errorCode);
  }
  return contents;
}

function assertNoDuplicateJSONKeys(source) {
  let index = 0;
  function whitespace() {
    while (/[\t\n\r ]/.test(source[index] ?? "")) index += 1;
  }
  function string() {
    const start = index;
    if (source[index] !== "\"") invalid("ios_runtime_receipt_invalid");
    index += 1;
    while (index < source.length) {
      if (source[index] === "\"") {
        index += 1;
        try {
          return JSON.parse(source.slice(start, index));
        } catch {
          invalid("ios_runtime_receipt_invalid");
        }
      }
      if (source[index] === "\\") {
        index += 1;
        if (source[index] === "u") index += 4;
      }
      index += 1;
    }
    invalid("ios_runtime_receipt_invalid");
  }
  function value() {
    whitespace();
    if (source[index] === "{") {
      index += 1;
      whitespace();
      const keys = new Set();
      if (source[index] === "}") {
        index += 1;
        return;
      }
      while (index < source.length) {
        whitespace();
        const key = string();
        if (keys.has(key)) invalid("ios_runtime_receipt_duplicate_field");
        keys.add(key);
        whitespace();
        if (source[index] !== ":") invalid("ios_runtime_receipt_invalid");
        index += 1;
        value();
        whitespace();
        if (source[index] === "}") {
          index += 1;
          return;
        }
        if (source[index] !== ",") invalid("ios_runtime_receipt_invalid");
        index += 1;
      }
      invalid("ios_runtime_receipt_invalid");
    }
    if (source[index] === "[") {
      index += 1;
      whitespace();
      if (source[index] === "]") {
        index += 1;
        return;
      }
      while (index < source.length) {
        value();
        whitespace();
        if (source[index] === "]") {
          index += 1;
          return;
        }
        if (source[index] !== ",") invalid("ios_runtime_receipt_invalid");
        index += 1;
      }
      invalid("ios_runtime_receipt_invalid");
    }
    if (source[index] === "\"") {
      string();
      return;
    }
    const match = source.slice(index).match(
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/
    );
    if (!match) invalid("ios_runtime_receipt_invalid");
    index += match[0].length;
  }
  value();
  whitespace();
  if (index !== source.length) invalid("ios_runtime_receipt_invalid");
}

function cloneReceipt(input) {
  return {
    ...input,
    backendPlanningGapCodes: [...input.backendPlanningGapCodes],
    semanticObservationIds: [...input.semanticObservationIds],
    limitationCauseIds: [...input.limitationCauseIds],
    contractConversion: { ...input.contractConversion },
    presentation: {
      ...input.presentation,
      kinds: [...input.presentation.kinds]
    },
    cancellation: { ...input.cancellation },
    retry: { ...input.retry },
    iosStageTimings: Object.fromEntries(
      IOS_STAGE_NAMES.map((stage) => [
        stage,
        [...input.iosStageTimings[stage]]
      ])
    ),
    diagnosticChecks: { ...input.diagnosticChecks }
  };
}

function exactObject(input, fields) {
  return Boolean(
    input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    Object.keys(input).length === fields.length &&
    fields.every((field) => Object.hasOwn(input, field)) &&
    Object.keys(input).every((key) => fields.includes(key))
  );
}

function allowedObject(input, requiredFields, optionalFields) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return false;
  }
  const allowed = new Set([...requiredFields, ...optionalFields]);
  return requiredFields.every((field) => Object.hasOwn(input, field)) &&
    Object.keys(input).every((field) => allowed.has(field));
}

function validVocabularyArray(input, vocabulary) {
  return Array.isArray(input) &&
    input.length <= vocabulary.size &&
    input.every((value) => vocabulary.has(value)) &&
    new Set(input).size === input.length &&
    sameValue(input, [...input].sort());
}

function validOptionalEnum(input, vocabulary) {
  return input === null || vocabulary.has(input);
}

function validOptionalDigest(input) {
  return input === null || validDigest(input);
}

function validDigest(input) {
  return typeof input === "string" && SHA256_PATTERN.test(input);
}

function boundedCount(input, maximum) {
  return Number.isSafeInteger(input) &&
    input >= 0 &&
    input <= maximum;
}

function boundedString(input, minimum, maximum) {
  return typeof input === "string" &&
    input.length >= minimum &&
    input.length <= maximum;
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function joinedDigest(values) {
  return sha256(values.map((value, index) =>
    `${index}:${Buffer.byteLength(value, "utf8")}:${value}`
  ).join("|"));
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function invalid(code) {
  throw new OutdoorAdventureStagingProofIOSReceiptError(code);
}
