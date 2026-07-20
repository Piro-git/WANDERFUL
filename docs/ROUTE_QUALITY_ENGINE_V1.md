# TrailMind Hiking Route Quality Engine v1

## Status and scope

The production policy is `HikingRouteQualityPolicy.v1`, identified as
`hiking-route-quality-v1`. It is a deterministic, hiking-first policy for
deciding which already-routed alternatives are eligible, how eligible routes
compare, which distinct routes may be shown, and which facts may be explained
to a user.

The routing provider remains responsible for calculating real geometry,
distance, duration and elevation. The quality engine does not invent geometry,
POIs, scenery, access, safety, trail conditions or other outdoor facts. It does
not expose an aggregate match percentage or a universal scalar quality score.

The implementation is centered in:

- `TrailMind/Services/HikingRouteQualityPolicy.swift`
- `TrailMind/Services/RouteEvidence.swift`
- `TrailMind/Services/HikingRouteQualityEngine.swift`
- the production integration and frozen comparator in
  `TrailMind/Services/RouteAlternativeQuality.swift`
- the bounded loop candidate search in
  `TrailMind/Services/RoutingFoundation.swift`

All v1 constants are **pre-baseline policy values**. They protect explicit
product and trust invariants, but they have not been calibrated by an
authorized live-provider baseline or a blind human preference study. They must
not be described as scientifically validated or as proof that TrailMind is
better than another product.

## Pipeline contract

The production pipeline is ordered deliberately:

1. Generate a bounded set of real routed candidates.
2. Extract typed routed, geometry and mapped path-detail evidence.
3. Apply hard eligibility rules.
4. Calculate independent normalized-loss objectives for eligible candidates.
5. Assign Pareto fronts for diagnostics using dominance across comparable objectives.
6. Repeatedly choose the request-best candidate from the current
   non-dominated front, remove it, and recompute the front.
7. Select at most three routes, rejecting near-duplicate geometry as a final
   diversity gate.
8. Generate factual request-fit, mapped-evidence, estimate and limitation items.
9. Return privacy-safe policy, count, rejection and assessment-duration
   telemetry.

Hard eligibility always precedes ranking. A candidate rejected for a critical
defect is absent from Pareto ranking and diversity selection; a good value on a
different objective cannot compensate for the rejection. Diversity may replace
a near-duplicate eligible candidate with another eligible candidate, but can
never rescue a hard-rejected route.

## Exact v1 policy thresholds

### Evidence, selection and presentation thresholds

| Policy value | Exact v1 value | Contract and conservative rationale |
| --- | ---: | --- |
| Final suggestions | 3 | A product-comprehension and diversity cap, not an assertion that three good routes always exist. |
| Accepted candidate pool | 6 | Lets the bounded loop search inspect alternatives beyond the first three successes without unbounded requests or full-resolution all-pairs work. |
| Strong evidence coverage | 60% | Below this level, a measured zero or ratio is treated as limited evidence rather than a route-wide positive fact. This is a disclosure policy, not a scientific confidence interval. |
| High evidence coverage | 90% | Marks evidence confidence as high and permits wording that data broadly covers the route. It does not prove completeness or current conditions. |
| Easy/avoidance distance tolerance bucket | 12% | Alternatives inside the existing product tolerance are treated as comparable before gentler or avoidance evidence is used. |
| High-quality early-stop target tolerance | 15% | All supplied distance and time targets must be within this relative deviation before three candidates can stop fallback exploration early. |
| Major-road hard rejection | More than 25% of full route distance | Applies only when major roads were explicitly requested to be avoided and road-class evidence has at least 60% coverage. It rejects substantial known conflict without treating missing road data as low exposure. |
| Maximum known hike rating for an Easy request | 1 | v1 makes only the conservative supported boundary between basic hiking (`1`) and a known higher mapped hike rating. It does not invent Moderate or Challenging mappings. |
| Minimum demanding technical distance for Easy rejection | 100 routed metres | Prevents an isolated rounding/sliver artifact from causing rejection while still preventing a known meaningful higher-rated section from being hidden. |
| Physical-effort ascent normalization | 1,200 m total ascent | Caps the independent ascent-load component without making a longer route with equal ascent look easier. Pre-baseline tuning value. |
| Physical-effort requested-difficulty/ascent weights | 70% / 30% | Keeps the requested Easy/Moderate/Challenging effort band primary while retaining total ascent as an independent load. These are deterministic pre-baseline preferences, not a physiological model. |
| Paths-and-tracks explanation | At least 60% of full route distance | A concise positive fact requires both this majority ratio and at least 60% road-class coverage. |
| Major-road exposure explanation | At least 1%, unless major roads were explicitly avoided | Avoids a rounded, meaningless zero-exposure row. An avoidance request may show the measured value, including zero, but still requires at least 60% coverage. |
| Low repeated-path explanation | At most 10% | A measured geometry fact for loops; it is not a statement about scenery or trail quality. |
| Objective comparison epsilon | `0.000001` | Prevents floating-point noise from creating a material preference or changing dominance. |
| Verified characteristics per route | 2 | Keeps the factual explanation contract concise while prioritizing known technical sections. |
| Route-card evidence items | 2 | Keeps cards scannable and prevents a dense quality dashboard. |
| Route-detail evidence items | 5 | Provides more context while keeping the evidence section concise. |

