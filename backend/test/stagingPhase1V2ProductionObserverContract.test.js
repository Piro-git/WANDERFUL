import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { fstatSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertStagingPhase1V2AdvisorFreshness,
  assertStagingPhase1V2BillingEvidence,
  assertStagingPhase1V2ProductionObserverCapabilities,
  assertStagingPhase1V2ProductionAdmission,
  assertStagingPhase1V2StagingInitializationAdmission,
  assertStagingPhase1V2StaticStatementId,
  classifyStagingPhase1V2AdvisorResponse,
  canonicalizeStagingPhase1V2Json,
  deriveStagingPhase1V2DatabaseRunBinding,
  evaluateStagingPhase1V2AdmissionLevel,
  parseStagingPhase1V2BoundedJson,
  STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY,
  StagingPhase1V2ProductionObserverContractError,
  validateStagingPhase1V2AuditorContract,
  validateStagingPhase1V2CleanupSamples,
  validateStagingPhase1V2ControlCredentialDescriptor,
  validateStagingPhase1V2RestrictedBillingObservation,
  validateStagingPhase1V2TargetSession
} from "../src/operations/stagingPhase1V2ProductionObserverContract.js";
import {
  STAGING_PHASE1_V2_PRODUCTION_SOURCE_MANIFEST
} from "../src/operations/stagingPhase1V2ProductionSourceManifest.js";
import {
  stagingPhase1V2ProductionAuditorConnectionContract,
  stagingPhase1V2ProductionAuditorStatement,
  STAGING_PHASE1_V2_PRODUCTION_AUDITOR_OBSERVATION_SETUP,
  STAGING_PHASE1_V2_PRODUCTION_AUDITOR_SESSION_SETUP,
  STAGING_PHASE1_V2_PRODUCTION_AUDITOR_SQL_MANIFEST
} from "../src/operations/stagingPhase1V2ProductionAuditor.js";
import {
  createAndPersistStagingPhase1V2ProductionArtifact,
  STAGING_PHASE1_V2_PRODUCTION_ARTIFACT_MANIFEST
} from "../src/operations/stagingPhase1V2ProductionArtifacts.js";

