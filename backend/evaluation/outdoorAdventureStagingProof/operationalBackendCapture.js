import { createHash } from "node:crypto";
import {
  createOutdoorAdventurePlanningEndpoint
} from "../../src/outdoorAdventure/outdoorAdventureEndpoint.js";
import {
  planAndRouteOutdoorAdventureV1
} from "../../src/outdoorAdventure/outdoorAdventureOrchestrator.js";
import {
  assembleAdventureResearchDossierV1
} from "../../src/outdoorResearch/dossierAssembler.js";
import {
  researchOutdoorAdventureV1
} from "../../src/outdoorResearch/outdoorResearchExecutor.js";
import {
  validateAdventureResearchDossierV1,
  validateAdventureResearchIntentV1
} from "../../src/outdoorResearch/validation.js";
import {
  buildResearchGuidedRouteCandidatePlanV1
} from "../../src/routeResearch/researchGuidedRouteCandidatePlanner.js";
import {
  validateResearchGuidedRouteCandidatePlanV1
} from "../../src/routeResearch/validation.js";
import {
  createDevelopmentRouteAuthorizer
} from "../../src/routing/routeAuthorization.js";
import { routeError } from "../../src/routing/routeErrors.js";
import { createIntentServer } from "../../src/server.js";

const HARZ_REGION_ID = "30000000-0000-4000-8000-000000000002";
const INNSBRUCK_REGION_ID =
  "30000000-0000-4000-8000-000000000001";
const FIXTURE_ANCHORS = deepFreeze({
  "harz-brocken": {
    state: "resolved",
    name: "Brocken",
    coordinate: { latitude: 51.7992, longitude: 10.6171 },
    regionEntityId: HARZ_REGION_ID
  },
  "harz-ilsenburg": {
    state: "resolved",
    name: "Ilsenburg",
    coordinate: { latitude: 51.8666, longitude: 10.6782 },
    regionEntityId: HARZ_REGION_ID
  },
  "harz-schierke": {
    state: "resolved",
    name: "Schierke",
    coordinate: { latitude: 51.7636, longitude: 10.6647 },
    regionEntityId: HARZ_REGION_ID
  },
  "innsbruck-hungerburg": {
    state: "resolved",
    name: "Hungerburg",
    coordinate: { latitude: 47.2868, longitude: 11.3997 },
    regionEntityId: INNSBRUCK_REGION_ID
  },
  "outside-reviewed-coverage": {
    state: "resolved",
    name: "Lüneburg",
    coordinate: { latitude: 53.2487, longitude: 10.4079 },
    regionEntityId: null
  }
});
const CONTROLLED_MODIFIERS = new Set([
  "graphhopper_timeout_then_legacy_fallback"
]);

export class OutdoorAdventureStagingProofBackendCaptureError
  extends Error {
  constructor(code) {
    super(code);
    this.name = "OutdoorAdventureStagingProofBackendCaptureError";
    this.code = code;
  }
}

export function outdoorAdventureStagingProofCanonicalIntentDigestV1(
  input
) {
  const intent = canonicalIntentForInput(input, {
    includeReviewedRegionId: false
  });
  return sha256(stableSerialize(intent));
}

export async function withControlledOutdoorAdventureProofServerV1({
  evaluationCase,
  context,
  env = process.env,
  operation
}) {
  if (
    context?.lane !== "controlled" ||
    typeof context.measureStage !== "function" ||
    typeof context.measureSynchronousStage !== "function" ||
    typeof context.instrumentAuthorizer !== "function" ||
    typeof operation !== "function"
  ) {
    invalid("invalid_controlled_topology");
  }
  canonicalIntentForInput(evaluationCase?.input, {
    includeReviewedRegionId: false
  });
  const capture = createCapture(evaluationCase);
  const proofEnv = controlledEnvironment(env, evaluationCase);
  const endpoint = capturedEndpoint({
    evaluationCase,
    context,
    env: proofEnv,
    capture
  });
  const unavailable = async () => ({
    statusCode: 404,
    payload: { error: "Not found" }
  });
  const server = createIntentServer({
    env: proofEnv,
    appAttestRuntime: {
      repository: null,
      endpoint: unavailable,
      routeAuthorizer: null,
      intentAuthorizer: null
    },
    appAttestEndpoint: unavailable,
    intentEndpoint: unavailable,
    routeEndpoint: unavailable,
    outdoorEvidenceEndpoint: unavailable,
    outdoorAdventurePlanningEndpoint: endpoint
  });
  const removeAbortListener = closeServerOnAbort(
    server,
    context.signal
  );
  try {
    const origin = await listenOnLoopback(server);
    const value = await operation({
      endpointOrigin: origin,
      canonicalInput: evaluationCase.input,
      signal: context.signal
    });
    return { value, capture: finalizeCapture(capture) };
  } finally {
    removeAbortListener();
    await closeServer(server);
  }
}

