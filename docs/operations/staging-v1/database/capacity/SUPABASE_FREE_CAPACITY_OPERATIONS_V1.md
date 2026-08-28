# Supabase Free bounded two-core capacity operations v1

Status: local release candidate only. No remote execution is authorized by this document.

## Product and platform contract

This profile covers only:

- `harz-v1`: Ilsenburg–Brocken–Schierke core
- `innsbruck-alps-v1`: Innsbruck–Nordkette core

It is not full Harz, full Innsbruck, or Alps coverage. A request outside the
tracked polygons must be rejected or reported as uncovered. The profile must
never be described with one of those broader claims.

The official [Supabase database-size documentation](https://supabase.com/docs/guides/platform/database-size)
and [billing documentation](https://supabase.com/docs/guides/platform/billing-on-supabase)
were checked on 2026-08-28. Supabase Free permits 500 MB of PostgreSQL database
size per project and places an over-limit Free database into read-only mode.
Database size is measured with `pg_database_size`; disk/WAL quota and dump size
are different measurements. The current [Supabase changelog](https://supabase.com/changelog)
was also checked. PostgreSQL 17 is the current new/self-hosted default, and the
2026 Data API default-exposure change does not alter this private database
capacity profile.

The immutable contract is
`backend/config/outdoor-capacity-profiles/supabase-free-bounded-two-core-v1/capacity-contract-v1.json`.
It binds the exact nine-migration ledger, profile, region definitions,
polygons, temporary-workspace prerequisite, and lifecycle SQL by SHA-256.
Local verification must fail closed on any byte or database-ledger drift.

## Capacity decision

The admission rule is:

`current pg_database_size + bounded operation growth + 40,000,000 reserve <= 500,000,000`

The operation bounds are 43,794,432 bytes for an import and 213,712,896 bytes
for a projection. These are derived conservatively from the measured retained
refresh. The settled operating target remains 400,000,000 bytes.

| State | Managed-equivalent bytes | Hard-limit headroom |
| --- | ---: | ---: |
| First active generation | 224,274,176 | 275,725,824 |
| Active plus superseded generation | 355,657,472 | 144,342,528 |
| Retained refresh transient peak | 453,060,352 | 46,939,648 |

Full Harz and full Innsbruck do not fit. A third retained generation is not
approved. If actual size, a bound, identity, freshness, quarantine, or settled
generation state cannot be proved, the operation must stop. A capacity failure
is `PLATFORM_LIMIT`; it is not grounds to reduce the reserve or broaden the
coverage claim.

Only bounded fields are emitted: profile, region, operation, coverage label,
byte measurements, generation counts, and a decision category. Connection
identity, database name, credentials, PBF paths, and import identifiers are not
published by capacity decisions.

## Prerequisites

Apply the profile only after the reviewed Phase 1 V2 pre-step, the exact
`001-007 + 009 + 010` migration policy, and the reviewed Phase 1 V2 post-step.
The migration runner's second execution must be a zero-output no-op. Then,
through a separately reviewed local/operator session, apply in order:

1. `projection-temporary-workspace.sql`
2. `capacity-generation-lifecycle.sql`

Neither file is an application migration and neither is applied implicitly by
the importer or projector. The lifecycle prerequisite verifies the exact
ledger and immutable profile identity before installing its contract and two
operator functions. It does not grant runtime base-table access or change the
five-function runtime boundary.

## Import and projection

Every bounded import must pass:

```text
npm run outdoor-evidence:import -- <normal reviewed arguments> \
  --staging-profile supabase-free-bounded-two-core-v1
```

Every bounded projection, including a dry projection because it consumes
workspace, must pass:

```text
npm run outdoor-research:project-osm -- <normal reviewed arguments> \
  --staging-profile supabase-free-bounded-two-core-v1
```

Before mutation, admission takes one session advisory lease, validates local
digests and the database contract/ledger, reads actual `pg_database_size`,
checks in-flight work and quarantine, counts the regional retained lineage,
and applies the conservative peak formula. The import retains the lease through
promotion and cleanup. The projector repeats preflight after the lease and
under its existing regional transaction lock. An exact already-active
projection returns `unchanged` before any new mutation.

The only admitted lifecycle is one active generation plus at most one
superseded generation for each bounded region. Import refuses a third source
generation; projection refuses a third retained projection. No refusal invokes
retirement implicitly, and a failed admission never writes a failed run/import
row. Profile-installed database triggers additionally require the exact
session-level admission context and advisory lease for bounded generation-row
inserts/updates and enforce the two-generation ceiling under direct SQL as a
defense in depth.

## Reviewed oldest-generation retirement

Retirement is a distinct operator action. Run rollback first with the exact
oldest superseded import/run pair:

```text
npm run outdoor-evidence:retire-generation -- \
  --profile supabase-free-bounded-two-core-v1 \
  --region <exact-bounded-region> \
  --import-id <oldest-superseded-import-uuid> \
  --projection-run-id <matching-superseded-run-uuid> \
  --operator-confirmation RETIRE_SUPERSEDED_OUTDOOR_EVIDENCE_GENERATION_V1 \
  --commit false
```

Verify the returned bounded counts and active-generation preservation. Only
then repeat with `--commit true` under a separately reviewed operator action.

The database function requires the exact managed `postgres` session and a
bounded `SET ROLE trailmind_app_owner`; the client resets that role before
returning its connection. It takes the global capacity, regional import, and
regional projection advisory locks. It requires exactly two settled imports
and two settled projections, zero regional quarantine, exact profile identity,
and the oldest complete superseded regional pair. It rejects active targets,
cross-region pairs, mismatched lineage, in-flight work, and wrong
confirmation.

The transaction deletes only projection rows for the bound run, the exact
superseded projection ledger row, and the exact superseded import. Import-owned
POIs, trails, hiking relations, and memberships follow their existing bounded
foreign-key cascade. Canonical assertions, relationships, entities, identities,
and source provenance remain append-only; shared or historical canonical facts
are not removed. The function revalidates active import/projection lineage and
regional generation counts before returning. Caller rollback preserves every
row.

Retirement releases logical rows; it is not permission for `VACUUM FULL`, broad
truncation, database reset, cross-region deletion, or any unbounded cleanup.
Because ordinary deletion does not promise an immediate managed
`pg_database_size` reduction, the next import/projection must run admission
again. If the measured formula still fails after reviewed retirement, stop with
`PLATFORM_LIMIT` or move off Free.

## Verification and recovery

The disposable PostgreSQL 17/PostGIS proof uses the exact managed-style role
topology and current official `supautils`. It covers exact migration/no-op
behavior, actual `pg_database_size` admission and refusal, two retained
generations, third-generation refusal before mutation, rollback and committed
retirement, cross-region and active-generation denial, post-retirement refresh,
zero quarantine, runtime isolation, RLS, and the intended GiST plans.

The retained-volume proof in `SUPABASE_FREE_CAPACITY_PROOF_V1.md` records both
bounded region imports/projections, route membership/access/corridor p95s, and
the PostgreSQL custom-format backup/restore row-count digest equivalence. Do not
use compressed dump size as a capacity measurement. Before any later remote
run, repeat backup/restore and compare row counts, active lineage, input file
digests, projection keys, quarantine count, policies, owners, and the immutable
contract.

No operation here authorizes a remote Supabase mutation, Data API change,
provider call, deployment, feature enablement, billing change, credential
inspection, or secret handling.
