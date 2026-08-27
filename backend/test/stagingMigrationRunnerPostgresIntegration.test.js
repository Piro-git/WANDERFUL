import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import {
  SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
} from "../src/operations/stagingMigrationPolicy.js";

const executeFile = promisify(execFile);
const disposable = disposableConfiguration(process.env);
const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationDirectory = join(backendRoot, "migrations");
const createdDatabases = new Set();
let maintenance;

describe("migration runner PostgreSQL 17 state machine", {
  skip: disposable ? false : "use the deterministic V2 disposable bootstrap"
}, () => {
  before(() => {
    maintenance = new pg.Pool({
      ...disposable,
      database: "template1",
      max: 1,
      allowExitOnIdle: true
    });
  });

  after(async () => {
    await maintenance?.end();
    const cleanup = new pg.Client({ ...disposable, database: "template1" });
    await cleanup.connect();
    try {
      for (const database of createdDatabases) {
        await cleanup.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)} WITH (FORCE)`);
      }
    } finally {
      await cleanup.end();
    }
  });

  it("applies the exact V2 files once and emits a true zero-output no-op", async () => {
    const database = await cloneDatabase("first_noop");
    const first = await runCli(database);
    assert.deepEqual(appliedOutput(first.stdout), SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2);
    assert.equal(first.stderr, "");
    assert.deepEqual(await ledger(database), SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2);

    const second = await runCli(database);
    assert.equal(second.stdout, "");
    assert.equal(second.stderr, "");
    assert.deepEqual(await ledger(database), SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2);
  });

  it("resumes a valid prefix and emits only files committed after the prefix", async () => {
    const database = await cloneDatabase("prefix");
    const client = await roleClient(database, "postgres");
    try {
      const prefix = SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2.slice(0, 3);
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE trailmind_app_owner");
      await client.query(
        "SET LOCAL search_path = trailmind_app, pg_catalog, trailmind_gis, pg_temp"
      );
      await client.query(`
        CREATE TABLE trailmind_app.trailmind_schema_migrations(
          version text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
        )
      `);
      for (const version of prefix) {
        await client.query(await readFile(join(migrationDirectory, version), "utf8"));
        await client.query(
          "INSERT INTO trailmind_app.trailmind_schema_migrations(version) VALUES ($1)",
          [version]
        );
      }
      await client.query("COMMIT");
    } finally {
      await client.end();
    }

    const resumed = await runCli(database);
    assert.deepEqual(
      appliedOutput(resumed.stdout),
      SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2.slice(3)
    );
    assert.deepEqual(await ledger(database), SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2);
  });

  it("rejects holes, reordering, foreign files, and a historical cross-policy ledger", async () => {
    const incompatible = [
      ["hole", [
        SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2[0],
        SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2[2]
      ]],
      ["reorder", [
        SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2[1],
        SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2[0]
      ]],
      ["foreign", ["999_foreign.sql"]],
      ["cross_policy", [
        ...SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2.slice(0, 7),
        "008_outdoor_research_runtime_read_contract.sql"
      ]]
    ];
    for (const [label, versions] of incompatible) {
      const database = await cloneDatabase(label);
      await createLedger(database, versions);
      const failure = await runCliFailure(database);
      assert.equal(failure.stdout, "", label);
      assert.match(failure.stderr, /trailmind_migration_ledger_incompatible/, label);
      assert.deepEqual(await ledger(database), versions, label);
    }
  });

  it("rolls a migration failure back without ledger or application residue and emits nothing", async () => {
    const database = await cloneDatabase("rollback");
    await queryAs(database, "trailmind_v2_admin", `
      SET ROLE trailmind_app_owner;
      CREATE TABLE trailmind_app.outdoor_evidence_imports(trap integer);
      RESET ROLE;
    `);
    const failure = await runCliFailure(database);
    assert.equal(failure.stdout, "");
    assert.match(failure.stderr, /column .* does not exist|outdoor_evidence_snapshots/i);
    const residue = await queryAs(database, "trailmind_v2_admin", `
      SELECT pg_catalog.to_regclass(
               'trailmind_app.trailmind_schema_migrations'
             ) IS NULL AS no_ledger,
             pg_catalog.to_regclass(
               'trailmind_app.app_attest_keys'
             ) IS NULL AS no_app_attest,
             (
               SELECT pg_catalog.count(*)::integer
                 FROM pg_catalog.pg_class relation
                 JOIN pg_catalog.pg_namespace namespace
                   ON namespace.oid = relation.relnamespace
                WHERE namespace.nspname = 'trailmind_app'
                  AND relation.relname <> 'outdoor_evidence_imports'
             ) AS other_relations,
             (
               SELECT pg_catalog.count(*)::integer
                 FROM pg_catalog.pg_proc procedure
                 JOIN pg_catalog.pg_namespace namespace
                   ON namespace.oid = procedure.pronamespace
                WHERE namespace.nspname = 'trailmind_app'
             ) AS functions
    `);
    assert.deepEqual(residue.rows[0], {
      no_ledger: true,
      no_app_attest: true,
      other_relations: 0,
      functions: 0
    });
  });

  it("serializes concurrent runners under one bounded advisory lock", async () => {
    const database = await cloneDatabase("concurrent");
    const results = await Promise.all([runCli(database), runCli(database)]);
    const emitted = results.map(({ stdout }) => appliedOutput(stdout));
    assert.deepEqual(
      emitted.map((files) => files.length).sort((a, b) => a - b),
      [0, SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2.length]
    );
    assert.deepEqual(emitted.flat(), SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2);
    assert.deepEqual(await ledger(database), SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2);
  });

  it("rejects missing GIS usage, wrong identities, owner drift, and membership drift", async () => {
    const missingGis = await cloneDatabase("missing_gis");
    await queryAs(missingGis, "trailmind_v2_admin",
      "REVOKE USAGE ON SCHEMA trailmind_gis FROM trailmind_app_owner");
    assert.match(
      (await runCliFailure(missingGis)).stderr,
      /trailmind_migration_operator_owner_contract_invalid/
    );

    const wrongSession = await cloneDatabase("wrong_session");
    assert.match((await runCliFailure(wrongSession, {
      user: "trailmind_v2_admin"
    })).stderr, /trailmind_migration_operator_owner_contract_invalid/);

    const wrongCurrent = await cloneDatabase("wrong_current");
    assert.match((await runCliFailure(wrongCurrent, {
      pgOptions: "-c role=trailmind_app_owner"
    })).stderr, /trailmind_migration_operator_owner_contract_invalid/);

    const wrongOwner = await cloneDatabase("wrong_owner");
    await queryAs(wrongOwner, "trailmind_v2_admin",
      "ALTER SCHEMA trailmind_app OWNER TO trailmind_v2_operator");
    assert.match(
      (await runCliFailure(wrongOwner)).stderr,
      /trailmind_migration_operator_owner_contract_invalid/
    );

    const missingMembership = await cloneDatabase("missing_membership");
    await maintenance.query(
      "REVOKE trailmind_app_owner FROM migration_role GRANTED BY postgres"
    );
    try {
      assert.match(
        (await runCliFailure(missingMembership)).stderr,
        /trailmind_migration_operator_owner_contract_invalid/
      );
    } finally {
      await maintenance.query(
        "GRANT trailmind_app_owner TO migration_role " +
        "WITH INHERIT FALSE, SET TRUE, ADMIN FALSE GRANTED BY postgres"
      );
    }
  });

  it("rejects every extra direct or indirect outgoing membership before ledger work", async () => {
    const cases = [
      ["benign", "NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOBYPASSRLS"],
      ["createdb", "NOLOGIN NOINHERIT NOSUPERUSER CREATEDB NOBYPASSRLS"],
      ["bypassrls", "NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB BYPASSRLS"],
      ["superuser", "NOLOGIN NOINHERIT SUPERUSER CREATEDB BYPASSRLS"]
    ];
    for (const [label, attributes] of cases) {
      const database = await cloneDatabase(`extra_membership_${label}`);
      const role = `trailmind_v2_extra_${label}`;
      await maintenance.query(`CREATE ROLE ${quoteIdentifier(role)} ${attributes}`);
      await maintenance.query(
        `GRANT ${quoteIdentifier(role)} TO migration_role ` +
        "WITH INHERIT FALSE, SET TRUE, ADMIN FALSE"
      );
      try {
        const failure = await runCliFailure(database);
        assert.equal(failure.stdout, "", label);
        assert.match(
          failure.stderr,
          /trailmind_migration_operator_owner_contract_invalid/,
          label
        );
        await assertNoRunnerResidue(database);
      } finally {
        await maintenance.query(`REVOKE ${quoteIdentifier(role)} FROM migration_role`);
        await maintenance.query(`DROP ROLE ${quoteIdentifier(role)}`);
      }
    }

    const indirectDatabase = await cloneDatabase("indirect_membership");
    await maintenance.query(
      "CREATE ROLE trailmind_v2_extra_indirect NOLOGIN NOINHERIT"
    );
    await maintenance.query(
      "GRANT trailmind_v2_extra_indirect TO trailmind_app_owner " +
      "WITH INHERIT FALSE, SET TRUE, ADMIN FALSE"
    );
    try {
      const failure = await runCliFailure(indirectDatabase);
      assert.equal(failure.stdout, "");
      assert.match(
        failure.stderr,
        /trailmind_migration_operator_owner_contract_invalid/
      );
      await assertNoRunnerResidue(indirectDatabase);
    } finally {
      await maintenance.query(
        "REVOKE trailmind_v2_extra_indirect FROM trailmind_app_owner"
      );
      await maintenance.query("DROP ROLE trailmind_v2_extra_indirect");
    }
  });

  it("rejects GIS schema owner drift before ledger work", async () => {
    const database = await cloneDatabase("gis_owner_drift");
    await queryAs(database, "trailmind_v2_admin",
      "ALTER SCHEMA trailmind_gis OWNER TO trailmind_v2_operator");
    const failure = await runCliFailure(database);
    assert.equal(failure.stdout, "");
    assert.match(
      failure.stderr,
      /trailmind_migration_operator_owner_contract_invalid|postgis_ownership_contract_invalid/
    );
    await assertNoRunnerResidue(database);
  });

  it("blocks the direct Supabase V2 CLI before any DDL, ledger, or stdout", async () => {
    const database = await cloneDatabase("direct_cli_denied");
    const failure = await runDirectCliFailure(database);
    assert.equal(failure.stdout, "");
    assert.match(failure.stderr, /trailmind_supabase_v2_operator_required/);
    await assertNoRunnerResidue(database);
  });
});

async function cloneDatabase(label) {
  const database = `trailmind_v2_${process.pid}_${label}`;
  if (!/^[a-z0-9_]+$/.test(database)) throw new TypeError("invalid test database");
  await maintenance.query(
    `CREATE DATABASE ${quoteIdentifier(database)} TEMPLATE postgres`
  );
  createdDatabases.add(database);
  return database;
}

async function createLedger(database, versions) {
  const client = await roleClient(database, "trailmind_v2_admin");
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE trailmind_app_owner");
    await client.query(`
      CREATE TABLE trailmind_app.trailmind_schema_migrations(
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
      )
    `);
    for (let index = 0; index < versions.length; index += 1) {
      await client.query(`
        INSERT INTO trailmind_app.trailmind_schema_migrations(version, applied_at)
        VALUES ($1, '2026-01-01T00:00:00Z'::timestamptz + ($2 * interval '1 second'))
      `, [versions[index], index]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function ledger(database) {
  const result = await queryAs(database, "trailmind_v2_admin", `
    SELECT version
      FROM trailmind_app.trailmind_schema_migrations
     ORDER BY applied_at, version
  `);
  return result.rows.map(({ version }) => version);
}

async function assertNoRunnerResidue(database) {
  const result = await queryAs(database, "trailmind_v2_admin", `
    SELECT pg_catalog.to_regclass(
             'trailmind_app.trailmind_schema_migrations'
           ) IS NULL AS no_ledger,
           pg_catalog.to_regclass(
             'trailmind_app.app_attest_keys'
           ) IS NULL AS no_app_attest
  `);
  assert.deepEqual(result.rows[0], { no_ledger: true, no_app_attest: true });
}

async function runCli(database, options = {}) {
  return executeFile(process.execPath, [
    "scripts/disposable/run-authorized-supabase-postgis-v2-migrations.js"
  ], {
    cwd: backendRoot,
    env: cliEnvironment(database, options),
    maxBuffer: 2 * 1024 * 1024
  });
}

async function runCliFailure(database, options = {}) {
  try {
    await runCli(database, options);
  } catch (error) {
    return {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? ""
    };
  }
  assert.fail("migration runner unexpectedly succeeded");
}

async function runDirectCliFailure(database) {
  try {
    await executeFile(process.execPath, ["scripts/migrate.js"], {
      cwd: backendRoot,
      env: cliEnvironment(database),
      maxBuffer: 2 * 1024 * 1024
    });
  } catch (error) {
    return { stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
  assert.fail("direct V2 migration CLI unexpectedly succeeded");
}

function cliEnvironment(database, { user = "postgres", pgOptions } = {}) {
  return {
    PATH: process.env.PATH,
    PGHOST: disposable.host,
    PGPORT: String(disposable.port),
    PGDATABASE: database,
    PGUSER: user,
    TRAILMIND_SUPABASE_POSTGIS_ISOLATION_V2_DISPOSABLE: "true",
    ...(pgOptions ? { PGOPTIONS: pgOptions } : {}),
    TRAILMIND_MIGRATION_POLICY: "supabase-postgis-isolation-v2"
  };
}

function appliedOutput(stdout) {
  if (stdout === "") return [];
  assert.match(stdout, /\n$/);
  return stdout.trimEnd().split("\n").map((line) => {
    assert.match(line, /^Applied [0-9]{3}_[a-z0-9_]+\.sql$/);
    return line.slice("Applied ".length);
  });
}

async function queryAs(database, user, sql) {
  const client = await roleClient(database, user);
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

async function roleClient(database, user) {
  const client = new pg.Client({ ...disposable, database, user });
  await client.connect();
  return client;
}

function quoteIdentifier(value) {
  if (!/^[a-z0-9_]+$/.test(value)) throw new TypeError("invalid identifier");
  return `"${value}"`;
}

function disposableConfiguration(env) {
  if (env.TRAILMIND_SUPABASE_POSTGIS_ISOLATION_V2_DISPOSABLE !== "true") {
    return undefined;
  }
  if (
    !env.PGHOST?.startsWith("/private/tmp/trailmind-postgis-isolation-v2.") ||
    env.PGUSER !== "trailmind_v2_admin" ||
    env.PGDATABASE !== "postgres" ||
    env.PGPASSWORD
  ) throw new TypeError("supabase_postgis_isolation_v2_disposable_invalid");
  return Object.freeze({
    host: env.PGHOST,
    port: Number(env.PGPORT),
    user: env.PGUSER
  });
}
