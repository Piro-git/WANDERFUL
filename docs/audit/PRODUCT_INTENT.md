# Product Intent Audit

Audit snapshot: 2026-07-15. This document reconciles the product direction in `AGENTS.md` and `PROJECT_CONTEXT.md` with the product that is actually present in the repository. Executable code and build configuration are treated as stronger evidence of current behavior than roadmap prose.

## Executive finding

TrailMind's product thesis is coherent and differentiated:

> Describe an outdoor adventure in natural language, receive real routed options, compare them with trustworthy evidence, and keep the whole planning flow on iPhone.

The current repository already goes materially beyond its governing product documents. It contains a backend routing proxy, protected route sessions, remote model-assisted intent parsing in Debug, voice input, route thumbnails, verified path-detail summaries, local saved routes, and a minimal GPX serializer exposed through text sharing. At the same time, the app still exposes mock planning, developer demo content, a geometry-free "Edit with AI" flow, and navigation/offline/profile affordances that are not connected to real capability.

The clearest current product description is therefore:

> TrailMind is an iOS-first outdoor route planner that can turn supported text or voice prompts into GraphHopper-backed route geometry, compare loop alternatives, explain route fit using routed data, and save plans locally. Its current GPX handoff is only partial. It is not yet a production AI copilot or a navigation app.

Evidence: `TrailMind/Views/Home/HomeView.swift` (`PlanFlowView`, `PromptComposerView` entry points), `TrailMind/ViewModels/AppModels.swift` (`PlannerViewModel`), `TrailMind/Services/RoutingFoundation.swift` (`RoutingCoordinator`), `TrailMind/Services/GraphHopperClient.swift` (`GraphHopperClient`), `TrailMind/Views/Planning/PlanningViews.swift` (`RouteSuggestionsView`), and `TrailMind/Views/Route/RouteDetailView.swift` (`RouteDetailView`).

## Intended audience

The repository consistently identifies the initial audience as:

- iPhone-first hikers, trail runners, and cyclists;
- casual outdoor users and weekend adventurers rather than GIS experts;
- people who can describe the trip they want but do not want to construct it waypoint by waypoint;
- people who currently plan conversationally and then rebuild the route in another app;
- Germany-first users, with Harz, Ilsenburg, Schierke, Brocken, Lüneburg, and Amelinghausen as the main examples.

Evidence: `AGENTS.md` sections "Target Users" and "Current Route Flows"; `PROJECT_CONTEXT.md` sections 4 and 5; activity cases in `TrailMind/Models/AdventureModels.swift` (`ActivityType`); and Germany-biased geocoding in `TrailMind/Services/GeocodingService.swift` (`NativeGeocodingService`).

## Primary user job

The primary job is not "chat about hiking" and not "display a map." It is:

> Convert loosely expressed outdoor intent into route options that are real enough to inspect, compare, save, and take into another navigation workflow.

The user needs to express activity, place, route type, desired distance or duration, difficulty, and preferences without manually translating that intent into routing controls. TrailMind then needs to preserve the distinction between:

- requested preferences, such as views, forest, quiet paths, and water; and
- verified facts, such as routed geometry, distance, duration, elevation, path details, and measured loop quality.

That trust distinction is explicit in `AGENTS.md` and is partially encoded in `RoutePlanningMetadata`, `RouteShapingSummary`, `VerifiedRouteCharacteristics`, and `RouteQualityExplanationGenerator` in `TrailMind/Models/AdventureModels.swift`.

## Intended core product loop

1. The user types or speaks an outdoor request.
2. TrailMind parses and validates a structured `AdventureIntent`.
3. Textual locations are geocoded.
4. A real routing engine calculates the geometry and route metrics.
5. TrailMind presents one route or several comparable loop variants.
6. The user inspects the route shape, verified statistics, path characteristics, and safety notes.
7. The user saves the plan locally; the current GPX handoff serializes XML but does not yet export a validated named `.gpx` file.
8. In-app navigation may follow later, but is not part of the current product.

Concrete implementation path:

`PromptComposerView` / `VoicePlanningModel` → `PlannerViewModel.startTextRoute(prompt:)` → `IntentParsingProvider` → `IntentValidationService` → `NativeGeocodingService` → `RoutingCoordinator` → `GraphHopperRoutingProvider` / `LoopFallbackProvider` → `GraphHopperClient` → `BackendRouteGateway` → backend `POST /api/route` → `RouteSuggestionsView` or `RouteDetailView`.

## Unique value proposition

### 1. Natural-language planning with typed intent

`AdventureIntent` and `RoutePlanningRequest` keep activity, route type, distance, duration, difficulty, and desired/avoided features explicit. The parser is replaceable through `IntentParsingProvider`.

