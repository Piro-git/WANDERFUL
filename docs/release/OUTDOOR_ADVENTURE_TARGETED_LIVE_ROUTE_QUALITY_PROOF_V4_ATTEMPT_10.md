# Outdoor Adventure Targeted Live Route Quality Proof V4 — Attempt 10

## Result

Attempt 10 is **blocked at the committed runtime-database admission gate**.
Every substantive privilege, current-data, geometry, index, performance, and
cancellation check passed, but the committed runner rejected PostgreSQL's
standard masked text representation of a loopback server address. PostgreSQL
returned an IPv4 loopback value with its host mask; the runner accepts only
unmasked loopback literals. It therefore emitted
`database_runtime_role_admission_failed` before credential admission.

This is a production proof-runner defect. It was not repaired or rerun under
the same authorization. No provider ledger was created and no GraphHopper or
AI-provider call occurred.

- Overall status: `blocked`
- Blocker: `database_runtime_loopback_address_normalization_mismatch`
- Database preflight: `failed` at the committed runner admission assertion
- Provider proof: `not_run`
- Route quality: `not_run`
- Provider accounting: 0 attempted, 15 unused
- Physical-iPhone App Attest: not proved
- Independent human review: not completed
- Closed-beta eligible: false

The machine-readable receipt is
`OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4_ATTEMPT_10.summary.json`.
Its semantic digest is
`c3e24849fe4935b5cd61a0b9299a4dd3cb6201f030bd7efea3601e0f0a7fb257`.

## Baseline, duplicate gate, and proof identity

The attempt used a clean detached isolated worktree at exact `origin/main`
`abf3d6853d8f604f9701434d89c2e4fc892d19f9`; baseline and candidate are
identical. The shared `main` checkout remained clean and untouched. No prior
Attempt 10 worktree, identity, ledger, lock, receipt, or provider process was
found.

- Authorization:
  `USER_AUTHORIZED_V4_ATTEMPT_10_2026-08-20_15_CALLS`
- Ledger namespace:
  `outdoor-adventure-v4-attempt-10-2026-08-20-zm0jul`
- Git candidate attestation digest:
  `54fe463ed7ca09fa1102624f0290c78647a3fe5040c4b59bb97f38848bab38f8`
- Proof identity digest:
  `d4ba9a6d09c6ca57cce13dc082adc3a5ffe1d6198d5172a6fdf99889680b1ee1`
- Identity artifact digest:
  `f292df659086c516513f475d393073fdadb3ce5c17be73e1f9c1c74526fd44d3`
- Sealed proof time: `2026-08-20T15:43:29.452Z`
- Proof-run context digest:
  `448a895994fd80b2dba1e63764d45b7c48009a75cbeec3041d3c6938fbc4be95`

## Storage, process, and credential preflight

The initial settled storage gate passed at 11.725 GiB. After the disposable
database was populated, four already-verified publisher PBF downloads were
removed because they were the least-used, easiest-to-regenerate task inputs.
Two pre-provider readings then settled at 10,715,948 and 10,710,424 KiB,
both above the unchanged 10 GiB threshold. No conflicting process or listener
was present before provisioning.

No reviewed disposable credential envelope existed in the authorized
temporary or standard external configuration locations. Only filename and
file metadata checks were performed. Credential contents were never read,
printed, copied, logged, hashed, or persisted, and
`Configuration/Local.xcconfig` was not inspected. The committed runner stopped
at database admission before credential admission, so this absence was not the
operative stop reason.

## Disposable PostGIS and current evidence

The proof used PostgreSQL 17.10 and PostGIS 3.6.4 on loopback only. Migration,
import/projection, direct runtime, and bounded read-auditor roles were distinct.
Migrations 001–008 applied in order; a second immediate run applied zero files
and was a true no-op. PROJ network access remained disabled.

All four current Geofabrik publisher inputs had source time
`2026-08-19T20:20:48Z` and passed the publisher's MD5 before use:

| Input | Publisher MD5 | Bytes |
| --- | --- | ---: |
| Niedersachsen | `0f23bae1f7c91177cfa6f060a1126e25` | 502,601,728 |
| Sachsen-Anhalt | `e34867633960dbb4cdb9871e97e888ff` | 173,565,381 |
| Thüringen | `794a85eaa4318f0085853a97e82047a3` | 159,135,696 |
| Austria | `b76d22300ffeba34312a03321e799d85` | 807,793,978 |

Retrieval was recorded at `2026-08-20T15:21:17Z`. Checked-in operational
polygons and `osmium extract --strategy=complete_ways` produced immutable
bounded inputs:

| Region | Bounded SHA-256 | POIs | Trails | Hiking relations | Route members |
| --- | --- | ---: | ---: | ---: | ---: |
| Harz | `35c15c6fa9fbee8c4ebcc607a91656f54cd42ffb47a4a8f32422065e773312a8` | 2,950 | 140,725 | 887 | 29,535 |
| Innsbruck Alps | `afbad597e9e0c075d0ec516689995059c7bafabbd7cd48ce1e91a8c6acd4371f` | 1,626 | 74,921 | 500 | 7,807 |

Both active imports used the reviewed `operator_supplied_local` channel and
were checksum-bound and current. Public Overpass was not used.

| Region | Dry projection | Persistent | Entities | Assertions | Relationships | Quarantine | Repeat |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Harz | 12,358 ms | 63,854 ms | 144,562 | 167,522 | 29,319 | 0 | `unchanged` |
| Innsbruck Alps | 20,049 ms | 49,992 ms | 77,047 | 91,742 | 7,785 | 0 | `unchanged` |

Aggregate totals were 221,609 entities, 259,264 assertions, 37,104
relationships, 221,609 stable source links, and zero quarantine rows. The
active OSM policy admitted 21 assertion scopes and one relationship scope,
normalized facts only. Invalid region, POI, trail, and projected geometries
were all zero. The two reviewed regions did not overlap, and all four canonical
planning queries reconciled to current active snapshots.

## Runtime, index, performance, and rollback gates

The direct runtime login was `LOGIN NOINHERIT`, had zero memberships, no RLS
bypass, no database temporary/create capability, no operational relation or
sequence privileges, owned no database objects, and could execute exactly the
five reviewed bounded V1 functions. Twelve direct negative probes all failed
closed: base read/insert/update/delete, active-view read, schema DDL, temporary
table, function and role creation, ownership change, `SET ROLE`, and RLS
bypass.

All six reviewed GiST indexes were valid and ready. The real corridor plan used
the required region, POI, and trail indexes, avoided a forbidden full
projection-entity scan, and measured 91.2 ms wall-clock / 77.9 ms database
execution under the unchanged 2,500 ms application limit.

The committed warmup-plus-five-sample membership gate returned nonzero rows
for all four cases:

| Case | Membership p95 |
| --- | ---: |
| Controlled survivor | 130.4 ms |
| Brocken | 164.4 ms |
| Innsbruck viewpoints | 124.7 ms |
| Innsbruck Easy | 118.7 ms |

The separate access gate measured 81.3 ms for the controlled survivor,
62.1 ms for Brocken, and 83.5 ms for Innsbruck viewpoints. Every measurement
was below the 1,500 ms p95 gate and used the reviewed representative-point or
trail-geography index.

Cancellation produced exactly `began`, `query_cancelled_after_abort`, and
`rollback_completed_after_cancel`, with zero leaked transactions and zero
waiting pool work.

## Mandatory committed-runner failure

The committed runner successfully created and verified the new immutable
identity, then stopped in `assertDatabaseAdmission`. All role and privilege
booleans were independently rechecked as true. The failing comparison was the
server-address loopback assertion: PostgreSQL's `inet` text includes the host
mask, while `loopbackHost` compares against only unmasked literal strings.

