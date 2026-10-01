# Account / Store release gate — 2026-09-26

Base: `c2ed264988a3a2ebc3f9bbe5d6a2f61324c449ff`, verified against the clean authoritative `codex/integration-20260915` recovery repository. Work is isolated on `codex/account-store-release-20260926`. No backend deployment, Apple configuration change, purchase, account deletion, physical-device installation, TestFlight upload or App Review submission was performed by this task.

**Decision: NO-GO for enabling Apple accounts or purchases; NO-GO for a claimed TestFlight-ready package.** The corrected source is reviewable, but compilation and synthetic tests do not establish Apple runtime acceptance.

## Changes and evidence

- Native `SignInWithAppleButton` now prepares its own nonce-bearing request and consumes its own completion. It no longer starts a second authorization controller. Controller-based reauthentication remains for deletion and rejects overlapping native requests. Unused name/email scopes are no longer requested.
- Account view provides sign-out, disables deletion when signed out, explains that deletion does not cancel an Apple subscription, and avoids claiming data remained unchanged after an uncertain server response.
- The local Apple user identifier is persisted only with the Keychain session (not added to the backend payload). Account view confirms credential state on entry/foreground and on Apple's credential-revoked notification. Confirmed invalid state clears the captured local session even if backend sign-out fails; transient Apple lookup errors do not confirm access or erase storage. An old check cannot erase a replacement login. Legacy sessions remain decodable but require a fresh sign-in before displaying confirmed access.
- Premium checks its access deadline at use time. Grace-period status cannot override transaction revocation or upgrade. Restore reports failure if entitlement refresh failed after `AppStore.sync()`. The real StoreKit adapter now also rejects an unavailable product catalog instead of returning an empty successful status result.
- Local StoreKit runtime catalog/transaction tests now fail when the catalog or transaction control is unavailable instead of silently skipping those gates.
- Release artifact contract additionally requires `WANDERFUL_ACCOUNT_ENABLED=false` and `WANDERFUL_APPLE_SIGN_IN_ENABLED=false`, with adverse artifact tests for accidental overrides.

| Gate | Code / local evidence | Simulator runtime | Apple / real runtime | Decision |
| --- | --- | --- | --- | --- |
| Sign in | Single native request fixed; fresh nonce/cancel/overlap regressions pass. Backend identity suite 6/6 passes, covering RS256, issuer/audience/expiry/nonce and code-exchange binding. | Account suite 18/18 passes with injected Apple/backend dependencies; no real sign-in | ASC redirects to login; source has no `com.apple.developer.applesignin`; production account variables absent per deploy-owner inspection | NO-GO; both iOS flags remain false |
| Account deletion | Server revokes refresh token before deleting account records; SQL account sessions cascade. Failure preserves local session. UI warning corrected. | Deletion/session regressions pass in the 18-test account suite; real revoke/delete unproved | No live revoke/delete receipt; fresh one-time reauthentication and server-side remote revocation remain unproved; local Apple credential checks are implemented but not runtime-accepted | NO-GO |
| Weekly / annual / restore | StoreKit supplies localized prices/periods; verified-only entitlement, cancellation, pending, restore, expiry/refund handling. Premium suite 21/21 passes, including four new regressions. | Real local StoreKit catalog/lifecycle tests executed: 3 FAIL, 0 skipped; same failures with unsigned and ad-hoc signed testhost | Actual product IDs, prices, subscription group, availability, agreements and sandbox tester unknown | NO-GO; monetization remains false |
| Privacy / support | Native controls and attribution source present; existing privacy worksheet retained. First-party manifest declares linked Device ID; embedded SDKs require reconciliation. | Final integrated UI not accepted | Production policy/support/terms URLs unset in tracked configuration; operator, retention and ASC declarations unapproved | NO-GO for publication |
| Screenshots / metadata | Current V4 draft and capture plan exist | No final candidate captures | No verified ASC metadata/rights/rating/export decisions | NO-GO; no login, purchase or offline-map marketing |
| TestFlight | Debug build and XCTest build-for-testing pass; release verifier self-tests pass (51 cases + stale-report recovery) | Release build passes; actual artifact verifier fails 8 checks (see evidence); no device acceptance inferred | No confirmed distribution identity/profile, app record, unique build number or upload receipt | NO-GO; prepare only |

