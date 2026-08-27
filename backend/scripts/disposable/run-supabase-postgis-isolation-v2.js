import { execFileSync, spawnSync } from "node:child_process";
import {
  chmod, copyFile, mkdtemp, rm, stat, writeFile
} from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const repositoryRoot = dirname(backendRoot);
const preMigration = join(
  repositoryRoot,
  "docs/operations/staging-v1/database/PHASE_1_PRE_MIGRATION_V2.sql"
);
const postMigration = join(
  repositoryRoot,
  "docs/operations/staging-v1/database/PHASE_1_POST_MIGRATION_V2.sql"
);
const port = 55_347;
const recoveryFixture = Object.freeze({
  runId: "00000000-0000-4000-8000-000000000010",
  authorizationDigest: "a".repeat(64),
  candidateCommit: "b".repeat(40),
  candidateTree: "c".repeat(40),
  operatorDigest: "d".repeat(64),
  providerDigest: "e".repeat(64)
});
const supautilsLibrary = await requiredSupautilsLibrary();

assertLocalPostgres17();
await withCluster("rollback", async (cluster) => {
  provisionManagedFixture(cluster);
  executePsqlFile(cluster, preMigration, "postgres");
  runNodeTests(cluster, [
    "test/supabasePostgisIsolationV2RollbackIntegration.test.js"
  ], {
    PGUSER: "postgres",
    TRAILMIND_PHASE1_V2_FIXTURE_RUN_ID: recoveryFixture.runId,
    TRAILMIND_PHASE1_V2_FIXTURE_AUTHORIZATION_DIGEST:
      recoveryFixture.authorizationDigest,
    TRAILMIND_PHASE1_V2_FIXTURE_CANDIDATE_COMMIT:
      recoveryFixture.candidateCommit,
    TRAILMIND_PHASE1_V2_FIXTURE_CANDIDATE_TREE:
      recoveryFixture.candidateTree,
    TRAILMIND_PHASE1_V2_FIXTURE_OPERATOR_DIGEST:
      recoveryFixture.operatorDigest,
    TRAILMIND_PHASE1_V2_FIXTURE_PROVIDER_DIGEST:
      recoveryFixture.providerDigest
  });
});

await withCluster("foundation", async (cluster) => {
  provisionManagedFixture(cluster);
  executePsqlFile(cluster, preMigration, "postgres");
  runNodeTests(cluster, [
    "test/stagingMigrationRunnerPostgresIntegration.test.js"
  ]);

  provisionSupabaseAdminPostgisTopologyFixture(cluster);
  const providerOwnershipEnvironment = environment(cluster, {
    PGDATABASE: "trailmind_v2_17_provider_ownership",
    PGUSER: "postgres",
    TRAILMIND_MIGRATION_POLICY: "supabase-postgis-isolation-v2"
  });
  run("node", [
    "scripts/disposable/run-authorized-supabase-postgis-v2-migrations.js"
  ], { env: providerOwnershipEnvironment });
  const providerOwnershipNoOp = run("node", [
    "scripts/disposable/run-authorized-supabase-postgis-v2-migrations.js"
  ], {
    env: {
      ...providerOwnershipEnvironment,
      TRAILMIND_DISPOSABLE_MIGRATION_PURPOSE: "verify-noop"
    },
    capture: true
  });
  if (providerOwnershipNoOp.stdout !== "" || providerOwnershipNoOp.stderr !== "") {
    throw new Error("provider-owned V2 second run was not a zero-output no-op");
  }
  runNodeTests(cluster, [
    "test/stagingMigrationRunnerProviderOwnershipPostgresIntegration.test.js"
  ], {
    PGDATABASE: "trailmind_v2_17_provider_ownership"
  });

  const migrationEnvironment = environment(cluster, {
    PGUSER: "postgres",
    TRAILMIND_MIGRATION_POLICY: "supabase-postgis-isolation-v2"
  });
  run("node", [
    "scripts/disposable/run-authorized-supabase-postgis-v2-migrations.js"
  ], { env: migrationEnvironment });
  const noOp = run("node", [
    "scripts/disposable/run-authorized-supabase-postgis-v2-migrations.js"
  ], {
    env: {
      ...migrationEnvironment,
      TRAILMIND_DISPOSABLE_MIGRATION_PURPOSE: "verify-noop"
    },
    capture: true
  });
  if (noOp.stdout !== "" || noOp.stderr !== "") {
    throw new Error("V2 second migration run was not a zero-output no-op");
  }

  executePsqlFile(cluster, postMigration, "postgres");

  runNodeTests(cluster, [
    "test/supabasePostgisIsolationV2PostgresIntegration.test.js"
  ]);
  await runRealImporterWorkflow(cluster);

  executePsql(cluster, `
    CREATE DATABASE trailmind_portable_test
      WITH TEMPLATE template0 OWNER trailmind_v2_admin;
  `, "trailmind_v2_admin", "template1");
  const disposableUrl = postgresUrl(cluster, "trailmind_portable_test");
  run("npm", ["run", "test:postgres-integration"], {
    env: environment(cluster, {
      TRAILMIND_TEST_DATABASE_URL: disposableUrl,
      TRAILMIND_TEST_POSTGIS_DATABASE_URL: disposableUrl
    })
  });
});

