# Outdoor Evidence Disposable Staging Proof

Date: 2026-07-22
Scope: Agent 11.5 regional outdoor-evidence foundation
Status: disposable local operational proof complete; **not production proof**

## Outcome

The regional outdoor-evidence foundation was reviewed, corrected where real PostGIS exposed defects, committed, pushed, and exercised against real bounded OpenStreetMap extracts for Harz and the Innsbruck Alpine pilot.

The checked-in iOS feature flag remains disabled. Evidence was enabled only through temporary Debug build-setting overrides pointed at an isolated localhost backend. No production database, Supabase project, cloud resource, public Overpass endpoint, public Nominatim endpoint, Germany-wide PBF, Alps-wide PBF, or planet PBF was used.

## Commits and review corrections

| Commit | Purpose |
| --- | --- |
| `ac41b52` | `Add regional OSM PostGIS evidence service` |
| `631623a` | `Connect optional outdoor evidence to iOS planning` |
| `d25c8a5` | `Fix real PostGIS corridor queries` |
| `d293943` | `Disambiguate PostGIS importer SRIDs` |

The two required foundation commits were pushed before operational proof. The two later commits are narrow corrections discovered only with the real database:

- Corridor queries previously selected duplicate unqualified context fields, allowed nullable boolean expressions, and used exact planar intersection against a geodesically segmentized route. The correction selects one canonical field set, coalesces booleans, and uses a one-metre geography tolerance.
- PostGIS 3.6 reported ambiguous `ST_Transform` overloads for importer parameters. Explicit integer casts now make region matching and imported geometry transformation deterministic.

Regression assertions were added for both corrections. After each correction, syntax/build checks and the complete deterministic backend suite passed.

## Isolated environment

The proof used one uniquely named native local cluster:

- task namespace: `trailmind-outdoor-evidence-proof.yiiFij`
- PostgreSQL: 17.10
- PostGIS: 3.6.4
- GEOS: 3.14.1
- PROJ: 9.8.1
- osm2pgsql: 2.3.1, Libosmium 2.23.1
- Osmium Tool: 1.19.1
- bind address: `127.0.0.1`
- port: `55439`
- database: `trailmind_agent115_proof`
- role: `trailmind_agent115`

The generated password was stored only in a mode-`600` task file and was supplied through the environment. It was never printed, committed, or placed on a command line. The cluster never touched an existing PostgreSQL database.

## Deterministic and migration verification

| Check | Result |
| --- | --- |
| Backend syntax build | passed |
| Complete deterministic backend suite | 218 passed, 0 failed |
| Focused iOS foundation suite | 36 passed, 0 failed, 0 skipped |
| iOS Debug build | passed |
| iOS Release build | passed with evidence disabled |
| First migration run | applied `001_app_attest.sql` and `002_outdoor_evidence.sql` |
| Second migration run | true no-op; no migrations reapplied |
| Real PostGIS integration suite | 3 passed, 0 failed, 0 skipped |

The database-backed suite ran against a separately created proof test database and was not counted as a pass through skipping. That database was dropped after the suite.

The final deterministic run initially encountered only sandbox-denied localhost binds (`listen EPERM 127.0.0.1`) in the HTTP-server tests. The identical suite was rerun with localhost permission and passed all 218 tests.

## Real bounded source receipts

All source files were official immutable Geofabrik extracts dated `2026-07-20T20:21:16Z`. Checksums were verified before clipping. Osmium `complete_ways` clipping used only the checked-in versioned operational polygons.

### Harz

| Source | Bytes | Published MD5 |
| --- | ---: | --- |
| `niedersachsen-260720.osm.pbf` | 500,216,683 | `ef4f33dd6da3f1a0ffcba4c266180aca` |
| `sachsen-anhalt-260720.osm.pbf` | 172,924,814 | `502bc8c5283e26e15ec65a4a511c29e3` |
| `thueringen-260720.osm.pbf` | 158,696,767 | `536c66c80c0df949731082d4d5c730a5` |

Source identifiers were the dated Geofabrik Germany URLs under `https://download.geofabrik.de/europe/germany/`.

The merged Harz clip was 40,288,125 bytes:

- MD5: `ce489fdbdf79f028fdd07aed4e39fcac`
- SHA-256: `89f59b0d79abd868a8d62d1b304aec9a6c8929bf8236b74c89f60db3b37006c2`
- objects: 3,771,960 nodes, 561,786 ways, 8,226 relations
- missing node references from retained ways: 0

### Innsbruck Alpine pilot

