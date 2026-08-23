# Observability and Privacy V1

Status: **POLICY PROPOSED; DEPLOYED CONTROLS NOT VERIFIED**

Current source boundary: `0eaf7af8ab45ec1f4e7cd39239d8977e0d1bef95`.

## Implemented and locally proved

`backend/src/operations/operationalEvents.js` implements a vendor-neutral JSON
event sink for a finite event vocabulary. It drops unknown fields, request IDs,
prompts, coordinates, URLs, payloads, and non-allowlisted/high-cardinality
values; durations and counts are bucketed. The standalone service passes this
logger to route, outdoor-evidence, outdoor-adventure, lifecycle, and intent
lease-release events. `backend/test/productionOperations.test.js` proves a
synthetic sensitive sentinel is absent from output and an unknown event is not
emitted.

That is local application behavior only. No external sink, metric exporter,
trace system, dashboard, alert destination, access policy, sampling policy, or
retention enforcement is configured or proved. App Attest endpoints do not yet
emit the full proposed aggregate outcome families below.

## Objective

Operate a small beta without recording a person's route request, precise
location, route geometry, App Attest material, or provider/database secrets.
Metrics are low-cardinality, aggregate, and tied to coarse operational regions,
typed states, and contract versions.

## Allowed event envelope

Every event has an allowlisted schema and rejects unknown fields:

- `eventName` from a reviewed finite set;
- UTC timestamp, with any environment/deployment/contract labels added only
  from a separately reviewed finite allowlist;
- coarse `regionId` (`harz-v1`, `innsbruck-alps-v1`, `unsupported`, or
  `unknown`), activity, and route type;
- result state and typed error code;
- duration bucket, attempt-count bucket, route-result-count bucket, and
  provider status class;
- evidence freshness class and coverage class;
- bounded quality state/rejection counts, not individual geometry samples;
- cancellation, timeout, rate-limit, invalid-contract, and circuit-open counts;
- App Attest outcome class such as registration accepted/rejected, assertion
  accepted/rejected, replay rejected, environment mismatch, session expired,
  or authorization unavailable;
- flag-state/version digest and receipt-integrity result;
- provider ledger aggregate counts only during an authorized proof.

Do not attach a user, installation, key, session, device, prompt, or exact route
identifier. Request IDs may exist transiently for request processing but are not
retained in normal analytics or proof summaries.

## Prohibited data

The log/metric/trace/receipt pipeline must drop and alert on:

- raw or normalized prompts and clarification text;
- precise coordinates, exact user location, waypoint/POI coordinates, route
  geometry, map snapshots, or complete distance series;
- request/response bodies, raw provider responses, headers, URLs, status text,
  or unbounded exception messages;
- GraphHopper, database, signing, or receipt credentials and connection values;
- authorization headers, session tokens/hashes, request IDs, key IDs,
  challenges, nonces, assertions, attestations, Apple receipts, public/private
  keys, or assertion counters;
- device serial, UDID, IP address, advertising identifier, Keychain identity,
  or another private device/user identifier;
- raw OSM tags, source PBF paths, import staging paths, or database process IDs;
- free-form operator notes that can bypass the typed schema.

Errors must be mapped to a small allowlist before observation. Provider or
database error bodies are discarded. Sanitizer failures fail the receipt/proof;
they are not logged with the offending value.

## Proposed metric families — not implemented proof

| Metric | Labels | Purpose |
| --- | --- | --- |
| `planning_requests_total` | region, activity, route_type, result_state, contract_version | Volume and truthful result mix |
| `planning_duration_bucket` | region, stage, bucket | Latency without exact traces |
| `planning_attempt_count` | region, bounded_count | Orchestration pressure |
| `planning_route_result_count` | region, bounded_count | Empty/partial/routed monitoring |
| `app_attest_outcomes_total` | environment, channel, typed_outcome, build_version | Integrity-flow health without installation identity |
| `route_session_outcomes_total` | typed_outcome, cost_class | Expiry, replay, exhaustion, authorization health |
| `postgis_outcomes_total` | region, operation_class, result, duration_bucket | Research availability and latency |
| `evidence_freshness` | region, freshness_class, contract_version | Current/stale/unavailable gate |
| `provider_outcomes_total` | region, provider_status_class, duration_bucket | Provider health and circuit input |
| `quality_states_total` | region, case/cohort class, quality_state | Aggregate eligibility/regression |
| `cancellation_total` | stage, result | Cancellation propagation and lease health |
| `invalid_contract_total` | side, schema_version, typed_code | Strict contract drift |
| `feature_gate_zero_work_violations_total` | gate, downstream_stage | Fail-closed invariant |
| `receipt_integrity_total` | receipt_type, result | Append-only proof integrity |

Exact meter values may exist transiently for validation and V4's sanitized
case receipt, but normal beta monitoring uses reviewed buckets only.

## Proposed alert targets and automatic action — not deployed proof

These are recommended initial targets for owner review, not a current SLA, SLO,
alert, or monitoring fact. A target change requires review, versioning, and a
rollback entry.

