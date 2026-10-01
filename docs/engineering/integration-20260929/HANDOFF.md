# Integrated candidate — 2026-09-29

> Source-only publication: referenced UI screenshots are retained locally by the integration owner; no screenshot PNG bytes are included or retrievable from this branch. Textual test results are retained; visual acceptance is not independently reproducible from this PR alone.

## Ownership and source

Sole integration checkout: `/Users/REDACTED/.codex/worktrees/c025/EasyWander/iphone-candidate`.
Branch: `codex/integrated-candidate-20260929`, based on `83a99c0d9f4dc6e457437eca2a29f306d3b8233a`.
Git common store: `/private/tmp/wanderful-iphone-release-20260926/.git`; preserve it with the checkout. The enclosing original worktree has an unavailable Git store; do not transplant its `.git` file.

Feature commits were fetched from the three owners' isolated checkouts, then cherry-picked in this order:

| Source | Source commits | Integrated commits |
| --- | --- | --- |
| Photos and packing | cb3eb30, f9a1568, 4a61cff, a680335, ba8da71, 1c0111a | fd96d7b, b2bb6b7, 7027b32, d410318, 3fcae6a, 4ff8bde |
| Weather | 910bccd, 70f1be8, 78f5dc9, 188c885 | d1854a2, 2d32268, eebb720, 383a73b |
| Overnight stays | b789692, 5c6d27c, 09f7430, d9c6bd6, f0bb107 | e2f8ba8, 3398399, fc71af8, 8e85fdd, f166a18 |
| Privacy gates | 2995fe1c581663c10a5c505fca69fdd36e7b16c0, semantic integration | 59ef2e3 |

Additional integration QA commit: `3e21da6` (test-only fixtures, deterministic English core UI tests, photo-credit accessibility identifier). Tested source commit is `3e21da6abc5d3638f72b104969a9f3d805ad5914`; integrated backend tree is `d246e0d211c105da828658994c2cbb364af46ede`.

See `evidence/ordered-commits.txt` for full integrated commit identities. Newer photo identity checks, gallery and resolver tests were retained when applying the privacy patch. Shared dynamic-response handling retains both validated photo evidence and optional route stays; RouteDetailView retains stays and the separately gated weather card. No deployment, physical-device install, user-data reset or remote push was performed.

## Validation

- Full backend harness: **1541 passed, 0 failed, 1 skipped**, 1542 tests and 126 suites. Optional database/performance suites are skipped without their opt-in environments; this does not prove deployed Postgres behavior. `npm run build` successfully compiled **380 files**. Log: `/private/tmp/wanderful-integrated-backend-20260929.log`.
- Native focused integration (including legacy packing and saved-stays age/roundtrip): **151 passed, 0 failed, 0 skipped**. Covers HikePreparation, WikimediaCommonsPhotoResolver, DynamicResearchPlanningClient, SavedRouteStore, RouteStays, RouteWeather, AppEnvironment, PrivacyReleaseContent and ReleaseSurfaceTruth. Authoritative xcresult summary is checked in; the tool's discovery count of 152 is not the executed count.
- Feature UI run: **7 passed, 0 failed, 0 skipped**. Evidence revision/exclusion, expired/missing evidence, DE/EN camping selection and water checkbox, stays source/map actions, unavailable/empty/stale states, largest German text size, privacy/help.
- Verifier self-tests: **56 isolated cases plus stale-report recovery passed**. Contract now requires `ROUTE_WEATHER_ENABLED=false` in addition to the existing closed account/monetization gates.
- Additional UI regression: **6 passed, 0 failed, 0 skipped**. Point-to-point, three loop variants, no-route recovery, isolated save/reopen/delete; real PreparationStore restart with a dedicated fixture route ID and DE→EN switch; full long-credit accessibility label and source/licence link reachability at largest text size in both languages. Total selected UI acceptance: **13/13 passed**.
- **Release arm64 simulator build succeeded** (132.7 seconds), with one existing Apple-account window initializer deprecation warning and no errors. Artifact: `/private/tmp/wanderful-integrated-dd-20260929/Build/Products/Release-iphonesimulator/TrailMind.app`.
- **Actual Release artifact verifier: 41 passed, 4 failed**. Failures are `code_signature_integrity`, `signing_identity_contract`, `entitlement_contract`, `final_signature_recheck`; this build deliberately used `CODE_SIGNING_ALLOWED=NO`. Final verifier status remains **failed**, not release-ready. Privacy/background-mode/disclosure, release surface, no-test-marker and weather-off checks passed. `evidence/release-artifact.json` includes the binary SHA-256 and exact check IDs.

