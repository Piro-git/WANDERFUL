# Phase 1 PostGIS Isolation V2 — Review Correction Proof

Status: **locally fixed; remote execution remains blocked**

Proof date: 2026-08-25 (Europe/Berlin)

Repository baseline and fetched `origin/main`: `72b98e3e065ae442168ece20984d8baba26e2d11`

This append-only receipt corrects the current V2 candidate after independent
review. It supersedes only the implementation and local-test assertions in
`PHASE_1_POSTGIS_ISOLATION_V2_LOCAL_PROOF.md` and `.json`; it does not replace,
edit, or reinterpret the protected blocked/compensated remote receipt except
through `PHASE_1_FOUNDATION_PROOF_ERRATUM_001.md` and `.json`.

No Supabase project, remote database, production system, Planua, GraphHopper,
AI provider, or application provider was contacted during this correction.
This proof establishes a disposable PostgreSQL/PostGIS contract, not managed
Supabase readiness.

## Review blockers corrected

1. The real runner now verifies a genuine `migration_role` login, its
   `NOINHERIT`/non-elevated attributes, exact `SET` membership in the NOLOGIN
   `trailmind_app_owner`, schema ownership, isolated GIS access, and the
   trusted migration path. It acquires the foundation advisory transaction
   lock and executes `SET LOCAL ROLE trailmind_app_owner` before creating or
   reading the ledger and before applying migrations. Applied filenames are
   returned and printed only after `COMMIT`.
2. The V2 post-step requires exact non-superuser managed-operator identity and
   attributes, asserts exact memberships in both NOLOGIN owners, and performs
   explicit bounded transitions to `trailmind_app_owner` and
   `trailmind_control_owner` on their respective fixed trusted paths.
3. A managed-style `extensions` fixture starts with `USAGE` granted to
   `PUBLIC`. The post-step removes TrailMind principals' effective shared
   extension capability while preserving every snapshotted non-TrailMind
   provider principal explicitly. Runtime admission checks effective
   `public`, `extensions`, and `trailmind_gis` schema/routine privileges and
   grant options; `NOINHERIT` is never treated as removing `PUBLIC` grants.
4. The pre-step snapshots raw and semantic database, `public`, and
   `extensions` ACL state, including grantee, grantor, privilege and grant
   option. It deliberately does not mutate shared ACLs before a foundation
   ledger can exist. PostgreSQL 17 proved that a null/default ACL cannot be
   restored byte-for-byte after revoke-and-regrant because it becomes an
   explicit ACL. Shared hardening therefore occurs only in the atomic
   post-step. Pre-ledger compensation requires exact raw and semantic equality
   and performs only exact guarded object drops—never `DROP OWNED` or
   `CASCADE`.
5. The compensation refuses a ledger or application foundation, unexpected
   enum/domain/operator/owned object, or active TrailMind session. Tests prove
   provider fixture preservation, exact ACL equality, zero foundation residue,
   and fail-closed repeated compensation.
6. The future operator gate verifies the exact staging project, organization,
   region, healthy state, Free/Nano USD 0/month state with five-minute
   freshness, both pre-advisors, empty TrailMind/PostGIS state, Data API
   exclusions, exact shared-ACL and restoration-plan digests, managed operator
   and `extensions` ownership/control, no sibling writer, one nonwaiting
   advisory lock, and a second state digest under the lock. It hard-denies the
   protected production and Planua project references. The committed CLI has
   no live adapter and stops with `remote_adapter_required_and_execution_not_authorized`.
7. Active runbooks, manifests, runtime contracts, admission tests, and backend
   documentation now distinguish the two mutually exclusive migration
   policies. Mixed, foreign, reordered, and hole-bearing ledgers are rejected
   before migration work.

## Migration policy and command contract

Historical portable V1 remains exactly migrations `001` through `008`.
Supabase isolated V2 is exactly migrations `001` through `007`, followed by
`009_supabase_postgis_isolated_runtime_read_contract.sql`. Historical `008`
remains byte-identical and is never applied in V2.

The generic command `npm run db:migrate` requires the caller to set the exact
`TRAILMIND_MIGRATION_POLICY`; it cannot silently select Supabase V2. The named
commands are:

- `npm run db:migrate:historical-portable-v1`
- `npm run db:migrate:supabase-postgis-isolation-v2`

The real runner orders ledger assertions by `applied_at, version`, accepts only
an exact valid prefix, serializes concurrent runs under one bounded advisory
lock, and applies a transaction-local 30-second statement bound before taking
that lock. It rolls back migrations and ledger writes atomically and emits no applied
filename before commit. Disposable execution proved an exact eight-file first
run, a zero-output second run, valid-prefix resume, and fail-closed hole,
reorder, foreign, and cross-policy handling.

