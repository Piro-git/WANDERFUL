# TrailMind Research-Guided Route Candidate Bridge V1

## Purpose

TrailMind began with a practical gap: a user could research a hike with
ChatGPT, but then had to rebuild the result manually in Komoot. The research
pipeline now has typed intent, evidence, highlights, mapped hiking relations,
and a validated `AdventureResearchDossierV1`. This bridge turns that dossier
into bounded route-construction briefs for a later real router.

```text
AdventureResearchDossierV1
        ↓
Research-Guided Route Candidate Bridge V1
        ↓
ResearchGuidedRouteCandidatePlanV1
        ↓
future GraphHopper candidate generation
        ↓
future HikingRouteQualityEngine evaluation
```

The bridge selects and orders only coordinates already present in validated
dossier highlights. It does not calculate a route. It does not claim that a
candidate is connected, reachable, on a trail, open, legal, safe, scenic, or
compatible with the requested distance. Those facts remain work for routing
and evidence evaluation.

The implementation is:

- `backend/src/routeResearch/researchGuidedRouteCandidatePlanner.js`
- `backend/src/routeResearch/contractSemantics.js`
- `backend/src/routeResearch/validation.js`
- `backend/src/routeResearch/policy.js`
- `backend/src/routeResearch/errors.js`
- `backend/src/routeResearch/index.js`

The executable contract corpus is:

- `backend/test/fixtures/researchGuidedRouteCandidateV1.json`
- `backend/test/researchGuidedRouteCandidatePlanner.test.js`
- `backend/test/researchGuidedRouteCandidateContract.test.js`

## Public API

```js
import {
  buildResearchGuidedRouteCandidatePlanV1,
  validateResearchGuidedRouteCandidatePlanV1,
  serializeResearchGuidedRouteCandidatePlanV1,
  RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V1
} from "./src/routeResearch/index.js";
```

### Builder

```js
buildResearchGuidedRouteCandidatePlanV1(dossier, options?)
```

The first boundary operation is
`validateAdventureResearchDossierV1(dossier)`. The bridge does not duplicate,
relax, or replace the checked-in dossier validator.

The only V1 option is:

```js
{ maximumProposals: 1...6 }
```

Options reject unknown fields, excessive bytes, non-integers, and values above
the immutable policy cap. Options cannot add a provider, source, network,
credential, scoring rule, or unbounded search behavior.

### Runtime validator

```js
validateResearchGuidedRouteCandidatePlanV1(plan)
```

The validator rejects unknown fields at every bridge-owned level, enforces all
enumerations and cross-field invariants, bounds strings, arrays, coordinates,
claim references, proposal counts, and serialized bytes, then deeply freezes
the validated result. It independently recomputes proposal IDs, proposal
verification unions, top-level requirement and verification aggregates, and
the only valid `ready`/`partial` state. A proposal ID that merely matches the
ID regular expression is not accepted unless its digest matches its emitted
content.

### Deterministic serializer

```js
serializeResearchGuidedRouteCandidatePlanV1(plan)
```

The serializer validates first, recursively orders object keys, and emits
bounded JSON. A plan produced from semantically equivalent dossier input is
byte-for-byte stable regardless of input object-key order, evidence-claim
insertion order, candidate insertion order, or the ordering of intent arrays
whose semantics are unordered.

## Output contract

The top-level internal contract is:

```js
{
  schemaVersion: 1,
  state:
    "ready" |
    "partial" |
    "insufficient_evidence" |
    "unsupported",
  normalizedIntent: AdventureResearchIntentV1,
  anchor: ResolvedOrUnresolvedGeographicAnchorV1,
  proposals: ResearchGuidedRouteProposalV1[],
  unmetRequirements: CandidateRequirementResultV1[],
  requiredVerification: VerificationCodeV1[],
  evidenceGaps: RouteCandidateEvidenceGapV1[],
  policyVersion: "research-guided-route-candidates-v1"
}
```

### States

