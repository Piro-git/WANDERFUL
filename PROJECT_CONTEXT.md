# TrailMind / EasyWander — Complete Project Context

## 1. High-level product vision

TrailMind is an iOS-first AI-native outdoor route planning app.

The app is not a Komoot clone. It is a new type of outdoor planning experience where the user describes what kind of outdoor adventure they want, and the app turns that intent into real route options with map geometry, distance, duration, elevation, route type, activity type, and planning metadata.

Core product sentence:

“Tell the app what kind of adventure you want. TrailMind builds the route.”

The long-term vision is to become a one-app solution for outdoor adventure planning and navigation. The user should not have to plan with ChatGPT, manually copy waypoints into Komoot, check maps elsewhere, and then switch between apps. TrailMind should combine natural-language planning, route generation, route comparison, map preview, and eventually GPS navigation in one clean mobile experience.

The product started from a real user pain:
A hiking trip in the Harz was planned mainly with ChatGPT, but the actual route had to be manually rebuilt in Komoot. That manual transfer step is annoying. TrailMind exists to remove that friction.

## 2. What TrailMind is

TrailMind is:

* an AI-first outdoor planning app
* an iOS-first SwiftUI app
* a natural-language route planner
* a route generator using real routing engines
* a clean Apple-like outdoor companion
* a future navigation app
* a premium alternative to manual route planning workflows

TrailMind is not:

* a Komoot clone
* a generic chatbot
* a generic map app
* a random AI route generator
* a fake “scenic” recommender without data
* a full turn-by-turn navigation app yet
* a social network yet
* a POI/weather/offline-map product yet

The core principle is:

AI or local parsing may understand the user’s intent, but a real routing engine must calculate the actual route geometry.

The app must never invent route geometry. It must not fake distances, elevation, water availability, trail quality, legal camping, or scenic features.

## 3. Product positioning

TrailMind should feel like:

* Apple Maps
* Apple Fitness
* Komoot-level outdoor clarity
* a modern 2026 Apple-native app
* a calm, premium outdoor companion
* an intelligent route copilot

It should not feel like:

* a cheap chatbot wrapper
* a generic form-based planner
* a cluttered GIS/map tool
* a hackathon demo
* a Komoot copy

Suggested positioning:

“Describe your perfect outdoor route. TrailMind turns it into a real map.”

or:

“Plan outdoor adventures by voice or text — then start the route.”

or:

“Say where you want to go. TrailMind builds your hike, ride, or trail run.”

## 4. Target users

Initial target users:

* iPhone users
* hikers
* trail runners
* casual outdoor people
* weekend adventurers
* people who like Komoot but want easier planning
* people who plan with ChatGPT but then manually transfer to route apps
* users in Germany first, especially Harz / Lüneburg / outdoor weekend regions

Initial activity focus:

* hiking
* trail running
* biking

The first geographic test areas are:

* Harz
* Ilsenburg
* Schierke
* Brocken
* Lüneburg
* Amelinghausen

## 5. Core user problem

Current outdoor planning is fragmented:

1. User has an idea.
2. User talks to ChatGPT or searches online.
3. User checks Komoot/AllTrails/maps manually.
4. User adds waypoints manually.
5. User tries to match distance/elevation.
6. User compares routes poorly.
7. User exports/imports or switches apps.
8. User starts navigation elsewhere.

TrailMind should collapse this into one flow:

1. User says or types the desired adventure.
2. App understands the route intent.
3. App geocodes start/end or loop location.
4. App requests real route geometry from GraphHopper.
5. App displays route options.
6. User compares routes visually.
7. User opens route detail.
8. User can save/export/start route later.

## 6. Current product status

TrailMind already has a working SwiftUI app foundation.

The app currently supports:

* polished iOS SwiftUI UI
* premium Apple-like design
* Home screen with text/voice-oriented route planning flow
* Explore/demo flow
* RouteSuggestionsView
* RouteDetailView
* MapKit route rendering
* mock fallback routes
* GraphHopper API integration
* local API key configuration
* parser-based route intent extraction
* point-to-point routing
* activity-aware routing
* distance-aware alternative routing
* loop / round-trip route generation
* multiple loop suggestions from seed variants
* route metadata display
* testing with XCTest

