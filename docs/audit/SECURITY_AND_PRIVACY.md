# TrailMind Security and Privacy Audit

Audit date: 2026-07-15

Scope: iOS application, routing and intent clients, App Attest/session flow, Node backend, PostgreSQL persistence, configuration, tests, and repository documentation.

Method: static source/configuration review, reconciled with the companion `BUILD_AND_RUNTIME_REPORT.md`. No credential values were intentionally inspected or reproduced. That report proves Debug/Release Simulator builds, 177 passing deterministic iOS tests with two live checks skipped, 115 passing normal backend tests, and a crash-free cold launch. Deployed-backend state, real PostgreSQL state, live providers, provider dashboards, and physical-device App Attest behavior remain **CANNOT_VERIFY**.

## Gate decision

- **Development:** **NO-GO until S-01 is complete.** The credential that surfaced during this audit must be rotated before further provider-backed testing.
- **Closed beta:** **NO-GO** until S-02 through S-06 are resolved or the affected production paths are disabled, and physical-device/deployed-backend verification in S-07 passes.
- **Public App Store:** **NO-GO** until every Critical/High item is closed, all Medium public gates have evidence, a privacy policy and App Privacy disclosures are complete, and the release archive is inspected.

The security architecture is notably stronger than a typical prototype: routing keys are intended to stay behind a backend, route inputs are strictly validated, route authorization is tied to App Attest sessions, replay and weighted budgets are implemented transactionally, provider responses are allowlisted, and route logging excludes exact coordinates and prompts. The current blockers are operational verification, privacy/product truth, and several narrower backend hardening gaps rather than an absent security model.

## Severity and gate definitions

| Severity | Meaning |
|---|---|
| Critical | Active or presumed credential compromise, or an issue requiring immediate containment. |
| High | Plausible user-safety, confidentiality, integrity, or availability failure that blocks beta/public use. |
| Medium | Material hardening, privacy, or operational-control gap that must be closed before the listed gate. |
| Low | Defense-in-depth or contained-quality issue. |
| Informational | Confirmed strength, assumption, or follow-up that is not itself a vulnerability. |

Gate notation used below: **D** = development, **B** = closed beta, **P** = public App Store.

## Data flow and data inventory

| Data | Where it originates | Where it goes | Current persistence | Privacy significance |
|---|---|---|---|---|
| Natural-language route prompt | Text composer or live speech transcript | Local parser; the backend AI endpoint can forward it to Google Gemini or OpenRouter | No prompt persistence was found in route records or safe route logs | A prompt can reveal precise places, routines, health/fitness context, or travel plans. Third-party AI sharing needs explicit, accurate disclosure and permission before enablement. |
| Voice audio | Microphone after system permission | Apple Speech framework; code comments state that Apple may process speech | Raw audio is not retained by TrailMind code | Explain Apple speech processing in the privacy policy and keep the permission just-in-time. |
| Start/end coordinates and returned geometry | Apple geocoding and GraphHopper | TrailMind backend, GraphHopper, device UI | Exact geometry is persisted for Saved routes in Application Support | Location and route plans are sensitive. Files use atomic writes and iOS complete-file protection, but backup/retention/deletion behavior is not documented to the user. |
| App Attest key identifier and local installation identifier | DeviceCheck / local app | TrailMind backend | Key ID is stored in Keychain; server stores hashes/installation state, public key and receipt | Persistent security identifiers require access control, retention, deletion, backup and residency decisions. |
| Route-session token | TrailMind backend | iOS memory and authorization header | Client cache is in memory; server stores a hash with expiry/budget | Stronger than persistent bearer-token storage; still redact from all logs and diagnostics. |
| Safe operational route metadata | Backend | Backend logger | Deployment-dependent | Current route logger is deliberately coarse and excludes prompts, coordinates, bodies, headers, keys and provider URLs. Preserve this invariant. |

## Findings summary

