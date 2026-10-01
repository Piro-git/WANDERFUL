# Second phone test: distance-limit rejection and local recovery repair

## Established result

The second authorized test produced Google HTTP 200 and parse-intent HTTP 200 at 2026-09-14 13:44:11 UTC, then route HTTP 400 at 13:44:20 UTC with `invalid_request` / `distance_limit`. The backend validated cumulative straight-line segments over 200 km. GraphHopper was never called. Final allowance consumption was Google 1, GraphHopper 0; no provider rate limits. Both temporary processes were explicitly stopped and listener absence confirmed by 13:49:26 UTC. No reset, renewal or further live request occurred.

The screenshot supplied by the owner shows the approved Berlin prompt and failure on the phone. No route geometry or Start was proven. The exact erroneous endpoint, returned geocoder candidates and raw AI intent are unknown; none was extracted. The first run's same-looking 400 is consistent with this result but its discarded reason cannot be retrospectively proven.

## Actual source path and retained context

- `RoutePlanningRequest.init(validatedIntent:)` in AdventureModels.swift copies startLocationQuery and endLocationQuery. regionQuery is only a fallback when startLocationQuery is absent.
- `PlannerViewModel.resolveLocationCandidate` passes each query plus originalPrompt to LocationQueryContext. Destination resolution also receives the resolved start coordinate. The new integration test verifies both full `..., Berlin` queries, the original prompt and preferred start survive this path.
- `NativeGeocodingService.candidates` trims the query and passes it through contextualizedQuery into MKGeocodingRequest(addressString:). contextualizedQuery currently returns the supplied query without inserting inferred locality. Therefore Berlin is retained when present in those endpoint fields.
- If AI returned bare landmark fields with Berlin only in regionQuery, the current path would not append that separate region to the endpoint search string. OriginalPrompt still participates in candidate scoring. Whether this happened in the live request is unknown; no speculative search rewriting was introduced.
- `LocationResolutionPolicy.score` previously considered a strong place-name match sufficient even for an arbitrarily distant candidate. Proximity is a small positive score, not a hard constraint. A synthetic distant candidate with a strong Berlin name/display match passes the old score threshold. This is a reproducible missing preflight check, not proof of the actual returned candidate.
- Manual `.locationCandidate` confirmation stores the selection in PreparedAttempt. A check only in the ranking policy would be bypassed on this path, so the planner also validates the final start/end pair before calling RoutingCoordinating.

## Narrow behavior change

Point-to-point destination auto-resolution now asks for clarification when the leading candidate is beyond the backend's supported 200 km straight-line limit from the start. The distance calculation uses the same Earth radius and haversine calculation as backend routeValidation. All final point-to-point endpoints, including manual selections and legacy geocoding adapters, are checked before routing. The user receives a specific message to check start/destination instead of a generic server failure.

No Berlin/Harz-specific production rule, new provider/POI feature, blanket loop restriction or relaxed backend limit was added. This restores clear recovery for an unsupported endpoint pair. It does not establish successful automatic landmark matching or completion of the original Berlin trip.

## Validation

The simulator build passed. 54 selected LocationResolutionTests, GeocodingServiceTests and PlannerViewModelTests passed. New coverage includes:

- A strongly named but distant synthetic destination requires clarification.
- Correct nearby Berlin coordinates still resolve automatically.
- The actual planner never calls its router for an over-limit resolved pair.
- Both full Berlin queries and original context survive the actual intent-to-location path.
- Manual confirmation of the distant candidate remains blocked before routing; selecting the nearby candidate reaches the router with the intended coordinate.

An earlier test launch failed with an invalid simulator connection UUID before tests ran; the subsequent run passed. The final focused run passed all 10 location-resolution tests, including the assertion demonstrating that the distant fixture exceeds the old automatic score threshold.

No new repair build was installed on the physical phone. The last installed app is the original compiled source 826bfc7 with the now-ended second-session credential. Offline mocks and the new preflight check must not be presented as successful live routing.

## Remaining acceptance

Automatic Berlin route generation and route Start remain unverified. A future authorized diagnostic run would need corrected location selection and successful real GraphHopper geometry on the phone. Any investigation of a still-wrong location should use a specifically scoped, non-sensitive indication of whether the endpoint query retained its requested locality rather than raw prompts, coordinates or provider responses. No further live run is authorized by this completed second attempt.
