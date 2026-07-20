# Prioritised Backlog

Audit snapshot: 2026-07-15. This backlog is derived from the repository, the verified build/runtime results, and the other reports in this directory. It deliberately optimizes for a truthful same-day route-planning beta before expanding the feature set.

## Ordering rules

- **Containment comes first:** rotate the credential exposed in the audit transcript before any more provider-backed testing.
- **The first code change is the route-truth contract:** route provenance and verified/requested-data invariants must exist before UI cleanup or feature work can be called safe.
- A green build is not a launch signal. The verified baseline is strong—Debug and Release Simulator builds pass, 177 of 179 Swift tests pass with two opt-in live tests skipped, and all 115 backend tests pass—but production-reachable fabricated routes and unverified deployment state remain blockers.
- “Parallel” below means parallel after dependencies are merged and only when file ownership in `AGENT_EXECUTION_PLAN.md` is respected.
- Sizes are relative (`XS`, `S`, `M`, `L`, `XL`), not time estimates.

## P0 — Foundation or launch blocker

### P0-00 — Contain the exposed GraphHopper credential

- **Problem:** An ignored local GraphHopper credential appeared in the audit tool transcript.
- **Evidence:** `SECURITY_AND_PRIVACY.md`, finding S-01. The value is not repeated in any audit document; `Configuration/Local.xcconfig` remains ignored and untracked.
- **User/business impact:** Continued use risks unauthorized quota consumption and invalidates claims that provider access is controlled.
- **Proposed solution:** Revoke/rotate the affected credential in the provider console, update approved secret stores, review usage, set quotas/alerts, and perform non-printing repository/history/archive checks.
- **Acceptance criteria:** The old credential is rejected; the replacement works only through the intended backend path; usage review is recorded; tracked-history and Release-archive scans find no secret; no replacement value enters source, chat, logs, or docs.
- **Dependencies:** Provider-console and secret-store access; no code dependency.
- **Risk:** Critical operational risk if delayed; scans can themselves leak values if poorly designed.
- **Expected files/modules:** No production source file is inherently required. At most, secret-management runbooks outside credential-bearing files.
- **Parallelization:** Blocks provider-backed tests; source-only work may continue in parallel.
- **Recommended owner:** Human security/operations owner with a security-review agent for non-printing verification.
- **Size:** XS.

### P0-01 — Establish route provenance and verified-fact invariants

- **Problem:** `TrailRoute` cannot distinguish GraphHopper-backed, fallback-routed, demo, or geometry-free edited content. Any route can be displayed, saved, or shared as if its facts were verified.
- **Evidence:** `TrailMind/Models/AdventureModels.swift` lacks a non-optional provenance contract; `LocalSavedRouteStore`, `RouteDetailView`, and GPX sharing accept every `TrailRoute`; `MockAIPlannerService.editRoute` changes metrics without rerouting.
- **User/business impact:** A user can trust, save, or export fabricated outdoor facts. This is the largest product-safety and credibility risk.
- **Proposed solution:** Add a typed, non-optional route origin/verification model; separate requested intent from observed route facts; require successful routing geometry for production “route success”; migrate persisted records; enforce save/export/display guards; remove inference based on instruction presence or debug labels.
- **Acceptance criteria:** Every constructed and decoded route has explicit provenance; GraphHopper/backend source is decoded, not inferred; demo/test content cannot pass the Release success invariant; edited metrics cannot diverge from geometry; persisted version migration is tested; Release save/export reject non-verified routes; all existing point-to-point, loop, fallback, and corrupt-record tests pass.
- **Dependencies:** P0-00 only for live-provider verification; source work can begin immediately.
- **Risk:** High migration and fan-out risk because `TrailRoute` is shared across routing, views, navigation values, mocks, persistence, and tests.
- **Expected files/modules:** `TrailMind/Models/AdventureModels.swift`, `TrailMind/Services/GraphHopperClient.swift`, `TrailMind/Services/RoutingFoundation.swift`, `TrailMind/Services/SavedRouteStore.swift`, related test fixtures and tests.
- **Parallelization:** Must merge before P0-02, P0-03, P1-08, P1-11, and P1-12. Give these shared files one owner during this task.
- **Recommended owner:** Senior Swift domain/routing agent with persistence review.
- **Size:** L.

