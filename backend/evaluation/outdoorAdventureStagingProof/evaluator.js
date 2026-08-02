import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  PostgresAppAttestRepository
} from "../../src/appAttest/postgresAppAttestRepository.js";
import {
  createAppAttestAssertionVerificationTracker
} from "../../src/appAttest/appAttestEndpoint.js";
import {
  validateOutdoorAdventurePlanningResponseV1
} from "../../src/outdoorAdventure/orchestrationContract.js";
import {
  PostgresOutdoorResearchRepository
} from "../../src/outdoorResearch/postgresOutdoorResearchRepository.js";
import {
  validateAdventureResearchDossierV1
} from "../../src/outdoorResearch/validation.js";
import {
  createGraphHopperProvider,
  providerConfiguration
} from "../../src/routing/graphHopperProvider.js";
import {
  isDevelopmentRouteAuthorizer
} from "../../src/routing/routeAuthorization.js";
import {
  validateResearchGuidedRouteCandidatePlanV1
} from "../../src/routeResearch/validation.js";
import {
  isVerifiedOutdoorAdventureStagingProofIOSReceiptV1
} from "./iosRuntimeReceipt.js";
import {
  createOutdoorAdventureStagingProofPostgresCancellationGateV1
} from "./postgresCancellationGate.js";
import {
  OUTDOOR_ADVENTURE_STAGING_PROOF_AUTHORIZATION_STATES_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_CASE_IDS_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_EVIDENCE_SOURCES_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_LIMITATION_CAUSE_IDS_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_PROVIDER_TRAFFIC_STATES_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_RESPONSE_STATES_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_RETRY_FRESHNESS_STATES_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_ROUTE_QUALITY_STATES_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_ROUTING_SOURCES_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_SEMANTIC_EXPECTATION_IDS_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_STAGE_NAMES_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_TERMINAL_STATES_V1,
  outdoorAdventureStagingProofInputDigestV1
} from "./manifest.js";

export const OUTDOOR_ADVENTURE_STAGING_PROOF_TIMING_BUCKETS_V1 =
  Object.freeze([
    "under_100ms",
    "100ms_to_499ms",
    "500ms_to_999ms",
    "1s_to_4s",
    "5s_to_14s",
    "15s_or_more"
  ]);

const OBSERVATION_FIELDS = Object.freeze([
  "id",
  "inputFixtureId",
  "inputDigest",
  "semanticExpectationIds",
  "limitationCauseIds",
  "terminalState",
  "skipped",
  "response",
  "dossier",
  "candidatePlan"
]);
const DRIVER_MEASURED_STAGES = new Set([
  "research_planning",
  "dossier_assembly",
  "candidate_planning"
]);
const STAGE_NAME_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_STAGE_NAMES_V1);
const TERMINAL_STATE_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_TERMINAL_STATES_V1);
const SEMANTIC_EXPECTATION_ID_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_SEMANTIC_EXPECTATION_IDS_V1);
const LIMITATION_CAUSE_ID_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_LIMITATION_CAUSE_IDS_V1);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIVE_LANE = "live";
const CONTROLLED_LANE = "controlled";
const CONTROLLED_IOS_PROOF_CASE_ID =
  "case-16-malformed-backend-response-rejected-by-ios";
const POSTGRES_CANCELLATION_PROOF_CASE_ID =
  "case-13-cancel-during-postgis-research";
const MANDATORY_CASE_ID_SET =
  new Set(OUTDOOR_ADVENTURE_STAGING_PROOF_CASE_IDS_V1);
const OFFICIAL_GRAPHHOPPER_BASE_URL = "https://graphhopper.com/api/1";
const LIVE_FETCH = typeof globalThis.fetch === "function"
  ? globalThis.fetch.bind(globalThis)
  : null;

export function createOutdoorAdventureStagingProofLaneDispatcherV1({
  evaluateLiveCase,
  evaluateControlledCase
}) {
  if (
    typeof evaluateLiveCase !== "function" ||
    typeof evaluateControlledCase !== "function"
  ) {
    throw new TypeError(
      "Both live and controlled staging proof evaluators are required."
    );
  }
  return async function evaluateStagingProofCaseByLane(
    evaluationCase,
    options = {}
  ) {
    if (!MANDATORY_CASE_ID_SET.has(evaluationCase?.id)) {
      throw new TypeError("The staging proof case is not mandatory.");
    }
    const evaluator = evaluationCase.id === CONTROLLED_IOS_PROOF_CASE_ID
      ? evaluateControlledCase
      : evaluateLiveCase;
    return evaluator(evaluationCase, options);
  };
}

export function createLiveOutdoorAdventureStagingProofEvaluatorV1({
  pool,
  postgresCancellationControlPool,
  env,
  runCase,
  now = () => performance.now(),
  statementTimeoutMs
}) {
  if (
    !pool?.connect ||
    !postgresCancellationControlPool?.connect ||
    postgresCancellationControlPool === pool ||
    typeof runCase !== "function"
  ) {
    throw new TypeError("Live staging proof dependencies are invalid.");
  }
  const appAttestRepository = new PostgresAppAttestRepository({ pool });
  const configuration = providerConfiguration(env);
  if (
    configuration.baseUrl !== OFFICIAL_GRAPHHOPPER_BASE_URL ||
    LIVE_FETCH === null
  ) {
    throw new TypeError("Live GraphHopper configuration is invalid.");
  }
  const provider = createGraphHopperProvider({
    env,
    fetchImpl: LIVE_FETCH
  });
  return createEvaluator({
    lane: LIVE_LANE,
    repository: null,
    repositoryFactory(state) {
      return new PostgresOutdoorResearchRepository({
        pool,
        statementTimeoutMs,
        transactionLifecycleObserver(event) {
          recordPostgresTransactionLifecycle(state, event);
          state.postgresCancellationGate
            ?.observeTransactionLifecycle(event);
        }
      });
    },
    postgresCancellationGateFactory({ caseId, nonceDigest, signal }) {
      return createOutdoorAdventureStagingProofPostgresCancellationGateV1({
        productPool: pool,
        controlPool: postgresCancellationControlPool,
        caseId,
        nonceDigest,
        signal
      });
    },
    appAttestRepository,
    provider,
    runCase,
    now
  });
}

export function createControlledOutdoorAdventureStagingProofEvaluatorV1({
  repository,
  appAttestRepository,
  provider,
  runCase,
  requireIOSRuntimeReceipt = false,
  now = () => performance.now()
}) {
  if (typeof runCase !== "function") {
    throw new TypeError("A controlled staging proof case driver is required.");
  }
  return createEvaluator({
    lane: CONTROLLED_LANE,
    repository,
    repositoryFactory: null,
    appAttestRepository,
    provider,
    runCase,
    requireIOSRuntimeReceipt,
    now
  });
}

