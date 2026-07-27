# TrailMind Outdoor Adventure Planning Coordinator V1

## Status and scope

`OutdoorAdventurePlanningCoordinatorV1` is the iOS architectural seam between
an already constructed, validated `AdventureResearchIntentV1` and the existing
`OutdoorAdventurePlanningClientV1`.

It is not connected to `PlannerViewModel`, Home, Planning, Route Suggestions,
Route Detail, or any other shipping flow. It does not parse or map the current
`AdventureIntent`, perform research, call GraphHopper directly, or change UI.

The coordinator's default client comes from
`OutdoorAdventurePlanningClientFactory.makeDefault()`. The existing
`RESEARCH_GUIDED_PLANNING_ENABLED` gate therefore remains authoritative and
disabled by default. No flag or Release configuration is enabled by this seam.

## API

```swift
protocol OutdoorAdventurePlanningCoordinatingV1: Sendable {
    func plan(
        intent: AdventureResearchIntentV1
    ) async throws -> OutdoorAdventurePlanningCoordinatorResultV1
}

struct OutdoorAdventurePlanningCoordinatorV1:
    OutdoorAdventurePlanningCoordinatingV1,
    Sendable
```

Production construction uses the existing client factory:

```swift
let coordinator = OutdoorAdventurePlanningCoordinatorV1()
```

Tests and a future composition root can inject any
`OutdoorAdventurePlanningClientV1`:

```swift
let coordinator = OutdoorAdventurePlanningCoordinatorV1(client: client)
```

Calling `plan(intent:)` creates only
`OutdoorAdventurePlanningRequestV1(intent:)` and delegates once to the client.
The coordinator does not accept raw prompts, current `AdventureIntent` values,
provider settings, evidence, route geometry, or policy overrides.

## Result preservation

`OutdoorAdventurePlanningCoordinatorResultV1` is exhaustive over the existing
five client states:

| Coordinator case | Existing typed payload |
| --- | --- |
| `clarificationRequired` | `OutdoorAdventurePlanningNonRoutedStateV1` |
| `unsupported` | `OutdoorAdventurePlanningNonRoutedStateV1` |
| `noViableRoute` | `OutdoorAdventurePlanningNonRoutedStateV1` |
| `partial` | `OutdoorAdventurePlanningRoutedStateV1` |
| `routed` | `OutdoorAdventurePlanningRoutedStateV1` |

After narrow application-boundary checks, the coordinator carries the original
payload value into the matching case. It does not flatten, reinterpret, filter,
rank, or alter the payload. Consequently it preserves:

- the backend-normalized `AdventureResearchIntentV1`, even when it differs
  from the submitted intent;
- every typed planning gap and clarification question;
- the complete `ResearchGuidedRouteSelectionV1`;
- selected alternative and waypoint identities;
- research lineage, evidence claim IDs, required verification, and known
  limitations;
- route-selection rejection counts and remaining limitations;
- verified `TrailRoute` values produced by the existing adapter and quality
  selection boundary.

Uniform read-only accessors expose `state`, `normalizedIntent`,
`planningGaps`, `clarificationQuestions`, and optional `routeSelection`
without erasing the exhaustive enum cases.

### Application-boundary invariants

An injected or future client can construct typed Swift payloads without going
through the production response decoder. The coordinator therefore enforces
only the invariants needed before application code can consume a state:

- each payload's embedded state matches its result case;
- `clarificationRequired` has nonempty questions exactly equal to the
  normalized intent's unresolved questions;
- `unsupported` and `noViableRoute` have no clarification questions;
- `partial` and `routed` have at least one alternative, and every alternative
  contains a verified routed result;
- `routed` has no planning gaps.

Non-routed cases cannot carry route data because their existing payload type
has no route-selection field. Any invalid combination fails closed as
`OutdoorAdventurePlanningCoordinatorFailureV1.invalidResult`.

The backend-normalized intent remains authoritative. The coordinator does not
compare it with, replace it from, or merge it into the submitted intent.

Deep response validation, JSON bounds, route conversion, GraphHopper
verification, provenance validation, ranking, and `RouteAlternativeQuality`
remain owned by the existing client and
`ResearchGuidedRoutingContractAdapterV1`. The coordinator does not duplicate
those implementations.

## Errors and cancellation

Application code receives the smaller
`OutdoorAdventurePlanningCoordinatorFailureV1` vocabulary:

- `unavailable`
- `authorizationFailed`
- `rateLimited`
- `timedOut`
- `rejected`
- `invalidResult`

Every case has a fixed, bounded, non-sensitive description. Transport details
do not cross the coordinator boundary.

| Client failure | Coordinator failure |
| --- | --- |
| `invalidRequest` | `rejected` |
| `requestTooLarge` | `rejected` |
| `rejected` | `rejected` |
| `unavailable` | `unavailable` |
| `authorizationFailed` | `authorizationFailed` |
| `rateLimited` | `rateLimited` |
| `timedOut` | `timedOut` |
| `invalidResponse` | `invalidResult` |
| `responseTooLarge` | `invalidResult` |
| unexpected error | `unavailable` |

`CancellationError` remains cancellation rather than becoming a planning
error. Cancellation is checked before delegation and again before returning a
result, preventing a late client result from winning after the caller cancels.

## Disabled behavior

When the existing factory returns
`NoOpOutdoorAdventurePlanningClientV1`, the coordinator receives and preserves
its typed `unsupported` result. The no-op client performs no authorization,
network, research, or routing work.

The coordinator adds no alternate feature flag, fallback, retry, or direct
backend construction. Enabling the existing flag remains insufficient to put
this seam into the shipping experience because no shipping caller is added.

## Verification

`OutdoorAdventurePlanningCoordinatorTests` uses injected in-memory clients and
the existing validated research-guided route fixture. It makes no live backend
or GraphHopper calls.

Coverage includes:

- exact request construction and one client invocation;
- all five valid result states and embedded-state coherence;
- clarification presence and exact normalized-intent question equality;
- forbidden questions on unsupported and no-viable-route states;
- required verified alternatives for partial and routed states;
- the routed zero-gap invariant;
- backend-normalized intent authority;
- route selection, alternative identity, research provenance, waypoint visits,
  rejection counts, verified suggestions, and remaining limitations;
- factory/no-op disabled behavior with zero authorization and network work;
- deterministic mapping of every client failure;
- bounded descriptions and unexpected-error sanitization;
- cancellation preservation, including a late cancellation-ignoring client.

## Future integration boundary

A later, separately approved `PlannerViewModel` integration should depend on
`any OutdoorAdventurePlanningCoordinatingV1`, pass only a previously validated
`AdventureResearchIntentV1`, and exhaustively handle all five coordinator
cases. That work must retain the existing disabled-by-default gate and should
not market or display this path until rollout, privacy, live evaluation, and
product-safety requirements are complete.