### Inherited structural thresholds

`HikingRouteQualityPolicy.v1` owns
`RouteAlternativeQualityPolicy.preBaseline`; these structural protections
remain part of v1 rather than becoming a disconnected second selector.

| Structural value | Exact predicate | What it protects |
| --- | --- | --- |
| Valid geometry | At least 2 points, valid finite coordinates, at least 100 m geometry length, finite positive routed distance and positive duration | Rejects missing, invalid and effectively empty routes. |
| Loop point count | At least 4 points | Rejects geometries that cannot describe a meaningful loop. |
| Loop closure | Gap no greater than `min(250 m, max(75 m, 1.5% of geometry length))` | Allows small provider endpoint variance while rejecting materially open loops. |
| Self-backtracking | Reject above 55% | Rejects extreme opposite-direction retracing. |
| Self-overlap | Reject above 55% | Rejects extreme repeated geometry in either parallel direction. |
| Loop shape quality | Reject below `0.025` | Rejects severely degenerate loop shapes using two-dimensional spread, compactness and area fill. |
| Hard distance envelope | Actual/target must be in `0.55...1.75` | Rejects only extreme target misses before nuanced ranking. |
| Hard duration envelope | Actual/target must be in `0.40...2.50` | Rejects only extreme time misses before nuanced ranking. |
| Extreme point-to-point detour | Reject only when detour ratio is above `5.0` **and** routed distance exceeds direct distance by more than 10,000 m | Avoids rejecting normal terrain/path detours while removing implausible extremes. Direct distance must exceed 100 m before this ratio is computed. |
| Similarity corridor | 35 m | Provides a geometry corridor robust to ordinary provider-point differences. |
| Near duplicate | Similarity at least 86% | Prevents multiple cards that represent essentially the same route. Similarity is symmetric and route reversal does not make geometry distinct. |

These envelopes are intentionally broad. Their purpose is to remove clear
structural failures and extreme request conflicts before ranking, not to encode
a complete model of what hikers prefer. Any threshold change requires an
updated deterministic benchmark and a written explanation of the behavior it
fixes. Once an authorized live baseline or blind human study exists, changes
must cite that evidence; partial, skipped or false-green runs are not tuning
evidence.

## Typed evidence and coverage semantics

`RouteEvidenceMetric<Value>` carries a typed optional value, optional coverage
ratio, source, confidence, status and freshness. A missing value is never
represented by a numeric zero.

| Status | Meaning in v1 | Selection behavior |
| --- | --- | --- |
| `known` | A typed value exists and coverage is finite in `0...1`. | May be used according to the metric-specific coverage rules. |
| `unavailable` | The current route/provider contract could carry the metric, but this route has no usable value. | Remains unknown, may produce a limitation, and does not create a positive fact. |
| `unsupported` | The current app/provider capability does not supply the metric. | Remains unknown and is not itself a route rejection. |
| `stale` | The source explicitly marks the metric too old for current selection. | Has no usable value or coverage, is non-known, produces unavailable-style warnings and is excluded from ranking and verified explanations. |
| `malformed` | A supplied value, coverage or breakdown violates the typed payload contract. | A malformed core metric rejects the candidate as `unusable_evidence_payload`. |
| `rejected` | Reserved for a metric rejected by a future evidence pipeline. | Not produced by the current extraction path and must not be interpreted as zero or unavailable. |

