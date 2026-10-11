import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
} from "../../src/operations/stagingMigrationPolicy.js";

const backendRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const migrationDirectory = join(backendRoot, "migrations");
const port = 55_000 + (process.pid % 900);
const expectedNoPolicyTables = Object.freeze([
  "outdoor_import_schema_leases",
  "outdoor_research_derived_features",
  "outdoor_research_entity_aliases",
  "outdoor_research_observations"
]);
const hardenedFunctions = Object.freeze([
  "outdoor_research_deterministic_uuid_v3",
  "outdoor_research_reject_audit_mutation",
  "outdoor_research_validate_assertion_write",
  "outdoor_research_validate_derived_feature_write",
  "outdoor_research_validate_policy_timestamps",
  "outdoor_research_validate_projection_assertion",
  "outdoor_research_validate_projection_relationship",
  "outdoor_research_validate_relationship_source_class"
]);

assertPostgres17WithPostgis();
const root = await mkdtemp("/private/tmp/trailmind-dormant-supabase-hardening.");
const data = join(root, "data");
const socket = join(root, "socket");
let started = false;

try {
  run("mkdir", ["-p", socket]);
  run("initdb", [
    "-D", data, "--username=postgres", "--auth=trust", "--encoding=UTF8",
    "--no-sync"
  ]);
  run("pg_ctl", [
    "-D", data, "-l", join(root, "postgres.log"),
    "-o", `-c listen_addresses='' -c unix_socket_directories='${socket}' ` +
      `-c port=${port}`,
    "-w", "start"
  ]);
  started = true;

  await provisionRoles();
  await verifyState("empty", 0);
  await verifyState("partial", 4);
  process.stdout.write(
    "Dormant Supabase hardening disposable PostgreSQL proof completed: " +
    "empty, partial-resume, replay, RLS, role and search-path checks passed.\n"
  );
} finally {
  if (started) {
    run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], true);
  }
  await rm(root, { recursive: true, force: true });
}

async function provisionRoles() {
  const client = await connect("postgres");
  try {
    await client.query(`
      CREATE ROLE anon NOLOGIN NOINHERIT;
      CREATE ROLE authenticated NOLOGIN NOINHERIT;
      CREATE ROLE service_role NOLOGIN NOINHERIT;
      CREATE ROLE trailmind_app_owner
        NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
        NOREPLICATION NOBYPASSRLS;
      CREATE ROLE trailmind_import_schema_owner
        NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
        NOREPLICATION NOBYPASSRLS;
      CREATE ROLE regional_import_role
        NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
        NOREPLICATION NOBYPASSRLS;
      CREATE ROLE projection_role
        NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
        NOREPLICATION NOBYPASSRLS;
      CREATE ROLE app_security_runtime_role
        NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
        NOREPLICATION NOBYPASSRLS;
      CREATE ROLE outdoor_research_runtime_role
        NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
        NOREPLICATION NOBYPASSRLS;
      CREATE ROLE pruner_role
        NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
        NOREPLICATION NOBYPASSRLS;
    `);
  } finally {
    await client.end();
  }
}

async function verifyState(label, prefixLength) {
  const database = `trailmind_dormant_${process.pid}_${label}`;
  const admin = await connect("postgres");
  try {
    await admin.query(`CREATE DATABASE ${quoteIdentifier(database)}`);
  } finally {
    await admin.end();
  }
  const client = await connect(database);
  try {
    await client.query(`
      CREATE SCHEMA trailmind_gis AUTHORIZATION postgres;
      REVOKE ALL ON SCHEMA trailmind_gis FROM PUBLIC, anon, authenticated,
        service_role;
      CREATE EXTENSION postgis WITH SCHEMA trailmind_gis;
      CREATE SCHEMA trailmind_app AUTHORIZATION trailmind_app_owner;
      REVOKE ALL ON SCHEMA trailmind_app FROM PUBLIC, anon, authenticated,
        service_role;
      GRANT USAGE ON SCHEMA trailmind_gis TO trailmind_app_owner,
        regional_import_role, projection_role;
      REVOKE CREATE ON SCHEMA trailmind_gis FROM trailmind_app_owner,
        regional_import_role, projection_role;
    `);
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE trailmind_app_owner");
    await client.query(
      "SET LOCAL search_path = trailmind_app, pg_catalog, trailmind_gis, pg_temp"
    );
    await client.query(`
      CREATE TABLE trailmind_app.trailmind_schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
      )
    `);
    await client.query("COMMIT");

    await applyRange(client, 0, prefixLength);
    if (prefixLength > 0) {
      assert.deepEqual(await ledger(client),
        SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2.slice(0, prefixLength));
    }
    await applyRange(
      client,
      prefixLength,
      SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2.length
    );
    await assertCompleteState(client);

    const hardeningSql = await readFile(join(
      migrationDirectory,
      "011_pin_security_invoker_function_search_paths.sql"
    ), "utf8");
    for (let replay = 0; replay < 2; replay += 1) {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE trailmind_app_owner");
      await client.query(hardeningSql);
      await client.query("COMMIT");
    }
    await assertCompleteState(client);
  } finally {
    await client.end();
  }
}

