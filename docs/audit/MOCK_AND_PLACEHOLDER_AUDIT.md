# Mock and Placeholder Audit

- Audit date: 2026-07-15
- Scope: all app, backend, test, configuration-example, project, and documentation files in the repository. Local secret files and generated output were explicitly excluded and no secret value was inspected or reproduced.

## Method

The repository was searched case-insensitively for all required terms:

`mock`, `mocked`, `sample`, `demo`, `placeholder`, `fake`, `stub`, `preview`, `fallback`, `hardcoded`, `temporary`, `TODO`, `FIXME`, `HACK`, `later`, `not implemented`, `fatalError`, `dummy`, `static route`, `sample route`, `test coordinates`, `example coordinates`, and `#if DEBUG`.

The audit also manually inspected:

- SwiftUI previews and preview-injected services
- all `MockRoutes` references
- dependency-injection defaults
- route factories and static arrays
- fallback routing/parser/session behavior
- saved-route persistence defaults
- test/evaluation fixtures and helpers
- backend no-provider behavior
- Debug compilation gates
- UI copy and controls that imply unsupported capability

No production `fatalError`, `FIXME`, or `HACK` occurrence was found. The important findings are not hidden crash stubs; they are polished, release-reachable mock experiences.

## Bottom line

### Can a failed real routing request silently become a believable fake route?

**The primary typed/voice planning path does not currently catch a GraphHopper/geocoding failure and substitute `MockRoutes`.** `PlannerViewModel.generateDynamicRoute` records a failed generation stage and leaves `suggestions`/`generatedRoute` empty. This is the correct behavior.

However, four adjacent paths still create the same user-level trust failure:

1. Home example chips intentionally select `.mockSuggestions`, simulate route-generation stages, and show fabricated route success.
2. Home labels a fixed mock as a recent plan under “Continue outside.”
3. Explore always shows fabricated routes, including after the hardcoded live demo fails.
4. “Edit with AI” modifies distance, elevation, duration, difficulty-adjacent copy, and scenic claims without rerouting geometry.

Additionally, the backend intent endpoint returns a deterministic mock intent when no AI provider key is configured, without a production-only fail-closed guard, and labels that response `remoteAI`.

These are public-launch blockers even though the central real-routing catch path itself fails safely.

## Public-launch blockers