`ready` means at least one bounded construction brief exists, all requested
must-have counts represented by the brief are satisfied, and no unresolved
high-stakes verification remains. It does not mean a real route exists.
Real routing, connectivity, distance, duration, and elevation verification are
still required.

`partial` means at least one brief can be attempted, but a requested count,
facility, group or terrain safeguard, evidence dimension, high-stakes fact, or
verification remains unresolved. It is also required when the declared dossier
freshness is not `current`, even if every selected proposal would otherwise
meet the proposal-level ready condition.

`insufficient_evidence` means no truthful coordinate-bearing waypoint proposal
can be assembled from the validated dossier. It never appears as an empty
`ready` plan.

`unsupported` means the activity, geography, or request boundary cannot be
represented by V1. V1 supports hiking and trail running. Biking is explicit
`unsupported`; it is not silently mapped onto hiking networks.

### Proposal

```js
{
  proposalId,
  strategy,
  activity,
  routeType,
  targetDistanceRangeKm,
  targetDurationRangeMinutes,
  maximumElevationGainMeters,
  maximumTechnicalDifficulty,
  viaCandidates,
  mappedNetworkCandidates,
  satisfiedRequirements,
  unsatisfiedRequirements,
  requiredVerification,
  preliminaryDistanceEnvelope,
  evidenceClaimIds,
  knownLimitations
}
```

`proposalId` is the first 128 bits of a SHA-256 digest over canonical:

- policy version;
- normalized intent;
- emitted waypoint entity IDs;
- emitted mapped-network entity IDs;
- selection strategy.

Waypoint and mapped-network IDs are separate identity fields. Candidates
discarded by an output cap or the proposal evidence-reference budget cannot
affect the ID.

It uses no UUID generator, clock, random value, process identifier, insertion
order, or locale-dependent comparison.

The construction strategy vocabulary is deliberately small:

- `must_have_first`
- `balanced_experiences`
- `minimal_preliminary_detour`
- `mapped_network_first`
- `overnight_candidate_first`

These names describe candidate construction, not route quality. The contract
does not use “best,” “recommended,” “scenic,” “safest,” “perfect,” or similar
persuasive labels.

## Must-have and preferred behavior

Must-have experiences are handled before preferences. Each count consumes one
distinct compatible entity. A candidate has one validated highlight category,
so one viewpoint cannot count twice and cannot also satisfy a waterfall count.

For:

```js
[
  { experience: "viewpoint", minimumCount: 2 },
  { experience: "waterfall", minimumCount: 1 }
]
```

the bridge needs three distinct coordinate-bearing candidates. If only one
viewpoint exists, the output preserves:

```js
{
  requirementType: "must_have_experience",
  value: "viewpoint",
  requestedCount: 2,
  availableCount: 1,
  includedCount: 1,
  shortfallCount: 1
}
```

The five-waypoint policy cap cannot silently weaken a larger request. If eight
viewpoints are available but only five fit the V1 waypoint budget, the plan
reports a shortfall of three and a `waypoint_budget_exceeded` gap.

Preferred experiences may influence ordering and fill remaining waypoint
capacity only after must-haves. An unsupported preference such as `forest` or
`quiet_trails` remains an unsatisfied preference; no viewpoint or mapped route
is substituted as proof.

## Waypoint eligibility

A `viaCandidate` contains:

```js
{
  entityId,
  coordinate: { latitude, longitude },
  highlightCategory,
  role:
    "must_have" |
    "preferred" |
    "facility_candidate" |
    "overnight_candidate",
  evidenceClaimIds,
  selectionReasons,
  knownLimitations,
  requiredVerification
}
```

Eligibility rules are fail-closed:

1. The dossier must pass `validateAdventureResearchDossierV1`.
2. The highlight needs a current, resolved category/presence claim compatible
   with its declared category.
3. `ineligible` highlights are excluded.
4. Known official access denial, prohibited access, or current closure excludes
   the entity.
5. Current official `restricted`, `conditional`, or `permit_required` access
   may retain the entity, but it adds `access_restriction_required`, remains
   unsatisfied as unrestricted access, and cannot produce `ready`.
