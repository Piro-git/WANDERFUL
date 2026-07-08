# AGENTS.md — TrailMind / EasyWander

## Project Identity

TrailMind is an iOS-first, SwiftUI-native outdoor route planning app.

It is not a Komoot clone and not a generic chatbot. It is an AI-native outdoor planning experience where the user describes an outdoor adventure in natural language and the app turns that intent into real route options with real map geometry, distance, duration, elevation, route type, activity type, and planning metadata.

Core product sentence:

> Tell TrailMind what kind of adventure you want. TrailMind builds the route.

The long-term product goal is to become the simplest and most intelligent way to plan outdoor adventures on iPhone: describe the trip, compare real route options, understand why each route fits, and eventually navigate directly inside the app.

The original user pain:

A hiking trip was planned with ChatGPT, but the route then had to be manually rebuilt in Komoot. TrailMind removes that transfer friction by combining natural-language planning, real routing, map preview, route comparison, and later navigation in one clean iOS app.

---

## Product Positioning

TrailMind should feel like:

- Apple Maps clarity
- Apple Fitness polish
- Komoot-level outdoor usefulness
- a premium 2026 Apple-native app
- a calm outdoor companion
- a trustworthy route copilot

TrailMind should not feel like:

- a Komoot copy
- a generic chatbot wrapper
- a generic map app
- a cluttered GIS tool
- a hackathon demo
- a fake AI recommender

Suggested product language:

- “Describe your perfect outdoor route. TrailMind turns it into a real map.”
- “Plan outdoor adventures by voice or text — then start the route.”
- “Say where you want to go. TrailMind builds your hike, ride, or trail run.”

---

## USP / What Makes TrailMind Different

TrailMind’s unique value is the combination of:

1. Natural-language planning
   - The user can type or eventually speak naturally instead of manually building routes with filters and waypoints.

2. Real routing geometry
   - The app does not invent routes. It uses real routing engines, currently GraphHopper, to calculate route geometry.

3. Intent-aware route generation
   - The app understands route type, activity, distance, duration, difficulty, and requested preferences.

4. Route comparison
   - The app can show multiple real route variants, especially loop routes, instead of one opaque result.

5. Trustworthy outdoor UX
   - The app only presents verified route stats as facts. Desired features like views, forest, quiet paths, or water are shown as requested preferences unless verified by real data.

6. Premium Apple-native experience
   - The UI should feel clean, beautiful, fast, trustworthy, and deeply native to iOS.

The core product magic:

From casual intent:

> “Mach mir eine schöne 15 km Rundwanderung um Ilsenburg mit Aussicht.”

To real route options:

- 2–3 loop variants
- real map geometry
- real distance
- real duration
- real elevation
- activity profile
- requested preference chips
- visual map previews
- safety notes
- route detail
- later save/export/navigation

---

## Target Users

Initial target users:

- iPhone users
- hikers
- trail runners
- casual outdoor people
- weekend adventurers
- people who like Komoot but want easier planning
- people who plan with ChatGPT but manually transfer routes into map apps
- Germany-first users, especially Harz, Lüneburg, Brocken, Schierke, Ilsenburg, Amelinghausen

Initial activity focus:

- hiking
- trail running
- biking

---

## Current Implemented Product State

The app currently has:

- SwiftUI iOS foundation
- premium Apple-like UI
- Home route planning flow
- Explore/demo flow
- RouteSuggestionsView
- RouteDetailView
- MapKit route rendering
- mock fallback routes
- GraphHopper API integration
- secure local API key configuration
- parser-based route intent extraction
- point-to-point routing
- activity-aware routing
- distance-aware alternative routing
- loop / round-trip route generation
- multiple loop suggestions from seed variants
- route metadata display
- XCTest coverage

The app has already been verified with clean builds, simulator launches, and live GraphHopper routes.

---

## Tech Stack

Primary platform:

- iOS first

Language and UI:

- Swift
- SwiftUI

Maps:

- MapKit
- MapPolyline rendering in RouteDetailView
- lightweight route thumbnails planned for suggestion cards

Location and geocoding:

- CoreLocation
- CLGeocoder for text-to-coordinate conversion

Routing:

- GraphHopper Routing API

State and models:

- Swift models
- ViewModels
- local app state
- SwiftData planned later for persistence

AI:

- No OpenAI integration yet
- No backend yet
- current intent understanding is local parser-based
- future AI should run through a backend endpoint, not directly from the iOS app

---

## Routing Principles

The most important product rule:

> AI or local parsing may understand user intent, but a real routing engine must calculate actual route geometry.

Never invent:

- route geometry
- distance
- duration
- elevation
- water availability
- trail quality
- legal camping
- route safety
- scenic quality
- forest/water/viewpoint presence

Only show verified route stats as facts.

Requested features like views, forest, water, sunset, or quiet paths are user preferences unless verified by actual route, path, POI, or metadata.

Allowed wording:

- “Requested: views, forest, quiet paths”
- “Actual route is 14.4 km based on available paths”
- “Closest match to your requested distance”

Avoid wording like:

- “This route definitely has water”
- “This route is safe”
- “This is a legal camping route”
- “This route is scenic” unless verified

---

## GraphHopper Integration Rules

GraphHopper is currently the route engine.

Current GraphHopper client supports:

- POST /route
- query-key authentication
- profile `foot` for hiking and trail running
- profile `bike` for biking
- `elevation: true`
- `points_encoded: false`
- `instructions: true`
- `locale: de`
- path details foundation
- distance decoding
- duration decoding
- ascent/descent decoding
- 3D coordinate decoding
- instruction decoding
- error handling for missing key, invalid responses, network errors, and GraphHopper hints/messages

Critical coordinate rule:

- GraphHopper POST points use `[longitude, latitude]`.
- Internal app models should use normal `latitude`, `longitude`, and optional `elevation` naming.

Activity profile mapping:

- hiking → GraphHopper `foot`
- trail running → GraphHopper `foot`, but UI labels as trail run
- biking → GraphHopper `bike`

Loop route rules:

- Loop routes use GraphHopper `algorithm: round_trip`
- Use one start point only
- Use `round_trip.distance`
- Use `round_trip.seed`
- Use `ch.disable: true`
- Use `points_encoded: false`

Current loop seeds:

- 11
- 29
- 47

Distance-aware alternative rules:

- Use `algorithm: alternative_route`
- Use `alternative_route.max_paths`
- Use `alternative_route.max_weight_factor`
- Use `alternative_route.max_share_factor`
- Use `ch.disable: true`
- If GraphHopper rejects flexible routing, gracefully retry normal routing

---

## Current Route Flows

### Point-to-point prompts

Supported examples:

- `Ilsenburg nach Schierke`
- `von Ilsenburg nach Brocken`
- `Wanderung von Lüneburg nach Amelinghausen`
- `Plan a hike from Ilsenburg to Schierke`
- `Start: Ilsenburg, Ziel: Brocken`
- `Ilsenburg → Schierke`
- `Ich möchte nach Schierke von Ilsenburg`

Flow:

1. User enters prompt.
2. RoutePromptParser extracts start and end.
3. Parser extracts activity if present.
4. CLGeocoder geocodes start.
5. CLGeocoder geocodes end.
6. GraphHopper calculates route.
7. App converts response into TrailRoute.
8. RouteDetailView shows the real route polyline, distance, duration, elevation, and metadata.

### Loop prompts

Supported examples:

- `15 km Rundwanderung um Ilsenburg`
- `Rundtour bei Schierke ca. 12 km`
- `10 km loop around Lüneburg`
- `Trailrun loop from Ilsenburg for 2 hours`
- `Mach mir eine schöne Rundwanderung ab Ilsenburg mit Aussicht, ca. 15 km`

Loop parser extracts:

- routeType: loop
- startLocationQuery
- targetDistanceKm
- targetDurationMinutes if present
- activityType
- desiredFeatures

Default loop distances:

- hiking: 10 km
- trail running: 8 km
- biking: 25 km

Loop variants are ranked by:

1. absolute distance difference from target distance
2. lower elevation gain
3. shorter duration

