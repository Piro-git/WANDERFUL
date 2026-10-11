# Prepare for this hike — implementation handoff

Branch: `codex/hike-preparation-20260906`
Base: `3f38e17eed44e767681d482b7f29638769fb7551`
Worktree: `/private/tmp/Wanderful-Preparation-20260906` (small sparse source checkout).

## Changes

- `TrailMind/Models/HikePreparation.swift`: typed catalogue and source metadata, explicit day/camping/hut context, pure generation/reconciliation, versioned per-route UserDefaults persistence.
- `TrailMind/Views/Preparation/HikePreparationView.swift`: route adapter, progress entry card, native preparation sheet, independent packing/disclosure controls, editable/deletable additions, exclusions and restoration, general departure checks, two SwiftUI previews.
- `TrailMind/Views/Route/RouteDetailView.swift`: one-line card insertion directly after route statistics, keyed by route UUID.
- `TrailMindTests/HikePreparationTests.swift`: six focused state/persistence scenarios.

No engine/backend/planning coordinator, signing, authentication, production configuration or other owner's files changed. Xcode filesystem-synchronized groups discover the new Swift files automatically.

## Product and state decisions

Forest/moss card, concise progress count, grouped native rows, muted struck-through packed items, and a short spring animation. Reduce Motion disables the spring. Controls have separate 44+ point targets and VoiceOver labels/state; native fonts wrap at Dynamic Type sizes. No continuous animation, imagery, dependencies or haptics required. Completion means only “Packing list complete”; all-excluded lists do not celebrate.

The stable saved `TrailRoute.id` is the persistence identity. Reopening/recreating the store retains packing and custom/excluded items. Another UUID starts a separate list. Context changes retain relevant states and custom items, drop removed catalogue states, and disclose additions. Returning to camping after removing camping equipment starts that equipment unpacked. Restore means unpacked. Excluded items never enter numerator or denominator.

Day hike is explicitly labelled as the starting choice. Multi-day routes prompt the user to choose an overnight style; the app does not guess their lodging. Hiking-only generated catalogue; other activities can maintain their own custom list and see an explicit coverage limitation. Four hours or 15 km adds a meal prompt: this is an editorial planning threshold, not a safety/exertion classification. No route distance implies weather, terrain, available water, permission or accessibility.

Before-you-go entries are general reminders, deliberately not persisted “checked” confirmations that might look current on the next trip. Route statistics are separate. No weather fetch, provider calls or LLM checklist generation. Source enum and controlled stable IDs define the future validated personalization boundary.

Local persistence follows the project's versioned UserDefaults preference-store convention; no route-store modifications. Unsupported/corrupt records remain untouched and the screen blocks editing rather than overwriting them. Schema v1 has no legacy records to migrate. Persisted lists are per saved route, not per calendar departure; users uncheck items when reusing a route. No bulk reset or automatic deletion is introduced.

## Content review and attribution

Read current official guidance on 2026-09-06. Concise original shipping copy and references only; no copied images/assets.

- NPS Ten Essentials: https://www.nps.gov/articles/10essentials.htm (page updated May 28, 2026). Baseline clothing, navigation, illumination, aid, food, hydration, repair, emergency cover and fire-rule checks.
- Recreation.gov overnight backpacking: https://www.recreation.gov/articles/list/helpful-tips-for-planning-an-overnight-backpacking-trip/1146 — camping and overnight planning.
- German Alpine Club hut visits: https://www.alpenverein.de/artikel/zu-gast-auf-alpenvereinshutten_7bf6cdc6-934f-4a00-9ff7-9829cb6180d0 — hut sleeping liner and booking checks, with the specific hut's requirements left to the user to confirm.
- Apple Reduce Motion API: https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducemotion

Sources are general guidance, not local rules or current route-specific evidence. No universal water/calorie quantities or equipment promises.

## Verification and limits

- Swift parser checks passed for all new Swift files plus the modified route-detail file.
- Pure model/store Foundation typecheck passed.
- Six scenario test bodies executed successfully using a small macOS Foundation assertion harness: day/camping/hut, measured duration/non-hiking coverage, stable IDs and reconciliation/custom preservation, exclusion/progress, store recreation/route isolation, damaged/future-record preservation. The harness substitutes assertion helpers for XCTest; this is not an XCTest app run. Sources/harness/logs remain in the worktree's untracked `work/` for review.
- New SwiftUI/model files typechecked against iOS Simulator 26 SDK, MainActor default isolation, actual existing TrailTheme, and a minimal TrailRoute fixture. This checks SwiftUI API use and generic bodies, not complete app integration. The first direct frontend attempt lacked macro plugins; the driver then required escalation because Xcode's macro sandbox could not launch nested in the tool sandbox. The bounded escalated driver typecheck passed.
- `git diff --check` passed.
- No app build, app XCTest run, simulator launch, preview rendering or screenshot capture. Visual behavior and full app compile/runtime remain UNVERIFIED.
- Initial free space was only 235 MiB; source checkout allocated about 11 MiB. Space independently rose to 2.7 GiB during work; last observed approximately 2.4 GiB. No user/cache files deleted. Reused existing module cache for bounded checks. Before an app build, reserve at least 5 GiB free as a conservative working floor; actual incremental build demand is unknown. No new build cache or dependency installation.
- Requested Documents handoff read stalled; coordinator explicitly instructed continuing with prompt constraints and durable AGENTS. No repeated cloud reads.

## Manual acceptance path after integration

1. Open a saved hiking route → Prepare for this hike. Verify route title/stats and default day list; no camping tent or sleeping bag/pad.
2. Pack water; open its reason independently. Confirm count changes only from the packing button. Mark an item Not needed; inspect progress and restore it unpacked.
3. Add “Camera”, edit the name, pack it. Close/reopen; relaunch the app and reopen the same saved route. Check persistence. Open another route and verify isolation.
4. Choose camping. Confirm new-items notice, tent and sleeping kit, and preserved water/custom states. Choose hut: no tent or camping sleeping kit, hut-specific item/check. Return through day to camping: removed camping kit is unpacked.
5. Complete included items; only packing completion is celebrated. Exclude all items: no completion claim.
6. Open a non-hiking route; confirm honest hiking-kit limitation and functional personal additions.
7. Check VoiceOver focus/order, reason/menu buttons, maximal Dynamic Type, light/dark/increased contrast, and Reduce Motion. Validate all controls remain reachable and text wraps.
8. Verify existing save, export, route editing and guidance still operate. No production/provider calls are necessary for this manual preparation flow.
