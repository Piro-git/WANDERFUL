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
const capacityProfileDirectory = join(
  backendRoot,
  "config/outdoor-capacity-profiles/supabase-free-bounded-two-core-v1"
);
const capacityTemporaryWorkspace = join(
  capacityProfileDirectory, "projection-temporary-workspace.sql"
);
const capacityGenerationLifecycle = join(
  capacityProfileDirectory, "capacity-generation-lifecycle.sql"
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
  executePsqlFile(cluster, capacityTemporaryWorkspace, "postgres");
  executePsqlFile(cluster, capacityGenerationLifecycle, "postgres");

  runNodeTests(cluster, [
    "test/supabasePostgisIsolationV2PostgresIntegration.test.js"
  ]);
  await runCapacityLifecycleWorkflow(cluster);
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

async function runCapacityLifecycleWorkflow(cluster) {
  const osm = join(cluster.root, "capacity-lifecycle.osm");
  const pbf = join(cluster.root, "capacity-lifecycle.osm.pbf");
  await writeFile(osm, `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="TrailMind capacity lifecycle proof">
  <node id="101" lat="47.2800" lon="11.4000" version="1" timestamp="2026-08-28T00:00:00Z">
    <tag k="tourism" v="viewpoint"/><tag k="name" v="Disposable Nordkette view"/>
  </node>
  <node id="102" lat="47.2810" lon="11.4010" version="1" timestamp="2026-08-28T00:00:00Z"/>
  <way id="110" version="1" timestamp="2026-08-28T00:00:00Z">
    <nd ref="101"/><nd ref="102"/><tag k="highway" v="path"/>
    <tag k="surface" v="ground"/><tag k="sac_scale" v="hiking"/>
    <tag k="name" v="Disposable Nordkette trail"/>
  </way>
  <relation id="120" version="1" timestamp="2026-08-28T00:00:00Z">
    <member type="way" ref="110" role=""/>
    <tag k="type" v="route"/><tag k="route" v="hiking"/>
    <tag k="name" v="Disposable Nordkette route"/>
  </relation>
</osm>
`, { mode: 0o600 });
  run("osmium", ["cat", osm, "-o", pbf, "--overwrite"], {
    cwd: backendRoot,
    capture: true
  });

  const projectionEnvironment = environment(cluster, {
    PGUSER: "projection_role",
    DATABASE_URL: roleUrl(cluster, "projection_role")
  });
  const configured = run(process.execPath, [
    "scripts/configure-osm-outdoor-research-policy.js",
    "--mode", "activate",
    "--policy-version", "osm-foundational-mapped-v1",
    "--operator-confirmation", "activate-reviewed-osm-mapped-policy",
    "--review-reference", "urn:trailmind:disposable-capacity-review",
    "--reviewed-at", "2026-08-28T00:30:00Z"
  ], { env: projectionEnvironment, capture: true });
  if (configured.stderr !== "" ||
      JSON.parse(configured.stdout).lifecycleState !== "active") {
    throw new Error("capacity policy activation failed");
  }

  assertActualDatabaseCapacityRefusal(cluster, pbf);
  const beforeFirstImportBytes = Number(executePsqlScalar(
    cluster, "SELECT pg_catalog.pg_database_size(pg_catalog.current_database())",
    "postgres"
  ));
  const firstImport = runCapacityImport(cluster, pbf, 1);
  if (firstImport.admission.measurements.currentDatabaseBytes !==
      beforeFirstImportBytes) {
    throw new Error("capacity admission did not use actual pg_database_size");
  }
  assertCapacityDirectMutationDenial(cluster, firstImport.importId);
  const firstProjection = runCapacityProjection(
    cluster, firstImport.importId, false
  );
  if (firstProjection.status !== "active" ||
      firstProjection.capacityAdmission?.decision !== "ADMITTED" ||
      firstProjection.counts?.quarantined !== 0) {
    throw new Error("first capacity projection failed");
  }
  const repeatedProjection = runCapacityProjection(
    cluster, firstImport.importId, false
  );
  if (repeatedProjection.status !== "unchanged") {
    throw new Error("repeated capacity projection was not a true no-op");
  }

  const secondImport = runCapacityImport(cluster, pbf, 2);
  const secondProjection = runCapacityProjection(
    cluster, secondImport.importId, false
  );
  if (secondProjection.status !== "active" ||
      secondProjection.counts?.quarantined !== 0) {
    throw new Error("second capacity projection failed");
  }

  const rejectedThird = run(process.execPath, capacityImportArguments(pbf, 3), {
    env: capacityImportEnvironment(cluster),
    capture: true,
    tolerateFailure: true
  });
  const refusal = JSON.parse(rejectedThird.stderr.trim());
  if (rejectedThird.status === 0 || refusal.decision !== "GENERATION_LIMIT") {
    throw new Error("third retained generation was not refused before mutation");
  }
  assertCapacityGenerationCounts(cluster, 2, 2, firstImport.importId,
    firstProjection.projectionRunId, secondImport.importId,
    secondProjection.projectionRunId);

  assertCapacityCrossRegionAndActiveDenial(
    cluster,
    firstImport.importId,
    firstProjection.projectionRunId,
    secondImport.importId,
    secondProjection.projectionRunId
  );

  const rollback = runCapacityRetirement(cluster, {
    importId: firstImport.importId,
    projectionRunId: firstProjection.projectionRunId,
    commit: false
  });
  if (rollback.status !== "rolled_back" ||
      rollback.retirement?.activeGenerationPreserved !== true) {
    throw new Error("capacity retirement rollback proof failed");
  }
  assertCapacityGenerationCounts(cluster, 2, 2, firstImport.importId,
    firstProjection.projectionRunId, secondImport.importId,
    secondProjection.projectionRunId);

  const committed = runCapacityRetirement(cluster, {
    importId: firstImport.importId,
    projectionRunId: firstProjection.projectionRunId,
    commit: true
  });
  if (committed.status !== "committed" ||
      committed.retirement?.retainedGenerationsAfter !== 1) {
    throw new Error("capacity retirement commit proof failed");
  }
  assertCapacityGenerationCounts(cluster, 1, 1, null, null,
    secondImport.importId, secondProjection.projectionRunId);

  const thirdImport = runCapacityImport(cluster, pbf, 3);
  const thirdProjection = runCapacityProjection(
    cluster, thirdImport.importId, false
  );
  if (thirdProjection.status !== "active" ||
      thirdProjection.counts?.quarantined !== 0) {
    throw new Error("post-retirement refresh failed");
  }
  assertCapacityGenerationCounts(cluster, 2, 2,
    secondImport.importId, secondProjection.projectionRunId,
    thirdImport.importId, thirdProjection.projectionRunId);
}

function assertCapacityDirectMutationDenial(cluster, importId) {
  const rejectedImportId = "00000000-0000-4000-8000-000000000099";
  executePsql(cluster, `
    DO $proof$
    BEGIN
      BEGIN
        INSERT INTO trailmind_app.outdoor_evidence_imports
          (import_id, region_id, source_dataset_name, source_identifier,
           source_data_at, retrieved_at, imported_at, tool_version,
           import_schema_version, status, aggregate_counts,
           acquisition_channel, source_checksum_algorithm, source_checksum,
           source_checksum_verified_at, input_file_sha256)
        SELECT '${rejectedImportId}'::uuid, region_id,
               'Rejected direct capacity mutation',
               'urn:trailmind:rejected-direct-capacity-mutation',
               source_data_at, retrieved_at, imported_at, tool_version,
               import_schema_version, 'loading', '{}'::jsonb,
               acquisition_channel, source_checksum_algorithm, source_checksum,
               source_checksum_verified_at, input_file_sha256
          FROM trailmind_app.outdoor_evidence_imports
         WHERE import_id = '${importId}'::uuid;
        RAISE EXCEPTION 'direct capacity mutation was accepted';
      EXCEPTION WHEN SQLSTATE '55000' THEN
        IF SQLERRM <> 'Capacity generation mutation lacks an admitted lease' THEN
          RAISE;
        END IF;
      END;
      IF EXISTS (
        SELECT 1 FROM trailmind_app.outdoor_evidence_imports
         WHERE import_id = '${rejectedImportId}'::uuid
      ) THEN
        RAISE EXCEPTION 'direct capacity denial mutated imports';
      END IF;
    END
    $proof$;
  `, "regional_import_role");
}

function assertActualDatabaseCapacityRefusal(cluster, pbf) {
  const refusalThreshold = 500_000_000 - 40_000_000 - 43_794_432;
  executePsql(cluster, `
    SET ROLE trailmind_app_owner;
    CREATE TABLE trailmind_app.outdoor_capacity_refusal_padding_v1 (
      ordinal bigint NOT NULL,
      payload text NOT NULL
    );
    RESET ROLE;
  `, "postgres");
  let rows = 0;
  let measuredBytes = Number(executePsqlScalar(
    cluster, "SELECT pg_catalog.pg_database_size(pg_catalog.current_database())",
    "postgres"
  ));
  while (measuredBytes <= refusalThreshold && rows < 2_100_000) {
    const start = rows + 1;
    rows += 300_000;
    executePsql(cluster, `
      SET ROLE trailmind_app_owner;
      INSERT INTO trailmind_app.outdoor_capacity_refusal_padding_v1
        (ordinal, payload)
      SELECT value,
             md5(value::text || ':1') || md5(value::text || ':2') ||
             md5(value::text || ':3') || md5(value::text || ':4') ||
             md5(value::text || ':5') || md5(value::text || ':6') ||
             md5(value::text || ':7') || md5(value::text || ':8')
        FROM pg_catalog.generate_series(${start}, ${rows}) value;
      RESET ROLE;
    `, "postgres");
    measuredBytes = Number(executePsqlScalar(
      cluster, "SELECT pg_catalog.pg_database_size(pg_catalog.current_database())",
      "postgres"
    ));
  }
  if (measuredBytes <= refusalThreshold) {
    throw new Error("actual pg_database_size refusal fixture was too small");
  }

  const rejected = run(process.execPath, capacityImportArguments(pbf, 0), {
    env: capacityImportEnvironment(cluster),
    capture: true,
    tolerateFailure: true
  });
  const refusal = JSON.parse(rejected.stderr.trim());
  if (rejected.status === 0 || refusal.decision !== "PLATFORM_LIMIT" ||
      refusal.measurements?.currentDatabaseBytes !== measuredBytes) {
    throw new Error("actual pg_database_size capacity refusal was not fail-closed");
  }
  executePsql(cluster, `
    SET ROLE trailmind_app_owner;
    DO $proof$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM trailmind_app.outdoor_evidence_imports
         WHERE region_id = 'innsbruck-alps-v1'
      ) THEN
        RAISE EXCEPTION 'capacity refusal mutated imports';
      END IF;
    END
    $proof$;
    DROP TABLE trailmind_app.outdoor_capacity_refusal_padding_v1;
    RESET ROLE;
  `, "postgres");
  const afterDropBytes = Number(executePsqlScalar(
    cluster, "SELECT pg_catalog.pg_database_size(pg_catalog.current_database())",
    "postgres"
  ));
  if (afterDropBytes >= measuredBytes) {
    throw new Error("capacity refusal padding cleanup was not observed");
  }
}

function runCapacityImport(cluster, pbf, generation) {
  const result = run(process.execPath, capacityImportArguments(pbf, generation), {
    env: capacityImportEnvironment(cluster),
    capture: true
  });
  if (result.stderr !== "") throw new Error("capacity import wrote stderr");
  const lines = result.stdout.trim().split("\n");
  const admission = JSON.parse(lines[0]);
  const match = result.stdout.match(
    /Outdoor evidence import ([0-9a-f-]+) is active:/
  );
  if (admission.decision !== "ADMITTED" || !match) {
    throw new Error("capacity import output was invalid");
  }
  return Object.freeze({ admission, importId: match[1] });
}

function capacityImportArguments(pbf, generation) {
  return [
    "scripts/import-outdoor-evidence.js",
    "--region", "innsbruck-alps-v1",
    "--pbf", pbf,
    "--dataset-name", `Disposable capacity generation ${generation}`,
    "--source-id", `urn:trailmind:capacity-generation:${generation}`,
    "--retrieved-at", `2026-08-28T0${generation}:00:00Z`,
    "--source-timestamp", "2026-08-28T00:00:00Z",
    "--acquisition-channel", "operator_supplied_local",
    "--staging-profile", "supabase-free-bounded-two-core-v1"
  ];
}

function capacityImportEnvironment(cluster) {
  return environment(cluster, {
    PGUSER: "regional_import_role",
    DATABASE_URL: roleUrl(cluster, "regional_import_role")
  });
}

function runCapacityProjection(cluster, importId, dryRun) {
  const result = run(process.execPath, [
    "scripts/project-osm-outdoor-research.js",
    "--region", "innsbruck-alps-v1",
    "--import-id", importId,
    "--policy-version", "osm-foundational-mapped-v1",
    "--operator-confirmation", "project-reviewed-osm-mapped-facts",
    "--dry-run", String(dryRun),
    "--staging-profile", "supabase-free-bounded-two-core-v1"
  ], {
    env: environment(cluster, {
      PGUSER: "projection_role",
      DATABASE_URL: roleUrl(cluster, "projection_role")
    }),
    capture: true
  });
  if (result.stderr !== "") throw new Error("capacity projection wrote stderr");
  return JSON.parse(result.stdout);
}

function runCapacityRetirement(cluster, { importId, projectionRunId, commit }) {
  const result = run(process.execPath, [
    "scripts/retire-outdoor-evidence-generation.js",
    "--profile", "supabase-free-bounded-two-core-v1",
    "--region", "innsbruck-alps-v1",
    "--import-id", importId,
    "--projection-run-id", projectionRunId,
    "--operator-confirmation",
    "RETIRE_SUPERSEDED_OUTDOOR_EVIDENCE_GENERATION_V1",
    "--commit", String(commit)
  ], {
    env: environment(cluster, {
      PGUSER: "postgres",
      DATABASE_URL: roleUrl(cluster, "postgres")
    }),
    capture: true,
    tolerateFailure: true
  });
  if (result.status !== 0) {
    throw new Error(`capacity retirement failed: ${result.stderr.trim()}`);
  }
  if (result.stderr !== "") throw new Error("capacity retirement wrote stderr");
  return JSON.parse(result.stdout);
}

function assertCapacityCrossRegionAndActiveDenial(
  cluster,
  oldestImportId,
  oldestRunId,
  activeImportId,
  activeRunId
) {
  executePsql(cluster, `
    SET ROLE trailmind_app_owner;
    DO $proof$
    BEGIN
      BEGIN
        PERFORM trailmind_app.retire_superseded_outdoor_generation_v1(
          'supabase-free-bounded-two-core-v1',
          'c5da9580a96eba5d18aeb8f8346926c016b71b8fd2340002529a1cb03c7e2afc',
          'harz-v1', '${oldestImportId}'::uuid, '${oldestRunId}'::uuid,
          'RETIRE_SUPERSEDED_OUTDOOR_EVIDENCE_GENERATION_V1'
        );
        RAISE EXCEPTION 'cross-region retirement was accepted';
      EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
      END;
      BEGIN
        PERFORM trailmind_app.retire_superseded_outdoor_generation_v1(
          'supabase-free-bounded-two-core-v1',
          'c5da9580a96eba5d18aeb8f8346926c016b71b8fd2340002529a1cb03c7e2afc',
          'innsbruck-alps-v1', '${activeImportId}'::uuid, '${activeRunId}'::uuid,
          'RETIRE_SUPERSEDED_OUTDOOR_EVIDENCE_GENERATION_V1'
        );
        RAISE EXCEPTION 'active-generation retirement was accepted';
      EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
      END;
    END
    $proof$;
    RESET ROLE;
  `, "postgres");
}

function assertCapacityGenerationCounts(
  cluster,
  imports,
  runs,
  oldestImportId,
  oldestRunId,
  activeImportId,
  activeRunId
) {
  executePsql(cluster, `
    SET ROLE trailmind_app_owner;
    DO $proof$
    BEGIN
      IF (SELECT pg_catalog.count(*)
            FROM trailmind_app.outdoor_evidence_imports
           WHERE region_id = 'innsbruck-alps-v1'
             AND status IN ('active', 'superseded')) <> ${imports} OR
         (SELECT pg_catalog.count(*)
            FROM trailmind_app.outdoor_research_projection_runs
           WHERE region_id = 'innsbruck-alps-v1'
             AND status IN ('active', 'superseded')) <> ${runs} OR
         (SELECT active_import_id
            FROM trailmind_app.outdoor_evidence_regions
           WHERE region_id = 'innsbruck-alps-v1') <>
             '${activeImportId}'::uuid OR
         NOT EXISTS (
           SELECT 1
             FROM trailmind_app.outdoor_research_projection_runs
            WHERE projection_run_id = '${activeRunId}'::uuid
              AND input_import_id = '${activeImportId}'::uuid
              AND status = 'active'
         ) OR
         (SELECT pg_catalog.count(*)
            FROM trailmind_app.outdoor_research_projection_quarantines
           WHERE projection_run_id IN (
             SELECT projection_run_id
               FROM trailmind_app.outdoor_research_projection_runs
              WHERE region_id = 'innsbruck-alps-v1'
           )) <> 0 OR
         ${oldestImportId === null ? "false" : `NOT EXISTS (
           SELECT 1 FROM trailmind_app.outdoor_evidence_imports
            WHERE import_id = '${oldestImportId}'::uuid
         )`} OR
         ${oldestRunId === null ? "false" : `NOT EXISTS (
           SELECT 1 FROM trailmind_app.outdoor_research_projection_runs
            WHERE projection_run_id = '${oldestRunId}'::uuid
         )`} THEN
        RAISE EXCEPTION 'capacity generation lifecycle state mismatch';
      END IF;
    END
    $proof$;
    RESET ROLE;
  `, "postgres");
}

function roleUrl(cluster, role) {
  return `postgresql://${role}@127.0.0.1:${cluster.port}/postgres?sslmode=disable`;
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
    "--acquisition-channel", "operator_supplied_local",
    "--staging-profile", "supabase-free-bounded-two-core-v1"
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
           WHERE region_id = 'harz-v1' AND status = 'active') <> 1 OR
         (SELECT pg_catalog.count(*)
            FROM trailmind_app.outdoor_evidence_trail_segments
           WHERE region_id = 'harz-v1') <> 1 OR
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

function executePsqlScalar(cluster, sql, user, database = "postgres") {
  const result = spawnSync("psql", [
    "-X", "-A", "-t",
    "-v", "ON_ERROR_STOP=1",
    "-h", cluster.socket,
    "-p", String(cluster.port),
    "-U", user,
    "-d", database,
    "-c", sql
  ], {
    cwd: backendRoot,
    env: environment(cluster),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    throw new Error(`psql scalar failed with status ${result.status}`);
  }
  return result.stdout.trim();
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
