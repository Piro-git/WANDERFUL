# TrailMind staging prerequisite package v3

Status: **offline candidate; not ready for live admission**

Target name: `TrailMind Outdoor Staging V1`

This package prepares five trust pins without accessing Supabase, a provider
API, a remote database, a credential store, or a deployment surface. It does
not authorize an initialization. The production observer and its existing
tests are outside this package and are not modified.

## What exists

- A fixed PostgreSQL catalog assertion program runs in a repeatable-read,
  read-only transaction with 5-second statement, 1-second lock, and 10-second
  idle-transaction limits. Its one parameter is the validated expected
  manifest; it cannot carry SQL. The result is exactly 18 sorted, unique
  assertion IDs with boolean values. Any false, missing, duplicate, reordered,
  unknown, non-boolean, oversized, or query-error result blocks.
- The expected-manifest compiler reads only allowlisted reviewed files in this
  repository. It verifies their exact SHA-256 values before compiling. The
  reviewed declaration binds the requested historical ledger `001` through
  `008`, required schemas, roles, functions, relations, named constraints,
  required indexes, policies, RLS, ACL checks, PostGIS topology, and the
  independent auditor contract.
- Ed25519 tooling generates candidate key material only in an explicit
  operator-owned directory outside the repository, derives a stable key ID
  from the public SPKI SHA-256, signs canonical receipts, and verifies against
  already reviewed literal pins. A valid signature proves byte integrity and
  possession of the key only. It proves neither truth nor freshness.
- The CA tool reads one explicit regular non-symlink certificate file, checks
  ownership/mode/size, rejects private-key or connection material, parses one
  CA certificate locally, and returns the SHA-256 of the exact `sslrootcert`
  bytes. It never fetches a certificate.
- The auditor lifecycle generator creates deterministic owner-only SQL with no
  password value. The role is direct-login, `NOINHERIT`, non-admin,
  non-bypass-RLS, connection-limited, read-only by default, and receives only
  a non-admin/non-inheriting/settable `pg_read_all_stats` membership, schema
  `USAGE` without table access, and execute permission on one bounded
  `SECURITY DEFINER` ledger reader. That reader returns at most ten migration
  identifiers and no product rows; its owner, search path, public ACL, exact
  identity, and exclusive auditor execute grant are catalog-asserted.
  Revocation removes the helper and commits `NOLOGIN PASSWORD NULL` quarantine
  before the guarded drop phase.
- The independent-session harness uses one primary auditor connection followed
  by two new cleanup connections with distinct application names, PIDs, and
  transactions. It never substitutes two samples on one session.

## Candidate values and absent reviewed values

| Acceptance field | Candidate | Reviewed value |
|---|---|---|
| `artifactContract.key.keyId` | deliberately not generated | absent |
| `artifactContract.key.requiredPinnedPublicKeySpkiSha256` | deliberately not generated | absent |
| `auditorContract.connection.sslrootcertSha256` | requires an explicitly supplied CA file | absent |
| `staticGate.independentCatalogAssertionProgramSha256` | `4986636d8750a024fa5ebece4da1eb02f767c4def1cb7a4ab1d210c778798ec6` | absent |
| `staticGate.independentExpectedManifestSha256` | `8b0c8254578c183e0681e1aec5868bba5c1d72bd7ef01c81ed34ca68aab4cb26` | absent |

These are candidate digests, not approved trust anchors. Recompute them from
the reviewed commit. Never copy values from console output directly into an
admission contract without independent source review and a separate review
receipt.

## Important migration-policy boundary

The v3 declaration intentionally implements the requested ledger `001–008`.
The current isolated Supabase Phase 1 V2 operator in this baseline instead
declares `001–007 + 009 + 010`; migration `009` is mutually exclusive with
historical `008`. This package does not edit or silently reconcile that
separate operator. A future admission must use exactly one independently
reviewed ledger and matching pre/post programs. Any mismatch remains
`not_ready`; no adapter may waive it or generate an expected manifest from the
live database.

## Offline preparation

Run from `backend/` in a clean reviewed checkout:

```text
node scripts/staging-prerequisites-v3/cli.js program-pin
node scripts/staging-prerequisites-v3/cli.js compile-manifest
node scripts/staging-prerequisites-v3/cli.js readiness
node scripts/staging-prerequisites-v3/offline-quality.js
```

The first two commands emit candidate evidence only. `readiness` emits the
machine-readable contract and must currently report `not_ready` with five
missing pins. The committed default is `offline-readiness.default.json`.

### Candidate signing key

Do not generate a real operational private key during ordinary build or test.
For a later authorized candidate ceremony, create a new empty mode-`0700`
directory outside the repository and run:

```text
node scripts/staging-prerequisites-v3/cli.js key-generate \
  --candidate-only acknowledged \
  --output-directory /absolute/operator-owned/mode-0700-directory
```

The private PKCS#8 file is atomically created at mode `0600`, is never printed,
and must be delivered through the separately reviewed protected-descriptor
path. The public SPKI file and candidate pin may be reviewed separately. A
partial public-file failure removes the just-created private file. Existing
files are never overwritten.

### Candidate CA pin

Obtain the CA certificate through a separately authorized provider process.
This package does not fetch it. Place the reviewed certificate in a safe local
file owned by the operator or root and not writable by group or others, then:

