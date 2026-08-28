import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { openSync, realpathSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import {
  readStagingPhase1V2CandidateBindings,
  STAGING_PHASE1_V2_DIRECT_HOST
} from "../src/operations/stagingPhase1V2Admission.js";
import {
  runAuthorizedStagingPhase1V2SingleSession
} from "../src/operations/stagingPhase1V2SingleSessionAdapter.js";
import { runMigrationPolicy } from "../src/operations/migrationRunner.js";
import {
  issueStagingPhase1V2MigrationCapability
} from "../src/operations/stagingMigrationCapability.js";
import {
  assertControlPlaneSnapshot,
  canonicalAclDigest
} from "../src/operations/stagingPhase1V2Operator.js";
import {
  SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
} from "../src/operations/stagingMigrationPolicy.js";

const enabled =
  process.env.TRAILMIND_PHASE1_V2_ADAPTER_POSTGRES_INTEGRATION === "true";
const mode = process.env.TRAILMIND_PHASE1_V2_ADAPTER_INTEGRATION_MODE;
const candidate = process.env.TRAILMIND_PHASE1_V2_ADAPTER_CANDIDATE;
const caPath = process.env.TRAILMIND_PHASE1_V2_ADAPTER_CA_PATH;
const tcpPort = Number(process.env.TRAILMIND_PHASE1_V2_ADAPTER_TCP_PORT);
const socketHost = process.env.PGHOST;
const socketPort = Number(process.env.PGPORT);
const PROJECT = "mbvzwsrtqcrwhvykugcd";
const POLICY = "supabase-postgis-isolation-v2";
const PASSWORD = "test-only-password";
const appName = "trailmind_phase1_v2_operator";
let maintenance;
let sharedAcl;
let providerPlan;
let expectedAclDigest;
let expectedProviderDigest;
let bindings;
let clientClass;

describe("staging Phase 1 V2 adapter on disposable PostgreSQL 17", {
  skip: enabled ? false : "run through the disposable TLS PostgreSQL 17 harness"
}, () => {
  before(async () => {
    assert.match(candidate, /^[a-f0-9]{40}$/);
    assert(Number.isSafeInteger(tcpPort) && tcpPort > 1024);
    maintenance = new pg.Client({
      host: socketHost,
      port: socketPort,
      user: "supabase_admin",
      database: "postgres"
    });
    await maintenance.connect();
    sharedAcl = await readSharedAcl(maintenance);
    providerPlan = await readProviderPlan(maintenance);
    expectedAclDigest = canonicalAclDigest(sharedAcl);
    expectedProviderDigest = canonicalAclDigest(providerPlan);
    bindings = readStagingPhase1V2CandidateBindings({
      gitInspection: testGitInspection()
    });
    clientClass = localTlsClientClass();
  });

  after(async () => {
    await maintenance?.end();
  });

  it("regresses the former non-superuser SQLSTATE 0LP01 grant failure", {
    skip: mode === "regression" ? false : `mode is ${mode}`
  }, async () => {
    await proveFormerGrantFailsWith0LP01();
  });

  it("proves one PID, outer lock, first apply, true no-op and lock release", {
    skip: mode === "success" ? false : `mode is ${mode}`
  }, async () => {
    const events = [];
    let result;
    try {
      result = await runOperator({ events });
    } catch (error) {
      assert.fail(`adapter ${error?.code ?? "unknown"}; phases=${events.join(",")}`);
    }
    assert.equal(result.receipt.status, "committed");
    assert.deepEqual(result.receipt.migrations,
      SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2);
    assert.equal(clientClass.instances.length, 1);
    assert.equal(new Set(clientClass.instances.map(({ processID }) => processID)).size, 1);
    const ledger = await maintenance.query(`
      SELECT version FROM trailmind_app.trailmind_schema_migrations
       ORDER BY applied_at, version
    `);
    assert.deepEqual(ledger.rows.map(({ version }) => version),
      SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2);
    assert.equal(events.filter((event) => event === "receipt:persist").length, 1);
    await assertLockReleased();
    await assertNoAdapterSessions();
  });

  it("proves transaction rollback plus exact pre-ledger compensation", {
    skip: mode === "compensation" ? false : `mode is ${mode}`
  }, async () => {
    const events = [];
    await assert.rejects(runOperator({ events, clientMode: "fail-migration" }),
      fixedAdapterError("operator_rejected"));
    const residue = await maintenance.query(`
      SELECT pg_catalog.to_regnamespace('trailmind_app') IS NULL AS no_app,
             pg_catalog.to_regnamespace('trailmind_control') IS NULL AS no_control,
             pg_catalog.to_regnamespace('trailmind_gis') IS NULL AS no_gis,
             pg_catalog.to_regnamespace('trailmind_phase1_guard') IS NULL
               AS no_guard,
             NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension
                          WHERE extname = 'postgis') AS no_postgis,
             NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
                          WHERE rolname = ANY($1::text[])) AS no_roles
    `, [TRAILMIND_ROLES]);
    assert.deepEqual(residue.rows[0], {
      no_app: true,
      no_control: true,
      no_gis: true,
      no_guard: true,
      no_postgis: true,
      no_roles: true
    });
    assert.equal(events.includes("receipt:persist"), false);
    await assertLockReleased();
    await assertNoAdapterSessions();
  });

  it("proves bounded post-commit containment without publication", {
    skip: mode === "containment" ? false : `mode is ${mode}`
  }, async () => {
    const events = [];
    await assert.rejects(runOperator({ events, failPostAdvisors: true }),
      fixedAdapterError("operator_rejected"));
    const grants = await maintenance.query(`
      SELECT pg_catalog.count(*)::integer AS executable
        FROM pg_catalog.pg_proc procedure
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'trailmind_app'
         AND procedure.proname = ANY($1::text[])
         AND pg_catalog.has_function_privilege(
           'outdoor_research_runtime_role', procedure.oid, 'EXECUTE'
         )
    `, [RUNTIME_FUNCTIONS]);
    assert.equal(grants.rows[0].executable, 0);
    assert.equal(events.includes("containment:flags"), true);
    assert.equal(events.includes("receipt:persist"), false);
    await assertLockReleased();
    await assertNoAdapterSessions();
  });

  it("proves conflict, statement/lock/overall timeout and disconnect cleanup", {
    skip: mode === "failures" ? false : `mode is ${mode}`
  }, async () => {
    await withHeldFoundationLock(async () => {
      await assert.rejects(runOperator({ events: [] }),
        fixedAdapterError("operator_rejected"));
    });
    await assertNoFoundation();

    await assert.rejects(
      runOperator({ events: [], clientMode: "statement-timeout" }),
      fixedAdapterError("operator_rejected")
    );
    await assertNoFoundation();

    await withHeldTableLock(async () => {
      await assert.rejects(
        runOperator({ events: [], clientMode: "lock-timeout" }),
        fixedAdapterError("operator_rejected")
      );
    });
    await assertNoFoundation();

    await assert.rejects(
      runOperator({
        events: [],
        clientMode: "overall-timeout",
        overallTimeoutMilliseconds: 100
      }),
      fixedAdapterError("overall_timeout")
    );
    await assertNoFoundation();

    await assert.rejects(
      runOperator({ events: [], clientMode: "disconnect" }),
      (error) => ["connection_lost", "database_rejected", "operator_rejected"]
        .includes(error?.code)
    );
    await assertNoFoundation();
    await assertLockReleased();
    await assertNoAdapterSessions();
  });
});

async function runOperator({
  events,
  clientMode = "normal",
  failPostAdvisors = false,
  overallTimeoutMilliseconds
}) {
  const authorization = await createAuthorization();
  assertControlPlaneSnapshot(controlSnapshot(), new Date());
  clientClass.mode = clientMode;
  clientClass.events = events;
  return runAuthorizedStagingPhase1V2SingleSession({
    admissionRequest: authorization,
    controlPlane: controlPlane(events, failPostAdvisors),
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
      async proveSessionClosed() {
        events.push("cleanup:prove");
        const result = await maintenance.query(`
          SELECT pg_catalog.count(*)::integer AS backend_session_count,
                 pg_catalog.count(*) FILTER (
                   WHERE state = 'idle'
                 )::integer AS idle_session_count
            FROM pg_catalog.pg_stat_activity
           WHERE application_name = $1
        `, [appName]);
        return {
          backendSessionCount: result.rows[0].backend_session_count,
          idleSessionCount: result.rows[0].idle_session_count,
          observedAt: new Date().toISOString(),
          evidenceDigest: sha256(JSON.stringify(result.rows[0]))
        };
      }
    },
    receiptStore: {
      async persist({ receiptDigest, receiptBytes }) {
        events.push("receipt:persist");
        return phase("sanitized-durable-receipt", 11, "persisted", {
          receiptDigest,
          receiptBytes
        }, "c");
      }
    }
  }, {
    Client: clientClass,
    lookup: async () => [{ address: "2606:4700:4700::1111", family: 6 }],
    now: () => new Date(),
    ...(overallTimeoutMilliseconds ? { overallTimeoutMilliseconds } : {}),
    admission: {
      env: {},
      now: () => new Date(),
      gitInspection: testGitInspection()
    }
  });
}

