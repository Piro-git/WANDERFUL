import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fstatSync, openSync, realpathSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  readStagingPhase1V2CandidateBindings,
  STAGING_PHASE1_V2_APPLICATION_NAME,
  STAGING_PHASE1_V2_DIRECT_HOST,
  STAGING_PHASE1_V2_LIVE_BOUNDARY_PACKAGE_VERSION
} from "../src/operations/stagingPhase1V2Admission.js";
import {
  createStagingPhase1V2SingleSessionDependencies,
  runAuthorizedStagingPhase1V2SingleSession
} from "../src/operations/stagingPhase1V2SingleSessionAdapter.js";
import {
  canonicalAclDigest
} from "../src/operations/stagingPhase1V2Operator.js";
import {
  SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
} from "../src/operations/stagingMigrationPolicy.js";

const NOW = new Date(Date.now() + 60_000);
NOW.setMilliseconds(0);
const CANDIDATE = "52849b4c75cd6e5ddf00473adf8a3265160d750d";
const CANDIDATE_TREE = "b".repeat(40);
const PROJECT = "mbvzwsrtqcrwhvykugcd";
const POLICY = "supabase-postgis-isolation-v2";
const PID = 41_241;
const RUNTIME_FUNCTIONS = [
  "trailmind_runtime_outdoor_research_highlights_v1",
  "trailmind_runtime_outdoor_research_route_assertions_v1",
  "trailmind_runtime_outdoor_research_route_memberships_v1",
  "trailmind_runtime_outdoor_research_snapshot_context_v1",
  "trailmind_runtime_outdoor_research_trail_access_candidates_v1"
];
const SHARED_ACL = [
  {
    object_kind: "database",
    object_name: "postgres",
    owner_name: "postgres",
    raw_acl: null,
    semantic_acl: []
  },
  {
    object_kind: "schema",
    object_name: "extensions",
    owner_name: "postgres",
    raw_acl: "{=U/postgres}",
    semantic_acl: [{
      grantee: "PUBLIC", grantor: "postgres",
      privilege: "USAGE", grantable: false
    }]
  },
  {
    object_kind: "schema",
    object_name: "public",
    owner_name: "postgres",
    raw_acl: "{=U/postgres}",
    semantic_acl: [{
      grantee: "PUBLIC", grantor: "postgres",
      privilege: "USAGE", grantable: false
    }]
  }
];
const PROVIDER_PLAN = [
  {
    principal_name: "postgres",
    object_kind: "database",
    object_name: "postgres",
    privilege_name: "CONNECT",
    effective: true
  }
];
const temporaryRoots = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("staging Phase 1 V2 one-session adapter", () => {
  it("runs all ten operator phases on exactly one configured Client and one PID", async () => {
    const events = [];
    const Client = fakeClientClass({ events });
    const fixture = await authorizationFixture();
    const result = await runAuthorizedStagingPhase1V2SingleSession({
      admissionRequest: fixture.request,
      ...boundaries(events)
    }, dependencies(Client));

    assert.equal(result.receipt.status, "committed");
    assert.deepEqual(result.receipt.migrations,
      SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2);
    assert.equal(Client.instances.length, 1);
    assert.equal(Client.instances[0].processID, PID);
    assert.equal(Client.instances[0].ended, true);
    assert.equal(Client.instances[0].state.locked, false);
    const config = Client.configs[0];
    assert.equal(config.host, STAGING_PHASE1_V2_DIRECT_HOST);
    assert.equal(config.port, 5432);
    assert.equal(config.database, "postgres");
    assert.equal(config.application_name, STAGING_PHASE1_V2_APPLICATION_NAME);
    assert.equal(config.enableChannelBinding, true);
    assert.equal(config.ssl.rejectUnauthorized, true);
    assert.equal(config.ssl.servername, STAGING_PHASE1_V2_DIRECT_HOST);
    assert.equal(config.keepAlive, true);
    assert.equal(config.connectionTimeoutMillis, 10_000);
    assert.equal(config.statement_timeout, 30_000);
    assert.equal(config.lock_timeout, 5_000);
    assert.equal(config.idle_in_transaction_session_timeout, 5_000);
    assert.equal(Object.hasOwn(config, "connectionString"), false);
    assert.equal(Object.hasOwn(config, "options"), false);
    assert.deepEqual(Client.instances[0].state.ledger,
      SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2);
    assert(events.indexOf("control:pre") < events.indexOf("client:connect"));
    assert(events.indexOf("client:outer-lock") < events.indexOf("client:pre"));
    assert(events.indexOf("client:post") < events.indexOf("receipt:persist"));
    const receiptIndex = events.indexOf("receipt:persist");
    assert(events.indexOf("client:end") < receiptIndex);
    assert(events.indexOf("cleanup:prove") < receiptIndex);
  });

  it("keeps disabled and production requests at zero DNS, Client and boundary IO", async () => {
    for (const override of [
      { enabled: false },
      { projectRef: "bejvhhjbgtvctpsnlwid" }
    ]) {
      const events = [];
      let dnsCalls = 0;
      const Client = fakeClientClass({ events });
      const fixture = await authorizationFixture();
      await assert.rejects(runAuthorizedStagingPhase1V2SingleSession({
        admissionRequest: { ...fixture.request, ...override },
        ...boundaries(events)
      }, {
        ...dependencies(Client),
        lookup: async () => {
          dnsCalls += 1;
          return [{ address: "2606:4700:4700::1111", family: 6 }];
        }
      }), fixedError("admission_rejected"));
      assert.equal(dnsCalls, 0);
      assert.equal(Client.instances.length, 0);
      assert.deepEqual(events, []);
    }
  });

  it("rejects reserved DNS answers and every unproved TLS property", async () => {
    for (const address of [
      "127.0.0.1", "10.0.0.1", "100.64.0.1", "192.0.2.1",
      "198.51.100.1", "203.0.113.1", "::1", "fc00::1", "fe80::1",
      "2001:db8::1", "3fff::1"
    ]) {
      const events = [];
      const Client = fakeClientClass({ events });
      const fixture = await authorizationFixture();
      await assert.rejects(runAuthorizedStagingPhase1V2SingleSession({
        admissionRequest: fixture.request,
        ...boundaries(events)
      }, {
        ...dependencies(Client),
        lookup: async () => [{ address, family: address.includes(":") ? 6 : 4 }]
      }), fixedError("dns_address"));
      assert.equal(Client.instances.length, 0);
      assert.deepEqual(events, []);
    }

    for (const tls of [
      { encrypted: false },
      { authorized: false },
      { authorizationError: "untrusted" },
      { protocol: "TLSv1.1" },
      { channelBinding: false },
      { connectionHost: "attacker.invalid" },
      { certificate: {} }
    ]) {
      const events = [];
      const Client = fakeClientClass({ events, ...tls });
      const fixture = await authorizationFixture();
      await assert.rejects(runAuthorizedStagingPhase1V2SingleSession({
        admissionRequest: fixture.request,
        ...boundaries(events)
      }, dependencies(Client)), fixedError("tls_attestation"));
      assert.equal(events.includes("receipt:persist"), false);
      assert.equal(Client.instances[0].ended, true);
    }
  });

  it("rejects a second operator immediately when the outer session lock conflicts", async () => {
    const events = [];
    const Client = fakeClientClass({ events, lockAcquired: false });
    const fixture = await authorizationFixture();
    await assert.rejects(
      runAuthorizedStagingPhase1V2SingleSession({
        admissionRequest: fixture.request,
        ...boundaries(events)
      }, dependencies(Client)),
      fixedError("operator_rejected")
    );
    assert.equal(events.includes("client:pre"), false);
    assert.equal(events.includes("receipt:persist"), false);
    assert.equal(Client.instances[0].ended, true);
  });

  it("fails closed on PID drift or a missing outer lock across transaction boundaries", async () => {
    for (const option of [
      { driftPidAfterPre: true },
      { loseLockAfterPre: true }
    ]) {
      const events = [];
      const Client = fakeClientClass({ events, ...option });
      const fixture = await authorizationFixture();
      await assert.rejects(
        runAuthorizedStagingPhase1V2SingleSession({
          admissionRequest: fixture.request,
          ...boundaries(events)
        }, dependencies(Client)),
        fixedError("session_attestation")
      );
      assert.equal(events.includes("receipt:persist"), false);
      assert.equal(Client.instances[0].connection.stream.destroyed, true);
    }
  });

  it("maps timeout and disconnect SQLSTATEs without exposing PostgreSQL text", async () => {
    for (const [databaseCode, expectedCode, destroysSocket] of [
      ["57014", "statement_timeout", false],
      ["55P03", "lock_timeout", false],
      ["25P03", "idle_timeout", true],
      ["08006", "connection_lost", true]
    ]) {
      const events = [];
      const Client = fakeClientClass({
        events,
        failPreStep: Object.assign(new Error(
          "private SQL and connection diagnostic"
        ), { code: databaseCode })
      });
      const fixture = await authorizationFixture();
      await assert.rejects(runAuthorizedStagingPhase1V2SingleSession({
        admissionRequest: fixture.request,
        ...boundaries(events)
      }, dependencies(Client)), fixedError(expectedCode));
      assert.equal(events.includes("receipt:persist"), false);
      assert.equal(
        Client.instances[0].connection.stream.destroyed,
        destroysSocket
      );
    }
  });

  it("never returns success when lock release or Client cleanup is unproved", async () => {
    for (const [options, expectedCode] of [
      [{ unlockFails: true }, "lock_release_unknown"],
      [{ failEnd: true }, "cleanup_unproved"]
    ]) {
      const events = [];
      const Client = fakeClientClass({ events, ...options });
      const fixture = await authorizationFixture();
      await assert.rejects(runAuthorizedStagingPhase1V2SingleSession({
        admissionRequest: fixture.request,
        ...boundaries(events)
      }, dependencies(Client)), fixedError(expectedCode));
      assert.equal(events.includes("receipt:persist"), false);
    }
  });

  it("latches aborts so late query completion cannot continue or publish", async () => {
    const events = [];
    let release;
    const Client = fakeClientClass({
      events,
      deferPreSnapshot: new Promise((resolve) => { release = resolve; })
    });
    const admission = fakeAdmission();
    const client = new Client({});
    const session = createStagingPhase1V2SingleSessionDependencies({
      admission,
      client,
      ...boundaries(events),
      now: () => NOW
    });
    const operation = session.run();
    await waitFor(() => events.includes("client:pre-snapshot-wait"));
    session.abort("overall_timeout");
    release();
    await assert.rejects(operation, /overall_timeout/);
    await session.cleanup();
    assert.equal(events.includes("client:pre"), false);
    assert.equal(events.includes("receipt:persist"), false);
    assert.equal(client.connection.stream.destroyed, true);
  });

  it("closes the consumed descriptor and client on external cancellation", async () => {
    const events = [];
    const Client = fakeClientClass({ events });
    const fixture = await authorizationFixture();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(runAuthorizedStagingPhase1V2SingleSession({
      admissionRequest: fixture.request,
      ...boundaries(events)
    }, {
      ...dependencies(Client),
      signal: controller.signal
    }), fixedError("cancelled"));
    assert.equal(Client.instances.length, 1);
    assert.equal(Client.instances[0].ended, true);
    assert.equal(events.includes("receipt:persist"), false);
    assert.throws(() => fstatSync(fixture.request.passwordFd),
      (error) => error?.code === "EBADF");
  });

  it("contains post-commit boundary failure before returning a fixed redacted error", async () => {
    const events = [];
    const Client = fakeClientClass({ events });
    const fixture = await authorizationFixture();
    const external = boundaries(events, { failPostAdvisors: true });
    await assert.rejects(
      runAuthorizedStagingPhase1V2SingleSession({
        admissionRequest: fixture.request,
        ...external
      }, dependencies(Client)),
      fixedError("control_plane_rejected")
    );
    assert.equal(events.includes("client:contain-runtime"), true);
    assert.equal(events.includes("containment:flags"), true);
    assert.equal(events.includes("receipt:persist"), false);
  });

  it("sanitizes arbitrary PostgreSQL and boundary text into a bounded taxonomy", async () => {
    const events = [];
    const Client = fakeClientClass({
      events,
      failIdentity: Object.assign(new Error(
        "postgresql://private-user:private-password@private-host/secret private coordinates"
      ), { code: "XX000" })
    });
    const fixture = await authorizationFixture();
    let observed;
    try {
      await runAuthorizedStagingPhase1V2SingleSession({
        admissionRequest: fixture.request,
        ...boundaries(events)
      }, dependencies(Client));
    } catch (error) {
      observed = error;
    }
    assert(observed);
    assert.equal(observed.code, "database_rejected");
    assert.equal(Buffer.byteLength(JSON.stringify(observed.outcome)) < 256, true);
    assert.doesNotMatch(observed.message,
      /postgres(?:ql)?:\/\/|password|private-host|coordinates/i);
    assert.deepEqual(Object.keys(observed.outcome).sort(), ["code", "status"]);
  });

  it("rejects stale or replayed cleanup evidence before publication", async () => {
    for (const mutation of [
      ["runId", randomUUID()],
      ["backendPid", PID + 1],
      ["candidateCommit", "0".repeat(40)],
      ["candidateTree", "0".repeat(40)],
      ["stagedReceiptDigest", "0".repeat(64)],
      ["applicationName", "replayed_operator"],
      ["completionState", "stale"],
      ["observedAt", new Date(NOW.getTime() - 600_000).toISOString()]
    ]) {
      const events = [];
      const Client = fakeClientClass({ events });
      const fixture = await authorizationFixture();
      const external = boundaries(events);
      const prove = external.cleanupVerifier.proveSessionClosed.bind(
        external.cleanupVerifier
      );
      external.cleanupVerifier.proveSessionClosed = async (request) => {
        const proof = await prove(request);
        const { evidenceDigest: ignored, ...fields } = proof;
        fields[mutation[0]] = mutation[1];
        return { ...fields, evidenceDigest: canonicalAclDigest(fields) };
      };
      await assert.rejects(
        runAuthorizedStagingPhase1V2SingleSession({
          admissionRequest: fixture.request,
          ...external
        }, dependencies(Client)),
        fixedError("cleanup_unproved")
      );
      assert.equal(events.includes("receipt:persist"), false);
    }
  });

  it("rejects stale or cross-run durable receipt acknowledgements", async () => {
    for (const mutation of [
      ["runId", randomUUID()],
      ["candidateTree", "0".repeat(40)],
      ["receiptDigest", "0".repeat(64)],
      ["cleanupEvidenceDigest", "0".repeat(64)],
      ["persistedAt", new Date(NOW.getTime() - 600_000).toISOString()]
    ]) {
      const events = [];
      const Client = fakeClientClass({ events });
      const fixture = await authorizationFixture();
      const external = boundaries(events);
      const persist = external.receiptStore.persist.bind(external.receiptStore);
      external.receiptStore.persist = async (payload) => {
        const proof = await persist(payload);
        const { evidenceDigest: ignored, ...fields } = proof;
        fields[mutation[0]] = mutation[1];
        return { ...fields, evidenceDigest: canonicalAclDigest(fields) };
      };
      await assert.rejects(
        runAuthorizedStagingPhase1V2SingleSession({
          admissionRequest: fixture.request,
          ...external
        }, dependencies(Client)),
        fixedError("receipt_publication_unproved")
      );
    }
  });
});

