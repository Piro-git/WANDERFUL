# TrailMind Routable Highlight Access Points V1

## Pre-implementation contract audit

The reviewed baseline is `1988aedcfba34968da6d07246a973f7f1d26e670`.
At the start of this work, `HEAD`, `origin/main`, the staging index, and the
working tree all matched that baseline. The V1, V2, V3, and official proof
receipts are immutable inputs to this work.

The current pipeline and contract boundaries are:

1. The active OSM projection binds an operational region, active evidence
   import, source, reviewed source policy, projection run, assertions,
   relationships, quarantine state, and projected geometries.
2. `PostgresOutdoorResearchRepository` reads only an active, current,
   same-region projection snapshot. Its highlight query returns a single
   evidence coordinate derived from the projected POI geometry. The existing
   75 metre trail test establishes mapped proximity only.
3. `AdventureResearchDossierV1` preserves the highlight evidence coordinate
   and evidence claims, but has no access-point or provider-routing fields.
4. `ResearchGuidedRouteCandidatePlanV1` copies that one coordinate into each
   via candidate. Proposal identity includes entity IDs and strategy, but not
   a distinct routing coordinate or access-point lineage.
5. `ResearchGuidedRoutedAlternativesV1` sends the same POI coordinate to
   GraphHopper. Its `waypointVisits` distinguish the requested coordinate and
   provider-snapped coordinate, but do not calculate the route geometry's
   closest approach to the original highlight.
6. The iOS V1 adapter accepts a routed alternative only when every via point
   passes the provider-snap tolerance. It cannot distinguish a mapped POI, a
   derived trail-access point, and a provider-verified access point.
7. `HikingRouteQualityEngine` and `RouteAlternativeQuality` remain
   authoritative for final target-distance, repeated-segment, overlap, and
   route-quality decisions after real routing.
8. Research-route presentation currently describes snap-accepted V1
   waypoints as lying on the routed path. That wording cannot be reused for an
   access candidate unless the route-to-original-highlight contract passes.

## Version decision

No field will be added to an existing strict V1 wire object.

- `AdventureResearchDossierV1` stays unchanged.
- `ResearchGuidedRouteCandidatePlanV1` stays unchanged and remains the source
  evidence-selection plan.
- `ResearchGuidedRoutedAlternativesV1` and the outer V1 response stay
  unchanged and continue to use the checked-in V1 corpus.
- `ResearchTrailAccessCandidateV1` is a new strict, independently versioned
  sidecar contract.
- `ResearchGuidedRouteCandidatePlanV2` wraps a validated V1 source plan and
  adds bounded selected-highlight access lineage, access shortfalls,
  lower-bound detour analysis, and mapped-corridor backtracking-risk results.
- `ResearchGuidedRoutedAlternativesV2` carries the original evidence
  coordinate, requested routing coordinate, provider-snapped coordinate,
  route closest-approach coordinate, separate distance measurements, and the
  reached / passes-near / not-reached / unverified result.
- `OutdoorAdventurePlanningResponseV2` contains only V2 routed alternatives.
  Schema-declared V1 and V2 payloads are validated by their matching strict
  validators; cross-version payloads fail closed.
- V2 proposal identity canonicalization encodes every normalized-intent
  numeric scalar as a fixed seven-decimal string before hashing. V2 lineage
  identity canonicalization applies the same fixed-width rule recursively to
  every numeric scalar in its complete access/provenance payload. This avoids
  JavaScript/Swift JSON floating-point rendering drift without changing either
  wire object.
- Access-candidate identity includes both coordinates, complete source
  lineage, derivation inputs, and freshness. Route-result identity is bound to
  the validated provider-derived path, snaps, approach calculations, and
  distance verification as well as its attempt and path index.

The V2 endpoint path is selected only when both the existing research-planning
gate and the new routable-highlight-access gate are explicitly enabled. Both
tracked Debug and Release configuration defaults remain false. A schema V1
request follows the existing V1 pipeline. With the access gate off, ordinary
route generation and the disabled research path retain their V1 behavior.

## Trust model

The three trust states are intentionally separate:

- `evidenceCoordinate` is the immutable projected coordinate of the mapped
  highlight.
- `trailAccessCandidate` is a deterministic closest point on a current,
  eligible mapped trail segment. It is not called routable or publicly
  accessible.
- `providerVerifiedAccess` is true only after a provider result passes the
  access-coordinate snap policy and the decoded route geometry passes the
  access-coordinate approach policy.

Every access resolution declares one canonical source snapshot: operational
region, projection run, import, source, source-policy ID and version, adapter
schema version, and freshness dates. Every accepted candidate must match that
snapshot exactly, and the V2 candidate plan is checked against the actual
research dossier and resolver output rather than trusting a self-declared,
self-consistent snapshot.

The trail assertion IDs carried by an access candidate prove only the
`trail_segment` entity category. Highway classification is attributed instead
to the immutable imported trail record identified by import, region, OSM way,
and OSM ID. Neither source is treated as proof of public access, provider
connectivity, current opening, or legal access; those remain explicit
limitations and verification requirements.

Provider snapping is never treated as proof that the route approached the
original highlight. The original highlight is:

- `reached` at no more than 25 metres;
- `passes_near` above 25 and at no more than 100 metres;
- `not_reached` above 100 metres; or
- `unverified` when provider/access verification is absent.

These are geometric planning semantics, not claims of safety, legality,
opening state, public access, or scenic quality.

## PostGIS derivation decision

Access candidates are snapshot-bound computed projections, not persisted
business records. Persistence would duplicate immutable projection lineage
and create lifecycle synchronization work without adding trust. Migration 007
therefore adds only the partial GiST expression index required for bounded
`geography` `ST_DWithin` lookup on projected trail geometry.

The authoritative access coordinate is `ST_ClosestPoint` on the eligible
SRID-4326 trail geometry. Longitude remains X and latitude remains Y.
Authoritative POI-to-access distance is computed with `geography`. Results are
ordered by metre distance, trail entity ID, and source identity, then bounded.

Eligibility binds the result to the same active projection run, operational
region, active import, accepted source and policy, active entity lifecycle,
non-quarantined rows, current snapshot, exact region containment, eligible
hiking path classes, and non-restricted foot access. Missing access tags remain
an explicit limitation and never become verified public access.

## Pre-provider guards

The V2 planner uses the ordered routing/access coordinates for an
anchor-to-access-points-to-anchor straight-line lower bound. Optional points
that alone make the target impossible are removed deterministically. Must-have,
required-facility, and required-overnight points are preserved and produce a
typed material-detour limitation when their lower bound exceeds policy.

Mapped geometry is used only for bounded risk heuristics. Near-duplicate
optional access points and multiple optional points on the same short mapped
segment are removed. Required points are preserved with an explicit
backtracking-risk limitation. Final routed overlap and repeated-segment
calculations remain authoritative.

## Live-call boundary

This implementation and all verification use deterministic fake provider
responses. It makes no live GraphHopper, AI, staging-proof, or other provider
call.
