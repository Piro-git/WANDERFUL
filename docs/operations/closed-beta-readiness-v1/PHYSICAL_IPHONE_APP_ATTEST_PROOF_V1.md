# Physical iPhone App Attest Proof V1

Status: **NOT EXECUTED**

Current backend source boundary:
`0eaf7af8ab45ec1f4e7cd39239d8977e0d1bef95`. Current automated verifier,
repository, endpoint, session-authorization, replay, pruning, flag, and
transport tests are prerequisites only; they are not physical-device or
TestFlight evidence.

## Purpose and proof boundary

This protocol proves one explicitly authorized physical iPhone can register an
App Attest key, create an assertion-backed route session, and authorize one
bounded planning request while replay, mismatch, expiry, malformed input,
cancellation, and rate-limit cases fail closed.

It does not prove user identity, location truth, route safety, route quality,
provider correctness, legal access, or beta readiness. Development-signed and
TestFlight production-environment proofs are separate receipts; neither may be
inferred from Simulator tests.

## Required prerequisites

All items must be recorded as verified before the proof window opens:

1. One supported iPhone that reports App Attest support and runs iOS 26.0 or
   later. Record only model family and OS major/minor, never serial number, UDID,
   advertising identifier, or key identifier.
2. A trusted, patched development Mac with an identified Xcode version, a clean
   reviewed repository commit, encrypted storage, and no screen/log capture of
   request material.
3. Active Apple Developer team access and a named signing operator with the
   minimum role needed for the proof.
4. An explicit application identifier matching the reviewed bundle identifier,
   with App Attest enabled.
5. A valid development signing configuration for the first proof and a
   separately approved TestFlight build for the production-environment proof.
   The embedded entitlement, application identifier, team identifier, profile,
   version, and build must be inspected before installation.
6. An isolated HTTPS staging backend whose certificate validates normally and
   whose deployment digest is recorded without retaining its URL in the proof
   receipt.
7. The current backend verifier dependencies: pinned Apple App Attestation root,
   exact App ID prefix/bundle/environment configuration, allowlisted validation
   categories and bundle versions, and reviewed locked Node dependencies for
   CBOR, ASN.1, X.509, PostgreSQL, and platform crypto.
8. A durable staging PostgreSQL repository with reviewed migrations applied,
   an explicit App-security runtime pool, separate research and cancellation
   roles/pools when research is used, pruning scheduled, backups defined, and
   no in-memory App Attest fallback.
9. Current, active, isolated regional evidence and projection only if the one
   planning case will execute research. All ordinary client/backend research
   flags begin false.
10. A passing `npm run ops:preflight` presence-only receipt for the exact
    candidate plus deployed checks proving exact-value flags, bounded costs,
    concurrency, timeouts, and a one-call provider ceiling for this proof.
11. Explicit, time-bounded provider authorization for case 5 only. The provider
    credential is owned by backend operations, injected through the staging
    secret store, unavailable to the iPhone, and never copied into a command,
    log, receipt, or document.
12. Correct device and server time, automatic time enabled, stable network with
    TLS interception disabled, and an alternate network available for a
    controlled interruption case.
13. A reviewed physical-proof harness able to execute named cases, corrupt or
    mismatch transient App Attest inputs in memory, and emit only the safe
    receipt fields below. The current repository does not yet provide this
    physical harness; its absence is a blocker.
14. A non-secret operator role, approval-reference ID, incident contact, proof
    start/end window, cleanup owner, and signed stop authority.

## Global controls

- Use a fresh proof-run ID. Never reuse V1/V2/V3/V4 or official proof outputs.
- Run cases serially. Keep all ordinary and insecure/local flags false except
  the minimum backend/client flags explicitly required by the active case.
- The backend must expose causal counters to the proof evaluator for feature
  gate, authorization, App Attest repository, research transaction, provider
  reservation/call, cancellation, and lease release. Counters contain no
  request payload or installation identity.
- Only case 5 may reserve or call the provider, with hard ceiling 1. If any
  other case reserves provider work, stop, disable flags, and classify the run
  `provider_boundary_violation`.
