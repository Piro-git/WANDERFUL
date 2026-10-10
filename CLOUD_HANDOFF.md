# Wanderful on Mac and Codex Cloud

Updated 10 October 2026. This is the entry point for continuing development across Mac and phone. Read `AGENTS.md` first. GitHub is the shared source of code; a cloud chat keeps its own workspace and can be reopened across devices.

## Use the current development branch

- Repository: https://github.com/Piro-git/WANDERFUL
- Cloud development branch: `codex/cloud-workspace-20261010`.
- Starting commit: `0448f0e5b44348b37fcf2cd99d92dbee8034e22d`, the published recovery candidate plus its publication receipt.
- Product code is inherited from the tested recovery candidate `bb7cbe4627036134137dc5a5550631149c652246`. This transfer adds documentation only.
- `main` remains the older August snapshot `adea2c08540e87f0acd7eebb976c72eab8eb76c3`. Starting from `main` alone omits substantial later development.

The development branch is a continuation baseline, not an App Store or deployment approval. Do not replace `main`, merge unrelated histories, or automatically combine the backup branches.

## Project reality and next work

Wanderful is the product name; the Xcode project and many types retain the TrailMind name. The source contains SwiftUI/MapKit route planning, a Node backend, research-led route planning, real GraphHopper geometry, route comparison and thumbnails, saved routes, preparation, localization, and gated account/commerce/other features. Source presence does not establish that a feature is enabled or working in production.

The older feature summaries in `AGENTS.md` and `PROJECT_CONTEXT.md` are historical. Do not restart already implemented thumbnails or add a new AI/backend stack because those summaries describe an earlier MVP. Resolve the intended place using available providers; historical regional fixtures do not define product coverage.

The [public publication receipt](https://github.com/Piro-git/WANDERFUL/blob/codex/backup-inventory-20261001/docs/release/github-backup-20261001/PUBLICATION_RECEIPT.md) is available locally at `docs/release/github-backup-20261001/PUBLICATION_RECEIPT.md`. It records passing hosted fixture/CI checks on the recovery candidate, but also separate newer backend fixes awaiting integration. First read that receipt and the relevant current source before selecting a product task. The next engineering step is to compare the newer backend backup with this baseline, propose a narrow integration, and validate the chosen changes. This transfer itself does not integrate those fixes or enable dormant features.

Open release gates include live provider/backend acceptance, distribution signing and physical iPhone acceptance, Apple login and StoreKit runtime transactions. Check dated receipts against current behavior before claiming progress; a fixture pass does not prove a live route or purchase.

## Preserved work on GitHub

The public publication receipt lists these preserved refs:

| Purpose | Branch | Commit |
| --- | --- | --- |
| Recovery candidate and CI | `codex/release-recovery-20261001` | `bb7cbe4627036134137dc5a5550631149c652246` |
| Published inventory | `codex/backup-inventory-20261001` | `0448f0e5b44348b37fcf2cd99d92dbee8034e22d` |
| Newer backend fixes | `codex/backup-backend-live-20261001` | `4942131ed33cd0d829f2446811fd1f849968dd55` |
| iOS evidence | `codex/backup-ios-evidence-20261001` | `ebf7a447325fbcbe1dbbce2a517b7dcd46d20cde` |
| Route review | `codex/backup-route-review-20261001` | `d256ce5d76b1c6f43cec8534fc5adc53ba9d3335` |
| StoreKit diagnosis | `codex/backup-storekit-diagnosis-20261001` | `f62358f45e3f22f23d2db6b6c4803fb575e6d4c8` |
| Reviewed handoffs | `codex/backup-handoffs-20261001` | `c1d72290a087103ba210ec64131db0c1eef99e9d` |

## Cloud setup and checks

Create or select a cloud environment for **Piro-git/WANDERFUL**. Set its repository branch to `codex/cloud-workspace-20261010` if a branch selector is available. If the environment initially checks out `main`, ask its setup agent to fetch and switch to the development branch before testing and publishing. Require complete repository history: several provenance tests inspect historical commits.

From the repository root, with Node 22 or newer:

```sh
git fetch origin
git switch codex/cloud-workspace-20261010
git log -1 --oneline
cd backend
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test -- --test-concurrency=2 --test-reporter=tap
```

Then, from the repository root:

```sh
node --test backend/quality-gates/routeAcceptance.test.js
node backend/scripts/configure-research-app.js --check
git diff --check
```

The basic fixture workflow needs no GraphHopper, AI-provider, database, or Apple credentials. Leave live-provider and database opt-in tests disabled during setup. Do not run deployment, migration, production operations, or paid live evaluations as part of this transfer. Existing macOS GitHub CI runs the synthetic release-verifier checks; platform-specific checks require suitable tools.

Review the environment's setup report and select **Publish** or **Republish** after it has switched to the right branch and completed the supported checks. Environment publishing is separate from publishing code to GitHub; this file does not certify environment publication.

On the phone, sign in with the same ChatGPT account, open **Codex**, select the published environment, and reopen the same cloud chat when continuing that task. A new chat gets a separate workspace. On desktop, choose **Work in → Cloud** for that same environment/chat. Personal Mac skills are not automatically synced, as described in the official Cloud documentation.

## Returning changes to the Mac

Commit and push cloud work on a named branch, or open a pull request. On the Mac, fetch that branch and inspect it before continuing. Keep each independent task on its own branch. In a clean checkout already on the development branch, use `git pull --ff-only`; if it fails, compare histories instead of resetting or force-pushing. Before switching from local development back to Cloud, commit and push the intended local changes.

iOS builds, SwiftUI/MapKit runtime checks, simulator/device work, signing and StoreKit acceptance belong on a Mac with Xcode or an explicitly configured Apple build service. Cloud/backend fixture tests do not replace that validation. For native source edits, follow the applicable iOS skill when available and the shared Xcode schemes in the repository.

## Keep private configuration local

Never upload `Configuration/Local.xcconfig`, `.env` files, signing identities, device identifiers, private screenshots or location data. Do not copy personal Codex configuration/authentication folders to GitHub. Supply a provider credential through the environment's protected configuration only if a later, explicitly requested task needs it. Basic setup works without provider secrets. These secret-handling rules also appear in the repository's existing `AGENTS.md` and `.gitignore`.

## First prompt on the phone

> Arbeite an Wanderful. Lies zuerst AGENTS.md, CLOUD_HANDOFF.md und docs/release/github-backup-20261001/PUBLICATION_RECEIPT.md. Nutze codex/cloud-workspace-20261010 und prüfe den tatsächlichen Branch. Fasse den aktuellen Quellstand und die nächsten offenen Integrationsschritte zusammen. Prüfe die neueren Backend-Backups, bevor du Produktänderungen vorschlägst. Keine Secrets lesen, keine Deployments oder Live-Provider-Tests starten und main nicht überschreiben. Halte das Premium-iOS-Design und reale Routendaten bei. Sichere neue Arbeit auf einem eigenen Branch und dokumentiere die durchgeführten Prüfungen.

Official Cloud workflow: https://learn.chatgpt.com/docs/cloud and https://learn.chatgpt.com/docs/environments/cloud-environments.
