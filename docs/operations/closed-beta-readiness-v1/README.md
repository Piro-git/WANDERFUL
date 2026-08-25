# TrailMind Backend Closed-Beta Readiness V1

Status: **NO-GO**

Current-source audit: **2026-08-23**

Reviewed backend source: `76f6552a1cd525a38a3840a0204cd81aede94406`

Parent main at source checkpoint: `5647bbea6d25eca9b03e9fa1a47e5dfca7ffb658`

## Executive verdict

The backend now has locally verified production admission, coarse health,
durable runtime composition, privacy-safe operational events, bounded drain,
App Attest pruning, and a false-green-resistant package validator. Those
changes remove important source-level P2 operational defects. They do not make
the product deployable or beta-ready by themselves.

The current decision remains **NO-GO** because no admitted HTTPS staging
deployment, durable PostgreSQL/PostGIS environment, least-privilege grant
proof, backup/restore rehearsal, physical-iPhone App Attest proof, signed
TestFlight proof, provider authorization/budget, deployed monitoring/alerts,
secret-rotation drill, or rollback rehearsal exists. The ordinary GraphHopper
route adapter now has locally verified success/error byte ceilings and a
process-local closed/open/half-open circuit, but no authorized staging/provider
outage receipt exists. Every mandatory unresolved item is listed by ID in
`go-no-go-checklist-v1.json`; missing evidence cannot become a pass.

This refresh performed no deployment, feature enablement, provider call,
database provisioning, import, signing, device, cloud, DNS, or production
mutation.

## Evidence classes

The package uses these meanings consistently:

- **Current automated proof:** a deterministic test at the reviewed source
  commit passed in the current run.
- **Current source verification:** the implementation was inspected at the
  reviewed source commit but may still require an external runtime proof.
- **Historical evidence only:** an immutable earlier receipt describes its own
  run and cannot prove the current service or deployment.
- **External blocker:** proof requires disposable PostGIS, staging/deployment,
  a physical iPhone/App Attest environment, provider authorization, or an
  owner/cloud decision.

Recommended targets, proposed SLOs, and operator procedures are not evidence
that a deployed system currently implements them.

## What current code and tests prove locally

| Contract | Current evidence | Boundary |
| --- | --- | --- |
| Production preflight | `backend/src/operations/productionConfiguration.js`, `backend/src/operations/preflight.js`, `backend/test/productionOperations.test.js` | Presence/exact parsing only; it performs no database/provider call and proves no deployed configuration. |
| Durable App Attest admission | `backend/src/operations/serviceLifecycle.js`, `backend/src/appAttest/appAttestRuntime.js`, `backend/test/productionOperations.test.js`, `backend/test/providerFeatureFlags.test.js` | Production startup requires a durable PostgreSQL repository and real verifier; actual database grants/connectivity require staging. |
| Provider flag fail-closed behavior | `backend/src/appAttest/routeSessionAuthorizer.js`, `backend/test/providerFeatureFlags.test.js` | Application parsers accept normalized `true`, `yes`, or `1`; production preflight permits exact `true` or `false` only. A deployed receipt is absent. |
| Disabled zero-work behavior | `backend/src/server.js`, `backend/test/outdoorAdventureServer.test.js`, `backend/test/providerFeatureFlags.test.js` | Disabled research/provider paths consume no authorization, database, provider, lease, or rate-window work in local fakes. |
| Liveness/readiness | `backend/src/server.js`, `backend/src/operations/serviceLifecycle.js`, `backend/test/productionOperations.test.js` | Liveness performs no dependency work; readiness returns only `ready`/`not_ready` from cached probes. Ingress behavior is unproved. |
| Drain and shutdown | `backend/src/operations/serviceLifecycle.js`, `backend/test/productionOperations.test.js` | One deadline, late-work rejection, abort, pool/socket close, partial-start cleanup, and forced nonzero signal exit are locally tested. Orchestrator behavior is unproved. |
| Request/content/cancellation bounds | `backend/src/server.js`, `backend/src/parseIntent.js`, `backend/src/routing/graphHopperProvider.js`, `backend/test/graphHopperProviderRuntime.test.js`, `backend/test/routeServer.test.js`, `backend/test/outdoorAdventureServer.test.js`, `backend/test/intentReliability.test.js` | Content type, request/intent/provider response size, timeout, late settlement, disconnect, and cancellation regressions pass. Ingress and dependency behavior still require staging proof. |
| Ordinary provider circuit | `backend/src/routing/graphHopperProvider.js`, `backend/src/server.js`, `backend/src/operations/serviceLifecycle.js`, `backend/test/graphHopperProviderRuntime.test.js`, `backend/test/providerFeatureFlags.test.js`, `backend/test/productionOperations.test.js` | The shared process-local provider has deterministic closed/open/half-open behavior, one half-open probe, neutral caller cancellation/local rejection/rate-limit outcomes, safe events, and coarse readiness. Multi-instance/provider-outage behavior requires authorized staging proof. |
| App Attest replay/budget/pruning | `backend/src/appAttest/postgresAppAttestRepository.js`, `backend/src/appAttest/pruneExpired.js`, `backend/test/postgresAppAttestRepository.test.js`, `backend/test/appAttestPrune.test.js` | Transactions, counter compare-and-set, request replay, weighted windows, leases, timeouts, App-security role URL precedence, aggregate pruning output, and pool cleanup are tested with fakes. Physical and deployed proof is absent. |
| Privacy-safe operational events | `backend/src/operations/operationalEvents.js`, `backend/test/productionOperations.test.js` | Unknown/high-cardinality fields and synthetic sensitive sentinels are dropped locally. No deployed sink, metric exporter, dashboard, or alert route exists. |
| Release package validation | `backend/src/operations/releasePackage.js`, `backend/test/releasePackage.test.js` | Source binding, package inventory, gate coverage/status, blocker reconciliation, unsafe feature states, evidence paths, and false-green decisions are validated. |

