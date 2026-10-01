# User-facing route failure reasons

The existing recovery screen now receives safe, actionable English copy for backend distance limits, unusable coordinates, unsupported activity/route types, busy/unavailable services and invalid requests. Existing no-route, timeout, connectivity and location-resolution explanations remain intact. Unknown errors keep the generic fallback; raw provider messages never determine the user-facing reason.

Backend cumulative point distance and finite over-limit round-trip requests return `route_distance_limit` (HTTP 400). Limits are unchanged. The app maps this code to a typed GraphHopperError planning failure preserved through the gateway. It does not guess a numeric limit or assert that the intended trip itself was long: users are asked to check selected places or shorten the request. Older backends returning only `invalid_request` receive general request-editing guidance; precise server distance explanations require the updated backend too.

Changed areas: BackendRouteGateway, GraphHopperError, PlannerViewModel, backend route validation/error definitions, diagnostic code allowlist and focused regression tests. The existing recovery view already renders PlannerViewModel's message; no layout redesign was needed.

Validation: simulator build and 100 tests passed (BackendRouteClientTests, GraphHopperClientTests, PlannerViewModelTests); one opt-in standalone HTTP fixture test skipped. 48 backend tests passed covering validation, endpoint responses, diagnostics and mocked owner server. Coverage proves over-limit rejection before provider calls, configured loop limits, safe known-error messages and unknown-error fallback. Initial backend loopback tests were blocked by sandbox socket permissions; rerunning with loopback permission passed.

Logs: /private/tmp/wanderful-error-reasons-ios.log and /private/tmp/wanderful-error-reasons-backend.log.

Not installed on the physical phone or deployed. No new live provider session was started. This change explains failures; successful automatic Berlin routing remains separately unverified.

## Follow-up: landmark lookup repair

The owner requested installation and continued repair until the route works. A fresh direct Apple lookup of the two public Berlin landmark queries reproduced an address-only mismatch on this Mac: MKGeocodingRequest returned Brandenburgallee/Bernau bei Berlin and Bernau bei Berlin. This reproduces a lookup weakness, not the discarded exact phone response. MKLocalSearch with address and point-of-interest results returned Brandenburg Gate and Victory Column, both Berlin, with their first-result pair within 5 km.

NativeGeocodingService now uses this place search for natural-language endpoints, preserving the original query, nearby-region bias, candidate ranking/clarification, cache and cancellation. No city-specific coordinates or aliases were added. Different-language names may still require the existing explicit candidate confirmation. A regression test verifies landmarks and addresses are both included and the user's locality and resolved-start bias are retained.

Follow-up simulator validation: 55 geocoding/location-resolution/planner tests passed with the place-search change, including the new request contract regression. Log: /private/tmp/wanderful-place-search-tests.log.
