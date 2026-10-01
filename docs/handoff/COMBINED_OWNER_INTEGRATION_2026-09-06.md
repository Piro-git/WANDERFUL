# Combined owner iPhone integration — 2026-09-06

Worktree: `/private/tmp/Wanderful-Owner-Combined-20260906`.
Branch: `codex/owner-combined-integration-20260906`.
Base: `8b95906f9b8c399eda09810d5706479953dc2647`.

Integrated preparation `b138bc3` as `36ce43e`, engine `22facaa` as `bad98e7`.
Original branches and untracked work preserved. No remote pushes.
Integration fix `a7c8f4b` removes a preview-only assignment to the read-only
accessibilityReduceMotion environment value. Shipping Reduce Motion remains.

Verification so far: 52 integrated backend contract tests pass; changed Swift
sources parse. First combined device compilation found the preview keypath error
above; no disk error. Final combined simulator build-for-testing and signed arm64 device build PASS.
App XCTest execution remains pending; compilation is not an executed test.
Disk approximately 1.4 GiB; reuse retained cache, arm64 only, inherited Swift flags.
The existing simulator is shutdown; no simulator boot permission has been granted.

Expired OwnerPhoneTest.json was removed only from the retained device build
artifact before rebuilding. It was not read or copied into this integration.
Installed phone app/data were unchanged by this cleanup. No new credential,
provider call, database access, or research activation occurred.

Research readiness blocker: backend/coordinator aggregate reports staging has
zero regions/imports/active entities/projections. Reviewed Harz highlights,
mapped access, bounded repository and cancellation roles/runtime are required.
Do not enable research flags or represent synthetic fixtures as live evidence.
Current owner URL/auth override does not automatically configure the research
client factory. Any eventual owner-only activation requires explicit compiled
gates, valid private owner configuration and backend/data readiness signoff.
No production settings changed.

Preparation is local per-route packing support. Actual phone acceptance must
verify entry from route details, pack/unpack, custom items, saved-route isolation,
and persistence. Research acceptance requires real sourced stops and measured
route geometry after fresh separately agreed provider budget; no old session reuse.

## Final installed update

Engine follow-up `3dac767` integrated as `5073b4c`; backend preparation
`7d852e1` and `4014b92` integrated as `c7a61b3` and `cfcd8a6`.
Built application source HEAD: `5073b4c1337dc3c862ca93a5f0c30e5b4ce5608e`.

Final combined checks: 70 offline backend tests passed; 22 standalone production
Swift constraint checks executed and passed; simulator TEST BUILD SUCCEEDED;
signed device BUILD SUCCEEDED; codesign deep/strict verification passed.
Both actual research Info.plist gate keys are present and disabled. No private
JSON resource or provider-key scan finding in the final app. No dependencies
downloaded: existing backend node_modules is linked locally and is untracked.

Install first hit a transport reset. Fresh lock-state read reestablished the
connection (passcodeRequired=false), then the bounded retry succeeded at
16:04:45 Berlin. Bundle `com.example.owner.wanderful.local`, Owner iPhone17Pro
`REDACTED-DEVICE-ID`, existing team `REDACTED-TEAM-ID`.
No uninstall or data erasure. Launch succeeded at16:05:12; process16072 was
present at16:05:24. Build/app version remains1.0(1).

This proves combined compilation, signing, installation and launch—not visual
acceptance of preparation. No physical screen-control tool is available, and
the existing simulator remains shutdown without boot permission. User can open
a saved hiking route, open Prepare for this hike, and send a screenshot; packing
and persistence still need runtime acceptance. No current live planning token
is bundled, so this update does not activate seamless researched routing.

Disk stayed approximately1.3GiB free. No cache deletion, provider calls, secret
reads, database modifications, production flag changes, or remote pushes.

## Backend runtime composition integration

Backend `4b6c944` integrated as `41d9d8041dbdd7dfee0b360f7da50453fa49e7ed`
after dormant owner wiring `5bcc0a2`. All 77 combined focused offline runtime,
server/session/budget and research endpoint/candidate tests passed in one run.
This uses mocked readiness/database/provider dependencies; no real data or
credential activation was performed. No iPhone rebuild or reinstall occurred.
The installed app remains built source5073b4c. Data/runtime signoff and a fresh
bounded session are still required before the activation build.
