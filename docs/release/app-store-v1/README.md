# Wanderful App Store V1 release handoff

Assessment date: 2026-08-30

Audited base: `adea2c08540e87f0acd7eebb976c72eab8eb76c3` (`origin/main`)

Task branch: `codex/wanderful-app-store-v1-release-audit`

Shipping identity: **Wanderful**, `com.trailmind.app`, version `1.0`, build `1`

## Decision

**The iOS Release surface is locally verified, but the repository is not yet ready to upload to TestFlight or submit to App Review.**

Two blockers apply to TestFlight:

1. Production core routing is unavailable. The tracked Release has an empty backend URL, direct GraphHopper is disabled, and the production gateway intentionally fails closed. This is the correct secret-safe behavior, but the app cannot deliver its core planning function until an owner-approved GraphHopper routing endpoint is configured and verified.
2. No distributable signed archive can be created from the repository as supplied because `DEVELOPMENT_TEAM` is empty. The task did not inspect or modify certificates, provisioning profiles, or private signing material.

Public App Store submission additionally requires owner-approved public privacy/support URLs, final App Privacy answers, App Store Connect fields, legal/content-rights decisions, screenshots, and explicit upload/submission authority.

A dependency-free, fail-closed public privacy/support site package now exists under `public-site`. Its source remains visibly draft-only and noindex. The checked-in placeholder configuration is intentionally rejected; a publishable render requires all controller/contact/provider/retention/legal fields plus owner and legal approval. No domain, hosting, deployment, DNS, or app/App Store URL configuration has occurred.

The following are **not V1 blockers under the owner decision for this release**:

- research-guided planning, outdoor evidence, routable highlights, and remote intent are off;
- Supabase onboarding/profile sync is off and production composes the no-op sync path;
- Superwall is off, has an empty key, and native onboarding is used;
- physical App Attest proof was not available locally and is not used as a stop condition for this V1 audit.

No upload, TestFlight mutation, App Store Connect mutation, backend change, provider change, or live GraphHopper/AI request occurred.

## What V1 can truthfully claim

After production routing is configured, the reviewed V1 surface supports:

- typed hiking, trail-running, and biking route requests;
- point-to-point and loop planning;
- mapped route options with routing-response distance, estimated duration, and elevation;
- comparison, route detail, local saves, and GPX export through the system share sheet;
- optional Apple Speech transcription when the user invokes voice input;
- a local Trail Profile that can be edited, reset, or deleted.

V1 does not offer live or turn-by-turn navigation, offline maps, weather, closure/water intelligence, guaranteed safety/access/scenery, remote AI chat or route editing, accounts/cloud sync, subscriptions, or purchases.

Requested preferences are not presented as verified route facts. Safety copy tells users to review the route and check weather, local rules, trail conditions, closures, and water availability.

## Local verification record

| Evidence | Result |
| --- | --- |
| Focused release-copy/config regressions | 7/7 passed |
| Complete deterministic unit suite | 710/710 passed |
| Explicit live-provider exclusions | 2 methods excluded by name; no live provider traffic |
| Critical UI matrix | 9/9 passed |
| Debug Simulator build | Passed |
| Release Simulator build and launch | Passed on iPhone 17 Pro, iOS 26.5 |
| Manual Release walkthrough | Home, Profile, Privacy & data, Help & safety, and safe retry/edit error state passed visual review |
| Release artifact contract | 43/43 passed |
| Artifact-verifier self-tests | 46 isolated cases plus stale-report recovery passed |
| Unsigned generic-iOS Release archive | Passed; arm64 app and dSYM present; Xcode store bundle validation passed |
| Signed distribution archive | Not attempted; Apple team/signing inputs are absent and out of task authority |
| Physical iPhone run | Not available through the configured device workflow |

The critical UI matrix covered onboarding, point-to-point output, three loop options, native privacy/help, clarification, recoverable retry, no-route recovery, save/reopen/delete, and GPX system handoff.

The manually exercised Release planning request failed safely because production routing is unconfigured. It showed user-safe retry/edit controls and no developer configuration text. Runtime-log checks found zero GraphHopper, OpenAI, or Supabase endpoint hits.

## Release configuration contract

All protected Release feature flags are exactly `false`:

- `DIRECT_GRAPHHOPPER_ENABLED`
- `INSECURE_LOCAL_BACKEND_AUTH_ENABLED`
- `IN_MEMORY_APP_ATTEST_ENABLED`
- `OUTDOOR_EVIDENCE_ENABLED`
- `REMOTE_INTENT_ENABLED`
- `RESEARCH_GUIDED_PLANNING_ENABLED`
- `ROUTABLE_HIGHLIGHT_ACCESS_ENABLED`
- `SUPABASE_ONBOARDING_SYNC_ENABLED`
- `SUPERWALL_ENABLED`

