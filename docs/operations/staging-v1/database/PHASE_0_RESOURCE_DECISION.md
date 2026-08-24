# Staging database Phase 0 and resource decision

Status: free-project creation blocked by the provider's active Free-project limit; no staging resource was created.

Audit date: 2026-08-24 (Europe/Berlin)

## Baseline and ownership

- Fetched `origin/main`; both `HEAD` at task start and refreshed `origin/main` were `fc7ea47968aebd7c1c9be747d2abe97c707e4636`.
- Dedicated task branch: `codex/supabase-staging-data-v1`.
- Worktree was clean and detached before the dedicated branch was created; the index remains empty.
- Available local storage at the audit was 26 GiB on the data volume. Repository working data was 17 MiB. No PBF or derivative was downloaded.
- The active sibling tasks are `codex/staging-runtime-v1` (runtime owner) and `codex/staging-readiness-proof-v1` (proof owner). Neither owns remote Supabase database mutations or this task's local paths.
- No equivalent active staging database owner, staging Supabase project, or staging database branch was found in current tasks, worktrees, repository paths, Git branches, or the organization project inventory.

## Production containment receipt

The production project was accessed only through read-only Supabase MCP calls (`get`, `list`, advisors, and SQL `SELECT`). No migration, SQL DDL/DML, branch, key, Auth, extension, configuration, pause, restore, import, or other mutation was invoked.

Production identity observed read-only:

