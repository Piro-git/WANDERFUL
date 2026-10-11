# Launch V4 — current release package

Date: 2026-09-10. Base: a80862136ee26152ce35cd50da5732049e8cd823 from hash-verified snapshot bundle. This is a new working package, not a claim of prior clean Git history or App Store readiness.

## User journey audit and changes

| Surface | Finding / result | Acceptance still needed |
| --- | --- | --- |
| Onboarding | Native optional defaults existed but required stepping through the questionnaire; added Skip personalization on welcome. Reset/delete already exist in Profile. | Fresh install and resumable-draft checks on phone |
| Home | Typed/voice/example submissions lacked explicit third-party AI data-sharing permission; added request-scoped opt-in naming backend, Google Gemini, research recipients and GraphHopper. | Denial sends nothing; both entry paths block submission until opt-in; edit/new request resets opt-in |
| Results | Comparison and source/limitation surfaces already exist; Help now explains estimated time, Closest Match, research limitations and unavailable results. | Real AI result and source/date review on final build |
| Privacy/support | About falsely claimed complete prompt stays local; corrected. Existing help, local-delete controls and public-link validation retained. | Real public URLs/contact; location disclosure reconciled with navigation |
| Purchases | StoreKit restore, management, period/price, error/pending/cancel/verified state foundations exist. Monetization is disabled in current resolved launch feature boundary. | Explicit launch business decision before enabling; no new products added |
| Navigation/offline | Navigation owns background guidance/local route preparation; Apple basemap download remains unresolved. | Physical screen-lock/app-switch/no-network acceptance by phone |

## Concrete owner inputs

1. Legal operator name/form, postal address/country, rights holder/year, trader/register/VAT status as applicable, intended age and chosen EULA. Supply facts, not credentials.
2. Monitored support and privacy email, canonical HTTPS domain, hosting provider, support retention and site access-log retention.
3. For the exact backend deployment: hosting region/operator, Google Gemini service/tier and data-use terms, research/search providers, GraphHopper role/region, international safeguards, actual prompt/response/cache/log retention (including failures) and deletion workflow. Do not substitute source-code intentions for deployed practices.
4. Launch purchase decision: keep the existing no-purchase configuration, or provide real product benefits/IDs/price decision for a separate StoreKit activation and sandbox acceptance. No invented subscription or free-forever claim.
5. Phone supplies final App ID/version/build, operational production endpoint confirmation, actual AI receipt, real device navigation result and final screenshots. No secrets in this package.

Fill public-site/config/owner-inputs.placeholder.json in an owner-controlled separate file. Added mandatory AI_PROCESSING_DETAILS and GUIDANCE_AVAILABILITY_DETAILS ensure neither provider-retention facts nor untested navigation availability can be silently published. The checked-in config intentionally fails release rendering.

## App Privacy worksheet for current AI scope

| Data flow | Source evidence / draft treatment | Required production answer |
| --- | --- | --- |
| Request text and relevant profile defaults | OutdoorAdventurePlanningClient encodes intent for backend planning; AI uses derived request context. Treat as user content for app functionality, with location where present. | Actual provider payload, retention and linked status |
| Planned places/coordinates | Backend and GraphHopper need routing coordinates/constraints; search providers can receive area/query context. | Precise/coarse data classification, retention and linkage |
| App Attest installation/security data | Existing app manifest declares linked Device ID for app functionality; one-way source hash is described. | Deployed records/retention/deletion, manifest and questionnaire reconciliation |
| Device GPS | Active guidance uses precise position; no track history claim permitted without source/device proof. | navigation/phone final behavior and any transmission |
| Voice | Optional Apple Speech may send audio to Apple; transcript can enter planning after permission. | Physical permission test; no raw-audio retention claim beyond verified implementation |
| Local profile/saves and GPX | Local controls and user-directed export exist. Relevant profile defaults can leave the device in a planning request even though stored profile remains local. | Confirm no remote profile sync and backup rules |
| Purchase data | StoreKit/Superwall foundation exists but monetization inactive. | Inspect embedded SDK manifest and actual activation; do not infer zero collection just from hidden UI |

Do not finalize “Data Not Collected” or promise zero retention. Local deletion does not erase provider/security/support records. AI-service training/retention terms depend on the actual service/tier and deployment; operator confirmation is required.

## Final screenshot / phone checklist

Capture the final integrated signed build, not this clone or earlier fixture proof: welcome + skip, typed composer and off-by-default sharing control, real AI comparison, route detail/source limitation, saved route, Profile privacy/help. Add guidance/offline-state captures only after accepted device tests. Use non-sensitive places. Confirm VoiceOver labels, large text and keyboard access for the longer composer.

Exercise: skip and full onboarding, cancel opt-in (zero planner request), both typed/example paths with opt-in, clarification/retry, edit/new composer reset, voice denied then typed, no-route/network recovery, save/export/delete, support/privacy links. StoreKit tests only if activated.

## Sources checked 2026-09-10

- [Apple App Review Guidelines 5.1.2](https://developer.apple.com/app-store/review/guidelines/): disclose third-party AI sharing and obtain explicit permission before sending personal data.
- [Google Gemini API terms](https://ai.google.dev/gemini-api/terms) and [retention guidance](https://ai.google.dev/gemini-api/docs/zdr): provider data handling varies; paid-service non-training terms do not establish zero retention for all features.

Prepared locally only. Publishing, App Store submission, final privacy/legal approval and physical device acceptance have not occurred in this release task.

## Navigation contract reconciled for integration

Navigation confirmed the active-session When In Use permission text and start/stop flags. App About now describes active background guidance, explicit pause/end, manual resume after termination, and no saved/transmitted location track. It does not assert that map requests never involve location. PrivacyReleaseContentTests now expects the location background mode, no Always keys, and background flags reset on stream stop. This contract requires the navigation commit and phone's plist change; it is not a standalone baseline change or physical acceptance receipt.

Public GUIDANCE_AVAILABILITY_DETAILS remains mandatory and unset until phone records the actual result. Store metadata does not advertise guaranteed background reliability or offline maps.