### P0-02 — Remove Release false-success, demo, and dead-action surfaces

- **Problem:** Home example chips call mock planning, Home shows a fake recent route, Explore ships a mock catalogue and developer demo, AI edit fabricates changes, and Start Route is a placeholder.
- **Evidence:** `PlanFlowView`/`PlannerViewModel.startPlanning`, `MockRoutes`, `ExploreView`, `RouteEditAIView`, `MockAIPlannerService`, and `RouteDetailView.bottomActions`; see `MOCK_AND_PLACEHOLDER_AUDIT.md` M-01 through M-12.
- **User/business impact:** The polished UI makes fabricated or unavailable features look production-ready and undermines every real-route claim.
- **Proposed solution:** Route supported examples through the single real planner; remove or compile Debug-only all demo catalogue/developer paths; remove AI edit and Start Route from the beta surface; replace fake recents with real Saved data or no section; ensure a real failure never reveals mock success.
- **Acceptance criteria:** A Release composition test proves no production CTA calls `MockAIPlannerService`, `MockRoutingService`, or `MockRoutes`; no mock/demo route is saveable or exportable; every visible primary action completes real behavior; Explore is absent or truthful; Home recents are real or absent; unsupported quick actions and developer copy are gone.
- **Dependencies:** P0-01 route provenance contract.
- **Risk:** Navigation/UI regressions and accidental loss of useful Preview fixtures.
- **Expected files/modules:** `TrailMind/App/TrailMindApp.swift`, `TrailMind/Views/Home/HomeView.swift`, `TrailMind/ViewModels/AppModels.swift`, `TrailMind/Views/Route/RouteDetailView.swift`, `TrailMind/Views/AIEdit/RouteEditAIView.swift`, `TrailMind/Services/TrailServices.swift`, `TrailMind/Data/MockRoutes.swift`, planner/composition tests.
- **Parallelization:** UI copy work can be prepared separately, but merge through one surface owner. Do not overlap `HomeView`, `AppModels`, or `RouteDetailView` with P1-10/P1-11.
- **Recommended owner:** SwiftUI product-flow agent with route-trust reviewer.
- **Size:** L.

### P0-03 — Make difficulty, match labels, locations, and explanations factual

- **Problem:** Requested difficulty overrides computed difficulty; percentage match scores are ordinal constants; real-route location is hard-coded to Germany; explanations can infer live routing indirectly.
- **Evidence:** `GraphHopperClient.makeTrailRoute`, `RouteSuggestion` construction (`96/92/88%` pattern), `RouteQualityExplanationGenerator`, `RouteCard`, and `PRODUCT_AND_UX_GAPS.md` trust findings.
- **User/business impact:** A route can be labelled easier or better-matched than its measured facts justify, affecting outdoor decisions and trust.
- **Proposed solution:** Keep requested difficulty only in planning metadata; derive actual difficulty from verified metrics; replace percentages with measured distance/duration/elevation deltas and factual comparative labels; carry geocoded locality when known; source explanations from provenance and mapped characteristics.
- **Acceptance criteria:** A requested-easy/challenging-result test shows the computed badge plus an unmet-request message; no arbitrary match percentage remains in Release; labels are deterministic from real stats; unknown locality is omitted rather than set to Germany; explanations never claim scenery/safety or live provenance without evidence.
- **Dependencies:** P0-01; coordinate label semantics with P1-08.
- **Risk:** Existing snapshots/copy/tests may encode old semantics; a simplistic difficulty formula must not be marketed as an official trail grade.
- **Expected files/modules:** `TrailMind/Services/GraphHopperClient.swift`, `TrailMind/Models/AdventureModels.swift`, `TrailMind/Services/RoutingFoundation.swift`, `TrailMind/Views/Route/RouteComponents.swift`, relevant tests.
- **Parallelization:** Sequential with P0-01 and routing/alternative work because of shared core files.
- **Recommended owner:** Routing-quality/domain agent.
- **Size:** M.

### P0-04 — Harden remote intent execution and fail closed

