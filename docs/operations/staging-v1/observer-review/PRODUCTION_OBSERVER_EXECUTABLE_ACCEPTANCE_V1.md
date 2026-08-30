# Production Observer Executable Acceptance V1

## Purpose

Reconciliation note: this is the historical red-first contract. The V2 suite
has been rebased to the corrected public/internal validation seams and now
passes 61/61 with no skips. Tests for exact billing, causal Advisor freshness,
provider-enforced scope isolation, missing pins, and unavailable operational
proof pass only by asserting their deterministic typed block. See
`../observer-review-v2/PRODUCTION_OBSERVER_V2_RECONCILIATION.md` for the exact
32-case classification.

This document defines the test-only contract exercised by
`backend/test/stagingPhase1V2ProductionObserverSecurityAcceptance.test.js`.
The suite starts red at candidate
`b59f432a1947154345f1629ecba50d14fcb1e7c8`. It must be integrated with the
production-observer correction before live admission is enabled.

The suite is synthetic and offline. It must not call Supabase, PostgreSQL,
GraphHopper, AI services, deployment APIs, feature-flag services, or any other
network endpoint. Test keys are ephemeral Ed25519 keys generated in-process and
are never production trust anchors.

The independent source review is commit
`4821c9b29e070be53c0c22873cb7af124434b985`. Its required architecture and
failure taxonomy are authoritative where this test contract does not further
constrain a test fixture.

## Reviewed semantic fixture seam

Production internals must remain private. To test the private fixed-function
implementation without injecting a transport, signer, factory, SQL callback, or
credential, the corrected module may expose one deeply frozen object named:

`STAGING_PHASE1_V2_PRODUCTION_OBSERVER_SECURITY_ACCEPTANCE_FIXTURES`

This object is a pure validation surface, not a construction or registration
surface. It must have these methods:

- `validateBillingEvidence(value)`
- `validateAdvisorFreshness(value)`
- `deriveMutatingApplicationIdentity(value)`
- `validateCleanupEvidence(value)`
- `validateArtifactChain(value)`
- `validateDescriptorLifecycle(value)`
- `validateControlTransport(value)`

The methods may only validate or derive immutable values. They must not accept
callbacks, clients, signers, SQL, URLs, runtime expected digests, secrets,
provider payloads larger than the production bounds, or mutable global state.
They must perform no file, network, database, environment, subprocess, or
credential operation. Rejections use
`StagingPhase1V2MachineObserverError` and the stable reviewed failure codes.

The existing exported response, response-metadata, credential-type,
auditor-identity, and cleanup-result validators remain direct reviewed seams.
The production factory itself must not be exported or publicly registrable.

## Why narrow static contracts remain

Candidate `b59f432` exposes no semantic seam for four properties that are
defined by source construction and durable ordering:

1. the package digest and signing-key digest are reviewed literals over a fixed
   source manifest rather than runtime-computed expected values;
2. the production artifact seal uses a pinned Ed25519 signature rather than an
   unkeyed digest;
3. all four phase artifacts are durably persisted before terminal receipt
   publication; and
4. pre-control completes before CA inspection, authorization intake, database
   password intake, or adapter invocation.

The suite therefore uses four bounded source-region checks. Each region is
delimited by stable function or initialization markers and asserts a semantic
property with a short failure message. It does not compare whole files or exact
formatting. These checks should be replaced by a stronger immutable exported
manifest or validation receipt only if the correction provides one without
weakening encapsulation.

## Provider and PostgreSQL basis

Current official documentation was checked on 2026-08-30:

- The Supabase security and performance advisor GET endpoints are documented as
  deprecated/experimental and their response schema does not itself establish
  a recomputation after this run's DDL:
  https://supabase.com/docs/reference/api/v1-get-security-advisors
- The billing addons endpoint is
  `GET /v1/projects/{ref}/billing/addons` and documents the fine-grained
  permission `infra_add_ons_read`:
  https://supabase.com/docs/reference/api/v1-list-project-addons
- PostgreSQL 17 documents `pg_read_all_stats` as the predefined role for full
  statistics visibility and documents `pg_stat_clear_snapshot()` plus
  `stats_fetch_consistency` caching behavior:
  https://www.postgresql.org/docs/17/predefined-roles.html
  https://www.postgresql.org/docs/17/monitoring-stats.html

The tests consequently reject free-plan/nano inference as billing proof,
provider-unmarked advisor freshness, privilege-blind cleanup zeros, and cached
single-sample session observations.

## Positive control

The suite builds a complete four-phase synthetic chain with:

- exact phase and predecessor ordering;
- run, attempt, authorization, Git, project, organization, region, application,
  PID, and `backend_start` bindings;
- an ephemeral in-process Ed25519 key;
- signature verification and mutation detection;
- `O_EXCL`/no-follow/`0600`/file-fsync/directory-fsync ledger evidence; and
- two fresh consecutive zero cleanup samples after confirmed disconnect.

The reference verifier must accept this chain before any production seam is
tested. This prevents a reject-everything suite from appearing secure.

## Execution contract

Run only the new gate:

```sh
cd backend
node --test --test-concurrency=1 --test-reporter=spec \
  test/stagingPhase1V2ProductionObserverSecurityAcceptance.test.js
```

Against the exact candidate, failures are expected and must remain visible.
There must be no skips, todos, zero-test success, retry, fallback, or network
setup. The corrected implementation is acceptable only when every leaf check
is green and the separate existing observer, launcher, admission, adapter, and
single-session integration suites remain green.

## Candidate execution record

Executed offline against `b59f432a1947154345f1629ecba50d14fcb1e7c8`:

| Suite | Configured/executed | Passed | Failed | Skipped/todo |
|---|---:|---:|---:|---:|
| New red-first acceptance | 61 | 29 | 32 | 0/0 |
| Existing machine observer | 11 | 11 | 0 | 0/0 |
| Existing live launcher | 11 | 11 | 0 | 0/0 |
| Existing admission | 7 | 7 | 0 | 0/0 |
| Existing single-session adapter | 14 | 14 | 0 | 0/0 |

This table is preserved as the original execution record. The correction moved
the result to 35/61, and the reconciled V2 suite subsequently reached 61/61.
The existing observer/launcher/admission/adapter checks remain required; green
typed blocks do not constitute operational proof or factory admission.