- Do not use a public production Overpass service or scrape any outdoor
  platform. No data acquisition occurs in this protocol.
- After every negative case, prove the service is still fail-closed and that no
  stale session, lease, flag, or transient proof file remains.

### Safe common receipt fields

Each case receipt includes the common receipt fields defined in `README.md`
plus: `caseId`, `preconditionDigest`, `expectedTypedState`,
`observedTypedState`, `registrationVerified`, `assertionVerified`,
`counterAdvanced`, `authorizationCount`, `researchTransactionCount`,
`providerReservationCount`, `providerCallCount`, `leaseReleased`,
`cleanupComplete`, and `casePassed`. Security values are booleans or aggregate
counts only.

Every case receipt prohibits raw prompts, request/response bodies, precise
coordinates, geometry, provider/database URLs, headers, credentials, tokens,
key IDs, challenges, nonces, attestation/assertion objects, Apple receipts,
public/private keys, counters, device identifiers, and unbounded errors.

## Proof cases

### 1. Feature disabled: zero downstream work

- **Preconditions:** client research/access flags false; backend research,
  access, evidence, route-provider, and intent-provider flags false; causal
  counters zero.
- **Operator action:** launch the signed proof build and run only its
  research-gate evaluation. Do not submit a legacy route. Separately invoke the
  disabled planning-endpoint probe through the reviewed harness.
- **Expected safe result:** client selects no research client; server returns
  typed `feature_unavailable` before body parsing; authorization, database, and
  provider counts remain zero.
- **Prohibited output:** any session opening, database query, provider
  reservation, payload echo, or sensitive error.
- **Durable receipt:** common fields plus both client/backend gate states and
  zero-work counters.
- **Failure classification:** `disabled_gate_downstream_work` or
  `disabled_gate_wrong_result`.
- **Provider work:** prohibited, ceiling 0.
- **Cleanup:** confirm all flags remain false and counters are sealed/reset for
  the next isolated case.

### 2. First valid physical-device registration

- **Preconditions:** fresh authorized installation with no stored key
  identifier; durable repository empty for this installation; correct signed
  development environment; provider and research flags false.
- **Operator action:** run the harness registration case once and allow the
  system App Attest API to generate and attest a key.
- **Expected safe result:** one registration challenge is consumed once, the
  certificate/nonce/RP ID/environment/category/build contract validates, and
  one durable registered-key record exists.
- **Prohibited output:** key identifier, attestation object, certificate chain,
  Apple receipt, public key, or installation identity.
- **Durable receipt:** common fields plus `registrationVerified=true`,
  challenge-created/consumed counts, and durable-record count delta.
- **Failure classification:** `registration_unsupported`,
  `registration_verification_rejected`, or `registration_storage_failed`.
- **Provider work:** prohibited, ceiling 0.
- **Cleanup:** keep the registered key only for later cases; delete all
  transient challenge/attestation artifacts and confirm logs contain none.

### 3. Valid challenge and assertion

- **Preconditions:** case 2 passed; registered key and verifier environment
  match; route-session and provider gates false except the App Attest endpoint.
- **Operator action:** request one route-session challenge, generate an
  assertion over the canonical client data, and submit it once.
- **Expected safe result:** challenge consumed once, signature and RP metadata
  valid, counter atomically advances, and one opaque session is created with
  only its hash stored.
- **Prohibited output:** challenge, nonce, assertion, counter values, token, key
  material, or raw verification failure.
- **Durable receipt:** common fields plus `assertionVerified=true`,
  `counterAdvanced=true`, and session-created count.
- **Failure classification:** `assertion_generation_failed`,
  `assertion_verification_rejected`, or `session_storage_failed`.
- **Provider work:** prohibited, ceiling 0.
- **Cleanup:** discard the returned token after the dedicated authorization
  cases or revoke/expire it; retain no token in the receipt.

### 4. Authorized route-session creation

- **Preconditions:** case 3 passed or a fresh valid assertion is available;
  fixed session maximum cost equals or exceeds the planning cost; provider
  remains disabled.
