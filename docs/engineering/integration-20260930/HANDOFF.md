# Photo cards and weather fleet source integration — 2026-09-30

## Candidate and scope

Checkout: `/Users/piroscheibe/.codex/worktrees/c025/EasyWander/iphone-candidate`.
Branch: `codex/integrated-candidate-20260929`.
Starting candidate: `1f5d268c39a540a2f22b205cbc55bbb3d81c366a` (including the reviewed health query fix).
Tested source commit: `3e724597828f0ece6136e321e052da4b06b3539f`.
Backend tree: `115b2950a5ea2f6809cead8306f2bd0c6e55dfa2`.
The following documentation-only commit records these results without changing tested source. Full ordered commit IDs are in `evidence/ordered-commits.txt`.

Only the two substantive photo commits were selected from the owner branch; its older integration history and handoff-only commits were not duplicated:

| Owner commit | Integrated commit | Change |
| --- | --- | --- |
| 4238645 | e6a1ad1 | Verified stop photos in comparison cards |
| e74e18d | 51d5296 | Distance to finite route segments, including sparse geometry/date line |
| 166a2e3 | b41cba4 | Durable weather cache, global admissions and SQL component |
| 32300f5 | f886027 | Weather capacity tests and pilot gates |
| Integrator correction | b5dfdad | Correct SQL preflight search path; block incompatible migration |
| Integrator fixes and QA | 3e72459 | Bounded photo loading, card layout, text-size propagation and deterministic tests |

The photo source sheet retains the earlier full-credit accessibility identifier and now names the photographed stop. The health patch remains intact. No iPhone install, remote push, deployment, cloud SQL or feature activation occurred.

## Integrator fixes

- Screenshot review caught the route path being measured before its 18-point padding, which cropped the bottom/right edges. Moving padding outside the geometry reader keeps path and markers inside the preview.
- Screenshot review also found that the source sheet did not preserve the forced accessibility text size. The comparison row now forwards it explicitly; the UI test additionally checks the expanded credit text height.
- Restored the existing card surface in SavedRoutesView after the comparison-row extraction moved that surface out of RouteCard.
- Enforced the 5 MB image-response ceiling while streaming through the existing bounded transport, with redirects rejected, instead of buffering an unbounded body before checking its length. Existing 520-pixel decoding and 12-image cache remain.
- Photo work restarts when route contents change, so a reused suggestion identity does not retain a previous route's photo. The service can be injected for deterministic UI testing.
- Added clearly labeled synthetic image fixtures, reachable only through explicit DEBUG/simulator test launch arguments. No stock/AI image is substituted for an actual place. Tests cover no photo, invalid credit, offline, corrupt bytes and a pending download. Source action and NavigationLink remain separate, with a 44-point source target.

## Verification

- **43 native tests passed, 0 failed, 0 skipped**: RouteCardStopPhotoTests, WikimediaCommonsPhotoResolverTests, RouteComparisonAccessibilityTests, DynamicResearchPlanningClientTests and RouteStaysTests. Includes source identity/attribution, off-route rejection, sparse segment midpoint, high latitude/date line, image decoding/cache, oversized/wrong MIME responses, network/HTTP failures and successful retry.
- **Debug arm64 simulator build-for-testing succeeded**. The new UI fixtures and test targets compiled. Existing Apple-account initializer deprecation and redundant-await warnings remain unrelated.
- **Weather targeted tests: 74 passed, 0 failed, 0 skipped**.
- **Full combined backend harness: 1551 passed, 0 failed, 1 skipped**, 1552 tests / 126 suites. Optional database/performance suites still require their opt-in environments; a green harness does not prove cloud Postgres behavior.
- **JavaScript build: 384 files checked, zero failures**.
- Combined UI rerun: **10 passed, 0 failed, 0 skipped** (296 seconds), covering DE/EN source navigation, 44-point source action, largest German text, no/invalid/offline/corrupt/pending-image fallbacks, dynamic evidence/packing and loop/save regression. Screenshot review then found the two visual defects described above.
- **Final rerun after both visual fixes: 20 passed, 0 failed, 0 skipped**: 17 native tests (photo 7, comparison accessibility 2, thumbnail 8) plus all 3 photo UI tests. The expanded-credit height assertion verifies that the source sheet actually receives the largest accessibility text size. This run rebuilt the final source. Across the runs, 51 distinct native tests and 10 distinct UI tests passed; overlapping reruns are not additional unique coverage.

