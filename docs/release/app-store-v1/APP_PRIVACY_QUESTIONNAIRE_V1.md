# App Privacy questionnaire V1

Status: **provisional; do not publish until the production routing policy and owner decisions are final**

Assessment date: 2026-08-30

This questionnaire describes the currently reviewed local-parser/disabled-research boundary. If the advanced research/routing engine is enabled for the submitted build, use `APP_STORE_PRIVACY_ANSWERS_ENGINE_ENABLED_V1.md` instead and reconcile its transient-processing decisions against exact production evidence.

## Verified V1 data flow

- The full typed route prompt is parsed locally. Release does not send it to a remote AI service.
- Place names are sent to Apple geocoding.
- Once the production routing endpoint is configured, resolved coordinates and selected route constraints are sent to the Wanderful routing gateway, which uses GraphHopper.
- The app does not request device Location permission in V1; the user enters a place name.
- Optional voice input uses Apple Speech only after Microphone and Speech Recognition permission. Wanderful does not retain raw audio or send raw audio to its own backend.
- Trail Profile data and saved routes are local protected files. V1 creates no account and composes no remote profile sync.
- GPX export is user initiated through the system share sheet and uses a protected temporary file with cleanup.
- App Attest supplies a device-scoped installation assertion for request protection. The first-party privacy manifest declares linked Device ID for App Functionality and no tracking.
- Research/evidence, remote intent, Supabase sync, and Superwall presentation are disabled. The Superwall SDK remains linked and its embedded manifest declares unlinked Purchase History for App Functionality.

## Provisional App Store Connect answers

### Tracking

- **Tracking:** No
- **Tracking domains:** None declared by the built first-party, Superwall, or swift-crypto manifests
- **Advertising/marketing purposes:** None in V1

### Data linked to the user

| Data type | Draft | Purpose | Final proof needed |
| --- | --- | --- | --- |
| Identifiers → Device ID | Yes | App Functionality / request protection | Confirm production App Attest retention and deletion policy |
| Precise Location | Conservative Yes | App Functionality / route calculation | Confirm exact routing payload, logs, retention, and access controls |
| Other User Content | Conservative Yes for structured route constraints | App Functionality / route calculation | Confirm no full prompt leaves the device and document retained fields |

The conservative “linked” classification reflects device-scoped request protection even though V1 has no visible account.

### Data not linked to the user

| Data type | Draft | Purpose | Reason |
| --- | --- | --- | --- |
| Purchases → Purchase History | Conservative Yes | App Functionality | Embedded Superwall manifest declares this category even though V1 does not present Superwall or a purchase surface |

The owner may remove this declaration only after proving that the exact submitted artifact and current Apple rules permit omission. Removing or activating the SDK requires a fresh manifest/privacy review.

### Not declared as developer collection in V1

- Audio Data: Apple Speech may process audio; Wanderful does not retain or send raw audio to its backend.
- Name, email, contacts, User ID: no V1 account or contact form.
- Product interaction, diagnostics, performance, crash data: no first-party analytics/crash recorder is composed in the audited Release.
- Saved routes, Trail Profile, and onboarding draft: local-only protected storage is not developer collection.
- GPX: user-directed sharing is not developer collection.

## Account deletion

Apple account deletion is not applicable because V1 creates no account. Profile provides edit, reset, and local delete. If Supabase Auth or any remote account/sync is later activated, the app and privacy package require a new deletion flow and review.

## Privacy policy requirements

The public policy must identify Wanderful’s legal operator and contact, explain Apple geocoding and Speech, GraphHopper routing, App Attest request protection, retention/logging/deletion for coordinates and constraints, local saves/Profile/GPX handling, user rights, and the absence of tracking. It must not describe disabled research, evidence, Supabase, Superwall, or AI features as active.

## Owner stop gate

Before publishing these answers:

1. document the production routing gateway’s exact payload, retention, logging, deletion, processors, and security purpose;
2. reconcile the embedded Superwall Purchase History declaration;
3. approve the final no-tracking assertion for the exact signed archive;
4. publish the matching privacy policy at the canonical HTTPS URL;
5. review the generated Xcode privacy report for the exact signed archive.

Physical App Attest proof is recommended operational QA, but it is not a standalone blocker in this V1 package.
