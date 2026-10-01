# Independent iOS integration verification — 2026-10-01

## Authoritative source

- Public branch: `Piro-git/WANDERFUL`, `codex/release-recovery-20261001`; connector checked its current head as `1c1e18249257b9cf70dce33012f27dd8c1af0e7e` during this run. Draft PR: https://github.com/Piro-git/WANDERFUL/pull/1.
- Local recovered source: `e96b99cbacb4c6838e25855b433e257e7565bcb2`.
- Source tree: `12f1ac6f16730809b70f895e2d9811a697fe4fc6`; backend tree: `52e7a7913e2db06fc1e44e42655ce927f2ef2165`. The coordinator's publication receipt establishes equal public/local trees despite different commit IDs.
- New independent checkout: `/private/tmp/wanderful-integration-20261001`, branch `codex/ios-integration-20261001`. Created with `git clone --no-hardlinks` from the healthy recovery checkout. No alternates; `git fsck --full` passed. Neither recovery source nor old candidate Git stores were edited or used for new commits.
- Earlier iOS d40a206, backend 9c88ef3 and QA c3f3dcc source is already incorporated. No duplicate cherry-picks. This integration changes only the four text evidence files in this directory.

## Simulator artifact, distinct from a signed phone app

All 217 tracked app/test/project files plus eight tracked configuration files match the prior tested iOS source byte for byte. SOURCE-MATCH.json records relative paths and SHA-256 values. Only tracked files were inspected; local secret configuration was not opened or copied.

The existing September 30 17:42 UTC XCTest product package was reused directly without building or reusing a DerivedData directory. Its original tested source is recorded as `1594e69cbc26ce7c564689ddd36f0c7395f9c3bd` in the previous iOS handoff. This is a fresh execution of source-matched existing binaries, not a fresh compile from the reconstructed Git history.

Test package: `~/Library/Developer/XcodeBuildMCP/workspaces/EasyWander-d3f5c9563e5d/test-products/test_sim_2026-09-30T17-42-20-163Z_pid22038_56541efb.xctestproducts`.
App executable SHA-256: `b61878bfe066d8caa02e220b9cc67666026e79dd7c93b556663e2b378e6abc49`.
App: `com.trailmind.app.local`, version 1.0 (1), iOS Simulator SDK 26.5, local/development lane. The allowlisted resolved metadata is in TEST-ARTIFACT.json. Its backend URL is empty and research, remote intent, direct GraphHopper, weather, account and monetization flags are false. It is not a production-configured or physical-device artifact.

## Fresh local verification

One serial `test_sim` execution using the prepared package on the already booted iPhone 17 Pro / iOS 26.5 simulator: **110 passed, 0 failed, 0 skipped**, approximately 263 seconds.

**99 native tests:** AppEnvironment 23, DurableResearchTransport 7, DynamicResearchPlanningClient 15, HikePreparation 9, RouteCardStopPhoto 7, RouteComparisonAccessibility 2, RouteStays 5, RouteStopGeometry 9, RouteWeather 6, WikimediaCommonsPhotoResolver 16.

These cover ordered finite spherical segments and the 100 m boundary (98/102 m), sparse geometry, dateline/poles, same-segment ordering and later revisits; free quality-review safety/water prose suppression; image identity, route proximity, MIME/size/error/cache behavior; packing persistence and language-stable identifiers; dates, stale evidence, weather gating; bounded session retries and typed errors; compiled environment and canonical endpoint identity separation.

**11 UI tests:** DynamicEvidence 5, RouteCardPhoto 3, RouteStays 3. These cover packing changes across app restart and German/English selection, separate source/navigation actions, 44-point source controls, map fallback states, excluded research stops, unavailable/stale stays, and largest accessibility text.

Result: `~/Library/Developer/XcodeBuildMCP/workspaces/EasyWander-d3f5c9563e5d/result-bundles/test_sim_2026-10-01T15-43-40-251Z_pid77488_25b14b84.xcresult`.
Log: `~/Library/Developer/XcodeBuildMCP/workspaces/EasyWander-d3f5c9563e5d/logs/test_sim_2026-10-01T15-43-40-250Z_pid77488_e2560cb1.log`.
Sanitized summary: TEST-SUMMARY.json (local simulator identifier omitted).

`node backend/scripts/configure-research-app.js --check` passed; generated endpoint identity and xcconfig agree with the public manifest. `git diff --check` passed. No broad backend rerun or fresh release build is claimed.

## Visual review and remaining UI scope

New screenshots remain exclusively in `/private/tmp/wanderful-ios-private-evidence-20261001`; none are included in this commit or publication. Reviewed DE/EN photo cards, German largest-text source sheet, largest-text German stay details and DE/EN packing sheets. Route shape/start marker fit, metrics are legible, cards retain rounded calm surfaces, source actions remain separate, and large text wraps/scrolls. Packing completion and labels are legible in both languages.

The existing German route card still mixes English generated title/summary, some metrics and evidence labels. Provider-specific generated copy also remains visible. This is a concrete localization/copy follow-up, not a fully localized product acceptance. No unbuilt copy changes were introduced under the low-space constraint. Explicit synthetic fixture labels belong only to DEBUG/simulator test surfaces; they are not real photos or production acceptance evidence. Full spoken VoiceOver traversal on the physical device remains untested; automated semantic/control assertions are not that proof.

## Signing and wireless device status

One current read-only check outside the sandbox found the existing iPhone paired and available over **localNetwork**, tunnel connected, Developer Mode enabled, iOS 27.0. No new pairing or USB connection was required. The sandbox-only CoreDevice attempt could not reach the XPC service; the authorized read-only host check succeeded.

Codesigning check outside the sandbox: **zero valid identities**. Tracked DEVELOPMENT_TEAM values are empty. No signed build or install was attempted. Required user action: make the intended Apple Development signing identity and matching private key available to Xcode and identify the authorized development team. Credentials, private keys and certificates must not be posted in chat or committed. Once available, recheck only that changed prerequisite.

Read-only app-identity check found existing `com.piroscheibe.wanderful.local` version 1.0 (1); `com.trailmind.app` was absent. The latter would be a separate app, not an in-place update of the existing owner app. Do not remove the existing app, overwrite its identity or imply its saved data has migrated. Device identifiers and raw device metadata remain local.

## Backend and phone acceptance gates

`Configuration/ResearchDeployment.json` still has null staging/production entries. The generated app identity deliberately trusts no unverified backend. The backend owner has been asked for the exact deployed tree, real authenticated runtime admission and provider readiness evidence. No new health/readiness polling, provider call, database mutation or deployment was performed by the integrator.

Existing recovery validation records four full-backend-suite failures tied to absent historical Git objects; GitHub/provenance ownership remains separate. This handoff does not turn that receipt green or fabricate history. Nor does health 200 establish readiness. Before a live-configured signed app can be produced, the backend owner must supply the actual ready deployment and HTTPS/App Attest verification receipt for the canonical app manifest. Weather migration and unfinished feature gates remain closed.

**Phone acceptance: NOT RUN.** A live acceptance flow will be issued only after backend admission/provider readiness and signing are established. No physical app installation, App Store/TestFlight transfer, reset or data deletion occurred.

## Capacity and handoff

Initial available space was about 900 MiB, decreasing to about 198 MiB after serial tests and local screenshot export. No cleanup/deletion was performed in this task. Do not start a new build until capacity is restored; coordinate any cleanup rather than deleting other owners' artifacts. All new evidence offered for publication is reviewed UTF-8 text. GitHub owner retains publication/CI provenance; backend owner retains deployment; this task owns the app candidate only.