process.stdout.write("Supabase PostGIS isolation V2 disposable proof completed.\n");

async function withCluster(label, operation) {
  const root = await mkdtemp(`/private/tmp/trailmind-postgis-isolation-v2.${label}.`);
  const data = join(root, "data");
  const socket = join(root, "socket");
  const localSupautilsLibrary = join(
    root, `supautils${extname(supautilsLibrary)}`
  );
  let started = false;
  try {
    run("mkdir", ["-p", socket], { cwd: backendRoot });
    await copyFile(supautilsLibrary, localSupautilsLibrary);
    await chmod(localSupautilsLibrary, 0o500);
    run("initdb", [
      "-D", data,
      "--username=trailmind_v2_admin",
      "--auth=trust",
      "--encoding=UTF8",
      "--no-sync"
    ], { cwd: backendRoot });
    run("pg_ctl", [
      "-D", data,
      "-l", join(root, "postgres.log"),
      "-o", `-c listen_addresses=127.0.0.1 ` +
        `-c unix_socket_directories='${socket}' -c port=${port} ` +
        `-c dynamic_library_path='${root}' ` +
        `-c shared_preload_libraries=supautils ` +
        `-c supautils.privileged_role=postgres ` +
        `-c supautils.superuser=supabase_admin ` +
        `-c supautils.privileged_extensions_superuser=supabase_admin ` +
        `-c supautils.privileged_extensions=postgis`,
      "-w",
      "start"
    ], { cwd: backendRoot });
    started = true;
    await operation(Object.freeze({ root, data, socket, port }));
  } finally {
    if (started) {
      run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], {
        cwd: backendRoot,
        tolerateFailure: true
      });
    }
    await rm(root, { recursive: true, force: true });
  }
}

function provisionManagedFixture(cluster) {
  executePsql(cluster, `
    CREATE ROLE anon NOLOGIN NOINHERIT;
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
    CREATE ROLE service_role LOGIN NOINHERIT;
    CREATE ROLE authenticator NOLOGIN NOINHERIT;
    CREATE ROLE supabase_admin NOLOGIN NOINHERIT SUPERUSER;
    CREATE ROLE dashboard_user NOLOGIN NOINHERIT;
    CREATE ROLE supabase_auth_admin NOLOGIN NOINHERIT;
    CREATE ROLE supabase_storage_admin NOLOGIN NOINHERIT;
    CREATE ROLE postgres LOGIN NOINHERIT NOSUPERUSER
      CREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS;
    GRANT pg_signal_backend TO postgres
      WITH INHERIT FALSE, SET FALSE, ADMIN TRUE;
    GRANT pg_read_all_settings TO postgres
      WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;
    CREATE ROLE trailmind_v2_operator LOGIN NOINHERIT NOSUPERUSER
      CREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS;
    ALTER DATABASE postgres OWNER TO postgres;
    CREATE SCHEMA extensions AUTHORIZATION postgres;
    GRANT USAGE ON SCHEMA extensions TO PUBLIC;
    CREATE FUNCTION extensions.fixture_extension_routine()
      RETURNS integer
      LANGUAGE sql
      IMMUTABLE
      AS 'SELECT 1';
    ALTER FUNCTION extensions.fixture_extension_routine()
      OWNER TO supabase_admin;
    GRANT EXECUTE ON FUNCTION extensions.fixture_extension_routine()
      TO PUBLIC;
  `, "trailmind_v2_admin");
}

