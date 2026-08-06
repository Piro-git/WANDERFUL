# Outdoor Adventure Targeted Live Route Quality Proof V4 — Attempt 5

## Result

Attempt 5 is **blocked at the mandatory pre-provider database planning gate**.
The current-data imports, optimized projections, repeat/no-op behavior,
lineage, isolation, indexes, corridor plan, and cancellation rollback gates
passed. The committed V4 database-gate suite then evaluated the new import with
its fixed Attempt 4 clock (`2026-08-05T21:30:00.000Z`). That clock predates the
truthful Attempt 5 retrieval/import, so the first canonical research case
returned `unsupported` instead of the required `ready` state.

The fail-closed stop rule was applied immediately. Product Shaping V3 admission,
credential admission, provider egress, route evaluation, the remaining test
suites, offline evaluation, and build were not run.

- Overall status: `blocked`
- Blocker: `database_preprovider_plan_unsupported`
- Database preflight: `failed`
- Product Shaping V3 live activation proof: `not_run`
- Provider proof: `not_run`
- Route quality: `not_run`
- Provider accounting: 0 attempted, 15 unused
- Physical-iPhone App Attest: not proved
- Human review: not completed
- Closed-beta eligible: false

The machine-readable receipt is
`OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4_ATTEMPT_5.summary.json`.
Its immutable semantic digest is
`7d1a405609f18ed575207b70e45ec228924019857d177f6af4b11470cb4a8822`.

## Baseline, duplicate gate, and historical protection

The attempt used a new detached isolated worktree at exact `origin/main`
`2c3e4e4c3ec319e6e5497cb83435c421fe3bf60f`. The baseline contains
`8bc11b9` (provider-admission rollback) and `2c3e4e4` (Product Shaping V3).
Shared `main` was clean and remained untouched. No complete Attempt 5, active
Attempt 5 worktree, ledger, lock, receipt, or provider process existed.

Attempts 1–4 remain byte-exact:

| Attempt | Markdown SHA-256 | JSON SHA-256 |
| ---: | --- | --- |
| 1 | `fc1e00c7063b794136c2368bc3c950f5677077934c45905c25391973abfc5a14` | `5477240eb9a2569cb0ffbf167f61c1edb87ededa7e8c420e271833e4c7f0063c` |
| 2 | `76650b3392885ba4683d6fdcd336aca3273e2b4040e359fb9aab0bd031b1f09b` | `7aa8a4b992514ded013ef5ebc6a6218f87b559997220a3c240e7fc39a436d737` |
| 3 | `3e11f9bdee5fa0da85a5f6f33d33d1065c10db017d8d078dc79afcfeca681690` | `9bd4fb94f67c997961254d70fbe58317dd40b4ef6ec111de90a81e3c3b5e2522` |
| 4 | `c36f664d25e8c4641419f0848d0b117d93207249d336030c37d905a7da245b69` | `f35c64f6cecf5cfb63ecb412e2ad6ae8b2671e2709c90139a4022938fe871119` |

## Storage, process, and credential preflight

Three settled free-space samples passed; the minimum was 12,270,068 KiB,
above the unchanged 10 GiB gate. No conflicting PostgreSQL, proof, import,
projection, ledger, lock, or listener existed, and the selected loopback port
was free.

The approved credential envelope was verified only as a regular file owned by
the current user, mode `0600`, and not a symlink. Its contents were never read,
sourced, printed, hashed, copied, or admitted. The local Xcode configuration
was not inspected.

## Current-data PostGIS evidence

The proof ran PostgreSQL 17.10 and PostGIS 3.6.4 with a least-privileged proof
role. Migrations 001–007 applied in order; the second committed migration run
applied zero files and was a true no-op.

All four publisher inputs had embedded source time `2026-08-05T20:21:23Z` and
passed the publisher's current MD5:

| Input | Publisher MD5 |
| --- | --- |
| Niedersachsen | `752086e94b3dbd65d9e5a66fa2ad428c` |
| Sachsen-Anhalt | `7134068b1049e108973d182f6786930b` |
| Thüringen | `0922c961ac7fdcb2e383d4a8aaca53eb` |
| Austria | `156109dfe301dcc7219de2f1a92b1687` |

Checked-in operational polygons and `complete_ways` produced these bounded
inputs and active imports:

| Region | Bounded SHA-256 | POIs | Trails | Hiking relations | Route members |
| --- | --- | ---: | ---: | ---: | ---: |
| Harz | `4ab343a5836200b36c36401a0b8b54701f4fcba8197fdd25fcf069ee177fb7b0` | 2,951 | 140,625 | 887 | 29,525 |
| Innsbruck | `6134edd52dad3515a3e06757188952292dc2ecf8a6bfa7d3a2e273ec1b52f507` | 1,619 | 74,743 | 500 | 7,785 |

