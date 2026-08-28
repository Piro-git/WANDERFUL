# Supabase Free current-data capacity proof v1

Decision: **BOUNDED_TWO_REGION_PROFILE**

Proof date: 2026-08-28 (Europe/Berlin)

Branch: `codex/supabase-free-capacity-v1`

Fetched `origin/main` and measurement baseline: `a36c646815f390b60df734147a78e82c8ef46dd1`

The full current Harz and Innsbruck evidence graphs do not fit Supabase Free. Neither full region fits alone. The exact staging profile recommended for a later, separately authorized remote provisioning run is:

`backend/config/outdoor-capacity-profiles/supabase-free-bounded-two-core-v1`

It is a truthful, deterministic partial-coverage profile for the Ilsenburg–Brocken–Schierke core and the Innsbruck–Nordkette core, with narrow source-backed category-preservation corridors. It is not full Harz, full Innsbruck pilot, or full Alps coverage. It supports one active plus one retained superseded source/projection generation per region. A third retained generation is not approved on Free; archive/remove the oldest generation through a separately reviewed operation before the next refresh, or upgrade.

No remote Supabase project was queried or mutated. No credential, `Configuration/Local.xcconfig`, clipboard, GraphHopper, AI provider, public Overpass, or competitor service was accessed.

## Quota basis

