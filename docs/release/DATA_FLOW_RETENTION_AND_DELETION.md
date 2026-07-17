# TrailMind data flow, retention, and deletion

Status: release-readiness draft
Evidence date: 2026-07-17
Scope: the iPhone-only, portrait closed-beta configuration in this repository

This document describes observed source behavior. It is not a provider contract or a substitute for legal review. Any row marked **Unresolved** must be closed before public release.

## Shipping boundary

- Release builds parse the full typed route request on the device with `LocalIntentParsingProvider`.
- Release builds do **not** send the full prompt to a remote AI provider.
- Remote-intent providers, their request/response types, and the `/api/parse-intent` path are compiled only in Debug. The Release factory contains only the local parsing path. Debug evaluation can send prompts to the TrailMind backend and then Google or OpenRouter.
- TrailMind does not currently request or read the device's location. The person enters place names.
- There are no TrailMind user accounts, cloud sync, advertising, or analytics SDKs in the app source.

## Data-flow inventory

| Data or action | Leaves the device? | Destination and purpose | TrailMind-controlled storage | Current deletion path | Release status |
|---|---|---|---|---|---|
| Onboarding-complete flag | No | None | App-local `UserDefaults` through `@AppStorage` | App uninstall or clearing app data; no separate in-app reset | Confirmed local-only |
| Full typed route request | No in Release | Parsed in memory on device | Not written by the planning flow | Discarded with in-memory state/process lifetime | Confirmed for Release |
| Place-name queries | Yes | Apple geocoding resolves names to coordinates; a destination query may be biased near the resolved start | In-memory geocoder cache only | Cache ends with the app process | Apple service retention is unresolved |
| Device location | No | TrailMind does not access Core Location device-position APIs | None | Not applicable | Confirmed absent from shipping source and permission keys |
| Route coordinates and routing constraints | Yes | TrailMind backend authorizes the request; GraphHopper calculates route geometry and statistics | Route endpoint source does not persist request bodies. Safe operational fields include request ID, route type, profile, point count, algorithm, a broad distance category, status, error code, and latency | No user-facing server deletion path exists because route bodies are not intentionally persisted | Infrastructure-log behavior and GraphHopper retention are unresolved |
| Returned route geometry and statistics | Yes, in the response back to the device | Backend returns the normalized GraphHopper response | Held in app memory; persisted only if the person saves a verified route | Leave screen/app memory, delete one saved route, or delete all saved routes | Confirmed app behavior; provider retention unresolved |
| App Attest key identifier | Yes during registration/session exchange | Apple App Attest and TrailMind backend protect routing requests | Raw key identifier is stored in this device's Keychain. Backend stores a hash-derived installation identifier, key-ID hash, public key, App Attest receipt, assertion counter, validation category, bundle version, and timestamps | App can delete a locally invalid key during recovery. There is no user-facing deletion for the backend installation record | Backend retention/deletion policy is unresolved |
| Protected-request network source | Yes | The backend receives the request connection address, or a deployed edge-resolver value, for abuse and rate-limit enforcement | Application code does not intentionally persist the raw value. PostgreSQL stores a one-way hash in short-lived rate-window records | `pruneExpired()` can remove expired windows; the production schedule is not wired | Actual proxy/IP semantics, hosting logs, retention, and final App Privacy classification are unresolved |
| App Attest challenges, route sessions, replay IDs, rate windows, and leases | Yes | Backend authorization, replay defense, budgets, and concurrency control | PostgreSQL schema has short-lived records. `pruneExpired()` removes expired challenges and sessions after a ten-minute margin, expired windows, and expired/released leases | Scheduled pruning job is required | Pruning code exists; real schedule and deployed database are unresolved |
| Saved routes | No | None | One JSON record per route in Application Support, with atomic writes and file protection until first unlock; the app store directory is excluded from device backups | Delete one route, confirmed **Delete All**, reset unreadable data, or uninstall | Confirmed source and focused tests; exact installed-build recheck pending integration |
| Recovered legacy saved routes | No | None | Same local saved-route store; legacy records stay explicitly unverified | Delete one, delete all, or remove unusable records | Confirmed source |
| GPX export | Yes only when the person chooses a share destination | The selected app or person receives route coordinates in a named GPX file | Protected temporary file in a TrailMind-owned temporary directory | Cleanup after sharing/cancel; pending cleanup is retried; abandoned TrailMind export directories are removed on a later launch | Confirmed app behavior; recipient retention is outside TrailMind control |
| GPX file metadata | No | Used only to identify stale app-container export directories for cleanup | Temporary app-container metadata | Removed with the export directory | Declared under required-reason API `C617.1` |
| Microphone audio for optional voice input | Yes, depending on Apple Speech service behavior | Apple's Speech framework transcribes the request | TrailMind does not retain raw audio or send it to its backend | Audio buffers are released when transcription stops/cancels; no TrailMind audio archive | Apple processing/retention terms and physical-device proof are unresolved |
| Voice transcript | Not as a full prompt in Release | Reviewed on device, then processed like typed input | In memory unless its resulting verified route is saved | Clear/edit prompt or leave the flow | Confirmed source |
| Map display | May contact Apple map services | MapKit renders the route map | No TrailMind map-tile store or offline-map store | System/provider controlled | Apple service handling is unresolved for the final policy review |
| Debug remote-intent evaluation | Yes, Debug only | TrailMind backend, then configured Google or OpenRouter provider | The provider and `/api/parse-intent` client path are excluded from Release compilation; evaluation harness artifacts are redacted | Evaluation artifacts are temporary and separately controlled | Exact candidate binary scan and traffic inspection must confirm the Release boundary |

