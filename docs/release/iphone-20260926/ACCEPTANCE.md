# Owner physical-device acceptance — 26 September 2026

Status: **not accepted; no candidate installed**. This record separates source/build evidence from a real user-flow pass.

## Candidate and isolation

- Authoritative source: `/Users/REDACTED/Library/Application Support/Wanderful-Recovery/release-wave-20260915/integration`, branch `codex/integration-20260915`.
- Verified starting application source SHA: `c2ed264988a3a2ebc3f9bbe5d6a2f61324c449ff`.
- Working branch: `codex/iphone-release-20260926`.
- Isolated worktree: `/Users/REDACTED/.codex/worktrees/c025/EasyWander/iphone-candidate`.
- Git store: `/private/tmp/wanderful-iphone-release-20260926/.git`; preserve it while this worktree is needed.
- The original Codex worktree uses a Documents Git store whose local fetch failed with `fatal: mmap failed: Operation canceled`. A local independent clone (`--no-hardlinks`) of the reviewed Recovery repository succeeded; no foreign changes were overwritten.
- Account/Store source fixes have now been integrated after review and targeted XCTest execution (see current integration section below). Feature flags, bundle identifiers, backend deployment and credentials remain unchanged.

## Fresh device and signing observations

- Owner: physical iPhone 17 Pro, iOS 27.0 (24A437).
- CoreDevice: `REDACTED-DEVICE-ID`.
- Xcode destination UDID: `REDACTED-DEVICE-UDID`.
- `devicectl`: available/paired, localNetwork transport, connected tunnel, Developer Mode enabled, developer disk image services available. Wireless installation is supported; USB is unnecessary.
- `security find-identity -v -p codesigning`: **0 valid identities**. Neither standard provisioning-profile directory contains a profile.
- Xcode Settings → Apple Accounts visibly shows “Add Apple Account…” and no signed-in account. No credentials or private keys were read.
- Project `DEVELOPMENT_TEAM` remains empty; signing style is Automatic.
- Existing installed app: **Wanderful Local 1.0 (1), `com.example.owner.wanderful.local`**.
- Reviewed Debug candidate: **`com.trailmind.app.local`**. An installation under that identity would be a separate app, not an update/migration of the existing app. Do not uninstall or relabel the existing app; resolve intended identity and authorized team before installation.
- No app uninstall, reset, launch, installation, or user-data mutation has been performed on Owner by this task.

## Build and independent checks

- Existing unsigned device artifact: `/private/tmp/WanderfulIntegrationDeviceCompile/Build/Products/Debug-iphoneos/TrailMind.app`. Its Info.plist reports local/development, 1.0 (1), and disabled account, Apple Sign In, monetization and research. It has no embedded provisioning profile or code-signature directory. This corroborates the prior unsigned build record; it is not installable acceptance evidence.
- A fresh signed build initially failed during SPM binary extraction due to a full Data volume (116 MiB free). Only this task's incomplete temporary DerivedData was removed. The coordinator subsequently freed regenerable prior build data; the relevant unsigned device artifact was preserved.
- Fresh signed retry with existing package checkouts reached provisioning and failed with exit 65: `Signing for "TrailMind" requires a development team. Select a development team in the Signing & Capabilities editor.` Log: `/private/tmp/wanderful-iphone-signing-retry-20260926.log`. No install was attempted.
- Public deployment generation check passed: `node backend/scripts/configure-research-app.js --check`.
- `git diff --check` passed before this report.
- Existing `WanderfulIntegrationHomeCommonsSerial.xcresult` was independently read with `xcresulttool`: **15 passed, 0 failed, 0 skipped**, iOS 26.5 Simulator. These are historical language/Commons tests, not a fresh physical-device run.
- The historical 31-test result path `WanderfulIntegrationNativeSerial.xcresult` currently lacks its Info.plist and cannot be independently reopened. Do not treat the current on-disk directory as a new passing result.

## Backend and capability gate

The backend owner is task `01a0dd4f-371b-7f61-8c27-c4cbf26f9c84`. Only that owner deploys or changes the backend. A verified public-origin/health handoff has now been received, but readiness and the App Attest contract remain blocked.

Backend-owner receipt, 2026-09-26 10:58:15 UTC (independently read from the supplied JSON):

