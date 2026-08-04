# TrailMind Expert Route Quality Golden Set V1

Status: **benchmark policy and fixtures; no current build is beta-ready**

Retrieval and policy date: **2026-08-04**

## Purpose

This package defines a durable expert benchmark for judging whether a TrailMind hiking or trail-running recommendation is truthful, coherent, useful, and compatible with the user's intent. It evaluates real routed results and their evidence. It does not create routes, prove current conditions, tune a provider, or declare one product superior to another.

The benchmark covers 26 cases: 13 in `harz-v1` and 13 in `innsbruck-alps-v1`. Its supported surface is hiking and trail-running loops. Point-to-point, out-and-back, biking, multi-day planning, navigation, weather, camping, public transport, current closures, drinking-water guarantees, and legal-overnight guarantees appear only as clarification, partial, no-viable-route, or unsupported expectations.

All thresholds below are **Golden Set V1 evaluation policy**. They are conservative product rules, not scientific claims or universal hiking truths.

## Package

- `golden-cases-v1.json`: 26 deterministic cases, a typed two-axis outcome contract, and expected behavior.
- `source-manifest-v1.json`: public-source scope, licensing, attribution, freshness, and claim limits.
- `EXPERT_REVIEW_FORM.md`: reusable bounded review form.
- `CLOSED_BETA_ACCEPTANCE_POLICY_V1.md`: future regional acceptance gates; every current requirement is unproved.
- `V4_EVALUATION_MAPPING.md`: mapping to a future bounded V4 proof without executing it.

The fixture contains no route geometry, raw provider response, provider URL, credential, secret, private coordinate, real-user prompt, or protected proof coordinate. Named public landmarks are references, not routable waypoints.

## Duplicate-work and baseline gate

Before creation, the repository was verified on `main` with:

- `HEAD == origin/main == e36e529fcefe767e04cb76b63edc393a31419e52`;
- empty staging index;
- clean worktree;
- no requested file or equivalent golden-set implementation in current paths or Git history;
- no other active Codex task owning `docs/route-quality/golden-set-v1/`.

If this package is revised later, the same duplicate-work gate applies. Do not create a second package under a different name.

## Authoritative committed contracts

Golden Set V1 preserves the current separation between:

1. original evidence coordinate;
2. OSM-derived trail-access candidate;
3. provider-snapped coordinate;
4. finished route geometry;
5. strictly reached highlight;
6. highlight merely passed near;
7. highlight not reached;
8. unverified access.

The current committed policies used as the baseline are:

- `research-trail-access-candidates-v1`: an access candidate must be within 75 m of current eligible mapped trail geometry; eligible highway classes are `path`, `footway`, `track`, `steps`, `bridleway`, and `pedestrian`.
- `research-guided-route-candidates-v2`: hard roles are `must_have`, `facility_candidate`, and `overnight_candidate`; optional roles are `preferred` and `available_candidate`; optional near-duplicates within 50 m and optional candidates on the same mapped segment within 250 m are removed; a required straight-line lower bound more than 15% above the requested maximum is a material required detour.
- `research-guided-routing-adapter-v2`: provider snap to the requested access coordinate and route geometry to that coordinate each use 100 m limits; evidence approach is reached at no more than 25 m and passes-near at more than 25 m through 100 m.
- `hiking-route-quality-v1` and `RouteAlternativeQualityPolicy.preBaseline`: real geometry, real provider distance/duration/elevation, structural loop checks, explicit hard envelopes, independent objectives, and no opaque aggregate score.
- regional evidence policy: both region definitions require current evidence, with a 14-day freshness threshold and exact regional containment.

Current orchestration states are exactly:

- `clarification_required`
- `unsupported`
- `no_viable_route`
- `partial`
- `routed`

Candidate-plan-only states such as `ready` and `insufficient_evidence` must be translated by the orchestration layer and are not valid expected final states in this fixture.

## Two-axis outcome contract

Golden Set V1 schema version 2 evaluates three separate facts:

- `technicalPipelineOutcome`: `pass`, `fail`, or `not_run`. `pass` means at least one evaluated route passes routing, geometry, evidence-lineage, access-verification, provenance, containment, and structural-sanity gates.
- `productQualityOutcome`: `pass`, `partial`, `fail`, or `not_applicable`. `pass` means a presented route also serves the expressed intent inside every applicable product-quality boundary.
- `caseEvaluationOutcome`: `pass` or `fail`. A case passes only when the observed planning state and both observed outcomes match the fixture, every applicable validation rule passes, and no forbidden claim occurs.

