# App Store Connect App Privacy draft

Status: **not ready to publish**
Evidence date: 2026-07-17
Release scope: iPhone-only TrailMind beta with local intent parsing and remote routing

Apple requires answers to include the practices of the app and relevant third-party partners. See [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/) and [Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy).

## Proposed top-level answer

**Yes, data may be collected from this app.**

Do not select "Data Not Collected." App Attest deliberately maintains an app-scoped installation record on the TrailMind backend, and routing/geocoding data leaves the device.

## Data types ready to answer

| App Store data type | Collected | Linked | Tracking | Purpose | Evidence |
|---|---:|---:|---:|---|---|
| Identifiers → Device ID | Yes | Yes | No | App Functionality | App Attest key/installation record protects backend requests and is associated with one app installation |

`Device ID` must remain declared unless the App Attest server architecture changes. Hashing the key identifier does not make the installation association unlinked.

## Conservative pending answers

These entries cannot be finalized until provider and infrastructure retention is documented. The safe working rule is: **declare unless evidence proves the data is used only to service the request in real time and meets Apple's current definition of not collected.**

| Candidate data type | Why it may apply | Working linkage/purpose | Evidence needed before App Store Connect |
|---|---|---|---|
| Location → Precise Location | Resolved start/end coordinates have latitude/longitude precision and are sent through the backend to GraphHopper | Potentially linked to the app installation through the authorized session; App Functionality | GraphHopper and hosting log/retention contracts plus observed production traffic |
| User Content → Other User Content | Place-name queries are sent to Apple geocoding; routing preferences/constraints are sent to the backend | App Functionality; linkage depends on service retention | Apple-service disclosure review, backend/edge log review, and counsel/owner decision |
| Search History | Route-place searches may fall within Apple's search-history interpretation if retained | App Functionality | Confirm current App Store Connect definitions and every recipient's retention |
| User Content → Audio Data | Optional voice audio may be processed by Apple's Speech service | App Functionality; TrailMind does not retain it | Confirm whether Apple service processing is reportable for this app and document Apple terms |
| Network-address-derived identifier | The backend hashes the request connection address, or a deployed edge-resolver value, into short-lived rate windows | App Functionality; actual linkage depends on the deployed resolver and retention | Observe production behavior and classify the address by its use under Apple's guidance, which may require Device ID, location, or diagnostics disclosure |

The app does not read the person's current device location. That fact does not by itself resolve whether user-entered route coordinates count as `Precise Location` after geocoding.

## Data types source does not support today

Unless a later traffic/archive review contradicts the source, do not select:

- contact information;
- health or fitness records;
- financial information or purchases;
- contacts;
- photos or videos;
- browsing history;
- account/user ID;
- advertising data;
- analytics/product-interaction data;
- crash or performance collection by TrailMind;
- other diagnostic data, unless the unresolved network-address use above is ultimately classified there;
- environment scanning, body, hands, or head data.

This is not permission to answer `No` for all diagnostics: hosting-provider logs and any Apple-generated diagnostics must be reviewed separately.

## Uses

Current source supports only **App Functionality**:

- parse a route request locally;
- geocode entered place names;
- calculate and return a route;
- protect the service from replay, fraud, and excessive provider cost;
- save or export a route when the person requests it.

Do not select advertising, developer marketing, analytics, or tracking purposes.

## Tracking

Proposed answer: **No, TrailMind does not use data for tracking.**

Required proof before publishing:

- no tracking domains in the generated Xcode privacy report;
- no advertising/analytics SDK in the signed archive;
- provider contracts do not permit TrailMind data to be combined for targeted advertising or measurement;
- production traffic and logs match the source.

## Privacy URLs

| Field | Status |
|---|---|
| Privacy Policy URL | **Unresolved — required for iOS** |
| User Privacy Choices URL | **Unresolved — recommended because backend App Attest deletion is not self-service** |
| Support URL | **Unresolved** |

Apple's App Store Connect reference confirms that a public privacy-policy URL is required: [App privacy reference](https://developer.apple.com/help/app-store-connect/reference/app-privacy/).

## Required sign-off

Before the App Manager publishes these answers:

1. Name the legal entity and privacy contact.
2. Close credential containment and rotation.
3. Record GraphHopper, Apple, hosting, and database retention, including the deployed network-source resolver, rate-window retention, and infrastructure copies of request addresses.
4. Run protected live route and intent baselines without exposing personal data.
5. Run a signed TestFlight build and inspect actual domains/traffic.
6. Generate and review Xcode's archive privacy report.
7. Reconcile this draft, the manifest, and the public policy line by line.
8. Have the Account Holder/Admin/App Manager attest that the answers are current.

No App Store Connect privacy response has been entered or published from this repository.