- **Problem:** Gemini/OpenRouter fetches lack a timeout and propagated cancellation; missing provider keys return deterministic mock intent labelled `remoteAI`; raw upstream details can reach clients.
- **Evidence:** `backend/src/parseIntent.js`, `intentSessionEndpoint.js`, `SECURITY_AND_PRIVACY.md` S-04, S-06, and S-08.
- **User/business impact:** Hung requests consume concurrency/cost, configuration errors can look like AI success, and provider excerpts can disclose internals.
- **Proposed solution:** Merge caller cancellation with a bounded provider timeout; cap response bytes; fail closed when providers are unconfigured outside an explicit local/test flag; return stable safe error envelopes; preserve redacted server-only diagnostics; fix opt-in evaluation launch so it actually executes.
- **Acceptance criteria:** Hang, timeout, disconnect, oversized-response, invalid-JSON, missing-key, and lease-release tests pass for both providers; production configuration cannot call `mockIntent`; parser provenance distinguishes remote provider, local fallback, and test fixture; client receives allowlisted codes only; the live-eval script cannot report success when its test skipped.
- **Dependencies:** No Swift UI dependency; remote Release enablement additionally depends on P0-06 and P0-05.
- **Risk:** Abort races and serverless runtime differences; provider error mapping must retain enough observability without returning raw content.
- **Expected files/modules:** `backend/src/parseIntent.js`, `backend/src/appAttest/intentSessionEndpoint.js`, backend tests, `scripts/run-intent-eval.sh`, possibly `TrailMind/Services/IntentParsingFoundation.swift` contract/tests.
- **Parallelization:** Can run beside P0-01/P0-02 with exclusive ownership of backend intent files.
- **Recommended owner:** Backend security/reliability agent.
- **Size:** M.

### P0-05 — Prove production authorization, database, and provider operations

- **Problem:** App Attest/session logic is substantial but signed-device behavior, deployed PostgreSQL state, migrations, TLS, pruning, quotas, trusted edge identity, backups, and provider monitoring are unverified.
- **Evidence:** Swift/backend unit tests are green; PostgreSQL integration test is skipped without a disposable database; `DEVELOPMENT_TEAM` is empty; see `SECURITY_AND_PRIVACY.md` S-07, S-10, S-11.
- **User/business impact:** A closed beta could be unavailable, bypass rate controls, reject legitimate devices, or accumulate security state without operational recovery.
- **Proposed solution:** Create a staging verification runbook and environment; exercise migrations and real concurrency/replay/budget behavior; enforce database TLS/access/retention; establish edge-identity trust, quotas, alerts, backup/restore, pruning, and credential-rotation drills; then verify App Attest on signed devices.
- **Acceptance criteria:** Disposable and staging PostgreSQL suites pass; replay and concurrent budget tests are transactional; TLS/access/backups/pruning are evidenced; outage and restore drills are recorded; safe logs contain no prompt/coordinates/tokens; signed physical-device challenge/register/assert/session/expiry paths pass; TestFlight production-environment proof is recorded before distribution.
- **Dependencies:** Backend deployment/database authority. Signed App Attest/TestFlight portions require paid Apple team access; most backend work does not.
- **Risk:** Environment drift and false confidence from Simulator fakes; external-service cost.
- **Expected files/modules:** `backend/src/appAttest/*`, `backend/migrations/*`, `backend/test/postgresAppAttestIntegration.test.js`, deployment configuration/runbooks, client App Attest tests only if defects emerge.
- **Parallelization:** Backend staging work can run beside iOS P0 work. Signed-device phase is a later gate.
- **Recommended owner:** Backend/platform security agent plus human operations owner.
- **Size:** L.

### P0-06 — Close privacy, consent, attribution, and local-data gates

