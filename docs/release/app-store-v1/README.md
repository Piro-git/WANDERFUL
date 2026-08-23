# Wanderful App Store Release Package V1

Status: **NO-GO for public App Store release**
Stage: **Stage A complete; Stage B source integration complete; Xcode/runtime verification blocked by storage**
Source baseline: `d61011098afa5f53ec4cc8ab1b3503ac1111e04a`
Audit date: 2026-08-23
Shipping name: **Wanderful**
Bundle identifier: `com.trailmind.app`

## Executive decision

Wanderful is not ready for TestFlight or public submission. The integrated source has a coherent iPhone-only route-planning product, native local onboarding and Trail Profile storage, explicit safety boundaries, a first-party privacy manifest, production App Attest entitlements, local prompt parsing in Release, and disabled tracked research, Supabase-sync and Superwall configuration. Those are source-level facts, not substitutes for this lane's built-product/runtime proof, a signed build, physical-device App Attest proof, a production-backend rehearsal, public legal/support assets, or App Store Connect configuration.

The integrated matrix proves **14 of 50 applicable release gates (28.0%)**. This percentage measures independently evidenced gates, not files created. It deliberately does not count upstream build reports as this release lane's built-product proof.

## Dependency order

1. **Restore safe local build headroom:** APFS initially reported 10,782,900 KiB available, only 297,140 KiB above the mandatory 10,485,760 KiB floor; the final validation check fell to 10,476,192 KiB, 9,568 KiB below the floor. Do not start Xcode until a complete bounded run can stay above the floor.
2. **Stage B local verification:** with exclusive Xcode/Simulator ownership, run the Build iOS Apps workflow, focused and complete non-live tests, Debug/Release builds, deterministic runtime QA, built-product inspection, and candidate-defect confirmation.
3. **Owner/legal decisions:** decide Apple legal entity/team, V1 Superwall exclusion, launch geography, categories, content rights, age-rating answers, encryption/export answers, and public contacts.
4. **Public assets:** publish reachable HTTPS privacy and support pages; add an easily accessible in-app privacy-policy link through a separately owned source change.
5. **Physical-device proof:** verify production App Attest with a real iPhone and a TestFlight/App Store-distributed build. Simulator evidence is invalid for this gate.
6. **Apple distribution:** configure the explicit App ID/capability, team, certificate and App Store profile; archive, validate, upload, process in TestFlight, and complete App Store Connect metadata/privacy/review configuration.

## Truthful V1 product boundary

Release-reachable claims may describe:

- typed same-day hiking, trail-running and biking route requests;
- point-to-point and loop route planning;
- mapped route options with routing-response distance, estimated duration and elevation;
- comparison before opening route detail;
- local saving of verified routed results;
- GPX export through the system share sheet;
- optional voice transcription only after runtime permission and physical-device verification.
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

## Execution record

- The original `origin/main` baseline matched `44953ed0…`; onboarding later integrated and pushed `d610110…`.
- Shared `main` was clean.
- No equivalent `docs/release/app-store-v1` package or release-package history was found.
- An isolated worktree was created from `origin/main`.
- The worktree was fast-forwarded to integrated `origin/main` at `d610110…`; only this directory was written by this release lane.
- The onboarding owner reported 669/671 unit tests passing with two intentional skips, 18/18 deterministic UI tests, and passing Debug/Release Simulator builds at the same commit. These are attributed upstream results, not rerun or promoted to built proof here.
- This release lane independently revalidated the integrated source, plist syntax, local/no-account composition, disabled flags, dependency pins, hashes and package consistency.
- No Xcode, Simulator, SwiftPM resolution, test, build or archive was started by this lane because storage had inadequate headroom and later fell below the mandatory floor.
- No provider, backend, Supabase, Superwall, App Store Connect, TestFlight, upload or submission traffic or mutation occurred.
