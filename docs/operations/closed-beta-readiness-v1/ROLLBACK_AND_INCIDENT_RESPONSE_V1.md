# Rollback and Incident Response V1

Status: **RUNBOOK ONLY — NO ROLLBACK OR DRILL EXECUTED**

## Principles

- Stop provider traffic first when safety, privacy, authorization, or quality is
  uncertain. A fail-closed unavailable result is preferable to an unverified
  route.
- Backend gates are the immediate kill switch. Current iOS research/access/
  evidence flags are embedded build settings; turning them off requires a new
  build and cannot immediately change an installed beta.
- Never enable insecure local routing/parsing or in-memory App Attest as a
  recovery path.
- Rollback never deletes historical evidence, rewrites proof receipts, reduces
  assertion counters, edits a migration ledger, or mutates a prior import.
- Every action records a new safe receipt with trigger, owner role, approvals,
  state digest, typed outcome, UTC window, verification, and recovery criteria.

## Emergency kill sequence

Execute serially unless the incident commander orders a narrower containment:

1. Set backend `OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED=false`.
2. Set backend `OUTDOOR_RESEARCH_PLANNING_ENABLED=false`.
3. Set backend `OUTDOOR_EVIDENCE_PROVIDER_ENABLED=false`.
4. Set `ROUTE_PROVIDER_ENABLED=false` and `INTENT_PROVIDER_ENABLED=false`.
5. Confirm all insecure/local/in-memory/mock flags false.
6. Deploy/apply the configuration atomically and run provider-independent
   health plus disabled zero-work probes.
7. Stop cohort expansion and notify the on-call/product/privacy owners with a
   typed incident class.
8. Prepare a client build with `ROUTABLE_HIGHLIGHT_ACCESS_ENABLED`,
   `RESEARCH_GUIDED_PLANNING_ENABLED`, and `OUTDOOR_EVIDENCE_ENABLED` false.
   Distribute only after normal signed-build review; do not claim it as the
   immediate containment step.

Success requires zero new provider reservations/calls and zero research
transactions after the configuration propagation window. If that cannot be
proved, revoke provider access and roll back the backend deployment.

## Control matrix

| Control | Trigger | Action | Verification | Recovery/roll-forward |
| --- | --- | --- | --- | --- |
| Turn off iOS feature gate | Access/research UX or client-contract defect | Set the three client build flags false in a new reviewed candidate; stop distributing the affected build where platform controls permit | Built Info plist/flag tests and signed archive receipt | New reviewed build only after backend gates and all affected checks pass |
| Turn off backend access gate | V2 lineage/snap/approach/presentation defect | Exact false for backend access flag | Schema V2 request returns typed unavailable with zero authorization/DB/provider work | Enable backend only after corrected V2 proof, then client |
| Turn off research planning | Research, PostGIS, quality, or region-wide defect | Exact false for backend research flag | Disabled endpoint short-circuits before body/auth/DB/provider | New database/quality proof and owner approval |
| Stop provider traffic | Provider incident, budget breach, sensitive egress, circuit open | Exact false for route and intent provider flags; close proof ledger | Provider ledger and egress counters stop; health remains provider-independent | Fresh provider approval and bounded canary |
| Rotate/revoke provider credential | Suspected exposure, staff/host change, provider instruction | Revoke at provider, replace only in backend secret store, restart/redeploy safely | Old key version unusable; new version identifier works in authorized canary | Keep client unchanged; never copy/hash credential into receipt |
| Roll back regional import | Stale/corrupt/wrong-region import or quality regression bound to import | Flags off; atomic same-region pointer/status transaction to reviewed prior import; re-project and revalidate | Provenance, freshness, isolation, indexes, latency, smoke tests | Prefer new immutable import if prior is stale |
| Roll back application deployment | Runtime/security/contract regression | Flags off; redeploy last reviewed artifact digest using platform rollback | Health, disabled zero-work, App Attest negative, DB connectivity without provider | Correct forward artifact after incident review |
| Preserve safe evidence | Any incident/proof failure | Seal logs/receipts under retention and access controls; snapshot only safe aggregates | Integrity digest/signature and forbidden-field scan | Append corrective receipt; never edit original |

## Regional import rollback procedure

1. Disable access, research, evidence, and provider flags.
2. Select one same-region prior `superseded` import with intact provenance and
   acceptable freshness. If none exists, keep the region disabled.
3. Under the region advisory lock, start one transaction and lock the region,
   current import, and selected prior import rows.
4. Recheck current pointer/status, same-region foreign keys, prior provenance,
   and absence of another active import.
5. Mark current import `superseded`, prior import `active`, and update the region
   pointer together. Commit or roll back all changes.
6. Run a new reviewed Evidence Graph projection for the restored import. Do not
   reactivate a projection tied to a different active import.
7. Repeat freshness, isolation, quarantine, index, corridor/access latency, and
   bounded smoke gates with provider false.
8. Append rollback receipt and keep product gates false until owner approval.

Do not delete the rejected import. A later repair is a new immutable import and
projection, not an in-place edit.

## Incident: App Attest verification failure

