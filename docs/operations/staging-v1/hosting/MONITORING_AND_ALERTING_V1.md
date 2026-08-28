# Free Staging Monitoring and Alerting V1

Render Free provides service logs, platform health checks and workspace email
notifications, but it does not provide the full custom threshold alerting
required for closed beta. No external monitor or alert route is created by this
package.

## Required free-tier signals

| Signal | Source | Interpretation |
| --- | --- | --- |
| Process liveness | Render HTTP health check on `/healthz` | Process only; never database or provider health. |
| Dependency readiness | External/manual `GET /readyz` and allowlisted readiness transition | Missing, 503 or stale observation is not ready. |
| Cold start | Timestamp from public request to exact application liveness response | Expected after idle; track separately from application latency. |
| Deploy/restart | Render event/email plus `service_started`, `service_draining`, `service_stopped` | Missing graceful stop evidence is a failed drill. |
| Database state | Deduplicated allowlisted pool availability/error transitions | No raw database errors, URLs, roles or SQL state. |
| Provider state | Capability-disabled events | Any enabled state or circuit/provider-call event is critical drift. |
| Backup/import freshness | Database-lane receipt | Unknown until supplied; liveness cannot turn it green. |
| Pruner freshness | Separate control-job receipt | Free web service cannot run one-off jobs; missing receipt remains unknown. |

## Alert policy

- Critical: Render reports unhealthy/restart, readiness remains unavailable for
  five minutes after the service is awake, any provider capability is enabled,
  any provider call is observed, drain exceeds ten seconds, or privacy scanning
  finds a forbidden field.
- Warning: cold wake exceeds two minutes, readiness is unavailable for one
  minute after liveness, or the service approaches Render's included usage.
- Expected/no page: idle spin-down by itself. It must still remain visible as
  unavailable, not healthy.

The owner must confirm Render workspace email notifications are delivered and
perform one controlled unhealthy-deploy notification test. Do not add a
keep-alive ping merely to defeat Free spin-down: it would obscure cold-start
behavior, consume instance hours and create avoidable database traffic.

## Privacy boundary

Logs and receipts may contain only fixed event/state/outcome enums, timestamps,
status codes, duration/count buckets, source commit and public Render deploy ID.
Never retain prompts, coordinates, geometry, App Attest assertions, tokens,
database/provider URLs, credentials, request IDs, client IPs, headers, SQL or
raw errors. A monitoring view is false green if readiness, database freshness,
backup freshness or pruning freshness is missing.
