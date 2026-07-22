import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const importerPath = join(backendRoot, "scripts", "import-outdoor-evidence.js");
const flexPath = join(backendRoot, "src", "outdoorEvidence", "osm2pgsql-flex.lua");

describe("outdoor evidence importer contract", () => {
  it("fails preflight with a bounded safe message instead of a stack or tool output", () => {
    const environment = { ...process.env };
    delete environment.DATABASE_URL;
    delete environment.POSTGRES_URL;
    const result = spawnSync(process.execPath, [importerPath], {
      cwd: backendRoot,
      env: environment,
      encoding: "utf8"
    });

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Outdoor evidence import preflight failed safely.\n");
    assert.doesNotMatch(result.stderr, /Error:| at |postgres|password|coordinate/i);
  });

  it("uses a unique staging schema, transactional promotion, and credential-safe child env", async () => {
    const source = await readFile(importerPath, "utf8");
    assert.match(source, /outdoor_import_\$\{importId\.replaceAll/);
    assert.match(source, /pg_advisory_xact_lock/);
    assert.match(source, /await client\.query\("BEGIN"\)/);
    assert.match(source, /await client\.query\("COMMIT"\)/);
    assert.match(source, /DROP SCHEMA IF EXISTS/);
    assert.match(source, /counts\?\.trails/);
    assert.match(source, /activation\.rowCount !== 1/);
    assert.match(source, /pointerUpdate\.rowCount !== 1/);
    assert.match(source, /ON CONFLICT \(region_id\) DO NOTHING/);
    assert.doesNotMatch(source, /ON CONFLICT \(region_id\) DO UPDATE/);
    assert.match(source, /delete childEnvironment\.DATABASE_URL/);
    assert.match(source, /delete childEnvironment\.POSTGRES_URL/);
    assert.match(source, /hasMinimumVersion\(result\.rows\[0\]\?\.postgis_version, 3, 2\)/);
    assert.match(source, /osm2pgsql version \(\\d\+\)\\\.\(\\d\+\).*2, 3/s);
    assert.equal(source.match(/ST_Transform\([\s\S]*?\$(?:3|6)::integer/g)?.length, 4);
    assert.match(source, /metric_srid = \$6::integer/);
  });

  it("maps only bounded evidence columns and excludes documented non-current states", async () => {
    const source = await readFile(flexPath, "utf8");
    assert.match(source, /source_timestamp', type = 'timestamptz'/);
    assert.match(source, /source_timestamp = object\.timestamp/);
    assert.match(source, /planned = true/);
    assert.match(source, /non_current_values\[tags\.state\]/);
    assert.match(source, /tags\.tourism == 'viewpoint'/);
    assert.match(source, /tags\.natural == 'water' and tags\.water == 'lake'/);
    assert.doesNotMatch(source, /hstore|jsonb|tags\s*=/i);
  });
});
