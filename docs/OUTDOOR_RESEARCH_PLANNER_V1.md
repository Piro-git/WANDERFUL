# TrailMind Deterministic Outdoor Research Planner V1

## Status and purpose

The Outdoor Research Planner V1 is a pure, deterministic planning layer between a validated `AdventureResearchIntentV1` and future approved evidence repositories.

```text
AdventureResearchIntentV1
        ↓
planOutdoorResearchV1
        ↓
canonical normalized intent + ResearchPlanV1 operations + bounded planning gaps
        ↓
future approved repositories/adapters
        ↓
EvidenceClaimV1 and AdventureResearchDossierV1
```

The planner decides which evidence must be researched. It does not retrieve evidence, call a provider or model, query a database, calculate a route, rank candidates, or create a claim.

The implementation is:

- `backend/src/outdoorResearch/researchPlanner.js`
- `backend/src/outdoorResearch/researchPlannerPolicy.js`

The evaluation corpus and focused tests are:

- `backend/test/fixtures/outdoorResearchPlannerV1.json`
- `backend/test/outdoorResearchPlanner.test.js`

## Public API

```js
planOutdoorResearchV1(intent, capabilities)
```

The planner first validates `intent` with `validateAdventureResearchIntentV1`, then canonicalizes semantically unordered arrays and validates the result again. Every ready plan is validated with `validateResearchPlanV1` before it is returned. The canonical `normalizedIntent` remains available to the future executor so geography, activity, date/season, counts, overnight requirements, constraints, and facilities are not lost at the planning boundary.

The result is deeply immutable and has one of three states.

### `ready`

```js
{
  state: "ready",
  normalizedIntent: AdventureResearchIntentV1,
  plan: ResearchPlanV1,
  planningGaps: PlanningGapV1[]
}
```

`ready` means at least one valid research operation can be executed. For hiking and trail running it additionally requires an executable foundational `retrieve_mapped_hiking_routes` operation containing `mapped_hiking_route_membership` and at least one accepted mapped-network source. It does not mean every requested dimension can be researched, and it never means a fact or route is verified. Any unsupported or unavailable dimensions remain explicit in `planningGaps`.

### `clarification_required`

```js
{
  state: "clarification_required",
  normalizedIntent: AdventureResearchIntentV1,
  plan: null,
  clarificationQuestions: [
    { code: "location_required", field: "geographicAnchor" }
  ],
  planningGaps: []
}
```

An unresolved geographic anchor always produces this state. The planner creates no repository operations, guesses no region, and preserves the complete validated intent together with the clarification codes and fields that passed the intent validator.

### `unsupported`

```js
{
  state: "unsupported",
  normalizedIntent: AdventureResearchIntentV1,
  plan: null,
  planningGaps: PlanningGapV1[]
}
```

This state is returned when the resolved region is outside configured coverage, capability filtering leaves no executable operation, or a hiking/trail-running request lacks its foundational mapped-network operation, predicate, or accepted source.

Invalid intent, malformed capabilities, or an invalid internally generated plan throw `OutdoorResearchPlannerError` with one bounded code and fixed message:

| Code | Meaning |
| --- | --- |
| `invalid_intent` | `AdventureResearchIntentV1` validation failed. |
| `invalid_capabilities` | The capability allowlist, values, bounds, or serialized size are invalid. |
| `invalid_generated_plan` | The internal result did not satisfy the checked-in plan contract or bound. |

The error never includes a raw prompt, provider error, arbitrary field value, URL, SQL, shell command, or validation path.

## Capability boundary

Capabilities are supplied explicitly to the pure planner. The planner does not read environment variables, network state, credentials, release flags, provider configuration, or database state.

All fields are optional. A missing field means that capability is unavailable.

```js
{
  supportedRegionIds: UUID[],
  availableSourceCategories: SourceCategory[],
  supportedEvidencePredicates: EvidencePredicate[],
  enabledOperationTypes: ResearchOperationType[]
}
```

Rules:

- unknown fields are rejected;
- arrays are bounded and duplicate-free;
- region IDs must be UUIDs;
- all other values must use the existing contract vocabularies;
- values are sorted into canonical contract order;
- no provider URL, credential, source parameter, or arbitrary metadata is accepted;
- source, predicate, and operation availability is intersected with every proposed operation;
- unavailable capabilities become deterministic planning gaps;
- capability filtering may remove an unavailable predicate, but never broadens source authority;
- a high-stakes operation can never survive with mapped, community, derived, partner, or model sources.
- hiking and trail-running readiness requires the enabled `retrieve_mapped_hiking_routes` operation, the `mapped_hiking_route_membership` predicate, and `openstreetmap_open_mapping`;
- missing any part of that foundation returns `unsupported` with the corresponding bounded capability gap instead of returning an access-only plan.