| ID | Occurrence | Evidence | Isolation verdict | Production reachable? | Can mislead? | Public-launch blocker? | Required action |
|---|---|---|---|---|---|---|---|
| M-01 | Static fabricated route catalog | `TrailMind/Data/MockRoutes.swift` (`MockRoutes.all`, `harzWeekend`, `luneburgLoop`, `sunsetRidge`) | **Accidentally reachable in production.** This is neither Preview-, Debug-, nor test-gated. | Yes, through Explore, Home recent-plan card, example-chip suggestions, AI edit, detail, save, and export. | Yes. It contains invented geometry, distance, duration, elevation profiles, named POIs, water stops, viewpoints, stays, summaries, safety notes, and quality prose. | **Yes — P0.** | Remove all production references. Keep sample routes only in Preview/test fixtures or an unmistakably separate Debug demo target. |
| M-02 | Example chips route to mock planning | `HomeView.prompts`, `expandedPrompt(for:)`, `onPlan`; `PlanFlowView` maps `onPlan` to `PlannerViewModel.startPlanning`; `.mockSuggestions` default branch | **Accidentally reachable and primary-journey adjacent.** | Yes, one tap from Home. | Yes. The screen simulates “Understanding,” “Finding scenic paths,” “Balancing distance and elevation,” and “Checking highlights and safety,” then returns mock routes. | **Yes — P0.** | Make supported examples call `startTextRoute`; delete the mock request kind from production planning. |
| M-03 | Mock generation service is the default planner dependency | `TrailMind/Services/TrailServices.swift` (`MockAIPlannerService`); default in `PlannerViewModel.init` | **Production default for the example-chip branch.** | Yes. | Yes. It returns predetermined `MockRoutes` and synthetic intent fields, not a route engine. | **Yes — P0.** | Move to test/preview-only code or require explicit Debug-only injection. Do not retain a production default mock service. |
| M-04 | Fabricated progress and match percentages | `PlannerViewModel.generateMockSuggestions`, `stageStates(for:)`; `matchScore: max(96 - index * 5, 80)`; `RouteCard.badgeLabel` | **Accidentally reachable.** | Yes, from example chips. | Yes. Percent “match” has no statistical/model basis, and progress claims operations that never occur. | **Yes — P0.** | Remove synthetic percentages and simulated stages; display only actual route-generation state and grounded explanations. |
| M-05 | Fake route history / recency | `HomeView` “Continue outside” / “Recent plans, ready when you are”; `NavigationLink(value: MockRoutes.luneburgLoop)` | **Accidentally reachable and mislabeled.** | Yes, on every Home visit after onboarding. | Yes. Static sample data is presented as the user’s prior activity. | **Yes — P0.** | Remove until a real recent-route/history store exists. |
| M-06 | Explore mock catalog | `TrailMind/App/TrailMindApp.swift` (`ExploreView`, `ForEach(MockRoutes.all)`) | **Explicit demo content, but not isolated.** | Yes, as a main tab. | Yes. Cards/details contain no persistent “sample” provenance and can be saved/exported. | **Yes — P0.** | Hide/remove Explore in Release or replace with a truthful empty/real-data state. |
| M-07 | Release-visible developer routing demo | `ExploreView.graphHopperDemo`, “LIVE ROUTING DEMO,” “Temporary developer path,” hardcoded Ilsenburg/Schierke coordinates, `generateHarzDemoRoute()` | **Developer UI accidentally reachable in production.** | Yes; no `#if DEBUG`. | Moderately. The live result is real, but the fixed route and developer wording make the product appear unfinished and unrelated to user intent. | **Yes — P0 for App Store cleanliness.** | Move to Debug-only QA tooling/tests; remove from the public tab. |
| M-08 | Explore failure leaves mocks as the fallback catalog | `ExploreView.generateGraphHopperDemo` catch: notice says mock routes are shown below; catalog is always present | **Disclosed but still production-adjacent.** | Yes after network/backend failure. | Yes. The notice is explicit, but cards lose that context once opened/saved and remain believable route plans. | **Yes — P0.** | Show a real error/empty state; never place saveable fake routes under a live routing failure. |
| M-09 | Mock AI route editing | `RouteEditAIView`; `RouteEditViewModel` default `MockAIPlannerService`; `MockAIPlannerService.editRoute` | **Accidentally reachable from every route detail.** | Yes, including from real GraphHopper routes. | **Severely.** It changes displayed distance/elevation/duration and claims steep sections/scenery changed while retaining the original geometry, waypoints, elevation profile, and instructions. | **Yes — P0 safety/trust.** | Remove/Debug-gate until an edit becomes typed constraints, triggers real rerouting, and validates all returned facts. |
| M-10 | Unsupported scenic/water edit quick actions | `RouteEditAIView.quickActions`: “More scenic,” “Add water stop,” “Split into 2 days”; mock copilot responses | **Accidentally reachable.** | Yes. | Yes. No scenic, POI/water, or multi-day route intelligence supports these actions. | **Yes — P0.** | Do not expose actions until backed by verified data and real geometry. |
| M-11 | No route provenance/source in model or UI | `TrailRoute` has no live/mock/source field; `LocalSavedRouteStore` persists routes uniformly | **Architectural omission enables all mock leakage.** | Yes. | Yes. Once a mock is opened or saved, no reliable UI/store distinction remains. | **Yes — P0.** | Add a non-optional provenance/verification model. Release should accept only verified routing-engine geometry as route facts. |
| M-12 | Saving/exporting mock data as normal user data | `RouteDetailView` save toolbar and GPX export accept any `TrailRoute`; `SavedRoutesView` has no source filter | **Accidentally reachable.** | Yes, from Home mock, Explore mock, or mock-edited route. | Yes. Fabricated geometry/stats become persistent/shareable artifacts. | **Yes — P0.** | Block persistence/export for demo data, or remove demo reachability entirely. |
| M-13 | Backend no-provider mock intent | `backend/src/parseIntent.js`: `parseIntentEndpoint` calls `mockIntent` when both provider keys are absent | **Not properly isolated.** README calls it local/test behavior, but code does not require development/test mode or an explicit flag. | Potentially yes on an authenticated production endpoint; Release iOS currently uses local-only parsing, limiting but not eliminating risk. | Yes. The deterministic result is returned with `parserSource: "remoteAI"`. | **Yes — P0.** | Fail closed in production. Require an explicit local/test mock flag and identify the source as mock/local, never remote AI. |
| M-14 | Requested difficulty displayed as actual route difficulty | `GraphHopperClient.makeTrailRoute`: requested difficulty overrides computed difficulty; `DifficultyBadge` displays it | **Production logic bug, not a named mock.** | Yes for real routes. | Yes. An objectively demanding route can display “Easy” because the user requested easy. | **Yes — P0 trust.** | Separate requested constraint from computed/verified route difficulty; never promote the request to a fact. |
| M-15 | Onboarding overclaims context and balancing | `OnboardingView.pages`: “balances ... highlights, practical stops”; “Every plan includes ... conditions, water, exposure” | **Hardcoded unsupported product copy.** | Yes, first launch. | Yes. Live routes do not verify highlights, practical stops, current conditions, water, or exposure. | **Yes — P0 claim accuracy.** | Rewrite around real geometry, stats, comparison, and review-before-start trust copy. |
| M-16 | Static “Near you” personalization | `HomeView.hero` hardcoded label; no wired `DefaultLocationService` | **Hardcoded and unsupported.** | Yes. | Yes, mildly: it implies current-location awareness that does not exist. | **Yes — P0 product truth.** | Remove or replace with a neutral label until location is intentionally implemented. |
| M-17 | Nonfunctional preference controls | `ProfilePreferencesView`; `UserPreferences` hardcoded defaults; no persistence/planner consumption; “Prefer offline-ready routes” | **Production-reachable placeholder behavior.** | Yes. | Yes. Users can change settings that reset and do not affect route generation; offline-ready routes do not exist. | **Yes — P0 for unsupported offline claim; P1 overall.** | Hide controls until functional; retain only supported, persisted preferences. |