The app has been verified multiple times with successful builds and simulator launches.

Current app name placeholder:

TrailMind

Current repository/folder context:

EasyWander / TrailMind

## 7. Tech stack

Primary platform:

* iOS first

Primary language/framework:

* Swift
* SwiftUI

Maps:

* MapKit
* MapPolyline rendering in RouteDetailView
* MapKit preview/thumbnail components planned

Location/geocoding:

* CoreLocation
* CLGeocoder for converting user text locations into coordinates

Routing:

* GraphHopper Routing API

State / models:

* Swift models
* ViewModels
* local app state
* SwiftData planned later for persistent saved routes

AI:

* No OpenAI integration yet
* No backend yet
* Current intent understanding is local parser-based
* Future AI should run through backend, not directly from iOS app

API key handling:

* GraphHopper API key is stored locally in:
  Configuration/Local.xcconfig
* Local.xcconfig is gitignored and untracked
* API key must never be printed, logged, committed, or pasted into prompts
* Production should use a backend proxy instead of shipping the GraphHopper key inside the iOS app

## 8. Current GraphHopper integration

GraphHopper routing is implemented and tested.

GraphHopper client supports:

* POST /route
* query-key authentication
* `profile: foot` for hiking/trail running
* `profile: bike` for biking
* `elevation: true`
* `points_encoded: false`
* `instructions: true`
* `locale: de`
* path details foundation
* distance decoding
* duration decoding
* ascent/descent decoding
* 3D coordinate decoding
* instruction decoding
* MapKit polyline rendering
* error handling for missing key, invalid response, network failure, and GraphHopper hints/messages

Important GraphHopper coordinate rule:

GraphHopper POST route points use `[longitude, latitude]` order.

Internal app Coordinate model should use normal app-friendly naming:

* latitude
* longitude
* optional elevation

## 9. Current route flows

### 9.1 Point-to-point route flow

Example prompts:

* `Ilsenburg nach Schierke`
* `von Ilsenburg nach Brocken`
* `Wanderung von Lüneburg nach Amelinghausen`
* `Plan a hike from Ilsenburg to Schierke`
* `Start: Ilsenburg, Ziel: Brocken`
* `Ilsenburg → Schierke`
* `Ich möchte nach Schierke von Ilsenburg`

Flow:

1. User types prompt.
2. RoutePromptParser extracts start and end.
3. Parser extracts activity if present.
4. CLGeocoder geocodes start.
5. CLGeocoder geocodes end.
6. GraphHopper calculates route.
7. App converts GraphHopper response into TrailRoute.
8. RouteDetailView shows route with real polyline, distance, duration, elevation, and planning metadata.

### 9.2 Activity-aware routing

Parser detects:

* hiking
* biking
* trail running

Mapping:

* hiking → GraphHopper profile `foot`
* trailRunning → GraphHopper profile `foot`
* biking → GraphHopper profile `bike`

Titles reflect activity:

* `Hike from Ilsenburg to Schierke`
* `Bike route from Lüneburg to Amelinghausen`
* `Trail run from Ilsenburg to Schierke`

### 9.3 Intent-aware route metadata

Parser extracts:

* start location
* end location
* route type
* activity type
* distance hint
* duration hint
* difficulty hint
* desired features
* avoid features

Desired features include:

* viewpoint / Aussicht
* forest / Wald
* water / Wasser
* quiet / ruhig
* sunset

Important principle:

Desired features are shown as requested preferences, not verified facts.

The app may show:

“Requested: views, forest, quiet paths”

But it must not claim:

“This route definitely has views, forest, and water.”

unless those claims are verified through real route/path/POI data.

### 9.4 Distance-aware alternatives

If the prompt includes a target distance, TrailMind can request GraphHopper alternative routes.