- organization: `Alibra AI` (`wbnftkftyamxzvxsftda`), Free plan;
- project: `TrailMind` (`bejvhhjbgtvctpsnlwid`);
- region: `eu-central-1`;
- status: `ACTIVE_HEALTHY`;
- PostgreSQL: engine 17, platform version `17.6.1.141`, server `17.6`;
- database size: 11,160,723 bytes at the audit;
- development branches: none;
- installed extensions: `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, and `uuid-ossp`; PostGIS is not installed;
- Supabase migration ledger: one migration, `20260712142911 app_attest_foundation`;
- application tables: six App Attest tables plus `onboarding_profiles` and `onboarding_events`, all in `public` with RLS enabled;
- application functions: three onboarding functions in `public`, all security-invoker with an empty search path and explicit ACLs;
- outdoor evidence/research schemas and roles: absent.

The database-local `pgrst.db_schemas` setting was not available, so the audit does not claim a dashboard Data API schema configuration that the MCP did not expose. It did verify object grants: App Attest tables have default `anon`/`authenticated` table grants but no permissive RLS policies, while onboarding tables have owner-scoped authenticated policies. Production security and performance advisors returned informational notices only, with no error/high finding. These production observations are out of scope for mutation in this task.

## Current Supabase guidance used

The current official changelog and MCP documentation were checked before this decision. Relevant current behavior:

- Explicit extension version pinning is ignored/deprecated; staging must install the current default PostGIS version without a version clause.
- New tables are no longer automatically exposed through Data/GraphQL APIs, but this does not replace private schemas, explicit revokes, or RLS.
- The legacy Management API `logs.all` endpoint is being removed on 2026-09-23; future log tooling must use the current `logs` endpoint/ClickHouse contract.
- Temporary token-based database access is a disabled-by-default feature preview and requires PostgreSQL `17.6.1.081` or newer. It may be useful for bounded operator access, but it is not assumed for runtime credentials.
- Direct connections are the documented choice for migrations, `pg_dump`, and native Postgres commands; Supavisor session mode is for persistent IPv4 application clients; transaction mode is for temporary/serverless application clients.
- Network restrictions apply to direct and pooled database routes. IPv4 and IPv6 CIDRs may both be required.
- Managed daily backups are documented for Pro, Team, and Enterprise projects only. Free projects require regular logical exports and off-site retention. Custom-role passwords are not included in managed backups and must be reset after restore.
- Free projects with low activity may be paused after a seven-day low-activity window and have a 90-day dashboard restore window.

Primary documentation:

- https://supabase.com/docs/guides/deployment/branching
- https://supabase.com/docs/guides/platform/manage-your-usage/branching
- https://supabase.com/docs/guides/platform/free-project-pausing
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/docs/guides/database/postgres/roles
- https://supabase.com/docs/guides/database/extensions/postgis
- https://supabase.com/docs/guides/platform/network-restrictions
- https://supabase.com/docs/guides/platform/temporary-access
- https://supabase.com/docs/guides/database/database-advisors

## Source-to-staging dependency graph

```text
Alibra AI organization
└── separate TrailMind staging project (fresh project ref; no production parent)
    ├── platform provisioner
    │   ├── install current default PostGIS in trusted `public`
    │   ├── revoke untrusted `CREATE` on trusted search-path schemas
    │   └── create NOLOGIN owner + distinct operator/runtime roles
    ├── non-exposed application schema owned by NOLOGIN/NOINHERIT owner
    │   └── backend/scripts/migrate.js (one transaction + advisory lock)
    │       ├── 001 App Attest durable tables
    │       ├── 002 regional evidence/import tables + GiST/B-tree indexes
    │       ├── 003 normalized research graph + validation triggers
    │       ├── 004 OSM policy/projection state + active views
    │       ├── 005 projected geometry constraints
    │       ├── 006 mapped-route membership point GiST index
    │       ├── 007 routable-highlight geography GiST index
    │       └── 008 five bounded SECURITY DEFINER runtime read functions
    ├── current official Geofabrik inputs
    │   ├── Niedersachsen + Sachsen-Anhalt + Thüringen -> bounded Harz PBF
    │   └── Austria -> bounded Innsbruck PBF
    │       └── verified publisher checksum/source time/digest
    │           └── import-outdoor-evidence.js
    │               ├── unique transient osm2pgsql schema
    │               ├── transaction-scoped regional advisory lock
    │               ├── immutable import/provenance rows
    │               └── atomic active-import promotion or rollback
    ├── configure-osm-outdoor-research-policy.js
    │   └── project-osm-outdoor-research.js
    │       ├── dry run (zero persistent rows/bytes changed)
    │       └── persistent atomic projection + quarantine accounting
    ├── bounded runtime boundary
    │   ├── App Attest read/write connection
    │   ├── outdoor runtime: five functions only, no base-table access
    │   ├── distinct cancellation/control connection
    │   └── provider and application flags remain false
    └── independent proof boundary
        ├── read-only auditor/operator connection
        ├── exact grants/RLS/DDL/DML/cross-role denial tests
        ├── static parameterized EXPLAIN (ANALYZE, BUFFERS, JSON)
        └── logical backup/restore verification in an approved target
