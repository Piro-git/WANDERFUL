# Normal app research integration — deployment and rollback

Status: implemented locally; **not deployed**. No public URL or usable platform
secret scope has been established by this task. `ResearchDeployment.json` remains
null in both lanes. Existing Owner test credentials, counters and latches are not
used by this deployment path.

## What the first rollout enables

Use the existing standalone container and App Attest PostgreSQL repository with
`TRAILMIND_RUNTIME_PROFILE=dynamic-research-v1`. Its first reviewed runtime stage
is staging, paired with the normal Staging app (no Owner flag). The public/closed
beta release restrictions remain separate. The old provider-off staging profile
still rejects provider keys and active features. The research profile admits only
Google and GraphHopper keys while retaining process, TLS, database identity,
least-privilege admission and exact-false controls for unrelated capabilities.

The normal app performs authenticated remote intent extraction, then schema-3
`POST /api/llm-plan-route` with `researchMode=web_and_map`. The first release is
loop-only. Point-to-point schema-3 requests are rejected before authorization or
provider work. Existing ordinary point-to-point routing remains separate.

Provider routing/research algorithms and source contracts are consumed unchanged.
App Attest opens short-lived sessions as needed; provider keys never enter the
app. Only an explicit HTTP 401 `route_session_expired` triggers one fresh session
and a fresh request ID. Invalid sessions, 403, 429 and replay rejection do not
trigger retries. Transport redirects are blocked for attestation, parsing and
research. Cancellation and network failures never count as a successful route.

## Budget and timeout contract

The public template is `backend/container/dynamic-research-rollout-v1.json`.
It is not authorization to spend. Its example permits one intent parse (3 units)
and one research plan (12 units) per global 24-hour budget window, with one
concurrent operation in each scope. Operators must explicitly select all four
installation/global limits, their 86400-second windows, concurrency and a budget
approval ID and a canonical UTC `DYNAMIC_RESEARCH_BUDGET_EXPIRES_AT` timestamp
(including milliseconds, at most 24 hours ahead). Startup and every new intent/route
admission require validity beyond the entire operation lease. A running process
therefore stops admitting paid work before expiry without a restart; already
admitted work retains its deadline and releases its lease. Renewal requires a new
explicit allowance and never resets durable counters. No broad inherited default is accepted for the dynamic profile.
Maximum admitted cost is 120 units per scope/window and concurrency is at most 2.

These are **request-cost units, not euros**. The existing planner bounds model,
map and route calls within each reserved plan. A provider monetary allowance and
current pricing/quota must be confirmed separately before enabling the profile;
this task made zero billable provider calls and does not assert a remaining euro
balance. A single request can use multiple model calls. Failed/aborted admitted
work remains charged against the server request budget. The PostgreSQL global
and installation windows, replay records and leases survive session refresh,
process restart and multiple instances. Never reset those tables to renew access.

The planner still owns a 150-second deadline; the native research HTTP limit is
160 seconds, and the lease is 180 seconds by default. Shorter leases that could
expire before research finishes are rejected. The outer native planning allowance
is 260 seconds to include initial App Attest registration/exchange; remote intent
has 100 seconds including verification, with its actual HTTP request still 20
seconds. Node's `requestTimeout` bounds upload receipt, not provider execution.
The selected ingress must support the 160-second response wait; prove that on the
actual host. Free-tier cold start and uptime are not production readiness.

## Required operator inputs and ordered rollout

1. Select an existing authorized hosting service with managed stable HTTPS,
   sufficient request duration, region and persistent PostgreSQL access. Keep the
   current image/revision and environment metadata as rollback evidence. No
   purchase, plan change or new account is authorized by the template.
2. Provision `APP_ATTEST_DATABASE_URL` through the host secret store for the
   existing least-privilege runtime role and approved database. Use the required
   verify-full CA file and reviewed port-5432 session-pooler/direct topology.
   Supply the matching private schema and distinct runtime/control/operator role
   names. The web process must not receive control/operator credentials. Reuse
   the reviewed migration/provisioning workflow if role/grant repair is needed;
   do not replay SQL or relax admission to bypass its guards.
3. Provision Google/GraphHopper keys through a separately authorized deployment
   secret source. The scoped Owner-phone loader and its private env file are not
   deployment secret sources. Confirm current Google project/quota and explicit
   bounded provider allowance. Supply a real identifying User-Agent/support URL.
4. Match Apple App ID prefix, bundle identifier, build version, App Attest
   environment and validation category to a currently entitled signed build.
   Retain the user's existing identity/data for any later phone update; this
   task has not installed or resigned the phone app.
5. Set the public template's reviewed values, all unrelated/insecure flags false,
   and the explicit dynamic runtime profile. Run normal production preflight and
   container admission on the candidate host. Actual database role/grant checks
   must pass before listen. Probe exact application `/healthz` and `/readyz`
   through public HTTPS. Do not count a hosting loading/error page as readiness.
6. After HTTPS readiness, record the candidate origin and evidence path in
   `Configuration/ResearchDeployment.json` for **one** lane, then run
   `node backend/scripts/configure-research-app.js`. Review generated Swift exact
   host pins and xcconfig together; the generator refuses credentials, non-HTTPS,
   custom ports/paths, loopback and temporary tunnel hosts. `--check` detects drift.
   Deployment metadata is public source, never a secret. An unassigned lane
   remains disabled. Do not publish/distribute the candidate until the real
   verification in step 7 completes; commit final evidence only after that proof.
7. Use that candidate app on a currently signed
   physical build verify App Attest registration/session
   exchange and expiry recovery, deny/replay/rate-limit handling, abort propagation,
   and one approved public synthetic loop through the normal app. Capture sanitized
   request outcomes and actual accepted geometry; do not log prompts, coordinates,
   keys, session tokens or raw provider payloads. Recheck counters after restart.
8. Build/test without `WANDERFUL_OWNER_PHONE_TEST`, scan the actual resulting
   bundle, and save a deployment receipt with image/commit, public host, nonsecret
   secret-version aliases, auth result, budget settings and observed route outcome.

## Rollback

Disable dynamic/LLM/intent/route capability flags, remove provider keys from the
provider-off runtime scope, and select `staging-off-v1` (or unset the profile).
Keep the durable database and all consumed budget/replay history. Drain the
candidate using its existing bounded shutdown; restore the prior reviewed image
and corresponding environment profile. Set the affected app manifest lane back
to null, regenerate and build. Installed configured clients receive explicit
unavailability while the server is off; no mock success is substituted.

## Integration boundaries

`DynamicResearchPlanningClient.swift`: factory, request transport and session
error handling only. Preserve other tasks' DTO/source/access additions when
merging. `IntentParsingFoundation.swift`: compile/factory/URL/auth transport only,
no intent extraction redesign. `PlannerViewModel.swift`: readiness/error and
verification-time allowance only. `llmFirstPlanningEndpoint.js`: schema-3 loop
rollout gate and exact AppAttest error preservation only. Planner, web/source,
access/local-condition and route algorithms are unchanged.

Efficiency-task compatibility: authorization reads only `DYNAMIC_LIMITS.deadlineMs`;
it does not depend on read/finish tool names or the reads/enrichments counter.
Re-run the combined tests after integrating that task; no foreign changes were
merged here.
