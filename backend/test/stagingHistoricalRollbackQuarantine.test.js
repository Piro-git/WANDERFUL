import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const databaseRoot = new URL(
  "../../docs/operations/staging-v1/database/",
  import.meta.url
);
const historicalRollback = new URL(
  "PHASE_1_BLOCKED_ROLLBACK.sql",
  databaseRoot
);
const noticeMarkdown = new URL(
  "PHASE_1_BLOCKED_ROLLBACK_QUARANTINE_NOTICE_001.md",
  databaseRoot
);
const noticeJson = new URL(
  "PHASE_1_BLOCKED_ROLLBACK_QUARANTINE_NOTICE_001.json",
  databaseRoot
);

describe("historical Phase 1 rollback quarantine", () => {
  it("preserves the protected bytes and records the destructive risk truthfully", async () => {
    const sql = await readFile(historicalRollback);
    assert.equal(
      createHash("sha256").update(sql).digest("hex"),
      "4f4cdbaee71df8b5b4fd5fdc93dc5711c74cd9746c873fa1524196b52011378e"
    );
    const text = sql.toString("utf8");
    assert.match(text, /DROP OWNED/);
    assert.match(text, /CASCADE/);
    const notice = await readFile(noticeMarkdown, "utf8");
    assert.match(notice, /NON-EXECUTABLE \/ SUPERSEDED HISTORICAL EVIDENCE/);
    assert.match(notice, /not a claim that the\s+historical SQL itself has been fixed/);
    assert.match(notice, /PHASE_1_PRE_MIGRATION_V2_ROLLBACK\.sql/);
    const receipt = JSON.parse(await readFile(noticeJson, "utf8"));
    assert.equal(receipt.activeSelectionAllowed, false);
    assert.equal(receipt.historicalArtifactFixed, false);
    assert.equal(receipt.historicalArtifact.sha256,
      "4f4cdbaee71df8b5b4fd5fdc93dc5711c74cd9746c873fa1524196b52011378e");
  });

  it("cannot be selected by any current executable V2 path", async () => {
    const activePaths = [
      "../package.json",
      "../scripts/migrate.js",
      "../scripts/staging/phase1-v2-operator.js",
      "../src/operations/migrationRunner.js",
      "../src/operations/stagingMigrationPolicy.js",
      "../src/operations/stagingPhase1V2Operator.js",
      "../../docs/operations/closed-beta-readiness-v1/STAGING_PROVISIONING_RUNBOOK_V1.md",
      "../../docs/operations/closed-beta-readiness-v1/SOURCE_EVIDENCE_MANIFEST_V1.json",
      "../../docs/operations/closed-beta-readiness-v1/SOURCE_EVIDENCE_MANIFEST_V1_DATABASE_SUPPLEMENT_V2_CANDIDATE.json",
      "../../docs/operations/closed-beta-readiness-v1/go-no-go-checklist-v1.json"
    ];
    for (const path of activePaths) {
      assert.doesNotMatch(
        await readFile(new URL(path, import.meta.url), "utf8"),
        /PHASE_1_BLOCKED_ROLLBACK\.sql/,
        path
      );
    }
  });
});
