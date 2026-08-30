import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync, mkdtempSync, readFileSync, rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  evaluateStagingPhase1V2AdmissionLevel,
  STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY
} from "../src/operations/stagingPhase1V2ProductionObserverContract.js";
import {
  acquireCandidateCaPin,
  buildReadinessContract,
  canonicalSha256,
  catalogAssertionProgramSha256,
  compileExpectedManifest,
  createReviewReceipt,
  MIGRATION_PROFILE_SCHEMA_VERSION,
  PIN_PATHS,
  provisionCandidateSigningKey,
  signCanonicalReceipt,
  stagingInitializationEvidenceBundleDigest,
  SUPABASE_PHASE1_PROFILE_ID,
  TARGET_PROJECT_NAME
} from "../src/operations/stagingPrerequisitesV3/index.js";

const NOW = new Date("2026-08-30T12:02:00.000Z");
const COMMIT = "c".repeat(40);
const TREE = "d".repeat(40);
const RUN = "11111111-1111-4111-8111-111111111111";
let fixture;

before(() => { fixture = createFixture(); });
after(() => {
  if (fixture?.directory?.startsWith(`${tmpdir()}/trailmind-admission-v3-`)) {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

describe("integrated staging prerequisites and observer admission", () => {
  it("keeps default staging and production blocked with five null pins", () => {
    assert.deepEqual(Object.values(
      STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.pins
    ), [null, null, null, null, null]);
    for (const level of ["staging_initialization", "production_admission"]) {
      const decision = evaluateStagingPhase1V2AdmissionLevel(level);
      assert.equal(decision.status, "blocked");
      assert.equal(decision.factoryRegistrationAllowed, false);
      assert.equal(decision.initializationAllowed, false);
    }
    const readiness = buildReadinessContract({ repositoryRoot: ".." });
    assert.equal(readiness.contract.status, "not_ready");
    assert.equal(readiness.contract.issueCodes.length, 5);
  });

  it("admits exactly one complete synthetic empty internal disabled initialization", () => {
    const replayStore = new Set();
    const decision = evaluate(fixture.evidence, "staging_initialization", replayStore);
    assert.equal(decision.status, "admitted");
    assert.equal(decision.initializationAllowed, true);
    assert.equal(decision.factoryRegistrationAllowed, false);
    assert.equal(decision.productFlagsRequiredState, "disabled");
    assert.equal(decision.claimBoundaries.freePlan, "verified");
    assert.equal(replayStore.size, 1);
    const replay = evaluate(fixture.evidence, "staging_initialization", replayStore);
    assert.equal(replay.status, "blocked");
    assert.equal(replay.blockers[0].code, "evidence_replay");
  });

  it("never promotes the same complete staging evidence to production", () => {
    const decision = evaluate(fixture.evidence, "production_admission", new Set());
    assert.equal(decision.status, "blocked");
    for (const code of [
      "exact_billing_unavailable",
      "control_plane_project_isolation_unproved",
      "advisor_causal_freshness_unproved",
      "production_factory_unregistered"
    ]) assert.equal(decision.blockers.some((blocker) => blocker.code === code), true);
    assert.equal(decision.initializationAllowed, false);
    assert.equal(decision.factoryRegistrationAllowed, false);
  });

  it("fails closed for every missing root evidence field", () => {
    for (const key of Object.keys(fixture.evidence)) {
      const changed = structuredClone(fixture.evidence);
      delete changed[key];
      assertBlocked(changed);
    }
  });

  it("rejects stale, future, malformed, unsigned, mutated and cross-bound evidence", () => {
    const cases = [
      (value) => { value.schemaVersion = 0; },
      (value) => { value.target.projectRef = "x".repeat(20); },
      (value) => { value.target.projectName = "Wrong target"; },
      (value) => { value.migrationProfileId = "generic_postgres_v1"; },
      (value) => { value.runBinding.candidateGitCommit = "e".repeat(40); },
      (value) => { value.runBinding.candidateGitTree = "e".repeat(40); },
      (value) => { value.runBinding.runId = "22222222-2222-4222-8222-222222222222"; },
      (value) => { value.flags.remoteCalls = true; },
      (value) => { value.flags.migrationExecution = true; },
      (value) => { value.initialization.databaseEmpty = false; },
      (value) => { value.initialization.previousInitializationCount = 1; },
      (value) => { value.restrictedObservations.exactUsageAmount = "0"; },
      (value) => { value.signedArtifact = {}; },
      (value) => { value.signedArtifact.signature = "A".repeat(86); },
      (value) => { value.reviewedPins.staticGate.independentExpectedManifestSha256 = "0".repeat(64); },
      (value) => { value.reviewedPins.staticGate.independentCatalogAssertionProgramSha256 = "0".repeat(64); },
      (value) => { value.reviewedPins.artifactContract.key.keyId =
        `trailmind-observer-ed25519-${"0".repeat(24)}`; },
      (value) => { value.reviewedPins.auditorContract.connection.sslrootcertSha256 = "0".repeat(64); }
    ];
    for (const mutate of cases) {
      const changed = structuredClone(fixture.evidence);
      mutate(changed);
      assertBlocked(changed);
    }
    assertBlocked(resignFixture({ observedAt: "2026-08-30T11:00:00.000Z" }));
    assertBlocked(resignFixture({ observedAt: "2026-08-30T12:03:00.001Z" }));
  });

  it("requires three distinct sessions and two fresh independent zero-leak observations", () => {
    const cases = [
      (value) => { value.sessionProof.sessionCount = 2; },
      (value) => { value.sessionProof.sessionIdentities.pop(); },
      (value) => {
        value.sessionProof.sessionIdentities[2] = structuredClone(
          value.sessionProof.sessionIdentities[1]
        );
      },
      (value) => { value.sessionProof.cleanupObservations.pop(); },
      (value) => { value.sessionProof.cleanupObservations[0].zeroLeak = false; },
      (value) => { value.sessionProof.sampleSeparationMilliseconds = 0; },
      (value) => { value.sessionProof.snapshotsFresh = false; }
    ];
    for (const mutate of cases) {
      const changed = structuredClone(fixture.evidence);
      mutate(changed);
      assertBlocked(changed);
    }
  });

  it("rejects reused reviewers, review drift and wrong public-key or CA material", () => {
    const duplicate = structuredClone(fixture.evidence);
    const first = duplicate.reviewedPins.reviewReceipts[0];
    const second = duplicate.reviewedPins.reviewReceipts[1];
    duplicate.reviewedPins.reviewReceipts[1] = createReviewReceipt({
      pinPath: second.artifact.pinPath,
      pinValue: second.artifact.pinValue,
      reviewId: second.reviewId,
      reviewerId: first.reviewer.reviewerId
    });
    assertBlocked(duplicate);
    const incomplete = structuredClone(fixture.evidence);
    incomplete.reviewedPins.reviewReceipts.pop();
    assertBlocked(incomplete);
    const artifactDrift = structuredClone(fixture.evidence);
    artifactDrift.reviewedPins.reviewReceipts[0].artifact.pinValue = "0".repeat(64);
    assertBlocked(artifactDrift);
    const digestDrift = structuredClone(fixture.evidence);
    digestDrift.reviewedPins.reviewReceipts[0].reviewSha256 = "0".repeat(64);
    assertBlocked(digestDrift);
    const wrongKey = structuredClone(fixture.evidence);
    wrongKey.publicKeyPath = fixture.caCertificatePath;
    assertBlocked(wrongKey);
    const wrongCa = structuredClone(fixture.evidence);
    wrongCa.caCertificatePath = fixture.publicKeyPath;
    assertBlocked(wrongCa);
  });
});

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "trailmind-admission-v3-"));
  chmodSync(directory, 0o700);
  const key = provisionCandidateSigningKey({ outputDirectory: directory });
  const caPrivateKeyPath = join(directory, "disposable-ca-key.pem");
  const caCertificatePath = join(directory, "disposable-ca.pem");
  execFileSync("openssl", [
    "req", "-new", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", caPrivateKeyPath, "-out", caCertificatePath, "-days", "1",
    "-subj", "/CN=TrailMind Admission Test CA",
    "-addext", "basicConstraints=critical,CA:TRUE",
    "-addext", "keyUsage=critical,keyCertSign,cRLSign"
  ], { cwd: directory, stdio: "ignore", timeout: 15_000 });
  chmodSync(caPrivateKeyPath, 0o600);
  chmodSync(caCertificatePath, 0o644);
  const ca = acquireCandidateCaPin({ caCertificatePath });
  const manifest = compileExpectedManifest({ repositoryRoot: ".." });
  const programSha256 = catalogAssertionProgramSha256();
  const reviewedPins = reviewedPinsFor({ ca, key, manifest, programSha256 });
  const publicKeyPath = join(directory, key.publicKeyFileName);
  const privateKeyPath = join(directory, key.privateKeyFileName);
  const evidence = unsignedEvidence({
    caCertificatePath, publicKeyPath, reviewedPins
  });
  const digest = stagingInitializationEvidenceBundleDigest(evidence, {
    repositoryRoot: ".."
  });
  evidence.signedArtifact = signCanonicalReceipt({
    privateKeyPath,
    receipt: receiptFor({ ca, digest, manifest, programSha256,
      sessionProof: evidence.sessionProof }),
    requiredKeyId: key.keyId,
    requiredPublicKeySpkiSha256: key.publicKeySpkiSha256
  }).envelope;
  return {
    caCertificatePath,
    directory,
    evidence,
    key,
    manifest,
    privateKeyPath,
    programSha256,
    publicKeyPath,
    reviewedPins
  };
}

