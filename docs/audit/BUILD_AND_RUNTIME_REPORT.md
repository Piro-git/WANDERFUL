# Build and Runtime Report

- Audit date: 2026-07-15
- Workspace: `/Users/piroscheibe/Documents/EasyWander`
- App scheme: `TrailMind`

## Outcome

The repository builds in both Debug and Release for an iOS 26.5 Simulator. The complete iOS XCTest run passed with 177 tests passing, two opt-in live tests skipped, and no failures. The backend's normal test suite passed all 115 tests after rerunning outside the restricted sandbox, and `npm audit --omit=dev` reported no known vulnerabilities. A clean Simulator install launched without a crash and exposed the onboarding flow; a second launch with onboarding completion set exposed the Plan home screen.

This is meaningful build and deterministic-test evidence, but it is not an end-to-end launch sign-off. There is no UI-test target, the available macOS automation could not address controls inside the embedded Simulator display, and neither live remote-intent evaluation nor live GraphHopper route-quality evaluation was proved to run. All prompt-to-route journeys and service-degradation cases that were not interactively completed are called out below.

## Evidence labels

- **TESTED**: the exact behavior was exercised either by a passing automated test or by direct runtime observation. The evidence column states which kind.
- **PARTIAL**: relevant logic passed deterministic tests or a portion of the screen flow was observed, but the complete user journey or live dependency was not exercised.
- **CANNOT_VERIFY**: the audit did not obtain reliable runtime or automated evidence for the requested behavior.

Passing a stubbed or URLProtocol-backed test is not treated as proof that a live third-party service works.

## Environment

| Item | Audited value |
|---|---|
| macOS development toolchain | Xcode 26.5 (`17F42`) |
| Simulator | iPhone 17, iOS 26.5 |
| Simulator UDID | `FC145747-0EAC-4A22-8616-74FCD34DFCF6` |
| App bundle identifier | `com.trailmind.app` |
| Node.js | `v22.22.3` |
| npm | `10.9.8` |
| Xcode project | `TrailMind.xcodeproj` |
| Schemes found | `TrailMind` |
| Targets found | `TrailMind`, `TrailMindTests` |
| UI-test target | None |

## Exact commands and results

### Project discovery

```sh
xcodebuild -list -json -project TrailMind.xcodeproj
```

Result: succeeded. It identified the real `TrailMind` scheme and the `TrailMind` and `TrailMindTests` targets. No scheme or target name was inferred.

### Dependency resolution

```sh
xcodebuild -resolvePackageDependencies \
  -project TrailMind.xcodeproj \
  -scheme TrailMind \
  -derivedDataPath /private/tmp/TrailMindAuditDerivedData
```

Result: succeeded. The Xcode project currently resolves no external Swift package products.

```sh
cd backend
npm ci
```

Result: succeeded; 26 packages were installed from the lockfile.

### Debug Simulator build

```sh
xcodebuild build \
  -project TrailMind.xcodeproj \
  -scheme TrailMind \
  -configuration Debug \
  -destination 'platform=iOS Simulator,id=FC145747-0EAC-4A22-8616-74FCD34DFCF6' \
  -derivedDataPath /private/tmp/TrailMindAuditDerivedData
```

Result: **BUILD SUCCEEDED**.

### Full iOS test suite

```sh
xcodebuild test \
  -project TrailMind.xcodeproj \
  -scheme TrailMind \
  -configuration Debug \
  -destination 'platform=iOS Simulator,id=FC145747-0EAC-4A22-8616-74FCD34DFCF6' \
  -derivedDataPath /private/tmp/TrailMindAuditDerivedData \
  -parallel-testing-enabled NO
```

Result: **TEST SUCCEEDED**.

- Executed: 179 tests
- Passed: 177
- Skipped: 2
- Failed: 0
- XCTest execution time: 13.372 seconds
- Total command time: 135.705 seconds
- Result bundle: `/private/tmp/TrailMindAuditDerivedData/Logs/Test/Test-TrailMind-2026.07.15_10-16-51-+0200.xcresult`

The two skipped tests were intentionally gated live checks:

1. `IntentEvaluationTests.testLiveRemoteAIIntentEvalWhenEnabled`
2. `RouteQualityEvaluationTests.testLiveRouteQualityEvalWhenEnabled`

The deterministic local intent evaluation did run. Its 40 fixtures all passed: 35 were reported through the local-rule fallback path and five produced the expected clarification behavior.

### Opt-in remote intent-evaluation script

```sh
zsh scripts/run-intent-eval.sh
```

Result: the script exited successfully, but the selected XCTest was **skipped**. This is not a successful live AI evaluation.

The script prefixes the host `xcodebuild` command with:

```sh
TRAILMIND_RUN_REMOTE_INTENT_EVAL=1 xcodebuild test ...
```

