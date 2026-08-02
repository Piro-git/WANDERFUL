import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import {
  createControlledOutdoorAdventureStagingProofEvaluatorV1,
  createOutdoorAdventureStagingProofLaneDispatcherV1,
  createLiveOutdoorAdventureStagingProofEvaluatorV1
} from "../evaluation/outdoorAdventureStagingProof/evaluator.js";
import {
  OUTDOOR_ADVENTURE_STAGING_PROOF_CASE_IDS_V1,
  loadOutdoorAdventureStagingProofManifestV1,
  outdoorAdventureStagingProofInputDigestV1,
  stableSerializeOutdoorAdventureStagingProofV1,
  validateOutdoorAdventureStagingProofManifestV1
} from "../evaluation/outdoorAdventureStagingProof/manifest.js";
import {
  OutdoorAdventureStagingProofHarnessError,
  createNotRunOutdoorAdventureStagingProofSummaryV1,
  executeOutdoorAdventureStagingProofCasesV1,
  isCanonicalOutdoorAdventureStagingProofSummaryV1,
  outdoorAdventureStagingProofExitCodeV1,
  outdoorAdventureStagingProofReadinessBlockersV1,
  runOutdoorAdventureStagingProofV1,
  summarizeOutdoorAdventureStagingProofV1
} from "../evaluation/outdoorAdventureStagingProof/harness.js";
import {
  planAndRouteOutdoorAdventureV1
} from "../src/outdoorAdventure/outdoorAdventureOrchestrator.js";
import {
  buildResearchGuidedRouteCandidatePlanV1
} from "../src/routeResearch/researchGuidedRouteCandidatePlanner.js";
import {
  finalizeOutdoorAdventureStagingProofRunV1
} from "../scripts/run-outdoor-adventure-staging-proof.js";
import {
  adventureResearchDossier,
  completeAdventureResearchIntent,
  highlightCandidate
} from "./outdoorResearchTestSupport.js";

const MANIFEST_PATH = resolve(
  "evaluation/outdoorAdventureStagingProof/fixtures/mandatoryCasesV1.json"
);
const HARZ_REGION_ID = "30000000-0000-4000-8000-000000000002";

