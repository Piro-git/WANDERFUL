# TrailMind Product and UX Gap Audit

Audit date: 2026-07-15

Scope: the complete primary journey from first launch through planning, comparison, detail, action and return. Static SwiftUI/code evidence is supplemented by the companion runtime report, which observed a crash-free cold launch, first onboarding page and returning-user Home. The rest of the rendered journey, accessibility tree, animation, performance and touch ergonomics remain **CANNOT_VERIFY**.

## Product verdict

TrailMind’s real core is credible: a typed/voice prompt can be parsed, geocoded and routed against real GraphHopper geometry; loop options can be ranked; cards have lightweight route-shape thumbnails; detail renders a real MapKit polyline and verified route facts; routes can be saved locally. The visual foundation is coherent and premium.

The current app shell, however, mixes that real product with production-reachable mocks, developer demos, unsupported promises and dead-end actions. This creates a more serious issue than ordinary unfinished UX: a user cannot reliably tell whether a route/stat/feature is real. The first beta should be smaller and fully truthful rather than exposing every current tab and CTA.

## Main journey trace

| Journey step | What exists | What the user reasonably infers | Gap / consequence | Gate |
|---|---|---|---|---|
| 1. Understand the product | Three-page onboarding and persisted completion state | TrailMind will balance highlights/stops and provide conditions, water and exposure context | Those data layers are not implemented or verified. The opening contract overstates the product (`TrailMind/Views/Onboarding/OnboardingView.swift:19-31`). | Beta/Public blocker |
| 2. Create a route request | Strong Home hero, text/voice composer, example chips, “Near you,” and “Continue outside” | Every visible entry path plans or resumes a real route | Example chips use the mock planner; “Recent plans” is a hard-coded mock route; “Near you” has no active location integration (`TrailMind/Views/Home/HomeView.swift:74-79`, `:117-131`, `:168`). | Beta/Public blocker |
| 3. Resolve missing information | Local parser/validator extracts start, end, loop, activity, distance, duration and requested preferences | Ambiguity will become a conversational clarification | Validation clarification is converted into a failure state; “Edit request” returns to Home rather than asking the specific missing question in place (`TrailMind/ViewModels/AppModels.swift:218-223`, `:439`). | Beta usability blocker |
| 4. Wait for route generation | Polished staged loading, cancel, retry, parser/geocoder/router deadlines | The visible stages reflect actual work | Real typed/voice requests do. Mock example requests use simulated sleeps and fabricated suggestions, while loading copy can still feel operational. | Remove production mock path |
| 5. Compare alternatives | Up to three cards with shape thumbnail, distance, climb, duration, difficulty, mapped facts and variant labels | Ranking, badges and “match” values are data-grounded | Loop labels are useful, but non-variant cards can show ordinal `96/92/88% match` values rather than a measured score (`TrailMind/Services/RoutingFoundation.swift:1072-1079`; `TrailMind/Views/Route/RouteComponents.swift:115-117`). There is no direct side-by-side comparison. | Truth blocker for `% match`; comparison improvement for beta |
| 6. Understand why a route fits | Variant label, explanation text, requested-preference chips and verified fact chips | Each recommendation is grounded in measured fit | Real distance/route type and mapped facts can ground the explanation, but arbitrary match percentages, requested-as-factual difficulty and unverified desired features weaken it. | Trust blocker |
| 7. Inspect route details | Real route map, stats, verified characteristics, planned-preference chips, safety notes, save/export/edit/start actions | Every shown metric is real and every primary action is usable | Most real-route stats are strong; location is hard-coded to Germany and start/end overlap on loops. Edit and Start are not real. | Beta/Public blocker unless corrected/removed |
| 8. Save, share or start | Local Save, attempted GPX export, fake AI edit and placeholder Start CTA | TrailMind can preserve, hand off or guide the route | Save is real. GPX shares text/empty fallback rather than a named file. No route-following/navigation exists. | Define launch boundary; keep only real actions |
| 9. Recover from failure | Cancel, retry and edit actions; parser/geocoder/router timeouts and user-facing errors | Recovery will preserve intent and continue the same task | Error handling is generally good, but clarification is misclassified as failure and Edit returns to Home rather than restoring an in-context editor. | Beta usability blocker |
| 10. Return to previous routes | Saved tab persists local routes and supports removal | Home recents and Profile reflect actual usage/preferences | Saved is real; Home recents are fake; there is no history/resume feed; Profile preferences are memory-only and unused by routing. | Beta cleanup / retention gap |

