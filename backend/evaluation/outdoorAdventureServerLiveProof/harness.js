import { createHash, randomUUID } from "node:crypto";
import {
  open,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { performance } from "node:perf_hooks";
import {
  assembleAdventureResearchDossierV1
} from "../../src/outdoorResearch/dossierAssembler.js";
import {
  researchOutdoorAdventureV1
} from "../../src/outdoorResearch/outdoorResearchExecutor.js";
import {
  buildResearchGuidedRouteCandidatePlanV1
} from "../../src/routeResearch/researchGuidedRouteCandidatePlanner.js";
import {
  routeResearchGuidedCandidatesV1
} from "../../src/routeResearch/researchGuidedRoutingAdapter.js";
import {
  validateResearchGuidedRoutedAlternativesV1
} from "../../src/routeResearch/routedAlternativesContract.js";
import {
  validateResearchGuidedRouteCandidatePlanV1
} from "../../src/routeResearch/validation.js";
import {
  planAndRouteOutdoorAdventureV1
} from "../../src/outdoorAdventure/outdoorAdventureOrchestrator.js";
import {
  createGraphHopperProvider,
  providerConfiguration
} from "../../src/routing/graphHopperProvider.js";
import { routeError } from "../../src/routing/routeErrors.js";
import {
  SERVER_LIVE_PROOF_CASE_IDS,
  SERVER_LIVE_PROOF_CLASSIFICATION,
  SERVER_LIVE_PROOF_FEATURE_FLAGS,
  SERVER_LIVE_PROOF_PROVIDER_CALL_LIMIT,
  SERVER_LIVE_PROOF_SCHEMA_VERSION,
  safeProofDigestV1,
  serverLiveProofCanonicalIntentV1,
  serverLiveProofRegionForCaseIdV1,
  stableSerialize,
  validateServerLiveProofPublishedSummaryV1
} from "./manifest.js";
import {
  evaluateServerLiveRouteQualityV1,
  redactQualityGeometryV1
} from "./quality.js";

const OFFICIAL_GRAPHHOPPER_BASE_URL = "https://graphhopper.com/api/1";
const REGION_IDS = Object.freeze(["harz-v1", "innsbruck-alps-v1"]);

export class ServerLiveProofError extends Error {
  constructor(code, options = {}) {
    super(code, options);
    this.name = "ServerLiveProofError";
    this.code = code;
  }
}

export async function runServerLivePipelineProofV1({
  cases,
  pool,
  repository,
  env,
  usageLedgerPath,
  outputPath,
  acquisitionMetadata,
  officialSummary,
  priorSummary = null,
  finalize = false,
  diagnosticMode = false,
  maximumProposals = 3,
  providerCallLimit = SERVER_LIVE_PROOF_PROVIDER_CALL_LIMIT,
  maximumConcurrency = 2,
  minimumProviderSpacingMilliseconds = 0,
  consecutiveImmediateFailureLimit = 0,
  immediateFailureThresholdMilliseconds = 1_000,
  graphHopperAttemptTimeoutMs = 8_000,
  totalDeadlineMs = 25_000,
  validatePublishedSummary = true,
  signal,
  now = () => new Date(),
  fetchImpl = globalThis.fetch
}) {
  validateRunDependencies({
    cases,
    pool,
    repository,
    env,
    usageLedgerPath,
    outputPath,
    acquisitionMetadata,
    officialSummary,
    priorSummary,
    diagnosticMode,
    signal,
    fetchImpl
  });
  if (
    !Number.isInteger(maximumProposals) ||
    maximumProposals < 1 ||
    maximumProposals > 3 ||
    !Number.isInteger(providerCallLimit) ||
    providerCallLimit < 1 ||
    providerCallLimit > SERVER_LIVE_PROOF_PROVIDER_CALL_LIMIT ||
    !Number.isInteger(maximumConcurrency) ||
    maximumConcurrency < 1 ||
    maximumConcurrency > 2 ||
    !Number.isInteger(minimumProviderSpacingMilliseconds) ||
    minimumProviderSpacingMilliseconds < 0 ||
    minimumProviderSpacingMilliseconds > 60_000 ||
    !Number.isInteger(consecutiveImmediateFailureLimit) ||
    consecutiveImmediateFailureLimit < 0 ||
    consecutiveImmediateFailureLimit > 3 ||
    !Number.isInteger(immediateFailureThresholdMilliseconds) ||
    immediateFailureThresholdMilliseconds < 1 ||
    immediateFailureThresholdMilliseconds > 10_000 ||
    !Number.isInteger(graphHopperAttemptTimeoutMs) ||
    graphHopperAttemptTimeoutMs < 1_000 ||
    graphHopperAttemptTimeoutMs > 30_000 ||
    !Number.isInteger(totalDeadlineMs) ||
    totalDeadlineMs < 1_000 ||
    totalDeadlineMs > 45_000 ||
    typeof validatePublishedSummary !== "boolean"
  ) {
    throw new ServerLiveProofError("invalid_run_dependencies");
  }
  const generatedAt = now();
  const configuration = providerConfiguration(env);
  if (configuration.baseUrl !== OFFICIAL_GRAPHHOPPER_BASE_URL) {
    throw new ServerLiveProofError("non_official_provider_base_url");
  }
  const ledger = new ProviderUsageLedgerV1(usageLedgerPath, {
    limit: providerCallLimit
  });
  const providerSchedule = new ProviderCallScheduleV1({
    minimumSpacingMilliseconds: minimumProviderSpacingMilliseconds,
    consecutiveImmediateFailureLimit,
    immediateFailureThresholdMilliseconds
  });
  await ledger.initialize();
  let ledgerClosed = false;
  try {
    const initialLedger = await ledger.snapshot();
    validateServerLiveProofLedgerContinuityV1({
      cases,
      priorSummary,
      diagnosticMode,
      maximumProposals,
      ledger: initialLedger
    });
    if (signal?.aborted) throw new ServerLiveProofError("cancelled");
    const evidence = await inspectRealEvidence(pool, generatedAt);
    const priorCases = (priorSummary?.cases ?? []).map(
      reassessSanitizedCaseReceiptV1
    );
    const duplicate = cases.find((item) =>
      priorCases.some((prior) => prior.caseId === item.id)
    );
    if (duplicate) throw new ServerLiveProofError("duplicate_case_execution");

    const currentCases = [];
    for (const evaluationCase of cases) {
      if (providerSchedule.stopped) break;
      if (signal?.aborted) throw new ServerLiveProofError("cancelled");
      currentCases.push(await executeCase({
        evaluationCase,
        repository,
        env,
        ledger,
        fetchImpl,
        maximumProposals,
        maximumConcurrency,
        graphHopperAttemptTimeoutMs,
        totalDeadlineMs,
        providerSchedule,
        signal
      }));
      if (providerSchedule.stopped) break;
    }
    const allCases = [...priorCases, ...currentCases].sort((left, right) =>
      SERVER_LIVE_PROOF_CASE_IDS.indexOf(left.caseId) -
        SERVER_LIVE_PROOF_CASE_IDS.indexOf(right.caseId)
    );
    const ledgerSnapshot = await ledger.snapshot();
    const summary = buildSummary({
      generatedAt,
      allCases,
      evidence,
      acquisitionMetadata,
      officialSummary,
      ledgerSnapshot,
      finalize,
      env,
      providerCallLimit,
      maximumConcurrency,
      minimumProviderSpacingMilliseconds,
      providerSchedule
    });
    if (validatePublishedSummary) {
      validateServerLiveProofPublishedSummaryV1(summary);
    }
    await ledger.close();
    ledgerClosed = true;
    await atomicWrite(outputPath, `${stableSerialize(summary)}\n`);
    return summary;
  } finally {
    if (!ledgerClosed) await ledger.close();
  }
}

export class ProviderUsageLedgerV1 {
  constructor(path, options = {}) {
    if (typeof path !== "string" || path.length < 1) {
      throw new ServerLiveProofError("invalid_usage_ledger");
    }
    this.path = path;
    this.limit = Number.isInteger(options.limit)
      ? options.limit
      : SERVER_LIVE_PROOF_PROVIDER_CALL_LIMIT;
    if (this.limit < 1 || this.limit > SERVER_LIVE_PROOF_PROVIDER_CALL_LIMIT) {
      throw new ServerLiveProofError("invalid_usage_ledger");
    }
    this.lockPath = `${path}.lock`;
    this.lockHandle = null;
    this.queue = Promise.resolve();
  }

  async initialize() {
    if (this.lockHandle !== null) {
      throw new ServerLiveProofError("invalid_usage_ledger");
    }
    try {
      this.lockHandle = await open(this.lockPath, "wx", 0o600);
    } catch {
      throw new ServerLiveProofError("invalid_usage_ledger");
    }
    try {
      validateLedger(JSON.parse(await readFile(this.path, "utf8")), this.limit);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        await this.close().catch(() => {});
        if (error instanceof ServerLiveProofError) throw error;
        throw new ServerLiveProofError("invalid_usage_ledger");
      }
      try {
        await atomicWrite(this.path, `${stableSerialize(emptyLedger(this.limit))}\n`);
      } catch (writeError) {
        await this.close().catch(() => {});
        throw writeError;
      }
    }
  }

  async close() {
    await this.queue;
    const handle = this.lockHandle;
    if (handle === null) return;
    this.lockHandle = null;
    let failure = null;
    try {
      await handle.close();
    } catch (error) {
      failure = error;
    }
    try {
      await unlink(this.lockPath);
    } catch (error) {
      failure ??= error;
    }
    if (failure) {
      throw new ServerLiveProofError("invalid_usage_ledger", {
        cause: failure
      });
    }
  }

  async reserve({ caseId, callDigest, requestedWaypointCount }) {
    return this.#mutate((ledger) => {
      if (ledger.calls.length >= this.limit) {
        throw new ServerLiveProofError("provider_call_limit_reached");
      }
      const callId = ledger.calls.length + 1;
      ledger.calls.push({
        callId,
        caseId,
        callDigest,
        requestedWaypointCount,
        outcome: "in_flight",
        pipelineDisposition: "pending",
        errorCode: null,
        responseBytes: null,
        latencyMilliseconds: null,
        returnedPathCount: 0,
        routeMetrics: []
      });
      return callId;
    });
  }

  async complete(callId, fields) {
    return this.#mutate((ledger) => {
      const call = ledger.calls.find((item) => item.callId === callId);
      if (!call || call.outcome !== "in_flight") {
        throw new ServerLiveProofError("invalid_usage_ledger_transition");
      }
      Object.assign(call, fields);
      return structuredClone(call);
    });
  }

  async snapshot() {
    await this.queue;
    return this.#read();
  }

  #mutate(operation) {
    const scheduled = this.queue.then(async () => {
      const ledger = await this.#read();
      const result = operation(ledger);
      validateLedger(ledger, this.limit);
      await atomicWrite(this.path, `${stableSerialize(ledger)}\n`);
      return result;
    });
    this.queue = scheduled.catch(() => {});
    return scheduled;
  }

  async #read() {
    let value;
    try {
      value = JSON.parse(await readFile(this.path, "utf8"));
    } catch {
      throw new ServerLiveProofError("invalid_usage_ledger");
    }
    validateLedger(value, this.limit);
    return value;
  }
}

