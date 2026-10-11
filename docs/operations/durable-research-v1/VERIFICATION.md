# Verification and operational status

The normal-app integration is implemented. It is **not a permanently deployed
service**. No Mac tunnel or Owner bearer is used for the new path. Deployment
pins remain null, and no provider feature was remotely enabled.

## Source and scope

Base: `03a430f17cbee03cc4017fee7c5e2022604c6027`. This task uses its independent
`.durable-backend` checkout inside the assigned ab66 workspace. The initial
shared-Git import failed with filesystem timeout/low space; the coordinator
confirmed the independent small clone as the working basis. No foreign source,
shared locks, old repair checkout or physical-device data was changed.

Implementation commits and final verification state are recorded in `STATUS.json`.
The source changes cover the normal factory/remote parser availability, transport,
App Attest session error handling, exact environment host configuration, startup
admission, budget/lease bounds, safe operational outcome logging and tests.
Planning algorithms and evidence/source contracts were not redesigned.

## Checks

- 112 focused backend tests pass, zero failures/skips. `backend-tests.log` includes
  schema-3 planning regressions, startup configuration, authorization, replay,
  budget continuity across renewed sessions, local HTTP cancellation and failures.
  All providers and the budget-continuity repository fixture are simulated.
- Normal Release simulator build passes without `WANDERFUL_OWNER_PHONE_TEST`.
  The initial build compiled arm64 and x86_64; the final follow-up was rebuilt
  for arm64. The bundle identity is `com.trailmind.app`,
  environment production. This is an unsigned simulator build, not a signed
  physical-device/App Store artifact. See `release-build.json`.
- `bundle-scan.json` is a scan of the actual Release app for nonempty provider/
  Owner secrets in Info.plist, configuration/Owner resources, Owner code markers
  and known provider-key patterns. It passed without printing values. This bounded
  scan is not proof against every possible credential encoding.
- Focused configuration/transport/App Attest/session/keychain source typechecks
  passed before the full native build. The initial standalone typecheck needed
  PublicAppLinks in its compilation set; the complete set passed.
- 114 selected native Debug XCTests pass with zero failures on iOS 26.5. The
  final successful run used the already-built, ad-hoc signed test host. The prior
  full invocation was killed before establishing a test connection; no assertion
  ran in that invocation. See `native-tests.json` and `native-tests.log`. The
  Release-only factory test was not executed; Release compilation was verified.
  Native transport
  tests use URLProtocol and timestamp-refreshed **offline** route/source fixtures.
  Their accepted route proves native contract handling, not a new live hike.
- First broad native run used an unsigned test host: its Keychain test failed
  with -34018. Ad-hoc simulator signing corrected this and the Keychain test
  passed. No physical profile or installation was changed.
- A pre-existing clarification test expected standard routing despite a hard
  road exclusion. The original base already rejects that request at its
  hard-exclusion gate (original PlannerViewModel.swift line 2057). The test now
  inspects the preserved clarified intent at that recovery boundary and asserts
  no standard route was invoked. The production guard is unchanged.

## Fresh infrastructure observations — read only

On 9 September 2026 the existing `TrailMind Outdoor Staging V1` Supabase project
was ACTIVE_HEALTHY. Six App Attest tables exist under the private application
schema. `app_security_runtime_role` exists, can log in, is NOINHERIT and has no
superuser/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS flags. Its table-level matrix
matches the expected SELECT/INSERT/UPDATE lifecycle access, INSERT-only replay-ID
access and no DELETE; all six tables have RLS enabled.

An initial information_schema grants query was visibility-limited and returned
no rows. Direct pg_catalog/has_table_privilege checks corrected that observation.
Do not infer missing runtime roles from the initial empty result or reuse the old
August provisioning-blocked report as current truth.

These catalog observations do not establish that the protected runtime connection,
CA, exact full privilege admission or separate control/pruner credentials are
available. No secret values were read. The named deployment credential variables
were absent from this task process. The Owner provider env file and Local.xcconfig
were never opened. Render browser inspection timed out twice; no signed-in hosting
state, service URL or deployment could be verified. Available CLI discovery found
no gcloud, render, vercel or docker executable in this task's PATH.

## Live boundary and next operation

Zero live provider requests, zero remote configuration/database mutations and zero
iPhone updates were made. No current euro balance, grounding allowance or usable
long-lived hosting credential was inferred from the old successful phone test.

Use `DEPLOYMENT.md` and the public runtime template to finish the concrete next
step: obtain access to an authorized long-running HTTPS host, provision deployment
secrets through its secure store, verify the actual least-privilege connection and
App Attest identity, and approve a bounded public synthetic loop. Then activate a
candidate app's reviewed exact host pin, run the real end-to-end test and publish
a deployment receipt. New paid hosting/account/plan changes require a specific
user decision; they were not performed here.

The existing provider-off staging profile remains available for rollback. Preserve
all durable cost windows, consumed requests and historical Owner ledgers. Never
reset them to manufacture fresh testing capacity.