- Public origin: `https://backend-zeta-amber-69.vercel.app`, no credentials or redirect following in the probes, no SSO redirect returned.
- Owner-reported final deployment: `dpl_CvYtmCNGKzJju5T8EAe8bzMhToTM`, READY; actual function `api/index`.
- Owner-reported source: `bcc6e3adacf04305b1cf6d35e826b3fc7cce97e7`; backend tree `59770ad87001e66577e7cbf163cc9119cef0d2c1`, matching the candidate backend.
- GET `/healthz`: 200, `{"status":"live"}`. GET `/readyz`: 503, `{"status":"not_ready"}`.
- Empty unauthenticated POSTs to `/api/parse-intent`, `/api/llm-plan-route`, `/api/route`, `/api/app-attest/challenge`, and `/api/account/apple/sign-in`: all 503 `service_unavailable`.
- Owner reports missing Google/GraphHopper credentials, App Attest database/prefix configuration, and runtime/provider/budget flags. Existing bundle/environment setting names are insufficient to prove their values match a signed lane.
- Receipt: `/Users/REDACTED/.codex/worktrees/89f8/EasyWander/outputs/backend-production-20260926/public-probes.json`.
- **Origin is reachable, not approved for manifest activation or live-route acceptance.** No app configuration changed on the strength of liveness alone.

`Configuration/ResearchDeployment.json` has null staging and production entries; the generated host policy remains unavailable. Debug's normal host policy is loopback-only. Staging/Release pin exact reviewed hosts and use production App Attest. Before enabling a lane, verify the public origin, deployed SHA, health/readiness, app-ID prefix + bundle ID, and App Attest environment together. No old URL, provider key, OwnerPhoneTest token, mock result, or authentication bypass is acceptable proof.

Account, Apple Sign In, Superwall and monetization stay disabled pending the separate account/commerce owner's reviewed runtime gate. Remote research should only be enabled by the reviewed deployment configuration; do not weaken signed lane checks to make the URL work.

## Physical acceptance matrix (all pending)

Record the installed source/build SHA, signed Team.BundleID, selected lane, public origin and backend SHA, installation result, and launch time before these checks. Capture actual route values; do not fill expected values with invented measurements.

| Check | Input / action | Required observation | Actual |
| --- | --- | --- | --- |
| German, Harz | “Plane eine etwa 12 km lange Rundwanderung ab Ilsenburg mit einem recherchierten Aussichtspunkt. Zeige mir, welche Highlights tatsächlich an der Route liegen.” | Real response, GraphHopper geometry and distance/duration/elevation, sourced highlight identity and truthful route membership | Not run |
| English, outside Harz | “Plan an approximately 8 km loop hike from Heidelberg with researched historic places. Explain which highlights the route actually reaches.” | Independent region resolution, real geometry/stats, sourced identities; no Harz fixture carry-over | Not run |
| Point-to-point regression | “Plan a hike from Ilsenburg to Schierke.” | Correct start/end and genuine routed geometry, or honest provider error | Not run |
| Commons positive | Open a returned highlight with matching Wikidata P18 or explicit Commons mapping | Matching subject/file identity, author, licence and working attribution source; no name-only image substitution | Not run |
| No photo | Open a returned highlight lacking verified Commons metadata | Honest no-photo state, no unrelated image, route remains usable | Not run |
| Preparation persistence | Save route, check a named item, close/reopen preparation, restart app and reopen same saved route | Same item remains checked; route identity remains stable | Not run |
| DE/EN | Switch language in Profile and reopen app | Selected language persists; Home/Profile/preparation/error copy inspected | Not run |
| Active guidance while locked | Start guidance explicitly, lock screen/switch app, then pause/end | Continued active guidance with visible system indicator; pause/end stops updates; observe battery behavior on the physical device | Not run |
| Attribution at device sizes | Open a real photo with long credits and the route map at supported text sizes | Complete author/licence links wrap visibly; native map attribution remains accessible | Not run |
| Offline/error | With owner's controlled network change or scoped network test, request a new route; then restore connectivity and retry | Clear recoverable state, no mock route presented as live, saved content/checklist preserved | Not run |

## Next action

The single immediate user action is to sign into the authorized Apple Developer account in the already-open Xcode Settings → Apple Accounts window and report when the team is visible. Then inspect its team/certificate/profile capabilities without printing private material. Backend readiness is handled independently by its owner. Do not mark this acceptance complete until the exact signed candidate has passed the physical-device matrix.

## Account/Store bundle review history — superseded by integration below

- Verified local bundle: `/Users/REDACTED/.codex/worktrees/8a1f/EasyWander/account-store-delivery-20260926/account-store-release.bundle`; prerequisite SHA exactly `c2ed264988a3a2ebc3f9bbe5d6a2f61324c449ff`.
- Imported for inspection only as `refs/remotes/account-review/release`, head `9865333141fd8bd70ea1849b96455790ea8c6570`; functional fix commit `a97576786d224a93ac43def0ee65d2242acf306d`.
- Reviewed native Apple-button request/completion changes, session UI, entitlement deadlines, grace-period revocation checks, restore failure handling, and regression-test additions. No activation settings are included.
- Owner reports Debug/Release compilation, XCTest build-for-testing, 6 backend contract tests and 51 verifier self-tests passed. XCTest execution and Apple Sandbox are still unproved. Release artifact check reports 37 passes/8 failures, including four unsigned-artifact checks and four existing contract/content mismatches.
- **Not cherry-picked.** Owner explicitly requests the targeted AccountAuthentication, PremiumAccess, StoreKitCatalog and StoreKitTransactionLifecycle XCTest run before source acceptance. Simulator-start request is already pending in the owner task; no duplicate request or device-data mutation was made here.
- Physical candidate application source remains c2ed264; only this acceptance record changed. The goal remains blocked on signing and backend readiness, with this additional runtime gate pending for the optional account fixes.