function fakeClientClass(options) {
  class FakeClient {
    static configs = [];
    static instances = [];

    constructor(config) {
      FakeClient.configs.push(config);
      FakeClient.instances.push(this);
      this.config = config;
      this.processID = PID;
      this.trailmindChannelBindingEstablished =
        options.channelBinding !== false;
      this.connectionParameters = {
        host: options.connectionHost ?? STAGING_PHASE1_V2_DIRECT_HOST,
        port: 5432,
        database: "postgres",
        user: "postgres",
        ssl: true
      };
      this.connection = {
        stream: {
          encrypted: options.encrypted ?? true,
          authorized: options.authorized ?? true,
          authorizationError: options.authorizationError ?? null,
          remoteAddress: directConnection().address,
          destroyed: false,
          getPeerCertificate: () => options.certificate ??
            ({ subjectaltname: `DNS:${STAGING_PHASE1_V2_DIRECT_HOST}` }),
          getProtocol: () => options.protocol ?? "TLSv1.3",
          destroy() { this.destroyed = true; }
        }
      };
      this.state = {
        locked: false,
        pre: false,
        post: false,
        ledger: []
      };
      this.ended = false;
      this.attestCount = 0;
    }

    async connect() {
      options.events.push("client:connect");
    }

    async end() {
      options.events.push("client:end");
      if (options.failEnd) throw new Error("private shutdown failure");
      this.ended = true;
    }

    getTransactionStatus() {
      return "I";
    }

    async query(text, values = []) {
      const sql = String(text);
      if (sql.includes("phase1-v2:identity")) {
        if (options.failIdentity) throw options.failIdentity;
        return result(identityRow());
      }
      if (sql.includes("phase1-v2:timeouts")) return result({ ok: true });
      if (sql.includes("phase1-v2:session-attestation")) {
        options.events.push("client:attest");
        this.attestCount += 1;
        const afterPre = this.state.pre;
        const pid = options.driftPidAfterPre && afterPre ? PID + 1 : PID;
        const lockHeld = options.loseLockAfterPre && afterPre
          ? false : this.state.locked;
        return result({
          backend_pid: pid,
          database_name: "postgres",
          session_user: "postgres",
          current_user: "postgres",
          application_name: STAGING_PHASE1_V2_APPLICATION_NAME,
          is_superuser: "off",
          statement_timeout: "30s",
          lock_timeout: "5s",
          idle_transaction_timeout: "5s",
          transaction_timeout: "35s",
          rolcanlogin: true,
          rolsuper: false,
          rolcreatedb: true,
          rolcreaterole: true,
          rolreplication: false,
          rolbypassrls: false,
          can_read_all_settings: true,
          foundation_lock_held: lockHeld
        });
      }
      if (sql.includes("phase1-v2:outer-lock")) {
        options.events.push("client:outer-lock");
        this.state.locked = options.lockAcquired !== false;
        return result({ acquired: this.state.locked });
      }
      if (sql.includes("phase1-v2:outer-unlock")) {
        options.events.push("client:outer-unlock");
        this.state.locked = false;
        return result({ unlocked: options.unlockFails !== true });
      }
      if (sql.includes("phase1-v2:pre-snapshot")) {
        if (options.deferPreSnapshot) {
          options.events.push("client:pre-snapshot-wait");
          await options.deferPreSnapshot;
        }
        return result(preSnapshotRow());
      }
      if (sql.includes("phase1-v2:shared-acl")) return rows(SHARED_ACL);
      if (sql.includes("phase1-v2:provider-acl-plan")) return rows(PROVIDER_PLAN);
      if (sql.includes("Phase 1 Supabase PostGIS-isolation V2 candidate")) {
        if (options.failPreStep) throw options.failPreStep;
        options.events.push("client:pre");
        this.state.pre = true;
        return empty();
      }
      if (sql.includes("phase1-v2:failure-state")) {
        return result({
          pre_step_committed: this.state.pre && !this.state.post,
          application_ledger_exists: this.state.ledger.length > 0,
          application_foundation_exists: this.state.ledger.length > 0,
          post_step_committed: this.state.post
        });
      }
      if (sql.includes("AS migration_count") &&
          sql.includes("trailmind_schema_migrations")) {
        return result({ migration_count: this.state.ledger.length });
      }
      if (sql.trim() === "BEGIN" || sql.trim() === "COMMIT" ||
          sql.trim() === "ROLLBACK" || sql.startsWith("SET LOCAL") ||
          sql.startsWith("SELECT pg_catalog.set_config")) return empty();
      if (sql.includes("pg_advisory_xact_lock")) return result({ locked: true });
      if (sql.includes("WITH RECURSIVE login AS") ||
          sql.includes("WITH RECURSIVE migration AS")) {
        return allTrueResult(sql);
      }
      if (sql.includes("current_user = 'migration_role' AS exact_current") ||
          (sql.includes("current_user = 'postgres' AS exact_current") &&
           !sql.includes("phase1-v2:session-attestation") &&
           !sql.includes("phase1-v2:cleanup-attestation"))) {
        return allTrueResult(sql);
      }
      if (sql.includes("exact_owned_object_owner")) return allTrueResult(sql);
      if (sql.includes("exact_portable_path")) return allTrueResult(sql);
      if (sql.includes("exact_path") && sql.includes("trailmind_app_owner")) {
        return allTrueResult(sql);
      }
      if (sql.includes("ordinary_table") && sql.includes("exact_primary_key")) {
        return allTrueResult(sql);
      }
      if (sql.includes("CREATE TABLE IF NOT EXISTS trailmind_app.trailmind_schema_migrations")) {
        return empty();
      }
      if (sql.includes("INSERT INTO trailmind_app.trailmind_schema_migrations")) {
        this.state.ledger.push(values[0]);
        return empty();
      }
      if (sql.includes("SELECT version") &&
          sql.includes("trailmind_schema_migrations")) {
        return rows(this.state.ledger.map((version) => ({ version })));
      }
      if (sql.includes("V2 post-step")) {
        options.events.push("client:post");
        this.state.post = true;
        return empty();
      }
      if (sql.includes("SELECT procedure.proname") &&
          sql.includes("outdoor_research_runtime_role")) {
        return rows(RUNTIME_FUNCTIONS.map((proname) => ({ proname })));
      }
      if (sql.includes("phase1-v2:final-roles")) {
        return rows(expectedRoleRows());
      }
      if (sql.includes("phase1-v2:final-memberships")) {
        return rows(expectedMembershipRows());
      }
      if (sql.includes("phase1-v2:final-snapshot")) return result(finalSnapshotRow());
      if (sql.includes("phase1-v2:cleanup-attestation")) {
        return result({
          backend_pid: PID,
          exact_session: true,
          exact_current: true,
          no_advisory_locks: true
        });
      }
      if (sql.includes("phase1-v2:containment-sessions")) return rows([]);
      if (sql.includes("REVOKE EXECUTE ON FUNCTION")) {
        options.events.push("client:contain-runtime");
        return empty();
      }
      if (sql.includes("AS revoked")) {
        return result({ revoked: true, remaining_runtime_sessions: 0 });
      }
      if (sql.includes("PRE_MIGRATION_V2_ROLLBACK") ||
          sql.includes("Guarded compensation for PHASE_1_PRE_MIGRATION_V2")) {
        this.state.pre = false;
        return empty();
      }
      return empty();
    }
  }
  return FakeClient;
}

