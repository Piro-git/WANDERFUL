import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const migrationURL = new URL(
  "../migrations/007_routable_highlight_access_geography_index.sql",
  import.meta.url
);

describe("routable highlight access migration", () => {
  it("is repeatable, index-only, partial, and geography-aware", async () => {
    const source = await readFile(migrationURL, "utf8");
    assert.match(source, /CREATE INDEX IF NOT EXISTS/);
    assert.match(
      source,
      /outdoor_research_projection_entities_trail_geography_gist_idx/
    );
    assert.match(source, /USING GIST \(\(projected_geometry::geography\)\)/);
    assert.match(source, /entity_category = 'trail_segment'/);
    assert.doesNotMatch(
      source,
      /\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i
    );
  });
});