For a known metric, confidence is derived from coverage:

- `high`: coverage at least 90%
- `medium`: coverage at least 60% and below 90%
- `low`: coverage below 60%
- `unknown`: non-known evidence

These names describe product disclosure strength, not provider accuracy,
freshness or a probabilistic confidence interval.

Freshness is modeled independently as `RouteEvidenceFreshness`:

| Freshness | Exact meaning |
| --- | --- |
| `currentRequest` | The value was produced for the current request and is explicitly tagged as such. |
| `sourceTimestampUnavailable` | The source supplied a value but the current contract supplied no trustworthy source timestamp. This is the current GraphHopper path-detail state. |
| `stale` | The evidence was explicitly determined to be too old. The corresponding metric status is `stale`, so it is not `isKnown` and cannot rank or create a verified fact. |
| `notApplicable` | Freshness has no meaning because the metric is unavailable, unsupported, malformed or otherwise has no usable value. |

Freshness is never inferred from request time or provider name. In particular,
`sourceTimestampUnavailable` must not be relabeled current, and stale evidence
must not silently degrade to a numeric zero.

The current mapped evidence comes only from sanitized GraphHopper path-detail
breakdowns:

- `road_class`: path/track values are `track`, `footway`, `path` and `steps`;
  major-road values are `motorway`, `trunk`, `primary` and `secondary`.
- `surface`: stable/easier values are `paved`, `asphalt`, `concrete`,
  `concrete:lanes`, `concrete:plates`, `paving_stones`, `compacted`,
  `fine_gravel`, `gravel` and `wood`; rough values are `rock`, `dirt`, `earth`,
  `ground`, `grass`, `mud`, `sand`, `pebblestone`,
  `unhewn_cobblestone` and `cobblestone`.
- `hike_rating`: values must decode as integers in `0...6`. Zero is treated as
  missing mapped technical data, not proof of an easy segment.

Ratios use full routed distance as the denominator. Coverage separately states
how much of that route had a mapped classification. This preserves the
difference between 0% major-road exposure with 95% coverage and the same
measured zero with 5% coverage.

A mapped payload is malformed when route distance is non-finite/non-positive,
coverage is non-finite/negative/materially above route distance, a breakdown
key is empty, a segment distance is non-finite/negative, or a breakdown total
does not approximately equal its declared coverage. This equality check is
essential: positive coverage with an empty or underfilled breakdown must not
become a high-confidence measured zero. The implementation tolerates up to 1%
distance-rounding variance or one metre, whichever is larger. Zero coverage is
valid only with an empty breakdown. A breakdown within the accepted rounding
tolerance is clamped to 100% when converted to a typed coverage or route-share
ratio; it is never exposed as more than the full routed distance.

### Current sources and extension seam

Current source tags distinguish routed geometry, routed metrics, individual
GraphHopper path details and derived evidence. The snapshot also has typed
fields for official hiking-network ratio, verified POI count, access
restrictions and maximum slope, but all are currently `unsupported`.

`OutdoorRouteEvidenceProviding` is the replaceable asynchronous seam for a
future route-corridor evidence service. Its current production implementation,
`NoOpOutdoorRouteEvidenceProvider`, returns only unsupported fields. It does not
fabricate POIs, call public Overpass/Nominatim from the app, or block current
selection.

## Hard eligibility and warnings

Eligibility is evaluated in this order:

1. Apply all structural rejections listed above.
2. Require the routed route type to equal the requested route type.
3. Require the routed activity to equal the requested activity.
4. Reject a malformed core evidence snapshot.
5. For a non-biking Easy request, reject a known hike rating above `1` when at
   least 100 m of mapped route is above that boundary. This rule is intentionally
   conservative even when total technical coverage is partial: a known
   demanding section is not erased by unknown sections.
6. When major-road avoidance was explicit, reject measured major-road exposure
   above 25% only with at least 60% road-class coverage.

