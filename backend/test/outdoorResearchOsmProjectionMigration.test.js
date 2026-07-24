import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const migrationURL = new URL(
  "../migrations/004_osm_outdoor_research_projection.sql",
  import.meta.url
);

describe("OSM projection migration contract", () => {
  it("is additive, restrictive and creates no source activation", async () => {
    const source = await readFile(migrationURL, "utf8");
    assert.doesNotMatch(source, /DROP\s+TABLE/i);
    assert.doesNotMatch(source, /ON\s+DELETE\s+CASCADE/i);
    assert.doesNotMatch(source, /INSERT\s+INTO\s+outdoor_research_sources/i);
    assert.match(source, /ON DELETE RESTRICT/g);
    assert.match(source, /outdoor_research_projection_runs_active_idx/);
    assert.match(source, /outdoor_research_projection_runs_active_key_idx/);
    assert.match(source, /outdoor_research_projection_entities_geometry_gist_idx/);
    assert.match(source, /source_checksum_verified_at/);
    assert.match(source, /input_file_sha256 text NOT NULL/);
    assert.match(source, /outdoor_evidence_imports_checksum_verification_check/);
    assert.match(source, /outdoor_evidence_imports_geofabrik_checksum_check/);
    assert.match(source, /outdoor_research_source_policies_timestamp_guard/);
    assert.match(source, /reviewed_at > clock_timestamp\(\)/);
  });

  it("gates active snapshots through active source, policy and exact scopes", async () => {
    const source = await readFile(migrationURL, "utf8");
    assert.match(source, /CREATE OR REPLACE VIEW outdoor_research_active_projection_runs/);
    assert.match(source, /policy\.lifecycle_state = 'active'/);
    assert.match(source, /policy\.normalized_facts_allowed = true/);
    assert.match(source, /policy\.derived_features_allowed = false/);
    assert.match(source, /CREATE OR REPLACE VIEW outdoor_research_active_assertions/);
    assert.match(source, /outdoor_research_source_policy_scopes/);
    assert.match(source, /outdoor_research_source_authority_scopes/);
    assert.match(source, /CREATE OR REPLACE VIEW outdoor_research_active_relationships/);
    assert.match(source, /outdoor_research_source_policy_relationship_scopes/);
  });

  it("keeps all projection lineage tables append-only and protected by RLS", async () => {
    const source = await readFile(migrationURL, "utf8");
    for (const table of [
      "outdoor_research_osm_entity_identities",
      "outdoor_research_projection_entities",
      "outdoor_research_projection_assertions",
      "outdoor_research_projection_relationships",
      "outdoor_research_projection_quarantines"
    ]) {
      assert.match(source, new RegExp(`${table}_append_only`));
      assert.match(source, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
    }
    assert.match(source, /retirement_reference/);
    assert.match(source, /retired_at/);
  });
});
