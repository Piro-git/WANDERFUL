# Wanderful App Store Release Package V1

Status: **NO-GO for public App Store release**
Stage: **Stage C three-environment artifact verification complete; external distribution, legal, backend and physical-device gates open**
Source baseline: `21f8450c976252210edf03389dc1b682d2440450`
Audit date: 2026-08-28
Shipping name: **Wanderful**
Bundle identifier: `com.trailmind.app`

## Executive decision

Wanderful is not ready for TestFlight or public submission. Current local evidence proves all three Simulator configurations, the complete deterministic non-live unit suite, the bounded relevant UI matrix, adaptive appearance/accessibility source contracts, exact lane identity and flags, built privacy manifests and fail-closed public-link slots. Physical-device App Attest, a live reviewed backend, hosted public legal/support pages, owner decisions, distribution signing and App Store Connect configuration remain unproved.

The integrated matrix proves **25 of 50 applicable release gates (50.0%)**. This percentage measures independently evidenced gates, not files created. Simulator and generic-device-build proof never substitute for an archive, physical-device or distribution proof.

## Dependency order

1. **Owner/legal decisions:** complete `OWNER_INPUTS_V1.json` only in the authorized release record: legal entity/team, record/SKU, V1 Superwall state, storefronts/pricing, categories, content rights, age rating, encryption/export, release strategy and public contacts.
2. **Public assets:** legally review the repository drafts, publish real canonical HTTPS privacy and support pages, then configure their exact URLs. The native destinations and fail-closed external-link slots already exist; empty values must remain the default until hosting is real.
3. **Backend and privacy proof:** prove the selected backend contract, App Attest enforcement, retention/logging/deletion and deployed flags; then reconcile the final App Privacy answers.
4. **Physical-device proof:** verify production App Attest with a real iPhone and a TestFlight/App Store-distributed build. Simulator evidence is invalid for this gate.
5. **Apple distribution:** configure the explicit App ID/capability, team, certificate and App Store profile; produce and validate a signed archive, then separately authorize upload, TestFlight and App Store Connect work.

## Truthful V1 product boundary

Release-reachable claims may describe:

- typed same-day hiking, trail-running and biking route requests;
- point-to-point and loop route planning;
- mapped route options with routing-response distance, estimated duration and elevation;
- comparison before opening route detail;
- local saving of verified routed results;
- GPX export through the system share sheet;
- optional voice transcription only after runtime permission and physical-device verification;
- a local Trail Profile with optional planning defaults that can be edited, reset or deleted on the device.

Do not claim live navigation, offline maps, live weather, guaranteed access, water, safety or trail conditions, verified scenic quality without mapped evidence, AI chat/editing, nationwide/global evidence coverage, a purchase/subscription offering, or superiority over a competitor.

Research-guided planning, outdoor evidence, routable-highlight access and Supabase onboarding sync are tracked as disabled. Production composition always selects a no-op profile-sync client in V1. The Superwall SDK remains a linked dependency, but production onboarding uses only the native host and does not construct or present its Superwall client. The current Release prompt parser is local; routing coordinates and constraints go to the configured backend for GraphHopper routing.

## Package map

- `RELEASE_GATE_MATRIX.md` — 50-gate authoritative matrix and completion calculation.
- `APP_STORE_METADATA_V1.md` — constrained, truthful metadata draft.
- `APP_PRIVACY_QUESTIONNAIRE_V1.md` — current answers and explicit onboarding/Supabase/Superwall deltas.
- `APP_PRIVACY_DECLARATION_DRAFT_V1.json` — machine-readable provisional App Privacy answers that cannot be published yet.
- `PRIVACY_POLICY_CONTENT_DRAFT_V1.md` — truthful unhosted policy-page content, separated into current and future/disabled behavior.
- `SUPPORT_PAGE_CONTENT_DRAFT_V1.md` — truthful unhosted support-page content and safety boundaries.
- `APP_REVIEW_NOTES_V1.md` — reviewer path and unavailable-feature disclosure.
- `SCREENSHOT_CAPTURE_PLAN_V1.md` — real-device-size capture plan; no screenshots are generated here.
- `PRIVACY_SUPPORT_URL_REQUIREMENTS_V1.md` — public URL, legal, contact, retention and deletion requirements.
- `SIGNING_TESTFLIGHT_ARCHIVE_RUNBOOK_V1.md` — stop-gated path from team setup to review.
- `APP_ATTEST_PHYSICAL_DEVICE_PROOF_V1.md` — bounded real-iPhone proof protocol.
- `OWNER_DECISIONS_V1.md` — decisions an engineer must not fabricate.
- `OWNER_INPUTS_V1.json` — bounded machine-readable owner checklist; every value remains unanswered by default.
- `EXTERNAL_ASSET_AND_ACCOUNT_INVENTORY_V1.md` — known/unknown external dependencies.
- `RELEASE_BLOCKERS_V1.json` — machine-readable blockers.
- `SOURCE_EVIDENCE_MANIFEST_V1.json` — exact source hashes and official references.

