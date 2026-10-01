import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
} from "../src/operations/stagingMigrationPolicy.js";

const migrationURL = new URL(
  "../migrations/011_pin_security_invoker_function_search_paths.sql",
  import.meta.url
);
const backendRoot = new URL("../", import.meta.url);

const hardenedFunctions = Object.freeze([
  "outdoor_research_reject_audit_mutation()",
  "outdoor_research_validate_assertion_write()",
  "outdoor_research_validate_relationship_source_class()",
  "outdoor_research_validate_derived_feature_write()",
  "outdoor_research_validate_policy_timestamps()",
  "outdoor_research_deterministic_uuid_v3(text, text)",
  "outdoor_research_validate_projection_assertion()",
  "outdoor_research_validate_projection_relationship()"
]);

describe("dormant Supabase advisor hardening migration", () => {
  it("pins exactly the eight reported security-invoker helpers to trusted schemas", async () => {
    const sql = await readFile(migrationURL, "utf8");
    assert.equal((sql.match(/^ALTER FUNCTION /gm) ?? []).length, 8);
    assert.equal(
      (sql.match(/SET search_path = pg_catalog, trailmind_app;/g) ?? []).length,
      8
    );
    for (const signature of hardenedFunctions) {
      assert.match(sql, new RegExp(
        `ALTER FUNCTION trailmind_app\\.${escapeRegExp(signature)}`
      ));
    }
    for (const forbidden of [
      "SECURITY DEFINER", "GRANT ", "CREATE POLICY", "DISABLE ROW LEVEL",
      "INSERT ", "UPDATE ", "DELETE ", "public", "pg_temp"
    ]) assert.equal(sql.includes(forbidden), false, forbidden);
  });

  it("keeps historical migration 008 absent from the V2 ledger", () => {
    assert.deepEqual(SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2, [
      "001_app_attest.sql",
      "002_outdoor_evidence.sql",
      "003_outdoor_research_graph.sql",
      "004_osm_outdoor_research_projection.sql",
      "005_outdoor_research_projection_geometry.sql",
      "006_outdoor_route_membership_point_index.sql",
      "007_routable_highlight_access_geography_index.sql",
      "009_supabase_postgis_isolated_runtime_read_contract.sql",
      "010_bounded_outdoor_import_schema_provisioning.sql",
      "011_pin_security_invoker_function_search_paths.sql"
    ]);
    assert.equal(
      SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2.some((name) =>
        name.startsWith("008_")
      ),
      false
    );
  });

  it("preserves exactly four intentional fail-closed RLS-without-policy tables", async () => {
    const migrationFiles = SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
      .filter((name) => name !==
        "011_pin_security_invoker_function_search_paths.sql");
    const migrationSql = (await Promise.all(migrationFiles.map((name) =>
      readFile(new URL(`migrations/${name}`, backendRoot), "utf8")
    ))).join("\n");
    const rlsTables = new Set([...migrationSql.matchAll(
      /ALTER TABLE (?:trailmind_app\.)?([a-z0-9_]+)\s+ENABLE ROW LEVEL SECURITY/g
    )].map((match) => match[1]));
    const post = await readFile(new URL(
      "../docs/operations/staging-v1/database/PHASE_1_POST_MIGRATION_V2.sql",
      backendRoot
    ), "utf8");
    const start = post.indexOf("CREATE POLICY app_security_runtime_select");
    const end = post.indexOf("REVOKE CREATE ON SCHEMA trailmind_app", start);
    assert(start > 0 && end > start);
    const policySection = post.slice(start, end);
    const policyTables = new Set([
      ...[...policySection.matchAll(
        /ON trailmind_app\.([a-z0-9_]+)/g
      )].map((match) => match[1]),
      ...[...policySection.matchAll(/^\s+'([a-z0-9_]+)'[,]?$/gm)]
        .map((match) => match[1])
    ]);
    assert.deepEqual(
      [...rlsTables].filter((table) => !policyTables.has(table)).sort(),
      [
        "outdoor_import_schema_leases",
        "outdoor_research_derived_features",
        "outdoor_research_entity_aliases",
        "outdoor_research_observations"
      ]
    );
  });
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