function boundaries(events, { failPostAdvisors = false } = {}) {
  const controlSnapshot = controlPlaneSnapshot();
  return {
    controlPlane: {
      async inspectPre() {
        events.push("control:pre");
        return controlSnapshot;
      },
      async inspectPostAdvisors() {
        events.push("control:post-advisors");
        if (failPostAdvisors) throw new Error("private provider response");
        return phase("post-ddl-advisors", 8, "acceptable", {
          observedAt: NOW.toISOString(),
          security: advisor("8"),
          performance: advisor("9")
        }, "8");
      },
      async inspectFinal() {
        events.push("control:final");
        return controlSnapshot;
      }
    },
    containmentControl: {
      async assertAllDisabled() {
        events.push("containment:flags");
        return {
          providerFlagsAllFalse: true,
          importFlagsAllFalse: true,
          deployFlagsAllFalse: true
        };
      }
    },
    cleanupVerifier: {
      async proveSessionClosed(request) {
        events.push("cleanup:prove");
        const proof = {
          applicationName: request.applicationName,
          authorizationBindingDigest: request.authorizationBindingDigest,
          backendPid: request.backendPid,
          backendSessionCount: 0,
          candidateCommit: request.candidateCommit,
          candidateTree: request.candidateTree,
          completionState: "session-closed",
          idleSessionCount: 0,
          observedAt: NOW.toISOString(),
          operatorDigestsDigest: request.operatorDigestsDigest,
          projectRef: request.projectRef,
          runId: request.runId,
          stagedReceiptDigest: request.stagedReceiptDigest
        };
        return { ...proof, evidenceDigest: canonicalAclDigest(proof) };
      }
    },
    receiptStore: {
      async persist(payload) {
        events.push("receipt:persist");
        const persistence = {
          applicationName: payload.applicationName,
          authorizationBindingDigest: payload.authorizationBindingDigest,
          backendPid: payload.backendPid,
          candidateCommit: payload.candidateCommit,
          candidateTree: payload.candidateTree,
          cleanupEvidenceDigest: payload.cleanupEvidenceDigest,
          operatorDigestsDigest: payload.operatorDigestsDigest,
          ordinal: 11,
          persistedAt: NOW.toISOString(),
          phase: "sanitized-durable-receipt",
          projectRef: payload.projectRef,
          receiptBytes: payload.receiptBytes,
          receiptDigest: payload.receiptDigest,
          runId: payload.runId,
          status: "persisted"
        };
        return { ...persistence, evidenceDigest: canonicalAclDigest(persistence) };
      }
    }
  };
}