function createEvaluator({
  lane,
  repository,
  repositoryFactory = null,
  postgresCancellationGateFactory = null,
  appAttestRepository,
  provider,
  runCase,
  requireIOSRuntimeReceipt = true,
  now
}) {
  if (typeof now !== "function") {
    throw new TypeError("A monotonic clock is required.");
  }
  return async function evaluateStagingProofCase(evaluationCase, options = {}) {
    const state = createEvaluationState(
      now,
      requireIOSRuntimeReceipt
    );
    const caseRepository = repositoryFactory === null
      ? repository
      : repositoryFactory(state);
    const removeAbortListener =
      deactivateEvaluationStateOnAbort(state, options.signal);
    const context = createCaseContext({
      lane,
      repository: caseRepository,
      appAttestRepository,
      provider,
      state,
      evaluationCase,
      postgresCancellationGateFactory,
      signal: options.signal
    });
    try {
      assertActive(state);
      const requiresIOSUserFlowTiming =
        state.requireIOSRuntimeReceipt ||
        evaluationCase.id ===
          "case-16-malformed-backend-response-rejected-by-ios";
      const observation = requiresIOSUserFlowTiming
        ? await runCase(evaluationCase, context)
        : await measure(
          state,
          "end_to_end",
          () => runCase(evaluationCase, context)
        );
      assertActive(state);
      return evaluateObservation(evaluationCase, observation, state, lane);
    } finally {
      try {
        await state.postgresCancellationGate?.dispose();
      } finally {
        state.active = false;
        removeAbortListener();
      }
    }
  };
}

function createEvaluationState(now, requireIOSRuntimeReceipt) {
  return {
    active: true,
    now,
    repositoryCalls: 0,
    providerCalls: 0,
    legacyFallbackCount: 0,
    syntheticEvidenceUsed: false,
    syntheticRoutingUsed: false,
    authorizationCount: 0,
    authorizationKind: "none",
    authorizationRequestIdDigest: null,
    authorizationRequestIdDigests: [],
    routeQualityCount: 0,
    retryRecorded: false,
    staleStateReused: false,
    verifiedAppAttestInstallations: new Map(),
    createdRouteSessions: new Map(),
    postgresTransactionActive: false,
    postgresAbortWhileActive: false,
    postgresRollbackAfterAbort: false,
    postgresCancellationGate: null,
    postgresCancellationGateArmed: false,
    postgresCancellationGateQueryActive: false,
    postgresCancellationGateSettled: false,
    graphHopperAbortWhileInFlight: false,
    timings: new Map(),
    timingBuckets: new Map(),
    iosReceiptObserved: false,
    iosReceipt: null,
    requireIOSRuntimeReceipt
  };
}

function deactivateEvaluationStateOnAbort(state, signal) {
  if (signal === undefined) return () => {};
  if (
    !signal ||
    typeof signal.aborted !== "boolean" ||
    typeof signal.addEventListener !== "function" ||
    typeof signal.removeEventListener !== "function"
  ) {
    throw new TypeError("The staging proof abort signal is invalid.");
  }
  const deactivate = () => {
    state.active = false;
  };
  if (signal.aborted) {
    deactivate();
    return () => {};
  }
  signal.addEventListener("abort", deactivate, { once: true });
  return () => signal.removeEventListener("abort", deactivate);
}