## Product-level determinations

| Question from the brief | Determination |
|---|---|
| Where does the experience end prematurely? | On clarification, GPX handoff, fake AI edit and placeholder Start route. |
| Where may users become confused? | At every boundary between real dynamic routing and mock examples/history/Explore/editing; also between requested preferences and verified facts. |
| Is developer terminology visible? | Yes: “LIVE ROUTING DEMO,” “Temporary developer path,” provider-centric highlights and “Navigation foundation ready.” |
| Does AI feel valuable or decorative? | Current Release value comes from the local natural-language parser. The branded AI edit is decorative and misleading because it does not reroute. Remote AI parsing is Debug-only by default. |
| Are alternatives meaningfully different? | Deterministic duplicate/reversed-segment/self-overlap cases passed, and geometry signatures plus target-aware ranking are a strong foundation. Pairwise shared geometry between suggestions is not measured and live provider fixtures did not run, so actual outdoor-route differentiation remains **CANNOT_VERIFY**; the UI also lacks measured overlap/delta explanation. |
| Are explanations trustworthy? | Mapped characteristics and measured route stats can be trustworthy. Requested difficulty overriding computed difficulty and arbitrary match percentages are not. |
| Does the app behave like a demo? | Yes, as a whole, because real core flows coexist with a main developer Explore tab, fake recent history and mock AI editing. |
| Is visual hierarchy consistent? | Largely yes: theme, spacing, cards and stat layout are coherent. Developer/placeholder surfaces break the product tone. |
| Does it follow native iOS interaction patterns? | Mostly: SwiftUI NavigationStack/Tab, MapKit, ShareLink and system permissions are used. Clarification-as-error, dead primary buttons and forced light appearance are notable departures from a polished native flow. |
| Are permissions requested at the correct time? | Microphone/speech are requested from the voice action, which is appropriate. Current location is not wired; do not request it until “Near you” or another current feature genuinely needs it. |
| Do important screens contain placeholders? | Yes: Explore, Home recent plan, AI edit, Start route and Profile “Coming next.” |
| Is there a complete repeated-use loop? | Partly. Save/reopen/delete works, but real Home recents/history, applied persisted preferences and “plan another like this” are missing. |

## What already works well

- The Home composer is an appropriate emotional center: concise, spacious and voice/text capable.
- Voice permission is requested from the user action, and denial/interruption/timeout states have recovery.
- The real planner separates parse, geocode and route stages, with cancellation, retry, edit and bounded waits.
- Loop generation and alternative routing retain real geometry and real provider stats.
- Suggestion cards use a lightweight normalized-path thumbnail rather than embedding multiple interactive maps, which is the right SwiftUI/MapKit performance tradeoff.
- The detail screen uses an interactive MapKit map only where it adds value.
- Requested features and mapped/verified characteristics are generally separated in route detail.
- Generic outdoor safety language appropriately asks the user to review weather, closures, local rules and trail conditions.
- Saved routes are real local persistence, not seeded placeholders, and corrupt-record handling is surfaced.
- The theme is coherent: forest/moss/sand palette, rounded cards, restrained hierarchy and SF Symbols.

## Core-value gaps

These gaps directly prevent the product sentence “Tell TrailMind what kind of adventure you want. TrailMind builds the route” from being consistently true.

