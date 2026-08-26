# Zero-Cost Staging Platform Decision V1

Review date: 2026-08-26. Only current primary provider documentation was used.
No provider account or remote resource was accessed or changed.

## Decision

Use **Render Free Web Service in Frankfurt** as the single zero-cost developer
staging candidate. It is the only evaluated free option that can run the
existing OCI process, accept the platform `PORT`, send `SIGTERM`, allow a
30-second shutdown delay, expose managed HTTPS and health checks, and retain a
normal Node process while the instance is awake.

This is a deliberately degraded staging lane, not a closed-beta host. It must
remain disconnected from iOS until the remote receipt proves HTTPS, database
admission, readiness, drain, outage behavior, privacy-safe logs and rollback.

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
