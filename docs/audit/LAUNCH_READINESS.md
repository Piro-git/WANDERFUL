# TrailMind Launch Readiness

Audit date: 2026-07-15

Readiness model: gate-weighted, not a count of source files or planned features. A single unresolved route-truth, credential, privacy, signing or production-backend gate caps the stage even when much of the implementation exists.

## Executive status

| Milestone | Conservative readiness | Decision today | Why the score is capped |
|---|---:|---|---|
| Internal development build | **≈78%** | **NO-GO until credential rotation; then conditional** | Debug and Release Simulator builds, deterministic suites and cold launch are healthy; the remaining cap is the credential incident, misleading live-test scripts, no UI smoke path and unisolated mock/demo journeys. |
| Useful closed beta | **≈36%** | **NO-GO** | Real planning can work, but production-reachable mocks/fake edits, factual difficulty mislabelling, dead CTAs, privacy gaps, and unverified signed App Attest/backend/PostgreSQL operation prevent trustworthy tester use. |
| Public App Store release | **≈18%** | **NO-GO** | All beta gates remain, plus paid-program/signing/App Store Connect work, privacy policy/details/manifest evidence, attribution/legal review, release archive QA, accessibility/device testing, metadata and production operations. |

These percentages describe evidence-backed readiness for each milestone. They are deliberately not additive: completing a marketing asset does not offset an unresolved outdoor-safety or credential gate.

## Evidence baseline

### Confirmed by static inspection

- SwiftUI app shell with onboarding and Plan/Explore/Saved/Profile tabs.
- Real text/voice composer path, local parser and structured request model.
- Apple geocoding and real GraphHopper routing through a backend gateway by default.
- Point-to-point, round-trip and fallback loop routing, alternative routes and typed route shaping.
- Real geometry, distance, duration, elevation, instructions and mapped path details decoding.
- Multiple loop suggestions, factual variant labels and lightweight Canvas route thumbnails.
- MapKit route detail, planning metadata, verified route characteristics and safety notes.
- Local Saved-route persistence, remove/error handling and file protection.
- Apple Speech permission/recording/transcription state handling.
- App Attest key registration/assertion/session design, replay/rate/concurrency controls, production entitlements and durable PostgreSQL repository.
- Broad Swift unit-test inventory and Node backend test inventory.
- Debug and Release builds succeeded for an iOS 26.5 Simulator using Xcode 26.5.
- XCTest executed 179 tests: 177 passed, two opt-in live checks were skipped, and none failed.
- All 115 normal backend tests passed outside the restricted network sandbox; `npm audit --omit=dev` reported zero known vulnerabilities at audit time.
- A clean Simulator install cold-launched without a crash into onboarding; a returning-user launch reached the Plan Home screen.

### Present but fake, placeholder, disconnected or development-only

- Home example chips use mock planning; Home “Recent plans” is a mock route.
- Explore is a visible developer routing demo plus mock route catalogue.
- “Edit with AI” is a mock stats/text mutation that keeps the old geometry.
- “Start route” only displays a placeholder alert.
- GPX export shares a string/empty fallback rather than a robust named file.
- Profile preferences are memory-only and not consumed by planning.
- Onboarding and examples promise unverified water/conditions/exposure/highlights/overnights/sunset intelligence.
- Release uses the local intent parser; remote backend AI is not enabled by default.
- Location service code exists but “Near you” is not wired to it.
- Instructions are decoded and persisted but not rendered as a user feature.

### CANNOT_VERIFY in this audit artifact

- Real GraphHopper provider behavior under the present backend configuration.
- The deployed Vercel environment, health, quotas, secrets and log policy.
- Applied PostgreSQL migrations, RLS/TLS/backup/region and real integration-suite result.
- Signed physical-device App Attest development and production behavior.
- Release archive contents, privacy report and absence of secrets/debug fixtures.
- VoiceOver, Dynamic Type, dark appearance, Reduce Motion, network and energy performance.
- Any complete prompt-to-live-route UI journey, including generation, suggestions, route detail, voice, Saved, Explore and Profile interaction.
- Live remote-intent and live route-quality evaluations: the opt-in test scripts exited successfully while their selected Simulator tests remained skipped.