- **Operator action:** ask the iOS `RouteSessionService` for one authorization
  without sending a planning body.
- **Expected safe result:** one valid session is cached in memory, one unique
  request ID is issued, and local remaining cost decreases consistently; no
  route or research work occurs.
- **Prohibited output:** session token, request ID, remaining raw budget tied to
  an installation, or authorization header.
- **Durable receipt:** common fields plus authorization count, fixed cost, and
  `sessionBudgetConsistent=true`.
- **Failure classification:** `route_session_authorization_failed` or
  `route_session_budget_inconsistent`.
- **Provider work:** prohibited, ceiling 0.
- **Cleanup:** invalidate the test authorization/session before case 5 so the
  successful planning case obtains a fresh bounded session.

### 5. One successful bounded planning request

- **Preconditions:** cases 1–4 passed; database/import/projection preflight
  passed; explicit one-call authorization active; backend research gate enabled
  before the client research gate; access remains off unless separately
  reviewed for this proof; all insecure flags false.
- **Operator action:** submit the canonical non-sensitive proof fixture through
  the signed app and wait for one strictly validated planning result.
- **Expected safe result:** one assertion-backed session authorizes fixed cost
  12; one repeatable-read read-only research transaction occurs; at most one
  provider call returns validated geometry or the case fails; the iOS result is
  strict and truthfully partial/routed without safety claims.
- **Prohibited output:** raw prompt, coordinates, geometry, provider URL/body,
  authorization values, database details, or claims that App Attest proves
  route quality.
- **Durable receipt:** common fields plus coarse region, activity/route type,
  result state, freshness class, provider call count 1, route-result count,
  bounded quality state, and cleanup booleans.
- **Failure classification:** `planning_authorization_failed`,
  `research_failed`, `provider_failed`, `contract_rejected`, or
  `provider_ceiling_exceeded`.
- **Provider work:** allowed, hard ceiling 1; no retry unless a new proof is
  separately authorized.
- **Cleanup:** immediately set client proof target false, backend research and
  route-provider flags false, release the lease, revoke/expire session state,
  remove provider secret exposure from the proof process, and reconcile
  `1 authorized = attempted + unused`.

### 6. Assertion replay rejection

- **Preconditions:** a valid assertion was accepted once; provider and research
  flags false; replay material remains only in volatile harness memory.
- **Operator action:** resubmit the same accepted assertion/session challenge
  once through the harness.
- **Expected safe result:** challenge reuse or non-increasing counter is rejected
  with a typed safe error; no new session is created.
- **Prohibited output:** replayed material, stored counter, verification detail,
  or provider work.
- **Durable receipt:** common fields plus replay-rejected boolean and zero new
  session/provider counts.
- **Failure classification:** `assertion_replay_accepted` or
  `assertion_replay_wrong_error`.
- **Provider work:** prohibited, ceiling 0.
- **Cleanup:** destroy volatile replay material and confirm no durable copy.

### 7. Wrong challenge rejection

- **Preconditions:** two fresh route-session challenges exist; provider and
  research flags false.
- **Operator action:** generate an assertion bound to challenge A and submit it
  with challenge B through the proof harness.
- **Expected safe result:** verification fails closed; the submitted challenge
  is consumed according to repository policy; no session is issued.
- **Prohibited output:** either challenge, assertion, nonce, or cryptographic
  mismatch detail.
- **Durable receipt:** common fields plus `challengeBindingRejected=true` and
  zero session/provider deltas.
- **Failure classification:** `wrong_challenge_accepted` or
  `wrong_challenge_leaked_detail`.
- **Provider work:** prohibited, ceiling 0.
- **Cleanup:** expire/consume both challenges and clear volatile material.

### 8. Wrong application or environment rejection

- **Preconditions:** isolated verifier configured for one reviewed App ID and
  environment; a separately authorized signed test build or isolated verifier
  mismatch is available; no production user traffic shares this environment.
- **Operator action:** submit a genuine attestation/assertion from the mismatched
  application or environment to the isolated staging verifier.