Allowed labels based on real stats:

- Closest Match
- Shorter Loop
- Longer Loop
- More Elevation
- Easier Option

Do not use labels like “Scenic” unless scenic quality is verified by data.

---

## UI / UX Style Direction

The UI must be:

- premium
- Apple-native
- clean
- minimal
- calm
- outdoor-oriented
- trustworthy
- tactile
- modern 2026
- spacious
- fast
- uncluttered

The UI should feel like an intelligent outdoor companion, not a form and not a generic chatbot.

Use:

- large rounded cards
- subtle shadows
- soft gradients only where tasteful
- SF Symbols where appropriate
- natural color palette
- strong spacing
- clear hierarchy
- concise copy
- calm states
- premium empty/loading states

Color direction:

- deep forest green
- moss
- warm sand
- graphite
- white/off-white
- natural outdoor tones

Main UX surfaces:

- HomeView
- RouteSuggestionsView
- RouteDetailView
- Explore
- Saved
- Profile
- MapPreviewView
- RouteCard / RouteSuggestionCard
- Planned for you section

---

## Home UX

Home is the emotional center of the product.

It should communicate:

- “Tell me what kind of route you want.”
- “I will build it for you.”
- “This is simple, calm, and magical.”

Home should not become a generic form.

Good examples:

- a large friendly prompt area
- voice-first affordance later
- “Type instead” action
- example chips
- minimal route generation CTA
- calm loading/generating state

Bad patterns:

- too many filters
- map-first clutter
- complicated setup
- raw technical controls
- developer demo buttons in production UI

---

## Route Suggestions UX

RouteSuggestionsView should help the user compare real options.

For multiple loop variants, route cards should show:

- route title
- route label
- distance
- duration
- elevation
- activity
- route type
- planning metadata chips
- eventually a lightweight map thumbnail

The user should instantly understand:

- Which route is closest to the requested distance?
- Which route is easier?
- Which route is longer?
- Which route has more elevation?
- What shape does the route have?

Do not overload the card.

The next best UI improvement is lightweight route thumbnails / mini route previews.

---

## Route Detail UX

RouteDetailView should show:

- title
- location/subtitle
- real map with route polyline
- distance
- duration
- elevation gain/loss
- activity type
- route type
- difficulty if available
- label if available
- “Planned for you” section
- requested target distance/duration
- requested features as preferences
- safety notes
- start/end markers
- loop route indicator when applicable

The “Planned for you” section should be subtle and premium.

Example chips:

- Hiking
- Trail running
- Biking
- Loop route
- ca. 15 km
- ca. 2 hr
- Views
- Forest
- Quiet route
- Moderate
- Closest Match

Do not clutter.

---

## Safety and Trust UX

Outdoor route planning can affect real-world safety. TrailMind must be careful and transparent.

Required principles:

- Always communicate that routes are planning aids, not guarantees.
- Show route stats as data, not as safety promises.
- Encourage users to check weather, local rules, trail conditions, and water availability.
- Do not guarantee legal camping, water availability, route safety, or trail access.
- Do not overstate AI capability.
- Do not claim verified features unless verified by real data.

Recommended safety copy:

- “AI-assisted route. Review before starting.”
- “Check weather, local rules, trail conditions and water availability.”
- “Outdoor conditions can change quickly.”
- “Requested features are preferences, not verified guarantees.”

Future trust layer:

Explain route recommendations using real data:

- close to requested distance
- activity profile
- loop vs point-to-point
- elevation
- duration
- surface/path details if available
- road/trail classification if available

---

## App Store Approval / Apple Review Cleanliness

All work must keep the app App Store-ready.

Follow these rules:

### Safety

- Do not present routes as guaranteed safe.
- Include appropriate safety disclaimers for outdoor activity.
- Do not encourage illegal camping, trespassing, risky terrain, or unsafe behavior.
- Avoid misleading claims about water, shelters, trail access, or weather.
- Make sure route suggestions are framed as planning assistance.

### Performance

