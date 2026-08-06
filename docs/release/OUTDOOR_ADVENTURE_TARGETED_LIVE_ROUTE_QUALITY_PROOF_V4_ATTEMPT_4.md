# Outdoor Adventure Targeted Live Route Quality Proof V4 — Attempt 4

## Result

Attempt 4 is **blocked at provider credential admission**. Every mandatory
database gate passed first, but the approved process environment did not
contain a usable GraphHopper configuration. In accordance with the stop rule,
the proof made zero provider calls and did not classify route quality as a
failure.

- Overall status: `blocked`
- Blocker: `credential_unavailable`
- Database preflight: `passed`
- Provider proof: `not_run`
- Route quality: `not_run`
- Provider accounting: 0 attempted, 15 unused
- Closed-beta eligible: false

The machine-readable receipt is
`OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4_ATTEMPT_4.summary.json`.

## Isolation, baseline, and preservation

The attempt used a new detached isolated worktree at exact `origin/main`
`a4cd746dbd7ba401124bdb6388757f769f68024a`. The initial worktree was clean.
No equivalent Attempt 4, conflicting agent, or conflicting proof process was
found. The preserved V4 worktree was treated as read-only; its required
untracked V4 implementation and Attempts 1–3 were reviewed and copied into the
new worktree without modifying the source.

Initial settled free-space samples had a minimum of 13,799,636 KiB, above the
mandatory 10 GiB gate. No deletion was needed to enter the proof.

Attempts 1–3 remain distinct and byte-preserved:

| Attempt | Status | Reason | Provider calls | Route quality |
| --- | --- | --- | ---: | --- |
| 1 | blocked | `insufficient_settled_free_storage` | 0/15 | `not_run` |
| 2 | blocked | `authorized_cleanup_candidates_contain_git_metadata` | 0/15 | `not_run` |
| 3 | failed | `database_projection_timed_out` | 0/15 | `not_run` |
| 4 | blocked | `credential_unavailable` | 0/15 | `not_run` |

Attempt 4 uses authorization
`USER_AUTHORIZED_V4_ATTEMPT_4_2026-08-05_15_CALLS` and ledger namespace
`outdoor-adventure-v4-attempt-4-2026-08-05`. The distinct empty durable ledger
digest is
`7abe78ab24a402bfd17d586246f0cec05166f04b5e834a2a6382f9d9ab79e524`.
The temporary ledger itself was removed during cleanup.

## Disposable current-data PostGIS proof

The proof ran PostgreSQL 17.10 and PostGIS 3.6.4 on loopback only. The proof
role had no superuser, database-create, role-create, replication, or RLS-bypass
privilege. PROJ network access remained disabled.

All seven committed migrations (001–007) applied in order. The second migration
run applied zero files and was a true no-op. All six required GiST indexes were
valid and ready.

### Publisher inputs and bounded imports

The current publisher inputs all carried source time
`2026-08-04T20:20:51Z`. Publisher MD5 verification passed for Niedersachsen
(`0130f5e275009440c4cd1e5b385085dd`), Sachsen-Anhalt
(`f87b7b7a21ce745fbab11bdf89a32908`), Thüringen
(`5e719091fb2f199c6462ca5677005624`), and Austria
(`7e6d148524d67590e160d65ef7b12a4b`).

Checked-in operational polygons and `osmium extract --strategy complete_ways`
reproduced these exact bounded inputs:

| Region | Bounded SHA-256 | POIs | Trails | Hiking relations | Route members |
| --- | --- | ---: | ---: | ---: | ---: |
| Harz | `4ea0d1394b2f1bc41983ba206b22ee194eae196b298689aee0534fe2503b4b5d` | 2,951 | 140,623 | 887 | 29,525 |
| Innsbruck | `edc3ad6604d87007aaf81cd23bec99308d80cc9308ae156a6567901ef5f4a55c` | 1,619 | 74,740 | 500 | 7,785 |

Both active imports were checksum-bound and fresh. Public Overpass was not
used.

### Projection results

The unchanged production projection timeout remained 120 seconds.

| Region | Dry run | Persistent | Entities | Assertions | Relationships | Quarantine | Repeat |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Harz | 11,967 ms | 64,595 ms | 144,461 | 167,372 | 29,309 | 0 | `unchanged` |
| Innsbruck | 25,419 ms | 45,831 ms | 76,859 | 91,477 | 7,763 | 0 | `unchanged` |

Both persistent runs became the single active snapshot for their region. Every
entity had a stable source link; assertion and relationship policy scopes were
complete; forbidden active assertions, freshness violations, inconsistent
snapshots, and promoted quarantine rows were all zero. Transactional projection
and integration coverage proved rollback behavior with zero partial commits.