function dependencies(Client) {
  return {
    Client,
    lookup: async () => [{ address: "2606:4700:4700::1111", family: 6 }],
    now: () => NOW,
    admission: {
      env: {},
      now: () => NOW,
      gitInspection: testGitInspection()
    }
  };
}

async function authorizationFixture() {
  const root = await mkdtemp("/private/tmp/trailmind-phase1-v2-adapter.");
  temporaryRoots.push(root);
  const authorizationStoreDirectory = join(root, "consumed");
  await mkdir(authorizationStoreDirectory, { mode: 0o700 });
  const caPath = join(root, "ca.pem");
  const caKeyPath = join(root, "ca-key.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256",
    "-days", "1", "-subj", "/CN=TrailMind Adapter Test CA",
    "-addext", "basicConstraints=critical,CA:TRUE",
    "-keyout", caKeyPath, "-out", caPath
  ], { stdio: ["ignore", "ignore", "ignore"] });
  unlinkSync(caKeyPath);
  await chmod(caPath, 0o600);
  const ca = await readFile(caPath);
  const passwordPath = join(root, "password");
  await writeFile(passwordPath, "test-only-password", { mode: 0o600 });
  const passwordFd = openSync(passwordPath, "r");
  unlinkSync(passwordPath);
  const runId = randomUUID();
  const attemptId = randomUUID();
  const providerAclRestorePlanDigest = canonicalAclDigest(PROVIDER_PLAN);
  const bindings = readStagingPhase1V2CandidateBindings({
    gitInspection: testGitInspection()
  });
  const authorizationEnvelopePath = join(root, "authorization.json");
  await writeFile(authorizationEnvelopePath, JSON.stringify({
    schemaVersion: 1,
    attemptId,
    authorizationId: randomUUID(),
    singleUse: true,
    issuedAt: new Date(NOW.getTime() - 1_000).toISOString(),
    expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
    projectRef: PROJECT,
    policyId: POLICY,
    runId,
    candidateCommit: CANDIDATE,
    candidateTree: CANDIDATE_TREE,
    connection: directConnection(),
    controlObservationDigest: "c".repeat(64),
    endpointClass: "direct",
    gitAttestation: bindings.gitAttestation,
    target: targetBinding(),
    tls: tlsBinding(),
    credentialContainment: credentialContainment(),
    liveBoundaryPackageVersion:
      STAGING_PHASE1_V2_LIVE_BOUNDARY_PACKAGE_VERSION,
    dataApiExposedSchemas: ["public", "graphql_public"],
    authorizationStoreDirectorySha256: sha256(
      realpathSync(authorizationStoreDirectory)
    ),
    caSha256: sha256(ca),
    providerAclRestorePlanDigest,
    operatorDigests: bindings.operatorDigests
  }), { mode: 0o600 });
  return {
    request: {
      enabled: true,
      attemptId,
      projectRef: PROJECT,
      policyId: POLICY,
      runId,
      candidateCommit: CANDIDATE,
      candidateTree: CANDIDATE_TREE,
      providerAclRestorePlanDigest,
      connection: directConnection(),
      controlObservationDigest: "c".repeat(64),
      endpointClass: "direct",
      gitAttestation: bindings.gitAttestation,
      target: targetBinding(),
      tls: tlsBinding(),
      credentialContainment: credentialContainment(),
      liveBoundaryPackageVersion:
        STAGING_PHASE1_V2_LIVE_BOUNDARY_PACKAGE_VERSION,
      dataApiExposedSchemas: ["public", "graphql_public"],
      authorizationEnvelopePath,
      authorizationStoreDirectory,
      passwordFd,
      caPath
    }
  };
}