## Local saved-route retention

Saved routes contain route geometry, distance, duration, elevation, instructions, metadata, provenance, and save timestamps. The production store:

1. accepts only verified routed results for new saves;
2. writes atomically with `completeFileProtectionUntilFirstUserAuthentication`;
3. marks the `SavedRoutes` directory as excluded from device backups;
4. isolates corrupt, invalid, and unsupported records instead of silently replacing them;
5. offers individual deletion and a destructive, confirmed delete-all action.

There is no automatic expiry. Retention is until deletion or app removal.

## Backend security-record retention

The repository currently defines two different retention shapes:

- Ephemeral authorization records have TTLs and pruning code.
- Registered App Attest installation records have no implemented expiry or user deletion endpoint.

Before protected beta traffic is enabled, the operator must document and implement:

- a retention period for App Attest key records and receipts;
- an authenticated or support-mediated deletion process appropriate for an app with no user account;
- a scheduled `pruneExpired()` job with monitoring;
- the deployed network-source resolver, hash-window TTL, and classification of that processing under Apple's App Privacy definitions;
- database backup retention, restore, encryption, access, and regional-residency controls;
- infrastructure log fields and retention;
- a response process for privacy requests.

## Third-party retention decisions still required

The owner must obtain and record current contractual answers for:

- Apple geocoding, MapKit/map display, and Speech processing;
- GraphHopper request/response and exact-coordinate retention;
- hosting/CDN/runtime request logs;
- PostgreSQL provider backups and logs;
- any future support channel.

Until those answers exist, neither the privacy manifest, App Privacy answers, nor the public privacy policy is final.

## User controls present now

- Do not use voice; type instead.
- Review and edit the transcript before planning.
- Save only when desired.
- Delete one saved route.
- Delete all saved-route and unusable local records from **Saved**.
- Choose whether and where to share a GPX file.

## Missing user controls

- No in-app reset for the onboarding preference.
- No self-service deletion of the backend App Attest installation record.
- No published privacy choices or support URL.
- No provider-retention or downstream GPX deletion control.

These gaps must be reflected in [PRIVACY_POLICY_DRAFT.md](PRIVACY_POLICY_DRAFT.md), [APP_PRIVACY_DRAFT.md](APP_PRIVACY_DRAFT.md), and [APPLE_TEAM_GATES.md](APPLE_TEAM_GATES.md).