`supportedRegionIds` is the only V1 coverage key. A resolved anchor with a null region ID cannot be matched safely and is treated as unsupported. The planner does not infer coverage from a name or coordinate.

## Deterministic rule table

| Intent signal | Research behavior | Trust boundary or gap |
| --- | --- | --- |
| Resolved hiking or trail-running intent | Retrieve mapped hiking routes and trail segments; inspect access and closure evidence separately. | OSM remains mapped. Access and closure use official authority/operator categories only. |
| Biking | Plan only independently supported research explicitly triggered by the request, such as requested POIs, facilities, or terrain constraints. A bare biking request has no executable operation and is `unsupported`. | Always report `biking_network_not_modeled`. Never emit `hiking_route`, `trail_segment`, or `mapped_hiking_route_membership` for biking. |
| Must-have mapped experience | Discover a mapped candidate and add its entity category to official access verification. | Must-haves receive stronger access research than preferences. |
| Preferred mapped experience | Discover a mapped candidate. | A preference does not by itself trigger candidate-specific access verification. |
| Viewpoint | Discover `viewpoint` using `entity_category` and `viewpoint_presence`. | Mapped presence does not verify view quality, visibility, access, or current openness. |
| Waterfall | Discover `waterfall` using `entity_category` and `waterfall_presence`. | No current flow is inferred from mapped existence, season, weather, or photographs. |
| Peak, lake, landmark | Discover the corresponding mapped entity category. | No scenic, safety, access, or current-condition claim is created. |
| Alpine or wilderness hut experience | Discover a mapped hut entity. | Existence alone does not imply opening, booking, drinking water, access, or overnight permission. |
| Official hiking route | Request route membership only from official authority/operator categories. | The contract lacks a distinct official-status predicate, so `unsupported_evidence_dimension` is also returned. OSM is never upgraded. |
| Forest or quiet trails | No substitute predicate is used. | `unsupported_evidence_dimension`. |
| Exposed trails | Analyze terrain and trail difficulty/visibility. | Exposure is not fully represented; `unsupported_evidence_dimension` records the limitation. |
| Technical terrain | Analyze terrain and research trail difficulty/visibility. | Difficulty evidence is planning input, never a safety guarantee. |
| Steep climbs or maximum elevation gain | Analyze terrain. | No invented elevation predicate is added; the operation may have an empty predicate list because `ResearchPlanV1` permits it. |
| Maximum technical difficulty | Analyze terrain and research `trail_difficulty`/`trail_visibility`. | Classification remains evidence, not suitability or safety. |
| Major roads, repeated path, crowds, unpaved surface | No unrelated predicate is substituted. | `unsupported_evidence_dimension`. |
| Beginner, children, limited mobility | Add stricter terrain/difficulty research. | Suitability is not modeled; a bounded `unsupported_evidence_dimension` gap is returned. |
| Lunch hut | Discover hut candidates, then separately research official opening/season/bookability and access. | A mapped hut is never treated as an open lunch stop. |
| Emergency shelter | Discover mapped shelter candidates and verify access for a must-have facility. | Mapped existence does not imply legal overnight use or current condition. |
| Drinking water | Research `drinking_water_availability` from official/operator categories. | Always return `water_availability_source_missing`; the accepted inventory has no source that meets the current-availability bar. |
| Official campsite or designated bivouac facility | Discover mapped candidates, then separately research overnight permission/access/closure using official sources. | Candidate discovery is not legal authorization. |
| Public transport or toilets | Do not invent predicates. | `transport_evidence_not_modeled` or `toilet_evidence_not_modeled`. |
| Overnight required | Discover allowed accommodation categories; research official legality, access, opening, season, bookability, and recent closure evidence in separate trust scopes. | Wild-camping permission is never inferred from OSM or a mapped campsite. |
| Exact date or season | Add official seasonal and recent-condition checks. | Absence of a closure is never interpreted as open. |
| Unknown date | Do not add generic seasonal/recent checks unless an overnight requirement independently needs them. | Avoids pretending that a current check is relevant without temporal context. |

## Operations and ordering

The planner uses only the existing `ResearchPlanV1` operation types.

Canonical ordering is:

1. `discover_highlights`
2. `retrieve_mapped_hiking_routes`
3. `analyze_terrain`
4. `inspect_access_evidence`
5. `check_current_status`
6. `research_overnight_options`
7. `check_seasonal_evidence`
8. `check_recent_conditions`

Within one operation type, operations are ordered by:

1. information-need vocabulary order;
2. reason-code vocabulary order;
3. canonical source, entity, and predicate arrays.

Operation IDs are assigned only after sorting:

