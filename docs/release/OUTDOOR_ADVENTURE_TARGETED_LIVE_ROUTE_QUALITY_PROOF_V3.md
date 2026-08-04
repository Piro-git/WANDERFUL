# Outdoor Adventure Targeted Live Route-Quality Proof V3

## Classification and decision

- Proof classification: `targeted_server_side_live_route_quality_proof`
- Reviewed baseline: `81358cb6e022983e4fe698b195893c72eb281ec0`
- Generated: `2026-08-04T07:59:13.065Z`
- Overall result: **failed**
- Cases: 4 executed, 1 passed, 3 failed, 0 not run
- Product decision: **not approved for closed beta**

This bounded proof removed the V2 database-performance blocker and obtained real
GraphHopper outcomes. The Brocken fixture now has one fully eligible route. The
controlled-survivor fixture did not retain an independently eligible route, the
Innsbruck viewpoint fixture reproduced the V1 snapping/reachability failure, and
the conservative-easy fixture was stopped after the provider returned two
consecutive immediate rate-limit failures with the same safe classification.

This is not the official 18-case proof, a production proof, physical-iPhone App
Attest evidence, or evidence that one provider is superior to another.

## Provider authorization and reconciliation

The task authorized at most 15 non-production `/route` calls for the four
reviewed Harz and Innsbruck fixtures. Calls were serialized with maximum
concurrency 1 and a 2,000 ms minimum start spacing. The scheduler accepts only a
valid `Retry-After` bounded to 15 seconds and stops after two consecutive
immediate failures carrying the same allowlisted classification.

| Count | Value |
| --- | ---: |
| Hard limit | 15 |
| Attempted | 10 |
| Successful provider responses | 8 |
| Failed | 2 |
| Timed out | 0 |
| Cancelled | 0 |
| Controlled post-success failures | 1 |
| Unused | 5 |

Reconciliation: `8 successful + 2 failed + 0 timed out + 0 cancelled = 10
attempted`; `15 authorized - 10 attempted = 5 unused`. The first controlled-case
call was a genuine provider success before the reviewed post-success injection.
It remains counted as a successful provider response and separately as one
controlled post-success failure; it is not relabelled as a provider failure.

No additional probe was made after the circuit breaker opened. The authorization
expired when this task completed.

## Current-data receipts

All four source files carried publisher replication timestamp
`2026-08-03T20:21:36Z`. Publisher MD5 receipts were verified before use, and a
separate local SHA-256 digest was recorded.

| Source | Bytes | Publisher MD5 | Local SHA-256 |
| --- | ---: | --- | --- |
| Niedersachsen | 501,484,194 | `a8b51cb14b3aaf2cacc2fc929957fc20` | `7b99d9fdba2b44c0f45c51526f1cfea8b20f1113a1f04a3dad572956ae79e217` |
| Sachsen-Anhalt | 173,218,793 | `f10b48251b8bd63a75d7b15159800e1c` | `10e903892a649627e756fadb845bb1d3b69e79e554fe026092064d8bb56437a7` |
| Thueringen | 158,907,056 | `f661ce5c6fabe24400624b7b4b631467` | `7dbb8448dc62ffceee15bd8dc88564a6d766c69986f11084c673fe54a6a228e7` |
| Austria | 805,997,426 | `69c2343b98f151b0fa3b48e7eac4af42` | `709df4aa7dfcb68070f7817d2fea2595cfe6ed604ad14697a6bfb60a0be6e7ba` |

Bounded `complete_ways` extracts were complete at the way-node-reference level:

| Region | Bytes | SHA-256 | Nodes | Ways | Relations | Missing way-node refs | Last object timestamp |
| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |
| Harz | 40,347,075 | `c58294b12bdeed54946d8e69a182d8f241854bd421c18d3a8d1317f0f89198f2` | 3,775,840 | 562,221 | 8,232 | 0 | `2026-08-03T19:54:46Z` |
| Innsbruck | 24,424,179 | `dafa32db6008fe687da279ce6c3465c77be8ccc1c50c01a5d2e34b64883bfbdf` | 2,471,032 | 245,645 | 4,572 | 0 | `2026-08-03T18:45:22Z` |

