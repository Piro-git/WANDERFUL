# Wanderful Physical-Device and Closed-Beta Readiness V1

Status: **NO-GO — operational plan complete; live evidence absent**
Audit date: 2026-08-04
Scope: Harz and Innsbruck, hiking and trail-running loops only

## Outcome

This package turns the current repository contracts into an executable,
fail-closed path to a small closed beta. It does not claim that the path has
been executed. No deployment, signing, device boot, provisioning, migration,
regional import, provider call, feature enablement, or production-system call
was performed while creating it.

The product remains **NO-GO**. In particular:

- no signed physical-iPhone App Attest proof or TestFlight proof exists;
- no approved HTTPS staging deployment with durable PostgreSQL/PostGIS exists;
- the concurrent routable-highlight V2 implementation and migration 007 have
  not yet completed independent review;
- no V4 provider proof exists after access-point integration;
- current Harz and Innsbruck imports from earlier proofs were disposable and
  were removed;
- `ROUTE_PROVIDER_ENABLED` and `INTENT_PROVIDER_ENABLED` currently treat a
  missing or malformed value as enabled, contrary to this plan's required
  exact-value fail-closed policy;
- iOS feature flags are build-time settings, not an immediate remote kill
  switch; emergency control therefore starts at the backend;
- privacy, operational ownership, Apple-team, support, and retention decisions
  remain open.

`go-no-go-checklist-v1.json` is authoritative: GO is possible only when every
mandatory item has verified evidence and an accountable owner.

## Current audited architecture

```text
physical iPhone
  -> DCAppAttestService support check and installation key
  -> one-time registration challenge
  -> attestation object verified by the backend
  -> durable PostgreSQL registered-key record
  -> one-time route-session challenge
  -> assertion over canonical challenge/key/nonce request data
  -> atomic assertion-counter update
  -> opaque route-session token (hash stored server-side)
  -> fixed-cost authorization plus unique request ID
  -> outdoor planning feature and schema gates
  -> repeatable-read, read-only PostGIS research snapshot
  -> bounded provider routing
  -> strict response validation and verified route geometry
```

### iOS contract

- `AppAttestService` stores only the App Attest key identifier in the
  Keychain. Attestation and assertion objects are transient request material.
- A new key is registered through `/api/app-attest/challenge` and
  `/api/app-attest/register`. A registered key obtains a route session through
  a route-session challenge and `/api/app-attest/route-session`.
- Route-session client data is a length-prefixed canonical sequence containing
  a schema label, method, path, server challenge, key identifier, and 32-byte
  session nonce. The assertion signs the SHA-256 digest of that sequence.
- `RouteSessionService` keeps the returned session in memory, accounts for
  local remaining cost, refreshes before expiry, shares concurrent refreshes,
  and invalidates once on an expired/exhausted/invalid response.
- The planning client uses a fixed authorization cost of 12, a unique request
  ID, bounded bodies, and one refresh attempt. It validates either the strict
  V1 or V2 response contract before presentation.
- Release and non-loopback physical-device paths use App Attest. The insecure
  placeholder authorizer exists only in Debug Simulator builds for exact local
  loopback HTTP URLs.
- The Release entitlement declares the App Attest production environment. A
  signed profile/application-identifier match has not been proved.

### Backend contract

- The verifier pins the Apple App Attestation root and validates the
  certificate chain, nonce, RP ID derived from App ID prefix and bundle ID,
  AAGUID environment, key identity, P-256 key, validation category, bundle
  version, assertion signature, and increasing counter.
- The durable repository stores challenges, registered public keys and Apple
  attestation receipts, assertion counters, hashed session tokens, unique
  request IDs, weighted rate windows, and expiring concurrency leases.
  Operational proof receipts must not copy any of that sensitive material.
- Production refuses an in-memory repository. Compare-and-set counters,
  one-time challenge consumption, request replay prevention, cost debiting,
  rate limiting, and lease acquisition are transactional.
- The HTTP handler short-circuits a disabled research-planning endpoint before
  body parsing. The endpoint then checks the V2 access gate, validates the
  request, authorizes the fixed cost, and only afterward resolves PostGIS and
  provider dependencies.
- Research reads run inside `REPEATABLE READ READ ONLY` transactions with a
  local statement timeout. A separate one-connection cancellation pool may
  call `pg_cancel_backend`; the product transaction is rolled back afterward.
- Completion logs currently use typed state/error and bounded metadata. This
  package narrows the allowed beta fields further in the observability policy.

### What App Attest does not prove

