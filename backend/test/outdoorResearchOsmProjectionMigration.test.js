import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const migrationURL = new URL(
  "../migrations/004_osm_outdoor_research_projection.sql",
  import.meta.url
);
const geometryMigrationURL = new URL(
  "../migrations/005_outdoor_research_projection_geometry.sql",
  import.meta.url
);
const membershipPointIndexMigrationURL = new URL(
  "../migrations/006_outdoor_route_membership_point_index.sql",
  import.meta.url
);
const trailAccessIndexMigrationURL = new URL(
  "../migrations/007_routable_highlight_access_geography_index.sql",
  import.meta.url
);
const migrationRunnerURL = new URL("../scripts/migrate.js", import.meta.url);
const membershipPerformanceRecordURL = new URL(
  "../../docs/OUTDOOR_MAPPED_ROUTE_MEMBERSHIP_PERFORMANCE_V1.md",
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

  it("retains strict spatial checks while allowing mapped area features", async () => {
    const source = await readFile(geometryMigrationURL, "utf8");
    assert.match(
      source,
      /outdoor_research_projection_entities_projected_geometry_check/
    );
    assert.match(source, /'POLYGON'/);
    assert.match(source, /'MULTIPOLYGON'/);
    assert.match(source, /ST_NDims\(projected_geometry\) = 2/);
    assert.match(source, /ST_SRID\(projected_geometry\) = 4326/);
    assert.match(source, /NOT ST_IsEmpty\(projected_geometry\)/);
    assert.match(source, /ST_IsValid\(projected_geometry\)/);
    assert.match(source, /ST_CoveredBy\(/);
    assert.doesNotMatch(source, /DROP\s+TABLE/i);
  });

  it("indexes the exact mapped-route representative point without changing rows", async () => {
    const source = await readFile(membershipPointIndexMigrationURL, "utf8");
    assert.match(source, /CREATE INDEX IF NOT EXISTS/);
    assert.match(
      source,
      /outdoor_research_projection_entities_trail_point_gist_idx/
    );
    assert.match(source, /USING GIST \(ST_PointOnSurface\(projected_geometry\)\)/);
    assert.match(source, /entity_category = 'trail_segment'/);
    assert.match(source, /projected_geometry IS NOT NULL/);
    assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i);
  });

  it("keeps the index compatible with the transactional runner and documents its write lock", async () => {
    const [migration, runner, performanceRecord] = await Promise.all([
      readFile(membershipPointIndexMigrationURL, "utf8"),
      readFile(migrationRunnerURL, "utf8"),
      readFile(membershipPerformanceRecordURL, "utf8")
    ]);
    assert.doesNotMatch(migration, /CREATE\s+INDEX\s+CONCURRENTLY/i);
    assert.match(runner, /client\.query\("BEGIN"\)/);
    assert.match(runner, /client\.query\("ROLLBACK"\)/);
    assert.match(performanceRecord, /`ShareLock`/);
    assert.match(performanceRecord, /write-quiet maintenance window/);
    assert.match(performanceRecord, /projection history is append-only/);
  });

  it("adds only the deterministic trail geography lookup index", async () => {
    const source = await readFile(trailAccessIndexMigrationURL, "utf8");
    assert.match(source, /CREATE INDEX IF NOT EXISTS/);
    assert.match(source, /projected_geometry::geography/);
    assert.match(source, /entity_category = 'trail_segment'/);
    assert.doesNotMatch(source, /CREATE\s+INDEX\s+CONCURRENTLY/i);
    assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i);
  });
});