function capturedEndpoint({
  evaluationCase,
  context,
  env,
  capture
}) {
  if (
    evaluationCase.input.flow === "controlled_rejection" &&
    evaluationCase.input.executionModifiers.includes(
      "malformed_backend_response"
    )
  ) {
    return async (body, requestContext) => {
      const execution = beginExecution(capture);
      try {
        execution.request = body;
        execution.requestIdDigest =
          requestIdDigest(requestContext?.headers);
        execution.statusCode = 200;
        execution.payload = { schemaVersion: 1 };
        execution.deliveredOutcome =
          "controlled_malformed_endpoint_result";
        execution.completed = true;
        return { statusCode: 200, payload: execution.payload };
      } finally {
        capture.activeExecution = null;
      }
    };
  }

  const repository = capturedRepository(context.repository, capture);
  const provider = capturedProvider(
    context.provider,
    capture,
    evaluationCase.input.executionModifiers
  );
  const developmentAuthorizer = createDevelopmentRouteAuthorizer();
  const authorizer =
    context.instrumentAuthorizer(developmentAuthorizer);
  const endpoint = createOutdoorAdventurePlanningEndpoint({
    env,
    logger: { info() {} },
    authorizer,
    repository,
    provider,
    orchestrator(request, dependencies, options) {
      const execution = activeExecution(capture);
      execution.request = request;
      return planAndRouteOutdoorAdventureV1(
        request,
        dependencies,
        options
      );
    },
    orchestrationDependencies: {
      async researchAdventure(intent, dependencies) {
        const execution = activeExecution(capture);
        execution.researchIntent = intent;
        return context.measureStage(
          "research_planning",
          async () => {
            const result = await researchOutdoorAdventureV1(
              intent,
              {
                ...dependencies,
                assembleDossier: async (input) =>
                  context.measureStage(
                    "dossier_assembly",
                    async () => {
                      const dossier =
                        await assembleAdventureResearchDossierV1(
                          input
                        );
                      execution.dossier =
                        validateAdventureResearchDossierV1(
                          dossier
                        );
                      return dossier;
                    }
                  )
              }
            );
            if (result.state === "ready") {
              execution.dossier =
                validateAdventureResearchDossierV1(
                  result.dossier
                );
            }
            return result;
          }
        );
      },
      buildCandidatePlan(dossier, options) {
        const execution = activeExecution(capture);
        const built = context.measureSynchronousStage(
          "candidate_planning",
          () => buildResearchGuidedRouteCandidatePlanV1(
            dossier,
            options
          )
        );
        execution.candidatePlan =
          validateResearchGuidedRouteCandidatePlanV1(built);
        return built;
      }
    }
  });

  return async (body, requestContext) => {
    const execution = beginExecution(capture);
    execution.requestIdDigest =
      requestIdDigest(requestContext?.headers);
    try {
      const result = await endpoint(body, requestContext);
      if (
        evaluationCase.input.flow === "retry" &&
        capture.executions.length === 1
      ) {
        const delivered = {
          statusCode: 503,
          payload: {
            error: {
              code: "internal_failure",
              message:
                "Outdoor-adventure planning could not produce a valid result."
            }
          }
        };
        execution.statusCode = delivered.statusCode;
        execution.payload = delivered.payload;
        execution.deliveredOutcome =
          "controlled_failure_after_production_execution";
        execution.completed = true;
        return delivered;
      }
      execution.statusCode = result.statusCode;
      execution.payload = result.payload;
      execution.deliveredOutcome = "production_endpoint_result";
      execution.completed = true;
      return result;
    } finally {
      capture.activeExecution = null;
    }
  };
}

function capturedRepository(repository, capture) {
  return Object.freeze({
    async withConsistentSnapshot(...args) {
      const execution = activeExecution(capture);
      execution.repositoryCalls += 1;
      return repository.withConsistentSnapshot(...args);
    }
  });
}