function unsignedEvidence({ caCertificatePath, publicKeyPath, reviewedPins }) {
  return {
    caCertificatePath,
    flags: {
      insecureTransport: false,
      migrationExecution: false,
      productFeatures: false,
      productionAdmission: false,
      providerMutation: false,
      remoteCalls: false
    },
    initialization: {
      databaseEmpty: true,
      initializationKind: "empty_internal_disabled",
      previousInitializationCount: 0,
      requestedInitializationCount: 1
    },
    migrationProfileId: SUPABASE_PHASE1_PROFILE_ID,
    publicKeyPath,
    restrictedObservations: {
      advisorCausalFreshness: "unproved",
      computeSize: "verified_nano",
      exactInvoiceAmount: "unavailable",
      exactUsageAmount: "unavailable",
      freePlan: "verified",
      providerSiblingIsolation: "unproved",
      selectedPaidAddons: "verified_none",
      source: "restricted_management_observation"
    },
    reviewedPins,
    runBinding: {
      candidateGitCommit: COMMIT,
      candidateGitTree: TREE,
      runId: RUN
    },
    schemaVersion: 1,
    sessionProof: sessionProof(),
    signedArtifact: {},
    target: {
      projectName: TARGET_PROJECT_NAME,
      projectRef: "mbvzwsrtqcrwhvykugcd"
    }
  };
}