| ID | Severity | Gates | Finding | Required disposition |
|---|---|---:|---|---|
| S-01 | **Critical** | D/B/P | An ignored local GraphHopper credential surfaced in the audit tool transcript. | Rotate and invalidate it immediately; treat the transcript as sensitive; verify usage and archive contents. |
| S-02 | **High** | B/P | Requested difficulty can replace computed difficulty and be presented as an actual route fact. | Derive the displayed difficulty from returned route data; present the requested difficulty separately as intent. |
| S-03 | **High** | B/P | Production-reachable mock route/edit behavior can produce invented stats or claims without changing geometry. | Remove/Debug-gate the flows or implement real rerouting; never present mock output as an outdoor plan. |
| S-04 | **High** | B/P | AI-provider requests have no enforced timeout and do not forward cancellation. | Add a bounded abort controller, merge client cancellation, cap response size, and test lease release. |
| S-05 | **High (conditional)** | B/P | Enabling remote intent parsing would send prompts to third-party AI without in-app disclosure/permission or a privacy policy. | Keep disabled until explicit consent, provider/retention review, policy, and App Privacy disclosures exist. |
| S-06 | **High** | B/P | Missing AI provider keys silently produce deterministic mock intent rather than failing closed. | Allow mocks only under an explicit local/test flag; production must return a stable configuration error. |
| S-07 | **High** | B/P | Production App Attest, signing identity, durable database and deployed backend are unverified. | Complete signed physical-device and deployed integration evidence before real testers. |
| S-08 | **Medium** | B/P | Intent errors can return raw provider response excerpts and internal error strings. | Map to stable safe error codes/messages; keep provider details in redacted server-only diagnostics. |
| S-09 | **Medium** | D/B | Debug intent base URLs accept cleartext HTTP on non-loopback hosts. | Permit HTTP only for exact loopback; require HTTPS elsewhere. |
| S-10 | **Medium** | B/P | Vercel edge identity falls back to the server socket address without a verified trusted-proxy resolver. | Resolve a platform-authenticated client identity defensively and test proxy/header behavior. |
| S-11 | **Medium** | B/P | PostgreSQL TLS, production access controls, backup, region, retention and cleanup scheduling are configuration-dependent and unverified. | Enforce encrypted connections and produce operational evidence; schedule pruning. |
| S-12 | **Medium** | P | No app privacy manifest/report, in-app privacy policy, or App Privacy label evidence exists. | Generate the Xcode privacy report, add a valid manifest as required, and publish consistent disclosures. |
| S-13 | **Medium** | P | OpenStreetMap attribution is textual but does not visibly provide the expected licence link/placement evidence. | Add compliant attribution and verify GraphHopper/OSM terms for every public route/map surface. |
| S-14 | **Low** | P | Saved exact route geometry has no documented backup exclusion, retention policy, or delete-all control. | Decide and disclose backup behavior; add clear local-data deletion. |
| S-15 | **Low** | B/P | GPX XML interpolates the route title without XML escaping and silently shares an empty string on export failure. | Escape XML and export a named `.gpx` file with an explicit error state. |
| S-16 | **Low** | B/P | Successful GraphHopper responses have structural validation but no explicit response/coordinate-count ceiling. | Enforce byte and collection limits before mapping/sanitizing. |

## Required security-control checklist

This table records the result of every security check named in the audit brief. “Pass” means the repository design/source supports the statement; it does not prove the deployed environment or final archive.

