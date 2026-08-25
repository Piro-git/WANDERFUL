# Phase 1 PostGIS Isolation V2 — Local Proof

Status: **locally fixed; remote Phase 1 retry not authorized or proven**

Proof date: 2026-08-25 (Europe/Berlin)  
Repository baseline/fetched `origin/main`: `72b98e3e065ae442168ece20984d8baba26e2d11`  
Authorized future staging target: TrailMind Outdoor Staging V1, `mbvzwsrtqcrwhvykugcd`, Frankfurt (`eu-central-1`)  
Protected production target: TrailMind, `bejvhhjbgtvctpsnlwid` — not contacted  

This receipt covers code and disposable local PostgreSQL/PostGIS verification only. No Supabase project was queried or mutated during this correction pass. It does not supersede the truthful blocked/compensated remote receipt in `PHASE_1_FOUNDATION_PROOF.md` and `.json`.

## Versioning decision

Unchanged historical migration `008_outdoor_research_runtime_read_contract.sql` was executed in one disposable PostgreSQL 17 transaction after PostGIS had been installed directly in `trailmind_gis`. It reset its creation path to `trailmind_app,pg_catalog,public,pg_temp`, then failed at the first unqualified `geometry` reference. The transaction rollback left zero application relations and zero application functions while retaining only the pre-existing isolated extension.

Therefore a corrective `009` after `008` is impossible: `008` cannot first commit in this topology. Historical `008` remains byte-identical. The Supabase candidate is a separately selected, mutually exclusive policy:

1. `001_app_attest.sql`
2. `002_outdoor_evidence.sql`
3. `003_outdoor_research_graph.sql`
4. `004_osm_outdoor_research_projection.sql`
5. `005_outdoor_research_projection_geometry.sql`
6. `006_outdoor_route_membership_point_index.sql`
7. `007_routable_highlight_access_geography_index.sql`
8. `009_supabase_postgis_isolated_runtime_read_contract.sql`

The migration runner requires an explicit policy ID, rejects cross-policy ledgers, prints applied filenames only after commit, and uses the Supabase V2 policy for `npm run db:migrate`. First execution applied exactly the eight files above; the second execution emitted no applied file and changed no ledger row. Selecting historical V1 against the V2 ledger failed closed.

Migration `009` preserves the five SQL bodies from historical `008` byte-for-byte. It changes only the deployment topology/assertions, schema qualification and fixed function configuration needed for isolated PostGIS.

## Final schema and search-path design

The design follows Supabase's supported separate-schema PostGIS pattern: <https://supabase.com/docs/guides/database/extensions/postgis>.

| Identity/use | Fixed path | `trailmind_gis` |
| --- | --- | --- |
| Migration while `SET ROLE trailmind_app_owner` | `trailmind_app,pg_catalog,trailmind_gis,pg_temp` | `USAGE`, no `CREATE`, no grant option |
| Five definer functions | `pg_catalog,trailmind_app,trailmind_gis,pg_temp` | owner-mediated only |
| Regional import | `pg_catalog,trailmind_app,trailmind_gis,pg_temp` | `USAGE`, no `CREATE`, no grant option |
| Projection | `pg_catalog,trailmind_app,trailmind_gis,pg_temp` | `USAGE`, no `CREATE`, no grant option |
| App Attest runtime/pruner | `pg_catalog,trailmind_app,pg_temp` | none |
| Outdoor runtime | `pg_catalog,trailmind_app,pg_temp` | none |
| Cancellation control | `pg_catalog,trailmind_control,pg_temp` | none |
| Readonly auditor | `pg_catalog,pg_temp` | none |

PostGIS is created directly with `CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA trailmind_gis;` and no version clause. The disposable proof used PostgreSQL 17.10 and current default PostGIS 3.6.4. No PostGIS routine existed in `public`. The GIS schema is not a Data API schema and grants no untrusted `CREATE`.

## Exact operational-role matrix

| Role | Login/inherit | Application capability | Direct PostGIS |
| --- | --- | --- | --- |
| `platform_provisioner` | no/no | no application object privilege | denied |
| `migration_role` | yes/no | may only `SET ROLE trailmind_app_owner`; no inherited owner privilege | denied as itself |
| `regional_import_role` | yes/no | reviewed evidence import DML plus database `CREATE` for importer-owned staging schemas; no `CREATE` on trusted schemas | GIS `USAGE` |
| `projection_role` | yes/no | reviewed projection DML/read/helper only | GIS `USAGE` |
| `app_security_runtime_role` | yes/no | exact App Attest transactions, zero application functions | denied |
| `outdoor_research_runtime_role` | yes/no | exactly five reviewed definer functions, zero base-table privilege | denied |
| `outdoor_research_cancellation_control_role` | yes/no, limit 1 | one control function, target restricted to outdoor runtime | denied |
| `pruner_role` | yes/no | exact App Attest deletion set only | denied |
| `readonly_auditor_role` | yes/no | no product-data privilege in Phase 1 | denied |

