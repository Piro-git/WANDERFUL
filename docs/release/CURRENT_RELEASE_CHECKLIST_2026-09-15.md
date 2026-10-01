# Current TestFlight and App Store checklist

Status: **NO-GO — authoritative release-readiness checklist for this wave.**

This document supersedes the claim portions of older drafts that say Wanderful
has no location/guidance or that all remote AI is absent. Do not delete historical
evidence, but do not copy those statements into metadata, screenshots, review
notes, or public legal pages. The final archive and the selected integration
commit always take precedence over this source review.

## Candidate identity

| Item | Evidence state |
| --- | --- |
| Integration owner | `01a0a479-a1ce-7681-bac5-254f465fdb69` |
| Current integration candidate | `9a53949162ece31e2a5ab96dbe10a827ab8cde59` |
| Read-only verification | Verified in `/Users/REDACTED/Library/Application Support/Wanderful-Recovery/release-wave-20260915/integration` on 15 September; clean tree and `git diff --check` against the launch base passed. |
| Build/archive/TestFlight | Not supplied; no build, archive, upload, or submission was run by this task. |

## Exact product boundary to verify in the final candidate

| Surface | Current owner statement | Store/review disposition |
| --- | --- | --- |
| Route Guidance | Code integrated; active session uses precise location and may continue on screen lock/app switch | Do not call it turn-by-turn navigation, offline maps, or a safety guarantee. Include only after physical acceptance. |
| Dynamic research / routing | Code behind configured HTTPS and App Attest gates; provider/backend is not live-verified | Do not claim Gemini, real routes, worldwide coverage, or researched stops until exact live evidence exists. |
| Commons photos | Optional resolver/gallery code integrated but fail-closed | Do not advertise until the candidate displays per-asset credit/licence/link and fallback is tested. |
| Account / Apple login | Account code/UI integrated but default-disabled | Do not claim login, deletion, sync, or accounts until enabled end-to-end. |
| StoreKit / Superwall | Foundation fail-closed | Do not show prices, subscriptions, trials, or Premium until products and sandbox flow are accepted. |
| Voice | Permission strings/service exists | Do not advertise until physical permission, denial, interruption, and transcription path pass. |

### Commerce P0 gate

Production monetization is correctly disabled. The checked-in StoreKit fixture
uses a **weekly** and annual test subscription. No App Store Connect product IDs, subscription group,
localized price, trial eligibility, Sandbox purchase/cancel/restore, revoked,
or expired-entitlement proof exists. Keep all Premium entry points unavailable;
when the owner approves real products, replace the test-only period/IDs and
accept all StoreKit states before enabling the gate.

### Account deletion P1 gate

The prior false-success path is resolved in source: `AccountStore.deleteAccount`
throws `noActiveSession` when no local session exists, does not issue a deletion
request, and does not clear local storage. Focused tests cover that path, a
rejected server deletion, a confirmed deletion, and a session change during
deletion. This is source-level evidence only: Apple login, re-authentication,
server deletion, sign-out, restart, and user-visible error handling still need
physical-device acceptance before accounts are enabled.

## App Privacy working answer

Do **not** choose “Data Not Collected.” At minimum the signed archive must be
reconciled with the first-party App Attest Device ID declaration. For every
enabled remote path, re-evaluate User Content, Search History, Precise Location,
Audio Data, account identifiers, purchase history, linkage, retention, and
tracking from actual deployed traffic and processor terms. Current intended
purpose is App Functionality only; no analytics/advertising/tracking claim may
be published without archive and service evidence.

The required processor inventory is in `APP_PRIVACY_INVENTORY_2026-09-15.md`.
For Google/Gemini, GraphHopper, Wikimedia, accounts, and Superwall, “code
integrated” is not an activated production data-flow fact.

## Archive and App Store Connect facts to answer from the final archive

| Field/question | Source-level indication only | Required final evidence / safe disposition |
| --- | --- | --- |
| Bundle ID | Base production configuration names `com.trailmind.app` | Inspect the signed archive; do not create an App ID or record from this task. |
| Version/build | Base project names `1.0 (1)` | Confirm it is the final version and the build number is unused in App Store Connect. |
| App Attest | Release entitlement names production | Verify selected team capability/profile and TestFlight App Attest behavior. |
| Permissions | Microphone, Speech, When-In-Use Location, and location background mode are in source | Inspect archive Info.plist and run physical rationale/denial/background tests. |
| Export compliance | Network and security dependencies require an exact archive assessment; tracked source has no approved export-compliance code | Answer Apple’s current questionnaire from the archive/linked libraries. Do not set `ITSAppUsesNonExemptEncryption` or claim an exemption without that assessment. |
| Screenshots | No final images supplied | Capture 1–10 opaque PNG/JPEG screenshots from the final build. Apple currently requires a 6.9-inch iPhone set when no 6.5-inch set is provided; use an accepted current size from Apple’s screenshot specification. |

Apple’s current documentation confirms that When-In-Use authorization can support
continuous background location updates only when the app starts services in use
and has the location background capability enabled. This matches the intended
guidance model but is not physical-device proof. Export-compliance answers are
also per build and must be completed in App Store Connect or via the final
Info.plist only after the encryption assessment.

## Owner inputs required before any public URL or App Store Connect entry

Complete the single **Owner launch-input form** in
`STORE_READINESS_HANDOFF_2026-09-15.md`. It is the canonical collection point
for legal, public-URL, backend/processor, Apple, metadata and optional-commerce
facts. The prepared static site has placeholders and must not be published
before those facts are supplied and reviewed. A read-only check on 17 September
reached Apple’s sign-in page without an active session, so membership,
agreements, App ID and app record remain unverified; the owner must inspect them
in Apple Developer/App Store Connect. No purchase is requested.

## Verified legal-site preparation

The checked-in static legal/support package in the integration candidate passed
its fail-closed validator and all 8 bundled regression tests on 15 September.
It rejects its owner placeholder configuration by design and was not rendered,
hosted, or published. This proves that a future owner-approved input file can be
validated; it does not supply the controller, contact, retention, or hosting
facts required for a public policy or Support URL.

## Only remaining acceptance sequence

1. Integration provides one readable final commit and selected configuration.
2. Owner configures/deploys approved backend and verifies bounded real routes.
3. Integrator makes one signed archive and reviews bundle ID/version,
   entitlements, privacy report, embedded SDK manifests, and final flags.
4. Physical TestFlight acceptance executes every row in
   `TESTFLIGHT_ACCEPTANCE_2026-09-15.md`, including network failure, route save/
   packing persistence, and only enabled optional features.
5. Capture only genuine final-build screenshots; populate the review route and
   contact fields in `STORE_COPY_2026-09-15.md`.
6. Owner completes App Store Connect metadata, App Privacy, legal URLs, and
   review contact. Upload remains an owner/integrator action; App Review
   submission is out of scope.
