import { createHash, randomBytes } from "node:crypto";
import {
  outdoorAdventureStagingProofInputDigestV1
} from "./manifest.js";
import {
  withControlledOutdoorAdventureProofServerV1
} from "./operationalBackendCapture.js";
import {
  extractOutdoorAdventureStagingProofIOSReceiptV1,
  verifyExtractedOutdoorAdventureStagingProofIOSReceiptV1
} from "./iosRuntimeReceipt.js";

const CASE_NUMBER_PATTERN = /^case-(0[1-9]|1[0-8])-/;
const CONTROLLED_IOS_PROOF_CASE_ID =
  "case-16-malformed-backend-response-rejected-by-ios";
const APPROVED_LIVE_DRIVER_DESCRIPTORS = new WeakSet();

export class OutdoorAdventureStagingProofOperationalDriverError
  extends Error {
  constructor(code) {
    super(code);
    this.name = "OutdoorAdventureStagingProofOperationalDriverError";
    this.code = code;
  }
}

export async function createOutdoorAdventureStagingProofCaseDriverV1() {
  invalid("approved_https_ios_receipt_verifier_missing");
}

export function inspectOutdoorAdventureStagingProofLiveDriverV1(
  descriptor
) {
  if (
    !descriptor ||
    typeof descriptor !== "object" ||
    !APPROVED_LIVE_DRIVER_DESCRIPTORS.has(descriptor) ||
    typeof descriptor.runLiveCase !== "function" ||
    typeof descriptor.runControlledCase !== "function" ||
    typeof descriptor.close !== "function"
  ) {
    return null;
  }
  return Object.freeze({
    runLiveCase: descriptor.runLiveCase,
    runControlledCase: descriptor.runControlledCase,
    close: descriptor.close,
    causalPipelineCaptureConfigured: true,
    appAttestReceiptIntegrationConfigured: true,
    iosRuntimeReceiptIntegrationConfigured: true
  });
}

function approvedLiveDriverDescriptor({
  runLiveCase,
  runControlledCase,
  close
}) {
  if (
    typeof runLiveCase !== "function" ||
    typeof runControlledCase !== "function" ||
    typeof close !== "function"
  ) {
    throw new TypeError(
      "Approved live and controlled proof runners are required."
    );
  }
  const descriptor = Object.freeze({
    runLiveCase,
    runControlledCase,
    close
  });
  APPROVED_LIVE_DRIVER_DESCRIPTORS.add(descriptor);
  return descriptor;
}

