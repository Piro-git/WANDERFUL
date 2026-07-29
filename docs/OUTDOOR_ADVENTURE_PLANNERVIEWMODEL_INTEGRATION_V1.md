# Outdoor Adventure PlannerViewModel Integration V1

## Status

This integration adds a disabled-by-default path-selection seam to
`PlannerViewModel`.

The shipping local-intent and GraphHopper flow remains the only active path
unless all of the following are true:

1. `TrailMindBackendConfiguration.researchGuidedPlanningEnabled()` returns
   `true`.
2. The existing intent validator produced a `ValidatedAdventureIntent`.
3. The existing location flow resolved an explicit, usable start candidate.
4. `AdventureResearchIntentAdapterV1` returns a valid `.ready` result.

The tracked Debug and Release feature-flag value remains `false`. This
integration does not enable the iOS flag, backend flag, or any live provider.

## Dependencies

`PlannerViewModel` injects three production behavior dependencies:

- `any AdventureResearchIntentAdaptingV1`
- `any OutdoorAdventurePlanningCoordinatingV1`
- `@MainActor @Sendable () -> Bool` research availability policy

It also accepts one default-no-op lifecycle observer,
`researchOperationDidFinish`, solely so deterministic tests can acknowledge
that a cancellation-ignoring or timed-out coordinator operation reached the
post-`TimeoutRace.resolve` boundary. It receives only the local request UUID
and does not affect path selection, routing, UI state, or provider data.

Production defaults reuse:

- `AdventureResearchIntentAdapterV1`
- `OutdoorAdventurePlanningCoordinatorV1`
- `TrailMindBackendConfiguration.researchGuidedPlanningEnabled()`

Tests can force availability without changing bundle configuration.

The existing `RoutingCoordinator`, location resolver, parser, validator,
timeouts, attempt IDs, and cancellation task remain the single shipping
planning lifecycle.

## Path-selection boundary

Path selection happens only after:

1. Prompt parsing.
2. Intent validation.
3. Existing intent clarification.
4. Existing start-location resolution and broad-region clarification.
5. Existing point-to-point destination resolution when applicable.

It happens immediately before the existing call to
`RoutingCoordinating.routeSuggestions(for:)`.

The adapter receives only:

- the validated intent;
- the explicit resolved start `LocationCandidate`.

The research coordinator receives only the adapter-produced
`AdventureResearchIntentV1`.

The coordinator never receives the raw prompt, geocoding query, candidate ID,
candidate provider/rank, parser debug information, backend configuration,
authorization data, or credentials.

## Feature-off invariant

When the availability policy returns `false`:

- the adapter is not called;
- the research coordinator is not called;
- no additional authorization or networking is started;
- the existing legacy router is called exactly as before;
- existing clarification, retry, cancellation, timeout, error, route
  preparation, notice, and outdoor-evidence behavior is retained;
- the successful state has `researchContext == nil`;
- no research notice is shown.

The focused regression suite covers hiking, trail running, biking, loops,
point-to-point routes, broad-location clarification, retry, and late
cancellation completion with the feature forced off.

## Adapter state policy

| Adapter state | Planner behavior |
| --- | --- |
| `.ready` | Calls the research coordinator exactly once under the existing routing timeout and attempt protection. The legacy router has not been called. |
| `.clarificationRequired` | Calls neither coordinator nor legacy router. A single geographic-anchor location/start question uses the existing free-text location clarification. Typed adapter gaps, adapter origin, and the bounded typed questions are retained with that pending clarification. Any unrepresentable question enters bounded recoverable edit-request copy with the same typed context. |
| `.unsupported` | Calls the existing legacy router exactly once and records adapter gaps in typed fallback context. No research notice is added, preserving ordinary biking, point-to-point, and other unsupported V1 behavior. |

Invalid adapter invariants never reach the research coordinator. Invalid
clarification fails to the existing edit-request recovery; invalid ready
output uses one standard-route fallback.

## Coordinator state policy