export class ProviderCallScheduleV1 {
  constructor({
    minimumSpacingMilliseconds = 0,
    consecutiveImmediateFailureLimit = 0,
    immediateFailureThresholdMilliseconds = 1_000,
    nowMilliseconds = () => Date.now(),
    sleep = wait
  } = {}) {
    if (
      !Number.isInteger(minimumSpacingMilliseconds) ||
      minimumSpacingMilliseconds < 0 ||
      minimumSpacingMilliseconds > 60_000 ||
      !Number.isInteger(consecutiveImmediateFailureLimit) ||
      consecutiveImmediateFailureLimit < 0 ||
      consecutiveImmediateFailureLimit > 3 ||
      !Number.isInteger(immediateFailureThresholdMilliseconds) ||
      immediateFailureThresholdMilliseconds < 1 ||
      immediateFailureThresholdMilliseconds > 10_000 ||
      typeof nowMilliseconds !== "function" ||
      typeof sleep !== "function"
    ) {
      throw new ServerLiveProofError("invalid_run_dependencies");
    }
    this.minimumSpacingMilliseconds = minimumSpacingMilliseconds;
    this.consecutiveImmediateFailureLimit =
      consecutiveImmediateFailureLimit;
    this.immediateFailureThresholdMilliseconds =
      immediateFailureThresholdMilliseconds;
    this.nowMilliseconds = nowMilliseconds;
    this.sleep = sleep;
    this.nextEligibleAt = 0;
    this.consecutiveImmediateFailureCode = null;
    this.consecutiveImmediateFailureCount = 0;
    this.stopped = false;
    this.stopReason = null;
  }

