import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  V4_GIT_REPOSITORY_ROOT,
  attestV4GitCandidate,
  createV4RepositoryBoundGitRunner,
  validateV4GitCandidateAttestation
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/gitCandidateAttestation.js";

const BASELINE = "1".repeat(40);
const CANDIDATE = "2".repeat(40);

describe("V4 Git candidate attestation", () => {
  it("attests an exact clean HEAD with an existing ancestor baseline", async () => {
    const { runGit, calls } = gitSeam();
    const attestation = await attestV4GitCandidate({
      baselineCommit: BASELINE,
      candidateCommit: CANDIDATE,
      runGit
    });
    assert.equal(validateV4GitCandidateAttestation(attestation, {
      baselineCommit: BASELINE,
      candidateCommit: CANDIDATE
    }), true);
    assert.deepEqual(calls, [
      "rev-parse --verify HEAD^{commit}",
      "status --porcelain=v1 --untracked-files=all",
      `cat-file -e ${BASELINE}^{commit}`,
      `merge-base --is-ancestor ${BASELINE} ${CANDIDATE}`
    ]);
    assert.deepEqual(Object.keys(attestation).sort(), [
      "baselineAncestorOfCandidate", "baselineCommit", "baselineExists",
      "candidateCommit", "contractVersion", "digest", "headCommit",
      "indexClean", "schemaVersion", "worktreeClean"
    ]);
    assert.equal(JSON.stringify(attestation).includes("/"), false);
  });

  it("rejects a candidate that is not the actual HEAD", async () => {
    const { runGit, calls } = gitSeam({ head: "3".repeat(40) });
    await assert.rejects(() => attestV4GitCandidate({
      baselineCommit: BASELINE,
      candidateCommit: CANDIDATE,
      runGit
    }), hasCode("v4_candidate_not_head"));
    assert.equal(calls.length, 1);
  });

  it("rejects staged, unstaged, or untracked dirty state", async () => {
    for (const status of [
      "M  backend/file.js\n",
      " M backend/file.js\n",
      "?? backend/new.js\n"
    ]) {
      const { runGit } = gitSeam({ status });
      await assert.rejects(() => attestV4GitCandidate({
        baselineCommit: BASELINE,
        candidateCommit: CANDIDATE,
        runGit
      }), hasCode("v4_candidate_worktree_dirty"));
    }
  });

  it("rejects a missing baseline", async () => {
    const { runGit } = gitSeam({ missingBaseline: true });
    await assert.rejects(() => attestV4GitCandidate({
      baselineCommit: BASELINE,
      candidateCommit: CANDIDATE,
      runGit
    }), hasCode("v4_baseline_commit_missing"));
  });

  it("rejects a baseline that is not an ancestor", async () => {
    const { runGit } = gitSeam({ nonAncestor: true });
    await assert.rejects(() => attestV4GitCandidate({
      baselineCommit: BASELINE,
      candidateCommit: CANDIDATE,
      runGit
    }), hasCode("v4_baseline_not_ancestor"));
  });

  it("fails closed when Git is unavailable", async () => {
    const runGit = createV4RepositoryBoundGitRunner({
      async execFileImpl() { throw new Error("unavailable"); }
    });
    await assert.rejects(() => attestV4GitCandidate({
      baselineCommit: BASELINE,
      candidateCommit: CANDIDATE,
      runGit
    }), hasCode("v4_git_unavailable"));
  });

  it("attests the module repository when invoked from an unrelated directory", async () => {
    const unrelated = await mkdtemp(
      "/private/tmp/TrailMindV4GitAttestation-unrelated-"
    );
    const originalDirectory = process.cwd();
    const seam = gitSeam();
    const invocations = [];
    const runGit = createV4RepositoryBoundGitRunner({
      async execFileImpl(file, arguments_, options) {
        invocations.push({ file, arguments_, options });
        return seam.runGit(arguments_);
      }
    });
    try {
      process.chdir(unrelated);
      await attestV4GitCandidate({
        baselineCommit: BASELINE,
        candidateCommit: CANDIDATE,
        runGit
      });
      assert.equal(process.cwd(), unrelated);
      assert.equal(invocations.length, 4);
      assert.equal(invocations.every(({ file }) => file === "git"), true);
      assert.equal(invocations.every(({ options }) =>
        options.cwd === V4_GIT_REPOSITORY_ROOT
      ), true);
      assert.notEqual(V4_GIT_REPOSITORY_ROOT, unrelated);
    } finally {
      process.chdir(originalDirectory);
      await rm(unrelated, { recursive: true, force: true });
    }
  });

  it("cannot switch attestation to a caller-selected parent or nested repository", async () => {
    const directory = await mkdtemp(
      "/private/tmp/TrailMindV4GitAttestation-other-repositories-"
    );
    const parentRepository = `${directory}/parent-repository`;
    const nestedRepository = `${parentRepository}/nested-repository`;
    await mkdir(`${parentRepository}/.git`, { recursive: true });
    await mkdir(`${nestedRepository}/.git`, { recursive: true });
    const originalDirectory = process.cwd();
    const seam = gitSeam();
    const observedWorkingDirectories = [];
    const runGit = createV4RepositoryBoundGitRunner({
      async execFileImpl(_file, arguments_, options) {
        observedWorkingDirectories.push(options.cwd);
        return seam.runGit(arguments_);
      }
    });
    try {
      for (const callerDirectory of [parentRepository, nestedRepository]) {
        process.chdir(callerDirectory);
        await attestV4GitCandidate({
          baselineCommit: BASELINE,
          candidateCommit: CANDIDATE,
          runGit
        });
      }
      assert.equal(observedWorkingDirectories.length, 8);
      assert.equal(observedWorkingDirectories.every((cwd) =>
        cwd === V4_GIT_REPOSITORY_ROOT
      ), true);
      assert.equal(observedWorkingDirectories.includes(parentRepository),
        false);
      assert.equal(observedWorkingDirectories.includes(nestedRepository),
        false);
      assert.throws(() => createV4RepositoryBoundGitRunner({
        execFileImpl: async () => ({ stdout: "" }),
        repositoryRoot: nestedRepository
      }), hasCode("invalid_v4_git_runner_configuration"));
    } finally {
      process.chdir(originalDirectory);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails before credential, ledger, or provider operations", async () => {
    const operations = { credential: 0, ledger: 0, provider: 0 };
    const preOperationAdmission = async () => {
      await attestV4GitCandidate({
        baselineCommit: BASELINE,
        candidateCommit: CANDIDATE,
        runGit: gitSeam({ status: "?? dirty\n" }).runGit
      });
      operations.credential += 1;
      operations.ledger += 1;
      operations.provider += 1;
    };
    await assert.rejects(preOperationAdmission,
      hasCode("v4_candidate_worktree_dirty"));
    assert.deepEqual(operations, { credential: 0, ledger: 0, provider: 0 });
  });
});

function gitSeam({
  head = CANDIDATE,
  status = "",
  missingBaseline = false,
  nonAncestor = false
} = {}) {
  const calls = [];
  const runGit = createV4RepositoryBoundGitRunner({
    async execFileImpl(_file, arguments_) {
      const call = arguments_.join(" ");
      calls.push(call);
      if (arguments_[0] === "rev-parse") return { stdout: `${head}\n` };
      if (arguments_[0] === "status") return { stdout: status };
      if (arguments_[0] === "cat-file") {
        if (missingBaseline) throw Object.assign(new Error("missing"), {
          code: 128
        });
        return { stdout: "" };
      }
      if (arguments_[0] === "merge-base") {
        if (nonAncestor) throw Object.assign(new Error("not ancestor"), {
          code: 1
        });
        return { stdout: "" };
      }
      throw new Error("unexpected git invocation");
    }
  });
  return {
    calls,
    runGit
  };
}

function hasCode(code) {
  return (error) => error?.code === code;
}