### Evidence boundaries

`evidence/local-validation.txt` records command outcomes. The actual unsigned Release simulator artifact **fails** the artifact verifier (37 pass / 8 fail): four signing-related checks, plus permission contract, forbidden info keys, composition markers and attribution markers. Current background location wording/mode differs from the legacy contract. These remaining gates were reported to the iPhone integrator; no gate was relaxed to manufacture success. Backend tests are isolated cryptographic/repository fixtures, not calls to Apple or production data. The `.storekit` IDs starting with `test.app.wanderful` and its numeric prices are test-only fixtures; they must not become production inputs. Test compilation is not test execution. Actual local XCTest results are in `evidence/targeted-xctest.json` and the independent ad-hoc-signed retry is in `evidence/storekit-signed-xctest.json`; account/server behavior there uses injected test dependencies, while the failing StoreKit tests call the real local test framework.

App Store Connect was opened through the in-app browser and visibly redirected to `https://appstoreconnect.apple.com/login`. No authenticated product/app/team page was reached. Therefore there is **no App Store Connect configuration evidence** beyond the login boundary. No API key or browser credential was inspected.

The backend deploy owner reports no `APPLE_ACCOUNT_ENABLED` or account client/encryption/subject/session variable names in the production inventory. This is a cross-task configuration finding, not a successful live account endpoint probe. The deploy owner later reports POST `/api/account/apple/sign-in` with an empty body returned 503 `service_unavailable` at production admission; no positive login proof. Physical signing/device acceptance belongs to the iPhone integrator.

## Handoff to the iPhone integrator

Source commit: `a97576786d224a93ac43def0ee65d2242acf306d` (iOS fixes and regression tests). The following package commit carries artifact-gate checks and this evidence. Follow-up commits add catalog-unavailability and local credential-revocation handling. Import the latest supplied local Git bundle, review `c2ed264..codex/account-store-release-20260926`, then cherry-pick explicitly; do not merge the obsolete default branch or overwrite another worktree. No activation settings changed.

The following targeted test selection was executed. Rerun it after toolchain/runtime repair before granting local StoreKit acceptance:

```sh
xcodebuild -project TrailMind.xcodeproj -scheme TrailMind \
  -configuration Debug -destination 'platform=iOS Simulator,id=A9194E37-28A7-450E-9F30-95D0145D0486' \
  -parallel-testing-enabled NO \
  -only-testing:TrailMindTests/AccountAuthenticationTests \
  -only-testing:TrailMindTests/PremiumAccessTests \
  -only-testing:TrailMindTests/StoreKitCatalogTests \
  -only-testing:TrailMindTests/StoreKitTransactionLifecycleTests \
  test
```

These suites include real local StoreKitTest calls and no silent skip for missing catalog/transaction control. Keep their failure distinct from unit-test failures and Apple Sandbox. The simulator was started as part of the already authorized test task. The first run executed 43 tests: 40 passed, 3 failed, 0 skipped. AccountAuthenticationTests 18/18 and PremiumAccessTests 21/21 passed; the local catalog fixture check also passed. The three StoreKit runtime tests failed with an empty catalog and `SKInternalErrorDomain Code=3` / `notEntitled`. A second, normally ad-hoc-signed, full-scheme run reproduced all three runtime failures. These results supersede the earlier compilation-only checkpoint.

## Exact remaining integration gates

