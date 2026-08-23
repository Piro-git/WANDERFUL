# Wanderful App Store Release Package V1

Status: **NO-GO for public App Store release**
Stage: **Stage B complete unit suite and partial UI/Debug-artifact verification passed; Release/manual-runtime verification storage-blocked**
Source baseline: `894ff2e4f33d8dffb65ce8c66a88463e18f5e8fa`
Audit date: 2026-08-23
Shipping name: **Wanderful**
Bundle identifier: `com.trailmind.app`

## Executive decision

Wanderful is not ready for TestFlight or public submission. The selected source has a coherent iPhone-only route-planning product, native local onboarding and Trail Profile storage, bounded non-interactive route thumbnails, explicit safety boundaries, a first-party privacy manifest, production App Attest source entitlement, local prompt parsing in Release, and disabled tracked research, Supabase-sync and Superwall configuration. The complete non-live unit suite passed and a Debug-for-testing product was inspected, but the UI suite was interrupted after six passes when the tool timed out and storage crossed the hard floor. Standalone Debug/Release builds, manual runtime QA, physical-device App Attest, production-backend rehearsal, public legal/support assets and App Store Connect configuration remain unproved.

The integrated matrix proves **15 of 50 applicable release gates (30.0%)**. This percentage measures independently evidenced gates, not files created. Partial Debug/UI evidence does not complete a grouped Release gate.

## Dependency order

1. **Restore materially greater local build headroom:** resume preflight passed at 14,237,720 and 14,245,296 KiB, but the complete unit run fell to 8,801,544 KiB. After bounded cleanup APFS temporarily recovered above threshold, then the UI run fell to 6,532,376 KiB before its timed-out processes were stopped. Final task cleanup left 11,052,360 KiB, below the 12,582,912 KiB restart threshold. Do not restart Xcode until two new readings pass and the remaining run can stay above the 10,485,760 KiB floor.
2. **Complete Stage B local verification:** rerun the interrupted UI cases in bounded groups, then standalone Debug/Release builds, deterministic manual runtime/accessibility QA and Release-product inspection.
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

- The isolated worktree fast-forwarded through non-overlapping backend runtime/readiness commits to `22368397…`; the release-verifier correction is source commit `894ff2e4…`. The shared checkout remained untouched at `44953ed0…`.
- Intervening changes touched only backend/provider/operations and `docs/operations/closed-beta-readiness-v1/**`; this lane changed none of them.
- Build iOS Apps defaults were verified for the exact iPhone 17 Pro (`A9194E37-28A7-450E-9F30-95D0145D0486`) and one task-owned DerivedData directory. The Simulator ended Shutdown and was never erased or deleted.
- The focused release/privacy/security/accessibility/planning/onboarding/thumbnail/research/save/export suite passed **395 tests, 0 failures, 0 skips** in 173.3 seconds. Compilation emitted nine pre-existing Swift concurrency warnings in protected `TrailMindStagingProofUITests.swift`.
- The complete non-live unit target passed **672 tests, 0 failures, 0 skips** in 177.6 seconds. The only excluded methods were `IntentEvaluationTests/testLiveRemoteAIIntentEvalWhenEnabled` and `RouteQualityEvaluationTests/testLiveRouteQualityEvalWhenEnabled`.
- The deterministic critical-path UI suite was run from prepared products. Six tests passed; the seventh was in progress when the tool timed out at 300 seconds. The incomplete result bundle was not promoted to a suite result. Attempt 13 staging-proof UI tests were not authorized or run.
- The Debug-for-testing app proved Wanderful/com.trailmind.app/1.0(1), iPhone family 1, iOS 26.0, truthful permission text, all four tracked flags false, no exported URL scheme, valid signature, an opaque compiled 1024×1024 icon, and no forbidden key/configuration or credential-pattern match. It contained valid first-party, Superwall and swift-crypto privacy manifests. It is not a standalone Debug or Release product.
- The built-proved release-contract identity/permission mismatch and recursive privacy-manifest false failure were corrected in `894ff2e4…`; all 22 isolated verifier cases plus stale-report recovery pass. The corrected verifier clears those checks on the Debug product.
- Standalone Debug/Release builds, manual Dark Mode/VoiceOver/Reduce Motion/rapid-scroll QA, Release binary/entitlement/privacy/signature inspection and archive inspection were not run after the storage stop.
- Every removed log, result bundle, prepared product and the single DerivedData directory was task-owned and closed before deletion. No pre-existing cache, worktree, Simulator or user artifact was removed.
- Source audit confirms route cards use SwiftUI `Path`, not interactive `Map`; geometry is capped at 512 thumbnail/4,096 map points and the FIFO cache defaults to 48 entries. Built/runtime performance remains unproved.
- Remaining candidates are narrower: `FakeVoicePlanningService` and the provider-evidence copy are present in the Debug dylib but require Release reachability/runtime proof; the Release icon and embedded manifests remain uninspected; no in-app privacy-policy link exists.
- No provider, backend, Supabase, Superwall, App Store Connect, TestFlight, upload or submission traffic or mutation occurred.
