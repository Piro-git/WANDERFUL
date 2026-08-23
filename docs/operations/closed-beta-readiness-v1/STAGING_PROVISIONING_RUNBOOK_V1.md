# Staging Provisioning and Regional Data Runbook V1

Status: **PLAN ONLY — NO STAGING, POSTGIS, BACKUP, OR DEPLOYMENT ACTION EXECUTED**

Current source boundary: `76f6552a1cd525a38a3840a0204cd81aede94406`.
Local tests prove the standalone admission/lifecycle seams only. Every command
below requires separate operator authorization and an isolated non-production
target.

## Minimal topology

```text
authorized development build or TestFlight
  -> public HTTPS ingress
  -> TrailMind backend
       -> App Attest verifier
       -> durable route-session authorization/rate/concurrency control
       -> outdoor orchestration
       -> read-only research transaction
  -> private PostgreSQL/PostGIS
  -> bounded GraphHopper egress owned by the backend
```

The currently admitted source design is the long-lived standalone entry point
`backend/src/operations/start.js`. Hosting remains a product-owner decision.
The bare `backend/api/index.js` serverless adapter does not execute production
preflight, explicit pool composition, cached dependency readiness, or the
signal-driven drain contract and is not admitted for closed beta until an
equivalent platform lifecycle is independently proved. The selected platform
must support HTTPS, private secret injection, bounded outbound egress,
deployment digests, atomic environment updates, fast rollback, health checks,
and a PostgreSQL connection model compatible with transactions and
cancellation.

## Trust and environment boundaries

- Development, staging, closed beta, and production use separate credentials,
  databases, App Attest environment contracts, logs, receipt stores, feature
  states, and provider budgets.
- The iPhone knows only the HTTPS backend endpoint. It never receives a
  provider credential or database connection value.
- Database connections are private to backend/migration/import jobs. No Data
  API or public role may read App Attest, evidence, projection, or proof data.
- The product connection and one-connection cancellation pool are distinct.
  The cancellation connection may only cancel the product role's active
  backend and must not be reused for product queries.
- Provider egress is available only to the backend provider adapter. It is
  disabled during infrastructure, migration, import, projection, and database
  performance verification.
- Public production Overpass is not a dependency. Regional import consumes an
  operator-supplied, bounded local PBF with reviewed provenance.
- Durable proof receipts are stored separately from application logs and from
  the App Attest security tables. They are append-only and sanitized.

## Least-privilege roles

The exact role names may follow the selected platform, but the privileges may
not be combined for convenience.

| Role | Required privileges | Prohibited privileges | Owner |
| --- | --- | --- | --- |
| Platform provisioner | Create database, roles, private network, backup policy, and PostGIS extension | Routine application traffic | Infrastructure owner |
| Migration role | Own schema objects; apply reviewed migrations and migration ledger under advisory lock | Provider credentials; app requests | Database release owner |
| Regional import role | Read approved local PBF; create/drop its unique staging schema; insert immutable import/evidence rows; atomically promote one region | App Attest tables; provider access; broad deletion | Regional-data owner |
| Projection role | Configure only reviewed source policy and project a selected active import into the Evidence Graph | App Attest data; provider access; arbitrary sources | Research-data owner |
| App-security runtime role | App Attest transactional reads/writes; acquire/release leases | Research/evidence tables, DDL, role creation, imports, projection policy changes | Backend security owner |
| Outdoor-research runtime role | Execute only the five bounded outdoor-research read operations | Base tables, active views, App Attest data, DDL, writes, role creation, import/projection policy changes | Backend owner |
| Pruner role | Execute the bounded App Attest expiry job or its minimum DELETE set | Evidence/import deletion, DDL, provider access | Security operations owner |
| Read-only auditor | Read migration/import/projection status, aggregate counts, index metadata, and sanitized receipts | Raw security material, prompts, geometry exports, credentials | Release approver |

RLS is enabled on backend-owned tables. Before use, prove each role's grants and
RLS behavior with denied-access checks. Do not assume that a managed platform's
default owner or Data API roles satisfy this separation.