| Coordinator state | Planner behavior |
| --- | --- |
| `.routed` | Validates every returned alternative, displays the existing suggestions without rerouting, and records routed research context. |
| `.partial` | Applies the same route validation, displays verified alternatives without rerouting, preserves planning gaps and limitations, and shows only “Some requested preferences could not be verified.” |
| `.clarificationRequired` | Displays no routes. A single representable geographic-anchor question uses existing location clarification; all other fields use bounded edit-request recovery. Both states retain coordinator origin, adapter gaps, backend planning gaps, and the bounded typed questions. |
| `.unsupported` | Calls the legacy router exactly once, records typed unsupported context and planning gaps, and identifies any success as a standard routed option. |
| `.noViableRoute` | Calls the legacy router exactly once, records typed no-viable-route context and planning gaps, and identifies any success as a standard routed option. |

These coordinator failures also discard the research result and use one
legacy routing attempt:

- `unavailable`
- `authorizationFailed`
- `rateLimited`
- `timedOut`
- `rejected`
- `invalidResult`

Unexpected errors are reduced to the same safe internal category as
`unavailable`. Provider errors and response bodies are never shown.
`CancellationError` remains cancellation and never starts fallback routing.

The bounded fallback notice is:

> A standard routed option was built because research-guided matching was
> unavailable.

When standard routing also supplies an existing user-facing notice, the
integration preserves both notices in deterministic order: research fallback
first, then the routing notice, separated by one blank line. A sole notice is
preserved exactly, including whitespace. Exact duplicate notices collapse to
one copy. At most these two already-curated presentation notices are merged;
the merger does not include typed gaps, errors, provider details, or codes.
Feature-off planning and adapter-unsupported fallback have no research notice,
so their routing notice remains byte-for-byte unchanged.

## Research clarification context

Research clarification can carry an optional
`PlannerViewModel.ResearchClarificationContext` on
`PendingClarification` or `PlanningRecovery`.

It preserves only:

- typed origin: adapter or coordinator;
- typed adapter gaps;
- typed backend planning gaps, when supplied by the coordinator;
- one through sixteen typed clarification questions.

Representable research location/start clarification stores the context on the
pending clarification. An unrepresentable research clarification stores the
same context on its recoverable edit-request state. Existing parser,
validation, and geocoding clarifications and recoveries store `nil`.

This context is distinct from successful-route `ResearchPlanningContext`. It
does not store a raw prompt, normalized intent, provider metadata, backend
payload, authorization data, credentials, arbitrary errors, or error text.
Typed gap codes remain internal and are never interpolated into the
clarification or recovery copy.

## Research planning context

Successful planning can carry an optional
`PlannerViewModel.ResearchPlanningContext`.

It preserves:

- outer outcome: research routed, research partial, or typed legacy fallback;
- adapter gaps;
- backend planning gaps;
- nested selection state;
- source envelope state;
- rejection counts;
- remaining limitations;
- research alternatives keyed by the displayed `RouteSuggestion.id`.

Each keyed sidecar preserves:

- research attempt ID;
- route result ID;
- `ResearchRouteProvenanceV1`;
- `[ResearchWaypointVisitV1]`.

The displayed suggestion remains in `PlanningSuccess.suggestions`. The
research context does not duplicate it and does not store normalized intent,
raw prompt, parser/debug metadata, `LocationCandidate`, provider payload,
authorization data, or backend error text.

Outer `.partial` and nested route-selection state remain distinct because an
outer partial result may contain a nested routed selection when backend
planning gaps, rather than route conversion, caused partiality. Nested
selection/source states must remain coherent (`routed/routed` or
`partial/partial`), and an outer partial must have a real partial cause:
backend planning gaps or a partial route-selection source.

## Route acceptance

Every coordinator result must first carry a normalized intent bound to the
exact structured intent submitted by the adapter. Backend canonical ordering
of set-like arrays is allowed. Routed, partial, unsupported, and no-viable
results may not change the anchor, activity, route type, constraints,
preferences, group, date/season, overnight, transport, or clarification
meaning. A clarification result may add only its declared questions and may
replace the anchor with the corresponding typed unresolved anchor. All other
fields remain stable. This binds routed and non-routed decisions to the active
request without retaining normalized intent in UI state.

