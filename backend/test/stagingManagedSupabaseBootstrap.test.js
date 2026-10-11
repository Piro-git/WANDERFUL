import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  assertManagedSupabaseBootstrapTarget,
  MANAGED_SUPABASE_BOOTSTRAP_CONTRACT,
  renderManagedSupabaseBootstrapSql
} from "../src/operations/stagingManagedSupabaseBootstrap.js";
import {
  SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
} from "../src/operations/stagingMigrationPolicy.js";

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(backendRoot);
const target = Object.freeze({
  projectRef: "mbvzwsrtqcrwhvykugcd",
  projectName: "TrailMind Outdoor Staging V1",
  organizationId: "wbnftkftyamxzvxsftda",
  region: "eu-central-1",
  status: "ACTIVE_HEALTHY",
  databaseName: "postgres",
  postgresMajor: 17
});
const binding = Object.freeze({
  runId: "00000000-0000-4000-8000-000000000011",
  authorizationBindingDigest: "a".repeat(64),
  candidateCommit: "b".repeat(40),
  candidateTree: "c".repeat(40),
  operatorDigestsDigest: "d".repeat(64),
  providerAclRestorePlanDigest: "e".repeat(64)
});

describe("managed Supabase bootstrap contract", () => {
  it("accepts only the exact staging project, name, region, health, database and PG17", () => {
    assert.equal(assertManagedSupabaseBootstrapTarget(target), true);
    for (const [field, value] of [
      ["projectRef", "bejvhhjbgtvctpsnlwid"],
      ["projectRef", "cmkvbxppgofteoutfslp"],
      ["projectName", "TrailMind"],
      ["organizationId", "wrong"],
      ["region", "us-east-1"],
      ["status", "PAUSED"],
      ["databaseName", "template1"],
      ["postgresMajor", 15]
    ]) {
      assert.throws(
        () => assertManagedSupabaseBootstrapTarget({
          ...target, [field]: value
        }),
        /managed_bootstrap_target_rejected/,
        field
      );
    }
  });

  it("renders one atomic transaction with the exact ledger and a true second-run no-op", async () => {
    const fixture = await repositoryFixture();
    const sql = renderManagedSupabaseBootstrapSql({
      target, binding, ...fixture
    });
    assert.equal(MANAGED_SUPABASE_BOOTSTRAP_CONTRACT,
      "managed-supabase-postgres-v1");
    assert.equal((sql.match(/^BEGIN;$/gm) ?? []).length, 1);
    assert.equal((sql.match(/^COMMIT;$/gm) ?? []).length, 1);
    assert.match(sql, /Atomic: any error rolls back the pre-step, migrations, ledger and post-step/);
    assert.match(sql, /trailmind\.phase1_v2_bootstrap_backend_pid/);
    assert.match(sql, /binding_record\.bootstrap_backend_pid =\s+pg_catalog\.pg_backend_pid\(\)/);
    assert.match(sql, /managed_migration_noop/);
    assert.match(sql, /'second_run_applied_count', 0/);
    assert.match(sql, /'historical_008_applied', false/);
    assert.doesNotMatch(sql, /managed-bootstrap:migration:008_/);
    for (const version of SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2) {
      assert.match(sql, new RegExp(
        `managed-bootstrap:migration:${escapeRegExp(version)}`
      ));
    }
    assert.deepEqual(
      [...sql.matchAll(/managed-bootstrap:migration:([^:]+):[0-9a-f]{64}/g)]
        .map((match) => match[1]),
      SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
    );
  });

  it("rejects migration 008, reordered files and mutated admitted SQL before rendering DDL", async () => {
    const fixture = await repositoryFixture();
    const historical = {
      ...fixture.admittedMigrations.at(-1),
      version: "008_outdoor_research_runtime_read_contract.sql"
    };
    for (const admittedMigrations of [
      [...fixture.admittedMigrations.slice(0, -1), historical],
      [...fixture.admittedMigrations].reverse(),
      fixture.admittedMigrations.map((migration, index) => index === 0
        ? { ...migration, sql: `${migration.sql}\nSELECT 1;` }
        : migration)
    ]) {
      assert.throws(() => renderManagedSupabaseBootstrapSql({
        target,
        binding,
        ...fixture,
        admittedMigrations
      }), /managed_bootstrap_migrations_rejected/);
    }
  });

  it("keeps managed bootstrap privileges separate from every TrailMind role", async () => {
    const pre = await readFile(join(
      repositoryRoot,
      "docs/operations/staging-v1/database/PHASE_1_PRE_MIGRATION_V2.sql"
    ), "utf8");
    const post = await readFile(join(
      repositoryRoot,
      "docs/operations/staging-v1/database/PHASE_1_POST_MIGRATION_V2.sql"
    ), "utf8");
    assert.match(pre, /role_record\.rolreplication\s+AND role_record\.rolbypassrls/);
    assert.match(post, /role_record\.rolreplication\s+AND role_record\.rolbypassrls/);
    assert.match(pre, /supautils\.privileged_role/);
    assert.match(pre, /supautils\.privileged_extensions/);
    assert.match(pre, /supabase_admin_superuser|managed_admin\.rolsuper/);
    assert.equal(
      (pre.match(/CREATE ROLE trailmind_[\s\S]*?NOREPLICATION NOBYPASSRLS;/g) ?? [])
        .length >= 3,
      true
    );
    for (const role of [
      "platform_provisioner", "migration_role", "regional_import_role",
      "projection_role", "app_security_runtime_role",
      "outdoor_research_runtime_role", "pruner_role",
      "readonly_auditor_role"
    ]) {
      assert.match(pre, new RegExp(
        `CREATE ROLE ${role}[\\s\\S]{0,180}NOREPLICATION NOBYPASSRLS;`
      ));
    }
    assert.match(pre, /REVOKE ALL ON SCHEMA trailmind_gis FROM PUBLIC, anon, authenticated, service_role/);
    assert.match(post, /ALTER DEFAULT PRIVILEGES IN SCHEMA trailmind_app\s+REVOKE ALL ON TABLES FROM PUBLIC/);
    assert.match(post, /ALTER DEFAULT PRIVILEGES IN SCHEMA trailmind_app\s+REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC/);
    assert.match(post, /REVOKE ALL ON FUNCTION\s+trailmind_app\.provision_outdoor_import_schema_v1/);
  });
});

async function repositoryFixture() {
  const preMigrationSql = await readFile(join(
    repositoryRoot,
    "docs/operations/staging-v1/database/PHASE_1_PRE_MIGRATION_V2.sql"
  ), "utf8");
  const postMigrationSql = await readFile(join(
    repositoryRoot,
    "docs/operations/staging-v1/database/PHASE_1_POST_MIGRATION_V2.sql"
  ), "utf8");
  const admittedMigrations = await Promise.all(
    SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2.map(async (version) => {
      const sql = await readFile(join(backendRoot, "migrations", version), "utf8");
      return { version, sql, sha256: sha256(sql) };
    })
  );
  return { preMigrationSql, postMigrationSql, admittedMigrations };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