Technical pipeline success never implies product-quality success. The distance ratio `0.55...1.75`, duration ratio `0.40...2.50`, 55% repetition ceilings, and loop-shape floor `0.025` are fail-closed corruption and structural-sanity limits only. They are not definitions of a good route.

Negative cases pass evaluation by stopping or failing honestly. For example, a correctly unsupported request has `technicalPipelineOutcome: not_run`, `productQualityOutcome: not_applicable`, and `caseEvaluationOutcome: pass`. A truthful no-quality-match case can similarly expect product failure while passing the benchmark evaluation.

## Case distribution

| Region | Cases | Routed | Partial | Clarification | No viable route | Unsupported |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Harz | 13 | 5 | 4 | 2 | 1 | 1 |
| Innsbruck Alps | 13 | 5 | 4 | 1 | 2 | 1 |
| **Total** | **26** | **10** | **8** | **3** | **3** | **2** |

Each region has one case in every category:

`easy_recreational_loop`, `moderate_loop`, `trail_running_loop`, `viewpoint_focus`, `peak_focus`, `water_feature`, `facility_preference`, `exact_distance`, `multi_must_have`, `route_coherence`, `current_evidence_gap`, `group_constraint`, and `unsupported_expectation`.

Tags inside each case provide overlapping coverage for approximate distance, duration targets, same-corridor highlights, terminal spurs, optional removal, broad or ambiguous geography, unknown access, missing official/current evidence, and difficult terrain inconsistent with an easy request.

## Technical pipeline and hard eligibility gates

Technical hard gates are evaluated before product-quality judgment. One hard failure cannot be offset by another good dimension. Passing every gate below establishes technical eligibility only; product-quality pass still requires the stricter target-fit and repetition boundaries in the following section.

A result is not fully eligible when any applicable condition holds:

- geometry has fewer than two valid points, is malformed, is shorter than 100 m, lacks finite positive routed distance, or lacks positive duration;
- a loop has fewer than four points or its endpoint gap exceeds `min(250 m, max(75 m, 1.5% of geometry length))`;
- activity or route type differs from the structured intent;
- a required highlight lacks a valid access candidate, provider snap, route-to-access approach, complete lineage, or strict `reached` classification;
- provider snapping to the selected access coordinate exceeds 100 m or route geometry remains more than 100 m from it;
- a known prohibition or closure is contradicted;
- a hard technical-difficulty or explicit group constraint is violated;
- actual/target distance is outside `0.55...1.75`, or actual/target duration is outside `0.40...2.50`;
- self-backtracking or self-overlap exceeds 55%;
- loop shape quality is below `0.025`;
- an explicitly avoided major-road share exceeds 25% when road-class coverage is at least 60%;
- a known demanding technical section of at least 100 m exceeds an Easy request;
- a point-to-point result has detour ratio above 5.0 and more than 10 km excess over direct distance;
- the route leaves the supported region;
- a must-have is silently dropped;
- provenance is incomplete or inconsistent;
- a preference or mapped feature is presented as a verified route fact;
- safety, legality, public access, scenic quality, water, opening, or current conditions are falsely claimed.

Near-duplicate alternatives at or above 86% symmetric similarity in a 35 m corridor are excluded from selection. This is a diversity rejection, not proof that either underlying route is poor.

## Explainable quality dimensions and thresholds

`Not measurable` is a legitimate outcome. Missing data never becomes a favorable zero.

### Target-distance fit

Only provider-routed distance is authoritative.

| Request | Excellent | Good | Acceptable | Partial concern | Technical hard failure |
| --- | --- | --- | --- | --- | --- |
| Exact target | within 5% | over 5% through 10% | over 10% through 15% | over 15% but inside structural envelope; no product pass | ratio outside `0.55...1.75` |
| Approximate target | inside normalized range | not applicable for product pass | not applicable for product pass | outside normalized range but inside structural envelope; no product pass | ratio outside `0.55...1.75` |
| Requested range | inside range, near midpoint when choices are otherwise equal | not applicable for product pass | not applicable for product pass | outside range but inside structural envelope; no product pass | ratio outside `0.55...1.75` |
| Missing target | not measurable | not measurable | not measurable | none | none |

A full `productQualityOutcome: pass` requires the route to be inside a normalized approximate/requested range or within 15% of an exact target. More than 15% outside an exact target, or any result outside an applicable normalized range, cannot receive a full product-quality pass even when it remains inside the structural envelope. A verified must-have may justify `partial` when the necessary deviation is measured and explained; otherwise revise, reject, or return no viable quality match. Such a result never receives `close match` or equivalent wording. Optional highlights should be removed when their straight-line lower-bound contribution or routed detour damages target fit.

### Target-duration fit

Only provider-routed duration is authoritative.

