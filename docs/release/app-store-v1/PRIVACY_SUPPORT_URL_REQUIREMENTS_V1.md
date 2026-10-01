# Privacy and Support URL Requirements V1

Status: **validated fail-closed static package implemented; owner inputs, hosting, and both production URLs remain empty/UNKNOWN; public release blocked**
Placeholders are forbidden in App Store Connect and shipping UI.

Apple requires an iOS privacy-policy URL and requires the privacy policy to be easily accessible inside the app. A Support URL is required and must lead to actual contact information. Privacy and platform-version requirements rechecked 2026-08-28; App Review Guidelines rechecked 2026-08-26: [Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/), [App Review Guidelines 5.1.1](https://developer.apple.com/app-store/review/guidelines/), [platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/).

## Privacy policy page

Owner: `UNKNOWN`
Production HTTPS URL: `UNKNOWN`
Blocker: `ASV1-004`

The published page must:

- identify the real legal controller/developer and the product Wanderful;
- provide an effective date, version/history approach and applicable jurisdiction/contact;
- enumerate data collected by the app, backend and third-party SDKs, including linkage, purpose, retention and deletion;
- cover typed place names, geocoded/routed coordinates and constraints, App Attest identifiers, IP/server logs, saved/exported routes, voice/Speech processing, onboarding/profile/Auth, and Superwall/purchase data exactly as shipped;
- name or categorize processors and link their policies where legally appropriate: Apple services, GraphHopper, OpenStreetMap/Mapterhorn attribution, hosting, Supabase and Superwall only when active;
- explain tracking/advertising status and consent choices without making an unproved “we collect nothing” claim;
- explain user rights, deletion initiation, appeal/contact and retention/backups;
- distinguish local-only data from data transmitted off-device and user-directed GPX sharing;
- match the final App Privacy questionnaire and remain available without login or geoblocking in review regions.

The app now exposes a native Privacy & data destination and conditionally shows an accessible external policy link only when `PublicAppLinks` accepts a canonical public HTTPS destination. Missing, placeholder, local, malformed, credential-bearing, query/fragment and non-canonical values fail closed. The tracked Production value remains empty, so there is no public policy link to claim or test yet.

The deployable static source package is in `public-site`. It contains privacy, support, privacy-choices, and terms templates plus a renderer/validator that rejects placeholders and incomplete owner inputs. `PRIVACY_POLICY_CONTENT_DRAFT_V1.md` remains the historical disabled-engine drafting baseline. The new public template covers the engine-enabled launch boundary but cannot be rendered for publication until the real controller, contact, processors, legal bases, retention, transfers, and host behavior are approved.

## Support page

Owner: `UNKNOWN`
Production HTTPS URL: `UNKNOWN`
Public support email/contact: `UNKNOWN`
Blocker: `ASV1-005`

The page must:

- identify Wanderful and the responsible legal/support operator;
- provide a monitored contact method and expected service window without fabricating an SLA;
- include troubleshooting for onboarding, typed planning, permissions, no-route/network states, saving and GPX export;
- explain that Wanderful is a planning aid, not emergency support or live navigation;
- give a separate privacy/deletion request path and describe identity verification safely;
- include applicable legal address/trader information and consumer disclosures selected by counsel;
- remain reachable over valid HTTPS without authentication, redirects to unrelated products or broken contact controls.

The app now exposes a native Help & safety destination and conditionally shows an accessible external support link through the same strict `PublicAppLinks` boundary. The tracked Production value remains empty. The new `public-site/support/index.html` template does not invent a contact, domain, operator, phone, or service level and is visibly draft-only until a validated release render removes that state.

## Optional marketing URL

Omit it for V1 unless the owner publishes a real, app-specific, rights-cleared HTTPS page whose claims match the selected build. Blocker `ASV1-024` is not satisfied by a social profile, placeholder or internal deployment.

## Deletion and retention acceptance criteria

Before publication, document:

1. What “delete account” and “delete local data” each remove.
2. Whether an anonymous/guest account exists and how deletion is initiated inside the app.
3. Deletion behavior for Auth identity, profile rows, saved routes, events, App Attest records, support logs and backups.
4. Retention periods or defensible retention criteria for every off-device data class.
5. How deletion failures/retries are surfaced and how resurrection from stale local/legacy writes is prevented.

Apple requires in-app account-deletion initiation when account creation is supported. Source: [Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/).

## Reachability and content validation

Run from a clean network before selecting the build:

- HTTPS succeeds with a trusted, non-expired certificate and no mixed content.
- Final URL returns a successful page, not a placeholder, parked domain, authentication wall or client-only error.
- Links, mail/contact forms and deletion instructions work on iPhone with VoiceOver and Larger Text.
- Pages are readable without JavaScript where practical and declare language/viewport correctly.
- App Store Connect metadata, in-app link and policy canonical URL are identical or intentionally redirected.
- Archive a dated PDF/HTML or content hash for legal evidence without adding personal support submissions to git.

No reachability test is authorized until the owner supplies and separately authorizes the actual deployment. The local templates, validator regressions, HTML syntax, and responsive browser behavior can be tested without external mutation. The owner procedure is `DEPLOY_STATIC_LEGAL_SITE_V1.md`.
