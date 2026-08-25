# TrailMind Supabase staging database Phase 1 foundation proof

Status: **BLOCKED, FAIL-CLOSED, AND COMPENSATED**

Proof date: 2026-08-24 (Europe/Berlin)

Machine-readable receipt:
`docs/operations/staging-v1/database/PHASE_1_FOUNDATION_PROOF.json`

## Outcome

Phase 1 is not complete and this document does not claim that it is. The
authorized staging identity, zero-cost boundary, production containment,
initial empty state, local migration topology, and repository verification all
passed. The hosted Supabase extension-ownership model then made the exact
committed least-privilege contract impossible to satisfy without changing or
weakening that contract.

Migrations 001-008 were therefore never applied remotely. The already-applied
pre-foundation was removed by an atomic, locally rehearsed compensating
rollback. Staging finishes with no TrailMind roles, no TrailMind schemas, no
application objects, no application migration ledger, no PostGIS, and clean
security and performance advisors. The provider migration history truthfully
retains the pre-foundation and compensating rollback entries; it was not
rewritten.

## Identity, cost, and concurrency gates

| Check | Result | Evidence |
| --- | --- | --- |
| Repository baseline | passed | `HEAD` and refreshed `origin/main` were `72b98e3e065ae442168ece20984d8baba26e2d11`, satisfying the required baseline-or-later gate. |
| Organization | passed | `Alibra AI` (`wbnftkftyamxzvxsftda`), Free plan. |
| Authorized staging | passed | `TrailMind Outdoor Staging V1` (`mbvzwsrtqcrwhvykugcd`), Frankfurt (`eu-central-1`), `ACTIVE_HEALTHY`, PostgreSQL 17, platform `17.6.1.155`. |
| Exact price | passed | Project creation quote was USD 0/month. No paid branch, backup/PITR, add-on, networking product, upgrade, or nonzero resource was requested. |
| Protected production | passed | `TrailMind` (`bejvhhjbgtvctpsnlwid`) remained read-only and `ACTIVE_HEALTHY`, platform `17.6.1.141`. |
| Planua | passed | `Planua` (`cmkvbxppgofteoutfslp`) remains preserved and paused with status `INACTIVE`; it was not deleted or placed in database scope. |
| Duplicate writer | passed | No equivalent committed Phase 1 foundation, active TrailMind database mutator, conflicting worktree, custom-role database session, or application ledger was found before mutation. |
| Initial state | passed | Zero TrailMind roles, zero TrailMind schemas/application objects, no PostGIS, no application ledger, and zero public application relations. |

Production was inspected only with project metadata and SQL `SELECT`. Before
and after the staging attempt it had one provider migration, eight public
application tables, no PostGIS, no Phase 1 roles, and no `trailmind_app` or
`trailmind_control` schema. Production mutation count is zero.

## Exact provider blocker

The pre-foundation installed the current Supabase default PostGIS 3.3.7 in
trusted `public` with no version clause. Supabase created its routines as the
provider-owned `supabase_admin` superuser and left their default `PUBLIC`
`EXECUTE` ACL in place. The managed `postgres` role is not a member of, cannot
`SET ROLE` to, and cannot act as `supabase_admin`. Its attempted owner-scoped
revokes therefore could not change those ACLs.

The resulting runtime observation was 744 executable routines in `public` for
each role inheriting `PUBLIC`; `public.st_point(double precision, double
precision)` was one verified provider-owned example. PostgreSQL has no negative
grant that can override a `PUBLIC` grant.

That behavior conflicts with two exact committed boundaries:

1. Both App Attest manifests require `public` schema `USAGE`, declare
   `publicFunctionExtensions: []`, and reject admission when the role can
   execute any `public` routine.
2. The outdoor runtime must execute exactly the five reviewed bounded
   application functions and no broader callable application/search-path
   surface.

Moving PostGIS to a separate schema is the provider's general recommendation,
but cannot preserve the exact protected migrations here: migration 008 stores
the migration session's fixed search path, and that reviewed path includes
`public` for unqualified PostGIS types, functions, and operators. Adding an
extension exception to the App Attest manifest, changing migration 008's path,
moving application objects into `public`, or introducing proxy functions would
change the committed contract. None was attempted. Supabase documents that
hosted users do not receive superuser access, so entering the provider owner was
also not a permissible remedy.

This satisfies the requested mandatory stop conditions: exact roles could not
be implemented securely on the provider while preserving the reviewed private
schema/search-path behavior.

Official references:

- https://supabase.com/docs/guides/database/postgres/roles-superuser
- https://supabase.com/docs/guides/database/extensions
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/api/securing-your-api

## Remote execution and compensation

