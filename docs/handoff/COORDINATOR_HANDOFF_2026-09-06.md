> Historical archive, reviewed 2026-10-01. This dated document is not current authorization, operational status, or release approval. Private device, signing and credential-storage identifiers have been omitted where present. See Draft PR #1 for the current candidate.

# Wanderful — coordinator handoff

Snapshot: 6 September 2026. This is a continuity document, not release approval. Recheck mutable facts before acting. No credential values are included.

## 1. Your job as the new coordinator

Be the user's senior engineering/product partner: maintain the roadmap, review actual outputs and diffs, coordinate independent tasks, integrate verified changes, and explain progress simply. Do not restart completed work or assume historical test totals prove today's app works.

User wants fast, high-quality delivery after weeks of infrastructure work. Avoid overengineering, tiny repetitive review prompts, unbounded test loops, and repeatedly recreating failed live-proof environments. Prioritize a real usable phone experience, then a secure deployable product and launch.

User prefers separate visible Codex tasks, each with its own branch/worktree—not hidden subagents. Usually two to four truly independent lanes, not four by default. Read task outputs directly via Codex task tools; do not ask the user to repeatedly copy them. Give narrowly owned, senior-level prompts, explicit acceptance tests and integration handoffs. Goal-driven iteration is welcome, but goals do not authorize unlimited calls, spending, deletion, deployment or repeated blocked checks. Create a goal only when requested. Use actual model/reasoning settings if the user requests them, not just words in a prompt.

Start read-only: inspect the two active tasks below and current Git state. Do not spawn replacement tasks, enable production, or perform another cleanup merely because this is a new conversation.

## 2. Original vision — keep this intact

The founder planned a real hike with ChatGPT, then manually rebuilt its suggested stops in Komoot. Wanderful should eliminate that transfer: describe an adventure naturally, clarify missing details, receive real route options with meaningful stops, compare them, and navigate within the same iPhone app.

Product sentence: “Tell Wanderful what kind of adventure you want. Wanderful builds the route.” Technical code/repository names still often use TrailMind/EasyWander.

The desired experience is Apple-native and calm, not a GIS tool or generic chatbot: voice/text planning, a short useful back-and-forth when needed, personalized hiking preferences, trustworthy highlights and explanations, real maps/stats, saved routes, and reliable navigation. Future research uses both licensed external sources and a provenance-aware internal database that improves through reviewed updates and consented feedback—not automatic truth from popularity or LLM outputs.

Reliability is more important than impressive-sounding recommendations. Gemini understands/plans; GraphHopper calculates geometry. Neither proves safety, current access, legal camping, drinkable water or scenic quality. Requested preferences must remain distinct from verified evidence. Never scrape competitors or use public Overpass as a production dependency.

## 3. Course correction and immediate objective

The regional OSM/PostGIS/research architecture is substantial, but operational gates repeatedly prevented real phone use. Do not discard it; do not make it a prerequisite for the first functional LLM-assisted route test either.

IMMEDIATE milestone: the founder's existing physical iPhone, installed via Xcode with a free Apple Personal Team, can submit text, have Gemini understand it, resolve/clarify location, obtain a real GraphHopper route, see actual geometry/stats, and exercise existing navigation. Verify microphone permission/cancel/no-crash too.

First test path: iPhone → temporary authenticated HTTPS endpoint → single Mac-hosted backend → Gemini intent parsing and GraphHopper routing → shipping decoder/quality pipeline → iPhone.

This temporary setup requires the Mac and tunnel to remain running. It is NOT a Vercel production deployment, App Store build, full regional evidence activation, proof of safe hiking, or complete field navigation validation.

Then finish isolated persistent hosting and authentication, test on real hardware, resolve launch blockers, and launch only what actually works. The user wants the planning engine enabled and useful, not a shell with everything off.

## 4. Active tasks — authoritative IDs

### A. iPhone lane

