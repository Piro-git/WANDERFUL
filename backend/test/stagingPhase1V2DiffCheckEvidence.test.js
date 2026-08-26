import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const baselineCommit = "72b98e3e065ae442168ece20984d8baba26e2d11";
const checkpointCommit = "360360714c5d467552fc1f9fdc00b255081ea422";
const erratumJsonPath =
  "docs/operations/staging-v1/database/PHASE_1_POSTGIS_ISOLATION_V2_DIFF_CHECK_ERRATUM_001.json";
const erratumMarkdownPath =
  "docs/operations/staging-v1/database/PHASE_1_POSTGIS_ISOLATION_V2_DIFF_CHECK_ERRATUM_001.md";
const supplementPath =
  "docs/operations/closed-beta-readiness-v1/SOURCE_EVIDENCE_MANIFEST_V1_DATABASE_SUPPLEMENT_V2_DIFF_CHECK_CORRECTION_001.json";
const evidenceMapPath = "docs/release/staging-v1/canonical-evidence-map-v1.json";
const regressionTestPath = "backend/test/stagingPhase1V2DiffCheckEvidence.test.js";

const expectedOriginalRangeOutput = [
  "docs/operations/staging-v1/database/PHASE_1_POSTGIS_ISOLATION_V2_LOCAL_PROOF.md:5: trailing whitespace.",
  "+Proof date: 2026-08-25 (Europe/Berlin)  ",
  "docs/operations/staging-v1/database/PHASE_1_POSTGIS_ISOLATION_V2_LOCAL_PROOF.md:6: trailing whitespace.",
  "+Repository baseline/fetched `origin/main`: `72b98e3e065ae442168ece20984d8baba26e2d11`  ",
  "docs/operations/staging-v1/database/PHASE_1_POSTGIS_ISOLATION_V2_LOCAL_PROOF.md:7: trailing whitespace.",
  "+Authorized future staging target: TrailMind Outdoor Staging V1, `mbvzwsrtqcrwhvykugcd`, Frankfurt (`eu-central-1`)  ",
  "docs/operations/staging-v1/database/PHASE_1_POSTGIS_ISOLATION_V2_LOCAL_PROOF.md:8: trailing whitespace.",
  "+Protected production target: TrailMind, `bejvhhjbgtvctpsnlwid` — not contacted  ",
  "docs/operations/staging-v1/database/PHASE_1_POST_MIGRATION.sql:345: new blank line at EOF.",
  ""
].join("\n");

function runGit(args, encoding = "utf8") {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding,
    maxBuffer: 2 * 1024 * 1024
  });
  assert.equal(result.error, undefined);
  return result;
}

async function sha256(path) {
  return createHash("sha256")
    .update(await readFile(new URL(`../../${path}`, import.meta.url)))
    .digest("hex");
}

describe("Phase 1 V2 committed-range diff-check evidence", () => {
  it("reproduces and classifies the exact five original-range findings", async () => {
    const result = runGit([
      "diff",
      "--check",
      `${baselineCommit}..${checkpointCommit}`
    ]);
    assert.equal(result.status, 2);
    assert.equal(`${result.stdout}${result.stderr}`, expectedOriginalRangeOutput);

    const receipt = JSON.parse(
      await readFile(new URL(`../../${erratumJsonPath}`, import.meta.url), "utf8")
    );
    assert.equal(receipt.originalRangeValidation.exitCode, 2);
    assert.equal(receipt.originalRangeValidation.findingCount, 5);
    assert.equal(receipt.originalRangeValidation.noOtherFindings, true);
  });

  it("preserves the exact checkpoint blobs and protected file digests", async () => {
    const receipt = JSON.parse(
      await readFile(new URL(`../../${erratumJsonPath}`, import.meta.url), "utf8")
    );
    for (const finding of receipt.findings) {
      const blob = runGit([
        "rev-parse",
        `${checkpointCommit}:${finding.path}`
      ]).stdout.trim();
      assert.equal(blob, finding.checkpointGitBlobSha1);

      const file = runGit(["show", `${checkpointCommit}:${finding.path}`], null).stdout;
      assert.equal(
        createHash("sha256").update(file).digest("hex"),
        finding.checkpointFileSha256
      );
      assert.equal(finding.preserved, true);
      assert.equal(finding.runtimeOrSecurityImpact, false);
    }
  });

  it("requires every committed correction after the sealed checkpoint to be clean", () => {
    const result = runGit([
      "diff",
      "--check",
      `${checkpointCommit}..HEAD`
    ]);
    assert.equal(result.status, 0);
    assert.equal(`${result.stdout}${result.stderr}`, "");
  });

  it("binds the append-only correction through the supplement and canonical map", async () => {
    const supplement = JSON.parse(
      await readFile(new URL(`../../${supplementPath}`, import.meta.url), "utf8")
    );
    const evidenceMap = JSON.parse(
      await readFile(new URL(`../../${evidenceMapPath}`, import.meta.url), "utf8")
    );
    const latest = evidenceMap.localCandidateCorrections.at(-1);

    assert.equal(latest.id, "trailmind-phase1-postgis-isolation-v2-diff-check-erratum-001");
    assert.equal(latest.markdownSha256, await sha256(erratumMarkdownPath));
    assert.equal(latest.jsonSha256, await sha256(erratumJsonPath));
    assert.equal(latest.regressionTestSha256, await sha256(regressionTestPath));
    assert.equal(latest.databaseSupplementSha256, await sha256(supplementPath));
    assert.equal(supplement.correctionBindings.markdown.sha256, latest.markdownSha256);
    assert.equal(supplement.correctionBindings.receipt.sha256, latest.jsonSha256);
    assert.equal(supplement.correctionBindings.regressionTest.sha256, latest.regressionTestSha256);
    assert.equal(latest.originalRangeDiffCheck.findingCount, 5);
    assert.equal(latest.originalRangeDiffCheck.noOtherFindings, true);

    const prior = evidenceMap.localCandidateCorrections.at(-2);
    assert.equal(
      prior.id,
      "trailmind-phase1-postgis-isolation-v2-review-correction-002-final-seal-001-local"
    );
    assert.equal(
      prior.jsonSha256,
      "a4387e8642926fe08bb5bc9a081fb916198f9af76060e78e15e4f8070577d793"
    );
  });
});