## Significant non-blocking or secondary placeholders

| ID | Occurrence | Evidence | Verdict | Production reachable? | Misleading risk | Launch decision / action |
|---|---|---|---|---|---|---|
| P-01 | GPX export swallows errors and shares text | `RouteDetailView.export`: `try? ... ?? ""`; `DefaultGPXService` TODO | Partially implemented, not mock data. | Yes. | Medium: an export failure can open Share with empty content; raw XML text is presented as GPX. | P1. Share a validated `.gpx` file and show errors. |
| P-02 | GPX format is minimal | `DefaultGPXService.exportRouteAsGPX` | Honest TODO but incomplete public behavior. | Yes. | Medium: no XML escaping/elevation/timestamps/extensions; special characters can invalidate XML. | P1. Escape/validate and use file export. |
| P-03 | “Start route” placeholder | `RouteDetailView` alert “Navigation foundation ready” | Explicit placeholder; not fake navigation. | Yes. | Low-to-medium: prominent CTA suggests a capability before tap. | P1. Relabel/remove for beta or implement basic following. |
| P-04 | Route thumbnail abstract fallback | `RouteThumbnailPlaceholder`, “Preview pending” | **Safe and properly labeled.** | Yes only for insufficient geometry. | Low. It does not claim to be the real route, but should rarely occur for a valid live route. | Keep; investigate why a production route lacks geometry. |
| P-05 | Map no-geometry fallback | `MapPreviewView`: “Route preview unavailable” | **Safe and honest.** | Yes. | None. | Keep. |
| P-06 | Map “PREVIEW” badge | `MapPreviewView` | This means map preview, not sample/mock data. | Yes. | None. | Keep or rename only for clarity. |
| P-07 | Hardcoded Home prompt examples | `HomeView.prompts`/`expandedPrompt` | Fixed examples are acceptable in principle; their current unsupported content and mock routing are not. | Yes. | High in current form. | Covered by M-02; replace with real supported examples. |
| P-08 | Hardcoded AI-edit quick actions | `RouteEditAIView.quickActions` | Fixed UI suggestions would be acceptable if implemented; currently they expose mock capability. | Yes. | High. | Covered by M-10; remove from Release. |
| P-09 | Hardcoded profile interests/defaults | `ProfilePreferencesView.interests`; `UserPreferences` defaults | Standard defaults, but currently nonpersistent/nonfunctional. | Yes. | Medium. | Covered by M-17; connect or hide. |
| P-10 | Hardcoded onboarding pages | `OnboardingView.pages` | Static onboarding is normal; claims are not. | Yes. | High in current copy. | Covered by M-15. |
| P-11 | GraphHopper demo coordinates | `generateHarzDemoRoute()` | Valid real-routing QA fixture, wrongly exposed publicly. | Yes via Explore. | Medium. | Debug/test-only after M-07. |
| P-12 | Fallback map region in `DefaultMapService` | fixed Germany center when route path is empty | Safe defensive default and currently bypassed by `MapPreviewView`’s empty-geometry branch. | No known production visual path. | Low. | Keep or simplify as dead defensive code. |
| P-13 | Protocol default round-trip “fallbackEnd” | default `GraphHopperRouteCalculating.calculateRoundTripRouteVariants` creates a nearby endpoint for conformers that do not implement variants | Weak/dead abstraction, not used by `GraphHopperClient` production implementation. | No known app path; custom conformers could inherit it. | Medium if a future production conformer forgets to override. | Remove the misleading default or make the requirement explicit. |
| P-14 | `MockRoutingService` | `TrailMind/Services/TrailServices.swift` | Compiled dead mock service; no app construction references it. | No known path. | Low today, high if accidentally injected. | Move to test support or delete. |
| P-15 | `InMemorySavedRouteStore` | `TrailMind/Services/SavedRouteStore.swift` | Safe injectable test double; app default is `LocalSavedRouteStore.applicationStore()`. | No default path. | Low. | Keep with test-oriented naming/location. |
| P-16 | `FakeVoicePlanningService` compiled in app target | `VoicePlanningService.swift`; only app-source reference is the SwiftUI preview, tests inject it | Properly used as preview/test support, although not compilation-gated. | Not through UI. | Low. | Prefer moving to Preview/test support to reduce accidental injection. |