async function proveFormerGrantFailsWith0LP01() {
  const client = new pg.Client({
    host: socketHost,
    port: socketPort,
    user: "postgres",
    database: "postgres"
  });
  try {
    await client.connect();
    await client.query(`
      CREATE ROLE trailmind_app_owner
        NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
        NOREPLICATION NOBYPASSRLS
    `);
    const bootstrap = await client.query(`
      SELECT membership.inherit_option, membership.set_option,
             membership.admin_option,
             grantor.rolname AS grantor_name
        FROM pg_catalog.pg_auth_members membership
        JOIN pg_catalog.pg_roles target ON target.oid = membership.roleid
        JOIN pg_catalog.pg_roles member ON member.oid = membership.member
        JOIN pg_catalog.pg_roles grantor ON grantor.oid = membership.grantor
       WHERE target.rolname = 'trailmind_app_owner'
         AND member.rolname = 'postgres'
    `);
    assert.deepEqual(bootstrap.rows, [{
      inherit_option: false,
      set_option: false,
      admin_option: true,
      grantor_name: "supabase_admin"
    }]);
    await assert.rejects(client.query(`
      GRANT trailmind_app_owner TO postgres
        WITH INHERIT FALSE, SET TRUE, ADMIN TRUE
    `), (error) => error?.code === "0LP01");
  } finally {
    try { await client.query("DROP ROLE trailmind_app_owner"); } catch {}
    await client.end();
  }
}

