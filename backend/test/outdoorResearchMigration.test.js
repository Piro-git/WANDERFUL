import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const migrationURL = new URL("../migrations/003_outdoor_research_graph.sql", import.meta.url);

describe("outdoor research graph migration", () => {
  it("defines every canonical graph table without replacing source-specific OSM tables", async () => {
    const sql = await readFile(migrationURL, "utf8");
    for (const table of [
      "outdoor_research_sources", "outdoor_research_entities", "outdoor_research_entity_aliases",
      "outdoor_research_source_authority_scopes",
      "outdoor_research_source_entities", "outdoor_research_assertions",
      "outdoor_research_relationships", "outdoor_research_derived_features",
      "outdoor_research_observations"
    ]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.equal(sql.includes("ALTER TABLE outdoor_evidence_"), false);
    assert.equal(sql.includes("DROP TABLE"), false);
    assert.equal(sql.includes("ON DELETE CASCADE"), false);
  });

  it("enforces WGS84 geometry, bounded vocabularies, typed values and restrictive provenance", async () => {
    const sql = await readFile(migrationURL, "utf8");
    assert.match(sql, /canonical_geometry geometry\(Geometry, 4326\)/);
    assert.match(sql, /ST_CoveredBy\(canonical_geometry, ST_MakeEnvelope\(-180, -90, 180, 90, 4326\)\)/);
    assert.match(sql, /evidence_class text NOT NULL CHECK/);
    assert.match(sql, /value_type text NOT NULL CHECK/);
    assert.match(sql, /FOREIGN KEY|REFERENCES outdoor_research_sources/);
    assert.equal(sql.includes("value_json"), false);
  });

  it("preserves append-only audit evidence and rejects source-class relabeling", async () => {
    const sql = await readFile(migrationURL, "utf8");
    assert.match(sql, /outdoor_research_assertions_append_only/);
    assert.match(sql, /outdoor_research_observations_append_only/);
    assert.match(sql, /outdoor_research_relationships_append_only/);
    assert.match(sql, /outdoor_research_derived_features_append_only/);
    assert.match(sql, /outdoor_research_validate_assertion_write/);
    assert.match(sql, /evidence class does not match source category/);
    assert.match(sql, /source lacks reviewed authority for assertion scope/);
    assert.match(sql, /source is not active and approved for normalized facts/);
    assert.match(sql, /source is not active and approved for derived features/);
    assert.match(sql, /supersession target must share entity, predicate and source/);
    assert.match(sql, /evidence_class = 'derived'/);
  });

  it("creates spatial and temporal indexes and enables RLS on every graph table", async () => {
    const sql = await readFile(migrationURL, "utf8");
    assert.match(sql, /USING GIST \(canonical_geometry\)/);
    assert.match(sql, /outdoor_research_assertions_current_lookup_idx/);
    assert.match(sql, /outdoor_research_observations_validity_idx/);
    assert.equal((sql.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length, 9);
  });

  it("remains discoverable by the deterministic migration runner", async () => {
    const entrypoint = await readFile(
      new URL("../scripts/migrate.js", import.meta.url), "utf8"
    );
    const runner = await readFile(
      new URL("../src/operations/migrationRunner.js", import.meta.url), "utf8"
    );
    const policy = await readFile(
      new URL("../src/operations/stagingMigrationPolicy.js", import.meta.url),
      "utf8"
    );
    assert.match(entrypoint, /requiredMigrationPolicy/);
    assert.match(runner, /trailmind_migration_ledger_incompatible/);
    assert.match(runner, /ORDER BY applied_at, version/);
    assert.match(runner, /SET LOCAL ROLE trailmind_app_owner/);
    assert.match(policy, /003_outdoor_research_graph\.sql/);
  });

  it("leaves the tracked iOS Release evidence gate disabled", async () => {
    const configuration = await readFile(
      new URL("../../Configuration/Shared.xcconfig", import.meta.url), "utf8"
    );
    assert.match(configuration, /^OUTDOOR_EVIDENCE_ENABLED = false$/m);
  });
});