It uses:

* `algorithm: alternative_route`
* `alternative_route.max_paths`
* `alternative_route.max_weight_factor`
* `alternative_route.max_share_factor`
* `ch.disable: true`

The app selects the route closest to the requested target distance.

If GraphHopper rejects flexible routing or alternative route configuration, the app safely retries the normal route request.

No fake geometry is created.

No random detours are added.

### 9.5 Loop / round-trip route flow

TrailMind supports loop prompts.

Example prompts:

* `15 km Rundwanderung um Ilsenburg`
* `Rundtour bei Schierke ca. 12 km`
* `10 km loop around Lüneburg`
* `Trailrun loop from Ilsenburg for 2 hours`
* `Mach mir eine schöne Rundwanderung ab Ilsenburg mit Aussicht, ca. 15 km`

Parser extracts:

* routeType: loop
* startLocationQuery
* targetDistanceKm
* targetDurationMinutes if present
* activityType
* desiredFeatures

Default loop distances:

* hiking: 10 km
* trail running: 8 km
* biking: 25 km

GraphHopper round_trip request uses:

* one start point only
* `algorithm: round_trip`
* `round_trip.distance`
* `round_trip.seed`
* `ch.disable: true`
* `elevation: true`
* `points_encoded: false`
* `instructions: true`
* `locale: de`

Seeds currently used:

* 11
* 29
* 47

TrailMind now preserves multiple valid loop variants.

If multiple seed variants return successfully, the app shows RouteSuggestionsView.

If only one valid loop variant returns, it may open RouteDetailView directly.

Failed seeds are ignored as long as at least one seed succeeds.

If all seeds fail, the existing safe fallback/error behavior is used.

### 9.6 Loop suggestion ranking

Loop variants are ranked by:

1. absolute distance difference from target distance
2. lower elevation gain
3. shorter duration

Labels are generated from real stats only.

Possible labels:

* Closest Match
* Shorter Loop
* Longer Loop
* More Elevation
* Easier Option

Important:

Do not label a route “scenic” unless scenic quality is verified by real data.

## 10. UI/UX design direction

The app should be premium, simple, calm, and Apple-native.

Design words:

* clean
* minimal
* outdoor
* tactile
* premium
* Apple-like
* modern 2026
* calm
* intuitive
* spacious
* trustworthy

Color direction:

* deep forest green
* moss
* warm sand
* graphite
* white/off-white
* natural outdoor tones

UI principles:

* large rounded cards
* subtle shadows
* soft gradients only when tasteful
* SF Symbols where appropriate
* no clutter
* strong spacing
* clean hierarchy
* route cards should feel tactile and premium
* Home screen should feel like an AI outdoor companion, not a generic form
* map previews should be useful but not heavy

Main UI areas:

* HomeView
* RouteSuggestionsView
* RouteDetailView
* Explore
* Saved
* Profile
* AI edit screen planned/foundation exists
* MapPreviewView
* RouteCard / RouteSuggestionCard
* Planned for you section

## 11. Current RouteDetailView behavior

RouteDetailView should display:

* route title
* location/subtitle
* route map with polyline
* distance
* duration
* elevation gain/loss
* activity type
* route type
* difficulty if available
* route label if available
* “Planned for you” section
* target distance/duration if provided
* requested features as preferences
* safety notes
* start/end markers
* loop route indicator if route is loop

The “Planned for you” section may show chips like:

* Hiking
* Trail running
* Biking
* Loop route
* ca. 15 km
* ca. 2 hr
* Views
* Forest
* Quiet route
* Moderate
* Closest Match

Keep this subtle and not cluttered.

## 12. Current RouteSuggestionsView behavior

RouteSuggestionsView is used when multiple route options are available.

For loop prompts, it can now show multiple valid GraphHopper seed variants.

Each route card should show:

* route name
* route label
* distance
* duration
* elevation
* activity
* route type
* metadata chips
* eventually a mini route preview

Current next UI improvement:

Add lightweight route thumbnails or mini route previews to route suggestion cards.

