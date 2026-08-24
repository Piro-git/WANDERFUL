# Staging Container Platform Decision V1

Research date: 2026-08-24. Evidence below is limited to current primary
provider documentation. No provider account or service was changed.

## Decision

Recommend one paid Render Web Service in Frankfurt. Keep one always-on Fly.io
Machine in `fra` as the alternative. Exclude Render Free and exclude Cloud Run
for this reviewed lifecycle.

| Contract | Render paid Web Service | Fly.io Machine | Cloud Run service |
| --- | --- | --- | --- |
| Persistent process | Paid instance remains running; Free spin-down is excluded | Disable autostop and keep one Machine running | Minimum instances do not prevent arbitrary instance shutdown |
| Region | Frankfurt | `fra` | `europe-west3` is nearby |
| HTTPS | Generated `onrender.com`, managed TLS, HTTP redirect | Generated `fly.dev` through Fly Proxy | Generated HTTPS endpoint |
| Signals/drain | SIGTERM; default 30-second shutdown delay, configurable 1–300 seconds | Explicit SIGTERM and 30-second kill timeout, configurable up to 300 seconds | Fixed 10 seconds before SIGKILL |
| Health | One configured HTTP health path plus external monitoring | Configurable service checks; failed checks affect routing but do not restart alone | Startup/liveness/readiness probes available |
| Secrets | Service-scoped environment/secret files; rotation redeploys | Encrypted secrets injected at boot; rotation restarts Machines | Secret Manager integration |
| Supabase network | IPv4-only: session pooler on port 5432 unless DB lane separately approves IPv4 | IPv6 direct or IPv4 session pooler | Public egress available |
| Bounds | Fixed 0.5 CPU/512 MB Starter; app still enforces request/concurrency bounds | Fixed 1 shared CPU/512 MB and proxy soft/hard concurrency controls | Configurable CPU/memory/concurrency |
| Logs/metrics/alerts | Hobby metrics/logs and health/deploy notifications; custom threshold alerting is a separate gate | Logs and managed Prometheus/Grafana; no built-in metric alerting | Strong native logging/monitoring/alerts |
| Rollback | Prior exact prebuilt digest; service-local env follows deploy, shared environment-group state does not | Redeploy prior exact digest; config/secrets remain separate | Revision traffic rollback |
| Quoted compute | USD $7/month Starter; 5 GB/month outbound included, then $0.15/GB | USD $3.69 per 30 days; Europe egress $0.02/GB | Usage/billing-account dependent |

Render is the simpler staging choice with a fixed quote and enough termination
margin for the existing 10-second application deadline. Configure its platform
health path as `/health/live`: startup cannot bind until database admission has
passed, while a later database outage should degrade `/health/ready` and return
bounded 503 responses without creating a liveness restart loop. Monitor
`/health/ready` separately. This mapping is a topology decision derived from
Render's single service health-path model and must be proved after approval.

Fly is technically attractive where proxy concurrency limits and IPv6 Supabase
connectivity matter. It needs separate alerting and a durable user-owned prior
image because configuration/secrets are not code rollback and registry
retention must not be assumed.

Cloud Run is excluded for this release because its fixed 10-second shutdown
window provides no safety margin beyond the reviewed default 10-second internal
deadline. Preserving the current contract requires time to record the outcome,
close pools and exit accurately. Shortening the app deadline would require a
new lifecycle review and proof, not an implicit deployment adaptation.

## Exact approval gate

Before any Render mutation, the user must supply and approve the existing
account identity, Hobby workspace name and outbound-overage response/ceiling,
then explicitly approve:

> Create exactly one Web Service named `wanderful-staging-v1` in Frankfurt on
> Render Starter (0.5 CPU/512 MB), one always-on instance, using only the
> reviewed OCI image at its immutable registry digest, with auto-deploy off and
> a Render-generated HTTPS hostname. Approve USD $7/month compute plus
> $0.15/GB outbound after the workspace's included 5 GB/month, subject to the
> separately stated overage response/ceiling. Do not create DNS, custom domains,
> disks, databases, private links, dedicated IPs, a Pro workspace, or paid
> monitoring. Secrets are entered directly by the user; all provider and
> research flags remain exact false.

Account/workspace creation is not implied. Registry cost, staging Supabase cost,
tax/VAT, observability and optional egress products are not included in $7 and
need separate approval if nonzero. Render documents no hard outbound-spend cap;
the user must approve the operational ceiling response rather than be told one
exists.

Fly alternative approval requires an existing org name and explicit approval
for one `shared-cpu-1x` 512 MB Machine in `fra`, always on, at USD $3.69 per 30
days plus $0.02/GB Europe egress, with no static egress unless separately
approved. Static egress would add USD $3.60/month.

## Official sources

- Node support: <https://nodejs.org/en/about/previous-releases>
- Supabase Node 20 deprecation: <https://supabase.com/changelog/45715-deprecation-notice-dropping-support-for-node-js-20>
- Node official image and container practices: <https://github.com/nodejs/docker-node> and <https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md>
- Render: <https://render.com/docs/web-services>, <https://render.com/docs/regions>, <https://render.com/docs/health-checks>, <https://render.com/docs/deploys>, <https://render.com/docs/configure-environment-variables>, <https://render.com/docs/rollbacks>, <https://render.com/docs/compute-plans>, <https://render.com/docs/service-metrics>, <https://render.com/docs/notifications>, <https://render.com/docs/outbound-bandwidth>, <https://render.com/docs/platform-features-by-plan>, <https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses>
- Fly.io: <https://fly.io/docs/reference/regions/>, <https://fly.io/docs/reference/configuration/>, <https://fly.io/docs/reference/health-checks/>, <https://fly.io/docs/apps/secrets/>, <https://fly.io/docs/monitoring/metrics/>, <https://fly.io/docs/blueprints/rollback-guide/>, <https://fly.io/docs/launch/autostop-autostart/>, <https://fly.io/docs/networking/egress-ips/>, <https://fly.io/docs/about/pricing/>
- Supabase connectivity and TLS: <https://supabase.com/docs/guides/database/connecting-to-postgres> and <https://supabase.com/docs/guides/platform/ssl-enforcement>
- node-postgres TLS: <https://node-postgres.com/features/ssl>
- Cloud Run exclusion: <https://docs.cloud.google.com/run/docs/container-contract>, <https://docs.cloud.google.com/run/docs/configuring/healthchecks>, <https://docs.cloud.google.com/run/docs/release-notes>, <https://cloud.google.com/run/pricing>