function capturedProvider(provider, capture, modifiers) {
  let providerCallIndex = 0;
  return Object.freeze({
    async route(request, routeContext) {
      const execution = activeExecution(capture);
      execution.providerCalls += 1;
      providerCallIndex += 1;
      let settled = false;
      const signal = routeContext?.signal;
      const observeActiveAbort =
        modifiers.includes(
          "graphhopper_timeout_then_legacy_fallback"
        ) &&
        signal &&
        typeof signal.addEventListener === "function" &&
        typeof signal.removeEventListener === "function";
      const onAbort = () => {
        if (!settled) {
          execution.providerOutcomes.push(
            "actual_call_aborted_while_in_flight"
          );
        }
      };
      if (observeActiveAbort) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
      try {
        const result = await provider.route(request, routeContext);
        settled = true;
        if (
          modifiers.includes(
            "one_provider_failure_with_survivor"
          ) &&
          providerCallIndex === 1
        ) {
          execution.providerOutcomes.push(
            "actual_call_then_controlled_failure"
          );
          throw routeError("routing_unavailable");
        }
        execution.providerOutcomes.push("actual_call_returned");
        return result;
      } catch (error) {
        settled = true;
        if (
          !execution.providerOutcomes.includes(
            "actual_call_aborted_while_in_flight"
          ) &&
          !execution.providerOutcomes.includes(
            "actual_call_then_controlled_failure"
          )
        ) {
          execution.providerOutcomes.push("actual_call_failed");
        }
        throw error;
      } finally {
        if (observeActiveAbort) {
          signal.removeEventListener("abort", onAbort);
        }
      }
    }
  });
}

function createCapture(evaluationCase) {
  return {
    caseId: evaluationCase.id,
    expectedIntentDigest:
      outdoorAdventureStagingProofCanonicalIntentDigestV1(
        evaluationCase.input
      ),
    expectedServerIntentDigest: sha256(stableSerialize(
      canonicalIntentForInput(evaluationCase.input, {
        includeReviewedRegionId: true
      })
    )),
    activeExecution: null,
    executions: []
  };
}

function beginExecution(capture) {
  if (capture.activeExecution !== null) {
    invalid("overlapping_backend_requests");
  }
  const execution = {
    ordinal: capture.executions.length + 1,
    request: null,
    researchIntent: null,
    requestIdDigest: null,
    repositoryCalls: 0,
    providerCalls: 0,
    providerOutcomes: [],
    statusCode: null,
    payload: null,
    deliveredOutcome: null,
    dossier: null,
    candidatePlan: null,
    completed: false
  };
  capture.executions.push(execution);
  capture.activeExecution = execution;
  return execution;
}

function activeExecution(capture) {
  if (capture.activeExecution === null) {
    invalid("backend_execution_not_active");
  }
  return capture.activeExecution;
}

function finalizeCapture(capture) {
  if (capture.activeExecution !== null) {
    invalid("backend_execution_incomplete");
  }
  const executions = capture.executions.map((execution) => {
    const requestIntent = execution.request?.intent ?? null;
    const actualIntentDigest = requestIntent === null
      ? null
      : sha256(stableSerialize(
        validateAdventureResearchIntentV1(requestIntent)
      ));
    const researchIntentDigest =
      execution.researchIntent === null
        ? null
        : sha256(stableSerialize(
          validateAdventureResearchIntentV1(
            execution.researchIntent
          )
        ));
    return Object.freeze({
      ...execution,
      providerOutcomes: Object.freeze([
        ...execution.providerOutcomes
      ]),
      actualIntentDigest,
      researchIntentDigest,
      intentBound:
        actualIntentDigest !== null &&
        actualIntentDigest === capture.expectedIntentDigest &&
        (
          researchIntentDigest === null ||
          researchIntentDigest ===
            capture.expectedServerIntentDigest
        )
    });
  });
  return Object.freeze({
    caseId: capture.caseId,
    expectedIntentDigest: capture.expectedIntentDigest,
    expectedServerIntentDigest:
      capture.expectedServerIntentDigest,
    executions: Object.freeze(executions)
  });
}

