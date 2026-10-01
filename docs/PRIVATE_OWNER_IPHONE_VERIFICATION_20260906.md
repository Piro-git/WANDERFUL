# Private owner iPhone verification — 2026-09-06

Base: `3f38e17eed44e767681d482b7f29638769fb7551`.
Branch: `codex/private-owner-phone-test-20260906-ios`.
Worktree: `/private/tmp/Wanderful-Private-Owner-Phone-20260906`.
Backend owner task: `01a0768f-eeaf-70d0-afe4-3206a0642123`.

## Scoped changes

Only `DEBUG && WANDERFUL_OWNER_PHONE_TEST` allows the exact existing owner
identity `com.example.owner.wanderful.local`, alongside `com.trailmind.app.local`,
and only in the local environment. The general environment validator uses the
same allowance. Release, staging and arbitrary bundle identities retain their
normal validation. Owner authorization now stops issuing requests after its
credential is invalidated; shared client session-refresh logic cannot resend it.
Owner builds force serial loop requests to match backend admission.
No backend, onboarding, payment, Supabase, or production App Attest changes.

## Verified so far

- Fresh device discovery: Owner, iPhone 17 Pro, paired/available;
  `REDACTED-DEVICE-ID`.
- Existing installed app: Wanderful Local, `com.example.owner.wanderful.local`, 1.0 (1).
- Existing Personal Team: `REDACTED-TEAM-ID`; cached matching profile expires 2026-09-09.
- The final device Debug build (including serial loop admission) succeeded using
  that existing automatically selected profile; signature verification passed
  with access to the system trust store.
- Final owner test build-for-testing succeeded, arm64 simulator only. XCTest has NOT
  run; boot permission is pending. Test additions cover identity restrictions,
  invalidation, unique request IDs and expired credentials.
- Compiler object checks of OwnerPhoneTestConfiguration.swift with ordinary Debug
  and with owner flag but no DEBUG emit no owner types. These are compile-guard
  checks, not a new full Release build.
- Device app contains microphone, speech and location purpose strings and local
  environment identity. Resource scan found no populated provider-key settings
  or Google key patterns. No provider secret file was read.

## Build settings

Use retained `/private/tmp/TrailMindDerivedData-EntitlementV2`, one build at a time,
Debug, arm64, `ONLY_ACTIVE_ARCH=YES`, existing resolved package versions, team
`REDACTED-TEAM-ID`, `PRODUCT_BUNDLE_IDENTIFIER=com.example.owner.wanderful.local`, and the
existing empty `/private/tmp/WanderfulPhoneDebug.entitlements` override. Append
`-D WANDERFUL_OWNER_PHONE_TEST` to inherited `OTHER_SWIFT_FLAGS`; do not replace
`SWIFT_ACTIVE_COMPILATION_CONDITIONS`. No tracked signing setting was changed.
The initial canonical identity failed provisioning; manually choosing the cached
profile also failed because it is Xcode-managed. Automatic cached selection works.
An unnecessary dual-architecture simulator compile was stopped; no caches deleted.

## Pending phone acceptance

Do not install until the backend window is agreed. Obtain only the private JSON
artifact path, public HTTPS URL, expiry and remaining provider counts from the
backend owner. Copy JSON into the app before final signing, reverify signature and
resource safety, then install as an update without uninstalling or erasing data.
No temporary JSON, signed app or credentials belong in Git or public artifacts.

Shared total budget: at most 5 Gemini generations and 10 GraphHopper calls.
This iOS task has used zero of either. The backend smoke consumed one Gemini
attempt and returned HTTP 503 `intent_unavailable`; no GraphHopper call ran.
Latest reported shared remainder: 4 Gemini / 10 GraphHopper. Backend diagnosis
is pending; installation and phone traffic are on hold. Reconfirm counters
before resuming. One actor produces traffic at a time; backend
must supply current counts before phone requests. Shipping loop search has two
concurrent requests, initial seeds 11/29/47 and possible quality fallback calls;
this owner build forces concurrency one; the backend retains its durable upstream cap.

Pending actual-device checks: text planning with an agreed synthetic Ilsenburg
loop; broad-location clarification; real route preview and details; retry/cancel;
navigation entry; microphone cancel/denial/no-crash only with owner consent and
normal system permissions. No GPS field-navigation proof is claimed.