## Safe real fallbacks that are not mock route success

The required term search produces many `fallback` matches that are intentionally safe. They must not be conflated with `MockRoutes`:

| Occurrence | Evidence | Why it is safe | Caveat |
|---|---|---|---|
| Remote intent → local parser fallback | `RemoteWithLocalFallbackIntentParsingProvider` | Returns parser-derived intent only; GraphHopper still computes geometry. Debug-only default today. | If enabled in Release, provenance must say local parser rather than remote AI. |
| GraphHopper flexible → standard point-to-point retry | `GraphHopperClient.calculateGraphHopperRoute` | Both attempts call the real routing provider; metadata records applied versus requested-only shaping. | Current retry catches every GraphHopper `.api` error, broader than only explicit flexible-mode failure. Narrow it. |
| Direct round trip → via-point loop fallback | `RoutingCoordinator`, `LoopFallbackProvider` | Via points are generated locally but every segment/geometry/stat comes back from GraphHopper. | Generated via points are not POIs and must never be described as highlights. |
| Failed individual seed | round-trip and fallback candidate loops | Successful seeds remain real; a failed seed does not create substitute static data. | A single route should be labeled as such, which the code does. |
| Missing provider ascent/descent | `elevationChange` | Computes totals from returned 3D coordinates, not invented terrain. | No value should be shown as verified when coordinates lack elevation. |
| Thumbnail placeholder | `RouteThumbnailPlaceholder` | Clearly labeled, abstract, and does not alter route facts. | Do not let it conceal invalid geometry accepted elsewhere. |
| Configuration numeric defaults | backend bounded-integer helpers | Safe operational defaults for limits/timeouts. | Invalid production configuration generally fails closed. |

## Debug-only inventory

