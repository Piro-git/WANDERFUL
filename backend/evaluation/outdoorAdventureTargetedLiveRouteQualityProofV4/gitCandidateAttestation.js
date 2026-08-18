import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { sha256V4 } from "./contract.js";

export const V4_GIT_CANDIDATE_ATTESTATION_SCHEMA_VERSION = 1;
export const V4_GIT_CANDIDATE_ATTESTATION_VERSION =
  "outdoor-adventure-targeted-live-route-quality-proof-v4-git-attestation-v1";

const execFileAsync = promisify(execFile);
const HEX_40 = /^[a-f0-9]{40}$/;
export const V4_GIT_REPOSITORY_ROOT = fileURLToPath(new URL(
  "../../../",
  import.meta.url
));
const REPOSITORY_BOUND_GIT_RUNNERS = new WeakSet();
const defaultRunGit = createV4RepositoryBoundGitRunner();

export class V4GitCandidateAttestationError extends Error {
  constructor(code) {
    super(code);
    this.name = "V4GitCandidateAttestationError";
    this.code = code;
  }
}

export async function attestV4GitCandidate({
  baselineCommit,
  candidateCommit,
  runGit = defaultRunGit
}) {
  if (!HEX_40.test(baselineCommit ?? "") ||
      !HEX_40.test(candidateCommit ?? "") ||
      typeof runGit !== "function" ||
      !REPOSITORY_BOUND_GIT_RUNNERS.has(runGit)) {
    invalid("invalid_v4_git_attestation");
  }

  const headCommit = await gitOutput(runGit, [
    "rev-parse", "--verify", "HEAD^{commit}"
  ], "v4_git_unavailable");
  if (!HEX_40.test(headCommit) || headCommit !== candidateCommit) {
    invalid("v4_candidate_not_head");
  }

  const status = await gitOutput(runGit, [
    "status", "--porcelain=v1", "--untracked-files=all"
  ], "v4_git_unavailable", { trim: false });
  if (status.length !== 0) invalid("v4_candidate_worktree_dirty");

  await gitExit(runGit, [
    "cat-file", "-e", `${baselineCommit}^{commit}`
  ], "v4_baseline_commit_missing");
  await gitExit(runGit, [
    "merge-base", "--is-ancestor", baselineCommit, candidateCommit
  ], "v4_baseline_not_ancestor");

  const record = attestationRecord({ baselineCommit, candidateCommit });
  return deepFreeze({ ...record, digest: sha256V4(record) });
}

export function v4GitCandidateAttestationDigest({
  baselineCommit,
  candidateCommit
}) {
  if (!HEX_40.test(baselineCommit ?? "") ||
      !HEX_40.test(candidateCommit ?? "")) {
    invalid("invalid_v4_git_attestation");
  }
  return sha256V4(attestationRecord({ baselineCommit, candidateCommit }));
}

export function validateV4GitCandidateAttestation(
  attestation,
  expected
) {
  if (!plainObject(attestation) || !plainObject(expected) ||
      Object.keys(expected).length !== 2 ||
      Object.keys(attestation).length !== 10 ||
      attestation.schemaVersion !==
        V4_GIT_CANDIDATE_ATTESTATION_SCHEMA_VERSION ||
      attestation.contractVersion !== V4_GIT_CANDIDATE_ATTESTATION_VERSION ||
      attestation.baselineCommit !== expected.baselineCommit ||
      attestation.candidateCommit !== expected.candidateCommit ||
      attestation.headCommit !== expected.candidateCommit ||
      attestation.indexClean !== true ||
      attestation.worktreeClean !== true ||
      attestation.baselineExists !== true ||
      attestation.baselineAncestorOfCandidate !== true ||
      !/^[a-f0-9]{64}$/.test(attestation.digest ?? "")) {
    invalid("invalid_v4_git_attestation");
  }
  const { digest, ...record } = attestation;
  if (sha256V4(record) !== digest) invalid("invalid_v4_git_attestation");
  return true;
}

export function createV4RepositoryBoundGitRunner(options = {}) {
  if (!plainObject(options) ||
      Object.keys(options).some((key) => key !== "execFileImpl") ||
      (options.execFileImpl !== undefined &&
        typeof options.execFileImpl !== "function")) {
    invalid("invalid_v4_git_runner_configuration");
  }
  const execFileImpl = options.execFileImpl ?? execFileAsync;
  const repositoryRoot = V4_GIT_REPOSITORY_ROOT;
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0) {
    invalid("v4_git_repository_unavailable");
  }
  const runner = async function runRepositoryBoundGit(arguments_) {
    if (!Array.isArray(arguments_) ||
        arguments_.some((value) => typeof value !== "string")) {
      invalid("invalid_v4_git_attestation");
    }
    return execFileImpl("git", arguments_, {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 32_768
    });
  };
  REPOSITORY_BOUND_GIT_RUNNERS.add(runner);
  return runner;
}

function attestationRecord({ baselineCommit, candidateCommit }) {
  return {
    schemaVersion: V4_GIT_CANDIDATE_ATTESTATION_SCHEMA_VERSION,
    contractVersion: V4_GIT_CANDIDATE_ATTESTATION_VERSION,
    baselineCommit,
    candidateCommit,
    headCommit: candidateCommit,
    indexClean: true,
    worktreeClean: true,
    baselineExists: true,
    baselineAncestorOfCandidate: true
  };
}

async function gitOutput(runGit, arguments_, failureCode, options = {}) {
  let result;
  try {
    result = await runGit(arguments_);
  } catch {
    invalid(failureCode);
  }
  if (!plainObject(result) || typeof result.stdout !== "string") {
    invalid(failureCode);
  }
  const output = options.trim === false ? result.stdout : result.stdout.trim();
  if (output.length > 4_096) invalid(failureCode);
  return output;
}

async function gitExit(runGit, arguments_, failureCode) {
  try {
    const result = await runGit(arguments_);
    if (!plainObject(result)) invalid(failureCode);
  } catch {
    invalid(failureCode);
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" &&
    !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function invalid(code) {
  throw new V4GitCandidateAttestationError(code);
}
