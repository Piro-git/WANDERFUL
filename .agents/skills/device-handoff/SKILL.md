---
name: device-handoff
description: Git-Arbeitsstand und Kontext zwischen Laptop und Codex Cloud übernehmen, prüfen und sichern. Verwenden bei Gerätewechsel, Arbeitsbeginn, Übergabe, Checkpoint oder Fortsetzen eines Git-Projekts sowie für vereinbarte automatische Sicherungen nach einer Arbeitseinheit.
---

# Gerätewechsel

Keep task code and a concise handoff together on a named Git branch. This skill
does not run in the background by itself. Implicit invocation is enabled;
repository guidance can request it at the beginning and end of coding turns.

Choose the mode from the request: **Übernehmen** before editing, **Sichern**
after a coherent work unit, **Übergeben** before changing execution environments.
If only this skill is invoked, inspect the state first: resume a known task or
checkpoint task-owned work when ownership and publication permission are clear.
Do not invent a task or guess among multiple active branches.

## Shared rules

- Read the applicable AGENTS.md and project handoff first. Locate the actual Git
  root; use the active checkout specified by project guidance, not a historical copy.
- One task keeps one branch across devices. Use codex/ for new task branches.
  A new task starts from verified current origin/main (or the user's chosen base).
  A continuation uses its existing task branch, even when main has other changes.
- Only one agent writes a given task branch at a time. A handoff receipt records
  intent, not a distributed lock. If another agent is still writing, coordinate
  with the user before taking over; do not message another chat without authorization.
- Never reset, clean, auto-stash, discard files, rewrite published history or
  force-push as a shortcut. Preserve unrelated local changes and existing staged files.
- Repo publication permission must come from the current user/session or an
  applicable user-enabled repository workflow. Invoking this skill to save or
  hand off a named task authorizes its normal commit and branch push, subject to
  tool permissions. Mere discovery does not authorize arbitrary publication.
- Review only task-owned candidate source/docs. Do not open credential files,
  private runtime receipts or logs. Never include secrets, signing material,
  sessions, personal machine paths or generated private evidence in a public handoff.
- Push and merge are separate. Keep incomplete work on the task branch or a draft
  PR. Do not merge main, deploy, enroll owners or change a database through this skill.
- A personal skill and local chat history are not automatically transferred to
  Cloud. The repo copy and pushed handoff are the durable shared context. An old
  Cloud task may retain an older branch or uncommitted work; check it explicitly.

## Übernehmen

1. Identify the requested branch from the user, task PR or current handoff.
   Read [scripts/git_state.py](scripts/git_state.py) usage only when needed;
   run `python3 <skill-dir>/scripts/git_state.py --branch <task-branch> --fetch`
   from the checkout to get metadata without reading file contents. If Python 3
   is unavailable, use equivalent Git metadata commands directly. Fetch changes
   remote-tracking refs, never working files. Without a successful fetch, remote
   freshness is unverified; do not report current GitHub state as confirmed.
2. Inspect local changes and local-only commits before switching/updating.
   Resume on the intended branch only if the checkout is clean. If another branch
   has work, preserve it and use a separate checkout/worktree where allowed.
3. For a clean existing task branch, use a fast-forward-only update from its
   origin branch. If local and remote histories diverge, stop automatic updates
   and explain both sides. Preserve them and propose a reviewed merge; never
   assume one side should overwrite the other. Local-only commits need review
   and publication before a remote-only continuation can use them.
4. Read `docs/handoff/<task-name>.md` on the task branch. Summarize the goal and
   next step, confirm branch and commit, then continue the user's authorized work.
   Do not treat dated roadmaps or a previous agent's claims as verified behavior.

## Sichern / Übergeben

1. Review the task diff and relevant tests. Fix findings within task scope.
   For incomplete work, record failing or unrun checks rather than claiming a
   pass. Native iOS checks require the Mac; Cloud fixture checks cannot replace them.
2. Create/update `docs/handoff/<task-name>.md` using
   [assets/handoff-template.md](assets/handoff-template.md). Keep it short: goal,
   decisions, completed work, gaps, checks and next action. Do not put the final
   commit hash in that same commit's file; report it in the final receipt.
3. Stage an explicit allowlist of reviewed task files and the handoff. Inspect
   the staged diff before committing. Do not use blanket `git add .` or `git add -A`.
   If existing staged files are unrelated or ownership is unclear, preserve them
   and resolve the staging boundary before committing.
4. Commit on the task branch and push normally to the verified intended remote.
   A GitHub connector may substitute for unavailable CLI authentication; preserve
   the reviewed tree and parent, reject stale expected branch heads and never force.
   Reuse the task's PR; create a draft PR for unfinished work if supported/authorized.
5. Verify the remote branch points to the reported commit (a fresh Git check or
   authenticated connector). A local commit or successful-looking tool message
   alone is not a completed GitHub handoff. If publication/auth/network fails,
   keep the local commit and report the precise unsynced state; do not silently retry.
6. Return a short receipt: task branch, published commit, PR if any, check outcome,
   next action and any unsaved/unpublished files. For **Übergeben**, cease editing
   that task after the receipt. For **Sichern**, checkpoint completion does not
   prohibit a later explicitly requested work unit.

At takeover, give the next agent the branch name/PR. Saved Cloud VM state, the
environment's main branch and an unfinished task branch are distinct; neither
republishing nor a timer should overwrite a task to make them equal.
