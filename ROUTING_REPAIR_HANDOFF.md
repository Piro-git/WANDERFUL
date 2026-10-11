# Routing restoration — 2026-09-14

## Scope and baseline

The route function is NOT restored yet. No live route or remote AI success is claimed.

The supplied runtime bundle SHA256 was verified as
fe5eebe914679cf19cb3a9358bcc655e1c174239f7904a5b97ec2f85458460be.
This isolated repository starts at 51c6a227756fb310046fcd9d6ddd1eb45bd41e65.
Reference documentation commits 8a7677e and 267f10a were inspected via supplied receipts; no uncommitted integration changes were imported.
The original outer worktree HEAD adea2c0 is preserved as codex/routing-repair-original-20260914.
Local fetches into its Documents-backed shared Git directory stalled and were terminated. All repair edits are in .routing-repair with its own Git database. No other checkout changed.

## Confirmed cause and code repair

The installed com.example.owner.wanderful.local does not match the ordinary local lane com.trailmind.app.local. Configuration resolution fails closed. Independently its backend URL is empty. Default routing therefore fails before authorization and HTTP, not because of proven Google quota failure.

BackendRouteGateway and URLSessionAppAttestAPI now throw configurationUnavailable for a missing endpoint. PlannerViewModel preserves typed app-verification messages instead of replacing them with a generic route error. Configuration failure tells the user setup is incomplete rather than suggesting a connection retry. Authorization denial and request limits remain distinguishable. No identity check, host policy, entitlement, provider flag or authentication bypass was changed.

## Durable service prerequisite

Inspected tracked local/staging/production configurations have no configured endpoint. Signed staging/production backend policies are unavailable. backend/container/staging-host-contract-v1.json has baseUrl.state=unassigned, productionEligible=false, remoteMutationAuthorized=false. This is a proposal, not evidence of a deployed service.

Required external information: exact existing backend HTTPS origin/operator, if one exists; App-Attest-capable Apple developer team availability. Only Personal Team REDACTED-TEAM-ID has been authorized and evidenced, which cannot supply the current App Attest capability. Preserve installed bundle ID and app data; do not uninstall or silently migrate identity. Do not invent a host or relax production verification.

Once these are known, prepare an exact matching lane/app-ID/team/App-Attest registration and approved-host change, review it, and identify any concrete external deployment/registration authorization. Paid acceptance traffic additionally needs the specified finite provider/cost permission. No old owner session or credential source may be reused. The temporary owner path is not a durable launch solution.

## Physical acceptance still outstanding

No build from this task has been installed. Last evidenced installed build remains runtime51c6a22, com.example.owner.wanderful.local, 1.0(1), signed with Personal TeamREDACTED-TEAM-ID and launched after trust on September10.

After service readiness: install same ID without uninstall, prove authenticated connection, submit approved point-to-point request with in-app consent, confirm real geometry and stats on the phone, start the route. Verify remote intent separately before claiming AI success. Record sanitized phase/status/counters only.

## Boundaries observed

No forbidden configuration/provider file or app-bundle secrets read. No hosting/DB mutation, provider traffic, owner session, purchase, certificate revocation, public push or App Store submission. Device and build process names checked; no active xcodebuild/devicectl process was found before simulator tests. Historical phone task is notLoaded; provided latest review reports localization setup_pending.

## Verification and reproduction

Final simulator Debug build and all 111 targeted tests passed (0 failed), iPhone17Pro/iOS26.5, with normal ad-hoc simulator signing. This includes BackendRouteClientTests, AppAttestServiceTests, AppEnvironmentTests, GraphHopperClientTests and RoutePromptParserTests. Fixtures/stubs only; no real provider routing proof.

The initial MCP invocation timed out at300seconds. Direct unsigned run executed111tests with109passed,2failed: keychain(-34018) without signing and stale GraphHopper assertion expecting Requested instead of the existing model's Preferences. The assertion alone was updated; normal simulator signing resolved the Keychain failure. No production entitlement was altered. Final log: /private/tmp/wanderful-routing-repair-20260914-signed-tests.log.

Reproduce from this repository:

```sh
xcodebuild -project TrailMind.xcodeproj -scheme TrailMind -configuration Debug \
  -destination 'platform=iOS Simulator,id=A9194E37-28A7-450E-9F30-95D0145D0486' \
  -derivedDataPath /private/tmp/wanderful-routing-repair-20260914-build \
  -disableAutomaticPackageResolution CODE_SIGN_IDENTITY=- \
  -only-testing:TrailMindTests/BackendRouteClientTests \
  -only-testing:TrailMindTests/AppAttestServiceTests \
  -only-testing:TrailMindTests/AppEnvironmentTests \
  -only-testing:TrailMindTests/GraphHopperClientTests \
  -only-testing:TrailMindTests/RoutePromptParserTests test
```

Diff review and git diff --check passed. Code commit2b2b797; stale assertion fix242ac49. The independent Git repository can be restored from ../routing-repair-20260914.bundle. No push performed.

## Offline follow-up after first live 400

See OFFLINE_ROUTE_CONTRACT.md for the full contract audit and reproduction commands. Added an opt-in real Swift encoder/gateway/URLSession → loopback owner backend → actual acceptance limiter → mocked GraphHopper → actual Swift route decoder regression. Standard and alternative Berlin requests both passed end-to-end; the installed 826bfc7 adapter separately accepted both Swift-encoded requests with two mocked upstream calls. Existing backend validation/HTTP/acceptance tests: 51/51 passed. No general contract mismatch was demonstrated and no production validation was relaxed. The original phone’s exact 400 cause remains unproven because its body/typed reason was not retained. Do not call the phone routing bug fixed.

A second simulator run was prevented by Mac disk exhaustion; the first full end-to-end XCTest passed. Reclaimed only this task’s 556 MB regenerable build intermediates, preserving products and result bundles. Test fixtures use synthetic credentials and poison un-injected fetch; all fixtures stopped, no live provider/session/tunnel recreated. New live work still requires bounded authorization; the next run would be diagnostic (capture a safe typed validation reason), not acceptance of an already-proven root-cause fix.

## Second live result and local distance preflight repair

Second authorized run is closed. Confirmed /api/route400 invalid_request/distance_limit at13:44:20UTC, after Google200 and parse-intent200. Final counts Google1/GH0; no third attempt or reset. Fresh-session app installation at15:41CEST was verified after explicit direct embedding approval and owner disk cleanup. That app still uses compiled production source826bfc7; the subsequent local repair has NOT been installed.

See DISTANCE_LIMIT_REPAIR.md and SECOND_DIAGNOSTIC_STATUS.md. The submitted segments exceeded200km; the particular incorrect endpoint/AI fields remain unknown. Added point-to-point destination clarification and final/manual endpoint preflight using the existing backend distance contract, without weakening it.54 targeted tests passed, plus final10 location tests confirming the distant-name-match regression. Actual planner/manual-selection/context paths are covered. Successful real Berlin geometry and Start remain unverified; do not report full restoration.
