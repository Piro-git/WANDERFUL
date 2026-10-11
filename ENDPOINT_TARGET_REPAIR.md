# Unrequested point-to-point targets

Owner confirmed the fourth run's precise error: “The mapped route doesn’t match the requested distance.” The prompt contains two Berlin landmarks and no distance or duration. This establishes rejection by the distance envelope; the discarded live intent and profile contents do not establish which component supplied the target.

The planner previously forwarded both interpreted targets and profile-adapted targets into route-quality selection regardless of whether the current endpoint request specified an outing size. It now clears distance/duration targets for point-to-point requests whose raw-prompt-derived comfortableOuting explicitness is not specified. This runs after profile adaptation and before intent application and all routing/constraint checks, including the profile-adapter failure fallback. Other fields, requested places and planned start time are preserved. Loop defaults and explicit endpoint targets remain intact. Route geometry and safety/quality limits are unchanged.

Regression: a verified synthetic 2 km point-to-point route is accepted when an unrequested 12 km/180-minute target is removed. Explicit targets still survive and reject extreme target misses. Loop defaults remain intact. All 99 RoutingFoundationTests/PlannerViewModelTests passed, simulator build succeeded. Log: /private/tmp/wanderful-endpoint-target-tests.log.

No fifth online test has been started. All earlier provider/session budgets remain ended. This is an offline-tested repair of the observed rejection cause; real phone-route acceptance remains to be verified with newly approved access.

Physical Debug build and deep signature verification passed. Same-ID data-preserving iPhone installation succeeded September14 at23:20CEST, database sequence5688, source d883439. No new live access embedded; the fourth session remains ended.
