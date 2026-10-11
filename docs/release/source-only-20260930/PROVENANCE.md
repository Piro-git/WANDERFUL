# Source-only integrated candidate review — 30 September 2026

Prepared locally only. Remote publication and Draft PR creation require approval of this exact final source-only version. No further remote objects, branch or PR have been created for it.

## Source and history

- Authoritative candidate: `1f5d268c39a540a2f22b205cbc55bbb3d81c366a`.
- Complete private source tree: `fa6805e4c4165c48396674132039474f7683412e`.
- Backend tree: `9a5147111278d13dbfb9c4b74833d8484d56c5f5`.
- Base/sole parent of this reconstruction: GitHub main `adea2c08540e87f0acd7eebb976c72eab8eb76c3`.
- Local snapshot root: `171f4e350058c304c6d7277526a76a43a3ed0ce4`; GitHub root: `fabc9df08badc667df3d847a758ed5d2f6be72b7`.

The complete, non-shallow histories have no merge-base. The initial local root is a documented recovery snapshot after stalled Git metadata; the original root manifest's 823 file hashes were verified against that root. No ancestral connection is invented. Source-to-main comparison is 485 files, +48,525 / −1,437; this includes integrated baseline work, not just the latest feature or Health patch.

The older full-evidence review `99645a9` and earlier `0b83aba` remain local and are not parents of this branch. This branch was created anew from main; loading the exact candidate before publication edits reproduced tree `fa6805e4c4165c48396674132039474f7683412e`.

## Materially different source-only scope

Automatic approval review rejected a public PNG upload in the full-evidence proposal because it did not consider sensitive-content absence and exact binary-egress authorization established. No rejected bytes were retried or transferred by another method. The coordinator subsequently requested a separate source-only scope and then explicitly required local preparation only, pending approval of the final version.

All **21 documentation PNGs (10,871,332 bytes)** are omitted from this tree and from its new reachable commit objects and bundle. Their names, hashes and local-only status are in `LOCAL_SCREENSHOTS.json`; the complete evidence remains in the private local integrator/full-review handoff. They are not available from this branch. Existing public app assets are unchanged from main and required for the application; they are not any of the excluded 21 screenshots. No new binary blob is included in the source-only diff.

Shipping application, Xcode project, configuration, backend, tests, original verifier scripts and required app assets are byte-identical to `1f5d268`. Publication-only differences: omitted documentation images; documentation redaction/local-only notices and manifest metadata; ignore rules; a CI workflow; these review receipts. `DOCUMENT_CHANGES.json` records exact source and publication hashes for the adapted pre-existing documentation.

The new `e0d2883` Health integration recognizes query-bearing GET health paths without decoding or rewriting protected request URLs. Its three regression tests preserve fail-closed readiness and reject lookalikes/method bypasses. It is a local robustness change, not production readiness proof. The semantic privacy correction is already integrated; no obsolete patch is reapplied.

## Review value and limits

Code, unit tests, CI and textual/hash evidence are independently reviewable. Direct screenshot QA is intentionally unavailable from this PR. Historical screenshot assessments remain attributed to local integration work; they are not a claim that image bytes can be retrieved publicly.

No source/configuration/feature flag has been activated. No unrelated-history merge, force-push, main update, deployment, signed build, iPhone installation or store submission occurs here.

## GitHub observations

Fresh read before local preparation: public repository, main unchanged at `adea2c0`, no matching new review branch, no open PR. Existing Actions workflow count is zero; main reports `protected=false`. Connector reports push/admin but CLI HTTPS returns 401 and SSH publickey authentication fails. A prior small PR-description blob was created, unattached to a release branch; no release commit/ref was created. No source-only remote write has been attempted. Approval of this final text/source scope, then fresh remote-state checks, must precede publication.
