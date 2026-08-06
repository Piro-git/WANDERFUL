# Outdoor Adventure Targeted Live Route Quality Proof V4 — Attempt 3

## Result

Attempt three **failed at the provider-disabled database preflight**. The
current Harz real Evidence Graph projection reached the reviewed projection
timeout and rolled back. This is a database-gate failure, not a route-quality
result.

No provider admission followed. GraphHopper accounting remained zero, all four
canonical route cases remained not run, and closed-beta eligibility remains
false.

## Attempt separation and preservation

| Attempt | Status | Database work | Provider calls | Route quality | Receipt hashes preserved |
| --- | --- | ---: | ---: | --- | --- |
| 1 | storage-blocked | 0 | 0/15 | `not_run` | yes |
| 2 | deletion-guard-blocked | 0 | 0/15 | `not_run` | yes |
| 3 | database-preflight-failed | bounded disposable proof | 0/15 | `not_run` | new namespace |

Attempt-one hashes remain:

- Markdown: `fc1e00c7063b794136c2368bc3c950f5677077934c45905c25391973abfc5a14`
- Summary: `5477240eb9a2569cb0ffbf167f61c1edb87ededa7e8c420e271833e4c7f0063c`

Attempt-two hashes remain:

- Markdown: `76650b3392885ba4683d6fdcd336aca3273e2b4040e359fb9aab0bd031b1f09b`
- Summary: `7aa8a4b992514ded013ef5ebc6a6218f87b559997220a3c240e7fc39a436d737`

Attempt three uses authorization
`USER_AUTHORIZED_V4_ATTEMPT_3_2026-08-05_15_CALLS`, ledger namespace
`outdoor-adventure-v4-attempt-3-2026-08-05`, and closed zero-call ledger digest
`dd646af7866a77f82ed595549c4d50a1f2bbf8f3ea3e62768afe9477d163f29f`.
The temporary ledger itself was removed during cleanup.

## Storage recovery

All six deletion targets independently passed the new exact authorization,
process, open-handle, nested-repository, cleanliness, and content-classification
checks. The only nested Git metadata belonged to 12 clean rebuildable Swift
Package checkouts under `SourcePackages/checkouts`.

| Authorized DerivedData root | Disk usage (KiB) | Deleted |
| --- | ---: | --- |
| `WanderfulReleaseDerivedData` | 806,656 | yes |
| `WanderfulDerivedData` | 961,736 | yes |
| `TrailMindDerivedData-RoutableAccess-Final` | 1,063,192 | yes |
| `TrailMindDerivedData-RoutableAccess-Release` | 1,237,948 | yes |
| `TrailMindDerivedData-RoutableAccess-Debug` | 1,411,208 | yes |
| `TrailMindDerivedData-RoutableAccess` | 1,447,736 | yes |

The candidates totaled exactly 6,928,476 KiB (6.608 GiB) of disk usage.
Settled free space increased from 8,145,472 KiB (7.768 GiB) to 13,931,980
KiB (13.287 GiB), a settled recovery of 5,786,508 KiB (5.518 GiB). The
mandatory 10 GiB gate passed.

Deletion was permanent and is not directly recoverable. The deleted material
was rebuildable Xcode/Swift Package DerivedData; Xcode and Swift Package
Manager can regenerate it. The V4 proof worktree and all receipt files were
outside the deletion set and remained intact.

## Baseline, flags, and Golden Set binding

- Baseline and candidate: `cc4f478580ed883223e7eaa6140e686b2e5f5f6d`
- `HEAD == origin/main` at admission: yes
- Provider fail-closed commit is an ancestor: yes
- Golden Set schema: version 2, 26 unique cases
- Attempt-three manifest digest:
  `2391ffef6b77e8ede539c7ecd4c96f40ce840457c94ba8fe5662a2a9d8adb1e0`
- All 13 reviewed flags: false initially, during database execution, and
  finally
- `INTENT_PROVIDER_ENABLED`: false

No provider credential was admitted or inspected. Local iOS configuration was
not read, copied, or modified.

## Disposable PostGIS preflight

The proof used PostgreSQL 17.10 with PostGIS 3.6.4, bound only to loopback. Its
proof-specific role had no superuser, database-create, role-create,
replication, or RLS-bypass privilege. PROJ network access remained disabled.

### Migrations

- First migration run: 7 migrations applied, in order, 001 through 007
- Second migration run: 0 migrations applied
- Ledger rows after both runs: 7
- Migration 006 and 007 index identities remained unchanged
- Second run classification: true no-op

### Current checksum-bound imports

