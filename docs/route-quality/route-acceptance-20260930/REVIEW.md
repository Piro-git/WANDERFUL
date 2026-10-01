# Independent route acceptance review — 2026-09-30

## Scope and receipt

Reviewed immutable integration source `d3fc6b0222450bc1cc43b9e289712c77e443f2d0` from `codex/integrated-candidate-20260929`. This QA branch contains only an explicit offline Node contract suite and this review. No provider, production, database, device, weather or App Attest call was made. The fixture names and coordinates are synthetic.

Run from the repository root:

```sh
node --test backend/quality-gates/routeAcceptance.test.js
```

Result on Node 22.22.3: **10 tests, 8 pass, 2 fail, 0 skip**. The two failures are intentional acceptance probes against current product behavior; this branch is a gate artifact and is not a green production candidate. The suite exercises the production place parser, model-tool planner, central route adapter, GraphHopper response evaluator, source reconciliation and media identity validator behind deterministic provider fixtures. Southern midlatitude and northern high-latitude/date-line loops both pass the full offline chain. No second route engine is implemented.

## Findings, ordered by release impact

### P1 — A supported-looking reviewer sentence can claim unverified safety or water

`backend/src/dynamicResearch/quality.js:11-24` validates the review object's shape and evidence ID membership, but never checks that the `summary` claim is supported. `backend/src/dynamicResearch/planner.js:324,343` returns this string after a `complete` decision. The native client puts it directly into visible route copy at `TrailMind/Services/DynamicResearchPlanningClient.swift:298-306`.

Reproduction: `routeAcceptance.test.js` test **“a final reviewer cannot promote an unsupported safety and water guarantee to UI copy”** injects a completed model review saying “This route is guaranteed safe and has drinking water.” The only research evidence is a synthetic mapped viewpoint identity with no water or safety fact. The route succeeds; the expected rejection is missing. This is a contract gap, not evidence that the live model has emitted that sentence. A prompt telling Gemini not to make such claims does not make output validation deterministic.

**No-go** for an unreviewed production run that presents `qualityReview.summary` as verified route advice. Require the live output to be inspected against its cited source passages, and add a fail-closed product treatment for unsupported safety, water, legal-access or scenic guarantees. If text cannot be verified, label it as an unverified preference/assessment or omit it.

### P2 — Valid stop on a sparse routed segment is rejected

`backend/src/llmPlanning/llmFirstPlanningOrchestrator.js:492-508,777-783` measures stop approach only to polyline vertices. `backend/src/dynamicResearch/routing.js:55-56` relies on that value. The native check independently repeats vertex-only search at `TrailMind/Services/DynamicResearchPlanningClient.swift:268-274`.

Reproduction: `routeAcceptance.test.js` test **“a path that passes through a stop between encoded vertices satisfies the stop corridor”** puts a synthetic stop exactly on a 1.6 km line segment midway between encoded points. Requested and snapped stop coincide; the returned route passes through it. The backend returns `waypoint_not_reached`. The native check would also reject the route. The replacement check must measure to finite segments and preserve monotonic stop order by along-line position; wrap longitude near ±180° and scale longitude at high latitude. Keep the separate snapped-target and actual-route checks. A boundary entrance may count only as reaching the entrance; it cannot prove a visit to the POI center.

## Production Go/No-Go run: exactly two free prompts

The backend owner `01a0dd4f-371b-7f61-8c27-c4cbf26f9c84` alone owns bounded live calls. Use these exact original prompts once each in the selected production configuration, without hand-editing parsed intent, coordinates, POIs or route order:

1. **German Harz loop:** “Plane eine ungefähr 10 km lange Rundwanderung ab Schierke im Harz. Baue einen echten, namentlich belegten Aussichtspunkt als Zwischenstopp ein und führe zum Start zurück. Wenn Quellen oder begehbare Wege dafür fehlen, sage das offen.”
2. **New Zealand loop:** “Plan an approximately 8 km loop hike starting at Queenstown Gardens, New Zealand. Include one real, named viewpoint as an intermediate stop and return to the start. If sources or walkable paths are insufficient, say so clearly.”

