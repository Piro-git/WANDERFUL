import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OutdoorAdventureStagingProofBackendCaptureError,
  outdoorAdventureStagingProofCanonicalIntentDigestV1,
  withControlledOutdoorAdventureProofServerV1
} from "../evaluation/outdoorAdventureStagingProof/operationalBackendCapture.js";
import {
  OutdoorAdventureStagingProofOperationalDriverError,
  createControlledOutdoorAdventureStagingProofCaseDriverV1,
  createOutdoorAdventureStagingProofCaseDriverV1,
  deriveSemanticObservationIds,
  hasCausalGraphHopperTimeoutExecution,
  inspectOutdoorAdventureStagingProofLiveDriverV1,
  outdoorAdventureStagingProofXCTestBindingV1
} from "../evaluation/outdoorAdventureStagingProof/operationalCaseDriver.js";
import {
  createControlledOutdoorAdventureStagingProofEvaluatorV1
} from "../evaluation/outdoorAdventureStagingProof/evaluator.js";
import {
  loadOutdoorAdventureStagingProofManifestV1,
  outdoorAdventureStagingProofInputDigestV1
} from "../evaluation/outdoorAdventureStagingProof/manifest.js";
import {
  createDevelopmentRouteAuthorizer
} from "../src/routing/routeAuthorization.js";
import {
  PostgresAppAttestRepository
} from "../src/appAttest/postgresAppAttestRepository.js";
import {
  PostgresOutdoorResearchRepository
} from "../src/outdoorResearch/postgresOutdoorResearchRepository.js";

const MANIFEST_PATH = new URL(
  "../evaluation/outdoorAdventureStagingProof/fixtures/mandatoryCasesV1.json",
  import.meta.url
);

