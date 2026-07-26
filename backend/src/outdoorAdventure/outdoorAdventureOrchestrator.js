import {
  OutdoorResearchExecutorError
} from "../outdoorResearch/executorPolicy.js";
import {
  researchOutdoorAdventureV1
} from "../outdoorResearch/outdoorResearchExecutor.js";
import {
  validateAdventureResearchDossierV1,
  validateAdventureResearchIntentV1
} from "../outdoorResearch/validation.js";
import {
  ResearchGuidedRouteCandidateError
} from "../routeResearch/errors.js";
import {
  buildResearchGuidedRouteCandidatePlanV1
} from "../routeResearch/researchGuidedRouteCandidatePlanner.js";
import {
  ResearchGuidedRoutingAdapterError
} from "../routeResearch/routedAlternativesErrors.js";
import {
  validateResearchGuidedRoutedAlternativesV1
} from "../routeResearch/routedAlternativesContract.js";
import {
  routeResearchGuidedCandidatesV1
} from "../routeResearch/researchGuidedRoutingAdapter.js";
import {
  validateResearchGuidedRouteCandidatePlanV1
} from "../routeResearch/validation.js";
import {
  validateOutdoorAdventurePlanningGapsV1,
  validateOutdoorAdventurePlanningRequestV1,
  validateOutdoorAdventurePlanningResponseV1
} from "./orchestrationContract.js";
import {
  OutdoorAdventureOrchestrationError,
  outdoorAdventureOrchestrationError
} from "./orchestrationErrors.js";

const DEPENDENCY_FIELDS = new Set([
  "repository",
  "provider",
  "clock",
  "regionBindings",
  "researchAdventure",
  "buildCandidatePlan",
  "validateCandidatePlan",
  "routeCandidates",
  "validateRoutedAlternatives"
]);
const OPTION_FIELDS = new Set([
  "signal",
  "maximumProposals",
  "maximumConcurrency",
  "researchTimeoutMs",
  "graphHopperAttemptTimeoutMs",
  "totalDeadlineMs"
]);

export async function planAndRouteOutdoorAdventureV1(
  requestInput,
  dependencies = {},
  options = {}
) {
  const settings = validateOptions(options);
  if (settings.signal?.aborted) {
    throw outdoorAdventureOrchestrationError("cancelled");
  }
  const request = validateOutdoorAdventurePlanningRequestV1(requestInput);
  const deps = validateDependencies(dependencies);
  return executeWithDeadline(settings, async (signal) => {
    throwIfAborted(signal);
    const researchResult = await deps.researchAdventure(
      request.intent,
      {
        repository: deps.repository,
        clock: deps.clock,
        signal,
        regionBindings: deps.regionBindings,
        totalTimeoutMs: settings.researchTimeoutMs
      }
    );
    throwIfAborted(signal);
    const research = validateResearchResult(researchResult);
    if (research.state === "clarification_required") {
      return response({
        state: "clarification_required",
        normalizedIntent: research.normalizedIntent,
        planningGaps: research.planningGaps,
        clarificationQuestions: research.clarificationQuestions,
        routedAlternatives: null
      });
    }
    if (research.state === "unsupported") {
      return response({
        state: "unsupported",
        normalizedIntent: research.normalizedIntent,
        planningGaps: research.planningGaps,
        clarificationQuestions: [],
        routedAlternatives: null
      });
    }

    const dossier = validateAdventureResearchDossierV1(research.dossier);
    throwIfAborted(signal);
    const builtPlan = deps.buildCandidatePlan(dossier, {
      maximumProposals: settings.maximumProposals
    });
    const candidatePlan = deps.validateCandidatePlan(builtPlan);
    throwIfAborted(signal);
    if (candidatePlan.state === "unsupported") {
      return response({
        state: "unsupported",
        normalizedIntent: candidatePlan.normalizedIntent,
        planningGaps: research.planningGaps,
        clarificationQuestions: [],
        routedAlternatives: null
      });
    }
    if (
      candidatePlan.state === "insufficient_evidence" ||
      candidatePlan.proposals.length === 0
    ) {
      return response({
        state: "no_viable_route",
        normalizedIntent: candidatePlan.normalizedIntent,
        planningGaps: research.planningGaps,
        clarificationQuestions: [],
        routedAlternatives: null
      });
    }

    const routedOutput = await deps.routeCandidates(
      candidatePlan,
      { provider: deps.provider },
      {
        signal,
        maximumConcurrency: settings.maximumConcurrency,
        operationTimeoutMilliseconds:
          settings.graphHopperAttemptTimeoutMs
      }
    );
    throwIfAborted(signal);
    const routedAlternatives =
      deps.validateRoutedAlternatives(routedOutput);
    const state = orchestrationState(
      research,
      candidatePlan,
      routedAlternatives
    );
    return response({
      state,
      normalizedIntent: candidatePlan.normalizedIntent,
      planningGaps: research.planningGaps,
      clarificationQuestions: [],
      routedAlternatives
    });
  });
}

