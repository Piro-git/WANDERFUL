import { createHash } from "node:crypto";

export const V4_SCHEMA_VERSION = 1;
export const V4_PROOF_VERSION =
  "outdoor-adventure-targeted-live-route-quality-proof-v4";
export const V4_PROOF_CLASSIFICATION =
  "targeted_server_side_live_route_quality_proof";
export const V4_BASELINE_COMMIT =
  "cc4f478580ed883223e7eaa6140e686b2e5f5f6d";
export const V4_AUTHORIZATION_REFERENCE =
  "USER_AUTHORIZED_V4_2026-08-05_15_CALLS";
export const V4_PROVIDER_CALL_LIMIT = 15;
export const V4_MAXIMUM_CONCURRENCY = 1;
export const V4_MINIMUM_CALL_START_SPACING_MILLISECONDS = 2_000;
export const V4_MAXIMUM_RETRY_AFTER_MILLISECONDS = 15_000;
export const V4_MANIFEST_DIGEST =
  "05253a4a6b13e57391eab9a69be9084cdf3f6f32c85fac5f50eebf099f2eb704";
export const V4_ATTEMPT_ONE_PUBLISHED_RECEIPT_DIGEST =
  "92849a164b1d1c637964a3bc8fcf3e31579d2f75d55af6dd6d102ff38a1f08cf";

export const V4_DECISION_STATES = Object.freeze([
  "not_run", "blocked", "failed", "passed"
]);
export const V4_TECHNICAL_OUTCOMES = Object.freeze([
  "pass", "fail", "not_run"
]);
export const V4_PRODUCT_OUTCOMES = Object.freeze([
  "pass", "partial", "fail", "not_applicable"
]);

export const V4_CASE_BINDINGS = deepFreeze([
  {
    caseId: "case-15-partial-provider-failure-survivor",
    goldenCaseId: "harz-v1-route-coherence-010",
    fixtureDigest:
      "c2e1f70233c8163392b8dedfa77ea5454cc12d5e42700fd6c5110e04058232af",
    goldenCaseDigest:
      "21529faec10cd3d8e6a38a83d03688b8fe4a4cee899df843b8bcc60a4c091eb6",
    expectedPlanningState: "partial",
    expectedTechnicalPipelineOutcome: "pass",
    expectedProductQualityOutcome: "pass",
    distanceRangeKm: { min: 10.8, max: 13.2 },
    durationRangeMinutes: null,
    requiredHighlightCount: 0,
    requiresVerifiedEasyDifficulty: false,
    maximumElevationGainMeters: null,
    controlledSurvivor: true
  },
  {
    caseId: "case-04-harz-brocken-must-have-landmark",
    goldenCaseId: "harz-v1-peak-focus-005",
    fixtureDigest:
      "177550bc626118d38d808559834f5f10f9e5aaec067e844f56c19e184c197cbe",
    goldenCaseDigest:
      "c472f3b539b38627221aa7fd4784b0397fbf6c288fc0814b6c529cd4969bc1ca",
    expectedPlanningState: "routed",
    expectedTechnicalPipelineOutcome: "pass",
    expectedProductQualityOutcome: "pass",
    distanceRangeKm: { min: 13.5, max: 16.5 },
    durationRangeMinutes: null,
    requiredHighlightCount: 1,
    requiresVerifiedEasyDifficulty: false,
    maximumElevationGainMeters: null,
    controlledSurvivor: false
  },
  {
    caseId: "case-07-innsbruck-viewpoint-loop",
    goldenCaseId: "innsbruck-alps-v1-viewpoint-focus-004",
    fixtureDigest:
      "3979608b6a17874086d59656faf125e29421c2cd36f65cb48d5655beaab3bdf6",
    goldenCaseDigest:
      "f6ef4fd6144313c82b99b15b1caf2c402f8e5bfc6425e137d5010fc24dc99e5b",
    expectedPlanningState: "partial",
    expectedTechnicalPipelineOutcome: "fail",
    expectedProductQualityOutcome: "partial",
    distanceRangeKm: { min: 10.8, max: 13.2 },
    durationRangeMinutes: null,
    requiredHighlightCount: 2,
    requiresVerifiedEasyDifficulty: false,
    maximumElevationGainMeters: null,
    controlledSurvivor: false
  },
  {
    caseId: "case-08-innsbruck-easy-conservative-loop",
    goldenCaseId: "innsbruck-alps-v1-easy-loop-001",
    fixtureDigest:
      "bc0989ec9040b8a4ab1d854eb4e3a912059300daac026302c372114d05dc543f",
    goldenCaseDigest:
      "f270400dc78fc4421b30b7a829d2f7fe2baadc5d05f0a89245b8abba65bdbdf9",
    expectedPlanningState: "routed",
    expectedTechnicalPipelineOutcome: "pass",
    expectedProductQualityOutcome: "pass",
    distanceRangeKm: { min: 2.4, max: 3.2 },
    durationRangeMinutes: { min: 45, max: 75 },
    requiredHighlightCount: 1,
    requiresVerifiedEasyDifficulty: true,
    maximumElevationGainMeters: 180,
    controlledSurvivor: false
  }
]);