describe("outdoor adventure staging proof operational capture", () => {
  it("binds a canonical fixture to the production HTTP planning path", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const evaluationCase = manifest.cases[5];
    let repositoryCalls = 0;
    let providerCalls = 0;
    let authorizationCalls = 0;
    const result = await withControlledOutdoorAdventureProofServerV1({
      evaluationCase,
      context: controlledContext({
        repository: {
          async withConsistentSnapshot() {
            repositoryCalls += 1;
            throw new Error("unexpected repository call");
          }
        },
        provider: {
          async route() {
            providerCalls += 1;
            throw new Error("unexpected provider call");
          }
        },
        instrumentAuthorizer(authorizer) {
          return {
            async authorize(input) {
              authorizationCalls += 1;
              return authorizer.authorize(input);
            }
          };
        }
      }),
      env: {},
      async operation({ endpointOrigin }) {
        const response = await fetch(
          `${endpointOrigin}/api/outdoor-research/plan-route`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              schemaVersion: 1,
              intent: outsideCoverageIntent()
            })
          }
        );
        return {
          statusCode: response.status,
          payload: await response.json()
        };
      }
    });

    assert.equal(result.value.statusCode, 200);
    assert.equal(result.value.payload.state, "unsupported");
    assert.equal(result.capture.executions.length, 1);
    assert.equal(result.capture.executions[0].intentBound, true);
    assert.equal(result.capture.executions[0].repositoryCalls, 0);
    assert.equal(result.capture.executions[0].providerCalls, 0);
    assert.equal(repositoryCalls, 0);
    assert.equal(providerCalls, 0);
    assert.equal(authorizationCalls, 1);
  });

  it("does not start an endpoint request for a feature-off runtime case", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const evaluationCase = manifest.cases[16];
    const result = await withControlledOutdoorAdventureProofServerV1({
      evaluationCase,
      context: controlledContext(),
      env: {},
      async operation({ canonicalInput, endpointOrigin }) {
        assert.equal(canonicalInput.flow, "feature_disabled");
        assert.match(endpointOrigin, /^http:\/\/127\.0\.0\.1:\d+$/);
        return "no-request";
      }
    });
    assert.equal(result.value, "no-request");
    assert.deepEqual(result.capture.executions, []);
  });

  it("binds the controlled malformed response to the iOS request", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const evaluationCase = manifest.cases[15];
    const result = await withControlledOutdoorAdventureProofServerV1({
      evaluationCase,
      context: controlledContext(),
      env: {},
      async operation({ endpointOrigin }) {
        const response = await fetch(
          `${endpointOrigin}/api/outdoor-research/plan-route`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-trailmind-request-id":
                "00000000-0000-4000-8000-000000000016"
            },
            body: JSON.stringify({
              schemaVersion: 1,
              intent: harzIlsenburgIntent()
            })
          }
        );
        return {
          statusCode: response.status,
          payload: await response.json()
        };
      }
    });
    assert.deepEqual(result.value.payload, { schemaVersion: 1 });
    assert.equal(result.capture.executions.length, 1);
    assert.equal(result.capture.executions[0].intentBound, true);
    assert.match(
      result.capture.executions[0].requestIdDigest,
      /^[0-9a-f]{64}$/
    );
    assert.equal(result.capture.executions[0].repositoryCalls, 0);
    assert.equal(result.capture.executions[0].providerCalls, 0);
  });

  it("does not synthesize routing or provider traffic for case16", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const evaluationCase = manifest.cases[15];
    const evaluate =
      createControlledOutdoorAdventureStagingProofEvaluatorV1({
        async runCase(value) {
          return {
            ...emptyObservation(value),
            terminalState: "rejected",
            response: { schemaVersion: 1 }
          };
        }
      });

    const result = await evaluate(evaluationCase);
    assert.equal(result.routingSource, "none");
    assert.equal(result.providerTraffic, "none");
    assert(result.errorCodes.includes("ios_runtime_receipt_missing"));
  });

  it("rejects an unrecognized point-to-point destination fixture", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const input = structuredClone(manifest.cases[11].input);
    input.destinationFixture = "unreviewed-destination";
    assert.throws(
      () => outdoorAdventureStagingProofCanonicalIntentDigestV1(input),
      (error) =>
        error instanceof OutdoorAdventureStagingProofBackendCaptureError &&
        error.code === "canonical_input_not_representable"
    );
  });

  it("rejects a live lane from the loopback-only topology", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    await assert.rejects(
      withControlledOutdoorAdventureProofServerV1({
        evaluationCase: manifest.cases[0],
        context: {
          ...controlledContext(),
          lane: "live"
        },
        env: {},
        async operation() {}
      }),
      (error) =>
        error instanceof OutdoorAdventureStagingProofBackendCaptureError &&
        error.code === "invalid_controlled_topology"
    );
  });

  it("limits the controlled iOS proof driver to case16", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    let iosRunCount = 0;
    const runCase =
      createControlledOutdoorAdventureStagingProofCaseDriverV1({
        expectedDeviceId: "controlled-simulator",
        async runIOSCase() {
          iosRunCount += 1;
          return "/tmp/unexpected.xcresult";
        },
        env: {}
      });

    await assert.rejects(
      runCase(
        manifest.cases[0],
        controlledContext({
          ingestVerifiedIOSRuntimeReceipt() {}
        })
      ),
      (error) =>
        error instanceof
          OutdoorAdventureStagingProofOperationalDriverError &&
        error.code === "controlled_case_requires_external_runner"
    );
    assert.equal(iosRunCount, 0);
  });

  it("uses Xcode's exact selector and xcresult identifier forms", () => {
    assert.deepEqual(
      outdoorAdventureStagingProofXCTestBindingV1(
        "case-16-malformed-backend-response-rejected-by-ios"
      ),
      {
        onlyTestingIdentifier:
          "TrailMindUITests/TrailMindStagingProofUITests/testCase16",
        xcresultTestIdentifier:
          "TrailMindStagingProofUITests/testCase16()"
      }
    );
    assert.throws(
      () =>
        outdoorAdventureStagingProofXCTestBindingV1(
          "case-19-unknown"
        ),
      (error) =>
        error instanceof
          OutdoorAdventureStagingProofOperationalDriverError &&
        error.code === "invalid_case_id"
    );
  });

  it("keeps the full proof driver blocked without an approved physical-device verifier", async () => {
    await assert.rejects(
      createOutdoorAdventureStagingProofCaseDriverV1(),
      (error) =>
        error instanceof
          OutdoorAdventureStagingProofOperationalDriverError &&
        error.code ===
          "approved_https_ios_receipt_verifier_missing"
    );
  });

  it("does not let the controlled case16 driver satisfy live readiness", () => {
    const controlled =
      createControlledOutdoorAdventureStagingProofCaseDriverV1({
        expectedDeviceId: "controlled-simulator",
        async runIOSCase() {
          return "/tmp/unavailable.xcresult";
        }
      });
    assert.equal(
      inspectOutdoorAdventureStagingProofLiveDriverV1(controlled),
      null
    );
    assert.equal(
      inspectOutdoorAdventureStagingProofLiveDriverV1({
        runCase: controlled,
        causalPipelineCaptureConfigured: true,
        appAttestReceiptIntegrationConfigured: true,
        iosRuntimeReceiptIntegrationConfigured: true
      }),
      null
    );
  });

  it("projects only case-scoped semantic observations", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const case16 = manifest.cases[15];
    assert.deepEqual(
      deriveSemanticObservationIds({
        evaluationCase: case16,
        capture: semanticCapture(case16.input),
        receipt: semanticReceipt({
          proofTerminalState: "rejected",
          plannerTerminalState: "recoverable_error",
          researchOutcome: "failure"
        }),
        response: { schemaVersion: 1 },
        dossier: null,
        candidatePlan: null,
        dependencyFacts: noCausalDependencyFacts()
      }),
      ["malformed_response_rejected_by_ios"]
    );

    for (const caseIndex of [14, 17]) {
      const evaluationCase = manifest.cases[caseIndex];
      assert(
        evaluationCase.input.preferredExperiences.includes(
          "viewpoint"
        )
      );
      assert.equal(
        evaluationCase.expected.semanticExpectationIds.includes(
          "viewpoint_preference_preserved"
        ),
        false
      );
      assert.deepEqual(
        deriveSemanticObservationIds({
          evaluationCase,
          capture: semanticCapture(evaluationCase.input),
          receipt: semanticReceipt(),
          response: null,
          dossier: null,
          candidatePlan: null,
          dependencyFacts: noCausalDependencyFacts()
        }),
        ["canonical_intent_bound"]
      );
    }

    for (const caseIndex of [12, 13]) {
      const evaluationCase = manifest.cases[caseIndex];
      assert.deepEqual(
        deriveSemanticObservationIds({
          evaluationCase,
          capture: semanticCapture(evaluationCase.input),
          receipt: semanticReceipt(),
          response: null,
          dossier: null,
          candidatePlan: null,
          dependencyFacts: noCausalDependencyFacts()
        }),
        ["canonical_intent_bound"]
      );
    }
  });

  it("requires the captured provider abort to yield route_timed_out", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const evaluationCase = manifest.cases[13];
    const capture = semanticCapture(evaluationCase.input);
    Object.assign(capture.executions[0], {
      completed: true,
      statusCode: 200,
      deliveredOutcome: "production_endpoint_result",
      providerCalls: 1,
      providerOutcomes: [
        "actual_call_aborted_while_in_flight"
      ],
      payload: {
        routedAlternatives: {
          attempts: [{
            state: "failed",
            failureCode: "routing_unavailable"
          }]
        }
      }
    });
    const receipt = semanticReceipt({
      proofTerminalState: "legacy_fallback",
      legacyRoutingRequestCount: 1
    });
    const dependencyFacts = {
      ...noCausalDependencyFacts(),
      graphHopperAbortWhileInFlight: true
    };

    assert.equal(
      hasCausalGraphHopperTimeoutExecution(capture),
      false
    );
    assert.deepEqual(
      deriveSemanticObservationIds({
        evaluationCase,
        capture,
        receipt,
        response: null,
        dossier: null,
        candidatePlan: null,
        dependencyFacts
      }),
      ["canonical_intent_bound", "legacy_fallback_once"]
    );

    capture.executions[0].payload.routedAlternatives
      .attempts[0].failureCode = "route_timed_out";
    assert.equal(
      hasCausalGraphHopperTimeoutExecution(capture),
      true
    );
    assert.deepEqual(
      deriveSemanticObservationIds({
        evaluationCase,
        capture,
        receipt,
        response: null,
        dossier: null,
        candidatePlan: null,
        dependencyFacts
      }),
      [
        "canonical_intent_bound",
        "graphhopper_timeout_observed",
        "legacy_fallback_once"
      ]
    );
  });

  it("requires the exact named Brocken entity across evidence, planning, and routing", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const evaluationCase = manifest.cases[3];
    const coordinate = {
      latitude: 51.7991,
      longitude: 10.6156
    };
    const dossier = {
      evidenceClaims: [{
        claimId: "claim-brocken-name",
        entityId: "peak-brocken",
        predicate: "name",
        value: { type: "text", value: "Brocken" },
        resolutionState: "known",
        freshness: "current"
      }],
      candidateHighlights: [{
        entityId: "peak-brocken",
        highlightCategory: "peak",
        coordinate,
        evidenceClaimIds: ["claim-brocken-name"]
      }]
    };
    const candidatePlan = {
      proposals: [{
        viaCandidates: [{
          entityId: "peak-brocken",
          highlightCategory: "peak",
          role: "must_have",
          coordinate
        }],
        satisfiedRequirements: [{
          requirementType: "must_have_experience",
          value: "peak",
          includedCount: 1,
          shortfallCount: 0
        }]
      }]
    };
    const response = {
      routedAlternatives: {
        normalizedIntent: {
          activity: evaluationCase.input.activity,
          routeType: evaluationCase.input.routeType,
          preferredExperiences:
            evaluationCase.input.preferredExperiences,
          avoidedExperiences:
            evaluationCase.input.avoidedExperiences,
          maximumTechnicalDifficulty:
            evaluationCase.input.maximumTechnicalDifficulty
        },
        attempts: [{
          state: "routed",
          routeResults: [{
            waypointVisits: [{
              role: "via",
              entityId: "peak-brocken",
              requestedCoordinate: coordinate,
              snappedCoordinate: coordinate,
              snapDistanceMeters: 0,
              withinVisitTolerance: true
            }]
          }]
        }]
      }
    };
    const derive = (overrides = {}) =>
      deriveSemanticObservationIds({
        evaluationCase,
        capture: semanticCapture(evaluationCase.input),
        receipt: semanticReceipt(),
        response,
        dossier,
        candidatePlan,
        dependencyFacts: noCausalDependencyFacts(),
        ...overrides
      });

    assert(derive().includes(
      "named_brocken_must_have_satisfied"
    ));
    const wrongNameDossier = structuredClone(dossier);
    wrongNameDossier.evidenceClaims[0].value.value = "Wurmberg";
    assert.equal(
      derive({ dossier: wrongNameDossier }).includes(
        "named_brocken_must_have_satisfied"
      ),
      false
    );
    const wrongCoordinateResponse = structuredClone(response);
    wrongCoordinateResponse.routedAlternatives.attempts[0]
      .routeResults[0].waypointVisits[0].requestedCoordinate = {
        latitude: 51.8000,
        longitude: 10.6160
      };
    assert.equal(
      derive({ response: wrongCoordinateResponse }).includes(
        "named_brocken_must_have_satisfied"
      ),
      false
    );
  });

  it("allows exactly two distinct causal authorizations for retry", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const evaluationCase = manifest.cases[17];
    const evaluate =
      createControlledOutdoorAdventureStagingProofEvaluatorV1({
        repository: controlledContext().repository,
        provider: controlledContext().provider,
        async runCase(value, context) {
          const authorizer = context.instrumentAuthorizer(
            createDevelopmentRouteAuthorizer()
          );
          await authorizer.authorize({
            requestId: "00000000-0000-4000-8000-000000000001"
          });
          await authorizer.authorize({
            requestId: "00000000-0000-4000-8000-000000000002"
          });
          return emptyObservation(value);
        }
      });
    const result = await evaluate(evaluationCase);
    assert.equal(result.authorization, "development_session");
    assert.equal(
      result.errorCodes.includes("authorization_mismatch"),
      true
    );
  });

  it("rejects a duplicate retry authorization request ID", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const evaluationCase = manifest.cases[17];
    const evaluate =
      createControlledOutdoorAdventureStagingProofEvaluatorV1({
        repository: controlledContext().repository,
        provider: controlledContext().provider,
        async runCase(value, context) {
          const authorizer = context.instrumentAuthorizer(
            createDevelopmentRouteAuthorizer()
          );
          const requestId =
            "00000000-0000-4000-8000-000000000001";
          await authorizer.authorize({ requestId });
          await authorizer.authorize({ requestId });
          return emptyObservation(value);
        }
      });
    await assert.rejects(
      evaluate(evaluationCase),
      /duplicated or out of bounds/
    );
  });

  it("rejects a lookalike durable App Attest repository", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const evaluate =
      createControlledOutdoorAdventureStagingProofEvaluatorV1({
        repository: controlledContext().repository,
        appAttestRepository: {
          isDurable: true,
          async createRouteSession() {},
          async consumeRouteAccess() {}
        },
        provider: controlledContext().provider,
        async runCase(value) {
          return emptyObservation(value);
        }
      });
    await assert.rejects(
      evaluate(manifest.cases[0]),
      /durable Postgres adapter/
    );
  });

  it("does not classify durable session writes without verified App Attest assertion evidence", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const installationId = "a".repeat(64);
    const tokenHash = "b".repeat(64);
    const appAttestRepository =
      new PostgresAppAttestRepository({
        pool: {
          async connect() {
            throw new Error("not used");
          },
          async query() {
            throw new Error("not used");
          }
        }
      });
    appAttestRepository.createRouteSession = async () => {};
    appAttestRepository.consumeRouteAccess = async () => ({
      installationId,
      remainingCost: 1,
      leaseId: "lease"
    });
    const evaluate =
      createControlledOutdoorAdventureStagingProofEvaluatorV1({
        repository: controlledContext().repository,
        appAttestRepository,
        provider: controlledContext().provider,
        async runCase(value, context) {
          await context.appAttestRepository.createRouteSession({
            tokenHash,
            installationId,
            expiresAt: Date.now() + 60_000,
            maximumCost: 1
          });
          await context.appAttestRepository.consumeRouteAccess({
            tokenHash,
            requestId:
              "00000000-0000-4000-8000-000000000001"
          });
          return emptyObservation(value);
        }
      });
    const result = await evaluate(manifest.cases[0]);
    assert.equal(result.authorization, "none");
    assert(result.errorCodes.includes("authorization_mismatch"));
  });

  it("does not classify an abort between PostgreSQL queries as query cancellation", async () => {
    const lifecycle = [];
    const queries = [];
    const client = {
      async query(statement) {
        queries.push(statement);
        return { rows: [] };
      },
      release() {}
    };
    const repository = new PostgresOutdoorResearchRepository({
      pool: {
        async connect() {
          return client;
        }
      },
      transactionLifecycleObserver(event) {
        lifecycle.push(event);
      }
    });
    const controller = new AbortController();
    await assert.rejects(
      repository.withConsistentSnapshot(
        { signal: controller.signal },
        async () => {
          controller.abort();
        }
      ),
      (error) => error?.code === "request_cancelled"
    );
    assert.deepEqual(lifecycle, [
      "began"
    ]);
    assert.equal(queries.at(-1), "ROLLBACK");
  });

  it("requires an accepted PostgreSQL cancel, cancelled query, and rollback", async () => {
    const lifecycle = [];
    const primaryQueries = [];
    let rejectActiveQuery;
    const primaryClient = {
      processID: 42,
      async query(statement) {
        primaryQueries.push(statement);
        if (statement === "SELECT proof_active_query") {
          return await new Promise((_resolve, reject) => {
            rejectActiveQuery = reject;
          });
        }
        return { rows: [] };
      },
      release() {}
    };
    let cancellationReleased = false;
    const cancellationClient = {
      async query(statement, values) {
        assert.equal(
          statement,
          "SELECT pg_cancel_backend($1) AS cancelled"
        );
        assert.deepEqual(values, [42]);
        const error = new Error("cancelled");
        error.code = "57014";
        rejectActiveQuery(error);
        return { rows: [{ cancelled: true }] };
      },
      release() {
        cancellationReleased = true;
      }
    };
    let productConnectionCount = 0;
    let controlConnectionCount = 0;
    const repository = new PostgresOutdoorResearchRepository({
      pool: {
        async connect() {
          productConnectionCount += 1;
          return primaryClient;
        }
      },
      cancellationPool: {
        async connect() {
          controlConnectionCount += 1;
          return cancellationClient;
        }
      },
      transactionLifecycleObserver(event) {
        lifecycle.push(event);
      }
    });
    const controller = new AbortController();
    await assert.rejects(
      repository.withConsistentSnapshot(
        { signal: controller.signal },
        async (snapshot) => {
          const activeQuery = snapshot.query(
            "SELECT proof_active_query",
            []
          );
          controller.abort();
          await activeQuery;
        }
      ),
      (error) => error?.code === "request_cancelled"
    );
    assert.deepEqual(lifecycle, [
      "began",
      "query_cancelled_after_abort",
      "rollback_completed_after_cancel"
    ]);
    assert.equal(primaryQueries.at(-1), "ROLLBACK");
    assert.equal(cancellationReleased, true);
    assert.equal(productConnectionCount, 1);
    assert.equal(controlConnectionCount, 1);
  });

  it("never obtains cancellation capacity from the retained transaction pool", async () => {
    const sharedPool = {
      async connect() {
        throw new Error("not reached");
      }
    };
    assert.throws(
      () => new PostgresOutdoorResearchRepository({
        pool: sharedPool,
        cancellationPool: sharedPool
      }),
      (error) => error?.code === "invalid_dependencies"
    );

    let connects = 0;
    let releases = 0;
    let rejectActiveQuery;
    const primaryClient = {
      processID: 42,
      async query(statement) {
        if (statement === "SELECT proof_active_query") {
          return await new Promise((_resolve, reject) => {
            rejectActiveQuery = reject;
          });
        }
        return { rows: [] };
      },
      release() {
        releases += 1;
      }
    };
    const repository = new PostgresOutdoorResearchRepository({
      pool: {
        async connect() {
          connects += 1;
          return primaryClient;
        }
      }
    });
    const controller = new AbortController();
    const operation = repository.withConsistentSnapshot(
      { signal: controller.signal },
      async (snapshot) => {
        const activeQuery = snapshot.query(
          "SELECT proof_active_query",
          []
        );
        controller.abort();
        const error = new Error("statement cancelled");
        error.code = "57014";
        rejectActiveQuery(error);
        await activeQuery;
      }
    );
    await assert.rejects(
      operation,
      (error) => error?.code === "request_cancelled"
    );
    assert.equal(connects, 1);
    assert.equal(releases, 1);
  });

  it("distinguishes an in-flight provider abort from a post-settlement abort", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const evaluationCase = manifest.cases[13];
    const inFlightEvaluator =
      createControlledOutdoorAdventureStagingProofEvaluatorV1({
        repository: controlledContext().repository,
        provider: {
          async route(_request, { signal }) {
            await new Promise((resolve, reject) => {
              signal.addEventListener(
                "abort",
                () => reject(new Error("aborted")),
                { once: true }
              );
            });
          }
        },
        async runCase(value, context) {
          const controller = new AbortController();
          const pending = context.provider.route(
            {},
            { signal: controller.signal }
          );
          controller.abort();
          await assert.rejects(pending);
          assert.equal(
            context.causalDependencyFacts()
              .graphHopperAbortWhileInFlight,
            true
          );
          return emptyObservation(value);
        }
      });
    await inFlightEvaluator(evaluationCase);

    const settledEvaluator =
      createControlledOutdoorAdventureStagingProofEvaluatorV1({
        repository: controlledContext().repository,
        provider: {
          async route() {
            return { paths: [] };
          }
        },
        async runCase(value, context) {
          const controller = new AbortController();
          await context.provider.route(
            {},
            { signal: controller.signal }
          );
          controller.abort();
          assert.equal(
            context.causalDependencyFacts()
              .graphHopperAbortWhileInFlight,
            false
          );
          return emptyObservation(value);
        }
      });
    await settledEvaluator(evaluationCase);
  });
});