function createCaseContext({
  lane,
  repository,
  appAttestRepository,
  provider,
  state,
  evaluationCase,
  postgresCancellationGateFactory,
  signal
}) {
  const measuredAppAttestRepository =
    instrumentAppAttestRepository(
      appAttestRepository,
      state,
      maximumAuthorizationCount(evaluationCase)
    );
  const appAttestAssertionVerificationTracker =
    createAppAttestAssertionVerificationTracker((verification) => {
      recordAppAttestAssertionVerification(state, verification);
    });
  return Object.freeze({
    signal,
    repository: instrumentRepository(repository, state),
    provider: instrumentProvider(provider, state),
    appAttestRepository: measuredAppAttestRepository,
    appAttestAssertionVerificationTracker,
    lane: lane === LIVE_LANE ? "live" : "controlled",
    async armPostgresCancellationGate({ nonceDigest } = {}) {
      assertActive(state);
      if (
        lane !== LIVE_LANE ||
        evaluationCase.id !== POSTGRES_CANCELLATION_PROOF_CASE_ID ||
        typeof postgresCancellationGateFactory !== "function" ||
        state.postgresCancellationGate !== null
      ) {
        throw new TypeError(
          "The Postgres cancellation gate is unavailable."
        );
      }
      const gate = await postgresCancellationGateFactory({
        caseId: evaluationCase.id,
        nonceDigest,
        signal
      });
      if (
        !gate ||
        typeof gate.wait !== "function" ||
        typeof gate.observeTransactionLifecycle !== "function" ||
        typeof gate.dispose !== "function"
      ) {
        await gate?.dispose?.();
        throw new TypeError(
          "The Postgres cancellation gate is invalid."
        );
      }
      state.postgresCancellationGate = gate;
      state.postgresCancellationGateArmed = true;
      return Object.freeze({
        async wait(input, options) {
          assertActive(state);
          const boundOptions = signal === undefined
            ? options
            : { ...options, signal };
          const result = await gate.wait(input, boundOptions);
          if (result?.state === "query_active") {
            state.postgresCancellationGateQueryActive = true;
          } else if (result?.state === "cancel_settled") {
            state.postgresCancellationGateSettled = true;
          }
          return result;
        }
      });
    },
    async measureStage(stage, operation) {
      assertActive(state);
      if (
        !DRIVER_MEASURED_STAGES.has(stage) ||
        typeof operation !== "function"
      ) {
        throw new TypeError("Invalid staging proof stage measurement.");
      }
      return measure(state, stage, operation);
    },
    measureSynchronousStage(stage, operation) {
      assertActive(state);
      if (
        !DRIVER_MEASURED_STAGES.has(stage) ||
        typeof operation !== "function"
      ) {
        throw new TypeError("Invalid staging proof stage measurement.");
      }
      return measureSynchronously(state, stage, operation);
    },
    instrumentAuthorizer(authorizer) {
      assertActive(state);
      if (!authorizer || typeof authorizer.authorize !== "function") {
        throw new TypeError("The staging proof authorizer is invalid.");
      }
      return Object.freeze({
        async authorize(input) {
          assertActive(state);
          const result = await measure(
            state,
            "authorization",
            () => authorizer.authorize(input)
          );
          if (
            lane === CONTROLLED_LANE &&
            isDevelopmentRouteAuthorizer(authorizer) &&
            result?.authorized === true &&
            typeof result.rateLimitKey === "string" &&
            result.rateLimitKey.length > 0
          ) {
            recordAuthorization(
              state,
              "development_session",
              input?.requestId,
              maximumAuthorizationCount(evaluationCase)
            );
          }
          return result;
        }
      });
    },
    recordDevelopmentAuthorization(durationMilliseconds) {
      assertActive(state);
      if (lane !== CONTROLLED_LANE) {
        throw new TypeError(
          "Live authorization evidence must come from the durable App Attest adapter."
        );
      }
      if (state.authorizationCount !== 0) {
        throw new TypeError("Authorization may be recorded once.");
      }
      state.authorizationCount = 1;
      state.authorizationKind = "development_session";
      recordDuration(state, "authorization", durationMilliseconds);
    },
    recordLegacyFallback() {
      assertActive(state);
      if (lane !== CONTROLLED_LANE) {
        throw new TypeError(
          "Live legacy fallback evidence requires an iOS runtime receipt."
        );
      }
      state.legacyFallbackCount += 1;
      if (state.legacyFallbackCount > 1) {
        throw new TypeError("Legacy fallback may be recorded once.");
      }
    },
    recordRouteQualityEvaluation(durationMilliseconds) {
      assertActive(state);
      if (lane !== CONTROLLED_LANE) {
        throw new TypeError(
          "Live route-quality evidence requires an iOS runtime receipt."
        );
      }
      if (state.routeQualityCount !== 0) {
        throw new TypeError("Route quality may be recorded once.");
      }
      state.routeQualityCount = 1;
      recordDuration(state, "route_quality", durationMilliseconds);
    },
    recordSyntheticEvidenceUsed() {
      assertActive(state);
      state.syntheticEvidenceUsed = true;
    },
    recordSyntheticRoutingUsed() {
      assertActive(state);
      state.syntheticRoutingUsed = true;
    },
    recordRetryFreshness({ staleStateReused }) {
      assertActive(state);
      if (lane !== CONTROLLED_LANE) {
        throw new TypeError(
          "Live retry evidence requires an iOS runtime receipt."
        );
      }
      if (
        state.retryRecorded ||
        typeof staleStateReused !== "boolean"
      ) {
        throw new TypeError("Retry freshness may be recorded once.");
      }
      state.retryRecorded = true;
      state.staleStateReused = staleStateReused;
    },
    ingestVerifiedIOSRuntimeReceipt(verifiedReceipt) {
      assertActive(state);
      if (
        state.iosReceiptObserved ||
        !isVerifiedOutdoorAdventureStagingProofIOSReceiptV1(
          verifiedReceipt
        )
      ) {
        throw new TypeError(
          "A causally verified iOS runtime receipt is required."
        );
      }
      const receipt = verifiedReceipt.receipt;
      if (
        receipt.caseId !== evaluationCase.id ||
        receipt.inputFixtureId !== evaluationCase.input.fixtureId ||
        receipt.lane !== (lane === LIVE_LANE ? "live" : "controlled")
      ) {
        throw new TypeError(
          "The iOS runtime receipt does not match this proof case."
        );
      }
      const capturedAuthorizationDigests =
        verifiedReceipt.capture.executions
          .map((execution) => execution.requestIdDigest)
          .filter((value) => value !== null);
      if (
        evaluationCase.expected.authorization !== "none" &&
        capturedAuthorizationDigests.length > 0 &&
        !sameValue(
          capturedAuthorizationDigests,
          state.authorizationRequestIdDigests
        )
      ) {
        throw new TypeError(
          "The iOS receipt is not bound to observed authorization."
        );
      }
      state.iosReceiptObserved = true;
      state.iosReceipt = receipt;
      state.legacyFallbackCount =
        receipt.legacyRoutingRequestCount;
      for (const stage of [
        "response_conversion",
        "route_quality",
        "end_to_end"
      ]) {
        for (const bucket of receipt.iosStageTimings[stage]) {
          recordTimingBucket(state, stage, bucket);
        }
      }
      if (receipt.iosStageTimings.route_quality.length > 0) {
        state.routeQualityCount = 1;
      }
      if (
        evaluationCase.id ===
          "case-18-retry-does-not-reuse-stale-state"
      ) {
        const retry = receipt.retry;
        state.retryRecorded =
          retry.priorResultDigest !== null &&
          retry.currentResultDigest !== null &&
          retry.priorResultDigest !== retry.currentResultDigest &&
          retry.postResetPlannerTerminalState === "generating" &&
          retry.postResetSuggestionCount === 0 &&
          retry.postResetResearchContextDigest === null &&
          retry.postResetClarificationDigest === null &&
          retry.postResetRecoveryDigest === null &&
          receipt.diagnosticChecks.retryFreshness === "passed";
        state.staleStateReused = !state.retryRecorded;
      }
    },
    causalDependencyFacts() {
      assertActive(state);
      return Object.freeze({
        postgresAbortWhileActive:
          state.postgresAbortWhileActive,
        postgresRollbackAfterAbort:
          state.postgresRollbackAfterAbort,
        graphHopperAbortWhileInFlight:
          state.graphHopperAbortWhileInFlight
      });
    }
  });
}

function recordAppAttestAssertionVerification(state, verification) {
  assertActive(state);
  if (
    typeof verification?.installationId !== "string" ||
    !SHA256_PATTERN.test(verification.installationId) ||
    typeof verification?.keyIdHash !== "string" ||
    !SHA256_PATTERN.test(verification.keyIdHash) ||
    !Number.isInteger(verification?.previousCounter) ||
    !Number.isInteger(verification?.newCounter) ||
    verification.previousCounter < 0 ||
    verification.newCounter <= verification.previousCounter
  ) {
    throw new TypeError(
      "Invalid App Attest assertion verification evidence."
    );
  }
  const count =
    state.verifiedAppAttestInstallations.get(
      verification.installationId
    ) ?? 0;
  if (count >= 2) {
    throw new TypeError(
      "Too many App Attest assertion verification events."
    );
  }
  state.verifiedAppAttestInstallations.set(
    verification.installationId,
    count + 1
  );
}