function tlsBinding() {
  return {
    certificateAuthority: "target-project-ca",
    minimumVersion: "TLSv1.2",
    mode: "verify-full",
    rejectUnauthorized: true,
    serverNameVerification: STAGING_PHASE1_V2_DIRECT_HOST
  };
}

function credentialContainment() {
  return {
    descriptorMinimum: 3,
    descriptorSameProcessOnly: true,
    fileMode: "0600",
    intake: "interactive-tty-noecho",
    ownerUid: process.geteuid(),
    pathUnlinkedBeforeDatabase: true,
    singleLinkBeforeUnlink: true
  };
}

function targetBinding() {
  return {
    databaseName: "postgres",
    monthlyCostUsd: 0,
    organizationId: "wbnftkftyamxzvxsftda",
    organizationName: "Alibra AI",
    organizationPlan: "free",
    postgresMajor: 17,
    projectName: "TrailMind Outdoor Staging V1",
    projectRef: PROJECT,
    region: "eu-central-1",
    regionLabel: "Frankfurt"
  };
}

function fakeAdmission() {
  const bindings = readStagingPhase1V2CandidateBindings({
    gitInspection: testGitInspection()
  });
  return Object.freeze({
    projectRef: PROJECT,
    policyId: POLICY,
    runId: randomUUID(),
    candidateCommit: CANDIDATE,
    candidateTree: CANDIDATE_TREE,
    authorizationBindingDigest: "a".repeat(64),
    connection: directConnection(),
    dataApiExposedSchemas: ["public", "graphql_public"],
    providerAclRestorePlanDigest: canonicalAclDigest(PROVIDER_PLAN),
    admittedMigrations: bindings.admittedMigrations,
    operatorDigests: bindings.operatorDigests,
    operatorSql: bindings.operatorSql
  });
}

