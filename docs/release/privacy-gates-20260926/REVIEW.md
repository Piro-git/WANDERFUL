# Release artifact, permission and attribution review — 2026-09-26, follow-up 2026-09-27

Base: clean iPhone candidate `914a2c122c134bd321305a2461c3d0c8fa88c451`, isolated branch `codex/release-privacy-gates-20260926`. This review does not authorize feature activation, backend changes, signing, deployment or device installation.

## Four original findings

| Gate | Exact cause in the candidate artifact | Decision and product effect |
| --- | --- | --- |
| `permission_contract` | Expected old foreground-only location-purpose string, while built plist already describes active guidance through screen lock/app switching and Pause/End. | Match the existing shipping disclosure; additionally require exactly `UIBackgroundModes=[location]`. Missing, extra or duplicate background modes fail. |
| `forbidden_info_keys` | `UIBackgroundModes` was prohibited wholesale. Actual value is only `location`. | Move this specific key to exact permission validation. Always-location, temporary precision, local-network and broad ATS exceptions remain forbidden. No app permission is added. |
| `release_composition_markers` | Binary contains `RemoteAIIntentParsingProvider`. Existing `PrivacyReleaseContentTests` explicitly require it in the enabled Release factory and its typed errors. | Permit the supported provider and its `parse-intent` endpoint. Remote feature flag remains false; remote-with-local-fallback, mocks and debug markers remain forbidden. No provider is activated. |
| `required_attribution_markers` | Only missing required string was the obsolete “foreground planning aid” sentence. All three provider attribution markers were present. | Require the actual visible sentence “Route Guidance is a planning aid, not a safety guarantee.” Provider markers remain mandatory. |

These are corrections to an obsolete artifact contract, not a waiver of failed product checks. The verifier still returns failure for the unsigned artifact's four signature/entitlement checks. Synthetic self-test fixtures are explicitly separate from real build evidence.

## Permission and privacy review

`RouteDetailView` presents guidance after the explicit start action. `CoreLocationRouteLocationService` requests When In Use only, verifies the background mode before starting, enables the visible system background indicator, and disables updates/indicator when the stream ends. No Always request, significant-change monitoring or visits API is used. `RouteGuidanceModel` stops monitoring on Pause, End, completion, error and permission revocation; view disappearance calls shutdown. A background transition preserves an already started session and releases screen-awake ownership. Samples are used in memory for progress; this path does not persist or upload a location track. App termination requires manual reopening/resumption.

Keep background location because this is implemented product functionality, with matching native disclosure and lifecycle tests. **Physical lock-screen continuation, battery behavior and system-indicator visibility are not established by model tests.** Add them to the exact signed candidate's iPhone acceptance; do not declare background runtime accepted from this patch.

Microphone and speech purposes are unchanged; input is explicit, uses Apple Speech, and existing copy explains server processing. Account, Apple Sign In, commerce, remote research and direct provider flags remain fail-closed. The privacy manifest is unchanged, not certified complete: SDK/provider retention, signed archive privacy report and final App Privacy answers remain release work.

A real disclosure gap was fixed: native Profile → Privacy & data now explains optional Wikidata/Commons identifiers, file-name requests and network-address exposure. This is distinct from route tracking. The author/source/license metadata do not prove current conditions or image rights beyond the returned source record.

## Attribution and identity

- Profile contains the existing GraphHopper, OpenStreetMap/ODbL and Mapterhorn links; the map uses native MapKit. This patch does not remove or cover the native map attribution. Real device visibility at supported sizes remains acceptance work.
- Route detail → mapped stops → Commons gallery displays the stop name plus author linking to the file page and license linking to its terms. Credits now wrap rather than truncate to one line; gallery title is “Photos linked to these stops” instead of promising what the user will see.
- On-device lookup uses exact Wikidata P18 or validated direct OSM Commons mapping, no name/proximity search. Missing metadata yields the existing honest empty state. New guard rejects a description-page URL for a different file even if the API page title matches. Space/underscore spelling is normalized for Commons URLs.
- Server-provided photos use `DynamicResearchStop` validation (allowed media hosts, license and source identity) and their separate stop-card author/license links. They still depend on the backend's P18/file association; a live positive/negative photo and long-credit visual acceptance remains required. No fixture is claimed as a live photograph or a route-membership proof.

Primary references checked on the review date: [GraphHopper attribution](https://www.graphhopper.com/attribution/), [Commons reuse guidance](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia), [Apple background location](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background). GraphHopper lists OSM and Mapterhorn attribution; Commons requires following each file's author/license terms.

## Validation

Results and exact counts are recorded in `evidence/`. The final unsigned arm64 Release simulator build succeeded. Its real verifier result is 41 pass / 4 fail / 0 skip (45 checks); only the four signature/entitlement IDs listed in the report fail. The verifier exits 1, as it must. Self-tests pass 55 isolated command cases plus stale-report recovery, with 0 failures and no waived cases. Focused XCTest results are recorded separately after execution. No physical-device, StoreKit Sandbox, Apple login or production routing success is inferred.

### Focused XCTest execution

Fresh Debug simulator run: **50 passed / 0 failed / 0 skipped**. Breakdown: PrivacyReleaseContent 15, RouteGuidanceModel 19, RouteLocationStreamSource 3, WikimediaCommonsPhotoResolver 13. These include the new foreign-attribution-file rejection, Commons space/underscore compatibility, disclosure and artifact-contract tests.

The additional native Privacy/Help UI test initially failed **0 passed / 1 failed / 0 skipped** before entering Profile. The captured hierarchy proves the tab was `Profil` in German while the existing test asserted English `Profile`. The isolated test now launches with `-wanderful.interfaceLanguage en`; this overrides the argument domain without changing the persisted preference. The original failure is retained in evidence, never reclassified as a skip. The bounded retry on 2026-09-27 passed **1 passed / 0 failed / 0 skipped** in 39.6 seconds. It reached both native Privacy & data and Help & safety destinations. This does not establish live photo rendering or long-credit layout acceptance.

### Reproduction

Use Xcode with the candidate's pinned packages, an already booted iOS 26.5 simulator and adequate free disk space. Build the `TrailMind` scheme in Release for arm64 iOS Simulator with `CODE_SIGNING_ALLOWED=NO`. Run `scripts/verify-release-artifact.sh simulator-app <Release TrailMind.app>` with `TRAILMIND_RELEASE_REPORT_PATH` pointing to the chosen evidence destination. Expected result for this unsigned artifact is exit 1, 41/4.

Run `zsh scripts/test-release-artifact-verifier.sh`. For fresh `xcodebuild test`, select only `TrailMindTests/PrivacyReleaseContentTests`, `TrailMindTests/RouteGuidanceModelTests`, `TrailMindTests/RouteLocationStreamSourceTests`, and `TrailMindTests/WikimediaCommonsPhotoResolverTests`; use serial execution. Separately select `TrailMindUITests/TrailMindCriticalPathUITests/testNativePrivacyAndHelpRemainReachableWithoutConfiguredWebLinks`. No claim is made that this replaces the full app test suite or the signed-device acceptance matrix.

### Handoff constraints

Cherry-pick only this narrow patch into the release owner's reconstructed candidate, preserving its public-document redactions. Only that owner integrates/pushes. Only the iPhone integrator installs. Keep signature checks, backend readiness, live photo acceptance, signed-device background behavior and prior account/StoreKit gates open. No backend, production configuration, permission plist, entitlement, Team ID or signing setting changes are part of this patch.