## Evidence policy

- Historical release documents are context only, never proof of current completion.
- A source-backed gate and its built-product counterpart are separate gates.
- `Configuration/Local.xcconfig` and `backend/.env` are excluded from every inspection, hash, scan and artifact.
- Unknown values remain `UNKNOWN`; no sample URL, email, Apple identifier, team, product, screenshot or approval state is valid production evidence.
- The original source inventory was retrieved on 2026-08-23. Apple App Review, App Attest, App ID, upload and TestFlight requirements were rechecked on 2026-08-26; privacy, platform-version metadata, submission workflow and third-party SDK requirements were rechecked against official Apple pages on 2026-08-28.

## Owner/archive prerequisite refresh — 2026-08-28

- The dedicated worktree started clean at exact commit `21f8450c976252210edf03389dc1b682d2440450`. The initial fetch showed no advancement. A final fetch found `origin/main` at `a36c646…`; its changes are confined to the Supabase migration operator lane and do not overlap this App Store package/tooling scope, so this branch remains based on the audited application commit.
- Focused release, privacy, public-link and accessibility tests passed **60/60**. The complete deterministic non-live unit suite passed **708/708** with only the two explicitly named live-provider methods excluded. All **7/7** completed methods in the relevant UI matrix passed; three CoreSimulator-interrupted attempts were rerun and no completed method failed.
- The complete backend suite passed **1044/1044** with no skips; backend static validation and both release-package validators pass.
- Debug, Staging and Release Simulator builds passed. The current Release artifact passes the hardened verifier **43/43**; its isolated regression suite passes **46 cases plus stale-report recovery**.
- The verifier now binds Release public-link defaults, exact first- and third-party privacy manifests, version/build, dSYM, team, signing/profile/entitlements and source/tooling provenance. Fabricated owner answers, hosted-page claims, URLs, stale hashes and generic-build-as-archive claims are rejected.
- A read-only signing preflight found zero valid identities, no provisioning-profile directory and no physical iPhone. The unsigned generic iPhoneOS build is retained only as a diagnostic; no `.xcarchive` was created and G-044 remains blocked.
- Draft privacy-policy and support-page content is intentionally unhosted. The two configured URL values remain empty, and no owner, legal, App Store Connect, TestFlight or public-hosting fact was invented.
- Historical Stage B and earlier Stage C evidence below remains immutable context and is not relabeled as this refresh's execution.

## Stage B execution record

