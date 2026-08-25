# Outdoor Research Runtime Read Boundary

Status: repository contract implemented; provider/platform provisioning and current-volume acceptance remain external gates.

## Decision

Production outdoor-research reads use five bounded `SECURITY DEFINER` functions. Historical portable migration `008_outdoor_research_runtime_read_contract.sql` is retained for non-Supabase/public-PostGIS compatibility evidence only. The approved Supabase candidate policy is the mutually exclusive sequence `001-007` plus `009_supabase_postgis_isolated_runtime_read_contract.sql`; it never applies `008`. The application runtime role receives private application-schema `USAGE` and `EXECUTE` on those functions only. It receives no table, sequence, active-view, migration-ledger, import, projection, policy, App Attest, public-schema or GIS-schema privilege.

The functions implement the exact operations used by `PostgresOutdoorResearchRepository`:

1. resolve one reviewed-region snapshot context;
2. discover bounded highlights;
3. retrieve bounded mapped-route memberships;
4. retrieve bounded route assertions; and
5. resolve bounded trail-access candidates.

Real index evidence is captured by executing static, parameterized `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` statements through a disposable read-only auditor. Plan diagnostics are deliberately not exposed as additional security-definer functions.

RLS remains enabled on all backend-owned base tables. No permissive `USING (true)` policy is added. The migration revokes the default `PUBLIC` execute privilege from every function and does not create roles or grant a named role. Role creation and grants remain a platform/operator action.

Generic RLS or security-barrier predicates were not used as the application query surface. In the representative PostGIS plans, applying those barriers around non-leakproof spatial expressions such as `ST_PointOnSurface` prevented the required point GiST plan and caused projection-entity sequential scans. The operation functions retain the full active-state checks inside an owner boundary while preserving the reviewed spatial query shape.

## Enforced visibility

Every data-returning operation is bounded by its typed arguments and hard limits. Together, the operations enforce:

- only `harz-v1` and `innsbruck-alps-v1`;
- finite WGS84 coordinates;
- reviewed radius, limit, category, predicate, and trail-access allowlists;
- the requested projection run and region;
- an enabled region whose active import matches the projection run;
- an import whose lifecycle status is `active`;
- an active source and recognized active source policy via the active projection views;
- active entities, assertions, relationships, and scope rows where applicable;
- in-region geometries; and
- exclusion of quarantined projected entities.

The snapshot-context operation may report inactive context fields so the repository can fail closed as `source_unavailable`; it does not return evidence or projection rows. All subsequent evidence operations return zero rows when the active import, source, source policy, region, entity lifecycle, or quarantine contract fails.

The migration and all five functions must be owned by one narrowly scoped `NOLOGIN NOINHERIT` schema owner with no dangerous role attributes and no role memberships. The application schema must also be owned by that role. An audited migration login may be allowed to `SET ROLE` to the owner; neither the runtime nor auditor login may be a member of it.

Supabase replacement migration `009` requires PostGIS to have been installed directly in locked `trailmind_gis`, proves that no PostGIS routine is in `public`, and rejects GIS ownership or GIS `CREATE` by the application-function owner. The five functions capture exactly `pg_catalog,trailmind_app,trailmind_gis,pg_temp`; no writable or untrusted schema precedes their dependencies. Runtime connections use `pg_catalog,trailmind_app,pg_temp`, receive no `USAGE` on `public`, managed `extensions`, or `trailmind_gis`, and have no database `TEMPORARY` privilege. Direct PostGIS or shared-extension invocation is therefore unavailable even when provider-owned routines retain `PUBLIC` execute ACLs inside an inaccessible schema.

## Production role provisioning

Role names may differ by platform, but the capability split must not. The reviewed Supabase candidate uses private application schema `trailmind_app`, locked extension schema `trailmind_gis`, non-login owner `trailmind_app_owner`, audited login `migration_role`, and runtime login `outdoor_research_runtime_role`. The complete guarded SQL is in `docs/operations/staging-v1/database/PHASE_1_PRE_MIGRATION_V2.sql` and `PHASE_1_POST_MIGRATION_V2.sql`; the abbreviated shape below is explanatory, not an operator substitute.

Run role creation through the platform's audited provisioner, not through an application migration:

