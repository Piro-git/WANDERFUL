# Outdoor Adventure Targeted Live Route-Quality Proof V2

Date: 2026-08-03

Repository baseline: `e0df14204ab959edb7bfae4711109065e8f39ada`

Classification: `targeted_server_side_live_route_quality_proof`

Result: **failed / pre-provider blocked**
Closed-beta eligible: **no**

## Product outcome

The reviewed corrections could not be evaluated with real GraphHopper routing
in this V2 run. Current mapped evidence was recreated successfully, but the
unchanged 2.5-second repository statement timeout was reached before provider
scheduling on the live proof path. The proof failed closed and made zero
GraphHopper calls. It therefore establishes neither usable routes nor a route-
quality regression for Brocken, either Innsbruck case, or the controlled-
survivor case.

This is a bounded non-production engineering proof. It is not the official
18-case staging proof, a production proof, a provider-superiority study, a
physical-iPhone/App Attest proof, or release/closed-beta approval.

## Baseline and safety controls

- `HEAD` and `origin/main` both equalled the expected baseline before the run.
- Reviewed commits `2d8842e` and `e0df142` were present consecutively.
- The worktree and index were clean, and 10.9 GiB was free.
- No other proof, PostGIS, PBF-import, or provider process was active. One
  loopback development server was idle and had no established connections.
- The provider credential was available only through the approved backend
  loading mechanism. It was not inspected, printed, copied, hashed, logged, or
  retained. `Configuration/Local.xcconfig` was not inspected.
- No provider URL, database URL, raw provider response, complete route
  geometry, precise request coordinate, raw prompt, or App Attest data is
  retained here.
- All ordinary feature flags remained false. No production timeout or global
  database configuration was changed.

## Current-data evidence receipt

Geofabrik publisher MD5 receipts were retrieved and verified against every
download before derivation. The four source files shared the replication
timestamp `2026-08-02T20:21:48Z`.

| Source | Bytes | Publisher MD5 | SHA-256 |
|---|---:|---|---|
| Niedersachsen | 501,413,482 | `4ac6b17d9a98198d36e10bbb4d8048c3` | `5c2a33356ffb8b18ba2af20454730ff85bc1877d7ced20614c62950da43cefdd` |
| Sachsen-Anhalt | 173,200,038 | `394d54e841049a69e7301581accebb33` | `0fbe876bec0d8a0afed3d5f21da63e9e58d013ce43fe911bc743e2dccda25dbe` |
| Thueringen | 158,894,938 | `31892c3394b8224bcb776d07a6af7b15` | `6a514b59f3461c82126ae1af6980bd7ffd2145becd74d6cc2ed4bd3e916073d8` |
| Austria | 805,816,738 | `170e08020c2755fd1be3ae8bb84e61f1` | `8859b3241cd410bd5c7bd7b6db17c35df7eb25a70142c0b7bcd436ff6cf5b7f7` |

Existing reviewed operational polygons were used with `complete_ways`; Harz
was formed from the three bounded German extracts. Both derivatives had zero
missing way-node references.

| Region | Derivative bytes | SHA-256 | Nodes | Ways | Relations | Last object timestamp |
|---|---:|---|---:|---:|---:|---|
| Harz | 40,342,586 | `a9a6bf09f67e197b1dc676bf26296d64a3a46c785858df5abe34506f6a4837df` | 3,775,333 | 562,204 | 8,232 | 2026-08-02T20:01:41Z |
| Innsbruck Alps | 24,417,930 | `4fb5286710c78dfc7bec3638373e66e4c83ee310114e96b55210df0bc929f252` | 2,470,462 | 245,533 | 4,570 | 2026-08-02T18:31:39Z |

## Disposable PostGIS evidence

The proof used loopback-only PostgreSQL 17.10 with PostGIS 3.6.4, GEOS 3.14.1,
and PROJ 9.8.1. Migrations 001–005 applied once; the second migration run was a
true no-op with exactly five recorded versions. `work_mem` was set to 64 MB
only for the disposable database.

The reviewed `osm-foundational-mapped-v1` policy was activated only in that
database. The imported raw evidence and final active projections were:

| Region | Imported POIs | Imported trails | Imported relations | Entities | Assertions | Relationships | Quarantine |
|---|---:|---:|---:|---:|---:|---:|---:|
| Harz | 2,951 | 140,612 | 887 | 144,450 | 167,356 | 29,308 | 0 |
| Innsbruck Alps | 1,620 | 74,674 | 498 | 76,792 | 91,398 | 7,711 | 0 |

The first Harz final projection and the first Innsbruck dry run timed out fail-
closed. Identical, unchanged warm-cache retries completed and were promoted:
Harz in 98,484 ms and Innsbruck in 118,434 ms. Provenance was complete, the
cross-region intersection count was zero, and both candidate and trail legs of
the 75 m query used the reviewed GiST index. The projection contained 143,563
Harz geometries (142,746 covered, 817 out-of-boundary audit geometries) and
76,294 Innsbruck geometries (75,958 covered, 336 audit geometries). Runtime
queries excluded audit geometries with `ST_CoveredBy`.

Evidence was current under the reviewed 14-day maximum. No quarantine,
provenance, regional-isolation, containment, or spatial-index invariant failed.

## Exact provider-call accounting

| Measure | Count |
|---|---:|
| Authorized hard limit | 15 |
| Attempted | 0 |
| Successful | 0 |
| Failed | 0 |
| Timed out | 0 |
| Cancelled | 0 |
| Controlled failure after success | 0 |
| Unused | 15 |

No canary or case route call was launched. The guarded live runner entered the
real evidence/research path, timed out before provider-ledger reservation, and
returned the existing safe `timed_out` classification. Consequently there was
no `Retry-After` observation, provider response, provider latency, or provider
reliability result to reconcile.