export const V4_PROTECTED_RECEIPTS = deepFreeze([
  [
    "docs/release/OUTDOOR_ADVENTURE_SERVER_SIDE_LIVE_PIPELINE_PROOF_V1.md",
    "04b749fb41c44e77121ff25678a60d68b0d763636c4db054935957f92e03ae1d"
  ],
  [
    "docs/release/OUTDOOR_ADVENTURE_SERVER_SIDE_LIVE_PIPELINE_PROOF_V1.summary.json",
    "6c57f5efc9bbec02ad0f49f7ab70bae43f9f61f4467afc8654f6c827ca7f69f3"
  ],
  [
    "docs/release/OUTDOOR_ADVENTURE_END_TO_END_STAGING_PROOF_V1.md",
    "0fdbdee5e931bdc307f5203e58b6e653269642da0db8b5f3ea397e8773303c0c"
  ],
  [
    "docs/release/OUTDOOR_ADVENTURE_END_TO_END_STAGING_PROOF_V1.summary.json",
    "e7614b1267390879c9037f028b40f9739eb0a61b4925fa58845fa5dd40c84e2f"
  ],
  [
    "docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V2.md",
    "69c9cd93c7ea6361c625a3b8daf506a39d4e16e7363aa045a06e6516c0b1c94a"
  ],
  [
    "docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V2.summary.json",
    "18946e87ea615b53c271179d648eae24b1cb427791cb3145b35fe81dfaf2b5f9"
  ],
  [
    "docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V3.md",
    "597b4d0aa6890cf74a3b63b5dfb10e6d52220cace1d02de315aec122b8b2f522"
  ],
  [
    "docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V3.summary.json",
    "6a247c8aeb21f1079cc625eba651ce32b281ab6b1c49690fbfdc183288c211bf"
  ]
].map(([repoRelativePath, sha256]) => ({ repoRelativePath, sha256 })));

export const V4_FLAG_NAMES = Object.freeze([
  "OUTDOOR_EVIDENCE_ENABLED",
  "RESEARCH_GUIDED_PLANNING_ENABLED",
  "ROUTABLE_HIGHLIGHT_ACCESS_ENABLED",
  "OUTDOOR_EVIDENCE_PROVIDER_ENABLED",
  "OUTDOOR_RESEARCH_PLANNING_ENABLED",
  "OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED",
  "ROUTE_PROVIDER_ENABLED",
  "INTENT_PROVIDER_ENABLED",
  "OUTDOOR_RESEARCH_PLANNING_ALLOW_INSECURE_LOCAL",
  "ROUTE_ALLOW_INSECURE_LOCAL_ROUTING",
  "INTENT_ALLOW_INSECURE_LOCAL_PARSING",
  "APP_ATTEST_ALLOW_IN_MEMORY",
  "INTENT_ALLOW_DETERMINISTIC_MOCK"
]);

const EXECUTION_TRUE_FLAGS = new Set([
  "OUTDOOR_RESEARCH_PLANNING_ENABLED",
  "OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED",
  "ROUTE_PROVIDER_ENABLED"
]);
const HEX_64 = /^[a-f0-9]{64}$/;