The disposable stack used PostgreSQL 17.10 and PostGIS 3.6.4. Both regions had
active policies, current accepted sources, complete assertion and relationship
lineage, zero cross-region entity intersection, and zero quarantined rows.

| Region | Projected entities | Assertions | Relationships | Covered geometries |
| --- | ---: | ---: | ---: | ---: |
| Harz | 144,459 | 167,366 | 29,308 | 142,755 / 143,572 |
| Innsbruck | 76,855 | 91,474 | 7,763 | 76,019 / 76,355 |

The audit counts outside each boundary do not enter runtime candidates because
the repository applies exact containment. Both assertion-lineage triggers were
enabled after projection. Set-based validation found zero assertion-lineage
mismatches and zero relationship-lineage mismatches.

## Migration and database-performance gate

Migrations 001 through 006 were applied with the normal migration runner. A
second full migration run was a true no-op. Migration 006's expression GiST
index, `outdoor_research_projection_entities_trail_point_gist_idx`, was valid
and ready. Representative optimized membership plans used that index and did
not sequentially scan the projection-entity relation.

The application transaction timeout remained 2,500 ms and ordinary `work_mem`
remained 4 MB. Neither was raised for this proof.

| Fixture | Maximum transaction | Median | p95 | Rows |
| --- | ---: | ---: | ---: | ---: |
| Controlled survivor | 152.1 ms | 93.5 ms | 152.1 ms | 24 |
| Brocken | 742.0 ms | 118.8 ms | 742.0 ms | 24 |
| Innsbruck viewpoint | 1,049.4 ms | 115.4 ms | 1,049.4 ms | 24 |
| Innsbruck easy | 104.6 ms | 102.1 ms | 104.6 ms | 24 |

Every representative transaction was below the required 2,000 ms gate before a
provider call was reserved. The provider-free end-to-end research/candidate
preflights were also below the production deadline: controlled 539.8 ms,
Brocken 312.2 ms, viewpoint 384.0 ms, and easy 238.8 ms. Each produced three
proposals.

Large projection promotion exposed a separate ingest-path issue: the row-level
assertion-lineage trigger caused the Harz promotion and the first Innsbruck dry
run to time out. With no concurrent writers, the already-reviewed disposable
fixture procedure disabled only that trigger during bulk projection, performed
promotion, re-enabled it immediately, and ran the complete set-based lineage
validation. Harz promotion then completed in 57.895 seconds; the identical warm
Innsbruck dry-run retry completed in 45.019 seconds and promotion in 49.398
seconds. This workaround did not alter the runtime query, application timeout,
or `work_mem`.

## Candidate preflight

All selected shaping points were current, active, same-region,
non-quarantined, accepted-source evidence within the active policy and exact
region boundary. Original POI coordinates were preserved; no access coordinate
was invented. The maximum selected-highlight distance to mapped trail evidence
was 5.3 m for the controlled case, 29.4 m for Brocken, 6.7 m for the viewpoint
case, and 28.1 m for the easy case, all within the reviewed 75 m filter.
GraphHopper snapping remained independently authoritative.

## Per-case outcomes

### Controlled partial-provider-failure survivor — failed

Three provider calls succeeded. The first returned genuine geometry (12.304 km,
397 m ascent, 180.4 minutes) before the post-success seam injected the typed
`routing_unavailable` pipeline failure. That proposal retained its limitation.
The two independent provider successes reached route-quality evaluation:

| Route | Distance | Target deviation | Maximum snap | Waypoints reached | Backtracking | Overlap | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 11.988 km | 0.10% | 5.3 m | 3 / 3 | 0.7311 | 0.7311 | rejected: excessive backtracking |
| 2 | 18.940 km | 57.84% | 194.6 m | 2 / 3 | 0.6552 | 0.6817 | rejected: excessive backtracking and snapping |

No independently eligible route survived, so the controlled case correctly
failed even though the injection itself was truthful and contract-valid.