- The clean isolated worktree selected `79c70f9…`; intervening commits were non-overlapping. The verified release correction is `8fce37f…`. The shared checkout was not changed.
- The exact iPhone 17 Pro Simulator (`A9194E37-28A7-450E-9F30-95D0145D0486`) and one task-owned DerivedData directory were used. The device was never erased or deleted.
- The focused suite passed **395/395**. The practical non-live unit target passed **672/672** in 177.6 seconds. The only exclusions were the two explicit live-provider evaluation methods named in the evidence manifest.
- All **18/18** deterministic critical-path UI tests passed: six were previously proved and the remaining twelve passed in six bounded groups. Attempt 13 staging-proof tests were not authorized or run.
- Standalone Debug and Release Simulator builds passed before and after the narrow corrections. The post-correction focused regression passed **4/4**.
- Built Debug and Release products prove Wanderful/com.trailmind.app/1.0(1), iPhone family 1, iOS 26.0, truthful permission text, all four tracked flags false, local Release parsing, empty tracked Supabase/Superwall values, no exported URL scheme, valid signatures, valid first-party/Superwall/swift-crypto privacy manifests, and no forbidden local configuration or credential-pattern match.
- The Release binary initially contained `FakeVoicePlanningService`, “Live trail geometry” and “trail-network data.” `8fce37f…` DEBUG-gates the fake and replaces the claims with narrower mapped/routed wording; the rebuilt Release contains none of the old symbols/strings. Focused tests pass.
- The icon source was converted from an opaque RGBA file to RGB without changing pixel RGB data. The rebuilt compiled catalog reports AppIcon `Opaque=true`; the verifier now enforces that contract and passes **37/37** on Release. Its isolated fixture suite passes **25 cases plus stale-report recovery**.
- Manual deterministic QA covered native onboarding, Home, profile create/edit/reset, clarification, safe error/retry, no-routes, three route choices, detail, save/reopen and GPX share handoff without selecting a destination. Reduce Motion and rapid list reuse remained responsive. Accessibility state exposed meaningful labels.
- Dark Mode inspection proved the app remains forced light due to `.preferredColorScheme(.light)`. Accessibility XXXL inspection exposed clipping/hyphenation/overlap in route suggestions. Actual VoiceOver focus handoff remains unproved; source/focused tests do not replace that runtime check.
- Route cards use bounded SwiftUI `Path` thumbnails rather than interactive maps: 512 thumbnail/4,096 map-point caps and cache capacity 48. No obvious rapid-scroll task explosion was observed.
- After the exact task-owned DerivedData path was confirmed handle-free and removed, storage settled at 28,233,920 / 28,232,880 / 28,232,824 KiB. The Simulator was shut down, not erased or deleted; no pre-existing artifact was removed.
- No archive was created because it was not necessary for the local artifact claims and would not prove distribution signing. No provider, backend, Supabase, Superwall, App Store Connect, TestFlight, upload or submission traffic or mutation occurred.

## Stage C environment and release-artifact record — 2026-08-26

- Debug, Staging and Release generic Simulator builds passed from one isolated worktree. The complete unit/UI test bundle compiled; tests were not executed because no Simulator was booted or booted by this task.
- Built identities were exact: `Wanderful Local` / `com.trailmind.app.local` / local / App Attest development; `Wanderful Staging` / `com.trailmind.app.staging` / staging / App Attest production; `Wanderful` / `com.trailmind.app` / production / App Attest production.
- All nine protected feature flags were `false` in all three products. Backend, Supabase and Superwall configuration values were empty. The production app therefore remains intentionally unavailable for live planning until the hosting lane supplies a reviewed canonical HTTPS URL.
- The hardened verifier passed **41/41** checks against the built Release app and **38** isolated adversarial cases plus stale-report recovery. It now fails closed on wrong environment identity, missing or enabled flags, nonempty service configuration, placeholder values, release mocks/overclaims, missing attribution and malformed signing/entitlement evidence.
- A pre-existing `PIPE_FAIL` defect could hide or falsely report large-binary marker matches. The verifier now performs literal in-memory marker checks; a large-binary regression case proves both required and forbidden markers behave deterministically. Generic `XCTest` and Superwall's dormant localhost test-mode string are not used as first-party release markers; linked XCTest frameworks, test bundles and Wanderful-owned test/mock markers remain prohibited.
- A generic iPhoneOS Release build passed as a non-archive build diagnostic. No `.xcarchive` exists, so archive gate G-044 remains blocked; the diagnostic is not TestFlight, signing or App Store proof.
- `security find-identity` found zero valid code-signing identities. Read-only device discovery found no connected iPhone. Therefore no signed archive, installation, physical App Attest, TestFlight or App Store Connect action was attempted.
- The selected Release composition retains required GraphHopper, OpenStreetMap/ODbL and Mapterhorn attribution plus the planning-aid boundary. `FakeVoicePlanningService`, old “Live trail geometry”/“trail-network data” wording, guaranteed-safety/scenic claims and competitor-superiority claims are prohibited.
- No backend, Supabase, GraphHopper, AI, Superwall or Apple network mutation occurred. `Configuration/Local.xcconfig`, clipboard data, private certificate material and secret values were not inspected.

The machine-readable Stage C record is `APPLE_RELEASE_READINESS_AUDIT_V1.json`. Historical Stage B executed-test evidence remains preserved separately and is not relabeled as current execution.