function localTlsClientClass() {
  class LocalTlsClient extends pg.Client {
    static instances = [];
    static mode = "normal";
    static events = [];

    constructor(config) {
      const expectedHost = config.host;
      const { stream: ignoredPinnedStream, ...localConfig } = config;
      super({ ...localConfig, host: "127.0.0.1", port: tcpPort });
      this.expectedHost = expectedHost;
      this.trailmindChannelBindingEstablished = false;
      LocalTlsClient.instances.push(this);
    }

    _handleAuthSASL(message) {
      super._handleAuthSASL(message);
      this.trailmindChannelBindingEstablished =
        this.saslSession?.mechanism === "SCRAM-SHA-256-PLUS";
    }

    async connect() {
      await super.connect();
      this.connectionParameters.host = this.expectedHost;
      this.connectionParameters.port = 5432;
      this.connectionParameters.database = "postgres";
      this.connectionParameters.user = "postgres";
      Object.defineProperty(this.connection.stream, "remoteAddress", {
        configurable: true,
        value: "2606:4700:4700::1111"
      });
    }

    async query(text, values) {
      let sql = String(text);
      const managedPreStep = sql === bindings.operatorSql.preMigration;
      if (sql.includes("phase1-v2:session-attestation")) {
        LocalTlsClient.events.push("db:attest");
      } else if (sql.includes("phase1-v2:pre-snapshot")) {
        LocalTlsClient.events.push("db:pre-snapshot");
      } else if (sql === bindings.operatorSql.preMigration) {
        LocalTlsClient.events.push("db:pre-step");
      } else if (sql === bindings.operatorSql.postMigration) {
        LocalTlsClient.events.push("db:post-step");
      } else if (sql.includes("phase1-v2:final-snapshot")) {
        LocalTlsClient.events.push("db:final-snapshot");
      } else if (sql.includes("REVOKE EXECUTE ON FUNCTION")) {
        LocalTlsClient.events.push("db:containment");
      } else if (sql.includes("WITH RECURSIVE migration AS")) {
        LocalTlsClient.events.push("db:migration-operator");
      } else if (sql.includes("current_user = 'migration_role'")) {
        LocalTlsClient.events.push("db:migration-role-transition");
      } else if (sql.includes("exact_owned_object_owner")) {
        LocalTlsClient.events.push("db:migration-postgis");
      } else if (sql.includes("exact_path") &&
                 sql.includes("trailmind_app_owner")) {
        LocalTlsClient.events.push("db:migration-owner");
      } else if (sql.includes("ordinary_table") &&
                 sql.includes("exact_primary_key")) {
        LocalTlsClient.events.push("db:migration-ledger-shape");
      } else if (sql.includes("CREATE TABLE IF NOT EXISTS") &&
                 sql.includes("trailmind_schema_migrations")) {
        LocalTlsClient.events.push("db:migration-ledger-create");
      } else if (sql.includes("SELECT version") &&
                 sql.includes("trailmind_schema_migrations")) {
        LocalTlsClient.events.push("db:migration-ledger-read");
      } else if (sql.includes("INSERT INTO trailmind_app.trailmind_schema_migrations")) {
        LocalTlsClient.events.push(`db:migration-insert-${values?.[0] ?? "unknown"}`);
      } else if (sql.trim() === "BEGIN") {
        LocalTlsClient.events.push("db:begin");
      }
      if (managedPreStep) {
        sql = sql.replace(
          "CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA trailmind_gis;",
          "SELECT fixture.install_managed_postgis();"
        );
        if (LocalTlsClient.mode === "statement-timeout") {
          sql = sql.replace(
            "SET LOCAL statement_timeout = '30s';",
            "SET LOCAL statement_timeout = '50ms';\n" +
            "SELECT pg_catalog.pg_sleep(1);"
          );
        }
        if (LocalTlsClient.mode === "lock-timeout") {
          sql = sql.replace(
            "BEGIN;",
            "BEGIN;\nSET LOCAL lock_timeout = '50ms';\n" +
            "LOCK TABLE public.phase1_v2_lock_fixture " +
            "IN ACCESS EXCLUSIVE MODE;"
          );
        }
      }
      if (
        LocalTlsClient.mode === "fail-migration" &&
        sql === firstMigrationSql
      ) {
        throw Object.assign(new Error("test migration fault"), {
          code: "XX000"
        });
      }
      if (
        LocalTlsClient.mode === "overall-timeout" &&
        sql.includes("phase1-v2:pre-snapshot")
      ) return super.query("SELECT pg_catalog.pg_sleep(10)");
      if (
        LocalTlsClient.mode === "disconnect" &&
        sql.includes("phase1-v2:pre-snapshot")
      ) this.connection.stream.destroy();
      try {
        return await super.query(sql, values);
      } catch (error) {
        const message = error?.message ?? "";
        const category = /already been granted membership/.test(message)
          ? "duplicate-membership"
          : /grantor must have|must have the/.test(message)
            ? "missing-grantor-option"
            : /permission denied|may grant/.test(message)
              ? "permission"
              : /cannot be a member|circular/.test(message)
                ? "membership-cycle"
                : /grant options can only/.test(message)
                  ? "grant-options-target"
                  : /own grantor/.test(message)
                    ? "grantor-cycle"
                    : /ADMIN/.test(message)
                      ? "admin-option"
                      : /SET/.test(message)
                        ? "set-option"
                        : /INHERIT/.test(message)
                          ? "inherit-option"
                          : "other";
        LocalTlsClient.events.push(
          `db:error-${error?.code ?? "none"}-${error?.routine ?? "unknown"}-` +
          `${error?.position ?? "unknown"}-${category}`
        );
        throw error;
      }
    }
  }
  return LocalTlsClient;
}

