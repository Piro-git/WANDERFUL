import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import {
  ATTEMPT_13_PATH_PATTERN,
  HISTORICAL_V4_RECEIPT_PATTERN
} from "./constants.js";
import { STAGING_READINESS_REPOSITORY_ROOT } from "./policy.js";
import { sha256StagingReadinessV1 } from "./serialization.js";
import { HEX_40, invalidStagingReadinessV1 } from "./validation.js";
import {
  V4_COMMITTED_HISTORICAL_RECEIPTS,
  validateCommittedV4HistoricalMarkdown,
  validateCommittedV4HistoricalSummary
} from "../outdoorAdventureTargetedLiveRouteQualityProofV4/historicalReceipt.js";

const execFileAsync = promisify(execFile);
const EXPECTED_HISTORICAL_RECEIPT_COUNT = 16;

export async function attestStagingReadinessGitCandidateV1({
  baselineCommit,
  candidateCommit,
  execFileImpl = execFileAsync
}) {
  if (!HEX_40.test(baselineCommit ?? "") ||
      !HEX_40.test(candidateCommit ?? "") ||
      typeof execFileImpl !== "function") {
    invalidStagingReadinessV1("candidate_git_input_invalid");
  }
  const runGit = repositoryBoundGit(execFileImpl);
  const headCommit = await gitText(runGit, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (headCommit !== candidateCommit) {
    invalidStagingReadinessV1("candidate_not_current_head");
  }
  const status = await gitText(
    runGit,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    false
  );
  if (status.length !== 0) invalidStagingReadinessV1("candidate_worktree_dirty");
  await gitSuccess(runGit, ["cat-file", "-e", `${baselineCommit}^{commit}`]);
  await gitSuccess(runGit, ["merge-base", "--is-ancestor", baselineCommit, candidateCommit]);
  const treeDigest = await gitText(runGit, ["rev-parse", "--verify", "HEAD^{tree}"]);
  const indexTreeDigest = await gitText(runGit, ["write-tree"]);
  if (!HEX_40.test(treeDigest) || !HEX_40.test(indexTreeDigest) ||
      treeDigest !== indexTreeDigest) {
    invalidStagingReadinessV1("candidate_index_tree_mismatch");
  }
  const record = {
    baselineCommit,
    candidateCommit,
    headCommit,
    treeDigest,
    indexTreeDigest,
    indexClean: true,
    worktreeClean: true,
    baselineExists: true,
    baselineAncestorOfCandidate: true
  };
  return {
    ...record,
    candidateAttestationSha256: sha256StagingReadinessV1(record)
  };
}

export async function attestHistoricalStagingProofReceiptsV1({
  baselineCommit,
  candidateCommit,
  execFileImpl = execFileAsync,
  readFileImpl = readFile
}) {
  if (!HEX_40.test(baselineCommit ?? "") ||
      !HEX_40.test(candidateCommit ?? "")) {
    invalidStagingReadinessV1("historical_receipt_candidate_invalid");
  }
  const runGit = repositoryBoundGit(execFileImpl);
  const baselinePaths = historicalPaths(await gitText(
    runGit,
    ["ls-tree", "-r", "--name-only", baselineCommit, "--", "docs/release"]
  ));
  const candidateReleasePaths = (await gitText(
    runGit,
    ["ls-tree", "-r", "--name-only", candidateCommit, "--", "docs/release"]
  )).split("\n").filter(Boolean);
  const candidatePaths = historicalPaths(candidateReleasePaths.join("\n"));
  if (candidateReleasePaths.some((path) => ATTEMPT_13_PATH_PATTERN.test(path))) {
    invalidStagingReadinessV1("attempt_13_artifact_not_authorized");
  }
  if (baselinePaths.length !== EXPECTED_HISTORICAL_RECEIPT_COUNT ||
      JSON.stringify(candidatePaths) !== JSON.stringify(baselinePaths)) {
    invalidStagingReadinessV1("historical_receipt_set_changed");
  }

  const entries = [];
  for (const path of baselinePaths) {
    const baselineBytes = await gitBytes(runGit, ["show", `${baselineCommit}:${path}`]);
    const candidateBytes = await gitBytes(runGit, ["show", `${candidateCommit}:${path}`]);
    if (!baselineBytes.equals(candidateBytes)) {
      invalidStagingReadinessV1("historical_receipt_bytes_changed");
    }
    let worktreeBytes;
    try {
      worktreeBytes = await readFileImpl(
        new URL(`../../../${path}`, import.meta.url)
      );
    } catch {
      invalidStagingReadinessV1("historical_receipt_unavailable");
    }
    if (!Buffer.from(worktreeBytes).equals(candidateBytes)) {
      invalidStagingReadinessV1("historical_receipt_worktree_mismatch");
    }
    entries.push({
      path,
      byteLength: candidateBytes.length,
      sha256: sha256StagingReadinessV1(candidateBytes)
    });
  }

  for (const expected of V4_COMMITTED_HISTORICAL_RECEIPTS) {
    const markdown = await readFileImpl(
      new URL(`../../../${expected.markdownPath}`, import.meta.url)
    );
    const summary = await readFileImpl(
      new URL(`../../../${expected.summaryPath}`, import.meta.url)
    );
    try {
      validateCommittedV4HistoricalMarkdown(expected.attemptNumber, markdown);
      validateCommittedV4HistoricalSummary(expected.attemptNumber, summary);
    } catch {
      invalidStagingReadinessV1("historical_receipt_validator_failed");
    }
  }
  return {
    receiptCount: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.byteLength, 0),
    manifestSha256: sha256StagingReadinessV1(entries)
  };
}

function historicalPaths(output) {
  return output.split("\n").filter((path) =>
    HISTORICAL_V4_RECEIPT_PATTERN.test(path)
  ).sort();
}

function repositoryBoundGit(execFileImpl) {
  return (args) => execFileImpl("git", args, {
    cwd: STAGING_READINESS_REPOSITORY_ROOT,
    encoding: null,
    timeout: 8_000,
    maxBuffer: 2_000_000
  });
}

async function gitText(runGit, args, trim = true) {
  const bytes = await gitBytes(runGit, args);
  const text = bytes.toString("utf8");
  if (text.length > 1_000_000) invalidStagingReadinessV1("git_output_unbounded");
  return trim ? text.trim() : text;
}

async function gitBytes(runGit, args) {
  let result;
  try {
    result = await runGit(args);
  } catch {
    invalidStagingReadinessV1("git_attestation_unavailable");
  }
  if (!result || (!Buffer.isBuffer(result.stdout) &&
      !(result.stdout instanceof Uint8Array))) {
    invalidStagingReadinessV1("git_attestation_unavailable");
  }
  return Buffer.from(result.stdout);
}

async function gitSuccess(runGit, args) {
  await gitBytes(runGit, args);
}
