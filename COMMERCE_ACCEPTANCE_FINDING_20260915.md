# P0 commerce acceptance finding

Status: **do not enable production monetization**.

The requested commercial offer is EUR 3.99 per week and EUR 39.99 per year, with a seven-day trial only when Apple reports eligibility. The current local StoreKit fixture is intentionally test-only, but it accurately models that proposed period and price structure; it is not evidence of an App Store Connect product or a Sandbox purchase:

- `TrailMindTests/StoreKit/Wanderful.storekit`: `test.app.wanderful.premium.weekly`, `P1W`, display price `3.99`, no introductory offer.
- Same fixture: `test.app.wanderful.premium.annual`, `P1Y`, display price `39.99`, `P1W` free introductory offer.
- `TrailMind/Services/AppEnvironment.swift`: configuration keys and fields are `WANDERFUL_PREMIUM_WEEKLY_PRODUCT_ID` / `weeklyProductIdentifier`.
- `TrailMindTests/StoreKitCatalogTests.swift` explicitly asserts the one-week subscription, its EUR 3.99 test display price, and the annual fixture's one-week introductory offer.

No App Store Connect product identifiers, live localized prices, subscription group, trial eligibility decision, sandbox receipt, purchase/cancel/restore evidence, or expired-entitlement device evidence has been verified. `MONETIZATION_ENABLED` remains false in release configuration and this is correct.

Required external acceptance before enabling the gate:

1. Create and approve the intended weekly and annual products in the correct App Store Connect subscription group; obtain their actual product IDs without putting prices in app code.
2. Configure the annual introductory offer only after eligibility/business approval, then verify it with StoreKit Sandbox.
3. Replace the test-only weekly and annual identifiers, periods, and offers throughout the StoreKit fixture and tests only once the actual products and commercial terms are approved.
4. Have the integration owner run StoreKit purchase, user-cancel, restore, expired, revoked, and no-entitlement flows on a supported simulator/device.

Until then, StoreKit's returned localized display prices and entitlements are the only permissible UI source of truth; a login does not grant Premium.