const firstMigrationSql = await readFile(
  new URL("../migrations/001_app_attest.sql", import.meta.url),
  "utf8"
);

async function createAuthorization() {
  const root = process.env.TRAILMIND_PHASE1_V2_ADAPTER_AUTH_ROOT;
  const authorizationStoreDirectory = join(root, "consumed");
  await mkdir(authorizationStoreDirectory, { mode: 0o700 }).catch(
    (error) => { if (error?.code !== "EEXIST") throw error; }
  );
  const runId = randomUUID();
  const authorizationId = randomUUID();
  const authPath = join(root, `${authorizationId}.json`);
  const passwordPath = join(root, `${authorizationId}.password`);
  await writeFile(passwordPath, PASSWORD, { mode: 0o600 });
  const passwordFd = openSync(passwordPath, "r");
  unlinkSync(passwordPath);
  const ca = await readFile(caPath);
  const connection = {
    address: "2606:4700:4700::1111",
    host: STAGING_PHASE1_V2_DIRECT_HOST,
    port: 5432,
    user: "postgres",
    database: "postgres"
  };
  await writeFile(authPath, JSON.stringify({
    schemaVersion: 1,
    authorizationId,
    singleUse: true,
    issuedAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    projectRef: PROJECT,
    policyId: POLICY,
    runId,
    candidateCommit: candidate,
    connection,
    dataApiExposedSchemas: ["public", "graphql_public"],
    authorizationStoreDirectorySha256: sha256(
      realpathSync(authorizationStoreDirectory)
    ),
    caSha256: sha256(ca),
    providerAclRestorePlanDigest: expectedProviderDigest,
    operatorDigests: bindings.operatorDigests
  }), { mode: 0o600 });
  return {
    enabled: true,
    projectRef: PROJECT,
    policyId: POLICY,
    runId,
    candidateCommit: candidate,
    providerAclRestorePlanDigest: expectedProviderDigest,
    connection,
    dataApiExposedSchemas: ["public", "graphql_public"],
    authorizationEnvelopePath: authPath,
    authorizationStoreDirectory,
    passwordFd,
    caPath
  };
}

