# Research failure validation — 2026-09-06

Integrated source: Swift recovery patch `5c8b651`, access cleanup `2b5927e`, backend diagnostics `9fe69ca` (cherry-picked from `09e250383e3418fca6787969fde8ce0580dd673e`).

The generic invalid-intent message now preserves a typed research failure in recovery state. Timeout, unavailable service, authorization, rate limit, rejection, unsupported request, no fitting route, and unverified result have separate messages. Research failures still stop before standard routing; the existing unsupported-adapter exception is unchanged. Initial remote parsing can still fall back locally, with parser/debug evidence retained in the prepared attempt.

Freeform input is encoded verbatim to `/api/parse-intent`; research planning consumes normalized structured intent. Added stubbed tests include the exact phone prompt and two other freeform variations. No preset allowlist was found in the remote request path.

Validation:
- Xcode `build-for-testing`, Debug, generic iOS Simulator, existing derived data, owner compilation flag, code signing disabled: PASS (arm64 and x86_64 app and test bundles). Final log: `/private/tmp/wanderful-recovery-offline-build.log`.
- Swift XCTest cases were compiled, not executed. No simulator boot was authorized or performed; this is compile validation, not proof of runtime behavior.
- Focused backend tests: 20 passed, 0 failed. Files: ownerPhoneDiagnostics, ownerPhoneProviderBudget, ownerPhoneResearchRuntime, ownerPhoneTestServer. Final log: `/private/tmp/wanderful-recovery-backend-tests.log`.
- Sandbox initially blocked Xcode cache writes and localhost test listeners. Approved retries completed. Backend HTTP fixtures used localhost and fake providers only.
- `git diff --check`: PASS. Existing untracked backend/node_modules and work/ preserved.
- Signed Debug-iphoneos executable and CodeResources SHA-256 hashes unchanged before/after. No device install, app launch, token injection, live provider call, session restart, or data deletion.

Historical phone ledger remains 2 Google attempts and 0 GraphHopper attempts, last Google outcome an unclassified transport error. The session expired and shut down at 18:15 Berlin. Neither successful initial remote parsing nor a selector timeout is established retrospectively. The added diagnostics enable phase/duration/abort evidence for a future authorized session; they do not fix or prove the cause of the historical transport failure.
