# Device handoff skill

- Task / branch: `codex/device-handoff-skill`
- Status: ready for review
- Last writer: local; handed off after publication receipt
- Goal: reusable local/Cloud Git and context handoff with routine task checkpoints.

## Completed and decisions

Added `.agents/skills/device-handoff` with implicit discovery, skill-picker
metadata, takeover/checkpoint/handoff modes and a public handoff template.
The user enabled scoped automatic checkpoints in AGENTS.md. Git state helper
only inspects metadata and optionally fetches/observes remote refs; it cannot
commit, switch, merge, reset, stash, clean or push. The agent reviews exact task
files before publication. Updated old main/combined-source branch guidance.

A personal skill is available locally; the repo copy is the shared Cloud source.
No lifecycle hook, timer, merge automation or distributed writer lock is installed.
Explicit main merge remains separate from routine task branch publication.

## Checks

Skill creator validation passed. Twelve isolated real-Git tests passed, including
dirty/untracked preservation, ahead/behind/diverged histories, detached HEAD,
different branch, missing/deleted remote and failed fetch. Added a GitHub Actions
job for those tests. Git metadata helper was checked against this task checkout.
No iOS/backend runtime source changed; native/live/device acceptance was not rerun.
CI status is reported in the PR, not claimed in this pre-publication document.

## Remaining and next action

Review the PR and successful checks, then merge when authorized. In a new or
existing Cloud coding chat fetch this task branch (or main after merge) and read
`.agents/skills/device-handoff/SKILL.md`. A published environment alone does not
transfer this unfinished branch or personal Mac skills into an existing task.

When continuing development, use a separate task branch and handoff named for
that task. Pass its branch/PR at takeover. Keep one writer and preserve existing
work. GitHub branch protection was not changed by this skill installation.