| Operation | Status | Result |
| --- | --- | --- |
| Identity and empty-state preflight | passed | Exact target and separation proved before DDL. |
| Pre-foundation transaction | passed, later compensated | Created the reviewed owner/operator role topology, private schemas, trusted search paths, cancellation wrapper, and current default PostGIS. Earlier portability diagnostics failed inside transactions and rolled back fully before the successful pre-foundation. |
| PostGIS ACL admission probe | failed | Provider ownership left 744 executable public routines; exact App Attest/outdoor admission was false. |
| Migrations 001-008 | **not run** | Stopped before the first application migration. |
| Post-migration grants/RLS | **not run** | Application objects did not exist. |
| Second remote migration/no-op | **not run** | No first remote application run existed to repeat. |
| Advisors after DDL | failed in blocked state | One security error, seven warnings, zero performance notices. |
| Compensating rollback rehearsal | passed | Disposable PostgreSQL 17/PostGIS run removed all 11 roles, both schemas, wrapper, and PostGIS while retaining provider fixture roles. |
| Atomic staging compensation | passed | Guarded rollback detected zero application objects/ledger and zero active TrailMind sessions before removing the partial foundation. |
| Final advisors | passed | Zero security notices and zero performance notices. |

The Supabase provider ledger contains exactly these two truthful operations:

1. `20260824201634 trailmind_phase_1_pre_migration_foundation`
2. `20260824202617 trailmind_phase_1_blocked_compensating_rollback`

The final database has zero TrailMind roles, zero TrailMind schemas, zero
TrailMind relations/routines, zero public application relations, no application
ledger, and no installed PostGIS. The application migration ledger/order is
therefore correctly `not_run`, not falsely reported as a no-op success.

## Local exact-migration rehearsal

Before the provider blocker was accepted, a disposable PostgreSQL 17/PostGIS
rehearsal successfully applied the committed private-schema topology without
editing migrations 001-008:

- migration owner path: `trailmind_app,pg_catalog,public,pg_temp`;
- runtime/import/projection path: `pg_catalog,trailmind_app,public,pg_temp`;
- cancellation path: `pg_catalog,trailmind_control,pg_temp`;
- first migration runner invocation: exactly 001 through 008, in lexical order;
- second migration runner invocation: zero applied files and no ledger change;
- exact ledger length: eight;
- App Attest runtime and control admission: passed in the owner-controllable
  disposable environment;
- outdoor runtime: five executable application functions and zero direct
  application relation privileges;
- bounded outdoor function call: passed;
- cancellation drill: wrong target denied, direct `pg_cancel_backend` denied,
  product query denied, outdoor target cancelled, non-target survived;
- compensating rollback rehearsal: passed.

Protected migration SHA-256 values used for the rehearsal:

| Migration | SHA-256 |
| --- | --- |
| 001 | `f25c5c712563d53abc926c34196e603b54d6ce7d414b5f22fdf95ec49ae95c16` |
| 002 | `750d715dc4662ca725a3c04de91c559e6dfc9455332be23eb95fa509dceafd7d` |
| 003 | `79eaf76eea21c6a3476fb801cfae432bccdbc3260421dcfb9e123513b6bb3928` |
| 004 | `7a876c955740021ca173300409c97a869e1c6aebbdb8dffdf773295d39d7bbb3` |
| 005 | `945688fdff722cfdab62f72fc7b9bd5c27335e10161054f3909e774094ae6bc8` |
| 006 | `13ad98c4fc0fa19b27ad7a398bbaca8a6dfb1a29616e2de25c4a877843e8c4` |
| 007 | `d3eb65d307f28e65bdaa234be7a6fc1cd7ceec47499ebd40e05b61fdb40657f7` |
| 008 | `e568e6ea65bd0d6f96fd20f636efcbb42700c55856ea3f19d1955b6a9e415b32` |

Local success is portability evidence only. It is not substituted for the
required remote staging proofs.

## Reviewed role matrix

The matrix below is the exact prepared/rehearsed separation. Its final remote
status is `absent_after_compensation`; no role is claimed provisioned.

