# TrailMind Privacy Policy — draft

> **Do not publish yet.** This draft contains unresolved legal, provider-retention, support, and deletion terms. It must be completed and reviewed by the product owner and appropriate counsel.

Effective date: **[UNRESOLVED]**
Controller/developer: **[LEGAL ENTITY AND POSTAL ADDRESS — UNRESOLVED]**
Privacy contact: **[PRIVACY EMAIL — UNRESOLVED]**
Public policy URL: **[PRIVACY POLICY URL — UNRESOLVED]**

## 1. What TrailMind does

TrailMind helps people plan same-day hiking, trail-running, and biking routes. A person can describe a route, compare mapped options, review measured route information, save verified routes on the device, and export a GPX file.

TrailMind is a planning aid, not live navigation. Outdoor conditions can change. People should review a route and check weather, trail conditions, closures, local rules, and water availability before starting.

## 2. Information processed in the current iPhone release

### Route requests

The distributed Release build parses the full typed route request on the device. It does not send the full request to a remote AI provider.

TrailMind sends the place names a person enters to Apple's geocoding service to obtain coordinates. It then sends route coordinates and routing constraints through TrailMind's backend to GraphHopper so GraphHopper can calculate route geometry, distance, duration, elevation, instructions, and available mapped characteristics.

TrailMind does not currently access the device's current location. A person enters a place name for the route start.

### Optional voice input

If a person chooses voice input and grants microphone and speech-recognition permission, Apple's Speech service may process captured audio. TrailMind does not retain raw audio or send raw audio to the TrailMind backend. The person can review the transcript before planning.

### Request protection

TrailMind uses Apple App Attest to help verify that protected backend requests come from a legitimate app installation. The App Attest key identifier is stored in the device Keychain. TrailMind's backend keeps an app-scoped installation record, including hashed identifiers and cryptographic verification material, so it can verify later requests. This is not a TrailMind user account and is not used for advertising or tracking.

### Saved routes

New saves accept only verified routed results. Saved routes are stored as protected files on the device and excluded from device backups. A saved record includes route geometry and route-planning information. Recovered legacy records remain labelled unverified.

### GPX export

GPX export creates a protected temporary file containing route coordinates. The app or person selected in the system share sheet receives that file. TrailMind attempts cleanup after sharing and removes abandoned TrailMind export files on a later launch. A recipient may retain the shared file under their own policy.

### Operational records

The routing backend is designed not to log full prompts, exact route coordinates, route bodies, tokens, challenges, assertions, or raw provider responses as application log fields. Its intended route-completion log contains a request ID, broad route metadata, status/error code, and latency. For protected-request rate limiting, the backend receives the request connection address, or a deployed edge-resolver value, and stores a one-way hash in a short-lived PostgreSQL rate window; application code does not intentionally store the raw address. **[DEPLOYED PROXY SEMANTICS, HOSTING/EDGE/DATABASE LOG CONTENT, CLASSIFICATION, AND RETENTION — UNRESOLVED]**

## 3. Purposes

TrailMind processes the information above only to:

- understand the route request on the device;
- find entered places;
- calculate and display routes;
- save or export a route when requested;
- authorize requests, prevent replay and abuse, and control third-party service cost;
- operate, secure, and troubleshoot the service.

TrailMind does not currently use the information for advertising, cross-app tracking, or product analytics.

## 4. Service providers and recipients

Current service relationships include:

- **Apple** — geocoding, MapKit display, optional Speech processing, and App Attest;
- **GraphHopper** — route calculation using route coordinates and constraints;
- **[HOSTING PROVIDER — UNRESOLVED]** — TrailMind backend execution and operational logs;
- **[POSTGRESQL/DATABASE PROVIDER — UNRESOLVED]** — App Attest security records;
- a person or app selected by the user in the system share sheet — exported GPX coordinates.

The remote-intent provider implementation remains in the binary, but the Release factory does not select or configure it. Debug evaluation can use Google or OpenRouter. Release traffic must confirm that full prompts stay on device. If remote AI becomes a Release feature, this policy and in-app disclosure must be updated before prompts are sent.

Provider processing locations, subprocessors, contractual roles, and retention periods are **[UNRESOLVED]**.

## 5. Retention

- Full typed prompts are processed in memory on the device in Release and are not intentionally persisted by TrailMind.
- The geocoder's app-side cache is in memory for the running process.
- Saved routes remain on the device until the person deletes them or removes the app.
- Temporary GPX files remain until cleanup succeeds; abandoned TrailMind export directories are retried on a later launch.
- Short-lived App Attest challenges, route sessions, replay IDs, rate windows, and leases have expiry/pruning logic.
- Hashed network-source rate-window records remain until their reset time and successful pruning; the production pruning schedule is unresolved.
- Registered App Attest installation records currently have **[RETENTION PERIOD — UNRESOLVED]**.
- Provider, infrastructure-log, and backup retention is **[UNRESOLVED]**.

## 6. Choices and deletion

A person can:

- type instead of using the microphone;
- deny or revoke microphone and Speech permission in iOS Settings;
- decide whether to save a route;
- delete one saved route;
- use **Delete All** in Saved to remove all local saved-route and unusable records;
- decide whether and where to share a GPX file;
- remove the app to clear its local container, subject to normal platform behavior.

TrailMind has no user account. A self-service backend deletion action for the App Attest installation record does not yet exist. Until one is implemented, requests must be handled through **[PRIVACY CHOICES/SUPPORT PROCESS — UNRESOLVED]**.

## 7. Security

TrailMind uses transport security, protected local files, Keychain storage, App Attest, bounded requests/responses, replay checks, rate/cost limits, and a backend-held GraphHopper credential. No method is completely secure. The operator's production database, access, backup, monitoring, and incident controls remain **[UNRESOLVED BEFORE BETA]**.

## 8. Children, legal basis, and international transfers

Age-rating position, intended minimum age, jurisdiction-specific legal bases, international-transfer mechanisms, and statutory rights language are **[UNRESOLVED — OWNER/COUNSEL REQUIRED]**. Do not add generic compliance claims without confirming the legal entity, markets, and actual provider contracts.

## 9. Changes

This policy must be updated before TrailMind adds remote AI in Release, device location, accounts, cloud sync, analytics, crash reporting, advertising, navigation/location history, or any new data recipient.

## 10. Contact

Privacy questions or deletion requests: **[PRIVACY CONTACT — UNRESOLVED]**

Support: **[SUPPORT URL AND EMAIL — UNRESOLVED]**

## Publication checklist

- [ ] Legal entity, address, contact, effective date, and public URL supplied.
- [ ] Provider roles, terms, regions, subprocessors, and retention recorded.
- [ ] Backend App Attest retention and deletion process implemented.
- [ ] Hosting, database, backup, and log practices verified.
- [ ] Signed release privacy report reconciled.
- [ ] App Privacy answers reconciled.
- [ ] In-app policy link added and accessibility checked.
- [ ] Jurisdiction/children/international-transfer language reviewed.
- [ ] Final policy approved by owner/counsel.