export class V4ProofContractError extends Error {
  constructor(code, options = {}) {
    super(code, options);
    this.name = "V4ProofContractError";
    this.code = code;
  }
}

export function stableSerializeV4(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerializeV4).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableSerializeV4(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256V4(value) {
  return createHash("sha256").update(
    typeof value === "string" ? value : stableSerializeV4(value)
  ).digest("hex");
}

export function buildV4ManifestRecord(cases, goldenCases) {
  if (!Array.isArray(cases) || !Array.isArray(goldenCases)) invalidManifest();
  const bindings = V4_CASE_BINDINGS.map((expected, index) => {
    const evaluationCase = cases[index];
    const goldenCase = goldenCases.find((item) =>
      item?.caseId === expected.goldenCaseId
    );
    return {
      caseId: evaluationCase?.id,
      goldenCaseId: goldenCase?.caseId,
      fixtureDigest: sha256V4(evaluationCase?.input),
      goldenCaseDigest: sha256V4(goldenCase)
    };
  });
  const digest = sha256V4({
    authorizationReference: V4_AUTHORIZATION_REFERENCE,
    bindings
  });
  const result = { digest, bindings };
  validateV4ManifestRecord(result);
  return deepFreeze(result);
}

export function validateV4ManifestRecord(value) {
  if (
    !plainObject(value) ||
    value.digest !== V4_MANIFEST_DIGEST ||
    !Array.isArray(value.bindings) ||
    value.bindings.length !== V4_CASE_BINDINGS.length
  ) invalidManifest();
  value.bindings.forEach((binding, index) => {
    const expected = V4_CASE_BINDINGS[index];
    if (
      !plainObject(binding) ||
      binding.caseId !== expected.caseId ||
      binding.goldenCaseId !== expected.goldenCaseId ||
      binding.fixtureDigest !== expected.fixtureDigest ||
      binding.goldenCaseDigest !== expected.goldenCaseDigest
    ) invalidManifest();
  });
  const digest = sha256V4({
    authorizationReference: V4_AUTHORIZATION_REFERENCE,
    bindings: value.bindings
  });
  if (digest !== value.digest) invalidManifest();
  return true;
}

export function validateV4Summary(summary) {
  if (!plainObject(summary)) invalidSummary();
  if (
    summary.schemaVersion !== V4_SCHEMA_VERSION ||
    summary.proofVersion !== V4_PROOF_VERSION ||
    summary.proofClassification !== V4_PROOF_CLASSIFICATION ||
    summary.baselineCommit !== V4_BASELINE_COMMIT ||
    summary.candidateCommit !== V4_BASELINE_COMMIT ||
    summary.authorizationReference !== V4_AUTHORIZATION_REFERENCE ||
    !["passed", "failed", "blocked"].includes(summary.status) ||
    summary.closedBetaEligible !== false ||
    summary.deployed !== false ||
    summary.released !== false ||
    summary.committed !== false ||
    summary.pushed !== false
  ) invalidSummary();
  validateV4ManifestRecord(summary.manifest);
  validateDecisions(summary.decisions, summary);
  validateCases(summary.cases);
  validateProviderAccounting(summary.providerAccounting);
  validateFeatureFlags(summary.featureFlags, summary.providerAccounting);
  validateCleanup(summary.cleanup, summary.decisions);
  validateProtectedReceipts(summary.protectedHistoricalReceipts);
  validatePrivacy(summary.privacy);
  if (
    summary.manualExpertReview?.completed !== false ||
    summary.manualExpertReview?.classification !== "not_completed"
  ) invalidSummary();
  assertNoSensitiveDurableValueV4(summary);
  return true;
}

export function validatePublishedV4AttemptOneReceipt(receipt) {
  validateV4Summary(receipt);
  if (sha256V4(receipt) !== V4_ATTEMPT_ONE_PUBLISHED_RECEIPT_DIGEST) {
    throw new V4ProofContractError("published_receipt_mismatch");
  }
  return true;
}

export function validateV4CaseRecords(cases) {
  validateCases(cases);
  return true;
}

export function validateProviderAccounting(value) {
  if (!plainObject(value)) invalidAccounting();
  const counts = [
    value.successful, value.failed, value.timedOut, value.cancelled
  ];
  if (
    value.hardLimit !== V4_PROVIDER_CALL_LIMIT ||
    value.maximumConcurrencyAllowed !== V4_MAXIMUM_CONCURRENCY ||
    value.minimumCallStartSpacingMilliseconds !==
      V4_MINIMUM_CALL_START_SPACING_MILLISECONDS ||
    !integer(value.attempted, 0, V4_PROVIDER_CALL_LIMIT) ||
    counts.some((item) => !integer(item, 0, V4_PROVIDER_CALL_LIMIT)) ||
    counts.reduce((sum, item) => sum + item, 0) !== value.attempted ||
    !integer(value.controlledPostSuccessFailures, 0, V4_PROVIDER_CALL_LIMIT) ||
    value.controlledPostSuccessFailures > value.successful ||
    value.unused !== V4_PROVIDER_CALL_LIMIT - value.attempted ||
    value.reconciled !== true ||
    !integer(value.maximumConcurrencyObserved, 0, V4_MAXIMUM_CONCURRENCY) ||
    value.retriesAttempted !== 0 ||
    value.probesAfterCircuitOpen !== 0 ||
    value.attempt16Prevented !== true
  ) invalidAccounting();
  if (
    value.attempted > 1 &&
    (!Number.isFinite(value.minimumObservedStartSpacingMilliseconds) ||
      value.minimumObservedStartSpacingMilliseconds <
        V4_MINIMUM_CALL_START_SPACING_MILLISECONDS)
  ) invalidAccounting();
  if (
    value.attempted <= 1 &&
    value.minimumObservedStartSpacingMilliseconds !== null
  ) invalidAccounting();
  if (
    value.circuitOpened === true && value.circuitStopHonored !== true ||
    value.invalidRetryAfterObserved === true &&
      value.invalidRetryAfterStoppedCase !== true
  ) invalidAccounting();
  return true;
}

export function validateProtectedReceipts(receipts) {
  if (!Array.isArray(receipts) ||
      receipts.length !== V4_PROTECTED_RECEIPTS.length) {
    throw new V4ProofContractError("protected_receipt_mismatch");
  }
  receipts.forEach((receipt, index) => {
    const expected = V4_PROTECTED_RECEIPTS[index];
    if (
      !plainObject(receipt) ||
      receipt.repoRelativePath !== expected.repoRelativePath ||
      receipt.beforeSha256 !== expected.sha256 ||
      receipt.afterSha256 !== expected.sha256 ||
      receipt.unchanged !== true ||
      !HEX_64.test(receipt.beforeSha256) ||
      !HEX_64.test(receipt.afterSha256)
    ) {
      throw new V4ProofContractError("protected_receipt_mismatch");
    }
  });
  return true;
}

export function assertNoSensitiveDurableValueV4(value) {
  const forbiddenKeys = new Set([
    "geometry", "routegeometry", "coordinate", "coordinates", "latitude",
    "longitude", "providerurl", "providerbaseurl", "requesturl",
    "databaseurl", "rawresponse", "providerresponse", "rawprompt", "prompt",
    "headers", "rawheaders", "apikey", "password", "authorizationheader",
    "credential", "credentials", "secret", "token", "appattestmaterial",
    "appattestassertion", "temporarypath", "temporarypaths"
  ]);
  const visit = (item) => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!item || typeof item !== "object") {
      if (typeof item === "string" && (
        /postgres(?:ql)?:\/\//i.test(item) ||
        /https?:\/\//i.test(item) ||
        /[?&]key=/i.test(item) ||
        /(?:^|\s)\/(?:private\/)?tmp\//i.test(item) ||
        /\/(?:private\/)?var\/folders\//i.test(item) ||
        /-----BEGIN [A-Z ]+PRIVATE KEY-----/.test(item)
      )) {
        throw new V4ProofContractError("sensitive_durable_output");
      }
      return;
    }
    for (const [key, child] of Object.entries(item)) {
      const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
      if (forbiddenKeys.has(normalized)) {
        throw new V4ProofContractError("sensitive_durable_output");
      }
      visit(child);
    }
  };
  visit(value);
  return true;
}

