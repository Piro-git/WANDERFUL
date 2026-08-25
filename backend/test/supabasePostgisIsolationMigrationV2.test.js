import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { runMigrationPolicy } from "../src/operations/migrationRunner.js";
import {
  HISTORICAL_PORTABLE_MIGRATIONS_V1,
  SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2,
  requiredMigrationPolicy
} from "../src/operations/stagingMigrationPolicy.js";

const historicalMigrationURL = new URL(
  "../migrations/008_outdoor_research_runtime_read_contract.sql",
  import.meta.url
);
const isolatedMigrationURL = new URL(
  "../migrations/009_supabase_postgis_isolated_runtime_read_contract.sql",
  import.meta.url
);
const migrationRunnerURL = new URL(
  "../src/operations/migrationRunner.js",
  import.meta.url
);

describe("Supabase PostGIS isolation migration policy V2", () => {
  it("preserves historical 008 and selects a mutually exclusive V2 ledger", async () => {
    assert.deepEqual(HISTORICAL_PORTABLE_MIGRATIONS_V1.slice(-1), [
      "008_outdoor_research_runtime_read_contract.sql"
    ]);
    assert.deepEqual(SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2, [
      "001_app_attest.sql",
      "002_outdoor_evidence.sql",
      "003_outdoor_research_graph.sql",
      "004_osm_outdoor_research_projection.sql",
      "005_outdoor_research_projection_geometry.sql",
      "006_outdoor_route_membership_point_index.sql",
      "007_routable_highlight_access_geography_index.sql",
      "009_supabase_postgis_isolated_runtime_read_contract.sql"
    ]);
    assert.equal(
      createHash("sha256").update(await readFile(historicalMigrationURL)).digest("hex"),
      "e568e6ea65bd0d6f96fd20f636efcbb42700c55856ea3f19d1955b6a9e415b32"
    );
    assert.throws(() => requiredMigrationPolicy({}), /migration_policy_required/);
    assert.throws(() => requiredMigrationPolicy({
      TRAILMIND_MIGRATION_POLICY: "toString"
    }), /migration_policy_required/);
  });

  it("changes topology and ownership assertions without changing five SQL bodies", async () => {
    const historical = await readFile(historicalMigrationURL, "utf8");
    const isolated = await readFile(isolatedMigrationURL, "utf8");
    assert.deepEqual(functionBodies(isolated), functionBodies(historical));
    assert.equal(functionBodies(isolated).length, 5);
    assert.match(isolated, /PostGIS must already be installed directly in trailmind_gis/);
    assert.match(isolated, /pg_catalog,trailmind_app,trailmind_gis,pg_temp/);
    assert.doesNotMatch(isolated, /CREATE EXTENSION/);
    assert.doesNotMatch(isolated, /WITH SCHEMA public/);
    assert.equal((isolated.match(/^SECURITY DEFINER$/gm) ?? []).length, 5);
    assert.equal((isolated.match(/REVOKE ALL ON FUNCTION/g) ?? []).length, 5);
  });

  it("rejects injected policy filenames before filesystem or database access", async () => {
    let accessed = false;
    let queried = false;
    await assert.rejects(runMigrationPolicy({
      client: { async query() { queried = true; } },
      migrationDirectory: "/not-used",
      migrationPolicy: {
        policyId: "supabase-postgis-isolation-v2",
        migrations: ["../../operator-controlled.sql"]
      },
      async fileAccess() { accessed = true; },
      async fileRead() { accessed = true; }
    }), /migration_policy_invalid/);
    assert.equal(accessed, false);
    assert.equal(queried, false);
  });

  it("keeps PostGIS direct-install and no-version clauses in the V2 operator pre-step", async () => {
    const pre = await readFile(new URL(
      "../../docs/operations/staging-v1/database/PHASE_1_PRE_MIGRATION_V2.sql",
      import.meta.url
    ), "utf8");
    assert.match(pre, /CREATE SCHEMA trailmind_gis;/);
    assert.match(pre, /CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA trailmind_gis;/);
    assert.doesNotMatch(pre, /CREATE EXTENSION[^;]*VERSION/i);
    assert.doesNotMatch(pre, /CREATE EXTENSION[^;]*WITH SCHEMA public/i);
    assert.match(pre, /REVOKE ALL ON SCHEMA trailmind_gis FROM PUBLIC, anon, authenticated, service_role/);
    assert.match(pre, /SET search_path = pg_catalog, trailmind_app, pg_temp/);
    assert.match(pre, /shared_acl_snapshot/);
    assert.match(pre, /shared_acl_principal_snapshot/);
    assert.match(pre, /namespace\.nspname IN \('public', 'extensions'\)/);
    assert.doesNotMatch(pre, /REVOKE TEMPORARY ON DATABASE/);
    assertBoundedLock(pre);
  });

  it("keeps the V2 post-step and compensation bound to the replacement ledger", async () => {
    const post = await readFile(new URL(
      "../../docs/operations/staging-v1/database/PHASE_1_POST_MIGRATION_V2.sql",
      import.meta.url
    ), "utf8");
    const rollback = await readFile(new URL(
      "../../docs/operations/staging-v1/database/PHASE_1_PRE_MIGRATION_V2_ROLLBACK.sql",
      import.meta.url
    ), "utf8");
    assert.match(post, /009_supabase_postgis_isolated_runtime_read_contract\.sql/);
    assert.doesNotMatch(post, /008_outdoor_research_runtime_read_contract\.sql/);
    assert.match(post, /session_user <> 'postgres' OR current_user <> 'postgres'/);
    assert.match(post, /REVOKE USAGE, CREATE ON SCHEMA extensions FROM PUBLIC/);
    assert.match(post, /shared_acl_principal_snapshot/);
    assert.match(post, /V2 PostGIS isolation, ownership, or GIS write boundary is invalid/);
    assertBoundedLock(post);
    assert.match(rollback, /trailmind\.phase_1_v2_rollback_confirmation/);
    assert.match(rollback, /namespace\.nspname = 'trailmind_app'/);
    assert.match(rollback, /application object or migration ledger/);
    assert.match(rollback, /WITH RECURSIVE postgis_objects/);
    assert.match(rollback, /V2 rollback detected an active TrailMind session/);
    assert.match(rollback, /DROP SCHEMA trailmind_app;/);
    assert.doesNotMatch(rollback, /DROP SCHEMA trailmind_app CASCADE/);
    assert.doesNotMatch(rollback, /DROP OWNED/);
    assert.doesNotMatch(rollback, /DROP SCHEMA [^;]+ CASCADE/);
    assert.match(rollback, /shared ACL byte\/semantic equality guard failed/);
    assertBoundedLock(rollback);
    const runner = await readFile(migrationRunnerURL, "utf8");
    assert.match(runner, /SET LOCAL statement_timeout = '30s'/);
    assert.ok(
      runner.indexOf("SET LOCAL statement_timeout = '30s'") <
        runner.indexOf("pg_advisory_xact_lock")
    );
  });
});

function functionBodies(sql) {
  return [...sql.matchAll(/AS \$function\$\n([\s\S]*?)\n\$function\$;/g)]
    .map((match) => match[1]);
}

function assertBoundedLock(sql) {
  assert.match(sql, /SET LOCAL statement_timeout = '30s';/);
  assert.ok(
    sql.indexOf("SET LOCAL statement_timeout = '30s';") <
      sql.indexOf("pg_advisory_xact_lock")
  );
}