## HTTPS staging provisioning order

1. Approve the environment owner, region, data residency, backup/restore target,
   retention, incident contact, and deletion process.
2. Create an isolated staging project/account and private PostgreSQL network.
3. Provision TLS and an HTTPS hostname. Record only a deployment/endpoint
   digest in receipts; do not persist the endpoint value in proof artifacts.
4. Create the roles above and store their connection values in the platform
   secret manager. Never put them in documents, command history, source, or
   proof receipts.
5. Inject the reviewed presence-only configuration and run `npm run
   ops:preflight`. Require decision `ready` without retaining environment
   values. Then start the reviewed standalone artifact with every ordinary,
   provider, insecure/local, in-memory, and deterministic-mock flag exact
   `false`; `NODE_ENV` is exact `production` and the release stage is explicit.
   Review `ROUTE_PROVIDER_MAX_RESPONSE_BYTES`,
   `ROUTE_PROVIDER_MAX_ERROR_RESPONSE_BYTES`,
   `ROUTE_PROVIDER_CIRCUIT_FAILURE_THRESHOLD`, and
   `ROUTE_PROVIDER_CIRCUIT_OPEN_MS` as non-secret bounded values. The error
   ceiling must be smaller than the success ceiling, and preflight must reject
   a configured provider-response concurrency budget above its fixed 64 MiB
   admission cap. Do not infer provider approval from preflight success.
6. Confirm `GET /health/live` stays dependency-free and `GET /health/ready`
   exposes only `ready`/`not_ready`. Exercise a controlled provider outage only
   after separate authorization: circuit-open readiness is `not_ready`, open
   requests perform no egress, one half-open probe is admitted, and recovery
   returns readiness to `ready`. Do not expose preflight, circuit detail, or
   pruning as an HTTP endpoint.
7. Verify that missing App Attest/database/provider configuration fails closed.
8. Apply database and regional-data steps below with provider traffic disabled.
9. Configure App Attest verifier values, bounded authorization values, and
   allowed build metadata through the secret/configuration service.
10. Run the physical-device protocol only after database and rollback gates
    pass. Enable backend gates before distributing a corresponding client gate.

## Database and regional-data sequence

The commands shown are future operator commands. They were not run by this
task. Environment values must be injected outside the command line.

### Action-to-rollback invariant

No numbered action may start unless its rollback owner and verification are
recorded. A failed rollback keeps all research, access, evidence, and provider
gates false.

| Step | Abort/rollback | Verification after rollback |
| --- | --- | --- |
| 1. Provision databases | Destroy only the newly identified disposable instance; for staging, restore the approved empty snapshot or keep it isolated | Environment guard and instance digest still identify no production target |
| 2. Create roles | Revoke the new grants/credentials through audited role management | Denied-access checks pass and no session remains |
| 3. Apply migrations | Let the migration transaction roll back; otherwise restore/recreate the pre-migration instance | Ledger and schema match the approved pre-step digest |
| 4. Prove repeatability | Discard/recreate the disposable database; do not edit the ledger | A fresh reviewed migration run starts from an empty database |
| 5. Import Harz | Importer drops only its unique staging schema on failure; preserve the prior active import | Harz active pointer/status and provenance remain unchanged |
| 6. Import Innsbruck | Same isolated staging-schema cleanup for Innsbruck | Innsbruck active pointer/status and provenance remain unchanged |
| 7. Verify provenance | Quarantine/reject the candidate; never manufacture metadata | Previous active generation remains selected and gates are false |
| 8. Project Evidence Graph | Roll back the projection transaction or quarantine the new projection | Prior active projection is unchanged and region bindings pass |
| 9. Validate isolation | Disable both pilot promotions and roll back the affected import/projection selection | No cross-region result and prior pointers are intact |
| 10. Check freshness/coverage | Keep the stale/insufficient region unavailable; select only a still-current reviewed prior generation | Freshness and partial/unsupported states remain truthful |
| 11. Check indexes | Do not promote; restore/recreate from pre-migration state if the reviewed schema is invalid | Required accepted indexes are valid/ready or all gates remain false |
| 12. Run performance gates | Cancel the read-only query through the control connection, roll back, and keep provider false | Pools/leases are idle and no provider reservation occurred |
| 13. Promote set | Atomically restore each same-region prior pointer/status and re-project it | Both regions pass provenance, isolation, freshness, index, and smoke checks |
| 14. Rehearse rollback | Roll the failed rehearsal forward to a new immutable generation or keep the region disabled | Pointer/projection consistency and safe receipt integrity pass |
| 15. Clean temporary material | Stop cleanup if target identity is ambiguous; isolate and escalate instead of broad deletion | Only task-owned transient material is gone; immutable evidence remains |

