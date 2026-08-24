# Staging Readiness Proof V1

Status: **OFFLINE HARNESS COMPLETE; REAL STAGING EXECUTION BLOCKED; NO-GO**

This package independently validates whether one exact TrailMind staging Git,
runtime, deployment, Supabase, and database candidate is ready for a separately
authorized physical App Attest proof. It does not deploy a runtime, create or
modify a database, run migrations, import data, call GraphHopper, call an AI
provider, authorize Attempt 13, or make a closed-beta/public-release decision.

The current package intentionally has no live driver. `--execute-live` fails
closed until the database and runtime lanes are terminal, immutable candidates
and non-production identity digests are supplied, the user authorizes read-only
verification and any explicit failure drills, every controlled staging flag is
independently observed false, and proof access is provided outside chat. A file
containing asserted live results is not an admitted substitute for independent
observation.

## Direct bounded command

Run only from a clean committed candidate. The output path must be a new path
under `/private/tmp/TrailMindStagingReadinessV1-*`; the writer is exclusive,
fsync-backed where supported, bounded to 512 KiB, and mode `0600`.

```sh
node backend/scripts/run-staging-readiness-v1.js \
  --baseline-commit <full-baseline-commit> \
  --candidate-commit <full-current-head-commit> \
  --proof-as-of <YYYY-MM-DDTHH:mm:ss.sssZ> \
  --output /private/tmp/TrailMindStagingReadinessV1-<run-id>.json
```

The current offline command attests clean Git state, the exact policy/source
digest, migrations 001–008 as source inputs, the tracked provider-off matrix,
and byte-exact preservation of all historical V4 receipts, then writes a
machine-readable `NO_GO` receipt with every unavailable live case explicitly
`blocked` or `not_run`. A truthful `NO_GO` exits `1`; invalid input, timeout,
cancellation, live-execution admission failure, or publication failure exits
`2`. This offline-only V1 has no exit-`0` path. A later authorized live driver
must add a separate admission boundary before any staging `GO` can be emitted.

Do not pass a hostname, project ref, database URL, credential path, credential,
prompt, coordinates, route geometry, App Attest material, or provider material
on the command line. Private environment identities are represented only by
stable SHA-256 digests in a future live receipt.

## False-green boundary

A V1 `GO` requires all 45 canonical cases and all 14 mandatory gates to pass in
their exact order. It additionally requires:

- an exact clean Git candidate and tree;
- one cross-binding over the candidate commit/tree, image, deployment revision,
  HTTPS origin digest, Supabase project digest, database instance digest, and
  region;
- preflight and postflight binding equality to stop a TOCTOU swap;
- production/staging identity sets that do not intersect;
- an Ed25519 receipt signature verified against an independently supplied,
  pinned observer public-key digest;
- zero errors, violations, blockers, provider calls, production mutations,
  secret exposures, or residual resources;
- every staging, provider, research, evidence, access, intent, insecure, mock,
  and in-memory flag independently observed exact false.
- all nine canonical staging roles in exact order, including a distinct
  first-class cancellation/control role whose identity and exact privilege
  manifest are bound into the candidate digest.

Offline/source-only receipts cannot claim a live case passed and can never be
`GO`. This package also rejects every `live_staging` receipt at a final hard
admission stop, even after its structure, binding, digest and signature pass.
An embedded public key is not trusted; the validator requires the pinned
observer key from a separate trust decision. Synthetic fixtures exist only for
adversarial unit tests and are not accepted by the offline command or validator.

## Reviewed thresholds

The harness reuses the reviewed repository policy without weakening it:

- regional source age strictly below 14 days;
- PostGIS 3.2 or later;
- 2,500 ms statement timeout;
- mapped-route membership p95 strictly below 1,500 ms;
- each reviewed access/performance measurement strictly below 2,000 ms;
- exactly five runtime read functions and three cancellation cases.

No reviewed maximum age exists for a backup/restore proof, alert test, or the
whole staging receipt. Those values require a bounded owner-decision digest in
a future live receipt. That same decision bounds the candidate observation
window. Missing owner decisions are not inferred and are NO-GO. The offline
command separately requires its caller-supplied proof clock to be within the
five-minute invocation-skew guard of an independently sampled process clock.

## Verification

Focused tests:

```sh
node --test backend/test/stagingReadinessV1*.test.js
```

The complete required verification and the real-execution prerequisites are in
[`PROOF_CONTRACT_V1.md`](./PROOF_CONTRACT_V1.md) and
[`REAL_EXECUTION_GATE_V1.md`](./REAL_EXECUTION_GATE_V1.md). The machine-readable
case-to-evidence inventory is
[`canonical-evidence-map-v1.json`](./canonical-evidence-map-v1.json).
The independent P1/P2 review and corrected findings are recorded in
[`ADVERSARIAL_AUDIT_V1.md`](./ADVERSARIAL_AUDIT_V1.md).
The cancellation/control purpose, exact privilege manifest, alias guards and
Markdown evidence format are defined in
[`ROLE_CONTRACT_V1.md`](./ROLE_CONTRACT_V1.md).
