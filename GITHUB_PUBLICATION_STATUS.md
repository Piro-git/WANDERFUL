# GitHub publication status

Read-only audit on 2026-09-14, before new deployment preparation changes.

- Verified repair snapshot: `767afde2e85950d9f720d5d92e99e86fbb351170`.
- Imported bundle baseline: `51c6a227756fb310046fcd9d6ddd1eb45bd41e65`.
- The repair snapshot contains 29 commits beyond that bundle baseline and was clean at audit time.
- The nested repository's `origin` points to a local bundle, not GitHub.
- GitHub repository: `Piro-git/WANDERFUL`; fetched HEAD: `adea2c08540e87f0acd7eebb976c72eab8eb76c3`.
- The fetched GitHub history and imported repair history have no merge base. Ahead/behind counts cannot be treated as ordinary unpublished-commit counts.
- Comparing the complete repair snapshot with GitHub yields 340 changed files, 38,176 insertions and 1,418 deletions. This includes substantial imported baseline work, not just this routing repair.

## Content integration check

The repair-only patch from the bundle baseline to the repair snapshot changes 41 files. It was checked with `git apply --cached --check` against an isolated temporary index populated from fetched GitHub HEAD. The active worktree and its index were not modified.

The patch does not apply cleanly. Hunk failures occur in:

- `TrailMind/Services/AppAttestService.swift`
- `TrailMind/Services/GraphHopperClient.swift`
- `TrailMind/ViewModels/PlannerViewModel.swift`
- `TrailMindTests/PlannerViewModelTests.swift`

These modified files are absent from GitHub:

- `backend/scripts/owner-phone-diagnostics.js`
- `backend/scripts/owner-phone-provider-budget.js`
- `backend/scripts/owner-phone-test-server.js`
- `backend/scripts/owner-phone-test-session.js`
- `backend/scripts/start-owner-phone-test.js`
- `backend/test/ownerPhoneDiagnostics.test.js`
- `backend/test/ownerPhoneTestServer.test.js`

## Safe next publication steps

1. Preserve the verified repair snapshot and bundles.
2. Refresh the GitHub target ref before publication and create an isolated integration branch from that ref.
3. Decide explicitly whether to integrate the complete phone-tested baseline or only a dependency-complete routing repair. A repair-only patch currently depends on code missing from GitHub.
4. Port selected changes by content, resolve the four hunk conflicts, include required missing dependencies, and run the relevant native/backend checks on the integrated result.
5. Review the exact proposed publication diff and publish a new branch/PR only when requested. Do not force-push or merge unrelated histories to bypass integration.

No push, PR, remote configuration change, or modification of the original checkout was performed in this audit. The original checkout's status command timed out after four seconds; its cleanliness remains unverified.