Historical statements in `AGENTS.md`/`PROJECT_CONTEXT.md` are useful context but are not current verification. `PROJECT_CONTEXT.md` is also materially behind the codebase (it still describes backend, AI, voice, persistence and route thumbnails as future work).

## Milestone 1 — Internal development build

### Purpose

Developers can build and exercise the real route-planning path locally without exposing a credential, crashing, or confusing a developer demo with production behavior.

**Current completion estimate: ≈78%.** Clean Debug/Release Simulator builds, deterministic tests and cold launch now have current evidence; the score remains capped by the credential incident and unverified interactive/live-service journey.

### Required functionality and current completion

| Requirement | Current evidence | Status |
|---|---|---|
| Project compiles under Swift 6 strict concurrency | Debug and Release iOS 26.5 Simulator builds succeeded | **TESTED** |
| Simulator launches through onboarding and Home | Clean onboarding and returning-user Home were directly observed without a crash | **TESTED for launch; later interaction unverified** |
| Typed point-to-point and loop requests use real routing | Dynamic planner/geocoder/router path and deterministic tests exist | **PARTIAL; live UI/provider journey unverified** |
| Local backend can start with explicit local-only insecure flags | All 115 normal backend tests passed, including local HTTP-server cases; local start script/policy exist | **PARTIAL; manual provider-backed smoke unverified** |
| No credential in tracked source or app bundle | Local config is ignored/untracked; default client uses backend | **Architecture passes; incident remediation pending** |
| Errors/cancellation do not strand the UI | Focused deterministic timeout/failure tests passed; rendered recovery was not traversed | **PARTIAL** |
| Mock/demo behavior is clearly isolated | It is not isolated from the main app shell | **Incomplete** |

### Immediate blockers

1. **Rotate and revoke the GraphHopper credential exposed in this task transcript.** No provider-backed development should continue until complete.
2. Fix both opt-in live-evaluation scripts so they fail when the selected Simulator test is skipped; pass the opt-in into the test process and inspect the `.xcresult`.
3. Add a small deterministic UI-test target and complete at least one typed point-to-point and loop journey through detail; separately run protected live-provider smoke checks after rotation.
4. Add an unmistakable Debug-only boundary around fixtures/demos, even for internal builds, so manual results cannot be misreported as live.

### Non-blocking internal issues

- Forced light appearance, missing localization and incomplete accessibility identifiers do not prevent an engineer from exercising the core locally, but they remain public-release work.
- Canvas thumbnails lack geographic basemap context; they are adequate for internal comparison and have the safer list-performance profile.
- Profile preferences, Explore discovery, route instructions UI and route history may remain absent if their unfinished controls are clearly isolated from the real test path.
- An unsigned Simulator build cannot prove physical-device permissions, App Attest or distribution behavior; that is intentionally a later gate, not evidence of failure in this milestone.
- The build emits iOS 26 deprecation warnings for `CLGeocoder` and `cancelGeocode()`. They do not block local execution, but migration to MapKit geocoding should land before public release with equivalent cancellation/context tests.

### Required internal test pass

Already satisfied: Debug/Release Simulator build, all deterministic `TrailMindTests` (177 pass, two live skips), all 115 normal backend tests, dependency advisory check, clean cold launch and returning-user Home observation.

Still required:

- Make the opt-in live tests demonstrably execute rather than skip; then record live intent and route-quality fixture outcomes without logging secrets or user location history.
- Add automated UI coverage for onboarding, text submission, clarification, generating, suggestions, detail, service failure and Saved-state boundaries.
- Manual/physical when available: voice denial/grant/cancel, point-to-point, loop, multiple suggestions, detail map, save/remove/reopen, network failure, provider failure, cancellation and retry.
- Secret checks: tracked files, Git history and built app/archive, using scanners that do not dump secret contents into logs.

### Exit criteria

- S-01 rotation evidence in `SECURITY_AND_PRIVACY.md` is satisfied.
- Clean Debug/Release Simulator builds and deterministic automated tests remain green from a clean checkout. **Currently satisfied.**
- One real point-to-point and one real loop complete end to end on the supported local setup.
- Missing backend/provider configuration fails safely and never silently returns a user-believable real result.
- No crash, dead navigation, uncaught error or secret-bearing log in the exercised path.

