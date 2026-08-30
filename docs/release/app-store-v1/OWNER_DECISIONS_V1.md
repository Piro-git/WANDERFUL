# Owner decisions V1

Status: **unchecked items are not repository facts and must be recorded in the authorized release system**

Do not put credentials, certificates, private profile contents, API keys, tax/banking records, or App Store Connect session data in this repository.

## Before TestFlight

- [ ] Approve the production GraphHopper routing gateway and operational owner.
- [ ] Confirm the routing payload, logs, retention, deletion, incident contact, and rate-limit policy.
- [ ] Confirm that provider secrets remain server-side and are not bundled in the app.
- [ ] Approve the Apple Developer team and legal developer identity.
- [ ] Confirm `com.trailmind.app` as the explicit App ID with production App Attest capability.
- [ ] Confirm version/build `1.0 (1)` is available or approve a build-number increment.
- [ ] Approve the signed-archive operator and validation evidence.
- [ ] Approve internal TestFlight tester group and beta support contact.
- [ ] Give explicit upload authority.

## Before public App Review

- [ ] Confirm name availability and rights for **Wanderful**.
- [ ] Approve copyright year/owner and rights to icon/art/code/other supplied assets.
- [ ] Publish and approve the canonical HTTPS privacy policy.
- [ ] Publish and approve the canonical HTTPS support page and monitored contact.
- [ ] Complete every item in `OWNER_LEGAL_INPUTS_V1.md`, including controller/trader details, processor regions/contracts, exact retention, legal bases, rights workflow, age, terms, and host logs.
- [ ] Render and validate `public-site` with the approved owner configuration; deploy only the rendered output and verify it from a clean device/network.
- [ ] Approve final App Privacy answers, including production routing retention and the embedded Superwall Purchase History declaration.
- [ ] If the advanced engine is enabled, approve `APP_STORE_PRIVACY_ANSWERS_ENGINE_ENABLED_V1.md` against its exact backend/evidence provider behavior.
- [ ] Approve App Store Connect record, immutable SKU, primary language, and developer name.
- [ ] Approve Navigation as the primary category and decide whether a secondary category is needed.
- [ ] Complete age-rating, content-rights, storefront/availability, and export-compliance decisions.
- [ ] Select the Apple Standard EULA or approve/configure a custom EULA; separately approve the public terms wording.
- [ ] Approve launch geography and any honest routing-coverage wording.
- [ ] Approve the English metadata and final signed-build screenshots.
- [ ] Approve review notes and deterministic reviewer route request.
- [ ] Select manual/automatic/phased release behavior.
- [ ] Give explicit App Review submission authority.

## V1 scope already fixed by the reviewed Release configuration

- [x] Research-guided planning, outdoor evidence, routable highlights, and remote intent are disabled.
- [x] Supabase onboarding/profile sync is disabled; no V1 account is created.
- [x] Superwall presentation, purchases, and subscriptions are disabled; native onboarding is used.
- [x] V1 is a planning aid, not live navigation.
- [x] Requested features are preferences, not guaranteed route facts.

Changing any checked scope item requires a new release, privacy, test, and metadata review.

## Recommended non-blocking follow-up

- [ ] Run the signed build on a physical iPhone, including optional voice permissions if voice is marketed.
- [ ] Confirm production App Attest behavior operationally.

These checks are recommended, but lack of a local physical App Attest proof is not a standalone V1 blocker in this package.