Restore follow-up: also verified `account-store-restore-followup.bundle` from the same delivery directory against c2ed264 and advanced the review-only ref to `c8efab743e394e4e01064d8f567949ef9f58379e`. The additional adapter guard rejects a missing matching subscription catalog with `productUnavailable`; its direct adapter regression was inspected. Owner reports fresh Debug test compilation and Release arm64 build passed, with unchanged 37/8 artifact results. XCTest still has not run; none of the three account commits is cherry-picked.

## Current integration — source accepted, activation not accepted

Four reviewed commits were cherry-picked without conflicts after the requested targeted XCTest execution became available. Integrated application-source commit: `41a44355c489ae6ab632c4aa098a756f8fad753d`.

| Account owner commit | Integration commit |
| --- | --- |
| a97576786d224a93ac43def0ee65d2242acf306d | 3b42497 |
| 9865333141fd8bd70ea1849b96455790ea8c6570 | 8abfecf |
| c8efab743e394e4e01064d8f567949ef9f58379e | e15f9ed |
| ecbd70d59d0c7b9f5256a358e2133f0a381ad62f | 41a44355c489ae6ab632c4aa098a756f8fad753d |

The integrated tree matches the owner's tested `ecbd70d` tree exactly except for this iPhone acceptance document. The Release build log independently ends in `BUILD SUCCEEDED`; no redundant build of identical application source was run. `git diff --check` passes, and configuration/entitlements are unchanged.

Independently opened raw result bundles:

- `/private/tmp/wanderful-account-targeted-20260926.xcresult`: 43 executed, **40 passed, 3 failed, 0 skipped**. AccountAuthentication 18/18 and PremiumAccess 21/21 pass; fixture shape passes. Actual StoreKit catalog is empty and both transaction tests fail `notEntitled`.
- `/private/tmp/wanderful-storekit-signed-20260926.xcresult`: **1 passed, 3 failed, 0 skipped**, same failures with normal simulator ad-hoc signing.
- `/private/tmp/wanderful-account-revocation-final-release.log`: Release simulator build succeeds. This is not a physical-device or distribution-signature proof.

The local Apple credential-state handling, legacy compatibility, captured-session race protection and tests were reviewed before adoption. Source acceptance does not establish Apple login, deletion, Sandbox purchase or restore correctness in production. Account, Apple Sign In and monetization remain false. StoreKit runtime and the eight release-artifact failures remain explicit open gates; no assertions were weakened and no failures were relabeled as skips or passes.

No candidate has been installed on Owner. All physical acceptance rows above remain pending; goal remains blocked on signing and backend readiness.

## Privacy/release handoff reviewed — 27 September 2026

Reviewed `2995fe1c581663c10a5c505fca69fdd36e7b16c0` against base `914a2c122c134bd321305a2461c3d0c8fa88c451`. Bundle verified at `/Users/REDACTED/.codex/worktrees/30ac/EasyWander/release-privacy-gates-20260927.bundle`; it advertises **HEAD**, not a named branch. Imported only into `privacy-review/release`. Per the handoff, the release owner alone cherry-picks/integrates/pushes this patch. It is not yet in this iPhone candidate.

Reviewed exact background-mode validation, unchanged permission/entitlement/feature configuration, retained forbidden mocks/fallbacks/Always/ATS, Commons attribution-file identity guard, wrapped credits and privacy disclosure. Independently reopened raw focused XCTest: 50 passed/0 failed/0 skipped; UI retry: 1 passed/0 failed/0 skipped. The earlier localization-related UI failure remains in the handoff evidence. Independently checked final Release log `BUILD SUCCEEDED` and actual executable SHA256 `014a9d967adcc9cefda5c38eb4c46ef080b4599f7e6f3a92fa896abe50b12f7d`, matching the 41-pass/4-fail artifact receipt. Remaining failures are code signature integrity, signing identity, entitlement contract and final signature recheck. This is still a failed unsigned-artifact verdict, not signed-release approval.

Physical background behavior, long-credit live-photo layout and map attribution were added to the device matrix above. Existing signing, backend readiness, live-route/media, Account/StoreKit and device-data preservation gates remain open. Await the release owner's final integrated source SHA before building the next device candidate.