The Simulator-hosted XCTest process did not receive that shell environment variable, so the guard inside `testLiveRemoteAIIntentEvalWhenEnabled` called `XCTSkip`. A zero exit status from this script can therefore mean "no live evaluation ran."

The corresponding route-quality command was also run:

```sh
zsh scripts/run-route-quality-eval.sh
```

It produced the same false-positive shape: `xcodebuild` exited successfully while `RouteQualityEvaluationTests.testLiveRouteQualityEvalWhenEnabled` was skipped after 0.015 seconds. Result bundle: `/Users/piroscheibe/Library/Developer/Xcode/DerivedData/TrailMind-chrvxlyfdqaxgghhckshbquqnshl/Logs/Test/Test-TrailMind-2026.07.15_10-42-06-+0200.xcresult`. No live GraphHopper request was proved, so live route quality remains **CANNOT_VERIFY**.

### Backend tests

```sh
cd backend
npm test
```

The first run inside the restricted sandbox produced six failures because test servers could not bind to `127.0.0.1` (`EPERM`); 109 tests passed. The identical command was then rerun with the required local-network permission and all 115 tests passed with zero failures. The initial result is an execution-environment restriction, not evidence of six product defects.

The PostgreSQL-backed App Attest integration suite was skipped because the audit environment did not provide a disposable PostgreSQL integration database. In-memory and normal backend tests are not a substitute for that integration suite.

### Backend dependency audit

```sh
cd backend
npm audit --omit=dev
```

Result: succeeded with 0 known vulnerabilities reported at audit time. This is a point-in-time package advisory check, not a penetration test.

### Release Simulator build

```sh
xcodebuild build \
  -project TrailMind.xcodeproj \
  -scheme TrailMind \
  -configuration Release \
  -destination 'platform=iOS Simulator,id=FC145747-0EAC-4A22-8616-74FCD34DFCF6' \
  -derivedDataPath /private/tmp/TrailMindAuditReleaseDerivedData
```

Result: **BUILD SUCCEEDED**.

This proves that optimized code compiles for the Simulator. It does not prove distribution signing, a device archive, App Attest on real hardware, TestFlight processing, or App Store submission.

## Runtime launch evidence

The Debug app was installed and launched with the Simulator command-line tools:

```sh
xcrun simctl install \
  FC145747-0EAC-4A22-8616-74FCD34DFCF6 \
  /private/tmp/TrailMindAuditDerivedData/Build/Products/Debug-iphonesimulator/TrailMind.app

xcrun simctl launch \
  FC145747-0EAC-4A22-8616-74FCD34DFCF6 \
  com.trailmind.app
```

A clean uninstall/reinstall proved the first-run onboarding screen. A test-only Simulator preference was then set to reach the returning-user home:

```sh
xcrun simctl spawn FC145747-0EAC-4A22-8616-74FCD34DFCF6 \
  defaults write com.trailmind.app hasCompletedTrailMindOnboarding -bool YES
```

Observed runtime evidence:

| Flow or screen | Status | Evidence and limitation |
|---|---|---|
| Clean cold launch | **TESTED** | App process launched successfully from a clean install. |
| Onboarding, page 1 of 3 | **TESTED** | Screenshot `/private/tmp/trailmind-audit-clean-launch.png` showed the first onboarding page and progress indicator. Later pages were not interacted through. |
| Returning-user Plan home | **TESTED** | Screenshot `/private/tmp/trailmind-audit-home.png` showed the main Plan home after setting the onboarding-complete preference. |
| Crash-free clean launch | **TESTED** | The clean launch remained alive; no crash was observed. |
| Submit typed prompt | **CANNOT_VERIFY** | The available CUA driver could see only the macOS Simulator window chrome, not addressable app controls inside the embedded iPhone display. A background pixel click reported as posted but produced no screen change. |
| Route-generating progress UI | **CANNOT_VERIFY** | Not reached interactively. |
| Suggestions and comparison | **CANNOT_VERIFY** | Not reached interactively. |
| Route detail and live map | **CANNOT_VERIFY** | Not reached interactively. |
| Voice route creation | **CANNOT_VERIFY** | Not reached; microphone/speech permissions were not exercised in Simulator. |
| Explore, Saved, and Profile journeys | **CANNOT_VERIFY** | Static/code evidence exists elsewhere in the audit, but these tabs were not interactively traversed in this run. |

This automation limitation is not an application failure. It means the audit must not claim manual end-to-end coverage from screenshots alone.

### Console and crash check

```sh
xcrun simctl spawn FC145747-0EAC-4A22-8616-74FCD34DFCF6 \
  log show --last 5m --style compact \
  --predicate 'process == "TrailMind" AND (messageType == error OR messageType == fault)'
```

