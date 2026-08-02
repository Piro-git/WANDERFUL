# Outdoor Adventure Server-Side Live Pipeline Proof V1

Date: 2026-08-02

Repository baseline: `102ab5289518b2dfeaae5fb22256eeb3ded7e611`

Classification: `server_side_live_pipeline_proof`

Result: **failed / incomplete**
Closed-beta eligible: **no**

This is a bounded engineering proof of TrailMind's server-side research-guided
route-planning pipeline using current mapped evidence in disposable PostGIS and
real GraphHopper responses. It is not the official 18-case staging proof, a
provider-superiority study, a production proof, a physical-iPhone App Attest
proof, or a release/closed-beta approval.

## Scope and controls

- Only the reviewed eight-case Harz/Innsbruck subset was executed.
- The hard GraphHopper budget was 25 `/route` calls and is fully exhausted.
- The provider credential was loaded only by the approved backend runtime. It
  was not read, printed, copied, hashed, or retained in an artifact.
- Raw provider responses, request URLs, credentials, coordinates, and complete
  route geometry were not retained in the summary.
- No deployment, release enablement, feature enablement, production-user
  request, or `Configuration/Local.xcconfig` inspection occurred.
- The ordinary runtime feature flags remained disabled throughout the proof.

## Evidence acquisition and disposable database

Publisher checksums were verified before bounded derivatives were made from
Geofabrik's 2026-08-01 extracts. Both derivatives had zero missing way-node
references:

| Region | Source timestamp | Derivative bytes | Nodes | Ways | Relations |
|---|---:|---:|---:|---:|---:|
| Harz | 2026-08-01 19:53:56Z | 40,340,276 | 3,775,287 | 562,190 | 8,232 |
| Innsbruck Alps | 2026-08-01 20:20:44Z | 24,413,558 | 2,470,223 | 245,488 | 4,568 |

Migrations 001–005 applied on the first run and the second migration run was a
true no-op. The resulting active, provenance-complete projections contained:

| Region | Entities | Assertions | Relationships | Quarantine |
|---|---:|---:|---:|---:|
| Harz | 144,445 | 167,351 | 29,308 | 0 |
| Innsbruck Alps | 76,761 | 91,359 | 7,711 | 0 |

Cross-region intersection count was zero. The entity and trail-segment spatial
indexes were observed. The disposable database was loopback-only; application
timeouts were not changed. Only that database's `work_mem` was raised to 64 MB
after a projection checkpoint exceeded the default memory profile.

## Exact provider-call accounting

| Measure | Count |
|---|---:|
| Hard limit | 25 |
| Attempted | 25 |
| Successful provider responses | 16 |
| Failed provider responses | 9 |
| Timed out | 0 |
| Cancelled | 0 |
| Controlled failure after success | 0 |

The 25 calls reconcile as follows:

- 3 successful initial canary calls preceded the target-aware candidate-shaping
  correction and were superseded rather than presented as final case receipts.
- 21 calls belong to the retained eight case receipts: 12 successful and 9
  failed.
- 1 final, single-proposal Innsbruck diagnostic call succeeded at the provider
  but its route failed the unchanged quality policy.

Calls 16–24 all failed with the same 144-byte response size and 30 ms recorded
latency. The first harness revision did not retain a safe provider error code,
so the cause is unconfirmed. A later single call succeeded. That sequence is
consistent with a transient upstream/burst rejection, but this proof does not
claim a confirmed rate-limit response.

## Case results

| Case | Region | Calls | Result | Quality outcome |
|---|---|---:|---|---|
| 01 Ilsenburg loop, viewpoints/forest | Harz | 3 | Pass | 2 eligible, 1 rejected for excessive snapping |
| 02 Schierke easy loop, avoid roads | Harz | 3 | Pass | 3 eligible; 0 major-road ratio |
| 03 trail-running loop | Harz | 3 | Pass | 3 eligible; activity preserved through pipeline |
| 04 Brocken must-have landmark | Harz | 3 | Fail | 0 eligible; snapping/backtracking rejection |
| 05 unsatisfied must-have | Harz | 0 | Pass | Correct fail-closed `no_viable_route` |
| 07 Innsbruck viewpoint loop | Innsbruck | 3 | Fail | All three provider attempts failed |
| 08 Innsbruck conservative loop | Innsbruck | 3 | Fail | All three provider attempts failed |
| 15 controlled partial failure | Harz | 3 | Fail | Upstream attempts failed before controlled injection |