- Title: Connect and verify Wanderful on Piro’s iPhone
- Task ID: `01a07687-a8f5-7a93-aad1-97fc0f599f36`
- Host: `local`
- Task output directory: `/Users/piroscheibe/Documents/Codex/2026-09-06/wanderful-private-iphone/outputs`
- Actual worktree: `/private/tmp/Wanderful-Private-Owner-Phone-20260906`
- Branch: `codex/private-owner-phone-test-20260906-ios`
- Base: `3f38e17eed44e767681d482b7f29638769fb7551`
- Owns Swift owner-only configuration/auth compatibility, focused tests, signing/build/install and phone UX verification. Does NOT own backend.
- Latest confirmed: signed physical-device build succeeded using existing cached profile; focused test bundle compiles. Runtime tests, connected live installation/test and synthetic route acceptance are still pending. No provider calls reported by this task at snapshot.
- It found actual installed app ID `com.piroscheibe.wanderful.local`. Parent approved an exact owner-Debug-only allowance for this verified ID (and matching local environment), not arbitrary IDs or Release changes.
- Parent preparation had unnecessarily required `com.trailmind.app.local`. Reusing the existing valid profile avoided unnecessary new account setup. Agent is also correcting matching AppEnvironment owner-only checks and rejected-token invalidation.
- Phone loop search makes two concurrent requests and can use fallback requests. Agent asked backend to serialize bounded admission rather than reject normal concurrent app behavior.

### B. backend lane

- Title: Private Gemini 3.8 backend — local checkout
- Task ID: `01a0768f-eeaf-70d0-afe4-3206a0642123`
- Host: `local`
- Task output directory: `/Users/piroscheibe/Documents/Codex/2026-09-06/wanderful-private-backend/outputs`
- Must create/use its own worktree/branch from same exact base; read its output for actual path.
- Owns backend owner-test server/session/launcher, model config, focused backend tests, temporary authenticated HTTPS, private handoff. No Swift, Xcode, Supabase or production deployment.
- Latest confirmed: claims exclusive backend ownership, checks passed that old duplicate task is not active; working on durable counts of actual upstream attempts including retries so restart cannot reset live budget. No live provider outcome yet established.
- Both tasks have each other's IDs and have been instructed to coordinate directly before token generation and live requests.

### Important pending-create hazard

An earlier project-based create_thread request titled `Private Gemini 3.8 backend for iPhone testing` never returned an ID and remained pending in the old coordinator's functions cell `137`. Do NOT assume it is running or create another backend task. The active backend above is a projectless fallback using the durable local checkout. If the delayed earlier task ever appears, stop/redirect duplicate backend execution. Both tasks know this. The original request includes a duplicate-work gate.

Old coordinator task ID: `019f64cd-6963-7fd3-98eb-3420ad438965`.

## 5. Git and storage — critical to avoid losing work

Saved project: Wanderful, project ID `local-984081efadb608bc914ae14dab09b6b4`, path `/Users/piroscheibe/Documents/EasyWander`.

That Documents repository has suffered iCloud/File Provider offloading and Git/Xcode coordination hangs. Broad status/search/build operations there can stall. New tasks intentionally start outside it and create isolated worktrees from the durable integrated checkpoint.

Newest known integrated base for CURRENT tasks:

- Commit `3f38e17eed44e767681d482b7f29638769fb7551` — Add isolated owner phone testing connection.
- Local branch `codex/private-owner-phone-test-20260906`.
- Durable repository `/Users/piroscheibe/Wanderful-Checkpoint-20260905` contains this branch, though its checked-out branch may still be prior integration at `efe4dc8f6817f501e625492ee3c80727f50946b8`.
- Working checkpoint `/private/tmp/Wanderful-GitHub-Checkpoint-20260905` contains current base as well.
- The prior integrated checkpoint includes navigation, StoreKit, LLM, voice/phone reliability and other reviewed lanes. Verify exact current commits rather than treating a clean old remote as latest app.

GitHub: `Piro-git/WANDERFUL`. Latest previously observed remote main was `adea2c08540e87f0acd7eebb976c72eab8eb76c3`; recheck before publication. All current integrated work is NOT confirmed on GitHub. User requested private publication; repository was previously public and visibility change was not verified. Do not push sensitive operational metadata/public history casually. Some older bootstrap receipts contained operational metadata and were excluded from a prepared final public tree but remain in local historical commits. Reassess repository visibility and final diff before fulfilling the eventual “push everything” request. Do not lose unpublished local branches.