function sessionProof() {
  const sessionIdentities = [1, 2, 3].map((number) => ({
    applicationName: `trailmind_p1v2_auditor_${String(number).repeat(32)}`,
    backendPid: 100 + number,
    sessionIdentitySha256: String(number + 3).repeat(64),
    snapshotSha256: String(number + 6).repeat(64)
  }));
  const result = {
    authorizationEligible: true,
    cleanupObservations: sessionIdentities.slice(1).map((identity) => ({
      ...identity,
      zeroLeak: true
    })),
    primaryResultSha256: "a".repeat(64),
    proofMode: "catalog-admission",
    proofSchemaVersion: 1,
    sampleSeparationMilliseconds: 250,
    sessionCount: 3,
    sessionIdentities,
    snapshotsFresh: true,
    status: "pass"
  };
  return { ...result, resultSha256: canonicalSha256(result) };
}

function reviewedPinsFor({ ca, key, manifest, programSha256 }) {
  const pins = {
    artifactContract: { key: {
      keyId: key.keyId,
      requiredPinnedPublicKeySpkiSha256: key.publicKeySpkiSha256
    } },
    auditorContract: { connection: {
      sslrootcertSha256: ca.sslrootcertSha256
    } },
    reviewReceipts: [],
    staticGate: {
      independentCatalogAssertionProgramSha256: programSha256,
      independentExpectedManifestSha256: manifest.sha256
    }
  };
  const values = {
    "artifactContract.key.keyId": pins.artifactContract.key.keyId,
    "artifactContract.key.requiredPinnedPublicKeySpkiSha256":
      pins.artifactContract.key.requiredPinnedPublicKeySpkiSha256,
    "auditorContract.connection.sslrootcertSha256":
      pins.auditorContract.connection.sslrootcertSha256,
    "staticGate.independentCatalogAssertionProgramSha256":
      pins.staticGate.independentCatalogAssertionProgramSha256,
    "staticGate.independentExpectedManifestSha256":
      pins.staticGate.independentExpectedManifestSha256
  };
  pins.reviewReceipts = PIN_PATHS.map((pinPath, index) => createReviewReceipt({
    pinPath,
    pinValue: values[pinPath],
    reviewId: `synthetic-independent-review-${index + 1}`,
    reviewerId: `synthetic-independent-reviewer-${index + 1}`
  }));
  return pins;
}

