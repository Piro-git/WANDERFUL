#!/usr/bin/env python3
"""Inspect task Git metadata; optionally fetch without changing working files."""
import argparse
import json
import os
import subprocess


class GitFailure(Exception):
    pass


def git(*args, optional=False):
    result = subprocess.run(
        ["git", *args], capture_output=True, text=True, timeout=60,
        env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
    )
    if result.returncode:
        if optional:
            return None
        # Do not expose remote URLs, authentication messages or credential values.
        raise GitFailure(f"Git operation failed: {args[0]}")
    return result.stdout.strip()


def inspect(branch=None, fetch=False):
    git("rev-parse", "--show-toplevel")
    current = git("symbolic-ref", "--quiet", "--short", "HEAD", optional=True)
    target = branch or current
    if target is not None:
        git("check-ref-format", "refs/heads/" + target)
    if fetch:
        git("fetch", "--no-tags", "origin")
    head = git("rev-parse", "--verify", "HEAD")
    changes = git("status", "--porcelain=v1", "-z", "--untracked-files=normal")
    dirty = bool(changes)
    local = git("rev-parse", "--verify", "refs/heads/" + target,
                optional=True) if target else None
    remote = git("rev-parse", "--verify", "refs/remotes/origin/" + target,
                 optional=True) if target else None
    if fetch and target:
        # Fetch without prune can leave a deleted branch's cached ref behind.
        # Observe the actual remote head; do not mistake that cache for GitHub.
        observed = git("ls-remote", "--heads", "origin", "refs/heads/" + target)
        remote = observed.split()[0] if observed else None
    ahead = behind = None
    if local and remote:
        ahead, behind = map(int, git("rev-list", "--left-right", "--count",
                                     local + "..." + remote).split())
    if not current:
        readiness = "detached"
    elif dirty:
        readiness = "dirty"
    elif target != current:
        readiness = "different_branch"
    elif not remote:
        readiness = "missing_remote"
    elif not fetch:
        readiness = "remote_unverified"
    elif ahead and behind:
        readiness = "diverged"
    elif ahead:
        readiness = "local_ahead"
    elif behind:
        readiness = "remote_ahead"
    else:
        readiness = "ready"
    return {
        "current_branch": current, "task_branch": target, "head": head,
        "task_local_commit": local, "origin_task_commit": remote,
        "dirty": dirty, "ahead": ahead, "behind": behind,
        "remote_verified": fetch, "readiness": readiness,
        "can_fast_forward": readiness == "remote_ahead",
        "working_files_changed_by_helper": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--branch", help="Task branch to inspect; defaults to current branch")
    parser.add_argument("--fetch", action="store_true",
                        help="Refresh origin tracking refs; needs authorized network access")
    args = parser.parse_args()
    try:
        print(json.dumps(inspect(args.branch, args.fetch), indent=2))
    except (GitFailure, subprocess.TimeoutExpired, OSError) as error:
        message = str(error) if isinstance(error, GitFailure) else "Git unavailable or timed out"
        print(json.dumps({"readiness": "error", "error": message,
                          "remote_verified": False}))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
