# Offline iOS routing contract investigation

## Scope and evidence

The owner-phone run on 2026-09-14 returned Google and parse-intent HTTP 200, then authenticated route HTTP 400 before any GraphHopper reservation. That run did not retain the body or typed validation reason. Its exact cause is therefore unproven.

The installed revision was 826bfc7. BackendRouteGateway.swift has identical SHA-256 be47d01cee748c1ac2d97d1d757dce1e8f545bd37e41905609c1a7432eec6c0c in the installed revision and this investigation. GraphHopperClient, routeValidation, routeAuthorization, owner session accounting and acceptance budget code are unchanged from that revision.

The new opt-in XCTest uses the actual GraphHopperClient, BackendRouteRequest synthesized Encodable implementation, BackendRouteGateway and bounded URLSession transport. It sends public synthetic Berlin coordinates to a loopback owner HTTP handler. The handler uses the real session authorizer, route validator, GraphHopper request builder, response normalizer and acceptance budget. Only the upstream fetch is replaced by an assertion-backed mock. The global fetch fallback is poisoned to prohibit accidental provider traffic.

Both standard point-to-point and three-path alternative requests reach the mock. Assertions cover foot profile, English locale, longitude/latitude order, elevation, instructions, flexible mode, custom model and alternative parameters. Swift then asserts decoded distance, three coordinates, elevation and backend GraphHopper provenance. These are synthetic test routes, not real outdoor evidence.

## Contract audit

| Area | Result |
| --- | --- |
| JSON fields | Named latitude/longitude point objects; no provider key or unsupported extra field is encoded. Optional nil fields are omitted by the Swift encoder. |
| Profiles | Hiking/trail running map to foot, biking to bike; backend permits both. |
| Locale/details | en and surface/road_class/hike_rating are accepted by the installed validator. |
| Point-to-point | Two points accepted; backend caps total straight-line segments at 200 km. A wrongly resolved distant endpoint could produce 400, but this was not established on the phone. |
| Alternatives | Swift emits maxPaths 3, maxWeightFactor 1.4, maxShareFactor 0.65; all fall within backend bounds. |
| IDs/auth | UUID v4 accepted; synthetic 43-character owner token authenticated before handler work. Real live route passed that outer authentication check. |
| Acceptance | Two-point standard/alternative payloads are allowed by the actual 1-Google/2-GraphHopper limiter; no limits were widened. Acceptance transport rejection maps to service failure, not the observed schema-level 400. |
| Research flags | Research is disabled; ordinary /api/route remains allowed independently of the research endpoint. |
| HTTP parsing | Malformed JSON or wrong Content-Type can also return 400 before endpoint work. No original body was retained, so this remains distinguishable only on a future diagnostic request. |

The recreated request succeeds. This rules out a general encoder/validator/acceptance mismatch for these inputs; it does not prove why the actual phone request failed. Do not describe the live routing bug as fixed or label the synthetic route as a successful phone acceptance.

## Reproduce without live services

From this repository, start the fixture in one terminal:

```sh
node backend/scripts/offline-ios-route-contract.js
```

For the exact installed owner HTTP adapter, add `--installed-revision`. This reads the trusted local Git revision 826bfc7 and imports its adapter against the unchanged local routing/session implementations. Neither mode reads provider credentials, creates a tunnel or contacts a provider. Fixtures use a disposable temporary directory and synthetic token; shutdown removes their files.

In a second terminal run the single opt-in XCTest with the existing simulator ID:

```sh
TEST_RUNNER_WANDERFUL_OFFLINE_CONTRACT_TEST=1 xcodebuild \
  -project TrailMind.xcodeproj -scheme TrailMind -configuration Debug \
  -destination 'platform=iOS Simulator,id=A9194E37-28A7-450E-9F30-95D0145D0486' \
  -derivedDataPath /private/tmp/wanderful-routing-repair-20260914-build \
  -disableAutomaticPackageResolution -parallel-testing-enabled NO \
  CODE_SIGN_IDENTITY=- 'OTHER_SWIFT_FLAGS=$(inherited) -D WANDERFUL_OWNER_PHONE_TEST' \
  -only-testing:TrailMindTests/BackendRouteClientTests/testOfflineHTTPContract test
```