function testGitInspection() {
  return () => ({
    baselineReachable: true,
    clean: true,
    head: candidate,
    root: realpathSync(new URL("../..", import.meta.url))
  });
}

function controlPlane(events, failPostAdvisors) {
  return {
    async inspectPre() {
      events.push("control:pre");
      return controlSnapshot();
    },
    async inspectPostAdvisors() {
      events.push("control:post-advisors");
      if (failPostAdvisors) throw new Error("test-only advisor failure");
      return phase("post-ddl-advisors", 8, "acceptable", {
        observedAt: new Date().toISOString(),
        security: advisor("8"),
        performance: advisor("9")
      }, "8");
    },
    async inspectFinal() {
      events.push("control:final");
      return controlSnapshot();
    }
  };
}

function controlSnapshot() {
  const observedAt = new Date().toISOString();
  return {
    observedAt,
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
      observedAt
    },
    advisors: {
      security: { status: "completed", blockingFindingCount: 0, observedAt },
      performance: { status: "completed", blockingFindingCount: 0, observedAt }
    },
    expectedDatabaseAclDigest: expectedAclDigest,
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
    featureFlags: Object.fromEntries(FEATURE_FLAGS.map((name) => [name, false]))
  };
}

async function readSharedAcl(client) {
  const result = await client.query(`
    WITH shared_object AS (
      SELECT 'database'::text AS object_kind, datname AS object_name,
             datdba AS owner_oid, datacl AS object_acl, 'd'::"char" AS acl_kind
        FROM pg_catalog.pg_database
       WHERE datname = pg_catalog.current_database()
      UNION ALL
      SELECT 'schema', nspname, nspowner, nspacl, 'n'::"char"
        FROM pg_catalog.pg_namespace
       WHERE nspname IN ('public', 'extensions')
    )
    SELECT object_kind, object_name,
           pg_catalog.pg_get_userbyid(owner_oid) AS owner_name,
           object_acl::text AS raw_acl,
           COALESCE((
             SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                 ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
               'grantor', pg_catalog.pg_get_userbyid(acl.grantor),
               'privilege', acl.privilege_type,
               'grantable', acl.is_grantable
             ) ORDER BY acl.grantee, acl.grantor, acl.privilege_type,
                        acl.is_grantable)
               FROM pg_catalog.aclexplode(COALESCE(
                 object_acl, pg_catalog.acldefault(acl_kind, owner_oid)
               )) acl
           ), '[]'::jsonb) AS semantic_acl
      FROM shared_object
     ORDER BY object_kind, object_name
  `);
  return result.rows;
}

async function readProviderPlan(client) {
  const result = await client.query(`
    WITH preserved AS (
      SELECT rolname FROM pg_catalog.pg_roles
       WHERE rolname <> ALL($1::text[])
    ), privilege(object_kind, object_name, privilege_name) AS (
      VALUES
        ('database', pg_catalog.current_database(), 'CONNECT'),
        ('database', pg_catalog.current_database(), 'CREATE'),
        ('database', pg_catalog.current_database(), 'TEMPORARY'),
        ('schema', 'public', 'USAGE'),
        ('schema', 'public', 'CREATE'),
        ('schema', 'extensions', 'USAGE'),
        ('schema', 'extensions', 'CREATE')
    )
    SELECT preserved.rolname AS principal_name,
           privilege.object_kind, privilege.object_name,
           privilege.privilege_name,
           CASE privilege.object_kind
             WHEN 'database' THEN pg_catalog.has_database_privilege(
               preserved.rolname, privilege.object_name,
               privilege.privilege_name
             )
             ELSE pg_catalog.has_schema_privilege(
               preserved.rolname, privilege.object_name,
               privilege.privilege_name
             )
           END AS effective
      FROM preserved CROSS JOIN privilege
     ORDER BY preserved.rolname, privilege.object_kind,
              privilege.object_name, privilege.privilege_name
  `, [TRAILMIND_ROLES]);
  return result.rows;
}