function consumeVerifiedAppAttestInstallation(
  state,
  installationId
) {
  const count =
    state.verifiedAppAttestInstallations.get(installationId) ?? 0;
  if (count < 1) return undefined;
  if (count === 1) {
    state.verifiedAppAttestInstallations.delete(installationId);
  } else {
    state.verifiedAppAttestInstallations.set(
      installationId,
      count - 1
    );
  }
  return installationId;
}

function instrumentAppAttestRepository(
  repository,
  state,
  maximumAuthorizationCount = 2
) {
  if (repository === undefined || repository === null) return null;
  if (
    !(repository instanceof PostgresAppAttestRepository) ||
    repository.isDurable !== true
  ) {
    throw new TypeError(
      "The staging proof App Attest repository must be the durable Postgres adapter."
    );
  }
  return new Proxy(repository, {
    get(target, property) {
      if (property === "createRouteSession") {
        return async (record) => {
          assertActive(state);
          const result = await target.createRouteSession(record);
          if (
            typeof record?.tokenHash !== "string" ||
            typeof record?.installationId !== "string"
          ) {
            throw new TypeError("Invalid durable route-session creation.");
          }
          const verifiedInstallationId =
            consumeVerifiedAppAttestInstallation(
              state,
              record.installationId
            );
          if (verifiedInstallationId !== undefined) {
            state.createdRouteSessions.set(
              record.tokenHash,
              verifiedInstallationId
            );
          }
          return result;
        };
      }
      if (property === "consumeRouteAccess") {
        return async (input) => {
          assertActive(state);
          const result = await target.consumeRouteAccess(input);
          const createdInstallationId =
            state.createdRouteSessions.get(input?.tokenHash);
          if (
            createdInstallationId !== undefined &&
            result?.installationId === createdInstallationId
          ) {
            recordAuthorization(
              state,
              "app_attest_session",
              input?.requestId,
              maximumAuthorizationCount
            );
          }
          return result;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

function instrumentRepository(repository, state) {
  return Object.freeze({
    async withConsistentSnapshot(...args) {
      assertActive(state);
      if (!repository?.withConsistentSnapshot) {
        throw new TypeError("The proof repository is unavailable.");
      }
      state.repositoryCalls += 1;
      try {
        return await measure(
          state,
          "postgis_evidence",
          () => repository.withConsistentSnapshot(...args)
        );
      } finally {
        state.postgresTransactionActive = false;
      }
    }
  });
}

function instrumentProvider(provider, state) {
  return Object.freeze({
    async route(...args) {
      assertActive(state);
      if (!provider?.route) {
        throw new TypeError("The proof routing provider is unavailable.");
      }
      state.providerCalls += 1;
      const signal = args[1]?.signal;
      let settled = false;
      const observeAbort = () => {
        if (!settled) {
          state.graphHopperAbortWhileInFlight = true;
        }
      };
      signal?.addEventListener?.("abort", observeAbort, {
        once: true
      });
      try {
        return await measure(
          state,
          "graphhopper_attempt",
          () => provider.route(...args)
        );
      } finally {
        settled = true;
        signal?.removeEventListener?.("abort", observeAbort);
      }
    }
  });
}

function evaluateObservation(evaluationCase, observation, state, lane) {
  const errors = [];
  if (!validObservation(observation)) {
    return failedResult(evaluationCase.id, state, lane, [
      "malformed_observation"
    ]);
  }
  if (observation.id !== evaluationCase.id) {
    errors.push("result_id_mismatch");
  }
  if (
    observation.inputFixtureId !== evaluationCase.input.fixtureId ||
    observation.inputDigest !==
      outdoorAdventureStagingProofInputDigestV1(evaluationCase.input)
  ) {
    errors.push("input_fixture_mismatch");
  }
  if (
    !sameValue(
      observation.semanticExpectationIds,
      evaluationCase.expected.semanticExpectationIds
    )
  ) {
    errors.push("semantic_expectation_mismatch");
  }
  if (
    evaluationCase.expected.requiredLimitationCauseIds.some((causeId) =>
      !observation.limitationCauseIds.includes(causeId)
    )
  ) {
    errors.push("limitation_cause_mismatch");
  }
  if (observation.skipped) errors.push("unexpected_skip");
  if (observation.terminalState !== evaluationCase.expected.terminalState) {
    errors.push("terminal_state_mismatch");
  }
  if (
    (
      state.requireIOSRuntimeReceipt ||
      evaluationCase.id ===
        "case-16-malformed-backend-response-rejected-by-ios"
    ) &&
    !state.iosReceiptObserved
  ) {
    errors.push("ios_runtime_receipt_missing");
  }
  if (state.iosReceiptObserved) {
    if (
      state.iosReceipt.proofTerminalState !==
        observation.terminalState
    ) {
      errors.push("terminal_state_mismatch");
    }
    if (
      !sameValue(
        state.iosReceipt.semanticObservationIds,
        observation.semanticExpectationIds
      )
    ) {
      errors.push("semantic_expectation_mismatch");
    }
    if (
      !sameValue(
        state.iosReceipt.limitationCauseIds,
        observation.limitationCauseIds
      )
    ) {
      errors.push("limitation_cause_mismatch");
    }
    if (
      state.authorizationCount !==
        maximumAuthorizationCount(evaluationCase)
    ) {
      errors.push("authorization_mismatch");
    }
    if (
      evaluationCase.id === POSTGRES_CANCELLATION_PROOF_CASE_ID &&
      (
        !state.postgresAbortWhileActive ||
        !state.postgresRollbackAfterAbort ||
        !state.postgresCancellationGateArmed ||
        !state.postgresCancellationGateQueryActive ||
        !state.postgresCancellationGateSettled
      )
    ) {
      errors.push("semantic_expectation_mismatch");
    }
    if (
      evaluationCase.id ===
        "case-14-timeout-during-graphhopper" &&
      !state.graphHopperAbortWhileInFlight
    ) {
      errors.push("limitation_cause_mismatch");
    }
  }

  const evidenceSource = deriveEvidenceSource(state, lane, errors);
  const providerTraffic = deriveProviderTraffic(state, lane, errors);
  const authorization = state.authorizationCount > 0
    ? state.authorizationKind
    : "none";
  const routeQuality = state.routeQualityCount === 1
    ? "evaluated"
    : "not_evaluated";
  const retryFreshness = state.retryRecorded
    ? state.staleStateReused ? "stale" : "fresh"
    : "not_applicable";

  compareClassification(
    evidenceSource,
    evaluationCase.expected.evidenceSource,
    "evidence_source_mismatch",
    errors
  );
  compareClassification(
    providerTraffic,
    evaluationCase.expected.providerTraffic,
    "provider_traffic_mismatch",
    errors
  );
  compareClassification(
    authorization,
    evaluationCase.expected.authorization,
    "authorization_mismatch",
    errors
  );
  compareClassification(
    routeQuality,
    evaluationCase.expected.routeQuality,
    "route_quality_mismatch",
    errors
  );
  compareClassification(
    retryFreshness,
    evaluationCase.expected.retryFreshness,
    "retry_freshness_mismatch",
    errors
  );
  if (
    state.legacyFallbackCount !==
      evaluationCase.expected.legacyFallbackCount
  ) {
    errors.push("legacy_fallback_count_mismatch");
  }

  const responseEvaluation = evaluateResponse(
    observation.response,
    evaluationCase.expected.responseExpectation,
    state,
    errors
  );
  errors.push(...validateCaseCausalFacts(
    evaluationCase,
    observation,
    responseEvaluation.validatedResponse,
    state.iosReceipt
  ));
  const routingSource = deriveRoutingSource(
    state,
    lane,
    responseEvaluation,
    errors,
    evaluationCase
  );
  compareClassification(
    routingSource,
    evaluationCase.expected.routingSource,
    "routing_source_mismatch",
    errors
  );
  if (
    evaluationCase.expected.requiresLinkage &&
    responseEvaluation.validatedResponse
  ) {
    const linkage = validateEvidenceLinkage(
      observation.dossier,
      observation.candidatePlan,
      responseEvaluation.validatedResponse,
      evaluationCase.expected.requiresWaypointVisits
    );
    errors.push(...linkage);
  } else if (
    evaluationCase.expected.requiresLinkage &&
    !responseEvaluation.validatedResponse
  ) {
    errors.push("evidence_linkage_invalid");
  } else {
    validateOptionalCapturedArtifacts(
      observation.dossier,
      observation.candidatePlan,
      errors
    );
  }

  const stageTimings = sanitizedStageTimings(
    state.timings,
    state.timingBuckets
  );
  for (const stage of evaluationCase.expected.requiredStages) {
    if (!Object.hasOwn(stageTimings, stage)) {
      errors.push("stage_timing_missing");
      break;
    }
  }
  const errorCodes = uniqueSorted(errors);
  return Object.freeze({
    id: evaluationCase.id,
    executed: true,
    passed: errorCodes.length === 0,
    skipped: observation.skipped,
    terminalState: observation.terminalState,
    responseState: responseEvaluation.responseState,
    evidenceSource,
    routingSource,
    providerTraffic,
    authorization,
    routeQuality,
    retryFreshness,
    legacyFallbackCount: state.legacyFallbackCount,
    stageTimings,
    errorCodes
  });
}

function evaluateResponse(response, expectation, state, errors) {
  if (expectation === "not_applicable") {
    if (response !== null) errors.push("unexpected_response");
    return { responseState: "none", validatedResponse: null };
  }

  let validatedResponse = null;
  let rejected = false;
  const startedAt = readClock(state);
  try {
    validatedResponse = validateOutdoorAdventurePlanningResponseV1(response);
  } catch {
    rejected = true;
  } finally {
    if (expectation !== "malformed_rejected") {
      recordElapsed(state, "response_validation", startedAt);
    }
  }

  if (expectation === "malformed_rejected") {
    if (!rejected) errors.push("malformed_response_not_rejected");
    return {
      responseState: rejected ? "malformed" : responseState(validatedResponse),
      validatedResponse: null
    };
  }
  if (rejected || !validatedResponse) {
    errors.push("malformed_response");
    return { responseState: "none", validatedResponse: null };
  }

  const stateValue = responseState(validatedResponse);
  if (
    expectation === "routed_alternatives" &&
    (
      !["routed", "partial"].includes(stateValue) ||
      routeResultCount(validatedResponse) < 1
    )
  ) {
    errors.push("response_state_mismatch");
  } else if (
    expectation !== "routed_alternatives" &&
    stateValue !== expectation
  ) {
    errors.push("response_state_mismatch");
  }
  return { responseState: stateValue, validatedResponse };
}

function validateEvidenceLinkage(
  dossierInput,
  candidatePlanInput,
  response,
  requireWaypointVisits
) {
  let dossier;
  let candidatePlan;
  try {
    dossier = validateAdventureResearchDossierV1(dossierInput);
    candidatePlan =
      validateResearchGuidedRouteCandidatePlanV1(candidatePlanInput);
  } catch {
    return ["evidence_linkage_invalid"];
  }
  if (
    !sameValue(dossier.normalizedIntent, candidatePlan.normalizedIntent) ||
    !response.routedAlternatives ||
    !sameValue(
      candidatePlan.normalizedIntent,
      response.routedAlternatives.normalizedIntent
    ) ||
    candidatePlan.proposals.length !==
      response.routedAlternatives.attempts.length
  ) {
    return ["evidence_linkage_invalid"];
  }

  const claimsById = new Map(
    dossier.evidenceClaims.map((claim) => [claim.claimId, claim])
  );
  const highlightsByEntity = new Map(
    dossier.candidateHighlights.map((candidate) => [
      candidate.entityId,
      candidate
    ])
  );
  const networksByEntity = new Map(
    dossier.mappedOrOfficialRouteCandidates.map((candidate) => [
      candidate.entityId,
      candidate
    ])
  );
  let visitedRouteResults = 0;

  for (
    let index = 0;
    index < response.routedAlternatives.attempts.length;
    index += 1
  ) {
    const attempt = response.routedAlternatives.attempts[index];
    const proposal = candidatePlan.proposals[index];
    if (
      attempt.proposalIndex !== index ||
      attempt.provenance.proposalId !== proposal.proposalId ||
      !sameValue(
        attempt.provenance.selectedWaypoints,
        proposal.viaCandidates
      ) ||
      !sameValue(
        attempt.provenance.mappedNetworkCandidates,
        proposal.mappedNetworkCandidates
      ) ||
      !sameValue(
        attempt.provenance.evidenceClaimIds,
        proposal.evidenceClaimIds
      )
    ) {
      return ["provenance_linkage_invalid"];
    }

    for (const waypoint of proposal.viaCandidates) {
      const highlight = highlightsByEntity.get(waypoint.entityId);
      if (
        !highlight ||
        highlight.highlightCategory !== waypoint.highlightCategory ||
        !sameValue(highlight.coordinate, waypoint.coordinate) ||
        waypoint.evidenceClaimIds.some((claimId) =>
          !highlight.evidenceClaimIds.includes(claimId) ||
          claimsById.get(claimId)?.entityId !== waypoint.entityId
        )
      ) {
        return ["evidence_linkage_invalid"];
      }
    }
    for (const mapped of proposal.mappedNetworkCandidates) {
      const dossierCandidate = networksByEntity.get(mapped.entityId);
      if (
        !dossierCandidate ||
        mapped.evidenceClaimIds.some((claimId) =>
          !dossierCandidate.evidenceClaimIds.includes(claimId) ||
          claimsById.get(claimId)?.entityId !== mapped.entityId
        )
      ) {
        return ["evidence_linkage_invalid"];
      }
    }
    for (const routeResult of attempt.routeResults) {
      visitedRouteResults += 1;
      if (
        routeResult.geometryProvider !== "graphhopper" ||
        routeResult.routingStrategy !== "backend"
      ) {
        return ["routing_provenance_invalid"];
      }
      if (
        requireWaypointVisits &&
        routeResult.waypointVisits.some((visit) =>
          visit.role === "via" &&
          (
            visit.snappedCoordinate === null ||
            visit.snapDistanceMeters === null ||
            visit.withinVisitTolerance !== true
          )
        )
      ) {
        return ["waypoint_visit_invalid"];
      }
    }
  }
  if (visitedRouteResults === 0) return ["evidence_linkage_invalid"];
  return validateEvidenceSourceLineage(
    dossier,
    candidatePlan,
    claimsById
  );
}

function validateEvidenceSourceLineage(dossier, candidatePlan, claimsById) {
  if (dossier.freshnessState !== "current") {
    return ["evidence_source_lineage_invalid"];
  }
  const summariesBySource = new Map(
    dossier.sourceProvenanceSummary.map((summary) => [
      summary.sourceId,
      summary
    ])
  );
  const usedClaimIds = new Set(
    candidatePlan.proposals.flatMap((proposal) => proposal.evidenceClaimIds)
  );
  for (const claimId of usedClaimIds) {
    const claim = claimsById.get(claimId);
    const summary = claim
      ? summariesBySource.get(claim.sourceReference.sourceId)
      : null;
    if (
      !claim ||
      claim.freshness !== "current" ||
      typeof claim.provenance.identifier !== "string" ||
      claim.provenance.identifier.length === 0 ||
      typeof claim.provenance.adapterVersion !== "string" ||
      claim.provenance.adapterVersion.length === 0 ||
      claim.provenance.recordVersion === null ||
      !summary ||
      summary.sourceKey !== claim.sourceReference.sourceKey ||
      summary.sourceCategory !== claim.sourceReference.sourceCategory ||
      !summary.evidenceClasses.includes(claim.evidenceClass) ||
      typeof summary.licenseIdentifier !== "string" ||
      summary.licenseIdentifier.length === 0 ||
      typeof summary.attributionRequired !== "boolean" ||
      (
        summary.sourceCategory === "openstreetmap_open_mapping" &&
        summary.attributionRequired !== true
      ) ||
      summary.retrievedAt === null
    ) {
      return ["evidence_source_lineage_invalid"];
    }
  }
  return [];
}

function validateOptionalCapturedArtifacts(dossier, candidatePlan, errors) {
  if (dossier !== null) {
    try {
      validateAdventureResearchDossierV1(dossier);
    } catch {
      errors.push("captured_dossier_invalid");
    }
  }
  if (candidatePlan !== null) {
    try {
      validateResearchGuidedRouteCandidatePlanV1(candidatePlan);
    } catch {
      errors.push("captured_candidate_plan_invalid");
    }
  }
}

function validateCaseCausalFacts(
  evaluationCase,
  observation,
  response,
  iosReceipt
) {
  const errors = [];
  const requiredCauses =
    evaluationCase.expected.requiredLimitationCauseIds;
  if (
    requiredCauses.includes("access_unverified") &&
    !response?.routedAlternatives?.remainingLimitations?.includes(
      "access_unverified"
    )
  ) {
    errors.push("limitation_cause_mismatch");
  }
  if (
    requiredCauses.includes("official_status_unverified") &&
    !response?.routedAlternatives?.remainingLimitations?.includes(
      "official_status_unverified"
    )
  ) {
    errors.push("limitation_cause_mismatch");
  }
  if (
    evaluationCase.id ===
      "case-04-harz-brocken-must-have-landmark"
  ) {
    errors.push(...validateBrockenPeakProof(
      observation.dossier,
      observation.candidatePlan,
      response
    ));
  }
  if (
    evaluationCase.id ===
      "case-05-harz-unsatisfied-must-have-highlight" &&
    !hasInsufficientLandmarkCandidateProof(
      observation.dossier,
      observation.candidatePlan,
      response
    )
  ) {
    errors.push("limitation_cause_mismatch");
  }
  if (
    evaluationCase.id ===
      "case-15-partial-provider-failure-survivor"
  ) {
    const attempts =
      response?.routedAlternatives?.attempts ?? [];
    if (
      !attempts.some((attempt) => attempt.state === "failed") ||
      !attempts.some((attempt) =>
        attempt.state === "routed" &&
        attempt.routeResults.length > 0
      )
    ) {
      errors.push("limitation_cause_mismatch");
    }
  }
  if (
    evaluationCase.id ===
      "case-18-retry-does-not-reuse-stale-state" &&
    (
      iosReceipt?.retry.priorTerminalState !== "no_routes" ||
      iosReceipt?.retry.currentTerminalState !== "suggestions_ready" ||
      iosReceipt?.retry.priorResultDigest === null ||
      iosReceipt?.retry.currentResultDigest === null ||
      iosReceipt?.retry.priorResultDigest ===
        iosReceipt?.retry.currentResultDigest ||
      iosReceipt?.retry.postResetPlannerTerminalState !== "generating" ||
      iosReceipt?.retry.postResetSuggestionCount !== 0 ||
      iosReceipt?.retry.postResetResearchContextDigest !== null ||
      iosReceipt?.retry.postResetClarificationDigest !== null ||
      iosReceipt?.retry.postResetRecoveryDigest !== null ||
      iosReceipt?.legacyRoutingRequestCount !== 1
    )
  ) {
    errors.push("retry_freshness_mismatch");
  }
  return errors;
}

function validateBrockenPeakProof(dossier, candidatePlan, response) {
  const routed = response?.routedAlternatives;
  const normalizedIntent = routed?.normalizedIntent;
  const anchor = normalizedIntent?.geographicAnchor;
  if (
    anchor?.state !== "resolved" ||
    anchor.name !== "Brocken" ||
    !normalizedIntent.mustHaveExperiences?.some((requirement) =>
      requirement.experience === "peak" &&
      requirement.minimumCount >= 1
    ) ||
    !Array.isArray(candidatePlan?.proposals) ||
    candidatePlan.proposals.length === 0
  ) {
    return ["semantic_expectation_mismatch"];
  }
  const claimsById = new Map(
    (dossier?.evidenceClaims ?? []).map((claim) => [
      claim.claimId,
      claim
    ])
  );
  const namedBrockenCandidates = new Map(
    (dossier?.candidateHighlights ?? [])
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
  if (namedBrockenCandidates.size === 0) {
    return ["semantic_expectation_mismatch"];
  }
  for (let index = 0; index < candidatePlan.proposals.length; index += 1) {
    const proposal = candidatePlan.proposals[index];
    const attempt = routed.attempts[index];
    const peakCandidates = proposal.viaCandidates.filter(
      (candidate) =>
        candidate.highlightCategory === "peak" &&
        candidate.role === "must_have" &&
        namedBrockenCandidates.has(candidate.entityId) &&
        sameValue(
          candidate.coordinate,
          namedBrockenCandidates.get(candidate.entityId)
        )
    );
    if (
      peakCandidates.length < 1 ||
      !proposal.satisfiedRequirements.some((requirement) =>
        requirement.requirementType === "must_have_experience" &&
        requirement.value === "peak" &&
        requirement.includedCount >= 1 &&
        requirement.shortfallCount === 0
      ) ||
      !attempt ||
      attempt.state !== "routed"
    ) {
      return ["semantic_expectation_mismatch"];
    }
    const peakEntities = new Map(
      peakCandidates.map((candidate) => [
        candidate.entityId,
        candidate.coordinate
      ])
    );
    for (const result of attempt.routeResults) {
      const anchorVisits = result.waypointVisits.filter((visit) =>
        visit.role === "anchor" ||
        visit.role === "return_anchor"
      );
      if (
        anchorVisits.length !== 2 ||
        anchorVisits.some((visit) =>
          visit.snappedCoordinate === null ||
          visit.snapDistanceMeters === null ||
          visit.withinVisitTolerance !== true ||
          !sameValue(
            visit.requestedCoordinate,
            anchor.coordinate
          )
        ) ||
        !result.waypointVisits.some((visit) =>
          visit.role === "via" &&
          peakEntities.has(visit.entityId) &&
          sameValue(
            visit.requestedCoordinate,
            peakEntities.get(visit.entityId)
          ) &&
          visit.snappedCoordinate !== null &&
          visit.snapDistanceMeters !== null &&
          visit.withinVisitTolerance === true
        )
      ) {
        return ["waypoint_visit_invalid"];
      }
    }
  }
  return [];
}

function hasInsufficientLandmarkCandidateProof(
  dossier,
  candidatePlan,
  response
) {
  const gapMatches = (gap) =>
    gap?.code === "insufficient_candidate_count" &&
    gap.experience === "landmark" &&
    gap.requiredMinimumCount >= 1 &&
    gap.foundCount < gap.requiredMinimumCount;
  return response?.state === "no_viable_route" &&
    dossier?.evidenceGaps?.some(gapMatches) === true &&
    candidatePlan?.state === "insufficient_evidence" &&
    candidatePlan.proposals?.length === 0 &&
    candidatePlan.evidenceGaps?.some(gapMatches) === true;
}

function deriveEvidenceSource(state, lane, errors) {
  if (state.syntheticEvidenceUsed && state.repositoryCalls > 0) {
    errors.push("mixed_evidence_sources");
  }
  if (state.syntheticEvidenceUsed) return "synthetic";
  if (state.repositoryCalls === 0) return "none";
  return lane === LIVE_LANE ? "real_postgis" : "synthetic";
}

function deriveProviderTraffic(state, lane, errors) {
  if (
    state.syntheticRoutingUsed &&
    state.providerCalls > 0
  ) {
    errors.push("mixed_routing_sources");
  }
  if (state.syntheticRoutingUsed) return "synthetic_attempted";
  if (state.providerCalls === 0) return "none";
  return lane === LIVE_LANE ? "live_attempted" : "synthetic_attempted";
}

function deriveRoutingSource(
  state,
  lane,
  responseEvaluation,
  errors,
  evaluationCase
) {
  const routedResults =
    responseEvaluation.validatedResponse === null
      ? 0
      : routeResultCount(responseEvaluation.validatedResponse);
  const terminalRetry =
    evaluationCase.expected.terminalState === "retry_succeeded" &&
    state.retryRecorded &&
    state.staleStateReused === false;
  if (
    state.syntheticRoutingUsed &&
    (state.providerCalls > 0 || state.legacyFallbackCount > 0)
  ) {
    errors.push("mixed_routing_sources");
  }
  if (state.syntheticRoutingUsed) return "synthetic";
  if (state.legacyFallbackCount > 0) {
    if (routedResults === 0) return "legacy_fallback";
    if (!terminalRetry) {
      errors.push("mixed_routing_sources");
      return "legacy_fallback";
    }
  }
  if (state.providerCalls === 0) return "none";
  if (
    !responseEvaluation.validatedResponse ||
    routedResults < 1
  ) {
    return "none";
  }
  return lane === LIVE_LANE ? "real_graphhopper" : "synthetic";
}

function validObservation(input) {
  return exactObject(input, OBSERVATION_FIELDS) &&
    typeof input.id === "string" &&
    typeof input.inputFixtureId === "string" &&
    typeof input.inputDigest === "string" &&
    SHA256_PATTERN.test(input.inputDigest) &&
    validVocabularyArray(
      input.semanticExpectationIds,
      SEMANTIC_EXPECTATION_ID_SET
    ) &&
    validVocabularyArray(
      input.limitationCauseIds,
      LIMITATION_CAUSE_ID_SET
    ) &&
    TERMINAL_STATE_SET.has(input.terminalState) &&
    !["not_run", "failed"].includes(input.terminalState) &&
    typeof input.skipped === "boolean";
}

function failedResult(id, state, lane, errorCodes) {
  return Object.freeze({
    id,
    executed: true,
    passed: false,
    skipped: false,
    terminalState: "failed",
    responseState: "none",
    evidenceSource: deriveEvidenceSource(state, lane, errorCodes),
    routingSource: "none",
    providerTraffic: deriveProviderTraffic(state, lane, errorCodes),
    authorization: "none",
    routeQuality: "not_evaluated",
    retryFreshness: "not_applicable",
    legacyFallbackCount: state.legacyFallbackCount,
    stageTimings: sanitizedStageTimings(
      state.timings,
      state.timingBuckets
    ),
    errorCodes: uniqueSorted(errorCodes)
  });
}

function responseState(response) {
  if (response.state === "clarification_required") return "clarification";
  return response.state;
}

function routeResultCount(response) {
  return response.routedAlternatives?.attempts.reduce(
    (total, attempt) => total + attempt.routeResults.length,
    0
  ) ?? 0;
}

function sanitizedStageTimings(timings, timingBuckets) {
  return Object.freeze(Object.fromEntries(
    OUTDOOR_ADVENTURE_STAGING_PROOF_STAGE_NAMES_V1
      .filter((stage) =>
        timings.has(stage) || timingBuckets.has(stage)
      )
      .map((stage) => [
        stage,
        Object.freeze([
          ...(timings.get(stage) ?? []).map(timingBucket),
          ...(timingBuckets.get(stage) ?? [])
        ])
      ])
  ));
}

async function measure(state, stage, operation) {
  if (!STAGE_NAME_SET.has(stage) || typeof operation !== "function") {
    throw new TypeError("Invalid staging proof measurement.");
  }
  const startedAt = readClock(state);
  try {
    return await operation();
  } finally {
    recordElapsed(state, stage, startedAt);
  }
}

function measureSynchronously(state, stage, operation) {
  if (!STAGE_NAME_SET.has(stage) || typeof operation !== "function") {
    throw new TypeError("Invalid staging proof measurement.");
  }
  const startedAt = readClock(state);
  try {
    const result = operation();
    if (result && typeof result.then === "function") {
      throw new TypeError(
        "A synchronous staging proof stage returned a promise."
      );
    }
    return result;
  } finally {
    recordElapsed(state, stage, startedAt);
  }
}

function recordElapsed(state, stage, startedAt) {
  recordDuration(state, stage, Math.max(0, readClock(state) - startedAt));
}

function recordDuration(state, stage, durationMilliseconds) {
  if (
    !STAGE_NAME_SET.has(stage) ||
    typeof durationMilliseconds !== "number" ||
    !Number.isFinite(durationMilliseconds) ||
    durationMilliseconds < 0 ||
    durationMilliseconds > 3_600_000
  ) {
    throw new TypeError("Invalid staging proof duration.");
  }
  const values = state.timings.get(stage) ?? [];
  if (values.length >= 8) {
    throw new TypeError("Too many staging proof stage measurements.");
  }
  values.push(durationMilliseconds);
  state.timings.set(stage, values);
}

function recordTimingBucket(state, stage, bucket) {
  if (
    !STAGE_NAME_SET.has(stage) ||
    !OUTDOOR_ADVENTURE_STAGING_PROOF_TIMING_BUCKETS_V1.includes(
      bucket
    )
  ) {
    throw new TypeError("Invalid staging proof timing bucket.");
  }
  const values = state.timingBuckets.get(stage) ?? [];
  if (values.length >= 8) {
    throw new TypeError("Too many staging proof stage measurements.");
  }
  values.push(bucket);
  state.timingBuckets.set(stage, values);
}

function recordAuthorization(
  state,
  kind,
  requestId,
  maximumCount
) {
  if (
    !["app_attest_session", "development_session"].includes(kind) ||
    !Number.isInteger(maximumCount) ||
    maximumCount < 1 ||
    maximumCount > 2 ||
    typeof requestId !== "string" ||
    !UUID_PATTERN.test(requestId)
  ) {
    throw new TypeError("Invalid staging proof authorization.");
  }
  const requestIdDigest = sha256(requestId.toLowerCase());
  if (
    state.authorizationCount >= maximumCount ||
    (
      state.authorizationKind !== "none" &&
      state.authorizationKind !== kind
    ) ||
    state.authorizationRequestIdDigests.includes(requestIdDigest)
  ) {
    throw new TypeError(
      "Staging proof authorization is duplicated or out of bounds."
    );
  }
  state.authorizationCount += 1;
  state.authorizationKind = kind;
  state.authorizationRequestIdDigest = requestIdDigest;
  state.authorizationRequestIdDigests.push(requestIdDigest);
}

function recordPostgresTransactionLifecycle(state, event) {
  if (!state.active) return;
  if (event === "began") {
    state.postgresTransactionActive = true;
    return;
  }
  if (
    event === "query_cancelled_after_abort" &&
    state.postgresTransactionActive
  ) {
    state.postgresAbortWhileActive = true;
    return;
  }
  if (
    event === "rollback_completed_after_cancel" &&
    state.postgresAbortWhileActive
  ) {
    state.postgresRollbackAfterAbort = true;
    state.postgresTransactionActive = false;
  }
}

function maximumAuthorizationCount(evaluationCase) {
  if (evaluationCase?.expected?.authorization === "none") return 0;
  return evaluationCase?.id ===
    "case-18-retry-does-not-reuse-stale-state"
    ? 2
    : 1;
}

function readClock(state) {
  const value = state.now();
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("The staging proof clock is invalid.");
  }
  return value;
}

function timingBucket(milliseconds) {
  if (milliseconds < 100) return "under_100ms";
  if (milliseconds < 500) return "100ms_to_499ms";
  if (milliseconds < 1_000) return "500ms_to_999ms";
  if (milliseconds < 5_000) return "1s_to_4s";
  if (milliseconds < 15_000) return "5s_to_14s";
  return "15s_or_more";
}

function compareClassification(actual, expected, errorCode, errors) {
  if (actual !== expected) errors.push(errorCode);
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
  return JSON.stringify(sortKeys(left)) === JSON.stringify(sortKeys(right));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])])
  );
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function validVocabularyArray(input, vocabulary) {
  return Array.isArray(input) &&
    input.length <= vocabulary.size &&
    input.every((value) => vocabulary.has(value)) &&
    new Set(input).size === input.length &&
    sameValue(input, [...input].sort());
}

function assertActive(state) {
  if (!state.active) {
    throw new TypeError("The staging proof case has completed.");
  }
}

function sha256(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Invalid staging proof digest input.");
  }
  return createHash("sha256").update(value, "utf8").digest("hex");
}

for (const vocabulary of [
  OUTDOOR_ADVENTURE_STAGING_PROOF_RESPONSE_STATES_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_EVIDENCE_SOURCES_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_ROUTING_SOURCES_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_PROVIDER_TRAFFIC_STATES_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_AUTHORIZATION_STATES_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_ROUTE_QUALITY_STATES_V1,
  OUTDOOR_ADVENTURE_STAGING_PROOF_RETRY_FRESHNESS_STATES_V1
]) {
  if (!Object.isFrozen(vocabulary)) {
    throw new TypeError("Staging proof vocabulary must be immutable.");
  }
}