function controlledContext(overrides = {}) {
  return {
    lane: "controlled",
    signal: undefined,
    repository: {
      async withConsistentSnapshot() {
        throw new Error("unexpected repository call");
      }
    },
    provider: {
      async route() {
        throw new Error("unexpected provider call");
      }
    },
    async measureStage(_stage, operation) {
      return operation();
    },
    measureSynchronousStage(_stage, operation) {
      return operation();
    },
    instrumentAuthorizer(authorizer) {
      return authorizer;
    },
    ...overrides
  };
}

function semanticCapture(input) {
  return {
    executions: [{
      intentBound: true,
      researchIntent: {
        activity: input.activity,
        routeType: input.routeType,
        preferredExperiences: input.preferredExperiences,
        avoidedExperiences: input.avoidedExperiences,
        maximumTechnicalDifficulty:
          input.maximumTechnicalDifficulty
      },
      repositoryCalls: 0,
      providerCalls: 0,
      providerOutcomes: []
    }]
  };
}

function semanticReceipt(overrides = {}) {
  return {
    proofTerminalState: "succeeded",
    plannerTerminalState: "suggestions_ready",
    adapterState: "ready",
    researchOutcome: "routed",
    researchCoordinatorRequestCount: 1,
    legacyRoutingRequestCount: 0,
    contractConversion: {
      acceptedCount: 0,
      coordinatorSelectionOrderDigest: null,
      plannerSuggestionOrderDigest: null
    },
    presentation: {
      count: 0,
      inputOrderDigest: null,
      outputOrderDigest: null
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
      priorTerminalState: null,
      currentTerminalState: null,
      currentResultDigest: null
    },
    iosStageTimings: {
      route_quality: []
    },
    ...overrides
  };
}