| Role | Attributes and intended boundary | Remote status |
| --- | --- | --- |
| `trailmind_app_owner` | `NOLOGIN NOINHERIT`; owns private application objects; only `migration_role` receives `SET TRUE`, not inherited membership. | absent after compensation |
| `trailmind_control_owner` | `NOLOGIN INHERIT`; owns only the control schema/wrapper; inherits `pg_signal_backend`; not a product role. | absent after compensation |
| `platform_provisioner` | `NOLOGIN NOINHERIT`; no application object privileges. | absent after compensation |
| `migration_role` | `LOGIN PASSWORD NULL NOINHERIT`; no direct app grants; may explicitly set the application owner only. | absent after compensation |
| `regional_import_role` | `LOGIN PASSWORD NULL NOINHERIT`; database `CREATE` for the bounded transient import schema; exact evidence import table privileges only; no trusted-schema `CREATE`. | absent after compensation |
| `projection_role` | `LOGIN PASSWORD NULL NOINHERIT`; exact evidence reads, projection writes, active-view reads, and deterministic UUID function only. | absent after compensation |
| `app_security_runtime_role` | `LOGIN PASSWORD NULL NOINHERIT`; App Attest exact transactions: `SELECT/INSERT/UPDATE` on five lifecycle tables and `INSERT` on request IDs; no functions or DDL. | absent after compensation |
| `outdoor_research_runtime_role` | `LOGIN PASSWORD NULL NOINHERIT`; execute only five bounded migration-008 functions; no base-table, mutation, DDL, or cross-role privileges. | absent after compensation |
| `outdoor_research_cancellation_control_role` | `LOGIN PASSWORD NULL NOINHERIT`, connection limit 1, statement timeout 1000 ms; control-schema wrapper only; wrapper verifies same database and outdoor runtime identity. | absent after compensation |
| `pruner_role` | `LOGIN PASSWORD NULL NOINHERIT`; `DELETE` only on four reviewed App Attest lifecycle tables, with role-specific RLS policies. | absent after compensation |
| `readonly_auditor_role` | `LOGIN PASSWORD NULL NOINHERIT`; remains separate; no operational grants were guessed before the exact hosted contract could be admitted. | absent after compensation |

Every custom role was prepared as `NOSUPERUSER NOCREATEROLE NOREPLICATION
NOBYPASSRLS`; only the regional importer had bounded database `CREATE`.
`anon`, `authenticated`, `service_role`, `postgres`, managed administrators,
and `backup_restore_role` were not collapsed into any application identity.

## Data API, RLS, lifecycle, and advisors

Final staging containment is structural: there are no application objects in
`public` or any private application schema. Consequently `anon`,
`authenticated`, and `service_role` have no TrailMind object privileges and no
TrailMind RPC surface.

In the blocked pre-rollback state the security advisor found:

- error: `public.spatial_ref_sys` had RLS disabled;
- warning: PostGIS was installed in exposed `public`;
- three anonymous and three authenticated warnings for the PostGIS
  `st_estimatedextent` `SECURITY DEFINER` overloads.

Those provider-owned findings could not be corrected while retaining the exact
contract. Compensation removed PostGIS, and both final advisors returned zero
notices. Official remediation pages for the observed findings:

- https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public
- https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public
- https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

Remote DDL denial, RLS lifecycle, App Attest transaction, outdoor five-function,
cancellation, import/projection/pruning/audit, and GiST execution drills are
`not_run` because their objects were deliberately never applied. The matching
local admission and cancellation checks passed, but do not replace remote
evidence.

## Repository verification

| Verification | Result |
| --- | --- |
| Focused migration/admission/container/lifecycle tests | passed, 34/34; zero failed/skipped |
| Complete backend suite | passed, 967/967; zero failed/skipped |
| `npm run build` | passed |
| Offline outdoor quality evaluation | passed, 101/101; zero failed/skipped |
| Thirteen reviewed flag defaults | passed; all exact false |
| JSON receipt validation | passed |
| `git diff --check` | passed |
| Conflict/whitespace/secret/artifact scan | passed, subject to the final handoff status below |

No OSM/PBF import, GraphHopper/AI/provider call, backend deployment, feature
enable, backup/restore claim, new project, paid product, or nonzero spend
occurred. No credential, key, JWT, password, provider URL, service-role value,
or connection string is present in this proof. `Configuration/Local.xcconfig`
and production secrets were not inspected. `supabase/.temp/cli-latest` was not
touched, deleted, staged, or committed.

## Phase 2 recommendation

Do not import data or proceed to Phase 2. First resolve the foundation contract
through one separately reviewed path:

1. obtain a supported Supabase mechanism for the project owner to revoke
   provider-owned PostGIS routine execution from `PUBLIC`; or
2. explicitly review and commit a new architecture that installs PostGIS in a
   non-exposed trusted schema and updates every affected fixed search path,
   admission manifest, migration test, and operator contract without adding
   unbounded runtime execution.

After that decision, rerun Phase 1 from the current empty application state,
apply exact migrations 001-008 twice, prove the full remote role/RLS/Data API
denial matrix, rerun both advisors, and only then consider bounded regional
imports. A paid plan is neither required nor authorized by this recommendation.

## Files prepared for independent review

- `docs/operations/staging-v1/database/PHASE_0_RESOURCE_DECISION.md`
- `docs/operations/staging-v1/database/PHASE_1_PRE_MIGRATION.sql`
- `docs/operations/staging-v1/database/PHASE_1_POST_MIGRATION.sql`
- `docs/operations/staging-v1/database/PHASE_1_BLOCKED_ROLLBACK.sql`
- `docs/operations/staging-v1/database/PHASE_1_FOUNDATION_PROOF.md`
- `docs/operations/staging-v1/database/PHASE_1_FOUNDATION_PROOF.json`

All task changes remain unstaged and uncommitted.
