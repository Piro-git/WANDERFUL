# Supabase Phase 1 remote admission — 2026-08-26

Outcome: **NO-GO for migrations, regional imports, and runtime connection.**

The staging project is healthy, isolated from production, and still on the
approved zero-cost Free plan. The remote database is clean after the earlier
compensated attempt. No mutation was made in this admission pass.

## Identity and containment

| field | observed value |
| --- | --- |
| staging project | `TrailMind Outdoor Staging V1` (`mbvzwsrtqcrwhvykugcd`) |
| organization | `Alibra AI` (`wbnftkftyamxzvxsftda`) |
| plan / recurring project cost | Free / USD 0 |
| region | Frankfurt (`eu-central-1`) |
| status | `ACTIVE_HEALTHY` |
| PostgreSQL | server 17.6, platform `17.6.1.155` |
| protected production | `bejvhhjbgtvctpsnlwid`, zero mutations |
| repository baseline | `90c874f4206c8fa4895c7e6c0a275a21b85f62cb` |

Read-only catalog inspection found no TrailMind schema, role, relation, or
function; no public application relation; no application migration ledger;
and no PostGIS installation. The Supabase migration ledger contains only the
historical Phase 1 pre-step and its compensating rollback. Current security
and performance advisors returned zero notices.

`PUBLIC`, `anon`, `authenticated`, and `service_role` cannot create in the
`public` schema. The database-local `pgrst.db_schemas` value was unavailable,
so this receipt does not infer the dashboard Data API schema configuration.

## Why migrations were not applied

The current repository contains two deliberately exclusive policies:

- historical portable V1: `001–008`;
- managed Supabase isolation V2: `001–007 + 009`.

Migration 009 replaces migration 008 for the managed Supabase ownership and
role topology. Applying 008 and 009 together would violate the committed
policy and is therefore forbidden.

The reviewed V2 operation is not a sequence of independent DDL requests. One
operator operation must retain the foundation lock while it:

1. validates target, plan, region, advisors, roles, ACLs, and prestate;
2. revalidates the same state after acquiring a non-waiting lock;
3. commits the reviewed pre-step;
4. consumes a short-lived in-memory capability and runs `001–007 + 009`;
5. consumes a distinct capability for the exact zero-output no-op run;
6. commits the reviewed post-step;
7. checks advisors and final containment; and
8. persists one bounded sanitized receipt.

The committed CLI intentionally fails with
`trailmind_phase1_v2_remote_adapter_required_and_execution_not_authorized`.
The connected Supabase operations execute independent remote requests and do
not provide the admitted persistent database session, Node capability, and
lock lifetime required by this state machine. Using raw `apply_migration` calls
would bypass the reviewed operator and could leave a partially established
role/ACL topology. That substitution was not attempted.

## Regional data and backup gates

Harz and Innsbruck imports/projections were not run because the database
foundation is absent. No PBF was downloaded, no public Overpass service was
used, and no freshness, coverage, corridor, mapped-membership, or trail-access
claim is made.

The Free plan has no claimed managed-daily-backup guarantee in this receipt.
A logical export and isolated restore rehearsal require an admitted direct
operator connection and a separately identified safe restore target. Neither
was available, so backup/restore remains `not_run` rather than falsely green.

## Exact unblock contract

Do not connect the hosting runtime yet. A future, separately reviewed operator
pass must provide all of the following without exposing values:

1. a temporary or secret-manager-injected direct staging database connection;
2. distinct admitted platform/operator and `migration_role` identities;
3. a live adapter implementing every dependency of
   `runStagingPhase1V2Operator` on one controlled operation boundary;
4. exact project-ref and Free-plan reinspection immediately before mutation;
5. non-waiting lock acquisition and locked prestate equality;
6. exact `001–007 + 009` first run and second-run no-op evidence;
7. post-DDL advisors, denial tests, five-function runtime boundary, and final
   containment reinspection;
8. sanitized durable receipt persistence outside ordinary application logs;
9. logical dump verification and restore into an isolated approved target;
10. only then, current checksum-bound Harz and Innsbruck imports, dry-run and
    persistent projections, query-performance gates, and activation.

No feature flag, provider, paid resource, deployment, or production object may
be enabled by that operator pass.

Machine-readable evidence:
`PHASE_1_REMOTE_ADMISSION_20260826.json`.
