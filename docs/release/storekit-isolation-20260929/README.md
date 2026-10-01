# StoreKit / Apple account diagnosis — 2026-09-29

**Result: local StoreKit runtime remains blocked; no product-code fix justified by the new evidence.** A new dependency-free app reproduces the failure before purchase, restore, or entitlement logic. All 39 account/premium regression tests pass again. No feature activation, Apple-portal mutation, real purchase, backend deployment, final candidate build, or physical-device installation was performed.

## Current source and environment

- Own branch: `codex/storekit-isolation-20260929`, based on `ecbd70d59d0c7b9f5256a358e2133f0a381ad62f`.
- Integrator's checkout was read-only: `/Users/piroscheibe/.codex/worktrees/c025/EasyWander/iphone-candidate`, clean at `83a99c0`. It differs from the previous handoff only in `docs/release/iphone-20260926/ACCEPTANCE.md`. Exact commit and file hashes are in `evidence/source-comparison.json`.
- Actual installed tools: Xcode 26.5 (17F42); only iOS 26.5 simulator runtime (23F77); booted iPhone 17 Pro, arm64. No supported alternative runtime was installed. Around 7.3 GiB free at start.
- The sandboxed `simctl` inventory was denied access to CoreSimulator; the authorized unsandboxed inventory and XcodeBuildMCP both succeeded. That initial access error is not evidence of a broken simulator.

## Isolation and diagnosis

The old signed-run log was re-read: `SKInternalErrorDomain Code=3` already appears while saving configuration, resetting overrides, and changing local test-session properties. `notEntitled` occurs later at `SKTestSession.buyProduct`, before Wanderful constructs its premium store in those lifecycle tests. The old failing tests therefore never validated app purchase/refund behavior.

The new four-test probe lives in `diagnostics/storekit-isolation`. It has only an empty SwiftUI host plus XCTest, StoreKit and StoreKitTest. No Wanderful imports, Superwall, Supabase, app configuration, authorization controller, backend, or product-state logic is included. Its bundle ID is `test.local.storekit.probe`; its scheme uses an absolute configuration path; both fixtures are in the actual application bundle. The independent fixture is one consumable rather than a subscription group.

Results:

- Reading and parsing both resources succeeds.
- Constructing `SKTestSession` succeeds with either a filename or the actual bundled file URL.
- Persisting/reading `disableDialogs` fails with Code 3 for both the minimal fixture and Wanderful's fixture. Product queries then return an empty set.
- A narrowly filtered `storekitd` log identifies the rejected development installation: `test.local.storekit.probe is not installed for development`. Its subsequent request context is `Sandbox`; the raw log also shows a read-only sandbox catalog request. No purchase, sync, or login call was made.
- The generated app and the previous app-hosted test were signed to run locally. Simulator signing is not distribution/provisioning evidence. No invented entitlements, simulator database edits, daemon resets or special private APIs were used.

**Supported conclusion:** Wanderful's premium state machine, third-party packages, subscription-group complexity, missing resource file, and filename lookup are not necessary to reproduce the failure. The immediate failure is StoreKitTest's development-installation/configuration service path on this installed toolchain. An app logic change cannot be inferred as a remedy.

**Limit:** This does not distinguish an Xcode installation/launch defect from a simulator-runtime defect or prove all app configuration correct on a working environment. One runtime and CLI launch path were available. No fresh runtime, IDE launch comparison, or Apple Developer signing comparison was performed. The current environment cannot supply the positive control needed for that distinction.

