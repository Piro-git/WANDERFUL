# App Store Privacy answers — engine-enabled V1

Status: **decision sheet only; do not publish without final production and signed-artifact evidence**

Assessment date: 2026-08-30

This document applies only if the advanced research/routing engine is enabled in the submitted V1 build. It does not change the current tracked Release flags or prove a production backend. Apple's current definition of “collect” generally turns on whether data transmitted off-device remains accessible to the developer or third-party partners beyond what is needed to service a request in real time. Final answers therefore depend on exact deletion, provider access, and logging—not simply on whether a value crosses the network.

## Engine-enabled data-flow boundary

- The app may send the typed prompt, requested place names or coordinates, activity, distance/duration, route type, constraints, and preferences to the Wanderful backend.
- The backend may use those fields to understand the request and query enabled outdoor-evidence services.
- GraphHopper receives the coordinates, routing profile, and constraints needed for route calculation; it should not need a Wanderful user identity or the full free-form prompt.
- App Attest supplies installation/security data. Bounded connection, abuse-prevention, and operational logs may persist for a defined period.
- V1 has no sign-in, user-facing account, Supabase profile sync, cloud-saved routes, subscriptions, purchases, advertising, or first-party analytics.
- Trail Profile, onboarding state, and saved routes remain local. Optional Apple Speech starts only after an explicit action and permission; Wanderful does not retain raw audio or send it to its backend.

## Provisional App Store Connect matrix

| Apple data type | Engine-enabled decision | Purpose/linkage | Evidence required before answering |
| --- | --- | --- | --- |
| User Content → Other User Content | **Declare if the prompt/constraints or derived content remain accessible after real-time fulfillment; otherwise document the real-time exception before omitting** | App Functionality; potentially linked through App Attest installation/security records | Backend payload, memory/queue/cache behavior, evidence queries, provider retention, logs, backups, deletion window |
| Location → Precise Location | **Declare if exact route coordinates remain accessible after real-time fulfillment; otherwise document the real-time exception before omitting** | App Functionality; potentially linked through installation/security records | Geocoding payload, backend/GraphHopper access, logs, provider contract, retention and deletion |
| Identifiers → Device ID | **Yes** under the current first-party privacy manifest | App Functionality / request protection; linked to an app installation rather than a visible account | Exact signed-archive privacy report, App Attest record design, retention and deletion |
| Diagnostics or other request metadata | **Owner decision required** if IP address, user agent, response status, performance, or error detail is retained | App Functionality, Security, or Analytics only as actually used | Exact log schema and current App Store Connect type/purpose definitions; do not label security logs as analytics unless used that way |
| Audio Data | **Do not declare as developer collection only if Apple Speech remains user-invoked and Wanderful/its partners cannot access retained raw audio** | Apple platform speech processing | Final binary flow, Apple service terms, no backend/raw-audio logging proof |
| Purchases → Purchase History | **Conservative Yes while the embedded Superwall privacy manifest declares it** | App Functionality; manifest says not linked, even though the V1 paywall/purchase surface is disabled | Exact signed-archive Xcode privacy report and current Apple guidance; remove only with evidence or remove the SDK in a separately reviewed change |
| Trail Profile, onboarding, saved routes | **No developer collection while strictly on-device** | Local app functionality | Final build proves Supabase sync/account/cloud saves remain disabled |
| Support email | **Policy disclosure required; App Privacy answer requires owner review of intake path and current form scope** | Support | Mailto-only website, receiving mailbox/provider, retention, whether data is collected through the app |

Service-to-service evidence searches are not automatically a user's “Browsing History.” Classify the underlying prompt, location, or other content according to Apple's definitions and actual retention instead of stretching an unrelated category.

## Tracking and advertising

- **Tracking:** No, only if the final app, backend, site, SDKs, and providers do not link Wanderful data with third-party data for targeted advertising/measurement or share it with data brokers.
- **Advertising or marketing:** None in the reviewed V1 product boundary.
- **Analytics:** None for first-party product analytics in the reviewed V1 boundary. Ordinary bounded security/availability logs must be classified by their actual use.

The public static site has no cookies, JavaScript, browser storage, analytics, tracking pixels, embeds, forms, or remote fonts. Its host can still receive ordinary HTTP request metadata; that belongs in the policy and provider/retention review.

## Account and deletion answer

V1 has no user-facing account or sign-in, so Apple's in-app account-deletion requirement is not applicable. Local Trail Profile and saved-route deletion controls must remain available. The privacy contact handles rights requests concerning support correspondence or any retained backend/security record. Enabling Supabase Auth, remote profile sync, or cloud-saved routes requires a new in-app account/data deletion design and a new review.

## Final-answer stop gate

Before entering App Store Connect answers:

1. freeze the exact production engine/provider configuration and prove payload, queue/cache, logs, deletion, backups, regions, and contracts;
2. decide whether prompt and precise-coordinate handling qualifies as real-time-only under Apple's current definition or must be declared as collected;
3. reconcile the Xcode privacy report from the exact signed archive, especially Device ID and embedded Superwall Purchase History;
4. verify no tracking, advertising, product analytics, Supabase sync, accounts, purchases, or cloud saves are reachable;
5. approve the matching rendered privacy policy and processor/retention statements;
6. have the privacy owner record each final answer and its evidence date in the authorized release system.

Primary Apple sources are recorded in `LEGAL_AND_PLATFORM_SOURCE_NOTE_V1.md`.