function receiptFor({ ca, digest, manifest, observedAt =
  "2026-08-30T12:00:00.000Z", programSha256, sessionProof: proof }) {
  return {
    auditorIdentity: {
      applicationName: proof.sessionIdentities[0].applicationName,
      backendPid: proof.sessionIdentities[0].backendPid,
      roleName: "trailmind_phase1_v2_stats_auditor",
      sessionIdentitySha256: proof.sessionIdentities[0].sessionIdentitySha256
    },
    auditorSslrootcertSha256: ca.sslrootcertSha256,
    candidateGitCommit: COMMIT,
    candidateGitTree: TREE,
    catalogResultSha256: proof.primaryResultSha256,
    expectedManifestSha256: manifest.sha256,
    migrationProfileId: SUPABASE_PHASE1_PROFILE_ID,
    migrationProfileSchemaVersion: MIGRATION_PROFILE_SCHEMA_VERSION,
    observedAt,
    programSha256,
    result: { digest, status: "pass" },
    runId: RUN,
    schemaVersion: 2,
    targetProjectName: TARGET_PROJECT_NAME
  };
}

function resignFixture({ observedAt }) {
  const evidence = structuredClone(fixture.evidence);
  const digest = stagingInitializationEvidenceBundleDigest(evidence, {
    repositoryRoot: ".."
  });
  evidence.signedArtifact = signCanonicalReceipt({
    privateKeyPath: fixture.privateKeyPath,
    receipt: receiptFor({
      ca: { sslrootcertSha256:
        fixture.reviewedPins.auditorContract.connection.sslrootcertSha256 },
      digest,
      manifest: fixture.manifest,
      observedAt,
      programSha256: fixture.programSha256,
      sessionProof: evidence.sessionProof
    }),
    requiredKeyId: fixture.key.keyId,
    requiredPublicKeySpkiSha256: fixture.key.publicKeySpkiSha256
  }).envelope;
  return evidence;
}

function evaluate(evidence, level = "staging_initialization", replayStore = new Set()) {
  return evaluateStagingPhase1V2AdmissionLevel(level, evidence, {
    now: () => NOW,
    replayStore,
    repositoryRoot: ".."
  });
}

function assertBlocked(evidence) {
  const decision = evaluate(evidence);
  assert.equal(decision.status, "blocked");
  assert.equal(decision.initializationAllowed, false);
  assert.equal(decision.factoryRegistrationAllowed, false);
}
