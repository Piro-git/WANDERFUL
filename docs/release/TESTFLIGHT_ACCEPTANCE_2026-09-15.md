# TestFlight acceptance and screenshot plan

Status: **execution pending final integrated TestFlight build.**

Record build number, commit, tester/device/iOS, date, result, and a sanitized artifact for each row. A local mock pass is not release evidence.

| Check | Minimum real acceptance | Status / evidence required |
| --- | --- | --- |
| Free route — Europe | Type a public, non-personal route; open map/detail; compare displayed geometry, distance, duration, elevation | Pending final build + live backend receipt |
| Free route — second region | Repeat in a materially different supported region; confirm place disambiguation or graceful clarification/error | Pending |
| Free route — third region | Repeat with loop or different activity where product supports it | Pending |
| Network failure | Disable network during request; confirm actionable retry state and no fabricated route | Pending |
| Route photos (only if integrated) | Verify actual stop photo, credit, exact licence/link, missing-photo fallback, no synthetic replacement | Blocked on Commons integration |
| Saved route / packing list | Save, relaunch, reopen; change trip style and preserve applicable packed/excluded state; test individual and all-route deletion | Pending installed-build proof |
| Guidance / location | Start only from saved eligible route; grant, deny, revoke, background/foreground, pause/end; confirm no safety guarantee | Pending physical device proof |
| Voice (only if shipped) | Grant/deny/interruption/retry; typed path remains complete without permission | Pending physical device proof |
| Account deletion (only if enabled) | Use reviewer-safe account, request deletion, verify backend deletion and documented local-data behavior; verify an unauthenticated request cannot show deletion success | **P1 source fix + focused test required**, then backend/device acceptance; account code is currently default-disabled |
| StoreKit sandbox (only if enabled) | Purchase, pending/cancelled/error, restore, subscription management; reviewer can see every product | Blocked on product configuration |
| Accessibility | VoiceOver, largest Dynamic Type, Increase Contrast, Button Shapes, Reduce Motion, supported iPhone sizes | Pending final UI |

## Screenshot capture list

Capture only the exact integrated release candidate on a physical iPhone or approved simulator configuration. Do not use generated imagery, mock-only screens, developer menus, private locations, or UI-test fixtures as marketing proof.

1. Plan entry: typed, non-personal sample prompt; no claim beyond planning.
2. Route comparison: live measured result with distance/duration/elevation and no unsupported scenic/safety wording.
3. Route detail: actual map geometry and the planning/safety boundary.
4. Saved route + packing list: genuine local persistence surface.
5. Guidance only after device acceptance; show orientation, not a promise of turn-by-turn navigation or safety.

For every captured screen retain build number, commit, device/OS, locale, capture date, source route prompt, and proof that displayed data came from the release lane. Do not publish a screen for a conditional feature until its row above passes.