| Source | Bytes | Published MD5 |
| --- | ---: | --- |
| `austria-260720.osm.pbf` | 804,800,048 | `1dedf6033083ebb4e402645da853ca17` |

The source identifier was `https://download.geofabrik.de/europe/austria-260720.osm.pbf`.

The Innsbruck Alpine pilot clip was 24,386,420 bytes:

- MD5: `d4df0fa1ef96fea893fe837c478cb211`
- SHA-256: `fbec71e7cc92db64ca0c2df8e0434b51d4dfed9d232a5f3247ccc6fdf8f9c20b`
- objects: 2,468,485 nodes, 245,318 ways, 4,565 relations
- missing node references from retained ways: 0

All downloaded and clipped PBF files were deleted after import.

## Import, promotion, failure, and rollback proof

| Region/import | Retrieved at | Final state | POIs | Trail segments | Hiking relations | Relation members |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Harz `675e2351` | `2026-07-22T08:21:51Z` | active | 2,946 | 140,479 | 886 | 29,501 |
| Innsbruck `929f3bba` | `2026-07-22T08:39:43Z` | active after rollback | 1,620 | 74,531 | 497 | 7,716 |
| Innsbruck `a0d5d203` | `2026-07-22T08:41:11Z` | superseded after rollback | — | — | — | — |
| Controlled mismatch `84c0eb00` | `2026-07-22T09:39:22Z` | failed / `import_failed` | — | — | — | — |

While the second Innsbruck import was loading, `929f3bba` remained the active pointer. Promotion atomically changed the pointer to `a0d5d203`, changed the prior import to `superseded`, and left zero staging schemas. The reviewed rollback transaction then restored the pointer to `929f3bba` and changed `a0d5d203` to `superseded` in the same commit.

The controlled failure supplied the valid Innsbruck clip to the Harz region boundary. It failed safely with `import_failed`; both regional active pointers were unchanged and zero staging schemas remained. This also proved that a failed import for one region cannot replace the other region's active import.

A data-only Harz snapshot was used to remain inside the local disk gate while exercising both large regions. Its six table-data entries were verified before temporary truncation. After Innsbruck promotion/rollback and the controlled failure, the Harz data was restored and its exact pre-snapshot counts were revalidated.

## Real corridor smoke and freshness proof

The real endpoint, service, repository, and PostGIS query were invoked with public OSM geometries selected from each active import. No synthetic repository was used.

| Region | OSM way | Route length | State | Regional coverage | Highway coverage | Hiking-relation coverage | Mapped/returned POIs | Response bytes |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| Harz | `27828345` | 3,000.7 m | known | 1.0 | 1.0 | 0.998615 | 1 / 1 | 1,728 |
| Innsbruck | `93577589` | 2,986.9 m | known | 1.0 | 1.0 | 0.003215 | 2 / 2 | 2,576 |

Both responses identified the correct active regional import and returned only bounded normalized evidence. Warning codes were `osmMappedEvidenceOnly` and `missingTagsRemainUnknown`.

Freshness was exercised by temporarily changing only the Harz source timestamp:

- current timestamp -> `current`
- expired timestamp -> `stale`
- missing timestamp -> `sourceTimestampUnavailable`
- Innsbruck remained `known` throughout
- the original Harz timestamp was restored in a `finally` path

A forced 100 ms database statement timeout mapped to the stable public error code `evidence_timed_out`. Active pointers remained `675e2351` and `929f3bba` afterward.

The existing deterministic overlap fixture also passed, preserving stable region ordering and preventing double-counted route length where regions overlap.

## Query performance and spatial indexes

Three warm-up calls preceded 25 timed repository/normalization calls per region. These are disposable localhost observations, not production latency claims or an SLA.

| Region | Runs | p50 | p95 | Max | Response size |
| --- | ---: | ---: | ---: | ---: | ---: |
| Harz | 25 | 23.573 ms | 24.140 ms | 24.367 ms | 1,728 bytes |
| Innsbruck | 25 | 24.046 ms | 26.934 ms | 27.030 ms | 2,576 bytes |

Sanitized `EXPLAIN (ANALYZE, FORMAT JSON)` checks showed `Index Scan` / `Index Only Scan` nodes and the intended indexes, including:

- `outdoor_evidence_regions_boundary_gist_idx`
- `outdoor_evidence_pois_geom_metric_gist_idx`
- `outdoor_evidence_trail_segments_geom_metric_gist_idx`
- `outdoor_evidence_imports_identity_region_idx`
- `outdoor_evidence_relation_members_segment_idx`

