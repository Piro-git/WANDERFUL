import {
  AUDITOR_LEDGER_FUNCTION,
  AUDITOR_ROLE,
  CANONICAL_UTC
} from "./constants.js";
import { blocked } from "./errors.js";

const MINIMUM_VALIDITY_MILLISECONDS = 60 * 1_000;
const MAXIMUM_VALIDITY_MILLISECONDS = 120 * 60 * 1_000;

export function compileAuditorProvisioningSql({ validUntil, now = () => new Date() }) {
  const expiry = validateExpiry(validUntil, now);
  return `${provisioningSql(expiry)}\n`;
}

export function compileAuditorRevocationSql() {
  return `${revocationSql()}\n`;
}

export function compileAuditorRollbackSql() {
  return `${revocationSql()}\n`;
}

function provisioningSql(validUntil) {
  return `-- TrailMind staging prerequisites v3: owner-only auditor provisioning.
-- Candidate SQL only. Run in a separately authorized owner session.
BEGIN;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SET LOCAL idle_in_transaction_session_timeout = '10s';
DO $trailmind_auditor_guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
     WHERE rolname = '${AUDITOR_ROLE}'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42710',
      MESSAGE = 'TrailMind staging auditor already exists';
  END IF;
END
$trailmind_auditor_guard$;
CREATE ROLE ${AUDITOR_ROLE}
  LOGIN PASSWORD NULL VALID UNTIL '${validUntil}'
  NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1;
ALTER ROLE ${AUDITOR_ROLE} SET default_transaction_read_only = 'on';
ALTER ROLE ${AUDITOR_ROLE} SET statement_timeout = '5000ms';
ALTER ROLE ${AUDITOR_ROLE} SET lock_timeout = '1000ms';
ALTER ROLE ${AUDITOR_ROLE}
  SET idle_in_transaction_session_timeout = '10000ms';
ALTER ROLE ${AUDITOR_ROLE} SET search_path = pg_catalog, pg_temp;
GRANT CONNECT ON DATABASE postgres TO ${AUDITOR_ROLE};
REVOKE CREATE, TEMPORARY ON DATABASE postgres FROM ${AUDITOR_ROLE};
SET LOCAL ROLE trailmind_app_owner;
CREATE FUNCTION ${AUDITOR_LEDGER_FUNCTION}
RETURNS TABLE(version text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $trailmind_ledger$
  SELECT ledger.version
    FROM trailmind_app.trailmind_schema_migrations ledger
   ORDER BY ledger.applied_at, ledger.version
   LIMIT 10
$trailmind_ledger$;
REVOKE ALL ON FUNCTION ${AUDITOR_LEDGER_FUNCTION} FROM PUBLIC;
RESET ROLE;
GRANT USAGE ON SCHEMA trailmind_app TO ${AUDITOR_ROLE};
GRANT EXECUTE ON FUNCTION ${AUDITOR_LEDGER_FUNCTION} TO ${AUDITOR_ROLE};
GRANT pg_read_all_stats TO ${AUDITOR_ROLE}
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
DO $trailmind_auditor_verify$
DECLARE
  target_oid oid;
BEGIN
  SELECT oid INTO STRICT target_oid FROM pg_catalog.pg_roles
   WHERE rolname = '${AUDITOR_ROLE}';
  IF pg_catalog.has_database_privilege(
       '${AUDITOR_ROLE}', 'postgres', 'CREATE'
     ) OR pg_catalog.has_database_privilege(
       '${AUDITOR_ROLE}', 'postgres', 'TEMPORARY'
     ) OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_namespace namespace
        WHERE namespace.nspname LIKE 'trailmind\\_%' ESCAPE '\\'
          AND (
            (namespace.nspname <> 'trailmind_app' AND
             pg_catalog.has_schema_privilege(
               '${AUDITOR_ROLE}', namespace.oid, 'USAGE'
             )) OR pg_catalog.has_schema_privilege(
              '${AUDITOR_ROLE}', namespace.oid, 'CREATE'
            )
          )
     ) OR NOT pg_catalog.has_schema_privilege(
       '${AUDITOR_ROLE}', 'trailmind_app', 'USAGE'
     ) OR NOT pg_catalog.has_function_privilege(
       '${AUDITOR_ROLE}', '${AUDITOR_LEDGER_FUNCTION}', 'EXECUTE'
     ) OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_auth_members membership
           WHERE membership.member = target_oid) <> 1 OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_auth_members membership
       JOIN pg_catalog.pg_roles granted ON granted.oid = membership.roleid
        WHERE membership.member = target_oid
          AND granted.rolname = 'pg_read_all_stats'
          AND NOT membership.admin_option
          AND NOT membership.inherit_option
          AND membership.set_option
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'TrailMind staging auditor effective privilege contract failed';
  END IF;
END
$trailmind_auditor_verify$;
COMMIT;
-- Set the password only with interactive PostgreSQL 17 psql \password.
-- Never place the password in SQL, argv, environment, JSON, or logs.`;
}