describe("outdoor adventure staging proof harness v1", () => {
  it("dispatches case16 to controlled and every other mandatory case to live", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const calls = [];
    const dispatcher =
      createOutdoorAdventureStagingProofLaneDispatcherV1({
        async evaluateLiveCase(evaluationCase, options) {
          calls.push(["live", evaluationCase.id, options]);
          return "live-result";
        },
        async evaluateControlledCase(evaluationCase, options) {
          calls.push(["controlled", evaluationCase.id, options]);
          return "controlled-result";
        }
      });
    for (const evaluationCase of manifest.cases) {
      const options = {
        signal: new AbortController().signal
      };
      const controlled =
        evaluationCase.id ===
          "case-16-malformed-backend-response-rejected-by-ios";
      assert.equal(
        await dispatcher(evaluationCase, options),
        controlled ? "controlled-result" : "live-result"
      );
      assert.deepEqual(calls.at(-1), [
        controlled ? "controlled" : "live",
        evaluationCase.id,
        options
      ]);
    }
    assert.equal(calls.length, 18);
    assert.equal(
      calls.filter(([lane]) => lane === "controlled").length,
      1
    );
  });

  it("fails closed without both lanes or an exact mandatory case binding", async () => {
    assert.throws(
      () => createOutdoorAdventureStagingProofLaneDispatcherV1({
        evaluateLiveCase() {},
        evaluateControlledCase: null
      }),
      TypeError
    );
    const dispatcher =
      createOutdoorAdventureStagingProofLaneDispatcherV1({
        evaluateLiveCase() {},
        evaluateControlledCase() {}
      });
    await assert.rejects(
      dispatcher({ id: "case-19-not-mandatory" }),
      TypeError
    );
  });

  it("loads the exact ordered 18-case mandatory manifest", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    assert.equal(manifest.cases.length, 18);
    assert.deepEqual(
      manifest.cases.map((evaluationCase) => evaluationCase.id),
      OUTDOOR_ADVENTURE_STAGING_PROOF_CASE_IDS_V1
    );
    assert.equal(
      new Set(manifest.cases.map((evaluationCase) =>
        outdoorAdventureStagingProofInputDigestV1(evaluationCase.input)
      )).size,
      18
    );
    assert.equal(
      manifest.cases.every((evaluationCase) =>
        evaluationCase.input.fixtureId ===
          `${evaluationCase.id}-input-v1` &&
        evaluationCase.expected.semanticExpectationIds.length > 0
      ),
      true
    );
    const timeout = manifest.cases[13];
    assert.equal(timeout.expected.terminalState, "legacy_fallback");
    assert.equal(timeout.expected.routingSource, "legacy_fallback");
    assert.equal(timeout.expected.providerTraffic, "live_attempted");
    assert.equal(timeout.expected.legacyFallbackCount, 1);
    const retry = manifest.cases[17];
    assert.equal(retry.expected.terminalState, "retry_succeeded");
    assert.equal(retry.expected.routingSource, "real_graphhopper");
    assert.equal(retry.expected.retryFreshness, "fresh");
    assert.equal(retry.expected.legacyFallbackCount, 1);
  });

  it("rejects zero, missing, extra, duplicate, reordered, and malformed IDs", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    for (const mutate of [
      (value) => { value.cases = []; },
      (value) => { value.cases.pop(); },
      (value) => { value.cases.push(structuredClone(value.cases[0])); },
      (value) => { value.cases[1] = structuredClone(value.cases[0]); },
      (value) => { [value.cases[0], value.cases[1]] =
        [value.cases[1], value.cases[0]]; },
      (value) => { value.cases[0].id = "malformed"; },
      (value) => { value.cases[0].input.activity = "biking"; },
      (value) => {
        value.cases[0].expected.semanticExpectationIds =
          ["canonical_intent_bound"];
      }
    ]) {
      const candidate = structuredClone(manifest);
      mutate(candidate);
      assert.throws(
        () => validateOutdoorAdventureStagingProofManifestV1(candidate),
        hasCode("manifest_malformed")
      );
    }
  });

  it("defaults to not_run, writes a deterministic redacted summary, and exits nonzero", async () => {
    const writes = [];
    const run = () => runOutdoorAdventureStagingProofV1({
      manifestPath: MANIFEST_PATH,
      outputPath: "unused",
      writeSummary: async (_path, contents) => writes.push(contents)
    });
    const first = await run();
    const second = await run();
    assert.equal(first.status, "not_run");
    assert.equal(first.metrics.configuredCases, 18);
    assert.equal(first.metrics.executedCases, 0);
    assert.equal(first.metrics.notRunCases, 18);
    assert.equal(outdoorAdventureStagingProofExitCodeV1(first), 1);
    assert.equal(
      isCanonicalOutdoorAdventureStagingProofSummaryV1(
        JSON.parse(writes[0])
      ),
      true
    );
    assert.equal(writes[0], writes[1]);
    for (const forbidden of [
      "originalPrompt",
      "latitude",
      "longitude",
      "authorizationToken",
      "databaseUrl",
      "providerResponse",
      "providerError",
      "geometry",
      "anchorFixture",
      "executionModifiers",
      "inputDigest",
      "inputFixtureId",
      "requiredNamedEntities",
      "semanticExpectationIds",
      "targetDistanceKm",
      "https://"
    ]) {
      assert.equal(writes[0].includes(forbidden), false, forbidden);
    }
  });

  it("requires every live, containment, disposable DB, and operational acknowledgement", () => {
    assert.deepEqual(
      outdoorAdventureStagingProofReadinessBlockersV1(),
      ["live_execution_not_requested"]
    );
    assert.deepEqual(
      outdoorAdventureStagingProofReadinessBlockersV1({
        executeLive: true
      }),
      [
        "bounded_live_graphhopper_not_authorized",
        "credential_containment_not_confirmed",
        "disposable_database_not_confirmed",
        "database_configuration_missing",
        "graphhopper_configuration_missing",
        "operational_case_driver_missing",
        "causal_pipeline_capture_missing",
        "app_attest_receipt_integration_missing",
        "ios_runtime_receipt_integration_missing"
      ]
    );
    assert.deepEqual(
      outdoorAdventureStagingProofReadinessBlockersV1({
        executeLive: true,
        boundedLiveGraphHopperAuthorized: true,
        credentialContainmentConfirmed: true,
        disposableDatabaseConfirmed: true,
        databaseConfigured: true,
        graphHopperConfigured: true,
        operationalCaseDriverConfigured: true
      }),
      [
        "causal_pipeline_capture_missing",
        "app_attest_receipt_integration_missing",
        "ios_runtime_receipt_integration_missing"
      ]
    );
    assert.deepEqual(
      outdoorAdventureStagingProofReadinessBlockersV1({
        executeLive: true,
        boundedLiveGraphHopperAuthorized: true,
        credentialContainmentConfirmed: true,
        disposableDatabaseConfirmed: true,
        databaseConfigured: true,
        graphHopperConfigured: true,
        operationalCaseDriverConfigured: true,
        causalPipelineCaptureConfigured: true,
        appAttestReceiptIntegrationConfigured: true,
        iosRuntimeReceiptIntegrationConfigured: true
      }),
      []
    );
  });

  it("does not let a development session or synthetic provider produce live proof", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const evaluationCase = manifest.cases[0];
    const evaluateCase =
      createControlledOutdoorAdventureStagingProofEvaluatorV1({
        provider: syntheticProvider(),
        runCase: (value, context) =>
          routedObservation(value, context)
      });
    const result = await evaluateCase(evaluationCase);
    assert.equal(result.passed, false);
    assert.equal(result.authorization, "development_session");
    assert.equal(result.routingSource, "synthetic");
    assert.equal(result.providerTraffic, "synthetic_attempted");
    assert(result.errorCodes.includes("authorization_mismatch"));
    assert(result.errorCodes.includes("routing_source_mismatch"));
    assert.equal(
      result.errorCodes.includes("evidence_linkage_invalid"),
      false
    );
    assert.equal(
      result.errorCodes.includes("provenance_linkage_invalid"),
      false
    );
  });

  it("fails a wrong input fixture, semantic receipt, or missing limitation cause without retaining them", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const firstCase = manifest.cases[0];
    const wrongInputEvaluator =
      createControlledOutdoorAdventureStagingProofEvaluatorV1({
        provider: syntheticProvider(),
        async runCase(value, context) {
          const observation = await routedObservation(value, context);
          return {
            ...observation,
            inputDigest:
              outdoorAdventureStagingProofInputDigestV1(
                manifest.cases[1].input
              )
          };
        }
      });
    const wrongInput = await wrongInputEvaluator(firstCase);
    assert(wrongInput.errorCodes.includes("input_fixture_mismatch"));

    const wrongSemanticEvaluator =
      createControlledOutdoorAdventureStagingProofEvaluatorV1({
        provider: syntheticProvider(),
        async runCase(value, context) {
          const observation = await routedObservation(value, context);
          return {
            ...observation,
            semanticExpectationIds: [
              "canonical_intent_bound"
            ]
          };
        }
      });
    const wrongSemantic = await wrongSemanticEvaluator(firstCase);
    assert(
      wrongSemantic.errorCodes.includes(
        "semantic_expectation_mismatch"
      )
    );

    const limitationCase = manifest.cases[8];
    const missingLimitationEvaluator =
      createControlledOutdoorAdventureStagingProofEvaluatorV1({
        runCase(value) {
          return {
            ...emptyObservation(value, "clarification"),
            limitationCauseIds: []
          };
        }
      });
    const missingLimitation =
      await missingLimitationEvaluator(limitationCase);
    assert(
      missingLimitation.errorCodes.includes(
        "limitation_cause_mismatch"
      )
    );
    const serialized = JSON.stringify([
      wrongInput,
      wrongSemantic,
      missingLimitation
    ]);
    for (const forbidden of [
      "anchorFixture",
      "inputDigest",
      "inputFixtureId",
      "limitationCauseIds",
      "requiredNamedEntities",
      "semanticExpectationIds"
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });

  it("classifies timeout fallback and a later fresh retry without treating sequential sources as mixed", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const timeoutCase = manifest.cases[13];
    const timeoutEvaluator =
      createControlledOutdoorAdventureStagingProofEvaluatorV1({
        repository: {
          async withConsistentSnapshot(_context, work) {
            return work({});
          }
        },
        provider: {
          async route() {
            throw new Error("controlled timeout");
          }
        },
        async runCase(value, context) {
          context.recordDevelopmentAuthorization(1);
          await context.repository.withConsistentSnapshot(
            {},
            async () => {}
          );
          await assert.rejects(() => context.provider.route({}));
          context.recordLegacyFallback();
          return emptyObservation(value, "legacy_fallback");
        }
      });
    const timeout = await timeoutEvaluator(timeoutCase);
    assert.equal(timeout.routingSource, "legacy_fallback");
    assert.equal(timeout.legacyFallbackCount, 1);
    assert.equal(
      timeout.errorCodes.includes("mixed_routing_sources"),
      false
    );

    const retryCase = manifest.cases[17];
    const retryEvaluator =
      createControlledOutdoorAdventureStagingProofEvaluatorV1({
        provider: syntheticProvider(),
        async runCase(value, context) {
          context.recordLegacyFallback();
          context.recordRetryFreshness({ staleStateReused: false });
          return routedObservation(value, context);
        }
      });
    const retry = await retryEvaluator(retryCase);
    assert.equal(retry.routingSource, "synthetic");
    assert.equal(retry.legacyFallbackCount, 1);
    assert.equal(retry.retryFreshness, "fresh");
    assert.equal(
      retry.errorCodes.includes("mixed_routing_sources"),
      false
    );
  });

  it("refuses to classify a custom provider endpoint as live GraphHopper", () => {
    const pool = proofPoolForEvaluator();
    const control = proofControlPoolForEvaluator();
    assert.throws(() =>
      createLiveOutdoorAdventureStagingProofEvaluatorV1({
        pool,
        postgresCancellationControlPool: control.pool,
        env: {
          GRAPHHOPPER_API_KEY: "synthetic-test-only",
          GRAPHHOPPER_BASE_URL: "https://synthetic.invalid/api/1"
        },
        runCase() {}
      })
    );
  });

  it("arms and cleans the case13 Postgres gate only inside the live evaluator", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const evaluationCase = manifest.cases[12];
    const pool = proofPoolForEvaluator();
    const control = proofControlPoolForEvaluator();
    const evaluateCase =
      createLiveOutdoorAdventureStagingProofEvaluatorV1({
        pool,
        postgresCancellationControlPool: control.pool,
        env: {
          GRAPHHOPPER_API_KEY: "synthetic-test-only"
        },
        async runCase(value, context) {
          const gate = await context.armPostgresCancellationGate({
            nonceDigest: "a".repeat(64)
          });
          assert.equal(typeof gate.wait, "function");
          return emptyObservation(
            value,
            value.expected.terminalState
          );
        }
      });

    const result = await evaluateCase(evaluationCase);
    assert.equal(result.executed, true);
    assert.equal(result.passed, false);
    assert(result.errorCodes.includes("ios_runtime_receipt_missing"));
    assert.deepEqual(control.queries, [
      "BEGIN",
      "SELECT set_config('lock_timeout', $1, true)",
      "LOCK TABLE public.outdoor_evidence_regions IN ACCESS EXCLUSIVE MODE",
      "ROLLBACK"
    ]);
    assert.equal(control.releaseCount(), 1);
    assert.equal(pool.connectCount(), 0);
  });

  it("classifies a timed-out provider call as attempted traffic, not successful routing", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const evaluationCase = manifest.cases[13];
    const evaluateCase =
      createControlledOutdoorAdventureStagingProofEvaluatorV1({
        repository: {
          async withConsistentSnapshot(_context, work) {
            return work({});
          }
        },
        provider: {
          async route() {
            throw new Error("private provider timeout detail");
          }
        },
        async runCase(value, context) {
          context.recordDevelopmentAuthorization(1);
          await context.repository.withConsistentSnapshot({}, async () => {});
          await assert.rejects(() => context.provider.route({}));
          return emptyObservation(value, "timed_out");
        }
      });
    const result = await evaluateCase(evaluationCase);
    assert.equal(result.routingSource, "none");
    assert.equal(result.providerTraffic, "synthetic_attempted");
    assert.equal(result.passed, false);
    assert.equal(
      JSON.stringify(result).includes("private provider timeout detail"),
      false
    );
  });

  it("fails a routed result whose selected via lacks a snapped visit", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const evaluationCase = manifest.cases[0];
    const evaluateCase =
      createControlledOutdoorAdventureStagingProofEvaluatorV1({
        provider: syntheticProvider({ includeSnappedWaypoints: false }),
        runCase: (value, context) =>
          routedObservation(value, context)
      });
    const result = await evaluateCase(evaluationCase);
    assert.equal(result.passed, false);
    assert(result.errorCodes.includes("waypoint_visit_invalid"));
  });

  it("fails malformed response provenance and never retains the response", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const evaluationCase = manifest.cases[0];
    const evaluateCase =
      createControlledOutdoorAdventureStagingProofEvaluatorV1({
        provider: syntheticProvider(),
        async runCase(value, context) {
          const observation = await routedObservation(value, context);
          const response = structuredClone(observation.response);
          response.routedAlternatives.attempts[0].provenance.lineageId =
            "rrlpv1_00000000000000000000000000000000";
          return { ...observation, response };
        }
      });
    const result = await evaluateCase(evaluationCase);
    assert.equal(result.passed, false);
    assert(result.errorCodes.includes("malformed_response"));
    assert.equal(Object.hasOwn(result, "response"), false);
  });

  it("fails missing freshness, attribution, and projected-record lineage", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const evaluationCase = manifest.cases[0];
    const evaluateCase =
      createControlledOutdoorAdventureStagingProofEvaluatorV1({
        provider: syntheticProvider(),
        async runCase(value, context) {
          const observation = await routedObservation(value, context);
          const dossier = structuredClone(observation.dossier);
          dossier.sourceProvenanceSummary[0].retrievedAt = null;
          dossier.sourceProvenanceSummary[0].attributionRequired = false;
          dossier.evidenceClaims[0].provenance.recordVersion = null;
          return { ...observation, dossier };
        }
      });
    const result = await evaluateCase(evaluationCase);
    assert.equal(result.passed, false);
    assert(result.errorCodes.includes("evidence_source_lineage_invalid"));
  });

  it("classifies Node-only malformed rejection as synthetic and still requires iOS", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const evaluationCase = manifest.cases[15];
    const evaluateCase =
      createControlledOutdoorAdventureStagingProofEvaluatorV1({
        runCase(value, context) {
          context.recordSyntheticRoutingUsed();
          return {
            ...emptyObservation(value, "rejected"),
            response: {
              privateProviderResponse: "must never reach summary"
            }
          };
        }
      });
    const result = await evaluateCase(evaluationCase);
    assert.equal(result.passed, false);
    assert.equal(result.routingSource, "synthetic");
    assert.equal(result.providerTraffic, "synthetic_attempted");
    assert(result.errorCodes.includes("ios_runtime_receipt_missing"));
    assert.equal(
      JSON.stringify(result).includes("must never reach summary"),
      false
    );
  });

  it("fails skips and per-case harness timeouts", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const skipEvaluator =
      createControlledOutdoorAdventureStagingProofEvaluatorV1({
        runCase(value) {
          return {
            ...emptyObservation(value, value.expected.terminalState),
            skipped: true
          };
        }
      });
    const skipped = await executeOutdoorAdventureStagingProofCasesV1({
      manifest,
      evaluateCase: skipEvaluator,
      caseTimeoutMilliseconds: 100
    });
    assert.equal(skipped.some((result) => result.skipped), true);
    assert.equal(
      summarizeOutdoorAdventureStagingProofV1(manifest, skipped).status,
      "failed"
    );

    let timeoutInvocations = 0;
    const timeoutEvaluator =
      createControlledOutdoorAdventureStagingProofEvaluatorV1({
        runCase: () => {
          timeoutInvocations += 1;
          return new Promise(() => {});
        }
      });
    const timed = await executeOutdoorAdventureStagingProofCasesV1({
      manifest,
      evaluateCase: timeoutEvaluator,
      caseTimeoutMilliseconds: 2
    });
    assert.equal(timeoutInvocations, 1);
    assert.deepEqual(timed[0].errorCodes, ["timeout"]);
    assert.equal(
      timed.slice(1).every((result) =>
        result.executed === false &&
        result.errorCodes.includes("aborted_after_timeout")
      ),
      true
    );
    assert.equal(
      summarizeOutdoorAdventureStagingProofV1(manifest, timed).status,
      "failed"
    );
  });

  it("rejects late provider calls after timeout without launching them", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    let releaseFirstProviderCall;
    const firstProviderCall = new Promise((resolvePromise) => {
      releaseFirstProviderCall = resolvePromise;
    });
    let resolveLateAttempt;
    const lateAttempt = new Promise((resolvePromise) => {
      resolveLateAttempt = resolvePromise;
    });
    let providerInvocations = 0;
    let evaluatorInvocations = 0;
    let lateCallError = null;
    const timeoutEvaluator =
      createControlledOutdoorAdventureStagingProofEvaluatorV1({
        provider: {
          route() {
            providerInvocations += 1;
            return firstProviderCall;
          }
        },
        async runCase(value, context) {
          evaluatorInvocations += 1;
          await context.provider.route({ attempt: 1 });
          try {
            await context.provider.route({ attempt: 2 });
          } catch (error) {
            lateCallError = error;
          } finally {
            resolveLateAttempt();
          }
          return emptyObservation(value, value.expected.terminalState);
        }
      });

    const timed = await executeOutdoorAdventureStagingProofCasesV1({
      manifest,
      evaluateCase: timeoutEvaluator,
      caseTimeoutMilliseconds: 2
    });
    assert.equal(evaluatorInvocations, 1);
    assert.equal(providerInvocations, 1);
    assert.deepEqual(timed[0].errorCodes, ["timeout"]);
    assert.equal(
      timed.slice(1).every((result) =>
        result.executed === false &&
        result.errorCodes.includes("aborted_after_timeout")
      ),
      true
    );

    releaseFirstProviderCall();
    await lateAttempt;
    assert(lateCallError instanceof TypeError);
    assert.equal(providerInvocations, 1);
    assert.equal(evaluatorInvocations, 1);
  });

  it("rejects missing, extra, duplicate, and reordered result IDs", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const baseline =
      createNotRunOutdoorAdventureStagingProofSummaryV1(
        manifest,
        ["live_execution_not_requested"]
      ).caseResults;
    for (const results of [
      baseline.slice(0, -1),
      [...baseline, baseline[0]],
      [baseline[0], baseline[0], ...baseline.slice(2)],
      [baseline[1], baseline[0], ...baseline.slice(2)]
    ]) {
      assert.throws(
        () => summarizeOutdoorAdventureStagingProofV1(
          manifest,
          results,
          ["live_execution_not_requested"]
        ),
        (error) =>
          error instanceof OutdoorAdventureStagingProofHarnessError
      );
    }
  });

  it("fails closed when the deterministic summary cannot be written", async () => {
    await assert.rejects(
      () => runOutdoorAdventureStagingProofV1({
        manifestPath: MANIFEST_PATH,
        outputPath: "unused",
        writeSummary: async () => {
          throw new Error("private filesystem detail");
        }
      }),
      hasCode("summary_write_failed")
    );
  });

  it("never publishes or retains passed status when runner cleanup fails", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "trailmind-proof-cleanup-failure-")
    );
    const outputPath = join(temporaryDirectory, "summary.json");
    const stdout = [];
    const cleanupCalls = [];
    const summary = await canonicalNotRunRunnerSummary();
    writeFileSync(outputPath, '{"status":"passed"}\n', "utf8");
    try {
      const outcome =
        await finalizeOutdoorAdventureStagingProofRunV1({
          summary,
          summaryContents: runnerSummaryContents(summary),
          outputPath,
          cleanupOperations: [
            async () => {
              cleanupCalls.push("driver");
              throw new Error("private cleanup detail");
            },
            async () => {
              cleanupCalls.push("control_pool");
            },
            async () => {
              cleanupCalls.push("product_pool");
            }
          ],
          writeStdout(contents) {
            stdout.push(contents);
          }
        });

      assert.deepEqual(cleanupCalls, [
        "driver",
        "control_pool",
        "product_pool"
      ]);
      assert.deepEqual(outcome, {
        exitCode: 1,
        published: false,
        infrastructureFailure: true,
        requiresForcedExit: false
      });
      assert.deepEqual(stdout, []);
      assert.equal(existsSync(outputPath), false);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("still publishes a blocked not-run summary after successful cleanup", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "trailmind-proof-not-run-finalization-")
    );
    const outputPath = join(temporaryDirectory, "summary.json");
    const summary = await canonicalNotRunRunnerSummary();
    const summaryContents = runnerSummaryContents(summary);
    const stdout = [];
    try {
      const outcome =
        await finalizeOutdoorAdventureStagingProofRunV1({
          summary,
          summaryContents,
          outputPath,
          cleanupOperations: [],
          writeStdout(contents) {
            stdout.push(contents);
          }
        });

      assert.deepEqual(outcome, {
        exitCode: 1,
        published: true,
        infrastructureFailure: false,
        requiresForcedExit: false
      });
      assert.equal(readFileSync(outputPath, "utf8"), summaryContents);
      assert.deepEqual(stdout, [
        '{"status":"not_run","configuredCases":18,"executedCases":0,"passedCases":0,"failedCases":0,"skippedCases":0}\n'
      ]);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("rejects forged or mismatched final summaries before publication", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "trailmind-proof-summary-binding-")
    );
    const outputPath = join(temporaryDirectory, "summary.json");
    const stdout = [];
    try {
      const forged = runnerSummary("passed");
      const forgedOutcome =
        await finalizeOutdoorAdventureStagingProofRunV1({
          summary: forged,
          summaryContents: runnerSummaryContents(forged),
          outputPath,
          cleanupOperations: [],
          writeStdout(contents) {
            stdout.push(contents);
          }
        });
      assert.deepEqual(forgedOutcome, {
        exitCode: 1,
        published: false,
        infrastructureFailure: true,
        requiresForcedExit: false
      });
      assert.equal(existsSync(outputPath), false);

      const malformedNotRun = runnerSummary("not_run");
      assert.equal(
        isCanonicalOutdoorAdventureStagingProofSummaryV1(
          malformedNotRun
        ),
        false
      );
      const malformedOutcome =
        await finalizeOutdoorAdventureStagingProofRunV1({
          summary: malformedNotRun,
          summaryContents: runnerSummaryContents(malformedNotRun),
          outputPath,
          cleanupOperations: []
        });
      assert.deepEqual(malformedOutcome, {
        exitCode: 1,
        published: false,
        infrastructureFailure: true,
        requiresForcedExit: false
      });

      const notRun = await canonicalNotRunRunnerSummary();
      const mismatchedOutcome =
        await finalizeOutdoorAdventureStagingProofRunV1({
          summary: notRun,
          summaryContents: '{"status":"passed"}\n',
          outputPath,
          cleanupOperations: [],
          writeStdout(contents) {
            stdout.push(contents);
          }
        });
      assert.deepEqual(mismatchedOutcome, {
        exitCode: 1,
        published: false,
        infrastructureFailure: true,
        requiresForcedExit: false
      });
      assert.deepEqual(stdout, []);
      assert.equal(existsSync(outputPath), false);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("binds canonical passed summaries to every digest-pinned case expectation", async () => {
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const summary = canonicalPassedRunnerSummary(manifest);
    assert.equal(summary.status, "passed");
    assert.equal(
      isCanonicalOutdoorAdventureStagingProofSummaryV1(summary),
      true
    );
    assert.equal(outdoorAdventureStagingProofExitCodeV1(summary), 0);

    const mutations = [
      (candidate) => {
        candidate.caseResults[1].authorization = "none";
        candidate.metrics.appAttestSessionCases -= 1;
      },
      (candidate) => {
        candidate.caseResults[2].terminalState = "unsupported";
      },
      (candidate) => {
        candidate.caseResults[15].routingSource = "synthetic";
        candidate.caseResults[15].providerTraffic =
          "synthetic_attempted";
        candidate.metrics.syntheticCases += 1;
      }
    ];
    for (const mutate of mutations) {
      const candidate = structuredClone(summary);
      mutate(candidate);
      assert.equal(
        isCanonicalOutdoorAdventureStagingProofSummaryV1(candidate),
        false
      );
      assert.equal(outdoorAdventureStagingProofExitCodeV1(candidate), 1);
    }

    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "trailmind-proof-manifest-binding-")
    );
    const outputPath = join(temporaryDirectory, "summary.json");
    try {
      const published =
        await finalizeOutdoorAdventureStagingProofRunV1({
          summary,
          summaryContents: runnerSummaryContents(summary),
          outputPath,
          cleanupOperations: [],
          writeStdout() {}
        });
      assert.deepEqual(published, {
        exitCode: 0,
        published: true,
        infrastructureFailure: false,
        requiresForcedExit: false
      });
      assert.equal(existsSync(outputPath), true);

      const tampered = structuredClone(summary);
      tampered.caseResults[1].authorization = "none";
      tampered.metrics.appAttestSessionCases -= 1;
      const rejected =
        await finalizeOutdoorAdventureStagingProofRunV1({
          summary: tampered,
          summaryContents: runnerSummaryContents(tampered),
          outputPath,
          cleanupOperations: [],
          writeStdout() {}
        });
      assert.deepEqual(rejected, {
        exitCode: 1,
        published: false,
        infrastructureFailure: true,
        requiresForcedExit: false
      });
      assert.equal(existsSync(outputPath), false);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("bounds a stalled cleanup without publishing a summary", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "trailmind-proof-cleanup-timeout-")
    );
    const outputPath = join(temporaryDirectory, "summary.json");
    const summary = await canonicalNotRunRunnerSummary();
    let activeHandle;
    try {
      const outcome =
        await finalizeOutdoorAdventureStagingProofRunV1({
          summary,
          summaryContents: runnerSummaryContents(summary),
          outputPath,
          cleanupOperations: [() => new Promise(() => {
            activeHandle = setInterval(() => {}, 1_000);
          })],
          cleanupTimeoutMilliseconds: 10
        });
      assert.deepEqual(outcome, {
        exitCode: 1,
        published: false,
        infrastructureFailure: true,
        requiresForcedExit: true
      });
      assert.equal(existsSync(outputPath), false);

      let invalidTimeoutCleanupCalls = 0;
      const invalidTimeoutOutcome =
        await finalizeOutdoorAdventureStagingProofRunV1({
          summary,
          summaryContents: runnerSummaryContents(summary),
          outputPath,
          cleanupOperations: [async () => {
            invalidTimeoutCleanupCalls += 1;
          }],
          cleanupTimeoutMilliseconds: 0
        });
      assert.equal(invalidTimeoutCleanupCalls, 1);
      assert.equal(invalidTimeoutOutcome.published, false);
      assert.equal(invalidTimeoutOutcome.infrastructureFailure, true);
    } finally {
      clearInterval(activeHandle);
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("returns nonzero for forged or incomplete passed-status objects", async () => {
    assert.equal(outdoorAdventureStagingProofExitCodeV1({
      status: "passed"
    }), 1);
    const manifest =
      await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
    const forged = structuredClone(
      createNotRunOutdoorAdventureStagingProofSummaryV1(
        manifest,
        ["live_execution_not_requested"]
      )
    );
    forged.status = "passed";
    forged.blockers = [];
    forged.metrics.executedCases = 18;
    forged.metrics.passedCases = 18;
    forged.metrics.notRunCases = 0;
    assert.equal(outdoorAdventureStagingProofExitCodeV1(forged), 1);
  });

  it("keeps operational_case_driver_missing for a nonexistent driver path", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "trailmind-proof-driver-path-")
    );
    const outputPath = join(temporaryDirectory, "summary.json");
    try {
      const result = spawnSync(
        process.execPath,
        [
          "scripts/run-outdoor-adventure-staging-proof.js",
          "--execute-live",
          "--ack-bounded-live-graphhopper",
          "--ack-credential-containment",
          "--confirm-disposable-database",
          "--driver-module",
          "evaluation/outdoorAdventureStagingProof/not-present.js",
          "--output",
          outputPath
        ],
        {
          cwd: resolve("."),
          encoding: "utf8",
          env: {
            ...process.env,
            TRAILMIND_STAGING_PROOF_DATABASE_URL:
              "postgresql://proof.invalid/staging",
            GRAPHHOPPER_API_KEY: "test-only-placeholder"
          }
        }
      );
      assert.equal(result.status, 1);
      const summary = JSON.parse(readFileSync(outputPath, "utf8"));
      assert(
        summary.blockers.includes("operational_case_driver_missing")
      );
      assert.equal(summary.metrics.executedCases, 0);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("never imports a foreign or symlinked live driver module", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "trailmind-proof-driver-import-")
    );
    const sentinelPath = join(temporaryDirectory, "imported.txt");
    const lookalikePath =
      "test/fixtures/outdoorAdventureStagingProofLookalikeDriver.js";
    const linkDirectory = mkdtempSync(
      join(resolve("."), ".trailmind-proof-driver-link-")
    );
    const linkPath = join(linkDirectory, "driver.js");
    symlinkSync(resolve(lookalikePath), linkPath);
    try {
      for (const driverModule of [
        lookalikePath,
        linkPath
      ]) {
        const outputPath = join(
          temporaryDirectory,
          `summary-${driverModule === lookalikePath
            ? "foreign"
            : "symlink"}.json`
        );
        const result = spawnSync(
          process.execPath,
          [
            "scripts/run-outdoor-adventure-staging-proof.js",
            "--execute-live",
            "--ack-bounded-live-graphhopper",
            "--ack-credential-containment",
            "--confirm-disposable-database",
            "--driver-module",
            driverModule,
            "--output",
            outputPath
          ],
          {
            cwd: resolve("."),
            encoding: "utf8",
            env: {
              ...process.env,
              TRAILMIND_STAGING_PROOF_DATABASE_URL:
                "postgresql://proof.invalid/staging",
              GRAPHHOPPER_API_KEY: "test-only-placeholder",
              TRAILMIND_PROOF_DRIVER_IMPORT_SENTINEL:
                sentinelPath
            }
          }
        );
        assert.equal(result.status, 1);
        assert.equal(existsSync(sentinelPath), false);
        const summary = JSON.parse(readFileSync(outputPath, "utf8"));
        assert(
          summary.blockers.includes(
            "operational_case_driver_missing"
          )
        );
        assert.equal(summary.metrics.executedCases, 0);
      }
    } finally {
      rmSync(linkDirectory, { recursive: true, force: true });
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});

