# Free Staging Outage, Drain and Cold-Start V1

Local lifecycle tests are necessary but not remote proof. Execute these drills
only after the free Render service and staging database pass admission. Keep all
providers disabled for every drill.

| Drill | Required result |
| --- | --- |
| Cold start after more than 15 idle minutes | First request may encounter Render wake behavior; eventually `/healthz` is exact application JSON and `/readyz` becomes exact ready JSON. Record wake duration. Do not count Render's loading response as health. |
| Database unavailable at startup | Process never binds; deploy is unhealthy; constructed pools close; logs contain only bounded startup category. |
| Database loss while running | `/healthz` remains live, cached `/readyz` becomes 503, late application work returns bounded 503, and no raw database error is logged. |
| Database recovery | A later bounded probe restores readiness once; no duplicate pools or process restart are required. |
| Idle restart | Render sends `SIGTERM`; readiness becomes false, the socket stops accepting, pools close and the process exits before the 30-second platform limit. |
| In-flight restart | New work is rejected, registered work receives cancellation at the 10-second application deadline, sockets and pools close, and late provider work is impossible because flags are false. |
| Repeated free-tier restart | Startup admission reruns on every fresh instance; no process-local state is treated as durable. |
| Disabled dependency/provider endpoint | Safe bounded 503, zero authorization transaction, rate window, lease, circuit reservation, database research query and network provider call. |
| Rollback | Prior available deploy becomes active and independently passes HTTPS/live/ready/disabled/log checks. |

## Existing automated coverage

- `backend/test/stagingRuntimeLifecycle.test.js` covers startup admission,
  bounded health, database outage, readiness and graceful pool shutdown.
- `backend/test/productionOperations.test.js` and
  `backend/test/providerFeatureFlags.test.js` cover fail-closed configuration
  and zero-work disabled providers.
- `backend/test/stagingRuntimeContainer.test.js` covers the pinned image source,
  non-root runtime, build-context allowlist and machine contract.
- `backend/test/stagingFreeHostingContract.test.js` binds the free Blueprint to
  the reviewed platform, lifecycle and exact-false capability contract.

Remote execution must publish its own sanitized receipt. Passing local tests
does not authorize iOS connection or imply that Render Free is always available.
