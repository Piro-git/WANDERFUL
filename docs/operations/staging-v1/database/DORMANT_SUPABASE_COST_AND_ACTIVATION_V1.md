# Dormant Supabase cost and activation runbook V1

Status: **dormant, zero application data, not authorized for activation**
Target identity: `mbvzwsrtqcrwhvykugcd` / `TrailMind Outdoor Staging V1` /
`eu-central-1` / database `postgres` / PostgreSQL 17
Scope: repository contract only. This document is not permission to call the
provider, apply SQL, import data, deploy functions, change billing, or enable a
feature.

## Current no-cost posture

TrailMind's incremental Supabase workload must remain zero:

- no imports, projections, retained generations, route evidence, App Attest
  traffic, database clients, Edge Functions, Realtime, Storage, Cron, Queues,
  branches, backups requested by TrailMind, or network egress;
- no repository feature flag may activate the outdoor evidence/research lane;
- `Configuration/Shared.xcconfig` keeps `OUTDOOR_EVIDENCE_ENABLED = false`;
- migration `008_outdoor_research_runtime_read_contract.sql` remains historical
  source only and is absent from the Supabase V2 policy and application ledger;
- the live receipt records zero imports, projection runs, provider leases,
  import-schema leases, branches, and Edge Functions.

This is a **$0 incremental TrailMind activity** posture, not a guarantee about
the owner's Supabase organization invoice or baseline project/compute plan.
Before any future activation, an authorized owner must inspect the current plan,
spend cap, compute size, included quotas, and billing alerts in the provider UI.
Repository evidence must never be used as a substitute for that current billing
check.

## Repository migration contract

The only admitted Supabase PostGIS-isolation sequence is:

1. `001_app_attest.sql`
2. `002_outdoor_evidence.sql`
3. `003_outdoor_research_graph.sql`
4. `004_osm_outdoor_research_projection.sql`
5. `005_outdoor_research_projection_geometry.sql`
6. `006_outdoor_route_membership_point_index.sql`
7. `007_routable_highlight_access_geography_index.sql`
8. `009_supabase_postgis_isolated_runtime_read_contract.sql`
9. `010_bounded_outdoor_import_schema_provisioning.sql`
10. `011_pin_security_invoker_function_search_paths.sql`

`008` is mutually exclusive with `009` and must never enter the V2 ledger. The
existing live receipt has the valid nine-entry prefix through `010`; `011` is a
code-only pending migration and has not been applied live.

## Advisor disposition

### Eight mutable-search-path warnings

Migration `011` pins exactly these security-invoker helpers to
`pg_catalog, trailmind_app`:

- `outdoor_research_deterministic_uuid_v3(text, text)`
- `outdoor_research_reject_audit_mutation()`
- `outdoor_research_validate_assertion_write()`
- `outdoor_research_validate_derived_feature_write()`
- `outdoor_research_validate_policy_timestamps()`
- `outdoor_research_validate_projection_assertion()`
- `outdoor_research_validate_projection_relationship()`
- `outdoor_research_validate_relationship_source_class()`

The functions remain `SECURITY INVOKER`. The migration changes metadata only,
is safe to replay, excludes `public` and `pg_temp`, and adds no privilege, policy,
data, or activation path.

### Four RLS-without-policy notices

These tables intentionally remain fail closed:

- `outdoor_research_entity_aliases`
- `outdoor_research_derived_features`
- `outdoor_research_observations`
- `outdoor_import_schema_leases`

All four have RLS enabled. None receives an `anon`, `authenticated`,
`service_role`, or runtime policy. Adding a policy merely to silence an
informational advisor notice would expand access and is prohibited without a
reviewed product query and explicit authorization.

The administrative migration ledger and PostGIS-owned `spatial_ref_sys` remain
outside the application Data API boundary. Do not enable RLS or add policies on
either mechanically: first prove the extension/administrative behavior and the
exact exposed-schema configuration in a disposable clone.

### Foreign-key index review

No new foreign-key index is admitted in the dormant state. The live advisor's
17 notices were evaluated against the concrete future operations:

| Query/delete shape | Existing access shape | Decision |
| --- | --- | --- |
| Import rows and children by `import_id` | Child primary/unique keys begin with `import_id`; retirement deletes a bounded generation | No extra index now |
| Projection rows and children by `projection_run_id` | Projection child primary/lookup keys begin with `projection_run_id` | No extra index now |
| Static region/source/policy deletion | Provenance uses `ON DELETE RESTRICT`; activation does not delete these parents | No speculative index |
| Entity/assertion/relationship provenance deletion | Append-only or restricted evidence; no authorized delete query exists | No speculative index |
| Runtime reads | Bounded functions use reviewed region, active-generation, spatial, and lookup indexes rather than generic FK scans | Preserve current indexes |