function revocationSql() {
  return `-- TrailMind staging prerequisites v3: owner-only auditor revocation.
-- Phase 1 commits quarantine first so a later refusal cannot restore login.
BEGIN;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
ALTER ROLE ${AUDITOR_ROLE} NOLOGIN PASSWORD NULL;
REVOKE pg_read_all_stats FROM ${AUDITOR_ROLE};
REVOKE EXECUTE ON FUNCTION ${AUDITOR_LEDGER_FUNCTION} FROM ${AUDITOR_ROLE};
REVOKE USAGE ON SCHEMA trailmind_app FROM ${AUDITOR_ROLE};
REVOKE CONNECT ON DATABASE postgres FROM ${AUDITOR_ROLE};
DROP FUNCTION IF EXISTS ${AUDITOR_LEDGER_FUNCTION};
COMMIT;

-- Phase 2 refuses destructive concealment when ownership or grants remain.
BEGIN;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
DO $trailmind_auditor_drop_guard$
DECLARE
  target_oid oid;
BEGIN
  SELECT oid INTO STRICT target_oid FROM pg_catalog.pg_roles
   WHERE rolname = '${AUDITOR_ROLE}';
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_database object WHERE object.datdba = target_oid
    UNION ALL
    SELECT 1 FROM pg_catalog.pg_namespace object WHERE object.nspowner = target_oid
    UNION ALL
    SELECT 1 FROM pg_catalog.pg_class object WHERE object.relowner = target_oid
    UNION ALL
    SELECT 1 FROM pg_catalog.pg_proc object WHERE object.proowner = target_oid
    UNION ALL
    SELECT 1 FROM pg_catalog.pg_type object WHERE object.typowner = target_oid
    UNION ALL
    SELECT 1 FROM pg_catalog.pg_operator object WHERE object.oprowner = target_oid
    UNION ALL
    SELECT 1 FROM pg_catalog.pg_collation object WHERE object.collowner = target_oid
    UNION ALL
    SELECT 1 FROM pg_catalog.pg_conversion object WHERE object.conowner = target_oid
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members membership
     WHERE membership.member = target_oid OR membership.grantor = target_oid
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'TrailMind staging auditor remains quarantined for manual review';
  END IF;
END
$trailmind_auditor_drop_guard$;
DROP ROLE ${AUDITOR_ROLE};
COMMIT;`;
}

function validateExpiry(validUntil, now) {
  if (typeof validUntil !== "string" || !CANONICAL_UTC.test(validUntil) ||
      new Date(validUntil).toISOString() !== validUntil ||
      typeof now !== "function") blocked("auditor_expiry");
  const current = now();
  if (!(current instanceof Date) || !Number.isFinite(current.getTime())) {
    blocked("auditor_clock");
  }
  const lifetime = Date.parse(validUntil) - current.getTime();
  if (lifetime < MINIMUM_VALIDITY_MILLISECONDS ||
      lifetime > MAXIMUM_VALIDITY_MILLISECONDS) blocked("auditor_expiry_window");
  return validUntil;
}
