# App Store metadata and claim traceability

Status: copy draft; not entered in App Store Connect
Evidence date: 2026-07-17
Scope: iPhone-only portrait beta

Every public field below is conditional. Do not enter this copy until its claim-matrix gate is closed. In particular, omit GPX and voice claims until independent GPX import and physical-device voice proof pass. Position the current build only as a Germany-first English-interface beta until the owner approves its primary locale and territories.

## Metadata draft

### Name

`TrailMind`

Name availability and legal ownership are **unresolved**.

### Subtitle

`Plan real outdoor routes`

### Promotional text

`Describe a same-day hike, trail run, or bike route. Compare mapped options, review measured route details, and save a verified plan.`

### Description

TrailMind is a focused planner for real outdoor routes.

Describe a same-day hike, trail run, or bike route with a start, destination, distance, or time. TrailMind resolves the places you enter and asks GraphHopper to calculate mapped route options.

For each returned route, review measured distance, duration, elevation, route shape, and available mapped characteristics. Compare alternatives, open the route map, and save a verified plan on your iPhone.

TrailMind separates requested preferences from verified route facts. A request for views, forest, quiet paths, or easier terrain is shown as a preference unless the returned map data supports it.

TrailMind is a planning aid, not live navigation. Review every route before starting, and check weather, trail conditions, closures, local rules, and water availability.

Current scope:

- same-day hiking, trail-running, and biking routes;
- point-to-point and loop planning;
- mapped route comparison;
- local saved routes;
Conditional capabilities to add only after their matrix gates close:

- GPX sharing after independent third-party import proof;
- optional voice-to-text input after signed physical-device permission, interruption, and transcription QA.

Not included: turn-by-turn navigation, live position tracking, offline maps, weather or closure intelligence, verified water/POI availability, accounts, or cloud sync.

### Keywords draft

`hiking,trail,route,planner,walking,biking,trail run,outdoor,loop`

Keyword length/availability must be checked in App Store Connect.

### Category

Primary: `Navigation`
Secondary: **[UNRESOLVED]**

### URLs and ownership

| Field | Status |
|---|---|
| Support URL | **Unresolved** |
| Marketing URL | **Unresolved/optional** |
| Privacy Policy URL | **Unresolved and required** |
| Copyright | **Legal entity/year unresolved** |
| Age rating | **Unresolved in App Store Connect** |
| Content rights | **Owner confirmation unresolved** |

## Claims deliberately excluded

Do not use these claims in the subtitle, description, screenshots, preview, release notes, or review notes:

- “AI-powered” or “remote AI” — Release parsing is local rule-based.
- “Navigation,” “turn-by-turn,” “start route,” “live tracking,” or “off-route alerts.”
- “Safe route,” “guaranteed trail access,” or “legal route.”
- verified views, water, forest, quietness, weather, closures, surface, difficulty, or POIs unless each displayed route has supporting mapped data.
- offline maps, accounts, sync, community, favorites across devices, or route history.
- “uses your current location” or “near you.”
- universal iPad, landscape, dark-mode, or localized-interface support.

## Claim-to-evidence matrix

| Public claim | Product source | Automated evidence | External evidence still required | Publish disposition |
|---|---|---|---|---|
| Describe a same-day route in natural language | Local parser, planner flow, truthful onboarding | Parser/planner tests and deterministic UI composer/clarification paths | Supported-language prompt review on signed beta | Allowed, phrased narrowly |
| Hiking, trail running, and biking | Typed activity model and GraphHopper profile mapping | Parser/routing tests | Live provider baseline for each activity | Allowed after live baseline |
| Point-to-point and loop planning | Planner coordinator and routing providers | Deterministic point-to-point/loop tests and UI paths | Protected live route-quality baseline | Allowed after live baseline |
| Real mapped route geometry and measured route stats | Backend GraphHopper gateway, strict response validation, provenance boundary | GraphHopper/backend decoding, invalid-response, and provenance tests | Deployed backend plus live GraphHopper proof | Blocked until live proof |
| Compare mapped options | Route suggestions, measured quality ranking, bounded thumbnails | Route-quality/thumbnail tests and three-option UI scenario | Release-device performance check with live geometry | Allowed after device/live check |
| Save verified routes locally | Verified-only saved-route store | Persistence, recovery, delete, and UI tests | Installed release relaunch/reopen/delete-all check | Allowed after installed-build check |
| Saved routes excluded from device backups | App-store directory resource value | Focused backup-exclusion test | Installed-device inspection | Allowed only after fresh combined test/device check |
| Share a GPX file | Protected named-file exporter and share sheet | Exporter tests and deterministic share-sheet UI test | Successful import in independent third-party GPX app | Blocked until third-party import proof |
| Optional voice-to-text | Apple Speech service and exact permission copy | Voice model/service tests and disclosure tests | Physical-device permission, denial, interruption, and transcription QA | Blocked from prominent marketing until device proof |
| No current-location access | No shipping location service or usage key; About disclosure | Privacy release tests | Exact signed archive/traffic inspection | Allowed after archive check |
| Full typed prompt stays on device in Release | Release factory returns local parser | Release disclosure/factory source contract tests | Signed archive/traffic inspection | Allowed after archive check |
| Planning aid, not navigation | Onboarding/About/detail safety copy; no Release start action | Release-surface truth tests | Screenshot/review copy audit | Required claim |
| Remote AI absent from Release | Release factory selects the local parser; remote providers, request/response types, and `/api/parse-intent` client path are Debug-only | Privacy source contract plus Release binary forbidden-marker scan | Exact signed-candidate binary and traffic inspection | Required internal constraint; do not market AI |

## Screenshot traceability rule

Every screenshot must record:

- exact app build and source commit;
- device and OS;
- prompt used;
- route provenance and provider-run evidence;
- capture date;
- whether any text overlay was added after capture.

Only real, verified, non-sensitive route results may be shown as route facts. See [SCREENSHOT_PLAN.md](SCREENSHOT_PLAN.md).

## Release-notes draft

`TrailMind's first closed beta focuses on truthful same-day route planning: describe a hike, trail run, or bike route, compare mapped options, review measured route details, and save verified plans locally. TrailMind is a planning aid, not live navigation.`

This release note is conditional on the live routing, signed-device, persistence, and GPX gates in the matrix.

## Approval

- Product claim review: **[UNRESOLVED]**
- Legal/attribution review: **[UNRESOLVED]**
- App Privacy reconciliation: **[UNRESOLVED]**
- App Store Connect entry: **[UNRESOLVED]**
