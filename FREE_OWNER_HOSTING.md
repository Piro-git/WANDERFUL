# Free personal iPhone hosting: current status and rollout

Status: prepared, not deployed. Infrastructure metadata checked read-only on
2026-09-14. No account, paid resource, public service, database object, provider
request or secret was created, changed or read by this investigation.

## What already exists

| Component | Fresh observation | What it proves |
| --- | --- | --- |
| Supabase organization `Alibra AI` | Plan `free`, organization `wbnftkftyamxzvxsftda` | A free database account is connected. |
| `TrailMind Outdoor Staging V1` | Project `mbvzwsrtqcrwhvykugcd`, `ACTIVE_HEALTHY`, `eu-central-1`, PostgreSQL 17 | An existing database can be evaluated; no new database purchase is needed. |
| Private `trailmind_app` schema | Six `app_attest_*` lifecycle tables exist with RLS enabled | The durable session/replay/budget foundation exists. This does not verify a usable least-privilege runtime connection or new owner enrollment. |
| Vercel `Owner's projects` | Hobby plan; generic `backend` project `REDACTED-PROJECT-ID` | A free Vercel account is connected. The latest listed READY production deployment is old revision `c0c13e9e06e4caaf4ff74e0d0b243bfbfdf46c79`, not the repaired app/backend. |
| Render | No callable connector or verified signed-in account/service | The repository template is not evidence of a deployed service. |

No tokens, provider keys, database URLs or credentials are included here.
Project IDs are public configuration identifiers. Metadata observations do not
prove end-to-end connectivity, budgets, current billing balances or secret access.

## Hosting choice

Use one **Render Free Web Service** in Frankfurt for personal testing, retaining
the existing Supabase database. This fits the existing long-running Node/Docker
backend. Managed HTTPS and a stable service hostname remove dependence on the
Mac and temporary tunnels. This is a hobby availability level, not guaranteed
always-on hosting.

Render's current free-service documentation confirms idle sleep after 15 minutes,
roughly one minute to wake, 750 instance-hours per workspace per month and an
ephemeral filesystem. Keep sessions, consumed budgets and replay protection in
PostgreSQL. Do not use Render Free PostgreSQL for this durable plan: its free
instance expires after 30 days. Keep the workspace without a payment method;
otherwise excess included usage may generate charges. Accept free-limit
suspension rather than silently enabling paid service.