  async beforeCall(signal) {
    if (this.stopped) {
      throw new ServerLiveProofError("provider_batch_stopped");
    }
    const delay = Math.max(0, this.nextEligibleAt - this.nowMilliseconds());
    if (delay > 0) await this.sleep(delay);
    if (signal?.aborted) throw new ServerLiveProofError("cancelled");
    if (this.stopped) {
      throw new ServerLiveProofError("provider_batch_stopped");
    }
  }

  observe({ outcome, errorCode, latencyMilliseconds, retryAfterMilliseconds }) {
    const now = this.nowMilliseconds();
    const retryDelay = boundedRetryAfterMilliseconds(retryAfterMilliseconds);
    this.nextEligibleAt = Math.max(
      now + this.minimumSpacingMilliseconds,
      retryDelay === null ? 0 : now + retryDelay
    );
    if (outcome === "success") {
      this.consecutiveImmediateFailureCode = null;
      this.consecutiveImmediateFailureCount = 0;
      return;
    }
    const immediate = outcome === "failed" &&
      typeof errorCode === "string" &&
      Number.isFinite(latencyMilliseconds) &&
      latencyMilliseconds <= this.immediateFailureThresholdMilliseconds;
    if (!immediate) {
      this.consecutiveImmediateFailureCode = null;
      this.consecutiveImmediateFailureCount = 0;
      return;
    }
    if (this.consecutiveImmediateFailureCode === errorCode) {
      this.consecutiveImmediateFailureCount += 1;
    } else {
      this.consecutiveImmediateFailureCode = errorCode;
      this.consecutiveImmediateFailureCount = 1;
    }
    if (
      this.consecutiveImmediateFailureLimit > 0 &&
      this.consecutiveImmediateFailureCount >=
        this.consecutiveImmediateFailureLimit
    ) {
      this.stopped = true;
      this.stopReason = "repeated_immediate_provider_failure";
    }
  }
}

