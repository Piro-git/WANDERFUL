# Wanderful Staging Runtime V1

Status: **PROVIDER-NEUTRAL OCI SOURCE READY; REMOTE DEPLOYMENT BLOCKED**

Source baseline: `fc7ea47968aebd7c1c9be747d2abe97c707e4636` from fetched
`origin/main` on 2026-08-24. This lane does not own staging database creation,
schema, roles, imports, remote SQL, proof receipts, or provider admission.

No account, service, hostname, certificate, DNS record, secret, provider call,
remote database or remote deployment has been created by this task. A
disposable local PostgreSQL 17/PostGIS cluster was used only for catalog denial
tests and removed afterward. Attempt 13 is not authorized. The production
Supabase project is excluded by admission and operator policy.

## Reviewed standalone topology

```text
untrusted iOS client / internet
  -> operator-approved HTTPS container ingress
     -> bounded dependency-free GET /health/live
     -> privacy-safe cached GET /health/ready
     -> container staging admission (exact stage, flags, approved project/role,
        TLS, process options and secret scope)
     -> existing production configuration preflight
     -> app-security PostgreSQL pool
        -> configured private application schema
        -> exact App Attest role/object/privilege admission probe
        -> durable App Attest repository and verifier
     -> bind/listen only after admission
     -> request bounds, cancellation and drain registration
        -> App Attest endpoint and durable security state
        -> provider/research/evidence/intent endpoints: all disabled
     -> allowlisted coarse JSON events on stdout

separate operator/control job boundary
  -> separately injected pruner role source
  -> bounded App Attest prune command
  -> success/failure freshness event only

never co-resident in the web process:
  migration/import/projection/backup/restore authority, service_role,
  provider credentials, proof credentials, production database access
```

The standalone lifecycle remains
`backend/src/operations/serviceLifecycle.js`. The container entry point adds
only staging-specific admission and then calls that lifecycle. The bare
`backend/api/index.js` serverless export is not equivalent: it has no startup
preflight, explicit pool ownership, cached readiness, or signal-driven drain.

## Trust boundaries

| Boundary | Accepted data | Rejected or never emitted |
| --- | --- | --- |
| HTTPS ingress to Node | HTTP method/path, bounded headers/body, socket peer | Unverified proxy headers as trusted identity |
| Node to App Attest | Bounded Apple assertion contract and hashed opaque identifiers | Raw assertions in logs/metrics |
| Node to PostgreSQL | Parameterized App Attest operations under one runtime role | Provider keys, prompts, geometry, operator authority |
| Health/preflight | Fixed state words and presence-only checks | URLs, roles, table detail, errors, credentials |
| Operational events | Allowlisted enums, buckets, timestamps | Prompts, coordinates, geometry, headers, payloads, request IDs |
| Operator job | One separately injected control/pruner source | Co-injection into the public web process |

The selected ingress must independently prove how client identity is derived.
The source deliberately does not trust generic forwarded headers. Until that
proof exists, socket-peer bucketing is fail-safe but may group clients behind
the platform proxy and is not a closed-beta traffic-control receipt.

## Locally corrected blockers

- The app-security startup/readiness probe now checks all required App Attest
  relations in one configured private schema and exact privileges rather than
  accepting a shadow object, `SELECT 1`, or open-ended grants.
- Every owned `pg.Pool` has a coarse idle-error listener that makes readiness
  false without logging the error object; the cached probe can later recover.
- Staging admission requires every provider, research, evidence, routable-access
  and insecure/local flag to be exact `false`.
- Unsafe Node/TLS/PostgreSQL process options are forbidden. The app-security
  pool pins and verifies
  `search_path=pg_catalog,<private_application_schema>,pg_temp`.
- The application schema name is a bounded, unquoted `trailmind_...`
  identifier. SQL receives it only as a parameter; the startup option uses the
  safely quoted validated identifier. `pg_catalog` is first, `pg_temp` is last,
  and neither runtime identity may create in any schema or create temporary
  objects. Both lack `USAGE` on `public`, managed `extensions`, and locked
  `trailmind_gis`; PostGIS is installed directly in the latter and application
  tables remain outside Data API schemas.
- Runtime admission rejects direct/indirect memberships, unsafe role
  attributes, ownership, grant options, unexpected schema access, public
  shadows, and excess table/column/sequence/function privileges.
- The runtime requires the database lane's approved project-ref hash and exact
  runtime role name; a generic non-production Supabase project is insufficient.
- Runtime, control/pruner and operator role names must be pairwise distinct.
  Control and operator credentials are forbidden from the long-running web
  process, and the control job rejects a runtime source.
- The OCI build context is an allowlist. Tests, scripts, migrations, proof
  material, local config, PBFs and logs are not copied.

## External gates

- exact platform/account/workspace/region/cost approval;
- database agent delivery of an isolated staging resource, approved project-ref
  hash, private schema identity, exact distinct least-privilege
  runtime/pruner/operator roles, applicable RLS policy proof, inherited/excess
  grant denial proof, and CA material;
- image build/push, Node/base/filesystem inspection and immutable registry digest (no local OCI engine is
  installed in the current workspace);
- deployed HTTPS, ingress identity, restart/drain/outage and prior-digest
  rollback receipts owned by the proof lane;
- remote log sink, alert routing and retention approval;
- backup and regional freshness signals from the database lane.

See the adjacent decision, environment, monitoring and drill documents before
any approval or remote mutation.
