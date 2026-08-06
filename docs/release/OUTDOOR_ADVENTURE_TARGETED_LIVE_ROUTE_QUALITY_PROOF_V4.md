# Outdoor Adventure Targeted Live Route Quality Proof V4

## Result

The V4 proof is **blocked**, not passed. The settled storage preflight observed 8.561 GiB free against the protocol's hard 10 GiB minimum. The protocol therefore stopped before disposable PostGIS provisioning, regional data acquisition, App Attest, provider enablement, or route execution.

This is server-side diagnostic evidence only. It is not physical-device App Attest evidence, route-quality evidence, a closed-beta approval, or a release approval. `closedBetaEligible=false`.

## 1. Duplicate and baseline gate

- `origin/main`, the shared checkout, and the isolated detached worktree all resolved to `cc4f478580ed883223e7eaa6140e686b2e5f5f6d` before edits.
- The shared checkout and isolated worktree were clean before edits.
- No equivalent V4 implementation, overlapping uncommitted V4 work, or concurrent V4 file ownership was found.
- The Golden Set and provider fail-closed commits are ancestors of the baseline.
- CodeRabbit was not used.

## 2. Candidate and protected receipts

The candidate commit is the unchanged baseline commit `cc4f478580ed883223e7eaa6140e686b2e5f5f6d`; the V4 implementation and receipt are an unstaged, uncommitted worktree overlay.

| Protected artifact | Before and after SHA-256 |
| --- | --- |
| `OUTDOOR_ADVENTURE_SERVER_SIDE_LIVE_PIPELINE_PROOF_V1.md` | `04b749fb41c44e77121ff25678a60d68b0d763636c4db054935957f92e03ae1d` |
| `OUTDOOR_ADVENTURE_SERVER_SIDE_LIVE_PIPELINE_PROOF_V1.summary.json` | `6c57f5efc9bbec02ad0f49f7ab70bae43f9f61f4467afc8654f6c827ca7f69f3` |
| `OUTDOOR_ADVENTURE_END_TO_END_STAGING_PROOF_V1.md` | `0fdbdee5e931bdc307f5203e58b6e653269642da0db8b5f3ea397e8773303c0c` |
| `OUTDOOR_ADVENTURE_END_TO_END_STAGING_PROOF_V1.summary.json` | `e7614b1267390879c9037f028b40f9739eb0a61b4925fa58845fa5dd40c84e2f` |
| `OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V2.md` | `69c9cd93c7ea6361c625a3b8daf506a39d4e16e7363aa045a06e6516c0b1c94a` |
| `OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V2.summary.json` | `18946e87ea615b53c271179d648eae24b1cb427791cb3145b35fe81dfaf2b5f9` |
| `OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V3.md` | `597b4d0aa6890cf74a3b63b5dfb10e6d52220cace1d02de315aec122b8b2f522` |
| `OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V3.summary.json` | `6a247c8aeb21f1079cc625eba651ce32b281ab6b1c49690fbfdc183288c211bf` |

All eight hashes matched after V4 work.

## 3. Database preflight

`databasePreflight=blocked` with reason `insufficient_settled_free_storage`.

- Process classes checked: 5.
- Conflicting process classes: 0.
- Settled storage samples: 2.
- Settled free storage: 8.561 GiB.
- Required free storage: 10 GiB.
- Shortfall: 1.439 GiB.
- Disposable PostGIS instances provisioned: 0.

No user files, Simulator devices, archives, caches, or unrelated artifacts were deleted to force the gate.

## 4. Migration, import, index, and performance totals

These checks are `not_run` because the storage gate precedes provisioning:

- migration first-run applied count: 0;
- migration second-run applied count: 0;
- current regional imports verified: 0;
- current projections verified: 0;
- promoted quarantine rows reviewed: 0;
- live GiST indexes reviewed: 0;
- live membership queries measured: 0;
- live access-resolution queries measured: 0;
- cancellation/statement-timeout rollback: not run.

Static migration and repository contracts remain covered by the complete backend suite, but that is not a substitute for the required real disposable PostGIS proof.

## 5. Physical App Attest

`physicalAppAttest=not_run`. No separately reviewed physical-iPhone receipt was available. No Simulator was booted or used as a substitute.

## 6. Provider authorization and accounting

Authorization reference: `USER_AUTHORIZED_V4_2026-08-05_15_CALLS`.

| Counter | Value |
| --- | ---: |
| Hard limit | 15 |
| Attempted | 0 |
| Successful | 0 |
| Failed | 0 |
| Timed out | 0 |
| Cancelled | 0 |
| Controlled post-success failures | 0 |
| Unused | 15 |
| Retries | 0 |
| Probes after circuit-open | 0 |
| Maximum observed concurrency | 0 |

The reconciliation equation is `0 = 0 + 0 + 0 + 0`. No provider credential was inspected, printed, copied, or retained.

## 7–13. Canonical case outcomes

Each canonical evaluation slot was processed in the fixed order and bound to its immutable fixture and Golden Case digest. Route execution did not run, so no technical or product result is inferred.

