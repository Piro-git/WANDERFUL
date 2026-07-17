# TrailMind archive verification record

Status: **no signed distribution archive has been verified**
Evidence date: 2026-07-17

## Current evidence boundary

The integration cycle has produced passing Simulator builds/tests and a successful Release Simulator build, install, and launch. Those results prove compilation and Simulator behavior only.

An unsigned generic-iOS-device archive/composition pass also succeeded. It is useful evidence that the app and its resources can be composed for a device destination, including the current privacy manifest and iPhone-only portrait configuration. Because code signing was disabled, it is **not** distribution, entitlement, App Attest, Organizer validation, upload, or App Store proof.

No evidence currently proves:

- a signed App Store/Ad Hoc distribution `.xcarchive`;
- distribution signing or provisioning;
- final embedded application identifier/team identifier;
- production App Attest operation on a physical iPhone or TestFlight;
- Organizer validation/upload;
- an Xcode-generated privacy report;
- App Store Connect processing;
- absence of credentials/debug content in the exact signed archive.

Xcode Organizer's privacy report has not been generated.

## Automated fail-closed verifier

The repository provides two deliberately non-interchangeable modes:

```sh
scripts/verify-release-artifact.sh simulator-app /path/to/TrailMind.app
scripts/verify-release-artifact.sh distribution-signed-archive /path/to/TrailMind.xcarchive
```

`simulator-app` checks Release composition without claiming device signing or App Store readiness. `distribution-signed-archive` is intentionally stricter: it accepts only a device archive that is already signed with Apple Distribution and an App Store distribution profile. It is not a verifier for the standard raw automatic-signing archive that Xcode may re-sign during export/upload. That normal export/upload path still requires separate Apple-team evidence.

Current local evidence:

- verifier self-tests: 22 isolated adversarial cases plus stale-report recovery passed;
- fresh Release Simulator app: 36 checks passed, 0 failed;
- unsigned generic-device archive: 34 checks passed, while strict mode failed the five expected signing, identity, entitlement, provisioning, and final-signature gates.

A passing simulator report or an expected unsigned-archive failure is not distribution proof. Update `scripts/release-contract.json` whenever the version, build, endpoint, permissions, device surface, or privacy declaration changes.

## Candidate identity

Complete this for every release candidate:

| Field | Value |
|---|---|
| Git commit | **[UNRESOLVED]** |
| Branch/tag | **[UNRESOLVED]** |
| Xcode version/build | **[UNRESOLVED]** |
| macOS build host | **[UNRESOLVED]** |
| Scheme/configuration | `TrailMind` / `Release` |
| Marketing/build version | **[UNRESOLVED]** |
| Bundle ID | `com.trailmind.app` |
| Team ID | **[UNRESOLVED]** |
| Archive path | **[UNRESOLVED]** |
| Archive SHA-256 | **[UNRESOLVED]** |
| Privacy report path/SHA-256 | **[UNRESOLVED]** |
| Reviewer/date | **[UNRESOLVED]** |

## Verification checklist

### Source and deterministic checks

- [ ] Clean tracked worktree at the recorded commit; unrelated local files excluded.
- [ ] `git diff --check` clean.
- [ ] Complete Swift unit suite passes; live-provider skips are reported separately, not counted as provider proof.
- [ ] Complete deterministic UI suite passes.
- [ ] Backend suite passes.
- [ ] Real PostgreSQL integration suite passes against a disposable database.
- [ ] Evaluation-harness self-tests pass.
- [ ] Protected 40-intent and 20-route live baselines execute with zero skips and recorded summaries.
- [ ] Release Simulator build/install/launch passes after all release-source changes.

### Archive and signing

- [ ] Archive uses a generic iOS device, not a Simulator destination.
- [ ] Organizer identifies it as an iOS app archive.
- [ ] Distribution certificate and provisioning profile belong to the final team.
- [ ] Embedded bundle ID, application identifier, Team ID, version, and build are exact.
- [ ] Release entitlement is `com.apple.developer.devicecheck.appattest-environment = production`.
- [ ] No Debug entitlement, insecure loopback authorization, test entitlement, or test runner is embedded.
- [ ] App is iPhone-only and portrait-only.
- [ ] Minimum OS and supported platforms match [RELEASE_CONFIGURATION.md](RELEASE_CONFIGURATION.md).

### Bundle contents

- [ ] `PrivacyInfo.xcprivacy` exists and parses.
- [ ] Privacy manifest contains only the reviewed required-reason and collected-data declarations.
- [ ] Info plist has the exact microphone/Speech disclosure and no location purpose key.
- [ ] No `NSAllowsLocalNetworking` or arbitrary-load exception.
- [ ] No `Local.xcconfig`, `.env`, provider key, database URL, signing secret, token, fixture prompt, mock route catalogue, XCTest bundle, or UI-test launch hook.
- [ ] App icon and launch assets are final.
- [ ] Provider attribution links and About copy are present.

Secret scanning must report only file names/rules and redacted findings; it must never print secret values into release logs.

### Privacy report and traffic

- [ ] Generate Xcode's privacy report from the exact archive.
- [ ] Reconcile every accessed API, collected data type, SDK, and tracking-domain result.
- [ ] Compare observed release traffic with [DATA_FLOW_RETENTION_AND_DELETION.md](DATA_FLOW_RETENTION_AND_DELETION.md).
- [ ] Confirm the exact Release executable contains no `RemoteAIIntentParsingProvider`, `RemoteWithLocalFallbackIntentParsingProvider`, or `parse-intent` marker.
- [ ] Confirm the full typed prompt never reaches a remote AI provider in Release.
- [ ] Confirm app traffic contains only expected Apple and TrailMind-backend domains; any direct app-to-GraphHopper request is a failure. Verify backend-to-GraphHopper egress separately.
- [ ] Confirm production logs do not retain prompts, exact coordinates, credentials, tokens, assertions, or raw provider bodies.
- [ ] Reconcile App Privacy answers and the public policy.

Apple documents privacy-report generation in [Describing data use in privacy manifests](https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests).

### Device and TestFlight

- [ ] Signed physical-device text point-to-point and loop journeys pass.
- [ ] Voice grant/deny/revoke/interruption behavior passes on hardware.
- [ ] Save/relaunch/reopen/delete-all and backup exclusion are observed on an installed build.
- [ ] GPX opens successfully in at least one independent third-party GPX consumer.
- [ ] Production App Attest registration, assertion counter, session, replay rejection, expiry, and recovery pass on TestFlight.
- [ ] Poor network, cancellation, backend outage, GraphHopper failure, and no-route recovery remain truthful.
- [ ] Accessibility/device matrix passes for the declared iPhones.

### App Store processing

- [ ] Archive validates in Organizer.
- [ ] Upload succeeds and Apple processing completes without unresolved warning.
- [ ] Export-compliance response is recorded.
- [ ] TestFlight build status is ready and the intended tester group can install it.
- [ ] App Review information, privacy policy URL, support URL, screenshots, and App Privacy details are attached to this exact build.

## Result

Release decision: **NO-GO pending the unchecked evidence above.**

Simulator success is valuable but must never be entered here as signed-archive, privacy-report, provider, PostgreSQL, TestFlight, or App Store proof.
