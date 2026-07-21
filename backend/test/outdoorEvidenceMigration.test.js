import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const migrationURL = new URL("../migrations/002_outdoor_evidence.sql", import.meta.url);

describe("outdoor evidence migration", () => {
  it("defines isolated prefixed tables, relationships and spatial indexes", async () => {
    const sql = await readFile(migrationURL, "utf8");
    for (const table of [
      "outdoor_evidence_regions", "outdoor_evidence_imports", "outdoor_evidence_pois",
      "outdoor_evidence_trail_segments", "outdoor_evidence_hiking_relations",
      "outdoor_evidence_hiking_relation_members"
    ]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(sql, /CREATE EXTENSION IF NOT EXISTS postgis/);
    assert.match(sql, /USING GIST \(boundary\)/);
    assert.match(sql, /USING GIST \(geom_metric\)/);
    assert.match(sql, /boundary_metric geometry NOT NULL CHECK/);
    assert.match(sql, /ST_NDims\(boundary_metric\) = 2 AND ST_SRID\(boundary_metric\) > 0/);
    assert.match(sql, /GeometryType\(geom_metric\) = 'MULTILINESTRING'/);
    assert.match(sql, /FOREIGN KEY \(import_id, relation_osm_type, relation_osm_id\)/);
    assert.match(sql, /FOREIGN KEY \(active_import_id, region_id\)/);
    assert.match(sql, /FOREIGN KEY \(import_id, region_id\)/);
    assert.match(sql, /outdoor_evidence_relation_members_relation_region_fk/);
    assert.match(sql, /outdoor_evidence_relation_members_segment_region_fk/);
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  });

  it("keeps unknown access distinct from explicit restrictions", async () => {
    const sql = await readFile(migrationURL, "utf8");
    assert.match(sql, /access_tag text CHECK \(access_tag IS NULL/);
    assert.match(sql, /foot_tag text CHECK \(foot_tag IS NULL/);
    assert.equal(sql.includes("DEFAULT 'yes'"), false);
  });

  it("adds named foreign keys only when missing so repeat runs do not rewrite them", async () => {
    const sql = await readFile(migrationURL, "utf8");
    assert.doesNotMatch(sql, /DROP CONSTRAINT/);
    assert.match(sql, /IF NOT EXISTS \([\s\S]*conname = 'outdoor_evidence_imports_region_fk'/);
    assert.match(sql, /IF NOT EXISTS \([\s\S]*conname = 'outdoor_evidence_regions_active_import_region_fk'/);
  });
});