export function createMeteredGraphHopperProviderV1({
  caseId,
  controlledFailureAfterFirstSuccess,
  env,
  ledger,
  fetchImpl,
  providerSchedule = null
}) {
  let caseCallOrdinal = 0;
  return Object.freeze({
    async route(request, context = {}) {
      caseCallOrdinal += 1;
      const ordinal = caseCallOrdinal;
      await providerSchedule?.beforeCall(context.signal);
      const callDigest = safeProofDigestV1({
        caseId,
        ordinal,
        requestPointCount: request.points.length,
        requestPointDigest: createHash("sha256")
          .update(request.points.map((point) =>
            `${point.latitude.toFixed(7)}:${point.longitude.toFixed(7)}`
          ).join("|"))
          .digest("hex")
      }, "call");
      const callId = await ledger.reserve({
        caseId,
        callDigest,
        requestedWaypointCount: request.points.length
      });
      const startedAt = performance.now();
      let responseBytes = null;
      let retryAfterMilliseconds = null;
      const provider = createGraphHopperProvider({
        env,
        fetchImpl: async (url, init) => {
          const response = await fetchImpl(url, init);
          retryAfterMilliseconds = retryAfterFromHeaders(response.headers);
          const bytes = await response.arrayBuffer();
          responseBytes = bytes.byteLength;
          return new Response(bytes, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        }
      });
      try {
        const result = await provider.route(request, context);
        const latencyMilliseconds = performance.now() - startedAt;
        const controlledFailure =
          controlledFailureAfterFirstSuccess && ordinal === 1;
        await ledger.complete(callId, {
          outcome: "success",
          pipelineDisposition: controlledFailure
            ? "controlled_failure_after_success"
            : "returned_to_pipeline",
          errorCode: null,
          responseBytes,
          latencyMilliseconds: coarseMilliseconds(latencyMilliseconds),
          returnedPathCount: result.paths.length,
          routeMetrics: result.paths.map((path) => ({
            distanceKm: round(path.distance / 1_000, 3),
            durationMinutes: round(path.time / 60_000, 1),
            ascentMeters: round(path.ascend ?? 0, 1),
            descentMeters: round(path.descend ?? 0, 1)
          }))
        });
        providerSchedule?.observe({
          outcome: "success",
          errorCode: null,
          latencyMilliseconds,
          retryAfterMilliseconds
        });
        if (controlledFailure) throw routeError("routing_unavailable");
        return result;
      } catch (error) {
        const snapshot = await ledger.snapshot();
        const active = snapshot.calls.find((item) => item.callId === callId);
        if (active?.outcome === "in_flight") {
          const latencyMilliseconds = performance.now() - startedAt;
          const outcome = providerOutcome(error, context.signal);
          const errorCode = safeProviderErrorCode(error);
          await ledger.complete(callId, {
            outcome,
            pipelineDisposition: "provider_error",
            errorCode,
            responseBytes,
            latencyMilliseconds: coarseMilliseconds(latencyMilliseconds),
            returnedPathCount: 0,
            routeMetrics: []
          });
          providerSchedule?.observe({
            outcome,
            errorCode,
            latencyMilliseconds,
            retryAfterMilliseconds
          });
        }
        throw error;
      }
    }
  });
}

async function executeCase({
  evaluationCase,
  repository,
  env,
  ledger,
  fetchImpl,
  maximumProposals,
  maximumConcurrency,
  graphHopperAttemptTimeoutMs,
  totalDeadlineMs,
  providerSchedule,
  signal
}) {
  const before = await ledger.snapshot();
  const stageTimings = {};
  const capture = {
    dossier: null,
    candidatePlan: null,
    researchState: "not_started",
    researchAvailabilityState: null
  };
  const provider = createMeteredGraphHopperProviderV1({
    caseId: evaluationCase.id,
    controlledFailureAfterFirstSuccess:
      evaluationCase.input.executionModifiers.includes(
        "one_provider_failure_with_survivor"
      ),
    env,
    ledger,
    fetchImpl,
    providerSchedule
  });
  let response = null;
  let errorCode = null;
  try {
    response = await measureAsync(stageTimings, "end_to_end", () =>
      planAndRouteOutdoorAdventureV1(
        {
          schemaVersion: 1,
          intent: serverLiveProofCanonicalIntentV1(evaluationCase.input)
        },
        {
          repository,
          provider,
          async researchAdventure(intent, dependencies) {
            return measureAsync(stageTimings, "research_planning", async () => {
              const research = await researchOutdoorAdventureV1(intent, {
                ...dependencies,
                assembleDossier: async (input) =>
                  measureAsync(stageTimings, "dossier_assembly", async () => {
                    const dossier = await assembleAdventureResearchDossierV1(input);
                    capture.dossier = dossier;
                    return dossier;
                  })
              });
              capture.researchState = research.state;
              capture.researchAvailabilityState =
                research.availabilityState ?? null;
              return research;
            });
          },
          buildCandidatePlan(dossier, options) {
            return measureSync(stageTimings, "candidate_planning", () => {
              const plan = buildResearchGuidedRouteCandidatePlanV1(
                dossier,
                options
              );
              capture.candidatePlan = plan;
              return plan;
            });
          },
          validateCandidatePlan: validateResearchGuidedRouteCandidatePlanV1,
          routeCandidates(plan, dependencies, options) {
            return measureAsync(stageTimings, "graphhopper_and_validation", () =>
              routeResearchGuidedCandidatesV1(plan, dependencies, options)
            );
          },
          validateRoutedAlternatives:
            validateResearchGuidedRoutedAlternativesV1
        },
        {
          maximumProposals,
          maximumConcurrency,
          graphHopperAttemptTimeoutMs,
          totalDeadlineMs,
          signal
        }
      )
    );
  } catch (error) {
    errorCode = safeCaseError(error);
  }
  const after = await ledger.snapshot();
  const calls = after.calls.slice(before.calls.length).filter((item) =>
    item.caseId === evaluationCase.id
  );
  const routedAlternatives = response?.routedAlternatives ?? null;
  const quality = routedAlternatives === null
    ? emptyQuality()
    : evaluateServerLiveRouteQualityV1({
      caseId: evaluationCase.id,
      input: evaluationCase.input,
      routedAlternatives
    });
  const assessment = assessCase({
    evaluationCase,
    response,
    errorCode,
    calls,
    capture,
    quality
  });
  const receipt = {
    caseId: evaluationCase.id,
    region: serverLiveProofRegionForCaseIdV1(evaluationCase.id),
    executed: true,
    passed: assessment.passed,
    terminalState: response?.state ?? "error",
    errorCode,
    providerCallCount: calls.length,
    providerOutcomes: providerCallCounts(calls),
    stageTimings: Object.freeze(stageTimings),
    pipeline: pipelineReceipt(capture, response),
    routeQuality: redactQualityGeometryV1(quality),
    limitations: Object.freeze(assessment.limitations),
    failureReasons: Object.freeze(assessment.failureReasons)
  };
  return Object.freeze(reassessSanitizedCaseReceiptV1(receipt));
}

function assessCase({
  evaluationCase,
  response,
  errorCode,
  calls,
  capture,
  quality
}) {
  const failures = [];
  const noRouteExpected = evaluationCase.id ===
    "case-05-harz-unsatisfied-must-have-highlight";
  const controlledPartial = evaluationCase.id ===
    "case-15-partial-provider-failure-survivor";
  if (errorCode !== null) failures.push(errorCode);
  if (noRouteExpected) {
    if (response?.state !== "no_viable_route") {
      failures.push("unsatisfied_constraint_not_fail_closed");
    }
    if (calls.length !== 0) failures.push("unexpected_provider_traffic");
  } else {
    if (!response || !["partial", "routed"].includes(response.state)) {
      failures.push("no_routed_pipeline_result");
    }
    if (calls.length < 1) failures.push("provider_not_called");
    if (quality.eligibleCount < 1 || quality.selectedCount < 1) {
      failures.push("no_quality_eligible_route");
    }
    if (quality.routes.filter((route) => route.eligible).some((route) =>
      route.geometryProvider !== "graphhopper" ||
      route.routingStrategy !== "backend" ||
      !route.researchProvenanceDistinctFromRoutingProvenance ||
      !route.waypointOrderPreserved ||
      route.reachedSelectedWaypointRatio !== 1 ||
      route.excessiveSnapping
    )) {
      failures.push("route_provenance_or_waypoint_validation_failed");
    }
  }
  if (controlledPartial) {
    if (response?.state !== "partial") {
      failures.push("partial_failure_not_preserved");
    }
    if (!calls.some((call) =>
      call.pipelineDisposition === "controlled_failure_after_success"
    )) {
      failures.push("controlled_partial_failure_not_exercised");
    }
    if (!response?.routedAlternatives?.remainingLimitations.includes(
      "provider_failure"
    )) {
      failures.push("provider_failure_limitation_missing");
    }
  }
  if (
    evaluationCase.id === "case-04-harz-brocken-must-have-landmark" &&
    !capture.candidatePlan?.proposals?.some((proposal) =>
      proposal.viaCandidates.some((candidate) =>
        candidate.highlightCategory === "peak"
      )
    )
  ) {
    failures.push("must_have_peak_not_selected");
  }
  const limitations = new Set([
    ...(response?.planningGaps?.map((gap) => gap.code) ?? []),
    ...(response?.routedAlternatives?.remainingLimitations ?? []),
    ...quality.routes.flatMap((route) => route.limitations)
  ]);
  if (evaluationCase.input.preferredExperiences.length > 0) {
    limitations.add("requested_preferences_not_verified_claims");
  }
  limitations.add("mapped_evidence_not_official_current_safe_open_legal_or_accessible_claim");
  return {
    passed: failures.length === 0,
    failureReasons: [...new Set(failures)].sort(),
    limitations: [...limitations].sort()
  };
}

export function reassessSanitizedCaseReceiptV1(receipt) {
  validateSanitizedCaseReceipt(receipt);
  const failures = [];
  const noRouteExpected = receipt.caseId ===
    "case-05-harz-unsatisfied-must-have-highlight";
  const controlledPartial = receipt.caseId ===
    "case-15-partial-provider-failure-survivor";
  if (receipt.errorCode !== null) failures.push(receipt.errorCode);
  if (noRouteExpected) {
    if (receipt.terminalState !== "no_viable_route") {
      failures.push("unsatisfied_constraint_not_fail_closed");
    }
    if (receipt.providerCallCount !== 0) {
      failures.push("unexpected_provider_traffic");
    }
  } else {
    if (!["partial", "routed"].includes(receipt.terminalState)) {
      failures.push("no_routed_pipeline_result");
    }
    if (receipt.providerCallCount < 1) failures.push("provider_not_called");
    if (
      receipt.routeQuality?.eligibleCount < 1 ||
      receipt.routeQuality?.selectedCount < 1
    ) {
      failures.push("no_quality_eligible_route");
    }
    const eligibleRoutes = receipt.routeQuality?.routes?.filter((route) =>
      route.eligible
    ) ?? [];
    if (eligibleRoutes.some((route) =>
      route.geometryProvider !== "graphhopper" ||
      route.routingStrategy !== "backend" ||
      !route.researchProvenanceDistinctFromRoutingProvenance ||
      !route.waypointOrderPreserved ||
      route.reachedSelectedWaypointRatio !== 1 ||
      route.excessiveSnapping
    )) {
      failures.push("route_provenance_or_waypoint_validation_failed");
    }
  }
  if (controlledPartial) {
    if (receipt.terminalState !== "partial") {
      failures.push("partial_failure_not_preserved");
    }
    if (receipt.providerOutcomes?.controlledFailureAfterSuccess < 1) {
      failures.push("controlled_partial_failure_not_exercised");
    }
    if (!receipt.limitations?.includes("provider_failure")) {
      failures.push("provider_failure_limitation_missing");
    }
  }
  if (
    receipt.caseId === "case-04-harz-brocken-must-have-landmark" &&
    !receipt.pipeline?.selectedHighlightCategories?.includes("peak")
  ) {
    failures.push("must_have_peak_not_selected");
  }
  return {
    ...receipt,
    passed: failures.length === 0,
    failureReasons: Object.freeze([...new Set(failures)].sort())
  };
}

function pipelineReceipt(capture, response) {
  const proposals = capture.candidatePlan?.proposals ?? [];
  const routedAttempts = response?.routedAlternatives?.attempts ?? [];
  return Object.freeze({
    realPostgisEvidence: capture.dossier !== null,
    researchPlanProduced: capture.dossier !== null,
    dossierProduced: capture.dossier !== null,
    researchState: capture.researchState,
    researchAvailabilityState: capture.researchAvailabilityState,
    candidatePlanState: capture.candidatePlan?.state ?? "not_produced",
    proposalCount: proposals.length,
    selectedHighlightCount: proposals.reduce((total, proposal) =>
      total + proposal.viaCandidates.length, 0
    ),
    selectedHighlightCategories: Object.freeze([
      ...new Set(proposals.flatMap((proposal) =>
        proposal.viaCandidates.map((candidate) => candidate.highlightCategory)
      ))
    ].sort()),
    mappedNetworkCandidateCount: proposals.reduce((total, proposal) =>
      total + proposal.mappedNetworkCandidates.length, 0
    ),
    selectedWaypointsHaveEvidence: proposals.every((proposal) =>
      proposal.viaCandidates.every((candidate) =>
        candidate.evidenceClaimIds.length > 0
      )
    ),
    routedAttemptCount: routedAttempts.length,
    routedSuccessCount: routedAttempts.filter((attempt) =>
      attempt.state === "routed"
    ).length,
    routedFailureCount: routedAttempts.filter((attempt) =>
      attempt.state === "failed"
    ).length,
    routedAttemptFailureCodes: Object.freeze([
      ...new Set(routedAttempts.flatMap((attempt) =>
        attempt.failureCode === null ? [] : [attempt.failureCode]
      ))
    ].sort()),
    planningGapReceipts: Object.freeze(
      (response?.planningGaps ?? []).map((gap) => Object.freeze({
        code: gap.code,
        affectedField: gap.affectedField,
        affectedValue: gap.affectedValue,
        reason: gap.reason,
        requiresCapability: gap.requiresCapability
      }))
    )
  });
}

async function inspectRealEvidence(pool, generatedAt) {
  let version;
  let regions;
  try {
    version = await pool.query(
      "SELECT current_setting('server_version') AS postgres_version, postgis_lib_version() AS postgis_version"
    );
    regions = await pool.query(`
      SELECT region.region_id,
             import.source_data_at,
             import.retrieved_at,
             run.projection_run_id,
             run.input_import_id,
             run.source_policy_version,
             source.source_key,
             source.source_category,
             policy.maximum_input_age_days,
             (SELECT count(*)::integer
                FROM outdoor_research_projection_entities entity
               WHERE entity.projection_run_id = run.projection_run_id) AS entity_count,
             (SELECT count(*)::integer
                FROM outdoor_research_projection_entities entity
               WHERE entity.projection_run_id = run.projection_run_id
                 AND entity.record_provenance ?& ARRAY[
                   'source_key', 'evidence_authority', 'acquisition_channel',
                   'osm_type', 'osm_id', 'osm_version', 'osm_timestamp',
                   'input_import_id', 'dataset_name', 'extract_identifier',
                   'dataset_timestamp', 'retrieved_at', 'imported_at',
                   'input_file_sha256', 'projection_run_id', 'license',
                   'attribution'
                 ]
                 AND (
                   entity.record_provenance->>'acquisition_channel' <>
                     'geofabrik_regional_extract'
                   OR entity.record_provenance ?& ARRAY[
                     'source_checksum_algorithm', 'source_checksum',
                     'source_checksum_verified_at'
                   ]
                 )) AS provenance_count
        FROM outdoor_evidence_regions region
        JOIN outdoor_evidence_imports import
          ON import.import_id = region.active_import_id
        JOIN outdoor_research_active_projection_runs run
          ON run.region_id = region.region_id
         AND run.input_import_id = region.active_import_id
        JOIN outdoor_research_sources source
          ON source.source_id = run.source_id
        JOIN outdoor_research_source_policies policy
          ON policy.source_policy_id = run.source_policy_id
       WHERE region.region_id = ANY($1::text[])
       ORDER BY region.region_id`, [REGION_IDS]);
  } catch (error) {
    throw new ServerLiveProofError("evidence_inspection_failed", {
      cause: error
    });
  }
  if (regions.rows.length !== REGION_IDS.length) {
    throw new ServerLiveProofError("active_region_projection_missing");
  }
  return Object.freeze({
    postgis: "real",
    postgresVersion: version.rows[0].postgres_version,
    postgisVersion: version.rows[0].postgis_version,
    regions: Object.freeze(regions.rows.map((row) => {
      const ageHours = (
        generatedAt.getTime() - new Date(row.source_data_at).getTime()
      ) / 3_600_000;
      return Object.freeze({
        regionId: row.region_id,
        sourceDataAt: new Date(row.source_data_at).toISOString(),
        retrievedAt: new Date(row.retrieved_at).toISOString(),
        evidenceAgeHours: round(ageHours, 1),
        maximumInputAgeDays: Number(row.maximum_input_age_days),
        current: ageHours >= 0 &&
          ageHours <= Number(row.maximum_input_age_days) * 24,
        projectionDigest: safeProofDigestV1(
          row.projection_run_id,
          "projection"
        ),
        importDigest: safeProofDigestV1(row.input_import_id, "import"),
        sourceKey: row.source_key,
        sourceCategory: row.source_category,
        sourcePolicyVersion: row.source_policy_version,
        entityCount: Number(row.entity_count),
        provenanceComplete:
          Number(row.entity_count) === Number(row.provenance_count)
      });
    }))
  });
}

function buildSummary({
  generatedAt,
  allCases,
  evidence,
  acquisitionMetadata,
  officialSummary,
  ledgerSnapshot,
  finalize,
  env,
  providerCallLimit,
  maximumConcurrency,
  minimumProviderSpacingMilliseconds,
  providerSchedule
}) {
  const executedIds = new Set(allCases.map((item) => item.caseId));
  const notRun = SERVER_LIVE_PROOF_CASE_IDS.filter((caseId) =>
    !executedIds.has(caseId)
  );
  const accounting = providerCallCounts(ledgerSnapshot.calls);
  const finalFailures = [];
  if (allCases.some((item) => !item.passed)) finalFailures.push("case_failed");
  if (ledgerSnapshot.calls.some((call) => call.outcome === "in_flight")) {
    finalFailures.push("provider_call_unsettled");
  }
  if (ledgerSnapshot.calls.length > providerCallLimit) {
    finalFailures.push("provider_call_limit_exceeded");
  }
  if (evidence.regions.some((region) =>
    !region.current || !region.provenanceComplete
  )) {
    finalFailures.push("evidence_not_current_or_provenance_complete");
  }
  if (!officialSummaryIsHonest(officialSummary)) {
    finalFailures.push("official_summary_not_not_run");
  }
  if (ordinaryFeatureFlags(env).some((flag) => flag.enabled)) {
    finalFailures.push("ordinary_feature_flag_enabled");
  }
  if (finalize && notRun.length > 0) finalFailures.push("cases_not_run");
  const harzPassed = allCases.some((item) =>
    item.region === "harz-v1" &&
    item.passed &&
    item.routeQuality.selectedCount > 0
  );
  const innsbruckPassed = allCases.some((item) =>
    item.region === "innsbruck-alps-v1" &&
    item.passed &&
    item.routeQuality.selectedCount > 0
  );
  if (finalize && (!harzPassed || !innsbruckPassed)) {
    finalFailures.push("required_region_route_missing");
  }
  return Object.freeze({
    schemaVersion: SERVER_LIVE_PROOF_SCHEMA_VERSION,
    proofClassification: SERVER_LIVE_PROOF_CLASSIFICATION,
    status: finalize
      ? finalFailures.length === 0 ? "passed" : "failed"
      : "in_progress",
    generatedAt: generatedAt.toISOString(),
    configuredCaseCount: SERVER_LIVE_PROOF_CASE_IDS.length,
    executedCaseCount: allCases.length,
    passedCaseCount: allCases.filter((item) => item.passed).length,
    failedCaseCount: allCases.filter((item) => !item.passed).length,
    notRunCaseCount: notRun.length,
    notRunCaseIds: Object.freeze(notRun),
    providerCalls: Object.freeze({
      limit: providerCallLimit,
      exactAttempted: ledgerSnapshot.calls.length,
      ...accounting
    }),
    providerScheduling: Object.freeze({
      maximumConcurrency,
      minimumSpacingMilliseconds: minimumProviderSpacingMilliseconds,
      stopped: providerSchedule.stopped,
      stopReason: providerSchedule.stopReason
    }),
    evidence: Object.freeze({
      ...evidence,
      acquisition: acquisitionMetadata
    }),
    graphHopper: Object.freeze({
      source: "real_graphhopper",
      officialBaseUrlPinned: true,
      rawResponsesRetained: false,
      completeGeometryRetainedInSummary: false
    }),
    cases: Object.freeze(allCases),
    officialCanonical18CaseSummary: Object.freeze({
      status: officialSummary.status,
      caseCount: officialSummary.caseResults.length,
      executedCaseCount: officialSummary.caseResults.filter((item) =>
        item.executed
      ).length,
      providerCallCount: Number(officialSummary.providerCallCount ?? 0)
    }),
    featureFlags: Object.freeze(ordinaryFeatureFlags(env)),
    closedBetaEligible: false,
    physicalIPhoneAppAttestProven: false,
    limitations: Object.freeze([
      "bounded_fixture_run_not_provider_superiority_claim",
      "not_physical_iphone_app_attest_proof",
      "not_full_18_case_official_proof",
      "not_production_proof",
      "not_closed_beta_approval",
      "mapped_evidence_not_official_current_safe_open_legal_or_accessible_claim"
    ]),
    failureReasons: Object.freeze([...new Set(finalFailures)].sort())
  });
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

function providerOutcome(error, signal) {
  if (signal?.aborted || error?.code === "request_cancelled") return "cancelled";
  if (error?.code === "route_timed_out") return "timed_out";
  return "failed";
}

function safeProviderErrorCode(error) {
  const allowed = new Set([
    "configuration_missing",
    "flexible_mode_unavailable",
    "invalid_request",
    "request_cancelled",
    "route_not_found",
    "route_timed_out",
    "routing_rate_limited",
    "routing_unavailable"
  ]);
  return allowed.has(error?.code) ? error.code : "routing_unavailable";
}

function ordinaryFeatureFlags(env) {
  return SERVER_LIVE_PROOF_FEATURE_FLAGS.map((name) => Object.freeze({
    name,
    enabled: env[name] === "true"
  }));
}

function officialSummaryIsHonest(summary) {
  return summary?.status === "not_run" &&
    Array.isArray(summary.caseResults) &&
    summary.caseResults.length === 18 &&
    summary.caseResults.every((item) =>
      item.executed === false && item.terminalState === "not_run"
    ) &&
    Number(summary.providerCallCount ?? 0) === 0;
}

function validateRunDependencies(input) {
  if (
    !Array.isArray(input.cases) ||
    input.cases.length < 1 ||
    !input.pool?.query ||
    !input.repository?.withConsistentSnapshot ||
    !input.env ||
    typeof input.fetchImpl !== "function" ||
    typeof input.usageLedgerPath !== "string" ||
    typeof input.outputPath !== "string" ||
    !input.acquisitionMetadata ||
    !input.officialSummary ||
    typeof input.diagnosticMode !== "boolean" ||
    (
      input.signal !== undefined &&
      (
        typeof input.signal.aborted !== "boolean" ||
        typeof input.signal.addEventListener !== "function" ||
        typeof input.signal.removeEventListener !== "function"
      )
    )
  ) {
    throw new ServerLiveProofError("invalid_run_dependencies");
  }
  if (input.priorSummary !== null) {
    if (
      input.priorSummary.proofClassification !==
        SERVER_LIVE_PROOF_CLASSIFICATION ||
      input.priorSummary.status !== "in_progress" ||
      !Array.isArray(input.priorSummary.cases)
    ) {
      throw new ServerLiveProofError("invalid_prior_summary");
    }
    try {
      validateServerLiveProofPublishedSummaryV1(input.priorSummary);
    } catch {
      throw new ServerLiveProofError("invalid_prior_summary");
    }
  }
}

export function validateServerLiveProofLedgerContinuityV1({
  cases,
  priorSummary,
  diagnosticMode,
  maximumProposals,
  ledger
}) {
  if (ledger.calls.some((call) => call.outcome === "in_flight")) {
    throw new ServerLiveProofError("invalid_usage_ledger_transition");
  }
  if (diagnosticMode) {
    if (
      priorSummary !== null ||
      maximumProposals !== 1 ||
      cases.length !== 1 ||
      cases[0].id !== "case-07-innsbruck-viewpoint-loop" ||
      ledger.calls.length !== SERVER_LIVE_PROOF_PROVIDER_CALL_LIMIT - 1
    ) {
      throw new ServerLiveProofError("invalid_usage_ledger_transition");
    }
    return;
  }
  if (priorSummary === null) {
    if (ledger.calls.length !== 0) {
      throw new ServerLiveProofError("invalid_usage_ledger_transition");
    }
    return;
  }
  if (
    priorSummary.providerCalls?.exactAttempted !== ledger.calls.length ||
    priorSummary.cases.some((receipt) =>
      ledger.calls.filter((call) => call.caseId === receipt.caseId).length <
        receipt.providerCallCount
    )
  ) {
    throw new ServerLiveProofError("invalid_usage_ledger_transition");
  }
}

function validateSanitizedCaseReceipt(receipt) {
  const outcomes = receipt?.providerOutcomes;
  const routes = receipt?.routeQuality?.routes;
  const providerOutcomeTotal = [
    outcomes?.successful,
    outcomes?.failed,
    outcomes?.timedOut,
    outcomes?.cancelled
  ];
  if (
    !receipt ||
    typeof receipt !== "object" ||
    Array.isArray(receipt) ||
    !SERVER_LIVE_PROOF_CASE_IDS.includes(receipt.caseId) ||
    receipt.executed !== true ||
    !Number.isInteger(receipt.providerCallCount) ||
    receipt.providerCallCount < 0 ||
    providerOutcomeTotal.some((value) =>
      !Number.isInteger(value) || value < 0
    ) ||
    providerOutcomeTotal.reduce((total, value) => total + value, 0) !==
      receipt.providerCallCount ||
    !Number.isInteger(outcomes?.controlledFailureAfterSuccess) ||
    outcomes.controlledFailureAfterSuccess < 0 ||
    outcomes.controlledFailureAfterSuccess > outcomes.successful ||
    !receipt.pipeline ||
    receipt.region !== serverLiveProofRegionForCaseIdV1(receipt.caseId) ||
    !Array.isArray(receipt.limitations) ||
    !Array.isArray(receipt.failureReasons) ||
    !Array.isArray(routes) ||
    receipt.routeQuality.routeCount !== routes.length ||
    receipt.routeQuality.eligibleCount !== routes.filter((route) =>
      route?.eligible === true
    ).length ||
    receipt.routeQuality.selectedCount !== routes.filter((route) =>
      route?.selected === true
    ).length ||
    receipt.routeQuality.rejectionCount !== routes.filter((route) =>
      route?.eligible === false
    ).length ||
    routes.some((route) => route?.selected === true && route?.eligible !== true)
  ) {
    throw new ServerLiveProofError("invalid_prior_summary");
  }
}

function validateLedger(
  value,
  expectedLimit = SERVER_LIVE_PROOF_PROVIDER_CALL_LIMIT
) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    value.limit !== expectedLimit ||
    !Array.isArray(value.calls) ||
    value.calls.length > expectedLimit ||
    value.calls.some((call, index) =>
      call.callId !== index + 1 ||
      !SERVER_LIVE_PROOF_CASE_IDS.includes(call.caseId) ||
      !["in_flight", "success", "failed", "timed_out", "cancelled"].includes(
        call.outcome
      )
    )
  ) {
    throw new ServerLiveProofError("invalid_usage_ledger");
  }
}