No error or fault was attributed to the clean-launch process. The query did show two Simulator app-launch measurement/telemetry errors from an earlier PID; no app crash or functional TrailMind failure was tied to those entries.

## Requested scenario matrix

None of the prompt scenarios below was completed manually from Home through a live route detail screen. `TESTED` in this table therefore means a focused deterministic automated test exercised the exact branch; it never means a live route service was proved.

| Requested case | Status | Evidence | What remains unverified |
|---|---|---|---|
| Point-to-point hiking request | **PARTIAL** | Passing parser, `PlannerViewModel`, routing-coordinator, and GraphHopper response-decoding tests cover a point-to-point hike with stubbed geocoding/network data. | Manual UI journey and live geocoding/routing response. |
| Loop hiking request | **PARTIAL** | Passing parser, one-start geocoding, round-trip request-body, multi-seed, and loop-coordinator tests. | Manual UI journey and live loop quality. |
| Cycling request | **PARTIAL** | `testBikePromptUsesBikeProfile` and activity/profile parser tests passed. | Live bike-profile route and UI labels. |
| Trail-running request | **PARTIAL** | `testTrailRunPromptUsesFootProfileWithTrailRunActivity` and fixture coverage passed. | Live foot-profile result and end-user presentation. |
| Request with distance | **PARTIAL** | Alternative selection, target-distance metadata, loop distance ranking, and prompt extraction tests passed. | Live provider behavior and UI disclosure for a real result. |
| Request with duration | **PARTIAL** | Intent fixture coverage and `testDurationBasedLoopRankingUsesVerifiedRouteDuration` passed. | A live duration-constrained route from the UI. |
| Region-only request | **TESTED** | `testLoopWithRegionQueryOnlyRepairsToStartLocationQuery` and fixture coverage directly exercised region-to-start repair. | Live geocoding of the repaired region and the full UI journey. |
| Missing-start request | **TESTED** | `testVaguePromptAsksForAreaOrStartLocation` directly exercised the clarification result. | Visual clarification interaction in the app. |
| Missing-destination request | **TESTED** | `testPointToPointWithoutEndAsksForDestination` and the matching ViewModel test directly exercised the contextual question and prevented geocoding/routing. | Visual interaction and subsequent user correction. |
| Unknown location | **CANNOT_VERIFY** | A typed `GeocodingServiceError.noResults` and user-message mapping exist, but no dedicated end-to-end or focused passing audit case established the rendered behavior. | Real geocoder no-result response, error copy, and retry. |
| Impossible route | **PARTIAL** | No-route and loop-fallback exhaustion paths passed with injected `GraphHopperError.noRouteFound`. | A real impossible coordinate pair and provider response. |
| AI service unavailable | **PARTIAL** | Remote-network failure falling back to the local parser passed in deterministic tests. | Actual backend outage, latency, and release behavior. |
| Routing service unavailable | **PARTIAL** | Missing-configuration and routing-failure tests prove a friendly error and no generated route; no-route fallback tests also passed. | Real outage/HTTP failure through the shipping configuration. |
| Malformed AI response | **TESTED** | `testInvalidRemoteJSONFallsBackToLocalParserAndRecordsReason` directly exercised malformed JSON and a recorded local fallback. | Actual malformed production response and UI telemetry. |
| Slow network | **PARTIAL** | Parser and routing timeout tests passed and checked actionable recovery copy. | Real throttled networking, cancellation timing, and UI responsiveness. |
| Location permission denied | **CANNOT_VERIFY** | Voice tests cover microphone denial, not Core Location denial. No interactive location-denial run or dedicated location-service test was established. | Core Location permission prompt, denial state, fallback, and settings recovery. |
| No routes returned | **TESTED** | `testLoopNoRouteFoundAfterFallbackUsesLoopSpecificError` and friendly routing-failure tests exercised empty/no-route outcomes without emitting a route. | Live service behavior and rendered retry UI. |
| One loop seed succeeds and others fail | **TESTED** | `testRoundTripFailedSeedDoesNotFailWholeVariantRequest` and `testFailedFallbackSeedDoesNotFailWholeRequest` directly exercised partial seed success. | Live provider concurrency, timing, and card presentation. |
| Several almost-identical alternatives | **TESTED** | Duplicate-geometry, reversed-segment overlap, and false-comparison rejection tests passed. | Quality thresholds on real outdoor route geometry. |
| Requested distance is badly missed | **TESTED** | Hard-envelope rejection, retry with smaller radius, mismatch explanation, and route-quality failure tests passed. | Live result behavior and the final disclosure in UI. |

## Debug and Release differences

Both configurations compile. Static inspection also identified behavior that differs by compilation mode:

| Area | Debug | Release | Verification level |
|---|---|---|---|
| Default intent provider | Remote provider with local fallback unless a Debug environment override selects local-only. | Local parser only. | Source-inspected; both configurations built, but the user behavior was not interactively exercised. |
| Intent/routing diagnostics | Debug-only diagnostic metadata and UI hooks are compiled. | Debug-only hooks are omitted. | Source-inspected and compile-checked. |
| Local backend session authorization | A loopback-only, non-secret development authorizer can exist for an HTTP Simulator backend. | The loopback development type is not compiled; production authorization uses the attested path. | Source-inspected and compile-checked, not live-device tested. |

The Release build therefore does not currently prove remote-AI intent interpretation. Marketing or release notes must not imply that free-form remote AI is active in the shipping configuration until the release architecture and an end-to-end test prove it.

## Warnings

The builds emitted these actionable source warnings:

- `TrailMind/Services/GeocodingService.swift:53`: `CLGeocoder` is deprecated in iOS 26; migrate to MapKit geocoding APIs.
- `TrailMind/Services/GeocodingService.swift:157`: `cancelGeocode()` is deprecated in iOS 26; migrate cancellation to the corresponding MapKit request API.

The build also reported that metadata extraction was skipped because the target has no App Intents dependency. No App Intents integration is currently claimed, so this is informational rather than a runtime failure.

## Failures and unverified behavior

### Confirmed failures in this audit

- No product source test failed after environmental permissions were corrected.
- The opt-in remote intent script falsely appeared successful while its only test was skipped. This is a test-harness correctness failure.
- The first sandboxed backend run had six `EPERM` bind failures. The same tests all passed with local-network permission, so these are not classified as backend product failures.

### Important areas not verified

- Any prompt-to-live-route journey from the UI.
- Live remote-AI intent parsing.
- Live GraphHopper route-quality evaluation across the 20 quality fixtures.
- PostgreSQL-backed App Attest integration behavior.
- Core Location permission denial and recovery.
- Real network throttling, airplane-mode transitions, or prolonged provider latency.
- Route comparison and detail rendering under actual service data.
- Real-device App Attest and production-session authorization.
- Distribution signing, archive validation, TestFlight, and App Store processing.

## Recommended fixes

1. **Make opt-in live scripts fail if the live test does not run.** Pass the opt-in variable into the Simulator-hosted XCTest process through an `.xctestplan`, scheme Test Action, or `simctl ... launchctl setenv`; inspect the resulting `.xcresult` and return nonzero if the selected test is skipped. Apply the same fix to both evaluation scripts.
2. **Add a small UI-test target for the launch-critical journey.** At minimum cover clean onboarding, returning-user Home, typed prompt submission, clarification, generating, suggestions, detail, service error, and Saved-state boundaries. Use injected deterministic services for repeatability, then keep a separate opt-in live smoke test.
3. **Add dedicated geocoding and Core Location denial tests.** Verify no-results, network failure, denied permission, restricted permission, retry, and the exact user recovery copy.
4. **Run live route-quality fixtures deliberately in a protected environment.** Record provider/config version, fixture result counts, distance miss distribution, overlap rejections, latency, and failures without logging credentials or precise user location history.
5. **Run the PostgreSQL App Attest integration suite against a disposable database.** It should be a release gate for session issuance, replay prevention, expiry, concurrency, and cleanup behavior.
6. **Replace deprecated `CLGeocoder` usage before the deployment baseline hardens further.** Preserve cancellation and proximity-biased destination lookup in focused tests.
7. **Add real-device verification before beta distribution.** Exercise App Attest, permissions, background/foreground transitions, MapKit rendering, voice input, and degraded connectivity on supported iPhones.

## Paid Apple Developer account limitations

No paid Apple Developer membership was required for the work completed here: dependency resolution, Debug and Release Simulator builds, unit tests, deterministic integration-style tests, backend tests, local Simulator launch, screenshots, and console inspection are all possible now.

A paid membership or access to the owner's Apple developer team is required later for:

- Distribution signing and an App Store/TestFlight archive tied to the final team and bundle identifier.
- Uploading to App Store Connect, TestFlight processing, beta distribution, and App Review submission.
- Validating production certificates, provisioning profiles, and production App Attest capability configuration on a physical device under the shipping team.
- Final capability and entitlement validation against the App Store record.

The missing paid account did **not** cause the UI-automation limitation, the skipped live evaluations, the PostgreSQL integration skip, or any build warning. Those items can and should be addressed independently now.

## Runtime readiness conclusion

Local build health is strong: both configurations compile, all deterministic iOS tests pass, all normal backend tests pass, and the app cold-launches into polished onboarding without a crash. Launch readiness remains blocked by evidence gaps around the real user journey and live dependencies, plus a test harness that can report success while live evaluation is skipped. The next verification milestone should be a trustworthy UI smoke suite and corrected opt-in live test plumbing, followed by live route-quality and real-device App Attest validation.