Native tests ran serially on an existing iPhone 17 Pro simulator, iOS 26.5 / arm64. XcodeBuildMCP derived data: `/private/tmp/wanderful-integrated-dd-20260929`; package checkout: `/private/tmp/wanderful-weather-build/SourcePackages`. Simulator was booted for the authorized acceptance work. No provider traffic is needed by the synthetic fixtures. Only completed, regenerable build intermediates/module caches were removed (including this candidate’s finished Debug intermediates before Release compilation) to recover disk space; sources, Git stores, app products, logs and xcresults were retained.

## Visual and accessibility evidence

`snapshots/ui/manifest.json` records local-only screenshot filenames and their tests; the image files are not published. `snapshots/weather/manifest.json` records metadata for four local-only native weather snapshots (DE standard, EN standard, DE no date, DE accessibility size). These are explicitly synthetic weather forecasts, never proof that the disabled production feature is live.

Visual review: DE/EN packing controls and checked state are readable; stays source text retains permission/access uncertainty, OSM attribution and data dates. Largest German stays text wraps vertically in a scroll view. Weather has readable time, units, source and model time at standard size; accessibility size stacks the metrics vertically. Lower content requires scrolling at large sizes. The offline-test navigation title is test-only.

`snapshots/source-credit/manifest.json` records metadata for DE/EN screenshots held only in the local handoff, before and after scrolling the long synthetic attribution. The integration owner reported their final text and both source/licence actions visible at the largest type size with Reduced Motion enabled; no image bytes are available in this source-only branch. No photo URL is loaded by this source-sheet fixture.

UI automation checks accessible labels/values and reachable controls. This is **not** a full VoiceOver speech, gesture order or physical-device accessibility acceptance. That remains open, as do live gallery image loading, photo deduplication on a live accepted route, offline image failures, two-region photo identity acceptance and current-iPhone packing persistence. Long-credit source-sheet and cross-launch packing tests use dedicated synthetic fixtures and do not claim a real photographed place.

## Release gates and next owner actions

- **Weather remains OFF** in native Shared/Development settings and the backend default. Do not activate until backend owner approves provider terms/contact identity, deployed distributed caching/fleet-wide rate limiting and an explicitly selected bounded real-route/date smoke test. Current process-local cache/rate limits do not cover a serverless fleet.
- **Signing/device blocked:** latest local check found zero valid code-signing identities and Owner unavailable. Existing phone app remains untouched. A valid Apple account/team/profile and an available device are required for signed install and real-device acceptance. Debug candidate bundle is `com.trailmind.app.local`; existing Owner bundle is `com.example.owner.wanderful.local`; do not assume they share data or overwrite either.
- **Backend blocked:** backend owner last verified public health 200, readiness 503, route APIs 503. Provider/App Attest configuration is missing; deployment manifest remains null. Source/backend changes here are not deployed. Backend owner must approve and deploy the integrated backend before any production route acceptance.
- Accounts and monetization remain disabled. Existing minimal-host StoreKit failures are a runtime/toolchain gate, not fixed by these feature branches; no repeated uninformative StoreKit retries were performed.
- Physical acceptance still needs point-to-point and loop routes with real geometry, persistent save/reopen and packing, verified photos with complete attribution, overnight evidence/source age and offline behavior. Simulator fixtures and unsigned Release verification do not satisfy these gates.