Near-duplicate geometry is a typed rejection applied after ranking while final
routes are selected. All other hard failures are excluded before Pareto
assessment.

Eligible routes can carry non-fatal warnings:

- the distance/elevation physical-effort estimate is harder than requested;
- technical, surface or road-class evidence is unavailable or covers less than
  60%;
- requested features remain unverified.

Physical effort and technical trail difficulty are separate contracts.
`RouteDifficulty` remains an estimate derived from route effort characteristics;
it is never presented as verified technical difficulty.

## Multi-objective assessment

Each objective is a normalized loss in `0...1`; lower is preferred. `nil` means
unavailable or inapplicable and is never converted to a favorable zero. The
engine retains the individual objectives and pairwise comparison result; it
does not sum them into a user-facing or internal universal quality score.

| Objective | v1 normalized loss and availability |
| --- | --- |
| Distance deviation | `abs(actual - target) / target`, clamped to 1; unavailable without a positive target. |
| Duration deviation | `abs(actual - target) / target`, clamped to 1; unavailable without a positive target. |
| Physical effort fit | With a requested difficulty: `70% × (absolute Easy/Moderate/Challenging rank difference / 2) + 30% × ascentLoad`; otherwise total-ascent load alone. `ascentLoad` is `ascentMeters / 1,200`, clamped to 1. Distance is evaluated independently, so lengthening an otherwise equal route cannot improve its effort estimate. |
| Technical difficulty | Maximum known hike rating divided by 6, clamped to 1; unavailable without known mapped technical evidence. |
| Surface suitability | Rough-surface ratio for Easy or steep-climb-avoidance requests, only with at least 60% surface coverage. |
| Path/track preference | `1 - pathAndTrackRatio`, only with at least 60% road-class coverage. |
| Major-road exposure | Major-road ratio, only with at least 60% road-class coverage. |
| Self-backtracking | Measured loop ratio; unavailable where not applicable. |
| Self-overlap | Measured loop ratio; unavailable where not applicable. |
| Loop shape | `1 - shapeQualityScore`; unavailable where not applicable. |
| Point-to-point detour | `max(detourRatio - 1, 0) / 4`, clamped to 1; unavailable where not applicable. |
| Evidence confidence | `1 - meanCoverage`; biking uses surface and road-class coverage, while other activities use surface, road-class and technical coverage. Missing coverage contributes zero coverage. |

This model intentionally does not assume that more unpaved surface is always
better. Rough-surface evidence becomes an ordering consideration only for an
Easy or steep-climb-avoidance intent and only with strong coverage.

### Pareto fronts

For each pair, the engine compares finite, available values for the same
objective. A difference no greater than `0.000001` is equivalent. One candidate
dominates another only when it is better on at least one comparable objective
and worse on none. Candidates with competing strengths are non-dominated and
share the same front. Missing objective values are skipped rather than treated
as favorable; the separate evidence-confidence objective ensures missing
surface, road-class and technical coverage remains visible in comparison.

Static Pareto rank is retained for diagnostics. Selection instead chooses one
request-best route from the current non-dominated front, removes that route,
recomputes the front, and repeats. A candidate cannot pass a route that directly
dominates it while that dominator remains, but an unrelated tradeoff cannot
indefinitely suppress a more relevant route after its own dominator has already
been selected. Within each current front, v1 uses this deterministic
request-sensitive order:

1. Duration deviation when a duration target exists.
2. For Easy or any steep-climb, major-road or repeated-path avoidance request,
   the within-12%-distance-tolerance bucket when a distance target exists.
3. Known lower technical difficulty for non-biking Easy requests.
4. Known lower major-road exposure when major roads were explicitly avoided.
5. Lower self-overlap, then lower self-backtracking, when repeated path was
   explicitly avoided.
6. Better physical-effort fit, then known lower rough-surface exposure, for Easy
   or steep-climb-avoidance requests.
7. Distance deviation when a distance target exists.
8. For non-biking activities, known higher path/track share, then known lower
   major-road exposure.
9. Lower backtracking, lower overlap, better loop shape, then lower
   point-to-point detour where applicable.
10. Better physical-effort fit.
11. Better evidence confidence.
12. Shorter duration.
13. Shorter distance.
14. A stable candidate key.

