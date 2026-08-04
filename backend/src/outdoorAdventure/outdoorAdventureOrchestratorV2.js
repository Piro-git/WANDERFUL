import { researchOutdoorAdventureWithTrailAccessV1 } from "../outdoorResearch/outdoorResearchExecutor.js";
import { bindOutdoorResearchIntentToReviewedRegionV1 } from "../outdoorResearch/regionBindings.js";
import { validateAdventureResearchDossierV1 } from "../outdoorResearch/validation.js";
import { canonicalizeResearchGuidedRouteIntentV1 } from "../routeResearch/contractSemantics.js";
import {
  buildResearchGuidedRouteCandidatePlanV2,
  validateResearchGuidedRouteCandidatePlanV2,
  validateResearchGuidedRouteCandidatePlanV2ForResearch
} from "../routeResearch/researchGuidedRouteCandidatePlannerV2.js";
import { routeResearchGuidedCandidatesV2 } from "../routeResearch/researchGuidedRoutingAdapterV2.js";
import { validateResearchGuidedRoutedAlternativesV2 } from "../routeResearch/routedAlternativesContractV2.js";
import {
  validateOutdoorAdventurePlanningGapsV1
} from "./orchestrationContract.js";
import {
  validateOutdoorAdventurePlanningRequestV2,
  validateOutdoorAdventurePlanningResponseV2
} from "./orchestrationContractV2.js";
import { outdoorAdventureOrchestrationError } from "./orchestrationErrors.js";

export async function planAndRouteOutdoorAdventureV2(
  requestInput,
  dependencies = {},
  options = {}
) {
  const request = validateOutdoorAdventurePlanningRequestV2(requestInput);
  const settings = settingsFor(options);
  const deps = dependenciesFor(dependencies);
  if (settings.signal?.aborted) throw outdoorAdventureOrchestrationError("cancelled");
  return withDeadline(settings, async (signal) => {
    let normalizedIntent = canonicalizeResearchGuidedRouteIntentV1(request.intent);
    if (normalizedIntent.geographicAnchor.state === "resolved") {
      const binding = bindOutdoorResearchIntentToReviewedRegionV1(
        normalizedIntent,
        deps.regionBindings
      );
      if (binding) normalizedIntent = canonicalizeResearchGuidedRouteIntentV1(
        binding.normalizedIntent
      );
    }
    const research = validateResearchResult(await deps.researchAdventure(
      normalizedIntent,
      {
        repository: deps.repository,
        clock: deps.clock,
        signal,
        regionBindings: deps.regionBindings,
        totalTimeoutMs: settings.researchTimeoutMs
      }
    ));
    assertSameIntent(normalizedIntent, research.normalizedIntent);
    if (research.state === "clarification_required") return response({
      state: "clarification_required",
      normalizedIntent,
      planningGaps: research.planningGaps,
      clarificationQuestions: research.clarificationQuestions,
      routedAlternatives: null
    });
    if (research.state === "unsupported") return response({
      state: "unsupported", normalizedIntent,
      planningGaps: research.planningGaps,
      clarificationQuestions: [], routedAlternatives: null
    });
    const plan = deps.validateCandidatePlan(deps.buildCandidatePlan(
      research.dossier,
      research.trailAccessResolution,
      { maximumProposals: settings.maximumProposals }
    ));
    validateResearchGuidedRouteCandidatePlanV2ForResearch(
      plan,
      research.dossier,
      research.trailAccessResolution,
      { maximumProposals: settings.maximumProposals }
    );
    assertSameIntent(normalizedIntent, plan.normalizedIntent);
    if (plan.state === "unsupported") return response({
      state: "unsupported", normalizedIntent,
      planningGaps: research.planningGaps,
      clarificationQuestions: [], routedAlternatives: null
    });
    if (plan.proposals.length === 0) return response({
      state: "no_viable_route", normalizedIntent,
      planningGaps: research.planningGaps,
      clarificationQuestions: [], routedAlternatives: null
    });
    const routed = deps.validateRoutedAlternatives(await deps.routeCandidates(
      plan,
      { provider: deps.provider },
      {
        signal,
        maximumConcurrency: settings.maximumConcurrency,
        operationTimeoutMilliseconds: settings.graphHopperAttemptTimeoutMs
      }
    ));
    assertSameIntent(normalizedIntent, routed.normalizedIntent);
    const count = routed.attempts.reduce(
      (total, attempt) => total + attempt.routeResults.length,
      0
    );
    const state = count === 0 ? "no_viable_route"
      : routed.state === "routed" && plan.state === "ready" &&
        research.planningGaps.length === 0 ? "routed" : "partial";
    return response({
      state,
      normalizedIntent,
      planningGaps: research.planningGaps,
      clarificationQuestions: [],
      routedAlternatives: routed
    });
  });
}