export function createControlledOutdoorAdventureStagingProofCaseDriverV1({
  runIOSCase,
  expectedDeviceId,
  env = process.env
}) {
  if (typeof runIOSCase !== "function") {
    throw new TypeError(
      "A controlled iOS staging-proof xcresult runner is required."
    );
  }
  if (
    typeof expectedDeviceId !== "string" ||
    expectedDeviceId.length === 0 ||
    expectedDeviceId.length > 255
  ) {
    throw new TypeError(
      "A preselected controlled iOS destination is required."
    );
  }
  return async function runControlledStagingProofCase(
    evaluationCase,
    context
  ) {
    if (evaluationCase?.id !== CONTROLLED_IOS_PROOF_CASE_ID) {
      invalid("controlled_case_requires_external_runner");
    }
    if (
      context?.lane !== "controlled" ||
      typeof context.ingestVerifiedIOSRuntimeReceipt !== "function"
    ) {
      invalid("invalid_controlled_topology");
    }
    const nonceDigest = sha256(randomBytes(32));
    const testBinding =
      outdoorAdventureStagingProofXCTestBindingV1(
        evaluationCase.id
      );
    const testIdentifier = testBinding.onlyTestingIdentifier;
    const xcresultTestIdentifier =
      testBinding.xcresultTestIdentifier;
    const { value: xcresultPath, capture } =
      await withControlledOutdoorAdventureProofServerV1({
        evaluationCase,
        context,
        env,
        async operation({ endpointOrigin, signal }) {
          const result = await runIOSCase(Object.freeze({
            caseId: evaluationCase.id,
            inputFixtureId: evaluationCase.input.fixtureId,
            endpointOrigin,
            deviceId: expectedDeviceId,
            buildSettings: Object.freeze({
              INTENT_BACKEND_BASE_URL: endpointOrigin,
              RESEARCH_GUIDED_PLANNING_ENABLED: "true"
            }),
            testEnvironment: Object.freeze({
              TRAILMIND_STAGING_PROOF_NONCE_DIGEST:
                nonceDigest
            }),
            testIdentifier,
            signal
          }));
          if (
            typeof result !== "string" ||
            result.length === 0 ||
            result.length > 4_096
          ) {
            invalid("ios_xcresult_path_missing");
          }
          return result;
        }
      });
    const receipt =
      await extractOutdoorAdventureStagingProofIOSReceiptV1({
        xcresultPath,
        expectedCaseId: evaluationCase.id,
        expectedInputFixtureId: evaluationCase.input.fixtureId,
        expectedLane: "controlled",
        expectedNonceDigest: nonceDigest,
        expectedTestIdentifier: xcresultTestIdentifier,
        expectedDeviceId,
        expectedDestination: "simulator",
        signal: context.signal
      });
    const verifiedReceipt =
      verifyExtractedOutdoorAdventureStagingProofIOSReceiptV1({
        receipt,
        capture,
        evaluationCase
      });
    context.ingestVerifiedIOSRuntimeReceipt(verifiedReceipt);
    const dependencyFacts =
      typeof context.causalDependencyFacts === "function"
        ? context.causalDependencyFacts()
        : Object.freeze({
          postgresAbortWhileActive: false,
          postgresRollbackAfterAbort: false,
          graphHopperAbortWhileInFlight: false
        });

    const execution = capture.executions.at(-1) ?? null;
    const response = capturedResponseFor(
      evaluationCase,
      execution
    );
    const dossier = latestCapturedArtifact(
      capture.executions,
      "dossier"
    );
    const candidatePlan = latestCapturedArtifact(
      capture.executions,
      "candidatePlan"
    );
    const semanticExpectationIds = deriveSemanticObservationIds({
      evaluationCase,
      capture,
      receipt,
      response,
      dossier,
      candidatePlan,
      dependencyFacts
    });
    const limitationCauseIds = deriveLimitationCauseIds({
      evaluationCase,
      capture,
      receipt,
      response,
      dossier,
      candidatePlan,
      dependencyFacts
    });
    return Object.freeze({
      id: evaluationCase.id,
      inputFixtureId: evaluationCase.input.fixtureId,
      inputDigest:
        outdoorAdventureStagingProofInputDigestV1(
          evaluationCase.input
        ),
      semanticExpectationIds,
      limitationCauseIds,
      terminalState: receipt.proofTerminalState,
      skipped: false,
      response,
      dossier,
      candidatePlan
    });
  };
}

function capturedResponseFor(evaluationCase, execution) {
  if (
    evaluationCase.expected.responseExpectation ===
      "not_applicable"
  ) {
    return null;
  }
  if (
    evaluationCase.id ===
      "case-16-malformed-backend-response-rejected-by-ios"
  ) {
    return { schemaVersion: 1 };
  }
  return execution?.payload ?? null;
}

