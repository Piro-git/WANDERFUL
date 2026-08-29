import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import {
  createSyntheticStagingPhase1V2ObserverFactory,
  createSyntheticStagingPhase1V2ObserverSession,
  machineCleanupEvidence,
  machineControlSnapshot,
  machinePostAdvisorEvidence,
  observeStagingPhase1V2MachinePhase,
  requireReviewedStagingPhase1V2ProductionObserverFactory,
  STAGING_PHASE1_V2_OBSERVER_CONTRACT_DIGEST,
  STAGING_PHASE1_V2_SYNTHETIC_OBSERVER_PACKAGE,
  StagingPhase1V2MachineObserverError
} from "../src/operations/stagingPhase1V2MachineObserver.js";

const NOW = new Date("2026-08-29T10:00:00.000Z");
const ATTEMPT = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const OTHER_RUN = "33333333-3333-4333-8333-333333333333";
const COMMIT = "10dd59adf4b12dec8288e261438331db78fff9b2";
const TREE = "ae82c3e2e4693ae911587e3fbba2516469c9e4d2";
const PROJECT = "mbvzwsrtqcrwhvykugcd";
const ORGANIZATION = "wbnftkftyamxzvxsftda";
const REGION = "eu-central-1";
const APPLICATION = "trailmind_phase1_v2_operator";
const PID = 41_241;