Historical device/backend acceptance context: `docs/release/iphone-20260926/ACCEPTANCE.md`. Feature detail and provider constraints: `docs/engineering/photos-packing-20260929/HANDOFF.md`, `docs/handoffs/route-weather-20260929.md`, `HANDOFF_ROUTE_STAYS_20260929.md`.

## Reproduction receipts

All receipt paths below are within `~/Library/Developer/XcodeBuildMCP/workspaces/EasyWander-d3f5c9563e5d/`:

- Native: `result-bundles/test_sim_2026-09-29T13-48-50-419Z_pid5292_2fec565e.xcresult`.
- Feature UI: `result-bundles/test_sim_2026-09-29T13-50-43-046Z_pid5292_f5aed019.xcresult`.
- Added UI/core regression: `result-bundles/test_sim_2026-09-29T13-58-54-687Z_pid5292_c3fb3d00.xcresult`.
- Release build: `logs/build_sim_2026-09-29T14-03-08-263Z_pid5292_dea70661.log`.

Reproduce backend checks from `backend/` with `npm ci --ignore-scripts --no-audit --no-fund`, `npm run build`, and `npm test -- --test-reporter=tap`. Run `zsh scripts/test-release-artifact-verifier.sh` from the candidate root. The actual artifact command is `zsh scripts/verify-release-artifact.sh simulator-app /private/tmp/wanderful-integrated-dd-20260929/Build/Products/Release-iphonesimulator/TrailMind.app`; expect nonzero exit while unsigned.

XcodeBuildMCP session used project `TrailMind.xcodeproj`, scheme `TrailMind`, Debug for tests and Release for final compilation, simulator `A9194E37-28A7-450E-9F30-95D0145D0486`, arm64, `CODE_SIGNING_ALLOWED=NO`, `ONLY_ACTIVE_ARCH=YES`, `-disableAutomaticPackageResolution`, and `-clonedSourcePackagesDirPath /private/tmp/wanderful-weather-build/SourcePackages`. Test selectors are named above; UI runs use `-parallel-testing-enabled NO`. No wider native-suite or physical-device pass is asserted.

## 2026-09-30 — Health query robustness follow-up

Backend owner commit `6609659399ff5bff6d7991a23ca0a7cb2fae01bc`, based on `0ff0fce`, was reviewed and cherry-picked as `e0d2883122ac0fd9b9fec4098866463e9be7a1b7`. Current backend tree: `9a5147111278d13dbfb9c4b74833d8484d56c5f5`.

Only `backend/api/index.js` and `backend/test/vercelHealthPaths.test.js` changed. GET health matching ignores the query string without decoding/normalizing the path or changing `request.url`. Exact health aliases remain recognized; readiness stays fail-closed. API paths, lookalikes, encoded paths and non-GET methods do not bypass production admission.

Integrator verification:

- New regression tests: **3/3 passed**, run directly with `node --test backend/test/vercelHealthPaths.test.js`.
- Backend build: **381 files checked, no failures**.
- Full harness: **1544 passed, 0 failed, 1 skipped**, 1545 tests / 126 suites; optional database/performance suites remain opt-in. Initial sandbox run produced exactly 32 `listen EPERM` errors on `127.0.0.1`; rerun with approved local-server access passed. Logs: `/private/tmp/wanderful-integrated-backend-20260930.log` (sandbox), `/private/tmp/wanderful-integrated-backend-20260930-loopback.log` (successful), `/private/tmp/wanderful-integrated-build-20260930.log`.
- `git diff --check` clean. No Swift/configuration changes; existing iOS receipts above remain the relevant native validation and were not rerun for this backend-only patch.

The backend owner's dated direct observation was exact `/healthz` → 200 and `/readyz` → 503. Query-bearing probes had returned generic `service_unavailable`; this patch fixes that separate robustness issue. **No newly proven production liveness regression or explanation of the connector discrepancy is claimed.** No deployment or live verification of this patch occurred. Weather remains off; signing/device/backend activation gates remain open.