function validateDependencies(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !DEPENDENCY_FIELDS.has(key))
  ) {
    throw outdoorAdventureOrchestrationError("internal_failure");
  }
  const dependencies = {
    repository: input.repository,
    provider: input.provider,
    clock: input.clock,
    regionBindings: input.regionBindings,
    researchAdventure:
      input.researchAdventure ?? researchOutdoorAdventureV1,
    buildCandidatePlan:
      input.buildCandidatePlan ??
      buildResearchGuidedRouteCandidatePlanV1,
    validateCandidatePlan:
      input.validateCandidatePlan ??
      validateResearchGuidedRouteCandidatePlanV1,
    routeCandidates:
      input.routeCandidates ?? routeResearchGuidedCandidatesV1,
    validateRoutedAlternatives:
      input.validateRoutedAlternatives ??
      validateResearchGuidedRoutedAlternativesV1
  };
  if (
    dependencies.clock !== undefined &&
      typeof dependencies.clock !== "function" ||
    [
      dependencies.researchAdventure,
      dependencies.buildCandidatePlan,
      dependencies.validateCandidatePlan,
      dependencies.routeCandidates,
      dependencies.validateRoutedAlternatives
    ].some((value) => typeof value !== "function")
  ) {
    throw outdoorAdventureOrchestrationError("internal_failure");
  }
  return dependencies;
}

function validateOptions(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !OPTION_FIELDS.has(key))
  ) {
    throw outdoorAdventureOrchestrationError("feature_unavailable");
  }
  const settings = {
    signal: input.signal,
    maximumProposals: boundedInteger(input.maximumProposals, 3, 1, 6),
    maximumConcurrency: boundedInteger(input.maximumConcurrency, 2, 1, 2),
    researchTimeoutMs: boundedInteger(
      input.researchTimeoutMs,
      7_500,
      250,
      30_000
    ),
    graphHopperAttemptTimeoutMs: boundedInteger(
      input.graphHopperAttemptTimeoutMs,
      8_000,
      1_000,
      30_000
    ),
    totalDeadlineMs: boundedInteger(
      input.totalDeadlineMs,
      25_000,
      1_000,
      45_000
    )
  };
  if (
    input.signal !== undefined &&
    (
      !input.signal ||
      typeof input.signal.aborted !== "boolean" ||
      typeof input.signal.addEventListener !== "function" ||
      typeof input.signal.removeEventListener !== "function"
    )
  ) {
    throw outdoorAdventureOrchestrationError("feature_unavailable");
  }
  if (
    settings.researchTimeoutMs >= settings.totalDeadlineMs ||
    settings.graphHopperAttemptTimeoutMs >= settings.totalDeadlineMs
  ) {
    throw outdoorAdventureOrchestrationError("feature_unavailable");
  }
  return settings;
}

function validateResearchResult(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw outdoorAdventureOrchestrationError("internal_failure");
  }
  const normalizedIntent =
    validateAdventureResearchIntentV1(input.normalizedIntent);
  const planningGaps =
    validateOutdoorAdventurePlanningGapsV1(input.planningGaps);
  if (input.state === "clarification_required") {
    if (
      !hasExactFields(input, [
        "state",
        "normalizedIntent",
        "planningGaps",
        "clarificationQuestions"
      ]) ||
      !Array.isArray(input.clarificationQuestions) ||
      Object.hasOwn(input, "dossier")
    ) {
      throw outdoorAdventureOrchestrationError("internal_failure");
    }
    return {
      state: input.state,
      normalizedIntent,
      planningGaps,
      clarificationQuestions: input.clarificationQuestions
    };
  }
  if (input.state === "unsupported") {
    if (
      !hasExactFields(input, [
        "state",
        "normalizedIntent",
        "planningGaps",
        "availabilityState"
      ]) ||
      typeof input.availabilityState !== "string" ||
      input.availabilityState.length < 1 ||
      input.availabilityState.length > 64 ||
      Object.hasOwn(input, "dossier")
    ) {
      throw outdoorAdventureOrchestrationError("internal_failure");
    }
    return {
      state: input.state,
      normalizedIntent,
      planningGaps
    };
  }
  if (
    input.state !== "ready" ||
    !hasExactFields(input, [
      "state",
      "normalizedIntent",
      "planningGaps",
      "dossier"
    ]) ||
    !input.dossier
  ) {
    throw outdoorAdventureOrchestrationError("internal_failure");
  }
  return {
    state: "ready",
    normalizedIntent,
    planningGaps,
    dossier: validateAdventureResearchDossierV1(input.dossier)
  };
}