Free space declined from roughly5–6GiB to2.6GiB during device builds. Read actual current space. Retained shared cache `/private/tmp/TrailMindDerivedData-EntitlementV2` is used by phone task. No additional broad builds, PBF downloads or database provision needed now. Do not delete caches while another task uses them. Prior cleanup authorization was bounded and already consumed: do not generalize it. Preserve Planua, Xcode, source, receipts, user data and current task outputs.

## 6. Credentials and security

User explicitly copied Google Gemini and GraphHopper keys for private backend setup. They were transferred without displaying values, saved outside repositories, and clipboard cleared after each successful transfer.

Private local credential path: `[private local credential path omitted]`.

- Directory0700; file0600; current-user owned; no symlink; single hard link; no extra ACL grants observed.
- Contains AI_PROVIDER=google, GOOGLE_API_KEY and GRAPHHOPPER_API_KEY. It had no GOOGLE_MODEL override when stored.
- This is PLAINTEXT owner-only storage, not Keychain or an encrypted vault. Do not describe it as unhackable. Malicious code running as same user could read it. FileVault status could not be verified.
- Check before GraphHopper addition found no Gemini exact-value matches across1390 source files and265 available app-build files, no skipped/unreadable files. This is a scoped check, not a guarantee about all disks/backups.
- No provider key was uploaded to Vercel or bundled into iPhone by parent. Neither key was tested by parent.
- Keys may be read only by the scoped backend runtime for authorized setup, never printed, hashed into reports, passed in command arguments, committed, placed in phone resources or copied into messages.
- Never inspect `Configuration/Local.xcconfig`. Never paste keys into prompts. New coordinator does not need secret values.
- Future production provider keys belong server-side in managed secrets/protected environment settings. Phone holds only its scoped session credential, ideally Keychain. macOS Keychain is stronger local persistence, but do not stall first testing with a new secret framework or insecure key-as-CLI-argument migration.

Current task live budget: conservative combined maximum5 Gemini generations and10 GraphHopper upstream calls across BOTH tasks, retries included. One session, no resetting/reusing budget across restarts, no hidden probes. No paid upgrades, credits purchases, subscriptions or broad authorizations. Backend owns actual accounting, phone obtains remaining counts before calls. Stop on billing/access denial or repeated rate limit.

OwnerPhoneTest.json handoff must contain ONLY HTTPS baseURL, temporary owner token and expiry, outside Git in0700/0600 storage. Coordinate issue time with phone build readiness (2h expiry). Exchange artifact PATH, not token contents. Incorporate before code signing; never insert provider keys. Revoke/stop backend+tunnel at agreed test end. Ordinary Release/AppAttest settings stay unchanged.

## 7. Current code architecture relevant to this milestone

Base3f38e17 added:

- `TrailMind/Services/OwnerPhoneTestConfiguration.swift`
- `TrailMindTests/OwnerPhoneTestConfigurationTests.swift`
- `backend/scripts/owner-phone-test-session.js`
- `backend/scripts/owner-phone-test-server.js`
- `backend/scripts/start-owner-phone-test.js`
- two focused backend tests, `docs/OWNER_PHONE_TESTING.md`, `.gitignore` protection for private JSON.
- Narrow integration into AppAttestService, IntentParsingFoundation, RouteSessionService.

Owner Swift types guarded with `#if DEBUG && WANDERFUL_OWNER_PHONE_TEST`. Base config demands local environment, exact approved bundle identity, bounded JSON and HTTPS URL/token/expiry. Current phone agent is adjusting exact identity to the installed owner app. Release must exclude owner path even if someone accidentally defines owner macro without DEBUG.

Backend base single-process owner server listens127.0.0.1:48173, authenticates before parsing/provider work, restricts endpoints, has random32-byte token,2h expiry, replay defense, request/weighted caps, bounded timeouts. It never imports production AppAttest bypass into shipping server. Current backend agent is improving live accounting and serialized request handling.

Current default in `backend/src/intentSchema.js`: `gemini-3.5-flash`. Google adapters accept env.GOOGLE_MODEL override, use x-goog-api-key header and Interactions structured outputs. User explicitly approved `gemini-3.8-flash` for new private session. On6Sept2026 Google's official page listed it stable/GA and supported structured outputs; agents must verify API compatibility and actual key quota/access. Sources: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash and https://ai.google.dev/gemini-api/docs/latest-model?hl=en . Do not confuse saved key with activated model.