The current official [Supabase database-size documentation](https://supabase.com/docs/guides/platform/database-size) was checked on 2026-08-28. It says:

- database size is the PostgreSQL data/index/materialized-view measurement and is distinct from disk/WAL;
- a new project normally occupies about 40–60 MB before product data; and
- a Free project enters read-only mode above 500 MB of database size.

The current [Supabase changelog](https://supabase.com/changelog) was also checked. Relevant current entries confirm that explicit extension version pinning is ignored in favor of the default from 2026-08-05, and PostgreSQL 17 is the current new-project default. The local snapshots are bound in the JSON receipt with SHA-256 digests.

This proof treats 500,000,000 bytes as a hard plan ceiling and 400,000,000 bytes as the maximum settled operating state. To avoid understating managed-platform overhead, every local measurement is conservatively adjusted as:

`managed equivalent = local pg_database_size - 7,804,595 + 60,000,000`

The user-supplied remote observation of about 11.7 MB is reported as a secondary comparison only. No remote query was made to verify it.

## Safety and reproducibility gates

- Two settled free-space readings before any download/provisioning: 15,376,156 KiB and 15,373,052 KiB; both exceed 12 GiB.
- Initial PostgreSQL/import/Xcode process and port-conflict gate: clear.
- Disposable source cluster: loopback `127.0.0.1:55432` only.
- Disposable restore cluster: loopback `127.0.0.1:55433` only.
- PostgreSQL 17.10; PostGIS 3.6.4; GEOS 3.14.1; PROJ 9.8.1 with network disabled.
- `osm2pgsql` 2.3.1; `osmium` 1.19.1; Node 22.22.3; npm 10.9.8.
- No equivalent current-extract/table-index-TOAST capacity proof existed in history, branches, receipts, or active worktrees.
- No active task overlapped the region configs, migration/storage policy, or capacity receipt.

## Exact publisher sources

Every source was a current publisher-authorized Geofabrik regional extract. Each downloaded PBF matched the publisher's `.md5` file before use.

| Extract | Source timestamp | Sequence | Bytes | Published MD5 | Local SHA-256 |
| --- | ---: | ---: | ---: | --- | --- |
| [Niedersachsen](https://download.geofabrik.de/europe/germany/niedersachsen-latest.osm.pbf) | 2026-08-26T20:22:15Z | 4883 | 503,254,893 | `9ea0580046ace0ad27104a3b7fdac871` | `6029c847b32e6402195c9acf51791a32da763cf4daed50fe128a9ce830c42654` |
| [Sachsen-Anhalt](https://download.geofabrik.de/europe/germany/sachsen-anhalt-latest.osm.pbf) | 2026-08-26T20:22:15Z | 4884 | 173,790,914 | `d997d174c51b07744cb5326378923be2` | `45abfb5fa16892c91e79f137b084e7ea21b5eef60ea8efba7eca29c2bdd2d381` |
| [Thüringen](https://download.geofabrik.de/europe/germany/thueringen-latest.osm.pbf) | 2026-08-26T20:22:15Z | 4885 | 159,236,450 | `389fc279ac94e3a3e62a6d01ff6a9f19` | `a5b0e226d4f3c698879cce214840648ce1d98c1f083155dfb16ae0ae46ea0ac5` |
| [Austria](https://download.geofabrik.de/europe/austria-latest.osm.pbf) | 2026-08-26T20:22:15Z | 4891 | 808,333,364 | `3893c70121a683be3aaea68cac673b0c` | `91ef35acbdb50e0c02ce0a3ac2e755145144f806d397480157767b53b1525cf8` |

The publisher index snapshot SHA-256 is `67f01603c4ac7a7c69d31abd274393f24b770a92d9c8226e724d83db660e4b1d`.

Production polygon-derived full inputs were:

| Region | Bytes | Nodes | Ways | Relations | SHA-256 |
| --- | ---: | ---: | ---: | ---: | --- |
| Harz | 40,465,234 | 3,783,038 | 563,449 | 8,247 | `471d5c485e885c2eaecff3b9b60df8bc27b46cf823c47275d47d1ccbfa1b0e83` |
| Innsbruck pilot | 24,500,212 | 2,476,813 | 246,211 | 4,577 | `b7211fcf9225fa1ba45a9405fceab0dd5426316a86ade9a78bbf28622f5d464d` |

The accepted staging inputs were derived from those full inputs with `osmium extract --strategy complete_ways` and the tracked EPSG:4326 profile polygons:

| Region | Bytes | Nodes | Ways | Relations | SHA-256 |
| --- | ---: | ---: | ---: | ---: | --- |
| Harz bounded core | 1,954,850 | 150,208 | 15,705 | 643 | `311dd2ecf8ab9a5914e1b7aedf15293625eba5eb974526001e60f772a17b6c48` |
| Innsbruck bounded core | 4,091,030 | 259,457 | 39,536 | 1,087 | `52710471231f661ea3c5eb6d1df75e01f02eebb2a3445b1922025539468046f7` |

The clipped inputs are truthfully recorded by the importer as `operator_supplied_local` with their own SHA-256. The receipt separately binds them to the verified publisher extracts; it does not falsely label a derived file as a direct Geofabrik download.

## Migrations and role boundary

The reviewed runner applied exact bytes in this order:

`001, 002, 003, 004, 005, 006, 007, 009, 010`

Historical `008` remained excluded and byte-identical. The first run applied exactly nine files. The second run emitted zero stdout bytes, zero stderr bytes, applied zero migrations, and left the ledger unchanged: a true no-op. Individual migration digests are in the JSON receipt.

The profile exercises the reviewed import-schema lease and production importer/projector. It does not relax RLS or table grants. One staging-only prerequisite grants `projection_role` database `TEMPORARY` because the production projector uses transaction-scoped `pg_temp` candidate tables; it expressly proves persistent database `CREATE` remains false and includes a single-statement rollback instruction.

The projector originally issued `FOR SHARE` against input tables even though the reviewed projection role has read-only input-table privileges. The implementation now relies on the existing region-scoped transaction advisory lock, repeats the preflight under that lock, and fails `active_import_changed` if the selected source changed. No input DML, RLS weakening, or broader grant was added.

Runtime proof: five and only five `SECURITY DEFINER` read functions, no runtime base-table access, no GIS schema access, 48 RLS policies, target-restricted cancellation, direct `pg_cancel_backend` denial, and statement-timeout/cancellation rollback with unchanged graph/import counts.

## Capacity measurements

All quota figures below use `pg_database_size`, not filesystem usage or dump compression.

| Stage | Local bytes | Conservative managed-equivalent bytes | Outcome |
| --- | ---: | ---: | --- |
| Empty local system/PostGIS baseline | 7,804,595 | 60,000,000 | baseline |
| Migrations + PostGIS, no outdoor data | 18,699,955 | 70,895,360 | baseline |
| Full Harz, active graph, post maintenance | 1,055,987,379 | 1,108,182,784 | over hard ceiling |
| Full Innsbruck, active graph, post maintenance | 576,345,779 | 628,541,184 | over hard ceiling |
| Full Harz + full Innsbruck, post maintenance | 1,615,787,699 | 1,667,983,104 | over hard ceiling |
| Accepted bounded cores, first active generation | 172,078,771 | 224,274,176 | fits |
| Accepted bounded cores, second imports retained | 187,152,051 | 239,347,456 | fits |
| Accepted bounded cores, active + superseded generation, pre maintenance | 303,167,155 | 355,362,560 | fits operating target |
| Accepted bounded cores, active + superseded generation, post maintenance | **303,462,067** | **355,657,472** | **fits operating target** |

The small post-maintenance increase is normal relation/catalog allocation; dead tuples fell from 28 to zero. No `VACUUM FULL`, unsafe rewrite, or deletion was used.

### Transient database-size peaks

| Workload | Local peak bytes | Conservative managed-equivalent bytes |
| --- | ---: | ---: |
| Full Harz import | 462,722,739 | 514,918,144 |
| Full Harz dry projection | 1,030,829,747 | 1,083,025,152 |
| Full Harz active projection | 1,959,409,331 | 2,011,604,736 |
| Full Innsbruck import | 293,090,995 | 345,286,400 |
| Full Innsbruck dry projection | 582,129,331 | 634,324,736 |
| Full Innsbruck active projection | 1,073,338,035 | 1,125,533,440 |
| Full combined active projection | 2,112,452,275 | 2,164,647,680 |
| Accepted first-generation imports | 62,953,139 | 115,148,544 |
| Accepted first-generation dry projection | 129,382,067 | 181,577,472 |
| Accepted retained-refresh imports | 215,873,203 | 268,068,608 |
| Accepted retained-refresh projection | **400,864,947** | **453,060,352** |

The accepted settled state leaves 44,342,528 bytes before the 400 MB operating target and 144,342,528 bytes before the hard ceiling. The actual retained-refresh peak leaves 46,939,648 bytes before the hard ceiling. Thus the 100 MB/20% hard-ceiling reserve remains intact after the database returns to its settled state; another 44,342,528 bytes remain inside that reserve for ledger growth, operational metadata, ordinary drift, and maintenance.

The profile proves one retained refresh in addition to the active generation. It does not prove a third retained generation. Before a third refresh, a separately reviewed lifecycle operation must archive/delete the oldest retained generation, or the project must move off Free.

Using the user-supplied 11.7 MB observed remote baseline instead of the conservative 60 MB allowance would yield 307,357,472 settled bytes and 404,760,352 peak bytes. Those smaller figures are not used for the decision.

## Profile comparison and information loss

- Full Harz alone is over 1 GB, so full Harz plus any Innsbruck AOI is impossible on Free by monotonic lower bound.
- Full Innsbruck alone is 576,345,779 local bytes, already over 500 MB before managed-baseline adjustment.
- A broader bounded two-region rectangle settled at 436,360,883 local / 488,556,288 managed-equivalent bytes and peaked at 670,660,275 local / 722,855,680 managed-equivalent bytes. It failed both the operating target and transient hard ceiling.
- Selective entity-type projection was not adopted. The accepted spatial profile preserves the complete evidence-graph semantics present inside the explicit polygons: entities, assertions, relationships, source links, provenance, route memberships, access candidates, freshness, active imports, and quarantine state.

| Region/measure | Full | Accepted | Retained | Lost |
| --- | ---: | ---: | ---: | ---: |
| Harz POIs | 2,949 | 251 | 8.51% | 91.49% |
| Harz trail segments | 141,197 | 5,405 | 3.83% | 96.17% |
| Harz hiking relations | 887 | 114 | 12.85% | 87.15% |
| Harz memberships | 29,684 | 2,214 | 7.46% | 92.54% |
| Harz graph entities | 145,033 | 5,770 | 3.98% | 96.02% |
| Harz assertions | 167,999 | 7,956 | 4.74% | 95.26% |
| Harz relationships | 29,467 | 2,132 | 7.24% | 92.76% |
| Innsbruck POIs | 1,629 | 67 | 4.11% | 95.89% |
| Innsbruck trail segments | 74,982 | 15,592 | 20.79% | 79.21% |
| Innsbruck hiking relations | 500 | 42 | 8.40% | 91.60% |
| Innsbruck memberships | 7,826 | 650 | 8.31% | 91.69% |
| Innsbruck graph entities | 77,111 | 15,701 | 20.36% | 79.64% |
| Innsbruck assertions | 91,840 | 18,150 | 19.76% | 80.24% |
| Innsbruck relationships | 7,804 | 643 | 8.24% | 91.76% |

The loss is explicit and geographic, not semantic. Requests outside the tracked polygons must be rejected or described as uncovered; they must never be silently presented as full-region coverage.

Required category counts remain nonzero:

| Region | Lakes | Peaks | Viewpoints | Waterfalls | Alpine huts | Wilderness huts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Harz core | 1 | 141 | 96 | 12 | 0 (none in full source) | 1 |
| Innsbruck core | 1 | 18 | 39 | 7 | 1 | 1 |

Harz retains 5,405 classified trails, including 4,418 with surface, 622 with trail visibility, 649 with `sac_scale`, and 2,095 with an access-state field. Innsbruck retains 15,592 trails, including 10,140 with surface, 310 with visibility, 620 with `sac_scale`, and 2,232 with an access-state field.

## Catalog contributors

Final schema totals: `trailmind_app` 284,966,912 bytes; `trailmind_gis` 7,315,456; `pg_catalog` 12,206,080; `information_schema` 253,952.

| Relation | Heap bytes | Index bytes | TOAST bytes | Total bytes |
| --- | ---: | ---: | ---: | ---: |
| `outdoor_research_projection_assertions` | 71,286,784 | 14,106,624 | 8,192 | 85,450,752 |
| `outdoor_research_projection_entities` | 63,938,560 | 16,474,112 | 794,624 | 81,248,256 |
| `outdoor_research_assertions` | 15,212,544 | 25,608,192 | 8,192 | 40,861,696 |
| `outdoor_evidence_trail_segments` | 17,391,616 | 10,592,256 | 98,304 | 28,114,944 |
| `outdoor_research_entities` | 10,002,432 | 5,390,336 | 8,192 | 15,433,728 |
| `outdoor_research_source_entities` | 3,465,216 | 7,585,792 | 8,192 | 11,091,968 |
| `outdoor_research_projection_relationships` | 9,093,120 | 1,720,320 | 8,192 | 10,854,400 |
| `trailmind_gis.spatial_ref_sys` | 7,061,504 | 212,992 | 8,192 | 7,315,456 |
| `outdoor_research_osm_entity_identities` | 2,514,944 | 3,596,288 | 8,192 | 6,152,192 |
| `outdoor_research_relationships` | 1,228,800 | 1,015,808 | 8,192 | 2,285,568 |

The machine receipt contains every application table's heap/index/TOAST/total split and the 20 largest individual indexes. In the rejected full-combined profile, the dominant relations were projection assertions (423,993,344 bytes), projection entities (422,420,480), canonical assertions (210,911,232), trail segments (159,334,400), source links (115,523,584), canonical entities (95,428,608), projection relationships (72,359,936), and OSM identities (65,470,464). The duplication required for retained projection provenance—not raw PBF size—is the principal capacity driver.

## Performance and correctness

Each of five representative anchors—Brocken, Ilsenburg, Schierke, Innsbruck, and Nordkette—received one warmup plus five deterministic measurements. The complete-suite run recorded:

| Query | Worst observed p95 | Existing threshold |
| --- | ---: | ---: |
| Route membership | 168.8 ms | 1,500 ms |
| Routable highlight access | 108.4 ms | 1,500 ms |
| Evidence corridor | 5.4 ms | 2,500 ms |

Real `EXPLAIN (ANALYZE, BUFFERS)` plans used the intended relationship index, trail point/geography GiST indexes, region-boundary GiST, trail metric GiST, and POI metric GiST. Representative Brocken and Innsbruck research dossiers and candidate shaping completed without provider routing, each yielding three validated proposals in a truthful partial state.

The accepted database also proves:

- exact EPSG:4326 longitude/latitude geometry and metric SRID 25832;
- non-overlapping Harz/Innsbruck polygons;
- input SHA-256 identical across active import and active projection lineage;
- deterministic repeated dry/active runs report `unchanged`;
- second current-source generation counts/digests match the first;
- zero unexplained quarantines;
- cancellation and statement-timeout rollback leave imports, runs, entities, and relationships unchanged.

## Backup and restore

The final retained-refresh database was dumped in PostgreSQL custom format with zstd level 9 and restored to a second PostgreSQL 17.10/PostGIS 3.6.4 disposable cluster.

- Compressed dump: 25,082,690 bytes.
- Dump SHA-256: `cd9ace551eb384ac6f6fb5a654ed6a1127ee608ad262668fd5b8ea62dce6b007`.
- Source `pg_database_size`: 303,462,067 bytes.
- Restored size before ordinary analyze/vacuum: 278,435,507 bytes.
- Restored size after ordinary analyze/vacuum: 277,952,179 bytes.
- Source/restored row-count digest: `f68852d66a3d2210a183f0aaa6fb2b5d` on both.
- Restored policies: 48; wrong object owners: 0; dead tuples: 0; quarantines: 0.

The restore is smaller because logical dump/restore reconstructs relations without the source's allocated free pages. Neither compressed dump size nor temporary local disk consumption is used as a Supabase compatibility claim.

## Local PostgreSQL observation

Two Homebrew PostgreSQL parallel workers exited with signal 11 during the disposable full-control runs: one during full-Harz active projection and one during database-wide vacuum. PostgreSQL crash recovery fully rolled back the partial projection, and the complete control was rebuilt. Accepted measurements used `max_parallel_workers_per_gather=0` and owner-scoped maintenance with `max_parallel_maintenance_workers=0`. This is recorded as a local toolchain observation only; no behavior is inferred for managed Supabase.

## Verification

- Focused importer/projector/runtime/PostGIS capacity suite: 22/22 passed.
- Complete backend suite: 1,072/1,072 passed; 0 failed/cancelled/skipped.
- Backend syntax build: passed.
- Offline outdoor quality evaluation: 101/101; zero false-claim, provenance, route-verification, high-stakes-authority, must-have, bounds, or determinism violations.
- JSON parse/schema/digest, `git diff --check`, credential/conflict/whitespace/generated-artifact scans: recorded after the final receipt digest pass.

## Later remote operating instruction

A later remote run may use only `supabase-free-bounded-two-core-v1`, after repeating all live identity, quota, empty-state, migration, advisor, and concurrency gates against the explicitly authorized staging project. Apply exact migrations `001–007, 009, 010`, then the profile's guarded temporary-workspace prerequisite, then import with explicit `--staging-profile supabase-free-bounded-two-core-v1` and the verified current derived inputs. Stop on any managed-platform semantic or size difference.

Do not provision either full region, do not label the bounded polygons as full coverage, and do not retain a third generation on Free.