export function deriveSemanticObservationIds({
  evaluationCase,
  capture,
  receipt,
  response,
  dossier,
  candidatePlan,
  dependencyFacts
}) {
  const observed = [];
  const input = evaluationCase.input;
  const normalizedIntent = latestNormalizedIntent({
    capture,
    response,
    dossier,
    candidatePlan
  });
  const allExecutionsBound =
    capture.executions.length > 0 &&
    capture.executions.every((execution) =>
      execution.intentBound === true
    );
  if (allExecutionsBound) observed.push("canonical_intent_bound");
  if (
    hasRealQualityChain(receipt) &&
    routedResultCount(response) > 0
  ) {
    observed.push("real_route_quality_ranked");
  }
  if (allResearchWaypointsVisited(response)) {
    observed.push("research_waypoints_visited");
  }
  if (
    intentPreserves(normalizedIntent, input) &&
    input.preferredExperiences.includes("viewpoint") &&
    input.preferredExperiences.includes("forest")
  ) {
    observed.push("viewpoint_forest_preferences_preserved");
  }
  if (
    intentPreserves(normalizedIntent, input) &&
    input.preferredExperiences.includes("viewpoint") &&
    !input.preferredExperiences.includes("forest")
  ) {
    observed.push("viewpoint_preference_preserved");
  }
  if (
    intentPreserves(normalizedIntent, input) &&
    input.preferredExperiences.includes("quiet_trails") &&
    input.avoidedExperiences.includes("major_roads")
  ) {
    observed.push("path_and_road_preferences_preserved");
  }
  if (
    intentPreserves(normalizedIntent, input) &&
    input.activity === "trail_running"
  ) {
    observed.push("trail_running_activity_preserved");
  }
  if (
    intentPreserves(normalizedIntent, input) &&
    input.maximumTechnicalDifficulty === "hiking"
  ) {
    observed.push("conservative_difficulty_applied");
  }
  if (brockenAnchorReturned(response)) {
    observed.push("brocken_anchor_returned");
  }
  if (
    namedBrockenMustHaveSatisfied(
      dossier,
      candidatePlan,
      response
    )
  ) {
    observed.push("named_brocken_must_have_satisfied");
  }
  if (insufficientLandmarkObserved(dossier, candidatePlan)) {
    observed.push("must_have_shortfall_observed");
  }
  if (
    response?.state === "unsupported" &&
    responseHasPlanningGap(response, "unsupported_region") &&
    capture.executions.every((execution) =>
      execution.repositoryCalls === 0 &&
      execution.providerCalls === 0
    )
  ) {
    observed.push("outside_coverage_unsupported");
  }
  if (
    input.anchorFixture === "alps-broad-region" &&
    receipt.adapterState === "clarification_required" &&
    receipt.plannerTerminalState === "clarification" &&
    capture.executions.length === 0
  ) {
    observed.push("broad_region_clarification");
  }
  if (
    response?.routedAlternatives?.remainingLimitations?.includes(
      "official_status_unverified"
    )
  ) {
    observed.push("missing_official_current_evidence_visible");
  }
  if (receipt.legacyRoutingRequestCount === 1) {
    observed.push("legacy_fallback_once");
  }
  if (
    input.activity === "biking" &&
    receipt.adapterState === "unsupported" &&
    receipt.legacyRoutingRequestCount === 1 &&
    capture.executions.length === 0
  ) {
    observed.push("unsupported_biking_fallback");
  }
  if (
    input.routeType === "point_to_point" &&
    receipt.adapterState === "unsupported" &&
    receipt.legacyRoutingRequestCount === 1 &&
    capture.executions.length === 0
  ) {
    observed.push("unsupported_point_to_point_fallback");
  }
  if (
    receipt.proofTerminalState === "cancelled" &&
    capture.executions.some((execution) =>
      execution.repositoryCalls > 0
    ) &&
    dependencyFacts.postgresAbortWhileActive === true &&
    dependencyFacts.postgresRollbackAfterAbort === true &&
    receipt.cancellation.attemptDigest !== null &&
    receipt.cancellation.postCancelTerminalState === "cancelled" &&
    receipt.cancellation.postCancelCoordinatorResultCount === 0 &&
    receipt.cancellation.postCancelLegacyRoutingCount === 0
  ) {
    observed.push("cancelled_during_postgis");
  }
  if (
    hasCausalGraphHopperTimeoutExecution(capture) &&
    dependencyFacts.graphHopperAbortWhileInFlight === true &&
    receipt.legacyRoutingRequestCount === 1
  ) {
    observed.push("graphhopper_timeout_observed");
  }
  if (providerFailureHasSurvivor(capture, response)) {
    observed.push("partial_provider_failure_survivor");
  }
  if (
    evaluationCase.id ===
      "case-16-malformed-backend-response-rejected-by-ios" &&
    receipt.proofTerminalState === "rejected" &&
    receipt.plannerTerminalState === "recoverable_error" &&
    receipt.researchOutcome === "failure" &&
    capture.executions.length === 1 &&
    capture.executions[0].intentBound === true
  ) {
    observed.push("malformed_response_rejected_by_ios");
  }
  if (
    evaluationCase.id ===
      "case-17-feature-disabled-zero-research-work" &&
    receipt.proofTerminalState === "disabled" &&
    receipt.adapterState === "not_observed" &&
    receipt.researchCoordinatorRequestCount === 0 &&
    receipt.legacyRoutingRequestCount === 0 &&
    capture.executions.length === 0
  ) {
    observed.push("feature_disabled_zero_research");
  }
  if (freshRetryObserved(capture, receipt)) {
    observed.push("fresh_retry_after_failure");
  }
  const expectedIds = new Set(
    evaluationCase.expected.semanticExpectationIds
  );
  return Object.freeze(
    [...new Set(observed)]
      .filter((id) => expectedIds.has(id))
      .sort()
  );
}