The complete deterministic backend suite passed **824/824** with **0 skips**,
`npm run build` passed, and the offline outdoor-adventure quality evaluation
passed **101/101** with zero live traffic. These totals are current verification
results, not staging receipts.

## Current source findings and external boundaries

- `backend/src/routing/graphHopperProvider.js` enforces actual streamed-byte
  ceilings for successful and smaller error bodies. `Content-Length` is only
  an early rejection hint; missing, malformed, chunked, or misleading headers
  cannot bypass the streamed limit. Fatal UTF-8 and JSON parsing occur only
  after the bounded read. There is no automatic retry.
- The ordinary provider circuit counts network errors, timeouts, 5xx results,
  and malformed/oversized/invalid successful responses as provider-health
  failures. Caller cancellation, local validation/configuration rejection,
  disabled endpoints, rate limits, and other 4xx results are neutral. Open
  state performs no fetch; exactly one half-open probe is admitted. This is
  process-local behavior, not proof of multi-instance or provider health.
- `backend/api/index.js` exports the bare request handler. It does not execute
  standalone preflight, explicit pool composition, cached dependency
  readiness, or signal-driven drain. It is not an admitted closed-beta entry
  point until a platform-specific equivalent is proved.
- The source does not configure broad CORS or trust proxy-forwarded client IP
  headers. It uses the socket peer unless an explicit resolver is injected.
  The correct ingress identity/rate-limit design remains a platform decision.
- Error responses are bounded allowlisted messages without stack traces or
  dependency detail. `Retry-After` is the only forwarded endpoint header and
  accepts bounded decimal seconds.
- App Attest pruning deletes expired challenges, route sessions, rate windows,
  and provider leases. It does not delete registered keys or Apple receipts;
  no retention period or deletion authority is approved.
- Metrics, alerts, dashboards, on-call routing, SLOs, backup objectives,
  zero-downtime behavior, and incident contacts in this package are proposals,
  not deployed facts.

## Trust boundaries

```text
iOS client
  -> HTTPS ingress and operator-selected peer identity boundary
  -> Node HTTP parser, body limits, cancellation, and drain state
  -> App Attest verifier and durable session authorization
  -> App-security PostgreSQL role/pool
  -> optional outdoor research/evidence PostgreSQL roles/pools
  -> optional GraphHopper or remote intent provider
  -> allowlisted application events -> operator-selected log/metric sinks

operator-only migration/import/prune/backup/restore roles
  -> separately authorized database and evidence operations
```

