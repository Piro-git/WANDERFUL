import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { openSync, realpathSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import {
  admitStagingPhase1V2Session,
  readStagingPhase1V2CandidateBindings,
  STAGING_PHASE1_V2_DIRECT_HOST,
  STAGING_PHASE1_V2_LIVE_BOUNDARY_PACKAGE_VERSION
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
const candidateTree = process.env.TRAILMIND_PHASE1_V2_ADAPTER_CANDIDATE_TREE;
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
    assert.match(candidateTree, /^[a-f0-9]{40}$/);
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

  if (mode === "regression") it(
    "regresses the former non-superuser SQLSTATE 0LP01 grant failure",
    async () => {
    await proveFormerGrantFailsWith0LP01();
  });

  if (mode === "success") it(
    "proves one PID, outer lock, first apply, true no-op and lock release",
    async () => {
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

  if (mode === "privileges") it(
    "proves bounded import schemas and least-privilege denials",
    async () => {
      const events = [];
      let completed;
      try {
        completed = await runOperator({ events });
      } catch (error) {
        assert.fail(
          `adapter ${error?.code ?? "unknown"}; phases=${events.join(",")}`
        );
      }
      assert.equal(completed.receipt.status, "committed");
      await proveBoundedImportPrivileges();
      await assertLockReleased();
      await assertNoAdapterSessions();
    }
  );

  if (mode === "restart") it(
    "proves authorization crash consumption without database mutation",
    async () => {
      const request = await createAuthorization();
      const admission = admitStagingPhase1V2Session(request, {
        env: {}, now: () => new Date(), gitInspection: testGitInspection()
      });
      admission.dispose();
      assert.throws(() => admitStagingPhase1V2Session(request, {
        env: {}, now: () => new Date(), gitInspection: testGitInspection()
      }));
      await assertNoFoundation();
      await assertLockReleased();
    }
  );

  if (mode === "restart") it(
    "rejects stale recovery bindings then compensates a crashed pre-step",
    async () => {
      const crashedBinding = await simulateCrashAfterPreStep();
      await maintenance.query(`
        UPDATE trailmind_phase1_guard.recovery_binding
           SET candidate_tree = $1
      `, ["0".repeat(40)]);
      await assert.rejects(
        runOperator({ events: [] }),
        (error) => ["unknown", "operator_rejected"].includes(error?.code) &&
          error?.outcome?.status !== "compensated"
      );
      const stillPresent = await maintenance.query(`
        SELECT pg_catalog.to_regnamespace('trailmind_phase1_guard') IS NOT NULL
          AS present
      `);
      assert.equal(stillPresent.rows[0].present, true);
      await maintenance.query(`
        UPDATE trailmind_phase1_guard.recovery_binding
           SET candidate_tree = $1
      `, [crashedBinding.candidateTree]);

      await assert.rejects(
        runOperator({ events: [] }),
        (error) => error?.code === "operator_rejected" &&
          error?.outcome?.status === "compensated"
      );
      await assertNoFoundation();
      await assertLockReleased();

      const events = [];
      const completed = await runOperator({ events });
      assert.equal(completed.receipt.status, "committed");
      assert.equal(events.filter((event) => event === "receipt:persist").length, 1);
      await assertLockReleased();
      await assertNoAdapterSessions();
    }
  );

  if (mode === "compensation") it(
    "proves transaction rollback plus exact pre-ledger compensation",
    async () => {
    const events = [];
    try {
      await runOperator({ events, clientMode: "fail-migration" });
      assert.fail("controlled migration failure unexpectedly succeeded");
    } catch (error) {
      if (!(fixedAdapterError("database_rejected")(error) &&
            error?.outcome?.status === "compensated")) {
        assert.fail(
          `adapter ${error?.code ?? "unknown"}; phases=${events.join(",")}`
        );
      }
    }
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

  if (mode === "containment") it(
    "proves bounded post-commit containment without publication",
    async () => {
    const events = [];
    let failure;
    try {
      await runOperator({ events, failPostAdvisors: true });
      assert.fail("post-advisor failure unexpectedly succeeded");
    } catch (error) {
      failure = error;
    }
    assert.equal(
      fixedAdapterError("control_plane_rejected")(failure),
      true
    );
    assert.equal(failure?.outcome?.status, "contained");
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

  if (mode === "failures") it(
    "proves conflict, server cancellation and disconnect cleanup",
    async () => {
    await withHeldFoundationLock(async () => {
      await assert.rejects(runOperator({ events: [] }),
        fixedAdapterError("operator_rejected"));
    });
    await assertNoFoundation();

    await assert.rejects(
      runOperator({
        events: [],
        clientMode: "statement-timeout"
      }),
      fixedAdapterError("statement_timeout")
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
      async proveSessionClosed(request) {
        events.push("cleanup:prove");
        const result = await maintenance.query(`
          SELECT pg_catalog.count(*)::integer AS backend_session_count,
                 pg_catalog.count(*) FILTER (
                   WHERE state = 'idle'
                 )::integer AS idle_session_count
            FROM pg_catalog.pg_stat_activity
           WHERE application_name = $1
        `, [appName]);
        const proof = {
          applicationName: request.applicationName,
          authorizationBindingDigest: request.authorizationBindingDigest,
          backendPid: request.backendPid,
          backendSessionCount: result.rows[0].backend_session_count,
          candidateCommit: request.candidateCommit,
          candidateTree: request.candidateTree,
          completionState: "session-closed",
          idleSessionCount: result.rows[0].idle_session_count,
          observedAt: new Date().toISOString(),
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
          persistedAt: new Date().toISOString(),
          phase: "sanitized-durable-receipt",
          projectRef: payload.projectRef,
          receiptBytes: payload.receiptBytes,
          receiptDigest: payload.receiptDigest,
          runId: payload.runId,
          status: "persisted"
        };
        return {
          ...persistence,
          evidenceDigest: canonicalAclDigest(persistence)
        };
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

async function simulateCrashAfterPreStep() {
  const request = await createAuthorization();
  const admission = admitStagingPhase1V2Session(request, {
    env: {}, now: () => new Date(), gitInspection: testGitInspection()
  });
  const client = new pg.Client({
    host: socketHost,
    port: socketPort,
    user: "postgres",
    database: "postgres"
  });
  try {
    await client.connect();
    await client.query(
      "SELECT pg_catalog.pg_advisory_lock(pg_catalog.hashtextextended($1, 0))",
      ["trailmind-phase-1-foundation"]
    );
    await client.query(
      `SELECT pg_catalog.set_config(
                'trailmind.phase1_v2_run_id', $1, false
              ),
              pg_catalog.set_config(
                'trailmind.phase1_v2_authorization_binding_digest', $2, false
              ),
              pg_catalog.set_config(
                'trailmind.phase1_v2_candidate_commit', $3, false
              ),
              pg_catalog.set_config(
                'trailmind.phase1_v2_candidate_tree', $4, false
              ),
              pg_catalog.set_config(
                'trailmind.phase1_v2_operator_digests_digest', $5, false
              ),
              pg_catalog.set_config(
                'trailmind.phase1_v2_provider_acl_restore_plan_digest',
                $6, false
              )`,
      [
        admission.runId,
        admission.authorizationBindingDigest,
        admission.candidateCommit,
        admission.candidateTree,
        canonicalAclDigest(admission.operatorDigests),
        admission.providerAclRestorePlanDigest
      ]
    );
    await client.query(admission.operatorSql.preMigration);
    return { candidateTree: admission.candidateTree };
  } finally {
    admission.dispose();
    await client.end();
  }
}

async function proveBoundedImportPrivileges() {
  const regional = new pg.Client({
    host: socketHost, port: socketPort, user: "regional_import_role",
    database: "postgres"
  });
  const concurrent = new pg.Client({
    host: socketHost, port: socketPort, user: "regional_import_role",
    database: "postgres"
  });
  await regional.connect();
  await concurrent.connect();
  try {
    await expectSqlState(regional.query("CREATE SCHEMA arbitrary_import"), "42501");
    await expectSqlState(
      regional.query("CREATE SCHEMA outdoor_import_not_a_uuid"), "42501"
    );
    await expectSqlState(
      regional.query("CREATE TABLE trailmind_app.import_escape(value integer)"),
      "42501"
    );
    await expectSqlState(
      regional.query("ALTER ROLE regional_import_role BYPASSRLS"), "42501"
    );
    await expectSqlState(
      regional.query("CREATE ROLE regional_import_escalation"), "42501"
    );
    await expectSqlState(
      regional.query(
        "GRANT trailmind_import_schema_owner TO regional_import_role"
      ),
      "42501"
    );
    await expectSqlState(
      regional.query("SET ROLE trailmind_import_schema_owner"), "42501"
    );
    await expectSqlState(
      regional.query("SELECT extensions.fixture_extension_routine()"), "42501"
    );
    await expectSqlState(
      regional.query(`
        SELECT trailmind_control.cancel_active_outdoor_research_backend_integer(
          pg_catalog.pg_backend_pid()
        )
      `),
      "42501"
    );

    await maintenance.query(`
      CREATE TABLE fixture.regional_rls_probe(value integer);
      ALTER TABLE fixture.regional_rls_probe ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA fixture TO regional_import_role;
      GRANT SELECT ON fixture.regional_rls_probe TO regional_import_role;
      INSERT INTO fixture.regional_rls_probe VALUES (1)
    `);
    const hidden = await regional.query(
      "SELECT value FROM fixture.regional_rls_probe"
    );
    assert.equal(hidden.rowCount, 0);
    await regional.query("SET row_security = off");
    await expectSqlState(
      regional.query("SELECT value FROM fixture.regional_rls_probe"), "42501"
    );
    await regional.query("RESET row_security");

    const firstRun = randomUUID();
    const firstLease = randomUUID();
    const secondRun = randomUUID();
    const secondLease = randomUUID();
    const thirdRun = randomUUID();
    const thirdLease = randomUUID();
    await insertLoadingRun(regional, firstRun, "proof-region-1");
    await insertLoadingRun(regional, secondRun, "proof-region-2");
    await insertLoadingRun(regional, thirdRun, "proof-region-3");

    const firstSchema = canonicalImportSchema(firstRun);
    const provisioned = await regional.query(`
      SELECT trailmind_app.provision_outdoor_import_schema_v1(
        $1::uuid, $2::uuid
      ) AS schema_name
    `, [firstRun, firstLease]);
    assert.equal(provisioned.rows[0].schema_name, firstSchema);
    const replay = await regional.query(`
      SELECT trailmind_app.provision_outdoor_import_schema_v1(
        $1::uuid, $2::uuid
      ) AS schema_name
    `, [firstRun, firstLease]);
    assert.equal(replay.rows[0].schema_name, firstSchema);
    await expectSqlState(regional.query(`
      SELECT trailmind_app.provision_outdoor_import_schema_v1(
        $1::uuid, $2::uuid
      )
    `, [firstRun, randomUUID()]), "42501");
    await expectSqlState(regional.query(`
      SELECT trailmind_app.provision_outdoor_import_schema_v1(
        $1::uuid, $2::uuid
      )
    `, [secondRun, secondLease]), "55P03");
    await expectSqlState(regional.query(`
      SELECT trailmind_app.release_outdoor_import_schema_v1(
        $1::uuid, $2::uuid
      )
    `, [secondRun, firstLease]), "42501");
    await expectSqlState(regional.query(`
      SELECT trailmind_app.provision_outdoor_import_schema_v1(
        $1::uuid, $2::uuid
      )
    `, ["not-a-uuid'; DROP SCHEMA trailmind_app; --", firstLease]), "22P02");

    await regional.query(
      `CREATE TABLE "${firstSchema}".raw_probe(value integer)`
    );
    await regional.query(
      `INSERT INTO "${firstSchema}".raw_probe VALUES (1)`
    );
    const raw = await regional.query(
      `SELECT value FROM "${firstSchema}".raw_probe`
    );
    assert.deepEqual(raw.rows, [{ value: 1 }]);
    await expectSqlState(
      regional.query(`DROP SCHEMA "${firstSchema}" CASCADE`), "42501"
    );
    const released = await regional.query(`
      SELECT trailmind_app.release_outdoor_import_schema_v1(
        $1::uuid, $2::uuid
      ) AS released
    `, [firstRun, firstLease]);
    assert.equal(released.rows[0].released, true);
    const releasedReplay = await regional.query(`
      SELECT trailmind_app.release_outdoor_import_schema_v1(
        $1::uuid, $2::uuid
      ) AS released
    `, [firstRun, firstLease]);
    assert.equal(releasedReplay.rows[0].released, false);
    await expectSqlState(regional.query(`
      SELECT trailmind_app.provision_outdoor_import_schema_v1(
        $1::uuid, $2::uuid
      )
    `, [firstRun, firstLease]), "55000");

    const attempts = await Promise.allSettled([
      regional.query(`
        SELECT trailmind_app.provision_outdoor_import_schema_v1(
          $1::uuid, $2::uuid
        ) AS schema_name
      `, [secondRun, secondLease]),
      concurrent.query(`
        SELECT trailmind_app.provision_outdoor_import_schema_v1(
          $1::uuid, $2::uuid
        ) AS schema_name
      `, [thirdRun, thirdLease])
    ]);
    const winnerIndex = attempts.findIndex(({ status }) => status === "fulfilled");
    const loserIndex = attempts.findIndex(({ status }) => status === "rejected");
    assert.notEqual(winnerIndex, -1);
    assert.notEqual(loserIndex, -1);
    assert.equal(attempts[loserIndex].reason?.code, "55P03");
    const winners = [
      [secondRun, secondLease],
      [thirdRun, thirdLease]
    ];
    const [winnerRun, winnerLease] = winners[winnerIndex];
    const [loserRun, loserLease] = winners[loserIndex];
    await expectSqlState(regional.query(`
      SELECT trailmind_app.release_outdoor_import_schema_v1(
        $1::uuid, $2::uuid
      )
    `, [loserRun, winnerLease]), "42501");
    const winnerRelease = await regional.query(`
      SELECT trailmind_app.release_outdoor_import_schema_v1(
        $1::uuid, $2::uuid
      ) AS released
    `, [winnerRun, winnerLease]);
    assert.equal(winnerRelease.rows[0].released, true);
    const loserProvision = await regional.query(`
      SELECT trailmind_app.provision_outdoor_import_schema_v1(
        $1::uuid, $2::uuid
      ) AS schema_name
    `, [loserRun, loserLease]);
    assert.equal(loserProvision.rows[0].schema_name,
      canonicalImportSchema(loserRun));
    const loserRelease = await regional.query(`
      SELECT trailmind_app.release_outdoor_import_schema_v1(
        $1::uuid, $2::uuid
      ) AS released
    `, [loserRun, loserLease]);
    assert.equal(loserRelease.rows[0].released, true);

    const cleanup = await maintenance.query(`
      SELECT (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_namespace
               WHERE nspname ~ '^outdoor_import_') AS schema_count,
             (SELECT pg_catalog.count(*)::integer
                FROM trailmind_app.outdoor_import_schema_leases
               WHERE state = 'active') AS active_lease_count
    `);
    assert.deepEqual(cleanup.rows[0], {
      schema_count: 0,
      active_lease_count: 0
    });
    const contract = await maintenance.query(`
      SELECT NOT rolcreatedb AND NOT rolcreaterole AND NOT rolsuper
               AND NOT rolreplication AND NOT rolbypassrls AS exact_attributes,
             NOT pg_catalog.has_database_privilege(
               'regional_import_role', pg_catalog.current_database(), 'CREATE'
             ) AS no_database_create,
             NOT EXISTS (
               SELECT 1 FROM pg_catalog.pg_auth_members membership
                WHERE membership.member = role_record.oid
             ) AS no_outgoing_memberships
        FROM pg_catalog.pg_roles role_record
       WHERE rolname = 'regional_import_role'
    `);
    assert.deepEqual(contract.rows[0], {
      exact_attributes: true,
      no_database_create: true,
      no_outgoing_memberships: true
    });
  } finally {
    await regional.end();
    await concurrent.end();
    await maintenance.query("DROP TABLE IF EXISTS fixture.regional_rls_probe");
    await maintenance.query("REVOKE USAGE ON SCHEMA fixture FROM regional_import_role");
  }
}

async function insertLoadingRun(client, importId, regionId) {
  await client.query(`
    INSERT INTO trailmind_app.outdoor_evidence_regions (
      region_id, name, definition_version, boundary_kind,
      coordinate_reference_system, metric_srid, boundary, boundary_metric,
      supported_feature_classes, freshness_threshold_days,
      path_match_tolerance_meters
    ) VALUES (
      $1, $1, 1, 'trailmind-operational-polygon', 'EPSG:4326', 3857,
      trailmind_gis.ST_Multi(trailmind_gis.ST_GeomFromText(
        'POLYGON((0 0,0 1,1 1,1 0,0 0))', 4326
      )),
      trailmind_gis.ST_Multi(trailmind_gis.ST_Transform(
        trailmind_gis.ST_GeomFromText(
          'POLYGON((0 0,0 1,1 1,1 0,0 0))', 4326
        ), 3857
      )),
      ARRAY['trail_segment'], 30, 25
    )
  `, [regionId]);
  await client.query(`
    INSERT INTO trailmind_app.outdoor_evidence_imports (
      import_id, region_id, source_dataset_name, source_identifier,
      retrieved_at, tool_version, import_schema_version, status
    ) VALUES ($2, $1, 'proof', 'proof', pg_catalog.clock_timestamp(),
              'proof-1', 1, 'loading')
  `, [regionId, importId]);
}

function canonicalImportSchema(runId) {
  return `outdoor_import_${runId.replaceAll("-", "_")}`;
}

async function expectSqlState(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
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
      if (
        LocalTlsClient.mode === "fail-migration" &&
        sql === firstMigrationSql
      ) {
        await super.query("SET trailmind.fixture_fail_ddl = 'on'");
      }
      if (
        LocalTlsClient.mode === "statement-timeout" &&
        sql.includes("phase1-v2:pre-snapshot")
      ) {
        return super.query(
          "SET statement_timeout = '100ms'; SELECT pg_catalog.pg_sleep(10)"
        );
      }
      if (
        LocalTlsClient.mode === "disconnect" &&
        sql.includes("phase1-v2:pre-snapshot")
      ) this.connection.stream.destroy();
      try {
        const result = await super.query(sql, values);
        if (sql.includes("WITH RECURSIVE migration AS")) {
          const failed = Object.entries(result.rows[0] ?? {})
            .filter(([, value]) => value !== true)
            .map(([name]) => name);
          if (failed.length > 0) {
            LocalTlsClient.events.push(
              `db:migration-operator-invalid-${failed.join("+")}`
            );
          }
        }
        if (sql.includes("phase1-v2:final-snapshot")) {
          const row = result.rows[0] ?? {};
          const failed = [
            "regional_import_no_database_create",
            "import_schema_owner_bounded_database_create",
            "bounded_import_provisioning_contract",
            "app_attest_admission",
            "outdoor_runtime_admission",
            "cancellation_admission"
          ].filter((name) => row[name] !== true);
          const nonzero = [
            "gis_unexpected_create_principal_count",
            "public_postgis_routine_count",
            "runtime_direct_table_privilege_count",
            "runtime_direct_postgis_routine_count",
            "runtime_direct_shared_routine_count",
            "sibling_writer_session_count"
          ].filter((name) => row[name] !== 0);
          if (failed.length + nonzero.length > 0) {
            LocalTlsClient.events.push(
              `db:final-invalid-${[...failed, ...nonzero].join("+")}`
            );
          }
        }
        return result;
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
          `${error?.position ?? "unknown"}-${category}-` +
          `${safeCatalogName(error?.schema)}-${safeCatalogName(error?.table)}-` +
          `${safePermissionTarget(message)}-${safeWhereLine(error?.where)}-` +
          `${safeAclOperation(error?.internalQuery)}`
        );
        throw error;
      }
    }
  }
  return LocalTlsClient;
}

function safeCatalogName(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,62}$/.test(value)
    ? value
    : "none";
}

function safePermissionTarget(value) {
  const match = /^permission denied for (database|function|schema|sequence|table) ([a-z][a-z0-9_]{0,62})$/.exec(value);
  return match ? `${match[1]}_${match[2]}` : "none";
}

function safeWhereLine(value) {
  const match = /line ([1-9][0-9]{0,3})/.exec(value ?? "");
  return match ? `line_${match[1]}` : "none";
}

function safeAclOperation(value) {
  const sql = typeof value === "string" ? value : "";
  if (/^REVOKE ALL ON TABLE /.test(sql)) return "revoke_table";
  if (/^REVOKE EXECUTE ON FUNCTION /.test(sql)) return "revoke_function";
  if (/^GRANT /.test(sql)) return "grant";
  if (/^CREATE POLICY /.test(sql)) return "create_policy";
  return "none";
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
  const attemptId = randomUUID();
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
    attemptId,
    authorizationId,
    singleUse: true,
    issuedAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    projectRef: PROJECT,
    policyId: POLICY,
    runId,
    candidateCommit: candidate,
    candidateTree,
    connection,
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
    providerAclRestorePlanDigest: expectedProviderDigest,
    operatorDigests: bindings.operatorDigests
  }), { mode: 0o600 });
  return {
    enabled: true,
    attemptId,
    projectRef: PROJECT,
    policyId: POLICY,
    runId,
    candidateCommit: candidate,
    candidateTree,
    providerAclRestorePlanDigest: expectedProviderDigest,
    connection,
    controlObservationDigest: "c".repeat(64),
    endpointClass: "direct",
    gitAttestation: bindings.gitAttestation,
    target: targetBinding(),
    tls: tlsBinding(),
    credentialContainment: credentialContainment(),
    liveBoundaryPackageVersion:
      STAGING_PHASE1_V2_LIVE_BOUNDARY_PACKAGE_VERSION,
    dataApiExposedSchemas: ["public", "graphql_public"],
    authorizationEnvelopePath: authPath,
    authorizationStoreDirectory,
    passwordFd,
    caPath
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

function testGitInspection() {
  return () => ({
    baselineReachable: true,
    clean: true,
    head: candidate,
    root: realpathSync(new URL("../..", import.meta.url)),
    tree: candidateTree
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
           NOT EXISTS (
             SELECT 1 FROM pg_catalog.pg_roles
              WHERE rolname = ANY($1::text[])
           ) AS no_roles,
           NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension
                        WHERE extname = 'postgis') AS no_postgis
  `, [TRAILMIND_ROLES]);
  assert.deepEqual(result.rows[0], {
    no_app: true,
    no_guard: true,
    no_roles: true,
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
  "trailmind_app_owner", "trailmind_control_owner",
  "trailmind_import_schema_owner", "platform_provisioner", "migration_role",
  "regional_import_role", "projection_role",
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