1. Disable research/access/provider traffic for the affected build/environment.
2. Classify only: unsupported, registration rejected, application/environment
   mismatch, assertion rejected, replay, expiry, rate limit, durable repository
   unavailable, or unknown safe failure.
3. Verify signed entitlement/profile/application identifier and backend App ID
   prefix, bundle, environment, validation category, and allowed build metadata
   without recording their private values.
4. Verify durable repository health, counter compare-and-set, challenge/session
   expiry, pruning, pool separation, and clock health.
5. Do not reset counters, copy Apple receipts, allow unauthenticated traffic, or
   use in-memory storage.
6. Run a newly authorized physical negative/positive subset. Restore traffic
   only after the mismatch is understood and the full mandatory security gate
   remains satisfied.

Escalate any environment mismatch in ordinary beta traffic as critical.

## Incident: provider rate limiting or circuit open

1. Stop new scheduling and honor only a valid bounded `Retry-After`; never loop
   or probe after the circuit opens.
2. Disable access/research provider gates and reconcile outstanding ledger/
   leases as success, typed failure, timeout, or cancellation.
3. Confirm call ceiling, cost owner, provider account status, and egress volume
   using aggregates only.
4. Do not rotate credentials merely to bypass a rate limit or distribute calls
   across unauthorized credentials.
5. Resume with a new explicit authorization and small serialized canary only
   after the provider owner confirms capacity/terms.

## Incident: stale or unavailable evidence

1. Mark the affected region unavailable and disable access/research before
   provider scheduling.
2. Confirm source/retrieval/import timestamps, checksum verification, active
   pointer, projection binding, and freshness class without exporting records.
3. If a current prior import exists, use the regional rollback procedure;
   otherwise acquire a new reviewed bounded source and create a new import.
4. Do not convert stale/unknown evidence into known zero, public access, safety,
   or scenic claims.
5. Resume only after current provenance, projection, isolation, performance,
   and smoke gates pass.

## Incident: route-quality regression

Examples include target-distance deviation, repeated segments/backtracking,
overlap, loop closure, unsuitable technical difficulty, route absence, or a
drop in eligible-survivor rate.

1. Disable access first; disable research entirely if the defect is not limited
   to V2 access shaping.
2. Preserve sanitized aggregate case/quality states and candidate/deployment/
   import digests. Do not retain geometry or coordinates.
3. Reproduce with deterministic fixtures/provider fakes before any live call.
4. Bind the regression to code, contract, import, projection, or provider class.
5. Revert deployment or import as appropriate; do not relax quality thresholds
   during incident response.
6. Require golden-set review, canonical-case V4 evidence under new authority,
   and presentation review before re-enabling.

## Incident: false verified-highlight presentation

This includes calling a mapped POI safely reachable, publicly accessible,
scenic, open, or reached without the corresponding contract evidence.

1. Immediately disable backend access V2, then research if the false claim can
   occur in V1 or shared presentation.
2. Stop distribution of the affected build and prepare a client-off build.
3. Preserve screenshots only when privacy-reviewed and stripped of route/user
   location; otherwise record typed presentation state and build digest.
4. Determine whether the source was contract conversion, lineage substitution,
   snap/approach classification, missing limitation, copy mapping, or stale
   evidence.
5. Correct the typed contract/presentation and add deterministic regression
   coverage. Never hide the issue by changing “verified” thresholds alone.
6. Notify beta participants with owner/legal-approved wording if they could
   have relied on the false claim.
7. Re-enable only after independent V2 contract, route-quality, and UX truth
   review plus the mandatory checklist.

## Incident: credential exposure

1. Disable provider traffic and restrict affected logs/storage immediately.
2. Revoke/rotate through the credential owner. Do not print, copy, hash, or
   compare the credential in the incident record.
3. Identify affected environment, key-version alias, exposure window bucket,
   and aggregate call/cost counts.
4. Apply the approved deletion/notification process for any sensitive log
   destination while preserving sanitized incident evidence.
5. Verify the iOS binary/archive never contained the credential and backend
   secret access is least privilege.
6. Resume only with new version, egress/cost review, and bounded canary.

## Deployment rollback

Before beta, the platform must demonstrate:

- one-command/API rollback to a previously reviewed artifact digest without
  exposing environment values;
- configuration flags can be set false independently of code rollback;
- database migrations are backward-compatible for the rollback artifact or the
  application remains disabled until a forward fix;
- provider-independent health, disabled zero-work, App Attest safe failure, and
  receipt signing survive rollback;
- rollback does not point staging at another environment's database or secrets.

Record artifact digests and typed results only. Vendor-specific commands belong
in the private platform procedure, not in this public-safe runbook.

## Audit evidence and closure

Every incident closes only after:

- immediate flags/provider state are false or explicitly approved;
- all leases/processes are reconciled and cleanup passes;
- forbidden-field scan and receipt integrity pass;
- root cause, affected contract versions, corrective owner, and due date are
  recorded without sensitive values;
- rollback/forward verification passes;
- closed-beta checklist is re-evaluated. A prior GO does not survive a critical
  unresolved incident.

Rollback drills must cover backend gates, provider stop/rotation, one regional
import, deployment, receipt preservation, and the client build-time limitation
before the first invite cohort and at an owner-approved recurring cadence.