### 2. Real geometry rather than model-invented routes

The default `GraphHopperClient()` uses `BackendRouteGateway`. The backend validates a narrow request contract and constructs the GraphHopper call in `backend/src/routing/graphHopperProvider.js`. Geometry, distance, time, ascent/descent, instructions, and supported path details come from the routing response.

### 3. Intent-aware alternatives and loop comparison

`RoutingCoordinator` combines GraphHopper round trips with `LoopFallbackProvider` when direct loops are insufficient or unavailable. `RouteSuggestionNormalizer` filters, deduplicates, ranks, and labels comparable loop variants. `RouteThumbnailView` in `TrailMind/Views/Route/RouteComponents.swift` gives cards a lightweight shape preview without embedding interactive maps in a list.

### 4. Trust-oriented presentation

`RouteDetailView` separates requested planning metadata from verified route characteristics, shows safety review notes, and presents GraphHopper/OSM-derived stats as route data. `RouteQualityExplanationGenerator` can explain distance fit, loop status, variant relationship, and live routing evidence.

### 5. Apple-native planning experience

The product is a SwiftUI app with MapKit, Core Location, Speech, Observation, App Attest, Keychain storage, and platform-native sharing. The design direction in the docs matches the implemented tab shell, cards, route map, loading states, and local save flow.

## Explicit non-goals and claim boundaries

The product documents explicitly reject:

- a Komoot clone, generic chatbot, generic map app, or cluttered GIS tool;
- invented geometry or fabricated route metrics;
- unverified claims about scenery, water, safety, legal camping, access, weather, or trail conditions;
- full turn-by-turn navigation at the current stage;
- weather, verified POI intelligence, trail closures, offline maps, community/social features, accounts, or cross-device sync unless separately implemented;
- shipping provider secrets in the iOS app.

Current code supports the following claim boundary:

| Capability | Current claim that is supportable | Boundary |
|---|---|---|
| Text planning | "Describe a route and TrailMind calculates it" | The real path starts from the composer, not every Home shortcut. |
| Voice input | "Plan by voice or text" | Apple Speech produces the prompt; voice is not a conversational copilot. |
| Route geometry and stats | "Calculated from GraphHopper/OSM routing data" | Applies to dynamic routes, not `MockRoutes` or geometry-free edits. |
| Loop comparison | "Compare distinct routed loop options" | The coordinator may return one route when quality/budget constraints prevent a comparison. |
| Route characteristics | "Verified from returned path details" | Only supported GraphHopper path details are facts; desired features remain preferences. |
| Saved routes | "Saved locally on this device" | JSON persistence only; no account or sync. |
| GPX | "Create basic GPX XML for sharing" | `DefaultGPXService` omits XML escaping, richer metadata, timestamps, and extensions; `ShareLink` receives a raw `String`, not a named validated `.gpx` file, and can silently share an empty fallback. |
| AI intent parsing | "Remote model-assisted parsing is under development" | Debug defaults to remote-with-local-fallback; Release defaults to the local parser. |
| Navigation | No live navigation claim | "Start route" currently displays a placeholder alert. |
| Offline | No offline-map claim | A preference toggle exists, but the capability does not. |

## Product reality versus governing documents

The following statements in `AGENTS.md` and `PROJECT_CONTEXT.md` are stale or incomplete:

| Documented state | Repository reality | Evidence |
|---|---|---|
| "No backend yet" | A Node/Vercel backend implements intent parsing, routing proxying, App Attest/session authorization, rate controls, and PostgreSQL-backed security state. | `backend/src/server.js`, `backend/src/parseIntent.js`, `backend/src/routing/routeEndpoint.js`, `backend/src/appAttest/appAttestRuntime.js` |
| Intent understanding is local-only and remote AI is future work | Debug defaults to `RemoteWithLocalFallbackIntentParsingProvider` and calls `/api/parse-intent`; Release intentionally returns `LocalIntentParsingProvider`. No direct OpenAI integration was found; the backend supports Gemini and OpenRouter. | `IntentParsingProviderFactory.makeDefaultProvider` and `RemoteAIIntentParsingProvider` in `TrailMind/Services/IntentParsingFoundation.swift`; `backend/src/parseIntent.js` |
| GraphHopper is configured from a local iOS API key | The default client routes through `BackendRouteGateway`; a direct key-bearing path remains for explicit tests/evaluations and retains stale proxy TODOs. | `GraphHopperClient.init()` and alternate initializer in `TrailMind/Services/GraphHopperClient.swift` |
| Voice is planned | Voice prompt capture is implemented with `VoicePlanningModel` and `AppleSpeechVoicePlanningService`. | `TrailMind/ViewModels/VoicePlanningModel.swift`, `TrailMind/Services/VoicePlanningService.swift` |
| Route thumbnails are the "best next task" | `RouteThumbnailService` caches normalized geometry and `RouteThumbnailView` / `MiniRouteGlyph` render it with lightweight SwiftUI paths. | `TrailMind/Services/RouteThumbnailService.swift`, `TrailMind/Views/Route/RouteComponents.swift` |
| SwiftData is planned for saved routes | Saved routes already persist as versioned, file-protected JSON through `LocalSavedRouteStore` and `SavedRoutesModel`. SwiftData is not used. | `TrailMind/Services/SavedRouteStore.swift`, `TrailMind/ViewModels/SavedRoutesModel.swift` |
| GPX/export is a later navigation feature | A basic `DefaultGPXService` is exposed through a `ShareLink`, but the current handoff is raw XML text rather than a robust file export. | `TrailMind/Services/TrailServices.swift`, `TrailMind/Views/Route/RouteDetailView.swift` |
| "Current app status" implies one coherent planner | Home currently exposes both a mock suggestion path and the real dynamic path. | `PlanFlowView` in `TrailMind/Views/Home/HomeView.swift`; `PlannerViewModel.RequestKind` in `TrailMind/ViewModels/AppModels.swift` |

The statement "No OpenAI integration yet" remains literally true based on the audited repository: there is no OpenAI client or SDK. It should not, however, be used to imply that there is no backend or remote model parsing.

## Contradictions and unresolved product decisions

### Critical: "Edit with AI" violates the trust contract

`RouteDetailView` exposes `RouteEditAIView` as a normal production navigation destination. Its default `RouteEditViewModel` uses `MockAIPlannerService`. `MockAIPlannerService.editRoute` changes displayed distance, duration, elevation, title, and summary without recalculating geometry. Unsupported instructions fall through to a "Scenic" result, while quick actions advertise "More scenic," "Add water stop," and "Split into 2 days."

This is not merely unfinished. It breaks the central rule that route facts and outdoor qualities must not be fabricated. It also makes the app feel like the generic chatbot wrapper the product explicitly rejects. Until edits produce a new structured request and a fresh routed geometry, this surface should not be treated as a shipping feature.

Evidence: `TrailMind/Views/AIEdit/RouteEditAIView.swift`, `RouteEditViewModel` in `TrailMind/ViewModels/AppModels.swift`, and `MockAIPlannerService.editRoute` plus `TrailRoute.edited` in `TrailMind/Services/TrailServices.swift`.

### High: Home has two visually adjacent but semantically different planners

Example chips call `onPlan` → `PlannerViewModel.startPlanning` → `RequestKind.mockSuggestions` → `MockAIPlannerService` / `MockRoutes`. Text or voice composer submission calls `onTextRoute` → `startTextRoute` → real parsing, geocoding, and routing. The distinction is hidden in the interaction rather than expressed in product language.

The generating copy for the mock branch also says it is "Finding scenic paths" and "Checking highlights and safety," even though it is only sleeping and returning fixtures. "Continue outside" is a fixed `MockRoutes.luneburgLoop` card labelled as a recent plan.

Evidence: `PlanFlowView` and `HomeView` in `TrailMind/Views/Home/HomeView.swift`; `PlannerViewModel.startPlanning`, `startTextRoute`, `generateMockSuggestions`, and `stageStates` in `TrailMind/ViewModels/AppModels.swift`.

### High: "AI-native" positioning does not match the Release runtime

`IntentParsingProviderFactory.makeDefaultProvider` returns `RemoteWithLocalFallbackIntentParsingProvider` in Debug by default and `LocalIntentParsingProvider` in Release. `RemoteAIIntentParsingProvider.defaultBaseURL` also returns `nil` outside Debug. The backend and Release URL configuration exist, but Release does not select remote intent parsing.

This can be an intentional rollout choice, but it needs a product decision: either the public MVP is a natural-language, rule-based route planner, or remote structured intent parsing is a release capability with a defined fallback and privacy posture. Marketing should not imply the latter before the runtime does it.

There is also a provenance ambiguity in local/backend QA: when neither remote model provider is configured, `backend/src/parseIntent.js` returns a deterministic mock that still reports `parserSource: "remoteAI"`. The current response contract cannot distinguish an actual provider result from that deterministic backend fallback.

### High: onboarding and profile imply unavailable intelligence