| Band | Threshold |
| --- | --- |
| Excellent | within 5% of an exact target or inside the requested range |
| Good | within 10% of target or nearest range bound |
| Acceptable | within 20% of target or nearest range bound |
| Partial concern | outside 20% but inside the structural envelope |
| Technical hard failure | actual/target ratio outside `0.40...2.50` |

A full `productQualityOutcome: pass` requires duration inside the requested range or within 20% of an exact target. The `0.40...2.50` ratio remains a technical structural-sanity envelope only.

### Required-highlight satisfaction

- Hard failure: any required role is not strictly `reached`, is unverified, or lacks complete provenance.
- Acceptable: every must-have is reached and no required count is silently reduced.
- Good: acceptable plus ordering is geographically coherent.
- Excellent: good plus every must-have materially contributes to the stated experience without avoidable route damage.
- Not measurable: no verified route/access chain exists; the result must remain partial or no-viable-route.

### Optional-highlight value

- Hard failure: an optional preference is presented as required or verified without evidence.
- Acceptable: optional candidates do not cause a hard gate or material target miss.
- Good: low-value same-corridor, near-duplicate, or target-damaging candidates are removed.
- Excellent: each retained optional detour adds a distinct, evidence-backed experience and expert review judges it worthwhile.
- Not measurable: no optional highlight is retained or its value cannot be verified.

### Access-point and highlight approach

- Hard failure for a required highlight: no valid access candidate; access candidate more than 75 m from eligible mapped trail evidence; provider snap more than 100 m; route-to-access more than 100 m; or evidence approach over 25 m.
- Acceptable: verified access chain and `reached` at no more than 25 m.
- Good: acceptable with clear original/access/snap/route lineage and no unexplained approach anomaly.
- Excellent: good with current public-access evidence where that claim is required; otherwise public access remains explicitly unknown.
- Not measurable: provider snap or route/access evidence is missing.

### Route coherence

- Hard failure: invalid/open/degenerate geometry, wrong order, severe accidental repetition, or a route that cannot be understood as the requested experience.
- Acceptable: valid loop with explainable sequence.
- Good: highlights follow a geographically sensible order with no obviously needless corridor changes.
- Excellent: the route reads as one worthwhile outing; each major segment has a clear purpose.
- Not measurable: no valid geometry.

### Repeated segments and backtracking

| Band | Accidental self-backtracking or overlap |
| --- | ---: |
| Excellent | at most 10% |
| Good | over 10% through 20% |
| Acceptable | over 20% through 35% |
| Partial only under the terminal-spur exception | over 35% through 55% |
| Hard failure | over 55% |

A full `productQualityOutcome: pass` requires accidental self-backtracking and accidental self-overlap each to be no more than 35%. Between 35% and 55%, `partial` is permitted only for a localized terminal spur serving a required highlight that expert review classifies as worthwhile. Accidental or diffuse repetition in this band is rejected. Intent never waives the 55% structural hard ceiling.

### Path/trail preference and road exposure

Ratios are measurable only with at least 60% route coverage.

- Path/track preference: excellent at 80% or more, good at 70% or more, acceptable at 60% or more.
- Major-road exposure when explicitly avoided: excellent at no more than 1%, good at no more than 5%, acceptable at no more than 15%, partial concern over 15% through 25%, hard failure over 25%.
- Below 60% coverage: not measurable; do not describe missing evidence as quiet, trail-heavy, or road-free.

### Elevation and difficulty fit

- A verified technical class above `maximumTechnicalDifficulty` is a hard failure.
- For an Easy request, at least 100 routed metres of known demanding technical terrain is a hard failure under the current engine.
- An explicit maximum elevation gain is a Golden Set hard constraint only where the case's hard gates say so; otherwise ascent is an independent fit dimension and limitation.
- Good and excellent judgments require both measured ascent and verified difficulty evidence; length, altitude, or tourism color alone is not a safety conclusion.
- Missing difficulty evidence is not measurable and must remain visible.

### Variant diversity

- Hard failure: duplicate geometry is presented as a distinct option.
- Acceptable: one eligible route when only one exists, or two alternatives below 86% similarity.
- Good: two distinct routes with a meaningful measured trade-off.
- Excellent: three distinct routes with clear factual differences and no manufactured labels.
- Not measurable: fewer than two valid alternatives.

### Evidence completeness and freshness

- Hard failure: missing/dangling provenance, wrong-region evidence, quarantined evidence, or a positive claim based on expired/unknown evidence.
- Acceptable: all decision-critical claims have lineage; missing facts are limitations.
- Good: accepted source, observation/retrieval time, license classification, and claim scope are complete.
- Excellent: good plus current high-authority evidence for every high-stakes claim actually made.
- OSM-derived regional evidence older than 14 days is stale for this benchmark.
- Current-status, opening, water, legal-access, and closure evidence uses the source-specific cadence in `source-manifest-v1.json`; absence never means favorable.