### Can remain deferred internally

App Store metadata, paid membership, public privacy policy, distribution signing, full accessibility matrix, active navigation, real AI edits, Explore, accounts and offline maps.

## Milestone 2 — Useful closed beta

### Purpose

A small invited group can use TrailMind to plan, compare, save and hand off real outdoor routes, understand the limitations, and provide feedback without being shown invented route facts or unusable primary actions.

**Current completion estimate: ≈36%.** Real core capability exists, but route-truth, production security/privacy and signed-device gates prevent a useful beta today.

### Beta scope recommended

- Same-day hiking, trail-running and biking point-to-point routes.
- Same-day loop routes with real geometry and 1–3 comparable options.
- Supported prompt constraints: start/end, activity, loop/point-to-point, distance, duration and a narrow set of preferences clearly labelled as requested.
- Route comparison using distance, duration, elevation and mapped path characteristics.
- Real detail map, Save/reopen/delete, safety review and a genuine named-file GPX share.
- Text plus current Apple Speech transcription if its privacy/runtime pass succeeds.
- No active navigation, verified POI/weather/water/closures, overnight planning, fake AI editing or developer Explore tab.

### Required functionality and current completion

| Area | Current evidence | Estimated beta completion | Blocking work |
|---|---|---:|---|
| Real planning coordinator | Strong dynamic path; Home examples bypass it | 70% | Route every entry point through the real coordinator; implement clarification-in-context. |
| Real route quality/truth | Real stats/geometry/path facts; requested difficulty and `% match` can be presented as facts | 55% | Fix difficulty semantics, remove arbitrary match percentages and all mock outputs. |
| Comparison | Three consistent cards, route-shape thumbnails and variant labels | 75% | Add explicit measured deltas; confirm long-route thumbnail performance. |
| Detail and safety | Map, verified facts, preferences and disclaimers are strong | 70% | Remove fake edit/start; fix hard-coded location and loop marker; expose only useful sections. |
| Save/return/export | Local Save is real; fake Home recents and broken GPX handoff | 55% | Real recent Saved section or none; named GPX file/errors; delete-all/privacy decision. |
| Voice | Implementation and model tests exist | 65% | Physical-device speech/permissions/interruption/privacy pass. |
| Backend security | Strong code/tests and fail-closed architecture | 50% | Provider timeout/cancel, safe intent errors, production configuration, trusted edge identity, real DB/deployment proof. |
| App Attest | Comprehensive client/server implementation and unit tests | 45% | Paid/signed physical-device staging proof and production-environment TestFlight proof. |
| Privacy/legal | Purpose strings and data-minimizing code exist | 20% | Consent/policy/labels/manifest report, retention/deletion, AI/Apple/GraphHopper/OSM disclosures and attribution. |
| Product shell | Premium visual foundation | 45% | Remove developer/demo/placeholder/unsupported UI and rewrite onboarding/examples/Profile. |
| QA | 177 deterministic iOS tests and 115 normal backend tests pass; no UI target and both live-evaluation checks skipped | 45% | Fix live-test plumbing, add critical-path UI tests and execute device/accessibility/network/performance matrix. |

### Closed-beta blockers

All are required unless the affected feature is removed from the beta build:

1. Close the Critical credential incident.
2. Fix factual difficulty, remove arbitrary percentage match scores, and enforce route provenance at Save/export boundaries.
3. Remove or Release-gate Home mock planning, fake recent route, Explore demo/mock catalogue and mock AI edit; migrate or quarantine already saved unverifiable records.
4. Remove the placeholder Start route action or replace it with a real, accurately labelled handoff.
5. Fix GPX as a named, valid file with error handling—or remove it from scope.
6. Rewrite onboarding/examples/Profile to match implemented behavior.
7. Implement inline clarification and consistent real planning for every entry point.
8. Add bounded AI-provider timeout/cancellation, production fail-closed configuration, safe intent errors and trusted edge identity.
9. Prove deployed staging PostgreSQL/migrations/RLS/TLS/pruning and provider quotas.
10. Prove App Attest on signed physical devices against staging. If TestFlight is used, also prove production App Attest environment behavior.
11. Publish at least a beta privacy notice covering prompts, Apple Speech, geocoding/routing providers, saved route geometry, App Attest identifiers, retention/deletion and support contact. If remote AI is enabled, add explicit in-app permission before provider sharing.
12. Run the beta manual/accessibility/device/network suite and add UI automation for the critical path.