- The app must build cleanly.
- Avoid crashes, broken screens, dead buttons, placeholder production content, and debug UI.
- Keep loading states polished.
- Keep route card thumbnails lightweight and cached.
- Do not render many heavy interactive maps in lists.
- Handle missing API key, network errors, geocoding errors, and GraphHopper errors gracefully.

### Design

- Keep the app native, polished, and coherent.
- Follow Apple-style interaction patterns.
- Avoid cluttered or confusing UI.
- Do not ship unfinished-looking placeholder screens.
- No developer-only debug buttons in production UI.
- Do not imitate another app’s branding, icons, copy, or trade dress.

### Privacy

- Do not collect unnecessary personal data.
- Do not access location without clear purpose and permission text.
- Use location only for route planning, map display, and future navigation features.
- Add clear Info.plist permission strings before using location, motion, microphone, or speech APIs.
- If voice is added later, explain clearly why microphone/speech access is needed.
- If accounts are added later, provide privacy policy, data deletion/account deletion support, and accurate App Privacy labels.
- Do not log sensitive user prompts, coordinates, or location history unnecessarily.

### Legal

- Do not expose API keys.
- Do not commit secrets.
- Respect third-party API terms.
- Do not scrape Komoot, AllTrails, Outdooractive, or other services without permission.
- Provide required map/routing attribution where needed.
- Do not use copyrighted competitor assets or copied UI.

### Business / metadata readiness

- App Store screenshots and descriptions must match actual app functionality.
- Do not claim full AI, navigation, offline maps, weather, or verified POI intelligence until implemented.
- If a feature is planned but not live, do not market it as live.
- Remove internal demo labels before release.

---

## Secrets and Configuration

GraphHopper API key handling:

- Local key lives in `Configuration/Local.xcconfig`.
- `Local.xcconfig` must remain gitignored and untracked.
- Never print, echo, log, expose, or commit the API key.
- Never paste the API key into prompts.
- Production should use a backend proxy instead of shipping API keys in the iOS app.

Do not touch or inspect secrets unless explicitly asked.

---

## Architecture Rules

Keep architecture clean and modular.

Important layers:

- Models
- Services
- ViewModels
- Views
- Theme
- Tests
- Configuration

Important files/concepts:

- `GraphHopperClient.swift`
- `RoutePromptParser.swift`
- `AdventureModels.swift`
- `AppModels.swift`
- `RouteDetailView.swift`
- `RouteComponents.swift`
- `PlannerViewModelTests.swift`
- `RoutePromptParserTests.swift`
- `GraphHopperClientTests.swift`
- `TrailRoute`
- `RoutePlanningRequest`
- `RoutePlanningMetadata`
- `DesiredFeature`
- `AvoidFeature`
- `ActivityType`
- `RouteType`
- `RouteDifficulty`
- `Coordinate`
- `Waypoint`
- `SafetyNote`

GraphHopper request logic should stay centralized.

The local parser and routing services should stay replaceable so future OpenAI/backend planning can be added without rewriting the app.

---

## What Not To Add Unless Explicitly Asked

Do not add these unless the current task explicitly asks for them:

- OpenAI
- backend
- Supabase
- accounts/auth
- cross-device sync
- weather layer
- water points
- shelter/campsite intelligence
- public transport integration
- trail closures
- offline maps
- turn-by-turn navigation
- route recording
- Apple Watch
- voice mode
- full chat
- POI search
- fake scenic scoring
- social/community features
- analytics/crash reporting
- monetization/payment
- App Store screenshots/assets
- major redesign

Current focus:

> Real route generation quality, route comparison, and trustworthy route UX.

---

## Future AI Architecture

Future free-form AI planning should be implemented through a backend.

Do not put OpenAI keys in the iOS app.

Future architecture:

1. iOS app sends user prompt to backend.
2. Backend uses OpenAI Structured Outputs.
3. Backend returns validated AdventureIntent JSON.
4. Routing engine calculates geometry.
5. App displays route suggestions.

The AI should output structured intent, not route geometry.

Example future AdventureIntent fields:

- activityType
- regionQuery
- startLocationQuery
- endLocationQuery
- routeType
- durationDays
- targetDistanceKm
- targetDistancePerDayKm
- targetDurationMinutes
- maxElevationGainM
- difficulty
- interests
- avoid
- needs
- preferredSurface
- safetySensitivity
- transportMode
- overnightNeeds
- routeConstraints

---

## Roadmap

### Phase 1 — Current MVP foundation

Goal:
Natural-language-ish local prompts generate real routes.

Implemented or mostly implemented:

- SwiftUI iOS app
- premium UI
- GraphHopper point-to-point routing
- GraphHopper loop routing
- parser-based intent extraction
- activity-aware routing
- distance-aware alternatives
- loop suggestions
- MapKit route rendering
- local key config
- tests

### Phase 2 — Better route comparison

Goal:
Users understand and compare route options.

Next features:

- map thumbnails in suggestion cards
- route quality summary
- route comparison chips
- better labels based on real stats
- surface/path details if available

### Phase 3 — Better route shaping

Goal:
Routes align more closely with user intent.

Features:

- better GraphHopper custom models
- avoid roads where possible
- prefer trails/paths
- biking-specific preferences
- trail-running-specific preferences
- duration-aware variants
- difficulty-aware filtering
- elevation constraints

### Phase 4 — Outdoor intelligence

Goal:
Routes become trustworthy plans, not just geometry.

Features:

- verified POI lookup
- viewpoints
- water points
- shelters
- public transport
- campsites/legal sleep options
- weather
- trail closures
- daylight timing
- risk flags

Only claim features if verified.

### Phase 5 — Persistence and accounts

Goal:
Users can save and reuse routes.

Features:

- SwiftData saved routes
- route history
- favorites
- local preferences
- later Supabase auth
- cross-device sync

### Phase 6 — Navigation foundation

Goal:
TrailMind becomes useful during the activity.

Features:

- live GPS
- route progress
- off-route detection
- rerouting
- route recording
- battery-efficient background tracking
- GPX export/import
- offline maps later

### Phase 7 — True AI copilot

Goal:
Users can freely chat/voice-plan and modify routes.

Features:

- backend AI planning
- structured outputs
- voice input
- route editing by instruction
- “make shorter”
- “less elevation”
- “more forest”
- “add water stop”
- “split into 2 days”
- “we are tired, find exit”
- “only 2 hours left, shorten route”

---

## Best Next Task

The best next task is:

> Add lightweight route thumbnails / mini route previews to route suggestion cards.

Goal:
When multiple loop variants are shown, the user should visually compare route shapes before opening route detail.

Why:
Loop route suggestions are much easier to understand visually. Users need to see whether the loop goes north/south, stays close to town, enters forest, or has a wider shape.

Implementation direction:

- create `RouteThumbnailView(route: TrailRoute)`
- use `MKMapSnapshotter` if stable
- otherwise use SwiftUI Canvas/Shape fallback
- cache generated thumbnails
- show route line
- show start/end marker where useful
- fallback to abstract route placeholder
- keep cards premium and uncluttered

Do not use full interactive Maps inside every card unless performance is clearly smooth.

---

## Coding Agent Rules

When working on this repo:

1. Read this file before making changes.
2. Always use the relevant `build-ios-apps` skill before doing iOS app work, especially build/run/test/debug tasks.
3. Keep the scope narrow.
4. Do not redesign the UI unless explicitly asked.
5. Preserve the premium Apple-like style.
6. Do not add unrelated features.
7. Do not break point-to-point routing.
8. Do not break loop routing.
9. Do not break mock fallback.
10. Do not expose or commit secrets.
11. Do not fake route claims.
12. Use real route stats only.
13. Keep error handling graceful.
14. Keep GraphHopper logic centralized.
15. Keep models typed and explicit.
16. Add or update tests for parser, routing, and model behavior.
17. Run build/tests after changes where possible.
18. Summarize what changed, files changed, how to test, and what should come next.

---

## Definition of Done for Any Sprint

A task is not done until:

- the app builds
- existing flows still work
- errors are handled gracefully
- no secrets are exposed
- no fake outdoor claims are added
- UI remains clean and premium
- tests are added/updated when relevant
- the change is summarized clearly
