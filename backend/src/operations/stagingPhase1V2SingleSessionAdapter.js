import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, Socket } from "node:net";
import { checkServerIdentity } from "node:tls";
import pg from "pg";
import {
  admitStagingPhase1V2Session,
  STAGING_PHASE1_V2_APPLICATION_NAME,
  STAGING_PHASE1_V2_DIRECT_HOST,
  STAGING_PHASE1_V2_SESSION_HOST
} from "./stagingPhase1V2Admission.js";
import {
  canonicalAclDigest,
  runStagingPhase1V2Operator,
  STAGING_PHASE1_V2_LOCK_KEY,
  STAGING_PHASE1_V2_POLICY_ID,
  STAGING_PHASE1_V2_TARGET
} from "./stagingPhase1V2Operator.js";
import { runMigrationPolicy } from "./migrationRunner.js";
import {
  SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
} from "./stagingMigrationPolicy.js";

const { Client: NodePostgresClient } = pg;
class ChannelBindingRequiredClient extends NodePostgresClient {
  _handleAuthSASL(message) {
    super._handleAuthSASL(message);
    this.trailmindChannelBindingEstablished =
      this.saslSession?.mechanism === "SCRAM-SHA-256-PLUS";
  }
}
const CONNECT_TIMEOUT_MILLISECONDS = 10_000;
const STATEMENT_TIMEOUT_MILLISECONDS = 30_000;
const LOCK_TIMEOUT_MILLISECONDS = 5_000;
const IDLE_TRANSACTION_TIMEOUT_MILLISECONDS = 5_000;
const OVERALL_TIMEOUT_MILLISECONDS = 120_000;
const DNS_TIMEOUT_MILLISECONDS = 5_000;
const CLEANUP_TIMEOUT_MILLISECONDS = 5_000;
const LOCK_TOKEN = Symbol("trailmind-phase1-v2-session-lock");
const RUNTIME_FUNCTIONS = Object.freeze([
  "trailmind_runtime_outdoor_research_highlights_v1",
  "trailmind_runtime_outdoor_research_route_assertions_v1",
  "trailmind_runtime_outdoor_research_route_memberships_v1",
  "trailmind_runtime_outdoor_research_snapshot_context_v1",
  "trailmind_runtime_outdoor_research_trail_access_candidates_v1"
]);
const TRAILMIND_ROLES = Object.freeze([
  "app_security_runtime_role",
  "migration_role",
  "outdoor_research_cancellation_control_role",
  "outdoor_research_runtime_role",
  "platform_provisioner",
  "projection_role",
  "pruner_role",
  "readonly_auditor_role",
  "regional_import_role",
  "trailmind_app_owner",
  "trailmind_control_owner",
  "trailmind_import_schema_owner"
]);
const LOGIN_ROLES = new Set([
  "app_security_runtime_role",
  "outdoor_research_cancellation_control_role",
  "outdoor_research_runtime_role",
  "projection_role",
  "pruner_role",
  "readonly_auditor_role",
  "regional_import_role"
]);
const EXPECTED_ROLE_ROWS = Object.freeze(TRAILMIND_ROLES.map((rolname) =>
  Object.freeze({
    rolname,
    rolcanlogin: LOGIN_ROLES.has(rolname),
    rolinherit: rolname === "trailmind_control_owner",
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolbypassrls: false,
    rolconnlimit: rolname ===
      "outdoor_research_cancellation_control_role" ? 1 : -1
  })));
const EXPECTED_MEMBERSHIP_ROWS = Object.freeze([
  ["migration_role", "trailmind_app_owner", "postgres", false, true, false],
  ...TRAILMIND_ROLES.flatMap((target) => [
    ["postgres", target, "supabase_admin", false, false, true],
    ...[
      "migration_role", "trailmind_app_owner", "trailmind_control_owner",
      "trailmind_import_schema_owner"
    ].includes(target)
      ? [["postgres", target, "postgres", false, true, false]]
      : []
  ]),
  [
    "trailmind_control_owner", "pg_signal_backend", "postgres",
    true, false, false
  ]
].map(([
  member_name, target_name, grantor_name, inherit_option, set_option,
  admin_option
]) => Object.freeze({
  member_name, target_name, grantor_name, inherit_option, set_option,
  admin_option
})));
const SHARED_ACL_SQL = `
  /* trailmind:phase1-v2:shared-acl */
  WITH shared_object AS (
    SELECT 'database'::text AS object_kind,
           database_record.datname AS object_name,
           database_record.datdba AS owner_oid,
           database_record.datacl AS object_acl,
           'd'::"char" AS acl_kind
      FROM pg_catalog.pg_database database_record
     WHERE database_record.datname = pg_catalog.current_database()
    UNION ALL
    SELECT 'schema'::text,
           namespace.nspname,
           namespace.nspowner,
           namespace.nspacl,
           'n'::"char"
      FROM pg_catalog.pg_namespace namespace
     WHERE namespace.nspname IN ('public', 'extensions')
  )
  SELECT shared_object.object_kind,
         shared_object.object_name,
         pg_catalog.pg_get_userbyid(shared_object.owner_oid) AS owner_name,
         shared_object.object_acl::text AS raw_acl,
         COALESCE((
           SELECT pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'grantee', CASE WHEN privilege.grantee = 0 THEN 'PUBLIC'
                 ELSE pg_catalog.pg_get_userbyid(privilege.grantee) END,
               'grantor', pg_catalog.pg_get_userbyid(privilege.grantor),
               'privilege', privilege.privilege_type,
               'grantable', privilege.is_grantable
             ) ORDER BY privilege.grantee, privilege.grantor,
                        privilege.privilege_type, privilege.is_grantable
           )
             FROM pg_catalog.aclexplode(COALESCE(
               shared_object.object_acl,
               pg_catalog.acldefault(
                 shared_object.acl_kind, shared_object.owner_oid
               )
             )) privilege
         ), '[]'::jsonb) AS semantic_acl
    FROM shared_object
   ORDER BY shared_object.object_kind, shared_object.object_name
`;
const PROVIDER_ACL_SQL = `
  /* trailmind:phase1-v2:provider-acl-plan */
  WITH preserved_principal AS (
    SELECT role_record.rolname
      FROM pg_catalog.pg_roles role_record
     WHERE role_record.rolname <> ALL($1::text[])
  ), expected_privilege(object_kind, object_name, privilege_name) AS (
    VALUES
      ('database', pg_catalog.current_database(), 'CONNECT'),
      ('database', pg_catalog.current_database(), 'CREATE'),
      ('database', pg_catalog.current_database(), 'TEMPORARY'),
      ('schema', 'public', 'USAGE'),
      ('schema', 'public', 'CREATE'),
      ('schema', 'extensions', 'USAGE'),
      ('schema', 'extensions', 'CREATE')
  )
  SELECT principal.rolname AS principal_name,
         privilege.object_kind,
         privilege.object_name,
         privilege.privilege_name,
         CASE privilege.object_kind
           WHEN 'database' THEN pg_catalog.has_database_privilege(
             principal.rolname, privilege.object_name, privilege.privilege_name
           )
           ELSE pg_catalog.has_schema_privilege(
             principal.rolname, privilege.object_name, privilege.privilege_name
           )
         END AS effective
    FROM preserved_principal principal
   CROSS JOIN expected_privilege privilege
   ORDER BY principal.rolname, privilege.object_kind,
            privilege.object_name, privilege.privilege_name
`;

export class StagingPhase1V2AdapterError extends Error {
  constructor(code, status = "unknown") {
    super(`trailmind_phase1_v2_adapter_failed:${code}`);
    this.name = "StagingPhase1V2AdapterError";
    this.code = code;
    this.outcome = Object.freeze({ code, status });
  }
}

