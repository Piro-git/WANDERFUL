# Research-Guided Route Product Shaping V3

## Outcome

V3 adds a deterministic, bounded pre-routing shaping layer for research-guided
loop proposals. It improves the waypoint set, routable access-point choice, and
waypoint order before GraphHopper runs. GraphHopper remains authoritative for
route geometry, distance, duration, elevation, snapping, reachability, and
final quality eligibility.

The strict `ResearchGuidedRouteCandidatePlanV2` wire boundary is deliberately
unchanged. V3 is an internal product-shaping algorithm behind that boundary,
so the existing V2 validator, canonical serializer, provenance binding,
proposal identifiers, routing adapter, and routed-alternatives contract remain
the integration surface. A new V3 wire contract was not justified. The V2
policy explicitly declares its loop-shaping policy dependency, every generated
shaping result declares that V3 policy version, and loop proposal identity
binds the shaping version. A plan generated under different shaping semantics
therefore fails canonical V2 validation instead of being silently
reinterpreted under the same proposal identity.

## Ownership and inputs

The shaping layer consumes only already validated V1 candidate-plan data and
validated `ResearchTrailAccessCandidateV1` records. It does not query a
provider, database, network, clock, random source, environment variable, or
global mutable state.

Every selected waypoint retains two distinct coordinate meanings:

- `evidenceCoordinate`: the research-owned highlight location;
- `routingCoordinate`: the selected mapped-trail access candidate.

Entity ID, evidence claims, source trail segment, projection snapshot,
operational region, access-candidate ID, and all verification limitations stay
attached through the existing V2 lineage. An access candidate is still only a
candidate until the provider and returned geometry verify it.

## Hard requirements

The hard roles are `must_have`, `facility_candidate`, and
`overnight_candidate`. Every hard role present in a source proposal is included
in every shaped descendant proposal. Optional preferences are searched only in
the remaining waypoint budget and cannot displace a hard role.

If any hard waypoint has no validated access candidate, that source proposal
produces no shaped route and the V2 plan emits
`required_access_candidate_unavailable`. Optional access failures use the
separate optional shortfall. No coordinate is invented as a fallback.

## Bounded search

The immutable policy is
`research-guided-route-product-shaping-v3`. Its explicit caps are:

- 384 total evaluated search states per source proposal;
- 147,456 worst-case dominance comparisons (384 squared);
- 32 optional-subset states;
- 3 access candidates per entity;
- 11 access assignments per selected waypoint set;
- 10 bounded angular ordering states per assignment, covering clockwise and
  counterclockwise rotations;
- 5 selected highlights per proposal;
- 6 shaped proposals before the V2 plan applies its source proposal budget.

Optional subsets are enumerated over the existing five-waypoint maximum. Every
nearest-access subset baseline is evaluated before farther-access alternatives,
so alternative access exploration cannot starve the hard-only or other subset
states. Access exploration changes one entity at a time. The algorithm never
computes unbounded permutations or a factorial Cartesian product. Search order
and tie-breaking use canonical IDs.

After search, an optional superset is removed from the frontier only when a
strict subset with identical hard/access lineage materially improves target fit
without increasing shape risk, or materially reduces shape risk when no target
exists. This bounded dominance pass is what prevents clearly harmful optional
points from surviving merely to fill a proposal slot.

The V2 output cap is additionally limited by the validated V1 source plan's
proposal count. This preserves the existing `maximumProposals` option rather
than letting one source proposal expand beyond the caller's reviewed budget.

## Distance shaping

For each ordered selection, V3 calculates the straight-line closed-loop
perimeter from anchor to access waypoints and back to anchor. This is a lower
bound and planning heuristic only. It is never presented as a routed distance.

When a target exists, ranking uses a declared 1.4 lower-bound multiplier only
as a deterministic target-fit heuristic. A lower bound equal to the requested
maximum stays admissible. A lower bound above the maximum remains explicit.
When the hard-waypoint lower bound exceeds the maximum by more than 15%, the
existing V2 `material_required_detour` state and limitation are emitted for
every affected descendant, including descendants that retain useful optional
points. Optional points that worsen target fit can be removed, with a typed
shortfall; hard points are never removed to satisfy distance. Exact target-edge
classification uses the unrounded lower bound; the three-decimal value is
display/storage precision only.

