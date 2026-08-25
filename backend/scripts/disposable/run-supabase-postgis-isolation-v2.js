import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
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

assertLocalPostgres17();
await withCluster("rollback", async (cluster) => {
  provisionManagedFixture(cluster);
  executePsqlFile(cluster, preMigration, "postgres");
  executePsql(cluster, "ALTER ROLE postgres NOSUPERUSER;", "trailmind_v2_admin");
  normalizeManagedRoleCreatorMemberships(cluster);
  runNodeTests(cluster, [
    "test/supabasePostgisIsolationV2RollbackIntegration.test.js"
  ], { PGUSER: "postgres" });
});

await withCluster("foundation", async (cluster) => {
  provisionManagedFixture(cluster);
  executePsqlFile(cluster, preMigration, "postgres");
  executePsql(cluster, "ALTER ROLE postgres NOSUPERUSER;", "trailmind_v2_admin");
  normalizeManagedRoleCreatorMemberships(cluster);
  runNodeTests(cluster, [
    "test/stagingMigrationRunnerPostgresIntegration.test.js"
  ]);

  provisionSupabaseAdminPostgisTopologyFixture(cluster);
  const providerOwnershipEnvironment = environment(cluster, {
    PGDATABASE: "trailmind_v2_17_provider_ownership",
    PGUSER: "migration_role",
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
    PGUSER: "migration_role",
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
  let started = false;
  try {
    run("mkdir", ["-p", socket], { cwd: backendRoot });
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
      "-o", `-c listen_addresses='' -c unix_socket_directories='${socket}' -c port=${port}`,
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
    CREATE ROLE supabase_admin NOLOGIN NOINHERIT;
    CREATE ROLE dashboard_user NOLOGIN NOINHERIT;
    CREATE ROLE supabase_auth_admin NOLOGIN NOINHERIT;
    CREATE ROLE supabase_storage_admin NOLOGIN NOINHERIT;
    CREATE ROLE postgres LOGIN NOINHERIT SUPERUSER
      CREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS;
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

function normalizeManagedRoleCreatorMemberships(cluster) {
  // PostgreSQL 17 gives a non-superuser CREATEROLE creator an automatic
  // ADMIN-only, non-SET membership in every role it creates. The fixture must
  // run CREATE EXTENSION as a temporary superuser for the upstream PostGIS
  // package, so recreate those documented managed-creator rows after demotion.
  executePsql(cluster, `
    GRANT platform_provisioner, migration_role, regional_import_role,
      projection_role, app_security_runtime_role,
      outdoor_research_runtime_role,
      outdoor_research_cancellation_control_role, pruner_role,
      readonly_auditor_role
    TO postgres WITH INHERIT FALSE, SET FALSE, ADMIN TRUE;
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
  executePsql(cluster,
    "ALTER ROLE supabase_admin SUPERUSER;",
    "trailmind_v2_admin"
  );
  try {
    executePsql(cluster, `
      SET ROLE supabase_admin;
      CREATE EXTENSION postgis WITH SCHEMA trailmind_gis;
      RESET ROLE;
    `, "trailmind_v2_admin", "trailmind_v2_17_provider_ownership");
  } finally {
    executePsql(cluster,
      "ALTER ROLE supabase_admin NOSUPERUSER;",
      "trailmind_v2_admin"
    );
  }
}

function runNodeTests(cluster, tests, extraEnvironment = {}) {
  run(process.execPath, [
    "--test",
    "--test-concurrency=1",
    ...tests
  ], { env: environment(cluster, extraEnvironment) });
}

function executePsqlFile(cluster, path, user) {
  run("psql", [
    "-X",
    "-v", "ON_ERROR_STOP=1",
    "-h", cluster.socket,
    "-p", String(cluster.port),
    "-U", user,
    "-d", "postgres",
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
