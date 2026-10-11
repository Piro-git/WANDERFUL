import { createHash } from "node:crypto";
import {
  SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
} from "./stagingMigrationPolicy.js";
import { STAGING_PHASE1_V2_TARGET } from "./stagingPhase1V2Operator.js";

export const MANAGED_SUPABASE_BOOTSTRAP_CONTRACT =
  "managed-supabase-postgres-v1";
export const MANAGED_SUPABASE_BOOTSTRAP_DATABASE = "postgres";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const GIT_OBJECT_PATTERN = /^[0-9a-f]{40}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertManagedSupabaseBootstrapTarget(target) {
  if (
    !target ||
    target.projectRef !== STAGING_PHASE1_V2_TARGET.projectRef ||
    target.projectName !== STAGING_PHASE1_V2_TARGET.projectName ||
    target.organizationId !== STAGING_PHASE1_V2_TARGET.organizationId ||
    target.region !== STAGING_PHASE1_V2_TARGET.region ||
    target.status !== STAGING_PHASE1_V2_TARGET.status ||
    target.databaseName !== MANAGED_SUPABASE_BOOTSTRAP_DATABASE ||
    target.postgresMajor !== STAGING_PHASE1_V2_TARGET.postgresMajor
  ) throw new Error("trailmind_managed_bootstrap_target_rejected");
  return true;
}

export function renderManagedSupabaseBootstrapSql({
  target,
  preMigrationSql,
  postMigrationSql,
  admittedMigrations,
  binding
}) {
  assertManagedSupabaseBootstrapTarget(target);
  assertBinding(binding);
  const migrations = assertMigrations(admittedMigrations);
  const pre = stripOuterTransaction(preMigrationSql, "pre");
  const post = stripOuterTransaction(postMigrationSql, "post");
  const expectedLedger = SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
    .map(sqlLiteral).join(",\n      ");
  const migrationStatements = migrations.map(({ version, sql, sha256 }) => `
-- trailmind:managed-bootstrap:migration:${version}:${sha256}
${sql.trim()}
SET LOCAL ROLE trailmind_app_owner;
SET LOCAL search_path = trailmind_app, pg_catalog, trailmind_gis, pg_temp;
INSERT INTO trailmind_app.trailmind_schema_migrations (version)
VALUES (${sqlLiteral(version)});
`).join("\n");

  return `-- TrailMind exact-target managed Supabase bootstrap V1.
-- Atomic: any error rolls back the pre-step, migrations, ledger and post-step.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SELECT pg_catalog.set_config(
         'trailmind.phase1_v2_bootstrap_contract',
         ${sqlLiteral(MANAGED_SUPABASE_BOOTSTRAP_CONTRACT)}, true
       ),
       pg_catalog.set_config(
         'trailmind.phase1_v2_project_ref',
         ${sqlLiteral(target.projectRef)}, true
       ),
       pg_catalog.set_config(
         'trailmind.phase1_v2_project_name',
         ${sqlLiteral(target.projectName)}, true
       ),
       pg_catalog.set_config(
         'trailmind.phase1_v2_database_name',
         ${sqlLiteral(target.databaseName)}, true
       ),
       pg_catalog.set_config(
         'trailmind.phase1_v2_bootstrap_backend_pid',
         pg_catalog.pg_backend_pid()::text, true
       ),
       pg_catalog.set_config(
         'trailmind.phase1_v2_run_id', ${sqlLiteral(binding.runId)}, true
       ),
       pg_catalog.set_config(
         'trailmind.phase1_v2_authorization_binding_digest',
         ${sqlLiteral(binding.authorizationBindingDigest)}, true
       ),
       pg_catalog.set_config(
         'trailmind.phase1_v2_candidate_commit',
         ${sqlLiteral(binding.candidateCommit)}, true
       ),
       pg_catalog.set_config(
         'trailmind.phase1_v2_candidate_tree',
         ${sqlLiteral(binding.candidateTree)}, true
       ),
       pg_catalog.set_config(
         'trailmind.phase1_v2_operator_digests_digest',
         ${sqlLiteral(binding.operatorDigestsDigest)}, true
       ),
       pg_catalog.set_config(
         'trailmind.phase1_v2_provider_acl_restore_plan_digest',
         ${sqlLiteral(binding.providerAclRestorePlanDigest)}, true
       );

${pre}

RESET ROLE;
DO $managed_migration_admission$
BEGIN
  IF pg_catalog.current_database() <> 'postgres' OR
     session_user <> 'postgres' OR current_user <> 'postgres' OR
     pg_catalog.current_setting(
       'trailmind.phase1_v2_bootstrap_contract', true
     ) IS DISTINCT FROM 'managed-supabase-postgres-v1' OR
     pg_catalog.current_setting(
       'trailmind.phase1_v2_project_ref', true
     ) IS DISTINCT FROM 'mbvzwsrtqcrwhvykugcd' OR
     pg_catalog.current_setting(
       'trailmind.phase1_v2_project_name', true
     ) IS DISTINCT FROM 'TrailMind Outdoor Staging V1' OR
     pg_catalog.current_setting(
       'trailmind.phase1_v2_bootstrap_backend_pid', true
     ) IS DISTINCT FROM pg_catalog.pg_backend_pid()::text OR
     NOT EXISTS (
       SELECT 1
         FROM trailmind_phase1_guard.recovery_binding binding_record
        WHERE binding_record.singleton
          AND binding_record.bootstrap_contract =
            pg_catalog.current_setting(
              'trailmind.phase1_v2_bootstrap_contract'
            )
          AND binding_record.project_ref = pg_catalog.current_setting(
            'trailmind.phase1_v2_project_ref'
          )
          AND binding_record.project_name = pg_catalog.current_setting(
            'trailmind.phase1_v2_project_name'
          )
          AND binding_record.database_name = pg_catalog.current_database()
          AND binding_record.bootstrap_backend_pid =
            pg_catalog.pg_backend_pid()
          AND binding_record.run_id = pg_catalog.current_setting(
            'trailmind.phase1_v2_run_id'
          )::uuid
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'TrailMind managed migration session binding rejected';
  END IF;
END
$managed_migration_admission$;

SET LOCAL ROLE migration_role;
SET LOCAL ROLE trailmind_app_owner;
SET LOCAL search_path = trailmind_app, pg_catalog, trailmind_gis, pg_temp;
CREATE TABLE trailmind_app.trailmind_schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
${migrationStatements}

-- Exercise the same exact policy ledger a second time. With every reviewed
-- version present, the only acceptable result is a zero-application no-op.
DO $managed_migration_noop$
BEGIN
  IF (
    SELECT pg_catalog.array_agg(version ORDER BY applied_at, version)
      FROM trailmind_app.trailmind_schema_migrations
  ) IS DISTINCT FROM ARRAY[
      ${expectedLedger}
  ]::text[] OR EXISTS (
    SELECT 1
      FROM trailmind_app.trailmind_schema_migrations
     WHERE version = '008_outdoor_research_runtime_read_contract.sql'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'TrailMind managed migration no-op ledger rejected';
  END IF;
END
$managed_migration_noop$;

RESET ROLE;
${post}

COMMIT;
SELECT pg_catalog.jsonb_build_object(
  'status', 'committed',
  'contract', ${sqlLiteral(MANAGED_SUPABASE_BOOTSTRAP_CONTRACT)},
  'project_ref', ${sqlLiteral(target.projectRef)},
  'database_name', ${sqlLiteral(target.databaseName)},
  'run_id', ${sqlLiteral(binding.runId)},
  'first_run_applied_count', ${migrations.length},
  'second_run_applied_count', 0,
  'historical_008_applied', false
) AS trailmind_managed_bootstrap_receipt;
`;
}

