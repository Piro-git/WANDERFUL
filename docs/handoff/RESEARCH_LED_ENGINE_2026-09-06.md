# Research-led itinerary slice — 6 September 2026

Status: implemented locally and tested with synthetic sourced-place fixtures. **Not activated, not compiled into an iPhone build, not live-tested.** No provider calls, credentials read, private session changes, database changes, deployment or push occurred.

## Ownership and reuse

Base `3f38e17eed44e767681d482b7f29638769fb7551`; branch `codex/research-led-engine-20260906`; isolated worktree `/private/tmp/Wanderful-Research-Engine-20260906`. Phone owner HEAD `8b95906f9b8c399eda09810d5706479953dc2647` and backend owner HEAD `7d852e1221337e6fdffc300aad75215ecc35b0aa` were verified. Neither lane's private changes were needed or imported. Their expired server/token must not be reused. Coordinator handoff was read from the original Documents repository; historical AGENTS architecture descriptions lag current source.

Reuse map:

- Natural language: current Gemini intent parser, validation, saved-profile resolver and Apple Maps location clarification remain the first step. Prompt/profile/default provenance is now carried separately into researched planning.
- Evidence: `outdoorResearchExecutor`, its reviewed-region binding, consistent repository snapshot, source authority/licence/freshness checks, dossier and evidence resolution remain authoritative. No LLM recall, web snippets or generated coordinates become evidence.
- Candidates: existing V1 evidence filtering and V2 mapped trail-access/product-shaping pipeline provide a bounded pool. The new selector picks one supported candidate set and chooses/orders up to three existing stop IDs. It can omit optional members but cannot remove mandatory members. This is deliberately bounded selection within existing supported candidate sets, not unrestricted search over arbitrary combinations.
- Model transport: existing selected Gemini-compatible adapter configuration and bounded HTTP transport; one ID-only itinerary response, strict schema, no prose/claims from retrieved text, `store=false` for Gemini. Only normalized intent, controlled categories, evidence IDs and validated coordinates reach this selection prompt. Raw retrieved descriptions are excluded.
- Geometry: existing centralized GraphHopper provider, V2 routed contract/access verification, plus existing LLM-route geometry/statistics/order/detour/backtracking gates. A mapped approach never proves visibility, public/current access, water quality or safety.
- iPhone: existing research intent adapter → coordinator → backend client → strict V2 decoder → route suggestions/detail renderer. Existing research + routable-access configuration now selects `/api/llm-plan-route`; no flags were enabled. Point-to-point, ordinary routes and mocks keep their existing path; explicit maxima are checked on returned standard routes too. Explicit exclusions that standard routing cannot verify stop honestly.

## Contract and behavior

`POST /api/llm-plan-route` now also accepts the existing schema-2 research intent with a required `planningContext`:

```json
{
  "schemaVersion": 2,
  "intent": "<complete AdventureResearchIntentV1 object, after location resolution>",
  "planningContext": {
    "maximumDistanceKm": null,
    "maximumDurationMinutes": null,
    "distanceOrigin": "prompt",
    "preferenceOrigin": "saved_profile",
    "hardAvoidances": []
  }
}
```

The abbreviated object above is explanatory, not a request fixture. Full **synthetic test data**, request and routed response: `TrailMindTests/Fixtures/research-led-itinerary.json`. It has `syntheticFixture: true`; it is never loaded by shipping providers. The response stays the existing strict `OutdoorAdventurePlanningResponseV2`, including measured path/stats, ordered highlight provenance, snap/approach verification and limitations. Existing schema-1 named-place endpoint compatibility remains, but the new native researched flow uses schema 2.

Limits: one existing research pass (executor operation/row caps unchanged), one itinerary generation (4 s), at most two GraphHopper attempts, no retries. With the initial intent parse, the complete phone request uses at most **two Gemini generations**. The second GH attempt is only a deterministic removal of one optional stop after actual geometry fails quality/constraints; upstream failure/denial is not retried. Existing 25 s research-orchestration total deadline and per-operation deadlines remain; cancellation reaches model, research repository and routing. No automatic old multi-seed search runs after a researched attempt is unavailable or rejected.