Every displayed research-guided suggestion must then satisfy all of these
checks:

1. The alternative set is non-empty.
2. Suggestion IDs are unique.
3. `route.isVerifiedRoutedResult == true`.
4. `RouteEligibilityPolicy.validate(route, for: .productionSuccess)` passes.
5. The route activity is hiking or trail running and matches the local
   planning request.
6. The route type is a loop and matches the local planning request.
7. Routed provenance remains GraphHopper provenance.
8. Research provenance activity and route type match the displayed route.

Any invalid alternative rejects the entire research selection. Invalid
alternatives are never filtered into a partial success, never used as routed
geometry evidence, and never sent through GraphHopper a second time.

GraphHopper route provenance remains on `TrailRoute`. Research provenance is
kept only as the separate keyed sidecar.

## Lifecycle and concurrency

The research operation runs inside the existing `planningTask`.

- Existing `activeRequestID` checks protect every awaited result.
- Existing `TimeoutRace` bounds the coordinator call and accepts one terminal
  result.
- Existing task cancellation covers cancel, edit, reset, retry, and a newer
  prompt.
- A cancellation-ignoring late coordinator result cannot start fallback or
  replace newer state.
- Retry reuses the existing `PreparedAttempt`, including its explicit selected
  location.
- Research clarification context is deliberately excluded from
  `PreparedAttempt`. Answering, editing, retrying, resetting, or starting a
  newer attempt cannot carry a stale clarification context forward.
- There is one shared legacy-routing block, so research fallback cannot route
  twice.

The coordinator result is carried through the timeout using the same narrow
`@unchecked Sendable` envelope pattern already used for `RoutingResult`.
Research contract types were not changed merely to satisfy this implementation
detail.

## User-interface scope

No SwiftUI view, route card, route detail, Home layout, filter, or chat surface
changes are part of V1.

The only possible new user-facing copy is:

- the bounded partial notice;
- the bounded standard-route fallback notice;
- an existing safe routing notice shown after the fallback notice when both
  apply;
- the existing location clarification or recoverable edit-request copy.

Typed gap codes and backend details remain internal.

## Verification scope

Deterministic coverage includes:

- full request/success feature-off parity for all shipping route shapes;
- existing location clarification, retry, and cancellation;
- adapter ready, clarification, and unsupported states;
- all five coordinator result states;
- all six coordinator failures;
- adapter/coordinator clarification origin, typed gap, and bounded-question
  preservation in pending and recoverable states;
- absence of raw gap codes in clarification and recovery copy;
- stale-context isolation across answer, edit, retry, and reset;
- the nil, single-notice, two-notice, and exact-duplicate notice matrix,
  including feature-off byte equivalence;
- raw-prompt and provider-metadata boundary checks;
- research provenance and waypoint association;
- routed and non-routed request/normalized-intent binding plus coherent
  partial-state rules;
- empty, duplicate-ID, eligibility-rejected, unverified,
  activity-mismatched, route-type-mismatched, and research-provenance-
  mismatched output;
- actual timeout fallback, late timeout completion, cancellation-ignoring
  completion, stale attempts, retry, edit, and reset;
- bounded privacy behavior for unexpected provider errors;
- missing, false, malformed, and explicitly true feature-flag configuration;
- built Debug and Release feature-flag values.

No live backend, GraphHopper, or AI evaluation is required for this
integration.

## Remaining limitations

- Research-guided planning supports only V1 hiking and trail-running loops.
- The current clarification UI can safely represent only location/start
  clarification from the research contract.
- Research planning and clarification contexts are internal and are not yet
  presented in route-detail UI.
- A research timeout followed by standard routing can consume a second bounded
  routing interval.
- Release remains disabled until staging proof covers PostGIS evidence,
  imported Harz/Innsbruck data, App Attest, and real GraphHopper routing.
