# Wanderful on Mac and Codex Cloud

Use `codex/latest-20261010` in https://github.com/Piro-git/WANDERFUL for current combined development. Read `AGENTS.md` and `docs/development/LATEST_SOURCE.md`. The source publication manifest maps the current iOS, backend and QA files to their original snapshots. Earlier October receipts and backup branches remain historical records.

## Development workflow

From the repository root, use Node 22 and complete Git history:

```sh
git fetch origin
git switch codex/latest-20261010
cd backend
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test -- --test-concurrency=2 --test-reporter=tap
```

From the repository root, run `node --test backend/quality-gates/routeAcceptance.test.js` and `node backend/scripts/configure-research-app.js --check`. The current source passed 1,620 backend fixture tests, 48 selected independent QA checks, 10 route contracts, nine mocked input-flow tests and an iOS Simulator build. Repeat relevant checks after source changes.

These fixture checks need no provider credentials. Do not run deployments, migrations, live-provider evaluations or actual owner enrollment as part of basic setup. Operator scripts require explicit configuration and human input; local secrets, signing material, device/session payloads and private runtime evidence are excluded from publication.

## Across devices

Configure the WANDERFUL Cloud environment to use this branch and review its actual checked-out commit before publishing or starting work. Existing tasks retain their own working state; publishing a new setup does not rewrite an older task. Reopen the same Cloud chat to continue that task across phone and desktop.

For local development, fetch the desired GitHub branch into a clean Mac checkout and inspect it before continuing. Commit and push intended local changes before continuing from Cloud; save Cloud work on a named branch or pull request before bringing it back to the Mac. Use `git pull --ff-only` only when the working tree is clean and the intended branch already tracks the correct remote. If it fails, compare histories and preserve changes rather than resetting or force-pushing. Keep independent tasks on their own branches.

The iOS app needs Xcode and an appropriate Apple environment for native builds, Simulator/device checks and signing. Linux fixture checks do not replace native or real-device acceptance. Personal Mac skills are not automatically synced to Cloud.

## First prompt on the phone

> Lies AGENTS.md, CLOUD_HANDOFF.md und docs/development/LATEST_SOURCE.md. Nutze codex/latest-20261010 und prüfe den tatsächlichen Commit. Fasse den aktuellen Quellstand zusammen. Behalte reale Routengeometrie, ehrliche Datenhinweise und das Premium-iOS-Design bei. Keine Secrets lesen, keine Live-Provider-Anfragen oder Deployments starten und main nicht ungeprüft ändern.

Official Cloud workflow: https://learn.chatgpt.com/docs/cloud and https://learn.chatgpt.com/docs/environments/cloud-environments.