function emptyLedger(limit = SERVER_LIVE_PROOF_PROVIDER_CALL_LIMIT) {
  return {
    schemaVersion: 1,
    limit,
    calls: []
  };
}

function emptyQuality() {
  return Object.freeze({
    policyVersion: "hiking-route-quality-v1-server-proof-projection",
    providerOrderUsedAsRanking: false,
    routeCount: 0,
    eligibleCount: 0,
    selectedCount: 0,
    rejectionCount: 0,
    nearDuplicateRejectionCount: 0,
    maximumPairwiseSimilarity: 0,
    routes: Object.freeze([])
  });
}

async function measureAsync(timings, name, operation) {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    timings[name] = coarseMilliseconds(performance.now() - startedAt);
  }
}

function measureSync(timings, name, operation) {
  const startedAt = performance.now();
  try {
    return operation();
  } finally {
    timings[name] = coarseMilliseconds(performance.now() - startedAt);
  }
}

function safeCaseError(error) {
  const allowed = new Set([
    "cancelled",
    "timed_out",
    "research_unavailable",
    "routing_unavailable",
    "internal_failure",
    "invalid_request",
    "response_too_large",
    "provider_call_limit_reached"
  ]);
  return allowed.has(error?.code) ? error.code : "proof_execution_failed";
}

function coarseMilliseconds(value) {
  return Math.max(0, Math.round(value / 10) * 10);
}

function round(value, digits) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function retryAfterFromHeaders(headers) {
  const value = headers?.get?.("retry-after");
  if (typeof value !== "string" || value.length > 128) return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds)) {
    return boundedRetryAfterMilliseconds(Math.ceil(seconds * 1_000));
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return boundedRetryAfterMilliseconds(date.getTime() - Date.now());
}

function boundedRetryAfterMilliseconds(value) {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.ceil(value);
  return rounded >= 0 && rounded <= 15_000 ? rounded : null;
}

function wait(milliseconds) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

async function atomicWrite(path, contents) {
  const temporaryPath = `${path}.pending-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporaryPath, contents, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw new ServerLiveProofError("summary_write_failed", { cause: error });
  }
}
