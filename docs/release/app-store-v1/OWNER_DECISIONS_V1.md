# Owner Decisions V1

Status: **all unchecked decisions remain UNKNOWN and block any dependent submission field**

This checklist contains product/legal/account decisions an engineer must not fabricate.
`OWNER_INPUTS_V1.json` is the machine-validated, deliberately unanswered companion template. A checkbox in this Markdown file is never sufficient evidence by itself. Record the decision maker, date, exact answer and independently reviewable evidence in the authorized release system; keep credentials, tax/banking records and private account material out of git.

## Minimum closure record

For every checked item, the external record must contain: decision ID, accountable owner, UTC decision date, exact approved value, rationale, evidence reference, affected gate IDs, selected app version/build and reviewer. If any field is absent, keep the item unchecked and the gate blocked.

## Apple and commercial identity

- [ ] `ASV1-006` — Confirm active Apple Developer team, exact legal entity/developer name, Account Holder and authorized release operator.
- [ ] `ASV1-007` — Approve App Store Connect app record, immutable SKU, primary language and name-availability/right for **Wanderful**.
- [ ] Confirm that `com.trailmind.app` remains the V1 bundle identifier despite the Wanderful shipping name; any change requires an explicit migration decision.
- [ ] Approve `com.trailmind.app.staging` as the separate internal staging App ID and enable App Attest on both staging and production identifiers.
- [ ] Approve copyright owner/year and applicable trader/business disclosures.
- [ ] Confirm current agreements and any tax/banking prerequisites required for paid distribution; do not copy those records into this repository.

## Product scope and positioning

- [ ] `ASV1-003` — Decide whether Superwall, paywalls, purchases and subscriptions are excluded from V1. Recommended current decision: exclude until separately configured, reviewed and proved.
- [ ] `ASV1-008` — Approve primary category. Draft: Navigation. Approve or omit secondary Health & Fitness after regulated-device/discoverability review.
- [ ] Approve geographic storefront availability and truthful route/backend coverage boundary; do not claim national/global evidence coverage.
- [ ] Approve the metadata draft and forbidden-claims ledger (`ASV1-026`).
- [ ] Decide whether optional voice transcription is marketable in V1 only after permission, accessibility and real-device proof.

## Privacy, legal and safety

- [ ] `ASV1-004` — Approve legal owner/content and publish the real HTTPS privacy-policy URL.
- [ ] `ASV1-005` — Approve a monitored public support contact and publish the real HTTPS support URL.
- [ ] Decide whether to publish a marketing URL; omission is valid for V1.
- [ ] `ASV1-002` — Approve final App Privacy answers only after onboarding/Supabase/Superwall/backend evidence.
- [ ] `ASV1-009` — Obtain legal export/encryption classification and approve App Store answers/plist declaration, if applicable.
- [ ] `ASV1-008` — Complete the current age-rating questionnaire; do not infer a rating.
- [ ] `ASV1-023` — Approve content-rights declaration for name, icon/art, code, maps, routing/elevation data and onboarding assets.
- [ ] Approve safety wording and confirm the app is not represented as emergency, medical, guaranteed-safe or live-navigation functionality.

## Accounts, onboarding and deletion

- [x] Source fact, not an owner choice: integrated V1 creates no Supabase/anonymous/guest/user account and composes no remote profile sync.
- [ ] Approve that remote Trail Profile sync remains excluded from V1; any future activation requires account/deletion/privacy review.
- [ ] Approve the local profile fields and purposes: activity, comfort range, route shape, requested experiences and soft avoidances.
- [ ] Approve the native onboarding behavior and any remaining human VoiceOver/rotor accessibility exceptions.

## Release operations

- [ ] Approve the supported production-backend environment and operational owner (`ASV1-011`).
- [ ] Approve the physical-iPhone App Attest proof window and reviewer (`ASV1-010`).
- [ ] Approve screenshot device/localization set after Stage B (`ASV1-015`).
- [ ] Approve internal/external TestFlight groups, review account if required, pricing and release mode (manual/automatic/phased) only after all gates pass.
- [ ] Approve storefront territories separately from technical backend coverage; record any territory exclusions and the customer-facing coverage wording.
- [ ] Provide explicit authority before signing distribution, upload, TestFlight mutation or App Review submission.

Record decisions in an access-controlled release system with decision maker, date, rationale and evidence. Do not insert private account data or credentials in this repository.
