# Wanderful on Mac and Codex Cloud

Use verified current `origin/main` in https://github.com/Piro-git/WANDERFUL for new development tasks. Continue unfinished tasks on their own named branches. The earlier `codex/latest-20261010` combined source was merged into main. Read `AGENTS.md` and `docs/development/LATEST_SOURCE.md`. The source publication manifest maps the current iOS, backend and QA files to their original snapshots. Earlier October receipts and backup branches remain historical records.

## Development workflow

From the repository root, use Node 22 and complete Git history:

```sh
git fetch origin
# Only in a clean new-task checkout; do not switch away from unfinished work.
git switch main
git pull --ff-only origin main
cd backend
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test -- --test-concurrency=2 --test-reporter=tap
```

From the repository root, run `node --test backend/quality-gates/routeAcceptance.test.js` and `node backend/scripts/configure-research-app.js --check`. The current source passed 1,620 backend fixture tests, 48 selected independent QA checks, 10 route contracts, nine mocked input-flow tests and an iOS Simulator build. Repeat relevant checks after source changes.

These fixture checks need no provider credentials. Do not run deployments, migrations, live-provider evaluations or actual owner enrollment as part of basic setup. Operator scripts require explicit configuration and human input; local secrets, signing material, device/session payloads and private runtime evidence are excluded from publication.

## Across devices

Configure the WANDERFUL Cloud environment to use main as the new-task baseline and review its actual checked-out commit before publishing or starting work. Existing tasks retain their own working state; publishing a new setup does not rewrite an older task. Reopen the same Cloud chat to continue that task across phone and desktop.

For local development, fetch the desired GitHub branch into a clean Mac checkout and inspect it before continuing. Commit and push intended local changes before continuing from Cloud; save Cloud work on a named branch or pull request before bringing it back to the Mac. Use `git pull --ff-only` only when the working tree is clean and the intended branch already tracks the correct remote. If it fails, compare histories and preserve changes rather than resetting or force-pushing. Keep independent tasks on their own branches.

The iOS app needs Xcode and an appropriate Apple environment for native builds, Simulator/device checks and signing. Linux fixture checks do not replace native or real-device acceptance. Personal Mac skills are not automatically synced to Cloud.

## First prompt on the phone

> Lies AGENTS.md, CLOUD_HANDOFF.md und docs/development/LATEST_SOURCE.md. Prüfe den tatsächlichen Commit und den aktuellen GitHub-Stand. Verwende für eine neue Aufgabe main als Basis und für eine Fortsetzung den benannten Arbeitszweig. Fasse den aktuellen Quellstand zusammen. Behalte reale Routengeometrie, ehrliche Datenhinweise und das Premium-iOS-Design bei. Keine Secrets lesen, keine Live-Provider-Anfragen oder Deployments starten und main nicht ungeprüft ändern.

Official Cloud workflow: https://learn.chatgpt.com/docs/cloud and https://learn.chatgpt.com/docs/environments/cloud-environments.


## One-command device handoff

The user-enabled checkpoint rules in AGENTS.md apply at work-unit boundaries,
not on a clock. The shared skill is `.agents/skills/device-handoff/SKILL.md`.
Use `$device-handoff übernehmen` at the next execution environment or
`$device-handoff übergeben` before leaving it. Natural requests such as
“Ich wechsle aufs Handy” can also select the skill. Skill-picker UI depends on
the client; when it is unavailable, ask the agent to read that exact repo file.

The agent reviews task changes, runs relevant tests, updates
`docs/handoff/<task-name>.md`, commits and pushes task-owned files to a named
branch, then confirms the actual remote commit. Informational chats are exempt.
Incomplete work stays on its task branch/draft PR; merging main is separate.
Pass the branch or PR to the next agent, or continue the same Cloud chat across
devices. A new Cloud chat on main cannot see unmerged task work unless it fetches
that task branch. Existing Cloud chats retain their own files and must inspect
them before pulling. Repository refresh does not replace this branch check.

Keep one writer per task. A task handoff records goal, decisions, completed work,
remaining steps and checks; it does not synchronize chat histories or provide a
distributed lock. Preserve dirty work and local-only commits on either side.
Never force-push, auto-stash, reset or discard work to manufacture a match.

Personal Mac skills are not automatically synced to Cloud. Fetch a branch that
contains the repo skill, or after its reviewed merge fetch current main. The
skill is a reusable procedure, not an always-running daemon or a registered slash
command. A schedule can monitor unsynced work, but cannot reliably detect device
changes or safely snapshot an agent halfway through an edit. No such timer or
lifecycle hook is installed by this change.

Official skill and task references: https://developers.openai.com/codex/skills
and https://learn.chatgpt.com/docs/automations.
