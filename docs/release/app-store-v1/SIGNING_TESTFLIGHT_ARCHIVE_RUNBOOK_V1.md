# Signing, Archive and TestFlight Runbook V1

Status: **runbook only; no signed archive, validation, upload or App Store mutation performed**
Current source identity: `Wanderful`, `com.trailmind.app`, version `1.0`, build `1`, iPhone, iOS `26.0`

Apple's current submission requirement is Xcode 26 or later with the iOS 26 SDK for uploads beginning April 28, 2026. Source retrieved 2026-08-23: [Upcoming requirements](https://developer.apple.com/news/upcoming-requirements/).

## Stop gate 0 — release evidence

Do not start distribution work until all are true:

- onboarding integration has a terminal commit and privacy/data-flow report;
- this package has been refreshed against that commit;
- Stage B Debug/Release builds, non-live tests, runtime QA and built-artifact inspection pass;
- production privacy/support URLs are live and linked in-app;
- owner decisions, content rights, age rating and export classification are recorded;
- production backend and physical App Attest proof have approved evidence;
- there is enough storage for a bounded build/archive without endangering protected receipts.

## Stop gate 1 — Apple account and identifier

An Account Holder/Admin-authorized operator verifies, without copying credentials into git:

1. Active Apple Developer Program membership, legal entity, current agreements and required compliance/business information.
2. App Store Connect record with shipping name, primary language, bundle ID and immutable SKU selected by owner.
3. Explicit App ID exactly `com.trailmind.app`; App Attest capability enabled.
4. No unapproved bundle-ID change. A change requires owner/legal, backend App Attest relying-party and App Store record review.
5. Roles permit certificate/profile management, build upload and app-version editing as needed.

Record only non-secret identifiers and evidence dates in the external release tracker. Never record private keys, session tokens, API keys or profile payloads here.

## Stop gate 2 — certificate and provisioning profile

- Verify a current Apple Distribution certificate whose private key is available to the authorized build operator.
- Create/download an App Store provisioning profile for the explicit App ID and correct team.
- Confirm the profile's application identifier and App Attest entitlement align with the signed Release product.
- Confirm Release uses `production`, Debug uses `development`; never “fix” this by weakening Release.
- Confirm version/build are unique for upload and approved. Increment build deliberately; do not silently change marketing version.

## Stop gate 3 — clean local release rehearsal

Using the Build iOS Apps workflow and one bounded DerivedData path:

1. Fetch and fast-forward to the selected commit; require clean status outside approved release changes.
2. Call XcodeBuildMCP session-default inspection before selecting scheme/device/settings.
3. Run focused privacy/release/accessibility tests, then the practical complete non-live suite.
4. Build Debug and Release for the authorized iPhone 17 Pro Simulator.
5. Inspect the built Release app for identity, version, minimum OS/device family, purpose strings, production App Attest entitlement, flags, first/third-party manifests, embedded frameworks, icon opacity and secret absence.
6. Run deterministic first launch → onboarding/fallback → Plan → compare → detail → save/export plus offline/timeout/denial/error states. Do not contact live GraphHopper, AI, backend, Supabase or Superwall.

An unsigned/local archive may be created only if it adds necessary artifact evidence and storage remains safe. It is not distribution proof.

## Distribution archive procedure

Only after explicit distribution authority:

1. Select the approved team, App Store profile, Release configuration and generic iOS device destination in Xcode 26+.
2. Archive the exact clean commit. Preserve the commit, Xcode build/SDK, build setting export and archive SHA-256 in the release evidence store.
3. In Organizer, inspect signing identity/profile, entitlements, embedded frameworks, privacy manifests/report, Info.plist, icons, dSYMs and absence of local configuration/secrets.
4. Run **Validate App** for App Store Connect. Stop on every error and every unexplained warning; do not upload a different unreviewed archive.
5. Reconcile the validated archive with `SOURCE_EVIDENCE_MANIFEST_V1.json` and the final App Privacy questionnaire.

Apple requires certain listed SDKs to include privacy manifests/signatures and Xcode can generate a combined privacy report. Source: [Third-party SDK requirements](https://developer.apple.com/support/third-party-SDK-requirements/).

## TestFlight procedure

Only with upload authority:

1. Upload the already validated archive once; never expose upload credentials in logs or docs.
2. Wait for processing. Resolve build-state, privacy-manifest, export-compliance or signing issues before assigning testers.
3. Complete export-compliance information using the owner/legal decision; do not infer an answer from source alone.
4. Add only approved internal testers and provide accurate beta notes/support contact.
5. On real iPhone hardware, repeat App Attest production proof, onboarding, critical planning/save/export and network/error QA against the approved non-production-safe test conditions.
6. Review crashes, hangs, feedback and server logs under the approved privacy/retention policy. Do not advance with unresolved P1/P2 findings.
7. External testing, if used, may require Beta App Review and full test information.

Source: [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/).

## App Review submission procedure

1. Select the exact tested build.
2. Complete name/subtitle/description/keywords/categories, screenshots, privacy URL, support URL, App Privacy, age rating, content rights, encryption/export compliance, availability and pricing.
3. Provide final review notes and working review access if the selected build requires authentication.
4. Confirm no unsubmitted In-App Purchase is required by a reachable paywall; if V1 excludes purchases, prove the surface/configuration is absent.
5. Re-run link reachability and metadata/runtime parity checks.
6. Submit once with owner authority, monitor messages, and answer truthfully. Never alter backend/feature behavior to mislead review.

Source: [Submit an app](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app/).

## Immediate stop conditions

Stop and return to NO-GO for: wrong team/bundle ID; missing production App Attest; unknown privacy collection; local secret in artifact; unproved paywall; broken required URL; icon/manifest validation failure; fake/mock release path; backend/provider call during deterministic QA; inconsistent build/commit; or any validation error.
