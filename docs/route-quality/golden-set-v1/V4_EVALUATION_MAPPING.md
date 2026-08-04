# TrailMind Golden Set V1 — V4 Evaluation Mapping

Status: **PREPARED, NOT EXECUTED**

This document maps Golden Set V1 to a future bounded V4 proof. It does not authorize provider traffic, execute V4, import data, provision PostGIS, boot a Simulator, use App Attest, or modify historical receipts.

## Immutable inputs

Before a future run, hash and treat as read-only:

- `docs/release/OUTDOOR_ADVENTURE_END_TO_END_STAGING_PROOF_V1.md`
- `docs/release/OUTDOOR_ADVENTURE_END_TO_END_STAGING_PROOF_V1.summary.json`
- `docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V2.md`
- `docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V2.summary.json`
- `docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V3.md`
- `docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V3.summary.json`
- the official 18-case summary and any protected release receipts named by `docs/operations/closed-beta-readiness-v1/V4_OPERATIONAL_PROTOCOL.md`.

V1, V2, and V3 receipts must remain byte-for-byte unchanged. V4 receives a new receipt namespace and must record matching pre/post hashes.

## Two-axis V4 evaluation

V4 records two independent outcomes for every canonical case:

- `technicalPipelineOutcome`: `pass`, `fail`, or `not_run`, derived only from routing and unchanged geometry, access, lineage, provenance, containment, and structural-sanity gates;
- `productQualityOutcome`: `pass`, `partial`, `fail`, or `not_applicable`, derived from intent fit after technical evaluation.

Technical success never implies product-quality success. Distance ratio `0.55...1.75`, duration ratio `0.40...2.50`, repetition no more than 55%, and loop-shape quality at least `0.025` remain unchanged technical sanity limits. A product-quality pass additionally requires distance inside the normalized range or within 15% of an exact target, duration inside its range or within 20% of an exact target, and accidental backtracking and overlap each no more than 35%.

## Canonical four-case mapping

The future provider order remains exactly the operational protocol's order. The golden case supplies evaluation semantics; it does not replace or alter the canonical fixture input.

| V4 order | Existing canonical ID | Golden Set V1 case | Purpose |
| ---: | --- | --- | --- |
| 1 | `case-15-partial-provider-failure-survivor` | `harz-v1-route-coherence-010` | Controlled survivor: a genuine provider success must precede the proof-only controlled failure and a different genuine route must remain independently eligible. |
| 2 | `case-04-harz-brocken-must-have-landmark` | `harz-v1-peak-focus-005` | Canonical Brocken: compare access snap, route-to-access, original-evidence approach, target deviation, repetition, provenance, and unchanged eligibility. |
| 3 | `case-07-innsbruck-viewpoint-loop` | `innsbruck-alps-v1-viewpoint-focus-004` | Innsbruck viewpoint: determine whether the V2 access coordinate corrects the prior provider-snap/highlight-reach failure without upgrading mapped access into public access. |
| 4 | `case-08-innsbruck-easy-conservative-loop` | `innsbruck-alps-v1-easy-loop-001` | Innsbruck easy: obtain a real bounded result only while the circuit remains closed and verify conservative difficulty, ascent, route coherence, and truthfulness. |

No substitute or reordered case may consume the V4 authorization. Golden Set additions remain provider-free unless separately authorized in a later protocol.

## Required V4 metrics

For each real validated route alternative, retain only bounded values already allowed by the V4 protocol:

| Golden dimension | V4 metric |
| --- | --- |
| Geometry integrity | `verifiedGeometry`, point-count bucket, order verified, loop-closure boolean, typed structural rejection |
| Access-candidate quality | selected candidate within 75 m of eligible mapped trail; source segment and candidate lineage present, without coordinate retention |
| Provider access snap | distance from provider snap to requested trail-access coordinate; within-100-m boolean |
| Geometry to access | closest route distance to requested access coordinate; within-100-m boolean |
| Geometry to highlight | closest route distance bucket to original evidence coordinate |
| Highlight result | `reached`, `passes_near`, `not_reached`, or `unverified` |
| Must-have satisfaction | required count, strictly reached count, silent-drop count |
| Distance fit | provider distance bucket, normalized target/range, deviation percentage, `within_target` or `outside_target` |
| Duration fit | provider duration bucket and target deviation where requested |
| Elevation/difficulty | ascent bucket, verified difficulty state, typed constraint result |
| Repetition | self-backtracking ratio, self-overlap ratio, intentional-spur review classification |
| Variant diversity | pairwise similarity bucket and near-duplicate rejection count |
| Path/road evidence | bounded coverage and path/track/major-road ratios only when contract-verified |
| Evidence quality | source class, accepted/quarantine state, freshness class, region containment, lineage booleans |
| Explanation | typed limitation/rejection codes and manual expert decision |
| Provider accounting | case/proposal attempt count, typed provider outcome, duration bucket, circuit state, remaining authorization |
| Feature state | initial, execution, and terminal feature-flag digests; ordinary/insecure flags false |
| Technical outcome | `pass`, `fail`, or `not_run`, with first decisive technical gate |
| Product outcome | `pass`, `partial`, `fail`, or `not_applicable`, with first decisive product-quality guard |

Do not retain coordinates, geometry, route shape, provider-snapped points, raw distance series, raw prompts, provider URL/body/header, database URL, credential, App Attest material, private start name, or temporary path.

## Highlight approach mapping

For every selected highlight V4 must prove the chain in order:

1. original evidence identity and coordinate were preserved in the transient validated input;
2. trail-access candidate was derived from eligible current mapped trail geometry within 75 m;
3. provider snap to the requested access coordinate was no more than 100 m;
4. finished route geometry approached the access coordinate within 100 m;
5. finished geometry approached the original evidence coordinate;
6. state was derived as `reached` at no more than 25 m, `passes_near` over 25 m through 100 m, `not_reached` over 100 m, or `unverified` when steps 3 or 4 failed;
7. hard roles were eligible only when `reached`;
8. provenance tied evidence, access candidate, selected waypoint, provider attempt, route result, and quality result together.

Provider snapping alone never proves a visit. `providerVerifiedAccess` proves provider/geometry approach to an access coordinate only; it does not prove public access, legality, opening, scenery, or safety.

## Per-canonical-case decision rules

### Controlled survivor

Record `technicalPipelineOutcome: pass` only when:

- the controlled failure is armed after a genuine strict provider success;
- that success is counted as provider success and separately as controlled post-success failure;
- another independently routed alternative survives all unchanged geometry, access, provenance, containment, distance/duration sanity envelopes, 55% repetition ceilings, and explanation-integrity gates;
- no failed route is relabeled eligible to create a survivor.

Record `productQualityOutcome: pass` only when the independently surviving alternative also falls inside the applicable distance and duration quality boundaries, has accidental self-backtracking and accidental self-overlap each no more than 35%, satisfies all must-haves, and contains no forbidden claim. A survivor between 35% and 55% accidental repetition is rejected for product quality; it cannot pass merely because it remains below the structural ceiling. A 35–55% result may be `partial` only for a localized, worthwhile, expert-reviewed terminal spur serving a required highlight.

The V3 result failed because both independently evaluated routes exceeded the unchanged backtracking policy. V4 must report the current outcome; it must not weaken the 55% ceiling or promote technical survival into case success without a product-quality pass.

### Canonical Brocken

V4 may separately prove `technicalPipelineOutcome: pass` when Brocken is strictly reached as a must-have with complete V2 access lineage and at least one route passes all unchanged technical gates. That proves the routable-highlight access layer for this case; it does not prove route quality.

