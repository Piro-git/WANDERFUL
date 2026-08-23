# Screenshot Capture Plan V1

Status: **plan only; no screenshots or generated marketing assets were created**
Capture build: `UNKNOWN` until Stage B and TestFlight selection

Apple accepts one to ten iPhone screenshots per localization, requires `.jpeg`, `.jpg` or `.png`, and forbids alpha/transparency. Current accepted portrait sizes include 1260×2736, 1290×2796 and 1320×2868 for the 6.9-inch class, and 1179×2556 or 1206×2622 for the 6.3-inch class. Source retrieved 2026-08-23: [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).

## Device and file plan

1. **Required production set:** capture a consistent portrait set on a 6.9-inch iPhone class at its exact native accepted size. Prefer the currently available 6.9-inch device that matches the selected release runtime; do not resize a smaller simulation by hand.
2. **Verification set:** capture the same states on the authorized iPhone 17 Pro Simulator at 1206×2622 (6.3-inch). Upload only if the App Store Connect slot strategy requires it; the Stage B simulator is primarily for QA.
3. Export sRGB PNG or high-quality JPEG, with no alpha, device frame, fabricated map data, generated UI, status-bar inconsistency, debug overlay or private user information.
4. Use one deterministic local-seam dataset whose displayed geometry/statistics match the app. Screenshots must not require live provider traffic in this task.
5. Keep the app localization, overlay language, status-bar time, appearance and content consistent across the set.

## Proposed six-scene narrative

| Order | Exact app state | Truthful overlay copy | Setup and stop gate |
| --- | --- | --- | --- |
| 1 | Plan/Home after verified onboarding | `Describe the route you want` | No debug/demo label; typed planner visible |
| 2 | Completed typed request before generation | `Hike, run or ride—your way` | Real supported activities only; no voice icon in focus unless voice proof passes |
| 3 | Multiple deterministic route suggestions with map shapes | `Compare real route options` | Each route uses coherent local-seam geometry/stats; no “scenic” badge without evidence |
| 4 | Detail map and stat summary | `See distance, time and elevation` | Values match the selected deterministic route |
| 5 | Planned-for-you/preferences and safety copy | `Requested preferences stay clear` | Distinguish requested preferences from verified facts; safety wording legible |
| 6 | Saved route or GPX share-sheet entry point | `Save or export your plan` | Use a verified routed result; do not expose other share targets' private data |

Do not use `Live trail geometry`, `trail-network data`, verified-scenery wording, voice planning, subscription/premium, remote-AI, research/evidence, offline, weather or navigation copy unless its blocker is independently closed in the selected build.

## Deterministic state requirements

- Fresh install/reset for scene 1; document the exact onboarding completion state.
- A local fake/fixture must simulate success without contacting GraphHopper, Supabase, Superwall or the production backend.
- Route name, coordinate bounds, distance, duration, elevation, type and activity must be internally consistent.
- No permission alert may obscure a marketing screenshot. Permission surfaces are verified separately.
- Avoid identifiable real-home coordinates, account names, emails or historical saved routes.
- Capture both light/dark appearance for QA; select one coherent App Store narrative after contrast review.

## Accessibility and visual QA before capture

- VoiceOver: logical order, descriptive controls/map summary, no unlabeled icon-only action.
- Voice Control: actionable controls have stable, distinct visible names.
- Larger Text: common tasks remain usable at accessibility sizes without clipped core copy or hidden actions.
- Reduce Motion: no essential meaning depends on animation.
- Contrast and color: route selection/status is not communicated by color alone; text remains readable over maps/materials.
- Check status bar, safe areas, Dynamic Island, keyboard dismissal, modal height and scroll affordances on both size classes.
- Run the common-task criteria before declaring any Accessibility Nutrition Label. Sources: [Accessibility Nutrition Labels](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels), [VoiceOver criteria](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/voiceover-evaluation-criteria), [Larger Text criteria](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/larger-text-evaluation-criteria).

## Capture acceptance record

For every final file record: build number, commit, device model, OS, pixel dimensions, localization, appearance, fixture ID, capture date, SHA-256, reviewer and the closed blocker IDs. Do not upload any screenshot until metadata/runtime parity and rights review pass (`ASV1-015`, `ASV1-016`, `ASV1-026`).