- **Problem:** No audited privacy manifest/report, in-app/public privacy policy, App Privacy answers, third-party AI consent, complete local-data disclosure/delete-all path, or verified OSM/GraphHopper attribution surface exists.
- **Evidence:** `SECURITY_AND_PRIVACY.md` S-05, S-12 through S-15; saved route geometry uses protected local files, while remote AI is Release-disabled today.
- **User/business impact:** Users cannot understand where sensitive prompts and route geometry go; enabling remote AI or public distribution would create review and trust risk.
- **Proposed solution:** Keep remote AI disabled until a named-provider disclosure and consent flow exists; create the data inventory/retention/deletion policy; add local saved-data deletion; generate and evaluate Xcode privacy reports; add `PrivacyInfo.xcprivacy` if required by actual APIs; publish in-app/provider attribution and planning-aid boundaries.
- **Acceptance criteria:** Observed traffic, files, logs, permissions, policy, consent, labels, and manifest agree; users can delete all saved route data; voice and AI disclosures name processing paths; OSM licence access and GraphHopper terms are verified; no unimplemented safety/weather/POI claim remains.
- **Dependencies:** Final product scope/parser choice; public URLs and App Store Connect entry are later membership tasks, but drafting and in-app implementation can proceed now.
- **Risk:** Legal wording can drift from implementation; privacy manifests must not be guessed.
- **Expected files/modules:** new privacy/about/attribution UI and resources, `Configuration/TrailMind-Info.plist`, `PrivacyInfo.xcprivacy` if justified, `SavedRoutesModel/View`, privacy/support documentation.
- **Parallelization:** Policy and data mapping can run now; UI/resource merge should follow P0-02 surface cleanup.
- **Recommended owner:** Privacy/release agent with product and legal review.
- **Size:** M.

## P1 — Required for a strong useful product

### P1-07 — Make live quality evaluation real and repeatable

- **Problem:** Both opt-in scripts exit successfully while their iOS XCTest cases skip because the Simulator test host does not inherit the shell environment flag. Consequently live remote intent and live GraphHopper quality remain unverified.
- **Evidence:** `scripts/run-intent-eval.sh`, `scripts/run-route-quality-eval.sh`, and `BUILD_AND_RUNTIME_REPORT.md`; both audited invocations ended `TEST SUCCEEDED` with the sole selected test skipped.
- **User/business impact:** Route/provider regressions can pass CI while no live fixture is executed.
- **Proposed solution:** Use an XCTest plan/environment mechanism or explicit test configuration that reaches the test process; make skips return a distinct non-success status in live-eval automation; emit a machine-readable summary without secrets or exact user coordinates.
- **Acceptance criteria:** The runner proves the selected test executed, reports fixture/pass/fail counts, refuses an unconfigured provider safely, and cannot treat skip as pass; baseline results are recorded for 40 intent and 20 route fixtures.
- **Dependencies:** P0-00; remote intent probe also depends on a safe configured backend.
- **Risk:** Live tests are variable, quota-consuming, and unsuitable as the sole merge gate.
- **Expected files/modules:** `scripts/run-intent-eval.sh`, `scripts/run-route-quality-eval.sh`, XCTest plans/scheme configuration, evaluation support/tests.
- **Parallelization:** Can run beside UI work after credential containment.
- **Recommended owner:** iOS test-infrastructure/routing-evaluation agent.
- **Size:** S.

### P1-08 — Improve routing reliability and alternative quality using measured geometry

- **Problem:** The architecture has strong loop/fallback filters, but real provider quality is unmeasured; point-to-point alternatives collapse to one; materially similar loops may survive; flexible-mode retry is broader than necessary.
- **Evidence:** `RoutingCoordinator`, `LoopFallbackProvider`, `RouteSuggestionNormalizer`, `GraphHopperClient`, fixture tests, and the skipped live quality probe.
- **User/business impact:** Users may get one weak option, near-duplicates, badly missed distances, unnecessary detours, or opaque fallbacks.
- **Proposed solution:** Establish live baselines, narrow retry conditions, validate response/coordinate ceilings, strengthen pairwise overlap/backtracking/detour checks, preserve genuinely distinct point-to-point alternatives, and ground variant labels in measured differences.
- **Acceptance criteria:** Exact/near/badly-missed distance fixtures have explicit envelopes; invalid geometry/extreme detours/backtracking/duplicates are rejected; one-seed success degrades honestly; distinct 2–3 option output is retained when available; all provider/fallback paths preserve provenance and real stats; latency and request budgets remain bounded.
- **Dependencies:** P0-01, P0-03, P1-07.
- **Risk:** Over-filtering may return no route; more candidates increase latency/quota; shared routing files are conflict hotspots.
- **Expected files/modules:** `TrailMind/Services/GraphHopperClient.swift`, `TrailMind/Services/RoutingFoundation.swift`, `TrailMind/Models/AdventureModels.swift` only through agreed interfaces, routing/evaluation tests.
- **Parallelization:** Split routing reliability and alternative ranking only after extracting stable interfaces; otherwise one sequential owner.
- **Recommended owner:** Routing-engine agent, followed by geometry-quality agent.
- **Size:** L.