function validateResearchResult(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) internal();
  const normalizedIntent = canonicalizeResearchGuidedRouteIntentV1(input.normalizedIntent);
  const planningGaps = validateOutdoorAdventurePlanningGapsV1(input.planningGaps);
  if (input.state === "clarification_required") {
    if (!exact(input, ["state", "normalizedIntent", "planningGaps", "clarificationQuestions"]) ||
        !Array.isArray(input.clarificationQuestions)) internal();
    return { state: input.state, normalizedIntent, planningGaps,
      clarificationQuestions: input.clarificationQuestions };
  }
  if (input.state === "unsupported") {
    if (!exact(input, ["state", "normalizedIntent", "planningGaps", "availabilityState"])) internal();
    return { state: input.state, normalizedIntent, planningGaps };
  }
  if (input.state !== "ready" || !exact(input, [
    "state", "normalizedIntent", "planningGaps", "dossier", "trailAccessResolution"
  ])) internal();
  return {
    state: "ready",
    normalizedIntent,
    planningGaps,
    dossier: validateAdventureResearchDossierV1(input.dossier),
    trailAccessResolution: input.trailAccessResolution
  };
}

function dependenciesFor(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => ![
        "repository", "provider", "clock", "regionBindings", "researchAdventure",
        "buildCandidatePlan", "validateCandidatePlan", "routeCandidates",
        "validateRoutedAlternatives"
      ].includes(key))) internal();
  const result = {
    repository: input.repository,
    provider: input.provider,
    clock: input.clock,
    regionBindings: input.regionBindings,
    researchAdventure: input.researchAdventure ?? researchOutdoorAdventureWithTrailAccessV1,
    buildCandidatePlan: input.buildCandidatePlan ?? buildResearchGuidedRouteCandidatePlanV2,
    validateCandidatePlan: input.validateCandidatePlan ?? validateResearchGuidedRouteCandidatePlanV2,
    routeCandidates: input.routeCandidates ?? routeResearchGuidedCandidatesV2,
    validateRoutedAlternatives: input.validateRoutedAlternatives ?? validateResearchGuidedRoutedAlternativesV2
  };
  if ([result.researchAdventure, result.buildCandidatePlan, result.validateCandidatePlan,
    result.routeCandidates, result.validateRoutedAlternatives].some((item) => typeof item !== "function")) internal();
  return result;
}

function settingsFor(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => ![
        "signal", "maximumProposals", "maximumConcurrency", "researchTimeoutMs",
        "graphHopperAttemptTimeoutMs", "totalDeadlineMs"
      ].includes(key))) throw outdoorAdventureOrchestrationError("feature_unavailable");
  const integer = (value, fallback, min, max) => {
    const result = value ?? fallback;
    if (!Number.isInteger(result) || result < min || result > max) {
      throw outdoorAdventureOrchestrationError("feature_unavailable");
    }
    return result;
  };
  const result = {
    signal: input.signal,
    maximumProposals: integer(input.maximumProposals, 3, 1, 6),
    maximumConcurrency: integer(input.maximumConcurrency, 2, 1, 2),
    researchTimeoutMs: integer(input.researchTimeoutMs, 7_500, 250, 30_000),
    graphHopperAttemptTimeoutMs: integer(input.graphHopperAttemptTimeoutMs, 8_000, 1_000, 30_000),
    totalDeadlineMs: integer(input.totalDeadlineMs, 25_000, 1_000, 45_000)
  };
  if (result.researchTimeoutMs >= result.totalDeadlineMs ||
      result.graphHopperAttemptTimeoutMs >= result.totalDeadlineMs) {
    throw outdoorAdventureOrchestrationError("feature_unavailable");
  }
  return result;
}

async function withDeadline(settings, work) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  settings.signal?.addEventListener("abort", abort, { once: true });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(outdoorAdventureOrchestrationError("timed_out"));
    }, settings.totalDeadlineMs);
  });
  try {
    return await Promise.race([work(controller.signal), timeout]);
  } catch (error) {
    if (settings.signal?.aborted) throw outdoorAdventureOrchestrationError("cancelled");
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
    settings.signal?.removeEventListener("abort", abort);
  }
}

function response(fields) {
  return validateOutdoorAdventurePlanningResponseV2({
    schemaVersion: 2,
    policyVersion: "outdoor-adventure-orchestration-v2",
    ...fields
  });
}
function assertSameIntent(left, right) {
  if (JSON.stringify(canonicalizeResearchGuidedRouteIntentV1(left)) !==
      JSON.stringify(canonicalizeResearchGuidedRouteIntentV1(right))) internal();
}
function exact(input, fields) {
  const keys = Object.keys(input);
  return keys.length === fields.length && keys.every((key) => fields.includes(key));
}
function internal() { throw outdoorAdventureOrchestrationError("internal_failure"); }
