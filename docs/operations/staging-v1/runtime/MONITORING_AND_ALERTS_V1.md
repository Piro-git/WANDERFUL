# Staging Monitoring, Privacy and Alerts V1

Status: **LOCAL HOOKS IMPLEMENTED; REMOTE SINKS AND ALERT ROUTING UNAPPROVED**

The application emits newline-delimited JSON through one existing allowlisted
logger. Unknown event names and fields are dropped. Durations and counts are
bucketed. New staging hooks cover capability state, database pool
available/unavailable and coarse pressure transitions, idle pool errors, and
prune job success/failure. Pool errors are emitted once per unavailable episode
and reset only after recovery, bounding outage log volume. No metrics or
operator endpoint is public.

## Signals

| Signal | Source | Proposed staging interpretation |
| --- | --- | --- |
| Process uptime/liveness | HTTPS `GET /health/live` and container healthcheck | Dependency-free process health only |
| Readiness transition | `GET /health/ready`, `readiness_changed` | Cached required-dependency and drain admission |
| Request rate/status/latency | Platform HTTP metrics plus allowlisted completion events | Group by fixed path class/status and existing buckets only |
| DB availability/pressure | `database_pool_state_changed`, `database_pool_error` | Fixed available state and pre-probe normal/busy/waiting/saturated/unknown sample; unavailable/unknown on failed probe |
| Provider state | `runtime_capability_state`, `provider_circuit_state_changed` | Every provider capability must be disabled; circuit events are unexpected |
| Drain | `service_draining`, `service_stopped` | Graceful versus deadline exceeded |
| Pruning freshness | Latest `prune_job_completed:succeeded` timestamp | External scheduler freshness, not an HTTP endpoint |
| Regional freshness | Database proof lane signal | Missing input remains unknown, never green |
| Backup freshness | Database proof lane signal | Missing input remains unknown, never green |

The process-local GraphHopper circuit is not coordinated across instances. It
is dormant while the route provider is disabled. Future provider admission must
either account for each instance independently in dashboards or add a reviewed
shared mechanism; this release makes no multi-instance provider-health claim.

## Proposed alert thresholds

These are staging operating thresholds, not an SLA, and require approval before
remote configuration.

| Alert | Warning | Critical | Placeholder owner role |
| --- | --- | --- | --- |
| Liveness | 2 consecutive failures | 3 consecutive failures or no process for 2 minutes | Platform operator |
| Readiness | not ready for 60 seconds | not ready for 5 minutes | Backend runtime owner |
| HTTP server errors | >5% with at least 20 requests over 5 minutes | >20% with at least 20 requests over 5 minutes | Backend runtime owner |
| Latency | p95 >5 seconds for 15 minutes | p95 >15 seconds for 5 minutes | Backend runtime owner |
| DB pressure | observed waiting/saturated transition or platform threshold | persists 60 seconds or one deduplicated idle pool error | Database staging owner |
| Provider drift | any capability not disabled | any circuit/provider call evidence | Release approver |
| Drain | none | deadline exceeded or forced termination | Platform operator |
| Pruning | no success for 24 hours | no success for 48 hours | Security operations owner |
| Regional/backup freshness | threshold supplied by DB proof | missing/failed DB proof at release gate | Database staging owner |

No person, on-call schedule or SLA is invented. Render's Hobby notifications
cover deployment/image-pull and unhealthy/healthy state but not arbitrary
metric thresholds; additional alerting or paid observability is a separate
remote approval gate. Fly likewise needs an external alerting arrangement.

## Privacy and cardinality

Never ingest prompts, precise coordinates, route geometry, App Attest
assertions/receipts, tokens, request IDs, database/provider URLs, provider
payloads, sensitive headers or error objects. Do not attach arbitrary path,
role, host, client identity, SQL state or exception text as labels.

Allowed dimensions are finite event names, fixed capability/state/outcome enums,
status codes, reviewed region IDs already present in existing schemas, and
existing count/duration buckets. Tests inject sensitive sentinels and prove they
are omitted. Unknown fields remain dropped rather than sanitized heuristically.

A monitoring dashboard is false green if liveness is up while readiness input,
pruning freshness, database proof freshness or backup proof is missing. Those
states render as unknown/not-ready, never pass.

The local pool-pressure sample runs immediately before each bounded readiness
probe and is transition-deduplicated. It can miss spikes shorter than the probe
interval, so deployed platform/database metrics remain required before claiming
continuous saturation coverage.