### P1-09 — Decide and harden the Release intent contract

- **Problem:** Release is local-parser-only while product language implies AI-native understanding; broad regions and free-form phrasing are partial; clarification is terminal rather than conversational.
- **Evidence:** `IntentParsingProviderFactory` build conditional, `RoutePromptParser`, intent fixtures (40 local prompts pass), and `PRODUCT_INTENT.md`.
- **User/business impact:** Users may expect general AI understanding but encounter regex boundaries or restart after an ambiguity.
- **Proposed solution:** Choose a truthful v1 contract—local structured parser is acceptable—or safely enable remote parsing only after P0-04/P0-06/P0-05. Add first-class clarification state that preserves parsed intent and merges an answer. Expand parsing only from evaluated failures.
- **Acceptance criteria:** Release copy matches selected provider; parser source is accurate; broad-region/missing-start/missing-destination cases ask specific questions; answering continues the same plan without losing text; malformed/unavailable remote AI falls back or fails according to documented policy without mock success; fixture evaluation remains zero deterministic failures.
- **Dependencies:** P0-04 for remote mode; P0-06 for consent; P0-02 for copy; P1-10 for UI continuation.
- **Risk:** Enabling remote AI expands privacy, availability, cost, and deployment scope.
- **Expected files/modules:** `TrailMind/Services/IntentParsingFoundation.swift`, `TrailMind/Services/RoutePromptParser.swift`, `TrailMind/ViewModels/AppModels.swift` through a coordinated state contract, backend intent schema/tests, intent fixtures.
- **Parallelization:** Parser/backend work can precede UI; `AppModels.swift` changes merge in P1-10.
- **Recommended owner:** AI-intent/schema agent.
- **Size:** M.

### P1-10 — Complete the truthful plan-to-detail recovery flow

- **Problem:** Typed planning has strong staged state, but clarification is shown as failure, edit recovery drops context, unsupported preferences are too implicit, and deeper runtime journeys lack UI automation.
- **Evidence:** `PlannerViewModel`, `GeneratingRouteView`, `RouteSuggestionsView`, unit tests, and the manual-runtime limitations in `BUILD_AND_RUNTIME_REPORT.md`.
- **User/business impact:** Ambiguous or failed requests feel like dead ends even though the routing core is recoverable.
- **Proposed solution:** Introduce typed planning states for clarification, retry, cancellation, and editable intent; preserve the prompt; show requested-but-unverified preferences plainly; keep one real coordinator for text, voice, and examples; add accessibility identifiers for the critical path.
- **Acceptance criteria:** Users can describe → clarify → generate → compare → inspect without restarting; retry and cancellation are deterministic; slow/offline/provider/no-route errors never expose fake content; all three activities and loop/point-to-point paths are covered by UI smoke tests using injected deterministic real-shaped responses.
- **Dependencies:** P0-02, P1-09; coordinate with P1-13.
- **Risk:** `AppModels.swift` and Home/Planning views are large shared bottlenecks.
- **Expected files/modules:** `TrailMind/ViewModels/AppModels.swift`, `TrailMind/Views/Home/HomeView.swift`, `TrailMind/Views/Planning/PlanningViews.swift`, route-navigation wiring, planner tests.
- **Parallelization:** One core-flow owner. QA agent can prepare test scaffolding but should not edit the same views concurrently.
- **Recommended owner:** SwiftUI state-machine/product-flow agent.
- **Size:** L.

### P1-11 — Deliver standards-valid named-file GPX handoff

- **Problem:** GPX XML is shared as raw text, does not escape route names, omits available elevation, and silently substitutes an empty string on failure.
- **Evidence:** `DefaultGPXService`, `RouteDetailView.export`, persistence/GPX tests, and `SECURITY_AND_PRIVACY.md` S-15.
- **User/business impact:** The user may believe a route was exported while common navigation apps receive invalid or unusable content.
- **Proposed solution:** Build escaped, validated GPX with all path points and available elevation; write a protected temporary `.gpx` file with a sanitized filename; share the file using a typed transferable; surface failures and cleanup artifacts.
- **Acceptance criteria:** Special-character titles produce valid XML; point count and elevation round-trip; an exported file imports into agreed reference apps; empty geometry/export errors are visible; only verified routes can export; temporary files follow a documented lifecycle.
- **Dependencies:** P0-01 and P0-02; route-detail ownership must be released first.
- **Risk:** Interoperability differences and temp-file privacy.
- **Expected files/modules:** `TrailMind/Services/TrailServices.swift` or a dedicated GPX service file, `TrailMind/Views/Route/RouteDetailView.swift`, GPX tests.
- **Parallelization:** Service implementation can proceed separately; route-detail integration merges after P0-02.
- **Recommended owner:** iOS interoperability/sharing agent.
- **Size:** M.

