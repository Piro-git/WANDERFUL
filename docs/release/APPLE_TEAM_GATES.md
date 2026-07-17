# Apple team and external release gates

Status: owner/account checklist
Evidence date: 2026-07-17

This file separates repository work that can proceed now from actions that require the owner's Apple team, signed hardware, provider authority, or public legal/support infrastructure.

## Can be completed without a paid Apple team

- Keep deterministic Swift, UI, backend, and harness tests green.
- Finish accessibility, contrast, Reduce Motion, and supported-iPhone layout QA in Simulator.
- Run release-source and bundle-content scanners on Simulator products.
- Verify the privacy manifest plist and focused built-bundle tests.
- Finalize metadata, screenshot captions, review-note drafts, and provider-attribution review.
- Implement release-verifier tooling and evidence templates.
- Run backend tests and real PostgreSQL integration against an authorized disposable database.
- Confirm provider retention, infrastructure logs, backup, and deletion requirements.
- Rotate/revoke exposed provider credentials and record containment without copying secret values.
- Run live 40-intent and 20-route baselines only after explicit credential/provider authorization.
- Publish owner-approved support and privacy pages.

These items should not wait for App Store Connect access.

## Requires owner identity or operational decisions

| Gate | Required decision/evidence | Current status |
|---|---|---|
| Legal entity | Developer/controller name, address, copyright owner, jurisdictions | **Unresolved** |
| Support | Public support URL, monitored email, review contact, incident owner | **Unresolved** |
| Privacy | Public policy URL, choices/request channel, legal approval | **Unresolved** |
| Provider retention | GraphHopper, Apple-service, hosting, and database handling | **Unresolved** |
| Credential incident | Rotation/revocation and containment record | **Unresolved** |
| Live evaluation authority | Permission and cost owner for 40 intent + 20 route baselines | **Unresolved** |
| Production operations | Backend owner, database, monitoring, backups, pruning, on-call | **Unresolved** |
| Language/market | Approve the Germany-first English-interface beta, Germany-biased unqualified geocoding, primary locale, territories, and reviewer path; German prompt parsing does not equal a localized German interface | **Repository behavior defined; owner decision unresolved** |

## Requires Apple Developer Program/team access

1. Confirm active program membership and roles.
2. Register or confirm the explicit App ID for `com.trailmind.app`.
3. Enable the App Attest capability for that identifier and align it with the Xcode target.
4. Set the correct `DEVELOPMENT_TEAM` and regenerate affected provisioning profiles.
5. Confirm distribution certificate/provisioning ownership.
6. Create the App Store Connect app record, reserve the name, and choose SKU/primary locale.
7. Complete age rating, content rights, category, copyright, export compliance, and availability.
8. Enter public support/privacy URLs and App Privacy responses.
9. Upload screenshots and metadata for the exact release surface.
10. Validate, upload, process, distribute, and submit builds.

Apple references:

- [Register an App ID](https://developer.apple.com/help/account/identifiers/register-an-app-id)
- [Enable app capabilities](https://developer.apple.com/help/account/identifiers/enable-app-capabilities)
- [Upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds)
- [Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy)
- [Overview of submitting for review](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/overview-of-submitting-for-review)

## Requires signed physical devices/TestFlight

- Development App Attest registration/assertion/session/replay testing on a signed physical iPhone.
- Production App Attest proof from TestFlight. Apple states that distributed builds operate in the production App Attest environment.
- Microphone/Speech permission, denial, interruption, and transcript QA.
- Installed-build saved-route protection, backup exclusion, relaunch, and delete-all checks.
- Independent third-party GPX import.
- Network degradation, background/foreground, MapKit, performance, and energy checks.
- VoiceOver, largest Dynamic Type, Increase Contrast, Button Shapes, and Reduce Motion on the declared device matrix.

Apple App Attest references:

- [Establishing your app's integrity](https://developer.apple.com/documentation/devicecheck/establishing-your-app-s-integrity)
- [Validating apps that connect to your server](https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server)
- [Preparing to use the App Attest service](https://developer.apple.com/documentation/devicecheck/preparing-to-use-the-app-attest-service)

## Requires a final signed archive

- Inspect team/application identifiers and production entitlements.
- Prove no secrets, Debug fixtures, test bundles, or insecure local networking are embedded.
- Generate the Xcode privacy report.
- Reconcile every SDK/domain/data category with the policy and App Privacy answers.
- Validate the archive and preserve its checksum/evidence.
- For standard automatic signing, preserve export/upload evidence because Xcode may apply distribution signing after creating the raw archive. The strict local archive verifier applies only to an archive already signed with Apple Distribution and an App Store profile.

The complete checklist is in [ARCHIVE_VERIFICATION.md](ARCHIVE_VERIFICATION.md).

## Suggested order

1. Close credential containment and provider authority.
2. Finish current-source verification and release-verifier tooling.
3. Verify disposable PostgreSQL plus deployed production configuration.
4. Obtain legal/support/privacy/provider-retention decisions.
5. Join the final Apple team and configure the explicit App ID/App Attest capability.
6. Prove development App Attest and voice on physical hardware.
7. Create and inspect the signed archive and privacy report.
8. Upload to TestFlight and prove production App Attest.
9. Capture approved screenshots from the exact candidate.
10. Reconcile metadata, policy, App Privacy, review notes, and archive evidence.
11. Submit only when every blocking gate is closed.

## Current decision

Closed beta/TestFlight: **NO-GO until credential, deployed backend/PostgreSQL, signed App Attest, privacy/support, and live-baseline gates are closed.**

Public App Store: **NO-GO until all beta gates plus signed archive, privacy report, metadata, accessibility/device matrix, legal/entity, and App Store Connect steps are complete.**