These are geographically distinct prompts, not guaranteed-success fixtures. A documented failure to find a sourced and walkable route is an honest product response but **does not count as a passed route-generation example**. Both accepted routes must pass every applicable gate below before claiming geographic generality for this two-case pilot. Do not broaden that claim beyond these cases.

| Stage | Receipt the owner must retain, with secrets and private data redacted | Pass criterion / honest failure |
| --- | --- | --- |
| Original request and intent | Exact prompt, request ID, `parserSource`, resolved public start, route type, activity, target distance, hard constraints, feature flags | Remote AI parser succeeded; `routeType=loop`, `activityType=hiking`; no local/mock fallback. Otherwise fail with explicit reason. |
| Grounded research | Gemini search and successful page-read evidence, citation URL and cited span, retrieval time, named claim | At least one successful read-backed citation; a citation attributes a statement only. Missing read/source is an explicit research failure, not a plausible POI substitute. |
| Mapped stop identity | Selected OSM type/id, exact OSM URL, name, category, coordinate, version, snapshot and access evidence; any entrance target separately identified | Each selected stop has a unique, inspected OSM identity, snapshot age ≤7 days and coordinate within discovery radius. Name/category alone cannot prove viewpoint quality or current access. Excluded/ambiguous identities fail. |
| Ordered itinerary | Ordered selected IDs; GraphHopper request points in `[longitude, latitude]`, start, at most three intermediate targets, return to start, `profile=foot` | Every routed ID was disclosed before routing; target order is monotonic along final geometry. No model-supplied geometry or unsourced detour. Other profiles fail this hiking run. |
| Route geometry | GraphHopper response provenance, raw geometry and snap waypoints, route-response digest, independent segment-distance calculation | Valid finite lon/lat; distance to the actual finite path ≤100 m for each selected target, including a point between vertices; if an entrance is used, label it as entrance reached, POI visit unconfirmed. Start/end closure ≤100 m. Date-line/high-latitude calculations must use wrapped longitude; no impossible world-spanning segment. Missing connection fails. |
| Measured statistics | Raw `distance` meters, `time` milliseconds, `ascend` meters or explicit absence, displayed distance/duration/ascent, requested target | Displayed distance differs by ≤0.1 km, duration by ≤1 minute, ascent by ≤1 m after documented rounding. Independent geodesic polyline length and provider distance ratio must be 0.90–1.10. A missing ascent is shown as unavailable, never zero. |
| Requested distance | Raw provider distance versus 10 km / 8 km prompt | Accepted soft range: 80–130% of target (8.0–13.0 km; 6.4–10.4 km). Always show actual measured distance and deviation. Do not use “exact match” unless deviation ≤5%; a partial match must name unmet wishes. Hard maximums, if parsed, have zero overage. |
| Text, claims, UI | Final quality decision, summary, remaining wishes, cited claim-to-place mapping, native card/detail screenshot or structured UI receipt | No unverified guarantee about safety, water, legal access, view quality or trail conditions. Every displayed named highlight binds to selected OSM ID and actual reached route target. “Complete” cannot hide an unmet named stop. No accepted route is shown after parser/source/path failure. |
| Photos, if shown | OSM direct `File:` or Wikidata QID/P625/P18 chain, exact Commons file/page, media URL, license URL and artist credit, selected POI ID and UI source action | Photo identity and subject match that specific selected stop; Wikidata coordinate ≤250 m from the OSM point; supported license and full credit visible. Manually inspect the image subject, not just metadata. Bad match/credit is a fail. No photo is an acceptable neutral fallback. |

For both cases, additionally record the stop-to-segment distance in meters and segment progress, closure distance, provider/polyline ratio, target deviation percentage, and each failure code. Use only the two public prompts and public place coordinates in shared receipts. Never log API keys, authorization tokens, private user location or raw unrelated prompts.

## Decision rule and handoff

**Current decision: no-go for claiming end-to-end production acceptance.** The offline suite has two reproducible failing contracts; there are no bounded live receipts for these two prompts in this review. The coordinator should integrate this QA branch separately from route-engine fixes. After fixes, rerun the explicit suite and require **10/10 passing**, then let the backend owner run the two bounded prompts and apply the table above. An honest source/path failure remains a fail for the two-case route-generation claim, while preventing a misleading route is the correct product behavior.
