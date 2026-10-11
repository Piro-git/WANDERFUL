# Phone Engine Reliability Gate V1

Status: deterministic acceptance contract implemented; integrated simulator,
physical-device, and live-provider proof remain unproved.

## Purpose and boundary

This is the smallest launch-oriented gate joining the already reviewed route
quality, staging, iOS persistence/export, and foreground-guidance contracts. It
does not replace Golden Set V1, the 18-case staging proof, V4, or their provider
controls. It makes their launch-critical phone expectations fail closed in one
18-case receipt.

The gate owns only fixtures, receipt evaluation, tests, and this protocol. It
does not call a provider, change route shaping, implement navigation, or modify
the protected navigation/StoreKit integration. The current branch has no live
navigation surface; navigation selectors bind to the reviewed
`codex/foreground-navigation-beta-v2` tests and become executable only after the
integration captain merges that work.

## Cases

| ID | Acceptance behavior | Reviewed source |
| --- | --- | --- |
| 01 | clear Harz loop reaches ranked suggestions with real-place, geometry/stat, activity/shape, provenance, eligibility, and honest-condition checks | Golden `harz-v1-exact-distance-008`; staging 01 |
| 02 | broad Alps request asks a specific clarification and performs zero routing | staging 09; Golden Innsbruck moderate 002 |
| 03 | ambiguous place is not guessed and performs zero routing | Golden Harz moderate 002 |
| 04 | point-to-point preserves waypoint order and opens verified detail actions | staging 12; critical-path UI fixture |
| 05 | trail-running activity survives intent, routing, and ranking | staging 03; Golden Harz trail-running 003 |
| 06 | an Easy request with known demanding output returns no viable route | Golden Harz/Innsbruck group 012 |
| 07 | an unverified viewpoint is rejected or recovered without a visit claim | staging 05; Golden Innsbruck viewpoint 004 |
| 08 | badly snapped/unreached required stop is ineligible | Golden Innsbruck viewpoint 004 |
| 09 | excessive distance is rejected and never called a close match | Golden Harz exact-distance 008 |
| 10 | excessive backtracking is rejected before ranking | Golden Harz/Innsbruck coherence 010 |
| 11 | malformed or empty intent fails closed before routing | staging 16; strict iOS contracts |
| 12 | no-route/rate-limit errors are typed, redacted, and recoverable | staging timeout 14; critical-path UI fixture |
| 13 | cancellation and late/stale responses cannot overwrite newer state | staging 13 and 18 |
| 14 | zero survivors produces no suggestions and a truthful shortfall | staging 05; Golden Innsbruck multi-must-have 009 |
| 15 | one independently eligible survivor is useful but not called diverse | staging 15; Golden Harz coherence 010 |
| 16 | verified-route navigation covers start, stale GPS, off-route hysteresis, pause, resume, and end | Golden Harz easy 001; foreground-guidance tests |
| 17 | selected detail facts and routed provenance survive save/reopen | Golden Harz easy 001; save UI/store tests |
| 18 | GPX preserves geometry/coordinate order and rejects unverified provenance | Golden Harz easy 001; GPX/UI tests |

Every source case ID and source-test selector is explicit in
`backend/evaluation/phoneEngineReliabilityGateV1/fixtures/casesV1.json`.
Changing, omitting, duplicating, adding, or reordering one fails validation.

## Reused policy; no new shaping thresholds

The gate binds existing policies without changing them:

- route geometry must be real and at least 100 m; loop closure is bounded by
  `min(250 m, max(75 m, 1.5% of geometry length))`;
- structural distance ratio is `0.55...1.75`; structural duration ratio is
  `0.40...2.50`;
- self-backtracking and self-overlap ceilings are 55%; minimum loop shape is
  0.025; near-duplicate similarity is 0.86 in a 35 m corridor;
- access candidate is at most 75 m from eligible mapped trail evidence;
  provider snap and route-to-access are at most 100 m; strict evidence reach is
  at most 25 m;
- strong characteristic coverage begins at 60%; explicitly avoided major-road
  exposure above 25% is ineligible at that coverage; known demanding technical
  terrain of at least 100 routed metres is incompatible with Easy;
- foreground location samples are at most 15 seconds old, at most 5 seconds in
  the future, and strictly increasing within an uninterrupted session.

These are existing pre-baseline/product acceptance rules, not safety claims.
Unknown access, conditions, opening, water, hikeability, scenery, or safety must
remain unknown in user copy.

## Receipt and false-green controls