Onboarding promises balancing "highlights" and "practical stops" and says plans include "conditions, water, exposure." Dynamic route construction currently adds fixed technical highlights and a reminder to check conditions; it does not fetch those outdoor intelligence layers. Profile exposes interests, preferred distance, risk posture, and "Prefer offline-ready routes," but `AppModel.preferences` is read only by `ProfilePreferencesView` and is neither persisted nor applied to planning.

Evidence: `TrailMind/Views/Onboarding/OnboardingView.swift`, `TrailMind/Views/Profile/ProfilePreferencesView.swift`, `AppModel` in `TrailMind/ViewModels/AppModels.swift`, and repository-wide references to `appModel.preferences`.

### High: developer/demo surfaces are production-reachable

`ExploreView` displays `MockRoutes.all` and a "LIVE ROUTING DEMO" card described as a temporary developer path. The Home screen also exposes fixed mock content. This conflicts with the App Store cleanliness rules in `AGENTS.md` and makes it difficult to tell which route evidence is real.

Evidence: `ExploreView` in `TrailMind/App/TrailMindApp.swift` and `TrailMind/Data/MockRoutes.swift`.

### Medium: route source and difficulty are not modelled cleanly

The backend response includes `provider: "graphhopper"`, but `GraphHopperRouteResponse` decodes only `paths` and `TrailRoute` has no route-source/provenance field. `RouteQualityExplanationGenerator.hasLiveRoutingEvidence` infers live routing from non-empty instructions or a fallback-provider debug label. That inference can fail for a valid provider response with zero instructions.

In addition, `GraphHopperClient.makeTrailRoute` uses a requested difficulty in preference to its computed difficulty. A user preference can therefore be displayed as though it were an observed property of the route.

The same assembler hardcodes `TrailRoute.location` to `"Germany"`, discarding more useful geocoded place context even though start/end names remain available in the title and waypoints.

Evidence: `backend/src/routing/graphHopperProvider.js` (`normalizeGraphHopperResponse`), `GraphHopperRouteResponse` and `makeTrailRoute` in `TrailMind/Services/GraphHopperClient.swift`, and `RouteQualityExplanationGenerator` in `TrailMind/Models/AdventureModels.swift`.

### Medium: current-location and navigation concepts are present but disconnected

`DefaultLocationService` wraps `CLLocationManager` but is not instantiated by the app. "Near you" language therefore does not use actual current location. `RouteDetailView`'s "Start route" action only displays "Navigation foundation ready."

Evidence: `LocationService` / `DefaultLocationService` in `TrailMind/Services/TrailServices.swift` and `RouteDetailView.bottomActions` in `TrailMind/Views/Route/RouteDetailView.swift`.

## Naming audit

### Canonical name: TrailMind

`TrailMind` is the only name consistently used by executable product assets:

- Xcode target and scheme: `TrailMind`;
- source directory and app entry point: `TrailMind/` and `TrailMindApp`;
- bundle identifiers: `com.trailmind.app` and `com.trailmind.app.tests`;
- display copy and onboarding state key;
- backend package and API/header names.

### Legacy repository name: EasyWander

`EasyWander` appears in the filesystem/repository context and in the headings of `AGENTS.md` and `PROJECT_CONTEXT.md`. It does not appear as a runtime brand. It should be described as a legacy repository/folder name if renaming the repository is not currently worth the churn.

### Unresolved external name: Wanderful

The audit brief mentions "TrailMind/Wanderful," but no `Wanderful` identifier was found in the audited app, backend, configuration, or repository documentation. Treat it as an external/abandoned candidate until the owner explicitly chooses it; do not introduce it as a third live name.

Recommended naming rule:

> Use TrailMind for the product, app, targets, APIs, types, and documentation. Use EasyWander only when referring to the legacy repository path. Do not use Wanderful without a deliberate rename decision.

## Recommended updates to AGENTS.md

The governing instructions should be refreshed before further feature work:

1. Replace the stale "Current Implemented Product State," tech-stack, and "Best Next Task" sections with the current backend, App Attest, voice, thumbnails, verified path details, JSON save, and GPX reality.
2. State the exact parser rollout: Debug remote-with-local-fallback; Release local-only as of this audit.
3. Define one production Home planning path and mark mock fixtures as preview/test-only.
4. Explicitly prohibit presenting route edits until every changed metric is produced by newly routed geometry.
5. Clarify that profile preferences are UI-only today and must not be marketed as personalization.
6. Clarify that current location, offline maps, weather/POI intelligence, and navigation are not connected.
7. Replace local-key guidance as the current production architecture with backend-proxy guidance; retain the direct client only as a controlled test/evaluation path if still required.
8. Add route provenance and requested-versus-observed difficulty to the trust model.
9. Remove the already-completed thumbnail task from "Best Next Task."

No product code was changed as part of this audit.