6. Known trail difficulty above the requested maximum excludes the entity.
7. All evidence references used for category, compatibility, or high-stakes
   decisions remain exact dossier claim IDs belonging to that entity.
8. The exact dossier coordinate is copied without adjustment.

The bridge never geocodes a name, snaps a point, generates a coordinate,
borrows another entity's claim, or converts a route relation into a waypoint.

Unknown access is not public access. Unknown difficulty is not easy. Missing
exposure evidence is not “not exposed.” Missing visibility evidence is not
“well marked.” A current official `public_access: true` claim does not override
a current official restrictive access condition.

Known exclusions use typed bounded gaps:

- public denial or `prohibited` → `candidate_access_denied`;
- current `closed` → `candidate_currently_closed`;
- difficulty above the declared maximum → `incompatible_difficulty`.

Each gap carries only the entity ID and fixed evidence predicate; raw access,
closure, or difficulty values are never copied into the plan.

## Mapped hiking-route relations

`mappedNetworkCandidates` retain:

- canonical entity ID;
- dossier `sourceBasis`;
- exact evidence claim IDs;
- mapped-only and connection limitations;
- routing, access, closure, difficulty, and official-status verification.

They contain no coordinate or geometry. An OSM relation therefore remains a
mapped-network candidate. It is never relabeled official, connected, walkable,
or available. `sourceBasis: "official"` can only copy an already validated
dossier basis; even then V1 carries `official_status_required` because the
current evidence contract has no independent route-official-status predicate.

Known incompatible difficulty excludes a mapped network candidate and creates
an `incompatible_difficulty` gap. Missing network geometry or connectivity
never becomes a waypoint.

Mapped networks use the same access decision policy as waypoint candidates.
Public denial, prohibition, and current closure exclude them. Restricted,
conditional, or permit-required access may be retained only with explicit
verification and limitation codes.

## Preliminary distance envelope

The bridge calculates geometry-independent, pre-routing information only:

```js
{
  kind: "straight_line_lower_bound",
  lowerBoundKm,
  heuristicRangeKm: { min, max },
  targetRangeKm,
  feasibilityState:
    "not_ruled_out" |
    "lower_bound_exceeds_target" |
    "target_unspecified",
  limitationCode: "requires_real_routing"
}
```

The lower bound is the sum of Haversine distances through the deterministically
ordered selected coordinates. A loop and an out-and-back brief add the
straight-line return to the anchor. A point-to-point brief measures only the
known anchor/waypoint chain because `AdventureResearchDossierV1` has no
separate destination-coordinate field. It therefore carries
`endpoint_coordinate_required`, `endpoint_unavailable`, and an explicit
route-endpoint shortfall.

`heuristicRangeKm` is the lower bound multiplied by the immutable
`1.15...1.65` V1 heuristic range. It is a search-planning heuristic, not
predicted or actual route distance, and it is never used to claim target fit.

If `lowerBoundKm` already exceeds the requested maximum, the proposal is
explicitly `lower_bound_exceeds_target`, the distance target remains
unsatisfied, and the proposal is not presented as feasible. If it does not
exceed the maximum, `not_ruled_out` means only that straight-line geometry has
not disproved the attempt. GraphHopper must still establish connectivity and
real distance.

## Difficulty and group safeguards

The V1 difficulty order follows the existing intent contract from `strolling`
through `difficult_alpine_hiking`.

- A current known difficulty above the user's maximum excludes a highlight or
  mapped network candidate.
- Missing, stale, unavailable, or conflicting difficulty becomes
  `trail_difficulty_required`.
- Technical-terrain avoidance also carries trail-visibility verification.
- Exposed-terrain avoidance remains `exposure_required`.
- Steep-climb avoidance remains `steep_climb_required`.
- A maximum elevation gain is copied as a routing constraint and requires
  actual routed-elevation verification.
- Beginners, children, and limited-mobility groups receive explicit,
  independent suitability verification requirements.

No output says “easy trail,” “safe for beginners,” “suitable for children,” or
“accessible.” The current dossier does not contain enough route-wide evidence
to support those statements.

