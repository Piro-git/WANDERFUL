import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";
import {
  fstatSync, mkdtempSync, openSync, readdirSync, rmSync, unlinkSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import * as observer from
  "../src/operations/stagingPhase1V2MachineObserver.js";
import {
  assertStagingPhase1V2AdvisorFreshness,
  assertStagingPhase1V2ProductionAdmission,
  assertStagingPhase1V2StagingInitializationAdmission,
  canonicalizeStagingPhase1V2Json,
  classifyStagingPhase1V2AdvisorResponse,
  deriveStagingPhase1V2DatabaseRunBinding,
  evaluateStagingPhase1V2AdmissionLevel,
  parseStagingPhase1V2BoundedJson,
  STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY,
  StagingPhase1V2ProductionObserverContractError,
  validateStagingPhase1V2AuditorContract,
  validateStagingPhase1V2CleanupSamples,
  validateStagingPhase1V2ControlCredentialDescriptor,
  validateStagingPhase1V2RestrictedBillingObservation
} from "../src/operations/stagingPhase1V2ProductionObserverContract.js";
import {
  assertStagingPhase1V2ProductionSigningAvailable,
  createAndPersistStagingPhase1V2ProductionArtifact,
  STAGING_PHASE1_V2_PRODUCTION_ARTIFACT_MANIFEST,
  verifyStagingPhase1V2ProductionArtifact
} from "../src/operations/stagingPhase1V2ProductionArtifacts.js";
import {
  stagingPhase1V2ProductionAuditorConnectionContract,
  stagingPhase1V2ProductionAuditorStatement,
  STAGING_PHASE1_V2_PRODUCTION_AUDITOR_SQL_MANIFEST
} from "../src/operations/stagingPhase1V2ProductionAuditor.js";

const PROJECT = "mbvzwsrtqcrwhvykugcd";
const ORGANIZATION = "wbnftkftyamxzvxsftda";
const COMMIT = "68887cf9cd3e8ce28a05cd2ca7eb9e5d5ed5f8ac";
const RUN = "22222222-2222-4222-8222-222222222222";
const OTHER_RUN = "33333333-3333-4333-8333-333333333333";
const AUTHORIZATION_DIGEST = "a".repeat(64);
const BACKEND_START = "2026-08-30T09:59:00.000001Z";
const PID = 41_241;

describe("staging Phase 1 V2 production observer security acceptance", () => {
  describe("advisor admission", () => {
    for (const level of ["ERROR", "WARN"]) {
      it(`blocks ${level} advisor lints`, () => {
        const result = classifyStagingPhase1V2AdvisorResponse(
          advisorResponse(level, "SECURITY"), "security"
        );
        assert.equal(result.status, "blocking");
        assert.equal(result.blockingFindingCount, 1);
      });
    }

    it("keeps reviewed INFO advisor lints notice-only", () => {
      const result = classifyStagingPhase1V2AdvisorResponse(
        advisorResponse("INFO", "PERFORMANCE"), "performance"
      );
      assert.equal(result.status, "notice-only");
      assert.equal(result.noticeCount, 1);
    });

    for (const [name, mutate] of [
      ["unknown level", (value) => { value.lints[0].level = "NOTICE"; }],
      ["unknown category", (value) => {
        value.lints[0].categories = ["SECURITY", "UNKNOWN"];
      }],
      ["missing level", (value) => { delete value.lints[0].level; }],
      ["unknown response field", (value) => { value.partial = false; }]
    ]) {
      it(`blocks advisor ${name}`, () => {
        const value = advisorResponse("INFO", "SECURITY");
        mutate(value);
        assert.throws(
          () => observer.validateStagingPhase1V2ControlResponseFixture(
            "security", value
          ),
          machineFailure()
        );
      });
    }

    it("blocks duplicate advisor lint identities with a bounded code", () => {
      const value = advisorResponse("INFO", "SECURITY");
      value.lints.push(structuredClone(value.lints[0]));
      assert.throws(
        () => observer.validateStagingPhase1V2ControlResponseFixture(
          "security", value
        ),
        machineFailure("advisor_duplicate_lint_identity")
      );
    });
  });

  describe("billing evidence", () => {
    it("binds billing evidence to the fixed provider endpoint and permission", () => {
      assert.deepEqual(
        observer.STAGING_PHASE1_V2_CONTROL_REQUEST_MANIFEST.requests.billing,
        {
          maximumBytes: 32 * 1024,
          method: "GET",
          path: `/v1/projects/${PROJECT}/billing/addons`,
          requiredPermission: "infra_add_ons_read"
        }
      );
    });

    it("accepts only the restricted Free and selected-addons observation", () => {
      assert.deepEqual(validateStagingPhase1V2RestrictedBillingObservation(
        billingObservation()
      ), {
        computeSize: "verified_nano",
        exactInvoiceAmount: "unavailable",
        exactUsageAmount: "unavailable",
        freePlan: "verified",
        selectedPaidAddons: "verified_none",
        selectedPaidAddonCount: 0
      });
    });

    it("keeps exact billing unavailable instead of inferring zero", () => {
      const production = evaluateStagingPhase1V2AdmissionLevel(
        "production_admission"
      );
      assert.equal(production.blockers.some(({ code }) =>
        code === "exact_billing_unavailable"), true);
      assert.throws(
        () => validateStagingPhase1V2RestrictedBillingObservation({
          ...billingObservation(),
          credentialDescriptor: credentialDescriptor("oauth_access_token")
        }),
        contractFailure("billing_evidence_unproved")
      );
    });
  });

  describe("advisor freshness", () => {
    it("records causal freshness as an external typed block", () => {
      for (const value of [
        undefined,
        { localRequestCompletedAt: "2026-08-30T10:00:00.000Z" },
        { fetches: ["digest-a", "digest-b"] },
        { responseDate: "Sun, 30 Aug 2026 10:00:00 GMT" }
      ]) assert.throws(
        () => assertStagingPhase1V2AdvisorFreshness(value),
        contractFailure("advisor_freshness_unproved")
      );
      assert.equal(evaluateStagingPhase1V2AdmissionLevel(
        "production_admission"
      ).blockers.some(({ code }) =>
        code === "advisor_causal_freshness_unproved"), true);
    });
  });

  describe("dedicated auditor identity", () => {
    it("accepts the exact pre-provisioned least-privilege role contract", () => {
      assert.deepEqual(validateStagingPhase1V2AuditorContract(auditor()), {
        accepted: true,
        role: "trailmind_phase1_v2_stats_auditor"
      });
    });

    it("rejects the postgres mutator as auditor", () => {
      assert.throws(
        () => validateStagingPhase1V2AuditorContract({
          ...auditor(), role: "postgres", sessionUserName: "postgres"
        }),
        contractFailure("auditor_privilege")
      );
    });

    for (const role of [
      "supabase_admin", "supabase_read_only_user", "readonly_auditor_role"
    ]) {
      it(`rejects ${role} as auditor`, () => {
        assert.throws(() => validateStagingPhase1V2AuditorContract({
          ...auditor(), role, sessionUserName: role
        }), contractFailure("auditor_privilege"));
      });
    }

    for (const [name, mutate] of [
      ["SUPERUSER", (value) => { value.roleAttributes.superuser = true; }],
      ["BYPASSRLS", (value) => { value.roleAttributes.bypassrls = true; }],
      ["CREATEDB", (value) => { value.roleAttributes.createdb = true; }],
      ["CREATEROLE", (value) => { value.roleAttributes.createrole = true; }],
      ["replication", (value) => { value.roleAttributes.replication = true; }],
      ["missing pg_read_all_stats", (value) => { value.memberships = []; }],
      ["inherited membership", (value) => {
        value.memberships[0].inherit = true;
      }],
      ["writable transaction", (value) => {
        value.defaults.defaultTransactionReadOnly = "off";
      }],
      ["product-data grant", (value) => {
        value.forbiddenAccess.productData = true;
      }]
    ]) {
      it(`rejects auditor ${name}`, () => {
        const value = auditor();
        mutate(value);
        assert.throws(
          () => validateStagingPhase1V2AuditorContract(value),
          contractFailure("auditor_privilege")
        );
      });
    }
  });

  describe("run-derived database identity", () => {
    it("derives the exact bounded application identity", () => {
      const value = runBinding();
      assert.match(value.applicationName, /^trailmind_p1v2_[a-f0-9]{24}$/);
      assert.match(value.databaseRunBindingDigest, /^[a-f0-9]{64}$/);
      assert.ok(Buffer.byteLength(value.applicationName) <= 63);
    });

    it("produces distinct identities across run IDs", () => {
      assert.notEqual(runBinding().applicationName, runBinding(OTHER_RUN)
        .applicationName);
    });

    it("binds cleanup to PID and microsecond backend_start", () => {
      const samples = cleanupSamples();
      assert.equal(samples[0].backendPid, PID);
      assert.equal(samples[0].backendStart, BACKEND_START);
      assert.equal(validateStagingPhase1V2CleanupSamples(
        samples, sessionBinding()
      ).accepted, true);
    });
  });

  describe("cleanup proof", () => {
    it("rejects a one-sample zero false green", () => {
      assert.throws(
        () => validateStagingPhase1V2CleanupSamples(
          cleanupSamples().slice(0, 1), sessionBinding()
        ),
        contractFailure("cleanup_unproved")
      );
    });

    it("requires two fresh independent auditor sessions", () => {
      const valid = cleanupSamples();
      assert.equal(validateStagingPhase1V2CleanupSamples(
        valid, sessionBinding()
      ).accepted, true);
      const sameSession = structuredClone(valid);
      sameSession[1].auditorApplicationName =
        sameSession[0].auditorApplicationName;
      sameSession[1].auditorBackendPid = sameSession[0].auditorBackendPid;
      sameSession[1].auditorBackendStart = sameSession[0].auditorBackendStart;
      assert.throws(
        () => validateStagingPhase1V2CleanupSamples(
          sameSession, sessionBinding()
        ),
        contractFailure("cleanup_independent_sessions")
      );
    });
  });

  describe("signed durable artifact chain", () => {
    it("has an offline positive Ed25519 reference control", () => {
      const pair = generateKeyPairSync("ed25519");
      const message = Buffer.from("trailmind-production-observer-v2\0fixture");
      const signature = sign(null, message, pair.privateKey);
      assert.equal(verify(null, message, pair.publicKey, signature), true);
    });

    it("fails closed while the production signing pin is absent", () => {
      assert.throws(
        () => assertStagingPhase1V2ProductionSigningAvailable(),
        contractFailure("observer_signature_key")
      );
      assert.throws(
        () => verifyStagingPhase1V2ProductionArtifact({}),
        contractFailure("observer_signature_key")
      );
    });

    it("pins canonical serialization and four durable V2 names", () => {
      assert.equal(canonicalizeStagingPhase1V2Json({ z: 1, a: "x" }),
        '{"a":"x","z":1}');
      assert.deepEqual(
        STAGING_PHASE1_V2_PRODUCTION_ARTIFACT_MANIFEST.phases.map(
          ({ suffix }) => suffix
        ),
        [
          "observer.01.pre-control.json",
          "observer.02.post-ddl-static.json",
          "observer.03.final-control.json",
          "observer.04.cleanup.json"
        ]
      );
    });

    it("closes an unapproved key descriptor without publishing", () => {
      const root = mkdtempSync("/private/tmp/trailmind-observer-acceptance.");
      const pair = generateKeyPairSync("ed25519");
      const path = join(root, "test-key.der");
      writeFileSync(path, pair.privateKey.export({
        format: "der", type: "pkcs8"
      }), { mode: 0o600 });
      const fd = openSync(path, "r");
      unlinkSync(path);
      try {
        assert.throws(() => createAndPersistStagingPhase1V2ProductionArtifact({
          attemptDirectory: root,
          evidence: {},
          signingCredentialFd: fd,
          unsignedArtifact: {}
        }), contractFailure("observer_signature_key"));
        assert.throws(() => fstatSync(fd), { code: "EBADF" });
        assert.deepEqual(readdirSync(root), []);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe("credential containment", () => {
    it("accepts an exact short-lived read-scoped OAuth descriptor", () => {
      assert.deepEqual(validateStagingPhase1V2ControlCredentialDescriptor(
        credentialDescriptor("oauth_access_token")
      ), {
        accepted: true,
        billingAddonReadAuthoritative: false,
        credentialType: "oauth_access_token",
        projectIsolationVerified: false
      });
    });

    const forbiddenDescriptors = [
      ["PAT", (value) => { value.descriptor.credentialType = "pat"; }],
      ["service role", (value) => {
        value.descriptor.credentialType = "service_role";
      }],
      ["publishable key", (value) => {
        value.descriptor.credentialType = "publishable_key";
      }],
      ["anon JWT", (value) => { value.descriptor.credentialType = "anon"; }],
      ["refresh token", (value) => {
        value.descriptor.credentialType = "oauth_refresh_token";
      }],
      ["client secret", (value) => {
        value.descriptor.credentialType = "oauth_client_secret";
      }],
      ["browser cookie", (value) => { value.descriptor.source = "browser"; }],
      ["MCP credential", (value) => { value.descriptor.source = "mcp"; }],
      ["opaque string", (value) => { value.descriptor.source = "opaque"; }],
      ["missing exact scopes", (value) => {
        value.descriptor.scopes = ["projects:read"];
      }]
    ];
    for (const [name, mutate] of forbiddenDescriptors) {
      it(`rejects ${name} credential material`, () => {
        const value = credentialDescriptor("oauth_access_token");
        mutate(value);
        assert.throws(
          () => validateStagingPhase1V2ControlCredentialDescriptor(value),
          contractFailure()
        );
      });
    }

    it("validates the complete single-read lifecycle", () => {
      const value = credentialDescriptor("oauth_access_token");
      value.lifecycle.readCount = 2;
      assert.throws(
        () => validateStagingPhase1V2ControlCredentialDescriptor(value),
        contractFailure("control_credential_descriptor")
      );
    });

    for (const [name, mutate] of [
      ["nonzero descriptor offset", (value) => {
        value.lifecycle.initialOffset = 1;
      }],
      ["linked descriptor", (value) => {
        value.lifecycle.unlinkedBeforeRead = false;
      }],
      ["unclosed descriptor", (value) => {
        value.lifecycle.closedAfterRead = false;
      }],
      ["retained credential copy", (value) => {
        value.lifecycle.retainedCredentialCopies = 1;
      }]
    ]) {
      it(`rejects ${name}`, () => {
        const value = credentialDescriptor("oauth_access_token");
        mutate(value);
        assert.throws(
          () => validateStagingPhase1V2ControlCredentialDescriptor(value),
          contractFailure("control_credential_descriptor")
        );
      });
    }
  });

  describe("management transport", () => {
    it("pins exact paths, queries, refs and endpoint permissions", () => {
      const requests = observer.STAGING_PHASE1_V2_CONTROL_REQUEST_MANIFEST
        .requests;
      assert.equal(requests.project.path, `/v1/projects/${PROJECT}`);
      assert.equal(requests.organization.path,
        `/v1/organizations/${ORGANIZATION}`);
      assert.equal(requests.inventory.path,
        `/v1/organizations/${ORGANIZATION}/projects?limit=100&offset=0&sort=name_asc`);
      assert.equal(requests.security.path,
        `/v1/projects/${PROJECT}/advisors/security?lint_type=sql`);
      assert.equal(requests.performance.path,
        `/v1/projects/${PROJECT}/advisors/performance`);
      assert.equal(requests.billing.requiredPermission, "infra_add_ons_read");
      assert.equal(Object.values(requests).every(({ method }) =>
        method === "GET"), true);
    });

    it("keeps response parsing exact, duplicate-safe and bounded", () => {
      const parsed = parseStagingPhase1V2BoundedJson('{"ok":true}');
      assert.equal(parsed.ok, true);
      assert.equal(Object.getPrototypeOf(parsed), null);
      for (const [body, options, code] of [
        ['{"a":1,"a":2}', {}, "control_duplicate_json_key"],
        ['{"a":"12345"}', { maximumStringBytes: 4 },
          "control_response_bounds"],
        ['{"a":[1,2]}', { maximumArrayItems: 1 },
          "control_response_bounds"]
      ]) assert.throws(
        () => parseStagingPhase1V2BoundedJson(body, options),
        contractFailure(code)
      );
    });

    it("rejects redirects, compression, stale dates and oversized lengths", () => {
      const valid = {
        contentEncoding: undefined,
        contentLength: "128",
        contentType: "application/json",
        location: undefined,
        maximumBytes: 16 * 1024,
        serverDate: new Date().toUTCString(),
        statusCode: 200
      };
      assert.equal(observer
        .validateStagingPhase1V2ControlResponseMetadataFixture(valid)
        .statusCode, 200);
      for (const mutate of [
        (value) => { value.statusCode = 302; value.location = "/other"; },
        (value) => { value.contentEncoding = "gzip"; },
        (value) => { value.contentLength = "999999"; },
        (value) => { value.serverDate = "invalid"; }
      ]) {
        const value = { ...valid };
        mutate(value);
        assert.throws(() => observer
          .validateStagingPhase1V2ControlResponseMetadataFixture(value),
        machineFailure("control_transport"));
      }
    });
  });

  describe("factory and admission", () => {
    it("keeps the production package explicitly unregistered", () => {
      assert.equal(observer.STAGING_PHASE1_V2_PRODUCTION_OBSERVER_PACKAGE
        .registrationStatus, "observer_required");
    });

    it("exports no generic production registration, transport or signer", () => {
      assert.deepEqual(Object.keys(observer).filter((name) =>
        /register|promote|inject|generic.*transport|signer/i.test(name)), []);
    });

    it("rejects a missing factory through staging_initialization", () => {
      assert.throws(
        () => observer.requireReviewedStagingPhase1V2ProductionObserverFactory(),
        machineFailure("observer_required")
      );
      assert.throws(
        () => assertStagingPhase1V2StagingInitializationAdmission(),
        contractFailure("staging_initialization_blocked")
      );
    });

    it("rejects copied and manually constructed factories", () => {
      assert.throws(
        () => observer.requireReviewedStagingPhase1V2ProductionObserverFactory({
          packageBinding: structuredClone(
            observer.STAGING_PHASE1_V2_PRODUCTION_OBSERVER_PACKAGE
          ),
          createSession() {}
        }),
        machineFailure("observer_untrusted")
      );
    });

    it("preserves the five exact unmet pins", () => {
      assert.deepEqual(STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.pins, {
        artifactKeyId: null,
        artifactPublicKeySpkiSha256: null,
        auditorSslrootcertSha256: null,
        independentCatalogAssertionProgramSha256: null,
        independentExpectedManifestSha256: null
      });
    });

    it("keeps production admission blocked on external limitations", () => {
      assert.throws(
        () => assertStagingPhase1V2ProductionAdmission(),
        contractFailure("production_admission_blocked")
      );
      const codes = evaluateStagingPhase1V2AdmissionLevel(
        "production_admission"
      ).blockers.map(({ code }) => code);
      assert.ok(codes.includes("exact_billing_unavailable"));
      assert.ok(codes.includes("control_plane_project_isolation_unproved"));
      assert.ok(codes.includes("advisor_causal_freshness_unproved"));
    });

    it("pins only catalog SQL and direct least-privilege auditor transport", () => {
      assert.ok(Object.hasOwn(
        STAGING_PHASE1_V2_PRODUCTION_AUDITOR_SQL_MANIFEST,
        "cleanup_sessions_v2"
      ));
      assert.match(stagingPhase1V2ProductionAuditorStatement(
        "cleanup_sessions_v2"
      ), /^SELECT/);
      const connection = stagingPhase1V2ProductionAuditorConnectionContract();
      assert.equal(connection.role,
        "trailmind_phase1_v2_stats_auditor");
      assert.equal(connection.sessionPoolerAllowed, false);
      assert.equal(connection.sslrootcertSha256, null);
    });
  });
});

function advisorResponse(level, category) {
  return { lints: [{
    cache_key: `fixture-${level}`,
    categories: [category],
    description: "fixture",
    detail: "fixture",
    facing: "EXTERNAL",
    level,
    name: "fixture",
    remediation: "review",
    title: "Fixture"
  }] };
}

function credentialDescriptor(credentialType) {
  const oauth = credentialType === "oauth_access_token";
  return {
    descriptor: {
      audience: "api.supabase.com",
      credentialType,
      expiresAt: "2026-08-30T10:30:00.000Z",
      issuedAt: "2026-08-30T10:00:00.000Z",
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

function billingObservation() {
  return {
    computeSize: "nano",
    credentialDescriptor: credentialDescriptor(
      "supabase_fine_grained_access_token"
    ),
    endpoint: `/v1/projects/${PROJECT}/billing/addons`,
    observedAt: "2026-08-30T10:00:00.000Z",
    organizationPlan: "free",
    responseDigest: "6".repeat(64),
    selectedAddons: [],
    source: "supabase_management_api"
  };
}

function auditor() {
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

function runBinding(runId = RUN) {
  return deriveStagingPhase1V2DatabaseRunBinding({
    authorizationBindingDigest: AUTHORIZATION_DIGEST,
    candidateCommit: COMMIT,
    projectRef: PROJECT,
    runId
  });
}

function sessionBinding() {
  return {
    applicationName: runBinding().applicationName,
    backendPid: PID,
    backendStart: BACKEND_START
  };
}

function cleanupSamples() {
  const sample = (index, observedAt) => ({
    ...sessionBinding(),
    auditorApplicationName:
      `trailmind_p1v2_auditor_${String(index).repeat(32)}`,
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
    statsSnapshotId: randomUUID()
  });
  return [
    sample(1, "2026-08-30T10:00:00.000001Z"),
    sample(2, "2026-08-30T10:00:00.250001Z")
  ];
}

function machineFailure(code) {
  return (error) => error instanceof
    observer.StagingPhase1V2MachineObserverError &&
    (code === undefined || error.code === code) &&
    error.message.length < 160 &&
    !/bearer|password|secret material/i.test(error.message);
}

function contractFailure(code) {
  return (error) => error instanceof
    StagingPhase1V2ProductionObserverContractError &&
    (code === undefined || error.code === code) &&
    error.message.length < 180 &&
    !/bearer|password|secret material/i.test(error.message);
}