The explain-plan execution times were 27.059 ms for Harz and 23.165 ms for Innsbruck. `enable_seqscan=off` was used only for the index-eligibility receipt; the 25-run latency measurements used the normal planner.

## Local/test iOS enablement gate

Evidence was enabled only for two Simulator invocations using temporary build overrides:

- configuration: Debug
- Simulator: existing iPhone 17 Pro, iOS 26.5
- `OUTDOOR_EVIDENCE_ENABLED=true`
- `INTENT_BACKEND_BASE_URL=http://127.0.0.1:55442`

The checked-in UI-test routing fixture produced the route, while the normal post-routing provider called a localhost proxy backed by the real disposable PostGIS endpoint.

### Delayed real evidence

The existing `testPointToPointPlanningOpensVerifiedRouteActions` test passed, 1 passed / 0 failed / 0 skipped. The proxy delayed forwarding by eight seconds:

- evidence request received: `2026-07-22T10:00:20.079Z`
- route title observed: approximately `2026-07-22T10:00:21.255Z`
- route detail observed: approximately `2026-07-22T10:00:26.475Z`
- real PostGIS response completed: `2026-07-22T10:00:29.072Z`
- real response: HTTP 200, 3,813 bytes, 9,016 ms end-to-end through the delay proxy

The route title was therefore visible about 7.8 seconds before optional evidence completed, and the route detail was already open before the response completed.

### Controlled evidence failure

The same existing UI test passed again, 1 passed / 0 failed / 0 skipped. The proxy received the optional request at `2026-07-22T10:04:39.396Z` and returned controlled `evidence_unavailable` after 147 ms. The route title was subsequently observed at approximately `2026-07-22T10:04:41.062Z`, route detail actions remained available, and the complete test passed. Evidence failure therefore did not delay, alter, or remove the routed result.

Evidence was not exposed as a new product UI in this proof. The localhost processes were stopped after verification.

## Release state

`Configuration/Shared.xcconfig` remains:

```text
OUTDOOR_EVIDENCE_ENABLED = false
```

The temporary Debug overrides were command-scoped and were not written to the project. Release was built successfully with the checked-in disabled value. Disposable database success does not authorize production enablement.

## Limitations

- This is a disposable local proof, not a deployed staging or production proof.
- The two checked-in polygons are TrailMind operational pilot boundaries, not official Harz or Alpine boundaries.
- `complete_ways` guarantees retained ways have their node references, which was verified. It does not make every out-of-boundary member of retained relations complete. The Harz clip reported 1,674 missing relation-node references, 41,413 missing relation-way references, and 726 missing nested-relation references; Innsbruck reported 1,331, 79,629, and 1,939 respectively. The importer safely retains only memberships whose trail segments were actually imported.
- Full regional replacement is proven; incremental OSM replication and a refresh scheduler are not implemented.
- OSM values remain mapped evidence, not guarantees of safety, legality, access, water, opening, trail condition, or scenic quality.
- Local latency does not predict hosted latency or capacity.

## Cleanup

Cleanup completed after the final sanitized audit:

- stopped the unique PostgreSQL cluster
- removed the exact 372 MB task namespace, including the generated password, database files, temporary snapshot, harnesses, logs, and receipts
- removed all source and clipped PBF files
- stopped the localhost backend and both proof proxy modes
- confirmed ports `55439`, `55441`, and `55442` were no longer listening
- removed the exact task-created 194 MB DerivedData directory and two proof-only Xcode result/log pairs
- preserved no database, password, PBF, or generated import artifact in the repository
- retained the locally installed PostgreSQL/PostGIS/osm2pgsql/osmium tooling; it is reusable software, not proof data

During setup, only task-created/rebuildable caches were cleared with user authorization: approximately 1.1 GB of Homebrew downloads, a never-used 39 MB default Homebrew PostgreSQL cluster, an earlier 572 MB copy of the task DerivedData, and approximately 393 MB from npm's download cache. No Simulator was erased or deleted.

## Remaining production gates

Outdoor evidence must remain disabled in Release until all of the following are separately proven:

- durable deployed PostGIS migration and backup/restore operations
- durable regional imports and an operator-approved refresh scheduler
- deployment of the bounded endpoint with production App Attest authorization intact
- monitoring, alerting, timeout, error-rate, freshness, and capacity thresholds
- privacy disclosure and data-retention review
- discoverable OpenStreetMap attribution and final ODbL/licensing review
- hosted latency/load testing and resource sizing
- operational rollback, incident response, and stale-dataset runbooks
- release-specific endpoint and configuration verification
