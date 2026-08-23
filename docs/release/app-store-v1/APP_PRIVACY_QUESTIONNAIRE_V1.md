# App Privacy Questionnaire V1

Status: **iOS onboarding and Release SDK-manifest delta reconciled; backend/legal answers remain provisional; do not publish in App Store Connect**
Source baseline: `8fce37f2c4db552a3a2ba8acad636fd0b80327ec`
Assessment date: 2026-08-23

Apple requires answers to cover the app and third-party partners, remain accurate for the current version, and be backed by a public privacy-policy URL. Source: [Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/). This draft deliberately does not convert unknown backend/App Attest retention or owner-unapproved SDK use into a “Data Not Collected” answer.

## Current source-backed data flow

| Surface | Current source evidence | Questionnaire consequence |
| --- | --- | --- |
| Route prompt | Release uses the local parser; About states the full prompt is not sent to a remote AI service | No remote-AI disclosure is supported; Stage B must prove the Release path |
| Place resolution | User-entered place names are sent to Apple geocoding | Disclose Apple processing in the privacy policy; determine whether this is reportable collection after legal review |
| Route calculation | Coordinates and selected route constraints go through the configured Wanderful backend to GraphHopper | Precise Location and Other User Content remain provisional until retention/linkage is proved |
| Device location | No location usage key; About says Wanderful does not read device location | Do not claim device-GPS collection; verify built Info.plist and runtime |
| Voice | Microphone audio is used for transcription; Speech purpose text says Apple servers process speech and Wanderful does not retain raw audio or send it to its backend | Audio Data is not asserted as developer collection; legal/privacy owner must confirm Apple-service treatment and actual runtime |
| App Attest | First-party privacy manifest declares Device ID, linked to identity, for App Functionality, not tracking | Draft answer includes Identifiers → Device ID, linked, App Functionality, not tracking |
| Saved routes | Protected local file store; excluded from backup | Local-only data is not App Privacy “collection”; integrated sync could change this |
| GPX export | Protected temporary file, user-initiated system share, cleanup | User-directed transfer is not claimed as developer collection; Stage B verifies cleanup |
| Research/evidence | Tracked Release flags are false | No research-guided/evidence data claim while disabled; built flags must confirm |
| Trail Profile/onboarding | Optional activity, distance or duration range, route shape, requested experiences and soft avoidances are stored locally in versioned protected app storage | Local-only data is not App Privacy collection; no account, Auth session or remote sync is composed in V1 |
| Supabase | SDK and dormant remote client are compiled, but `HikingPreferenceProfileSyncFactoryV1` unconditionally returns a no-op client and tracked sync/URL/key values are disabled/empty | No Supabase data transfer or anonymous account is Release-reachable in V1; built dependency/manifests still require inspection |
| Purchases/Superwall | SDK exists, tracked key is empty, production native onboarding neither constructs nor presents `SuperwallOnboardingClient`; its Debug embedded manifest declares unlinked Purchase History for App Functionality | No V1 purchase path is source-reachable, but the embedded declaration must be reconciled with the selected Release and owner exclusion before answering Purchases |

## Draft App Store Connect answers

### Tracking

- **Does the app or its third-party partners use data for tracking?** Draft: **No**.
- Evidence: first-party manifest says tracking is false and contains no tracking domains.
- Built evidence: final Debug and Release first-party, Superwall and swift-crypto manifests all declare tracking false; no tracking domain was declared. Configured remote behavior and owner V1 monetization scope remain unproved.
- Stop gate: selected-Release SDK manifests are inspected, but this answer cannot be published until the owner's Superwall V1 exclusion, backend behavior and any cross-company data linkage are approved. Blockers `ASV1-002`, `ASV1-003`, `ASV1-011`.

### Data linked to the user