### Non-blocking beta issues

- Full in-app navigation, off-route detection and live route progress are not required if the Start CTA is absent and the planning/export boundary is explicit.
- A normalized-shape thumbnail is sufficient for beta if it remains performant; cached basemap snapshots can follow after observed user need.
- Rich side-by-side comparison is desirable, but consistent measured deltas on the existing cards are sufficient for the first beta.
- Preference persistence, route-history search, folders and cloud sync can wait if the app does not expose nonfunctional settings.
- Dark appearance, localization and iPad can be limited to an explicitly narrow beta device/language scope; all become public gates if the public metadata supports them.
- Remote AI parsing can remain disabled; a reliable local parser with truthful capability copy is acceptable for beta.

### Required beta test matrix

Functional:

- German and English supported prompt examples; point-to-point and loop for each activity.
- Exact, under-target and over-target distance; duration; easy request that returns a harder route; no-route and ambiguous-place cases.
- 1/2/3 suggestions, exact-duplicate rejection, pairwise overlap/diversity thresholds, fallback loop, provider flexible-mode rejection and timeout.
- Save/reopen/delete/corrupt record, valid GPX export/import, app relaunch and onboarding reset.

Security/privacy:

- Full App Attest registration/assertion/session/replay/budget flow on physical devices.
- Production dependency fail-closed behavior and real Postgres concurrency tests.
- Provider timeout, cancellation, response-size and rate/cost limits.
- Log review proving no prompt, exact coordinates, token, challenge, assertion, key or raw provider body is recorded.
- Consent/disclosure and local-only fallback, if AI parsing is enabled.

UX/accessibility:

- VoiceOver journey; largest Dynamic Type; Reduce Motion; Increase Contrast; Button Shapes; permission denied/restricted; keyboard/dictation.
- Small supported iPhone, current flagship iPhone, iPad layouts/orientations where declared, poor network, airplane mode and background/foreground transitions.
- Map/thumbnail responsiveness for long geometry; scrolling with three cards; memory and energy sampling.

### Beta exit criteria

- At least the agreed closed-beta critical path passes on every supported test device/build channel.
- Zero production-reachable invented route geometry/stats/claims and zero dead primary CTAs.
- Physical App Attest and deployed route service have repeatable evidence, monitoring and an incident owner.
- Privacy notice/consent matches observed traffic and testers can delete local saved data.
- No open Critical/High finding; Medium findings have a named public-launch disposition.
- Testers can independently complete: describe → clarify if needed → compare → inspect → save → reopen → export/share.

### Explicitly deferred beyond beta

In-app navigation/off-route detection, offline maps, weather/closures/water/viewpoint/overnight intelligence, accounts/cloud sync, real conversational route edits, public Explore, monetization and Apple Watch. Remove their CTAs rather than shipping placeholders.

## Milestone 3 — Public App Store release

### Purpose

A signed, production-operated, review-ready app delivers exactly the route-planning experience shown in metadata, with complete privacy/legal disclosures, reliable backend authorization, accessibility and support operations.

**Current completion estimate: ≈18%.** This is gate-weighted and includes the unresolved closed-beta work, not merely the remaining App Store paperwork.

### Required functionality and current completion

