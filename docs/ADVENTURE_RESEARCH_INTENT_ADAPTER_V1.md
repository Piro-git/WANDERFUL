# TrailMind Adventure Research Intent Adapter V1

## Status and scope

`AdventureResearchIntentAdapterV1` is a pure, synchronous boundary between
TrailMind's already validated local planning intent and the existing
`AdventureResearchIntentV1` backend contract:

```text
ValidatedAdventureIntent + resolved LocationCandidate?
    -> AdventureResearchIntentAdapterV1
    -> AdventureResearchIntentV1 or a typed non-ready state
```

The adapter is not connected to `PlannerViewModel`,
`OutdoorAdventurePlanningCoordinatorV1`, UI, configuration, feature flags,
authorization, research, geocoding, or routing. It makes no network calls and
does not enable research-guided planning.

V1 supports hiking-first loop research only. The boundary is deliberately
fail-closed: it does not turn unsupported trips into loops, derive outdoor
facts, widen constraints, invent defaults, or inspect the raw prompt.

## API

```swift
protocol AdventureResearchIntentAdaptingV1: Sendable {
    func adapt(
        _ input: AdventureResearchIntentAdapterInputV1
    ) -> AdventureResearchIntentAdapterResultV1
}

struct AdventureResearchIntentAdapterInputV1: Sendable {
    let validatedIntent: ValidatedAdventureIntent
    let resolvedStart: LocationCandidate?
}

enum AdventureResearchIntentAdapterResultV1 {
    case ready(
        intent: AdventureResearchIntentV1,
        gaps: [AdventureResearchIntentAdapterGapV1]
    )
    case clarificationRequired(
        intent: AdventureResearchIntentV1,
        gaps: [AdventureResearchIntentAdapterGapV1]
    )
    case unsupported(
        gaps: [AdventureResearchIntentAdapterGapV1]
    )
}
```

The nonthrowing API maps all known invalid or out-of-contract input to a typed
`unsupported` result. An unexpected failure while constructing the existing
research contract also fails closed as `researchContractRejected`; it never
reflects input values in an error.

The result exposes read-only `state`, optional `intent`, `gaps`, and
`satisfiesStateInvariants` accessors.

## Result invariants

| State | Invariant |
| --- | --- |
| `ready` | Contains a valid research intent with a resolved anchor and no clarification questions. |
| `clarificationRequired` | Contains a valid unresolved research intent, a nonempty unique gap list, and exactly one `.locationRequired` / `.geographicAnchor` question. |
| `unsupported` | Contains no research intent and at least one unique typed gap. |

Every gap list is deterministic, unique, and bounded by the finite
`AdventureResearchIntentAdapterGapV1` vocabulary. Unsupported capability or
invalid numeric input takes precedence over location clarification.

## Exact mapping

| Local typed input | Research V1 output | Policy |
| --- | --- | --- |
| `ActivityType.hiking` | `.hiking` | Exact |
| `ActivityType.trailRunning` | `.trailRunning` | Exact |
| `ActivityType.biking` | `unsupported` | Downstream routing V1 does not support biking |
| `TrailRouteType.loop` | `.loop` | Exact |
| `TrailRouteType.pointToPoint` | `unsupported` | A separately validated destination anchor is unavailable |
| `TrailRouteType.multiDay` | `unsupported` | Never rewritten as a zero-night loop |
| Settlement, trailhead, or landmark candidate | Resolved geographic anchor | Uses `displayName` exactly, preserves latitude/longitude exactly, and sets `regionEntityID` to `nil` |
| Missing candidate | Unresolved `.locationRequired` anchor | Requires exact geographic-anchor clarification |
| Park, mountain range, or broad region | Unresolved `.locationRequired` anchor | Candidate centroid is never used |
| Unknown semantic kind | Unresolved `.locationRequired` anchor | A concrete resolved anchor is required |
| Explicit valid distance (`0.1...500` km) | Exact range where `min == max == targetDistanceKm` | No tolerance or default |
| Missing distance | `nil` | Never uses `RoutePlanningRequest` loop defaults |
| Invalid/out-of-range distance | `unsupported` | No clamping |
| Explicit valid duration (`15...10,080` minutes) | Exact range where `min == max == targetDurationMinutes` | No tolerance |
| Missing duration | `nil` | No inferred duration |
| Invalid/out-of-range duration | `unsupported` | No clamping |
| Difficulty `.easy` | Maximum technical difficulty `.hiking` | Conservative upper bound |
| Difficulty `.moderate` or `.challenging` | `nil` plus `technicalDifficultyNotEquivalent` | Product difficulty is not a SAC-style technical grade |
| Desired `.viewpoint` | Preferred `.viewpoint` | Preference, not a must-have |
| Desired `.forest` | Preferred `.forest` | Preference, not a verified fact |
| Desired `.quiet` | Preferred `.quietTrails` | Preference, not a verified fact |
| Desired `.water` | No mapped experience/facility plus `waterPreferenceAmbiguous` | Never becomes drinking water, lake, or waterfall |
| Desired `.sunset` | No mapped value plus `sunsetNotModeled` | No V1 equivalent |
| Avoid `.majorRoads` | `.majorRoads` | Exact |
| Avoid `.steepClimbs` | `.steepClimbs` | Exact |
| Avoid `.repeatedPath` | `.repeatedPath` | Exact |

