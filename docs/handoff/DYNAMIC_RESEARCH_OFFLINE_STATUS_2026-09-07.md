# Dynamic research implementation checkpoint

## Scope and status

Work remains in the single isolated owner task. No agents/tasks were created, no other checkout was modified, no push/merge/publication occurred. The active goal is not complete. No new live provider calls, owner session, tunnel, device install or data erasure occurred during this implementation.

The former diagnostic session remains exhausted at two Google attempts, zero GraphHopper calls. Its two HTTP 500 outcomes establish a failure in initial remote intent parsing, not its root cause. Error payloads from that session were discarded; new private error classification can diagnose a future authorized call. The four-second research selector was never reached in that session.

## Implemented

- New default-off backend schema 3 at the existing `/api/llm-plan-route`, retaining legacy schema 1/2 behavior.
- Original prompt plus independently resolved anchor, normalized route parameters, explicit hard limits and remote parser provenance reach a bounded Gemini Interactions function loop.
- Dynamic OSM discovery in the anchor area has no approved-region gate. Source identity, recorded category, version, snapshot freshness and radius are validated. No fabricated places or geometry.
- Model tools search places, inspect IDs, route ordered inspected IDs, receive measured feedback, revise distinct itineraries and finish an accepted result. Model prose/coordinates never become route facts. Thought/signature steps are preserved in stateless history exactly as documented.
- Central GraphHopper routing and existing path/statistics/snap/order/detour/backtracking/access checks remain the source of geometry. Hard distance/time/elevation and evidenced road/repetition constraints reject violations. Unsupported hard crowd/steepness exclusions fail explicitly. Soft distance range is 80–130% of target.
- Optional Wikidata evidence requires explicit OSM Q-ID link and nearby Earth coordinate. Photos require a unique linked P18 file, exact Commons identity, recognized license URL and usable attribution. Missing enrichment/photos are omitted; unrelated media are not substituted.
- Native owner-only client sends schema 3 for research-enabled loops after remote parsing and Apple geocoding. Existing standard point-to-point behavior remains. The client validates route geometry, source identity/freshness, ordered approaches and hard distance/time before displaying a suggestion.
- Route detail adds source links, snapshot dates and photo credits while preserving MapKit and the local packing card. Optional persisted source fields preserve old saved records and route IDs; copy helpers retain evidence. Checklist code/storage is unchanged.
- Private runtime accepts dynamic schema 3 only through explicit dynamic allowance setup. A separate ledger version adds per-provider source accounting and refuses any reinterpretation of old ledgers. Legacy defaults/caps are unchanged. No allowance is automatically granted or reset.

## Deadline and accounting chain

Initial parse chain is unchanged: backend 15 seconds, native HTTP 20 seconds, wrapper 22 seconds. Dynamic routing replaces the unsuitable single-selector chain with one explicit request-wide deadline: backend 150 seconds, native HTTP 160 seconds, planner wrapper 165 seconds. Individual Gemini calls are bounded at 30 seconds, OSM at 10 seconds, Wikidata/Commons at 5 seconds; central routing retains its own bound and receives parent cancellation. Every tool checks request-wide cancellation and capacity before work. No automatic provider retries.

Per dynamic request maxima: eight Gemini generations, two searches, ten distinct source reads, three route attempts, three photos, twenty tool calls, 512 KiB history. These are upper bounds rather than targets. The session ledger imposes independent durable aggregate caps and reserves before network IO.

Node `server.requestTimeout` remains 45 seconds because it bounds receiving the HTTP request body, not the completed response. Existing HTTP cancellation propagation remains in use.

## Verification

- Offline native flow exercised the actual owner HTTP server, remote parse endpoint, schema-3 endpoint, Gemini interaction adapter, OSM adapter, GraphHopper adapter and durable accounting with synthetic upstream fixtures. It reached an evaluated route with three sourced stops and five counted Google requests, one OSM request and one GraphHopper request. Apple geocoding was represented by an explicit fixture anchor; this is not live acceptance.
- 121 focused backend tests executed and passed. Broader focused suite logs: `/private/tmp/wanderful-dynamic-final-backend.log`.
- Swift application and test bundle build succeeded for arm64 simulator: `/private/tmp/wanderful-dynamic-swift-tests-build.log`. Tests were compiled, not executed; the simulator remains unbooted pending the existing permission question.
- Signed device build succeeded at `/private/tmp/Wanderful-AI-Phone-Products-20260906`, log `/private/tmp/wanderful-dynamic-device-build.log`. Strict deep codesign verification passed; bundle identity is `com.example.owner.wanderful.local`, all three owner research/remote flags are true, and OwnerPhoneTest.json is absent. The missing nonsecret empty temporary entitlements file was recreated before this successful build. No install occurred.
- Phone last recheck: known iPhone 17 Pro listed as unavailable. No install attempted.

## Remaining before completion

1. Diff whitespace checks and signed artifact verification passed. Execute native regressions when simulator boot is authorized; test bundles include native contract, source preservation and existing checklist regressions.
2. Obtain one explicit adequate live allowance. Proposed aggregate ceiling: 30 Gemini generations, 10 GraphHopper calls, 8 OSM queries, 30 Wikidata reads and 10 Commons metadata reads, including all failures/retries, one fresh 30-minute session. This covers up to three complete flows (regional loop, unrelated-region loop, phone acceptance), bounded routing revisions and initial provider diagnosis. Do not start it until approved and phone readiness is confirmed.
3. Diagnose initial Google HTTP 500 with retained bounded error codes; if needed use the prepared schema control only within that same approved ceiling. Do not invent a root cause or silently change providers.
4. Verify real model-selected IDs, source timestamps, measured paths and hard constraints through the native contract. Coverage is source-dependent, not universal. The public Overpass adapter is a bounded owner-test choice, not production hosting infrastructure.
5. Only after successful live verification, inject a fresh validated private OwnerPhoneTest.json into a successfully built app, re-sign/verify, install in place without uninstall, and coordinate one original user-authored request plus checklist reopen/persistence acceptance.

Do not report this feature as working from fixtures, database readiness, compilation, signing or installation alone.

## Connectivity review follow-up

An offline review found that central GraphHopper `route_not_found` errors bypassed the model revision loop. The dynamic router now converts only the typed, provider-confirmed missing-connection outcome into `route_connection_not_found` feedback, without inventing statistics. Service, quota, configuration, timeout and cancellation errors still propagate and cannot trigger a hidden route retry.

Nine focused tests executed and passed in `/private/tmp/wanderful-connectivity-revision-offline.log`, including the real owner HTTP composition with stubbed upstream responses: the first route returns a missing connection, the next Gemini turn receives that evidence and requests a distinct reversed stop order, and the second route passes evaluation. Durable accounting includes both attempts. No live provider calls or new owner session occurred. The previously built signed iOS artifact is unaffected by this backend-only change.