### P1-12 — Make saved/recent data and supported preferences coherent

- **Problem:** Local saved routes work, but fake Home recents coexist with them; saved records lack provenance; Profile settings are memory-only, mostly ignored, and include unsupported offline readiness.
- **Evidence:** `LocalSavedRouteStore`, `SavedRoutesModel`, `HomeView`, `AppModel.preferences`, and `ProfilePreferencesView`.
- **User/business impact:** Return visits and settings create false expectations; fabricated content can become durable.
- **Proposed solution:** Complete the provenance migration; drive any Recent section from real locally saved/opened state or remove it; add delete-all/data disclosure; hide unsupported preferences; persist and apply only a narrow, truthful subset if retained.
- **Acceptance criteria:** Fresh install contains no route/history fixture; mock/demo records cannot migrate into normal Release data; save/reopen/delete/delete-all/corrupt/migration paths pass; Home recents reflect actual records or are absent; every visible preference persists and measurably changes a supported request.
- **Dependencies:** P0-01 and P0-02.
- **Risk:** Migration/data-loss risk; applying defaults silently can change user intent.
- **Expected files/modules:** `TrailMind/Services/SavedRouteStore.swift`, `TrailMind/ViewModels/SavedRoutesModel.swift`, `TrailMind/Views/Saved/SavedRoutesView.swift`, `HomeView` through the core-flow owner, `ProfilePreferencesView`, tests.
- **Parallelization:** Persistence internals can run beside GPX after the provenance contract; Home/Profile integration needs sequenced ownership.
- **Recommended owner:** iOS persistence/data-migration agent.
- **Size:** M.

### P1-13 — Add critical-path UI, accessibility, and failure-state verification

- **Problem:** There is no UI-test target; CUA could not safely interact with the embedded Simulator app; VoiceOver, Dynamic Type, Reduce Motion, contrast, permission states, dark mode, and deeper manual journeys remain unverified.
- **Evidence:** Xcode has only `TrailMind` and `TrailMindTests`; `BUILD_AND_RUNTIME_REPORT.md`; forced light mode and fixed typography/heights in theme/views.
- **User/business impact:** A visually polished app can still ship dead controls, clipping, inaccessible maps/stats, or unrecoverable errors.
- **Proposed solution:** Add a small UI smoke target with deterministic launch arguments/dependencies; cover onboarding and the core planning loop; add accessibility labels/values and scalable layouts; run the manual device/network matrix and measure long-geometry map/thumbnail performance.
- **Acceptance criteria:** UI automation covers launch, onboarding, one point-to-point, one multi-loop comparison, detail, save/reopen/delete, clarification, retry, and no-route; VoiceOver/largest text/Reduce Motion/contrast passes on supported devices; no dead primary control; performance budgets are recorded.
- **Dependencies:** UI tests should stabilize after P0-02/P1-10/P1-11. Test-target scaffolding can start earlier with exclusive project-file ownership.
- **Risk:** Brittle tests if accessibility identifiers/state injection are not designed first; `project.pbxproj` merge conflicts.
- **Expected files/modules:** new UI-test target/files, `TrailMind.xcodeproj/project.pbxproj`, targeted view accessibility changes, test-only dependency composition.
- **Parallelization:** Test scaffolding parallel; view fixes merge after feature owners finish.
- **Recommended owner:** iOS QA/accessibility agent.
- **Size:** L.

### P1-14 — Verify voice and permission behavior on real hardware

