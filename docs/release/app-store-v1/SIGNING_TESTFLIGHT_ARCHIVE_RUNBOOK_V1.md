# Signing, archive, and TestFlight runbook V1

Status: **owner-operated runbook; no upload or App Store Connect mutation was performed**

Shipping identity: Wanderful, `com.trailmind.app`, `1.0 (1)`, iPhone, iOS 26.0

Release entitlement: production App Attest

## Current local evidence

- Debug and Release Simulator builds pass.
- Release launches on iPhone 17 Pro Simulator and passes the local artifact contract.
- A generic iOS Release archive succeeds with signing disabled. It contains an arm64 app, dSYM, and three privacy manifests, and Xcode’s store bundle validation passes.
- The diagnostic archive is not uploadable and is not distribution proof.
- `DEVELOPMENT_TEAM` is empty. No certificates, provisioning profiles, or private signing material were inspected.

## Stop gate

Do not begin distribution until:

1. the owner-approved production routing gateway is configured and the exact Release build completes point-to-point and loop requests;
2. the Apple owner approves the team, explicit App ID `com.trailmind.app`, production App Attest capability, and App Store provisioning setup;
3. version/build uniqueness is confirmed;
4. the release branch is clean and all deterministic tests/artifact checks pass;
5. explicit archive/upload authority is granted.

Research/evidence, Supabase, and Superwall remain disabled and are not prerequisites for V1.

## Create and validate the signed archive

Only an authorized release operator should:

1. Select the approved Apple Developer team and Release configuration in Xcode.
2. Confirm bundle ID `com.trailmind.app`, version/build, iPhone platform, iOS 26.0 minimum, production App Attest entitlement, and App Store provisioning destination.
3. Archive the exact reviewed commit for generic iOS device.
4. Inspect Organizer’s archive identity, entitlements, privacy report, embedded SDKs/manifests, icon, dSYM, and validation messages.
5. Set `TRAILMIND_EXPECTED_TEAM_IDENTIFIER` only in the authorized shell environment; never commit or print it.
6. Run:

   `scripts/verify-release-artifact.sh distribution-signed-archive /absolute/path/Wanderful.xcarchive`

7. Require every check to pass. Stop on any validation error or unexplained warning.
8. Repeat the deterministic test matrix after any source/configuration correction.

## Physical-iPhone smoke test

If an authorized iPhone is available, install the signed candidate and check:

- first launch/native onboarding;
- typed point-to-point and loop planning;
- comparison, detail, save/reopen/delete, and GPX share-sheet handoff;
- airplane-mode/network failure, retry, and no-route recovery;
- optional Microphone/Speech permission grant and denial if voice will be marketed;
- request-protection behavior with the production App Attest entitlement.

No physical device was available in this audit. This follow-up is strongly recommended but physical App Attest proof is not a standalone V1 stop condition here.

## TestFlight

Only after the signed archive validates and explicit upload authority exists:

1. Upload the already validated archive once.
2. Resolve processing, privacy-manifest, signing, and export-compliance issues before assigning testers.
3. Add only approved internal testers and provide accurate beta notes/support contact.
4. Repeat the critical path on TestFlight hardware against the production routing gateway.
5. Do not enable research/evidence, Supabase, Superwall, remote AI, or another unreviewed feature for the beta.
6. Do not advance to public review with a broken core route request or unresolved crash/hang/privacy issue.

## Public App Review

Before submission, complete the public URLs, final App Privacy form, legal/content-rights answers, category/age rating/export compliance, App Store Connect record, screenshots, metadata, and review notes listed in this package. Submission requires separate explicit authority.