Approximate distance: accept only the existing intent range expanded by at most 20% on either side, plus geometry/structure checks. With a 15 km point target the maximum is 18 km; 20.1 km is rejected. The native notice states actual distance and approximate target and identifies saved-profile preferences. A hard maximum takes precedence with no expansion. Explicit time/elevation maxima must be met. Major-road exclusions require complete allowed road-class coverage; repeated-path exclusions tighten the measured repetition gate. Hard crowd/steep-climb exclusions are currently unsupported because this slice has no reliable evidence to prove them; it returns unavailable rather than a guarantee.

Maximum phrases are conservatively extracted from the original prompt independently of model defaults (English/German phrases including “at most”, “maximum”, “höchstens”, “maximal”, “under”, “bis zu”). This is not a complete multilingual hard-constraint parser. Compound duration expressions and unrecognized maximum phrasing remain a launch limitation requiring broader intent-schema work. Avoidance provenance is coarse by preference group; it is not per-chip provenance. “Preferences” replaces the misleading all-features “Requested” label. The fallback banner no longer diagnoses an API-plan entitlement.

No image acquisition was added. Existing outputs retain stable place/evidence IDs so later optional media can attach by entity ID with source URL, author, licence, attribution, retrieval date and association (`on_route`/`nearby`/`regional`). Missing photos never block routing. No photo, scenic-quality or safety claim is synthesized. Preparation/checklist work is a separate task and receives existing typed route/evidence outputs.

## Smallest real Ilsenburg path — concrete operational dependency

The existing reviewed region **`harz-v1` includes Ilsenburg** (required anchor 51.866, 10.678), peaks/viewpoints/waterfalls/trail segments, and a 14-day freshness threshold in `backend/config/outdoor-regions/harz-v1.json`. Region entity ID is `30000000-0000-4000-8000-000000000002`.

The smallest existing supported path is to reuse an already imported, current Harz OSM snapshot, with active recognised OSM source policy and projected highlight + trail-access geometry, via the existing research runtime repository. Required runtime capabilities are snapshot context, highlight discovery, memberships, assertions and trail-access resolution. Before activation an operator must verify that the selected Harz snapshot actually contains a few relevant place records around Ilsenburg plus the mapped access segments and their source/claim IDs. Mere regional metadata is not actual place coverage.

Required configuration (names only; values were not inspected): authenticated backend/App Attest runtime; existing `AI_PROVIDER=google` and approved Gemini model/key; GraphHopper key; separate `OUTDOOR_RESEARCH_DATABASE_URL` and `OUTDOOR_RESEARCH_CANCELLATION_DATABASE_URL` with the already reviewed bounded read functions/roles; backend `LLM_FIRST_PLANNING_ENABLED`, `INTENT_PROVIDER_ENABLED`, `ROUTE_PROVIDER_ENABLED`, `OUTDOOR_RESEARCH_PLANNING_ENABLED`, `OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED`; app `RESEARCH_GUIDED_PLANNING_ENABLED` and `ROUTABLE_HIGHLIGHT_ACCESS_ENABLED` in the applicable signed configuration. These switches are documented, not enabled here. The owner-test server currently exposes only parse-intent/route, so it does **not** serve this new slice without a separately owned/authenticated integration.

Actual current database roles, active imports, source policy, freshness and local Ilsenburg candidates are **unverified**, not asserted absent. The task has no database/import/activation authorization. Read-only source inspection found **no existing licensed external POI/evidence adapter** that can replace the repository: the existing GraphHopper geocoder resolves names but supplies insufficient category/source/access evidence. Consequently this task cannot truthfully promise an immediately usable researched Ilsenburg itinerary without data verification. If a current projected Harz snapshot exists, reuse it; no new broad import/provision is intrinsically needed. If it does not, real reviewed data acquisition/projection is still required under a separately approved scope. A small reviewed local evidence bundle could be a follow-up alternative, but no new ingestion framework or fake starter data was introduced here. Do not let this dependency be hidden behind a successful synthetic test.

The repository documents historical portable migration 008 separately from the reviewed managed sequence 001–007 + 009 (and later approved work). Nothing here authorizes or applies any migration; especially do not transplant 008 to the managed target.