The evaluator accepts one normalized JSON receipt. It requires exactly 18 cases
in manifest order, nonzero execution, zero skips, exact assertion IDs, exact
source-test selectors, coherent runtime totals, bounded per-case/total runtime,
and one terminal test result per selector. Missing, duplicate, extra, reordered,
or malformed evidence is rejected. Failed/skipped/not-run source tests and any
failed assertion produce a failed summary. Serialization sorts object keys and
contains no clock or random field, so identical input is byte stable. Output is
limited to 64 KiB.

Technical and product outcomes remain separate. For example, the demanding
Easy, bad-snap, excessive-distance, backtracking, and zero-survivor cases expect
technical/product failure but pass the acceptance case only when the product
rejects them safely. Broad/ambiguous inputs expect `not_run` and zero routing.

`providerCallCount > 0` is accepted only with
`proofClassification=physical_device_live_proof` and
`providerAuthorization=fresh_bounded`. Deterministic or simulator runs must use
zero provider calls and `providerAuthorization=none`. A deterministic green
summary proves the contract/evaluator only; it is not live GraphHopper, device,
GPS, or outdoor-quality proof.

## Final integration captain protocol

Run this only after merging this branch and the protected foreground-navigation
integration into the candidate. Do not copy navigation code into this branch.

1. Verify the evaluator and its anti-false-green controls:

   ```sh
   cd backend
   node --test test/phoneEngineReliabilityGateV1.test.js
   npm run build
   ```

2. Run the existing backend contracts and deterministic quality/golden/corpus
   suites, with no provider authorization or provider environment loaded:

   ```sh
   cd backend
   node --test test/outdoorAdventureQualityEvaluation.test.js test/outdoorAdventureQualityHarness.test.js test/outdoorAdventureContractCorpus.test.js test/outdoorAdventureContractCorpusV2.test.js test/researchGuidedRoutingAdapter.test.js test/outdoorAdventureStagingProofHarness.test.js test/graphHopperProvider.test.js test/routeValidation.test.js
   ```

3. From the repository root, set an explicit available simulator destination
   and run every unique selector named by the manifest. Preserve the `.xcresult`
   as integration evidence; an absent navigation selector is a hard integration
   failure, not a skip:

   ```sh
   export TRAILMIND_PHONE_GATE_DESTINATION='platform=iOS Simulator,id=<UDID>'
   TRAILMIND_PHONE_GATE_RESULT_DIR="$(mktemp -d /private/tmp/TrailMindPhoneGateV1.XXXXXX)"
   selectors=("${(@f)$(jq -r '.cases[].sourceTestSelectors[]' backend/evaluation/phoneEngineReliabilityGateV1/fixtures/casesV1.json | sort -u)}")
   xcodebuild test -project TrailMind.xcodeproj -scheme TrailMind -destination "$TRAILMIND_PHONE_GATE_DESTINATION" -resultBundlePath "$TRAILMIND_PHONE_GATE_RESULT_DIR/result.xcresult" ${selectors/#/-only-testing:}
   ```

4. Normalize the immutable XCTest results plus the case-level product
   observations with `createPhoneEngineReliabilityReceiptV1` in
   `backend/evaluation/phoneEngineReliabilityGateV1/receiptAdapter.js`. Its
   strict input/output fields are exercised in
   `backend/test/phoneEngineReliabilityGateV1.test.js`. Assertions must come from
   the named test evidence; do not infer a pass from process exit alone. Use
   `deterministic_contract_proof` or `integrated_simulator_proof`, zero provider
   calls, and `providerAuthorization=none` unless a separately authorized,
   bounded physical-device run actually occurred.

5. Evaluate twice and compare bytes:

   ```sh
   cd backend
   npm run eval:phone-engine-reliability-gate-v1 -- --receipt /private/tmp/phone-engine-reliability-v1.receipt.json > /private/tmp/phone-engine-reliability-v1.summary-a.json
   npm run eval:phone-engine-reliability-gate-v1 -- --receipt /private/tmp/phone-engine-reliability-v1.receipt.json > /private/tmp/phone-engine-reliability-v1.summary-b.json
   cmp /private/tmp/phone-engine-reliability-v1.summary-a.json /private/tmp/phone-engine-reliability-v1.summary-b.json
   jq -e '.finalStatus == "passed" and .configuredCaseCount == 18 and .executedCaseCount == 18 and .skippedCaseCount == 0 and .failedCaseCount == 0' /private/tmp/phone-engine-reliability-v1.summary-a.json
   ```

6. Finish with `git diff --check` and repository credential/generated-artifact
   scans. Live V4 or GraphHopper reruns remain separate and require fresh bounded
   authorization; historical receipts must not be relabelled as this phone gate.