Existing iOS path: `/api/parse-intent` → client location intelligence/clarification → `/api/route` → GraphHopper decoding and route-quality selection. Combined backend `/api/llm-plan-route` exists but no integrated iOS caller was found. Full research-guided database pipeline is a separate feature, not automatically active because Gemini parsing works.

LLM understanding may be wrong. Never claim automatic scenic/safety/access validation from structured output or routing. Test broad location questions, actual stats and honest uncertainty.

## 8. Device/build specifics

- Physical owner phone, iPhone17Pro, model iPhone18,1.
- Last devicectl ID `[device identifier omitted]` (rediscover).
- Free Personal Team `[personal signing team omitted]`, existing installed local app `com.piroscheibe.wanderful.local`.
- Cached existing development profile valid until9Sept2026 according to phone task. Recheck expiry when resuming.
- Actual manual profile override failed; automatic cached profile selection without account updates succeeded in signing device build. Do not unnecessarily ask user to enroll paid program now.
- Use required build-ios-apps skills for any iOS work; physical actions requiring unlock/trust belong to user.
- Preserve inherited OTHER_SWIFT_FLAGS and append owner define. Replacing SWIFT_ACTIVE_COMPILATION_CONDITIONS previously broke Swift package compilation.
- Simulator tests require applicable skill permission; do not erase/boot indiscriminately. Physical microphone/location permission testing requires user consent and system permission dialogs.
- Do not uninstall/erase existing phone app data to get green tests. Do not claim simulated route progress proves reliable outdoor navigation or offline capability.

## 9. Hosting and database situation

Vercel is connected and parent inspected authenticated dashboard. Target existing project:

- Team `[Vercel team ID omitted]`, slug `[Vercel team slug omitted]`, Hobby plan.
- Project `backend`, ID `[Vercel project ID omitted]`.
- Dashboard [private project settings URL omitted]
- Old deployment [historical deployment ID omitted], July14 commit c0c13e9..., Node24, READY production but NOT current integrated app backend.
- Alias backend-zeta-amber-69.vercel.app; /healthz returned404 on inspected deployment.
- No Git link observed. Project had only Production database/Supabase/AppAttest variables, no Gemini/GraphHopper/AI_PROVIDER variables and no linked shared vars. Values were NOT revealed.
- Vercel MCP project/deployment inspection works, but no env management tool was available; dashboard inspected via Chrome. CLI was not installed/authorized. Do not invent tools or blindly pull all production secrets.
- No environment variable/upload/deployment modifications made by parent.
- Temporary single-process owner budgets CANNOT be transplanted unchanged to stateless/scaled Vercel functions; durable auth/budget behavior must be solved before persistent deployment. This is why immediate test uses Mac+HTTPS tunnel.
- Planua and unrelated Vercel/Supabase projects are out of scope.

Historical Supabase project authorized: exactly TrailMind Outdoor Staging V1, ref mbvzwsrtqcrwhvykugcd, free-cost constraint. User once explicitly authorized migrations001–007,009,010 and PROHIBITED008 for that managed target. Do not extrapolate older local008 tests into permission to apply008 there. Current deployed state has not been freshly audited in this handoff; inspect actual recent task/code evidence before making claims. No regional DB work is required for current phone test.

## 10. Roadmap and honest launch checklist

Implemented/reported across reviewed checkpoints, but verify integrated behavior: native iOS shell/branding, real routing, location clarification, route-quality heuristics, intent/research contracts, OSM/PostGIS evidence architecture, bounded research planner/executor/candidate adapters, disabled client/coordinator/UI seams, saved/export features, navigation work, onboarding/account/paywall groundwork and release checks. Many tests passed over time; not equivalent to a proven live launch candidate.

Immediate acceptance checklist:

- [ ] Gemini3.8 is explicitly selected and one real structured response succeeds.
- [ ] Real authenticated HTTPS reachable from iPhone; wrong/expired access rejected before providers.
- [ ] One actual requested route shown with real geometry/stats; shortfall labels honest.
- [ ] Clarification for broad/ambiguous location works; retry/cancel behave.
- [ ] Microphone/speech flow does not crash and respects permissions.
- [ ] Existing navigation entry/live progress tested on physical phone; field reliability still separately assessed.
- [ ] No provider key in app/source/log output; limited private session and clear expiry.