### Brocken must-have loop — passed

Brocken was selected from current validated evidence with must-have priority.
All shaping points were evidence-owned and the maximum mapped-trail proximity
was 29.4 m. Three real routes were returned:

| Route | Distance | Target deviation | Maximum snap | Waypoints reached | Backtracking | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 30.917 km | 106.11% | 265.3 m | 2 / 3 | 0.1056 | rejected: distance envelope and snapping |
| 2 | 27.086 km | 80.57% | 265.3 m | 2 / 3 | 0.0499 | rejected: distance envelope and snapping |
| 3 | 23.799 km | 58.66% | 41.9 m | 3 / 3 | 0.1647 | eligible and selected |

The selected route has genuine loop closure, preserved waypoint order, 358.1
minutes duration, 772.3 m ascent and descent, overlap 0.1647, shape score 0.566,
trail/path ratio 0.7299, major-road ratio 0, road-coverage ratio 0.9971, and
maximum hiking rating 1. It reached the must-have and passed the unchanged hard
distance, snapping, backtracking, overlap, provenance, and routed-envelope
policies. The 58.66% distance deviation is material and is reported rather than
described as a close target match.

### Innsbruck viewpoint loop — failed

Two real routes were returned before one immediate `routing_rate_limited`
failure. Neither route was eligible:

| Route | Distance | Target deviation | Ascent | Maximum snap | Waypoints reached | Backtracking | Overlap | Trail/path ratio | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 21.201 km | 76.67% | 1,629.2 m | 427.6 m | 0 / 3 | 0.4849 | 0.4861 | 0.8895 | rejected: distance and snapping |
| 2 | 21.290 km | 77.41% | 1,629.8 m | 441.1 m | 1 / 3 | 0.4826 | 0.4850 | 0.8889 | rejected: distance and snapping |

The first result exactly reproduces the V1 diagnostic: 21.201 km for a 12 km
request, 76.67% deviation, zero reached viewpoints, and 427.6 m maximum
snapping. Therefore V3 proves no measurable improvement for this fixture.
Mapped-trail proximity is not proof that the same POI is usable in the
provider's routable foot graph. The evidence supports a
mapped-evidence/provider-routable-graph mismatch, but does not distinguish
whether the raw POI itself is unsuitable or its nearby mapped trail is absent
from the provider/profile graph.

### Innsbruck conservative easy loop — failed

The first provider attempt returned the same immediate safe
`routing_rate_limited` classification as the preceding viewpoint failure. The
two-failure circuit breaker then stopped the batch and suppressed the remaining
two local proposals without reserving ledger calls. No real route geometry was
available, so distance, ascent, difficulty, snapping, reach, order, loop,
overlap, surface, and route-quality eligibility were not evaluated. The case is
an executed provider failure, not a route-quality pass or an unevidenced quality
claim.

## Comparison with V1 and V2

- V1 reached GraphHopper but rejected the Brocken and viewpoint outputs. V3
  improves the Brocken outcome to one eligible survivor, although it remains
  58.66% longer than requested.
- V3's first viewpoint route is identical to the V1 diagnostic, so the 75 m
  mapped-evidence filter did not correct provider snapping or viewpoint reach.
- V1 had an eligible route survive its controlled partial-failure fixture. With
  current V3 evidence and responses, both independently evaluated routes
  exceeded the unchanged backtracking policy, so V3 did not reproduce that pass.
- V2 made zero provider calls because repository membership exceeded 2.5
  seconds. V3 proves migration 006 and the optimized query remove that blocker:
  all pre-provider repository measurements passed and 10 calls were truthfully
  attempted.
- V2 did not obtain a live easy-route result. V3 also cannot make a quality
  comparison for that fixture because the provider circuit breaker opened
  before geometry was returned.

## Provider reliability observation

The provider returned eight fast successful responses, followed by two
consecutive `routing_rate_limited` failures at approximately 40 ms and 50 ms.
The error was retained only as its allowlisted safe classification. No provider
URL, raw response, header, or credential was retained. Conservative spacing was
applied throughout; after the repeated immediate failure the batch stopped with
five calls unused rather than repeatedly probing the service.