Mapped preference and avoidance arrays preserve first-occurrence order and
remove later duplicates. `mustHaveExperiences` and `requiredFacilities` are
always empty.

## Neutral compatibility fields

The current typed local intent has no safe representation for several required
research-contract fields. V1 uses one documented neutral representation:

| Research field | Adapter value |
| --- | --- |
| `maximumElevationGainMeters` | `nil` |
| Group party size | `1` |
| Includes children / youngest age | `false` / `nil` |
| Group mobility / experience | `.unknown` / `.unknown` |
| `dateOrSeason` | `nil` |
| Overnight required / nights / accommodations | `false` / `0` / `[]` |
| Arrival mode | `.unknown` |
| Public transport required | `false` |
| Return to start | `true` for the supported loop |

Every intent-bearing `ready` or `clarificationRequired` output also carries
`groupContextUnavailable` and `arrivalContextUnavailable`. These gaps prevent
neutral compatibility values from being mistaken for verified user context.
An `unsupported` result contains no research intent and therefore carries only
its blocking adapter gaps.

The adapter never derives elevation, exposure, safety, trail visibility,
technical grade, child suitability, experience, season, public-transport
availability, accommodation, or facilities.

## Gap vocabulary

Blocking unsupported gaps:

- `activityNotSupported`
- `pointToPointDestinationNotRepresentable`
- `multiDayNotSupported`
- `resolvedAnchorCoordinatesInvalid`
- `resolvedAnchorNameInvalid`
- `distanceNotRepresentable`
- `durationNotRepresentable`
- `researchContractRejected`

Clarification gaps:

- `resolvedAnchorRequired`
- `broadRegionRequiresClarification`

Explicit information-loss or unavailable-context gaps:

- `technicalDifficultyNotEquivalent`
- `waterPreferenceAmbiguous`
- `sunsetNotModeled`
- `groupContextUnavailable`
- `arrivalContextUnavailable`

These are adapter-boundary gaps. They intentionally do not reuse
`OutdoorAdventurePlanningGapV1`, whose vocabulary describes downstream
research evidence and capability results.

## Privacy and trust boundary

The adapter reads only the explicit typed fields required for mapping. Although
`ValidatedAdventureIntent` stores additional data, the adapter never reads,
copies, serializes, logs, returns, or reflects:

- `rawPrompt`
- parser source or confidence
- start, destination, or region query text
- candidate ID
- provider identity or provider rank
- candidate locality, administrative region, or country metadata
- backend URL, authorization data, or API keys
- dossiers, route geometry, or elevation samples

`LocationCandidate.id` is never parsed as a UUID. No region UUID is hashed,
fabricated, or inferred. The provider's selected `displayName` is used without
trimming, sanitizing, or fallback; an invalid contract name fails closed.

The encoded output is therefore exactly the existing 17-field
`AdventureResearchIntentV1` manifest and contains no local parser or provider
metadata.

## Determinism and side effects

The adapter is stateless and synchronous. It does not depend on current date,
locale, random values, environment, feature flags, backend configuration, or
mutable global state. Equal inputs produce equal result values and equal
encoded research intents.

It does not call:

- `LocationResolutionService`
- `OutdoorAdventurePlanningCoordinatorV1`
- a backend client
- GraphHopper
- authorization or App Attest
- any network or routing API

## Known V1 limitations

- Only hiking and trail-running loops can become `ready`.
- Point-to-point intent remains unsupported until a separately validated
  destination anchor can cross the boundary.
- Multi-day and biking intent remain unsupported at this V1 seam.
- Water and sunset preferences have no lossless mapping.
- Moderate and challenging product difficulty do not map to technical terrain
  grades.
- Group, date/season, arrival, overnight, elevation, and accessibility context
  remain unavailable.
- `regionEntityID` remains `nil` until a separately trusted validated region
  UUID exists.

## Future integration boundary

A later, separately approved integration may pass a `ready` or
`clarificationRequired` intent to application orchestration. That integration
must remain behind the existing disabled research flag, handle all adapter
states exhaustively, and preserve the adapter's gaps. This V1 implementation
does not perform that integration.
