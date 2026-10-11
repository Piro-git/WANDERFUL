# App Privacy and processor inventory — candidate draft

Status: **not publishable until archive + deployment reconciliation.**

Scope: read-only reviewed integration candidate `9a53949162ece31e2a5ab96dbe10a827ab8cde59`. Remote/account/photo/commerce integrations are present in source but remain default-disabled or operationally unverified. This is a technical inventory, not legal advice or a legal conclusion.

Apple requires App Privacy answers to cover the app and relevant third parties. The archive privacy report assists this work but does not replace App Store Connect answers. Answer conservatively for the exact submitted build and revise answers whenever data practices change.

| Data / action | Source evidence | Recipient / processor | Candidate App Privacy treatment | Required closure evidence |
| --- | --- | --- | --- | --- |
| App-scoped installation/App Attest identifier | `PrivacyInfo.xcprivacy`; App Attest services | Wanderful backend | Device ID; linked; not tracking; App Functionality | deployed schema, retention/pruning, deletion path, archive traffic review |
| Route request text, place names, route preferences | planner and backend request contracts | Wanderful backend; geocoding/routing processors selected by release lane | User Content / Search History must be assessed; App Functionality; linkage depends on deployment | payload and log retention for every processor |
| Resolved route coordinates and live guidance location | routing contracts; `RouteLocationService` for guidance | backend/GraphHopper only if transmitted by final lane; guidance engine processes samples locally in source | Precise Location must be assessed; do not mark “not collected” before traffic/retention proof | final network capture, backend/GraphHopper/host terms, archive review |
| Spoken request | `VoicePlanningService`; microphone/Speech purpose strings | Apple Speech when user chooses voice | Audio Data must be assessed; App Functionality | actual OS/service behavior and Apple-service disclosure review |
| Saved routes and packing-list state | `SavedRouteStore`, preparation storage | on-device in base; any synced backend only if separately enabled | Not “collected” if genuinely only stored locally; reassess if backup/sync/telemetry is enabled | final storage and backup-exclusion acceptance |
| Subscription transactions | StoreKit code exists; production products disabled in tracked config | Apple; Superwall only if enabled/configured | Financial Info / Purchases and identifiers require final SDK/flow review | product configuration, SDK privacy manifest/report, sandbox transaction test |
| Sign in with Apple / account record | integrated source, default-disabled | Wanderful backend and Apple | Account/User ID, and possibly email/name, must be declared if enabled | endpoint/storage/retention/deletion acceptance |
| Commons photo asset metadata | integrated optional resolver/gallery, fail-closed | Wikimedia/CDN only if enabled | URL/media metadata and network identifiers need final review | archive/traffic proof and per-asset attribution display |
| Google/Gemini research | gated/unassigned in tracked production configuration | Google only if released backend enables it | request content and possibly location must be assessed | model/grounding configuration, provider terms, logs/retention, live evidence |

## Provisional answers that are safe only after verification

- Tracking: **No**, provided the final archive contains no tracking/advertising SDK or cross-company linking for advertising/measurement.
- Purposes: only **App Functionality** is supported by the intended product. Do not select analytics, marketing, or advertising without independently reviewed implementation.
- Privacy policy URL: **required and unresolved**. A user privacy choices/deletion URL is unresolved but strongly advisable where a backend identity/account exists.

## In-app policy requirements

The final public policy must name the controller and a usable contact channel, explain data categories, processors, purposes, retention, international transfers where applicable, user choices/deletion, and policy changes. It must be linked in App Store Connect and easily accessible in the app. Do not invent an operator name, address, email, or retention period in this repository.

### Conditional Apple-account deletion handoff

The integrated candidate includes a durable PostgreSQL account/session adapter and migration `012`. Its intended deletion path requires fresh Apple reauthentication, revokes the refresh token before deletion, then transactionally invokes injected app-owned-cloud cleanup, deletes the account and refresh-token ciphertext, and FK-cascades sessions. On revocation failure it reports no deletion/success. Opaque sessions expire after 30 days. Local saved routes and packing lists remain on the device.

This is a useful intended boundary, but the feature remains 404/fail-closed unless its explicit enablement and full backend key/client configuration are present and the migration is applied. There is no generic account-data retention/pruning job, deployed endpoint, or physical/backend acceptance. Therefore it is not yet a publishable privacy or deletion claim.

## Attribution and media release checks

- Source review of candidate `9a53949` found that `WikimediaCommonsPhotoResolver`
  follows only a stop's Wikidata `P18` record, rejects non-Commons media,
  missing credit, and unlisted licences, and that route UI exposes author/source
  and licence links. The accompanying fixture suite covers valid, rejected, and
  cache cases, but was not executed in this documentation task. This is source
  evidence only; it is not a live asset-rights or visual acceptance result.
- Keep GraphHopper/OpenStreetMap attribution visible where their data is used; re-check GraphHopper’s current terms and ODbL obligations for the actual release data flow.
- Commons is not one blanket licence. For every displayed asset retain and show its exact author/credit, asset source, licence/version, and licence link. The candidate resolver’s allowlist is not legal clearance for personality, trademark, or other non-copyright rights.
- Do not present a Commons photo, web citation, or mapped stop as proof of route safety, access, scenic quality, water availability, or current status.