function controlPlaneSnapshot() {
  const flags = [
    "OUTDOOR_EVIDENCE_ENABLED",
    "RESEARCH_GUIDED_PLANNING_ENABLED",
    "ROUTABLE_HIGHLIGHT_ACCESS_ENABLED",
    "OUTDOOR_EVIDENCE_PROVIDER_ENABLED",
    "OUTDOOR_RESEARCH_PLANNING_ENABLED",
    "OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED",
    "ROUTE_PROVIDER_ENABLED",
    "INTENT_PROVIDER_ENABLED",
    "OUTDOOR_RESEARCH_PLANNING_ALLOW_INSECURE_LOCAL",
    "ROUTE_ALLOW_INSECURE_LOCAL_ROUTING",
    "INTENT_ALLOW_INSECURE_LOCAL_PARSING",
    "APP_ATTEST_ALLOW_IN_MEMORY",
    "INTENT_ALLOW_DETERMINISTIC_MOCK"
  ];
  return {
    observedAt: NOW.toISOString(),
    project: {
      ref: PROJECT,
      name: "TrailMind Outdoor Staging V1",
      organizationId: "wbnftkftyamxzvxsftda",
      region: "eu-central-1",
      status: "ACTIVE_HEALTHY"
    },
    billing: {
      organizationPlan: "free",
      computeSize: "nano",
      currency: "USD",
      monthlyCostAmount: 0,
      nonzeroAddonCount: 0,
      observedAt: NOW.toISOString()
    },
    advisors: {
      security: {
        status: "completed", blockingFindingCount: 0,
        observedAt: NOW.toISOString()
      },
      performance: {
        status: "completed", blockingFindingCount: 0,
        observedAt: NOW.toISOString()
      }
    },
    expectedDatabaseAclDigest: canonicalAclDigest(SHARED_ACL),
    protectedProjects: [
      {
        ref: "bejvhhjbgtvctpsnlwid", kind: "production",
        selected: false, mutationCount: 0
      },
      {
        ref: "cmkvbxppgofteoutfslp", kind: "planua",
        selected: false, mutationCount: 0
      }
    ],
    featureFlags: Object.fromEntries(flags.map((name) => [name, false]))
  };
}