| Apple data type | Draft selection | Purpose | Status/evidence needed |
| --- | --- | --- | --- |
| Identifiers → Device ID | Yes | App Functionality | Source and built manifest agree; App Attest server storage/retention remains owner/backend-dependent |
| Precise Location | Provisional | App Functionality | Typed/geocoded route coordinates leave the device; linkage and retention UNKNOWN |
| Other User Content | Provisional | App Functionality | Structured route constraints may leave the device; exact payload/retention UNKNOWN |
| User ID | No for V1 iOS onboarding | — | Production composition creates no account/Auth/session; reassess if the dormant Supabase client is ever activated |
| Name, Email Address, Other Contact Info | No for V1 iOS onboarding | — | Onboarding collects no contact field and creates no account |
| Purchases | Provisional | App Functionality if applicable | Native onboarding has no purchase/paywall path, but the embedded Superwall Debug manifest declares unlinked Purchase History; owner exclusion and selected Release must reconcile this |
| Product Interaction | No first-party onboarding collection | — | Typed onboarding event vocabulary has no recorder composed; embedded SDK and backend behavior still require inspection |
| Crash Data, Performance Data, Other Diagnostic Data | Provisional | App Functionality/Analytics | No first-party analytics found; embedded SDK and backend logging UNKNOWN |

No advertising, developer marketing, third-party advertising, or tracking purpose is supported by the current product description.

### Data not linked to the user

No category is classified here yet. Backend pseudonymization, aggregation or prompt/coordinate de-identification has not been evidenced. “Not linked” must not be selected merely because the app has no visible sign-in screen.

## Integrated onboarding / Supabase / Superwall delta

The terminal onboarding integration at `d610110…` establishes the following current V1 facts:

1. Optional fields are activity, comfortable distance or duration range, route shape, requested experiences and soft avoidances. No onboarding free text, name, email or contact information is collected.
2. The profile and resumable draft are local. No Supabase anonymous sign-in, named account, user ID, remote profile or cloud sync is created.
3. Production composition always chooses `NoOpHikingPreferenceProfileSyncClientV1`; no bundle value can activate the dormant Supabase implementation in V1.
4. Profile deletion removes the local profile and draft. It is not Apple account deletion because no V1 account exists.
5. The dormant event vocabulary is bounded and typed, but no recorder is composed; no onboarding analytics event is transmitted.
6. Production first launch uses native onboarding. It does not construct or present the compiled Superwall client, and the tracked key is empty.
7. Explicit request values override compatible profile defaults; an explicit no-preference suppresses a profile field. Preferences remain requests, not safety/scenery/access facts.

The integration owner also reported a read-only production Supabase schema in `eu-central-1` with zero onboarding rows, forced RLS/owner policies, migration-history drift and no disposable-environment two-user dynamic RLS proof. Because V1 does not activate Supabase, those facts do not create a shipping data flow; they are activation blockers for any future sync release. Supabase documents that anonymous sign-in creates an authenticated user and that RLS must distinguish anonymous users where required. Sources: [Anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous), [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Account deletion decision

The integrated V1 source creates no account, so Apple's in-app account-deletion requirement is not applicable to the current onboarding path. The app provides local Trail Profile deletion. If Supabase anonymous or named Auth is ever activated, Apple requires initiation of account deletion inside the app and local deletion alone becomes insufficient. Source: [Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/).

## Privacy policy consistency checklist

The public policy and questionnaire must agree on:

- purposes, linkage and retention for route coordinates and constraints;
- Apple geocoding and Speech processing;
- GraphHopper, Mapterhorn, Supabase and Superwall roles where active;
- App Attest identifiers and fraud/security processing;
- local saves, GPX export and user-directed sharing;
- account/profile deletion and contact route;
- international transfers, legal bases and user rights selected by counsel;
- absence of tracking/advertising only if verified in the built app.

## Finalization stop gate

Do not enter or publish these answers until backend/App Attest retention and linkage are owner-proved, the built Superwall Purchase History declaration and V1 exclusion are reconciled, and the public policy is live. The standalone Release manifests are locally reconciled; any dependency change or activation of Supabase, Superwall, analytics, accounts or AI requires a new review before release.