function runnerSummary(status) {
  return {
    status,
    metrics: {
      configuredCases: 18,
      executedCases: status === "passed" ? 18 : 0,
      passedCases: status === "passed" ? 18 : 0,
      failedCases: 0,
      skippedCases: 0
    }
  };
}

function runnerSummaryContents(summary) {
  return `${stableSerializeOutdoorAdventureStagingProofV1(summary)}\n`;
}

async function canonicalNotRunRunnerSummary() {
  const manifest =
    await loadOutdoorAdventureStagingProofManifestV1(MANIFEST_PATH);
  return createNotRunOutdoorAdventureStagingProofSummaryV1(
    manifest,
    ["live_execution_not_requested"]
  );
}

function canonicalPassedRunnerSummary(manifest) {
  return summarizeOutdoorAdventureStagingProofV1(
    manifest,
    manifest.cases.map((evaluationCase) => ({
      id: evaluationCase.id,
      executed: true,
      passed: true,
      skipped: false,
      terminalState: evaluationCase.expected.terminalState,
      responseState: responseStateFor(
        evaluationCase.expected.responseExpectation
      ),
      evidenceSource: evaluationCase.expected.evidenceSource,
      routingSource: evaluationCase.expected.routingSource,
      providerTraffic: evaluationCase.expected.providerTraffic,
      authorization: evaluationCase.expected.authorization,
      routeQuality: evaluationCase.expected.routeQuality,
      retryFreshness: evaluationCase.expected.retryFreshness,
      legacyFallbackCount:
        evaluationCase.expected.legacyFallbackCount,
      stageTimings: Object.fromEntries(
        evaluationCase.expected.requiredStages.map((stage) => [
          stage,
          ["under_100ms"]
        ])
      ),
      errorCodes: []
    }))
  );
}