This bounded observation is not a provider reliability benchmark or a
provider-superiority claim.

## Defects and follow-up

1. The viewpoint candidate layer's 75 m mapped-trail test does not establish
   routability or access in GraphHopper's foot graph. The recommended correction
   is a separately proven routable-highlight access-point layer that preserves
   the original POI, derives an explicitly sourced access coordinate, and keeps
   a separate POI-approach requirement. Thresholds must not be weakened.
2. The current controlled fixture can produce genuine routes that fail the
   unchanged backtracking policy; a deterministic eligible survivor is not yet
   proven on current data.
3. The easy fixture still needs a fresh, separately authorized live run after
   provider availability recovers.
4. Bulk projection's row-level assertion-lineage trigger does not scale to these
   imports within the current operation deadline. A durable set-based ingest
   design should replace the disposable proof workaround.
5. Brocken now has a valid route but its 58.66% target-distance deviation remains
   a product-quality concern even though it is inside the existing hard envelope.

## Corrections made for V3

- Added a dedicated, import-safe V3 runner with the fixed four-case order,
  explicit authorization acknowledgements, a hard 15-call ceiling, loopback
  database validation, sanitized output validation, and no official-summary
  mutation.
- Extended the existing proof harness with backward-compatible optional limits,
  maximum concurrency, attempt/deadline controls, conservative call spacing,
  bounded `Retry-After` handling, and a repeated-immediate-failure circuit
  breaker. Existing V1 defaults remain unchanged.
- Added unit coverage for the narrower ledger ceiling, spacing, bounded retry
  delay, stop behavior, and import safety.
- Independent checkpoint review made the runner reject direct or symlinked V1,
  V2, and official-proof output targets, require a proof-only loopback database
  principal, and complete bounded pool/capture cleanup before it can publish or
  report a successful result. Regression tests cover each fail-closed boundary.

No route-quality, snapping, distance, backtracking, overlap, or provenance
threshold was changed.

## Verification

| Verification | Result |
| --- | --- |
| Focused migration, repository, candidate, executor/dossier, GraphHopper/provider, route-quality, orchestrator, staging-proof, and server-live-proof suites | 200 / 200 passed across 10 suites |
| Current-data optimized repository performance test | 2 / 2 passed |
| Real disposable PostGIS integration suites | 44 / 44 passed across 5 suites |
| Independent checkpoint focused server-live-proof, staging-proof, provider, adapter, and orchestrator suites | 141 / 141 passed across 9 suites |
| Complete backend suite after checkpoint corrections | 585 / 585 passed across 63 suites |
| Backend build | passed |
| Offline route-quality evaluation | 101 / 101 passed; 0 skipped, 0 failed, 0 policy violations |

The counts overlap and must not be added into a synthetic total. No Swift file
changed, so the reviewed iOS build/debug instructions correctly did not require
an Xcode run.

## Safety, release, and cleanup state

All ordinary flags remained false:

- `OUTDOOR_RESEARCH_PLANNING_ENABLED`
- `OUTDOOR_RESEARCH_PLANNING_ALLOW_INSECURE_LOCAL`
- `OUTDOOR_EVIDENCE_PROVIDER_ENABLED`
- `ROUTE_ALLOW_INSECURE_LOCAL_ROUTING`
- `INTENT_ALLOW_INSECURE_LOCAL_PARSING`
- `APP_ATTEST_ALLOW_IN_MEMORY`

The official 18-case summary remains `not_run` with 0 executed cases. V1 and V2
remain immutable. At live-proof capture completion, nothing was staged,
committed, pushed, deployed, released, or enabled.

The loopback database was stopped, its port was verified closed, and all
disposable source extracts, database files, import products, provider ledger,
and transient receipts were removed. The removed proof root occupied 5,858,436
KiB. Only this sanitized report and its summary are durable; they contain no
credential, provider URL, raw response, raw prompt, complete geometry, private
coordinate, database connection material, temporary path, or App Attest data.