function deriveLimitationCauseIds({
  evaluationCase,
  capture,
  receipt,
  response,
  dossier,
  candidatePlan,
  dependencyFacts
}) {
  const observed = [];
  const input = evaluationCase.input;
  const remainingLimitations =
    response?.routedAlternatives?.remainingLimitations ?? [];
  if (remainingLimitations.includes("access_unverified")) {
    observed.push("access_unverified");
  }
  if (insufficientLandmarkObserved(dossier, candidatePlan)) {
    observed.push("insufficient_candidate_count");
  }
  if (
    response?.state === "unsupported" &&
    responseHasPlanningGap(response, "unsupported_region")
  ) {
    observed.push("unsupported_region");
  }
  if (
    input.anchorFixture === "alps-broad-region" &&
    receipt.adapterState === "clarification_required"
  ) {
    observed.push("unresolved_geography");
  }
  if (remainingLimitations.includes("official_status_unverified")) {
    observed.push("official_status_unverified");
  }
  if (
    input.activity === "biking" &&
    receipt.adapterState === "unsupported"
  ) {
    observed.push("unsupported_activity");
  }
  if (
    input.routeType === "point_to_point" &&
    receipt.adapterState === "unsupported"
  ) {
    observed.push("unsupported_route_type");
  }
  if (
    hasCausalGraphHopperTimeoutExecution(capture) &&
    dependencyFacts.graphHopperAbortWhileInFlight === true
  ) {
    observed.push("graphhopper_timeout");
  }
  if (providerFailureHasSurvivor(capture, response)) {
    observed.push("provider_failure");
  }
  if (
    evaluationCase.id ===
      "case-16-malformed-backend-response-rejected-by-ios" &&
    receipt.proofTerminalState === "rejected"
  ) {
    observed.push("malformed_response");
  }
  if (
    evaluationCase.id ===
      "case-17-feature-disabled-zero-research-work" &&
    capture.executions.length === 0
  ) {
    observed.push("feature_disabled");
  }
  if (freshRetryObserved(capture, receipt)) {
    observed.push("prior_attempt_failed");
  }
  return Object.freeze([...new Set(observed)].sort());
}

export function hasCausalGraphHopperTimeoutExecution(capture) {
  return Array.isArray(capture?.executions) &&
    capture.executions.some((execution) =>
      execution?.completed === true &&
      execution.statusCode === 200 &&
      execution.deliveredOutcome === "production_endpoint_result" &&
      Number.isInteger(execution.providerCalls) &&
      execution.providerCalls > 0 &&
      Array.isArray(execution.providerOutcomes) &&
      execution.providerOutcomes.includes(
        "actual_call_aborted_while_in_flight"
      ) &&
      execution.payload?.routedAlternatives?.attempts?.some(
        (attempt) =>
          attempt?.state === "failed" &&
          attempt.failureCode === "route_timed_out"
      ) === true
    );
}

function latestCapturedArtifact(executions, field) {
  for (let index = executions.length - 1; index >= 0; index -= 1) {
    if (executions[index][field] !== null) {
      return executions[index][field];
    }
  }
  return null;
}

function latestNormalizedIntent({
  capture,
  response,
  dossier,
  candidatePlan
}) {
  return response?.routedAlternatives?.normalizedIntent ??
    response?.normalizedIntent ??
    candidatePlan?.normalizedIntent ??
    dossier?.normalizedIntent ??
    capture.executions.at(-1)?.researchIntent ??
    null;
}

