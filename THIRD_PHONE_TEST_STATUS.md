# Third phone repair verification

User requested updating app/backend and continuing until it works. Source 596010f includes safe failure reasons and the landmark lookup fix. Simulator 55 focused tests pass and physical iPhone build/signature verification succeeded.

A new bounded tunnel was started with public origin https://lyric-carlos-require-drew.trycloudflare.com/ using the existing 40-minute wrapper. Automatic approval review then rejected starting the credentialed backend because explicit authorization for this new payload, tunnel destination and live session was required. No backend/session/provider call was started, no session token created or copied. The original two completed sessions remain ended. Await direct confirmation for one 30-minute session, the existing 1 Google / 2 GraphHopper limits, at most USD 2 pre-tax / 4 existing credits and embedding its temporary token only. No provider credentials in the app.

Do not bypass the rejection. The tunnel wrapper expires automatically; inspect its state before acting on any later approval and do not silently replace its approved origin. Installation of the tested app is independent of new online access.

## Explicit approval and activation

The owner directly answered yes to the exact pinned-origin 30-minute Berlin test, temporary app access, 1 Google / 2 GraphHopper maximum, USD2 pre-tax and 4 existing routing credits. The same original third tunnel was still running. Backend startup succeeded at approximately 16:42 CEST on September 14, 2026, with the fixed 30-minute session expiry (approximately 17:12 CEST), no renewal. Unauthenticated HTTPS route POST returned 401. The approved fresh session resource was copied only into the compiled owner Debug app, re-signed and signature-verified. Data-preserving physical install succeeded at 16:43 CEST, same bundle ID com.example.owner.wanderful.local, database sequence 5600. Compiled source is 596010f.

Active process handles: tunnel 57955, backend 76658. Both wrappers are time bounded. No successful route has yet been observed; next step is the owner's single original Berlin prompt, followed by any necessary location-candidate confirmation. Do not reset counters or start another session. Stop the service and tunnel at completion or deadline.

## Third live result: backend success, phone still reports failure

At 14:44:50 UTC Google and parse-intent returned 200. At 14:44:57 UTC GraphHopper first returned 400, translated to flexible_mode_unavailable / 422; the existing automatic fallback then returned GraphHopper 200 and authenticated route endpoint 200. Thus the former distance rejection is absent and the routing fallback reached a successful normalized backend response. The owner still reports the same error screen. This does not prove successful app decoding, validation, suggestions, or route Start. The exact failure is not yet known: the precise current recovery message was requested; the response body was not retained. Do not infer a decoder or eligibility cause as proven.

Final counters: Google 1/1, GraphHopper 2/2, no rate limits. The backend (76658) and tunnel (57955) were explicitly stopped via SIGINT at approximately 14:47 UTC; both exited successfully. No further attempt, counter reset, or renewed session was started. Source remains 596010f. Need the exact message under the generic title to narrow the client-side stage before proposing another bounded verification.

## Screenshot and error-propagation repair

The owner's screenshot shows the original Berlin point-to-point prompt but the body says “couldn’t build a useful loop”. Source inspection proves this exact copy was used for every RoutingError, including point-to-point quality rejection. It therefore does not prove the planner attempted a loop. It narrows the visible failure to the routing coordinator error family; the precise old rejection reason remains unavailable.

RoutingCoordinator now preserves a deterministic typed reason from quality-selection rejection counts for point-to-point failures. PlannerViewModel uses the specific RoutingError description instead of assigning the loop message universally. Messages cover distance/duration mismatch, detours, difficulty/road constraints, geometry/evidence problems and actual loop failures. No acceptance thresholds were relaxed and no unproven live rejection cause was patched speculatively. The first simulator build and 96 focused routing/planner tests pass. A separately added coordinator regression is being verified.

Final verification limitation: the added coordinator regression initially failed because the test helper removes distance targets from point-to-point requests. The fixture was corrected to construct an explicit 12 km request directly. Its rerun was blocked before tests by disk exhaustion while rebuilding UIKit module cache. Only task-generated Index.noindex/ModuleCache.noindex were removed; no user files were deleted. The corrected additional regression remains unverified. Earlier 96 tests/build passed for the production change. New code has not been installed on the phone. More free disk space is required before completing the final test/build; no new live test was started.

## Resumed after storage cleanup

Owner freed space; 8.7 GiB observed. Both outstanding simulator regressions now pass, including the corrected point-to-point distance rejection fixture and PlannerViewModel message mapping. Combined with the earlier 96 passing tests, final source checks are complete. Log: /private/tmp/wanderful-quality-reason-resumed-tests.log. The temporary empty Personal Team entitlement file had been removed; it was recreated with an empty plist dictionary and the phone build restarted. No session credential or provider key was recreated or read. All live sessions remain ended.

Final physical build and deep signature verification passed. Same-ID data-preserving installation completed September 14 at 22:51 CEST, installation database sequence 5672, source 0413115. No new live access was created; the app still needs a fresh explicitly approved session for further real routing. Berlin-route acceptance is not yet established.