Record `productQualityOutcome: pass` only when the strictly reached Brocken route is also inside the normalized 13.5–16.5 km range and passes every other product-quality guard. V3's 23.799 km result was 58.66% longer than the nominal 15 km request and approximately 44.24% above the normalized maximum. Even if V4 proves its technical access chain and structural eligibility, that measured result is `productQualityOutcome: partial` only when the required peak genuinely necessitates and clearly explains the deviation; otherwise it is `fail`. It is never a successful product-quality result and never a close match.

### Innsbruck viewpoint

Record technical pass only when the required viewpoint is strictly reached, the V2 access coordinate passes both 100 m checks, and all other technical gates pass. Record product pass only when target, duration, repetition, difficulty, and explanation quality guards also pass and the explanation does not claim public access or guaranteed views. V1/V3's mapped-evidence/provider-graph mismatch is the comparison baseline; a provider failure or `not_run` is not improvement evidence.

### Innsbruck easy

Record technical pass only when a real result is available and hard geometry/access gates pass. Record product pass only when verified difficulty fits the conservative request, distance and duration are inside their quality boundaries, accidental repetition is no more than 35%, ascent and target fit are honestly described, and the route is manually judged suitable with stated caveats. If the circuit opens first, record `technicalPipelineOutcome: not_run` and `productQualityOutcome: not_applicable`; do not infer quality.

## Additional provider-free Golden Set cases

The following cases require no V4 provider traffic and should be evaluated offline/manually from strict fixtures, fixed receipts, contracts, source-state simulations, or synthetic geometry:

- `harz-v1-easy-loop-001`: beginner-sensitive easy loop and group constraints;
- `harz-v1-exact-distance-008`: exact-target bands and optional-detour removal;
- `harz-v1-current-evidence-gap-011`: stale/missing current access must remain partial;
- `harz-v1-unsupported-013`: camping and drinking-water guarantees fail honestly;
- `innsbruck-alps-v1-water-feature-006`: three must-have lakes and ordered strict reach;
- `innsbruck-alps-v1-facility-preference-007`: hut preference cannot become current lunch/opening fact;
- `innsbruck-alps-v1-group-constraint-012`: difficult terrain cannot satisfy a family Easy request;
- `innsbruck-alps-v1-unsupported-013`: point-to-point, live transport, and live opening expectation remains unsupported.

All other noncanonical cases are also provider-free for V4. A later live proof would require a new authorization, new ceiling, new ledger, and explicit protocol version.

## Evaluation record per case

Each V4-linked case record must include:

- canonical ID and Golden Set case ID;
- region, activity, route type, expected and observed planning state;
- expected and observed `technicalPipelineOutcome` plus first decisive technical gate;
- expected and observed `productQualityOutcome` plus first decisive product-quality guard;
- source snapshot and policy-version digests;
- access-candidate, provider-snap, geometry-to-access, and geometry-to-highlight metrics;
- reached/passes-near/not-reached/unverified state for every selected highlight;
- provider target deviation and duration/ascent buckets;
- backtracking, overlap, and diversity metrics;
- evidence freshness and provenance result;
- provider accounting classification;
- feature-flag state digest;
- manual expert decision and first improvement category;
- typed limitations and rejections;
- explicit zero false-claim counters.

## Comparison and reporting rules

- Compare only identical canonical IDs under unchanged thresholds.
- Compare the technical and product-quality axes independently; never collapse them into one pass flag or score.
- Report improvement only when the same metric exists in both runs.
- Report regressions, missing evidence, provider failures, and circuit-stopped cases explicitly.
- Never aggregate the four cases into a score that allows one pass to cancel another failure.
- V4 provider success does not prove App Attest, database readiness, route eligibility, or closed-beta GO.
- Manual review does not prove current real-world safety or access.

## Completion boundary

A future V4 run is complete only after provider accounting reconciles, transient resources are removed, protected receipts re-hash identically, the disabled zero-work probe passes, and `finalFlagsDisabled=true` plus `cleanupComplete=true` are recorded.

Even a fully passing V4 leaves beta status **NO-GO** until `CLOSED_BETA_ACCEPTANCE_POLICY_V1.md` and the repository-wide machine-readable checklist are independently satisfied.