### 1. Provision disposable and staging PostgreSQL/PostGIS

- Use PostgreSQL with PostGIS 3.2 or later, transactions, row/advisory locks,
  `pg_cancel_backend`, GiST indexes, backups, point-in-time recovery as approved,
  and enough storage for two active/superseded regional generations.
- Create a disposable migration/integration database first. Do not point any
  verification variable at a shared or production database.
- Prove the database name/environment guard used by the operator cannot resolve
  to production. Record only an environment label and database-instance digest.

### 2. Create and test least-privilege roles

- Provision roles using the platform's audited role-management path.
- Test that runtime cannot create/alter/drop schema objects or update import/
  projection policy state.
- Test that importer/projection roles cannot read App Attest keys, receipts,
  challenges, sessions, request IDs, or rate windows.
- Test that public/anonymous/Data API roles cannot read any backend-owned table.
- Record grant-policy digests and denied-access booleans, never role passwords.

Inject distinct runtime URLs for App security, outdoor research, research
cancellation, and outdoor evidence only when the corresponding capability is
approved. Production preflight rejects missing or textually aliased active
pool URLs; that source check does not replace database grant/denial proof.

### 3. Apply migrations 001 through 008

From `backend/`, with the migration role injected:

```sh
npm run db:migrate
```

The runner sorts migrations, takes the
`trailmind-schema-migrations` advisory lock, applies each unapplied file inside
one transaction, and prints filenames only.

Current review boundary:

- migrations 001 through 008 are tracked current-source inputs;
- migration 008 adds the operation-scoped outdoor-research runtime read
  contract and revokes its default `PUBLIC` function privileges;
- role creation and runtime grants remain an audited platform action and are
  not performed by migration 008;
- V4 must stop if the accepted reviewed migration set does not contain the
  point/geography GiST and relationship indexes required by the runtime query
  plans.

Use the exact role and grant contract in
`backend/docs/outdoor-research-runtime-read-boundary.md`. The application
runtime and operator/auditor connections must use distinct roles.

### 4. Prove migration repeatability

Run `npm run db:migrate` a second time against the same disposable database.
Require no new ledger rows and no schema drift. Compare:

- ordered filenames and cryptographic digests from the reviewed commit;
- migration-ledger row count and exact version set;
- required tables, constraints, RLS state, and valid/ready indexes;
- no output containing connection data or records.

Then repeat on empty staging using the same artifact. Failure rolls back the
migration transaction and blocks imports; rollback is restore/recreate from the
pre-migration snapshot, never editing the ledger to claim success.

### Backup and restore gate

Before any beta promotion, the database owner must record a vendor-neutral,
non-secret policy for backup scope, encryption/access, frequency, retention,
restore target, and recovery objectives. Those values are owner/cloud
decisions and are not supplied by this repository.

Perform a restore into a separately identified isolated target. Re-run
migrations, ledger/schema/index/RLS checks, App Attest counter/replay tests,
regional pointer/projection consistency, pruning, and application readiness
with all provider flags false. Record artifact/snapshot version identifiers
and typed outcomes only. A configured backup without a successful restore test
does not satisfy the gate.

### 5. Import bounded current Harz data