## 13. Planned next feature: route thumbnails

The next recommended implementation step is:

Add small route map thumbnails to RouteSuggestionCard so users can visually compare loop shapes.

Preferred approaches:

Option A:
Use `MKMapSnapshotter` to generate static map images, then draw route polyline on top.

Option B:
Use a lightweight custom SwiftUI Canvas/Shape to normalize route coordinates into card bounds and draw an abstract route shape.

For performance, do not render a full interactive Map inside every card unless it is clearly smooth.

Thumbnail requirements:

* compact map/route preview
* rounded corners
* show route shape if coordinates exist
* show start/end markers when useful
* for loop routes avoid duplicate awkward markers if start/end are very close
* show premium skeleton/placeholder while loading
* fallback to abstract route placeholder if snapshot fails
* cache thumbnails by route id or coordinate hash
* keep performance smooth for 2–3 cards

## 14. Safety and trust principles

Outdoor routing can affect real-world safety. The app must be careful.

The app should include safety copy such as:

* “AI-assisted route. Review before starting.”
* “Check weather, local rules, trail conditions and water availability.”
* “Outdoor conditions can change quickly.”
* “Requested features are preferences, not verified guarantees.”

The app must not claim:

* water availability is guaranteed
* camping is legal
* a route is safe in all conditions
* a trail is open unless verified
* a route is scenic unless verified
* a route has forest/water/viewpoints unless verified by data

Route quality should be explained with actual data:

* close to requested distance
* route type
* activity profile
* elevation
* duration
* surface/path details if available
* road/trail classification if available

Future “Trust Layer” goal:

Explain why a route is recommended based on real route facts, not fake AI confidence.

## 15. Architecture direction

The app should keep a clean architecture.

Important layers:

* Models
* Services
* ViewModels
* Views
* Theme
* Tests
* Configuration

Existing important files include:

* `GraphHopperClient.swift`
* `RoutePromptParser.swift`
* `AdventureModels.swift`
* `AppModels.swift`
* `RouteDetailView.swift`
* `RouteComponents.swift`
* `PlannerViewModelTests.swift`
* `RoutePromptParserTests.swift`
* `GraphHopperClientTests.swift`

Important concepts/models:

* TrailRoute
* RoutePlanningRequest
* RoutePlanningMetadata
* DesiredFeature
* AvoidFeature
* ActivityType
* RouteType
* RouteDifficulty
* Coordinate
* Waypoint
* SafetyNote
* RouteDay / route day breakdown if needed later

The code should remain modular so future OpenAI/backend integration can replace or augment the local parser without rewriting the app.

## 16. Configuration and secrets

GraphHopper key handling:

* Local key is in `Configuration/Local.xcconfig`
* File permissions are owner-only
* File is gitignored
* File is untracked
* Key must never be printed
* Key must never be committed
* Key must never be included in Codex prompts
* Production should use backend proxy

Current local setup works:

* clean build succeeded
* live GraphHopper test succeeded
* route rendered in MapKit
* API key was never displayed or committed

## 17. What is intentionally not implemented yet

Do not add these yet unless explicitly requested:

* OpenAI
* backend
* Supabase
* accounts/auth
* cross-device sync
* weather layer
* water points
* shelter/campsite intelligence
* public transport integration
* trail closures
* offline maps
* turn-by-turn navigation
* route recording
* Apple Watch
* voice mode
* full chat
* POI search
* fake scenic scoring
* social/community features
* App Store assets
* analytics/crash reporting
* monetization/payment

These are later phases.

The current focus is:

Real route generation quality and comparison.

## 18. Future AI architecture

Eventually, TrailMind should support natural free-form prompts like:

“We are four friends, want a 2-day Harz hike, around 25 km per day, waterfalls, forest, views, not too crowded, maybe sleep nearby, and we are coming by train.”

Future architecture should be:

iOS app
→ backend endpoint
→ OpenAI Structured Output
→ validated AdventureIntent JSON
→ routing/POI/weather/safety services
→ route suggestions
→ iOS display