function validateDecisions(value, summary) {
  const names = [
    "databasePreflight", "physicalAppAttest", "providerProof",
    "routeQuality", "cleanupAndContainment"
  ];
  if (!plainObject(value) || Object.keys(value).length !== names.length ||
      names.some((name) => !V4_DECISION_STATES.includes(value[name]))) {
    invalidSummary();
  }
  if (
    summary.status === "passed" &&
    [
      value.databasePreflight, value.providerProof,
      value.routeQuality, value.cleanupAndContainment
    ].some((state) => state !== "passed")
  ) invalidSummary();
  if (value.physicalAppAttest === "passed" &&
      summary.physicalAppAttestReceiptPresent !== true) invalidSummary();
  if (value.physicalAppAttest !== "passed" &&
      summary.closedBetaEligible !== false) invalidSummary();
}

function validateCases(cases) {
  if (!Array.isArray(cases) || cases.length !== V4_CASE_BINDINGS.length) {
    invalidSummary();
  }
  if (cases.filter((item) => item?.executed === true).length === 0) {
    throw new V4ProofContractError("zero_executed_cases");
  }
  cases.forEach((record, index) => validateCase(record, V4_CASE_BINDINGS[index]));
}

function validateCase(record, binding) {
  if (
    !plainObject(record) ||
    record.caseId !== binding.caseId ||
    record.goldenCaseId !== binding.goldenCaseId ||
    record.fixtureDigest !== binding.fixtureDigest ||
    record.goldenCaseDigest !== binding.goldenCaseDigest ||
    record.executed !== true ||
    record.skipped !== false ||
    typeof record.providerExecuted !== "boolean" ||
    !V4_TECHNICAL_OUTCOMES.includes(record.technicalPipelineOutcome) ||
    !V4_PRODUCT_OUTCOMES.includes(record.productQualityOutcome) ||
    !["pass", "fail"].includes(record.caseEvaluationOutcome) ||
    record.expectedPlanningState !== binding.expectedPlanningState ||
    record.expectedTechnicalPipelineOutcome !==
      binding.expectedTechnicalPipelineOutcome ||
    record.expectedProductQualityOutcome !==
      binding.expectedProductQualityOutcome ||
    !Array.isArray(record.routes) ||
    !integer(record.providerAttemptCount, 0, 3) ||
    record.manualExpertReview !== "not_completed"
  ) invalidSummary();
  if (!record.providerExecuted && record.providerAttemptCount !== 0) {
    invalidSummary();
  }
  record.routes.forEach((route) => validateRoute(route, binding));
  const technicalRoutes = record.routes.filter((route) =>
    route.technicalEligible === true
  );
  if (
    record.technicalPipelineOutcome === "pass" &&
    technicalRoutes.length === 0
  ) invalidSummary();
  if (
    record.technicalPipelineOutcome === "not_run" &&
    record.routes.length > 0
  ) invalidSummary();
  const productPassingRoutes = technicalRoutes.filter((route) =>
    routeQualifiesForProductPass(route, binding)
  );
  if (
    record.productQualityOutcome === "pass" &&
    productPassingRoutes.length === 0
  ) {
    throw new V4ProofContractError("false_product_quality_pass");
  }
  if (
    record.technicalPipelineOutcome === "not_run" &&
    record.productQualityOutcome !== "not_applicable"
  ) invalidSummary();
  const expectationMatched =
    record.observedPlanningState === binding.expectedPlanningState &&
    record.technicalPipelineOutcome ===
      binding.expectedTechnicalPipelineOutcome &&
    record.productQualityOutcome === binding.expectedProductQualityOutcome;
  if (record.caseEvaluationOutcome === "pass" && !expectationMatched) {
    invalidSummary();
  }
  if (binding.controlledSurvivor) {
    const controlled = record.controlledSurvivor;
    if (!plainObject(controlled)) invalidSummary();
    if (controlled.injectionArmed === true &&
        controlled.genuineProviderSuccessBeforeInjection !== true) {
      throw new V4ProofContractError("controlled_failure_before_success");
    }
    if (controlled.successRelabelledAsFailure !== false) {
      throw new V4ProofContractError("controlled_success_relabelled");
    }
    if (record.technicalPipelineOutcome === "pass" &&
        controlled.independentSurvivorTechnicalPass !== true) invalidSummary();
    if (record.productQualityOutcome === "pass" &&
        controlled.independentSurvivorProductPass !== true) invalidSummary();
  } else if (record.controlledSurvivor !== null) {
    invalidSummary();
  }
}

