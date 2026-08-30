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
  STAGING_PHASE1_V2_AUDITOR_SQL_MANIFEST,
  STAGING_PHASE1_V2_CONTROL_REQUEST_MANIFEST,
  STAGING_PHASE1_V2_OBSERVER_CONTRACT_DIGEST,
  STAGING_PHASE1_V2_SYNTHETIC_OBSERVER_PACKAGE,
  StagingPhase1V2MachineObserverError,
  validateStagingPhase1V2AuditorIdentityFixture,
  validateStagingPhase1V2CleanupResultFixture,
  validateStagingPhase1V2ControlCredentialTypeFixture,
  parseStagingPhase1V2ControlJsonFixture,
  validateStagingPhase1V2ControlResponseFixture,
  validateStagingPhase1V2ControlResponseMetadataFixture,
  validateStagingPhase1V2TargetSessionFixture
} from "../src/operations/stagingPhase1V2MachineObserver.js";
import {
  deriveStagingPhase1V2DatabaseRunBinding
} from "../src/operations/stagingPhase1V2ProductionObserverContract.js";

const NOW = new Date("2026-08-29T10:00:00.000Z");
const ATTEMPT = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const OTHER_RUN = "33333333-3333-4333-8333-333333333333";
const COMMIT = "10dd59adf4b12dec8288e261438331db78fff9b2";
const TREE = "ae82c3e2e4693ae911587e3fbba2516469c9e4d2";
const PROJECT = "mbvzwsrtqcrwhvykugcd";
const ORGANIZATION = "wbnftkftyamxzvxsftda";
const REGION = "eu-central-1";
const PID = 41_241;
const BACKEND_START = "2026-08-29T09:59:00.000Z";
const AUTHORIZATION_BINDING_DIGEST = "7".repeat(64);
const DATABASE_RUN_BINDING = deriveStagingPhase1V2DatabaseRunBinding({
  authorizationBindingDigest: AUTHORIZATION_BINDING_DIGEST,
  candidateCommit: COMMIT,
  projectRef: PROJECT,
  runId: RUN
});
const APPLICATION = DATABASE_RUN_BINDING.applicationName;

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
    assert.throws(() =>
      requireReviewedStagingPhase1V2ProductionObserverFactory({
        createSession() {}, packageBinding: { copied: true }
      }), observerFailure("observer_untrusted"));
    assert.throws(
      () => createSyntheticStagingPhase1V2ObserverSession({
        packageBinding: STAGING_PHASE1_V2_SYNTHETIC_OBSERVER_PACKAGE,
        createSession() {}
      }, binding()),
      observerFailure("synthetic_factory")
    );
  });

  it("keeps production unregistered and pins the fixed read-only manifests", () => {
    assert.deepEqual(STAGING_PHASE1_V2_CONTROL_REQUEST_MANIFEST.transport, {
      host: "api.supabase.com",
      method: "GET",
      port: 443,
      protocol: "https:",
      redirects: false,
      retries: 0,
      tlsMinimumVersion: "TLSv1.2",
      verifyHostname: true
    });
    assert.equal(STAGING_PHASE1_V2_CONTROL_REQUEST_MANIFEST.maximumCalls, 14);
    assert.deepEqual(
      STAGING_PHASE1_V2_CONTROL_REQUEST_MANIFEST.requiredOAuthScopes,
      ["database:read", "organizations:read", "projects:read"]
    );
    assert.deepEqual(
      STAGING_PHASE1_V2_CONTROL_REQUEST_MANIFEST
        .requiredFineGrainedPermissions,
      [
        "advisors_read", "infra_add_ons_read", "organization_admin_read",
        "organization_projects_read", "project_admin_read"
      ]
    );
    assert.equal(Object.values(
      STAGING_PHASE1_V2_CONTROL_REQUEST_MANIFEST.phases
    ).flat().length, 14);
    for (const requestBinding of Object.values(
      STAGING_PHASE1_V2_CONTROL_REQUEST_MANIFEST.requests
    )) {
      assert.equal(requestBinding.method, "GET");
      assert.match(requestBinding.path, /^\/v1\//);
      assert.ok(requestBinding.maximumBytes <= 32 * 1_024);
      assert.doesNotMatch(requestBinding.path,
        /cmkvbxppgofteoutfslp|bejvhhjbgtvctpsnlwid/);
    }
    assert.deepEqual(Object.keys(STAGING_PHASE1_V2_AUDITOR_SQL_MANIFEST)
      .sort(), [
      "begin", "cleanup", "foundation", "identity", "membership",
      "providerAcl", "rollback", "sharedAcl", "timeouts", "tls"
    ]);
    assert.equal(Object.values(STAGING_PHASE1_V2_AUDITOR_SQL_MANIFEST)
      .every((digest) => /^[a-f0-9]{64}$/.test(digest)), true);
  });

  it("strictly validates current project, organization, inventory and advisor schemas", () => {
    assert.deepEqual(validateStagingPhase1V2ControlResponseFixture(
      "project", projectFixture()
    ), {
      name: "TrailMind Outdoor Staging V1",
      postgresMajor: 17,
      status: "ACTIVE_HEALTHY"
    });
    assert.deepEqual(validateStagingPhase1V2ControlResponseFixture(
      "organization", organizationFixture()
    ), { name: "Alibra AI", plan: "free" });
    const inventory = validateStagingPhase1V2ControlResponseFixture(
      "inventory", inventoryFixture()
    );
    assert.equal(inventory.computeSize, "nano");
    assert.deepEqual(inventory.protectedProjects.map(({ ref }) => ref), [
      "bejvhhjbgtvctpsnlwid", "cmkvbxppgofteoutfslp"
    ]);
    const advisor = validateStagingPhase1V2ControlResponseFixture(
      "security", advisorFixture("SECURITY")
    );
    assert.deepEqual({ ...advisor, lintSetDigest: "digest" }, {
      blockingFindingCount: 0,
      evidenceDigest: "0".repeat(64),
      levelCounts: { ERROR: 0, INFO: 1, WARN: 0 },
      lintSetDigest: "digest",
      noticeCount: 1,
      status: "notice-only"
    });
    assert.match(advisor.lintSetDigest, /^[a-f0-9]{64}$/);
    assert.equal(validateStagingPhase1V2ControlResponseMetadataFixture({
      contentEncoding: undefined,
      contentLength: "128",
      contentType: "application/json; charset=utf-8",
      location: undefined,
      maximumBytes: 16 * 1_024,
      serverDate: new Date().toUTCString(),
      statusCode: 200
    }).statusCode, 200);
  });

  it("rejects target substitution, inventory ambiguity, malformed advisors and stale transport evidence", () => {
    for (const projectRef of [
      "cmkvbxppgofteoutfslp", "bejvhhjbgtvctpsnlwid",
      "aaaaaaaaaaaaaaaaaaaa"
    ]) {
      const project = projectFixture();
      project.id = projectRef;
      project.ref = projectRef;
      assert.throws(() => validateStagingPhase1V2ControlResponseFixture(
        "project", project
      ), observerFailure("control_project"));
    }
    for (const mutate of [
      (value) => { value.organization_slug = "another-organization"; },
      (value) => { value.name = "TrailMind Production"; },
      (value) => { value.region = "us-east-1"; },
      (value) => { value.status = "INACTIVE"; },
      (value) => { value.database.version = "16.9.0.001"; },
      (value) => { value.database.host = "db.example.invalid"; }
    ]) {
      const project = projectFixture();
      mutate(project);
      assert.throws(() => validateStagingPhase1V2ControlResponseFixture(
        "project", project
      ), observerFailure("control_project"));
    }
    for (const mutate of [
      (value) => { value.name = "Another organization"; },
      (value) => { value.plan = "pro"; }
    ]) {
      const organization = organizationFixture();
      mutate(organization);
      assert.throws(() => validateStagingPhase1V2ControlResponseFixture(
        "organization", organization
      ), observerFailure("control_organization"));
    }
    for (const missingRef of [
      PROJECT, "cmkvbxppgofteoutfslp", "bejvhhjbgtvctpsnlwid"
    ]) {
      const inventory = inventoryFixture();
      inventory.projects = inventory.projects.filter(
        ({ ref }) => ref !== missingRef
      );
      inventory.pagination.count = inventory.projects.length;
      assert.throws(() => validateStagingPhase1V2ControlResponseFixture(
        "inventory", inventory
      ), (error) => error instanceof StagingPhase1V2MachineObserverError);
    }
    for (const mutate of [
      (value) => { value.projects[0].databases[0].infra_compute_size = "small"; },
      (value) => { value.projects[0].databases[0].status = "INACTIVE"; },
      (value) => { value.projects[0].is_branch = true; },
      (value) => { value.projects[0].region = "us-east-1"; }
    ]) {
      const inventory = inventoryFixture();
      mutate(inventory);
      assert.throws(() => validateStagingPhase1V2ControlResponseFixture(
        "inventory", inventory
      ), (error) => error instanceof StagingPhase1V2MachineObserverError);
    }
    const advisor = advisorFixture("SECURITY");
    advisor.lints[0].categories = ["PERFORMANCE"];
    assert.throws(() => validateStagingPhase1V2ControlResponseFixture(
      "security", advisor
    ), observerFailure("advisor_response"));
    assert.throws(() => validateStagingPhase1V2ControlResponseMetadataFixture({
      contentEncoding: undefined,
      contentLength: undefined,
      contentType: "application/json",
      location: undefined,
      maximumBytes: 16 * 1_024,
      serverDate: new Date(Date.now() - 301_000).toUTCString(),
      statusCode: 200
    }), observerFailure("control_transport"));
    for (const invalid of [
      { contentType: "text/html", location: undefined, statusCode: 200 },
      { contentType: "application/json", location: "/redirect",
        statusCode: 302 },
      { contentType: "application/json", location: undefined,
        statusCode: 429 },
      { contentEncoding: "gzip", contentType: "application/json",
        location: undefined, statusCode: 200 },
      { contentLength: "40000", contentType: "application/json",
        location: undefined, statusCode: 200 }
    ]) {
      assert.throws(() => validateStagingPhase1V2ControlResponseMetadataFixture({
        contentEncoding: undefined,
        contentLength: undefined,
        maximumBytes: 32 * 1_024,
        ...invalid,
        serverDate: new Date().toUTCString()
      }), observerFailure("control_transport"));
    }
  });

  it("rejects opaque or unscoped credential descriptors without exposing values", () => {
    const accepted = controlCredentialDescriptor();
    assert.deepEqual(validateStagingPhase1V2ControlCredentialTypeFixture(
      accepted
    ), {
      accepted: true,
      billingAddonReadAuthoritative: false,
      credentialType: "oauth_access_token",
      projectIsolationVerified: false
    });
    for (const [secretMarker, candidate] of [
      ["do-not-log-this-token", "do-not-log-this-token"],
      ["browser-cookie-marker", {
        ...structuredClone(accepted),
        descriptor: { ...accepted.descriptor, source: "browser_cookie" }
      }],
      ["mcp-credential-marker", {
        ...structuredClone(accepted),
        descriptor: { ...accepted.descriptor, source: "mcp" }
      }],
      ["missing-scope-marker", {
        ...structuredClone(accepted),
        descriptor: { ...accepted.descriptor, scopes: ["projects:read"] }
      }]
    ]) {
      let failure;
      try {
        validateStagingPhase1V2ControlCredentialTypeFixture(candidate);
      } catch (error) {
        failure = error;
      }
      assert.ok(failure instanceof StagingPhase1V2MachineObserverError);
      assert.equal(failure.message.includes(secretMarker), false);
    }
  });

  it("requires the distinct least-privilege observer auditor contract", () => {
    const fixture = auditorIdentityFixture();
    assert.deepEqual(validateStagingPhase1V2AuditorIdentityFixture(fixture), {
      accepted: true,
      role: "trailmind_phase1_v2_stats_auditor"
    });
    for (const mutate of [
      (value) => { value.role = "postgres"; },
      (value) => { value.roleAttributes.createdb = true; },
      (value) => { value.roleAttributes.bypassrls = true; },
      (value) => { value.memberships[0].inherit = true; },
      (value) => { value.memberships[0].admin = true; },
      (value) => { value.defaults.defaultTransactionReadOnly = "off"; },
      (value) => { value.forbiddenAccess.productData = true; },
      (value) => { value.forbiddenAccess.genericSql = true; }
    ]) {
      const invalid = structuredClone(fixture);
      mutate(invalid);
      assert.throws(() => validateStagingPhase1V2AuditorIdentityFixture(
        invalid
      ), observerFailure("auditor_privilege"));
    }
  });

  it("requires exact backend_start binding and two fresh cleanup samples", () => {
    const expected = sessionBindingFixture();
    assert.deepEqual(validateStagingPhase1V2TargetSessionFixture({
      expected,
      observed: targetSessionFixture(expected)
    }), { accepted: true });
    const samples = cleanupSamplesFixture(expected);
    assert.equal(validateStagingPhase1V2CleanupResultFixture({
      expected, samples
    }).accepted, true);
    for (const invalid of [
      [samples[0]],
      [{ ...samples[0], exactBackendInstanceCount: 1 }, samples[1]],
      [samples[0], { ...samples[1], matchingApplicationCount: 1 }],
      [samples[0], { ...samples[1], backendStart:
        "2026-08-29T09:59:59.000Z" }],
      [samples[0], { ...samples[1], samePidOtherInstanceCount: 1 }],
      [samples[0], { ...samples[1], observedAt:
        "2026-08-29T10:00:00.100Z" }]
    ]) {
      assert.throws(() => validateStagingPhase1V2CleanupResultFixture({
        expected, samples: invalid
      }), (error) => error instanceof StagingPhase1V2MachineObserverError);
    }
  });

  it("rejects duplicate JSON keys and bounded parser false-greens", () => {
    assert.throws(() => parseStagingPhase1V2ControlJsonFixture(
      Buffer.from('{"lints":[],"lints":[{"level":"INFO"}]}')
    ), (error) => error?.code === "control_duplicate_json_key");
    assert.throws(() => parseStagingPhase1V2ControlJsonFixture(
      Buffer.from('{"x":[[[[[1]]]]]}'), { maximumDepth: 3 }
    ), (error) => error?.code === "control_response_bounds");
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
      ["source-digest-substitution", (artifact, { resealArtifact }) => {
        artifact.observer.sourceDigest = "0".repeat(64);
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
    authorizationBindingDigest: pre ? null : AUTHORIZATION_BINDING_DIGEST,
    backendPid: pre ? null : PID,
    backendStart: pre ? null : BACKEND_START,
    databaseRunBindingDigest: pre
      ? null
      : DATABASE_RUN_BINDING.databaseRunBindingDigest,
    phase,
    stagedReceiptDigest: cleanup ? "9".repeat(64) : null
  };
}

function cleanupRequest() {
  return {
    applicationName: APPLICATION,
    authorizationBindingDigest: AUTHORIZATION_BINDING_DIGEST,
    backendPid: PID,
    backendStart: BACKEND_START,
    candidateCommit: COMMIT,
    candidateTree: TREE,
    databaseRunBindingDigest: DATABASE_RUN_BINDING.databaseRunBindingDigest,
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

function projectFixture() {
  return {
    created_at: NOW.toISOString(),
    database: {
      host: "db.mbvzwsrtqcrwhvykugcd.supabase.co",
      postgres_engine: "17",
      release_channel: "ga",
      version: "17.4.1.001"
    },
    id: PROJECT,
    name: "TrailMind Outdoor Staging V1",
    organization_id: ORGANIZATION,
    organization_slug: ORGANIZATION,
    ref: PROJECT,
    region: REGION,
    status: "ACTIVE_HEALTHY"
  };
}

function organizationFixture() {
  return {
    allowed_release_channels: ["ga"],
    id: ORGANIZATION,
    name: "Alibra AI",
    opt_in_tags: [],
    plan: "free"
  };
}

function inventoryFixture() {
  const database = (identifier, region = REGION, size = "nano") => ({
    cloud_provider: "AWS",
    disk_last_modified_at: null,
    disk_throughput_mbps: null,
    disk_type: null,
    disk_volume_size_gb: null,
    identifier,
    infra_compute_size: size,
    region,
    status: "ACTIVE_HEALTHY",
    type: "PRIMARY"
  });
  const project = (ref, name, region = REGION, size = "nano") => ({
    cloud_provider: "AWS",
    databases: [database(ref, region, size)],
    inserted_at: NOW.toISOString(),
    is_branch: false,
    name,
    ref,
    region,
    status: "ACTIVE_HEALTHY"
  });
  const projects = [
    project(PROJECT, "TrailMind Outdoor Staging V1"),
    project("bejvhhjbgtvctpsnlwid", "TrailMind Production"),
    project("cmkvbxppgofteoutfslp", "Planua")
  ];
  return {
    pagination: { count: projects.length, limit: 100, offset: 0 },
    projects
  };
}

function advisorFixture(category) {
  return {
    lints: [{
      cache_key: `${category.toLowerCase()}-fixture`,
      categories: [category],
      description: "bounded fixture",
      detail: "bounded fixture",
      facing: "EXTERNAL",
      level: "INFO",
      name: "fixture_lint",
      remediation: "review",
      title: "Fixture"
    }]
  };
}

function auditorIdentityFixture() {
  return {
    databaseName: "postgres",
    defaults: {
      defaultTransactionReadOnly: "on",
      idleInTransactionSessionTimeout: "5s",
      lockTimeout: "1s",
      searchPath: "pg_catalog",
      statementTimeout: "5s"
    },
    forbiddenAccess: {
      databaseCreate: false,
      databaseTemporary: false,
      genericSql: false,
      ownedObjects: false,
      pgMonitor: false,
      pgReadAllData: false,
      pgReadAllSettings: false,
      pgWriteAllData: false,
      productData: false,
      productRoutineExecute: false,
      schemaCreate: false
    },
    memberships: [{
      admin: false,
      inherit: false,
      role: "pg_read_all_stats",
      set: true
    }],
    role: "trailmind_phase1_v2_stats_auditor",
    roleAttributes: {
      bypassrls: false,
      canLogin: true,
      connectionLimit: 1,
      credentialUnexpired: true,
      createdb: false,
      createrole: false,
      inherit: false,
      replication: false,
      superuser: false
    },
    sessionUserName: "trailmind_phase1_v2_stats_auditor",
    tls: { active: true, version: "TLSv1.3" }
  };
}

function sessionBindingFixture() {
  return {
    applicationName: APPLICATION,
    backendPid: PID,
    backendStart: BACKEND_START
  };
}

function targetSessionFixture(expected) {
  return {
    ...expected,
    backendType: "client backend",
    databaseName: "postgres",
    databaseUser: "postgres",
    exactBackendInstanceCount: 1,
    idleExactInstanceCount: 0,
    matchingApplicationCount: 1,
    samePidOtherInstanceCount: 0,
    tls: true
  };
}

function cleanupSamplesFixture(expected) {
  const build = (index, observedAt, statsSnapshotId) => ({
    ...expected,
    auditorApplicationName: `trailmind_p1v2_auditor_${String(index).repeat(32)}`,
    auditorBackendPid: 61_240 + index,
    auditorBackendStart: observedAt,
    auditorSelfExcluded: true,
    clearSnapshot: true,
    exactBackendInstanceCount: 0,
    idleExactInstanceCount: 0,
    matchingApplicationCount: 0,
    observedAt,
    observedSessions: [],
    samePidOtherInstanceCount: 0,
    statsSnapshotId
  });
  return [
    build(
      1,
      "2026-08-29T10:00:00.000Z",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    ),
    build(
      2,
      "2026-08-29T10:00:00.250Z",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    )
  ];
}

function controlCredentialDescriptor() {
  return {
    descriptor: {
      audience: "api.supabase.com",
      credentialType: "oauth_access_token",
      expiresAt: "2026-08-29T10:30:00.000Z",
      issuedAt: "2026-08-29T10:00:00.000Z",
      permissions: [],
      projectIsolation: "unproved",
      scopes: ["database:read", "organizations:read", "projects:read"],
      source: "protected_unlinked_descriptor"
    },
    lifecycle: {
      closedAfterRead: true,
      initialOffset: 0,
      readCount: 1,
      retainedCredentialCopies: 0,
      singleOpenDescription: true,
      unlinkedBeforeRead: true
    }
  };
}

function observerFailure(code) {
  return (error) => error instanceof StagingPhase1V2MachineObserverError &&
    error.code === code && !/password|SESSION_CLOSED/i.test(error.message);
}
