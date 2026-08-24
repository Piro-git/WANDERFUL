# Staging Readiness V1 Proof Contract

## Decision scope

`GO` means only that the selected staging infrastructure candidate has passed
the V1 database, runtime, containment, privacy and cleanup gates and is ready
to enter the separate physical App Attest protocol. It does not prove route
quality, a physical device, TestFlight, production, closed-beta approval, or
Attempt 13 authorization.

`NO_GO` is mandatory when evidence is missing, stale, malformed, duplicated,
reordered, skipped, zero-case, unsigned, unauthenticated, not candidate-bound,
or inconsistent. A blocked or not-run mandatory gate is not a pass.

This repository package is deliberately offline-only and has no exit-zero
path. Its validator performs the complete live-shape, cross-binding, digest and
signature checks for adversarial coverage and then rejects `live_staging` with
`live_execution_not_admitted`. A future live driver requires an explicit,
separately reviewed admission change after all external prerequisites exist.

## Canonical manifest

The authoritative executable schema is
`backend/evaluation/stagingReadinessV1/contract.js` plus its versioned constants
and nested validators. The semantic policy digest binds the executable contract,
closed-beta checklist, feature matrix, provisioning/rollback/monitoring/V4
contracts, App Store blockers, regional definitions, runtime read boundary,
reviewed performance policy and migrations 001–008.

The receipt contains exact top-level sections for:

- version, evidence mode, proof clock and owner-approved clock age;
- policy/source manifest digests;
- baseline/candidate Git commits, tree/index digests and clean-state attestation;
- candidate cross-binding;
- environment/runtime/database observations;
- migration ledger and true second-run no-op;
- nine canonical roles in exact order, role/grant/RLS/Data API digests, the
  five-function runtime boundary, and a first-class cancellation/control role;
- Harz and Innsbruck import/projection lineages, freshness, rows and isolation;
- GiST plan, latency, cancellation/rollback and pool recovery;
- backup/restore identity and five reconciliation classes;
- HTTPS, liveness, readiness, preflight, non-root runtime, drain, restart and
  rollback;
- monitoring/alerts and dependency-outage failure drills;
- the exact 13-flag matrix and three-phase zero provider ledger;
- privacy scan, cleanup and residual resources;
- ordered cases, ordered gates, P1/P2 findings and consistent totals;
- semantic SHA-256 and external observer authenticity.

Every object rejects unknown fields. Arrays are bounded and canonical arrays
reject omission, duplicates and reordering. Strings, nesting and total output
are bounded. Canonical serialization sorts object keys but preserves array
order. Identical modeled run identity produces byte-identical bytes and the
same semantic digest.

The cancellation/control role is not represented by a detached digest. Its
stable role ID, purpose, identity digest, exact privilege-manifest digest,
role-evidence digest and managed-identity separation guards are inside the
ordered role observation and the overall candidate binding. The least-
privilege gate and cancellation-performance gate each contain a mandatory
cancellation boundary case. A safe application runtime role cannot compensate
for missing or unsafe cancellation evidence.

## Authenticity and anti-collusion boundary

Live evidence must be captured by this verification lane, not imported as a
database/runtime-owner conclusion. Its final semantic digest is signed with an
independent observer key and verified against a separately pinned public-key
digest. The key is never embedded as authority in the receipt. Database/runtime
owners may supply immutable candidate identifiers and safe platform evidence,
but cannot self-promote their own summaries to a V1 `GO`.

Signature validation does not excuse weak capture. The future live driver must
repeat the selected origin, image, deployment and database observations before
and after the proof, bind all case evidence to the same digest, and stop on any
change. The owner-decided maximum receipt age also bounds the total preflight to
postflight observation window, and every live timestamp must fall inside it.
If a platform cannot expose a safe immutable identity or perform a
required read-only/failure-drill observation, the gate remains blocked.

## Privacy contract

Receipts reject raw HTTP(S) origins, PostgreSQL strings, credentials,
authorization material, prompts, precise coordinates, geometry, App Attest
assertions/attestations, private keys, raw request/response bodies and
secret-bearing error messages. Errors are typed bounded codes only. The live
privacy scan must cover every retained artifact and report zero forbidden
matches; it never reports the rejected value.

Private staging and production identities are stored only as independently
derived stable digests. The proof does not connect to production to learn them.
Production digests must come from an approved non-secret guard manifest and
must be disjoint from all staging identity digests.

## Receipt publication

Publication is exclusive and atomic. It writes a new same-filesystem temporary
file with mode `0600`, fsyncs it, links it to the final new path, fsyncs the
directory where supported, and removes the temporary file. Existing output,
partial write, cleanup failure or post-cleanup publication failure cannot yield
a cleanup-success receipt or exit zero.

Historical V4 Markdown and JSON receipts are enumerated from the immutable
baseline and compared byte-for-byte with the candidate and clean worktree.
Attempts 6–9 are not invented. Any Attempt 13 artifact is rejected.