When no target exists, no distance is invented. Spatially useful evidence-owned
optional points are preferred when they reduce pre-routing shape risk.

## Access-candidate selection

The nearest validated access candidate is the baseline. A farther candidate is
admitted only if it produces at least one declared material improvement:

- at least 2% normalized target-fit improvement;
- at least 10 points of pre-routing risk reduction; or
- moving a lower bound from above the target maximum to at or below it.

Equal-distance or farther alternatives that provide none of those material
improvements are rejected, so access lineage alone cannot manufacture product
diversity.

Changing access lineage changes the existing V2 proposal digest. Provider
result order never affects access selection or proposal ranking.

## Loop ordering and diversity

Waypoints are projected locally around the anchor and sorted by polar angle.
Bounded cyclic rotations in both counterclockwise and clockwise directions are
evaluated, allowing the anchor connections to change without arbitrary input
permutation. Direction-only reversal of the same waypoint/access sequence has
the same undirected topology key and is not counted as meaningful diversity.

Proposals can be meaningfully distinct through different role-bound entity
sets, access candidates, or non-equivalent adjacency. Exact duplicate proposal
IDs are collision-checked, and reverse-equivalent topology is removed
deterministically before the output cap. Stable IDs continue to bind normalized
intent, V1 source proposal, route type, shaping policy version, ordered
evidence and routing coordinates, access-candidate lineage, roles, and
mapped-network evidence.

## Pre-routing backtracking risk

V3 detects only geometry-available warning signals:

- a single radial waypoint;
- a narrow radial angular spread;
- a low-area collinear loop;
- near-duplicate access coordinates;
- nearby points on the same mapped trail segment.

Hard conflicts use `required_mapped_corridor_risk` and
`required_backtracking_risk`. Optional-only shapes that cannot be improved use
`pre_routing_backtracking_risk`. Optional candidates can instead be removed
with `optional_removed_for_loop_shape`, the existing near-duplicate code, or
the existing same-corridor code.

These are pre-routing risks, not verified route-quality facts. Only returned
provider geometry can establish actual overlap or backtracking. The unchanged
route-quality engine remains the final authority and its thresholds are not
modified by V3.

## Compatibility and failure behavior

- V1 candidate planning and contracts remain valid.
- V2 canonical validation recomputes V3 shaping from the embedded validated
  source plan and access resolution; unknown fields and tampering still fail.
- Point-to-point and out-and-back requests keep their existing fail-closed
  adapter behavior; V3 applies only to loops.
- Unsupported biking remains unsupported.
- Requested technical difficulty remains an intent constraint. V3 does not
  infer or verify difficulty from coordinates.
- Cancellation, timeout, bounded concurrency, partial provider failure,
  waypoint snapping, evidence approach, route-distance verification, and final
  quality selection remain owned by the unchanged V2 adapter and quality
  engine.

## Verification data

The V3 fixture is synthetic topology only. It contains no production
coordinates or Golden Set case identifiers. Focused tests cover hard-role
preservation, typed access shortfalls, target and no-target behavior, material
required detours, useful optional shaping, angular ordering, reversal dedupe,
radial/collinear/corridor risks, access alternatives, deterministic IDs and
input order, explicit search caps, malformed coordinates, immutable policy,
difficulty preservation, strict serialization, provenance/snapshot tampering,
partial provider failure in both attempt orders, downstream snap/reach
rejection, and the shipping V2 orchestration path from a deterministic research
dossier/access resolution through V3 shaping and routed-alternative evaluation.
The integration proof asserts the exact selected access-candidate coordinates
and waypoint order received by the fake provider.

No live GraphHopper, AI, PostGIS, staging, or production call is required to
exercise this layer. No deployment or live proof is part of this change.