async function withHeldFoundationLock(operation) {
  const holder = new pg.Client({
    host: socketHost, port: socketPort, user: "supabase_admin",
    database: "postgres"
  });
  await holder.connect();
  try {
    await holder.query(
      "SELECT pg_catalog.pg_advisory_lock(pg_catalog.hashtextextended($1, 0))",
      ["trailmind-phase-1-foundation"]
    );
    await operation();
  } finally {
    await holder.end();
  }
}

async function withHeldTableLock(operation) {
  const holder = new pg.Client({
    host: socketHost, port: socketPort, user: "supabase_admin",
    database: "postgres"
  });
  await holder.connect();
  try {
    await holder.query("BEGIN");
    await holder.query(
      "LOCK TABLE public.phase1_v2_lock_fixture IN ACCESS EXCLUSIVE MODE"
    );
    await operation();
  } finally {
    await holder.query("ROLLBACK");
    await holder.end();
  }
}

async function assertLockReleased() {
  const result = await maintenance.query(`
    SELECT pg_catalog.pg_try_advisory_lock(
      pg_catalog.hashtextextended($1, 0)
    ) AS acquired
  `, ["trailmind-phase-1-foundation"]);
  assert.equal(result.rows[0].acquired, true);
  await maintenance.query(`
    SELECT pg_catalog.pg_advisory_unlock(
      pg_catalog.hashtextextended($1, 0)
    )
  `, ["trailmind-phase-1-foundation"]);
}

async function assertNoAdapterSessions() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await maintenance.query(`
      SELECT pg_catalog.count(*)::integer AS sessions
        FROM pg_catalog.pg_stat_activity
       WHERE application_name = $1
    `, [appName]);
    if (result.rows[0].sessions === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("adapter session leaked after bounded cleanup");
}

async function assertNoFoundation() {
  const result = await maintenance.query(`
    SELECT pg_catalog.to_regnamespace('trailmind_app') IS NULL AS no_app,
           pg_catalog.to_regnamespace('trailmind_phase1_guard') IS NULL
             AS no_guard,
           NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
                        WHERE rolname = 'migration_role') AS no_role,
           NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension
                        WHERE extname = 'postgis') AS no_postgis
  `);
  assert.deepEqual(result.rows[0], {
    no_app: true,
    no_guard: true,
    no_role: true,
    no_postgis: true
  });
  await assertNoAdapterSessions();
}

function fixedAdapterError(code) {
  return (error) => error?.code === code &&
    error.message === `trailmind_phase1_v2_adapter_failed:${code}` &&
    !/postgres(?:ql)?:\/\/|password|host|path|coordinate/i.test(error.message);
}

function advisor(digit) {
  return {
    status: "completed", blockingFindingCount: 0, noticeCount: 0,
    evidenceDigest: digit.repeat(64)
  };
}

function phase(name, ordinal, status, fields, digit) {
  return { phase: name, ordinal, status, evidenceDigest: digit.repeat(64), ...fields };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const TRAILMIND_ROLES = [
  "trailmind_app_owner", "trailmind_control_owner", "platform_provisioner",
  "migration_role", "regional_import_role", "projection_role",
  "app_security_runtime_role", "outdoor_research_runtime_role",
  "outdoor_research_cancellation_control_role", "pruner_role",
  "readonly_auditor_role"
];
const RUNTIME_FUNCTIONS = [
  "trailmind_runtime_outdoor_research_snapshot_context_v1",
  "trailmind_runtime_outdoor_research_highlights_v1",
  "trailmind_runtime_outdoor_research_route_memberships_v1",
  "trailmind_runtime_outdoor_research_route_assertions_v1",
  "trailmind_runtime_outdoor_research_trail_access_candidates_v1"
];
const FEATURE_FLAGS = [
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