describe("staging Phase 1 V2 machine observer", () => {
  it("traverses the pinned synthetic machine fixture once in causal phase order", async () => {
    const phases = [];
    const factory = createSyntheticStagingPhase1V2ObserverFactory({
      now: () => new Date(NOW),
      onObservation: (phase) => phases.push(phase)
    });
    assert.deepEqual(factory.packageBinding,
      STAGING_PHASE1_V2_SYNTHETIC_OBSERVER_PACKAGE);
    assert.match(STAGING_PHASE1_V2_OBSERVER_CONTRACT_DIGEST, /^[a-f0-9]{64}$/);
    const session = createSyntheticStagingPhase1V2ObserverSession(
      factory, binding()
    );

    const pre = await observeStagingPhase1V2MachinePhase(
      session, request("pre-control")
    );
    const post = await observeStagingPhase1V2MachinePhase(
      session, request("post-ddl-advisors")
    );
    const final = await observeStagingPhase1V2MachinePhase(
      session, request("final-control")
    );
    const cleanupArtifact = await observeStagingPhase1V2MachinePhase(
      session, request("post-disconnect-cleanup")
    );

    assert.deepEqual(phases, [
      "pre-control", "post-ddl-advisors", "final-control",
      "post-disconnect-cleanup"
    ]);
    assert.equal(pre.sequence, 1);
    assert.equal(post.previousObservationDigest, pre.artifactDigest);
    assert.equal(final.previousObservationDigest, post.artifactDigest);
    assert.equal(cleanupArtifact.previousObservationDigest,
      final.artifactDigest);
    assert.equal(new Set([pre.artifactDigest, post.artifactDigest,
      final.artifactDigest, cleanupArtifact.artifactDigest]).size, 4);
    assert.equal(machineControlSnapshot(pre).observerArtifactDigest,
      pre.artifactDigest);
    assert.throws(() => machineControlSnapshot(pre),
      observerFailure("artifact_replay"));
    const advisors = machinePostAdvisorEvidence(post);
    assert.equal(advisors.evidenceDigest, post.artifactDigest);
    assert.equal(advisors.observerArtifactDigest, post.artifactDigest);
    assert.equal(machineControlSnapshot(final).observerArtifactDigest,
      final.artifactDigest);
    const cleanup = machineCleanupEvidence(cleanupArtifact, cleanupRequest());
    assert.equal(cleanup.backendSessionCount, 0);
    assert.equal(cleanup.idleSessionCount, 0);
    assert.equal(cleanup.observerArtifactDigest,
      cleanupArtifact.artifactDigest);
    assert.match(cleanup.evidenceDigest, /^[a-f0-9]{64}$/);
    await assert.rejects(
      observeStagingPhase1V2MachinePhase(session, request("pre-control")),
      observerFailure("phase_order")
    );
  });

  it("rejects missing, arbitrary, metadata-copied and synthetic production packages", () => {
    assert.throws(
      () => requireReviewedStagingPhase1V2ProductionObserverFactory(),
      observerFailure("observer_required")
    );
    for (const candidate of [
      {},
      { packageBinding: STAGING_PHASE1_V2_SYNTHETIC_OBSERVER_PACKAGE },
      createSyntheticStagingPhase1V2ObserverFactory()
    ]) {
      assert.throws(
        () => requireReviewedStagingPhase1V2ProductionObserverFactory(candidate),
        observerFailure("observer_untrusted")
      );
    }
    assert.throws(
      () => createSyntheticStagingPhase1V2ObserverSession({
        packageBinding: STAGING_PHASE1_V2_SYNTHETIC_OBSERVER_PACKAGE,
        createSession() {}
      }, binding()),
      observerFailure("synthetic_factory")
    );
  });

  it("rejects manual control, advisor and cleanup assertions as untrusted artifacts", () => {
    const typedControl = {
      phase: "pre-control",
      evidence: { securityBlockingFindingCount: 0 },
      artifactDigest: "0".repeat(64)
    };
    assert.throws(() => machineControlSnapshot(typedControl),
      observerFailure("artifact_untrusted"));
    assert.throws(() => machinePostAdvisorEvidence({
      phase: "post-ddl-advisors",
      evidence: {
        security: { blockingFindingCount: 0 },
        performance: { blockingFindingCount: 0 }
      },
      artifactDigest: "0".repeat(64)
    }), observerFailure("artifact_untrusted"));
    assert.throws(() => machineCleanupEvidence({
      phase: "post-disconnect-cleanup",
      evidence: "SESSION_CLOSED:41241:0:0",
      artifactDigest: "0".repeat(64)
    }, cleanupRequest()), observerFailure("artifact_untrusted"));
  });

  it("fails closed on stale, cross-boundary, malformed, oversized and contradictory artifacts", async () => {
    const cases = [
      ["stale", (artifact, { resealArtifact }) => {
        artifact.observedAt = "2026-08-29T09:54:59.999Z";
        return resealArtifact(artifact);
      }, "artifact_freshness"],
      ["future", (artifact, { resealArtifact }) => {
        artifact.observedAt = "2026-08-29T10:00:00.001Z";
        return resealArtifact(artifact);
      }, "artifact_freshness"],
      ["cross-run", (artifact, { resealArtifact }) => {
        artifact.binding.runId = OTHER_RUN;
        return resealArtifact(artifact);
      }, "artifact_binding"],
      ["cross-project", (artifact, { resealArtifact }) => {
        artifact.binding.projectRef = "cmkvbxppgofteoutfslp";
        return resealArtifact(artifact);
      }, "artifact_binding"],
      ["cross-organization", (artifact, { resealArtifact }) => {
        artifact.binding.organizationId = "untrusted-organization";
        return resealArtifact(artifact);
      }, "artifact_binding"],
      ["cross-region", (artifact, { resealArtifact }) => {
        artifact.binding.region = "us-east-1";
        return resealArtifact(artifact);
      }, "artifact_binding"],
      ["wrong-commit", (artifact, { resealArtifact }) => {
        artifact.binding.candidateCommit = "f".repeat(40);
        return resealArtifact(artifact);
      }, "artifact_binding"],
      ["wrong-tree", (artifact, { resealArtifact }) => {
        artifact.binding.candidateTree = "e".repeat(40);
        return resealArtifact(artifact);
      }, "artifact_binding"],
      ["wrong-phase", (artifact, { resealArtifact }) => {
        artifact.phase = "final-control";
        return resealArtifact(artifact);
      }, "artifact_binding"],
      ["wrong-nonce", (artifact, { resealArtifact }) => {
        artifact.requestNonce = "55555555-5555-4555-8555-555555555555";
        return resealArtifact(artifact);
      }, "artifact_binding"],
      ["trust-anchor-substitution", (artifact, { resealArtifact }) => {
        artifact.observer.packageDigest = "0".repeat(64);
        return resealArtifact(artifact);
      }, "artifact_binding"],
      ["malformed", (artifact) => {
        artifact.unreviewed = true;
        return artifact;
      }, "artifact_fields"],
      ["oversized", (artifact, { resealArtifact }) => {
        artifact.evidence.unreviewed = "x".repeat(40_000);
        return resealArtifact(artifact);
      }, "artifact_size"],
      ["contradictory", (artifact, { resealArtifact }) => {
        artifact.evidence.securityBlockingFindingCount = 1;
        return resealArtifact(artifact);
      }, "control_evidence"],
      ["sensitive", (artifact, { resealArtifact }) => {
        artifact.evidence.password = "synthetic";
        return resealArtifact(artifact);
      }, "artifact_sensitive"]
    ];
    for (const [name, mutateArtifact, code] of cases) {
      const session = createSyntheticStagingPhase1V2ObserverSession(
        createSyntheticStagingPhase1V2ObserverFactory({
          now: () => new Date(NOW), mutateArtifact
        }),
        binding()
      );
      await assert.rejects(
        observeStagingPhase1V2MachinePhase(session, request("pre-control")),
        observerFailure(code),
        name
      );
    }
  });

  it("rejects reorder, duplicate identities, wrong PID and cleanup contradictions", async () => {
    const reordered = session();
    await assert.rejects(observeStagingPhase1V2MachinePhase(
      reordered, request("post-ddl-advisors")
    ), observerFailure("phase_order"));

    const duplicateId = "44444444-4444-4444-8444-444444444444";
    const duplicate = session({ randomId: () => duplicateId });
    await assert.rejects(observeStagingPhase1V2MachinePhase(
      duplicate, request("pre-control")
    ), observerFailure("artifact_binding"));

    const wrongPid = session({
      mutateArtifact(artifact, { expectedPhase, resealArtifact }) {
        if (expectedPhase === "post-ddl-advisors") {
          artifact.session.backendPid += 1;
          return resealArtifact(artifact);
        }
        return artifact;
      }
    });
    await observeStagingPhase1V2MachinePhase(wrongPid, request("pre-control"));
    await assert.rejects(observeStagingPhase1V2MachinePhase(
      wrongPid, request("post-ddl-advisors")
    ), observerFailure("artifact_binding"));

    const contradictoryCleanup = session({
      mutateArtifact(artifact, { expectedPhase, resealArtifact }) {
        if (expectedPhase === "post-disconnect-cleanup") {
          artifact.evidence.activeSessionCount = 1;
          return resealArtifact(artifact);
        }
        return artifact;
      }
    });
    await observeThroughFinal(contradictoryCleanup);
    await assert.rejects(observeStagingPhase1V2MachinePhase(
      contradictoryCleanup, request("post-disconnect-cleanup")
    ), observerFailure("cleanup_evidence"));

    const contradictoryFinal = session({
      mutateArtifact(artifact, { expectedPhase, resealArtifact }) {
        if (expectedPhase === "final-control") {
          artifact.evidence.providerAclRestorePlanDigest = "0".repeat(64);
          return resealArtifact(artifact);
        }
        return artifact;
      }
    });
    await observeStagingPhase1V2MachinePhase(
      contradictoryFinal, request("pre-control")
    );
    await observeStagingPhase1V2MachinePhase(
      contradictoryFinal, request("post-ddl-advisors")
    );
    await assert.rejects(observeStagingPhase1V2MachinePhase(
      contradictoryFinal, request("final-control")
    ), observerFailure("control_contradiction"));
  });
});

