# Outdoor Mapped-Route Membership Performance V1

## Outcome

Mapped hiking-route membership now completes with reliable margin inside the unchanged 2,500 ms repository statement timeout on the current bounded Harz and Innsbruck regional data. The correction preserves the reviewed representative-point proximity meaning, exact geography-distance inclusion, deterministic ordering, evidence lineage, source policy, active import, lifecycle, quarantine, containment, and regional-isolation requirements.

This work changes only the mapped-route membership query, one bounded expression index, tests, and this record. It does not call a routing provider, enable a feature, change an application timeout, or alter route generation.

## Current-data fixture and provenance

The disposable benchmark used freshly checksum-verified and bounded OSM extracts current on 2026-08-02. The bounded Harz derivative had SHA-256 `a9a6bf09f67e197b1dc676bf26296d64a3a46c785858df5abe34506f6a4837df`; the bounded Innsbruck derivative had SHA-256 `4fb5286710c78dfc7bec3638373e66e4c83ee310114e96b55210df0bc929f252`.

| Region | Imported POIs | Imported segments | Imported relations | Projected entities | Projected assertions | Projected relationships |
|---|---:|---:|---:|---:|---:|---:|
| Harz | 2,951 | 140,612 | 887 | 144,450 | 167,356 | 29,308 |
| Innsbruck | 1,620 | 74,674 | 498 | 76,792 | 91,398 | 7,711 |

The reviewed `osm-foundational-mapped-v1` policy was the only policy activated in the disposable database. Both dry runs had zero quarantine records. Projection/import lineage checks, regional isolation checks, containment checks, and set-based assertion and relationship lineage validations passed with zero mismatches. All projection assertion triggers were enabled before benchmarking.

Fixture preparation note: the unchanged row-level projection assertion validation triggers made the current-volume projection preparation impractically slow. For this disposable fixture only, those assertion triggers were disabled during the projector write and re-enabled in a guaranteed cleanup step. Equivalent set-based foreign-key and lineage validations then returned zero violations. This was not a production-code or migration change and is not part of the optimized query's success condition.

## Exact semantic contract

For the same read-only database snapshot and inputs, the optimized query preserves:

- selected membership entity, mapped route, evidence, and relationship identifiers;
- predicates, categories, source keys, policy versions, import IDs, region IDs, evidence classes, and freshness timestamps;
- active source-policy, import, region, lifecycle, quarantine, and containment filtering;
- assertion binding, record provenance, attribution, and conflict/resolution inputs consumed by the dossier;
- the reviewed `ST_PointOnSurface` representative point for each trail segment;
- the authoritative `ST_DWithin(...::geography, ...::geography, radius)` inclusion decision;
- deterministic distance, route, membership-rank, segment, and relationship ordering; and
- the current maximum of one membership row per selected route and the bounded 24-row result limit.

Mapped membership remains evidence that a nearby segment belongs to a mapped hiking relation. It is not an official-route, access, safety, or quality claim.

## Root cause

The legacy query performed expensive spatial filtering after joining projected relationships, active relationships, projected segments and routes, source-policy state, active runs, region state, and lifecycle records. It repeatedly evaluated `ST_PointOnSurface`, exact geography distance, and sort/window work over a much wider intermediate result than the final membership set.

The projected-geometry GiST index indexed the trail line geometry, while the reviewed proximity decision uses `ST_PointOnSurface(projected_geometry)`. That mismatch forced broad line-bounding-box candidates, particularly in Innsbruck, and provided no direct index for the representative-point predicate. One Brocken plan also rescanned a wide materialized nearby result for route selection, multiplying temporary reads. The planner materially underestimated that branch.

Representative diagnostic plan evidence included:

- seven legacy sort operations versus three after correction;
- 10,296 temporary-block reads caused by repeated selection-side rescans in an early corrected plan;
- 26,163 broad Innsbruck candidates from the line-geometry index before representative-point indexing; and
- 89,197 legacy rows removed by join filters in the Brocken plan versus 5,708 after correction.

## Query and schema correction

The query now:

1. materializes only segment IDs participating in the active projection's mapped-route relationships;
2. applies active projection, region, import, lifecycle, quarantine, category, non-null geometry, and exact containment requirements before exact distance work;
3. computes the reviewed representative point once per bounded candidate;
4. prefilters those points through a parameterized bounding box backed by the expression GiST index;
5. applies exact geography `ST_DWithin` and calculates geography distance once;
6. joins relationship, route, policy, source, and provenance records only after spatial narrowing; and
7. applies the current one-row-per-route rank and 24-row deterministic final limit without rescanning a wide selected-routes CTE.

Migration `006_outdoor_route_membership_point_index.sql` adds this partial expression index:

