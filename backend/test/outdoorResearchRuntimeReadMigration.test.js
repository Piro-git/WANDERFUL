import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const migrationURL = new URL(
  "../migrations/008_outdoor_research_runtime_read_contract.sql",
  import.meta.url
);

describe("outdoor research runtime read migration", () => {
  it("exposes only the five bounded repository operations", async () => {
    const sql = await readFile(migrationURL, "utf8");
    for (const operation of [
      "snapshot_context",
      "highlights",
      "route_memberships",
      "route_assertions",
      "trail_access_candidates"
    ]) {
      assert.match(
        sql,
        new RegExp(`trailmind_runtime_outdoor_research_${operation}_v1`)
      );
    }
    assert.equal((sql.match(/SECURITY DEFINER/g) ?? []).length, 5);
    assert.equal(
      (sql.match(/SET search_path FROM CURRENT/g) ?? []).length,
      5
    );
    assert.equal((sql.match(/SET jit = off/g) ?? []).length, 5);
    assert.equal((sql.match(/REVOKE ALL ON FUNCTION/g) ?? []).length, 5);
    assert.match(sql, /RETURNS SETOF jsonb/);
    assert.doesNotMatch(sql, /RETURNS SETOF json\b/);
    assert.doesNotMatch(sql, /\bEXPLAIN\b/);
    assert.match(sql, /owner_role\.rolcanlogin/);
    assert.match(sql, /owner_role\.rolinherit/);
    assert.match(sql, /FROM pg_catalog\.pg_auth_members/);
    assert.match(sql, /pg_catalog,public,pg_temp/);
  });

  it("keeps active, region, lifecycle, source-policy and quarantine checks inside the owner boundary", async () => {
    const sql = await readFile(migrationURL, "utf8");
    assert.match(sql, /outdoor_research_active_projection_runs/);
    assert.match(sql, /outdoor_research_active_assertions/);
    assert.match(sql, /outdoor_research_active_relationships/);
    assert.match(sql, /region\.enabled = true/);
    assert.match(sql, /region\.active_import_id = .*input_import_id/);
    assert.match(sql, /import\.status = 'active'/);
    assert.match(sql, /lifecycle_state = 'active'/);
    assert.match(
      sql,
      /JOIN outdoor_research_entities canonical_entity[\s\S]*canonical_entity\.lifecycle_state = 'active'/
    );
    assert.match(sql, /outdoor_research_projection_quarantines/);
    assert.match(sql, /'harz-v1', 'innsbruck-alps-v1'/);
    assert.match(
      sql,
      /'wilderness_hut', 'landmark', 'trail_segment', 'hiking_route'/
    );
    assert((sql.match(/'harz-v1', 'innsbruck-alps-v1'/g) ?? []).length >= 5);
  });

  it("does not create roles, grant base tables, disable RLS, or use dynamic SQL", async () => {
    const sql = await readFile(migrationURL, "utf8");
    assert.doesNotMatch(sql, /\bCREATE\s+ROLE\b/i);
    assert.doesNotMatch(sql, /\bALTER\s+ROLE\b/i);
    assert.doesNotMatch(sql, /\bGRANT\b/i);
    assert.doesNotMatch(sql, /DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    assert.doesNotMatch(sql, /row_security\s*=\s*off/i);
    assert.doesNotMatch(sql, /\bALTER\s+ROLE\b[\s\S]*\bBYPASSRLS\b/i);
    assert.doesNotMatch(sql, /\bEXECUTE\s+format\b/i);
    assert.doesNotMatch(sql, /\bEXECUTE\s+(?:format|immediate|'|")/i);
    assert.doesNotMatch(sql, /USING\s*\(\s*true\s*\)/i);
  });
});
