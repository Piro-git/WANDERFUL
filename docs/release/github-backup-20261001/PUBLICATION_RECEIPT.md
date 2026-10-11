# GitHub publication and CI receipt — 2026-10-01

Draft PR #1 is green at `bb7cbe4627036134137dc5a5550631149c652246`; main remains `adea2c08540e87f0acd7eebb976c72eab8eb76c3`. No merge or deployment was performed.

| Purpose | Remote branch | Remote commit | Source mapping |
| --- | --- | --- | --- |
| release-recovery | [codex/release-recovery-20261001](https://github.com/Piro-git/WANDERFUL/tree/codex/release-recovery-20261001) | `bb7cbe4627036134137dc5a5550631149c652246` | exact tree |
| ci-owner | [codex/release-ci-audit-20261001](https://github.com/Piro-git/WANDERFUL/tree/codex/release-ci-audit-20261001) | `bb7cbe4627036134137dc5a5550631149c652246` | exact tree |
| storekit | [codex/backup-storekit-diagnosis-20261001](https://github.com/Piro-git/WANDERFUL/tree/codex/backup-storekit-diagnosis-20261001) | `f62358f45e3f22f23d2db6b6c4803fb575e6d4c8` | 11 selected files, exact bytes |
| ios | [codex/backup-ios-evidence-20261001](https://github.com/Piro-git/WANDERFUL/tree/codex/backup-ios-evidence-20261001) | `ebf7a447325fbcbe1dbbce2a517b7dcd46d20cde` | exact tree |
| qa | [codex/backup-route-review-20261001](https://github.com/Piro-git/WANDERFUL/tree/codex/backup-route-review-20261001) | `d256ce5d76b1c6f43cec8534fc5adc53ba9d3335` | exact tree |
| backend | [codex/backup-backend-live-20261001](https://github.com/Piro-git/WANDERFUL/tree/codex/backup-backend-live-20261001) | `4942131ed33cd0d829f2446811fd1f849968dd55` | exact tree |
| handoffs | [codex/backup-handoffs-20261001](https://github.com/Piro-git/WANDERFUL/tree/codex/backup-handoffs-20261001) | `c1d72290a087103ba210ec64131db0c1eef99e9d` | 3 reviewed redacted documents plus manifest |

## Validation

[Hosted PR run](https://github.com/Piro-git/WANDERFUL/actions/runs/36889501900): 386 JavaScript files, 1,564 backend tests passed / 0 failed / 1 guarded opt-in skip, 10 route contracts, 58 verifier cases plus stale-report recovery. Push run 36889493530 also passed.

Original historical commits were recovered by fetching full existing history. All 19 focused historical tests pass; no sealed receipt or ancestry was fabricated. OpenSSL 1.1.1w duplicate CA extensions and macOS 15 plist/JSON extraction were corrected while keeping validation strict.

## Audit limits

All 625 committed main paths were found in the old checkout. At the bounded metadata pass, 71 readable tracked files matched main or the published candidate; 554 tracked working copies remained dataless and were not content-verified. No unknown readable product source was found. Two private Xcode user-state files were excluded. Three untracked handoffs were recovered, reviewed and archived with privacy redactions. `docs/handoff/PHONE_RESEARCH_DATA_READINESS_2026-09-06.md` still timed out in bounded 2- and 5-second reads and is not backed up remotely. The full path inventory is retained locally.

The separate backend backup contains newer product fixes; the integrator must combine and validate them with the CI fixes. QA is green on that owner fix (18 deterministic cases), not on the older product tree retained in PR1. iOS evidence is 110 tests on existing source-matched simulator binaries, with empty backend URL and features off. Live admission/providers, signed phone acceptance, Apple login and StoreKit transactions remain open.

New private screenshots and credential material stayed local. Original and redacted handoff hashes are recorded in the handoff backup.