```sql
USING GIST (ST_PointOnSurface(projected_geometry))
WHERE entity_category = 'trail_segment'
  AND projected_geometry IS NOT NULL
```

The index uses the same representative-point expression as the authoritative query contract. It does not add a denormalized value, mutate or backfill rows, change SRIDs, or change longitude/latitude handling.

## Rejected alternatives

- Raising `statement_timeout` was rejected because the 2,500 ms application deadline is an operational requirement.
- K-nearest-neighbor ordering was not used for final selection because it could replace the exact geography-distance and deterministic ordering contract.
- Line-to-anchor proximity was rejected because it would silently change the reviewed representative-point meaning.
- A stored or denormalized representative point was unnecessary and would add provenance, lifecycle, backfill, and consistency obligations.
- A process-global result cache was rejected because it could become stale or unbounded and would not protect cold execution.
- Removing exact region containment, active import, lifecycle, quarantine, source-policy, assertion, or provenance joins was rejected as a semantic weakening.

## Same-snapshot differential and plan timings

The legacy and optimized queries were run in the same repeatable-read snapshot. All four cases produced byte-equivalent ordered result structures after normalizing only diagnostic formatting. Each returned 24 rows with the same digest across repeated executions.

| Case | V2 observed membership | Legacy same-snapshot plan | Optimized same-snapshot plan | Ordered result digest prefix |
|---|---:|---:|---:|---|
| Brocken | 5,160 ms | 2,502.6 ms | 464.4 ms | `3e2c03735ac1beef` |
| Innsbruck viewpoint | 1,650 ms | 850.2 ms | 867.1 ms | `4a7f5ece40341943` |
| Innsbruck easy | 520 ms | 373.2 ms | 119.3 ms | `4a7f5ece40341943` |
| Controlled survivor | 900 ms | 999.1 ms | 239.8 ms | `b652f91d56958e13` |

The same-snapshot figures are representative `EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT JSON)` executions and vary with cache state. The viewpoint sample is effectively neutral in that warm comparison; its cold-like result and repeated p95 below show the index's deadline margin. The V2 figures are retained as the truthful pre-correction observation and are not directly substituted for same-snapshot measurements.

In the Brocken comparison, the legacy plan recorded 754,884 shared hits, 30,672 reads, and 15,645 temporary reads. The optimized plan recorded 124,062 shared hits, 2,694 reads, and no temporary blocks.

## Cold-like and repeated warm acceptance results

Cold-like measurements were taken after restarting the disposable PostgreSQL server, using the normal repeatable-read transaction and a transaction-local 2,500 ms statement timeout. No case timed out.

| Case | Cold-like query | Cold-like transaction | Warm minimum | Warm median | Warm p95 | Warm maximum |
|---|---:|---:|---:|---:|---:|---:|
| Brocken | 1,148.7 ms | 1,150.0 ms | 190.6 ms | 206.1 ms | 228.7 ms | 266.3 ms |
| Innsbruck viewpoint | 732.0 ms | 736.2 ms | 176.7 ms | 193.3 ms | 235.6 ms | 256.6 ms |
| Innsbruck easy | 178.5 ms | 182.1 ms | 159.4 ms | 175.1 ms | 223.8 ms | 229.7 ms |
| Controlled survivor | 311.7 ms | 312.3 ms | 152.0 ms | 163.0 ms | 187.2 ms | 201.2 ms |

Warm measurements contain 20 normal application-transaction executions per case. Transaction p95/max values were respectively 229.5/267.4 ms, 244.9/266.2 ms, 233.0/236.4 ms, and 187.7/202.0 ms. All 84 cold-like and warm executions completed below 2,000 ms; every warm p95 was below 1,500 ms. PostgreSQL `work_mem` remained at its ordinary 4 MB setting.

The opt-in current-volume regression test independently ran five exact-result executions per case under the 2,500 ms transaction-local timeout. Its maximum/p95 results were 336.8 ms, 230.0 ms, 203.8 ms, and 172.0 ms. The test fails if any execution reaches 2,000 ms, p95 reaches 1,500 ms, results vary, the point index is absent/invalid, the plan stops using it, or the large projected-entity table is sequentially scanned.

## Query-plan and index result

All four optimized plans used `outdoor_research_projection_entities_trail_point_gist_idx` and the relationship-subject index. None sequentially scanned the large projected-entity table. The exact geography predicate remained visible after the indexed bounding-box preselection. The optimized query has two textual `ST_PointOnSurface` occurrences: one computed candidate expression and the identical expression required for matching the expression index; it no longer repeats the function inside exact distance and ordering expressions.

The final Brocken plan used no temporary blocks. No query or migration changed `work_mem`, global planner settings, or the application timeout.

## Differential edge matrix

The diagnostic differential harness compared legacy and optimized ordered results for the four representative cases plus these conditions:

| Condition | Result |
|---|---|
| No nearby route | Exact, zero rows |
| Region-boundary evidence | Exact, contained row retained |
| Exact radius boundary | Exact ordered 20-row set |
| Multiple routes and distance ties | Exact, stable deterministic ordering |
| Duplicate relationships | Exact relationship identities retained |
| Evidence outside operational polygon | Exact, excluded |
| Cross-region evidence | Exact, excluded |
| Inactive/failed projection | Exact, excluded |
| Quarantined segment | Exact, excluded; transaction rolled back |
| Null route geometry | Exact; membership remains segment-based |
| Repeated execution | Exact stable order and digests |

Existing unit and PostGIS integration coverage additionally verifies stale/inactive imports, invalid geometry constraints and fail-closed behavior, active policy/lifecycle binding, assertion provenance, regional isolation, statement timeout, and bounded output.

## Cancellation and transaction behavior

A real PostGIS integration test holds a table lock and aborts three independent repository transactions. Each abort uses a distinct cancellation pool and produces the reviewed event sequence: transaction began, active query cancelled after abort, rollback completed after cancellation. Each request rejects as cancelled, the retained transaction pool remains reusable, neither pool has waiting clients, and cancellation connections return idle without growth beyond the configured bound.

The existing 100 ms statement-timeout case also passes. Late results cannot escape after cancellation. No same-pool cancellation dependency or unbounded temporary-memory requirement was introduced.

## Migration behavior

Migrations 001 through 005 were first applied to the disposable environment and the runner's second pass was a true no-op. Migration 006 then applied exactly once through the real runner; its second pass was also a true no-op. The resulting index was both valid and ready.

Migration 006 is an idempotent, transaction-safe `CREATE INDEX IF NOT EXISTS` schema addition. It contains no row mutation or deletion, preserves populated and legacy rows, requires no backfill, and leaves invalid/null geometry outside its bounded predicate. Static migration tests, empty/populated PostGIS integration setup, repeated real-runner execution, and the complete integration suite cover its behavior.

The ordinary `CREATE INDEX` is intentionally compatible with the current migration runner, which applies migrations inside one transaction and records the version only after the SQL succeeds. PostgreSQL takes a `ShareLock` on `outdoor_research_projection_entities` while this index is built: reads continue, but concurrent inserts, updates, and deletes wait until the build and migration transaction commit. Apply migration 006 in a write-quiet maintenance window and monitor lock waits. The current bounded table size makes that operationally acceptable; if write availability later requires `CREATE INDEX CONCURRENTLY`, the migration runner must first gain an explicit non-transactional migration design rather than placing `CONCURRENTLY` in the existing transaction.

The index remains predicate-bounded to non-null `trail_segment` projections and exists only to accelerate representative-point membership preselection. It covered 215,286 trail-segment rows in the reviewed fixture. Because projection history is append-only, retained historical runs and future imports can increase that row count; measure the table and index again and renew the maintenance-window assessment before materially larger imports. A failed build rolls back both the index and the migration-version insert; a later runner invocation can retry normally.

## Verification

- Provider-disabled focused repository, executor, research-planner, candidate-planner, routing-adapter, migration, cancellation, staging-proof, and server-live-proof matrix: 372/372 passed across 30 suites.
- Real executor PostGIS integration: 17/17 passed.
- Projection and research-graph PostGIS integration: 16/16 passed.
- Serial `test:postgres-integration`: 36/36 passed across five suites.
- Opt-in current-volume performance gate: 2/2 passed.
- Complete backend suite: 579/579 passed across 63 suites.
- Backend build: passed.
- Offline outdoor-adventure evaluation: 101/101 configured cases executed and passed, with zero skips, failures, or violations.

## Operational limits and known limitations

- Results apply to the current bounded Harz and Innsbruck volumes and the existing 75 m representative-point membership policy. Materially larger regions or a changed search/membership policy require renewed plan and threshold evidence.
- PostgreSQL buffer state and concurrent machine load create timing variance; the cold-like restart and repeated warm samples are therefore reported separately.
- This correction improves mapped evidence membership only. It does not verify route officialness, trail access, conditions, safety, scenic quality, or provider routability.
- The performance fixture's projector-trigger workaround is suitable only for controlled disposable preparation with the documented set-based validation; it is not a production projection optimization.

## Boundary for the later targeted GraphHopper rerun

Before a later targeted live rerun, apply migration 006 through the normal migration runner and confirm the active Harz and Innsbruck projections represent the intended current imports under the reviewed policy. Then run the existing targeted proof with its original application timeout and authorization controls. That later task owns all provider authorization, metering, credential access, live routing, and publication decisions. This performance task made zero provider calls and does not make the historical V2 proof green retroactively.