| Region | Active source class | Source time | Trail segments | Route members | Fresh | Checksum verified |
| --- | --- | --- | ---: | ---: | --- | --- |
| Harz | Harz-only merge of three current regional extracts | 2026-08-04 20:20 UTC | 140,623 | 29,525 | yes | yes |
| Innsbruck | current Tirol regional extract | 2026-08-02 23:00 UTC | 75,996 | 8,101 | yes | yes |

The Harz derivation was reference-complete for way nodes and bound to three
publisher MD5 values, three exact input SHA-256 values, the checked-in
`harz-v1` polygon, and a deterministic merged-input SHA-256. The sanitized
upstream provenance-manifest digest is
`deb33042a1c5c4637f2eec05650cb4eed6cc274891d5b23a6fb4e0230e92088d`.

One Tirol import was rejected before staging because its supplied retrieval
timestamp was one second ahead of the database clock. The database timing
constraint worked as designed; no row was promoted. The rerun used the
already-observed timestamp and promoted the checksum-identical input.

### Projection outcome

The Harz dry run passed:

- entities: 144,461
- relationships: 29,309
- quarantined: 0
- duration: 63,933 ms

The Harz real projection then failed with `projection_timed_out` after 128,634
ms. The failure transaction rolled back. Post-failure verification found:

- active projections: 0
- projection entities: 0
- quarantined projection rows: 0
- residual import staging schemas: 0
- import/projection child processes: 0

The failed run retained only its bounded failed audit record while the
disposable database existed. That database was subsequently removed.

In accordance with the stop rule, Innsbruck projection, regional-isolation,
index-readiness, query-plan, latency, cancellation, candidate/proposal, and
lineage gates were not run after the decisive projection failure. No provider
gate was admitted.

## Provider accounting

| Counter | Value |
| --- | ---: |
| Authorized ceiling | 15 |
| Attempted | 0 |
| Successful | 0 |
| Failed | 0 |
| Timed out | 0 |
| Cancelled | 0 |
| Controlled post-success failures | 0 |
| Unused | 15 |
| Retries | 0 |
| Probes after circuit-open | 0 |

Reconciliation is `0 = 0 + 0 + 0 + 0`. Provider egress and provider
credential admission were both false.

## Canonical outcomes

| Canonical case | Technical pipeline | Product quality | Golden case evaluation |
| --- | --- | --- | --- |
| `case-15-partial-provider-failure-survivor` | `not_run` | `not_applicable` | `fail` |
| `case-04-harz-brocken-must-have-landmark` | `not_run` | `not_applicable` | `fail` |
| `case-07-innsbruck-viewpoint-loop` | `not_run` | `not_applicable` | `fail` |
| `case-08-innsbruck-easy-conservative-loop` | `not_run` | `not_applicable` | `fail` |

The case-evaluation values are `fail` because no observed route result could
match the committed expected outcomes. They do not classify route quality as
failed: route quality is independently `not_run`.

No Brocken distance or strict reach result, Innsbruck viewpoint reach result,
Innsbruck easy-difficulty result, or controlled-survivor result exists for
attempt three.

## Independent gates

- Physical iPhone App Attest: `not_run`
- Independent human expert review: `not_completed`
- Server-side route quality: `not_run`
- Closed-beta eligible: false

No Simulator, agent judgment, or historical route was substituted for these
gates.

## Cleanup and verification

Cleanup removed the disposable database cluster, downloaded and derived PBFs,
captures, logs, and temporary ledger: 2,891,948 KiB of attempt-three runtime
material. No proof process, listener, lease, pool, or provider resource remains.
The final disabled zero-work probe performed zero database, provider, budget,
lease, authorization, and orchestrator operations. Final measured free space
remained above 10 GiB.

Verification after cleanup:

- focused V4/attempt-two/attempt-three tests: 37/37 passed
- server-live and provider-flag regressions: 28/28 passed
- complete backend suite: 677/677 passed after rerunning with local loopback
  socket permission; the initial sandboxed run failed only with `listen EPERM`
- backend syntax build: passed
- offline route-quality evaluation: 101/101 passed
- Golden Set/source-manifest JSON checks: passed (26 unique schema-v2 cases)
- attempt-three false-green/privacy receipt tests: 7/7 passed
- real migration/import/projection execution: completed through the recorded
  projection failure; the remaining real PostGIS integration gates were not
  run after the mandatory stop

All eight protected historical V1/V2/V3 receipt hashes and both prior V4
receipt pairs still match their recorded values.

Nothing was staged, committed, pushed, deployed, released, or enabled.