Prerequisites: reviewed local `harz-v1` PBF, publisher acquisition record,
verified publisher checksum when the acquisition channel requires it, local
SHA-256, ISO-8601 source/retrieval timestamps, `osm2pgsql` 2.3+, `osmium` 1.x+,
and no credentials in source metadata.

```sh
npm run outdoor-evidence:import -- \
  --region harz-v1 \
  --pbf <absolute-local-harz-pbf> \
  --dataset-name <reviewed-dataset-label> \
  --source-id <credential-free-source-identifier> \
  --retrieved-at <utc-timestamp> \
  --source-timestamp <utc-timestamp> \
  --acquisition-channel <reviewed-channel> \
  --source-checksum <algorithm-and-publisher-checksum>
```

The importer calculates the exact input SHA-256, validates the supplied source
checksum, writes to a unique staging schema, and promotes atomically. A missing
reviewable timestamp or checksum mismatch is a stop, not an invitation to
invent metadata.

### 6. Import bounded current Innsbruck data

Repeat the same command with `--region innsbruck-alps-v1` and the separately
reviewed bounded Innsbruck PBF/provenance. Never reuse Harz metadata, checksum,
or import ID. Do not use Germany-, Austria-, Alps-, or planet-scale inputs.

### 7. Verify acquisition provenance

For each immutable import require:

- region ID, acquisition channel, credential-free source identifier, dataset
  label, source/retrieval/import timestamps in valid order;
- publisher checksum algorithm/value and verification time when applicable;
- calculated input SHA-256 matching the approved local file;
- bounded aggregate counts and `active` status;
- source age no greater than the region's 14-day freshness threshold.

Receipts retain digests and freshness class, not PBF paths, source URLs,
coordinates, raw tags, or database values.

### 8. Project both imports into the Evidence Graph

First activate only the independently reviewed source policy. Substitute one of
the repository-recognized policy versions selected by review:

```sh
npm run outdoor-research:configure-osm-policy -- \
  --mode activate \
  --policy-version <reviewed-policy-version> \
  --operator-confirmation activate-reviewed-osm-mapped-policy \
  --review-reference <non-secret-review-reference> \
  --reviewed-at <utc-timestamp>
```

For each region/import, run dry-run then real projection:

```sh
npm run outdoor-research:project-osm -- \
  --region <harz-v1-or-innsbruck-alps-v1> \
  --import-id <selected-active-import-id> \
  --policy-version <reviewed-policy-version> \
  --operator-confirmation project-reviewed-osm-mapped-facts \
  --dry-run true
```

Repeat with `--dry-run false` only after the dry-run summary passes. Import and
projection IDs are sensitive operational identifiers and must not appear in
public logs or product analytics; sanitized receipts retain their digests.

### 9. Validate active imports and regional isolation

Inside read-only transactions require exactly one active import pointer and one
active projection for each region, with matching region/import/source policy,
current lifecycle states, non-quarantined selected data, and no cross-region
foreign-key or query results. Validate that:

- the active Harz projection references only the active Harz import;
- the active Innsbruck projection references only the active Innsbruck import;
- region boundaries/configuration match the checked-in versioned definitions;
- routes outside both pilot regions remain unsupported or partial;
- broad “Alps” input is not silently bound to the Innsbruck pilot.

Any mismatch blocks provider work and triggers import/projection rollback.

### 10. Check freshness and coverage

- Require source, retrieval, import, and evaluation times in valid order.
- Require both sources current under the 14-day maximum at V4 start and at beta
  stage approval.
- Run bounded corridor/research fixtures for both regions and require known,
  partial, unsupported, stale, and unavailable states remain distinguishable.
- Never interpret missing tags, zero mapped counts, or partial coverage as
  safety, permission, absence, or quality proof.

### 11. Check required GiST indexes

Query `pg_index`/`pg_class` as the read-only auditor and require `indisvalid` and
`indisready` for the region boundary, evidence POI/trail metric geometry,
projection geometry, mapped-route representative-point, and accepted V2 trail
geography indexes. The accepted migration set, not this document, is
authoritative for exact index names.