function assertMigrations(admittedMigrations) {
  if (
    !Array.isArray(admittedMigrations) ||
    admittedMigrations.length !==
      SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2.length
  ) throw new Error("trailmind_managed_bootstrap_migrations_rejected");
  const checked = admittedMigrations.map((migration, index) => {
    const expected = SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2[index];
    if (
      !migration || migration.version !== expected ||
      migration.version.startsWith("008_") ||
      typeof migration.sql !== "string" || migration.sql.length === 0 ||
      !DIGEST_PATTERN.test(migration.sha256 ?? "") ||
      sha256(migration.sql) !== migration.sha256
    ) throw new Error("trailmind_managed_bootstrap_migrations_rejected");
    return migration;
  });
  return checked;
}

function assertBinding(binding) {
  if (
    !binding || !UUID_PATTERN.test(binding.runId ?? "") ||
    !DIGEST_PATTERN.test(binding.authorizationBindingDigest ?? "") ||
    !GIT_OBJECT_PATTERN.test(binding.candidateCommit ?? "") ||
    !GIT_OBJECT_PATTERN.test(binding.candidateTree ?? "") ||
    !DIGEST_PATTERN.test(binding.operatorDigestsDigest ?? "") ||
    !DIGEST_PATTERN.test(binding.providerAclRestorePlanDigest ?? "")
  ) throw new Error("trailmind_managed_bootstrap_binding_rejected");
}

function stripOuterTransaction(sql, label) {
  if (typeof sql !== "string") {
    throw new Error(`trailmind_managed_bootstrap_${label}_sql_rejected`);
  }
  const begin = sql.indexOf("BEGIN;");
  const commit = sql.lastIndexOf("COMMIT;");
  if (
    begin < 0 || commit <= begin ||
    sql.slice(commit + "COMMIT;".length).trim() !== "" ||
    (sql.match(/^BEGIN;$/gm) ?? []).length !== 1 ||
    (sql.match(/^COMMIT;$/gm) ?? []).length !== 1
  ) throw new Error(`trailmind_managed_bootstrap_${label}_sql_rejected`);
  return `${sql.slice(0, begin)}${sql.slice(begin + "BEGIN;".length, commit)}`
    .trim();
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
