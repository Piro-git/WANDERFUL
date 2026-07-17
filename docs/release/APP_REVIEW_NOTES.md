# App Review notes — draft

Status: not ready to submit
Evidence date: 2026-07-17

Replace every bracketed field and verify the exact uploaded build before copying these notes into App Store Connect.

## Draft notes for App Review

TrailMind is an iPhone-only, portrait route-planning app for same-day hiking, trail running, and biking. It is a planning aid, not live navigation.

Language/market note: **[UNRESOLVED]**. The current candidate is Germany-first and mixed-language: the interface development region is English, while geocoding failures and routing instructions can be German. Do not submit until the intended market and reviewer path match the tested behavior.

No account or login is required. TrailMind does not access the device's current location; the reviewer enters a place name for the route start.

Suggested review path:

1. Complete the three onboarding pages.
2. On **Plan**, tap **Type instead**.
3. Enter `[REVIEW PROMPT WITH PRE-VERIFIED LIVE RESULT — UNRESOLVED]`.
4. Submit the request. If TrailMind asks for a missing place or destination, answer the inline clarification.
5. Open a mapped suggestion to review distance, duration, elevation, route geometry, requested preferences, verified characteristics, and the planning-safety boundary.
6. Tap the save control, then open **Saved** to reopen or delete the route.
7. On a verified route detail, use **Export GPX** to open the system share sheet.
8. Open **About** for the current capability, data-flow, safety, and provider-attribution disclosures.

Voice input is optional. It uses Apple's Speech framework and requests microphone and Speech permission only when selected. The complete text review path works without granting either permission.

The distributed Release factory parses the full typed prompt on the device. A dormant remote-provider implementation remains compiled but is neither selected nor configured in Release; candidate traffic must confirm it is never invoked. Route coordinates and routing constraints are sent to TrailMind's backend, which uses GraphHopper to calculate route geometry and measured statistics. Apple App Attest protects backend requests; there are no reviewer credentials.

TrailMind does not include turn-by-turn navigation, live location, route recording, offline maps, weather, closures, verified water availability, accounts, cloud sync, advertising, or analytics.

Backend availability during review: **[UTC WINDOW/24×7 CONFIRMATION — UNRESOLVED]**
Review support contact: **[NAME, PHONE, EMAIL — UNRESOLVED]**
Privacy policy: **[PUBLIC URL — UNRESOLVED]**
Support page: **[PUBLIC URL — UNRESOLVED]**

## Reviewer prompt requirements

The prompt placed above must:

- have a repeatable live result in the production backend;
- use a public, non-sensitive start/destination;
- be represented in the protected route-quality baseline;
- not depend on a user's current location;
- not create a safety, access, water, scenic, or legality guarantee;
- still work under review-region geocoding behavior.

Do not use a mock fixture or a result captured from Debug/UI-test composition.

## Review readiness prerequisites

- [ ] Credential containment and provider rotation complete.
- [ ] Production backend and PostgreSQL migration verified.
- [ ] Production App Attest tested from TestFlight.
- [ ] Review prompt succeeds repeatedly in the exact candidate.
- [ ] Backend owner/monitoring contact available throughout review.
- [ ] Privacy policy and support URLs public.
- [ ] App Privacy details published and matched to the candidate.
- [ ] GPX opens in an independent consumer.
- [ ] No unsupported claim appears in metadata or screenshots.
- [ ] Export-compliance and content-rights answers completed.

## Potential review questions and factual answers

### Is this an AI app?

No remote AI parser is enabled in the submitted Release build. TrailMind uses a local rule-based parser to interpret supported route-request forms, then a real routing engine calculates the route.

### Does TrailMind navigate the person?

No. It plans and displays routes and can share GPX. It does not provide live navigation, current-position tracking, or off-route alerts.

### Where is route data stored?

Verified saved routes are protected local files on the iPhone and excluded from device backups. They can be deleted individually or all at once. Temporary GPX files are cleaned after sharing and on a later launch if abandoned.

### Why does the app use App Attest?

To protect the routing backend from modified clients, replay, and uncontrolled third-party provider cost. The backend maintains an app-scoped installation record; it is not a user account or advertising identifier.

### Why are microphone and Speech permissions present?

Only for the optional voice-to-text route request. The reviewer can use the complete text path without granting them.

## Apple-team fields

| App Store Connect field | Status |
|---|---|
| Contact first/last name | **Unresolved** |
| Phone | **Unresolved** |
| Email | **Unresolved** |
| Sign-in information | Not applicable; no account |
| Notes | Draft above, conditional |
| Attachment | **Unresolved; add only if review needs an operations/data-flow note** |