| Priority | Gap | Evidence | Recommended smallest truthful release |
|---|---|---|---|
| P0 | Prominent Home examples invoke mock suggestions | `HomeView` calls `onPlan`; `TrailMindApp` maps that to `startPlanning`; `startPlanning` selects `.mockSuggestions` (`TrailMind/ViewModels/AppModels.swift:125-127`). | Route every example through `startTextRoute`, or remove examples the parser/router cannot support. |
| P0 | Main Explore tab is a developer/demo surface with mock cards | “LIVE ROUTING DEMO,” “Temporary developer path,” hard-coded Harz button and `MockRoutes.all` are visible (`TrailMind/App/TrailMindApp.swift:96`, `:117-140`). | Remove the tab for beta or replace it with real persisted/generated route discovery; do not ship the developer copy. |
| P0 | “Edit with AI” does not reroute | Default `MockAIPlannerService` changes title/stats/summary while preserving path (`TrailMind/Services/TrailServices.swift:90-106`, `:200-230`). | Remove the CTA until edits create new real geometry and recomputed facts. A later v1 may support “shorter / less elevation” first. |
| P0 | The central “Start route” action is a placeholder | It only opens a “Navigation foundation ready” alert (`TrailMind/Views/Route/RouteDetailView.swift:64-68`, `:331-345`). | Remove or rename to a real action such as a supported MapKit handoff. Do not imply in-app navigation. |
| P1 | Release does not use the remote AI intent endpoint | `IntentParsingProviderFactory` returns `LocalIntentParsingProvider` outside Debug (`TrailMind/Services/IntentParsingFoundation.swift:600-613`). | Market Release as natural-language/local parser planning, or explicitly design and safely enable backend AI before claiming AI understanding. |
| P1 | Quick examples promise unsupported trip types/POI intelligence | Examples include two-day lodging, waterfalls, views and sunset (`TrailMind/Views/Home/HomeView.swift:75-78`, `:237-244`). | Use only supported examples: point-to-point and same-day loop, activity, distance/duration, requested preferences labelled as preferences. |
| P1 | Profile preferences do not affect routes | References to `appModel.preferences` occur only in Profile. | Remove nonfunctional controls or persist and feed a narrow supported subset into the planning request. |
| P1 | Route instructions are produced but not usable | GraphHopper instructions are decoded and saved, but no View renders them. | Either expose a compact route-step preview or omit “German directions” as a highlight until users can access them. |
| P1 | GPX export is not a true interoperability flow | `ShareLink` receives a string and silently falls back to empty (`RouteDetailView.swift:301-305`). | Share a named `.gpx` file, show errors, and test import into common route apps. |
| P1 | Alternative differentiation is not fully measured | The coordinator checks each loop’s self-overlap and uses a sampled geometry signature for duplicates, but does not calculate pairwise shared geometry between suggestions (`TrailMind/Services/RoutingFoundation.swift:860-872`, `:1072-1110`). | Add pairwise overlap/route-diversity thresholds and explain a measured direction/shape/distance difference; return fewer options rather than near-duplicates. |
| P2 | Comparison is card-by-card only | Cards are strong but users must remember values/shapes while scrolling. | Add a compact pinned comparison row or selected-two comparison only after truth blockers are closed. |

## Trust gaps

For TrailMind, trust is part of the core value, not a secondary polish category.

| Priority | Gap | Why it matters | Required correction |
|---|---|---|---|
| P0 | Requested difficulty overrides computed route difficulty (`GraphHopperClient.swift:1082-1083`) | A difficult returned route can be labelled Easy because the user asked for easy. | Always compute the factual badge from returned stats/data. Show “Requested: easy” separately and flag a mismatch. |
| P0 | Mock edit invents distance, elevation, duration and scenic/water language without new geometry | It can encourage decisions based on data that does not describe the map line. | Delete/non-Release gate the feature until a real routing engine verifies the new route. |
| P0 | Arbitrary percentage match scores | Values are generated from suggestion order (`max(96 - index * 4, 84)`), not a documented metric. | Remove percentages. Use factual labels such as “Closest distance,” “Lower climb,” or an explicit measured delta. |
| P0 | Fake “Recent plans” is presented as user history | It implies the app remembers a route the user did not create. | Drive the section from Saved/history data or use a clearly labelled example section. |
| P0 | Saved/exported routes have no required provenance | Any `TrailRoute`, including fixture or mock-edited data, can be saved/exported; legacy records remain indistinguishable after UI cleanup. | Introduce a non-optional route-source/verification invariant, block Release persistence/export of fixtures, and migrate or quarantine unverifiable saved records. |
| P1 | Onboarding promises water, exposure, conditions, practical stops and highlights | The product has no verified layers for those claims. | Rewrite onboarding around real route geometry, comparison, saved plans and review-before-starting. |
| P1 | Every real route location is hard-coded to “Germany” (`GraphHopperClient.swift:1093`) | Apple geocoding and GraphHopper are not constrained to Germany; a valid route elsewhere is mislabeled. | Derive locality from geocoding or omit the location label when it is not known. |
| P1 | “Near you” has no current-location behavior | The label suggests personalization and possibly location use that does not occur. | Hide it until wired, or relabel the content as examples. Do not request location for a placeholder. |
| P1 | Route preferences and actual shaping are not consistently explained | Some desired features are chips, but users cannot tell which preferences changed routing versus were merely remembered. | For each route, explain only measurable fit: distance delta, duration delta, route type, activity profile, elevation and mapped path facts. |
| P1 | Active-safety boundary is ambiguous | A prominent Start button suggests the app can support the user during the activity. | State the exact launch boundary: planning aid only, no live navigation/off-route/closure/weather guarantee. |
| P2 | Loop start/end markers can overlap | Identical loop coordinates visually look like duplicate markers. | Use a single start/finish marker for loops. |