Next after phone milestone:

1. Review/merge both lane commits into correct integrated checkpoint, preserving all prior work; test the combined build. Confirm repository privacy and publish safe latest source so Windows work can use it.
2. Persistent authenticated hosting with durable usage controls, secure key configuration and minimal useful monitoring; verify end-to-end outside Mac. Do not enable production debug bypass.
3. Route-quality and actual hiking acceptance: sensible distance, reached highlights when claimed, low accidental repetition, honest difficulty/access uncertainty. Reuse existing benchmarks; no another infinite synthetic-proof project.
4. Bring back regional evidence research as supported operational capability, with coverage/licensing/freshness and no unsupported claims. User accepts starting without big paid database if LLM+real routing is genuinely useful and honest.
5. Separate independent lanes can finish account/sign-in/deletion, Superwall/StoreKit paywall/purchases/restore, and navigation reliability, after checking what is already integrated. Do not duplicate completed onboarding. Supabase is not App Store digital-purchase billing; Superwall config and StoreKit products require actual review.

App Store launch still needs verified paid Developer Program/signing/TestFlight when user chooses, real production auth/backend, privacy policy/support links and accurate data disclosures, account deletion if accounts enabled, real purchase/restore checks if monetized, release artifact permissions/entitlements/privacy manifests, no microphone crash/dead buttons, honest metadata/screenshots/attribution and physical critical-path testing. Check current official Apple docs when doing that work. Free Xcode installation does not prove those gates. Cookie banners are not automatically required for a native app; inspect actual web/tracking/data behavior rather than adding generic compliance UI.

User wants full ambition but fastest useful safe release: planning engine and reliability first; do not market “better than Komoot,” legal sleep spots, verified water, offline maps or complete navigation until evidenced.

## 11. First actions in the new coordinator chat

1. Read this handoff plus current repository AGENTS.md; note historical AGENTS descriptions can lag implemented source.
2. Use wait_threads/read_thread on the TWO exact active IDs above. Verify whether they remain running, need input, or finished; read outputs/diffs rather than trusting status labels.
3. Tell both tasks the new coordinator's task ID if needed. They should keep their existing worktrees/goals and coordinate directly; do not restart them.
4. Check delayed duplicate backend task hazard. Only one backend process/session should own the shared budget.
5. Give user a short status: what now works, what remains blocked, exact next user action. Do not demand new approvals for actions already in scope, or silently expand into production/payment/deletion.
6. When both lanes deliver, review relevant diffs and combined compatibility, integrate once, and perform the smallest real phone acceptance test. Then update this document or a short current status record.

### Late status update during handoff writing

Backend agent reports durable shared5/10 ledger and exclusive lock implemented, Gemini3.8 pinned, Google store=false, only parse-intent/route exposed,12 focused offline tests passing, official Cloudflare binary download underway. No token/provider calls yet. These are agent reports, not parent diff review.

Phone/backend agreed to serialize loop work in the owner-only iOS path to match strict server admission1; final incremental build is running. Device and test bundle compile; actual runtime XCTest still needs simulator boot permission under applicable iOS skill. Parent has NOT granted new simulator-boot permission on user's behalf. Existing-profile sign-in question is superseded; no new account needed based on successful build.

This document itself is newly created and not committed/pushed. It contains paths/IDs but no secret values. Keep a durable copy; /private/tmp task outputs alone are not durable history.

Latest phone report: local commit `6a51c9b65b9d85a97cc14b4c2f4e42ef1bdd3e63`, final device and arm64 test builds succeeded, signature verified; no push. Backend reports tunnel binary ready and is holding token/provider calls until coordinated window. Phone reports discussing a45-minute window with initial1Gemini+1GraphHopper synthetic check. Reconcile actual agreed window and current counters directly with BOTH tasks before user testing—do not assume these messages mean the check already ran. Microphone/location acceptance still needs user interaction/consent; simulator XCTest boot question is separate from whether a synthetic backend check can run.
