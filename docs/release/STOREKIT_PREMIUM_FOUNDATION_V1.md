# Wanderful StoreKit Premium Foundation V1

## Shipping state

This foundation is deliberately inactive. `MONETIZATION_ENABLED` is `false` in
the shared configuration and Development protects it as `false` after the
optional local include. Product identifiers and the Terms of Use URL are empty.
Superwall remains inactive and is never an entitlement source.

When inactive, the app constructs a no-op premium store, makes no StoreKit
product request, presents no premium UI, and preserves the current guest-first
planning flow.

## Owner inputs required before activation

All of these must be reviewed and supplied together:

1. The exact Premium feature set and ongoing subscription value. The current
   paywall intentionally makes no feature claims that have not been approved.
2. App Store Connect auto-renewable subscriptions in one subscription group:
   a monthly product and an annual product, with complete localizations and
   pricing.
3. The production values for
   `WANDERFUL_PREMIUM_MONTHLY_PRODUCT_ID` and
   `WANDERFUL_PREMIUM_ANNUAL_PRODUCT_ID`.
4. Reviewed public HTTPS destinations for
   `WANDERFUL_PRIVACY_POLICY_URL` and `WANDERFUL_TERMS_OF_USE_URL`.
5. App Store metadata, review notes, tax/category/banking readiness, and the
   final App Privacy answers.
6. A reviewed change to set `MONETIZATION_ENABLED = true` in the intended
   signed lane and to update the release contract. Do not use runtime data or a
   remote campaign to activate it.

The configuration and release verifier fail closed if monetization is enabled
without distinct product identifiers, legal destinations, restore/manage
paths, or while Superwall is enabled.

## Entitlement semantics

- StoreKit 2 signed transactions are the authority.
- Only verified, unrevoked, non-upgraded, unexpired subscription transactions
  grant normal access.
- A verified App Store grace-period status grants access until its grace date.
- Billing retry without a verified grace period, expiry, and revocation do not
  grant access.
- Unverified transactions never unlock Premium and are never finished as a
  successful delivery.
- Successful purchases are finished only after access is granted.
- `Transaction.updates` is listened to for the lifetime of the premium store;
  `stop()` cancels the listener for deterministic teardown.
- The local cache contains only a verified product ID, transaction ID, dates,
  and expires after at most 72 hours or the subscription expiration, whichever
  comes first. It is an offline continuity aid, never an independent source of
  permanent entitlement.
- `AppStore.sync()` runs only after the user explicitly chooses Restore
  purchases. Subscription management uses Apple's system sheet.

## Value-first presentation policy

Premium never appears during first launch, onboarding, home, route generation,
or route comparison. A user must first open a verified routed result. Only then
does a non-blocking invitation appear at the end of route detail, after route
facts, safety information, and existing guest actions. Dismissal returns to the
route without penalty. No plan is preselected and no countdown, scarcity, or
forced continuity pattern is used.

## Local StoreKit test catalog

`TrailMindTests/StoreKit/Wanderful.storekit` contains test-only monthly and
annual identifiers. The shared `TrailMind` scheme references it for the Debug
launch action, and the catalog unit test opens an explicit `SKTestSession` from
the same file. It is not an app resource and its identifiers are compiled only
inside a simulator `#if DEBUG` factory.

The deterministic UI scenario is:

`--trailmind-ui-testing --trailmind-ui-scenario premium`

The UI scenario covers monthly and annual display, eligible introductory offer
disclosure, legal controls, dismissal, dark mode, and accessibility text sizes.
The premium state-machine tests cover success, cancellation, pending approval,
purchase failure, restore, expiry, revocation/refund, billing retry, grace
period, offline launch, and listener teardown. App Store sandbox and TestFlight
testing remain required because the local catalog cannot validate App Store
Connect metadata or production commerce configuration.

## Privacy review

The foundation adds no analytics, advertising, tracking, account, backend, or
developer-operated purchase-history collection. The short-lived entitlement
cache uses UserDefaults, whose required-reason declaration already exists in
`PrivacyInfo.xcprivacy`. StoreKit and Apple's subscription-management UI handle
commerce. Re-review the manifest, App Privacy answers, and public policy if the
future Premium feature set adds any new collection or third-party SDK behavior.

## Apple references

- [Auto-renewable subscriptions](https://developer.apple.com/app-store/subscriptions/)
- [Human Interface Guidelines: In-app purchase](https://developer.apple.com/design/human-interface-guidelines/in-app-purchase)
- [StoreKit 2](https://developer.apple.com/storekit/)
- [Testing in-app purchases in Xcode](https://developer.apple.com/documentation/storekit/testing-in-app-purchases-in-xcode)
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Third-party SDK requirements](https://developer.apple.com/support/third-party-SDK-requirements/)
