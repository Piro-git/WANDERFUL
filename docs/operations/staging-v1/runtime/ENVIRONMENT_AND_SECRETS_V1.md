# Staging Environment and Secret Contract V1

The machine-readable source is
`backend/container/staging-runtime-contract-v1.json`. It contains names, types,
role classes, exact privilege manifests and required states only. No credential
values belong in source, documents, commands, image layers, logs or receipts.

## Web process

Required non-secret identity/configuration names:

- `NODE_ENV`: exact production state;
- `TRAILMIND_RELEASE_STAGE`: exact staging state;
- `TRAILMIND_STAGING_PROJECT_REF_SHA256`: exact lowercase SHA-256 supplied by
  the database lane for the user-approved staging project identity;
- `TRAILMIND_APPLICATION_SCHEMA`: required private application schema. It must
  match `^trailmind_[a-z][a-z0-9]*(?:_[a-z0-9]+)*$`, be at most 48 characters,
  and is never accepted as quoted, dotted, comma-separated, `public`, a system
  schema or a `pg_*` name;
- `APP_ATTEST_RUNTIME_ROLE`: exact least-privilege role name supplied by the
  database lane and matched to the URL username;
- `APP_ATTEST_CONTROL_ROLE` and `APP_ATTEST_OPERATOR_ROLE`: non-secret identity
  names used only to prove all three database responsibilities are distinct;
- App Attest app identity, environment, validation category and allowed build
  version names already validated by production preflight;
- bounded HTTP, App Attest, database and authorization settings when overriding
  reviewed defaults.

Required secret source:

- `APP_ATTEST_DATABASE_URL`: staging-only app-security runtime role; PostgreSQL
URL, Supabase staging project identifier present, TLS `verify-full`, CA path
under the platform secret-file directory, never a default owner, admin or
`service_role` identity.

`NODE_OPTIONS`, TLS verification overrides, Node debug/extra-CA switches and
PostgreSQL session/service overrides are forbidden. The container starts Node
without execution arguments. The app-security pool pins and verifies
`search_path=pg_catalog,"<validated_application_schema>",pg_temp` before
listen. `pg_catalog` first prevents built-in shadowing and explicit `pg_temp`
last prevents its implicit front-of-path placement. Both roles are denied
database `TEMPORARY`, `USAGE`/`CREATE` on `public`, managed `extensions`, and locked `trailmind_gis`,
and `CREATE` on every schema. PostGIS is installed directly in
`trailmind_gis`; App Attest tables exist only in the configured private schema,
and neither schema is exposed through the Supabase Data API. Because
pre-main Node options act before JavaScript admission, the platform
configuration receipt must independently prove the forbidden process names
absent.

For the recommended IPv4-only Render target, the database lane must provide the
Supavisor **session-mode** connection shape on port 5432 for a persistent Node
pool unless it separately approves a Supabase IPv4 option. Transaction mode on
6543 is not the reviewed persistent-pool topology.

The service must receive exact `false` for:

- `ROUTE_PROVIDER_ENABLED`
- `INTENT_PROVIDER_ENABLED`
- `OUTDOOR_EVIDENCE_PROVIDER_ENABLED`
- `OUTDOOR_RESEARCH_PLANNING_ENABLED`
- `OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED`
- every insecure-local, deterministic mock and in-memory App Attest switch

Provider keys, legacy generic database URLs, optional research/evidence URLs,
and all operator/control credentials are forbidden from the web process. Role
names are not credentials. The staging admission report returns only check
names and pass/fail state.

## Exact App Attest privilege manifests

Both identities are `LOGIN NOINHERIT` and must be neither superuser nor
`CREATEDB`, `CREATEROLE`, `REPLICATION` or `BYPASSRLS`. They own no database,
schema, table, sequence or function, have no direct or indirect role membership,
receive database `CONNECT` only, and receive schema `USAGE` only on the private
application schema. They receive no `public`, `extensions`, or `trailmind_gis` schema usage.
Grant options are forbidden.

The web runtime receives:

| Private table | Exact privileges |
| --- | --- |
| `app_attest_challenges` | `SELECT`, `INSERT`, `UPDATE` |
| `app_attest_keys` | `SELECT`, `INSERT`, `UPDATE` |
| `app_attest_route_sessions` | `SELECT`, `INSERT`, `UPDATE` |
| `app_attest_request_ids` | `INSERT` |
| `app_attest_rate_windows` | `SELECT`, `INSERT`, `UPDATE` |
| `app_attest_provider_leases` | `SELECT`, `INSERT`, `UPDATE` |

The control/pruner receives `DELETE` only on
`app_attest_challenges`, `app_attest_route_sessions`,
`app_attest_rate_windows` and `app_attest_provider_leases`; it receives no
privilege on the other two tables. Neither identity receives application,
public, managed-extension or PostGIS sequence/function privileges, other application/public relation privileges,
column-only extras, `TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN`, database
`CREATE`/`TEMPORARY`, or schema `CREATE`. Required role-scoped RLS policy
behavior remains part of the database lane's authoritative DML denial proof.

## Control/pruner job

The one-shot pruner receives `APP_ATTEST_CONTROL_DATABASE_URL` from a separate
secret scope using the database agent's least-privilege pruner role. The web
service does not receive it. The job adapter maps it only in process memory to
the existing pruning repository contract and removes the control name before
composition. It rejects any simultaneously supplied runtime source, preventing
role aliasing and shared secret scope, and emits only `succeeded` or `failed`.
It also requires the approved project-ref hash plus pairwise-distinct exact
runtime, control and operator role names, runs the exact control manifest
admission before pruning, forbids unsafe process options, and pins the same
schema search path. Database denial proof remains authoritative for RLS and
distinct credential ownership.

Migration, import, projection, backup, restore and audit sources are outside
this runtime package and must never be reused as either URL. The Node runtime
never uses a Supabase API service role or secret key.

## Rotation

1. Database/platform owner creates the replacement staging-only credential in
   its audited system; no value is pasted into this task.
2. User enters the replacement directly in the target service or job secret
   store. Old/new values are never logged, printed, hashed into receipts, or
   compared by the agent.
3. Start a candidate at the exact reviewed image digest. Require staging
   admission, production preflight, schema/grant admission and readiness.
4. Drain the prior instance within the platform grace period; verify pool and
   socket closure.
5. Revoke the old credential only after the new instance is ready and rollback
   authority confirms the prior digest can be restarted with an approved active
   credential.
6. Record only credential version aliases or rotation-event IDs supplied by the
   platform, never values.

Missing secrets/schema, malformed identifiers, wrong or aliased roles, wrong
project hash, weak TLS, unsafe process options, catalog/privilege drift,
malformed flags or enabled capabilities all block before listen.