```

The migrations use unqualified application object names. Therefore the reviewed way to keep all App Attest and outdoor objects outside the Data API without editing protected migrations is to apply migrations 001-008 with the migration owner and a non-exposed application schema first in `search_path`. Migration 008 explicitly supports that layout and stores a trusted fixed search path. PostGIS must remain reachable in trusted `public` because migration 008's captured path includes `public` for PostGIS; untrusted `CREATE` on both schemas must be absent.

## Resource comparison

| Requirement | Separate project | Persistent development branch |
| --- | --- | --- |
| Production containment | Fresh project and ref; no merge/rebase/reset path to production. | Separate instance and credentials, but it is a child of production and branch merge/rebase/reset operations exist. Creating it changes production project branch state. |
| Data and migration history | Fresh, empty environment; only reviewed staging migrations/imports are applied. | Data-less, but current production migrations are applied to the new branch and future branch workflows remain coupled to the production parent. |
| Lifecycle | Free project may auto-pause after low activity; data is resumable within the documented 90-day window. | Persistent branches are documented as long-lived and not automatically paused/deleted for PR closure or inactivity. |
| PostGIS/roles/network | Full project database supports extensions, roles/grants, stable endpoints, and project network restrictions. | Separate branch instance supports database changes and credentials, but branch-specific backup/network parity was not explicit enough in retrieved documentation to strengthen the containment case. |
| Backup/restore | Free plan has no documented managed daily backup; logical dump/off-site restore proof is required. PITR would require a separately approved paid plan/add-on. | Branch documentation does not establish an independent managed backup/PITR guarantee; logical backup is still required. |
| Capacity | Refreshed project quote is USD 0 monthly (Nano/Free constraints apply: 500 MB recommended DB size and up to 0.5 GB memory). Current-volume Harz/Innsbruck data must prove it fits. | Refreshed branch quote is USD 0.01344 hourly (about USD 9.81 for 730 hours), plus variable usage; Micro starts with a 10 GB recommended DB size and 1 GB memory. |
| Cleanup | Project deletion is irreversible and removes project backups; requires separate approval. | Branch deletion stops branch compute but is also irreversible for branch state; no deletion is authorized now. |

## Recommendation and exact approval boundary

Recommend a **separate Supabase project** because this task explicitly requires `bejvhhjbgtvctpsnlwid` to remain read-only, including no branch mutation. A development branch cannot satisfy that hard containment rule even though a persistent branch has a stronger inactivity lifecycle and more default capacity.

Exact proposed resource:

- organization: `Alibra AI` (`wbnftkftyamxzvxsftda`);
- resource type: separate Supabase project;
- name: `TrailMind Outdoor Staging V1`;
- region: `eu-central-1`;
- refreshed creation cost: **USD 0 monthly**;
- production project: not selected as a parent and remains read-only.

Known acceptance risks: Free/Nano capacity may be insufficient for the established approximately 221k regional trail segments plus duplicated projection evidence and spatial indexes; low activity can pause the project; managed daily backups/PITR are not included on Free. Creation approval does not approve a compute upgrade, paid plan, PITR, disposable paid restore target, destructive restore/reset, production mutation, feature enablement, or provider traffic. If capacity, backup, or restore requirements cannot be truthfully proven within the zero-cost project, work must stop for a new exact cost authorization.

## Approved free-only attempts and provider result

The owner subsequently approved exactly one separate project with the identity above, only at USD 0 monthly and with no paid add-on or other charge. Immediately before creation:

- the official changelog and relevant current documentation were refreshed;
- `Alibra AI` was confirmed as a Free organization;
- the production project was confirmed as `TrailMind` (`bejvhhjbgtvctpsnlwid`), healthy and not selected as the target;
- production still had no development branches;
- a duplicate project named `TrailMind Outdoor Staging V1` did not exist; and
- Supabase returned an exact create-project quote of `type=project`, `recurrence=monthly`, `amount=0`.

After the required zero-cost confirmation, the create request was rejected before provisioning because the organization owner already had the maximum two active Free projects. The provider reported a two-project active Free limit and required deleting, pausing, or upgrading another project to continue.

On the owner's explicit 2026-08-24 follow-up, the duplicate, organization-plan, production-containment, and quote gates were run again. The exact project name was still absent, production was still healthy with no branches, and the immediately refreshed quote was again exactly USD 0 monthly. One new zero-cost confirmation and one new create request were issued. Supabase rejected that request with the same two-active-Free-project limit before provisioning. No further retry, pause, deletion, upgrade, branch, add-on, backup/PITR product, custom domain, or alternate resource was attempted.

A final post-failure read-only inventory confirmed that no project named `TrailMind Outdoor Staging V1` exists and production remains `ACTIVE_HEALTHY` on platform version `17.6.1.141` with no branches. Database foundation, roles, extensions, migrations, imports, projections, backup/restore, advisors, and capacity tests were therefore not run because there is no authorized staging target.

Precise blocker: the approved zero-cost project cannot be created while the owner remains at Supabase's two-active-Free-project limit. Resolving this requires a new explicit decision about an existing non-production project or a paid plan; neither is authorized by this task.