| Required check | Evidence-backed result | Disposition |
|---|---|---|
| GraphHopper API keys | Default iOS routing uses the backend and no key field is in the app Info.plist. A local ignored/untracked credential nevertheless surfaced in this task transcript. | **Critical S-01**; rotate now, then inspect history/archive. |
| OpenRouter / Google AI keys | Provider code reads backend environment variables. No corresponding key value or client-bundle field was found. Deployed environment is **CANNOT_VERIFY**. | Informational strength; preserve backend-only storage and rotation. |
| Supabase keys / database credentials | No Supabase client integration or public client key was found. PostgreSQL is selected from backend-only `DATABASE_URL`/`POSTGRES_URL`; no value is committed in the reviewed configuration. | **Medium S-11** for deployed TLS/access/retention evidence. |
| Hard-coded secrets / source control | Local secret config is ignored and untracked; tracked source uses variable names/examples. A Release archive and full Git-history secret scan were not run here. | S-01 containment plus required development/public scans. |
| Keys in `.xcconfig` / bundle resources | `Shared.xcconfig` contains backend URLs and optionally includes ignored `Local.xcconfig`; Info.plist contains no GraphHopper key. The final archive is **CANNOT_VERIFY**. | S-01; inspect exact Release archive before distribution. |
| Secret logging | Safe route logging excludes keys, authorization and provider URLs. Debug loop rejection can print localized errors, and intent errors return upstream detail. | **Medium S-08**; keep all provider detail redacted. |
| Full prompt logging | No route/intent logger storing raw prompts was found; backend documentation explicitly prohibits it. AI providers receive prompts when remote parsing is enabled. | **High conditional S-05** for disclosure/permission; verify deployed logs. |
| Precise-location logging | Route safe metadata deliberately excludes exact coordinates. Saved routes persist exact geometry locally. | Informational strength plus **Low S-14** retention/backup decision. |
| Direct third-party calls from iOS | Apple geocoding, MapKit and Apple Speech are called from iOS. Default route traffic uses TrailMind’s backend; direct GraphHopper code is limited to explicitly constructed clients/tests. Release remote AI parsing is currently disabled. | Disclose Apple/provider processing; preserve backend route boundary. |
| Server-side rate limits | Attested-installation, global weighted budget, replay IDs and provider concurrency leases exist. Pre-attestation edge identity is deployment-dependent. | Informational strength plus **Medium S-10**. |
| Timeouts | GraphHopper provider and iOS planning stages are bounded. AI provider requests are not. | **High S-04**. |
| Unlimited retries | Route fallbacks/seeds and session refresh are bounded; no unbounded retry loop was found. AI has no retry but can wait indefinitely. | Informational, with S-04 timeout requirement. |
| Cost controls | Weighted route/intent budgets, global windows/concurrency and provider quotas in configuration exist. Real production quotas/alerts are **CANNOT_VERIFY**. | Verify before beta under S-07/S-11. |
| Request validation | Route/intent schemas use typed allowlists, numeric/coordinate/point limits and unknown-field rejection; provider responses are structurally checked/sanitized. | Informational strength; add S-16 response-size limits. |
| Backend authentication | Route and intent endpoints require App Attest-backed short-lived sessions except explicit local-development flags. Challenge/registration bootstrap endpoints are rate-limited; health is intentionally public. | Strong design; production proof remains **High S-07**. |
| Error contracts | Route errors use stable safe envelopes. Intent errors can expose raw provider/internal strings. | **Medium S-08**. |

## Detailed findings

### S-01 — Critical — rotate the exposed local credential

During this audit, a broad search unexpectedly printed the contents of the ignored `Configuration/Local.xcconfig` into the task transcript. The credential is **not reproduced here**. Repository checks show that `Configuration/Local.xcconfig` is ignored and untracked, while `Configuration/Local.xcconfig.example` and `Configuration/Shared.xcconfig` are tracked. This is therefore an operational transcript exposure, not evidence that the secret is committed.

Required containment:

1. Revoke/rotate the affected GraphHopper credential in the provider console immediately.
2. Update only approved local/backend secret stores; do not place the replacement in source, Info.plist, documentation, logs, tests, or chat.
3. Review provider usage from the exposure time onward and set practical quotas/alerts.
4. Treat this task transcript as sensitive according to the organization’s incident process.
5. Reconfirm `Configuration/Local.xcconfig` is ignored and untracked, scan Git history, and inspect the final Release archive for the key or a key-bearing URL.

Exit evidence: old credential rejected; replacement works only through the intended backend; repository/history/archive scans return no credential; provider usage review recorded.

### S-02 — High — requested difficulty is displayed as fact

`TrailMind/Services/GraphHopperClient.swift:1082-1083` calculates a difficulty from real distance/elevation but then chooses `planningRequest.difficulty ?? computedDifficulty`. An “easy” request can therefore force an Easy badge even when returned distance/elevation would compute as moderate or challenging. `RouteCard` displays this as route difficulty, not as the user’s preference.

This violates TrailMind’s central trust rule and can affect outdoor decisions. Keep requested difficulty in planning metadata (“Requested: easy”) and derive the factual route rating only from verified geometry/elevation. If the request is not met, say so plainly.

Required tests: a requested-easy route with challenging returned stats must display the computed rating and an unmet-preference explanation; mock and saved-route round trips must preserve the distinction.

### S-03 — High — invented route edits and production-reachable mocks

Several paths can show believable outdoor output without real routing:

- Home example chips call `PlannerViewModel.startPlanning`, whose request kind is `.mockSuggestions` (`TrailMind/ViewModels/AppModels.swift:59-70`, `:125-127`).
- Explore renders `MockRoutes.all` and a developer demo in the main app tab (`TrailMind/App/TrailMindApp.swift:96`, `:117-140`).
- Route AI edit defaults to `MockAIPlannerService` (`TrailMind/ViewModels/AppModels.swift:519`) and modifies displayed distance/elevation/duration and scenery language while retaining the same route path (`TrailMind/Services/TrailServices.swift:90-106`, `:200-230`).