- **Expected safe result:** RP ID or AAGUID/environment mismatch is rejected;
  no key/session is registered and no fallback activates.
- **Prohibited output:** App ID prefix, team identifier, key material, AAGUID
  bytes, or private provisioning information.
- **Durable receipt:** common fields plus mismatch kind from a small allowlist
  and zero durable-key/session/provider deltas.
- **Failure classification:** `application_mismatch_accepted`,
  `environment_mismatch_accepted`, or `mismatch_fallback_enabled`.
- **Provider work:** prohibited, ceiling 0.
- **Cleanup:** remove the mismatch build from the device, restore the reviewed
  verifier configuration, and prove the ordinary flags remain false.

### 9. Expired challenge and session rejection

- **Preconditions:** isolated staging TTLs within repository-supported bounds;
  one unused challenge and one valid session; provider/research flags false.
- **Operator action:** wait beyond server expiry plus clock-skew margin, then
  submit the challenge and attempt session authorization once each.
- **Expected safe result:** typed challenge-expired and session-expired results;
  no counter advance, budget debit, research transaction, or provider work.
- **Prohibited output:** timestamps tied to key/session identity, raw token, or
  database state.
- **Durable receipt:** common fields plus expiry-type outcomes and zero
  downstream counts.
- **Failure classification:** `expired_challenge_accepted`,
  `expired_session_accepted`, or `expiry_wrong_debit`.
- **Provider work:** prohibited, ceiling 0.
- **Cleanup:** let pruning policy remove expired records after its grace period;
  do not manually delete audit evidence.

### 10. Malformed assertion rejection

- **Preconditions:** one fresh challenge; proof harness can alter one transient
  assertion byte or replace it with bounded invalid CBOR; provider/research
  flags false.
- **Operator action:** submit exactly one malformed assertion.
- **Expected safe result:** bounded typed verification failure; no parser detail,
  key update, session, or fallback.
- **Prohibited output:** malformed bytes, CBOR/ASN.1 stack detail, certificate
  material, or unbounded exception text.
- **Durable receipt:** common fields plus `malformedAssertionRejected=true` and
  zero session/provider deltas.
- **Failure classification:** `malformed_assertion_accepted` or
  `malformed_assertion_detail_leak`.
- **Provider work:** prohibited, ceiling 0.
- **Cleanup:** clear malformed material and seal the safe error receipt.

### 11. Cancellation and client disconnect

- **Preconditions:** fresh valid session; backend research enabled only for the
  case; provider gate false; causal cancellation instrumentation active; a
  separate cancellation connection is healthy.
- **Operator action:** start the bounded planning fixture, wait for the
  instrumented research transaction to begin, then cancel from the iPhone and
  close the client request.
- **Expected safe result:** abort propagates; active PostgreSQL query is
  cancelled when possible, product transaction rolls back, lease releases,
  client ignores late completion, and provider count stays zero.
- **Prohibited output:** query text/values, process ID, prompt, coordinates,
  transport details, or partial response.
- **Durable receipt:** common fields plus transaction-began, cancellation-
  accepted, rollback-complete, lease-released booleans, and provider count 0.
- **Failure classification:** `cancellation_not_propagated`,
  `cancellation_lease_leak`, `cancellation_provider_work`, or
  `late_result_accepted`.
- **Provider work:** prohibited, ceiling 0.
- **Cleanup:** set research false, verify both pools return to expected idle
  state, and expire the session.

### 12. Rate-limit enforcement

- **Preconditions:** provider/research flags false; one bounded session or
  challenge-rate window; reviewed low proof-only limit; no shared beta traffic.
- **Operator action:** exceed exactly one reviewed challenge/session/request-ID
  budget serially. Prefer request-ID replay or session exhaustion so rejection
  occurs before provider reservation.
- **Expected safe result:** typed rate-limit/replay/exhaustion response with a
  bounded `Retry-After` when applicable; no double debit and no provider work.
- **Prohibited output:** installation identifier, token hash, rate-window key,
  request ID, or exact per-installation history.