function orchestrationState(research, candidatePlan, routedAlternatives) {
  if (routedAlternatives.state === "unsupported") return "unsupported";
  const routedCount = routedAlternatives.attempts.reduce(
    (total, attempt) => total + attempt.routeResults.length,
    0
  );
  if (routedCount === 0) return "no_viable_route";
  if (
    routedAlternatives.state === "partial" ||
    candidatePlan.state === "partial" ||
    research.planningGaps.length > 0
  ) {
    return "partial";
  }
  return "routed";
}

function response(fields) {
  return validateOutdoorAdventurePlanningResponseV1({
    schemaVersion: 1,
    policyVersion: "outdoor-adventure-orchestration-v1",
    ...fields
  });
}

async function executeWithDeadline(settings, work) {
  const controller = new AbortController();
  let deadlineFired = false;
  let externalCancelled = false;
  let rejectCancellation;
  const cancellation = new Promise((_, reject) => {
    rejectCancellation = reject;
  });
  const abortFromCaller = () => {
    externalCancelled = true;
    controller.abort();
    rejectCancellation(
      outdoorAdventureOrchestrationError("cancelled")
    );
  };
  settings.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (settings.signal?.aborted) abortFromCaller();
  const timer = setTimeout(() => {
    deadlineFired = true;
    controller.abort();
    rejectCancellation(
      outdoorAdventureOrchestrationError("timed_out")
    );
  }, settings.totalDeadlineMs);
  const workPromise = Promise.resolve().then(() => work(controller.signal));
  workPromise.catch(() => {
    // A dependency may ignore cancellation. Its late result is detached and
    // can no longer determine or mutate the orchestration response.
  });
  try {
    return await Promise.race([workPromise, cancellation]);
  } catch (error) {
    if (externalCancelled || settings.signal?.aborted) {
      throw outdoorAdventureOrchestrationError("cancelled");
    }
    if (deadlineFired) {
      throw outdoorAdventureOrchestrationError("timed_out");
    }
    throw normalizeOrchestrationError(error);
  } finally {
    clearTimeout(timer);
    settings.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function normalizeOrchestrationError(error) {
  if (error instanceof OutdoorAdventureOrchestrationError) return error;
  if (error instanceof OutdoorResearchExecutorError) {
    if (error.code === "request_cancelled") {
      return outdoorAdventureOrchestrationError("cancelled");
    }
    if (
      error.code === "execution_timed_out" ||
      error.code === "repository_timed_out"
    ) {
      return outdoorAdventureOrchestrationError("timed_out");
    }
    if (error.code === "invalid_intent") {
      return outdoorAdventureOrchestrationError("invalid_request");
    }
    if (error.code === "result_too_large") {
      return outdoorAdventureOrchestrationError("response_too_large");
    }
    return outdoorAdventureOrchestrationError("research_unavailable", {
      cause: error
    });
  }
  if (error instanceof ResearchGuidedRouteCandidateError) {
    if (error.code === "output_too_large") {
      return outdoorAdventureOrchestrationError("response_too_large");
    }
    return outdoorAdventureOrchestrationError("internal_failure", {
      cause: error
    });
  }
  if (error instanceof ResearchGuidedRoutingAdapterError) {
    if (error.code === "cancelled") {
      return outdoorAdventureOrchestrationError("cancelled");
    }
    if (error.code === "output_too_large") {
      return outdoorAdventureOrchestrationError("response_too_large");
    }
    return outdoorAdventureOrchestrationError("routing_unavailable", {
      cause: error
    });
  }
  return outdoorAdventureOrchestrationError("internal_failure", {
    cause: error
  });
}

function throwIfAborted(signal) {
  if (signal.aborted) {
    throw outdoorAdventureOrchestrationError("cancelled");
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined) return fallback;
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw outdoorAdventureOrchestrationError("feature_unavailable");
  }
  return value;
}

function hasExactFields(value, fields) {
  const keys = Object.keys(value);
  return keys.length === fields.length &&
    keys.every((key) => fields.includes(key)) &&
    fields.every((field) => Object.hasOwn(value, field));
}