function binding() {
  return {
    attemptId: ATTEMPT,
    candidateCommit: COMMIT,
    candidateTree: TREE,
    organizationId: ORGANIZATION,
    projectRef: PROJECT,
    region: REGION,
    runId: RUN
  };
}

function request(phase) {
  const cleanup = phase === "post-disconnect-cleanup";
  const pre = phase === "pre-control";
  return {
    applicationName: pre ? null : APPLICATION,
    authorizationBindingDigest: cleanup ? "7".repeat(64) : null,
    backendPid: pre ? null : PID,
    phase,
    stagedReceiptDigest: cleanup ? "9".repeat(64) : null
  };
}

function cleanupRequest() {
  return {
    applicationName: APPLICATION,
    authorizationBindingDigest: "7".repeat(64),
    backendPid: PID,
    candidateCommit: COMMIT,
    candidateTree: TREE,
    operatorDigestsDigest: "8".repeat(64),
    projectRef: PROJECT,
    runId: RUN,
    stagedReceiptDigest: "9".repeat(64)
  };
}

function session(options = {}) {
  return createSyntheticStagingPhase1V2ObserverSession(
    createSyntheticStagingPhase1V2ObserverFactory({
      now: () => new Date(NOW),
      randomId: randomUUID,
      ...options
    }),
    binding()
  );
}

async function observeThroughFinal(observerSession) {
  await observeStagingPhase1V2MachinePhase(
    observerSession, request("pre-control")
  );
  await observeStagingPhase1V2MachinePhase(
    observerSession, request("post-ddl-advisors")
  );
  await observeStagingPhase1V2MachinePhase(
    observerSession, request("final-control")
  );
}

function observerFailure(code) {
  return (error) => error instanceof StagingPhase1V2MachineObserverError &&
    error.code === code && !/password|SESSION_CLOSED/i.test(error.message);
}
