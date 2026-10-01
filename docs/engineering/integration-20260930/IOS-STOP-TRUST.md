# iOS route stop and explanation boundary — 2026-09-30

Starting candidate: `016ef5b47fd2308e77afe3be577f7d0203c2079a`.
Tested source commit: `1594e69cbc26ce7c564689ddd36f0c7395f9c3bd`.
Backend tree remains `b1b0b37d8b4fc1939cbc16d7a75deed3c304365b`.

## Findings and fixes

`BackendDynamicResearchPlanningClient.validate` previously measured stop distance only to route vertices. A sourced stop on the middle of a long segment could be rejected despite lying on the returned geometry. The client now uses `RouteStopGeometry` to project onto finite minor great-circle arcs, including the dateline and polar regions. It retains the 100 m limit and monotonic progress, including progress within a single segment. Documented access targets are still used only after their existing evidence validation; the place identity remains separate. Invalid coordinates and ambiguous antipodal arcs cannot establish a match. Geometry proximity is not proof of access, safety or a visit.

The client previously displayed model-authored `qualityReview.summary` and `remainingWishes` directly as the route explanation. A valid envelope did not establish the truth of those statements. The client still validates review structure and completion state, but now constructs the displayed explanation locally from the validated route distance and a clearly attributed partial/unresolved assessment. It never reproduces those free-text fields or the top-level model explanation. It explicitly leaves current access, safety and drinking water availability unverified. Original requested preferences remain available in existing planning metadata; individual model-authored unresolved-wish descriptions are no longer displayed through this field.

This change is scoped to the route explanation boundary. It is not a semantic audit of every separately displayed web-research passage, place name or local notice. Existing source/evidence checks remain unchanged. The separate backend route-owner patch has not yet been supplied/integrated in this handoff.

## Files

- `TrailMind/Services/DynamicResearchPlanningClient.swift`: ordered segment matching and locally constructed explanations.
- `TrailMind/Services/RouteStopGeometry.swift`: bounded spherical segment projection.
- `TrailMindTests/DynamicResearchPlanningClientTests.swift`: sparse-segment acceptance, reversed/off-route rejection, and DE/EN unsupported safety/water claim suppression for complete/partial reviews.
- `TrailMindTests/RouteStopGeometryTests.swift`: nine focused geometry tests covering finite endpoints, 98/102 m boundaries, dateline, high latitude, pole crossing, same-segment ordering, later revisits, duplicates and invalid/antipodal geometry.

## Verification

One incremental Debug arm64 simulator build and focused XCTest run succeeded on iPhone 17 Pro / iOS 26.5: **43 passed, 0 failed, 0 skipped**.

- DynamicResearchPlanningClientTests: 15.
- RouteStopGeometryTests: 9.
- DurableResearchTransportTests: 7 (the release-only test is listed by discovery but not compiled in Debug).
- RouteCardStopPhotoTests: 7.
- RouteStaysTests: 5.

Result: `~/Library/Developer/XcodeBuildMCP/workspaces/EasyWander-d3f5c9563e5d/result-bundles/test_sim_2026-09-30T17-42-20-163Z_pid22038_4bc2d041.xcresult`.
Log: `~/Library/Developer/XcodeBuildMCP/workspaces/EasyWander-d3f5c9563e5d/logs/test_sim_2026-09-30T17-42-20-163Z_pid22038_0d4c6319.log`.
Compact summary: `evidence/ios-stop-trust-tests.json`.
Existing redundant-await warning in OwnerAccessClientTests remains unrelated. `git diff --check` passed. No UI, Release, physical-device or live-provider test is claimed. No backend rerun was needed for this iOS-only patch.

## Capacity and unchanged gates

Before work, free space was approximately 245 MiB. Two own obsolete XCTest product packages were removed (00:36 and interrupted 00:38 runs from September 30); their xcresults, logs and screenshots were preserved, along with the 09:38 successful package. This raised free space to about 661 MiB, with about 629 MiB immediately before the single incremental test run. The run passed; approximately 164 MiB remained afterward. No further heavy build should start until more capacity is available. Source/Git stores, package checkouts, simulator data and physical-device data were not deleted.

No deployment, physical-device installation, remote push, provider call, database migration, grant or feature-flag change occurred. Weather and production activation gates remain unchanged; the weather migration is still blocked by the frozen runtime privilege manifest.