| Order | Canonical case | Technical pipeline | Product quality | Golden evaluation | Specific result |
| ---: | --- | --- | --- | --- | --- |
| 1 | `case-15-partial-provider-failure-survivor` | `not_run` | `not_applicable` | `fail` | Controlled survivor not armed; no genuine provider success and no survivor claimed. |
| 2 | `case-04-harz-brocken-must-have-landmark` | `not_run` | `not_applicable` | `fail` | Distance and strict Brocken reach not measured. The historical 23.799 km result is not reused as V4 evidence. |
| 3 | `case-07-innsbruck-viewpoint-loop` | `not_run` | `not_applicable` | `fail` | Strict viewpoint reach not measured; provider snap is not treated as a visit. |
| 4 | `case-08-innsbruck-easy-conservative-loop` | `not_run` | `not_applicable` | `fail` | Difficulty, ascent, distance, duration, and route result not measured; Easy is not inferred from requested difficulty. |

The technical and product-quality axes remain independent. No technical value was promoted to a product pass.

## 14. False-green and privacy validation

Focused V4 tests passed 26/26. They reject zero execution, case skip/substitution/reordering, fixture or hash mutation, technical-to-product auto-promotion, off-range distance/duration, repetition above 35%, non-strict must-have reach, incomplete V2 lineage, provider call 16, excessive concurrency, sub-2-second spacing, retries/probes after circuit-open, invalid `Retry-After`, ledger imbalance, invalid controlled-survivor accounting, cleanup failure, enabled final flags, sensitive durable fields, and protected-receipt mutation. They also validate the published blocked receipt.

Durable V4 output contains no raw route shape, precise location, provider payload, user input text, provider or database endpoint, secret, App Attest material, temporary location, or unbounded error.

## 15. Verification totals

| Verification | Result |
| --- | --- |
| Focused V4 contract/provider/preflight tests | 26 passed, 0 failed |
| Server-live/V3 and provider-flag regressions | 28 passed, 0 failed |
| Complete backend suite | 666 passed, 0 failed |
| Backend syntax build | passed |
| Offline route-quality evaluation | 101/101 passed |
| Golden Set manifest/schema binding | passed |
| Real disposable PostGIS integration | not run after storage gate |
| Migration repeatability/no-op on disposable PostGIS | not run after storage gate |
| Xcode/iOS | not run; no Swift/iOS files changed |

The first complete-suite attempt was restricted by the execution sandbox from binding loopback sockets. The unchanged suite was rerun with loopback permission and passed 666/666.

## 16. Feature-flag states

All 13 reviewed route, research, access, evidence, intent, insecure/local, in-memory, and deterministic-mock flags were false in the initial snapshot, remained false during the blocked execution, and were false in the final snapshot. No alias value was admitted and no production or Release flag was enabled.

## 17. Cleanup

`cleanupAndContainment=passed` and `cleanupComplete=true`.

- Disabled V2 endpoint probe: passed.
- Disabled-probe authorization/database/provider/budget/lease/orchestrator work: 0/0/0/0/0/0.
- Pools opened or left open: 0.
- Leases acquired or left open: 0.
- Disposable databases, PBFs, provider ledgers, route captures, or proof services created: 0.
- Provider material retained: none.
- Final flags disabled: true.

## 18. Historical receipt integrity

Every protected V1/V2/V3/official receipt matched its pre-work SHA-256 after implementation, tests, and receipt publication. No protected receipt was modified.

## 19–20. Changed files and Git state

Changed files are limited to the V4 proof namespace, its focused test and runner, the backend syntax-build surface, and these two new V4 receipts:

- `backend/package.json`
- `backend/evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/contract.js`
- `backend/evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/preflight.js`
- `backend/evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/providerControl.js`
- `backend/evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/quality.js`
- `backend/evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/receipt.js`
- `backend/scripts/run-outdoor-adventure-targeted-live-route-quality-proof-v4.js`
- `backend/test/outdoorAdventureTargetedLiveRouteQualityProofV4.test.js`
- `docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4.md`
- `docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4.summary.json`

Expected final `git status --short`:

```text
 M backend/package.json
?? backend/evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/
?? backend/scripts/run-outdoor-adventure-targeted-live-route-quality-proof-v4.js
?? backend/test/outdoorAdventureTargetedLiveRouteQualityProofV4.test.js
?? docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4.md
?? docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4.summary.json
```

## 21. Remaining blockers

1. Raise settled free storage from 8.561 GiB to at least 10 GiB without deleting protected or unrelated material.
2. Then perform the provider-disabled disposable PostGIS/import/projection/index/performance/cancellation proof.
3. Only if every database gate passes, assess whether a contained backend credential is already available and run the authorized provider proof.
4. Obtain a separately reviewed physical-iPhone App Attest receipt and a real bounded human expert review if closed-beta eligibility is later sought.
5. Resolve or explicitly adjudicate two committed input/evaluation mismatches without mutating fixtures: the canonical viewpoint fixture requests one viewpoint while its Golden mapping requires two, and the canonical Easy fixture targets 8 km from Hungerburg while its Golden mapping evaluates 2.4–3.2 km, 45–75 minutes, strict viewpoint reach, and at most 180 m ascent.

## 22. Release and deployment confirmation

Nothing was deployed, released, staged, committed, or pushed. No production traffic was authorized or sent. No feature flag was left enabled. Closed-beta eligibility remains false.
