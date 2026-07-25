# TrailMind Research-Guided Routing Adapter V1

## Purpose

Research-Guided Routing Adapter V1 is the internal bridge between the
server-validated `ResearchGuidedRouteCandidatePlanV1` and TrailMind’s existing
GraphHopper and iOS route-quality infrastructure.

The trusted flow is:

```text
server-side research dossier
  → validated ResearchGuidedRouteCandidatePlanV1
  → internal routeResearchGuidedCandidatesV1
  → existing validateRouteRequest
  → existing GraphHopper provider
  → validated ResearchGuidedRoutedAlternativesV1
  → strict iOS contract adapter
  → existing GraphHopper path-to-TrailRoute converter
  → RouteAlternativeQuality.select
  → HikingRouteQualityEngine
  → truthful surviving alternatives
```

This V1 is intentionally not wired into the production planner. It adds no
public endpoint and no Release feature flag. A client cannot submit a dossier,
candidate plan, evidence identifier, or research coordinate to this adapter.

## Trust boundary

`routeResearchGuidedCandidatesV1(candidatePlan, dependencies, options?)` is a
server-internal API. Its input must be the output of the trusted server research
pipeline.

The adapter revalidates the complete candidate plan before preparing any
provider operation. Tampered proposal IDs, dangling evidence references,
unknown fields, duplicate identifiers, excessive arrays, invalid coordinates,
and inconsistent plan states fail before GraphHopper is called.

The later public orchestration endpoint must accept user intent, not a dossier
or candidate plan. It must run research, candidate planning, this routing
adapter, and response preparation entirely on the server.

## Internal and contract APIs

Backend:

- `routeResearchGuidedCandidatesV1(candidatePlan, dependencies, options?)`
- `validateResearchGuidedRoutedAlternativesV1(envelope)`
- `serializeResearchGuidedRoutedAlternativesV1(envelope)`
- `deriveResearchGuidedRouteAttemptIdV1(proposalId)`
- `deriveResearchGuidedRouteLineageIdV1(provenance)`
- `deriveResearchGuidedRouteResultIdV1(attemptId, pathIndex)`
- `RESEARCH_GUIDED_ROUTED_ALTERNATIVES_POLICY_V1`

iOS:

- `ResearchGuidedRoutingContractAdapterV1.decodeConvertAndSelect(_:)`
- `ResearchGuidedRouteSelectionV1`
- `ResearchGuidedRouteAlternativeV1`
- `ResearchRouteProvenanceV1`
- `ResearchWaypointVisitV1`
- `GraphHopperClient.verifiedBackendRoute(...)`

The GraphHopper conversion seam is internal. It reuses the shipping decoder,
route-fact fingerprint, path-detail conversion, and `RouteEligibilityPolicy`.
It does not perform network traffic.

## Supported route types

V1 supports research-guided loops only.

Each loop uses standard GraphHopper via-point routing:

```text
resolved anchor
  → selected via candidate 1
  → selected via candidate 2
  → …
  → resolved anchor
```

The adapter does not replace this request with GraphHopper `round_trip`. The
existing backend route validator confirms that the point chain is a standard,
closed loop. GraphHopper request encoding remains centralized in
`graphHopperProvider.js`, including the `[longitude, latitude]` provider
translation.

Both hiking and trail running use GraphHopper’s `foot` profile. Their distinct
activity semantics remain in the routed-alternatives provenance and in the iOS
`RoutePlanningRequest`.

V1 fails these shapes closed:

- `biking`: the research candidate bridge does not yet model a biking
  network, so its unsupported envelope remains decodable but produces zero
  routing attempts. This is reported as `candidate_plan_unsupported`, not as
  an unsupported route shape.
- `point_to_point`: unsupported until the trusted plan contains a separately
  validated destination coordinate.
- `out_and_back`: unsupported because standard via-point loop routing does not
  prove the required outbound/retraced-return semantics.
- unresolved anchors, empty proposals, `insufficient_evidence`, and unsupported
  candidate-plan states: zero provider calls.

## Research provenance versus routed facts

Research provenance explains why TrailMind attempted a waypoint. It includes:

- stable proposal and attempt identities;
- the proposal strategy;
- selected entity IDs and exact selected coordinates;
- highlight roles and selection reasons;
- mapped-network candidate IDs and their source basis;
- evidence claim IDs;
- required verification codes;
- known research limitations;
- the source candidate-plan policy version;
- a cross-language `lineageId`.

The backend still re-derives the candidate planner’s proposal ID from the
validated plan. `lineageId` is a separate SHA-256 identity over normalized
string fields and fixed-precision coordinates so Swift can verify exact
lineage without depending on JavaScript and Foundation serializing JSON numbers
identically.

Routed facts remain separate:

- geometry provider: GraphHopper;
- routing strategy: backend;
- geometry, distance, duration, ascent, descent, instructions, and path details:
  sanitized GraphHopper output;
- production eligibility: existing iOS route integrity checks;
- final acceptance and ranking: `HikingRouteQualityEngine`.

Research evidence cannot make scenic quality, public access, safety, legality,
opening status, water availability, overnight suitability, trail membership,
or official-route status verified. Mapped route relations remain advisory and
never become coordinates or claims that GraphHopper followed a relation.

## Snapped waypoints

When GraphHopper supplies snapped waypoints, V1 preserves a per-path visit
record for every requested point:

- requested coordinate;
- snapped coordinate;
- calculated snap distance;
- role (`anchor`, `via`, or `return_anchor`);
- optional research entity ID;
- `withinVisitTolerance`.

The V1 tolerance is 100 metres. Exceeding it adds
`snapping_exceeds_tolerance` and never becomes a claim that the POI was
reached. Missing snapped data adds `snapping_unavailable`; the lineage means
“attempted,” not “visited.”

## Output contract

`ResearchGuidedRoutedAlternativesV1` contains:

- schema version `1`;
- state: `routed`, `partial`, `no_viable_route`, or `unsupported`;
- the normalized research intent;
- candidate-plan and routing-adapter policy versions;
- deterministic proposal-order attempt results;
- successful sanitized GraphHopper paths;
- exact research provenance for each attempt;
- fixed failure codes;
- remaining research and adapter limitations.

Attempt IDs depend only on policy versions and proposal identity. Route-result
IDs identify stable path slots within an attempt. Neither uses clocks,
randomness, provider completion order, or route geometry.

The runtime validator rejects unknown fields, invalid enums, malformed dates,
duplicate IDs, invalid coordinates, inconsistent states, lineage mismatches,
malformed path data, excessive arrays, and oversized serialization. The
serializer recursively sorts object keys.

## Bounds, cancellation, and failures

V1 limits:

- at most 6 proposals;
- at most 3 GraphHopper paths per proposal;
- at most 2 concurrent provider operations;
- at most 5 selected via candidates per proposal;
- at most 8 mapped-network candidates per proposal;
- 8 MiB routed envelope;
- existing coordinate, instruction, and path-detail ceilings;
- default 30-second and maximum 60-second provider-operation timeout;
- 100-metre waypoint visit tolerance.

Provider completion order never changes attempt ordering. One provider failure
does not convert other successful attempts into failures. If no valid real path
remains, the envelope is `no_viable_route`.

Caller cancellation aborts outstanding provider signals and rejects with the
fixed `cancelled` adapter error. A provider that ignores cancellation or timeout
is detached; a late completion cannot mutate the ordered result array.

Failure objects contain codes only. They do not include prompts, exact
coordinates, provider messages, stack traces, tokens, or credentials. The
adapter emits no request or provider logging.

## iOS final-quality seam

iOS first performs strict Foundation object validation; permissive `Codable`
decoding is not the trust boundary. Every structurally valid path is then fed
through the existing GraphHopper converter. Only routes that retain GraphHopper
as provider, backend as strategy, a valid route-fact fingerprint, valid
geometry, and valid quantitative facts become `RouteSuggestion` candidates.

The complete converted candidate set enters
`RouteAlternativeQuality.select`, which delegates to
`HikingRouteQualityEngine`. The engine remains responsible for rejecting open
or degenerate loops, severe backtracking and overlap, extreme target misses,
invalid geometry, and near-duplicate routes.

Research provenance is paired back only with the selected provider indices.
If every candidate is rejected, the iOS result is `no_viable_route` and exposes
no success alternative.

## Shared fixtures

Both Node and XCTest load:

`TrailMindTests/Fixtures/research_guided_routed_alternatives_v1.json`

The corpus contains deterministic valid routed envelopes and a required
scenario manifest covering valid single and ordered highlights, concurrency
ordering, partial and total provider failure, malformed responses, provenance
tampering, unsupported shapes, advisory mapped relations, snapping, cancellation
and late completion, duplicate geometry, all-quality-rejected behavior,
quality reduction/ranking, bounds, and sanitized failures.

No fixture or test performs live GraphHopper, production backend, Overpass, or
other provider traffic.

## Remaining gaps and exact next step

V1 does not provide a destination coordinate for point-to-point plans, prove
out-and-back semantics, verify outdoor claims, expose a public endpoint, or
change the production planner.

The exact next step is a server-side end-to-end research planning endpoint that:

1. accepts validated user intent;
2. executes trusted research;
3. builds and validates `ResearchGuidedRouteCandidatePlanV1`;
4. calls `routeResearchGuidedCandidatesV1` internally;
5. returns the strict routed-alternatives envelope to the iOS adapter;
6. remains unavailable in Release until authorization, rate limiting,
   observability, and product verification are complete.