Important:

OpenAI API key should not be stored in the iOS app.

The AI should output structured data, not route geometry.

Example AdventureIntent fields:

* activityType
* regionQuery
* startLocationQuery
* endLocationQuery
* routeType
* durationDays
* targetDistanceKm
* targetDistancePerDayKm
* targetDurationMinutes
* maxElevationGainM
* difficulty
* interests
* avoid
* needs
* preferredSurface
* safetySensitivity
* transportMode
* overnightNeeds
* routeConstraints

Then the routing engine calculates geometry.

## 19. Long-term product roadmap

### Phase 1 — Current MVP foundation

Goal:
Natural-language-ish local prompts generate real routes.

Features:

* SwiftUI iOS app
* premium UI
* GraphHopper point-to-point routing
* GraphHopper loop routing
* intent parser
* activity-aware routing
* distance-aware alternatives
* loop suggestions
* MapKit route rendering
* local key config
* tests

Status:
Mostly implemented.

### Phase 2 — Better route comparison

Goal:
Users can understand and choose between route options.

Features:

* map thumbnails in suggestion cards
* route quality summary
* route comparison chips
* surface/path details if GraphHopper details are available
* elevation/distance/duration comparison
* better labels based on real stats

### Phase 3 — Better route shaping

Goal:
Routes become more aligned with user intent.

Features:

* better use of GraphHopper custom models
* avoid roads where possible
* prefer trails/paths
* biking-specific route preferences
* trail-running-specific preferences
* distance-aware loop variants
* duration-aware variants
* difficulty-aware route filtering
* elevation constraints

### Phase 4 — Outdoor intelligence

Goal:
Routes become trustworthy outdoor plans, not just geometry.

Features:

* POI lookup
* viewpoints
* water points
* shelters
* public transport start/end
* campsites/legal sleep options
* weather
* trail closures
* daylight timing
* risk flags
* “check before you go” layer

Important:
Only claim features if verified by real data.

### Phase 5 — Persistence and accounts

Goal:
Users can save and reuse routes.

Features:

* SwiftData local saved routes
* route history
* favorites
* local preferences
* later Supabase auth
* cross-device sync
* user profile/preferences

### Phase 6 — Navigation foundation

Goal:
TrailMind becomes usable during the activity.

Features:

* live GPS location
* route progress
* off-route detection
* rerouting
* route recording
* battery-efficient background tracking
* maybe Mapbox/MapLibre navigation later
* GPX export/import
* offline maps later

### Phase 7 — True AI copilot

Goal:
Users can freely chat/voice-plan and modify routes.

Features:

* backend AI planning
* structured outputs
* voice input
* route editing by instruction
* “make shorter”
* “less elevation”
* “more forest”
* “add water stop”
* “split into 2 days”
* “we are tired, find exit”
* “only 2 hours left, shorten route”

## 20. MVP success criteria

A strong MVP should let a user do this:

1. Open the app.
2. Type or speak:
   “15 km Rundwanderung um Ilsenburg mit Aussicht”
3. App understands:

   * loop route
   * start: Ilsenburg
   * activity: hiking
   * target: 15 km
   * requested preference: views
4. App geocodes Ilsenburg.
5. App requests GraphHopper round_trip variants.
6. App shows 2–3 real loop route suggestions.
7. User sees map thumbnails and stats.
8. User selects one.
9. RouteDetailView shows real MapKit polyline.
10. User sees distance, duration, elevation, loop route, and requested preference chips.
11. App includes safety/trust copy.
12. User can later save/export/start.

## 21. Current implementation verification history

Reported verification so far:

* GraphHopper key setup completed securely
* Local.xcconfig exists
* file permissions set to 600
* key is present
* file is gitignored and untracked
* Info.plist build-setting placeholder added
* clean build succeeded
* live GraphHopper test succeeded
* example live route: 14.4 km, 662 m ascent, rendered in MapKit
* RoutePromptParser tests passed
* PlannerViewModel tests passed
* GraphHopperClient tests passed
* loop tests passed
* simulator build and launch succeeded
* Home UI visible
* existing iOS 26 CLGeocoder deprecation warning remains
* no API key printed or touched