function provisionSupabaseAdminPostgisTopologyFixture(cluster) {
  executePsql(cluster, `
    CREATE DATABASE trailmind_v2_17_provider_ownership
      WITH TEMPLATE template0 OWNER postgres;
  `, "trailmind_v2_admin", "template1");
  executePsql(cluster, `
    CREATE SCHEMA extensions AUTHORIZATION postgres;
    GRANT USAGE ON SCHEMA extensions TO PUBLIC;
    CREATE SCHEMA trailmind_app AUTHORIZATION trailmind_app_owner;
    CREATE SCHEMA trailmind_gis AUTHORIZATION postgres;
    REVOKE ALL ON SCHEMA trailmind_app, trailmind_gis FROM PUBLIC;
    GRANT USAGE ON SCHEMA trailmind_gis TO trailmind_app_owner;
  `, "trailmind_v2_admin", "trailmind_v2_17_provider_ownership");
  executePsql(cluster, `
    SET ROLE supabase_admin;
    CREATE EXTENSION postgis WITH SCHEMA trailmind_gis;
    RESET ROLE;
  `, "trailmind_v2_admin", "trailmind_v2_17_provider_ownership");
}

function runNodeTests(cluster, tests, extraEnvironment = {}) {
  run(process.execPath, [
    "--test",
    "--test-concurrency=1",
    ...tests
  ], { env: environment(cluster, extraEnvironment) });
}

async function runRealImporterWorkflow(cluster) {
  const osm = join(cluster.root, "bounded-import.osm");
  const pbf = join(cluster.root, "bounded-import.osm.pbf");
  await writeFile(osm, `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="TrailMind disposable proof">
  <node id="1" lat="51.8000" lon="10.6180" version="1" timestamp="2026-08-28T00:00:00Z"/>
  <node id="2" lat="51.8010" lon="10.6190" version="1" timestamp="2026-08-28T00:00:00Z"/>
  <way id="10" version="1" timestamp="2026-08-28T00:00:00Z">
    <nd ref="1"/><nd ref="2"/><tag k="highway" v="path"/>
    <tag k="name" v="Disposable bounded import trail"/>
  </way>
</osm>
`, { mode: 0o600 });
  run("osmium", ["cat", osm, "-o", pbf, "--overwrite"], {
    cwd: backendRoot,
    capture: true
  });
  const imported = run(process.execPath, [
    "scripts/import-outdoor-evidence.js",
    "--region", "harz-v1",
    "--pbf", pbf,
    "--dataset-name", "Disposable bounded import proof",
    "--source-id", "urn:trailmind:disposable-bounded-import",
    "--retrieved-at", "2026-08-28T00:00:00Z",
    "--source-timestamp", "2026-08-28T00:00:00Z",
    "--acquisition-channel", "operator_supplied_local"
  ], {
    env: environment(cluster, {
      PGUSER: "regional_import_role",
      DATABASE_URL:
        `postgresql://regional_import_role@127.0.0.1:${cluster.port}/postgres` +
        "?sslmode=disable"
    }),
    capture: true
  });
  if (
    !/Outdoor evidence import [0-9a-f-]+ is active: 0 POIs, 1 trail segments, 0 mapped hiking relations\.\n$/
      .test(imported.stdout ?? "") ||
    imported.stderr !== ""
  ) throw new Error("bounded importer workflow output was invalid");
  const proof = executePsql(cluster, `
    DO $proof$
    BEGIN
      IF (SELECT pg_catalog.count(*) FROM trailmind_app.outdoor_evidence_imports
           WHERE status = 'active') <> 1 OR
         (SELECT pg_catalog.count(*) FROM trailmind_app.outdoor_evidence_trail_segments) <> 1 OR
         EXISTS (SELECT 1 FROM pg_catalog.pg_namespace
                  WHERE nspname LIKE 'outdoor_import\\_%' ESCAPE '\\') OR
         EXISTS (SELECT 1 FROM trailmind_app.outdoor_import_schema_leases
                  WHERE released_at IS NULL) THEN
        RAISE EXCEPTION 'bounded importer workflow cleanup failed';
      END IF;
    END
    $proof$;
  `, "trailmind_v2_admin");
  if (proof !== undefined) throw new Error("unexpected importer proof result");
}