All nine operational roles are `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`; the eight login roles are `NOINHERIT`. `anon`, `authenticated`, `service_role`, `PUBLIC`, runtimes, cancellation, pruning and audit have no GIS usage/create/grant option. The application function owner, import and projection roles are the only non-managed identities with GIS usage; none owns provider extension routines.

## Executable results

| Proof | Result |
| --- | --- |
| Supabase V2 static compatibility | 4/4 passed |
| Supabase V2 disposable role/runtime/adversarial integration | 11/11 passed |
| Focused staging/readiness/runtime contract suite | 147/147 passed |
| Portable PostGIS integration suites | 48/48 passed |
| Real App Attest PostgreSQL integration | 8/8 passed |
| Complete backend suite | 971/971 passed |
| Backend syntax build | passed |
| Offline outdoor-adventure quality evaluation | 101/101 passed |
| First V2 migration run | exactly `001-007 + 009` applied |
| Second V2 migration run | true no-op |
| Deliberate missing-GIS-usage failure | failed closed; zero application relations/functions and no ledger |
| Applied-foundation rollback attempt | correctly refused before deletion |
| Guarded V2 pre-only rollback | passed; zero roles, schemas and PostGIS remained |

The adversarial database suite proved:

- App Attest runtime and pruner admission with no public/GIS access;
- outdoor runtime execution of exactly five functions and no base-table read/write;
- direct `ST_Point`, `ST_Distance`, `geometry` and `geography` use denied to runtimes;
- public, temp and attacker-owned schema shadowing ineffective;
- DDL, DML, `TEMPORARY`, role grant, `BYPASSRLS`, ownership and grant-option denial;
- Data API role denial on private application/GIS schemas;
- import/projection/pruning/audit/migration separation;
- target-restricted cancellation and product-data blindness; and
- WGS84 distance plus required GiST index sanity.

## Historical integrity

The protected prior-attempt files remained byte-identical throughout this pass:

| File | SHA-256 |
| --- | --- |
| `PHASE_0_RESOURCE_DECISION.md` | `390fa66e83963e218161a853894cba4ff7cfe3ecb881fbeaa82dd71c98c620d5` |
| `PHASE_1_PRE_MIGRATION.sql` | `acbc878d02ddf04647c11fc6fa0f5df9ed4e53942dd9a3da7eedf5f01eee1be9` |
| `PHASE_1_POST_MIGRATION.sql` | `f67a92fc1d003b10601555973f263d2d5a50c53d0f95e67269e6901976611485` |
| `PHASE_1_BLOCKED_ROLLBACK.sql` | `4f4cdbaee71df8b5b4fd5fdc93dc5711c74cd9746c873fa1524196b52011378e` |
| `PHASE_1_FOUNDATION_PROOF.md` | `3209e082f48d33199c68b4cf7e4a8f4b8f08d3e1a07e09faf5faab5c1dabaaff` |
| `PHASE_1_FOUNDATION_PROOF.json` | `45c756fce9a68440c36f8c2cb0ed4228bf7047015166ec603700619abce646a6` |
| Historical migration `008` | `e568e6ea65bd0d6f96fd20f636efcbb42700c55856ea3f19d1955b6a9e415b32` |

## Remaining remote blockers

Remote Phase 1 is still **NO-GO** until an independent reviewer approves this unstaged candidate and a newly authorized remote turn repeats the identity/cost/empty-state/concurrency gates. That remote retry must use only the V2 pre-step, explicit V2 migration policy and V2 post-step; must re-run real Supabase advisors and production-containment checks; and must stop on any managed-platform semantic difference. The V2 pre-only rollback is not an applied-foundation rollback and correctly refuses application objects or a ledger.

No advisor result, remote role behavior, remote Data API behavior or remote readiness is claimed from this local receipt.

## Containment

- Supabase mutations/queries this turn: zero
- Production contact: zero
- Paid resources/cost: zero
- GraphHopper/AI/provider/application traffic: zero
- Imports/deployments/flags enabled: zero
- All 10 backend feature/provider/insecure defaults and all 3 outdoor iOS defaults: false
- Supabase onboarding sync default: also false
- Swift/iOS changes: zero
- Git stage/commit/push: none