function canonicalIntentForInput(
  input,
  { includeReviewedRegionId }
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    invalid("canonical_input_not_representable");
  }
  if (
    input.routeType === "point_to_point" &&
    input.destinationFixture !== "harz-schierke"
  ) {
    invalid("canonical_input_not_representable");
  }
  if (
    input.routeType !== "point_to_point" &&
    input.destinationFixture !== null
  ) {
    invalid("canonical_input_not_representable");
  }
  const fixtureAnchor = input.anchorFixture === "alps-broad-region"
    ? {
      state: "unresolved",
      requirementCode: "location_required"
    }
    : FIXTURE_ANCHORS[input.anchorFixture];
  if (!fixtureAnchor) {
    invalid("canonical_input_not_representable");
  }
  const geographicAnchor = fixtureAnchor.state === "resolved"
    ? {
      ...fixtureAnchor,
      regionEntityId: includeReviewedRegionId
        ? fixtureAnchor.regionEntityId
        : null
    }
    : fixtureAnchor;
  return validateAdventureResearchIntentV1({
    schemaVersion: 1,
    activity: input.activity,
    geographicAnchor,
    routeType: input.routeType,
    distanceRangeKm: input.targetDistanceKm === null
      ? null
      : {
        min: input.targetDistanceKm,
        max: input.targetDistanceKm
      },
    durationRangeMinutes: null,
    maximumElevationGainMeters: null,
    maximumTechnicalDifficulty:
      input.maximumTechnicalDifficulty,
    mustHaveExperiences: input.mustHaveExperiences.map(
      (experience) => ({ experience, minimumCount: 1 })
    ),
    preferredExperiences: input.preferredExperiences,
    avoidedExperiences: input.avoidedExperiences,
    requiredFacilities: [],
    groupContext: {
      partySize: 1,
      includesChildren: false,
      youngestAge: null,
      mobility: "unknown",
      experienceLevel: "unknown"
    },
    dateOrSeason: null,
    overnightRequirements: {
      required: false,
      nights: 0,
      allowedAccommodationTypes: []
    },
    transportRequirements: {
      arrivalMode: "unknown",
      returnToStart: true,
      publicTransportRequired: false
    },
    unresolvedClarificationQuestions:
      input.anchorFixture === "alps-broad-region"
        ? [{
          code: "location_required",
          field: "geographicAnchor"
        }]
        : []
  });
}

function controlledEnvironment(env, evaluationCase) {
  const controlled = {
    ...env,
    NODE_ENV: "test",
    OUTDOOR_RESEARCH_PLANNING_ENABLED: "true",
    OUTDOOR_RESEARCH_PLANNING_ALLOW_INSECURE_LOCAL: "true"
  };
  if (
    evaluationCase.input.executionModifiers.some((modifier) =>
      CONTROLLED_MODIFIERS.has(modifier)
    )
  ) {
    controlled.OUTDOOR_RESEARCH_PLANNING_GRAPHHOPPER_TIMEOUT_MS =
      "1000";
    controlled.OUTDOOR_RESEARCH_PLANNING_RESEARCH_TIMEOUT_MS =
      "2000";
    controlled.OUTDOOR_RESEARCH_PLANNING_STATEMENT_TIMEOUT_MS =
      "500";
    controlled.OUTDOOR_RESEARCH_PLANNING_TOTAL_TIMEOUT_MS =
      "5000";
  }
  return controlled;
}

function listenOnLoopback(server) {
  return new Promise((resolve, reject) => {
    const fail = (error) => {
      server.removeListener("listening", ready);
      reject(error);
    };
    const ready = () => {
      server.removeListener("error", fail);
      const address = server.address();
      if (
        !address ||
        typeof address === "string" ||
        address.address !== "127.0.0.1"
      ) {
        reject(
          new OutdoorAdventureStagingProofBackendCaptureError(
            "invalid_controlled_topology"
          )
        );
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    };
    server.once("error", fail);
    server.once("listening", ready);
    server.listen(0, "127.0.0.1");
  });
}

function closeServerOnAbort(server, signal) {
  if (
    signal === undefined ||
    signal === null ||
    typeof signal.addEventListener !== "function" ||
    typeof signal.removeEventListener !== "function"
  ) {
    return () => {};
  }
  const close = () => server.close();
  signal.addEventListener("abort", close, { once: true });
  return () => signal.removeEventListener("abort", close);
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function stableSerialize(value) {
  return JSON.stringify(sortKeys(value));
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

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requestIdDigest(headers) {
  const value = headers?.["x-trailmind-request-id"];
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  ) {
    return null;
  }
  return sha256(value.toLowerCase());
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
  throw new OutdoorAdventureStagingProofBackendCaptureError(code);
}