function responseStateFor(expectation) {
  if (expectation === "routed_alternatives") return "routed";
  if (expectation === "malformed_rejected") return "malformed";
  if (expectation === "not_applicable") return "none";
  return expectation;
}

async function routedObservation(evaluationCase, context) {
  context.recordDevelopmentAuthorization(1);
  context.recordSyntheticEvidenceUsed();
  await context.measureStage("research_planning", async () => {});
  await context.measureStage("dossier_assembly", async () => {});
  await context.measureStage("candidate_planning", async () => {});
  const intent = completeAdventureResearchIntent({
    geographicAnchor: {
      state: "resolved",
      name: "Harz",
      coordinate: { latitude: 51.8, longitude: 10.6 },
      regionEntityId: HARZ_REGION_ID
    },
    durationRangeMinutes: null,
    maximumElevationGainMeters: null,
    maximumTechnicalDifficulty: null,
    mustHaveExperiences: [{
      experience: "viewpoint",
      minimumCount: 1
    }],
    preferredExperiences: [],
    avoidedExperiences: [],
    requiredFacilities: [],
    dateOrSeason: null
  });
  const dossier = adventureResearchDossier({
    normalizedIntent: intent,
    regionCoverage: {
      state: "partial",
      regionEntityIds: [HARZ_REGION_ID],
      limitationCodes: ["partial_regional_coverage"]
    },
    candidateHighlights: [highlightCandidate({
      coordinate: { latitude: 51.81, longitude: 10.62 }
    })]
  });
  let candidatePlan = null;
  const response = await planAndRouteOutdoorAdventureV1(
    { schemaVersion: 1, intent },
    {
      repository: context.repository,
      provider: context.provider,
      researchAdventure: async () => ({
        state: "ready",
        normalizedIntent: intent,
        planningGaps: [],
        dossier
      }),
      buildCandidatePlan(value, options) {
        candidatePlan =
          buildResearchGuidedRouteCandidatePlanV1(value, options);
        return candidatePlan;
      }
    }
  );
  context.recordRouteQualityEvaluation(1);
  return {
    id: evaluationCase.id,
    ...observationBinding(evaluationCase),
    terminalState: evaluationCase.expected.terminalState,
    skipped: false,
    response,
    dossier,
    candidatePlan
  };
}

