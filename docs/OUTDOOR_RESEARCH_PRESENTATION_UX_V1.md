# TrailMind Outdoor Research Presentation UX V1

## Status and scope

This presentation layer turns the existing, disabled-by-default research
planning sidecars into concise route-comparison and route-detail content.
It performs no research, networking, geocoding, routing, database access,
feature-flag decisions, or current-time evaluation.

The shipping standard-routing presentation remains unchanged when
`PlannerViewModel.PlanningSuccess.researchContext` is absent. A standard route
produced after research fallback keeps its existing merged notice and receives
only a small route-basis explanation in detail.

## User problems addressed

The V1 presentation helps a hiker understand:

- whether an option was research-guided or built by standard routing fallback;
- why the verified routed result fits the request;
- which selected research highlights were actually confirmed on the routed
  path;
- which facts came from route statistics versus researched place evidence;
- which requested preferences remain unverified;
- what should be checked before starting;
- why TrailMind needs a more precise location during research clarification.

The UI intentionally avoids AI decoration, internal audit language, provider
mechanics, scores, and persuasive claims unsupported by the validated data.

## Information hierarchy

### Route suggestions

1. Existing route map preview and comparison label.
2. Existing title, distance, duration, climb, activity, and effort estimate.
3. A subtle `Researched route` status only for a verified route with a keyed
   research sidecar.
4. At most three bounded research facts:
   - count of confirmed on-route highlights;
   - conservative highlight categories;
   - partial-coverage disclosure.
5. Existing route-quality evidence.

Standard fallback cards do not receive a research badge or research facts.
The existing merged fallback notice remains the primary explanation.

### Route detail

1. Existing map, route title, verified route statistics, and route actions.
2. Compact route-basis summary.
3. Existing `Planned for you` requested-preference chips.
4. Ranked `Why this route fits` reasons.
5. Confirmed on-route research highlights.
6. Existing route-quality evidence and mapped route characteristics.
7. Research limitations, initially bounded to three with `Show all`.
8. Existing outdoor safety and planning guidance.

This order keeps requested preferences visibly separate from verified route
and research facts.

## Presentation truth table

| Data | Classification | Can display as fact? | User wording | Missing behavior |
| --- | --- | --- | --- | --- |
| `TrailRoute` distance, duration, climb, route type, activity | Verified route fact, only when route verification passes | Yes | “Actual 14.8 km versus requested 15 km.” | Omit the reason |
| Unique lowest climb/duration among displayed verified routes | Verified comparative route fact | Yes | “Lowest climb of the available options.” | Omit |
| `ResearchWaypointVisitV1.isResearchWaypointReached` joined to the selected entity | Verified route/evidence association | Yes, for conservative category only | “Mapped viewpoint on this routed path.” | Do not show a highlight |
| Selected waypoint without a reached visit | Limitation | No positive claim | “One requested highlight could not be confirmed on the routed path.” | Omit if no selected waypoint exists |
| Selected waypoint role `mustHave` plus reached visit | Verified request/evidence association | Yes | “Includes a requested must-have highlight.” | Omit |
| Selected waypoint category | Evidence-backed category | Yes, conservatively | “Viewpoint”, “waterfall”, “alpine hut” | Omit |
| Selected waypoint/entity name | Not present in the current iOS sidecar | No | No named visit claim | Omit and document the boundary |
| `knownLimitations`, recognized remaining limitations, and typed planning gaps | Limitation or missing information | Yes, as missing/uncertain information | “Official access information wasn’t available.” | Omit unknown codes |
| Unresolved high-stakes `requiredVerification` values | Limitation or missing information | Yes, as an explicit check, never as a positive claim | “Current closure information wasn’t verified.” | Omit routing/statistic checks already satisfied by the verified route |
| Adapter desired features / route planning desired features | Requested preference | Not as an achieved experience | Existing `Requested:` chips | Omit when missing |
| Research outer outcome | Validated result state | Yes | “Researched route”, “Research coverage: partial”, or “Standard routed option” | No research treatment |
| Clarification code and field | Validated missing-information state | Yes, through fixed copy | “How long should the route be?” | Omit unknown/unrepresentable questions |
| Rejection-count keys and counts | Internal technical metadata | No | None | Always omit |
| Attempt, proposal, route-result, evidence, entity, and lineage IDs | Internal technical metadata | No | None | Always omit |
| Candidate strategy and policy version | Internal technical metadata | No | None | Always omit |
| Exact research coordinates | Internal routing/evidence data | No | None | Always omit |
| Provider/source implementation names, errors, URLs, hashes, scores | Internal technical metadata | No | None | Always omit |
| Freshness date or “last verified” | Not present as validated presentation data | No | None | Omit |

## Requested versus verified behavior

- Existing planning chips continue to disclose requested preferences.
- A requested view, forest, quiet route, water feature, or sunset preference
  never creates a research highlight or route-fit reason by itself.
- A selected research candidate never becomes a visited highlight without a
  matching via-point visit inside the existing tolerance contract.
- A visit for an entity not present in the selected-waypoint provenance is
  ignored.
- Unreached selected waypoints become limitations, not highlights.
- No category or evidence presence becomes a scenic, safe, accessible, open,
  legal, child-friendly, beginner-friendly, or water-availability claim.
- Invalid, demo, legacy-unverified, or fingerprint-invalid routes never receive
  a successful research presentation.

## Result states

### Complete research-guided

- Verified routed result.
- Route-keyed research sidecar is present.
- `Researched route` badge.
- Confirmed on-route highlights and ranked fit reasons.
- `Research coverage: complete` only when the projection has no displayable
  limitation.

### Partial research-guided

- Verified routed result remains selectable.
- Same calm research treatment.
- `Some preferences unverified` appears on the route card.
- Limitations remain visible in detail without red error styling.
- Evidence summary says `Research coverage: partial`.