## Targeted case results

| Case | Target | Last proven stage | Provider calls | Result |
|---|---:|---|---:|---|
| Brocken must-have loop | 15 km | current PostGIS research | 0 | failed: `repository_timed_out` before candidate/provider |
| Innsbruck viewpoint loop | 12 km | current PostGIS research | 0 | failed: `repository_timed_out` before candidate/provider |
| Innsbruck conservative easy loop | 8 km | candidate-ready in bounded preflight; live path later timed out | 0 | failed: no provider evaluation |
| Controlled partial-provider-failure survivor | 12 km | current PostGIS research | 0 | not exercisable without a genuine provider success |

Brocken therefore has no new finding about must-have reach, snapping,
distance, closure, overlap, backtracking, waypoint ordering, or provider graph
connectivity. A route was not forced.

The Innsbruck viewpoint request likewise has no new routed result. For the easy
fixture, one candidate-only preflight produced three proposals and nine
selected viewpoints. All nine were active, same-region, accepted by the source
policy, non-quarantined, and retained their original POI coordinates; no access
point was invented. The three proposal groups had mapped-trail proximity
distances of `1.4/5.2/28.1 m`, `3.1/3.4/0.0 m`, and `3.4/0.0/1.6 m`. This
validates the 75 m filter at candidate selection only. These distances are not
GraphHopper snap distances, and the later guarded live attempt failed in
research before any route was requested.

The controlled-survivor seam was not used because its prerequisite—a genuine
real GraphHopper success—did not exist in V2. No provider failure was relabelled
as a controlled failure, and no invalid survivor was selected.

## Route-quality metrics

There were no real V2 routes. Distance, target deviation, duration,
ascent/descent, maximum provider snapping, reached-waypoint ratio, loop
closure, self-backtracking, self-overlap, trail ratio, path/track ratio, major-
road ratio, eligibility, and typed route rejection reasons are therefore all
not observed. Evidence freshness was the only requested quality input proven
current. Reporting zeros for the absent route metrics would be misleading.

The V1 Innsbruck diagnostic remains immutable historical evidence: 21.201 km
for the same 12 km viewpoint request, 76.67% target deviation, zero of three
selected viewpoints reached, and 427.6 m maximum provider snapping. V2 has no
GraphHopper result to compare, so it cannot claim that the 75 m proximity
correction materially improved or worsened those values.

## Defect and decision

The targeted live proof exposed a pre-provider performance blocker in current-
data mapped-route membership lookup. A diagnosis used a 15-second statement
timeout only in a disposable diagnostic session; it did not alter the
application or proof path and made no external request.

| Case | Capability | Highlights | Mapped-route membership | Assertions | Total |
|---|---:|---:|---:|---:|---:|
| Brocken | 90 ms | 330 ms | 5,160 ms | 130 ms | 5,760 ms |
| Innsbruck viewpoint | 0 ms | 700 ms | 1,650 ms | 110 ms | 2,480 ms |
| Innsbruck easy | 0 ms | 60 ms | 520 ms | 70 ms | 680 ms |
| Controlled survivor | 0 ms | 140 ms | 900 ms | 100 ms | 1,150 ms |

Brocken clearly exceeds the unchanged 2.5-second repository statement timeout;
the viewpoint case sits too close to that limit to be stable on a cold path.
No production code, query, timeout, policy threshold, or configuration was
changed in this proof. The next task should optimize and regression-test mapped-
route membership against current regional volumes, then rerun these exact
fixtures with a newly authorized provider budget.

## Verification

- Focused candidate/repository/GraphHopper/server-live/staging-harness tests:
  107 passed, 0 failed.
- Real disposable PostGIS plus App Attest integration tests in a separate test
  database: 42 passed, 0 failed, 0 skipped.
- Complete backend suite: 577 passed, 0 failed, 0 skipped. An earlier sandboxed
  run had 17 localhost `listen EPERM` failures; the unrestricted rerun passed.
- Backend build: passed.
- Canonical offline quality evaluation: 101/101 passed with zero bounds,
  determinism, false-claim, high-stakes-authority, must-have, provenance,
  route-verification, or waypoint-connection violations.
- No Xcode run was required because no Swift file changed.
- `git diff --check -- docs` passed; both new untracked files also passed
  independent no-index and trailing-whitespace checks.
- The changed-artifact credential/provider-URL scan passed. The generated-
  artifact scan found zero retained PBF, provider-ledger, receipt, database, or
  socket artifacts. The feature-flag scan found all six ordinary flags false.

## Historical and release state

The historical V1 proof files were not modified. Their Git blob IDs remain
`cf537251a564409cfe1e885774ae989bb328b35e` and
`e14663f579e2824e66df054914f5aa1b6665014b`. The official 18-case summary
remains `not_run`; its Git blob ID remains
`043770b8b670a31e1c678bba1ada24dca5572d83`.

The targeted V2 status is **failed** with reasons
`pre_provider_repository_timeout`, `real_route_quality_not_evaluated`,
`brocken_and_innsbruck_routes_missing`, and
`controlled_survivor_not_exercised`. It grants no closed-beta approval,
physical App Attest claim, production claim, or provider-superiority claim.
All ordinary feature flags remain false.

## Cleanup

The disposable cluster was stopped and port 55432 was confirmed non-responsive.
The task-owned 2.9 GB proof root—including PBF derivatives, database files,
temporary scripts, receipts, and the empty provider ledger—was removed. The
evidence can be recreated from the checksummed publisher sources above.

Nothing was staged, committed, pushed, deployed, or enabled by this proof.