- **Durable receipt:** common fields plus limit class, attempt count,
  accepted/rejected aggregate counts, retry bucket, and zero provider count.
- **Failure classification:** `rate_limit_not_enforced`,
  `rate_limit_double_debit`, or `rate_limit_provider_work`.
- **Provider work:** prohibited, ceiling 0.
- **Cleanup:** wait for/reset only the isolated proof window through normal
  expiry; do not edit durable counters to manufacture a pass.

### 13. Feature disabled again after proof

- **Preconditions:** all earlier executed cases sealed; provider reconciliation
  complete; staging operator has stop authority.
- **Operator action:** set backend access/research/evidence/route-provider flags
  false, verify deployment health, then confirm the next client gate evaluation
  and disabled endpoint probe perform zero downstream work.
- **Expected safe result:** typed unavailable/no-op behavior and zero new
  authorization, database, or provider counts.
- **Prohibited output:** stale success, automatic insecure fallback, or provider
  reservation after disablement.
- **Durable receipt:** common fields plus final flag-state digest, counter
  deltas, and `proofFlagsDisabled=true`.
- **Failure classification:** `proof_flags_remained_enabled` or
  `post_disable_downstream_work`.
- **Provider work:** prohibited, ceiling 0.
- **Cleanup:** keep all proof flags false; client build-time flag change is
  queued for the next build if it was enabled in this proof build.

### 14. Durable proof receipt validation

- **Preconditions:** all case receipts are append-only and the receipt verifier
  has the approved schema/signing key version; no live flags are needed.
- **Operator action:** validate schema, unique case IDs, required fields,
  signature/digest chain, provider reconciliation, prohibited-field scan,
  case ordering, and final-disable receipt.
- **Expected safe result:** exactly one immutable aggregate result; missing,
  duplicate, altered, unsigned, sensitive, or unreconciled receipts make the
  whole run failed.
- **Prohibited output:** secret scan matches with their values, raw receipt
  payloads from protected storage, or rewriting an earlier receipt.
- **Durable receipt:** aggregate digest, case counts, pass/fail counts,
  provider authorized/attempted/success/failed/unused counts, verifier version,
  and typed failure reasons.
- **Failure classification:** `receipt_missing`, `receipt_integrity_failed`,
  `receipt_sensitive_field`, or `provider_reconciliation_failed`.
- **Provider work:** prohibited, ceiling 0.
- **Cleanup:** make the receipt store read-only under retention policy and keep
  the run failed until a completely new authorized run is executed.

### 15. Cleanup and credential-containment confirmation

- **Preconditions:** case 13 disabled all flags; case 14 sealed the aggregate;
  cleanup and secret owners present.
- **Operator action:** remove proof-only secret access, transient captures,
  assertion buffers, local receipts, temporary builds, and device proof data;
  verify leases released, pruning scheduled, staging logs clean, and the
  provider credential remained backend-only.
- **Expected safe result:** no active proof process, provider authorization,
  transient sensitive file, or enabled proof flag; durable sanitized receipts
  and required security database records remain intact.
- **Prohibited output:** credential inspection, hashing or copying; deletion of
  historical evidence; counter/session rewrites; broad database cleanup.
- **Durable receipt:** common fields plus resource-count booleans,
  credential-containment attestation, final provider reconciliation, and
  `cleanupComplete=true`.
- **Failure classification:** `cleanup_incomplete`, `credential_exposure`,
  `lease_or_flag_leak`, or `historical_evidence_mutated`.
- **Provider work:** prohibited, ceiling 0.
- **Cleanup:** this is the terminal cleanup. Any failure keeps the proof and
  closed-beta decision NO-GO and triggers the incident runbook.

## Acceptance rule

The physical-device security gate passes only if all 15 cases pass in order,
case 5 uses no more than one authorized provider call, every other case uses
zero, the receipt chain validates, and final flags are false. A development
proof and a TestFlight production-environment proof must each satisfy their
declared subset and may not be merged into a claim neither run independently
proved.