| Alert | Threshold | Severity | Immediate action | Clear condition |
| --- | --- | --- | --- | --- |
| Disabled-gate downstream work | Any authorization, DB, or provider count while a required upstream gate is off | Critical | Disable backend research/access/provider; incident response | Root cause fixed and zero-work probe passes twice |
| Provider ceiling violation | Any proof attempt above its authorized ceiling or unreconciled ledger | Critical | Stop proof/provider traffic; revoke access if needed | New authorized run only |
| V4 circuit breaker | Two consecutive same-class immediate failures under 1 s | Critical for proof | Open circuit, make no probe, disable proof flags | New authorization after provider review |
| Beta provider failures | At least 5 attempts in 10 min and failure/timeout ratio at least 40%, or 3 consecutive rate limits | High | Disable access/research provider path; preserve standard safe fallback only if separately approved | 30 min healthy canary under new approval |
| Rate-limit anomaly | At least 3 rate-limit outcomes in 5 min for the small cohort, or any global-capacity limit at planned idle load | High | Freeze cohort expansion; inspect budgets without identifiers | Two windows below threshold |
| App Attest verification failure | At least 5 attempts in 10 min and rejection ratio at least 30% for one channel/build, excluding deliberate proof negatives | High | Stop rollout for affected build; keep insecure fallback off | Signed-device diagnostic passes and ratio normal for 30 min |
| App Attest environment mismatch | Any ordinary beta occurrence | Critical | Disable affected build/backend gate and inspect signing/config | Correct signed build and verifier receipt |
| Evidence stale/unavailable | Any supported region not current at beta admission or two consecutive 15-min checks during beta | Critical | Disable research/access for that region; no provider work | New current import/projection passes all gates |
| PostGIS latency | p95 at or above 2 s for 15 min with at least 10 operations, or 2 statement timeouts in 5 min | High | Disable research/access; inspect plan/index and cancel health | p95 below 1.5 s for 30 min and no timeout |
| Cancellation anomaly | At least 5 cancellations in 15 min and rollback/lease-release success below 100%, or any provider call after pre-provider cancellation | Critical | Disable research/provider; inspect pools/leases | Controlled cancellation proof passes |
| Invalid contract | Any unknown-field/schema/lineage result in closed beta | High | Quarantine deployment/build combination; disable access if V2 | Matching contract corpus and signed receipt pass |
| Receipt integrity | Any missing, duplicate, altered, unsigned, sensitive, or unreconciled mandatory receipt | Critical | NO-GO; lock receipt store and investigate | New independent valid evidence; never rewrite old receipt |
| False verified-highlight presentation | Any confirmed occurrence | Critical | Disable access then research; invoke presentation incident runbook | Corrected build and independent UX/contract verification |

Low-volume windows that do not meet the minimum count remain `insufficient_data`
and cannot justify expansion.

## Retention and access

The only current callable retention seam is the bounded App Attest expiry
pruner:

```sh
cd backend
npm run ops:prune-app-attest
```

After configuration is injected outside the command line, it deletes expired
challenges, route sessions, rate windows, and provider leases and emits fixed
aggregate counts only. Current evidence:
`backend/src/appAttest/pruneExpired.js`,
`backend/src/appAttest/postgresAppAttestRepository.js`,
`backend/test/appAttestPrune.test.js`, and
`backend/test/postgresAppAttestRepository.test.js`. No scheduler or deployed
execution receipt exists. Registered keys and Apple attestation receipts are
out of scope for this pruner and require a separately approved retention and
deletion operation.

Illustrative privacy-minimizing targets, pending explicit owner/legal approval:

- staging structured application logs: 7 days;
- closed-beta structured application logs: 14 days;
- aggregate low-cardinality metrics: 90 days;
- sanitized signed proof/rollback/decision receipts: 365 days or the approved
  release-audit period, whichever is shorter unless legal obligations require
  otherwise;
- provider task-local ledger: delete after a reconciled signed aggregate and
  cleanup receipt;
- App Attest security-table retention: separate security policy. Run the
  repository's bounded expiry pruning every 5 minutes, alert after 15 minutes
  without success, and define registered-key/Apple-receipt deletion separately;
- PBF and temporary import artifacts: remove after verified promotion/rollback
  evidence according to the staging runbook; immutable import provenance stays
  under its approved audit retention.

Recommended access policy: restrict structured logs to the minimum named
backend/on-call role and receipts to named privacy/security auditors; prohibit
provider/database administrators from reusing them for product analytics;
review access on an owner-approved cadence; and disable export unless approved.
None of those controls is currently proved.

## Sanitization and enforcement

1. Define each event as an exact schema with enum labels and bounded counts.
2. Construct the event from already typed state; never redact a raw request
   after logging it.
3. Reject unknown fields and high-cardinality values at the application sink.
4. Apply a second ingestion rule for forbidden key names and credential-like
   values. Emit only `sanitizer_rejected_event_total`, never the rejected value.
5. Sample/test the pipeline with synthetic sentinel values before beta and
   verify no sentinel appears in the destination.
6. Run daily privacy review during early cohort stages and weekly after stable
   expansion.
7. Treat any forbidden-data observation as an incident: stop affected logging,
   restrict access, follow approved deletion/notification policy, rotate exposed
   credentials without inspecting them, and preserve only safe incident facts.

## Proposed dashboards — none deployed

Maintain four small dashboards:

1. Security: App Attest/session typed outcomes, mismatch/replay/rate limits,
   pruning health, and receipt integrity.
2. Pipeline: gate state, authorization, PostGIS, provider, strict contract, and
   cancellation stage counts.
3. Regional data: Harz/Innsbruck freshness, coverage class, active projection,
   index/latency class, and import rollback state.
4. Quality: routed/partial/no-route counts, eligibility/rejection classes,
   highlight reached/near/not-reached/unverified counts, and quality-regression
   alerts.

No dashboard supports drill-down to a person's route, device, session, or
location.