Stop the fixture with Ctrl-C after XCTest. It prints safe synthetic diagnostics and the asserted mocked call count (expected 2); its maximum lifetime is ten minutes. Without the environment opt-in, ordinary XCTest runs skip this one integration test and perform no loopback traffic.

## Validation results

- Current owner adapter: XCTest passed, two mocked GraphHopper calls, both HTTP 200 and successful Swift route decoding.
- Backend routeValidation/routeEndpoint/routeServer/ownerPhoneAcceptance: 51/51 tests passed.
- Earlier safe-diagnostic change: 13/13 diagnostic/server/acceptance tests passed.
- Exact installed adapter: both requests returned HTTP 200 and reached the asserted upstream mock. Requests were generated by compiling the actual BackendRouteRequest declaration with Swift against the public synthetic coordinates, then sent over loopback HTTP. Both normalized responses were identical and carried GraphHopper identity plus three coordinates. The simulator rerun against that adapter could not install its new XCTest clone because the Mac ran out of storage; no second simulator result is claimed. The first complete Swift HTTP/decode test above passed. Removed only this task’s regenerable build intermediates (556 MB); no user apps or files were deleted.

No live test/session/tunnel was restarted. The first live run remains Google 1, GraphHopper 0, with no successful phone route or Start evidence. A future physical test is diagnostic work, not acceptance of a proven routing fix; it needs a newly bounded authorization and the safe validation diagnostics already prepared.

## Remaining live-400 branches and minimum next diagnostic

The reconstructed green request is not a live fix. The existing metadata establishes only successful remote parsing, successful outer token authentication for the route request, HTTP 400 and zero GraphHopper reservations.

- HTTP input rejection remains possible: wrong Content-Type, invalid JSON or an empty body (the latter becomes an empty object and fails profile validation). Oversize input is 413, and cancellation is 499, so neither directly matches the observed 400.
- Route validation remains possible: unsupported profile/algorithm, malformed or out-of-range coordinate objects, zero/excess point count, cumulative straight-line distance over 200 km, incompatible route mode/algorithm settings, round-trip distance/seed bounds, alternative limits, unsupported locale/details, unexpected fields or invalid typed preferences. Fixed fields in the reconstructed point-to-point request all passed. The original resolved points and parsed route settings were not retained, so they cannot be eliminated on the basis of the reconstructed request.
- Location resolution is score-based. `LocationResolutionPolicy.score` adds at most 0.08 for proximity, tapering to zero at 150 km; it is not a hard distance rejection. The planner checks that start/end are at least 250 m apart and that candidates are usable anchors, but does not enforce the backend's 200 km maximum. A distant false match can therefore reach backend distance validation. This is a possible path, not evidence that either Berlin landmark was actually misresolved. Do not change the intended ranking or distance contract based on this hypothesis.
- Ambiguity/no-result/unusable-anchor/too-close failures normally stop before the route HTTP request; they do not explain this observed backend response directly.
- The owner-session path returns 401 for invalid/expired tokens or invalid UUID/cost, 409 for replay and 429 for exhausted/concurrent requests. It does not use the App Attest unsupported-device 400 branch. Provider configuration or acceptance-filter rejection becomes service failure, not this 400. A real GraphHopper rejection is excluded by zero durable provider reservations.

Minimal future record: correlated endpoint, status, typed error code and a fixed validation category. No original prompt, resolved place names, coordinates, raw body, headers/token or upstream error text is needed. The existing route diagnostic now records typed route failures and known static categories including distance_limit. Added `route_http_rejected` for the earlier HTTP parser boundary, with only malformed_json/content_type categories. The owner adapter defaults to its safe diagnostic logger; logging failures cannot alter the original HTTP result. Tests exercise both malformed inputs and a synthetic distant-coordinate rejection and verify private body text is absent. All 45 targeted diagnostic/owner-server/route-server/validation tests pass. No route-generation rules, production validation, app UI or live-session limits were changed.

If a later authorized attempt reports `distance_limit`, investigate location-selection correctness locally using synthetic candidates before changing behavior. If it reports an HTTP category, inspect transport/header/body handling. If it reports another typed validation error, reproduce that branch with a synthetic request. A new successful reconstructed request alone must not be reported as repair of the original failure.