function noCausalDependencyFacts() {
  return {
    postgresAbortWhileActive: false,
    postgresRollbackAfterAbort: false,
    graphHopperAbortWhileInFlight: false
  };
}

function outsideCoverageIntent() {
  return {
    schemaVersion: 1,
    activity: "hiking",
    geographicAnchor: {
      state: "resolved",
      name: "Lüneburg",
      coordinate: { latitude: 53.2487, longitude: 10.4079 },
      regionEntityId: null
    },
    routeType: "loop",
    distanceRangeKm: { min: 10, max: 10 },
    durationRangeMinutes: null,
    maximumElevationGainMeters: null,
    maximumTechnicalDifficulty: null,
    mustHaveExperiences: [],
    preferredExperiences: [],
    avoidedExperiences: [],
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
    unresolvedClarificationQuestions: []
  };
}

function harzIlsenburgIntent() {
  return {
    ...outsideCoverageIntent(),
    geographicAnchor: {
      state: "resolved",
      name: "Ilsenburg",
      coordinate: { latitude: 51.8666, longitude: 10.6782 },
      regionEntityId: null
    },
    distanceRangeKm: { min: 12, max: 12 }
  };
}

function emptyObservation(evaluationCase) {
  return {
    id: evaluationCase.id,
    inputFixtureId: evaluationCase.input.fixtureId,
    inputDigest:
      outdoorAdventureStagingProofInputDigestV1(evaluationCase.input),
    semanticExpectationIds: [
      ...evaluationCase.expected.semanticExpectationIds
    ],
    limitationCauseIds: [
      ...evaluationCase.expected.requiredLimitationCauseIds
    ],
    terminalState: evaluationCase.expected.terminalState,
    skipped: false,
    response: null,
    dossier: null,
    candidatePlan: null
  };
}