## Facility and overnight safeguards

A coordinate-bearing mapped hut may be selected as a facility or overnight
candidate. That selection does not satisfy a lunch-hut or overnight requirement
without appropriate current official evidence.

Lunch-hut satisfaction requires current official evidence for:

- opening;
- public access;
- non-closed status.

Overnight satisfaction requires distinct candidates for the requested night
count and current official evidence for:

- public access;
- current opening;
- overnight permission;
- bookability;
- seasonal operation;
- non-closed status.

Missing evidence remains:

- `opening_status_required`;
- `seasonal_operation_required`;
- `overnight_permission_required`;
- `booking_required`;
- `legal_sleep_required`.

A `booking_required` verification maps to
`bookability_unverified`. Executor-produced hut dossiers containing
`bookability_unverified` and `seasonal_status_unverified` are valid bridge
inputs; those limitations remain visible rather than being rejected or
promoted into verified availability.

A mapped campsite, bivouac, shelter, or hut is never called legal, open,
available, bookable, or supplied with drinkable water. A drinking-water request
requires official `drinking_water_availability` evidence and otherwise remains
`water_status_required`.

## Deterministic bounded search and ordering

The immutable V1 bounds are:

| Bound | V1 value |
| --- | ---: |
| Input highlights | Existing dossier maximum: 32 |
| Output proposals | 6 |
| Via candidates per proposal | 5 |
| Mapped-network candidates per proposal | 8 |
| Explored candidate-set attempts | 512 |
| Evidence references per candidate | 32 |
| Evidence references per proposal | 64 |
| Serialized plan | 256 KiB |

Search uses fixed strategy and rotation order over canonically sorted candidate
pools. It generates no unbounded permutation set and uses no random search,
model, hidden score, provider call, or wall clock.

Candidate sets are ordered by:

1. more satisfied must-have counts;
2. known incompatibilities already excluded;
3. fewer unresolved high-stakes checks;
4. more included requested preferences;
5. lower straight-line lower bound;
6. stable entity-ID key;
7. stable proposal ID.

This is an internal comparator, not a user-facing score or confidence.

## Proposal diversity

Two proposals cannot use the same entity set merely in a different order.
Selection uses set overlap and admits a later proposal only when its
intersection-over-union with every selected proposal is no more than `0.8`.
With the five-waypoint cap, this ensures at least one meaningful entity
difference and usually more. If only one truthful set exists, V1 returns one
proposal rather than fabricating variety.

Proposal-specific gaps are aggregated only from the selected diverse proposal
records. A discarded construction attempt cannot leak its distance or
requirement gap into the final plan. Dossier-level gaps and typed gaps for
truly excluded candidates remain global.

## Exact plan aggregation and freshness

For plans with proposals, the standalone validator requires:

- `requiredVerification` to be the exact policy-ordered union of all selected
  proposal verification codes;
- `unmetRequirements` to be the exact aggregation of selected proposal
  `unsatisfiedRequirements`;
- `ready` only when every proposal has no unsatisfied requirement and no
  unresolved high-stakes verification;
- `partial` in every other proposal-bearing case.

Requirement aggregation groups by `(requirementType, value)`. For unmet
requirements it selects, in order, greatest shortfall, greatest requested
count, lowest included count, lowest available count, then canonical lexical
order. Results are ordered by the fixed requirement type and value
vocabularies. Plans without proposals have empty top-level proposal
aggregates.

The sole V1 plan-level blocker that may keep otherwise ready proposals
`partial` is `dossier_freshness_not_current`. Freshness uses only the dossier's
validated declared `freshnessState`; the bridge never reads wall-clock time.
`stale` and `expired` add `source_stale`; `unknown` adds
`insufficient_evidence`. The bridge does not reinterpret stale claims as
current.

## Evidence linkage and errors

Every output evidence ID must exist in the validated dossier and belong to the
selected entity. Proposal-level evidence IDs are exactly the sorted union of
the selected waypoint and mapped-network references. Duplicate and dangling
references fail validation.

Fixed error codes are:

- `invalid_dossier`
- `invalid_options`
- `invalid_plan`
- `policy_inconsistent`
- `output_too_large`

Messages are fixed and bounded. They reflect no prompt, coordinate, source URL,
provider response, database record, or validation path.

## Validated worked examples

The examples below are executable cases in
`researchGuidedRouteCandidateV1.json`; the focused fixture test builds and
validates each plan.

| Worked example | Fixture | Validated result |
| --- | --- | --- |
| 15 km Ilsenburg loop with two viewpoints | `de-ilsenburg-15km-viewpoints` | `partial`, one proposal, two distinct viewpoints and one waterfall included; access and closure remain unresolved. |
| Easy Innsbruck hike with friends | `en-easy-friends-innsbruck` | `partial`, one proposal; beginner, child, and mobility suitability remain separate verification requirements. |
| Viewpoint, waterfall, and hut request | `en-viewpoint-waterfall-hut` | `partial`, one proposal; viewpoint and waterfall counts are satisfied, but the mapped hut does not satisfy lunch availability without opening evidence. |
| Insufficient viewpoint evidence | `boundary-one-of-two-viewpoints` | `partial`, exact viewpoint shortfall `2 requested / 1 included / 1 short`. |
| Overnight without verified opening or legality | `en-one-night-hut` | `partial`, one mapped hut candidate; opening, permission, booking, seasonal operation, and legal-sleep verification remain required. |
| Target impossible by geometric lower bound | `boundary-lower-bound-exceeds` | `partial`, `lower_bound_exceeds_target`, distance shortfall retained, and `requires_real_routing` remains explicit. |

## Current limitations

- Point-to-point dossiers have no separate destination coordinate, so V1 can
  only form an endpoint-incomplete construction chain.
- Highlight categories do not currently include emergency shelters, campsites,
  designated bivouacs, or water points. Those dossier candidates have no
  coordinate in the current contract and cannot become waypoints.
- Mapped network candidates have no route geometry or proven connectivity.
- Exposure, slope, elevation, transport, current conditions, quietness,
  forest coverage, scenic quality, and route-wide suitability are not resolved.
- The distance heuristic has not been calibrated as a prediction and is never
  an actual route metric.
- V1 does not split a multi-night request into day stages.
- The bridge is an internal domain engine and is not connected to a server
  endpoint or release behavior.

## Explicit non-goals

V1 does not:

- query PostGIS, OSM, or another repository;
- call GraphHopper or another routing provider;
- access the network;
- generate route geometry;
- invent distance, duration, elevation, access, safety, scenery, water, or
  legality;
- geocode, snap, or adjust coordinates;
- add an HTTP endpoint;
- add OpenAI, another model, or a dependency;
- change the dossier contract or evidence resolver;
- modify iOS code;
- add a feature flag or production enablement;
- stage, commit, push, or deploy.

## Future GraphHopper integration

After the Outdoor Research Executor and Dossier Assembler are stable, a narrow
integration layer can translate each proposal into a bounded GraphHopper
attempt:

1. use the validated anchor and exact ordered `viaCandidates`;
2. carry activity, route type, target ranges, elevation and difficulty
   constraints;
3. use mapped networks only as typed guidance where the provider can represent
   that guidance;
4. request real geometry, distance, duration, elevation, and path details;
5. retain proposal ID and evidence links as construction provenance;
6. return typed routing failure rather than promoting the pre-routing brief.

The router must not mutate the evidence meaning of any waypoint or relation.

## Future HikingRouteQualityEngine integration

Real routed alternatives should next enter the existing hiking-first quality
engine. That engine can:

- enforce structural geometry and request compatibility;
- reject real known technical or road conflicts;
- compare actual distance, duration, elevation, mapped path details, repeated
  path, loop shape, and evidence coverage;
- remove near-duplicate routed geometry;
- explain only routed or evidence-backed facts.

The candidate bridge's construction ordering must not become the quality
engine's route ranking. A pre-routing proposal that looks short in straight-line
space may route poorly or fail entirely. Only the routed alternative and its
evidence can be assessed for final user comparison.