function intentPreserves(intent, input) {
  if (!intent) return false;
  return intent.activity === input.activity &&
    intent.routeType === input.routeType &&
    sameValue(
      intent.preferredExperiences,
      input.preferredExperiences
    ) &&
    sameValue(
      intent.avoidedExperiences,
      input.avoidedExperiences
    ) &&
    intent.maximumTechnicalDifficulty ===
      input.maximumTechnicalDifficulty;
}

function hasRealQualityChain(receipt) {
  const conversion = receipt.contractConversion;
  const presentation = receipt.presentation;
  return receipt.iosStageTimings.route_quality.length > 0 &&
    conversion.acceptedCount > 0 &&
    conversion.coordinatorSelectionOrderDigest !== null &&
    conversion.plannerSuggestionOrderDigest ===
      conversion.coordinatorSelectionOrderDigest &&
    presentation.count === conversion.acceptedCount &&
    presentation.inputOrderDigest ===
      conversion.plannerSuggestionOrderDigest &&
    presentation.outputOrderDigest !== null;
}

function allResearchWaypointsVisited(response) {
  const results = routeResults(response);
  return results.length > 0 &&
    results.every((result) => {
      const viaVisits = result.waypointVisits.filter(
        (visit) => visit.role === "via"
      );
      return viaVisits.length > 0 &&
        viaVisits.every((visit) =>
          visit.snappedCoordinate !== null &&
          visit.snapDistanceMeters !== null &&
          visit.withinVisitTolerance === true
        );
    });
}

function brockenAnchorReturned(response) {
  const intent = response?.routedAlternatives?.normalizedIntent;
  if (
    intent?.geographicAnchor?.state !== "resolved" ||
    intent.geographicAnchor.name !== "Brocken"
  ) {
    return false;
  }
  const results = routeResults(response);
  return results.length > 0 &&
    results.every((result) => {
      const anchors = result.waypointVisits.filter((visit) =>
        visit.role === "anchor" ||
        visit.role === "return_anchor"
      );
      return anchors.length === 2 &&
        anchors.every((visit) =>
          sameValue(
            visit.requestedCoordinate,
            intent.geographicAnchor.coordinate
          ) &&
          visit.snappedCoordinate !== null &&
          visit.snapDistanceMeters !== null &&
          visit.withinVisitTolerance === true
        );
    });
}

function namedBrockenMustHaveSatisfied(
  dossier,
  candidatePlan,
  response
) {
  if (
    !dossier ||
    !candidatePlan ||
    !response?.routedAlternatives ||
    candidatePlan.proposals.length === 0
  ) {
    return false;
  }
  const claimsById = new Map(
    dossier.evidenceClaims.map((claim) => [
      claim.claimId,
      claim
    ])
  );
  const namedBrockenCandidates = new Map(
    dossier.candidateHighlights
      .filter((candidate) =>
        candidate.highlightCategory === "peak" &&
        candidate.evidenceClaimIds.some((claimId) => {
          const claim = claimsById.get(claimId);
          return claim?.entityId === candidate.entityId &&
            claim.predicate === "name" &&
            claim.value?.type === "text" &&
            claim.value.value === "Brocken" &&
            claim.resolutionState === "known" &&
            claim.freshness === "current";
        })
      )
      .map((candidate) => [
        candidate.entityId,
        candidate.coordinate
      ])
  );
  if (namedBrockenCandidates.size === 0) return false;
  return candidatePlan.proposals.every((proposal, index) => {
    const brockenEntities = new Map(
      proposal.viaCandidates
        .filter((candidate) =>
          candidate.highlightCategory === "peak" &&
          candidate.role === "must_have" &&
          namedBrockenCandidates.has(candidate.entityId) &&
          sameValue(
            candidate.coordinate,
            namedBrockenCandidates.get(candidate.entityId)
          )
        )
        .map((candidate) => [
          candidate.entityId,
          candidate.coordinate
        ])
    );
    const attempt = response.routedAlternatives.attempts[index];
    return brockenEntities.size > 0 &&
      proposal.satisfiedRequirements.some((requirement) =>
        requirement.requirementType === "must_have_experience" &&
        requirement.value === "peak" &&
        requirement.includedCount >= 1 &&
        requirement.shortfallCount === 0
      ) &&
      attempt?.state === "routed" &&
      attempt?.routeResults.every((result) =>
        result.waypointVisits.some((visit) =>
          visit.role === "via" &&
          brockenEntities.has(visit.entityId) &&
          sameValue(
            visit.requestedCoordinate,
            brockenEntities.get(visit.entityId)
          ) &&
          visit.snappedCoordinate !== null &&
          visit.snapDistanceMeters !== null &&
          visit.withinVisitTolerance === true
        )
      ) === true;
  });
}