| Workstream | Current state | Public exit criterion |
|---|---|---|
| Apple program/signing | `DEVELOPMENT_TEAM` is empty; no distribution evidence | Enrolled team, explicit App ID/capabilities, signing/profiles, App Store Connect record, production App Attest and archived entitlement verification. |
| Privacy | No policy link, App Privacy details or manifest/report evidence | Public policy in-app and metadata, accurate labels, valid privacy report/manifest, consent/withdrawal/deletion paths. |
| Legal/data sources | In-route source sentence only | Verified GraphHopper terms and visible OpenStreetMap ODbL attribution/link; MapKit attribution preserved; support/terms ownership recorded. |
| Store product truth | No App Store package audited | Description, subtitle, screenshots, preview, category and review notes show only released behavior and planning-aid limitations. |
| Accessibility/localization | Static partial evidence only; forced light; no localizations | Supported locales, appearance and accessibility matrix pass; no clipping or inaccessible primary control. |
| Production operations | Backend code exists; deployed state unverified | Health/latency/error/cost monitoring, quotas, backups/restore, key rotation, pruning, incident playbooks and support ownership. |
| Release quality | Unit tests broad; no UI test target or archive evidence | CI clean build/tests, UI smoke suite, TestFlight soak, crash-free target, performance budget and exact archive inspection. |
| Review readiness | Developer/demo surfaces remain | No demo/beta/placeholder/dead content; backend remains live for review; clear non-obvious feature notes. |

Apple’s current guidelines require accurate metadata, a live backend for review where needed, and an in-app plus metadata privacy-policy link: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/). OpenStreetMap attribution must be made visible with access to the ODbL: [OSMF Attribution Guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines).

### Public blockers

- Every closed-beta blocker and every open Critical/High security finding.
- Paid Apple Developer Program and verified production signing/App Attest.
- Missing privacy policy, App Privacy details, required privacy-manifest/report evidence and third-party AI consent (if enabled).
- Missing data-source licensing/attribution evidence.
- Developer/demo/mock/placeholder UI or unsupported App Store claims.
- No TestFlight soak, no critical-path UI automation and no accessibility/device/release-archive pass.
- No production ownership for provider cost, backend/database outage, credential rotation and user support.

### Non-blocking public issues

- In-app active navigation is non-blocking if the app is marketed and designed as a planner/export tool and no Start-navigation control remains.
- Explore discovery, accounts, cross-device sync, Apple Watch, route recording and monetization are not required for the proposed v1 value.
- Cached geographic thumbnails and advanced comparison are improvements rather than public blockers if the existing route shapes and measured deltas are clear and performant.
- Remote generative intent parsing is optional; public copy must match whichever local/remote parser actually ships.

### Required public tests

- Clean Release build, archive and install using the production configuration and intended signing team.
- Full Swift/backend automated suites plus critical-path UI automation on the exact release candidate.
- TestFlight soak covering onboarding, text/voice planning, clarification, point-to-point, loops, comparison, detail, Save/reopen/delete and GPX handoff.
- Physical-device App Attest production-environment registration/assertion/session/replay/budget tests against the deployed backend.
- Small/large supported iPhone and any declared iPad orientation; VoiceOver, largest Dynamic Type, Increase Contrast, Reduce Motion, Button Shapes, keyboard/dictation and permission states.
- Poor network, offline, cancellation, provider timeout/rate-limit, backend/database outage and recovery tests.
- Long-geometry map/thumbnail scrolling, memory, launch, energy and file-persistence performance checks.
- Exact archive privacy report/manifest, entitlement, bundle-resource, binary/string and secret scan.
- Observed traffic/log/privacy test proving consent and disclosure match every provider and no sensitive values enter diagnostics.
- Database migration/backup/restore/pruning drill and provider credential-rotation/incident drill.

### Public exit criteria

- Exact submitted archive is the TestFlight-soaked build and passes signing, entitlement, secret, privacy-resource and debug-fixture inspection.
- All automated suites and agreed manual matrix pass; no open severity-1/2 crash, data-loss, route-truth or authorization defect.
- Every visible claim is demonstrable in the review build; every unavailable roadmap feature is absent from product/metadata.
- Production backend/database/providers are monitored, budgeted, backed up and recoverable; failure modes remain safe and comprehensible.
- Privacy policy, labels, consent and deletion have been checked against actual network/file/log behavior.
- App Review notes explain that TrailMind is an AI-assisted/local-parser planning aid, identify its routing/data providers, and state that active navigation/weather/closure/safety guarantees are not included.
- Support URL/contact, terms/licence acknowledgements, version/release notes, icon, screenshots and age/content declarations are complete.

### Features explicitly deferred from public v1

