# Single-owner AI phone diagnosis — 6 September 2026

## Current result

Full AI planning is **not verified working**. The new approved diagnostic session used exactly two Google calls and zero GraphHopper calls. Both failed in `/api/parse-intent` with an upstream HTTP 500. There was no valid remote intent, no itinerary selection, and no routed geometry. The second call was one deliberate retry of the same original request; there were no hidden probes, automatic retries, alternate models, or ledger resets.

This is evidence of the current failure, not proof of the cause of the older phone session. An HTTP 500 alone does not reveal Google's internal error or prove a general outage. No deadline was changed.

## Source and isolation

Verified integrated source: `5df92b90e6115ccd6cf5eaa3a4e254d0593f4090`, from `/private/tmp/Wanderful-Owner-Combined-20260906`. Its untracked `work/` and dependency link were left intact. The original Documents checkout and untracked handoff directory were unchanged.

New worktree: `/private/tmp/Wanderful-AI-Phone-Fix-20260906`, branch `codex/free-form-phone-owner-20260906`. No delegation, push, main-branch merge, cloud database changes, or import was performed.

## Live evidence

Fresh private session: `/private/tmp/wanderful-owner-diagnostic-20260906`.

- Existing restricted socket runtime readiness passed again: 32 highlights, 79 mapped approaches, three usable proposals.
- Original English hiking request used words rather than a preset: roughly fifteen kilometres from Ilsenburg, returning to the start with viewpoints.
- First Google attempt: 18:17:22 UTC completion, 10,569 ms to HTTP 500; native endpoint returned HTTP 503 `intent_unavailable`.
- Second Google attempt: 18:19:02 UTC completion, 7,954 ms to HTTP 500; native endpoint returned HTTP 503 `intent_unavailable`.
- Both diagnostic records identify `intent_parsing`; neither records an abort.
- Durable accounting: Google 2/2, GraphHopper 0/2. Old ledgers untouched.
- The exact session process was terminated gracefully; its budget lock was released. No tunnel was started. The diagnostic credential uses an intentionally non-routable `.invalid` host and must never be injected into a phone build.

Provider credentials were read only by `startOwnerPhoneTest` through its existing strict loader. Upstream error bodies were discarded. Private logs contain bounded metadata only, not keys, prompts, coordinates, or provider response content.

## Offline contract and deadline review

Shipping phone order is remote `/api/parse-intent`, native intent validation/normalization, Apple geocoding, and schema-2 `/api/llm-plan-route` with exactly `schemaVersion`, `intent`, `planningContext`. No schema-1 demo endpoint was used in the live diagnostic. Since parsing failed, geocoding and the schema-2 request were deliberately not fabricated or sent.

Google requests use `/v1beta/interactions`, `gemini-3.8-flash`, `x-goog-api-key`, and `response_format: {type: "text", mime_type: "application/json", schema: ...}`. The scoped budget enforces `store: false`. The response reader supports documented `steps[].type == model_output` text content. These shapes match Google's current migration guide:
https://ai.google.dev/gemini-api/docs/interactions-breaking-changes-may-2026

Google's documented bounded-retry advice for transient 5xx responses supported the single controlled retry:
https://ai.google.dev/gemini-api/docs/troubleshooting

Current deadline chain, unchanged:

| Phase | Limit |
| --- | --- |
| Backend intent provider | 15 seconds |
| Native intent HTTP request | 20 seconds |
| Native parser operation | 22 seconds |
| Research database statement | 2.5 seconds |
| Research phase | 7.5 seconds |
| Itinerary selection, inner HTTP and outer selection race | 4 seconds |
| Each GraphHopper attempt | 8 seconds |
| Research orchestration total | 25 seconds |
| Native research HTTP request | 30 seconds |
| Native routing operation | 45 seconds |

The selection budget remains a possible later bottleneck; this session never reached it. Increasing it cannot fix the observed intent-provider HTTP 500. The total phase maxima also exceed the orchestration budget, so any future adjustment must allocate remaining time explicitly rather than increase every limit.

## Narrow changes

- `PlannerViewModel`: when loop research is enabled, a local parsed result or explicit remote-failure metadata stops in the understanding stage as `intentUnavailable`, before geocoding or routing. The wrapper's provider label is not taken as evidence of success. Standard planning with research disabled and point-to-point behavior retain existing paths.
- Private diagnostics now retain the allowlisted native intent failure codes rather than dropping them.
- Swift regressions cover local fallback on three original English/German requests and assert zero geocoding/routing.
- Backend native HTTP regression simulates the observed upstream 500 for three original prompts, verifies service-failure mapping, one upstream attempt per request, and diagnostic privacy.
- Packing checklist, its persistence, route geometry, source/freshness validation, distance/quality gates and production settings are unchanged.

## Verification and remaining work

Focused backend suite: **89 tests executed, 89 passed**. Initial sandbox loopback errors were environmental; rerunning with loopback access passed. No real provider was used by these tests.

Device build and Swift test validation are recorded below when complete. No successful live route or manual checklist persistence acceptance has occurred in this task. Do not call installation or compilation proof of working AI planning.

The existing iPhone is paired/available: bundle `com.example.owner.wanderful.local`, team `REDACTED-TEAM-ID`. The old signed app is preserved. New build output is separate at `/private/tmp/Wanderful-AI-Phone-Products-20260906`.

The next live verification needs a new explicit allowance and a functioning Google intent response, then a Gemini-selected sourced itinerary through the native schema-2 contract and GraphHopper measured route checks. Do not reuse this spent diagnostic session or ask the founder to retry presets. A phone install with a new credential must wait for a valid backend acceptance window; no app data may be erased.

## Final build verification

- Final device build succeeded with the documented private owner flag and retained empty entitlement override. Strict signature verification passed. Exact bundle identity, three enabled remote/research flags and absence of `OwnerPhoneTest.json` were verified without displaying credentials.
- Final arm64 simulator **build-for-testing succeeded**, including the new regressions. Swift tests were **not executed**: the existing simulator remained shut down, and the iOS skill requires explicit permission to boot. A simulator-choice question was presented in this task; no answer was received during this work.
- Research success fixtures now explicitly represent completed remote parsing. A second runtime guard covers loop conversion after profile/clarification changes.
- No credential injection, phone installation, uninstall, data erasure or manual acceptance occurred. The prior signed phone artifact remains preserved.
- Final free space approximately 3.4 GiB. Build logs are `/private/tmp/wanderful-owner-device-final.log` and `/private/tmp/wanderful-owner-swift-tests-final.log`. Backend results are `/private/tmp/wanderful-owner-offline-final.log`.

## Offline diagnostic follow-up

Further primary-documentation review and bounded provider-error classification are recorded in [GOOGLE_ERROR_DIAGNOSTIC_PREPARATION_2026-09-06.md](GOOGLE_ERROR_DIAGNOSTIC_PREPARATION_2026-09-06.md). It distinguishes documented syntax from unproven compatibility hypotheses, records 107 passing offline tests, and proposes an explicitly bounded two-call schema comparison. No additional live allowance was used or granted by that preparation.