function identityRow() {
  return {
    database_name: "postgres",
    session_user: "postgres",
    current_user: "postgres",
    backend_pid: PID,
    server_version_num: 170_000,
    shared_preload_libraries: "supautils",
    supautils_privileged_role: "postgres",
    supautils_superuser: "supabase_admin",
    supautils_legacy_superuser: "supabase_admin",
    supautils_privileged_extensions: "postgis",
    is_superuser: "off",
    rolcanlogin: true,
    rolsuper: false,
    rolcreatedb: true,
    rolcreaterole: true,
    rolreplication: false,
    rolbypassrls: false,
    can_read_all_settings: true,
    supabase_admin_superuser: true,
    postgres_cannot_set_supabase_admin: true
  };
}

function preSnapshotRow() {
  return {
    database_name: "postgres",
    current_database_bytes: 12_000_000,
    session_user: "postgres",
    current_user: "postgres",
    database_owner: "postgres",
    trailmind_role_count: 0,
    trailmind_schema_count: 0,
    trailmind_object_count: 0,
    postgis_installed: false,
    recovery_guard_exists: false,
    recovery_ledger_exists: false,
    recovery_application_foundation_exists: false,
    public_postgis_routine_count: 0,
    sibling_writer_session_count: 0,
    extensions_schema_owner: "postgres",
    extensions_schema_exists: true,
    extensions_public_usage: true,
    extensions_public_create: false,
    shared_acl_mutation_authorized: true
  };
}