Re-evaluate with `EXPLAIN (ANALYZE, BUFFERS)` only after a representative,
disposable dataset exists and before authorizing imports. Add an index only when
a reviewed read, cascade, or parent-delete plan shows a scan beyond the bounded
capacity contract. Do not use an empty-database unused-index report to remove
indexes.

## Activation prerequisites

Every item is mandatory and must be recorded in a new immutable receipt:

1. A named owner explicitly authorizes the exact live target, candidate commit,
   migration list, maximum imported bytes/regions, allowed provider calls, and
   maximum incremental cost.
2. The owner verifies current project identity, PostgreSQL major, region,
   health, plan, spend cap, quota, billing alerts, and absence of protected
   production targets. Never record credentials in the receipt.
3. The candidate tree is clean, reviewed, built, scanned, and contains no local
   configuration or secret material.
4. Read-only preflight proves the live ledger is the exact prefix through `010`,
   `008` is absent, data counts are still zero, no active sessions/jobs/imports
   exist, and Data API schemas/grants remain closed.
5. Disposable PostgreSQL 17 + PostGIS verification passes from an empty schema,
   a prefix/partial schema, and direct replay of `011`.
6. Security review confirms the eight fixed paths, four intentional fail-closed
   RLS notices, zero API-role access, and no `SECURITY DEFINER` expansion.
7. Backend non-regression proves `/api/parse-intent` and `/api/route` reach the
   LLM and GraphHopper lanes without constructing or calling Supabase evidence.
8. A separately authorized operator and independent reviewer approve the
   transaction, rollback boundary, expected catalog diff, and receipt schema.

Absent any one prerequisite, status is **NO-GO**.

## Authorization boundary

Only a new user instruction that explicitly authorizes a live mutation may move
past preflight. Authorization must name the target and the exact action. A request
to review, verify, document, test, or prepare code does not authorize:

- SQL or migration application;
- imports, projections, provider calls, Edge Functions, deploys, or flags;
- role, policy, grant, schema, extension, network, secret, or billing changes;
- project pause, restore, branch, deletion, or credential retrieval.

The managed bootstrap renderer is for a truly empty foundation. It must not be
used against the existing nine-entry live prefix. A future `011` application
must use the prefix-aware, target-bound migration runner inside one explicitly
authorized session and then execute a read-only no-op verification pass.

## Rollback and stop rules

Before execution, capture a read-only catalog diff plan and confirm the entire
change is limited to eight `pg_proc.proconfig` values plus ledger entry `011`.
Apply `011` and its ledger insert in one transaction. Any mismatch, timeout,
unexpected advisor result, data count, role/grant change, or non-prefix ledger
must roll back the transaction and stop.

After commit, do not import data or enable a flag. If post-verification fails,
freeze activation and preserve the receipt. A compensating transaction may be
considered only under new explicit authorization. Resetting the eight paths to
mutable defaults is a security downgrade and is not an automatic rollback;
prefer fixing forward or restoring the exact reviewed pre-change database state.

## Verification commands and receipts

Local code-only verification:

```sh
cd backend
npm ci
node --test test/dormantSupabaseHardeningMigration.test.js \
  test/dormantSupabasePlanningIsolation.test.js \
  test/stagingManagedSupabaseBootstrap.test.js \
  test/stagingMigrationCapability.test.js
npm run test:dormant-supabase-hardening
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

The disposable command must report successful empty, partial-resume, replay,
RLS, role, and search-path checks and remove its `/private/tmp` cluster. The
managed Supabase/Supautils parity suite remains additionally required wherever
an official PostgreSQL 17 Supautils library is available.

A future live receipt must include target identity, authorization reference,
candidate commit/tree, migration hashes, exact before/after ledger, transaction
outcome, before/after data counts, eight function configurations, four no-policy
tables, schema/API grants, role attributes, both advisor outputs, cost settings,
and explicit counts of imports, projections, provider calls, functions, branches,
and deploys. It must state every non-mutation and contain no secret.

## Current documentation check

Public Supabase changelog and documentation were reviewed on 2026-09-05. The
2026 Data API change that stops automatically exposing newly created tables
reinforces explicit schema/grant verification but does not replace RLS. Current
RLS/function guidance still requires RLS in exposed schemas, fixed trusted paths
for privileged functions, and least privilege. No live platform discovery was
needed for this code-only task; the pinned managed-bootstrap receipt remains the
target/evidence source.