```sql
CREATE ROLE trailmind_app_owner
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
GRANT trailmind_app_owner TO migration_role
  WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;

CREATE ROLE outdoor_research_runtime_role
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

CREATE SCHEMA trailmind_gis;
REVOKE ALL ON SCHEMA trailmind_gis FROM PUBLIC, anon, authenticated, service_role;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA trailmind_gis;
CREATE SCHEMA trailmind_app AUTHORIZATION trailmind_app_owner;
GRANT USAGE ON SCHEMA trailmind_gis TO trailmind_app_owner;
REVOKE CREATE ON SCHEMA trailmind_gis FROM trailmind_app_owner;

-- Apply policy 001-007 + 009 from the audited login after:
SET ROLE trailmind_app_owner;
SET search_path = trailmind_app, pg_catalog, trailmind_gis, pg_temp;
-- run the explicitly selected Supabase V2 migration policy here
RESET ROLE;

GRANT CONNECT ON DATABASE trailmind TO outdoor_research_runtime_role;
GRANT USAGE ON SCHEMA trailmind_app TO outdoor_research_runtime_role;
REVOKE ALL ON SCHEMA trailmind_gis FROM outdoor_research_runtime_role;
ALTER ROLE outdoor_research_runtime_role
  SET search_path = pg_catalog, trailmind_app, pg_temp;

REVOKE ALL ON ALL TABLES IN SCHEMA trailmind_app FROM outdoor_research_runtime_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA trailmind_app FROM outdoor_research_runtime_role;

GRANT EXECUTE ON FUNCTION
  trailmind_app.trailmind_runtime_outdoor_research_snapshot_context_v1(
    text, double precision, double precision
  ) TO outdoor_research_runtime_role;
GRANT EXECUTE ON FUNCTION
  trailmind_app.trailmind_runtime_outdoor_research_highlights_v1(
    uuid, text, double precision, double precision, text[],
    double precision, text[], integer, double precision
  ) TO outdoor_research_runtime_role;
GRANT EXECUTE ON FUNCTION
  trailmind_app.trailmind_runtime_outdoor_research_route_memberships_v1(
    uuid, text, double precision, double precision,
    double precision, integer, integer
  ) TO outdoor_research_runtime_role;
GRANT EXECUTE ON FUNCTION
  trailmind_app.trailmind_runtime_outdoor_research_route_assertions_v1(
    uuid, uuid[], text[], integer
  ) TO outdoor_research_runtime_role;
GRANT EXECUTE ON FUNCTION
  trailmind_app.trailmind_runtime_outdoor_research_trail_access_candidates_v1(
    uuid, text, uuid[], double precision, integer, text[], text[], integer
  ) TO outdoor_research_runtime_role;
```

PostgreSQL grants database `TEMPORARY` to `PUBLIC` by default. A dedicated TrailMind database should revoke it from `PUBLIC` and grant it back only to reviewed maintenance roles; revoking it from the runtime role alone cannot override a `PUBLIC` grant:

```sql
REVOKE TEMPORARY ON DATABASE trailmind FROM PUBLIC;
```

Keep future objects closed by default under the migration owner:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE trailmind_app_owner IN SCHEMA trailmind_app
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE trailmind_app_owner IN SCHEMA trailmind_app
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE trailmind_app_owner IN SCHEMA trailmind_app
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
```

The import/projector role remains separate and write-capable only for the reviewed import/projection workflow. App Attest uses a separate application-security connection. The endpoint accepts outdoor reads only from the explicit `outdoorResearchPool` and `outdoorResearchCancellationPool`; it fails closed if either aliases an App Attest pool. Because base tables are RLS-protected without permissive read policies, a disposable auditor may use `BYPASSRLS` only with explicit `SELECT` grants and no DML, DDL, `TEMPORARY`, object ownership, or role memberships. Those privileges must never be inherited by the outdoor runtime role.

For a disposable V4 performance-proof database, a distinct auditor receives only the relation `SELECT` needed by the fixed diagnostic queries. RLS remains enabled; the role may use `BYPASSRLS` only in that disposable database and only while it has no write, DDL, `TEMPORARY`, ownership, or role-membership capability. The proof runtime receives exactly the five data functions and no relation access.

## V4 connection contract

The targeted V4 runner requires two separate loopback URLs for the same disposable proof database:

- `TRAILMIND_V4_RUN_DATABASE_URL`: the direct non-elevated proof-runtime login used by `PostgresOutdoorResearchRepository` and its cancellation pool;
- `TRAILMIND_V4_OPERATOR_DATABASE_URL`: a distinct operator/auditor login used only for migration-count, lifecycle, clock, index, and route-containment diagnostics.

The runner rejects query parameters, fragments, non-loopback hosts, mismatched decoded database/server identities, username aliases, and a shared username. It also verifies the auditor's bounded read-only bypass contract, direct runtime-login role attributes, membership, object ownership, schema/database privileges, the exact five-function runtime grant, and the constrained five-function owner before provider admission. Every pool has bounded connection, query, and server statement timeouts and an idle-error monitor. Provider credentials remain gated until database admission and the four canonical pre-provider planning cases have completed through the runtime repository.

The current-volume performance suites likewise require separate runtime and operator/auditor URLs. They compare runtime-function results with operator-query results and execute only fixed, parameterized plan statements through the operator/auditor role. Each query gets one bounded warm-up followed by exactly five measurements. Acceptance requires real `ANALYZE, BUFFERS` evidence, the point GiST or geography GiST index, the relationship subject index where applicable, no projection-entity sequential scan in the accepted plan, nonzero expected results, and p95 below 1.5 seconds.

## Verification and rollback

From `backend/`, syntax/unit coverage is available without a database:

```sh
npm run build
npm test
```

The gated PostGIS suite verifies direct migration repeatability, migration-runner repeatability, atomic rollback after an injected failure, exact function grants, a real login role with `current_user = session_user`, successful repository reads, direct read/write/DDL/role denial, RLS-bypass denial, and lifecycle/import/source-policy removal.

On a migration failure, `scripts/migrate.js` rolls the entire migration set and ledger insert back in one transaction. If an already-applied contract must be disabled, first revoke the five execute grants and terminate only the affected runtime sessions through the audited platform path. Keep provider and product gates false. Dropping the functions or restoring a pre-migration database is a separately reviewed operator action; never edit the migration ledger to simulate rollback.

This contract does not prove current Harz/Innsbruck data volume, staging deployment, provider success, public access, route safety, or route quality. Those remain separate evidence gates.