| Occurrence | Files/types | Isolation assessment | Risk/action |
|---|---|---|---|
| Remote intent mode/default local URL | `IntentParsingFoundation.swift` (`defaultBaseURL`, provider factory, parser mode) | Correctly selected with `#if DEBUG`; Release factory is local-only. | Safe isolation. Product copy must not call Release “remote AI.” |
| Detailed remote parser error strings | `RemoteAIIntentParsingProvider.ProviderError` | Detailed HTTP/config errors are Debug-only; Release uses generic copy. | Safe. |
| Planner reflected error | `PlannerViewModel.generationDebugError` | Declared/set/cleared only in Debug. | Safe, though no UI currently uses it. |
| Intent source badge | `RouteComponents.swift` | Entire view/use is Debug-gated. | Safe. |
| Intent QA disclosure | `RouteDetailView.intentQA` | Entire state/view/use is Debug-gated. | Safe. Raw prompts/base URL remain on-screen only in Debug. |
| Loop candidate debug metadata | `RoutingFoundation.swift` | Debug has target, ratio, overlap, radius, seed, pattern/provider; Release stores `nil`. | Safe; loss of overlap evidence in Release weakens explanation/observability but prevents developer leakage. |
| Loop fallback print | `debugCandidateRejection` | `print` is Debug-only and contains pattern/reason, not coordinates. | Safe; keep precise locations out of logs. |
| HTTP loopback backend URL | `TrailMindBackendConfiguration.baseURL` | HTTP accepted only in Debug and only exact loopback hosts. | Safe. |
| Loopback placeholder route session | `RouteSessionService.swift` | Type exists only for Debug Simulator and only exact HTTP loopback; HTTPS/non-loopback/physical/Release retain App Attest. | Properly isolated. Do not weaken host/scheme/build checks. |

## Preview-only inventory

| Occurrence | Evidence | Assessment |
|---|---|---|
| Voice composer preview | `HomeView.swift` `#Preview("Voice composer")` | Properly Preview-only; injects `FakeVoicePlanningService` and cannot submit into the app shell. |
| Preview transcript/service state | same preview and fake service | Safe. No mock route is created by the preview itself. |

There are no other SwiftUI preview providers/traits in the current repository.

## Test-only fixtures and mocks

All files under `TrailMindTests/` and `backend/test/` are excluded from the application/backend production source paths by target/folder structure. Relevant groups:

| Group | Files/examples | Assessment |
|---|---|---|
| Swift routing/provider doubles | `GraphHopperClientTests.swift`, `RoutingFoundationTests.swift`, `BackendRouteClientTests.swift`, `PlannerViewModelTests.swift` | Test-only and necessary. Static payloads validate request/response truth without displaying routes to users. |
| Intent doubles/evaluations | `IntentParsingFoundationTests.swift`, `IntentEvaluationSupport.swift`, `Fixtures/prompt_intent_eval.json` | Test-only. Live remote evaluation is opt-in; local deterministic evaluation is safe. |
| Route-quality fixtures | `RouteQualityEvaluationSupport.swift`, `Fixtures/route_quality_eval.json` | Test-only. Synthetic geometry/stats are appropriate because they assert rejection/warning logic. |
| Persistence fixtures | `SavedRouteStoreTests.swift`; injected `InMemorySavedRouteStore` | Test-only use; a dedicated test asserts a fresh production store does not seed mocks. This is positive evidence. |
| Voice fake | `VoicePlanningModelTests.swift`; `FakeVoicePlanningService` | Test/preview support and not a production UI dependency. |
| App Attest fakes/official fixture | `AppAttestServiceTests.swift`, backend App Attest tests, `backend/test/fixtures/appleAppAttestFixture.js` | Test-only. Documentation correctly states Simulator fakes do not prove real-device App Attest. |
| Backend provider/server mocks | `routeEndpoint.test.js`, `routeServer.test.js`, `graphHopperProvider.test.js` | Test-only; normalized payloads never seed the app. |
| Backend mock-intent tests | `parseIntent.test.js` | Tests expose the deterministic no-key fallback. The tests are safe; the source behavior they cover is not production-isolated (M-13). |
| Optional database integration fixture | `postgresAppAttestIntegration.test.js` | Test-only and gated by an external disposable test database variable. |

No sample saved route is automatically inserted into `LocalSavedRouteStore`; `SavedRouteStoreTests.testFreshStoreIsEmptyAndDoesNotSeedMocks` explicitly protects this behavior.

## TODO and incomplete-implementation inventory