### Explanation quality and uncertainty honesty

- Hard failure: any forbidden claim, opaque score overriding a hard gate, hidden must-have shortfall, or close-match language outside the applicable band.
- Acceptable: actual route facts, limitations, and requested preferences are clearly separated.
- Good: the explanation names the decisive fit and limitation in concise factual language.
- Excellent: a reviewer can reproduce why the result is routed, partial, rejected, or unsupported from the bounded evidence.
- Not measurable: no user-facing explanation exists.

## Highlight approach semantics

For each selected highlight, retain and review:

- original evidence coordinate;
- derived trail-access coordinate and its source mapped trail segment;
- provider-snapped coordinate and snap distance to the requested access coordinate;
- route distance to the access coordinate;
- route distance to the original evidence coordinate;
- role and complete provenance.

The state is:

- `reached`: provider/access verification passes and route distance to original evidence is no more than 25 m;
- `passes_near`: provider/access verification passes and evidence distance is over 25 m through 100 m;
- `not_reached`: provider/access verification passes and evidence distance exceeds 100 m;
- `unverified`: provider snap or route-to-access verification does not pass.

Provider snapping alone never proves a visit. `passes_near` never satisfies an explicit required visit. A hard-role result is eligible only when its state is `reached`.

## Distance and backtracking semantics

- Exact targets are evaluated against the exact target; approximate values are normalized into an explicit range before routing.
- A requested range is evaluated against its bounds, not an invented midpoint target.
- No target produces `not measurable`, not a perfect fit.
- Straight-line lower bounds are pre-provider feasibility signals only. They never become route distance.
- Required highlights remain in the plan when their detour is necessary, but the result becomes partial if fit is materially worse and must disclose that trade-off.
- Optional candidates are removed first when the lower bound exceeds the requested maximum, prioritizing the candidate whose removal most reduces the lower bound.
- Optional near-duplicate access candidates within 50 m and optional same-segment candidates within 250 m are removed.
- Required same-corridor highlights remain but carry `required_mapped_corridor_risk`; a provider route still has to pass the unchanged overlap/backtracking gates.
- Shorter and longer results use measured delta language. They are not relabeled as close matches.
- Variant overlap at or above 86% means near-duplicate geometry, even if traversal direction is reversed.

## Known implementation-policy discrepancies

- The current quality engine treats ascent largely as an independent ranking/warning dimension, while the intent contract can express a maximum elevation gain. Golden cases that explicitly make the ceiling hard must therefore be enforced by the evaluator until the production eligibility layer carries the same rule.
- The production structural envelopes intentionally remain broader than Golden Set product-quality boundaries. Evaluators must preserve both layers and must never translate structural eligibility into product-quality success.
- The V3 Brocken result measured 23.799 km for an approximately 15 km request. Its geometry may remain technically eligible, but its 58.66% nominal-target deviation is `productQualityOutcome: partial` or `fail`, never `pass`; a future full pass must also fall inside the normalized 13.5–16.5 km range.
- Public tourism pages provide useful reference expectations but are not runtime evidence and generally do not grant route-data reuse.
- Current official closure/opening feeds are not licensed and integrated for both regions. Cases requiring those facts must remain partial, no-viable-route, or unsupported.
- V3 showed that mapped trail proximity did not by itself correct provider snapping or viewpoint reach. V2 access coordinates require the separately authorized V4 proof.

## Evaluation sequence

1. Validate fixture and source-manifest schemas and IDs.
2. Resolve final planning state and clarification behavior.
3. Validate provider geometry and measured stats when a route exists.
4. Validate access lineage and highlight approach for every selected highlight.
5. Derive `technicalPipelineOutcome` from routing and hard technical gates.
6. Independently apply distance, duration, repetition, must-have, and truthfulness guards to derive `productQualityOutcome`.
7. Evaluate the remaining independent quality dimensions; do not collapse them into one score.
8. Apply diversity selection.
9. Complete the expert review form with both outcomes.
10. Compare the observed planning state and both outcomes with the case expectation.
11. Derive `caseEvaluationOutcome`; a negative case passes only by matching its expected bounded failure or stop state.

## Safety and claim boundary

Every real route remains a planning aid. The benchmark never permits a claim that a route is guaranteed safe, legal, open, scenic, supplied with water, or suitable for every member of a group. Required participant-facing copy remains:

> AI-assisted route. Review before starting. Check weather, local rules, trail conditions and water availability. Outdoor conditions can change quickly.
