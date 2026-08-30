# Wanderful Privacy Policy Content Draft V1

Status: **DRAFT — NOT HOSTED**
Source baseline: `21f8450c976252210edf03389dc1b682d2440450`

This file is retained as the disabled-engine drafting baseline. The deployable, fail-closed engine-enabled template and validator are in `public-site`; do not publish either version without matching it to the exact selected build and completing `OWNER_LEGAL_INPUTS_V1.md`.

This is source-derived drafting material, not legal advice and not a published policy. Every bracketed `OWNER REQUIRED` field must be supplied and approved outside git before publication. No domain, URL, support address, legal entity, retention period or jurisdiction is inferred here.

## Owner-required publication fields

- Legal controller/developer: `[OWNER REQUIRED: exact legal entity]`
- Privacy contact: `[OWNER REQUIRED: monitored contact]`
- Postal/trader details and jurisdiction: `[OWNER REQUIRED]`
- Effective date and version history: `[OWNER REQUIRED]`
- Canonical public HTTPS URL: `[OWNER REQUIRED: do not use a placeholder]`
- Production processors, hosting regions, transfer safeguards and retention periods: `[OWNER REQUIRED]`

## Current default behavior

The tracked Production configuration has no backend URL, privacy-policy URL, support URL, Supabase project/key or Superwall key. All nine protected feature flags are false. In that default state, live route planning through Wanderful’s backend is unavailable, the public web links are intentionally hidden, Supabase profile sync cannot be composed, and Superwall is not constructed or presented.

Wanderful currently stores optional Trail Profile answers and verified saved routes locally on the iPhone in protected app storage. Saved routes are excluded from device backups. The user can edit, reset or delete the Trail Profile and can delete saved routes in the app. GPX export creates a protected temporary file containing route coordinates, hands it to the app or person selected in Apple’s share sheet, then schedules cleanup and later recovery of abandoned export files.

Wanderful does not request device Location permission in this release boundary. The user enters a place name manually. The full typed route request is parsed on the device and is not sent to a remote AI provider. If the user invokes optional voice input, Apple Speech may process captured audio; Wanderful’s source states that it does not retain raw audio or send raw audio to its own backend.

The app includes Apple App Attest support and a production entitlement, but a successful distributed physical-iPhone/backend path is not proved. The first-party privacy manifest declares a linked Device ID used for App Functionality and no tracking. The selected Release also contains Superwall’s manifest declaration for unlinked Purchase History used for App Functionality and swift-crypto’s no-collection declaration. No purchase, paywall, account, advertising or first-party analytics surface is Release-reachable under the tracked defaults.

## Future or disabled behavior

If the owner later configures a reviewed production backend, the current source is designed to send user-entered place names to Apple geocoding, then send resolved route coordinates and selected routing constraints to the Wanderful backend, which requests route calculation from GraphHopper. The full prompt remains locally parsed in Release. App Attest may store a key identifier in the device Keychain and the backend design may keep an app-scoped installation record plus a one-way hash of the connection source for rate limiting. Production retention, linkage, IP/log handling, deletion and backup behavior are not proved and must be filled from backend evidence before this section can be published.

Supabase onboarding sync, remote accounts, Superwall/paywalls, research-guided planning, outdoor evidence, routable-highlight access, direct GraphHopper, remote intent and insecure test authentication are disabled. Activating any of them requires a new privacy review, updated App Privacy answers, processor/retention disclosures and, where accounts are created, an in-app account-deletion path.

## Draft disclosure structure for legal review

1. Explain what remains local: Trail Profile, saved routes and drafts, including in-app deletion controls.
2. Explain user-directed GPX sharing and the receiving third party’s independent handling.
3. Explain Apple geocoding and Apple Speech only for the flows actually enabled in the selected build.
4. Explain backend/GraphHopper routing, App Attest identifiers, connection metadata and server logs only from proved production behavior.
5. Identify every active processor and hosting region, purpose, linkage, legal basis, transfer safeguard and retention/deletion rule.
6. State that Wanderful does not use data for advertising or cross-company tracking only after final owner/backend/SDK verification.
7. Describe access, correction, deletion, objection, appeal and complaint rights using the actual controller’s applicable law and contact.
8. Distinguish deletion of local data from deletion of any future account or off-device record.

## Non-claims

This draft does not say “we collect nothing,” does not claim that App Attest or the production backend has been run, and does not claim that a public policy exists. It must remain unhosted and the Production URL must remain empty until the owner supplies a real approved canonical HTTPS endpoint.
