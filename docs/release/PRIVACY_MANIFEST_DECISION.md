# TrailMind privacy-manifest decision

Status: provisional implementation decision
Evidence date: 2026-07-17
Manifest: `TrailMind/PrivacyInfo.xcprivacy`

## Current declaration

| Manifest area | Current value | Source-backed reason |
|---|---|---|
| Tracking | `false` | No advertising, cross-app tracking, tracking domains, or analytics SDK is present in the shipping app source |
| Required-reason API: file timestamp | `NSPrivacyAccessedAPICategoryFileTimestamp` with `C617.1` | GPX recovery reads file metadata inside TrailMind's temporary app container to remove owned abandoned exports |
| Required-reason API: user defaults | `NSPrivacyAccessedAPICategoryUserDefaults` with `CA92.1` | `@AppStorage` reads and writes the app-only onboarding-complete flag |
| Collected data | `NSPrivacyCollectedDataTypeDeviceID` | App Attest creates an app-scoped key identifier; the backend keeps a linked installation record to verify later requests |
| Device-ID linkage | Linked: `true` | The record is consistently associated with an app installation, even though TrailMind has no user account |
| Device-ID purpose | App functionality | Fraud prevention, request authorization, replay defense, and provider-budget protection |
| Device-ID tracking | `false` | The identifier is not used for advertising or cross-company tracking |

The App Attest declaration intentionally does not call the record anonymous merely because the backend stores hashes. Apple treats data as linked when it remains associated through a device or other identifier.

## Required-reason rationale

### File timestamp — `C617.1`

TrailMind reads content-modification dates only for files/directories inside its own temporary export root. The metadata is used for cleanup and is not sent off device. `C617.1` is the app-container metadata reason that matches this use.

### User defaults — `CA92.1`

TrailMind uses app-only user defaults for `hasCompletedTrailMindOnboarding`. It does not read system/global defaults or an App Group defaults domain. `CA92.1` matches app-only defaults access.

Apple's current reason descriptions are authoritative; do not copy a reason code into a future feature without rechecking the allowed use:

- [Privacy manifest files](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files)
- [Privacy Accessed API Reasons](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitypereasons)
- [Describing data use in privacy manifests](https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests)

## Why this is provisional

The manifest is bundled by the synchronized app target and focused tests compare the tracked and built copies. That proves the intended file content only after those tests pass on the exact release candidate. It does **not** prove that the declaration is complete.

The following evidence does not yet exist:

- an Xcode Organizer privacy report generated from a signed device archive;
- review of every linked binary/SDK in that archive;
- confirmed GraphHopper, Apple service, hosting, and database retention practices;
- a final App Privacy questionnaire reviewed against observed production traffic;
- App Store validation or review acceptance.

## Data categories requiring a final retention decision

Release sends place-name queries to Apple geocoding and exact route coordinates/constraints through the TrailMind backend to GraphHopper. Apple defines collection for the App Privacy label in terms of off-device transmission that remains accessible beyond real-time servicing. The source does not intentionally persist route bodies, but source alone cannot establish provider or infrastructure retention.

Protected backend requests also expose a connection address, or deployed edge-resolver value. Application code hashes that value into short-lived PostgreSQL rate windows. Apple directs developers who retain IP addresses to select the relevant category based on use, which can include location, Device ID, or diagnostics. The production resolver, retention, and final classification remain unresolved; the current Device ID declaration must not be treated as proof that every network-address use is fully covered.

Therefore:

- do not add or omit `Precise Location`, `Other User Content`, `Search History`, or another category based on assumption;
- obtain provider and infrastructure retention evidence;
- observe a signed release candidate's traffic;
- update both the manifest and App Privacy answers if any party retains those data beyond real-time request handling.

The conservative App Privacy working position appears in [APP_PRIVACY_DRAFT.md](APP_PRIVACY_DRAFT.md).

## Release-candidate verification

For the exact signed candidate:

1. Confirm `PrivacyInfo.xcprivacy` exists in the app bundle.
2. Run the privacy-content XCTest that compares tracked and bundled declarations.
3. Archive with the final team, bundle ID, and production entitlements.
4. In Xcode Organizer, generate a privacy report from that archive.
5. Compare the report with the data-flow inventory and all linked SDK manifests.
6. Record the report artifact checksum and reviewer/date in [ARCHIVE_VERIFICATION.md](ARCHIVE_VERIFICATION.md).
7. Reconcile the result with App Store Connect before publishing App Privacy details.

Apple documents the Organizer workflow in [Describing data use in privacy manifests](https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests). No privacy report has been generated for TrailMind yet.

## Change triggers

Reopen this decision before shipping any of the following:

- Release remote-AI parsing;
- device-location access;
- accounts, cloud sync, analytics, crash reporting, advertising, or attribution SDKs;
- server-side route history or prompt storage;
- a new file-metadata/defaults use;
- new third-party SDKs;
- changed App Attest retention or identity linkage;
- navigation, background location, or route recording.