## Verification and next phone acceptance

Offline backend command:

```
node --test backend/test/researchGuidedRouteCandidateV2.test.js backend/test/llmFirstPlanningEndpoint.test.js backend/test/llmFirstPlanningOrchestrator.test.js backend/test/outdoorAdventureEndpoint.test.js backend/test/researchGuidedRouteCandidatePlanner.test.js backend/test/selectedIntentPlanningAdapter.test.js
```

**113 focused backend tests passed, zero failures/skips.** New checks cover ID/order/mandatory-stop validation, a multi-stop routed loop, hard distance/time limits, 20% soft policy, inaccessible snaps, two-attempt refinement, upstream no-retry, cancellation, native endpoint auth/contract and no-evidence behavior. Existing selected-model, evidence filtering (including unsupported waterfall evidence), route-quality and endpoint regression suites are included. The checked-in synthetic native response is validated by the backend and consumed by an added Swift URLProtocol client test.

Swift `swiftc -frontend -parse` succeeds for changed Swift sources/tests. **This is syntax parsing only, not type checking, Xcode compilation or XCTest execution.** No simulator boot, installation or device interaction. Disk fell to approximately 235 MiB; no caches/data deleted. Allow at least 2 GiB free headroom for one focused incremental existing-cache build (estimate, not a verified minimum; full rebuild needs more), then compile and execute the new client/provenance tests under the existing device/simulator authorization rules. Verify factory dispatch and saved-route/detail/navigation regressions on the built app.

After data/auth/build readiness, propose a fresh bounded acceptance session to coordinator: one natural-language “about 15 km loop from Ilsenburg with views”, at most **2 Gemini + 2 GraphHopper attempts**, no geocoder GH calls (Apple resolves the anchor). Check ordered sourced stops, mapped approach vs nearby labels, geometry/stats, distance explanation and cancel. A second live submission needs its own remaining-budget confirmation. Test hard maximum/no-evidence/provider errors offline first. Do not reuse the exhausted historical session, reset counters or activate production flags for this test.

## Review correction — follow-up revision

The implementation now uses the production `ResearchPromptConstraints` typed parser, independently executable without the iOS app. Prefix and suffix numeric maxima, decimal commas, compound hour/minute limits, strict “under” bounds and lower-bound negations are covered. Unmatched or ambiguously negated limiting language becomes an explicit clarification before research/routing instead of silently losing the constraint. Exclusions match their own nearby object phrase; unrelated “no” and preference/negation prefixes cannot upgrade profile defaults. The wire context stays unchanged.

The selector now receives current sourced display names (nullable; taken from the existing access candidate's current name assertion and snapshot), readable category facts with evidence IDs, controlled evidence-backed preference reasons, freshness and limitations. It must choose a supported reason and cite existing evidence IDs per selected stop; unsupported reason codes/claims fail before routing. Those choices are retained in the existing selected-highlight reason contract. Swift now preserves the sourced name and renders the validated reason with honest mapped-approach wording. It still does not invent descriptive prose, scenic judgments or biographies where the existing source has none. The synthetic native fixture includes a clearly synthetic source name to test decoder transport. No new evidence provider/framework was added.

Schema-1 production adapter construction now follows authorization and weighted admission; rejected authorization is normalized correctly. The native schema-2 path remains unchanged.

Verification: **116 focused backend tests passed**, zero failures/skips; **22 executable checks of the actual Swift prompt-constraint parser passed** using a small standalone Foundation binary and an isolated temporary module cache. Changed Swift app/test files pass syntax parsing with bare-slash regex support. These results are not a full iOS build or XCTest run; the phone integration lane owns that build and reported its prior combined baseline build succeeded.

Operational correction: coordinator's fresh read-only staging inspection now confirms `regions=[]`, import count 0, active entity count 0 and active projection count 0. The data dependency is therefore known empty, not merely unverified. Coordinator also confirms importer tools, import-schema provisioning function and five bounded research read functions exist; no new migration project is indicated. A bounded real-source acquisition/import/projector operation and scoped runtime connections are still required before the native engine can produce real researched routes. No activation or data mutation occurred in this revision.