No threshold, database role, source record, migration, test, or production code
was changed to bypass the defect. Attempt 10 was not restarted. The necessary
correction is a separate reviewed production change with regression coverage,
followed by a fresh authorization, identity, and ledger namespace.

## Provider accounting and canonical cases

No ledger existed because provider admission was never reached. Reconciliation
is exactly `0 = 0 + 0 + 0 + 0`; all 15 calls expired unused. Maximum observed
concurrency was zero. There were no retries, controlled injections, rate-limit
events, circuit probes, AI calls, GraphHopper calls, raw responses, or late
results.

| Case | Technical pipeline | Product quality | Evaluation | Route metrics |
| --- | --- | --- | --- | --- |
| Controlled survivor | `not_run` | `not_applicable` | `fail` | none |
| Brocken | `not_run` | `not_applicable` | `fail` | none |
| Innsbruck viewpoints | `not_run` | `not_applicable` | `fail` | none |
| Innsbruck Easy | `not_run` | `not_applicable` | `fail` | none |

The case evaluations are `fail` because no observed route can meet a Golden
Set expected outcome. Route quality remains separately `not_run`; no actual
distance, duration, ascent/descent, snap, access-point reach, repetition,
backtracking, eligibility, viewpoint, or Easy-difficulty metric exists.

## Comparison and verification

Attempts 1, 2, 4, and 5 blocked before route observations, and Attempt 3
failed at projection timeout. Attempt 10 adds evidence that the current eight
migrations, least-privilege runtime boundary, current imports/projections, and
current-volume latency gates pass. It adds no route-quality comparison against
V1/V2/V3 or prior V4 attempts because provider execution did not occur.

Executed verification:

- run-scoped current-database gate: 2/2 passed;
- current-volume membership gate: 2/2 passed;
- current-volume access gate: 3/3 passed;
- full-volume privilege/geometry/index/cancellation audit: passed;
- committed live runner: blocked with
  `database_runtime_role_admission_failed` and zero calls;
- complete backend suite: 773/773 passed after allowing ephemeral loopback
  listeners (the sandbox-only run had produced `listen EPERM`);
- backend syntax build: passed;
- offline outdoor-adventure quality evaluation: 101/101 passed, zero skipped;
- historical receipt contract: 3/3 passed;
- no Swift or Xcode project file changed, so Xcode was not run.

## Historical integrity, privacy, and cleanup

Attempts 1–5 remained byte-exact, and all eight protected V1/V2/V3 release
receipts matched their committed SHA-256 values before and after the run.

Cleanup stopped the disposable server and removed the database cluster,
downloaded and bounded PBFs, imports/projections, logs, password files, npm
cache, installed dependencies, temporary audit tooling, and the verified
identity artifact. No ledger, capture, credential envelope, provider resource,
proof process, or listener remained. Three final storage readings settled at a
minimum of 13,677,644 KiB. A final disabled endpoint probe performed zero
authorization, database, provider, budget, lease, and orchestrator operations.

The receipt contains no credential, provider URL, database URL/password, raw
provider response, raw route geometry, private coordinate, raw prompt, App
Attest assertion, unbounded error, or mutable temporary path. Physical App
Attest and independent human approval remain unproved.

All 13 feature flags were exact false initially and finally. Nothing was
staged, committed, pushed, deployed, released, or enabled. Exact final
porcelain status:

```text
?? docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4_ATTEMPT_10.md
?? docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4_ATTEMPT_10.summary.json
```

## Remaining blockers

1. Correct and regression-test loopback address normalization in the committed
   proof runner as a separate task.
2. Start any future live proof only with a fresh explicit authorization,
   immutable identity, and ledger namespace; Attempt 10 cannot be reused.
3. Provider execution, controlled-survivor behavior, all four route-quality
   cases, physical App Attest, and independent human review remain unproved.
