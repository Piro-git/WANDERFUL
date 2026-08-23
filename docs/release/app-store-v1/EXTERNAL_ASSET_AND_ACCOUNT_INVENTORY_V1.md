# External Asset and Account Inventory V1

Status: **UNKNOWN values are intentional; no external account or public asset was inspected or mutated**
Assessment date: 2026-08-23

| Item | Current evidence | Owner | Required acceptance evidence | Blocker |
| --- | --- | --- | --- | --- |
| Shipping product name | `Wanderful` in source | Product/legal | Name availability, trademark/right and App Store record | ASV1-007 |
| Apple legal entity/developer name | UNKNOWN | Account Holder/legal | Active Program membership and exact public developer identity | ASV1-006 |
| Apple team ID | UNKNOWN | Account Holder | Verified team record; never infer from local artifacts | ASV1-006 |
| Explicit App ID | Bundle source is `com.trailmind.app`; portal state UNKNOWN | Apple release owner | Matching explicit ID with App Attest enabled | ASV1-006 |
| Distribution certificate/profile | UNKNOWN | Apple release owner | Current Apple Distribution identity and App Store profile | ASV1-006 |
| App Store Connect app/Apple ID | UNKNOWN | Product/App Store owner | Real app record linked to exact bundle ID | ASV1-007 |
| SKU | UNKNOWN | Product/App Store owner | Owner-selected immutable SKU | ASV1-007 |
| Version/build | Source `1.0` / `1` | Release owner | Unique selected upload build and approval | ASV1-020 |
| Privacy policy URL | UNKNOWN | Legal/privacy/web | Public reachable HTTPS page plus in-app accessible link | ASV1-004 |
| Support URL | UNKNOWN | Support/web | Public reachable HTTPS page with working contact | ASV1-005 |
| Support email/contact | UNKNOWN | Support/legal | Monitored public contact and applicable legal details | ASV1-005 |
| Marketing URL | Omitted by draft | Product/marketing | Optional real page with build-matching claims | ASV1-024 |
| Legal terms/EULA | Apple standard EULA or custom choice UNKNOWN | Legal | Owner decision and published custom terms if chosen | ASV1-008 |
| Age rating | UNKNOWN | Product/legal | Completed current App Store Connect questionnaire | ASV1-008 |
| Content-rights declaration | UNKNOWN | Legal/product | Rights inventory and App Store declaration | ASV1-023 |
| Export compliance | UNKNOWN | Legal/security | Encryption classification and App Store answers/docs | ASV1-009 |
| Primary/secondary category | Navigation / Health & Fitness draft only | Product | Owner-approved App Store categories | ASV1-008 |
| Geographic availability | UNKNOWN | Product/legal/operations | Approved storefronts and truthful coverage boundary | ASV1-008 |
| App icon rights | Source and built opacity are locally proved; ownership UNKNOWN | Brand/legal | Rights provenance/content-rights declaration | ASV1-023 |
| App Store screenshots | Not created | Marketing/release/accessibility | Real selected-build captures at accepted sizes | ASV1-015 |
| Production backend | Tracked URL exists; availability/owner proof UNKNOWN | Backend/operations | Health, contract, retention, flags and App Attest enforcement | ASV1-011 |
| GraphHopper account/terms | Client/backend integration exists; account state not inspected | Backend/legal | Authorized plan, terms/attribution and operational limits | ASV1-011, ASV1-023 |
| OpenStreetMap/Geofabrik data | OSM attribution exists; exact deployed extracts/Geofabrik use UNKNOWN | Backend/legal | Deployed-source attribution/ODbL compliance record | ASV1-011, ASV1-023 |
| Mapterhorn elevation | Attribution exists; deployed use/terms evidence UNKNOWN | Backend/legal | Exact deployed role and attribution/terms record | ASV1-011, ASV1-023 |
| Supabase project/region | Read-only integration report identifies project `bejvhhjbgtvctpsnlwid`, `eu-central-1`; V1 source sync is disabled/non-activatable | Onboarding/privacy/backend | Future activation requires schema-drift resolution, disposable dynamic RLS proof, retention/deletion and processor review | ASV1-002 |
| Superwall account/API key/placements/products | SDK 4.16.1 linked; tracked/built key empty; native V1 composition does not construct/present client; Release manifest/resources inspected; remote account state not inspected | Onboarding/product/privacy | Owner-approved V1 exclusion | ASV1-003 |
| Review/demo account | Not applicable: integrated V1 creates no account or sign-in | App Review owner | Re-open only if selected build changes authentication | — |

## Attribution sources

Current in-app About source credits Apple MapKit, GraphHopper/OpenStreetMap and Mapterhorn. Provider requirements retrieved 2026-08-23: [GraphHopper attribution](https://www.graphhopper.com/attribution/), [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright). Final attribution must reflect the exact deployed data flow, including any Geofabrik-sourced extracts; source copy alone does not prove deployed compliance.

## Inventory handling

- Store contracts, certificates, profiles, tax/business records, support submissions and account screenshots outside git in the authorized release system.
- Record only redacted identifiers/evidence links needed for audit.
- Never add passwords, private keys, API keys, tokens, `.env` contents or `Configuration/Local.xcconfig` to this package.
- Reconcile the inventory again against the selected signed archive and any later activation of dormant SDK paths.