## Usability gaps

| Priority | Gap | User friction | Recommended pattern |
|---|---|---|---|
| P0 | Clarification is treated as an error | A normal ambiguous prompt looks like failure; user loses conversational momentum. | Present the exact clarification question in the composer/sheet, preserve the prompt, and resume the same request after the answer. |
| P1 | “Edit request” returns to Home rather than reopening the editor in context | Recovery requires rediscovering the composer and creates uncertainty about retained text. | Reopen the composer with the original prompt focused and the validation question visible. |
| P1 | Entry paths behave differently | Typing/voice can be real while chips are mock; users cannot predict the outcome. | One planning coordinator and one truth contract for every entry point. |
| P1 | Unsupported preferences are accepted too freely | A request for waterfall, water, sunset or lodging may appear understood even when only kept as requested metadata. | Ask a concise clarification or show “Preference requested; not verified” before generation. |
| P1 | No actionable route handoff | Users can inspect a route but not confidently take it to the trail. | For v1, deliver reliable file/share handoff and a clear review checklist; navigation can remain deferred. |
| P1 | Profile settings look functional but reset and are ignored | Toggling preferences creates false expectation and wasted effort. | Keep only settings that persist and change behavior. Move future items to release notes/roadmap, not production controls. |
| P2 | No fast route comparison mode | Three strong cards still require serial scanning. | Add distance-to-target, climb and duration deltas in the same position across cards; later allow two-route compare. |
| P2 | No route-step or waypoint summary | Route detail has underlying instructions but only start/finish waypoints for real routes. | Add a compact “Route overview” without pretending it is turn-by-turn navigation. |
| P2 | Saved has no search/sort/filter | Acceptable for a small beta, weak once history grows. | Defer until real users accumulate enough routes to justify it. |

Positive usability evidence to preserve: staged async state is explicit; cancellation/retry exists; route cards share consistent stat positions; details separate preferences from verified facts; Saved reports skipped/corrupt records rather than crashing.

## Visual consistency gaps

| Priority | Gap | Evidence / risk | Recommendation |
|---|---|---|---|
| P1 | App is forced to light mode | `.preferredColorScheme(.light)` at `TrailMind/App/TrailMindApp.swift:21`; users in dark environments cannot follow system appearance. | Support system light/dark before public launch, or document and validate a deliberate accessibility exception. |
| P1 | Large fixed custom fonts need Dynamic Type validation | `trailHero` is a fixed 42-point system font (`TrailMind/Theme/TrailTheme.swift:29-33`). Fixed card/map heights also appear throughout. | Adopt scalable text styles/relative metrics and test all accessibility sizes for clipping and navigation. |
| P1 | No localization infrastructure | No string catalog/localization files were found, while UI and routing directions mix English/German assumptions. | Decide launch locales. For Germany-first public launch, localize user-facing UI and test long German strings; otherwise limit storefront/metadata claims. |
| P1 | Developer language is visible | “LIVE ROUTING DEMO,” provider names and “foundation ready” make the app look unfinished. | Remove implementation language from user surfaces; keep provider attribution in an appropriate legal/data-source context. |
| P2 | Thumbnail shows shape but no geographic context | The Canvas thumbnail is performant, but it cannot show north/south, town proximity or forest context—the reason users wanted mini maps. | After core fixes, cache `MKMapSnapshotter` thumbnails with the route overlay and a graceful abstract fallback. Preserve list performance. |
| P2 | Empty/irrelevant sections may still occupy detail | Real routes have sparse highlights/waypoints/days; generic technical highlights can dominate. | Render only meaningful sections and prioritize fit explanation, mapped facts and safety review. |
| P2 | Accessibility coverage is partial and untested | Some identifiers/labels exist, but there is no UI test target and the runtime accessibility tree was not inspected. | Add VoiceOver labels/values for route shape, stats, chips and maps; test Reduce Motion, Increase Contrast, Button Shapes and landscape/iPad layouts. |
| P2 | App targets iOS 26 only | `IPHONEOS_DEPLOYMENT_TARGET = 26.0`; this sharply narrows device reach and makes compatibility a business decision. | Validate intended audience/device data and explicitly accept the reach tradeoff, or lower the target with fallback verification. |

