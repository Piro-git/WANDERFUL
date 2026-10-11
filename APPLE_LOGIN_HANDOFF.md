# Apple Login handoff

Base: `3aae5e19ec83b43196295e2dc3e98085e64046f0` (nested `.routing-repair`).

This branch adds standalone iOS account/authentication services, a native account screen, focused iOS fixtures, Apple ID-token verification and account endpoint module tests. It does not change onboarding composition, `ProfilePreferencesView`, StoreKit/Superwall, `server.js`, provisioning, developer portals, Supabase, or production data.

Integration owner: compose `BackendAccountService` only after supplying a signed-lane backend URL and add `AccountView` as a Profile destination. On the backend, apply the documented three endpoint dispatch additions in `backend/integration-patches/APPLE_SIGN_IN_SERVER_INTEGRATION.md`, backed by durable encrypted storage. The production repository's `deleteAccountData` must delete its account row, encrypted Apple refresh token, and only app-owned cloud rows transactionally; saved routes and packing lists on the device are intentionally untouched.

Evidence: `node --test test/appleSignIn.test.js` passes (signature, nonce, expiry, audience). `xcodebuild` was attempted with an isolated DerivedData path but could not resolve cached SPM dependencies because the host volume is out of space; no simulator or live Apple route was attempted. `git diff --check` passes.
