# Independent route quality review — 2026-10-01

## Source and decision

Reviewed the recovered published source tree `12f1ac6f16730809b70f895e2d9811a697fe4fc6` (backend tree `52e7a7913e2db06fc1e44e42655ce927f2ef2165`) in an isolated, self-contained checkout. This branch changes only quality tests and this review. It makes no production, database, provider, iPhone or secret changes.

**Current route-quality decision: NO-GO for an end-to-end production claim.** The prior 10-case acceptance suite is now green, including the previously failing segment-stop and unsafe-review cases. Two new provider-consistency acceptance cases fail. No two-region live Gemini → sourced POI → GraphHopper → Commons receipt for this exact backend tree was available to this reviewer. An offline mock success is not a live route or a phone result.

## Reproducible new finding

### P2 — Overstated distance passes as a verified route statistic

Trigger: a deterministic GraphHopper-boundary fixture reports `paths[0].distance` at **125%** of the great-circle length of its supplied route polyline. All route coordinates are flat 3D points (`[longitude, latitude, 0]`), with zero ascent/descent and straight legs. The response also has matching instruction distance, a valid foot profile, closed loop, reachable ordered stops and plausible time. `createDynamicItineraryRouter` returns `accepted: true` and publishes the overstated distance. Neither omitted bends in this fixture nor elevation can account for its 25% gap.

Source: `backend/src/llmPlanning/llmFirstPlanningOrchestrator.js:162-176` permits a distance/polyline ratio from 0.72 to 1.38; `backend/src/dynamicResearch/routing.js:61` then labels `path.distance` as measured statistics. Reproduce with:

```sh
node --test backend/quality-gates/routeReview20261001.test.js
```

Observed: the distance case expects rejection but receives `accepted: true`. A second test divides the same flat legs into 900 collinear segments, still reports 125% of geometric distance, and is also accepted. Vertex density does not create unobserved turns, so a tolerance that grows without bound per point would miss this variant. These are contract vulnerabilities under synthetic provider data, **not** evidence that GraphHopper has returned a bad live path. The adapter requests `elevation: true` and `points_encoded: false`, without overriding simplification (`backend/src/routing/graphHopperProvider.js:104-130`). GraphHopper's [routing source](https://github.com/graphhopper/graphhopper/blob/master/core/src/main/java/com/graphhopper/routing/Router.java) sets a 0.5 m default simplification distance; its [path merger](https://github.com/graphhopper/graphhopper/blob/master/core/src/main/java/com/graphhopper/util/PathMerger.java) retains a full path distance while simplifying the returned points. Those upstream defaults make a 25% gap in these flat, straight fixtures implausible, but the hosted API configuration and real response distribution have not been measured here. The repository does not explain or support the current 0.72–1.38 acceptance interval with empirical receipts.

The smallest product fix is a provider/geometry consistency rule that rejects this exact flat 25% fixture, with an explicit allowance justified by real elevation and simplification evidence. **Do not impose 10% globally solely from this synthetic test.** The regression should assert no published statistics on rejection. If the live provider yields such a legitimate ratio, retain the raw 3D points/instructions and explain why before choosing its bound.

### P2 — Two tolerated gaps can move a selected POI 178 m off the actual route

Trigger: a synthetic provider response snaps a selected POI 89 m toward the route, then reports that snap 89 m from the routed line. The two independent values each pass the 100 m check in `backend/src/dynamicResearch/routing.js:63-64`; the direct finite-segment distance from the **selected source coordinate** to the **actual path** is 178 m. The result is nevertheless `accepted: true` with `targetReached: true` (`routing.js:80`). The sixth test in `routeReview20261001.test.js` reproduces it.

GraphHopper's [path-merger source](https://github.com/graphhopper/graphhopper/blob/master/core/src/main/java/com/graphhopper/util/PathMerger.java) checks that snapped waypoints occur on its path before simplification, so this synthetic inconsistency is not evidence of an observed live response. It exposes a missing end-to-end check against the promised route-line tolerance. The smallest fix is an additional direct finite-segment distance from each requested POI or documented entrance target to the validated path, ≤100 m, while retaining separate snap, approach and monotonic-order checks. On failure, provide revision feedback and publish no reached highlight or verified statistics.

## Gates checked on the integrated tree