function validateRoute(route, binding) {
  if (
    !plainObject(route) ||
    typeof route.resultDigest !== "string" ||
    !/^result_[a-f0-9]{24}$/.test(route.resultDigest) ||
    typeof route.technicalEligible !== "boolean" ||
    typeof route.selected !== "boolean" ||
    typeof route.verifiedGeometry !== "boolean" ||
    typeof route.regionContained !== "boolean" ||
    typeof route.provenanceComplete !== "boolean" ||
    typeof route.accessLineageComplete !== "boolean" ||
    typeof route.waypointOrderVerified !== "boolean" ||
    typeof route.loopClosureVerified !== "boolean" ||
    typeof route.distanceStructuralFit !== "boolean" ||
    typeof route.durationStructuralFit !== "boolean" ||
    !finite(route.distanceKm, 0) ||
    !finite(route.durationMinutes, 0) ||
    !finite(route.ascentMeters, 0) ||
    !finite(route.descentMeters, 0) ||
    !finite(route.targetDistanceDeviationRatio, 0) ||
    !nullableFinite(route.targetDurationDeviationRatio, 0) ||
    !finite(route.maximumProviderSnapDistanceMeters, 0) ||
    !finite(route.aggregateProviderSnapDistanceMeters, 0) ||
    !nullableFinite(route.maximumRouteToAccessDistanceMeters, 0) ||
    !nullableFinite(route.maximumRouteToEvidenceDistanceMeters, 0) ||
    !integer(route.providerSnapCount, 0, 32) ||
    !integer(route.selectedWaypointCount, 0, 16) ||
    !integer(route.reachedWaypointCount, 0, 16) ||
    !finite(route.selfBacktrackingRatio, 0, 1) ||
    !finite(route.selfOverlapRatio, 0, 1) ||
    !finite(route.loopShapeQuality, 0, 1) ||
    typeof route.distanceProductFit !== "boolean" ||
    ![true, false, null].includes(route.durationProductFit) ||
    typeof route.difficultyCompatible !== "boolean" ||
    !integer(route.requiredHighlightCount, 0, 16) ||
    !integer(route.selectedRequiredHighlightCount, 0, 16) ||
    !integer(route.strictlyReachedRequiredHighlightCount, 0, 16) ||
    !Array.isArray(route.highlightApproachStates) ||
    !Array.isArray(route.allHighlightApproachStates) ||
    !/^lineage_[a-f0-9]{24}$/.test(route.evidenceLineageDigest) ||
    !/^lineage_[a-f0-9]{24}$/.test(route.accessLineageDigest) ||
    !["technically_eligible", "rejected_by_quality_policy"].includes(
      route.providerResultClassification
    ) ||
    !integer(route.falseClaimCount, 0, 1_000) ||
    !Array.isArray(route.rejectionCodes) ||
    !Array.isArray(route.limitationCodes)
  ) invalidSummary();
  if (
    route.requiredHighlightCount !== binding.requiredHighlightCount ||
    route.selectedRequiredHighlightCount > route.selectedWaypointCount ||
    route.strictlyReachedRequiredHighlightCount >
      route.requiredHighlightCount ||
    route.highlightApproachStates.some((state) =>
      !["reached", "passes_near", "not_reached", "unverified"].includes(state)
    ) || route.allHighlightApproachStates.some((state) =>
      !["reached", "passes_near", "not_reached", "unverified"].includes(state)
    )
  ) invalidSummary();
  const technicalGuardsPass =
    route.verifiedGeometry && route.regionContained &&
    route.provenanceComplete && route.accessLineageComplete &&
    route.waypointOrderVerified && route.loopClosureVerified &&
    route.distanceStructuralFit && route.durationStructuralFit &&
    route.selfBacktrackingRatio <= 0.55 &&
    route.selfOverlapRatio <= 0.55 &&
    route.loopShapeQuality >= 0.025 &&
    route.selectedRequiredHighlightCount ===
      route.requiredHighlightCount &&
    route.strictlyReachedRequiredHighlightCount ===
      route.requiredHighlightCount &&
    route.highlightApproachStates.every((state) => state === "reached") &&
    (!binding.requiresVerifiedEasyDifficulty || route.difficultyCompatible) &&
    (binding.maximumElevationGainMeters === null ||
      route.ascentMeters <= binding.maximumElevationGainMeters) &&
    route.falseClaimCount === 0;
  if (route.technicalEligible !== technicalGuardsPass) invalidSummary();
  if (route.providerResultClassification !== (route.technicalEligible
    ? "technically_eligible" : "rejected_by_quality_policy")) invalidSummary();
}