| Occurrence | Evidence | Reality and production reachability | Priority/action |
|---|---|---|---|
| Replace deterministic mock planner | `MockAIPlannerService.parseAdventurePrompt` TODO | Still production-reachable through Home examples and AI editing. | **P0:** remove from production rather than “improve” the mock. |
| Send intent to routing/weather/safety | `MockAIPlannerService.generateRouteSuggestions` TODO | Not implemented; returning `MockRoutes` masks the absence. | **P0:** delete masked success; real typed planner already exists for routing. Do not add weather/safety in this scope. |
| Apply AI route diff and validate | `MockAIPlannerService.editRoute` TODO | Not implemented; current code mutates facts without geometry. | **P0:** remove/Debug-gate. |
| Mock routing provider | `MockRoutingService` TODO | Dead code; returns a fixed route. | P2 cleanup: move to tests/delete. |
| Elevation-model sampling | `MockRoutingService.getElevationProfile` TODO | Dead code; returns existing profile. | P2 cleanup. |
| Full GPX metadata/file sharing | `DefaultGPXService` TODO | Minimal exporter is production-reachable. | P1 complete standards-valid file export. |
| Navigation sample persistence | `DefaultLocationService.startTracking` TODO | Location service is dead/unwired; no active navigation. | P2/P3; remove unsupported UI until scoped. |
| Direct GraphHopper key/proxy comments | three TODOs in private direct-request builders in `GraphHopperClient.swift` | Comments are stale for the default app path, which uses `BackendRouteGateway`; direct client initializer remains useful in tests. | P2 update comments and keep direct-key initializer inaccessible to production composition. |
| Custom-model tuning | TODO in `GraphHopperRoutePreferences.conservative` | Honest limitation; mild road/slope rules are production-reachable, but no scenic claim is made by this code. | P1 evaluate with live route-quality fixtures before stronger claims. |

## Documentation-only mock/placeholder references

`AGENTS.md` and `PROJECT_CONTEXT.md` contain numerous “mock fallback,” “planned later,” “preview,” and “placeholder” references. They are not executable and cannot directly create a fake route. They do, however, create two material governance problems:

1. They instruct agents both to preserve mock fallback and never invent route geometry/stats. Those rules conflict while mocks remain release-reachable.
2. `PROJECT_CONTEXT.md` is stale: it says no backend/AI, SwiftData is planned, route thumbnails are next, and save/export are later, while the repository now has a backend/remote parser foundation, JSON saved routes, thumbnails, and GPX sharing.

Documentation should be corrected after the public mock paths are removed so future agents do not treat demo behavior as protected production functionality.

## Unsupported-claim inventory

| Claim/data | Source | Verified? | Risk |
|---|---|---|---|
| Named waterfalls, viewpoints, forest, lake/water, overnight stays, rail connections | `MockRoutes` highlights/waypoints/summaries | No; static authored samples | High — can influence real outdoor decisions. |
| Route-specific safety (“exposed upper trail,” shared paths, bring a light) | `MockRoutes.safetyNotes` | No source/freshness/provenance | High. Generic review advice is acceptable; route-specific facts are not. |
| “Scenic,” “quiet,” “water,” “sunset,” “strongest viewpoints preserved” | mock summaries, `whyItMatches`, AI edit output | No | High. |
| Synthetic “80–96% match” | mock suggestion creation | No score model/calibration | High. |
| Nearby personalization | Home “Near you” | No location use | Medium. |
| Recent plan/history | Home static `MockRoutes.luneburgLoop` | No user history | High. |
| Offline-ready preference | Profile toggle | No offline maps/route readiness computation | High. |
| Every plan includes conditions/water/exposure context | onboarding | No live context sources | High. |
| “Easy” on a demanding route | requested difficulty overriding computation | Not verified; preference promoted to fact | High. |

## Release gate

A useful closed beta should not ship until all of the following are true:

- No Release UI references `MockRoutes`, `MockAIPlannerService`, the GraphHopper developer demo, or mock AI editing.
- A real request failure cannot reveal a saveable demo catalog in the same journey.
- `TrailRoute` (or its replacement) carries explicit source/provenance and verification semantics.
- Saved routes and GPX export reject non-live/demo routes in Release.
- Requested preferences, especially difficulty, are never rendered as verified actual characteristics.
- Backend no-provider intent parsing fails closed outside an explicit local/test mode.
- Onboarding/Home/Profile copy and controls match implemented capabilities.
- A regression test asserts that the Release composition contains no mock route provider and that every production planning CTA enters the real pipeline.

The safe long-term rule should be simple:

> Preview and test fixtures may be vivid. A Release route may be shown as a successful route only when its geometry and quantitative facts came from a real routing response and its qualitative claims are separately verified or explicitly labeled as unfulfilled preferences.