function syntheticProvider({ includeSnappedWaypoints = true } = {}) {
  return {
    async route(request) {
      const start = request.points[0];
      const via = request.points[1];
      const path = {
        distance: 12_000,
        time: 10_800_000,
        ascend: 400,
        descend: 400,
        points: {
          type: "LineString",
          coordinates: [
            [start.longitude, start.latitude, 500],
            [via.longitude, via.latitude, 650],
            [start.longitude + 0.01, start.latitude - 0.01, 575],
            [start.longitude, start.latitude, 500]
          ]
        },
        instructions: [{
          text: "Continue",
          distance: 12_000,
          time: 10_800_000,
          interval: [0, 3],
          sign: 0
        }],
        details: {
          surface: [[0, 3, "ground"]],
          road_class: [[0, 3, "path"]],
          hike_rating: [[0, 3, "1"]]
        }
      };
      if (includeSnappedWaypoints) {
        path.snapped_waypoints = {
          type: "LineString",
          coordinates: request.points.map((point) => [
            point.longitude,
            point.latitude
          ])
        };
      }
      return { provider: "graphhopper", paths: [path] };
    }
  };
}

function emptyObservation(evaluationCase, terminalState) {
  return {
    id: evaluationCase.id,
    ...observationBinding(evaluationCase),
    terminalState,
    skipped: false,
    response: null,
    dossier: null,
    candidatePlan: null
  };
}