Source checked 2026-09-14: [Render Free](https://render.com/docs/free).

The existing `backend/vercel.json` is a historical request handler. Deploying it
unchanged bypasses the reviewed container admission/readiness/drain lifecycle.
The old Vercel project's READY label does not fix this. A separate serverless
adapter would require explicit lifecycle, PostgreSQL pooling and request-duration
validation; it is not a drop-in completion shortcut.

## Prepared owner container candidate

`render-owner.yaml` and `backend/owner-container/` now define a separate personal
service using the new owner entrypoint. It starts disabled and needs reviewed
owner enrollment/schema, real runtime admission, hosting configuration and tests
before activation. Seven offline preflight tests pass. Docker is not available in
this workspace, so no actual image build is claimed. See
`backend/owner-container/README.md` for exact paths and configuration checks.
The existing production `render.yaml` and Dockerfile remain untouched.

## Deployment configuration

Use **`render-owner.yaml`**, Dockerfile
**`backend/owner-container/Dockerfile`**, and Docker build context **`backend`**
from the repository root. The image starts
**`node src/ownerAccess/startOwnerService.js`**. Select the reviewed repair
revision/branch published to GitHub. Keep automatic deployments off, one Free
instance, Frankfurt, `/healthz`, and the 30-second shutdown delay. The existing
`render.yaml`, `backend/Dockerfile` and App Attest entrypoint are separate and
must not be substituted for this owner service.

The new personal authentication path uses an enrolled device's proof of key
possession and short-lived sessions. Its local implementation still requires
live database admission and physical-phone verification. The template starts
with `OWNER_ACCESS_ENABLED=false` until these activation prerequisites are
prepared. Preserve the separate production App Attest path; do not reuse the old
30-minute bearer or put provider keys in the app.

Supply through host secret storage, never source control:

- `OWNER_ACCESS_DATABASE_URL` for the dedicated `wanderful_owner_runtime` role.
- The verified CA file at `/etc/secrets/owner-database-ca.crt`, selected by
  `OWNER_ACCESS_DATABASE_CA_FILE`.
- Authorized deployment-scoped `GOOGLE_API_KEY` and `GRAPHHOPPER_API_KEY`.

Supply as non-secret runtime configuration:

- `NODE_ENV=production` and the exact stable HTTPS `OWNER_ACCESS_ORIGIN`.
- `OWNER_ACCESS_SUPABASE_PROJECT_REF` when using the verified Supabase session
  pooler on port 5432 with the project-suffixed runtime login. Preflight and
  startup use the same validator; direct runtime login is also supported.
- `AI_PROVIDER=google` and an explicitly supported `GOOGLE_MODEL` selection.
- Explicit per-owner/global route and intent daily cost limits, each 1–100,
  and `OWNER_ACCESS_MAX_CONCURRENCY` of 1 or 2.

Provision the isolated `wanderful_owner_v1` schema from the reviewed
`backend/src/ownerAccess/001_owner_access.sql` and enroll only the intended
phone's public key using a separate authorized operator connection. The existing
App Attest tables do not establish that these new owner tables or grants exist.
The runtime must never receive operator/database-owner credentials. Keep
research/evidence capabilities outside this service; the older dynamic research
profile is a different runtime and is not part of this deployment.

## Ordered completion checks

1. Obtain a usable Render account/workspace connection and verify its Free plan
   and charge-prevention settings. No verified Render host is currently available.
2. Publish the reviewed app/backend changes to the intended GitHub branch; select
   that exact source in an isolated Render service.
3. Verify the integrated owner session path and durable repository tests.
   Provision the isolated owner schema/role and enroll the intended phone.
   Verify that runtime role's real TLS connection and exact grants without
   exposing the connection string or reading provider secrets into tool output.
4. Provision deployment-scoped secrets, establish explicit provider allowances,
   and pass container startup admission. Historical phone-test allowances do not
   establish a continuing budget. No purchase or paid-tier upgrade is needed just
   to prepare these steps.
5. Verify exact application `/healthz` and `/readyz` over the stable HTTPS origin,
   including a cold wake and process restart. Preserve consumed budgets across
   restart and session renewal. A provider loading page is not app readiness.
6. Pin the verified host in the personal app configuration. Build and install on
   the existing iPhone without changing its identity or deleting its data.
7. Run a bounded real Berlin request on cellular with the Mac backend/tunnel off.
   Confirm accepted geometry is shown, session renewal works and unauthorized,
   replayed and over-budget requests are rejected before provider traffic.
8. Record source/image revision, public origin, test outcome, nonsecret secret
   aliases, limits and rollback target. Only then call the four steps operational.

## Safe verification before a live deployment

Run the existing backend unit tests with provider transports stubbed, the owner
authentication tests, and native URLProtocol transport tests. Validate deployment
configuration through the read-only preflight with no secret values in the output. Review
Git changes for accidental credentials before pushing. A build or local mock
route can establish code correctness, but cannot establish a hosted service.
Do not revive or reset the old owner-phone acceptance ledgers to run a new test.

## Current blocking inputs

- A verified usable long-running free hosting account/service connection.
- Live provisioning/admission of the isolated owner schema and runtime role,
  followed by actual phone enrollment and authentication verification.
- Deployment secret provisioning and least-privilege connection verification.
- Explicit continuing provider allowance; request-cost units are not euros.
- The final real phone/network/restart test after deployment.

The existing database and local deployment foundations are real; the permanent
backend and final mobile test remain unfinished. Do not report them complete
because the earlier temporary Berlin route succeeded.
