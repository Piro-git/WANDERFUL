"""Exercise real Git histories in disposable local repos, without network access."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HELPER = Path(__file__).with_name("git_state.py")


class GitStateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.origin, self.local, self.other = (root / name for name in ("origin.git", "local", "other"))
        self.env = {**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
                    "GIT_AUTHOR_NAME": "Fixture", "GIT_COMMITTER_NAME": "Fixture",
                    "GIT_AUTHOR_EMAIL": "fixture@example.invalid",
                    "GIT_COMMITTER_EMAIL": "fixture@example.invalid"}
        self.git(root, "init", "--bare", str(self.origin))
        self.git(root, "init", "-b", "codex/task", str(self.local))
        self.commit(self.local, "base.txt")
        self.git(self.local, "remote", "add", "origin", str(self.origin))
        self.git(self.local, "push", "-u", "origin", "codex/task")
        self.git(root, "clone", "--branch", "codex/task", str(self.origin), str(self.other))

    def git(self, cwd, *args):
        return subprocess.run(["git", *args], cwd=cwd, env=self.env, check=True,
                              capture_output=True, text=True).stdout.strip()

    def commit(self, cwd, name):
        (cwd / name).write_text(name + "\n")
        self.git(cwd, "add", name)
        self.git(cwd, "commit", "-m", name)

    def inspect(self, *args):
        result = subprocess.run([sys.executable, str(HELPER), *args], cwd=self.local,
                                env=self.env, capture_output=True, text=True)
        return result.returncode, json.loads(result.stdout)

    def test_verified_equal_heads(self):
        code, state = self.inspect("--fetch")
        self.assertEqual(code, 0)
        self.assertEqual(state["readiness"], "ready")
        self.assertEqual(state["head"], state["origin_task_commit"])

    def test_cached_refs_are_not_claimed_fresh(self):
        _, state = self.inspect()
        self.assertEqual(state["readiness"], "remote_unverified")
        self.assertFalse(state["remote_verified"])

    def test_dirty_work_survives_fetch(self):
        path = self.local / "base.txt"
        path.write_text("unfinished\n")
        (self.local / "untracked.txt").write_text("keep me\n")
        _, state = self.inspect("--fetch")
        self.assertEqual(state["readiness"], "dirty")
        self.assertEqual(path.read_text(), "unfinished\n")
        self.assertTrue((self.local / "untracked.txt").exists())

    def test_remote_ahead_does_not_update_checkout(self):
        before = self.git(self.local, "rev-parse", "HEAD")
        self.commit(self.other, "remote.txt")
        self.git(self.other, "push", "origin", "codex/task")
        _, state = self.inspect("--fetch")
        self.assertEqual(state["readiness"], "remote_ahead")
        self.assertTrue(state["can_fast_forward"])
        self.assertEqual(self.git(self.local, "rev-parse", "HEAD"), before)
        self.assertFalse((self.local / "remote.txt").exists())

    def test_local_only_commit_preserved(self):
        self.commit(self.local, "local.txt")
        _, state = self.inspect("--fetch")
        self.assertEqual(state["readiness"], "local_ahead")
        self.assertEqual(state["ahead"], 1)

    def test_divergence_preserves_both_histories(self):
        self.commit(self.local, "local.txt")
        before = self.git(self.local, "rev-parse", "HEAD")
        self.commit(self.other, "remote.txt")
        self.git(self.other, "push", "origin", "codex/task")
        _, state = self.inspect("--fetch")
        self.assertEqual(state["readiness"], "diverged")
        self.assertEqual((state["ahead"], state["behind"]), (1, 1))
        self.assertEqual(self.git(self.local, "rev-parse", "HEAD"), before)

    def test_different_branch_is_not_checked_out(self):
        self.git(self.local, "branch", "codex/other")
        _, state = self.inspect("--branch", "codex/other", "--fetch")
        self.assertEqual(state["readiness"], "different_branch")
        self.assertEqual(self.git(self.local, "branch", "--show-current"), "codex/task")

    def test_missing_remote(self):
        self.git(self.local, "switch", "-c", "codex/new")
        _, state = self.inspect("--fetch")
        self.assertEqual(state["readiness"], "missing_remote")

    def test_deleted_remote_does_not_use_stale_tracking_ref(self):
        self.git(self.other, "push", "origin", "--delete", "codex/task")
        self.assertTrue(self.git(self.local, "rev-parse", "refs/remotes/origin/codex/task"))
        _, state = self.inspect("--fetch")
        self.assertEqual(state["readiness"], "missing_remote")
        self.assertIsNone(state["origin_task_commit"])

    def test_detached_head_is_not_resumed(self):
        self.git(self.local, "checkout", "--detach")
        _, state = self.inspect("--fetch")
        self.assertEqual(state["readiness"], "detached")

    def test_invalid_branch_rejected(self):
        code, state = self.inspect("--branch", "bad..branch")
        self.assertEqual(code, 1)
        self.assertEqual(state["readiness"], "error")

    def test_failed_fetch_does_not_claim_remote_verified(self):
        self.git(self.local, "remote", "set-url", "origin", str(self.origin / "missing"))
        code, state = self.inspect("--fetch")
        self.assertEqual(code, 1)
        self.assertFalse(state["remote_verified"])
        self.assertNotIn(str(self.origin), json.dumps(state))


if __name__ == "__main__":
    unittest.main()
