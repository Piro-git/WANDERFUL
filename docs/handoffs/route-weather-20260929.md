# Route weather — integration handoff (2026-09-29)

> Source-only publication: referenced UI screenshots are retained locally by the integration owner; no screenshot PNG bytes are included or retrievable from this branch. Textual test results are retained; visual acceptance is not independently reproducible from this PR alone.

Checkout: `/private/tmp/wanderful-weather-20260929`; branch: `codex/route-weather-20260929`; base: `83a99c0`.
No deployment, push, device installation, secret access, paid registration, or live forecast request was performed.

## Change

- Independent authenticated `POST /api/route-weather`, version 1, using the existing route-session authorization (cost 1), bounded HTTP transport, server handler and hosting. No AI or GraphHopper calls.
- Exact request: `{version:1, geometryJSON:"[[longitude,latitude],…]", plannedStartAt:"ISO-8601 with offset or Z" | null, durationHours:number}`. Full geometry is bounded to 500 KB / 20,000 points and bound to the response by SHA-256. No user prompt, city name, account ID or device IP is sent to MET Norway.
- Three distance-based samples on the actual geometry: 0/50/100% for point-to-point, 0/33/67% for closed routes (endpoints within 50 m, route over 100 m). Handles unequal vertex density and antimeridian longitude interpolation. It does not reconstruct route geometry or claim complete geographic coverage.
- Every sample covers the **entire** selected route time window, conservatively, rather than guessing arrival times. Window = explicit start + mapped duration, without breaks. Maximum 24 h; multi-day previews are intentionally unavailable. No assumed departure if date absent. Existing `localConditions.visitTime` seeds the picker; routes without that metadata require choosing a time. Weather time edits are local to this card, not edits to local warning checks or saved route metadata.
- Temperature envelope, maximum modelled wind (m/s converted to km/h; no gust claim), and highest precipitation interval average (mm divided by 1 h or 6 h). Includes rain/snow water equivalent; **not peak hourly intensity, rain probability, or trip accumulation**. Native details explain this.
- A single missing/incomplete sample fails the whole preview visibly; no partial data masquerades as a complete forecast, no zero substituted for missing rain, no old forecast substituted after errors. Uses returned coverage, at most ~9 days, and rejects model updates older than 24 h or in the future.
- Compact rounded native card; DE/EN string table, Dynamic Type, disclosure details, source/license links, model update/retrieval times and explicit device timezone. The main card now leads with its time window and three separate values; source and oldest model update remain visible. Explanations are in the disclosure. UTC instants eliminate DST/region ambiguity; no guess of route-local timezone. Mountain/coarse-grid limitations and official-warning reminder are explicit. Existing `localConditions`/DWD warnings stay separate.

## Provider decision and cost review

Primary sources inspected 2026-09-29:

- [MET Norway API](https://api.met.no/): freely usable data, including commercial use.
- [Locationforecast 2.0](https://api.met.no/weatherapi/locationforecast/2.0/documentation): global coordinate forecast for approximately nine days, compact JSON.
- [Data model](https://docs.api.met.no/doc/locationforecast/datamodel.html): automatic numerical forecasts, region-dependent resolution, hourly and six-hour periods. Terrain/microclimates are not verified.
- [Forecast JSON](https://docs.api.met.no/doc/ForecastJSON.html): instantaneous temperature/wind versus accumulated interval precipitation.
- [License](https://api.met.no/doc/License): MET Norway attribution and CC BY 4.0 (or NLOD); app displays source and license link and identifies summarization.
- [Terms](https://api.met.no/doc/TermsOfService): identifying User-Agent/contact, maximum four coordinate decimals, cache until Expires and conditional If-Modified-Since, backend proxy, no SLA; more than 20 requests/second **across the application** needs agreement.
- [Open-Meteo terms](https://open-meteo.com/en/terms): free hosted endpoint restricted to noncommercial usage; rejected here to avoid adding a paid plan for this commercial app.

MET Norway requires no key and has no per-call invoice/subscription in this integration. No real forecast call was needed: all verification uses synthetic fixtures. The adapter only contacts the fixed HTTPS MET origin, supports one same-origin redirect/gzip, one attempt, 5 s timeout per sample, 256 KB response cap. URLs are constructed solely from validated/rounded coordinates. No upstream error strings reach the app.

## Exact integration/configuration steps (release integrator)

1. Cherry-pick the feature commit and subsequent review-fix commits from this branch onto the chosen release base. Files are additive except one route-detail insertion and server endpoint registration; no project-file changes or DB migration.
2. Keep `ROUTE_WEATHER_ENABLED` unset/false in **both** the server environment and iOS build settings initially. iOS now resolves this independent flag through the existing strict configuration parser and displays the card only when it is exactly `true` and the signed-lane backend configuration is valid. Missing/invalid/duplicate values fail closed. Shared and Development xcconfig defaults are false; Staging/Production inherit the shared default. Thus current release builds have no permanently unavailable weather card.
3. Configure **server-side only** `ROUTE_WEATHER_USER_AGENT` with the real product/version and a reachable company contact URL/email, for example `Wanderful/1.0 https://<actual-company-domain>/contact`. The placeholder must be replaced. No API key is needed or accepted. Do not put this setting into the iPhone or Local.xcconfig.
4. Before setting `ROUTE_WEATHER_ENABLED=true`, choose a long-lived **single backend instance** for this initial in-memory implementation. Cache is 128 coordinate entries, respects Expires/Last-Modified, deduplicates concurrent fills and refuses new entries while full rather than evicting fresh data. Admission caps three cache misses per second per process (at most six provider HTTP requests with redirects); provider failures trigger backoff. All weather app requests still use existing durable authenticated route-session budgets in production.
5. **Vercel/multiple replicas remain an external activation gate:** serverless cold starts and independent instance caches do not guarantee app-wide cache/rate compliance. Leave the feature off there until a shared cache and fleet-wide provider limiter have been integrated/reviewed, or MET Norway agrees to the intended traffic. No such infrastructure or new hosting contract was added in this task. This is an activation limit, not a claim that per-instance caches control the whole fleet.
6. Include the provider disclosure (sampled route coordinates sent via backend to MET Norway) in the existing privacy documentation before external release. Attribution/license are already visible in the card.
7. Activation order: (a) satisfy the server cache/fleet and contact gates above, (b) enable server `ROUTE_WEATHER_ENABLED=true` via normal release review and verify a staging weather request with existing App Attest/session configuration, (c) only then build the reviewed iOS lane with explicit build-setting override `ROUTE_WEATHER_ENABLED=true` and its validated backend base URL. Verify the compiled Info.plist and native screen, then follow the usual release process. Neither side is enabled by this commit. The iOS flag is compiled configuration, not a runtime switch; a later emergency backend shutdown yields the friendly unavailable state on previously enabled app builds. No new entitlement or permission prompt.
8. Smoke-test one explicitly selected route/date after activation, within returned horizon; confirm three returned samples, attribution, fresh timestamps and failure state after disabling the flag. Bound any live check to one preview (at most three coordinate requests; repeated loop points use cache).

## Verification and UI/data states

Commands from this checkout:

- `node backend/scripts/check-javascript.js`
- `node --test backend/test/routeWeather.test.js backend/test/server.test.js backend/test/preparation.test.js backend/test/dynamicResearchConditions.test.js backend/test/dynamicResearchRegionalConditions.test.js backend/test/dynamicResearchGlobalConditions.test.js`
- Simulator scheme `TrailMind`, iPhone 17 Pro / iOS 26.5, `CODE_SIGNING_ALLOWED=NO`, isolated DerivedData `/private/tmp/wanderful-weather-build`.
- XCTest selections: `RouteWeatherTests`, `RoutePromptParserTests`, `RoutePlanningEvidenceTests`.

Results: initial build succeeded; 66 targeted backend tests passed; 30 initial iOS tests passed. Native weather snapshot and final regression results are recorded below after review.

| State | Visible behavior |
| --- | --- |
| No date | Ask to choose time; first tap opens details without a provider request |
| Loading | Native progress indicator, check button disabled |
| Available | Time window + three legible values; explanations on tap; source and model update always visible |
| Date changed | Old forecast cleared; explicit new check required |
| Expired | Numerical summary hidden; refresh invitation |
| Past / beyond actual horizon | Explain forecast window and closer-to-departure retry |
| Route longer than 24 h | Explain limited preview duration; consult daily forecasts separately |
| Offline / auth / timeout | Friendly retry text, route unaffected |
| Missing source / partial or malformed data | Unavailable; never claim dry or safe conditions |
| Another timezone / DST / region | Absolute request instant, displayed device timezone; global provider with coverage limits |

Risks/limits: no guaranteed service availability; coarse model terrain and three points omit local changes; no gust/warning layer; no overnight/day-split model or pause estimates; no weather persistence/offline forecast; no live-provider/network integration claim. Client validation binds route/time/source and refuses malformed/future/stale values. Existing unrelated compiler warnings remain (AppleAccountAuthentication deprecated initializer; StoreKitTest deprecation; OwnerAccessClientTests redundant await).

Final verification receipt:

- Full official backend harness: **1,524 passed, 0 failed, 1 skipped** (1,525 total). Initial sandbox-only failures were all local `listen EPERM`; the approved repeat with loopback listeners passed. Log: `/private/tmp/weather-full-backend-tests.log`.
- Final weather XCTest run: **6 passed, 0 failed**, including four native snapshots (EN, DE, DE Accessibility 3, DE no date). Previous regression selection: 30 passed. Snapshots were exported and visually inspected: proper German decimal comma, wrapping without horizontal clipping, scrolling at Accessibility 3, no values in the no-date state.
- Final xcresult: `/Users/REDACTED/Library/Developer/XcodeBuildMCP/workspaces/EasyWander-984081efadb6/result-bundles/test_sim_2026-09-29T13-26-22-456Z_pid81710_0014d55c.xcresult`.
- Exported snapshots: `/private/tmp/weather-ui-review/` (see manifest). These are synthetic fixtures, not live-weather evidence.

Post-commit review fix: cache capacity now reclaims expired entries on demand, while retaining fresh entries until their provider expiry and retaining old documents for conditional revalidation when capacity permits. This prevents 128 expired entries from blocking new route coordinates for a day. Added saturation/expiry regression: **14 weather tests passed** after the fix. Full-suite and native results above apply to the feature commit; only the provider cache eviction policy changed afterward.


## Coordinator UI/release follow-up

- Condensed the standard card: time window, temperature, rain/snow and wind in three columns; stacks vertically for accessibility sizes. Removed introductory/uncertainty paragraphs from the main card; kept them in disclosure details. Rain/snow uses “bis …” / “up to …” with “mm/h im Mittel” / “mm/h on average”; VoiceOver explicitly reads average precipitation. No probability/safety claims. Source and oldest model timestamp remain visible (not just the time the cache was checked).
- All native QA fixture timestamps now derive from one captured clock. Tour starts one hour ahead and lasts four hours; model/retrieval/expiry timestamps are coherent. The fixture runs through contract validation and asserts a future start before rendering.
- New native `ROUTE_WEATHER_ENABLED` gate defaults false; strict parsing and a valid signed-lane backend are required. Tests cover missing, false, malformed, duplicate, backend-missing and exact true settings in Staging/Production plus tracked defaults/Info.plist/view wiring.
- Follow-up snapshots/tests run only on dedicated temporary simulator `86734355-AC25-43C5-BEBD-0B2868E909EB` (Wanderful-Weather-QA-20260929). Shared simulator `A9194E37-28A7-450E-9F30-95D0145D0486` was not used or modified in this follow-up. No deployment or activation.

Follow-up verification: **48 XCTest tests passed, 0 failed** (`AppEnvironmentTests`, `ReleaseSurfaceTruthTests`, `RouteWeatherTests`); build succeeded with no reported warnings. Compiled app Info.plist `ROUTE_WEATHER_ENABLED` inspected as literal `false`. Four exported snapshots were visually checked: EN and DE compact forecast, DE Accessibility 3 vertical layout, DE no-date state. The new forecast window is 16:39–20:39 with model data at 15:09 on the QA date, so the screenshot no longer presents a past trip as current. New evidence supersedes the older UI snapshots above.

- Result: `/Users/REDACTED/Library/Developer/XcodeBuildMCP/workspaces/EasyWander-984081efadb6/result-bundles/test_sim_2026-09-29T13-37-37-204Z_pid81710_46e3c80c.xcresult`
- DE standard: `/private/tmp/weather-ui-review-v2/9E79D28E-2560-41D3-88BD-DAD7D2A9E37C.png`
- EN standard: `/private/tmp/weather-ui-review-v2/23A39E31-F802-4609-BE1A-46B07A5F441B.png`
- DE large type: `/private/tmp/weather-ui-review-v2/F4F0636E-A7D6-4B0E-91A9-9DD447DC317D.png`
- DE no date: `/private/tmp/weather-ui-review-v2/9667EDEE-7DC6-4F25-8412-66B7E62E4371.png`

The dedicated follow-up simulator is shut down and removed after verification; exported artifacts remain. No backend source changed in this follow-up; previous backend tests still apply.

Final copy-only follow-up: replaced `Ø ≤ 1.2` with `up to 1.2` / `bis 1,2`, plus `mm/h on average` / `mm/h im Mittel`. Full VoiceOver average-precipitation wording is retained; interval definitions remain in details. No layout, backend or featureflag changes. Targeted native snapshot test passed (1 test, four screenshots); EN, DE and Accessibility 3 images visually reviewed with no clipping. Result: `/Users/REDACTED/Library/Developer/XcodeBuildMCP/workspaces/EasyWander-984081efadb6/result-bundles/test_sim_2026-09-29T13-43-08-849Z_pid81710_65674061.xcresult`. Latest snapshots supersede v2: DE `/private/tmp/weather-ui-review-v3/E29F1799-61AE-459C-A995-93FAC2B4B668.png`, EN `/private/tmp/weather-ui-review-v3/7A983264-BF80-4966-A008-E8CBE2631471.png`, large text `/private/tmp/weather-ui-review-v3/7338447C-68BD-4502-9484-662FF4F858F4.png`. Dedicated temporary simulator `57DB08FB-8D6E-4D58-804C-D02F621DDDC6` used and removed; shared simulator untouched.