### 12. Run access-point and corridor performance gates

Provider traffic stays false. Against representative current regional volume:

- corridor predicates must use the POI/trail metric GiST indexes and avoid an
  unbounded sequential scan;
- mapped-route membership must use its representative-point GiST index, with
  every reviewed case below 2,000 ms and p95 below 1,500 ms;
- the V2 trail-access query must use the geography GiST index, return within its
  bounded row limit, avoid sequential scan of the projection-entity table, and
  complete below 2,000 ms;
- the application statement timeout remains 2,500 ms unless a separately
  reviewed production change replaces it.

Relevant repository checks include the PostGIS integration suite,
`backend/test/outdoorRouteMembershipPerformance.test.js`, and the access-query
plan gate in
`backend/test/outdoorResearchExecutorPostgisIntegration.test.js`. Run them only in an
explicitly authorized disposable/performance environment, then reproduce the
read-only `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` gate against staging volume
without retaining query parameters or coordinates.

### 13. Promote the import/projection set

The importer already promotes each regional import atomically under a
region-specific advisory lock and retains the prior import as `superseded`.
Approve the beta data set only after both regional imports, both projections,
isolation, freshness, index, latency, and rollback checks pass together. Record
an aggregate promotion receipt. Do not enable client, research, access, or
provider flags as part of data promotion.

### 14. Roll back to the previous import

Rehearse this before beta. Under a region-specific advisory lock, in one
transaction:

1. lock the region row and selected current/prior import rows;
2. verify the prior import belongs to the same region, was formerly active,
   has intact provenance, and is still fresh enough for the intended use;
3. mark the current import `superseded`;
4. mark the chosen prior import `active`;
5. update the region's active-import pointer;
6. commit, then re-project that restored import with the reviewed projection
   command and repeat isolation/index/smoke gates.

Use parameterized operator tooling or reviewed SQL with bound parameters. Never
paste identifiers or a connection string into a receipt. If the prior import is
stale or inconsistent, keep research/provider flags false rather than promote
it. Roll forward by importing/projecting a new immutable generation; never
rewrite a proof receipt or mutate the contents of an old import.

### 15. Clean temporary PBFs and credentials

- Stop import/projection processes and verify no child process remains.
- Drop only the run's validated unique staging schema; the importer normally
  does this on success/failure.
- Securely remove task-owned PBF copies and checksums from temporary operator
  storage according to policy. Do not delete publisher acquisition evidence or
  immutable database import/projection records.
- Remove the import/migration role's temporary secret access and rotate only if
  exposure is suspected or policy requires it; never inspect or hash secrets.
- Confirm ordinary/provider/insecure flags are false, pools are closed, no
  lease remains, logs contain no forbidden fields, and the sanitized receipt is
  sealed.

## Secret and credential ownership

| Secret/material | Owner | Rotation trigger | Receipt evidence |
| --- | --- | --- | --- |
| GraphHopper credential | Provider/security owner | Exposure, staff/host change, provider incident, scheduled cadence | Key-version alias and rotation-complete boolean only |
| Database role credentials | Database owner | Exposure, role change, environment rebuild, scheduled cadence | Role class and rotation-complete boolean only |
| Apple signing material | Apple-team release owner | Apple revocation/expiry/compromise | Certificate/profile class and inspection result only |
| Receipt signing key | Security audit owner | Exposure, signer change, scheduled cadence | Public key-version identifier only |

No secret is shared with the regional-data source, iOS app, logs, documents, or
proof receipts.

## Failure isolation

- App Attest failure disables protected authorization; it never enables an
  insecure fallback.
- PostGIS failure returns typed research unavailable and releases the lease;
  provider scheduling must not start.
- One region's stale or invalid import disables research for that region and
  blocks a combined beta promotion; it does not mutate the other region.
- Provider failures cannot mutate database evidence or App Attest state beyond
  the already authorized cost/lease lifecycle.
- Receipt-store failure makes the proof/rollout decision fail, but does not
  rewrite historical receipts.