export async function runAuthorizedStagingPhase1V2SingleSession({
  admissionRequest,
  cleanupVerifier,
  containmentControl,
  controlPlane,
  receiptStore
}, dependencies = {}) {
  if (admissionRequest?.enabled !== true) {
    throw adapterFailure("admission_rejected");
  }
  requireBoundary(controlPlane, [
    "inspectPre", "inspectPostAdvisors", "inspectFinal"
  ], "control_plane");
  requireBoundary(containmentControl, ["assertAllDisabled"], "containment");
  requireBoundary(cleanupVerifier, ["proveSessionClosed"], "cleanup_verifier");
  requireBoundary(receiptStore, ["persist"], "receipt_store");
  const overallTimeoutMilliseconds = boundedTestTimeout(
    dependencies.overallTimeoutMilliseconds,
    OVERALL_TIMEOUT_MILLISECONDS
  );

  let admission;
  let secrets;
  let session;
  let cleanupComplete = false;
  try {
    admission = admitStagingPhase1V2Session(
      admissionRequest,
      dependencies.admission
    );
    await boundedDnsAdmission(
      admission.connection.host,
      admission.connection.address,
      dependencies.lookup
    );
    secrets = admission.takeSecrets();
    const Client = dependencies.Client ?? ChannelBindingRequiredClient;
    let client;
    try {
      client = new Client({
        user: admission.connection.user,
        password: secrets.password,
        host: admission.connection.host,
        port: admission.connection.port,
        database: admission.connection.database,
        ssl: {
          ca: secrets.ca,
          rejectUnauthorized: true,
          servername: admission.connection.host,
          minVersion: "TLSv1.2"
        },
        enableChannelBinding: true,
        application_name: STAGING_PHASE1_V2_APPLICATION_NAME,
        connectionTimeoutMillis: CONNECT_TIMEOUT_MILLISECONDS,
        statement_timeout: STATEMENT_TIMEOUT_MILLISECONDS,
        lock_timeout: LOCK_TIMEOUT_MILLISECONDS,
        idle_in_transaction_session_timeout:
          IDLE_TRANSACTION_TIMEOUT_MILLISECONDS,
        keepAlive: true,
        keepAliveInitialDelayMillis: 5_000,
        stream: dependencies.createPinnedSocket
          ? dependencies.createPinnedSocket(admission.connection.address)
          : new PinnedAddressSocket(admission.connection.address)
      });
    } catch {
      throw adapterFailure("client_configuration");
    }
    session = createSession({
      admission,
      client,
      containmentControl,
      controlPlane,
      receiptStore,
      now: dependencies.now ?? (() => new Date())
    });
    const operation = session.run();
    const staged = await raceOverallTimeout(
      operation,
      session,
      overallTimeoutMilliseconds
    );
    const result = await session.finalize({
      staged,
      cleanupVerifier,
      receiptStore
    });
    cleanupComplete = true;
    return result;
  } catch (error) {
    throw sanitizeFailure(error, session?.failureCode());
  } finally {
    if (!cleanupComplete) await session?.cleanup();
    admission?.dispose();
    secrets?.ca?.fill(0);
  }
}

export function createStagingPhase1V2SingleSessionDependencies({
  admission,
  client,
  containmentControl,
  controlPlane,
  receiptStore,
  now = () => new Date()
}) {
  requireBoundary(controlPlane, [
    "inspectPre", "inspectPostAdvisors", "inspectFinal"
  ], "control_plane");
  requireBoundary(containmentControl, ["assertAllDisabled"], "containment");
  requireBoundary(receiptStore, ["persist"], "receipt_store");
  return createSession({
    admission,
    client,
    containmentControl,
    controlPlane,
    receiptStore,
    now
  });
}