function finalSnapshotRow() {
  return {
    database_name: "postgres",
    session_user: "postgres",
    current_user: "postgres",
    database_owner: "postgres",
    regional_import_no_database_create: true,
    import_schema_owner_bounded_database_create: true,
    bounded_import_provisioning_contract: true,
    postgis_schema: "trailmind_gis",
    postgis_owner_topology: "postgres-schema/postgres-extension-members",
    gis_unexpected_create_principal_count: 0,
    public_postgis_routine_count: 0,
    runtime_direct_table_privilege_count: 0,
    runtime_direct_postgis_routine_count: 0,
    runtime_direct_shared_routine_count: 0,
    sibling_writer_session_count: 0,
    app_attest_admission: true,
    outdoor_runtime_admission: true,
    cancellation_admission: true
  };
}

function expectedRoleRows() {
  const roles = [
    "app_security_runtime_role", "migration_role",
    "outdoor_research_cancellation_control_role",
    "outdoor_research_runtime_role", "platform_provisioner",
    "projection_role", "pruner_role", "readonly_auditor_role",
    "regional_import_role", "trailmind_app_owner",
    "trailmind_control_owner", "trailmind_import_schema_owner"
  ];
  const login = new Set([
    "app_security_runtime_role",
    "outdoor_research_cancellation_control_role",
    "outdoor_research_runtime_role", "projection_role", "pruner_role",
    "readonly_auditor_role", "regional_import_role"
  ]);
  return roles.map((rolname) => ({
    rolname,
    rolcanlogin: login.has(rolname),
    rolinherit: rolname === "trailmind_control_owner",
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolbypassrls: false,
    rolconnlimit: rolname ===
      "outdoor_research_cancellation_control_role" ? 1 : -1
  }));
}

function expectedMembershipRows() {
  const roles = expectedRoleRows().map(({ rolname }) => rolname);
  const rows = [{
    member_name: "migration_role",
    target_name: "trailmind_app_owner",
    grantor_name: "postgres",
    inherit_option: false,
    set_option: true,
    admin_option: false
  }];
  for (const target_name of roles) {
    rows.push({
      member_name: "postgres", target_name, grantor_name: "supabase_admin",
      inherit_option: false, set_option: false, admin_option: true
    });
    if ([
      "migration_role", "trailmind_app_owner", "trailmind_control_owner",
      "trailmind_import_schema_owner"
    ].includes(target_name)) {
      rows.push({
        member_name: "postgres", target_name, grantor_name: "postgres",
        inherit_option: false, set_option: true, admin_option: false
      });
    }
  }
  rows.push({
    member_name: "trailmind_control_owner",
    target_name: "pg_signal_backend",
    grantor_name: "postgres",
    inherit_option: true,
    set_option: false,
    admin_option: false
  });
  return rows;
}

function allTrueResult(sql) {
  const aliases = [...sql.matchAll(/\bAS\s+([a-z][a-z0-9_]*)/gi)]
    .map((match) => match[1].toLowerCase());
  return result(Object.fromEntries(aliases.map((alias) => [alias, true])));
}

function directConnection() {
  return {
    address: "2606:4700:4700::1111",
    host: STAGING_PHASE1_V2_DIRECT_HOST,
    port: 5432,
    user: "postgres",
    database: "postgres"
  };
}

function testGitInspection() {
  return () => ({
    baselineReachable: true,
    clean: true,
    head: CANDIDATE,
    root: realpathSync(new URL("../..", import.meta.url)),
    tree: CANDIDATE_TREE
  });
}

function advisor(digit) {
  return {
    status: "completed",
    blockingFindingCount: 0,
    noticeCount: 0,
    evidenceDigest: digit.repeat(64)
  };
}

function phase(name, ordinal, status, fields, digit) {
  return { phase: name, ordinal, status, evidenceDigest: digit.repeat(64), ...fields };
}

function fixedError(code) {
  return (error) => error?.code === code &&
    error?.message === `trailmind_phase1_v2_adapter_failed:${code}`;
}

function result(row) {
  return { rowCount: 1, rows: [structuredClone(row)] };
}

function rows(value) {
  return { rowCount: value.length, rows: structuredClone(value) };
}

function empty() {
  return { rowCount: 0, rows: [] };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("condition was not reached");
}