Most recent reported test status:

* XCTest: 30 passed, 0 failed
* Simulator build + launch succeeded
* only existing CLGeocoder deprecation warning remains

## 22. Development rules for future AI coding agents

When working on this project:

1. Do not redesign the UI unless explicitly asked.
2. Keep the Apple-like premium UI intact.
3. Do not add OpenAI unless explicitly asked.
4. Do not add backend unless explicitly asked.
5. Do not add Supabase/auth unless explicitly asked.
6. Do not add weather/offline/navigation unless explicitly asked.
7. Do not break mock fallback.
8. Do not hardcode or expose API keys.
9. Do not commit Local.xcconfig.
10. Do not fake route claims.
11. Use real route stats only.
12. Keep errors graceful.
13. Add tests for parser/routing/model behavior.
14. Preserve existing point-to-point flow.
15. Preserve existing loop flow.
16. Keep GraphHopper request logic centralized.
17. Keep route planning metadata explicit and typed.
18. Keep code production-quality, not hackathon-quality.
19. Use small focused sprints.
20. After changes, run build/tests and summarize files changed.

## 23. Best next task

The best next task is:

Add lightweight map thumbnails / mini route previews to route suggestion cards.

Goal:
When multiple loop variants are shown, the user should visually compare route shapes before opening the detail page.

Why:
Loop route suggestions are much easier to understand visually. Users need to see if the loop goes north/south, stays close to town, goes into forest, or has a bigger shape.

Implementation direction:

* create `RouteThumbnailView(route: TrailRoute)`
* use `MKMapSnapshotter` if stable
* or use SwiftUI Canvas/Shape as lightweight fallback
* cache generated thumbnails
* show route line
* show start/end marker
* fallback to abstract route placeholder
* keep cards premium and uncluttered

Do not use full interactive Maps inside every card unless performance is clearly fine.

## 24. Example next Codex instruction

Use Goal Mode.

Goal:
Add lightweight route map thumbnails to TrailMind route suggestion cards.

Context:
TrailMind is an iOS-first SwiftUI outdoor route planning app. GraphHopper point-to-point routing, distance-aware alternatives, loop routes, and loop suggestions already work. RouteDetailView already renders real MapKit polylines. The app has a premium Apple-like UI and must not be redesigned.

Task:
Add compact route previews to RouteSuggestionCard so users can visually compare 2–3 route suggestions.

Constraints:
Do not add OpenAI, backend, POI search, weather, offline maps, accounts, Supabase, or navigation. Do not break existing routing flows. Do not expose API keys. Do not fake scenic claims.

Requirements:

* create a reusable `RouteThumbnailView`
* show route shape if coordinates exist
* show start/end marker where useful
* use `MKMapSnapshotter` or a lightweight Canvas route preview
* cache thumbnails
* show premium loading/fallback placeholder
* integrate into existing route cards
* keep UI clean and Apple-like
* add tests for bounds/normalization/cache key where practical
* run build/tests

Acceptance criteria:

* app builds
* existing point-to-point flow works
* existing loop suggestions work
* route cards show thumbnails for routes with coordinates
* fallback works for routes without coordinates
* performance remains smooth
* no unrelated features are added

## 25. Overall project goal

The goal of TrailMind is to become the simplest and most intelligent way to plan outdoor adventures on iPhone.

The app should let the user speak or type naturally, generate real safe route options, compare them visually, understand why each route fits, and eventually navigate directly inside the app.

The key product magic is:

From casual intent:

“Mach mir eine schöne 15 km Rundwanderung um Ilsenburg mit Aussicht.”

To real route options:

* 3 loop variants
* real map geometry
* distance
* duration
* elevation
* activity profile
* requested preference chips
* visual map previews
* safety notes
* route detail
* later save/export/navigation

That is the core of the product.