The stable key includes typed route facts and a canonicalized, bounded sample
of geometry that chooses the same geometric representation in forward or
reverse order. The route UUID is the final component for genuinely equal
candidates. Provider-array ordering is not a semantic tie-break. Stable keys
are internal comparison material and must not be logged as telemetry because
they contain route-derived data.

### Diversity selection

The selector scans the deterministically ranked eligible routes and admits at
most three. A candidate whose symmetric 35 m corridor similarity to any already
selected route is at least 86% is marked `near_duplicate_geometry` and skipped.
The scan continues so a lower-ranked but genuinely different eligible route can
be shown. Route reversal and different point density do not manufacture
diversity.

## Missing-data behavior

The following invariants are release requirements:

- Missing hike-rating data is not evidence that a route is technically easy.
- Missing access data is not evidence that access is allowed.
- Missing surface data is not evidence that a route is paved, unpaved, stable or
  rough.
- Missing road-class data is not evidence of low road exposure.
- Missing POI/network data is not evidence that no POIs or network membership
  exist.
- Low coverage cannot produce the paths-and-tracks or low-road positive facts.
- Unsupported future evidence does not reject an otherwise valid candidate.
- A malformed core payload does reject the candidate rather than silently
  degrading to a favorable value.
- Requested views, forest, water, quietness and similar preferences remain
  requested preferences and produce an explicit limitation until a supported
  corridor evidence source verifies them.

An otherwise valid route can remain eligible with unavailable or partial mapped
evidence. Warnings and limitations disclose that uncertainty, and the evidence-
confidence objective makes the gap available to selection without claiming
that unknown is bad terrain.

## Candidate-pool and performance strategy

The v1 selector makes no network calls. Candidate generation remains in the
existing routing pipeline, with its finite direct alternatives, seeds, bearing
patterns, radius variations, response limits, cancellation checks, concurrency
limit and loop-search deadline.

For loop fallback, the policy caps the accepted candidate pool at six. Provider
attempts can exceed six when responses fail or candidates are rejected, but the
attempt space remains finite and deadline-bounded. Work runs in bounded batches;
cancellation and the deadline are checked before and after routing batches and
while results are processed.

The direct-loop cohort may stop without fallback once the configured minimum
comparable count (currently two) is present and every candidate satisfies the
same high-quality checks below. The fallback itself may stop at three accepted
candidates only when v1 confirms three eligible, distinct selections, every
supplied distance/time target is within 15%, and no selected route has a
`physical_effort_harder_than_requested` warning. An Easy hiking request also
requires strong technical-classification coverage, and explicit major-road
avoidance requires strong road-class coverage, before the cohort is considered
complete. Otherwise fallback generation can continue to the six-accepted-
candidate cap. Bounded smaller/larger-radius retries remain available while
pool capacity remains and the cohort is not yet high quality; retry patterns
are derived from accumulated rejection evidence, while cancellation and the
existing deadline remain authoritative.

`LoopRouteVariantRanker.rank` passes the full bounded variant pool and the
complete original planning request—including difficulty and avoidance
features—through `RouteAlternativeQuality.select`. It therefore cannot discard
a road-avoidance or technical-fit candidate under a distance-only surrogate
request before the coordinator's final merge. After direct and fallback
candidates are merged, the production normalizer enters through the same v1
selector again so the combined cohort is revalidated and deduplicated.

Geometry work is bounded:

- pairwise similarity resamples each route to at most 192 points;
- repeated-segment geometry analysis resamples to at most 1,024 points;
- stable-key geometry uses at most 32 coordinate samples;
- a six-candidate pool has at most 15 pairwise comparisons.

Assessment telemetry records elapsed microseconds. Future asynchronous
enrichment must preserve cancellation, stay outside SwiftUI rendering, use a
cache key containing the policy version plus all relevant request/evidence
inputs, and must not turn the current synchronous in-memory selector into a
main-thread network operation.

## Release explanation and UI contract

Every item is typed as one of four roles:

- `primaryFit`: actual distance or duration versus the supplied target;
- `verifiedCharacteristic`: a fact reproducible from strong mapped evidence or
  measured geometry;