App Attest is evidence of application/request integrity. It does not prove user
identity, device location, route safety, route quality, provider correctness,
trail access, legal status, current conditions, or that a selected highlight
is reached. Those claims require separate evidence and remain explicitly
partial or unverified when absent.

## Verified ordering contract

For the research-planning endpoint the required ordering is:

1. backend research gate;
2. V2 access gate when schema V2 is requested;
3. cancellation check and bounded configuration validation;
4. strict request validation;
5. attested route-session authorization and fixed cost/rate/concurrency debit;
6. PostGIS repository and provider dependency resolution;
7. research snapshot and candidate creation;
8. bounded provider scheduling;
9. strict response serialization and iOS validation;
10. lease release and privacy-safe completion event.

Any disabled or invalid upstream gate must produce zero downstream provider
work. The backend gate must be enabled and proved before a corresponding client
gate is distributed. Proof-only flags must return to false after the proof.

## Common receipt contract

Every future physical, database, provider, quality, rollout, or rollback proof
must create a new append-only receipt. A safe receipt may contain:

- receipt schema/protocol version and opaque proof-run ID;
- case or gate ID, UTC start/end time, and typed result;
- non-secret operator role and approval-reference ID;
- environment label, release channel, app version/build, OS major/minor, and
  device model family without serial number or private device identifier;
- reviewed source/deployment/migration/import digests or immutable references;
- feature-contract version and boolean flag-state digest;
- coarse region ID, activity, route type, freshness class, typed error code,
  duration bucket, attempt count, result count, and bounded quality metrics;
- booleans such as registration verified, assertion verified, counter advanced,
  lease released, cleanup complete, and flags disabled;
- provider authorization reference, hard ceiling, reconciled aggregate counts,
  and unused count;
- receipt digest, signer/key version identifier, and previous-receipt digest
  when an append-only chain is used.

It must never contain raw prompts, precise coordinates, route geometry,
provider or database URLs, provider bodies/headers, unbounded errors,
credentials, tokens, key IDs, challenges, attestation or assertion objects,
Apple receipts, public/private key material, authorization headers, private
device identifiers, or temporary paths.

## Operating sequence

1. Merge and independently accept the access-point correction lane and its
   migration; identify a clean reviewed commit.
2. Resolve the exact-value provider-flag blocker and approve owners.
3. Provision isolated HTTPS staging and least-privilege PostgreSQL/PostGIS.
4. Apply reviewed migrations repeatably and import/project current Harz and
   Innsbruck data.
5. Prove index use, latency, freshness, coverage, regional isolation,
   cancellation, and rollback with provider traffic disabled.
6. Execute the one-device App Attest protocol with a single provider-capable
   planning case and immediately return proof flags to false.
7. Obtain a new, explicit 15-call V4 authorization and run only the four
   canonical cases under the serialized circuit-breaker protocol.
8. Review route-quality and presentation results independently from security
   and database results.
9. Rehearse backend/provider/import/deployment rollback.
10. Re-evaluate every mandatory checklist item. Only the named approver may
    authorize a cohort stage.

## Documents

- `PHYSICAL_IPHONE_APP_ATTEST_PROOF_V1.md` — one-device security proof.
- `STAGING_PROVISIONING_RUNBOOK_V1.md` — HTTPS, PostgreSQL/PostGIS, migrations,
  imports, projection, performance, promotion, and rollback.
- `V4_OPERATIONAL_PROTOCOL.md` — bounded post-access-point live proof.
- `OBSERVABILITY_AND_PRIVACY_V1.md` — low-cardinality metrics, retention, and
  alert thresholds.
- `ROLLBACK_AND_INCIDENT_RESPONSE_V1.md` — kill sequence and incident playbooks.
- `CLOSED_BETA_ROLLOUT_V1.md` — narrow cohort stages and expansion criteria.
- `feature-flag-state-matrix-v1.json` — machine-readable state machine.
- `go-no-go-checklist-v1.json` — machine-readable mandatory decision evidence.

## Product-owner decisions still required

- Apple Developer team, App ID ownership, signing identity/profile ownership,
  TestFlight app record, and supported physical-iPhone matrix;
- staging host, database service/region, backups, recovery objectives, and
  network/secret-management owners;
- backend, database, provider credential, regional import, security incident,
  privacy, and on-call owners;
- provider authority, proof call budget, beta traffic budget, rotation cadence,
  and emergency revocation process;
- support contact, privacy-policy location, App Privacy answers, retention and
  deletion periods, and ODbL/attribution legal review;
- closed-beta territories, cohort ceilings, invitation criteria, daily-review
  owner, participant communications, and final GO approver.