## Retention gaps

| Priority | Gap | Impact | Smallest viable improvement |
|---|---|---|---|
| P0 | Home recents are fake | Damages trust on every return visit. | Replace with latest real Saved routes or remove the section. |
| P1 | No planning history | Unsaved successful plans disappear from the return journey. | Add a small local recent-plans list only after privacy/retention decisions; make deletion obvious. |
| P1 | Profile preferences reset and do not affect planning | Users receive no compounding personalization benefit. | Persist only supported preferences locally and show when each is applied. |
| P1 | No “plan another like this” truthful loop | The fake AI edit attempts this job but cannot deliver it. | Add a prefilled composer action that starts a new real plan using explicit current-route facts. |
| P2 | Saved routes lack organization | Repeat users will eventually face an unstructured list. | Defer folders/tags/search until usage data demonstrates need. |
| P2 | No lightweight quality feedback | Team cannot learn whether a route fit the intent. | For closed beta, use an explicit manual feedback channel that never logs prompt/coordinates automatically; add analytics only with a deliberate privacy design. |

## Nice-to-have improvements

The following may improve the product later but should not delay a truthful planning beta unless the launch promise explicitly includes them:

- in-app turn-by-turn navigation, live GPS, route progress and off-route detection;
- offline maps and offline-ready route guarantees;
- verified weather, closures, daylight, water, viewpoints, shelters, camping/legal access or public transport;
- accounts, cloud sync and cross-device history;
- genuine AI route editing beyond a narrow real-routing-backed “shorter / less climb” first version;
- elevation-aware interactive comparison, advanced custom models and surface filters;
- Apple Watch, route recording, social/community, subscriptions and gamification;
- rich Explore discovery, editorial content and POI search.

Do not expose disabled controls or “coming next” rows for these in the public app. A smaller surface with no dead ends will feel more premium.

## Recommended beta information architecture

A useful closed beta can be only three truthful surfaces:

1. **Plan** — text/voice composer, supported examples, clarification, generation and recovery.
2. **Saved** — real locally saved routes and delete controls.
3. **Profile / About** — only functional settings, privacy, data sources, safety boundary and feedback contact.

Explore can return when it has a real purpose. On route detail, keep **Save** and a genuine **Export/Share GPX** action. Remove **Edit with AI** and **Start route** until they perform what their labels promise.

## UX exit criteria by gate

### Closed beta

- Every visible route is real or unmistakably a non-actionable demo fixture; no production-reachable mock planner/edit output.
- Every entry point uses the same real planning coordinator.
- Requested difficulty/features are visibly distinct from returned facts; arbitrary percentage matches are gone.
- Ambiguity is handled as clarification, not failure.
- Onboarding, examples, Home sections, Profile and CTAs describe only current behavior.
- A user can plan, compare, inspect, save, reopen and export a real route without encountering a dead action.
- Safety boundary and unverified-preference wording remain visible but calm.
- VoiceOver and largest Dynamic Type manual pass succeeds on the supported device matrix.

### Public App Store

- System appearance/localization/device support decisions are explicit and tested.
- Privacy, data-source attribution and local-data deletion are accessible from the app.
- No developer/demo/placeholder copy, fake history, “coming next” controls or dormant feature claims remain.
- App Store description/screenshots demonstrate the exact reviewed journey, including its planning-aid boundary.
- Route performance is profiled with long geometry, three thumbnails, repeated saves and poor network conditions.