function routeQualifiesForProductPass(route, binding) {
  return route.technicalEligible &&
    route.selected &&
    route.distanceProductFit &&
    (binding.durationRangeMinutes === null ||
      route.durationProductFit === true) &&
    route.selfBacktrackingRatio <= 0.35 &&
    route.selfOverlapRatio <= 0.35 &&
    route.strictlyReachedRequiredHighlightCount ===
      binding.requiredHighlightCount &&
    route.highlightApproachStates.every((state) => state === "reached") &&
    (!binding.requiresVerifiedEasyDifficulty || route.difficultyCompatible) &&
    (binding.maximumElevationGainMeters === null ||
      route.ascentMeters <= binding.maximumElevationGainMeters) &&
    route.provenanceComplete && route.accessLineageComplete &&
    route.falseClaimCount === 0;
}

function validateFeatureFlags(value, providerAccounting) {
  if (!plainObject(value)) invalidSummary();
  validateFlagSnapshot(value.initial, false);
  validateFlagSnapshot(value.final, false);
  if (value.initial.exactAdmissionVerified !== true ||
      value.final.exactAdmissionVerified !== true) invalidSummary();
  if (providerAccounting.attempted === 0) {
    validateFlagSnapshot(value.execution, false);
  } else {
    validateFlagSnapshot(value.execution, true);
  }
}