For an outdoor planner, this is a user-safety and integrity issue, not merely unfinished polish. Delete or compile these surfaces out of non-Debug builds, or replace them with real routing-backed behavior. A demo fixture may exist only when it is unmistakably labelled and cannot be confused with a usable plan.

`TrailRoute` has no non-optional live/mock provenance and Save/GPX accept any route, so mock or mock-edited records can outlive removal of their entry screen. Add a verification/source invariant at the route boundary, reject non-live routes from Release persistence/export, and migrate, quarantine or explicitly clear legacy saved records that cannot prove live routing origin.

### S-04 — High — AI requests lack bounded cancellation

`backend/src/parseIntent.js:95-193` awaits Google/OpenRouter `fetch` calls without a timeout or `signal`, even though `intentSessionEndpoint` passes `context.signal` at `backend/src/appAttest/intentSessionEndpoint.js:29`. A stalled provider can occupy serverless work and authorization concurrency until the runtime ends, increasing availability and cost risk.

Implement the same discipline already present in `backend/src/routing/graphHopperProvider.js:23-52`: bounded timeout, client-abort forwarding, cleanup in `finally`, stable timeout/cancel errors, and a maximum response size. Test provider hangs, client disconnect, timeout races, and authorization-lease release.

### S-05 — High (conditional) — third-party AI data sharing lacks consent/disclosure

The backend can send the complete route prompt to Google Gemini or OpenRouter (`backend/src/parseIntent.js:102-123`, `:157-168`). Prompts can include precise place names and personal constraints. Release iOS currently chooses the local parser (`TrailMind/Services/IntentParsingFoundation.swift:600-613`), so this is a gated capability rather than a currently verified Release data flow.

Before enabling it for testers or the public:

- explain, immediately before enablement, that the text may be sent to the named third-party AI provider;
- obtain the consent required for that sharing and provide a local/no-AI path where practical;
- document purposes, retention, deletion, subprocessors, training/data-use settings, regions and support contacts;
- ensure the privacy policy, in-app disclosure, App Privacy details and backend behavior agree;
- do not send raw voice audio to the TrailMind backend; continue sending only the user-approved transcript.

