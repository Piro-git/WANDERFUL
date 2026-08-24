# Staging Environment and Secret Contract V1

The machine-readable source is
`backend/container/staging-runtime-contract-v1.json`. It contains names, types,
role classes and required states only. No credential values belong in source,
documents, commands, image layers, logs or receipts.

## Web process

Required non-secret identity/configuration names:

- `NODE_ENV`: exact production state;
- `TRAILMIND_RELEASE_STAGE`: exact staging state;
- `TRAILMIND_STAGING_PROJECT_REF_SHA256`: exact lowercase SHA-256 supplied by
  the database lane for the user-approved staging project identity;
- `APP_ATTEST_RUNTIME_ROLE`: exact least-privilege role name supplied by the
  database lane and matched to the URL username;
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
without execution arguments. The app-security pool pins
`search_path=pg_catalog,public`, and startup verifies the effective value before
listen. Because pre-main Node options act before JavaScript admission, the
platform configuration receipt must independently prove these names absent.

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
and all operator/control credentials are forbidden from the web process. The
staging admission report returns only check names and pass/fail state.

## Control/pruner job

The one-shot pruner receives `APP_ATTEST_CONTROL_DATABASE_URL` from a separate
secret scope using the database agent's least-privilege pruner role. The web
service does not receive it. The job adapter maps it only in process memory to
the existing pruning repository contract and removes the control name before
composition. It rejects any simultaneously supplied runtime source, preventing
role aliasing and shared secret scope, and emits only `succeeded` or `failed`.
It also requires the approved project-ref hash plus distinct exact runtime and
control role names, forbids unsafe process options, and pins the same schema
search path. Database denial proof remains authoritative for inherited/excess
grants and distinct credential ownership.

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

Missing secrets, wrong roles, wrong project hash, weak TLS, unsafe process
options, aliased runtime/control sources, malformed flags or enabled
capabilities all block before listen.
