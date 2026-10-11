# Backend route quality handoff — 2026-09-30

## Source and integration

This isolated branch, `codex/route-quality-20260930` in `/private/tmp/wanderful-route-quality-20260930`, starts at tested candidate `d3fc6b0222450bc1cc43b9e289712c77e443f2d0`. Its backend commits, in order, are:

1. `7feb0b3` — measure stop proximity along routed segments.
2. `2b4144f` — identify a specifically unreachable sourced stop for itinerary revision.
3. `68ed0b5` — keep unverified model review prose out of final route copy.
4. This alignment commit — use the same finite minor great-circle segment calculation, first valid ordered position and 100 m stop corridor as the iOS schema-3 client.

The iPhone candidate `d40a206945c781619948ca2cedbc74c4543642b3` already includes the independent iOS fix `1594e69`. Its backend tree remains `b1b0b37d8b4fc1939cbc16d7a75deed3c304365b`. Apply this branch's backend commits in order to that candidate; no iOS source from this branch is needed. Resolve any later backend changes by reviewing the exact diff rather than replacing the backend tree wholesale.

## Contract and behavior

- A routed stop midway between encoded GraphHopper vertices can be reached. The backend measures to finite minor great-circle arcs and keeps waypoint order by fractional route progress, including a later revisit and date-line crossing. Schema-3 dynamic routing uses the native 100 m corridor; the older LLM-first evaluator retains its 150 m default. Snapped target and actual path are still separate checks.
- A failed snap or genuinely unreachable selected stop returns only its registered OSM ID to the planner as revision feedback. A wrong visit order does not blacklist the place. Unverified geometry and statistics are not returned as an accepted route.
- An explicit unsupported safety or drinking-water guarantee in Gemini's final quality review is rejected. Successful final review copy is generated from GraphHopper's verified distance and a generic unresolved-preference notice; model-authored summary and remaining-wish prose stays internal to revision and cannot become API advice. The iOS client independently constructs its displayed explanation from validated route data.
- The historical Berlin “We couldn't finish that route” receipt was an HTTP 400 at `/api/route` before GraphHopper. Its exact validation cause was not retained. These changes do not claim to repair that separate historical incident.

## Verification and limits

- Exact independent QA file `backend/quality-gates/routeAcceptance.test.js` from the QA branch was copied temporarily into this isolated checkout and run against these backend sources: **10 passed, 0 failed**. Both originally red probes (sparse-segment stop and unsupported safety/water guarantee) are green. The temporary file was removed; the QA branch was not merged.
- Focused routing/evaluator tests after alignment: **47 passed, 0 failed**, including 98/102 m boundaries and first valid segment on a revisiting loop.
- JavaScript build after alignment: **385 files checked, 0 failures**.
- Before the final spherical alignment, the full offline backend suite passed **1556, failed 0, skipped 1** with local loopback permission. It has not been repeated after alignment because of the low free-space gate; the alignment changes are covered by the focused tests and build above.
- iOS `IOS-STOP-TRUST.md` reports **43 native tests passed** and a Debug simulator build for the independent client patch. No combined app/backend live run is claimed here.

No production deployment, remote push, provider call, secret inspection, database migration, account deletion or weather change occurred. The backend production owner alone controls the bounded Harz and Queenstown live acceptance prompts in the independent QA review. Those receipts are still required before claiming end-to-end geographic acceptance.