Apple’s current App Review Guidelines require disclosure and explicit permission when personal data is shared with third-party AI: [App Review Guidelines, section 5.1](https://developer.apple.com/app-store/review/guidelines/).

### S-06 — High — missing provider configuration returns a mock intent

`backend/src/parseIntent.js:90-92` returns `mockIntent(request)` whenever neither AI key exists. This is not restricted to test/development. `INTENT_PROVIDER_ENABLED` defaults to enabled (`backend/src/appAttest/routeSessionAuthorizer.js:75-84`) but does not prove a configured provider.

Production must fail closed with a stable `configuration_unavailable` result. Allow deterministic fixtures only behind an explicit `NODE_ENV` plus local/test opt-in, and add a deployment smoke test proving the production endpoint cannot claim remote parsing when no provider is configured.

### S-07 — High — production authorization is not operationally proven

The code includes strong controls, but operational proof is absent:

- `DEVELOPMENT_TEAM` is empty in all project configurations (`TrailMind.xcodeproj/project.pbxproj:243`, `:306`, `:337`, `:367`).
- Debug and Release entitlements target different App Attest environments, correctly, but a signed physical-device flow was not run in this audit.
- The backend intentionally fails closed without a durable repository/verifier (`backend/src/appAttest/appAttestRuntime.js:13-43`).
- Real PostgreSQL tests require an external disposable database and are not evidence of the deployed database unless run there.
- Production environment variables, migrations, TLS, health and provider quotas are **CANNOT_VERIFY**.

Required beta evidence: signed physical-device registration, assertion/session opening, replay rejection, concurrent budget enforcement, token expiry/refresh, Debug/production environment separation, deployed route and intent calls, fail-closed negative cases, and archive inspection. Apple notes that TestFlight/App Store builds use the production App Attest environment regardless of the local entitlement: [App Attest Environment](https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.developer.devicecheck.appattest-environment).

### S-08 — Medium — intent errors expose upstream/internal detail

AI error responses include up to 400 characters of raw provider response (`backend/src/parseIntent.js:126-130`, `:171-175`, `:572-577`), and the intent endpoint/server return `error.message` to clients (`backend/src/appAttest/intentSessionEndpoint.js:31-37`; `backend/src/server.js:69-72`, `:110-116`). This differs from the safer route error envelope.

Map intent failures to a small allowlist such as `invalid_request`, `intent_unavailable`, `intent_timed_out`, `request_cancelled`, and `configuration_unavailable`. Redacted diagnostic detail may be recorded server-side with a request ID, never prompt text, provider bodies, authorization, or coordinates.

### S-09 — Medium — Debug parser permits non-loopback HTTP

`RemoteAIIntentParsingProvider.usableURL` accepts both HTTP and HTTPS (`TrailMind/Services/IntentParsingFoundation.swift:370-380`). Release currently has no remote base URL, but a Debug/ad-hoc build could send prompts and route-session authorization over cleartext to a configured non-loopback host.

Mirror the stricter simulator policy already used for insecure route sessions: HTTP only for exact loopback (`127.0.0.1`, `localhost`, and optionally IPv6 loopback if deliberately supported), with HTTPS required everywhere else.

### S-10 — Medium — proxy edge identity is unverified

`backend/src/server.js:54` uses an optional resolver or `request.socket.remoteAddress`; the Vercel entry point simply re-exports this handler (`backend/api/index.js:1`). Behind a reverse proxy, that address can identify the proxy rather than the client, collapsing challenge-rate limits or making their behavior deployment-dependent.

Use only Vercel-documented, trusted forwarding metadata after validating the request came through the platform; normalize one client address, ignore attacker-supplied chains, and test direct-node plus Vercel-style requests. App Attest key/session limits remain valuable defense in depth, but they do not replace a correct pre-attestation edge limiter.

### S-11 — Medium — database transport and lifecycle controls are unverified

The PostgreSQL adapter parses a PostgreSQL URL and creates a pool (`backend/src/appAttest/postgresAppAttestRepository.js:324-334`) but does not independently enforce TLS; the deployment URL may do so, but that is **CANNOT_VERIFY**. The schema stores public keys, receipts, installation identifiers and counters (`backend/migrations/001_app_attest.sql:14-26`). `pruneExpired()` exists for transient records (`backend/src/appAttest/postgresAppAttestRepository.js:266-282`) but no scheduler is present.

Before beta, require encrypted database connections, least-privilege runtime/migration roles, managed encryption at rest, backup and regional-residency decisions, secret rotation, and a scheduled prune job with monitoring. Before public launch, define retention/deletion for App Attest key records and document how support/privacy deletion requests affect them. RLS on all backend-only tables (`backend/migrations/001_app_attest.sql:71-79`) is a confirmed strength, not a substitute for owner-role controls.

### S-12 — Medium — privacy release artifacts are absent

No `PrivacyInfo.xcprivacy`, in-app privacy-policy link, or App Privacy label evidence was found. The app uses protected resources and stores saved routes; it also uses `@AppStorage`/UserDefaults-backed state, which must be assessed in Xcode’s privacy report for required-reason API declarations.

Do not guess manifest values. Generate the privacy report from the exact archive, enumerate app and dependency data use, add a valid target resource where required, and make the manifest, App Store privacy details, permission strings, backend behavior and policy consistent. Apple’s primary references are [Privacy manifest files](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files) and [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/).

The current location purpose string also mentions “future navigation” even though location is not wired into the journey. Permission copy must describe only current, directly relevant behavior before location access is enabled.

### S-13 — Medium — public attribution evidence is incomplete

Route detail states that data comes from GraphHopper/OpenStreetMap, but no visible link to the OpenStreetMap licence or dedicated legal/attribution surface was found. OpenStreetMap’s guideline requires attribution and access to the ODbL for public produced works: [OSMF Attribution Guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines).

Before public release, obtain a terms/licensing review of GraphHopper and OpenStreetMap use, add compliant visible attribution to every relevant route/map experience, and preserve Apple MapKit attribution. Record the exact wording/placement and licence links in release QA.

### S-14 — Low — local route retention and backup need a product decision

`SavedRouteStore` atomically writes exact geometry with `.completeFileProtectionUntilFirstUserAuthentication` (`TrailMind/Services/SavedRouteStore.swift:91`), which is a strong baseline. The files are not explicitly excluded from backup, and the UI offers per-route removal but no obvious delete-all/export/privacy explanation.

Decide whether Saved routes should be included in device backups, document it, add delete-all local data, and verify removal does not leave temporary files. Do not claim cross-device sync because none is implemented.

### S-15 — Low — GPX generation is not safely packaged

The GPX generator interpolates a route title into XML without escaping, and the UI uses `(try? export) ?? ""` in a string `ShareLink` (`TrailMind/Views/Route/RouteDetailView.swift:301-305`). A title containing XML metacharacters can create malformed output; failures silently share an empty item.

Escape XML, write a temporary named `.gpx` file using an appropriate content type, display export failure, and test metacharacters, Unicode, long routes and cleanup.

### S-16 — Low — bound successful provider payloads

GraphHopper success payloads are structurally validated (`backend/src/routing/graphHopperProvider.js:153-247`) and sanitized to safe fields, but no explicit byte, path-count, instruction-count or coordinate-count ceiling is applied before/while decoding. Because the upstream host is fixed HTTPS and redirects are disabled, risk is contained, but a malformed or unexpectedly large trusted-provider response can still consume memory.

Add conservative limits aligned with the route contract and tests that reject oversized successful responses without returning partial data.

## Confirmed controls worth preserving

- Default iOS routing uses `BackendRouteGateway`; direct GraphHopper configuration is only available to explicitly constructed clients (`TrailMind/Services/GraphHopperClient.swift:166-183`).
- No GraphHopper key Info.plist field is present; the production base URL points to the backend. Local configuration remains optional and ignored.
- Route validation allowlists profiles, algorithms, point counts, coordinates and typed preferences; the client cannot submit arbitrary GraphHopper custom-model code.
- GraphHopper upstream is fixed to HTTPS, disallows credentials/query/fragment in its configured base URL, disables redirects, applies a timeout and forwards cancellation (`backend/src/routing/graphHopperProvider.js:23-52`, `:97-117`).
- Route responses are validated and reduced to safe fields; raw provider errors are mapped to stable route errors.
- App Attest validation covers challenge binding, certificate chain, relying-party identity, AAGUID/environment, key ID, signature and monotonic counters; session tokens are stored as hashes server-side and cached only in memory on iOS.
- The local App Attest key ID uses Keychain accessibility `AfterFirstUnlockThisDeviceOnly` (`TrailMind/Services/SecureInstallationStore.swift:53`).
- Production refuses the in-memory repository unless explicit local-development conditions are met.
- PostgreSQL operations use parameters, transactions/locks and RLS; request IDs, weighted budgets and provider concurrency are atomically consumed.
- Safe route logs intentionally exclude prompts, exact coordinates, route bodies, authorization headers, keys, provider URLs and raw responses (`backend/docs/route-api.md:168-180`).
- Voice permission is requested from the composer action; code states that raw audio is not retained or sent to TrailMind’s backend (`TrailMind/Services/VoicePlanningService.swift:77-79`).
- Saved records omit intent debug metadata and use iOS file protection.
- No third-party analytics, ads, account database, cross-device history, or raw prompt logging was found.
- The current deterministic security/provider suites are green, and `npm audit --omit=dev` reported zero known backend dependency advisories at audit time; this is useful baseline evidence, not a penetration test or live-deployment proof.

## Required security verification suite

### Development gate

- Prove S-01 rotation/revocation and repository/history/archive scans.
- Run all Swift unit tests and backend tests from a clean checkout.
- Add tests for factual-versus-requested difficulty, mock isolation, AI timeout/cancellation, safe intent error envelopes, HTTP loopback restriction, proxy identity, oversized provider payloads and GPX escaping.
- Run static secret scanning against tracked files without reading ignored secret files into reports.

### Closed-beta gate

- Signed physical-device App Attest registration, assertion and session tests against a deployed staging backend.
- Replay, expired challenge/token, exhausted budget, wrong environment/bundle/team, counter race, malformed attestation, client cancellation and fail-closed dependency tests.
- Real disposable-PostgreSQL integration suite plus migration, RLS, TLS, backup/restore and pruning-job evidence.
- Provider quotas, cost caps and alerts for GraphHopper and any enabled AI provider.
- Packet/log inspection proving prompts/coordinates/tokens/keys do not enter logs and protected traffic is TLS-only.
- Privacy consent/disclosure walkthrough for text and voice, if remote AI is enabled.

### Public gate

- Inspect the exact signed Release archive: entitlements, production backend URL, privacy manifest/report, embedded resources, no secrets/debug fixtures, and symbol/diagnostic handling.
- Complete App Privacy labels and an easily accessible in-app privacy policy describing collection, third parties, retention/deletion, consent withdrawal and support contact.
- Complete GraphHopper/OpenStreetMap/MapKit terms and attribution review.
- Run an incident drill for provider-key rotation, backend outage, database outage and authorization failure.
- Obtain a final independent security review of the deployed build/backend after all High findings are closed.