- **Problem:** Voice state/service tests are good, but microphone, Apple Speech, denial/restriction, interruptions, locale accuracy, and privacy copy were not verified on physical devices.
- **Evidence:** `AppleSpeechVoicePlanningService`, `VoicePlanningModelTests`, correct just-in-time permission design, and `BUILD_AND_RUNTIME_REPORT.md`.
- **User/business impact:** A marketed voice entry path may fail or confuse users in realistic permission/network conditions.
- **Proposed solution:** Execute a hardware matrix; ensure denial/restriction/timeout/interruption recovery; keep the transcript editable before submission; verify purpose strings and privacy disclosure; remove voice from beta claims if evidence is not obtained.
- **Acceptance criteria:** Grant/deny/restrict/cancel/interruption/60-second/locale cases pass; no audio is retained by app code; transcript can be corrected; accessibility behavior is usable; product/privacy copy matches Apple Speech processing.
- **Dependencies:** Physical device access; signed development may be possible with Personal Team, while TestFlight proof needs paid membership.
- **Risk:** Speech availability and locale behavior vary by OS/account/network.
- **Expected files/modules:** `VoicePlanningService.swift`, `VoicePlanningModel.swift`, composer UI, purpose strings, voice tests only if issues are found.
- **Parallelization:** Manual verification can run beside routing/backend work; code fixes require Home ownership coordination.
- **Recommended owner:** iOS device/voice QA agent.
- **Size:** S.

## P2 — Valuable after the core loop works

### P2-15 — Decide device reach, appearance, and launch locales

- **Problem:** The app targets iOS 26 only, forces light appearance, has fixed large typography/heights, and has no localization resources despite Germany-first examples.
- **Evidence:** project deployment target, `.preferredColorScheme(.light)`, `TrailTheme`, and absence of string catalogs.
- **User/business impact:** Public reach is sharply limited and accessibility/localization quality may be poor in the intended market.
- **Proposed solution:** Make explicit product decisions for minimum OS, iPhone/iPad support, system appearance, and launch languages; lower the target only with API fallback/build/runtime evidence; add strings and layout tests for chosen locales.
- **Acceptance criteria:** Supported-device/OS/locales are documented and match metadata; system appearance decision is accessible; largest German/English strings do not clip; any lowered target builds and passes the core suite.
- **Dependencies:** Stable P1 UI and audience/storefront decision.
- **Risk:** Lowering the target can require broad API fallbacks; localization can expose layout assumptions.
- **Expected files/modules:** project settings, theme/views, string catalogs, UI tests.
- **Parallelization:** Research/string extraction can begin earlier; project/view edits follow P1-13 ownership.
- **Recommended owner:** iOS compatibility/localization agent.
- **Size:** L.

### P2-16 — Choose the route-handoff boundary; defer or scope basic following

- **Problem:** “Start route” implies navigation, but no active route-following exists. A planner/export v1 does not require it.
- **Evidence:** `RouteDetailView` placeholder alert; unused `DefaultLocationService`; no active-session/progress/completion model.
- **User/business impact:** A dead Start CTA disappoints users; premature navigation work would delay the truthful planner.
- **Proposed solution:** For v1, remove Start Route and make GPX/Map handoff explicit. Only after beta evidence, separately scope current location, remaining distance, next instruction, basic off-route detection, and completion—without claiming offline turn-by-turn navigation.
- **Acceptance criteria:** Public v1 contains no navigation implication unless an end-to-end location-permission and active-session test passes; if following is approved later, foreground/background/denied/off-route/battery/safety states have written requirements before code.
- **Dependencies:** P1-11 and product decision after closed-beta feedback.
- **Risk:** Location/background capabilities add safety, privacy, battery, signing, and review scope.
- **Expected files/modules:** current `LocationService` foundation, future dedicated active-route module, route detail, permissions/entitlements only after approval.
- **Parallelization:** Product specification can run in parallel; implementation is deferred.
- **Recommended owner:** Product + iOS location/navigation architecture agent.
- **Size:** XS.

### P2-17 — Add richer comparison context only after truth is stable

