import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import pg from "pg";
import {
  deriveStagingPhase1V2DatabaseRunBinding,
  validateStagingPhase1V2AuditorContract,
  validateStagingPhase1V2CleanupSamples,
  validateStagingPhase1V2TargetSession
} from "../src/operations/stagingPhase1V2ProductionObserverContract.js";
import {
  stagingPhase1V2ProductionAuditorStatement,
  STAGING_PHASE1_V2_PRODUCTION_AUDITOR_SESSION_SETUP
} from "../src/operations/stagingPhase1V2ProductionAuditor.js";

const enabled = process.env
  .TRAILMIND_PHASE1_V2_PRODUCTION_AUDITOR_POSTGRES_INTEGRATION === "true";

describe("production observer auditor on disposable PostgreSQL 17", {
  skip: enabled ? false : "use the dedicated disposable PostgreSQL 17 runner"
}, () => {
  it("proves exact least privilege, run binding, TLS and two-sample cleanup", async () => {
    const ca = await readFile(process.env
      .TRAILMIND_PHASE1_V2_PRODUCTION_AUDITOR_CA_PATH);
    const connection = {
      host: "127.0.0.1",
      port: Number(process.env
        .TRAILMIND_PHASE1_V2_PRODUCTION_AUDITOR_PORT),
      database: "postgres",
      ssl: { ca, rejectUnauthorized: true }
    };
    const run = deriveStagingPhase1V2DatabaseRunBinding({
      authorizationBindingDigest: "7".repeat(64),
      candidateCommit: "b59f432a1947154345f1629ecba50d14fcb1e7c8",
      projectRef: "mbvzwsrtqcrwhvykugcd",
      runId: "22222222-2222-4222-8222-222222222222"
    });
    const mutator = new pg.Client({
      ...connection,
      application_name: run.applicationName,
      user: "postgres"
    });
    const primaryAuditorApplicationName =
      `trailmind_p1v2_auditor_${randomUUID().replaceAll("-", "")}`;
    let auditor = new pg.Client({
      ...connection,
      application_name: primaryAuditorApplicationName,
      user: "trailmind_phase1_v2_stats_auditor"
    });
    const admin = new pg.Client({
      ...connection,
      application_name: "trailmind_p1v2_test_admin",
      user: "trailmind_test_admin"
    });
    let sibling;
    try {
      await mutator.connect();
      await auditor.connect();
      await admin.connect();
      for (const statement of STAGING_PHASE1_V2_PRODUCTION_AUDITOR_SESSION_SETUP) {
        await auditor.query(statement);
      }
      const identity = (await auditor.query(
        stagingPhase1V2ProductionAuditorStatement("auditor_identity_v1")
      )).rows[0];
      const membership = (await auditor.query(
        stagingPhase1V2ProductionAuditorStatement("auditor_membership_v1")
      )).rows;
      const tls = (await auditor.query(
        stagingPhase1V2ProductionAuditorStatement("auditor_tls_v1")
      )).rows[0];
      const acl = (await auditor.query(
        stagingPhase1V2ProductionAuditorStatement("database_acl_v1")
      )).rows[0];
      assert.equal(identity.current_user_name,
        "trailmind_phase1_v2_stats_auditor");
      assert.equal(acl.current_role,
        "trailmind_phase1_v2_stats_auditor");
      assert.equal(acl.may_set_stats_role, true);
      assert.equal(acl.no_pg_monitor, true);
      assert.equal(acl.no_pg_read_all_settings, true);
      assert.equal(acl.no_pg_read_all_data, true);
      assert.equal(acl.no_pg_write_all_data, true);
      assert.equal(acl.can_connect, true);
      assert.equal(acl.no_database_create, true);
      assert.equal(acl.no_database_temporary, true);
      assert.equal(acl.no_owned_objects, true);
      assert.equal(acl.no_trailmind_data_access, true);
      assert.equal(acl.no_trailmind_routine_access, true);
      const auditorEvidence = {
        databaseName: identity.database_name,
        defaults: {
          defaultTransactionReadOnly: identity.transaction_read_only,
          searchPath: identity.search_path,
          statementTimeout: identity.statement_timeout,
          lockTimeout: identity.lock_timeout,
          idleInTransactionSessionTimeout: identity.idle_timeout
        },
        forbiddenAccess: {
          databaseCreate: !acl.no_database_create,
          databaseTemporary: !acl.no_database_temporary,
          genericSql: false,
          ownedObjects: !acl.no_owned_objects,
          pgMonitor: !acl.no_pg_monitor,
          pgReadAllData: !acl.no_pg_read_all_data,
          pgReadAllSettings: !acl.no_pg_read_all_settings,
          pgWriteAllData: !acl.no_pg_write_all_data,
          productData: !acl.no_trailmind_data_access,
          productRoutineExecute: !acl.no_trailmind_routine_access,
          schemaCreate: !acl.no_trailmind_data_access
        },
        memberships: membership.map((row) => ({
          role: row.granted_role,
          inherit: row.inherit_option,
          set: row.set_option,
          admin: row.admin_option
        })),
        role: identity.current_user_name,
        roleAttributes: {
          bypassrls: identity.rolbypassrls,
          canLogin: identity.rolcanlogin,
          connectionLimit: identity.rolconnlimit,
          credentialUnexpired: identity.credential_unexpired,
          createdb: identity.rolcreatedb,
          createrole: identity.rolcreaterole,
          inherit: identity.rolinherit,
          replication: identity.rolreplication,
          superuser: identity.rolsuper
        },
        sessionUserName: identity.session_user_name,
        tls: { active: tls.ssl, version: tls.version }
      };
      assert.deepEqual(validateStagingPhase1V2AuditorContract(auditorEvidence), {
        accepted: true,
        role: "trailmind_phase1_v2_stats_auditor"
      });

      await auditor.query("SET LOCAL ROLE pg_read_all_stats");
      await auditor.query("SET LOCAL stats_fetch_consistency = 'none'");
      await auditor.query("SELECT pg_catalog.pg_stat_clear_snapshot()");
      const discovered = (await auditor.query(
        stagingPhase1V2ProductionAuditorStatement(
          "target_session_discovery_v1"
        ), [mutator.processID, run.applicationName]
      )).rows[0];
      const counts = (await auditor.query(
        stagingPhase1V2ProductionAuditorStatement("target_session_v1"),
        [mutator.processID, run.applicationName, discovered.backend_start]
      )).rows[0];
      const expected = {
        applicationName: run.applicationName,
        backendPid: mutator.processID,
        backendStart: discovered.backend_start
      };
      const observedTarget = {
        ...expected,
        backendType: discovered.backend_type,
        databaseName: discovered.datname,
        databaseUser: discovered.usename,
        exactBackendInstanceCount: counts.exact_backend_instance_count,
        idleExactInstanceCount: counts.idle_exact_instance_count,
        matchingApplicationCount: counts.matching_application_count,
        samePidOtherInstanceCount: counts.same_pid_other_instance_count,
        tls: discovered.ssl
      };
      assert.deepEqual(observedTarget, {
        ...expected,
        backendType: "client backend",
        databaseName: "postgres",
        databaseUser: "postgres",
        exactBackendInstanceCount: 1,
        idleExactInstanceCount: 1,
        matchingApplicationCount: 1,
        samePidOtherInstanceCount: 0,
        tls: true
      });
      assert.deepEqual(validateStagingPhase1V2TargetSession(
        observedTarget, expected
      ), { accepted: true });

      await auditor.query("ROLLBACK");

      await auditor.query("BEGIN TRANSACTION READ ONLY");
      await assert.rejects(
        auditor.query("SELECT * FROM trailmind_app.private_route")
      );
      await auditor.query("ROLLBACK");
      await auditor.query("BEGIN TRANSACTION READ ONLY");
      await assert.rejects(
        auditor.query("CREATE TABLE public.auditor_escape(id integer)")
      );
      await auditor.query("ROLLBACK");

      sibling = new pg.Client({
        ...connection,
        application_name: run.applicationName,
        user: "postgres"
      });
      await sibling.connect();
      await auditor.query("BEGIN TRANSACTION READ ONLY");
      await auditor.query("SET LOCAL ROLE pg_read_all_stats");
      await auditor.query("SET LOCAL stats_fetch_consistency = 'none'");
      await auditor.query("SELECT pg_catalog.pg_stat_clear_snapshot()");
      const ambiguous = (await auditor.query(
        stagingPhase1V2ProductionAuditorStatement("target_session_v1"),
        [expected.backendPid, expected.applicationName,
          expected.backendStart]
      )).rows[0];
      assert.equal(ambiguous.matching_application_count, 2);
      assert.throws(() => validateStagingPhase1V2TargetSession({
        ...observedTarget,
        matchingApplicationCount: ambiguous.matching_application_count
      }, expected));
      await auditor.query("ROLLBACK");
      await sibling.end();
      sibling = undefined;

      await admin.query(
        "REVOKE pg_read_all_stats FROM " +
        "trailmind_phase1_v2_stats_auditor"
      );
      const missingMembership = (await auditor.query(
        stagingPhase1V2ProductionAuditorStatement("auditor_membership_v1")
      )).rows;
      assert.deepEqual(missingMembership, []);
      assert.throws(() => validateStagingPhase1V2AuditorContract({
        ...auditorEvidence,
        memberships: []
      }));
      await auditor.query("BEGIN TRANSACTION READ ONLY");
      await assert.rejects(auditor.query("SET LOCAL ROLE pg_read_all_stats"));
      await auditor.query("ROLLBACK");
      await admin.query(
        "GRANT pg_read_all_stats TO " +
        "trailmind_phase1_v2_stats_auditor " +
        "WITH INHERIT FALSE, SET TRUE, ADMIN FALSE"
      );

      await auditor.query("BEGIN TRANSACTION READ ONLY");
      await auditor.query("SET LOCAL ROLE pg_read_all_stats");
      await auditor.query("SET LOCAL stats_fetch_consistency = 'none'");
      await auditor.query("SELECT pg_catalog.pg_stat_clear_snapshot()");
      const stillActive = (await auditor.query(
        stagingPhase1V2ProductionAuditorStatement("target_session_v1"),
        [expected.backendPid, expected.applicationName,
          expected.backendStart]
      )).rows[0];
      assert.equal(stillActive.exact_backend_instance_count, 1);
      assert.throws(() => validateStagingPhase1V2CleanupSamples([
        cleanupSample(expected, identity, [{
          pid: expected.backendPid,
          application_name: expected.applicationName,
          backend_start: expected.backendStart,
          state: "idle"
        }]),
        cleanupSample(expected, identity, [{
          pid: expected.backendPid,
          application_name: expected.applicationName,
          backend_start: expected.backendStart,
          state: "idle"
        }])
      ], expected));
      await auditor.query("ROLLBACK");

      await mutator.end();
      await auditor.end();
      auditor = undefined;
      const samples = [];
      for (let index = 0; index < 2; index += 1) {
        const auditorApplicationName =
          `trailmind_p1v2_auditor_${randomUUID().replaceAll("-", "")}`;
        const cleanupAuditor = new pg.Client({
          ...connection,
          application_name: auditorApplicationName,
          user: "trailmind_phase1_v2_stats_auditor"
        });
        try {
          await cleanupAuditor.connect();
          for (const statement of
            STAGING_PHASE1_V2_PRODUCTION_AUDITOR_SESSION_SETUP) {
            await cleanupAuditor.query(statement);
          }
          const cleanupIdentity = (await cleanupAuditor.query(
            stagingPhase1V2ProductionAuditorStatement("auditor_identity_v1")
          )).rows[0];
          await cleanupAuditor.query("BEGIN TRANSACTION READ ONLY");
          await cleanupAuditor.query("SET LOCAL ROLE pg_read_all_stats");
          await cleanupAuditor.query(
            "SET LOCAL stats_fetch_consistency = 'none'"
          );
          await cleanupAuditor.query(
            "SELECT pg_catalog.pg_stat_clear_snapshot()"
          );
          const observedSessions = (await cleanupAuditor.query(
            stagingPhase1V2ProductionAuditorStatement("cleanup_sessions_v2"),
            [expected.backendPid, expected.applicationName,
              expected.backendStart, cleanupIdentity.backend_pid]
          )).rows;
          samples.push(cleanupSample(
            expected, cleanupIdentity, observedSessions
          ));
          await cleanupAuditor.query("ROLLBACK");
        } finally {
          await cleanupAuditor.end();
        }
        if (index === 0) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
      assert.equal(validateStagingPhase1V2CleanupSamples(samples, expected)
        .accepted, true);
    } finally {
      try { await sibling?.end(); } catch { /* bounded cleanup */ }
      try { await mutator.end(); } catch { /* already closed */ }
      try { await auditor?.end(); } catch { /* bounded cleanup */ }
      try { await admin.end(); } catch { /* bounded cleanup */ }
      ca.fill(0);
    }
  });
});

function cleanupSample(expected, auditorIdentity, observedSessions) {
  const observedAt = new Date().toISOString();
  const exactBackendInstanceCount = observedSessions.filter((session) =>
    session.pid === expected.backendPid &&
    session.application_name === expected.applicationName &&
    session.backend_start === expected.backendStart
  ).length;
  const matchingApplicationCount = observedSessions.filter((session) =>
    session.application_name === expected.applicationName
  ).length;
  const samePidOtherInstanceCount = observedSessions.filter((session) =>
    session.pid === expected.backendPid && (
      session.application_name !== expected.applicationName ||
      session.backend_start !== expected.backendStart
    )
  ).length;
  return {
    ...expected,
    auditorApplicationName: auditorIdentity.application_name,
    auditorBackendPid: auditorIdentity.backend_pid,
    auditorBackendStart: auditorIdentity.backend_start,
    auditorSelfExcluded: true,
    clearSnapshot: true,
    exactBackendInstanceCount,
    idleExactInstanceCount: observedSessions.filter((session) =>
      session.pid === expected.backendPid &&
      session.application_name === expected.applicationName &&
      session.backend_start === expected.backendStart &&
      ["idle", "idle in transaction", "idle in transaction (aborted)"]
        .includes(session.state)
    ).length,
    matchingApplicationCount,
    observedAt,
    observedSessions,
    samePidOtherInstanceCount,
    statsSnapshotId: randomUUID()
  };
}