function createSession({
  admission,
  client,
  containmentControl,
  controlPlane,
  receiptStore,
  now
}) {
  let connected = false;
  let ended = false;
  let abortCode;
  let backendPid;
  let activeLock;
  let initialSharedAclDigest;
  let lastFailureCode;
  let stagedReceipt;
  const boundaryAbort = new AbortController();
  const operatorDigestsDigest = canonicalAclDigest(admission.operatorDigests);
  client.on?.("error", () => abort("connection_lost"));

  async function run() {
    return runStagingPhase1V2Operator({
      controlPlane: wrappedControlPlane(),
      database: databaseAdapter(),
      executor: executorAdapter(),
      containment: containmentAdapter(),
      receiptStore: wrappedReceiptStore(),
      approval: {
        authorizationBindingDigest: admission.authorizationBindingDigest,
        candidateCommit: admission.candidateCommit,
        candidateTree: admission.candidateTree,
        operatorDigestsDigest,
        providerAclRestorePlanDigest:
          admission.providerAclRestorePlanDigest,
        runId: admission.runId
      },
      now
    });
  }

  function wrappedControlPlane() {
    return {
      async inspectPre(request) {
        assertActive();
        return callBoundary("control_plane", () =>
          controlPlane.inspectPre(request, { signal: boundaryAbort.signal }));
      },
      async inspectPostAdvisors(request) {
        await attestLocked(request.lock);
        return callBoundary("control_plane", () =>
          controlPlane.inspectPostAdvisors(request, {
            signal: boundaryAbort.signal
          }));
      },
      async inspectFinal(request) {
        await attestLocked(request.lock);
        return callBoundary("control_plane", () =>
          controlPlane.inspectFinal(request, { signal: boundaryAbort.signal }));
      }
    };
  }

  function databaseAdapter() {
    return {
      async inspectPre({ stage, lock }) {
        await ensureConnected();
        if (stage === "locked") await attestLocked(lock);
        else await attestSession(false);
        const snapshot = await inspectPreSnapshot();
        if (stage === "locked") await attestLocked(lock);
        return snapshot;
      },
      async withFoundationLock({ key, wait }, operation) {
        if (key !== STAGING_PHASE1_V2_LOCK_KEY || wait !== false) {
          throw adapterFailure("lock_contract");
        }
        await ensureConnected();
        await attestSession(false);
        const result = await query(
          `/* trailmind:phase1-v2:outer-lock */
           SELECT pg_catalog.pg_try_advisory_lock(
             pg_catalog.hashtextextended($1, 0)
           ) AS acquired`,
          [key]
        );
        if (result.rowCount !== 1 || result.rows[0].acquired !== true) {
          return operation(Object.freeze({ acquired: false }));
        }
        activeLock = Object.freeze({
          [LOCK_TOKEN]: true,
          acquired: true,
          backendPid,
          key
        });
        try {
          await attestLocked(activeLock);
          return await operation(activeLock);
        } finally {
          if (!abortCode && connected && !ended) {
            await attestLocked(activeLock);
            const unlocked = await query(
              `/* trailmind:phase1-v2:outer-unlock */
               SELECT pg_catalog.pg_advisory_unlock(
                 pg_catalog.hashtextextended($1, 0)
               ) AS unlocked`,
              [key]
            );
            if (unlocked.rowCount !== 1 || unlocked.rows[0].unlocked !== true) {
              abort("lock_release_unknown");
              throw adapterFailure("lock_release_unknown");
            }
          }
          activeLock = undefined;
        }
      },
      async inspectFailure({ lock }) {
        await attestLocked(lock);
        const state = await inspectFailureState();
        await attestLocked(lock);
        return state;
      },
      async inspectFinal({ lock }) {
        await attestLocked(lock);
        const snapshot = await inspectFinalSnapshot();
        await attestLocked(lock);
        return snapshot;
      }
    };
  }

  function executorAdapter() {
    return {
      async commitPreStep({ lock }) {
        await attestLocked(lock);
        await query(
          `SELECT pg_catalog.set_config(
                    'trailmind.phase1_v2_run_id', $1, false
                  ),
                  pg_catalog.set_config(
                    'trailmind.phase1_v2_authorization_binding_digest',
                    $2, false
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
            operatorDigestsDigest,
            admission.providerAclRestorePlanDigest
          ]
        );
        await transactionScript(admission.operatorSql.preMigration);
        await attestLocked(lock);
        const state = await inspectFailureState();
        return evidence("v2-pre-step", 4, "committed", {
          applicationLedgerExists: state.applicationLedgerExists,
          applicationMigrationCount: state.applicationMigrationCount,
          applicationFoundationExists: state.applicationFoundationExists
        });
      },
      async runMigrations({
        lock,
        migrations,
        operatorContext,
        policyId,
        runKind
      }) {
        await attestLocked(lock);
        if (
          policyId !== STAGING_PHASE1_V2_POLICY_ID ||
          !exactArray(migrations, SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2) ||
          !["apply", "verify-noop"].includes(runKind)
        ) throw adapterFailure("migration_contract");
        let appliedMigrations;
        try {
          appliedMigrations = await runMigrationPolicy({
            client: Object.freeze({ query }),
            admittedMigrations: admission.admittedMigrations,
            migrationPolicy: Object.freeze({
              policyId,
              migrations: SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
            }),
            operatorContext,
            migrationPurpose: runKind,
            now
          });
        } catch (error) {
          if (error instanceof StagingPhase1V2AdapterError) throw error;
          const code = /operator_context/.test(error?.message ?? "")
            ? "migration_capability_rejected"
            : error?.code === "ENOENT"
              ? "candidate_file_missing"
              : "migration_runner_rejected";
          throw recordFailure(code);
        }
        await attestLocked(lock);
        const ledger = await readLedger();
        const stdoutBytes = runKind === "apply"
          ? appliedMigrations.reduce((total, name) =>
            total + Buffer.byteLength(`Applied ${name}\n`, "utf8"), 0)
          : 0;
        return evidence(
          runKind === "apply" ? "first-migration-run" : "second-migration-run",
          runKind === "apply" ? 5 : 6,
          runKind === "apply" ? "committed" : "no-op",
          { appliedMigrations: [...appliedMigrations], ledger, stdoutBytes }
        );
      },
      async commitPostStep({ lock }) {
        await attestLocked(lock);
        await transactionScript(admission.operatorSql.postMigration);
        await attestLocked(lock);
        const ledger = await readLedger();
        const runtimeFunctions = await readRuntimeFunctions();
        return evidence("v2-post-step", 7, "committed", {
          ledgerMigrationCount: ledger.length,
          runtimeFunctionCount: runtimeFunctions.length
        });
      },
      async compensatePreLedger({
        lock,
        recoveryRunId,
        recoveryAuthorizationBindingDigest
      }) {
        await attestLocked(lock);
        if (
          typeof recoveryRunId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            .test(recoveryRunId) ||
          typeof recoveryAuthorizationBindingDigest !== "string" ||
          !/^[0-9a-f]{64}$/.test(recoveryAuthorizationBindingDigest)
        ) throw adapterFailure("recovery_binding");
        await query(
          `SELECT pg_catalog.set_config($1, $2, false),
                  pg_catalog.set_config(
                    'trailmind.phase_1_v2_recovery_run_id',
                    $3, false
                  ),
                  pg_catalog.set_config(
                    'trailmind.phase_1_v2_recovery_authorization_binding_digest',
                    $4, false
                  ),
                  pg_catalog.set_config(
                    'trailmind.phase_1_v2_recovery_candidate_commit',
                    $5, false
                  ),
                  pg_catalog.set_config(
                    'trailmind.phase_1_v2_recovery_candidate_tree',
                    $6, false
                  ),
                  pg_catalog.set_config(
                    'trailmind.phase_1_v2_recovery_operator_digests_digest',
                    $7, false
                  ),
                  pg_catalog.set_config(
                    'trailmind.phase_1_v2_recovery_provider_acl_digest',
                    $8, false
                  )`,
          [
            "trailmind.phase_1_v2_rollback_confirmation",
            `${STAGING_PHASE1_V2_TARGET.projectRef}:pre-only`,
            recoveryRunId,
            recoveryAuthorizationBindingDigest,
            admission.candidateCommit,
            admission.candidateTree,
            operatorDigestsDigest,
            admission.providerAclRestorePlanDigest
          ]
        );
        await transactionScript(admission.operatorSql.preLedgerRollback);
        await attestLocked(lock);
        const state = await inspectFailureState();
        const sharedAcl = await readSharedAcl();
        return evidence("v2-pre-ledger-compensation", 0, "compensated", {
          exactAclRestored:
            canonicalAclDigest(sharedAcl) === initialSharedAclDigest,
          providerFixturePreserved: true,
          applicationLedgerExists: state.applicationLedgerExists,
          applicationFoundationExists: state.applicationFoundationExists
        });
      }
    };
  }

  function containmentAdapter() {
    return {
      async securePostCommitFailure({ lock, targetRuntimeRole }) {
        if (targetRuntimeRole !== "outdoor_research_runtime_role") {
          throw adapterFailure("containment_contract");
        }
        await attestLocked(lock);
        const contained = await containRuntime();
        const control = await callBoundary("containment", () =>
          containmentControl.assertAllDisabled({
            projectRef: admission.projectRef,
            runId: admission.runId,
            readOnly: true
          }, { signal: boundaryAbort.signal }));
        if (
          !isExactObject(control, [
            "deployFlagsAllFalse",
            "importFlagsAllFalse",
            "providerFlagsAllFalse"
          ]) ||
          Object.values(control).some((value) => value !== true)
        ) throw adapterFailure("containment_control_unknown");
        await attestLocked(lock);
        return evidence("post-commit-containment", 0, "contained", {
          runtimeExecuteRevoked: contained.runtimeExecuteRevoked,
          affectedRuntimeSessionsTerminatedCount:
            contained.affectedRuntimeSessionsTerminatedCount,
          nonRuntimeSessionsTerminatedCount: 0,
          providerFlagsAllFalse: true,
          importFlagsAllFalse: true,
          deployFlagsAllFalse: true,
          evidencePreserved: true,
          compensationAttempted: false,
          rollbackAttempted: false,
          forwardFixRequired: true
        });
      }
    };
  }

  function wrappedReceiptStore() {
    return {
      async stage(payload) {
        await attestLocked(activeLock);
        assertActive();
        if (stagedReceipt !== undefined) {
          throw adapterFailure("receipt_staging_reused");
        }
        stagedReceipt = Object.freeze({ ...payload });
        return evidence(
          "sanitized-terminal-receipt-staging",
          10,
          "staged",
          {
            receiptDigest: payload.receiptDigest,
            receiptBytes: payload.receiptBytes
          }
        );
      }
    };
  }

  async function ensureConnected() {
    assertActive();
    if (connected) return;
    try {
      await client.connect();
    } catch {
      abort("connect");
      throw adapterFailure("connect");
    }
    connected = true;
    assertTls(client, admission.connection);
    const identity = await query(`
      /* trailmind:phase1-v2:identity */
      SELECT pg_catalog.current_database() AS database_name,
             session_user,
             current_user,
             pg_catalog.pg_backend_pid()::integer AS backend_pid,
             current_setting('server_version_num')::integer
               AS server_version_num,
             current_setting('shared_preload_libraries')
               AS shared_preload_libraries,
             current_setting('supautils.privileged_role', true)
               AS supautils_privileged_role,
             current_setting('supautils.superuser', true)
               AS supautils_superuser,
             current_setting(
               'supautils.privileged_extensions_superuser', true
             ) AS supautils_legacy_superuser,
             current_setting('supautils.privileged_extensions', true)
               AS supautils_privileged_extensions,
             current_setting('is_superuser') AS is_superuser,
             role_record.rolcanlogin,
             role_record.rolsuper,
             role_record.rolcreatedb,
             role_record.rolcreaterole,
             role_record.rolreplication,
             role_record.rolbypassrls,
             pg_catalog.pg_has_role(
               current_user, 'pg_read_all_settings', 'USAGE'
             ) AS can_read_all_settings,
             (SELECT managed_admin.rolsuper
                FROM pg_catalog.pg_roles managed_admin
               WHERE managed_admin.rolname = 'supabase_admin')
               AS supabase_admin_superuser,
             NOT pg_catalog.pg_has_role(
               'postgres', 'supabase_admin', 'SET'
             ) AS postgres_cannot_set_supabase_admin
        FROM pg_catalog.pg_roles role_record
       WHERE role_record.rolname = current_user
    `);
    if (
      identity.rowCount !== 1 ||
      identity.rows[0].database_name !== "postgres" ||
      identity.rows[0].session_user !== "postgres" ||
      identity.rows[0].current_user !== "postgres" ||
      Math.trunc(identity.rows[0].server_version_num / 10_000) !== 17 ||
      !settingListIncludes(
        identity.rows[0].shared_preload_libraries, "supautils"
      ) ||
      identity.rows[0].supautils_privileged_role !== "postgres" ||
      ![
        identity.rows[0].supautils_superuser,
        identity.rows[0].supautils_legacy_superuser
      ].includes("supabase_admin") ||
      !settingListIncludes(
        identity.rows[0].supautils_privileged_extensions, "postgis"
      ) ||
      identity.rows[0].is_superuser !== "off" ||
      identity.rows[0].rolcanlogin !== true ||
      identity.rows[0].rolsuper !== false ||
      identity.rows[0].rolcreatedb !== true ||
      identity.rows[0].rolcreaterole !== true ||
      identity.rows[0].rolreplication !== false ||
      identity.rows[0].rolbypassrls !== false ||
      identity.rows[0].can_read_all_settings !== true ||
      identity.rows[0].supabase_admin_superuser !== true ||
      identity.rows[0].postgres_cannot_set_supabase_admin !== true ||
      !Number.isInteger(identity.rows[0].backend_pid) ||
      identity.rows[0].backend_pid <= 0 ||
      !Number.isInteger(client.processID) || client.processID <= 0 ||
      client.processID !== identity.rows[0].backend_pid
    ) {
      abort("identity");
      throw adapterFailure("identity");
    }
    backendPid = identity.rows[0].backend_pid;
    await query(
      `/* trailmind:phase1-v2:timeouts */
       SELECT pg_catalog.set_config('statement_timeout', $1, false),
              pg_catalog.set_config('lock_timeout', $2, false),
              pg_catalog.set_config(
                'idle_in_transaction_session_timeout', $3, false
              ),
              pg_catalog.set_config('transaction_timeout', $4, false)`,
      [
        `${STATEMENT_TIMEOUT_MILLISECONDS}ms`,
        `${LOCK_TIMEOUT_MILLISECONDS}ms`,
        `${IDLE_TRANSACTION_TIMEOUT_MILLISECONDS}ms`,
        `${STATEMENT_TIMEOUT_MILLISECONDS + 5_000}ms`
      ]
    );
    await attestSession(false);
  }

  async function attestSession(requireLock) {
    assertActive();
    assertTls(client, admission.connection);
    const attestation = await query(`
      /* trailmind:phase1-v2:session-attestation */
      SELECT pg_catalog.pg_backend_pid()::integer AS backend_pid,
             pg_catalog.current_database() AS database_name,
             session_user,
             current_user,
             current_setting('application_name') AS application_name,
             current_setting('is_superuser') AS is_superuser,
             current_setting('statement_timeout') AS statement_timeout,
             current_setting('lock_timeout') AS lock_timeout,
             current_setting('idle_in_transaction_session_timeout')
               AS idle_transaction_timeout,
             current_setting('transaction_timeout') AS transaction_timeout,
             role_record.rolcanlogin,
             role_record.rolsuper,
             role_record.rolcreaterole,
             role_record.rolreplication,
             role_record.rolbypassrls,
             EXISTS (
               SELECT 1
                 FROM pg_catalog.pg_locks held
                WHERE held.pid = pg_catalog.pg_backend_pid()
                  AND held.locktype = 'advisory'
                  AND held.granted
                  AND held.objsubid = 1
                  AND held.classid = (
                    (pg_catalog.hashtextextended($1, 0) >> 32)
                    & 4294967295
                  )::oid
                  AND held.objid = (
                    pg_catalog.hashtextextended($1, 0) & 4294967295
                  )::oid
             ) AS foundation_lock_held
        FROM pg_catalog.pg_roles role_record
       WHERE role_record.rolname = current_user
    `, [STAGING_PHASE1_V2_LOCK_KEY]);
    const row = attestation.rows[0] ?? {};
    if (
      attestation.rowCount !== 1 ||
      !Number.isInteger(client.processID) || client.processID !== backendPid ||
      row.backend_pid !== backendPid ||
      row.database_name !== "postgres" ||
      row.session_user !== "postgres" ||
      row.current_user !== "postgres" ||
      row.application_name !== STAGING_PHASE1_V2_APPLICATION_NAME ||
      row.is_superuser !== "off" ||
      row.rolcanlogin !== true ||
      row.rolsuper !== false ||
      row.rolcreaterole !== true ||
      row.rolreplication !== false ||
      row.rolbypassrls !== false ||
      !timeoutEquals(row.statement_timeout, STATEMENT_TIMEOUT_MILLISECONDS) ||
      !timeoutEquals(row.lock_timeout, LOCK_TIMEOUT_MILLISECONDS) ||
      !timeoutEquals(
        row.idle_transaction_timeout,
        IDLE_TRANSACTION_TIMEOUT_MILLISECONDS
      ) ||
      !timeoutEquals(
        row.transaction_timeout,
        STATEMENT_TIMEOUT_MILLISECONDS + 5_000
      ) ||
      (requireLock && row.foundation_lock_held !== true)
    ) {
      abort("session_attestation");
      throw adapterFailure("session_attestation");
    }
  }

  async function attestLocked(lock) {
    assertLock(lock);
    await attestSession(true);
  }

  function assertLock(lock) {
    if (
      !lock ||
      lock !== activeLock ||
      lock[LOCK_TOKEN] !== true ||
      lock.backendPid !== backendPid ||
      lock.key !== STAGING_PHASE1_V2_LOCK_KEY
    ) throw adapterFailure("lock_attestation");
  }

  async function inspectPreSnapshot() {
    const topologyResult = await query(`
      /* trailmind:phase1-v2:pre-snapshot */
      SELECT pg_catalog.current_database() AS database_name,
             session_user,
             current_user,
             pg_catalog.pg_get_userbyid(database_record.datdba)
               AS database_owner,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_roles role_record
               WHERE role_record.rolname = ANY($1::text[]))
               AS trailmind_role_count,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_namespace namespace
               WHERE namespace.nspname = ANY($2::text[]))
               AS trailmind_schema_count,
             (SELECT pg_catalog.count(*)::integer
                FROM (
                  SELECT relation.oid
                    FROM pg_catalog.pg_class relation
                    JOIN pg_catalog.pg_namespace namespace
                      ON namespace.oid = relation.relnamespace
                   WHERE namespace.nspname = ANY($2::text[])
                  UNION ALL
                  SELECT procedure.oid
                    FROM pg_catalog.pg_proc procedure
                    JOIN pg_catalog.pg_namespace namespace
                      ON namespace.oid = procedure.pronamespace
                   WHERE namespace.nspname = ANY($2::text[])
                ) object_record) AS trailmind_object_count,
             EXISTS (SELECT 1 FROM pg_catalog.pg_extension
                      WHERE extname = 'postgis') AS postgis_installed,
             pg_catalog.to_regnamespace('trailmind_phase1_guard') IS NOT NULL
               AS recovery_guard_exists,
             EXISTS (
               SELECT 1
                 FROM pg_catalog.pg_class relation
                 JOIN pg_catalog.pg_namespace namespace
                   ON namespace.oid = relation.relnamespace
                WHERE namespace.nspname = 'trailmind_app'
                  AND relation.relname = 'trailmind_schema_migrations'
             ) AS recovery_ledger_exists,
             EXISTS (
               SELECT 1
                 FROM pg_catalog.pg_class relation
                 JOIN pg_catalog.pg_namespace namespace
                   ON namespace.oid = relation.relnamespace
                WHERE namespace.nspname = 'trailmind_app'
                  AND relation.relname <> 'trailmind_schema_migrations'
             ) AS recovery_application_foundation_exists,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_proc procedure
                JOIN pg_catalog.pg_namespace namespace
                  ON namespace.oid = procedure.pronamespace
               WHERE namespace.nspname = 'public'
                 AND procedure.proname LIKE 'st_%')
               AS public_postgis_routine_count,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_stat_activity activity
               WHERE activity.datname = pg_catalog.current_database()
                 AND activity.pid <> pg_catalog.pg_backend_pid()
                 AND activity.application_name = $3)
               AS sibling_writer_session_count,
             (SELECT owner.rolname
                FROM pg_catalog.pg_namespace namespace
                JOIN pg_catalog.pg_roles owner ON owner.oid = namespace.nspowner
               WHERE namespace.nspname = 'extensions')
               AS extensions_schema_owner,
             pg_catalog.to_regnamespace('extensions') IS NOT NULL
               AS extensions_schema_exists,
             pg_catalog.has_schema_privilege('public', 'extensions', 'USAGE')
               AS extensions_public_usage,
             pg_catalog.has_schema_privilege('public', 'extensions', 'CREATE')
               AS extensions_public_create,
             role_record.rolcanlogin AND NOT role_record.rolsuper
               AND role_record.rolcreaterole
               AND NOT role_record.rolreplication
               AND NOT role_record.rolbypassrls
               AS shared_acl_mutation_authorized
        FROM pg_catalog.pg_database database_record
        JOIN pg_catalog.pg_roles role_record
          ON role_record.rolname = current_user
       WHERE database_record.datname = pg_catalog.current_database()
    `, [
      TRAILMIND_ROLES,
      ["trailmind_app", "trailmind_control", "trailmind_gis",
        "trailmind_phase1_guard"],
      STAGING_PHASE1_V2_APPLICATION_NAME
    ]);
    if (topologyResult.rowCount !== 1) throw adapterFailure("pre_snapshot");
    const topology = topologyResult.rows[0];
    const sharedAcl = await readSharedAcl();
    const providerPlan = await readProviderAclPlan();
    const databaseAclDigest = canonicalAclDigest(sharedAcl);
    const providerAclRestorePlanDigest = canonicalAclDigest(providerPlan);
    const recovery = await inspectRecoveryBinding(topology);
    initialSharedAclDigest ??= databaseAclDigest;
    return Object.freeze({
      projectRef: admission.projectRef,
      databaseName: topology.database_name,
      trailmindRoleCount: topology.trailmind_role_count,
      trailmindSchemaCount: topology.trailmind_schema_count,
      trailmindObjectCount: topology.trailmind_object_count,
      postgisInstalled: topology.postgis_installed,
      publicPostgisRoutineCount: topology.public_postgis_routine_count,
      siblingWriterSessionCount: topology.sibling_writer_session_count,
      sessionUser: topology.session_user,
      currentUser: topology.current_user,
      databaseOwner: topology.database_owner,
      extensionsSchemaOwner: topology.extensions_schema_owner,
      sharedAclMutationAuthorized: topology.shared_acl_mutation_authorized,
      extensionsSchemaExists: topology.extensions_schema_exists,
      extensionsPublicUsage: topology.extensions_public_usage,
      extensionsPublicCreate: topology.extensions_public_create,
      providerAclPrincipalCount: new Set(
        providerPlan.map(({ principal_name }) => principal_name)
      ).size,
      providerAclRestorePlanDigest,
      databaseAclDigest,
      stateDigest: canonicalAclDigest({
        topology: withoutVolatileIdentity(topology),
        sharedAcl,
        providerPlan,
        recovery
      }),
      dataApiExposedSchemas: [...admission.dataApiExposedSchemas],
      ...recovery
    });
  }

  async function inspectRecoveryBinding(topology) {
    if (topology.recovery_guard_exists !== true) {
      return Object.freeze({
        recoveryState: "pristine",
        recoveryAuthorizationBindingDigest: null,
        recoveryCandidateCommit: null,
        recoveryCandidateTree: null,
        recoveryOperatorDigestsDigest: null,
        recoveryProviderAclRestorePlanDigest: null,
        recoveryRunId: null
      });
    }
    const binding = await query(`
      SELECT run_id::text AS recovery_run_id,
             authorization_binding_digest
               AS recovery_authorization_binding_digest,
             candidate_commit AS recovery_candidate_commit,
             candidate_tree AS recovery_candidate_tree,
             operator_digests_digest AS recovery_operator_digests_digest,
             provider_acl_restore_plan_digest
               AS recovery_provider_acl_restore_plan_digest
        FROM trailmind_phase1_guard.recovery_binding
       WHERE singleton
    `);
    const row = binding.rows[0] ?? {};
    const state = binding.rowCount === 1 &&
      topology.recovery_ledger_exists === false &&
      topology.recovery_application_foundation_exists === false
      ? "pre-step-committed-no-ledger"
      : "unrecoverable";
    return Object.freeze({
      recoveryState: state,
      recoveryAuthorizationBindingDigest:
        row.recovery_authorization_binding_digest ?? null,
      recoveryCandidateCommit: row.recovery_candidate_commit ?? null,
      recoveryCandidateTree: row.recovery_candidate_tree ?? null,
      recoveryOperatorDigestsDigest:
        row.recovery_operator_digests_digest ?? null,
      recoveryProviderAclRestorePlanDigest:
        row.recovery_provider_acl_restore_plan_digest ?? null,
      recoveryRunId: row.recovery_run_id ?? null
    });
  }

  async function inspectFailureState() {
    const result = await query(`
      /* trailmind:phase1-v2:failure-state */
      SELECT pg_catalog.to_regnamespace('trailmind_phase1_guard') IS NOT NULL
               AS pre_step_committed,
             EXISTS (
               SELECT 1
                 FROM pg_catalog.pg_class relation
                 JOIN pg_catalog.pg_namespace namespace
                   ON namespace.oid = relation.relnamespace
                WHERE namespace.nspname = 'trailmind_app'
                  AND relation.relname = 'trailmind_schema_migrations'
             ) AS application_ledger_exists,
             EXISTS (
               SELECT 1
                 FROM pg_catalog.pg_class relation
                 JOIN pg_catalog.pg_namespace namespace
                   ON namespace.oid = relation.relnamespace
                WHERE namespace.nspname = 'trailmind_app'
                  AND relation.relname <> 'trailmind_schema_migrations'
             ) AS application_foundation_exists,
             pg_catalog.to_regnamespace('trailmind_phase1_guard') IS NULL
               AND EXISTS (
                 SELECT 1
                   FROM pg_catalog.pg_class relation
                   JOIN pg_catalog.pg_namespace namespace
                     ON namespace.oid = relation.relnamespace
                  WHERE namespace.nspname = 'trailmind_app'
                    AND relation.relname = 'trailmind_schema_migrations'
               ) AS post_step_committed
    `);
    if (result.rowCount !== 1) throw adapterFailure("failure_state");
    const row = result.rows[0];
    const applicationMigrationCount = row.application_ledger_exists
      ? (await readLedger()).length
      : 0;
    if (!Number.isInteger(applicationMigrationCount)) {
      throw adapterFailure("failure_state");
    }
    return evidence("failure-state-inspection", 0, "inspected", {
      preStepCommitted: row.pre_step_committed,
      applicationLedgerExists: row.application_ledger_exists,
      applicationMigrationCount,
      applicationFoundationExists: row.application_foundation_exists,
      postStepCommitted: row.post_step_committed
    });
  }

  async function inspectFinalSnapshot() {
    const ledger = await readLedger();
    const roleRows = (await query(`
        /* trailmind:phase1-v2:final-roles */
        SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb,
               rolcreaterole, rolreplication, rolbypassrls, rolconnlimit
          FROM pg_catalog.pg_roles
         WHERE rolname = ANY($1::text[])
         ORDER BY rolname
      `, [TRAILMIND_ROLES])).rows;
    const membershipRows = (await query(`
        /* trailmind:phase1-v2:final-memberships */
        SELECT member.rolname AS member_name,
               target.rolname AS target_name,
               grantor.rolname AS grantor_name,
               membership.inherit_option,
               membership.set_option,
               membership.admin_option
          FROM pg_catalog.pg_auth_members membership
          JOIN pg_catalog.pg_roles member ON member.oid = membership.member
          JOIN pg_catalog.pg_roles target ON target.oid = membership.roleid
          JOIN pg_catalog.pg_roles grantor ON grantor.oid = membership.grantor
         WHERE member.rolname = ANY($1::text[])
            OR target.rolname = ANY($1::text[])
         ORDER BY member.rolname, target.rolname, membership.set_option,
                  membership.admin_option, grantor.rolname
      `, [TRAILMIND_ROLES])).rows;
    const roleContractValid = sameRows(roleRows, EXPECTED_ROLE_ROWS) &&
      sameRows(membershipRows, EXPECTED_MEMBERSHIP_ROWS);
    const runtimeFunctions = await readRuntimeFunctions();
    const final = await query(`
      /* trailmind:phase1-v2:final-snapshot */
      SELECT pg_catalog.current_database() AS database_name,
             session_user,
             current_user,
             pg_catalog.pg_get_userbyid(database_record.datdba)
               AS database_owner,
             NOT pg_catalog.has_database_privilege(
               'regional_import_role', pg_catalog.current_database(), 'CREATE'
             ) AS regional_import_no_database_create,
             pg_catalog.has_database_privilege(
               'trailmind_import_schema_owner', pg_catalog.current_database(),
               'CREATE'
             ) AND NOT pg_catalog.has_database_privilege(
               'trailmind_import_schema_owner', pg_catalog.current_database(),
               'CREATE WITH GRANT OPTION'
             ) AS import_schema_owner_bounded_database_create,
             ((SELECT pg_catalog.count(*) = 2
                FROM pg_catalog.pg_proc procedure
                JOIN pg_catalog.pg_namespace namespace
                  ON namespace.oid = procedure.pronamespace
                 JOIN pg_catalog.pg_roles owner
                  ON owner.oid = procedure.proowner
               WHERE namespace.nspname = 'trailmind_app'
                 AND procedure.proname IN (
                   'provision_outdoor_import_schema_v1',
                   'release_outdoor_import_schema_v1'
                 )
                 AND pg_catalog.pg_get_function_identity_arguments(
                   procedure.oid
                 ) = 'requested_run_id uuid, requested_lease_id uuid'
                 AND owner.rolname = 'trailmind_import_schema_owner'
                 AND procedure.prosecdef
                 AND procedure.proisstrict
                 AND procedure.provolatile = 'v'
                 AND procedure.prokind = 'f'
                 AND NOT procedure.proleakproof
                 AND procedure.proparallel = 'u'
                 AND procedure.proconfig = ARRAY[
                   'search_path=pg_catalog, pg_temp'
                 ]::text[]
                 AND (
                   (procedure.proname =
                      'provision_outdoor_import_schema_v1'
                    AND procedure.prorettype = 'pg_catalog.text'::pg_catalog.regtype)
                   OR
                   (procedure.proname =
                      'release_outdoor_import_schema_v1'
                    AND procedure.prorettype = 'pg_catalog.bool'::pg_catalog.regtype)
                 )
                 AND pg_catalog.has_function_privilege(
                   'regional_import_role', procedure.oid, 'EXECUTE'
                 )
                 AND NOT pg_catalog.has_function_privilege(
                   'regional_import_role', procedure.oid,
                   'EXECUTE WITH GRANT OPTION'
                 )
                 AND NOT pg_catalog.has_function_privilege(
                   'public', procedure.oid, 'EXECUTE'
                 )
                 AND NOT pg_catalog.has_function_privilege(
                   'anon', procedure.oid, 'EXECUTE'
                 )
                 AND NOT pg_catalog.has_function_privilege(
                   'authenticated', procedure.oid, 'EXECUTE'
                 )
                 AND NOT pg_catalog.has_function_privilege(
                   'service_role', procedure.oid, 'EXECUTE'
                 ))
              AND EXISTS (
                SELECT 1
                  FROM pg_catalog.pg_class relation
                  JOIN pg_catalog.pg_namespace namespace
                    ON namespace.oid = relation.relnamespace
                  JOIN pg_catalog.pg_roles owner
                    ON owner.oid = relation.relowner
                 WHERE namespace.nspname = 'trailmind_app'
                   AND relation.relname = 'outdoor_import_schema_leases'
                   AND relation.relkind = 'r'
                   AND owner.rolname = 'trailmind_import_schema_owner'
                   AND relation.relrowsecurity
                   AND NOT relation.relforcerowsecurity
              )
              AND NOT EXISTS (
                SELECT 1
                  FROM pg_catalog.unnest(ARRAY[
                    'public', 'anon', 'authenticated', 'service_role',
                    'regional_import_role'
                  ]::text[]) principal(role_name)
                 CROSS JOIN pg_catalog.unnest(ARRAY[
                    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                    'REFERENCES', 'TRIGGER'
                  ]::text[]) privilege(privilege_name)
                 WHERE pg_catalog.has_table_privilege(
                   principal.role_name,
                   (
                     SELECT relation.oid
                       FROM pg_catalog.pg_class relation
                       JOIN pg_catalog.pg_namespace namespace
                         ON namespace.oid = relation.relnamespace
                      WHERE namespace.nspname = 'trailmind_app'
                        AND relation.relname =
                          'outdoor_import_schema_leases'
                        AND relation.relkind = 'r'
                   ),
                   privilege.privilege_name
                 )
              )) AS bounded_import_provisioning_contract,
             extension_namespace.nspname AS postgis_schema,
             CASE
               WHEN schema_owner.rolname = 'postgres'
                AND extension_owner.rolname = 'postgres'
                 THEN 'postgres-schema/postgres-extension-members'
               WHEN schema_owner.rolname = 'postgres'
                AND extension_owner.rolname = 'supabase_admin'
                 THEN 'postgres-schema/supabase_admin-extension-members'
             END AS postgis_owner_topology,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_roles candidate
               WHERE candidate.oid <> extension_namespace.nspowner
                 AND NOT candidate.rolsuper
                 AND pg_catalog.has_schema_privilege(
                   candidate.rolname, 'trailmind_gis', 'CREATE'
                 )) AS gis_unexpected_create_principal_count,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_proc procedure
                JOIN pg_catalog.pg_namespace namespace
                  ON namespace.oid = procedure.pronamespace
               WHERE namespace.nspname = 'public'
                 AND procedure.proname LIKE 'st_%')
               AS public_postgis_routine_count,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_class relation
                JOIN pg_catalog.pg_namespace namespace
                  ON namespace.oid = relation.relnamespace
               WHERE namespace.nspname = 'trailmind_app'
                 AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
                 AND (
                   pg_catalog.has_table_privilege(
                     'outdoor_research_runtime_role', relation.oid, 'SELECT'
                   ) OR pg_catalog.has_table_privilege(
                     'outdoor_research_runtime_role', relation.oid, 'INSERT'
                   ) OR pg_catalog.has_table_privilege(
                     'outdoor_research_runtime_role', relation.oid, 'UPDATE'
                   ) OR pg_catalog.has_table_privilege(
                     'outdoor_research_runtime_role', relation.oid, 'DELETE'
                   )
                 )) AS runtime_direct_table_privilege_count,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_proc procedure
                JOIN pg_catalog.pg_namespace namespace
                  ON namespace.oid = procedure.pronamespace
               WHERE namespace.nspname = 'trailmind_gis'
                 AND pg_catalog.has_schema_privilege(
                   'outdoor_research_runtime_role', namespace.oid, 'USAGE'
                 )
                 AND pg_catalog.has_function_privilege(
                   'outdoor_research_runtime_role', procedure.oid, 'EXECUTE'
                 )) AS runtime_direct_postgis_routine_count,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_proc procedure
                JOIN pg_catalog.pg_namespace namespace
                  ON namespace.oid = procedure.pronamespace
               WHERE namespace.nspname IN ('public', 'extensions')
                 AND pg_catalog.has_schema_privilege(
                   'outdoor_research_runtime_role', namespace.oid, 'USAGE'
                 )
                 AND pg_catalog.has_function_privilege(
                   'outdoor_research_runtime_role', procedure.oid, 'EXECUTE'
                 )) AS runtime_direct_shared_routine_count,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_stat_activity activity
               WHERE activity.datname = pg_catalog.current_database()
                 AND activity.pid <> pg_catalog.pg_backend_pid()
                 AND activity.application_name = $1)
               AS sibling_writer_session_count,
             EXISTS (
               SELECT 1 FROM pg_catalog.pg_roles
                WHERE rolname = 'app_security_runtime_role'
                  AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
             ) AS app_attest_admission,
             EXISTS (
               SELECT 1 FROM pg_catalog.pg_roles
                WHERE rolname = 'outdoor_research_runtime_role'
                  AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
             ) AS outdoor_runtime_admission,
             EXISTS (
               SELECT 1 FROM pg_catalog.pg_roles
                WHERE rolname = 'outdoor_research_cancellation_control_role'
                  AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
                  AND rolconnlimit = 1
             ) AS cancellation_admission
        FROM pg_catalog.pg_database database_record
        JOIN pg_catalog.pg_extension extension_record
          ON extension_record.extname = 'postgis'
        JOIN pg_catalog.pg_namespace extension_namespace
          ON extension_namespace.oid = extension_record.extnamespace
        JOIN pg_catalog.pg_roles schema_owner
          ON schema_owner.oid = extension_namespace.nspowner
        JOIN pg_catalog.pg_roles extension_owner
          ON extension_owner.oid = extension_record.extowner
       WHERE database_record.datname = pg_catalog.current_database()
    `, [STAGING_PHASE1_V2_APPLICATION_NAME]);
    if (final.rowCount !== 1) throw adapterFailure("final_snapshot");
    const row = final.rows[0];
    const sharedAcl = await readSharedAcl();
    const aclDigest = canonicalAclDigest(sharedAcl);
    const roleContractDigest = canonicalAclDigest({ roleRows, membershipRows });
    return Object.freeze({
      projectRef: admission.projectRef,
      databaseName: row.database_name,
      sessionUser: row.session_user,
      currentUser: row.current_user,
      databaseOwner: row.database_owner,
      stateDigest: canonicalAclDigest({
        aclDigest,
        ledger,
        roleContractDigest,
        runtimeFunctions
      }),
      policyId: admission.policyId,
      ledger,
      roleContractDigest,
      roleContractValid,
      aclDigest,
      dataApiExposedSchemas: [...admission.dataApiExposedSchemas],
      applicationSchemasExposed: admission.dataApiExposedSchemas.some(
        (schema) => ["trailmind_app", "trailmind_control", "trailmind_gis"]
          .includes(schema)
      ),
      regionalImportNoDatabaseCreate:
        row.regional_import_no_database_create,
      importSchemaOwnerBoundedDatabaseCreate:
        row.import_schema_owner_bounded_database_create,
      boundedImportProvisioningContract:
        row.bounded_import_provisioning_contract,
      postgisSchema: row.postgis_schema,
      postgisOwnerTopology: row.postgis_owner_topology,
      gisUnexpectedCreatePrincipalCount:
        row.gis_unexpected_create_principal_count,
      publicPostgisRoutineCount: row.public_postgis_routine_count,
      runtimeExecutableFunctions: runtimeFunctions,
      runtimeDirectTablePrivilegeCount:
        row.runtime_direct_table_privilege_count,
      runtimeDirectPostgisRoutineCount:
        row.runtime_direct_postgis_routine_count,
      runtimeDirectSharedRoutineCount:
        row.runtime_direct_shared_routine_count,
      appAttestAdmission: row.app_attest_admission,
      outdoorRuntimeAdmission: row.outdoor_runtime_admission,
      cancellationAdmission: row.cancellation_admission,
      siblingWriterSessionCount: row.sibling_writer_session_count
    });
  }

  async function containRuntime() {
    const sessions = await query(`
      /* trailmind:phase1-v2:containment-sessions */
      SELECT pid::integer
        FROM pg_catalog.pg_stat_activity
       WHERE datname = pg_catalog.current_database()
         AND usename = 'outdoor_research_runtime_role'
         AND pid <> pg_catalog.pg_backend_pid()
       ORDER BY pid
    `);
    await transactionScript(`
      BEGIN;
      SET LOCAL statement_timeout = '5s';
      SET LOCAL lock_timeout = '2s';
      SET LOCAL ROLE trailmind_app_owner;
      REVOKE EXECUTE ON FUNCTION
        trailmind_app.trailmind_runtime_outdoor_research_snapshot_context_v1(
          text, double precision, double precision
        ),
        trailmind_app.trailmind_runtime_outdoor_research_highlights_v1(
          uuid, text, double precision, double precision, text[],
          double precision, text[], integer, double precision
        ),
        trailmind_app.trailmind_runtime_outdoor_research_route_memberships_v1(
          uuid, text, double precision, double precision, double precision,
          integer, integer
        ),
        trailmind_app.trailmind_runtime_outdoor_research_route_assertions_v1(
          uuid, uuid[], text[], integer
        ),
        trailmind_app.trailmind_runtime_outdoor_research_trail_access_candidates_v1(
          uuid, text, uuid[], double precision, integer, text[], text[], integer
        ) FROM outdoor_research_runtime_role;
      COMMIT;
    `);
    let terminated = 0;
    for (const { pid } of sessions.rows) {
      try {
        await query("BEGIN");
        await query("SET LOCAL statement_timeout = '5s'");
        await query("SET LOCAL ROLE trailmind_control_owner");
        const result = await query(`
          SELECT trailmind_control.cancel_active_outdoor_research_backend_integer(
            $1::integer
          ) AS terminated
        `, [pid]);
        await query("COMMIT");
        if (result?.rows?.[0]?.terminated === true) terminated += 1;
      } catch (error) {
        await boundedRollback();
        throw error;
      }
    }
    const verification = await query(`
      SELECT pg_catalog.count(*) = 0 AS revoked,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_stat_activity activity
               WHERE activity.datname = pg_catalog.current_database()
                 AND activity.usename = 'outdoor_research_runtime_role'
                 AND activity.pid <> pg_catalog.pg_backend_pid())
               AS remaining_runtime_sessions
        FROM pg_catalog.pg_proc procedure
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'trailmind_app'
         AND procedure.proname = ANY($1::text[])
         AND pg_catalog.has_function_privilege(
           'outdoor_research_runtime_role', procedure.oid, 'EXECUTE'
         )
    `, [RUNTIME_FUNCTIONS]);
    if (
      verification.rowCount !== 1 ||
      verification.rows[0]?.revoked !== true ||
      verification.rows[0]?.remaining_runtime_sessions !== 0
    ) throw recordFailure("containment_unproved");
    return Object.freeze({
      runtimeExecuteRevoked: true,
      affectedRuntimeSessionsTerminatedCount: terminated
    });
  }

  async function transactionScript(sql) {
    try {
      return await query(sql);
    } catch (error) {
      await boundedRollback();
      throw error;
    }
  }

  async function boundedRollback() {
    if (abortCode || !connected || ended) return false;
    try {
      await query("ROLLBACK");
      return true;
    } catch {
      abort("rollback_unknown");
      return false;
    }
  }

  async function readSharedAcl() {
    return (await query(SHARED_ACL_SQL)).rows.map(normalizeRow);
  }

  async function readProviderAclPlan() {
    return (await query(PROVIDER_ACL_SQL, [TRAILMIND_ROLES])).rows.map(normalizeRow);
  }

  async function readLedger() {
    try {
      await query("BEGIN");
      await query("SET LOCAL ROLE trailmind_app_owner");
      const result = await query(`
        SELECT version
          FROM trailmind_app.trailmind_schema_migrations
         ORDER BY applied_at, version
      `);
      await query("COMMIT");
      return result.rows.map(({ version }) => version);
    } catch (error) {
      await boundedRollback();
      throw error;
    }
  }

  async function readRuntimeFunctions() {
    const result = await query(`
      SELECT procedure.proname
        FROM pg_catalog.pg_proc procedure
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'trailmind_app'
         AND procedure.proname = ANY($1::text[])
         AND pg_catalog.has_function_privilege(
           'outdoor_research_runtime_role', procedure.oid, 'EXECUTE'
         )
       ORDER BY procedure.proname
    `, [RUNTIME_FUNCTIONS]);
    return result.rows.map(({ proname }) => proname);
  }

  async function query(text, values) {
    assertActive();
    try {
      const result = await client.query(text, values);
      assertActive();
      return result;
    } catch (error) {
      if (abortCode) throw adapterFailure(abortCode);
      const code = classifyDatabaseFailure(error);
      if (["connection_lost", "idle_timeout"].includes(code)) abort(code);
      throw recordFailure(code);
    }
  }

  function abort(code) {
    if (abortCode) return;
    abortCode = code;
    boundaryAbort.abort(adapterFailure(code));
    try { client.connection?.stream?.destroy?.(); } catch { /* abort latch wins */ }
  }

  function assertActive() {
    if (abortCode) throw adapterFailure(abortCode);
  }

  async function cleanup() {
    if (ended) return;
    ended = true;
    const close = async () => {
      try {
        if (abortCode) client.connection?.stream?.destroy?.();
        await client.end?.();
        return true;
      } catch {
        client.connection?.stream?.destroy?.();
        return false;
      } finally {
        clearClientSecrets();
      }
    };
    const closed = await Promise.race([
      close(),
      timeout(CLEANUP_TIMEOUT_MILLISECONDS).then(() => {
        client.connection?.stream?.destroy?.();
        return false;
      })
    ]);
    clearClientSecrets();
    if (closed !== true) throw adapterFailure("cleanup_unproved");
  }

  async function finalize({ staged, cleanupVerifier, receiptStore }) {
    assertActive();
    if (
      !stagedReceipt || staged?.receipt !== stagedReceipt.receipt ||
      staged?.receiptDigest !== stagedReceipt.receiptDigest ||
      staged?.receiptBytes !== stagedReceipt.receiptBytes || activeLock
    ) throw adapterFailure("receipt_staging_invalid");
    await attestSession(false);
    if (
      typeof client.getTransactionStatus === "function" &&
      client.getTransactionStatus() !== "I"
    ) throw adapterFailure("transaction_cleanup_unproved");
    const beforeClose = await query(`
      /* trailmind:phase1-v2:cleanup-attestation */
      SELECT pg_catalog.pg_backend_pid()::integer AS backend_pid,
             session_user = 'postgres' AS exact_session,
             current_user = 'postgres' AS exact_current,
             NOT EXISTS (
               SELECT 1 FROM pg_catalog.pg_locks held
                WHERE held.pid = pg_catalog.pg_backend_pid()
                  AND held.locktype = 'advisory'
                  AND held.granted
             ) AS no_advisory_locks
    `);
    if (
      beforeClose.rowCount !== 1 ||
      beforeClose.rows[0]?.backend_pid !== backendPid ||
      beforeClose.rows[0]?.exact_session !== true ||
      beforeClose.rows[0]?.exact_current !== true ||
      beforeClose.rows[0]?.no_advisory_locks !== true
    ) throw adapterFailure("cleanup_attestation");

    const cleanupStartedAt = now();
    await cleanup();
    let cleanupProof;
    try {
      cleanupProof = await cleanupVerifier.proveSessionClosed({
        applicationName: STAGING_PHASE1_V2_APPLICATION_NAME,
        authorizationBindingDigest: admission.authorizationBindingDigest,
        backendPid,
        candidateCommit: admission.candidateCommit,
        candidateTree: admission.candidateTree,
        completedAt: staged.receipt.completedAt,
        operatorDigestsDigest,
        projectRef: admission.projectRef,
        stagedReceiptDigest: staged.receiptDigest,
        runId: admission.runId,
        readOnly: true
      }, { signal: boundaryAbort.signal });
    } catch {
      throw adapterFailure("cleanup_verifier_rejected");
    }
    if (
      !isExactObject(cleanupProof, [
        "applicationName", "authorizationBindingDigest", "backendPid",
        "backendSessionCount", "candidateCommit", "candidateTree",
        "completionState", "evidenceDigest", "idleSessionCount",
        "observedAt", "operatorDigestsDigest", "projectRef", "runId",
        "stagedReceiptDigest"
      ]) || cleanupProof.backendSessionCount !== 0 ||
      cleanupProof.idleSessionCount !== 0 ||
      cleanupProof.applicationName !== STAGING_PHASE1_V2_APPLICATION_NAME ||
      cleanupProof.authorizationBindingDigest !==
        admission.authorizationBindingDigest ||
      cleanupProof.backendPid !== backendPid ||
      cleanupProof.candidateCommit !== admission.candidateCommit ||
      cleanupProof.candidateTree !== admission.candidateTree ||
      cleanupProof.completionState !== "session-closed" ||
      cleanupProof.operatorDigestsDigest !== operatorDigestsDigest ||
      cleanupProof.projectRef !== admission.projectRef ||
      cleanupProof.runId !== admission.runId ||
      cleanupProof.stagedReceiptDigest !== staged.receiptDigest ||
      !isBoundaryTimestamp(
        cleanupProof.observedAt, cleanupStartedAt, now()
      ) ||
      !/^[a-f0-9]{64}$/.test(cleanupProof.evidenceDigest) ||
      canonicalAclDigest(withoutKey(cleanupProof, "evidenceDigest")) !==
        cleanupProof.evidenceDigest
    ) throw adapterFailure("cleanup_unproved");

    const receipt = Object.freeze({
      ...staged.receipt,
      cleanup: Object.freeze({ ...cleanupProof }),
      publishedAt: now().toISOString()
    });
    const receiptDigest = canonicalAclDigest(receipt);
    const receiptBytes = Buffer.byteLength(JSON.stringify(receipt), "utf8");
    let persistence;
    try {
      persistence = await receiptStore.persist({
        applicationName: STAGING_PHASE1_V2_APPLICATION_NAME,
        authorizationBindingDigest: admission.authorizationBindingDigest,
        backendPid,
        candidateCommit: admission.candidateCommit,
        candidateTree: admission.candidateTree,
        cleanupEvidenceDigest: cleanupProof.evidenceDigest,
        operatorDigestsDigest,
        projectRef: admission.projectRef,
        receipt,
        receiptBytes,
        receiptDigest,
        runId: admission.runId
      }, { signal: boundaryAbort.signal });
    } catch {
      throw adapterFailure("receipt_publication_rejected");
    }
    if (
      !isExactObject(persistence, [
        "applicationName", "authorizationBindingDigest", "backendPid",
        "candidateCommit", "candidateTree", "cleanupEvidenceDigest",
        "evidenceDigest", "operatorDigestsDigest", "ordinal", "persistedAt",
        "phase", "projectRef", "receiptBytes", "receiptDigest", "runId",
        "status"
      ]) || persistence.phase !== "sanitized-durable-receipt" ||
      persistence.ordinal !== 11 || persistence.status !== "persisted" ||
      persistence.applicationName !== STAGING_PHASE1_V2_APPLICATION_NAME ||
      persistence.authorizationBindingDigest !==
        admission.authorizationBindingDigest ||
      persistence.backendPid !== backendPid ||
      persistence.candidateCommit !== admission.candidateCommit ||
      persistence.candidateTree !== admission.candidateTree ||
      persistence.cleanupEvidenceDigest !== cleanupProof.evidenceDigest ||
      persistence.operatorDigestsDigest !== operatorDigestsDigest ||
      persistence.projectRef !== admission.projectRef ||
      persistence.receiptDigest !== receiptDigest ||
      persistence.receiptBytes !== receiptBytes ||
      persistence.runId !== admission.runId ||
      !isBoundaryTimestamp(
        persistence.persistedAt, new Date(receipt.publishedAt), now()
      ) ||
      !/^[a-f0-9]{64}$/.test(persistence.evidenceDigest) ||
      canonicalAclDigest(withoutKey(persistence, "evidenceDigest")) !==
        persistence.evidenceDigest
    ) throw adapterFailure("receipt_publication_unproved");
    return Object.freeze({
      persistence,
      receipt,
      receiptBytes,
      receiptDigest
    });
  }

  function clearClientSecrets() {
    if (client.connectionParameters) {
      client.connectionParameters.password = undefined;
      client.connectionParameters.ssl = false;
    }
    if ("password" in client) client.password = undefined;
  }

  function failureCode() {
    return lastFailureCode;
  }

  function recordFailure(code) {
    lastFailureCode ??= code;
    return adapterFailure(code);
  }

  async function callBoundary(code, operation) {
    assertActive();
    try {
      const result = await operation();
      assertActive();
      return result;
    } catch (error) {
      if (error instanceof StagingPhase1V2AdapterError) throw error;
      if (/^trailmind_phase1_v2_operator_(blocked|failed):/.test(
        error?.message ?? ""
      )) throw error;
      throw recordFailure(`${code}_rejected`);
    }
  }

  return Object.freeze({ abort, cleanup, failureCode, finalize, run });
}

async function assertAllowedDns(host, expectedAddress, customLookup = dnsLookup) {
  let addresses;
  try {
    addresses = await customLookup(host, { all: true, verbatim: true });
  } catch {
    throw adapterFailure("dns");
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw adapterFailure("dns");
  }
  const requiredFamily = host === STAGING_PHASE1_V2_DIRECT_HOST ? 6 :
    host === STAGING_PHASE1_V2_SESSION_HOST ? 4 : 0;
  if (
    requiredFamily === 0 ||
    isIP(expectedAddress) !== requiredFamily ||
    !addresses.some(({ address }) => address === expectedAddress) ||
    !addresses.some(({ family }) => family === requiredFamily) ||
    addresses.some(({ address, family }) =>
      family !== requiredFamily || !isPublicAddress(address, family))
  ) throw adapterFailure("dns_address");
}

async function boundedDnsAdmission(host, expectedAddress, customLookup) {
  let timer;
  try {
    return await Promise.race([
      assertAllowedDns(host, expectedAddress, customLookup),
      new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(adapterFailure("dns_timeout")),
          DNS_TIMEOUT_MILLISECONDS
        );
        timer.unref?.();
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function assertTls(client, expectedConnection) {
  const stream = client.connection?.stream;
  let certificate;
  let hostnameError;
  try { certificate = stream?.getPeerCertificate?.(); } catch { /* invalid */ }
  try {
    hostnameError = certificate
      ? checkServerIdentity(expectedConnection.host, certificate)
      : new Error("missing certificate");
  } catch {
    hostnameError = new Error("hostname verification failed");
  }
  if (
    stream?.encrypted !== true ||
    stream?.authorized !== true ||
    stream?.authorizationError != null ||
    !certificate ||
    Object.keys(certificate).length === 0 ||
    hostnameError !== undefined ||
    !["TLSv1.2", "TLSv1.3"].includes(stream?.getProtocol?.()) ||
    client.trailmindChannelBindingEstablished !== true ||
    !client.connectionParameters?.ssl ||
    client.connectionParameters?.host !== expectedConnection.host ||
    client.connectionParameters?.port !== expectedConnection.port ||
    client.connectionParameters?.database !== expectedConnection.database ||
    client.connectionParameters?.user !== expectedConnection.user ||
    stream?.remoteAddress?.toLowerCase?.() !==
      expectedConnection.address.toLowerCase()
  ) throw adapterFailure("tls_attestation");
}

class PinnedAddressSocket extends Socket {
  constructor(address) {
    super();
    this.pinnedAddress = address;
  }

  connect(port, ignoredHost) {
    if (!Number.isInteger(port) || port !== 5432 || !isIP(this.pinnedAddress)) {
      throw adapterFailure("pinned_socket");
    }
    return super.connect({ host: this.pinnedAddress, port });
  }
}

function classifyDatabaseFailure(error) {
  if (error?.code === "57014") return "statement_timeout";
  if (error?.code === "55P03") return "lock_timeout";
  if (error?.code === "25P03") return "idle_timeout";
  if (error?.code === "42501") return "permission_denied";
  if (error?.code === "55000") return "object_state_rejected";
  if (["42704", "42883", "42P01"].includes(error?.code)) {
    return "required_object_missing";
  }
  if (typeof error?.code === "string" && error.code.startsWith("23")) {
    return "integrity_rejected";
  }
  if (["57P01", "57P02", "57P03", "08000", "08003", "08006"].includes(
    error?.code
  )) return "connection_lost";
  return "database_rejected";
}

function evidence(phase, ordinal, status, fields) {
  return Object.freeze({
    phase,
    ordinal,
    status,
    evidenceDigest: canonicalAclDigest({ phase, ordinal, status, fields }),
    ...fields
  });
}

function normalizeRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    value === null ? null : value
  ]));
}

function settingListIncludes(value, expected) {
  return typeof value === "string" && value.split(",")
    .map((entry) => entry.trim())
    .includes(expected);
}

function sameRows(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    JSON.stringify(actual) === JSON.stringify(expected);
}

function withoutKey(value, deniedKey) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== deniedKey)
  );
}

function isBoundaryTimestamp(value, notBefore, notAfter) {
  if (!(notBefore instanceof Date) || !(notAfter instanceof Date)) return false;
  const observed = new Date(value);
  return !Number.isNaN(observed.getTime()) &&
    observed.getTime() >= notBefore.getTime() &&
    observed.getTime() <= notAfter.getTime();
}

function withoutVolatileIdentity(topology) {
  const { sibling_writer_session_count: ignored, ...stable } = topology;
  return stable;
}

function timeoutEquals(value, milliseconds) {
  if (typeof value !== "string") return false;
  if (value === `${milliseconds}ms`) return true;
  if (milliseconds % 1_000 === 0 && value === `${milliseconds / 1_000}s`) return true;
  return Number(value) === milliseconds;
}

function isPublicAddress(address, family) {
  if (isIP(address) !== family) return false;
  if (family === 4) {
    const parts = address.split(".").map(Number);
    const [first, second, third] = parts;
    return !(
      first === 0 || first === 10 || first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 0 && third === 0) ||
      (first === 192 && second === 0 && third === 2) ||
      (first === 192 && second === 88 && third === 99) ||
      (first === 192 && second === 168) ||
      (first === 198 && [18, 19].includes(second)) ||
      (first === 198 && second === 51 && third === 100) ||
      (first === 203 && second === 0 && third === 113) ||
      first >= 224
    );
  }
  const normalized = address.toLowerCase();
  const [first = 0, second = 0] = ipv6LeadingHextets(normalized);
  const globallyRouted = first >= 0x2000 && first <= 0x3fff;
  const documentation = first === 0x2001 && second === 0x0db8;
  const documentationV2 = (first & 0xfff0) === 0x3ff0;
  return globallyRouted && !documentation && !documentationV2;
}

function ipv6LeadingHextets(address) {
  const head = address.split("::", 1)[0];
  const values = head.split(":").filter(Boolean).slice(0, 2)
    .map((part) => Number.parseInt(part, 16));
  while (values.length < 2) values.push(0);
  return values;
}

async function raceOverallTimeout(operation, session, milliseconds) {
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      session.abort("overall_timeout");
      reject(adapterFailure("overall_timeout"));
    }, milliseconds);
    timer.unref?.();
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timer);
    operation.catch(() => {});
  }
}

function requireBoundary(value, methods, code) {
  if (
    !value ||
    typeof value !== "object" ||
    methods.some((method) => typeof value[method] !== "function")
  ) throw adapterFailure(`${code}_required`);
}

function sanitizeFailure(error, rootCode) {
  if (error instanceof StagingPhase1V2AdapterError) return error;
  if (error?.name === "StagingPhase1V2AdmissionError") {
    return adapterFailure("admission_rejected");
  }
  if (/^trailmind_phase1_v2_operator_(blocked|failed):/.test(
    error?.message ?? ""
  )) {
    const status = [
      "pre-step-committed-no-ledger",
      "migration-transaction-rollback",
      "restart-pre-ledger-compensated"
    ].includes(error?.classification)
      ? "compensated"
      : ["committed-migration-failure", "post-step-or-later-failure"]
          .includes(error?.classification)
        ? "contained"
        : "unknown";
    return adapterFailure(rootCode ?? "operator_rejected", status);
  }
  return adapterFailure("unknown");
}

function isExactObject(value, keys) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    exactArray(Object.keys(value).sort(), [...keys].sort());
}

function exactArray(actual, expected) {
  return Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

function boundedTestTimeout(value, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0 || value > fallback) {
    throw adapterFailure("timeout_configuration");
  }
  return value;
}

function timeout(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}

function adapterFailure(code, status = "unknown") {
  return new StagingPhase1V2AdapterError(code, status);
}