Exact prompts, coordinates, geometry, App Attest assertions, key IDs,
credentials, database/provider URLs, provider responses, and sensitive headers
must not cross into health, preflight, logs, metrics, or receipts.

## Promotion dependency order

1. Accept the exact source/evidence manifest and keep every provider/client
   feature false.
2. Select an admitted runtime/ingress/secret/egress design and named owners.
3. Provision isolated HTTPS staging plus private PostgreSQL/PostGIS with
   separate provisioner, migration, App-security, research, cancellation,
   evidence, pruner, and audit authorities.
4. Run production preflight and the candidate-bound ten-phase database
   operator. Supabase must use `supabase-postgis-isolation-v2`
   (`001–007 + 009`) behind the sealed operator context; the raw runner and
   historical portable `001–008` policy are not operator substitutes. Then run
   denied-access, backup/restore, restart/drain, dependency-outage, and rollback
   exercises with provider traffic disabled.
5. Import/project current regional evidence only under separately authorized
   data operations, then prove isolation, freshness, indexes, latency, and
   cancellation using disposable/staging PostGIS.
6. Execute the physical-iPhone development App Attest protocol, then the
   independently signed TestFlight production-environment protocol.
7. Obtain new provider authority and owner-approved cost/rate/concurrency/
   circuit limits. Attempt 13 is not authorized and must not start.
8. Complete route-quality, truth-boundary, monitoring, privacy, retention,
   support, incident, and rollback gates.
9. Re-run the package validator against the exact deployment candidate. This V1
   validator admits only a reconciled **NO-GO** package and cannot authorize GO;
   a separately reviewed promotion gate is required after every mandatory item
   has real evidence and approval.

## Historical evidence boundary

Existing server-side, staging, V2, V3, Golden Set, and V4 receipts under
`docs/release/` remain byte-for-byte historical artifacts. V4 Attempts 10, 11,
and 12 are current repository history but were blocked before producing
accepted provider/route proof. Attempt 12 stopped before database provisioning
and provider admission; Attempt 13 is not authorized. Historical cleanup and
zero-traffic claims apply only to their recorded runs.

No claim in this package relies on the incomplete Codex Security TAC scan. The
current security assessment is an offline source/diff review plus the tests
and limitations cited above.

## Package inventory

- `go-no-go-checklist-v1.json` — authoritative mandatory gate states.
- `feature-flag-state-matrix-v1.json` — fail-closed feature-state contract.
- `SOURCE_EVIDENCE_MANIFEST_V1.json` — source commit, package inventory,
  classifications, and per-gate source evidence.
- `SOURCE_EVIDENCE_MANIFEST_V1_DATABASE_SUPPLEMENT_V2_CANDIDATE.json` —
  explicitly uncommitted, non-homogeneous database-candidate supplement. It
  overrides only the current local database gate evidence and does not
  regenerate or relabel the older commit-bound source manifest.
- `STAGING_PROVISIONING_RUNBOOK_V1.md` — staging, database, migration, backup,
  restore, and role proof.
- `PHYSICAL_IPHONE_APP_ATTEST_PROOF_V1.md` — physical-device protocol.
- `OBSERVABILITY_AND_PRIVACY_V1.md` — implemented event boundary versus
  proposed metrics/SLO/retention targets.
- `ROLLBACK_AND_INCIDENT_RESPONSE_V1.md` — containment and recovery protocol.
- `CLOSED_BETA_ROLLOUT_V1.md` — staging-to-beta-to-public promotion protocol.
- `V4_OPERATIONAL_PROTOCOL.md`, `V4_PROOF_RUN_CLOCK_CONTRACT.md`, and
  `V4_PROOF_RUN_IDENTITY_CONTRACT.md` — historical/future V4 boundaries;
  Attempt 13 remains unauthorized.

Machine validation command:

```sh
cd backend
npm run ops:validate-release-package
```

The command emits bounded JSON and exits nonzero on stale source binding,
missing evidence, inconsistent blockers, incomplete state coverage, unsafe
feature states, or a false-green decision.