const PROJECT = "mbvzwsrtqcrwhvykugcd";
const COMMIT = "b59f432a1947154345f1629ecba50d14fcb1e7c8";
const RUN = "22222222-2222-4222-8222-222222222222";
const AUTHORIZATION = "7".repeat(64);
const BACKEND_START = "2026-08-29T09:59:00.000Z";
const PID = 41_241;
const roots = [];
const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("staging Phase 1 V2 production observer acceptance contract", () => {
  it("binds the reviewed source, package and acceptance contract digests", () => {
    const manifest = STAGING_PHASE1_V2_PRODUCTION_SOURCE_MANIFEST;
    const paths = manifest.sourceFiles.map(({ path }) => path);
    assert.deepEqual(paths, [...paths].sort());
    for (const source of manifest.sourceFiles) {
      assert.equal(
        sha256(readFileSync(join(REPOSITORY_ROOT, source.path))),
        source.sha256
      );
    }
    assert.equal(
      sha256(readFileSync(join(
        REPOSITORY_ROOT, manifest.acceptanceContract.path
      ))),
      manifest.acceptanceContract.sha256
    );
    assert.equal(sha256(manifest.sourceFiles.map(({ path, sha256 }) =>
      `${path}\0${sha256}\n`
    ).join("")), manifest.sourceDigest);
    assert.equal(sha256(canonicalizeStagingPhase1V2Json({
      acceptanceContract: manifest.acceptanceContract,
      packageId: manifest.packageId,
      packageVersion: manifest.packageVersion,
      schemaVersion: manifest.schemaVersion,
      sourceDigest: manifest.sourceDigest,
      sourceFiles: manifest.sourceFiles
    })), manifest.packageDigest);
  });

  it("keeps staging initialization and production admission independently typed and blocked", () => {
    const staging = evaluateStagingPhase1V2AdmissionLevel(
      "staging_initialization"
    );
    const production = evaluateStagingPhase1V2AdmissionLevel(
      "production_admission"
    );
    assert.equal(staging.status, "blocked");
    assert.equal(production.status, "blocked");
    assert.deepEqual(staging.blockers.slice(0, 5).map(({ code }) => code), [
      "artifact_key_id_unpinned",
      "artifact_public_key_unpinned",
      "auditor_ca_unpinned",
      "static_catalog_program_unpinned",
      "static_expected_manifest_unpinned"
    ]);
    assert.equal(staging.blockers.some(({ code }) =>
      code === "exact_billing_unavailable"), false);
    for (const code of [
      "exact_billing_unavailable",
      "control_plane_project_isolation_unproved",
      "advisor_causal_freshness_unproved"
    ]) assert.equal(production.blockers.some((blocker) =>
      blocker.code === code), true);
    assert.throws(
      () => assertStagingPhase1V2StagingInitializationAdmission(),
      blocked("staging_initialization_blocked")
    );
    assert.throws(
      () => assertStagingPhase1V2ProductionAdmission(),
      blocked("production_admission_blocked")
    );
    assert.throws(
      () => assertStagingPhase1V2ProductionObserverCapabilities(),
      blocked("production_admission_blocked")
    );
    assert.throws(
      () => assertStagingPhase1V2BillingEvidence({
        organizationPlan: "free", computeSize: "nano"
      }),
      blocked("billing_evidence_unproved")
    );
    assert.equal(
      STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.capabilities
        .productionFactoryRegistration,
      false
    );
    assert.deepEqual(
      STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.capabilities
        .controlPlaneCredential,
      {
        accepted: false,
        oauthAccepted: false,
        requiredType: "supabase_fine_grained_access_token",
        requiredPermissions: [
          "infra_add_ons_read",
          "organization_admin_read",
          "organization_projects_read",
          "project_admin_read"
        ],
        reason: "provider-enforced staging-only project isolation is unproved on the fixed Free organization"
      }
    );
    assert.equal(
      STAGING_PHASE1_V2_PRODUCTION_ARTIFACT_MANIFEST.productionSigningAvailable,
      false
    );
    assert.equal(
      STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.capabilities
        .staticCatalogGate.accepted,
      false
    );
    assert.equal(
      STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.capabilities
        .cleanupV2.accepted,
      false
    );
  });

  it("validates single-read credential descriptors and restricted billing claims", () => {
    const oauth = credentialDescriptor("oauth_access_token");
    assert.equal(validateStagingPhase1V2ControlCredentialDescriptor(oauth)
      .billingAddonReadAuthoritative, false);
    const fineGrained = credentialDescriptor(
      "supabase_fine_grained_access_token"
    );
    assert.equal(validateStagingPhase1V2ControlCredentialDescriptor(fineGrained)
      .billingAddonReadAuthoritative, true);
    const billing = validateStagingPhase1V2RestrictedBillingObservation({
      computeSize: "nano",
      credentialDescriptor: fineGrained,
      endpoint: `/v1/projects/${PROJECT}/billing/addons`,
      observedAt: "2026-08-29T10:00:00.000Z",
      organizationPlan: "free",
      responseDigest: "6".repeat(64),
      selectedAddons: [],
      source: "supabase_management_api"
    });
    assert.deepEqual(billing, {
      computeSize: "verified_nano",
      exactInvoiceAmount: "unavailable",
      exactUsageAmount: "unavailable",
      freePlan: "verified",
      selectedPaidAddons: "verified_none",
      selectedPaidAddonCount: 0
    });
    assert.throws(() => validateStagingPhase1V2RestrictedBillingObservation({
      computeSize: "nano",
      credentialDescriptor: oauth,
      endpoint: `/v1/projects/${PROJECT}/billing/addons`,
      observedAt: "2026-08-29T10:00:00.000Z",
      organizationPlan: "free",
      responseDigest: "6".repeat(64),
      selectedAddons: [],
      source: "supabase_management_api"
    }), blocked("billing_evidence_unproved"));
  });

  it("never treats local time, Date, ETag, cache keys or repeated GETs as advisor freshness", () => {
    for (const candidate of [
      undefined,
      {
        etag: '"same-response"',
        localRequestCompletedAt: "2026-08-29T10:00:00.000Z",
        providerMarker: null,
        responseDate: "Sat, 29 Aug 2026 10:00:00 GMT"
      },
      {
        etag: "security-cache-key",
        localRequestCompletedAt: new Date().toISOString(),
        providerMarker: "caller-claimed-recomputed",
        responseDate: new Date().toUTCString()
      }
    ]) assert.throws(
      () => assertStagingPhase1V2AdvisorFreshness(candidate),
      blocked("advisor_freshness_unproved")
    );
  });

  it("blocks WARN and ERROR, treats INFO as notice-only, and blocks unknown lint input", () => {
    const info = classifyStagingPhase1V2AdvisorResponse(
      advisor("INFO"), "security"
    );
    assert.equal(info.status, "notice-only");
    assert.equal(info.blockingFindingCount, 0);
    assert.equal(info.noticeCount, 1);
    for (const level of ["WARN", "ERROR"]) {
      const result = classifyStagingPhase1V2AdvisorResponse(
        advisor(level), "security"
      );
      assert.equal(result.status, "blocking");
      assert.equal(result.blockingFindingCount, 1);
    }
    for (const mutate of [
      (value) => { value.lints[0].level = "CRITICAL"; },
      (value) => { value.lints[0].categories = ["UNKNOWN"]; },
      (value) => { value.lints.push(structuredClone(value.lints[0])); }
    ]) {
      const value = advisor("INFO");
      mutate(value);
      assert.throws(
        () => classifyStagingPhase1V2AdvisorResponse(value, "security"),
        (error) => error instanceof
          StagingPhase1V2ProductionObserverContractError
      );
    }
  });

  it("rejects duplicate keys and every configured JSON resource bound", () => {
    assert.throws(
      () => parseStagingPhase1V2BoundedJson('{"a":1,"a":2}'),
      blocked("control_duplicate_json_key")
    );
    for (const [bytes, options] of [
      ['{"a":"12345"}', { maximumStringBytes: 4 }],
      ['{"a":[1,2]}', { maximumArrayItems: 1 }],
      ['{"a":{"b":{"c":1}}}', { maximumDepth: 2 }],
      ['{"a":1,"b":2}', { maximumObjectKeys: 1 }],
      [Buffer.from([0xc3, 0x28]), {}]
    ]) assert.throws(
      () => parseStagingPhase1V2BoundedJson(bytes, options),
      (error) => error?.code === "control_response_bounds" ||
        error?.code === "control_duplicate_json_key"
    );
  });

  it("derives a bounded database application identity from the sealed run binding", () => {
    const first = runBinding();
    const repeated = runBinding();
    const otherRun = deriveStagingPhase1V2DatabaseRunBinding({
      authorizationBindingDigest: AUTHORIZATION,
      candidateCommit: COMMIT,
      projectRef: PROJECT,
      runId: randomUUID()
    });
    assert.deepEqual(first, repeated);
    assert.match(first.applicationName, /^trailmind_p1v2_[a-f0-9]{24}$/);
    assert.ok(Buffer.byteLength(first.applicationName, "utf8") <= 63);
    assert.notEqual(first.applicationName, otherRun.applicationName);
    assert.notEqual(first.applicationName, "trailmind_phase1_v2_operator");
  });

  it("requires an exact distinct SET-only pg_read_all_stats auditor", () => {
    const exact = auditorContract();
    assert.deepEqual(validateStagingPhase1V2AuditorContract(exact), {
      accepted: true,
      role: "trailmind_phase1_v2_stats_auditor"
    });
    for (const mutate of [
      (value) => { value.role = "postgres"; },
      (value) => { value.role = "supabase_admin"; },
      (value) => { value.role = "supabase_read_only_user"; },
      (value) => { value.roleAttributes.superuser = true; },
      (value) => { value.roleAttributes.createdb = true; },
      (value) => { value.roleAttributes.createrole = true; },
      (value) => { value.roleAttributes.bypassrls = true; },
      (value) => { value.roleAttributes.replication = true; },
      (value) => { value.roleAttributes.credentialUnexpired = false; },
      (value) => { value.memberships[0].inherit = true; },
      (value) => { value.memberships[0].admin = true; },
      (value) => { value.defaults.defaultTransactionReadOnly = "off"; },
      (value) => { value.forbiddenAccess.productData = true; },
      (value) => { value.forbiddenAccess.databaseTemporary = true; },
      (value) => { value.forbiddenAccess.ownedObjects = true; },
      (value) => { value.forbiddenAccess.genericSql = true; }
    ]) {
      const invalid = structuredClone(exact);
      mutate(invalid);
      assert.throws(
        () => validateStagingPhase1V2AuditorContract(invalid),
        blocked("auditor_privilege")
      );
    }
  });

  it("exposes only source-compiled auditor statement IDs and read-only setup", () => {
    const connection = stagingPhase1V2ProductionAuditorConnectionContract();
    assert.equal(connection.role,
      "trailmind_phase1_v2_stats_auditor");
    assert.equal(connection.directPort, 5432);
    assert.equal(connection.distinctFromMutatingRole, true);
    assert.equal(connection.genericSqlAllowed, false);
    assert.equal(connection.sessionPoolerAllowed, false);
    assert.equal(connection.transactionPoolerPortAllowed, false);
    assert.deepEqual(Object.keys(STAGING_PHASE1_V2_PRODUCTION_AUDITOR_SQL_MANIFEST)
      .sort(), STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.auditor
      .allowedStatementIds.toSorted());
    assert.equal(STAGING_PHASE1_V2_PRODUCTION_AUDITOR_SESSION_SETUP[0],
      "BEGIN TRANSACTION READ ONLY");
    assert.ok(STAGING_PHASE1_V2_PRODUCTION_AUDITOR_OBSERVATION_SETUP.includes(
      "SET LOCAL stats_fetch_consistency = 'none'"
    ));
    assert.ok(STAGING_PHASE1_V2_PRODUCTION_AUDITOR_OBSERVATION_SETUP.includes(
      "SELECT pg_catalog.pg_stat_clear_snapshot()"
    ));
    for (const id of STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.auditor
      .allowedStatementIds) {
      assert.match(stagingPhase1V2ProductionAuditorStatement(id), /^SELECT/);
      assert.match(STAGING_PHASE1_V2_PRODUCTION_AUDITOR_SQL_MANIFEST[id],
        /^[a-f0-9]{64}$/);
    }
    for (const value of ["SELECT 1", "cleanup", "auditor_identity_v2", null]) {
      assert.throws(
        () => assertStagingPhase1V2StaticStatementId(value),
        blocked("auditor_sql")
      );
    }
  });

  it("binds target and cleanup observations to PID plus backend_start and two fresh samples", () => {
    const binding = sessionBinding();
    const observed = {
      ...binding,
      backendType: "client backend",
      databaseName: "postgres",
      databaseUser: "postgres",
      exactBackendInstanceCount: 1,
      idleExactInstanceCount: 0,
      matchingApplicationCount: 1,
      samePidOtherInstanceCount: 0,
      tls: true
    };
    assert.deepEqual(validateStagingPhase1V2TargetSession(
      observed, binding
    ), { accepted: true });
    for (const invalid of [
      { ...observed, exactBackendInstanceCount: 0 },
      { ...observed, idleExactInstanceCount: 2 },
      { ...observed, matchingApplicationCount: 2 },
      { ...observed, samePidOtherInstanceCount: 1 },
      { ...observed, backendStart: "2026-08-29T09:59:00.000001Z" }
    ]) assert.throws(
      () => validateStagingPhase1V2TargetSession(invalid, binding),
      blocked("auditor_visibility")
    );
    const samples = cleanupSamples(binding);
    assert.equal(validateStagingPhase1V2CleanupSamples(samples, binding)
      .accepted, true);
    for (const invalid of [
      [samples[0]],
      [samples[0], { ...samples[1], statsSnapshotId: samples[0].statsSnapshotId }],
      [samples[0], {
        ...samples[1],
        auditorApplicationName: samples[0].auditorApplicationName,
        auditorBackendPid: samples[0].auditorBackendPid,
        auditorBackendStart: samples[0].auditorBackendStart
      }],
      [samples[0], { ...samples[1], matchingApplicationCount: 1 }],
      [samples[0], { ...samples[1], idleExactInstanceCount: 1 }],
      [samples[0], { ...samples[1], samePidOtherInstanceCount: 1 }],
      [samples[0], { ...samples[1], backendStart:
        "2026-08-29T09:59:01.000Z" }],
      [samples[0], { ...samples[1], observedAt:
        "2026-08-29T10:00:00.100Z" }]
    ]) assert.throws(
      () => validateStagingPhase1V2CleanupSamples(invalid, binding),
      (error) => error instanceof StagingPhase1V2ProductionObserverContractError
    );
  });

  it("rejects a task-owned signing key, closes it, and creates no artifact", async () => {
    const root = await mkdtemp("/private/tmp/trailmind-observer-signing.");
    roots.push(root);
    const { privateKey } = generateKeyPairSync("ed25519");
    const path = join(root, "task-test-key.der");
    await writeFile(path, privateKey.export({ format: "der", type: "pkcs8" }), {
      mode: 0o600
    });
    const fd = openSync(path, "r");
    unlinkSync(path);
    assert.throws(() => createAndPersistStagingPhase1V2ProductionArtifact({
      attemptDirectory: root,
      evidence: {},
      signingCredentialFd: fd,
      unsignedArtifact: {}
    }), blocked("observer_signature_key"));
    assert.throws(() => fstatSync(fd), { code: "EBADF" });
    assert.deepEqual(await readdir(root), []);
  });

  it("pins four chained durable files and consumes OAuth only into session memory", () => {
    assert.deepEqual(STAGING_PHASE1_V2_PRODUCTION_ARTIFACT_MANIFEST.phases, [
      { sequence: 1, phase: "pre-control",
        suffix: "observer.01.pre-control.json" },
      { sequence: 2, phase: "post-ddl-static",
        suffix: "observer.02.post-ddl-static.json" },
      { sequence: 3, phase: "final-control",
        suffix: "observer.03.final-control.json" },
      { sequence: 4, phase: "cleanup",
        suffix: "observer.04.cleanup.json" }
    ]);
    const artifacts = readFileSync(new URL(
      "../src/operations/stagingPhase1V2ProductionArtifacts.js",
      import.meta.url
    ), "utf8");
    assert.match(artifacts, /constants\.O_EXCL/);
    assert.match(artifacts, /0o600/);
    assert.ok((artifacts.match(/fsyncSync\(/g) ?? []).length >= 2);
    assert.match(artifacts, /assertDurablePredecessor/);
    assert.match(artifacts,
      /signatureDomain:\s*"trailmind-production-observer-v2"/);
    assert.match(artifacts,
      /PRODUCTION_OBSERVER_POLICY\.artifacts\.signatureDomain/);
    assert.match(artifacts, /`\\0\$\{artifactDigest\}`/);
    assert.doesNotMatch(artifacts,
      /function\s+createAndPersist[^)]*(?:callback|signer|publicKey)/s);

    const observer = readFileSync(new URL(
      "../src/operations/stagingPhase1V2MachineObserver.js",
      import.meta.url
    ), "utf8");
    const sessionSource = observer.slice(
      observer.indexOf("function createProductionSession"),
      observer.indexOf("function sealMachineArtifact")
    );
    assert.equal((sessionSource.match(/readProtectedDescriptor\(/g) ?? []).length,
      1);
    assert.doesNotMatch(sessionSource, /spawn|execFile|process\.env/);
    const requestSource = observer.slice(
      observer.indexOf("async function requestControlJson"),
      observer.indexOf(
        "export function validateStagingPhase1V2ControlCredentialTypeFixture"
      )
    );
    assert.doesNotMatch(requestSource, /readProtectedDescriptor|redirect|retry/);
  });
});

function advisor(level) {
  return { lints: [{
    cache_key: `fixture-${level}`,
    categories: ["SECURITY"],
    description: "fixture",
    detail: "fixture",
    facing: "EXTERNAL",
    level,
    name: "fixture",
    remediation: "review",
    title: "Fixture"
  }] };
}

function runBinding() {
  return deriveStagingPhase1V2DatabaseRunBinding({
    authorizationBindingDigest: AUTHORIZATION,
    candidateCommit: COMMIT,
    projectRef: PROJECT,
    runId: RUN
  });
}

function sessionBinding() {
  return {
    applicationName: runBinding().applicationName,
    backendPid: PID,
    backendStart: BACKEND_START
  };
}

function cleanupSamples(binding) {
  const sample = (index, observedAt, statsSnapshotId) => ({
    ...binding,
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
    sample(1, "2026-08-29T10:00:00.000Z", randomUUID()),
    sample(2, "2026-08-29T10:00:00.250Z", randomUUID())
  ];
}

function auditorContract() {
  return {
    databaseName: "postgres",
    defaults: {
      defaultTransactionReadOnly: "on",
      searchPath: "pg_catalog",
      statementTimeout: "5s",
      lockTimeout: "1s",
      idleInTransactionSessionTimeout: "5s"
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
      role: "pg_read_all_stats", inherit: false, set: true, admin: false
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

function credentialDescriptor(credentialType) {
  const oauth = credentialType === "oauth_access_token";
  return {
    descriptor: {
      audience: "api.supabase.com",
      credentialType,
      expiresAt: "2026-08-29T10:30:00.000Z",
      issuedAt: "2026-08-29T10:00:00.000Z",
      permissions: oauth ? [] : [
        "advisors_read", "infra_add_ons_read", "organization_admin_read",
        "organization_projects_read", "project_admin_read"
      ],
      projectIsolation: "unproved",
      scopes: oauth
        ? ["database:read", "organizations:read", "projects:read"]
        : [],
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function blocked(code) {
  return (error) => error instanceof
    StagingPhase1V2ProductionObserverContractError &&
    error.code === code && !/token|password|secret|credential/i.test(
      error.message.replace("observer_signature_key", "")
    );
}
