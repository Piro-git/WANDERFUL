# TrailMind staging prerequisite package v3

Status: **offline candidate; not ready for live admission**

Target name: `TrailMind Outdoor Staging V1`

This integrated package prepares five trust pins without accessing Supabase, a
provider API, a remote database, a credential store, or a deployment surface.
The no-argument observer remains blocked. An explicit evidence adapter can
admit only one empty, internal, feature-disabled staging initialization after
all reviewed pins, source-bound digests, CA, signature, Git/run bindings, and
three-session cleanup proof validate. It never admits production and never
registers a production factory.

## What exists

- A fixed PostgreSQL catalog assertion program runs in a repeatable-read,
  read-only transaction with 5-second statement, 1-second lock, and 10-second
  idle-transaction limits. Its one parameter is the validated expected
  manifest; it cannot carry SQL. The result is exactly 18 sorted, unique
  assertion IDs with boolean values. Any false, missing, duplicate, reordered,
  unknown, non-boolean, oversized, or query-error result blocks.
- The expected-manifest compiler reads only allowlisted reviewed files in this
  repository. It verifies their exact SHA-256 values before compiling. The
  reviewed declaration binds the fixed target to the exact
  `supabase_phase1_v2` ledger (`001`–`007`, `009`, `010`), required schemas,
  roles, functions, relations, named constraints, required indexes, policies,
  RLS, ACL checks, PostGIS topology, and the independent auditor contract.
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
  transactions. Its receipt retains all three public session identities and
  binds two zero-leak observations plus the bounded monotonic separation. It
  never substitutes two samples on one session.
- The observer evidence adapter consumes only an explicit reviewed-pins
  contract, the repository-compiled target/profile manifest and catalog
  program, an exact CA file, an Ed25519 envelope verified against the reviewed
  public-key pin, a least-privilege auditor/session proof, immutable Git
  commit/tree/run bindings, disabled flags, and restricted observations. It
  requires an injected replay store and fails closed on any unknown field or
  mismatch. A signature proves authenticity and integrity only; freshness is
  separately bounded by the signed canonical observation time and truth still
  depends on the independently reviewed assertion process.

## Candidate values and absent reviewed values

| Acceptance field | Candidate | Reviewed value |
|---|---|---|
| `artifactContract.key.keyId` | deliberately not generated | absent |
| `artifactContract.key.requiredPinnedPublicKeySpkiSha256` | deliberately not generated | absent |
| `auditorContract.connection.sslrootcertSha256` | requires an explicitly supplied CA file | absent |
| `staticGate.independentCatalogAssertionProgramSha256` | `1b2f1ad373b5fb2ef58b4b21fccf602d64360f6a99b7c79a4abd88c6d399b889` | absent |
| `staticGate.independentExpectedManifestSha256` | `2a6a8e9f1caff83ef3fcb24d4f1373397732ed67ba899a38d4e4910ced7f6a00` | absent |

These are candidate digests, not approved trust anchors. Recompute them from
the reviewed commit. Never copy values from console output directly into an
admission contract without independent source review and a separate review
receipt.

The integrated dormant observer source manifest currently has candidate source
digest `6ae3179cdf9f7c18bb751274a6d35158e52367d7b39da4585e94d9d74d88b840`
and package digest
`e5200338957937c0cf404d18ab265c23e66961d3a3a70785460e558a4662df79`.
They cover the observer and admission-critical prerequisite sources but remain
candidate values; the production package stays unregistered.

## Migration-profile boundary

The package has two explicit schema-versioned profiles:

- `generic_postgres_v1` is exactly migrations `001`–`008` and declares only
  `generic_postgresql_only` compatibility. It cannot be selected for
  `TrailMind Outdoor Staging V1`.
- `supabase_phase1_v2` is exactly migrations `001`–`007`, `009`, and `010` and
  is the only profile accepted for `TrailMind Outdoor Staging V1`.

Migration `008` and either `009` or `010` in one ledger are a typed runtime
boundary conflict. Mixing, omission, addition, reorder, duplicate, path drift,
hash drift, schema-version drift, or fixed-target/profile mismatch blocks.
The expected manifest is compiled only from the reviewed Supabase profile and
matching V2 pre/post programs; it is never synthesized from a live catalog.

## Current Supabase platform boundaries reviewed for this candidate

- Supabase now ignores explicit extension-version clauses and installs the
  project default extension version. The selected migrations do not rely on a
  requested extension version; later live review must observe the installed
  version rather than treating a version clause as a pin.
- New-project Data API exposure is becoming opt-in. This package relies on
  exact catalog ACL/RLS assertions and private schemas, never on automatic
  `anon`, `authenticated`, or `service_role` grants.
- Any future database connection must enforce TLS and verify the reviewed CA
  and host (`sslmode=verify-full`). A TLS handshake or signature cannot replace
  exact CA-pin and least-privilege role checks.
- Temporary token-based database access remains a feature preview, is disabled
  by default, requires SSL enforcement and role mapping, and is not operational
  proof for this candidate. No admission path depends on it.
- Production remains blocked on exact billing/usage, provider-enforced sibling
  project isolation, causal Advisor freshness, and an independently reviewed
  launcher/factory seam. Free/nano observations, no selected add-ons, response
  shape, and signatures never satisfy those gates.

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
4. Create one immutable review receipt per pin. Each receipt binds an exact
   `artifact.pinPath` and `artifact.pinValue`, a safe `reviewId`, and a distinct
   `reviewer.reviewerId`. The reviewer identity digest is recomputed from that
   identity, and `reviewSha256` is recomputed from the complete unsigned receipt.
   All five artifact paths, review IDs, reviewer identities, reviewer digests,
   and receipt digests must be distinct and ordered by pin path. Receipts contain
   no key, certificate bytes, credential, or provider response.
5. In a new reviewed commit, replace the null values in
   `reviewed-pins-v1.json` and add all five ordered review receipts. Never
   populate a pin from runtime discovery or trust-on-first-use.
6. Rerun readiness. `offline_prerequisites_ready` means only that this offline
   package and all review receipts agree. It is not live approval and does not
   populate the five committed null defaults automatically.

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
   target/profile, exact CA digest, program digest, manifest digest, auditor
   role/application/PID/session digest, catalog result, complete evidence-bundle
   digest, and canonical observation time. Verify before interpreting.
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
The committed product, provider, insecure-transport, migration-execution, and
production-admission flags remain disabled in every staging-admissible bundle.
