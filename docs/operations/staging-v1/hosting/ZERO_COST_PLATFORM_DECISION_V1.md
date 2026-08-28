# Zero-Cost Staging Platform Decision V1

Review date: 2026-08-28. Only current primary provider documentation was used.
A connected Vercel Hobby team was inspected read-only. Its existing generic
`backend` project has production-target deployments from `main`, so it is
explicitly outside this lane and was not changed. No Render control plane was
available, and no remote resource was created or updated.

## Decision

Use **Render Free Web Service in Frankfurt** as the single zero-cost developer
staging candidate. It is the only evaluated free option that can run the
existing OCI process, accept the platform `PORT`, send `SIGTERM`, allow a
30-second shutdown delay, expose managed HTTPS and health checks, and retain a
normal Node process while the instance is awake.

This is a deliberately degraded staging lane, not a closed-beta host. It must
remain disconnected from iOS until the remote receipt proves HTTPS, database
admission, readiness, drain, outage behavior, privacy-safe logs and rollback.

## Runtime and database shape

Render runs the reviewed Node 22 OCI image as one long-running process while
the Free instance is awake. Startup performs production configuration and
private-schema/role/migration admission before binding. `/healthz` is a fixed,
dependency-free liveness response. `/readyz` exposes only cached `ready` or
`not_ready` state derived from bounded startup admission and recurring database
probes; it never queries providers or returns raw database detail.

The only persistent web-process pool in the all-features-off deployment is the
App Attest runtime pool: four connections by default, bounded to 1–20, with a
five-second connect timeout, five-second statement/query timeout, ten-second
idle-transaction timeout and 30-second idle timeout. Use the isolated Supabase
session pooler on port 5432 for this persistent container when direct IPv6 is
not available. Runtime, control/pruner and operator credentials remain
separate; control and operator sources are forbidden in the web process. The
research/evidence/cancellation pools are not constructed while their exact
flags are false. A future serverless port would instead require Supavisor
transaction mode on 6543, no prepared statements, per-invocation pool
attachment and a new lifecycle review.

## Effective limits

| Boundary | Reviewed limit |
| --- | --- |
| Node request lifecycle | 10 s headers, 45 s request, 5 s keep-alive; 64 headers by default |
| Request bodies | intent 16 KiB, route 32 KiB, App Attest 256 KiB, evidence 128 KiB default/256 KiB max, orchestration 64 KiB default/128 KiB max |
| Responses/provider reads | intent provider 64 KiB default/256 KiB max, route provider 2 MiB default/8 MiB max, evidence 512 KiB default/2 MiB max, orchestration 9 MiB max |
| Database | App Attest pool 4 default/20 max; 5 s connect and statement deadlines; readiness probe every 10 s |
| Drain | 10 s application deadline inside Render's configured 30 s shutdown delay |
| Render Free | 750 instance-hours/workspace/month, 500 Hobby pipeline minutes, 5 GB Hobby outbound bandwidth, idle spin-down after 15 minutes |

The iOS and backend contracts remain well below Vercel's documented 4.5 MB
Function request/response ceiling for the endpoints that are enabled in this
deployment. Orchestration can exceed that platform ceiling and, more
importantly, Vercel's 500 ms function `SIGTERM` window cannot preserve this
runtime's startup admission, standing readiness monitor, owned pools and
ten-second drain.

| Candidate | Decision | Evidence-based reason |
| --- | --- | --- |
| Render Free Web Service | Selected for developer staging only | Runs Docker web services with managed TLS, HTTP health checks and configurable 1–300 second shutdown delay. Free instances idle-spin after 15 minutes, may take about one minute to wake, may restart at any time, have no private network/one-off jobs/persistent disk and can be suspended for unusual outbound traffic. |
| Vercel Hobby Functions | Rejected for the canonical runtime | Full Node is available, but execution is request-scoped and `SIGTERM` cleanup is limited to 500 ms. It cannot preserve the reviewed standing startup admission, readiness monitor, connection-pool ownership and 10-second drain semantics. The existing `backend/vercel.json` remains a noncanonical serverless adapter. |
| Supabase Edge Functions Free | Rejected for the canonical runtime | Hosted functions are Deno-compatible short-lived workers with 256 MB memory, 2 seconds CPU per request and a 150-second Free wall-clock limit. Supabase explicitly recommends serverless-friendly database access and short-lived idempotent operations, not the reviewed persistent Node pools and signal lifecycle. |
| Fly.io | Rejected as zero-cost | The current trial is limited to two total VM hours or seven days, and trial Machines stop after five minutes. It is not a durable free staging host. |
| Render paid / Fly paid | Deferred | The adjacent runtime decision remains technically stronger, but any nonzero charge requires explicit separate approval. |

## Zero-cost guard

Create the Render resource only in a workspace with **no payment method**. On
Render Free, exhausted included bandwidth then suspends the service instead of
billing supplementary usage. The operator must accept suspension rather than
adding billing details or upgrading the instance. This package contains no
paid plan, database, disk, private service, background worker, cron job,
custom domain or observability add-on.

## Cold start, region and exit criteria

Frankfurt minimizes latency to the intended Germany-first clients and the
staging database lane should select a compatible nearby database region. A
cold wake can take about one minute and is not counted as application latency;
the first exact application `/healthz` result and subsequent `/readyz` result
must be recorded separately.

Exit or upgrade this lane before a wider beta if any of the following occurs:
stable availability is required; cold wakes exceed two minutes; Free limits or
suspensions disrupt testing; more than one instance is needed; database pool
waiters persist; provider/orchestration features are enabled; response or
runtime limits approach their reviewed ceilings; a private network, scheduled
control job, durable disk, centralized alerting or an uptime commitment is
required. Any paid replacement needs separate cost approval.

## Current primary sources

- Render Free: <https://render.com/docs/free>
- Render web services and HTTPS: <https://render.com/docs/web-services>
- Render deploy and graceful shutdown: <https://render.com/docs/deploys>
- Render health checks: <https://render.com/docs/health-checks>
- Render Blueprint schema: <https://render.com/docs/blueprint-spec>
- Vercel Functions API and 500 ms `SIGTERM`: <https://vercel.com/docs/functions/functions-api-reference>
- Vercel Function limits: <https://vercel.com/docs/functions/limitations>
- Supabase Edge Functions: <https://supabase.com/docs/guides/functions>
- Supabase Edge limits: <https://supabase.com/docs/guides/functions/limits>
- Fly.io trial: <https://fly.io/docs/about/free-trial/>
- Supabase changelog index: <https://supabase.com/changelog.md>

The Supabase changelog review confirms the repository's Node 22 baseline is
appropriate after the June 2026 Node 20 support removal. No relevant hosted
Edge Function change makes that runtime equivalent to this standalone service.