The optimized dry and persistent projections stayed below the unchanged
120-second limit and repeated as `unchanged`:

| Region | Dry run | Persistent | Entities | Assertions | Relationships | Quarantine |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Harz | 13,456 ms | 72,886 ms | 144,463 | 167,374 | 29,309 | 0 |
| Innsbruck | 18,697 ms | 45,399 ms | 76,862 | 91,480 | 7,763 | 0 |

Aggregate totals were 221,325 entities, 258,854 assertions, 37,072
relationships, 221,325 stable source links, and zero quarantine rows. The
projection validators found zero entity-lineage, assertion-scope,
relationship-scope, forbidden-assertion, freshness, or snapshot-consistency
violations.

## Index, query, isolation, and rollback gates

All six reviewed GiST indexes were valid and ready. The real corridor plan used
the required region, POI, and trail indexes and measured 128.3 ms wall-clock /
92.2 ms database execution against the unchanged 2,500 ms statement limit.
The region boundaries did not overlap, and all four mismatched-region probes
returned zero results.

Cancellation produced the exact lifecycle `began`,
`query_cancelled_after_abort`, `rollback_completed_after_cancel`, with zero
leaked transactions or waiting pool work.

Membership and access p95 benchmarks were not run after the stop condition;
their unchanged 1,500 ms thresholds remain recorded as `not_run`, not passed.

## Mandatory gate failure and V3 state

The committed database-gate suite passed four checks and failed one. The first
pre-provider case returned research state `unsupported`; `ready` was required.
The truthful current retrieval/import occurred after the suite's fixed
Attempt 4 clock, so the freshness/provenance contract rejected it.

The Product Shaping V3 policy was present and digest-bound in the receipt:

- policy version: `research-guided-route-product-shaping-v3`
- semantic digest: `70a01b65b7c8a19077288bc09fcf47174a0ab1e0058e31a320a5e8e4a2eaba42`

V3 was not claimed active because the mandatory database gate stopped before
candidate-plan admission. No legacy fallback was used.

## Provider and canonical cases

The authorization reference and unique ledger namespace are bound in the JSON
receipt. No ledger was created because provider admission was never reached.
Accounting reconciles exactly as `0 = 0 + 0 + 0 + 0`; all 15 calls remain
unused. There were no retries, controlled injections, circuit probes, AI calls,
or GraphHopper calls.

| Case | Technical pipeline | Product quality | Evaluation | Route metrics |
| --- | --- | --- | --- | --- |
| Controlled survivor | `not_run` | `not_applicable` | `fail` | none |
| Brocken | `not_run` | `not_applicable` | `fail` | none |
| Innsbruck viewpoint | `not_run` | `not_applicable` | `fail` | none |
| Innsbruck easy | `not_run` | `not_applicable` | `fail` | none |

The evaluation field is `fail` because no observed route can match the Golden
Set expectation. Route quality itself remains separately `not_run`. No actual
distance, duration, ascent, snapping, reach, overlap, backtracking, loop-shape,
or difficulty metric exists for Attempt 5.

## Comparison and verification

Attempts 1, 2, and 4 blocked before route observations; Attempt 3 failed at
projection timeout. Attempt 5 confirms the optimized projections now complete
within policy, but it adds no route-quality comparison against V1/V2/V3 or
Attempt 4 because provider execution did not occur.

Executed verification:

- mandatory database-gate suite: 4 passed, 1 failed;
- migration repeat/no-op, projection repeat/unchanged, index, corridor,
  isolation, and cancellation gates: passed;
- final disabled zero-work probe: passed with zero authorization, database,
  provider, budget, lease, or orchestrator work.

Attempt 5 focused/provider/V3/V2 adapter suites, full PostGIS integration, full
backend suite, offline quality evaluation, Golden Set validation, and
`npm run build` were not run after the mandatory stop. No Swift or Xcode file
changed, so Xcode was not run.

## Cleanup and Git state

Cleanup stopped and removed the disposable database, publisher and bounded
PBFs, logs, captures, the entire 4,380,484 KiB task runtime, and the isolated
dependency install. The credential envelope was permanently deleted after
abort and verified absent. No task process or listener remains. Three final
free-space samples settled at a minimum of 12,345,268 KiB. All feature flags
remained exact false, and the final disabled zero-work probe passed.

Only these new receipt files are changed:

- `docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4_ATTEMPT_5.md`
- `docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4_ATTEMPT_5.summary.json`

Both remain untracked and unstaged. Nothing was committed, pushed, deployed,
released, or enabled.

## Remaining blockers

The V4 database-gate clock must be reviewed and versioned so it evaluates
truthful current imports without backdating retrieval metadata. Any later live
proof requires a new explicit authorization and a new ledger namespace. V3
activation, membership/access p95, provider behavior, all four route-quality
cases, physical App Attest, and independent human review remain unproved.