The temporary test requires the Mac, backend and HTTPS tunnel to remain running.
Revoke the session and stop the tunnel afterward. This path is parse-intent then
geocoding/clarification then route, not combined llm-plan-route, POI/database
research, offline navigation, safe-trail guarantees or App Store readiness.

## Live installation update — 14:08 Berlin

Backend smoke subsequently passed with pinned Gemini 3.8 Flash and real
GraphHopper geometry (14,398.712 m, 498 points). Backend reported total usage
2 Gemini / 1 GraphHopper, remaining 3 / 9; no phone requests yet. Earlier 503
state above is superseded by this successful handoff.

The private three-field owner resource was validated and copied into the built
app before final re-signing; signature verification passed. `devicectl` installed
the update successfully at 14:07:53 Berlin with existing bundle identity and data
preserved. Launch failed because the physical iPhone is locked. User must unlock
and open Wanderful Local, submit one synthetic Ilsenburg loop prompt, and report
suggestions/map/detail state. No automatic retry or audio/location action.

Credential expires 2026-09-06 12:43 UTC (14:43 Berlin). Backend/tunnel are being
kept alive for this window; no renewal authorized. Backend commit: `dc26b44`.
Simulator runtime tests and all actual phone acceptance states remain pending.

## Direct phone check — 14:22 Berlin

User authorized direct inspection. Lock-state query reported passcodeRequired=false.
Wanderful was not running; launch succeeded at 14:22:03, and the app process
PID 15453 was still present at 14:22:23. This proves launch, not route UI success.
Backend read-only counters at 14:20 remained 2 Gemini / 1 GraphHopper, with
3 / 9 remaining; no additional phone request had reached a provider.

The available device tools expose lock/process state, not physical-screen UI
inspection or taps. No phone mirror is exposed and no physical screenshot CLI
is installed. User can send the current Wanderful screenshot for interpretation;
no technical verdict is required from the user. No microphone/location action
or provider request was made during this check.

## Screenshot acceptance and read-only findings — 14:38 Berlin

User screenshot (phone clock 14:29) proves the suggestions screen reports three
routes and displays the first route geometry thumbnail. Displayed prompt is
“Plan A 15km hiking Loop From Illsenburg”; first option is 20.1 km, explicitly
5.1 km over target, with estimated challenging effort. It also shows the
flexible-mode fallback banner, Requested: Views, and remoteAI primary badge.
Route detail, full map, navigation entry and voice behavior remain unverified.

Backend read-only ledger at 12:37:53 UTC reports 3 Gemini attempts and 10
GraphHopper calls total: phone added 1 / 9 since handoff. Remaining 2 / 0; no
further routing submissions. Latest upstream outcome is GraphHopper HTTP 200.
Together with the screenshot this supports real phone routing and displayed
suggestions. The ledger does not retain earlier response bodies/status history.

Read-only trace and next-scope proposals (no implementation):

- Views: app composition injects the saved hiking profile (TrailMindApp.swift:53);
  PlannerViewModel.swift:1825 applies it. HikingPreferenceProfileResolver.swift:304
  maps saved viewpoints when experiences were omitted. The remote decoder also
  accepts returned desiredFeatures (IntentParsingFoundation.swift:693). Defaults
  for profile/engine experiences are nil. Saved preference is plausible; its
  actual source is unproven without current preference/provenance evidence.
  PlanningViews.swift:690 labels all merged features Requested, losing origin.
  Narrow proposal: preserve and display prompt-versus-profile attribution, with
  an omitted-experiences regression case; do not assume provider hallucination.
- remoteAI primary: RouteComponents.swift:115 and :337 gate this badge under
  DEBUG. It is intentional internal UI, not a proven Release leak. Suppress it
  in owner acceptance builds or use a separate diagnostics surface next scope.
- Fallback banner: RoutingFoundation.swift:212 selects this copy for a classified
  flexible-mode error before successful normal-segment fallback. The phrase
  “on this API plan” claims an entitlement cause not established by that
  classification or retained ledger. Use neutral capability/fallback wording.
- Distance: 20.1 km is approximately 34% above 15 km; the 5.1 km delta is correct.
  RouteAlternativeQuality.swift:17 permits hard distance ratio up to 1.75.
  This is a visible fit-quality gap, not a demonstrated arithmetic bug. Review
  bounded near-target selection/rejection policy with fixtures before new calls.

No new provider calls, builds, source edits, audio or location actions occurred
during this screenshot review. Scheduled backend shutdown remains 14:43 Berlin.