### Standard routed fallback

- No research badge and no research facts on route cards.
- Existing merged planning notice explains that research matching was
  unavailable.
- Detail states that the option is a real routed result while requested
  experiences were not verified against researched places.

### Standard route

- When research context is absent, existing cards and detail are unchanged.

### Clarification and recovery

- The existing primary question, answer field, edit, retry, cancel, and reset
  behavior remains authoritative.
- A compact research-context panel explains why the detail matters.
- Multiple typed questions are mapped to fixed human copy, deduplicated, and
  bounded to four.
- No unsupported structured-answer mechanics are added.
- Typed codes are never interpolated into user copy.

### Unsupported shapes

- Biking, point-to-point, and other unsupported research shapes retain the
  existing documented standard behavior.
- An adapter-unsupported fallback has no research badge.

## Component architecture

### Pure presentation projection

`ResearchPresentationProjector` converts existing validated values into:

- `ResearchRoutePresentation`
- `ResearchRouteBadge`
- `ResearchRouteCardFact`
- `ResearchFitReason`
- `ResearchHighlightPresentation`
- `ResearchLimitationPresentation`
- `ResearchEvidenceSummary`
- `ResearchClarificationPresentation`
- `ResearchResultKind`

The projection is deterministic and contains no I/O, clock, environment,
feature-flag, parsing, or provider decisions. Collection bounds are:

| Collection | Bound |
| --- | ---: |
| Card research facts | 3 |
| Route-fit reasons | 5 |
| On-route highlights | 6 |
| Retained limitations | 12 |
| Initially visible limitations | 3 |
| Clarification questions | 4 |

### SwiftUI components

- `ResearchRouteCardSummaryView`
- `WhyThisRouteFitsView`
- `VerifiedResearchHighlightsView`
- `RouteResearchLimitationsView`
- `RouteResearchEvidenceSummaryView`
- `ResearchClarificationContextView`

Existing `RouteCard`, `RouteSuggestionsView`, `RouteDetailView`,
`PlanningClarificationView`, and `PlanningRecoveryView` accept optional
presentation content. No research context means their standard presentation
path remains unchanged.

## Accessibility and native behavior

- All content uses Dynamic Type fonts and vertically flexible text.
- Important content is not placed in a horizontal-only scroller.
- Every status row has a spoken text label; color and symbols are supplemental.
- Section headings expose header traits.
- Limitation disclosure has a minimum 44-point target and explicit expanded or
  collapsed accessibility value.
- Research surfaces have stable accessibility identifiers.
- The UI uses existing TrailMind spacing, cards, theme colors, and SF Symbols.
- No animation loop was added; existing Reduce Motion behavior is unchanged.
- English copy is allowed to wrap naturally, and fixture coverage includes long
  German text at accessibility sizes.

## Fixture strategy

Pure projection tests and debug-only previews cover:

1. Complete Harz loop with confirmed viewpoint and waterfall visits.
2. Partial Harz loop with one confirmed highlight, missing access/current
   conditions, and one unconnected highlight.
3. Innsbruck viewpoint route with conservative mapped, exposure, and technical
   trail-difficulty limitations.
4. Standard routed fallback.
5. Broad-region research clarification.
6. Unsupported research shape using standard fallback behavior.
7. More limitations than the initial disclosure bound.
8. Missing optional research context and missing sidecar.
9. Long content at accessibility Dynamic Type.
10. Invalid/unverified route rejection.

Debug Simulator launch scenarios are:

- `research-complete`
- `research-partial`
- `research-fallback`
- `research-clarification`

They use in-memory deterministic routes and research sidecars. They do not call
the backend, GraphHopper, PostGIS, AI, geocoding providers, or external content.

## Known limitations

1. `ResearchSelectedWaypointV1` and `ResearchWaypointVisitV1` do not carry a
   validated human-readable place name. V1 can say `Viewpoint on this routed
   path`, but it cannot truthfully say `Visits Brocken`. The narrow future
   contract addition is a bounded, validated display name on the selected
   waypoint or a route-keyed presentation-safe entity summary.
2. The sidecar does not expose a validated coarse freshness state or
   presentation-safe verification date. V1 therefore never shows `Last
   verified`.
3. Research provenance preserves pre-routing limitation codes such as route
   connection uncertainty even after real routing. V1 describes those narrowly
   as mapped-network context rather than contradicting a confirmed waypoint
   visit.
4. Required-versus-preferred experiences are available for selected
   waypoints, but the current local intent adapter maps ordinary desired
   features as preferences. V1 does not upgrade them to must-haves.
5. The app-wide theme predates this work; V1 reuses it rather than introducing
   an isolated research color system.

## Screenshot and visual-QA record

The existing route-suggestion and route-detail UI was inspected on the
preferred iPhone 17 Pro Simulator before implementation. Post-change fixture
screenshots were not produced in this verification pass because the explicit
shared-resource gate remained closed: free disk stayed at 5.9 GiB, below the
required 8 GiB minimum. No screenshot is presented as post-change evidence.

When the gate is available, the remaining visual pass must cover the complete,
partial, fallback, and clarification fixtures in light and dark appearance,
Accessibility XXXL text, and a smaller available iPhone. Only deterministic
fixture states without credentials, private coordinates, or live external
content are eligible.

## Future integration boundary

Future data work may add only presentation-safe, validated fields such as:

- selected waypoint display name;
- coarse evidence class per selected waypoint;
- validated coarse freshness state;
- a typed resolved limitation set after real routing.

Those fields should remain route-keyed, bounded, and separate from route
geometry. The presentation projection should continue to receive validated
values and must not query providers, inspect raw evidence, or reinterpret
feature flags.