- `estimate`: the explicitly labeled physical-effort estimate;
- `limitation`: missing, partial or unsupported evidence relevant to the route.

Every item has a stable code, title, optional detail, SF Symbol and explicit
VoiceOver label. The engine creates at most two verified-characteristic items
and retains every distinct request-relevant limitation in its typed contract;
the card and detail views apply their own two/five-item presentation budgets.
This prevents a newly discovered limitation from silently crowding an explicit
road-avoidance or requested-preference disclosure out of the underlying result.
No raw objective value or aggregate score is rendered.

Route-card rules:

- retain the existing factual comparison badge for request fit/comparison;
- label the route difficulty badge visibly as estimated physical effort, not
  verified technical difficulty;
- render a separate “Route evidence” row only for verified routed results;
- show no more than two items, ordered as verified characteristics and then
  limitations; the visibly labeled effort badge avoids duplicating the estimate
  inside this small budget;
- keep requested-preference chips/context separate from verified evidence;
- communicate a limitation with wording and symbol, never color alone.

Route-detail rules:

- compute the route-local presentation once;
- label the header difficulty visibly as estimated physical effort;
- show “Why this route” after planning context and before the raw mapped
  characteristics section;
- show at most five items from request fit, physical-effort estimate, mapped
  evidence and limitations;
- if a limitation exists but the ordinary five-item prefix would omit every
  limitation, replace the last item with the first limitation;
- label each role explicitly and preserve logical Dynamic Type and VoiceOver
  reading order;
- keep safety guidance visible as a separate planning disclaimer.

`presentation(for:)` intentionally returns nothing for demo/unverified routes.
It reconstructs route-local facts from saved route data and deliberately omits
comparative claims that require a surrounding candidate cohort. During active
selection, a label such as “Lowest measured road exposure” is allowed only for
a unique minimum among the selected routes with strong road-class coverage.
“Best,” “safest,” “scenic,” “quiet,” “family-safe,” “perfect match” and similar
unsupported conclusions are forbidden.

## Evidence provenance, freshness and privacy limits

The current evidence source identifies its category and path-detail name, and
every metric has a typed freshness state. GraphHopper/OSM path-detail responses
do not provide a source timestamp through this app contract, so those known
metrics use `sourceTimestampUnavailable`. v1 makes no claim that mapped
classifications reflect current trail, access, weather or closure conditions.
A future evidence provider may supply a current or timestamp-derived state only
when the upstream source actually provides meaningful freshness metadata;
explicitly stale evidence must remain non-ranking.

The outdoor-evidence query seam accepts route geometry and an optional route
fact fingerprint. Geometry is sensitive location data. Before a real provider
replaces the no-op implementation, its transport, minimization, retention,
access control and deletion behavior require explicit privacy review. It must
not create location-history analytics or systematically call public
Overpass/Nominatim from the iOS app.

Current telemetry is intentionally aggregate and contains only:

- policy version;
- candidate, eligible and selected counts;
- typed rejection-category counts;
- assessment duration in microseconds.

It excludes prompts, coordinates, route titles, stable candidate keys, raw
provider bodies, provider errors, secrets and rejected-route persistence. No
third-party analytics are introduced by the quality engine.

## Deterministic offline validation

### 54-case ranking benchmark

The offline corpus is
`TrailMindTests/Fixtures/hiking_route_quality_v1_eval.json`; its executable
contract is `TrailMindTests/HikingRouteQualityEngineTests.swift`. The corpus is
versioned with schema `1`, benchmark kind `deterministic_engine_contract` and
policy `hiking-route-quality-v1`. It contains 54 cases, while the test gate
requires at least 40 unique cases so accidental fixture loss fails loudly.

This benchmark is separate from the protected 20-case live provider harness and
is safe to run without provider credentials. Synthetic routes in this suite
prove code behavior only; they are not provider proof or real-world
hiking-quality evidence.

Each fixture inherits the suite-level policy version and must declare:

- typed request;
- candidate route facts, geometry and mapped-evidence breakdowns;
- expected accepted and rejected candidate IDs with typed reasons;
- expected first route and final distinct selection;
- expected factual explanation codes and limitation codes;
- expected difference from the frozen baseline where relevant.