1. **Identity first:** iPhone owner reports existing installation `com.example.owner.wanderful.local`; this source resolves Debug as `com.trailmind.app.local`, Release as `com.trailmind.app`. Do not infer an in-place update or migrate/delete old local data. Confirm the owner-selected distribution App ID/team in Apple Developer and ASC.
2. **Apple capability:** after that selection, enable Sign in with Apple for the actual App ID, obtain matching profiles, and add `com.apple.developer.applesignin = [Default]` to the applicable entitlement only as part of a separately verified activation. Match signed app, profile, backend accepted audience and code-exchange client ID. App Attest entitlement alone does not enable Apple login. Do not simply flip the feature flags.
3. **Backend account lane:** deploy owner must validate the durable account pool and `012_apple_accounts.sql`, encrypted token storage, session hashing, account-owned-data deletion callback and protected Apple client secret. Require RS256 Apple identity verification and code-exchange subject binding. Never put private Apple signing material in iOS or Git.
4. **Deletion / revocation:** `/api/account/delete` currently validates a signed ID token and subject but does not consume the supplied authorization code or enforce fresh `auth_time`. Before activation, strengthen/prove fresh one-time reauthentication, failed revocation, retry after response loss, wrong-account rejection and expired/replayed credentials. iOS now stores Apple user identity in its local Keychain session and uses `getCredentialState` and the credential-revoked notification on the account screen. It does not claim to revoke every server session: server-to-server Apple notification handling and a device revocation receipt remain open. Backend changes are intentionally deferred to its owner.
5. **Commerce:** inspect the actual existing weekly/annual products read-only in ASC: exact IDs, one intended group, duration, localized name/price, availability, review metadata, agreements and sandbox access. Define the concrete paid benefit: current paywall explains billing/optional planning but does not substantiate a distinct paid entitlement benefit. Keep disabled until product scope is approved. Never use fixture prices as a portal observation.
6. **Apple sandbox receipt:** on a test identity in the confirmed bundle, prove catalog load and displayed prices, purchase sheet cancellation, successful verified purchase, finish, fresh-launch access, explicit restore, subscription expiration, refund/revocation and interrupted/unverified handling. Record build, environment, result and timestamp without tokens or personal account data. Local StoreKitTest is a separate prerequisite, not substitute evidence.
7. **Public package:** operator supplies policy/support owner and contacts, canonical URLs, actual provider/data/retention decisions, rights/rating/export answers, and final truthful screenshots from the integrated accepted build. Reconcile account identifiers/token retention and purchases with App Privacy and embedded manifests when activated. Local route deletion does not delete server/provider records.
8. **TestFlight:** iPhone owner produces the signed archive after these identity/configuration choices, checks actual artifact and privacy report, confirms unused build number and ASC app mapping, then validates upload. Provide beta description, test instructions and feedback contact; external testing has Apple's beta review path. Upload or App Review submission is not performed by this handoff.

## Local StoreKit toolchain blocker

Installed: Xcode 26.5 (17F42), iOS Simulator 26.5 (23F77). Both unsigned test-without-building and a normal full-scheme ad-hoc-signed test run reproduce the same empty catalog and `SKInternalErrorDomain Code=3` / `notEntitled` failures. Fixture resource presence and signing alone did not fix the runtime.

[Apple DTS discusses this StoreKitTest issue](https://developer.apple.com/forums/thread/826971), including a reported fix in Xcode 26.6 RC and later reports about the 26.5 simulator runtime. Our error pattern is consistent with that issue; this is an inference, not proof that our app configuration has no other defects. Use a supported updated Xcode/runtime pair and rerun the unchanged strict tests. Do not bypass StoreKit verification or invent entitlements to turn the gate green. No Xcode/runtime upgrade was performed because it is a shared development installation and no suitable newer runtime is currently installed.

## TestFlight text prepared for review (not uploaded)

Beta description: “Wanderful turns an outdoor route request into route options for review. Check the mapped route and current outdoor conditions before setting out.”

What to test: “Plan one point-to-point route and one loop using the configured backend. Review route geometry and statistics, save and reopen a route, and verify useful network-error handling. Check privacy/help links. Apple account and purchase features are disabled in this candidate; do not test them until a separately identified account/commerce build is provided.”

Feedback email, beta review contact, app record and build number: **owner inputs required**. Do not upload placeholder values. Final beta claims must match the iPhone owner's accepted build.

## Sources checked

- [Apple Sign in entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.applesignin): `Default` and Xcode capability.
- [Apple account deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app) and [TN3194](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple): in-app deletion, token revocation and revoked credential handling.
- [Apple sandbox overview](https://developer.apple.com/help/app-store-connect/test-in-app-purchases/overview-of-testing-in-sandbox): actual product information and test account workflow.
- [App Privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy): app and third-party practices must be accurate; [privacy policy URL](https://developer.apple.com/help/app-store-connect/reference/app-privacy/) is required.
- [TestFlight test information](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information): beta information and contact requirements.