function insufficientLandmarkObserved(dossier, candidatePlan) {
  const matches = (gap) =>
    gap.code === "insufficient_candidate_count" &&
    gap.experience === "landmark" &&
    gap.requiredMinimumCount >= 1 &&
    gap.foundCount < gap.requiredMinimumCount;
  return dossier?.evidenceGaps?.some(matches) === true &&
    candidatePlan?.state === "insufficient_evidence" &&
    candidatePlan.proposals?.length === 0 &&
    candidatePlan.evidenceGaps?.some(matches) === true;
}

function providerFailureHasSurvivor(capture, response) {
  const attempts = response?.routedAlternatives?.attempts ?? [];
  return capture.executions.some((execution) =>
    execution.providerOutcomes.includes(
      "actual_call_then_controlled_failure"
    )
  ) &&
    attempts.some((attempt) => attempt.state === "failed") &&
    attempts.some((attempt) =>
      attempt.state === "routed" &&
      attempt.routeResults.length > 0
    );
}

function freshRetryObserved(capture, receipt) {
  const priorExecution = capture.executions[0];
  const currentExecution = capture.executions[1];
  return capture.executions.length === 2 &&
    priorExecution.statusCode === 503 &&
    priorExecution.deliveredOutcome ===
      "controlled_failure_after_production_execution" &&
    priorExecution.payload?.error?.code === "internal_failure" &&
    currentExecution.statusCode === 200 &&
    currentExecution.deliveredOutcome ===
      "production_endpoint_result" &&
    ["routed", "partial"].includes(currentExecution.payload?.state) &&
    receipt.retry.priorAttemptDigest !== null &&
    receipt.retry.currentAttemptDigest !== null &&
    receipt.retry.priorAttemptDigest !==
      receipt.retry.currentAttemptDigest &&
    receipt.retry.priorResultDigest !== null &&
    receipt.retry.priorResultDigest !==
      receipt.retry.currentResultDigest &&
    receipt.retry.priorRequestIdDigest ===
      capture.executions[0].requestIdDigest &&
    receipt.retry.currentRequestIdDigest ===
      capture.executions[1].requestIdDigest &&
    receipt.retry.priorTerminalState === "no_routes" &&
    receipt.retry.currentTerminalState === "suggestions_ready" &&
    receipt.retry.currentResultDigest !== null &&
    receipt.retry.postResetPlannerTerminalState === "generating" &&
    receipt.retry.postResetSuggestionCount === 0 &&
    receipt.retry.postResetResearchContextDigest === null &&
    receipt.retry.postResetClarificationDigest === null &&
    receipt.retry.postResetRecoveryDigest === null &&
    receipt.legacyRoutingRequestCount === 1;
}

function responseHasPlanningGap(response, code) {
  return response?.planningGaps?.some((gap) => gap.code === code) ===
    true;
}

function routeResults(response) {
  return response?.routedAlternatives?.attempts.flatMap(
    (attempt) => attempt.routeResults
  ) ?? [];
}

function routedResultCount(response) {
  return routeResults(response).length;
}

export function outdoorAdventureStagingProofXCTestBindingV1(caseId) {
  const match = caseId.match(CASE_NUMBER_PATTERN);
  if (!match) invalid("invalid_case_id");
  return Object.freeze({
    onlyTestingIdentifier:
      `TrailMindUITests/TrailMindStagingProofUITests/testCase${match[1]}`,
    xcresultTestIdentifier:
      `TrailMindStagingProofUITests/testCase${match[1]}()`
  });
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function invalid(code) {
  throw new OutdoorAdventureStagingProofOperationalDriverError(code);
}
