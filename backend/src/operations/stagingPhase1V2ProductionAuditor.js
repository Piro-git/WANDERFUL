import { createHash } from "node:crypto";
import {
  assertStagingPhase1V2StaticStatementId,
  STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY,
  validateStagingPhase1V2AuditorContract,
  validateStagingPhase1V2CleanupSamples,
  validateStagingPhase1V2TargetSession
} from "./stagingPhase1V2ProductionObserverContract.js";

const STATEMENTS = deepFreeze({
  auditor_identity_v1: `SELECT
  pg_catalog.current_database() AS database_name,
  SESSION_USER AS session_user_name,
  CURRENT_USER AS current_user_name,
  login.rolcanlogin,
  login.rolinherit,
  login.rolsuper,
  login.rolcreatedb,
  login.rolcreaterole,
  login.rolreplication,
  login.rolbypassrls,
  login.rolconnlimit,
  login.rolvaliduntil IS NOT NULL
    AND login.rolvaliduntil > pg_catalog.clock_timestamp()
    AS credential_unexpired,
  pg_catalog.current_setting('transaction_read_only') AS transaction_read_only,
  pg_catalog.current_setting('search_path') AS search_path,
  pg_catalog.current_setting('statement_timeout') AS statement_timeout,
  pg_catalog.current_setting('lock_timeout') AS lock_timeout,
  pg_catalog.current_setting('idle_in_transaction_session_timeout') AS idle_timeout
FROM pg_catalog.pg_roles AS login
WHERE login.rolname = SESSION_USER`,
  auditor_membership_v1: `SELECT
  granted.rolname AS granted_role,
  membership.admin_option,
  membership.inherit_option,
  membership.set_option
FROM pg_catalog.pg_auth_members AS membership
JOIN pg_catalog.pg_roles AS granted
  ON granted.oid = membership.roleid
JOIN pg_catalog.pg_roles AS member
  ON member.oid = membership.member
WHERE member.rolname = SESSION_USER
ORDER BY granted.rolname`,
  auditor_tls_v1: `SELECT ssl, version, cipher, bits
FROM pg_catalog.pg_stat_ssl
WHERE pid = pg_catalog.pg_backend_pid()`,
  target_session_discovery_v1: `SELECT
  activity.pid,
  pg_catalog.to_char(
    activity.backend_start AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
  ) AS backend_start,
  activity.application_name,
  activity.datname,
  activity.usename,
  activity.backend_type,
  activity.state,
  ssl.ssl,
  ssl.version
FROM pg_catalog.pg_stat_activity AS activity
LEFT JOIN pg_catalog.pg_stat_ssl AS ssl
  ON ssl.pid = activity.pid
WHERE activity.pid = $1::integer
  AND activity.application_name = $2::text
  AND activity.datname = 'postgres'
  AND activity.usename = 'postgres'
  AND activity.backend_type = 'client backend'`,
  target_session_v1: `SELECT
  pg_catalog.count(*) FILTER (
    WHERE activity.pid = $1::integer
      AND activity.application_name = $2::text
      AND pg_catalog.to_char(
        activity.backend_start AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) = $3::text
      AND activity.datname = 'postgres'
      AND activity.usename = 'postgres'
      AND activity.backend_type = 'client backend'
      AND ssl.ssl IS TRUE
  )::integer AS exact_backend_instance_count,
  pg_catalog.count(*) FILTER (
    WHERE activity.application_name = $2::text
      AND activity.datname = 'postgres'
      AND activity.usename = 'postgres'
      AND activity.backend_type = 'client backend'
  )::integer AS matching_application_count,
  pg_catalog.count(*) FILTER (
    WHERE activity.pid = $1::integer
      AND activity.application_name = $2::text
      AND pg_catalog.to_char(
        activity.backend_start AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) = $3::text
      AND activity.datname = 'postgres'
      AND activity.usename = 'postgres'
      AND activity.backend_type = 'client backend'
      AND activity.state IN (
        'idle', 'idle in transaction', 'idle in transaction (aborted)'
      )
  )::integer AS idle_exact_instance_count,
  pg_catalog.count(*) FILTER (
    WHERE activity.pid = $1::integer
      AND activity.backend_type = 'client backend'
      AND (
        activity.application_name IS DISTINCT FROM $2::text
        OR pg_catalog.to_char(
          activity.backend_start AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ) IS DISTINCT FROM $3::text
        OR activity.datname IS DISTINCT FROM 'postgres'
        OR activity.usename IS DISTINCT FROM 'postgres'
      )
  )::integer AS same_pid_other_instance_count
FROM pg_catalog.pg_stat_activity AS activity
LEFT JOIN pg_catalog.pg_stat_ssl AS ssl
  ON ssl.pid = activity.pid`,
  database_acl_v1: `SELECT
  pg_catalog.current_database() AS database_name,
  CURRENT_USER AS current_role,
  pg_catalog.pg_has_role(
    SESSION_USER, 'pg_read_all_stats', 'SET'
  ) AS may_set_stats_role,
  NOT pg_catalog.pg_has_role(
    SESSION_USER, 'pg_monitor', 'USAGE'
  ) AS no_pg_monitor,
  NOT pg_catalog.pg_has_role(
    SESSION_USER, 'pg_read_all_settings', 'USAGE'
  ) AS no_pg_read_all_settings,
  NOT pg_catalog.pg_has_role(
    SESSION_USER, 'pg_read_all_data', 'USAGE'
  ) AS no_pg_read_all_data,
  NOT pg_catalog.pg_has_role(
    SESSION_USER, 'pg_write_all_data', 'USAGE'
  ) AS no_pg_write_all_data,
  pg_catalog.has_database_privilege(
    SESSION_USER, pg_catalog.current_database(), 'CONNECT'
  ) AS can_connect,
  NOT pg_catalog.has_database_privilege(
    SESSION_USER, pg_catalog.current_database(), 'CREATE'
  ) AS no_database_create,
  NOT pg_catalog.has_database_privilege(
    SESSION_USER, pg_catalog.current_database(), 'TEMPORARY'
  ) AS no_database_temporary,
  NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_database AS owned_database
      JOIN pg_catalog.pg_roles AS login
        ON login.oid = owned_database.datdba
     WHERE login.rolname = SESSION_USER
    UNION ALL
    SELECT 1
      FROM pg_catalog.pg_namespace AS owned_namespace
      JOIN pg_catalog.pg_roles AS login
        ON login.oid = owned_namespace.nspowner
     WHERE login.rolname = SESSION_USER
    UNION ALL
    SELECT 1
      FROM pg_catalog.pg_class AS owned_relation
      JOIN pg_catalog.pg_roles AS login
        ON login.oid = owned_relation.relowner
     WHERE login.rolname = SESSION_USER
    UNION ALL
    SELECT 1
      FROM pg_catalog.pg_proc AS owned_routine
      JOIN pg_catalog.pg_roles AS login
        ON login.oid = owned_routine.proowner
     WHERE login.rolname = SESSION_USER
  ) AS no_owned_objects,
  NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_namespace AS namespace
      LEFT JOIN pg_catalog.pg_class AS relation
        ON relation.relnamespace = namespace.oid
     WHERE (
       namespace.nspname LIKE 'trailmind\_%' ESCAPE '\'
       OR namespace.nspname LIKE 'outdoor\_%' ESCAPE '\'
     ) AND (
       pg_catalog.has_schema_privilege(
         SESSION_USER, namespace.oid, 'USAGE'
       ) OR pg_catalog.has_schema_privilege(
         SESSION_USER, namespace.oid, 'CREATE'
       ) OR (
         relation.oid IS NOT NULL AND (
           (relation.relkind IN ('r','p','v','m','f') AND (
             pg_catalog.has_table_privilege(
               SESSION_USER, relation.oid,
               'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
             ) OR pg_catalog.has_any_column_privilege(
               SESSION_USER, relation.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
             )
           )) OR (relation.relkind = 'S' AND
             pg_catalog.has_sequence_privilege(
               SESSION_USER, relation.oid, 'USAGE,SELECT,UPDATE'
             )
           )
         )
       )
     )
  ) AS no_trailmind_data_access,
  NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = routine.pronamespace
     WHERE (
       namespace.nspname LIKE 'trailmind\_%' ESCAPE '\'
       OR namespace.nspname LIKE 'outdoor\_%' ESCAPE '\'
     ) AND pg_catalog.has_function_privilege(
       SESSION_USER, routine.oid, 'EXECUTE'
     )
  ) AS no_trailmind_routine_access`
});