The fixture matrix must cover Easy, Moderate and Challenging hiking;
family/casual, distance-focused, duration-focused and lower-elevation intents;
major-road, steep-climb and repeated-path avoidance; loops and point-to-point
detours; partial surface, road-class and hike-rating coverage; conflicting
objectives; technical difficulty versus physical effort; malformed payloads;
underfilled positive-coverage surface and road-class breakdowns; near
duplicates; reversed geometry; stable ties; and all missing-data states.

Metamorphic/invariant tests must prove at least:

- increasing distance deviation cannot improve distance fit;
- increasing known major-road exposure cannot improve road-avoidance fit;
- increasing overlap cannot improve loop-quality fit;
- increasing known technical difficulty cannot improve an Easy fit;
- missing/low-coverage evidence cannot create a verified positive claim;
- a hard rejection cannot improve selection or be rescued by diversity;
- input reordering does not change deterministic ranking for stable candidates;
- reversed equivalent geometry is deduplicated;
- normalized objectives remain finite or explicitly unavailable;
- stable equal candidates use the documented key;
- rendered explanations match the evidence used by selection.

### Frozen pre-v1 comparison

`RouteAlternativeQuality.selectBaseline` is the frozen `pre-v1-baseline`
selector and exists only for deterministic regression comparison. Production
selection enters through `RouteAlternativeQuality.select` and policy v1.

The offline comparison must report, per fixture and in aggregate:

- first-choice changes and the objective/rejection that explains each change;
- hard-rejection changes;
- final-selection and near-duplicate/diversity changes;
- evidence-confidence and missing-data behavior changes;
- regressions requiring review.

Twenty corpus cases freeze an `expectedBaselineSelected` result, while the test
gate requires at least 12. The focused test verifies that the old selector has
not drifted, compares that
result with the golden v1 selection, and reports counts for first-choice,
overall-selection, hard-eligibility and evidence-confidence changes plus
reviewed regressions. Its summary always states `provider_proof=false`.

The current deterministic run compares 20 frozen cases: 17 first choices and
17 final selections change, 8 cases exercise hard-eligibility changes, 9
exercise evidence-confidence behavior, and 0 are marked reviewed regressions.
The three unchanged controls are the Easy distance-fit, Moderate distance-fit,
and distance-versus-duration tradeoff cases.

| Changed fixture | Frozen first choice | v1 first choice | Why v1 changes it |
| --- | --- | --- | --- |
| `explicit-major-road-hard-rejection` | `road-heavy` | `road-light` | Strong evidence above the explicit major-road limit is ineligible. |
| `partial-road-evidence-does-not-confirm-avoidance` | `partial` | `full` | Low coverage cannot confirm low exposure; complete evidence wins the remaining comparison. |
| `lower-road-exposure-without-hard-avoidance` | `road-heavy` | `road-light` | Known lower major-road exposure is preferred without turning it into a hard rule. |
| `paths-and-tracks-preference` | `few-paths` | `many-paths` | Strong road-class evidence supports the higher path/track share. |
| `easy-stable-surface-preference` | `rough` | `stable` | For an Easy intent, strong surface evidence supports the lower rough-surface share. |
| `easy-known-technical-hard-rejection` | `technical` | `basic` | A known demanding section beyond the Easy policy is ineligible. |
| `easy-partial-known-technical-hard-rejection` | `technical-partial` | `basic` | Known demanding distance is not hidden merely because total coverage is partial. |
| `moderate-known-technical-ranking` | `rating-two` | `rating-one` | Comparable known lower technical classification is preferred. |
| `challenging-known-technical-ranking` | `rating-three` | `rating-one` | Requested physical effort does not imply a preference for harder technical terrain. |
| `missing-vs-strong-evidence` | `missing` | `strong` | Missing mapped evidence is not equal to strong favorable evidence. |
| `partial-vs-full-evidence` | `partial` | `full` | Higher relevant coverage wins when request-fit facts are otherwise equal. |
| `malformed-coverage-rejection` | `malformed` | `valid` | Impossible coverage fails closed before ranking. |
| `malformed-hike-rating-rejection` | `malformed` | `valid` | An invalid hike-rating payload fails closed before ranking. |
| `malformed-negative-distance-rejection` | `malformed` | `valid` | Negative characteristic distance fails closed before ranking. |
| `route-type-mismatch-hard-rejection` | `wrong-type` | `correct-type` | Route type is a hard eligibility contract. |
| `activity-mismatch-hard-rejection` | `wrong-activity` | `correct-activity` | Activity/profile fit is a hard eligibility contract. |
| `deterministic-stable-tie` | provider-first route | stable-key route | Equal candidates use the documented provider-order-independent stable key. |