Tracked service values for the production backend, Supabase URL/key, and Superwall key are empty. Privacy and support URL slots are empty and fail closed; the app retains complete native Privacy & data and Help & safety pages.

Release uses the production App Attest entitlement. The first-party privacy manifest declares tracking `false`, linked Device ID for App Functionality, and required-reason File Timestamp/UserDefaults APIs. Embedded Superwall and swift-crypto manifests also declare tracking `false`; Superwall declares unlinked Purchase History for App Functionality even though its V1 surface is disabled. The final App Privacy form must reconcile that embedded declaration conservatively.

## Corrections made in this audit

- Replaced developer-only missing-key guidance with a user-safe routing-unavailable message.
- Replaced “live” and “real route” overclaims with precise routed/mapped wording.
- Updated release-surface regression tests and forbidden binary markers to prevent those strings returning.
- Added an identity/version regression for Wanderful, `com.trailmind.app`, and `1.0 (1)`.
- Added `@MainActor` to the staging UI-test class to remove Swift 6 actor-isolation warnings.

## Exact owner actions

### Required before any TestFlight upload

1. Approve and configure the production GraphHopper routing endpoint used by the existing backend gateway. Keep provider secrets off-device. Verify point-to-point, loop, retry, and no-route behavior from the exact Release build.
2. Select the Apple Developer team and App Store provisioning setup for `com.trailmind.app`, with the production App Attest capability matching `TrailMindRelease.entitlements`.
3. Confirm that version/build `1.0 (1)` is unused in App Store Connect; increment the build only if required.
4. Create a signed Release archive, validate it, run `scripts/verify-release-artifact.sh distribution-signed-archive <archive>`, and perform physical-iPhone smoke testing if a device is available.
5. Give explicit upload authority. This repository audit does not grant it.

### Required before public App Review submission

1. Publish and configure canonical HTTPS privacy-policy and support URLs with a monitored contact.
2. Approve the legal entity/developer name, rights to the Wanderful name and supplied assets, copyright, category, age rating, content-rights declaration, storefronts, and export-compliance answers.
3. Finalize App Privacy answers against the actual production routing retention/logging policy and the embedded Superwall Purchase History declaration.
4. Create/verify the App Store Connect record and SKU, then approve the metadata in `APP_STORE_METADATA_V1.md` and review notes in `APP_REVIEW_NOTES_V1.md`.
5. Capture screenshots from the final signed Release build; do not show disabled features.
6. Give explicit App Review submission authority.

## Package map

- `RELEASE_GATE_MATRIX.md` — current technical and owner gate status.
- `RELEASE_BLOCKERS_V1.json` — machine-readable current blockers and follow-ups.
- `APP_STORE_METADATA_V1.md` — truthful English metadata draft.
- `APP_PRIVACY_QUESTIONNAIRE_V1.md` and `APP_PRIVACY_DECLARATION_DRAFT_V1.json` — provisional privacy answers.
- `APP_REVIEW_NOTES_V1.md` — reviewer path once production routing is enabled.
- `SIGNING_TESTFLIGHT_ARCHIVE_RUNBOOK_V1.md` — bounded owner-operated distribution procedure.
- `OWNER_DECISIONS_V1.md` — exact non-engineering decisions still required.
- `OWNER_LEGAL_INPUTS_V1.md` — short completion form for legal identity, processors, retention, rights, terms, and hosting facts.
- `APP_STORE_PRIVACY_ANSWERS_ENGINE_ENABLED_V1.md` — provisional App Privacy decision sheet if the advanced engine is enabled.
- `LEGAL_AND_PLATFORM_SOURCE_NOTE_V1.md` — dated primary-source Apple/EU/German research and legal-review stop list.
- `DEPLOY_STATIC_LEGAL_SITE_V1.md` — owner-operated static rendering, hosting, verification, URL, and rollback procedure.
- `public-site/` — responsive static privacy, support, privacy-choices, and terms templates with a fail-closed renderer/validator.
- `SCREENSHOT_CAPTURE_PLAN_V1.md`, `PRIVACY_POLICY_CONTENT_DRAFT_V1.md`, and `SUPPORT_PAGE_CONTENT_DRAFT_V1.md` — final-asset inputs.

Older audit/evidence files in this directory are retained as historical records. They do not override this handoff or prove current signing, public hosting, TestFlight, or App Store Connect state.