- Active turn-by-turn navigation, off-route detection, route recording and offline maps.
- Verified weather, closures, daylight, water, shelters, viewpoints, legal camping and public-transport intelligence.
- Multi-day expedition planning and overnight logistics.
- Accounts, cloud sync, community/social features, challenges, monetization and Apple Watch.
- Broad conversational route editing; a future version may begin with real-routing-backed “shorter” and “less climb” edits.

## Paid Apple Developer membership — separate dependency list

Apple currently lists the Apple Developer Program at **US$99 per membership year** (local pricing may vary) and associates membership with Certificates, Identifiers & Profiles, DeviceCheck capabilities, TestFlight and App Store distribution: [Membership Details](https://developer.apple.com/programs/whats-included/).

### Work that can proceed before paid membership

- Fix all source-level truth, security, privacy and UX issues in this audit.
- Build and run iOS Simulator configurations; execute Swift unit tests and add a UI test target.
- Run the backend locally, complete Node tests, deploy a staging backend/database if separately authorized, and implement monitoring/runbooks.
- Draft the privacy policy, terms, data inventory, retention/deletion policy, App Privacy answers, review notes, support content and attribution surface.
- Add and validate `PrivacyInfo.xcprivacy` based on an Xcode privacy report; prepare metadata and screenshots from the real app.
- Perform accessibility, Dynamic Type, localization, performance, network and failure testing on available environments.
- Use limited Personal Team device testing where Xcode permits it, but do **not** treat that as evidence of TestFlight/App Store signing or production App Attest.

### Work that depends on paid membership/team access

- Establish the verified developer/team identity and accept current agreements.
- Register the explicit production App ID and bundle identifier; configure DeviceCheck/App Attest and any other capabilities.
- Set the correct Team/App ID prefix and production backend verifier values; create development/distribution certificates and provisioning profiles as appropriate.
- Produce correctly signed device, Archive and distribution builds using the intended team.
- Create/manage the App Store Connect app record, users/roles and distribution workflow.
- Upload to TestFlight, invite internal/external testers, complete beta review where required, and verify that TestFlight uses the production App Attest environment. Apple documents the environment behavior here: [App Attest Environment](https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.developer.devicecheck.appattest-environment).
- Enter App Privacy details, age rating, availability, support/privacy URLs and final metadata in App Store Connect.
- Submit the build for App Review and release it through the approved distribution channel.

Membership does not block the bulk of engineering, privacy drafting or test preparation. It does block credible completion of the TestFlight/App Store signing and production App Attest critical path, so enrollment should occur before the team expects to declare the closed beta “distribution ready.”

## Critical path in execution order

1. **Contain:** rotate/revoke the exposed credential and verify no repository/archive leak.
2. **Make the product truthful:** remove Release mocks/dead CTAs, fix difficulty and match semantics, replace fake recents, rewrite onboarding/examples/Profile.
3. **Finish the closed loop:** consistent real planning, inline clarification, detail, Save/reopen/delete and valid GPX handoff.
4. **Harden intent/backend:** timeout/cancellation, fail-closed AI configuration, safe errors, trusted edge identity, response limits.
5. **Prove infrastructure:** real PostgreSQL/migrations/TLS/RLS/pruning, staging deployment, provider quotas and safe logs.
6. **Enroll/configure Apple team:** App ID, App Attest, signing and backend relying-party values.
7. **Verify signed devices/TestFlight:** App Attest environments, route sessions, voice, network failures and critical-path UI/accessibility.
8. **Close public compliance:** privacy policy/consent/labels/manifest report, OSM/GraphHopper attribution, support/terms and metadata.
9. **Soak and submit:** exact Release archive, TestFlight soak, incident drill, App Review notes and submission.

## Recommended release boundary

The fastest credible public v1 is a **route planner and comparison tool**, not a navigator and not a general outdoor-intelligence copilot:

> Describe a same-day hike, trail run or bike route. TrailMind builds real route options from mapped paths, helps you compare their measured stats, and lets you save or export a plan for review.

Everything in that sentence must work from every visible entry path. Navigation, verified scenery/water/weather/closures, overnight planning and conversational route editing can follow later without weakening the v1 value.
