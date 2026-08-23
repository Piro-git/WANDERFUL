# Wanderful App Store Release Package V1

Status: **NO-GO for public App Store release**
Stage: **Stage B focused tests passed; complete suite/build/runtime/artifact verification storage-blocked**
Source baseline: `1d298a9c4a9a2d5edc0035729e370031d3b09884`
Audit date: 2026-08-23
Shipping name: **Wanderful**
Bundle identifier: `com.trailmind.app`

## Executive decision

Wanderful is not ready for TestFlight or public submission. The selected source has a coherent iPhone-only route-planning product, native local onboarding and Trail Profile storage, bounded non-interactive route thumbnails, explicit safety boundaries, a first-party privacy manifest, production App Attest entitlements, local prompt parsing in Release, and disabled tracked research, Supabase-sync and Superwall configuration. A focused 395-test Stage B suite passed, but it is not a substitute for the complete non-live suite, Debug/Release products, runtime QA, physical-device App Attest proof, production-backend rehearsal, public legal/support assets or App Store Connect configuration.

The integrated matrix proves **14 of 50 applicable release gates (28.0%)**. This percentage measures independently evidenced gates, not files created. It deliberately does not count upstream build reports as this release lane's built-product proof.

## Dependency order

1. **Restore safe local build headroom:** two preflight readings passed at 13,358,044 and 13,356,200 KiB. The focused suite then reduced free space to 8,008,952 KiB. After closed task-artifact and DerivedData cleanup, space recovered but the last settled reading was 12,147,512 KiB, below the 12 GiB restart threshold. Do not restart Xcode until two new settled readings pass and the whole remaining run can stay above the 10 GiB floor.
2. **Complete Stage B local verification:** the focused suite is proved; the practical complete non-live suite, Debug/Release builds, deterministic runtime QA, built-product inspection and candidate-defect confirmation remain required.
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

- Live GitHub `main`, local `origin/main` and the isolated worktree selected `1d298a9c4a9a2d5edc0035729e370031d3b09884`; the shared checkout remained untouched at `44953ed0…`.
- Intervening onboarding, release-package, backend-operations and route-shaping commits were reviewed. This lane changed no backend/provider/operations file.
- Build iOS Apps defaults were verified for the exact iPhone 17 Pro (`A9194E37-28A7-450E-9F30-95D0145D0486`) and one task-owned DerivedData directory. The Simulator ended Shutdown and was never erased or deleted.
- The focused release/privacy/security/accessibility/planning/onboarding/thumbnail/research/save/export suite passed **395 tests, 0 failures, 0 skips** in 173.3 seconds. Compilation emitted nine pre-existing Swift concurrency warnings in protected `TrailMindStagingProofUITests.swift`.
- The practical complete non-live suite was not run. Its only authorized live-test exclusions would be `IntentEvaluationTests/testLiveRemoteAIIntentEvalWhenEnabled` and `RouteQualityEvaluationTests/testLiveRouteQualityEvalWhenEnabled`.
- Debug/Release builds, runtime QA, built privacy/SDK/icon/binary inspection and archive inspection were not run after the storage stop.
- The three returned test artifacts and the single DerivedData directory were removed only after exact handle checks showed them closed. No pre-existing cache, worktree, Simulator or user artifact was removed.
- Source audit confirms route cards use SwiftUI `Path`, not interactive `Map`; geometry is capped at 512 thumbnail/4,096 map points and the FIFO cache defaults to 48 entries. Built/runtime performance remains unproved.
- Source candidates remain open: icon source has alpha; fake voice exists in preview/tests; release contract says TrailMind while shipping Info says Wanderful; GraphHopper source contains “Live trail geometry”/“trail-network data”; no in-app privacy-policy link exists.
- No provider, backend, Supabase, Superwall, App Store Connect, TestFlight, upload or submission traffic or mutation occurred.
