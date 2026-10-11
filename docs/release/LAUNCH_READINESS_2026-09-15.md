# Wanderful launch readiness — 15 September 2026

Status: **NO-GO — release documentation package only**

Evidence base: read-only source review of integration candidate `9a53949162ece31e2a5ab96dbe10a827ab8cde59`; release-docs branch `codex/store-readiness-20260915`.

Official Apple references checked on 15 September 2026: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [Manage App Privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy), [App Review information](https://developer.apple.com/documentation/appstoreconnectapi/app-store-review-details), and [beta/release distribution](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases).

This is a decision record, not a submission authorization. It does not treat the integrated-but-unverified account, Commons-photo, backend-runtime, or paywall paths as enabled, marketable, or accepted for release.

## What source evidence supports today

| Surface | Evidence in base | Release status |
| --- | --- | --- |
| Typed route request, saved routes, packing list | Swift source and focused persistence/tests | Candidate/device acceptance still required |
| Route geometry and measured statistics | Client/backend contracts name GraphHopper; no current deployed production origin is configured | **Not marketable until one real release-lane route succeeds** |
| Voice-to-text | Purpose strings and `VoicePlanningService` | Physical permission/interruption/transcript test required |
| Active Route Guidance | `RouteGuidanceView` and `RouteLocationService`; guidance requests When-In-Use location and enables background updates | Physical route, background, privacy, battery, and safety acceptance required |
| Purchases | StoreKit code and Superwall package; tracked production settings disabled/unassigned | Do not enable or market before products, terms, reviewer visibility, and sandbox proof |
| Account deletion / Sign in with Apple | Account code/UI and server adapter are integrated but default-disabled; no deployed endpoint or end-to-end proof | **Do not enable or market. P1: unauthenticated deletion currently returns success and can show a false “deleted” confirmation; fix and focused regression test required before account acceptance.** |
| Wikimedia Commons photos | Optional resolver/gallery code is integrated and fail-closed; source review found per-asset author/source/licence links | Do not enable or market before device acceptance verifies rendered credit/licence/link and missing-photo fallback for real assets |

## Blocking gates

1. Confirm active Apple Developer Program membership; select the final team, App ID `com.trailmind.app`, provisioning, and App Attest production registration. A free Personal Team cannot upload TestFlight or App Store builds. Do not purchase membership from this task.
2. Integration selects one candidate and records final commit, archive checksum, bundle identifier/version, entitlement inspection, and Xcode privacy report.
3. Deploy and monitor a real HTTPS backend, document retention/logging and all processors, then pass a bounded live route matrix. Tracked production backend configuration is unassigned.
4. Publish owner-approved support and privacy URLs with controller identity, contact channel, retention/deletion terms, and processor list. No placeholders or invented contact details.
5. Execute `TESTFLIGHT_ACCEPTANCE_2026-09-15.md` and record exact evidence commit/build per row.
6. If Apple login, paid access, or Commons photos are enabled, re-run privacy, review-note, attribution, and screenshot checks. For accounts, first fix the unauthenticated-deletion false-success path and add the focused regression test; source-only handoff tests are not release proof.

## App Store Connect preparation (owner action)

- Create the app record only after current agreements are accepted; reserve final name and SKU.
- Enter exact final metadata, choose only proven territories/languages, and complete age rating, export compliance, copyright, and content-rights questions.
- Provide a public Privacy Policy URL. Apple requires it in App Store Connect and in an easily accessible in-app location. Publish App Privacy answers only after release archive and deployed data flows are reconciled.
- Supply a reachable review contact and, if login is integrated, working reviewer access or approved functional demo mode. Keep the backend available during review and use a pre-verified non-personal route.

## Final decision check

Mark **GO** only if each is evidenced, not planned: membership/team; signed archive; App Attest; backend; live routes; privacy/support URLs; current App Privacy responses; payment/login path if enabled; attribution review; TestFlight matrix; exact screenshots; review contact/notes. Any missing row remains **NO-GO**.