| Area | Implemented | Locally proved | Live / phone status |
| --- | --- | --- | --- |
| Free prompt to sourced stop IDs | Original German and Japanese free-text prompts pass unchanged into the deterministic research interaction; tool calls can select only disclosed OSM IDs. Web research requires a read-backed envelope. | Two geographically distinct synthetic loops pass the entire local parser-of-OSM-records → tool planner → route adapter chain. This proves structural handling, **not Gemini's semantic understanding** of either language. | Two-region live provider ledger is owned by the backend task; not yet independently reviewed here. Phone UI acceptance remains with the integrator. |
| Walkable geometry and ordered stops | Hiking uses GraphHopper `foot`; measured geometry must reach snapped stops in monotonic order. | Existing 10/10 QA tests pass. New 20 km sparse segment at 75°N crossing ±180° passes; reverse stops on one segment fail; loop endpoint >100 m from start fails. **178 m direct POI-to-route gap still passes via two 89 m component checks: open P2.** | Actual trail access, graph coverage and legality require live source and local checks. |
| Route statistics and target | Distance, time and ascent come from the routing response; 20% target deviation is permitted with actual distance in explanation. | New target-deviation case passes. **25% provider/polyline mismatch is accepted with sparse and dense flat vertices: open P2.** | Compare raw provider geometry and stats on each bounded live route. No displayed value should be inferred from target distance. |
| Place and photo identity | OSM URL binds object ID. Direct `File:` or Wikidata QID/P625/P18 binds the Commons file; license and artist credit are required. | Mismatched object, far Wikidata coordinate, wrong file and missing credit are rejected by deterministic tests. | Metadata cannot establish that a photograph visibly depicts the claimed POI; inspect the actual image subject and source on both live cases. No generic landscape may be used as route proof. |
| Overnight places and weather | Stays are labelled partial, with straight-line offset and unknown access/legality; weather failure displays unavailable and leaves the route unchanged. | Targeted stay and weather tests pass after making the sparse fixture and existing dependency package visible to this isolated checkout. Source inspection confirms cautious DE/EN copy in `RouteStaysView.swift` and unavailable state in `RouteWeatherCard.swift`. | Weather runtime and stay coverage are not a safety clearance. Phone display and real provider state remain open. |
| Claims and fallback | Final free-form model review prose is replaced by measured/cautious public copy; failed research does not silently become an AI route. | Prior unsafe-claim and missing-source probes pass. | Each live named highlight still needs a matching selected OSM identity, routed approach ≤100 m, and a source passage or explicit “unverified” treatment. |

## Test receipts and limits

- `node --test backend/quality-gates/routeAcceptance.test.js`: **10 pass, 0 fail**. The two historical red cases from 2026-09-30 are now green.
- `node --test backend/quality-gates/routeReview20261001.test.js`: **5 pass, 3 fail** (two variants of the distance P2 and one direct POI-distance P2).
- Targeted dynamic routing, segment, media, stays and weather suites: **52 pass, 0 fail** after fixture/dependency visibility was corrected. The first sparse-checkout run had two environmental `ENOENT`/`pg` failures; those are not product defects and were rerun successfully. No test was skipped to obtain this count.
- `node backend/scripts/check-javascript.js` from `backend/`: **386 files checked, 0 failures**.
- The GitHub owner reports the historical Git checks now pass on hosted CI with full history. It is investigating **18 CA fixture failures** in the current run; they are outside this route-quality test and remain an open CI gate. This review did not rerun or reclassify those failures.

The prior [2026-09-30 acceptance plan](../route-acceptance-20260930/REVIEW.md) contains the exact two public live prompts and per-stage numeric criteria. Its two code findings are historical and fixed in this tree. Its 0.90–1.10 geometry/statistic ratio is a proposed review gate, **not an established global GraphHopper invariant**; the backend owner should check real 3D geometry and simplification before fixing a permanent bound. The other live evidence requirements remain applicable. The backend owner alone should spend the bounded live calls. Independently inspect its immutable receipts for prompt → Gemini search/page reads → OSM object and ordered IDs → foot GraphHopper geometry/stats → segment distances → Commons photo identity/credit → final UI. A failed source or path lookup must yield an honest failure, not a substitute route. One or two successful places do not establish worldwide coverage.