function validateFlagSnapshot(snapshot, execution) {
  if (!plainObject(snapshot) || !plainObject(snapshot.flags) ||
      Object.keys(snapshot.flags).length !== V4_FLAG_NAMES.length ||
      snapshot.exactAdmissionVerified !== true) invalidSummary();
  for (const name of V4_FLAG_NAMES) {
    const expected = execution && EXECUTION_TRUE_FLAGS.has(name);
    if (snapshot.flags[name] !== expected) invalidSummary();
  }
}

function validateCleanup(value, decisions) {
  if (
    !plainObject(value) ||
    value.cleanupComplete !== true ||
    value.finalFlagsDisabled !== true ||
    value.disabledZeroWorkProbePassed !== true ||
    value.disabledZeroWorkDatabaseOperations !== 0 ||
    value.disabledZeroWorkProviderOperations !== 0 ||
    value.providerCredentialRemovedFromProofProcess !== true ||
    value.poolsClosed !== true ||
    value.leasesReleased !== true ||
    value.taskOwnedArtifactsRemoved !== true ||
    decisions.cleanupAndContainment !== "passed"
  ) throw new V4ProofContractError("cleanup_failed");
}

function validatePrivacy(value) {
  if (
    !plainObject(value) ||
    value.forbiddenFieldCount !== 0 ||
    value.rawProviderMaterialRetained !== false ||
    value.routeShapeRetained !== false ||
    value.preciseLocationRetained !== false ||
    value.unboundedErrorRetained !== false ||
    value.appAttestMaterialRetained !== false
  ) throw new V4ProofContractError("sensitive_durable_output");
}

function invalidManifest() {
  throw new V4ProofContractError("manifest_mismatch");
}

function invalidAccounting() {
  throw new V4ProofContractError("provider_accounting_invalid");
}

function invalidSummary() {
  throw new V4ProofContractError("invalid_v4_summary");
}

function integer(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function finite(value, minimum, maximum = Number.POSITIVE_INFINITY) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function nullableFinite(value, minimum, maximum = Number.POSITIVE_INFINITY) {
  return value === null || finite(value, minimum, maximum);
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" &&
    !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}