export const STAGING_PHASE1_V2_PRODUCTION_AUDITOR_SQL_MANIFEST = deepFreeze(
  Object.fromEntries(Object.entries(STATEMENTS).map(([id, statement]) => [
    id,
    sha256(normalizeStatement(statement))
  ]))
);

export const STAGING_PHASE1_V2_PRODUCTION_AUDITOR_SESSION_SETUP =
  Object.freeze([
    "BEGIN TRANSACTION READ ONLY",
    "SET LOCAL search_path = pg_catalog",
    "SET LOCAL statement_timeout = '5s'",
    "SET LOCAL lock_timeout = '1s'",
    "SET LOCAL idle_in_transaction_session_timeout = '5s'"
  ]);

export const STAGING_PHASE1_V2_PRODUCTION_AUDITOR_OBSERVATION_SETUP =
  Object.freeze([
    "SET LOCAL ROLE pg_read_all_stats",
    "SET LOCAL stats_fetch_consistency = 'none'",
    "SELECT pg_catalog.pg_stat_clear_snapshot()"
  ]);

export function stagingPhase1V2ProductionAuditorStatement(statementId) {
  assertStagingPhase1V2StaticStatementId(statementId);
  return STATEMENTS[statementId];
}

export function validateStagingPhase1V2ProductionAuditorPreflight(value) {
  return validateStagingPhase1V2AuditorContract(value);
}

export function validateStagingPhase1V2ProductionTargetSession(
  value,
  expected
) {
  return validateStagingPhase1V2TargetSession(value, expected);
}

export function validateStagingPhase1V2ProductionCleanup(
  samples,
  expected
) {
  return validateStagingPhase1V2CleanupSamples(samples, expected);
}

export function stagingPhase1V2ProductionAuditorConnectionContract() {
  const policy = STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.auditor;
  return deepFreeze({
    database: policy.database,
    directPort: 5432,
    role: policy.role,
    sessionPoolerAllowed: false,
    transactionPoolerPortAllowed: false,
    distinctFromMutatingRole: policy.role !==
      STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.target.mutatingRole,
    genericSqlAllowed: false
  });
}

function normalizeStatement(value) {
  return value.replace(/\s+/g, " ").trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