[Apple DTS's discussion of FB22237318](https://developer.apple.com/forums/thread/826971) reports the matching Code 3 problem and a fix in Xcode 26.6 RC; later participant reports still concern the 23F77 simulator runtime. Our own reproduction supports the same failure class, not definitive identity with Apple's bug. A newer supported Xcode/runtime pair must provide the positive control before changing the application's purchase logic or declaring the runtime gate green.

## Executed test matrix

| Layer | Execution on 2026-09-29 | Outcome | What it establishes |
| --- | --- | --- | --- |
| Minimal host build/sign/install | Full `xcodebuild test`, fresh diagnostic project and DerivedData | Build succeeds; test run exits 65 | No third-party packages or shipping app required |
| Bundled fixture control | Parse actual host resources | 1/1 PASS | Both files exist and are readable JSON |
| Minimal consumable, explicit URL | SKTestSession setting round-trip and Product.products | FAIL | Failure does not depend on name lookup or subscriptions |
| Minimal consumable, filename | Same checks via named initializer | FAIL | Same failure via standard lookup |
| Wanderful fixture, explicit URL | Same checks outside Wanderful | FAIL | Same runtime failure with original fixture |
| AccountAuthenticationTests | Existing ecbd70d Debug testhost, source matched to current candidate, test-without-building | 18/18 PASS | Native request nonce/scopes/overlap; cancellation; injected sign-in/session persistence; deletion failure/success; local revocation, transient error, stale-check race |
| PremiumAccessTests | Same host and targeted selection | 21/21 PASS | Injected verified purchase/finalization, cancellation/pending, explicit restore, restore failure, expiry/revocation/grace, cache distrust and update listener behavior |
| Original real local purchase/expiry/refund | Previous 2026-09-26 run reviewed, not repeated | 3 historical StoreKit runtime failures remain open | New probe reaches the same earlier failing service boundary; no transaction evidence |
| Apple login / sandbox / TestFlight | Not executed | OPEN | Local unit tests do not provide these receipts |

Probe totals: **4 tests, 1 pass, 3 fail, 0 skipped** (six failed assertions across three tests). Account/premium totals: **39 tests, 39 pass, 0 fail, 0 skipped**. The raw xcresult summary chooses one primary failure per failed test; the test excerpt preserves both setting and catalog assertions.

## Evidence and reproduction

- `evidence/minimal-probe.json`, `probe-test-excerpt.txt`: fresh runtime result and failure ordering.
- `evidence/storekit-service-excerpt.txt`: narrowed rejection/context messages; network addresses and unrelated logs excluded.
- `evidence/account-premium.json`: fresh 39-test run; old binary explicitly identified, not a newly built final candidate.
- `evidence/source-comparison.json`: exact reviewed candidate and SHA-256 matches for relevant source/tests/project.
- Probe command and generator: `diagnostics/storekit-isolation/README.md`.

Raw local receipts (not committed): `/private/tmp/wanderful-storekit-probe-20260929.xcresult`, `/private/tmp/wanderful-storekit-probe-20260929.log`, `/private/tmp/wanderful-account-premium-20260929.xcresult`, `/private/tmp/wanderful-account-premium-20260929.log`. The generated project is `/private/tmp/wanderful-storekit-probe-20260929-v1/Probe.xcodeproj`. No raw production or account data was accessed.

## Stop condition and remaining gates

No app/test configuration fix was made because the independent control fails before app logic and no supported replacement runtime is installed. The added code is an optional diagnostic project generator/tests; the shipping project, strict original tests, and all activation flags are unchanged. Repeated identical runtime attempts stop here.

1. **Local tooling owner:** make a supported newer Xcode and simulator runtime available. Run the minimal probe once. If it passes, run the unchanged original catalog/lifecycle suites and add a real local restore/cancellation receipt before claiming local StoreKit acceptance. If it fails, attach the minimal project plus sanitized evidence to an Apple Feedback report through an authorized owner. This task did not upgrade shared tools or submit Feedback.
2. **Apple Developer:** select the actual distribution team/App ID, confirm capability and matching provisioning/entitlements; verify backend audience/client ID. No live Sign in with Apple login/revocation/deletion was validated here. Existing backend freshness/remote-revocation gates from the previous handoff remain outside this task's ownership.
3. **Apple Sandbox:** verify real product IDs/group/prices/availability/agreements and test identity, then collect purchase, cancel, restore, relaunch, expiry, refund and revocation evidence from an explicitly authorized sandbox run. Mock results and local fixtures cannot satisfy this gate.
4. **TestFlight / device:** integrator owns integration, final signed build, artifact checks, device installation and upload. The previous 37-pass/8-fail unsigned artifact receipt is historical and was not rerun or declared fixed by this diagnostic. Public metadata/privacy and actual paid benefit remain separate release decisions.

The broader Apple-account/commerce release objective remains incomplete. This bounded diagnosis is handed off with an external runtime block and no activation recommendation.