function executePsqlFile(cluster, path, user) {
  const recoverySettings = path === preMigration ? [
    "-c", `SET trailmind.phase1_v2_run_id = '${recoveryFixture.runId}'`,
    "-c", `SET trailmind.phase1_v2_authorization_binding_digest = '${recoveryFixture.authorizationDigest}'`,
    "-c", `SET trailmind.phase1_v2_candidate_commit = '${recoveryFixture.candidateCommit}'`,
    "-c", `SET trailmind.phase1_v2_candidate_tree = '${recoveryFixture.candidateTree}'`,
    "-c", `SET trailmind.phase1_v2_operator_digests_digest = '${recoveryFixture.operatorDigest}'`,
    "-c", `SET trailmind.phase1_v2_provider_acl_restore_plan_digest = '${recoveryFixture.providerDigest}'`
  ] : [];
  run("psql", [
    "-X",
    "-v", "ON_ERROR_STOP=1",
    "-h", cluster.socket,
    "-p", String(cluster.port),
    "-U", user,
    "-d", "postgres",
    ...recoverySettings,
    "-f", path
  ], { cwd: backendRoot });
}

function executePsql(cluster, sql, user, database = "postgres") {
  const result = spawnSync("psql", [
    "-X",
    "-v", "ON_ERROR_STOP=1",
    "-h", cluster.socket,
    "-p", String(cluster.port),
    "-U", user,
    "-d", database
  ], {
    cwd: backendRoot,
    env: environment(cluster),
    input: sql,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    throw new Error(`psql fixture failed with status ${result.status}`);
  }
}

function environment(cluster, extra = {}) {
  return {
    PATH: process.env.PATH,
    LANG: "C",
    LC_ALL: "C",
    PGHOST: cluster.socket,
    PGPORT: String(cluster.port),
    PGDATABASE: "postgres",
    PGUSER: "trailmind_v2_admin",
    TRAILMIND_SUPABASE_POSTGIS_ISOLATION_V2_DISPOSABLE: "true",
    ...extra
  };
}

function postgresUrl(cluster, database) {
  return `postgresql://trailmind_v2_admin@localhost:${cluster.port}/${database}` +
    `?host=${encodeURIComponent(cluster.socket)}`;
}

function assertLocalPostgres17() {
  const version = execFileSync("pg_config", ["--version"], {
    encoding: "utf8"
  }).trim();
  if (!/^PostgreSQL 17\./.test(version)) {
    throw new Error(`PostgreSQL 17 is required; found ${version}`);
  }
  const sharedDirectory = execFileSync("pg_config", ["--sharedir"], {
    encoding: "utf8"
  }).trim();
  const control = join(sharedDirectory, "extension", "postgis.control");
  try {
    execFileSync("test", ["-r", control]);
  } catch {
    throw new Error("PostGIS for the active PostgreSQL 17 installation is required");
  }
}

async function requiredSupautilsLibrary() {
  const requested = process.env.TRAILMIND_SUPAUTILS_LIBRARY_PATH;
  if (typeof requested !== "string" || requested.length === 0) {
    throw new Error(
      "TRAILMIND_SUPAUTILS_LIBRARY_PATH is required for PostgreSQL proof"
    );
  }
  const library = resolve(requested);
  const metadata = await stat(library);
  if (!metadata.isFile() || !/^supautils\.(?:dylib|so)$/.test(basename(library))) {
    throw new Error("the official PostgreSQL 17 supautils library is required");
  }
  return library;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? backendRoot,
    env: options.env ?? { PATH: process.env.PATH, LANG: "C", LC_ALL: "C" },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
  if (!options.capture) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.status !== 0 && !options.tolerateFailure) {
    throw new Error(`${command} failed with status ${result.status}`);
  }
  return result;
}