```text
op_01_discover_highlights
op_02_retrieve_mapped_hiking_routes
op_03_analyze_terrain
```

There are no random UUIDs, clocks, timestamps, hashes of arbitrary input, environment values, or unordered object iterations in IDs or ordering.

## Merging and bounds

Compatible proposals merge only when all of these match:

- operation type;
- information need;
- reason code;
- acceptable source-category scope.

Entity categories and predicates are then unioned and sorted in checked-in contract order.

Different reasons remain separate so the plan does not hide why research is required. Mapped discovery and official verification remain separate because their source arrays differ. This prevents merging from broadening authority or turning an official-only check into a mapped-source request.

The generated plan is rejected internally if it exceeds the contract maximum of 24 operations. Every plan is also checked against the 64 KiB `ResearchPlanV1` serialized ceiling by the existing validator.

## Trust and high-stakes safeguards

The high-stakes predicates are:

- `public_access`
- `access_restriction`
- `current_opening`
- `seasonal_opening`
- `overnight_permission`
- `bookability`
- `drinking_water_availability`
- `closure_status`

For these predicates:

- proposed sources are restricted to `official_authority` and `official_operator`;
- capability filtering may narrow that official set but cannot add another category;
- a surviving operation is checked again before plan validation;
- mapped, community, derived, partner, or model sources can never independently verify the predicate;
- missing or stale evidence will remain unresolved for the future resolver;
- the plan asks for research and does not assert a positive or negative result.

Additional invariants:

- OSM route relations remain mapped hiking relations, not official routes.
- A mapped viewpoint does not verify scenic quality.
- A mapped waterfall does not verify current flow.
- A mapped hut does not verify opening, bookability, water, or overnight permission.
- A mapped campsite or bivouac does not verify legal authorization.
- Missing closure evidence does not mean open.
- No generic safety predicate or safety guarantee exists.
- Difficulty does not imply suitability for children, beginners, limited mobility, or medical needs.

## Planning-gap contract

Planning gaps are internal immutable values:

```js
{
  code: PlanningGapCode,
  affectedField: AffectedIntentField,
  affectedValue: string | null,
  reason: PlanningGapReason,
  requiresClarification: boolean,
  requiresCapability: boolean
}
```

Every enum is checked against a bounded policy vocabulary. `affectedValue` is either null or a string of at most 80 characters. It never contains a prompt, arbitrary message, URL, SQL, shell command, provider response, or geometry.

| Gap code | Meaning |
| --- | --- |
| `unsupported_region` | The resolved region ID is absent or outside configured coverage. |
| `unsupported_evidence_dimension` | The current contracts/predicates cannot faithfully represent the requested evidence dimension. |
| `official_source_unavailable` | An official authority/operator source category required for legal/access verification is unavailable. |
| `current_source_unavailable` | A current authority/operator source category required for opening/season/recent status is unavailable. |
| `mapped_source_unavailable` | No configured mapped source can perform candidate or hiking-network discovery. |
| `derived_source_unavailable` | No configured terrain-analysis source can perform the proposed operation. |
| `operation_type_unavailable` | The required existing operation type is not enabled. |
| `predicate_unavailable` | A required existing predicate is not supported by the configured executor. |
| `transport_evidence_not_modeled` | The V1 plan predicate vocabulary cannot express public-transport research. |
| `biking_network_not_modeled` | V1 has no biking-network retrieval operation. |
| `toilet_evidence_not_modeled` | The V1 plan predicate vocabulary cannot express toilet evidence. |
| `scenic_quality_not_verifiable` | Reserved for a future validated intent dimension that explicitly requests factual scenic quality; V1 does not infer it from viewpoint requests. |
| `water_availability_source_missing` | No accepted inventory source can guarantee current drinking-water availability. |

The fixed reason vocabulary is:

- `coverage_not_configured`
- `contract_dimension_missing`
- `accepted_source_not_available`
- `operation_not_enabled`
- `predicate_not_supported`
- `authority_not_available`
- `current_evidence_not_available`
- `clarification_needed`

## Capability examples

### Complete test capability surface

Tests can enable every checked-in operation, predicate, and source category to prove the full policy graph. This does not mean those providers are licensed or live in production.

### Current pilot-style capability surface

A conservative pilot capability object might expose only reviewed mapped and derived categories:

```js
{
  supportedRegionIds: ["33333333-3333-4333-8333-333333333333"],
  availableSourceCategories: [
    "openstreetmap_open_mapping",
    "derived_computation"
  ],
  supportedEvidencePredicates: [
    "entity_category",
    "trail_difficulty",
    "trail_visibility",
    "viewpoint_presence",
    "waterfall_presence",
    "mapped_hiking_route_membership"
  ],
  enabledOperationTypes: [
    "discover_highlights",
    "retrieve_mapped_hiking_routes",
    "analyze_terrain"
  ]
}
```