async function applyRange(client, start, end) {
  for (let index = start; index < end; index += 1) {
    const version = SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2[index];
    assert.equal(version.startsWith("008_"), false);
    const sql = await readFile(join(migrationDirectory, version), "utf8");
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE trailmind_app_owner");
      await client.query(
        "SET LOCAL search_path = trailmind_app, pg_catalog, trailmind_gis, pg_temp"
      );
      await client.query(sql);
      await client.query("SET LOCAL ROLE trailmind_app_owner");
      await client.query(
        "INSERT INTO trailmind_app.trailmind_schema_migrations(version) VALUES ($1)",
        [version]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
}

async function assertCompleteState(client) {
  assert.deepEqual(await ledger(client), SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2);
  assert.equal((await client.query(`
    SELECT pg_catalog.count(*)::integer AS count
      FROM trailmind_app.trailmind_schema_migrations
     WHERE version LIKE '008\\_%' ESCAPE '\\'
  `)).rows[0].count, 0);

  const functions = await client.query(`
    SELECT procedure.proname, procedure.prosecdef, procedure.proconfig,
           owner.rolname AS owner
      FROM pg_catalog.pg_proc procedure
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = procedure.pronamespace
      JOIN pg_catalog.pg_roles owner ON owner.oid = procedure.proowner
     WHERE namespace.nspname = 'trailmind_app'
       AND procedure.proname = ANY($1::text[])
     ORDER BY procedure.proname
  `, [hardenedFunctions]);
  assert.deepEqual(functions.rows.map(({ proname }) => proname),
    hardenedFunctions);
  for (const fn of functions.rows) {
    assert.equal(fn.prosecdef, false, fn.proname);
    assert.equal(fn.owner, "trailmind_app_owner", fn.proname);
    assert.deepEqual(fn.proconfig, [
      "search_path=pg_catalog, trailmind_app"
    ], fn.proname);
  }

  const rlsTables = await client.query(`
    SELECT relation.relname
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'trailmind_app'
       AND relation.relkind IN ('r', 'p')
       AND relation.relname <> 'trailmind_schema_migrations'
       AND NOT relation.relrowsecurity
  `);
  assert.deepEqual(rlsTables.rows, []);

  for (const role of ["anon", "authenticated", "service_role"]) {
    const access = await client.query(`
      SELECT pg_catalog.has_schema_privilege($1, 'trailmind_app', 'USAGE')
               AS app_usage,
             pg_catalog.has_schema_privilege($1, 'trailmind_gis', 'USAGE')
               AS gis_usage,
             pg_catalog.has_table_privilege(
               $1, 'trailmind_app.outdoor_research_entities', 'SELECT'
             ) AS entity_select
    `, [role]);
    assert.deepEqual(access.rows[0], {
      app_usage: false,
      gis_usage: false,
      entity_select: false
    }, role);
  }

  const empty = await client.query(`
    SELECT
      (SELECT pg_catalog.count(*)::integer
         FROM trailmind_app.outdoor_evidence_imports) AS imports,
      (SELECT pg_catalog.count(*)::integer
         FROM trailmind_app.outdoor_research_projection_runs) AS projections,
      (SELECT pg_catalog.count(*)::integer
         FROM trailmind_app.outdoor_import_schema_leases) AS leases
  `);
  assert.deepEqual(empty.rows[0], { imports: 0, projections: 0, leases: 0 });

  // The four live advisor notices are a post-bootstrap policy property. Their
  // exact table set is source-verified separately; this executable fixture
  // proves every one still has RLS and no application data.
  assert.deepEqual(expectedNoPolicyTables, [...expectedNoPolicyTables].sort());
}

async function ledger(client) {
  const result = await client.query(`
    SELECT version
      FROM trailmind_app.trailmind_schema_migrations
     ORDER BY applied_at, version
  `);
  return result.rows.map(({ version }) => version);
}

async function connect(database) {
  const client = new pg.Client({ host: socket, port, database, user: "postgres" });
  await client.connect();
  return client;
}

function assertPostgres17WithPostgis() {
  assert.match(execFileSync("pg_config", ["--version"], {
    encoding: "utf8"
  }), /PostgreSQL 17\./);
  const shared = execFileSync("pg_config", ["--sharedir"], {
    encoding: "utf8"
  }).trim();
  execFileSync("test", ["-r", join(shared, "extension", "postgis.control")]);
}

function run(command, args, tolerateFailure = false) {
  const result = spawnSync(command, args, {
    cwd: backendRoot,
    env: { PATH: process.env.PATH, LANG: "C", LC_ALL: "C" },
    encoding: "utf8",
    maxBuffer: 32 * 1_024 * 1_024
  });
  if (result.status !== 0 && !tolerateFailure) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} failed with status ${result.status}`);
  }
}

function quoteIdentifier(value) {
  if (!/^[a-z0-9_]+$/.test(value)) throw new TypeError("invalid identifier");
  return `"${value}"`;
}