- **Problem:** Current lightweight thumbnails show normalized shape without geography; instructions are decoded/persisted but not displayed; cards still require serial comparison.
- **Evidence:** `RouteThumbnailView`, `RouteThumbnailService`, `RouteSuggestionsView`, stored `routeInstructions` with no View consumer.
- **User/business impact:** Users can compare broad shapes/stats but not geographic direction, town proximity, or a compact route overview.
- **Proposed solution:** First add aligned verified deltas and an optional compact instruction/route overview; then evaluate cached `MKMapSnapshotter` basemap thumbnails with a graceful abstract fallback and strict performance/cache budgets.
- **Acceptance criteria:** No interactive maps in lists; thumbnails cannot block scrolling; attribution is compliant; route overview is not labelled turn-by-turn navigation; comparison uses only measured facts.
- **Dependencies:** P0-03, P1-08, P1-13 performance baseline.
- **Risk:** Map snapshots add memory/network/cache complexity and may obscure route lines.
- **Expected files/modules:** `RouteComponents.swift`, `RouteThumbnailService.swift`, `PlanningViews.swift`, tests/performance fixtures.
- **Parallelization:** After route card semantics stabilize; one owner for shared route views.
- **Recommended owner:** SwiftUI/MapKit performance agent.
- **Size:** M.

## P3 — Post-launch expansion

### P3-18 — Verified outdoor intelligence

- **Problem:** Weather, daylight, closures, water, viewpoints, shelters, camping legality, transit, and real scenic quality are not implemented, yet old mock/onboarding copy mentions parts of them.
- **Evidence:** No verified data layer or production service exists; `MockRoutes` contains unsupported authored claims.
- **User/business impact:** These features could add substantial planning value, but unsupported claims can create real-world safety harm.
- **Proposed solution:** Add each data domain only through licensed, freshness-aware sources with explicit coverage/provenance and an “unknown” state; never infer it from a language model.
- **Acceptance criteria:** Each domain has source, timestamp/coverage, legal terms, failure behavior, UI distinction from preferences, and safety review before any public claim.
- **Dependencies:** Stable v1 route-truth contract and product demand.
- **Risk:** High data/licensing/freshness/safety complexity.
- **Expected files/modules:** Future backend data adapters, typed domain models, route detail components, privacy/legal docs.
- **Parallelization:** Discovery can run independently; implementation should be domain-by-domain.
- **Recommended owner:** Outdoor-data/product-safety research agent.
- **Size:** XL.

### P3-19 — Accounts, cloud sync, community, Watch, and monetization

- **Problem:** None is required to prove the current planning value, and no production foundation exists for them.
- **Evidence:** Saved routes are local JSON; no accounts/auth/product analytics/social/watch/payment code exists.
- **User/business impact:** Premature expansion would broaden privacy, moderation, reliability, and App Review scope before the main loop is trustworthy.
- **Proposed solution:** Defer until retention and beta evidence identify a concrete need. Start with an explicit product/data model and deletion/export requirements, not a vendor-first integration.
- **Acceptance criteria:** A separately approved product brief, data/privacy model, moderation/support plan where relevant, and measurable reason to add the feature.
- **Dependencies:** Public v1 and real user evidence.
- **Risk:** Very high scope and operational cost.
- **Expected files/modules:** Future modules only; do not retrofit into current core files without an architecture decision.
- **Parallelization:** Research only; no implementation on the current critical path.
- **Recommended owner:** Product strategy/architecture agent.
- **Size:** XL.

## Paid Apple membership boundary

The following backlog work is **not blocked** by paid membership: P0-01 through P0-04, most of P0-05 backend work, P0-06 implementation/drafting, all deterministic tests, UI-test creation, Simulator builds, accessibility/layout work, GPX, persistence, parser/routing changes, privacy manifest preparation, metadata/review-note drafts, and staging infrastructure if separately authorized.

The following evidence **does require** paid team access later: explicit production App ID/capabilities, intended-team signing/profiles, distribution archive, App Store Connect record, TestFlight distribution, production-environment App Attest verification, App Privacy/App Store metadata entry, external beta review where applicable, and App Review submission. Do not let these later gates block source-level truth and quality work now; do not claim distribution readiness without them.

## Recommended immediate sequence

1. P0-00 credential containment.
2. P0-01 route provenance and fact invariants—the first code task.
3. P0-02 and P0-03 Release truth cleanup.
4. P0-04 backend intent hardening in parallel with P0-02/P0-03 after contracts are stable.
5. P1-07/P1-08 live quality and routing reliability; P1-09/P1-10 intent and core flow.
6. P1-11/P1-12 real export and return loop.
7. P0-05/P0-06 deployment/privacy gates and P1-13/P1-14 device/accessibility proof.
8. Only then consider P2/P3 expansion.