## Schema, ownership, and search paths

PostGIS is installed directly and without a version clause:

`CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA trailmind_gis;`

No PostGIS routine exists in `public`; `trailmind_gis` is outside the Data API
schema list and is not writable by untrusted identities.

| Identity/use | Fixed path | Shared/PostGIS capability |
| --- | --- | --- |
| Migration after `SET LOCAL ROLE trailmind_app_owner` | `trailmind_app,pg_catalog,trailmind_gis,pg_temp` | GIS `USAGE`, no `CREATE` or grant option |
| Five definer functions | `pg_catalog,trailmind_app,trailmind_gis,pg_temp` | owner-mediated PostGIS only |
| Regional import | `pg_catalog,trailmind_app,trailmind_gis,pg_temp` | GIS `USAGE`, no shared-schema write |
| Projection | `pg_catalog,trailmind_app,trailmind_gis,pg_temp` | GIS `USAGE`, no shared-schema write |
| App Attest runtime/pruner | `pg_catalog,trailmind_app,pg_temp` | no `public`, `extensions`, or GIS capability |
| Outdoor runtime | `pg_catalog,trailmind_app,pg_temp` | five definer functions only; no direct shared/PostGIS capability |
| Cancellation control | `pg_catalog,trailmind_control,pg_temp` | one target-bounded control function only |
| Readonly auditor | `pg_catalog,pg_temp` | no product or shared-extension capability |

## Exact operational-role matrix

| Role | Login/inherit | Membership and application capability | Direct PostGIS |
| --- | --- | --- | --- |
| `platform_provisioner` | no/no | no application-object privilege | denied |
| `migration_role` | yes/no | exact `SET`-only membership in `trailmind_app_owner`; no inherited owner privilege | denied as itself |
| `regional_import_role` | yes/no | reviewed import DML and importer staging-schema creation; no trusted-schema `CREATE` | GIS `USAGE` only |
| `projection_role` | yes/no | reviewed projection DML/read/helper access | GIS `USAGE` only |
| `app_security_runtime_role` | yes/no | exact App Attest transactions; zero application functions | denied |
| `outdoor_research_runtime_role` | yes/no | exactly five reviewed SECURITY DEFINER functions; zero base-table privilege | denied |
| `outdoor_research_cancellation_control_role` | yes/no, connection limit 1 | one control function restricted to outdoor runtime | denied |
| `pruner_role` | yes/no | exact App Attest deletion set | denied |
| `readonly_auditor_role` | yes/no | no Phase 1 product-data privilege | denied |

All nine operational roles are `NOSUPERUSER NOCREATEDB NOCREATEROLE
NOREPLICATION NOBYPASSRLS`; every LOGIN operational role is `NOINHERIT`.
`anon`, `authenticated`, `service_role`, `PUBLIC`, runtimes, cancellation,
pruning, and audit receive no direct application or PostGIS privilege. The
application function owner, import role, and projection role are the only
non-managed identities with GIS usage; none owns provider extension routines.

## Executable local proof

The disposable harness used PostgreSQL 17.10 and PostGIS 3.6.4, Unix-domain
sockets only, no TCP listener, genuine non-superuser LOGIN roles, and NOLOGIN
owners. Every task-created cluster was stopped and removed.

| Proof | Result |
| --- | --- |
| V2 static contract | 5/5 passed |
| V2 exact rollback/ACL restoration | 7/7 passed |
| Real migration-runner state machine | 6/6 passed |
| Managed-style V2 role/runtime/adversarial PostGIS | 12/12 passed |
| Portable historical V1 PostGIS plus App Attest integration | 56/56 passed |
| Combined disposable PostgreSQL/PostGIS harness | 81/81 passed |
| Focused staging/admission/readiness/proof suite | 168/168 passed |
| Focused OSM migration runner regression | 7/7 passed |
| Complete backend suite | 992/992 passed; 0 failed, skipped, cancelled, or todo |
| Backend syntax build | passed |
| Offline outdoor-adventure quality evaluation | 101/101 passed; 0 failed or skipped |

App Attest admission passed with its exact table/RLS transactions, no
application functions, and no direct `public`, `extensions`, or GIS access.
Outdoor runtime admission passed with exactly five reviewed definer functions,
no base-table DML/read, and no direct PostGIS routine/type/cast access. Direct
`ST_Point`, `ST_Distance`, geometry, and geography use failed for runtime roles
but worked behind the reviewed functions. Public, temp, and attacker-owned
shadow attempts failed. DDL, role/grant escalation, `TEMPORARY`, ownership,
grant-option, cross-membership, unintended writes, and direct Data API access
were denied. Cancellation remained target-restricted and product-data blind.

## Protected historical integrity and erratum

The following bytes remain unchanged:

| File | SHA-256 |
| --- | --- |
| `PHASE_0_RESOURCE_DECISION.md` | `390fa66e83963e218161a853894cba4ff7cfe3ecb881fbeaa82dd71c98c620d5` |
| `PHASE_1_PRE_MIGRATION.sql` | `acbc878d02ddf04647c11fc6fa0f5df9ed4e53942dd9a3da7eedf5f01eee1be9` |
| `PHASE_1_POST_MIGRATION.sql` | `f67a92fc1d003b10601555973f263d2d5a50c53d0f95e67269e6901976611485` |
| `PHASE_1_BLOCKED_ROLLBACK.sql` | `4f4cdbaee71df8b5b4fd5fdc93dc5711c74cd9746c873fa1524196b52011378e` |
| `PHASE_1_FOUNDATION_PROOF.md` | `3209e082f48d33199c68b4cf7e4a8f4b8f08d3e1a07e09faf5faab5c1dabaaff` |
| `PHASE_1_FOUNDATION_PROOF.json` | `45c756fce9a68440c36f8c2cb0ed4228bf7047015166ec603700619abce646a6` |
| Historical migration `008` | `e568e6ea65bd0d6f96fd20f636efcbb42700c55856ea3f19d1955b6a9e415b32` |

Erratum 001 records the correct migration-006 SHA-256,
`13ad98c4fc0fa19b27ad7a398bbaca8a6dfdfb1a29616e2de25c4a877843e8c4`,
and clarifies that historical `providerCalls: 0` means no GraphHopper, AI, or
application-provider calls—not no Supabase control-plane operation. Its
Markdown and JSON SHA-256 values are respectively
`df2bb5a7b008ac822ea7a555ff487dc565d93ada0374cd9c17f64c1a7de02b8e`
and `1f72741e1f7f3682107efeba7659eb356c845264f3c079317bc3d333a04761e2`.

## Candidate source bindings

| File | SHA-256 |
| --- | --- |
| Migration `009` | `de440269a78c81d36e9f1da05cb81dc52f8a29440ff43b4c2aad3cc7dcc715cc` |
| Migration runner | `1c1be8a2e3ac6c34729e8b5aa0ae4586f08dd82ac4e951a3ed69f7bc6fe501cf` |
| Migration-policy selector | `be8fbb0e5798f8b466c67c2fd97e0346c4cc41f5234eea3350eaabb69aa0847a` |
| Future operator gate | `72e9db1eb274275a77b3799b8e26b3a0d8fa1edf68bb9c7804435559c06ec414` |
| V2 pre-step | `1a3270109816152c1fa3e0a750aedc1e9a6025e777cec6b1928aee5f1caa7011` |
| V2 post-step | `b2b09db6e1ac0cf3568ed96a2d0b1e21ab4053322f06453d8a93231100133a51` |
| V2 pre-ledger compensation | `7fd59051e6df1a0e9c8d2faa030bdc31df23a8cc37734583666dfdaccbc968d0` |

## Remaining remote gates

No local P1/P2 defect remains after this correction and self-review. Managed
Supabase behavior remains deliberately unproved. A fresh authorized remote
turn must verify, before mutation, the exact project/org/region/health/cost,
current advisors, database and `extensions` owners, managed operator role
attributes/memberships, ability to install PostGIS directly in
`trailmind_gis`, ability to normalize the provider-managed shared ACLs while
preserving provider identities, Data API schema exposure, empty TrailMind
state, production/Planua containment, and absence of sibling sessions. Any
semantic or authority mismatch is a hard stop, not an invitation to weaken the
contract.

The future retry must use the reviewed operator adapters, V2 pre-step, explicit
V2 runner command, and V2 post-step under one bounded lock; prove the second
runner execution is a no-op; run both advisors after DDL; and re-attest
production containment and all thirteen false feature/provider/insecure
defaults. No applied-foundation rollback exists; the bounded compensation is
pre-ledger only and must refuse after a foundation exists.

## Official references consulted

- <https://supabase.com/docs/guides/database/extensions/postgis>
- <https://supabase.com/docs/guides/database/extensions>
- <https://supabase.com/docs/guides/database/postgres/roles>
- <https://supabase.com/docs/guides/database/hardening-data-api>
- <https://supabase.com/changelog>

## Containment

- Remote Supabase/control-plane/database calls: zero
- Production and Planua contact: zero
- Secrets, passwords, keys, JWTs, connection strings, or provider URLs read or emitted: zero
- Paid resources/cost: zero
- GraphHopper/AI/application-provider calls: zero
- Deployments, imports, feature flags enabled: zero
- All ten backend and three iOS feature/provider/insecure defaults: false
- Swift/iOS changes: zero
- Git stage/commit/push: none