function observationBinding(evaluationCase) {
  return {
    inputFixtureId: evaluationCase.input.fixtureId,
    inputDigest:
      outdoorAdventureStagingProofInputDigestV1(evaluationCase.input),
    semanticExpectationIds: [
      ...evaluationCase.expected.semanticExpectationIds
    ],
    limitationCauseIds: [
      ...evaluationCase.expected.requiredLimitationCauseIds
    ]
  };
}

function hasCode(code) {
  return (error) => {
    assert.equal(error?.code, code);
    return true;
  };
}

function proofPoolForEvaluator() {
  let connections = 0;
  return {
    options: {
      max: 2,
      application_name: "trailmind_staging_proof_v1"
    },
    async connect() {
      connections += 1;
      throw new Error("unexpected product connection");
    },
    async query() {
      throw new Error("unexpected product query");
    },
    connectCount() {
      return connections;
    }
  };
}

function proofControlPoolForEvaluator() {
  const queries = [];
  let releases = 0;
  const pool = {
    options: { max: 1 },
    async connect() {
      return {
        async query(text) {
          queries.push(text);
          return { rows: [] };
        },
        release() {
          releases += 1;
        }
      };
    }
  };
  return {
    pool,
    queries,
    releaseCount: () => releases,
    connect: pool.connect.bind(pool)
  };
}
