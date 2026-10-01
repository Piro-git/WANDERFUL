# Account / preparation / commerce handoff

Branch: `codex/account-preparation-commerce-20260915`
Base: `3aae5e19ec83b43196295e2dc3e98085e64046f0`
Commits: `e9b53a2` (account foundation), `46bf89f3769618cf1edd900d937a4bbcaab098d7` (validation correction), followed by the durable-repository commit on this branch.

## Integration contract

- iOS account surfaces are `AccountView`, `AccountStore`, `BackendAccountService`, and `AppleAccountAuthenticator`; integration owns root/Profile navigation and must only inject an HTTPS backend URL after the server lane is configured.
- Backend entry point is `createAppleSignInEndpoint`. It requires durable `accounts` and `sessions` implementations plus non-optional `tokenExchange` and `tokenRevoker`; it cannot be composed with in-memory production state.
- `PostgresAppleAccountRepository` and `PostgresAccountSessionRepository` plus migration `012_apple_accounts.sql` are the supplied adapter. Refresh tokens and optional email use AES-256-GCM ciphertext; Apple subjects and session tokens use keyed hashes. Sessions are 30-day, opaque Bearer records and are revoked on sign-out. Account deletion runs app-owned cloud cleanup and account deletion transactionally, with session rows removed by the database foreign-key cascade.
- Apple ID tokens are RS256 against Apple's RSA JWKS. The server-generated Apple client-secret JWT used for `/auth/token` and `/auth/revoke` is a separate ES256 secret and never reaches iOS.
- Account deletion reauthenticates, revokes the stored refresh token before deletion, deletes only the account record, encrypted refresh token, app-owned cloud account data, and server sessions. A revocation failure returns failure and leaves server and local records intact. Local saved routes and packing lists are intentionally retained.

## Current scope and release gate

The account feature must remain unavailable until migration `012` is applied under the least-privilege app-security role, a server-generated Apple client secret, Apple capability/provisioning, configured client IDs, and an accepted live device/backend flow exist. `createAppleAccountRuntime` enables only with `APPLE_ACCOUNT_ENABLED=true` and all required injected secrets; otherwise the route is a 404. No secret, personal data, or product identifier is in this branch.

Preparation is already supplied by the base (`HikePreparationView` and `PreparationStore`): checks persist per route and overnight choices are explicit; it makes no weather, water, access, or camping guarantee. Commerce is already supplied by the base StoreKit `PremiumAccessStore` and is fail-closed when valid product IDs plus legal URLs and the signed monetization configuration are absent. It presents after a real route, does not grant Premium on sign-in, and uses StoreKit transaction verification. StoreKit product IDs/prices and trial eligibility remain App Store Connect configuration, not static UI claims.

## Evidence

`node --test test/appleSignIn.test.js` — 6/6 passed: RS256 validation; ES256 rejection; nonce/audience/expiry/future-iat rejection; JWKS rotation; required exchange and failed revocation preserves deletion state; encrypted account/session persistence, revocation and targeted deletion. `npm run build` checked 371 JavaScript files. `git diff --check` passed. No large Xcode build, simulator, Apple portal, StoreKit sandbox, physical-device, external token-exchange, or purchase test was run.