The acceptance criterion is improved behavior on explicit user-fit contracts,
not a higher self-defined score. The baseline comparator must remain frozen;
changing it invalidates longitudinal comparison.

### Future blind human benchmark

No human result is claimed by v1. A later study should use 30–50 hiking
requests across multiple regions and difficulty levels, TrailMind candidates
and legally obtained comparator or official published routes, and blinded
expert/user pairwise review. Reviewers should judge request fit, trail
suitability, technical appropriateness, road exposure, repetition, route
distinctness and explanation trust. The study must record reviewer disagreement
and missing-data cases, predefine analysis criteria, and avoid scraping
competitor data. No public “better than Komoot” claim is appropriate without
statistically meaningful, independently reviewable evidence.

## Live 20-case harness

The existing `TrailMindTests/Fixtures/route_quality_eval.json` live contract
remains exactly 20 cases and is unchanged by the separate offline ranking
benchmark. `RouteQualityEvaluationTests.testLiveRouteQualityEvalWhenEnabled`
must continue to fail closed when the count is not exactly 20 and must preserve
selected-test verification, redacted output and provider-proof checks.

No live route-quality evaluation is authorized or run as part of this v1
documentation. It may run only when all existing gates are explicitly true:

- `TRAILMIND_RUN_ROUTE_QUALITY_EVAL=1`
- `TRAILMIND_EVAL_CREDENTIALS_CONTAINED=1`
- `TRAILMIND_EVAL_PROVIDER_USAGE_AUTHORIZED=1`

Zero executed tests, skips, timeouts, malformed machine summaries, missing
provider proof and partial runs are failures, not baselines. Thresholds must not
be tuned from those outcomes.

## Versioning, telemetry and rollback

The policy raw value is attached to selection output and aggregate telemetry.
Thresholds, normalization, ordering, candidate/diversity caps and explanation
limits are policy-owned rather than UI-scattered. A shipped policy must not be
silently retuned; behavior-changing changes require an offline benchmark update
and a new policy version or an explicitly documented pre-release calibration.

Production integration is narrow: `RouteAlternativeQuality.select` delegates
to v1, while `selectBaseline` remains test-only. There is no remote runtime
quality-policy switch in v1. A rollback is therefore a reviewed code rollback
of that delegation to the frozen selector, followed by the same build and
deterministic regression gates. Rollback must not weaken structural eligibility,
change route provenance, rewrite saved routes or expose previously rejected
candidates without review.

Operational review should compare policy version, eligible/selected counts,
typed rejection distributions and assessment latency. An unexpected rise in
empty selections, malformed-evidence rejection, near-duplicate output or
latency is a rollback/investigation signal. Those aggregate diagnostics must
remain redacted. If quality results are cached later, the key must include the
policy version, relevant request constraints, route-fact fingerprint and
evidence version/freshness where actually available.

## Known v1 limitations

- Surface, road-class and hike-rating path details are the only mapped
  characteristic evidence currently consumed.
- Official hiking networks, verified POIs, access restrictions and slope remain
  explicitly unsupported.
- The engine has no weather, closure, trail-condition, quietness, viewpoint,
  water or scenery evidence.
- GraphHopper path-detail source timestamps are unavailable; their freshness is
  explicitly `sourceTimestampUnavailable`, not current.
- Physical effort is an estimate and not verified technical difficulty.
- Coverage is a disclosure measure and does not validate upstream map accuracy.
- The deterministic offline benchmark proves engine behavior, not route-provider
  or real-world superiority.
- The protected live baseline and future human benchmark remain separate proof
  gates.

## Recommended next agent

“Build the OSM/PostGIS Outdoor Evidence Service for verified POIs, official hiking networks and route-corridor enrichment.”