```text
node scripts/staging-prerequisites-v3/cli.js ca-pin \
  --ca-file /absolute/path/to/reviewed-ca-certificate.pem
```

The `sslrootcertSha256` candidate is the digest of the exact file bytes used by
the future connection. Reformatting or replacing the file changes the pin and
blocks. A missing pin, changed pin, multiple-certificate input, symlink, unsafe
owner/mode, parse failure, or non-CA certificate blocks.

### Candidate auditor SQL

Create a new empty mode-`0700` output directory. Generate short-lived SQL with
an injected canonical UTC expiry between 1 and 120 minutes from generation:

```text
node scripts/staging-prerequisites-v3/cli.js auditor-provisioning-sql \
  --valid-until 2026-08-30T18:00:00.000Z \
  --output-file /absolute/operator-owned/auditor-provision.sql

node scripts/staging-prerequisites-v3/cli.js auditor-revocation-sql \
  --output-file /absolute/operator-owned/auditor-revoke.sql
```

The example timestamp is illustrative and will be rejected outside its short
window. The provisioning SQL must run in a database-owner session distinct
from the mutation and auditor sessions. Set the password only with PostgreSQL
17 interactive `psql` `\password`; never put it in SQL, argv, environment,
JSON, logs, or receipts. If effective `TEMPORARY` remains via `PUBLIC`,
provisioning fails and a separately reviewed owner change is required.
The generated SQL also creates the fixed bounded migration-ledger reader under
`trailmind_app_owner`; any pre-existing helper identity, missing owner role,
missing ledger, ownership mismatch, or inability to create it makes the
transaction fail closed. The auditor still has no direct `SELECT` on the
ledger or any product relation.

## Independent review and pin approval

1. Review the implementation, declarations, exact migration/source hashes,
   catalog queries, bounds, and negative tests at one immutable commit/tree.
2. Recompute the two static candidate digests twice and compare identical
   output. Review the compiled manifest; do not use a live catalog to construct
   it.
3. In a later authorized ceremony, review the public SPKI and CA file through
   independent channels. Confirm the key ID is derived from the reviewed SPKI
   digest.
4. Create one immutable review receipt per pin. A review receipt contains only
   `pinPath`, a safe `reviewId`, and the SHA-256 of the independent review
   evidence. It contains no key, certificate bytes, credential, or provider
   response.
5. In a new reviewed commit, replace the null values in
   `reviewed-pins-v1.json` and add all five ordered review receipts. Never
   populate a pin from runtime discovery or trust-on-first-use.
6. Rerun readiness. `offline_prerequisites_ready` means only that this offline
   package and all review receipts agree. It is not live approval.

## Future live admission

A new task with explicit live authority must perform these steps. This package
does none of them.

1. Reconfirm immutable Git commit/tree, target project name and identity,
   protected-project isolation, exact ledger choice, reviewed program/manifest
   pins, key pin, and CA pin before credential intake.
2. Provision/rotate the auditor through a separate owner connection and set a
   short expiry. Prove exact role attributes, memberships, ownership count,
   database/schema/table/sequence/routine privileges, and read-only defaults.
3. Use the reviewed production observer’s fixed direct endpoint with libpq 17,
   `sslmode=verify-full`, reviewed `sslrootcert`,
   `require_auth=scram-sha-256`, `channel_binding=require`,
   `gssencmode=disable`, and a 10-second connect timeout. No pooler or TLS/auth
   downgrade is allowed.
4. Run the static program after commit through the independent auditor. Compare
   its canonical result with the reviewed expected manifest. Unknown or false
   assertions block.
5. Sign a strict receipt binding schema version, run ID, candidate commit/tree,
   program digest, manifest digest, auditor role/application/PID/session digest,
   result digest, and canonical observation time. Verify before interpreting.
6. Disconnect mutation and primary-auditor sessions. Use two new auditor
   connections and fresh read-only transactions to prove two zero-row cleanup
   observations separated by a bounded monotonic interval.
7. Durably write the cleanup receipt, then use a separate owner session to run
   revocation. If ownership, membership, grant, or drop checks fail, retain the
   already committed `NOLOGIN PASSWORD NULL` quarantine and escalate to manual
   review. Never `REASSIGN OWNED` or `DROP OWNED` to hide evidence.

## Rotation and mismatch behavior

- Key rotation always creates a new key ID/SPKI pin, review evidence, and
  reviewed commit. There is no previous-key fallback or unreviewed key ring.
- CA rotation always creates a new exact-file pin and reviewed commit. A changed
  file blocks before connection.
- Program or declaration changes always create new candidate static digests.
  A mismatch with reviewed pins blocks.
- Missing tools, PostGIS, PostgreSQL major/version behavior, source files,
  credentials, pins, review receipts, or independent sessions produces typed
  `blocked`/`not_ready`, never a pass.

## What this package cannot prove

Offline signatures and catalog assertions do not establish live Supabase
identity, network/TLS behavior, provider isolation, billing, backups, PITR,
production workload safety, or future schema behavior. Exact invoice/usage is
an external limitation. Advisor responses still lack a causal freshness
binding to the DDL, so signatures or static assertions do not establish causal
Advisor freshness. These limitations remain false in every readiness receipt.
