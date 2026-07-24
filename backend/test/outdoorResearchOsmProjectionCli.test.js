import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const projectionCli = join(backendRoot, "scripts", "project-osm-outdoor-research.js");
const policyCli = join(
  backendRoot, "scripts", "configure-osm-outdoor-research-policy.js"
);

describe("OSM projection operator CLIs", () => {
  it("fails with bounded JSON, no stack and nonzero status when configuration is absent", () => {
    for (const script of [projectionCli, policyCli]) {
      const environment = { ...process.env };
      delete environment.DATABASE_URL;
      delete environment.POSTGRES_URL;
      const result = spawnSync(process.execPath, [script], {
        cwd: backendRoot,
        env: environment,
        encoding: "utf8"
      });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      const failure = JSON.parse(result.stderr);
      assert.equal(failure.schemaVersion, 1);
      assert.equal(failure.status, "failed");
      assert.match(failure.error.code, /^[a-z0-9_]{1,80}$/);
      assert.doesNotMatch(result.stderr, /password|coordinate|Error:| at /i);
    }
  });

  it("requires explicit dry-run and reviewed operator confirmations", async () => {
    const projectionSource = await readFile(projectionCli, "utf8");
    const policySource = await readFile(policyCli, "utf8");
    assert.match(projectionSource, /"dry-run"/);
    assert.match(projectionSource, /OSM_PROJECTION_OPERATOR_CONFIRMATION/);
    assert.match(projectionSource, /JSON\.stringify\(summary\)/);
    assert.match(policySource, /"review-reference"/);
    assert.match(policySource, /"reviewed-at"/);
    assert.match(policySource, /operatorConfirmation/);
    assert.doesNotMatch(projectionSource, /console\.(?:log|error)/);
    assert.doesNotMatch(policySource, /console\.(?:log|error)/);
  });
});