For a normal hiking request, this may still produce mapped-network research, while access/current/legal work appears as gaps. The planner does not pretend official evidence exists.

## Examples

### Resolved hiking request

For a resolved hiking loop with a must-have viewpoint, the planner normally produces:

- mapped viewpoint discovery;
- mapped hiking-network retrieval;
- official access/restriction/closure verification for the viewpoint and trail network.

The viewpoint operation uses mapped sources and presence predicates. The access operation is separate and official-only.

### Unresolved anchor

For:

```js
{
  geographicAnchor: {
    state: "unresolved",
    requirementCode: "location_required"
  }
}
```

the planner returns `clarification_required`, preserves the validated location question, and creates no operations.

### Biking

For a bare biking intent, the planner returns `unsupported` with `biking_network_not_modeled` and no plan. A biking intent with independently supported research, such as a requested viewpoint, may be `ready`, but none of its operations may emit hiking-route or trail-segment entities or `mapped_hiking_route_membership`.

### Lunch hut

A lunch-hut requirement produces three independent concerns:

1. mapped hut discovery;
2. official current opening/season/bookability research;
3. official access/restriction/closure research.

Failure to find current official capability becomes a gap; mapped discovery never fills it.

## Evaluation corpus

`outdoorResearchPlannerV1.json` contains 65 structured cases. It covers:

- hiking loop, point-to-point, out-and-back, and trail running;
- bare biking failure, biking-network limitation, and independent biking research without hiking semantics;
- viewpoint, waterfall, peak, lake, landmark, and hut requests;
- forest, quiet-trail, scenic-trust, official-route, and unsupported avoidance boundaries;
- beginner, experienced, children, and limited-mobility groups;
- exposed, technical, steep, difficulty, and elevation constraints;
- lunch hut, emergency shelter, drinking water, toilets, and public transport;
- one-night and multi-night trips, official campsites, and designated bivouacs;
- summer, winter, exact date, and unknown date;
- unresolved, broad, supported, and unsupported geography;
- missing official, current, mapped, predicate, and operation capabilities, including all three foundational hiking-network failures;
- overlapping requirements, maximum-size valid input, shuffled arrays, stable ordering, and duplicate prevention;
- invalid unknown-field and duplicate-value boundaries;
- official-only high-stakes source restrictions and no forbidden claim promotion.

Every non-invalid fixture intent passes `validateAdventureResearchIntentV1`. The invalid boundary cases remain contract-shaped objects and must fail with the fixed `invalid_intent` error.

## Future executor boundary

A future executor may consume only a validated `ready` result and must use its immutable `normalizedIntent` together with its validated `plan`. It must not reconstruct or infer lost request constraints from operations alone.

It must:

1. carry the complete `normalizedIntent` through execution and dossier assembly;
2. dispatch each typed operation to an approved bounded repository;
3. enforce the operation's acceptable source categories as an upper bound;
4. return only validated `EvidenceClaimV1` and `HighlightCandidateV1` values;
5. preserve source identity, authority scope, timestamps, freshness, and limitations;
6. use the existing deterministic evidence resolver for each entity/predicate cohort;
7. assemble a validated `AdventureResearchDossierV1`;
8. keep missing, conflicting, stale, or unavailable evidence unresolved.

The executor must not infer that an operation succeeded merely because it ran. “Research requested” and “claim verified” remain different states.

## Connection to the OSM Evidence Graph adapter

The separate OSM projection work can later satisfy mapped operations such as:

- `discover_highlights` for mapped entity categories and viewpoint/waterfall presence;
- `retrieve_mapped_hiking_routes` for mapped hiking-route membership and mapped difficulty/visibility evidence.

That future connection must:

- keep OSM evidence classed as mapped;
- use approved repository interfaces rather than provider parameters in the plan;
- preserve OSM identity/version/import provenance;
- return no positive access, opening, closure, overnight, water, official-route, scenic, or safety conclusion from mapped existence;
- leave official-only planner operations unresolved until approved authority/operator repositories exist.

The planner and adapter are not connected in V1, and no research executor or provider execution is live.

## Non-goals

V1 does not:

- call OpenAI or any other model;
- add an AI SDK;
- access the internet;
- query PostGIS, OSM, or another provider;
- calculate route geometry, distance, duration, or elevation;
- create evidence claims or dossiers;
- rank routes or highlights;
- score scenic quality;
- infer current waterfall flow;
- implement or configure an OSM adapter;
- add migrations;
- alter source permissions;
- add UI;
- modify iOS code;
- read secrets or environment variables;
- enable a release flag;
- stage, commit, push, or deploy anything.