`complete_ways` intentionally retains full source ways that cross a polygon
edge: 817 in Harz and 336 in Innsbruck. This is source completeness, not
cross-region query leakage. Active repository queries require `ST_CoveredBy`;
the two reviewed boundaries do not overlap and all mismatched run/region query
probes returned zero rows.

## Query, index, and performance proof

Production statement timeout remained 2,500 ms. No timeout, memory, trigger,
RLS, constraint, freshness, or quality threshold was relaxed.

- Real corridor plan: required region, trail, and POI GiST indexes; 65 ms
  representative execution against a 2,500 ms limit.
- Current-volume mapped membership: representative worst p95 551.5 ms across
  the four cases, under the 1,500 ms gate; intended trail-point GiST index and
  no projection-entity sequential scan.
- Current-volume routable access: representative post-fix worst p95 72.0 ms,
  under the 1,500 ms gate; intended trail-geography GiST index and no
  projection-entity sequential scan.
- All four pre-provider plans were bounded to at most three proposals and had
  complete evidence/access lineage.
- Real cancellation produced the exact `began`,
  `query_cancelled_after_abort`, `rollback_completed_after_cancel` lifecycle,
  with no leaked transaction or waiting pool work.

Two non-fabricated diagnostic events are retained in the receipt. The first
membership benchmark overlapped PostgreSQL's initial automatic analyze and was
rerun unchanged only after that database-owned maintenance settled. More
importantly, the original full case-15 access plan scanned 2,949 region POIs
before joining the 32 requested IDs and measured 6,214.2 ms. Materializing the
requested highlight lookup before spatial containment changed that same plan to
32 primary-key lookups plus the existing trail-geography GiST scan; the
diagnostic execution measured 149.1 ms. Production thresholds did not change.

## Provider admission and accounting

Credential admission occurred only after every database gate passed. The
process checked the approved environment mechanism without printing any value,
reading `Configuration/Local.xcconfig`, searching the filesystem, or retaining
provider configuration. Admission returned `credential_unavailable`.

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

Reconciliation is exactly `0 = 0 + 0 + 0 + 0`. Provider egress was never
admitted. The controlled post-success failure was not armed because no genuine
provider success existed.

Regression tests now prove that a controlled failure attaches to the first
genuine success even if an earlier ordinal fails, and that two matching
immediate rate-limit failures open the circuit without later provider egress or
false probe accounting.

## Canonical case outcomes

The exact schema-v2 Golden Set order was preserved. No coordinate, POI, target,
fixture, threshold, or expectation was substituted.

| Case | Technical pipeline | Product quality | Evaluation |
| --- | --- | --- | --- |
| `case-15-partial-provider-failure-survivor` | `not_run` | `not_applicable` | `fail` |
| `case-04-harz-brocken-must-have-landmark` | `not_run` | `not_applicable` | `fail` |
| `case-07-innsbruck-viewpoint-loop` | `not_run` | `not_applicable` | `fail` |
| `case-08-innsbruck-easy-conservative-loop` | `not_run` | `not_applicable` | `fail` |

The evaluations are `fail` because no observed route can match the committed
expected outcome. This does not relabel the blocked proof as a route-quality
failure: route quality is separately `not_run`. No route metrics, geometry,
snapping, strict reach, easy-difficulty result, or controlled survivor exists
for Attempt 4.

## Independent trust gates

- Physical-iPhone App Attest: not proved
- Independent human expert review: not completed
- Closed-beta eligible: false

No Simulator or agent judgment was substituted.

## Verification and privacy

The real PostgreSQL/PostGIS integration suite passed 49/49 and the complete
backend suite passed 686/686. Backend syntax build, the 101-case offline
outdoor-adventure quality evaluation, and Golden Set schema-v2 validation for
all 26 unique cases passed. Receipt-contract reconciliation also passed.

The durable receipts contain no raw route geometry, provider response, provider
URL, secret value, precise location, prompt, database URL, App Attest material,
unbounded error, or temporary filesystem path. No Swift or Xcode project file
changed, so Xcode was correctly not run.

## Cleanup and Git state

Cleanup stopped the disposable database and removed exactly 4,361,040 KiB of
task-owned runtime data, including the database cluster, downloaded and bounded
PBFs, empty ledger, diagnostic capture, and logs. No task-owned listener,
process, pool, lease, or runtime path remains. A final disabled endpoint probe
performed zero authorization, database, provider, budget, lease, and
orchestrator operations. The final settled free-space minimum was 13,789,032
KiB.

The isolated source worktree and every historical receipt remain present. All
ordinary feature flags were false initially, during database work, at provider
admission, and finally. Nothing was staged, committed, pushed, deployed,
released, or enabled. The machine-readable receipt contains the exact final
porcelain Git status.

## Blocker and next action

The sole blocker is `credential_unavailable`. A future run requires a **new
authorized attempt** with a GraphHopper configuration already present in the
approved process environment. Attempt 4's authorization and empty ledger must
not be reset or reused.