Overall retained-case result: 8 executed, 4 passed, 4 failed, 0 not run.

## Route-quality observations

- The corrected Ilsenburg canary produced eligible 16.559 km and 15.605 km
  loops. Both reached every selected evidence waypoint; maximum snapping was
  45.7 m and 5.2 m respectively.
- The three Schierke alternatives were 10.908–12.130 km, reached every selected
  waypoint, used predominantly path/track road classes, and recorded no major
  road share.
- The Brocken alternatives were correctly rejected. Two had self-backtracking
  above 0.80 and every alternative exceeded the waypoint snapping tolerance
  (100.6–657.4 m).
- The final Innsbruck diagnostic returned one real 21.201 km GraphHopper loop
  backed by the current PostGIS dossier. It was rejected because it missed the
  12 km target by 76.67%, reached none of three selected viewpoints, and had a
  427.6 m maximum snap distance. It is evidence of a real end-to-end provider
  response, not an eligible route.
- The controlled-survivor case was not exercised because all three real
  provider attempts failed before the post-success controlled failure could be
  injected.

## Defects found and narrow corrections

1. **Publisher cadence was treated as evidence expiry.** A normal daily extract
   slightly older than 24 hours was incorrectly marked stale despite the
   reviewed 14-day region/policy maximum. The repository now treats refresh
   cadence as metadata and enforces only explicit reviewed maximum-age limits.

2. **Exact-distance loops were under-shaped and shortest-first.** A single
   highlight could collapse into a short out-and-back. Exact-distance loop
   planning now uses up to three evidence-owned shaping waypoints and ranks
   candidate envelopes by target fit before lower-bound tie-breaking.

3. **One rejected proposal could poison eligible survivors.** Case-level
   assessment now validates only quality-eligible routes, so an excessive-snap
   rejection cannot invalidate a separate eligible route.

4. **Mapped highlights could be isolated from mapped trails.** Highlight
   discovery now fails closed unless a projected `trail_segment` is within
   75 m, using bounded PostGIS predicates compatible with the spatial index.
   This does not claim GraphHopper connectivity; the later 100 m provider-snap
   validation remains authoritative. This last correction is covered by real
   PostGIS integration tests but was not rerun against GraphHopper because the
   25-call budget was already exhausted.

The proof harness was also hardened to retain only allowlisted provider error
codes for future executions, preserve exact atomic call accounting, validate
only eligible survivors, and redact geometry from durable output.

## Verification

- Focused route research/provider/proof regressions: 283 passed.
- Complete disposable PostGIS and App Attest integration suite: 39 passed,
  0 failed.
- Complete backend suite: 569 passed, 0 failed.
- Canonical offline outdoor-adventure quality evaluation: 101/101 passed;
  zero bounds, determinism, false-claim, high-stakes-authority, must-have,
  provenance, route-verification, or waypoint-connection violations.
- Backend syntax build: passed.
- No Xcode build was required because no Swift or iOS contract changed in this
  bounded correction.

## Durable proof classification and remaining blockers

The canonical summary remains `failed`, with these reasons:

- `case_failed`
- `provider_call_budget_exhausted_without_innsbruck_quality_route`
- `required_region_route_missing`

The official 18-case summary remains `not_run` with zero executed cases and
zero provider calls. The proof does not establish a physical-iPhone/App Attest
production chain, current official trail status, access legality, live
conditions, or a closed-beta release decision.

A new, separately authorized provider budget would be required to re-run the
trail-proximity correction against Innsbruck and to exercise the controlled
post-success failure case. The quality thresholds should remain unchanged.

## Cleanup and release state

The disposable integration-test database was dropped, the loopback PostgreSQL
cluster was stopped and confirmed non-responsive, and the validated proof root
was removed. The canonical summary records cleanup as `removed`; it retains no
temporary path.

No files were staged, committed, pushed, deployed, or enabled by this proof.
All ordinary production feature flags remained false.
