# Wanderful App Store Release Package V1

Status: **NO-GO for public App Store release**
Stage: **Stage B local Simulator verification complete; external distribution, legal, backend and physical-device gates open**
Source baseline: `8fce37f2c4db552a3a2ba8acad636fd0b80327ec`
Audit date: 2026-08-23
Shipping name: **Wanderful**
Bundle identifier: `com.trailmind.app`

## Executive decision

Wanderful is not ready for TestFlight or public submission. Local Stage B evidence now proves the complete non-live unit/UI suites, standalone Debug and Release Simulator builds, deterministic onboarding/planning/save/export/error paths, built identity/flags/privacy manifests/signatures/icon opacity, and exclusion of fake voice code and overclaimed provider copy from Release. It also found two release-visible accessibility gaps: the app forces light appearance, and route cards do not remain acceptably legible at accessibility XXXL. Physical-device App Attest, production-backend rehearsal, public legal/support assets, owner decisions, signing and App Store Connect configuration remain unproved.

The integrated matrix proves **24 of 50 applicable release gates (48.0%)**. This percentage measures independently evidenced gates, not files created. Simulator proof never substitutes for physical-device or distribution proof.

## Dependency order

1. **Fix the verified accessibility defects:** remove the forced-light override only after UI-wide Dark Mode review, and make suggestion cards robust at accessibility XXXL; then rerun focused visual/accessibility regression.
2. **Owner/legal decisions:** decide Apple legal entity/team, V1 Superwall exclusion, launch geography, categories, content rights, age-rating answers, encryption/export answers, and public contacts.
3. **Public assets:** publish reachable HTTPS privacy and support pages; add an easily accessible in-app privacy-policy link through a separately owned source change.
4. **Backend and privacy proof:** prove the selected production backend contract, App Attest enforcement, retention/logging and deployed flags; reconcile the final App Privacy answers.
5. **Physical-device proof:** verify production App Attest with a real iPhone and a TestFlight/App Store-distributed build. Simulator evidence is invalid for this gate.
6. **Apple distribution:** configure the explicit App ID/capability, team, certificate and App Store profile; produce and validate a signed archive, upload, process in TestFlight, and complete App Store Connect configuration.

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
- `APP_REVIEW_NOTES_V1.md` — reviewer path and unavailable-feature disclosure.
- `SCREENSHOT_CAPTURE_PLAN_V1.md` — real-device-size capture plan; no screenshots are generated here.
- `PRIVACY_SUPPORT_URL_REQUIREMENTS_V1.md` — public URL, legal, contact, retention and deletion requirements.
- `SIGNING_TESTFLIGHT_ARCHIVE_RUNBOOK_V1.md` — stop-gated path from team setup to review.
- `APP_ATTEST_PHYSICAL_DEVICE_PROOF_V1.md` — bounded real-iPhone proof protocol.
- `OWNER_DECISIONS_V1.md` — decisions an engineer must not fabricate.
- `EXTERNAL_ASSET_AND_ACCOUNT_INVENTORY_V1.md` — known/unknown external dependencies.
- `RELEASE_BLOCKERS_V1.json` — machine-readable blockers.
- `SOURCE_EVIDENCE_MANIFEST_V1.json` — exact source hashes and official references.

## Evidence policy

- Historical release documents are context only, never proof of current completion.
- A source-backed gate and its built-product counterpart are separate gates.
- `Configuration/Local.xcconfig` and `backend/.env` are excluded from every inspection, hash, scan and artifact.
- Unknown values remain `UNKNOWN`; no sample URL, email, Apple identifier, team, product, screenshot or approval state is valid production evidence.
- All official web sources in this package were retrieved on 2026-08-23.

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
