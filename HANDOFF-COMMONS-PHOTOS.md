# Commons photo lane handoff

Base: `3aae5e19ec83b43196295e2dc3e98085e64046f0` (verified nested routing repair).
Final: recorded in the amended local commit that contains this handoff.

## Delivered

- `WikimediaCommonsPhotoResolver` resolves only the actual stop's Wikidata `P18` image, then checks canonical Commons media/file URLs, supported Creative Commons licence URL, and a non-empty author before showing it.
- Resolver cache is bounded to 48 items and honours Swift task cancellation. Missing identity, rights, mismatch and failed media resolution simply yield no image.
- `CommonsRoutePhotoGallery` is a lazy, compact route-detail gallery in stop order. It retains already validated server-side Commons records for compatible saved routes and never supplies a synthetic, stock or name-searched replacement.
- Existing route-detail wiring is untouched except for one isolated call within `DynamicResearchStopsView`; no `RouteDetailView`, `RouteCard` or `SavedRoute` structural wiring was changed.

## Evidence

`WikimediaCommonsPhotoResolverTests` uses URL-protocol fixtures to cover valid P18/source-chain resolution, unsupported licence rejection, no-Wikidata identity, Commons filename mismatch, and bounded cache retention across coordinates in different regions. Swift parser checks passed for all three new Swift files and the test file; `git diff --check` passed.

Full `xcodebuild build-for-testing` could not reach app compilation: dependency extraction for the existing Superwall binary target failed because the local volume was full. No code, fixture or external provider error was reached. No simulator/device or live Wikimedia proof is claimed.

## Integration

Cherry-pick the final commit from branch `codex/commons-photos-20260915` onto the integrator's chosen history. The only pre-existing shared file touched is `TrailMind/Views/Route/DynamicResearchStopsView.swift`; review that one-line gallery insertion separately if another route-detail owner is changing the same section.

## Remaining product prerequisites

- A configured production research backend must include valid OSM stops plus Wikidata IDs; availability of a Commons P18 image is intentionally not guaranteed worldwide.
- Run the named XCTest target and visual acceptance on a device/simulator with sufficient disk space before release.