Native receipt: `~/Library/Developer/XcodeBuildMCP/workspaces/EasyWander-d3f5c9563e5d/result-bundles/test_sim_2026-09-30T00-36-48-769Z_pid49167_43454a6c.xcresult`.
Combined UI receipt: `~/Library/Developer/XcodeBuildMCP/workspaces/EasyWander-d3f5c9563e5d/result-bundles/test_sim_2026-09-30T09-31-33-059Z_pid43773_e5772b98.xcresult`.
Final visual-fix receipt: `~/Library/Developer/XcodeBuildMCP/workspaces/EasyWander-d3f5c9563e5d/result-bundles/test_sim_2026-09-30T09-38-23-170Z_pid43773_2369e0a1.xcresult`.
Backend logs: `/private/tmp/wanderful-combined-backend-20260930-resumed.log`, `/private/tmp/wanderful-combined-build-20260930.log`, `/private/tmp/wanderful-fleet-targeted-20260930.log`. Compact summaries are under `evidence/`.

An initial build failed with ENOSPC. Completed, reproducible own build intermediates, old duplicate XCTest products and older simulator products were removed; source/Git stores, xcresults, logs and screenshots were retained. The old September 29 unsigned Release .app was among removed products; its binary hash/report remains in the earlier handoff. No user/production data was deleted. A DEBUG-only URLProtocol actor-isolation compiler error introduced in the new fixture was corrected before the 43-test passing run.

The first UI tool connection closed, leaving an incomplete xcresult; a direct retry then spent hours in simulator timeouts during an interrupted session. The initial combined backend run likewise had hours of delays and time-sensitive certificate/admission fixture failures. These runs are recorded as failures, not counted as passes. A bounded no-sleep rerun of the unchanged backend test sources passed in 13.4 seconds. The successful 43-case native unit run predates that interruption; the final padding and sheet-type-size fixes are covered by the later targeted rerun.

## Screenshot inspection

Final attachments are under `snapshots/`, with test associations in `manifest.json`; superseded review evidence is explicitly separated in `snapshots-before-visual-fixes/`. Final manual inspection confirms the entire route shape and start marker fit within the preview, pending-photo fallback uses the full map area, and largest-text source credits visibly wrap at the requested size. DE/EN source actions and navigation separation also pass UI assertions. The synthetic image is explicitly labeled as a test fixture.

The new photo caption/source copy is localized in German and English. Some existing/generated route and evidence labels remain English in the German fixture; this is not a whole-app localization acceptance result.

## Weather: source integrated, migration and activation blocked

**Do not apply the weather migration to the selected deployment, even while weather is disabled.** `APP_ATTEST_RUNTIME_PRIVILEGE_MANIFEST` currently enumerates only the six App Attest tables. The exact service admission SQL rejects runtime privileges on any other application relation. Weather grants on its two new tables therefore violate this contract. This is a concrete additional blocker beyond capacity or provider configuration. The integrator deliberately did not broaden the frozen permission allowlist.

The original weather preflight also required `current_schema()='trailmind_app'`. The actual app-security pool is configured with `pg_catalog,trailmind_app,pg_temp`, where `current_schema()` returns `pg_catalog`. The corrected component preflight checks the exact normalized path and resolves both unqualified table names to the intended schema.

Before the coordinator's latest instruction forbidding further migration work, these facts were reproduced only in a new disposable local PostgreSQL cluster over a Unix socket: original preflight false; corrected weather component preflight true; exact unknown-relation clause from the frozen service manifest false. The receipts and reproduction SQL are under `evidence/`. No cloud database was contacted. That local test server has now been stopped; no further migration was applied after the latest instruction.

Next weather step is a separately reviewed admission/role design and whole-service startup proof. Component `ready = true` does not override the service-level failure. Keep server and iOS weather flags false. The 128-entry cache remains a closed-pilot ceiling (at most 42 disjoint three-sample routes), not public capacity; preserve the 350 MB database start gate and documented 96/120-entry and relation/database size stop thresholds. Current selected cloud capacity, roles, latency, provider contact, MET behavior and fleet membership are unverified. See `docs/handoffs/route-weather-fleet-20260930.md` for the full revised gate.

The SQL/RLS review consulted the [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security); grants and row policies are distinct checks. The changelog Markdown endpoint could not be retrieved by the available web/sandbox transports. No Supabase API/client or migration ledger was changed.

## Remaining live/device gates

Synthetic fixtures prove layout, control separation and error handling, not a live accepted route's photographic identity. A real photo/OSM or Wikidata source match, several live alternatives, gallery/cache interaction across regions and current-iPhone offline/persistence acceptance remain open. Largest-text UI semantics do not constitute a full VoiceOver spoken focus-order audit. Actual VoiceOver gestures, smaller physical-device widths and signed-device acceptance remain unverified.

No signing or installed-app state was changed. No permission or capacity check was bypassed. Historical signing/backend/device gates remain documented in `docs/engineering/integration-20260929/HANDOFF.md` and `docs/release/iphone-20260926/ACCEPTANCE.md`.
