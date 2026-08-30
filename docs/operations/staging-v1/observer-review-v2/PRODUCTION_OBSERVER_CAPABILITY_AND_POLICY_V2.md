# TrailMind Phase 1 V2 production observer capability and evidence policy

Status: **REVIEWABLE V2 CANDIDATE; BOTH ADMISSION LEVELS BLOCKED**

Decision date: 2026-08-30

Evidence access date: 2026-08-30

Reconciliation baseline: `adea2c08540e87f0acd7eebb976c72eab8eb76c3`

Reconciled inputs: correction `68887cf9cd3e8ce28a05cd2ca7eb9e5d5ed5f8ac`,
capability policy `b8fdcc8539dc149fd0cfac783602073ae5567f24`, and
adversarial acceptance `a38677e67b23916e27d7c8f594866ab746a60921`

Independent review: `4821c9b29e070be53c0c22873cb7af124434b985`

This is the evidence policy for the Phase 1 V2 production observer. It is not an execution receipt and does not authorize a Supabase call, database connection, deployment, feature flag, factory registration, or live initialization. The companion JSON is the machine-verifiable acceptance contract.

## Decision and claim boundary

| Decision surface | State | Reason |
|---|---|---|
| Review and merge this dormant code candidate | **REVIEWABLE** | The code-controlled defects are closed and the offline adversarial suite proves both valid acceptances and correct typed blocks. This is not operational admission. |
| `staging_initialization` | **BLOCKED** | This level is only for one empty, internal, disabled staging initialization. It requires the reviewed static replacement gates, all five pins, independently provisioned auditor proof, two independent cleanup sessions, and signing proof. Those inputs are not present. Exact invoice/usage and causal Advisor freshness remain explicitly unavailable or unproved and are not claimed as verified. |
| `production_admission` | **BLOCKED** | In addition to all staging requirements, production requires exact billing/usage evidence, provider-enforced project isolation, causal Advisor freshness, and the full production security and operational evidence set. Available provider surfaces do not currently prove those properties. |
| Register or make either factory reachable | **BLOCKED** | The factory remains unregistered and all product, provider, and production flags remain disabled until the applicable admission level returns a typed pass. |

The two levels are independent contracts. Passing `staging_initialization` in a
future reviewed revision would not imply or promote `production_admission`.
For staging, an authoritative response may support only these narrow recorded
observations: the organization reported `Free`, inventory reported `nano`, and
the selected add-on response contained no positive-priced selected add-on.
Those observations are not an invoice, an exact `$0` usage statement, an
organization balance, or proof of causal Advisor freshness.

The five exact unmet pins remain intentionally null:

- `artifactContract.key.keyId`
- `artifactContract.key.requiredPinnedPublicKeySpkiSha256`
- `auditorContract.connection.sslrootcertSha256`
- `staticGate.independentCatalogAssertionProgramSha256`
- `staticGate.independentExpectedManifestSha256`

No runtime input, permissive default, mock, or self-derived digest may replace
one of these pins.

The duplicate/staleness gate found no newer equivalent capability decision on current `origin/main` or active refs. `origin/main` was inspected at `adea2c08540e87f0acd7eebb976c72eab8eb76c3`; the implementation and independent review remain the relevant active decisions.

## Required architecture

The accepted architecture is a fail-closed observer with distinct staging and
production admission evaluators. Its control-plane reads, database audit,
mutation, and artifact signing are separate authorities.

1. A control-plane reader uses one fine-grained access token containing exactly `project_admin_read`, `organization_admin_read`, `organization_projects_read`, and `infra_add_ons_read`. `advisors_read` may be added only when advisor output is collected as unsigned-in-meaning diagnostic data. The observer has a literal method/path/query allowlist and rejects redirects.
2. The credential’s principal must be independently proven unable to access `cmkvbxppgofteoutfslp` and `bejvhhjbgtvctpsnlwid`, not merely prevented by client code. On the current Free organization that proof is unavailable, so the run is blocked. A local allowlist is defense in depth, not credential isolation.
3. A pre-provisioned PostgreSQL login role, `trailmind_phase1_v2_stats_auditor`, connects only to the direct staging endpoint. It owns nothing, has no TrailMind schema/table/routine privileges, has no write privileges, and receives only a non-inheriting, non-admin, settable membership in `pg_read_all_stats`. It is provisioned and later revoked by an owner in a session separate from both the migration and observer.
4. The migration uses its separately authorized mutation identity. The auditor never receives the mutation secret and the mutator never receives the auditor secret.
5. Advisor results are diagnostic only. Admission uses the digest-pinned Phase 1 pre/post SQL plus an independently executed, read-only catalog/security assertion program after commit. The independent program and its expected result manifest must be added and reviewed before a live run.
6. Four canonical JSON artifacts are signed with a one-run Ed25519 key whose public SPKI SHA-256 digest is pinned by a reviewed source/contract revision before any factory becomes reachable.
7. The immutable source/package manifest and acceptance-contract digest are
   reviewed literals. Factory registration occurs only after the applicable
   admission evaluator also verifies the static assertion program, expected
   catalog manifest, CA, signing key, auditor, cleanup, and operator receipts.
   Runtime self-hashing is not a substitute.

Neither level is currently satisfiable. Staging is blocked by missing reviewed
pins and operational auditor/signing/static-gate evidence. Production has those
same blockers and additionally lacks exact billing/usage proof, causal Advisor
freshness, and provider-enforced project isolation. The latter production-only
limitations must not be misreported as satisfied merely because a future
disabled staging initialization can truthfully record narrower observations.

## A. Billing and the strongest honest zero-cost claim

### Credential support and permission

The current Management API specification marks `GET /v1/projects/{ref}/billing/addons` with the fine-grained permission `infra_add_ons_read`. Unlike the project, organization, project-list, and advisor endpoints, the billing-addons operation has no documented OAuth scope. The current OAuth scope list contains no billing or add-on scope.

Therefore:

- a fine-grained access token with `infra_add_ons_read` is the documented credential for this endpoint;
- an OAuth application is **not accepted** for billing admission because current official documentation does not grant it a billing/add-on scope;
- the observer must not silently replace the billing read with project metadata or a synthesized price.

The complete accepted read set is:

| Method and path | Required fine-grained permission | OAuth scope shown by the current API specification | Admission use |
|---|---|---|---|
| `GET /v1/projects/mbvzwsrtqcrwhvykugcd` | `project_admin_read` | `projects:read` | Exact project ref, org, region, status, database metadata |
| `GET /v1/organizations/wbnftkftyamxzvxsftda` | `organization_admin_read` | `organizations:read` | Exact organization identity and plan metadata |
| `GET /v1/organizations/wbnftkftyamxzvxsftda/projects?limit=100&offset=0&sort=name_asc` | `organization_projects_read` | `projects:read` | Inventory, protected-ref detection, `infra_compute_size` |
| `GET /v1/projects/mbvzwsrtqcrwhvykugcd/billing/addons` | `infra_add_ons_read` | none documented | Selected add-ons and their published price metadata |
| `GET /v1/projects/mbvzwsrtqcrwhvykugcd/advisors/security?lint_type=sql` | `advisors_read` | `database:read` | Diagnostic only |
| `GET /v1/projects/mbvzwsrtqcrwhvykugcd/advisors/performance` | `advisors_read` | `database:read` | Diagnostic only |

No other hostname, method, path, query, body, pagination, or redirect is accepted.

### Project isolation

Supabase documents project-scoped organization roles and the Read-Only role as Team/Enterprise features. On Free, the organization role applies across the organization. Current official token documentation describes fine-grained endpoint permissions but does not document a resource-binding control that restricts a token to one project ref. Personal access tokens can have a custom expiration but retain the privileges of their user. OAuth tokens can be short-lived and scoped, but the OAuth scope list does not include billing/add-ons.

Consequently, no single current credential is proven to meet all three properties required here: short-lived, billing-capable, and cryptographically/provider-enforced staging-project-only. The immutable staging project shares an organization inventory with protected refs. The observer may not infer isolation from its URL allowlist. This is a platform/control-plane blocker, not an implementation detail that code can waive.

### What the add-ons response proves

The response schema contains `selected_addons` and `available_addons`. A selected item has `type` and `variant`; a variant has `id`, `name`, and `price`; a price has `description`, `type`, `interval`, and `amount`. Price type may be `fixed` or `usage`, and interval may be `monthly` or `hourly`.

The response can prove only what the provider reported at that observation instant:

- which add-on variants were selected;
- the published price metadata attached to each selected variant;
- whether any selected item carried a positive numeric price amount;
- in conjunction with organization project inventory, whether `infra_compute_size` was reported as `nano`.

It cannot prove an exact invoice total or exact `$0` amount due. It does not settle metered usage, hourly proration, credits, taxes, prior-period usage, organization-level charges, project transfers, or invoice timing. It also cannot safely prove `nano` from the add-ons schema alone: the current selected-compute enum begins at `ci_micro`, while project inventory separately exposes `infra_compute_size` including `nano`.

The strongest allowed receipt claim is:

> At the recorded observation time, the Supabase Management API reported the staging project’s compute size as `nano`, and its `selected_addons` response contained no selected add-on whose published numeric price amount was positive. This is not an invoice and does not prove an exact `$0` organization balance or amount due.

Forbidden claims include “monthly cost is exactly $0,” “the invoice is $0,” “no bill can occur,” “Free has no usage charges,” or a monthly total obtained by summing mixed monthly, hourly, fixed, and usage prices.

## B. Advisor freshness and the replacement gate

Both advisor GET operations are currently marked deprecated and experimental in the official Management API specification. Their response schema contains only `lints`. A lint includes descriptive fields such as `name`, `title`, `level`, `facing`, `categories`, `description`, `detail`, `remediation`, `cache_key`, and optional metadata.

The schema exposes no provider run ID, computation timestamp, schema version, database transaction ID, LSN, DDL digest, or other marker that can bind a response to this migration. The current Management API specification exposes no advisor trigger/rerun operation. Supabase’s advisor guide describes automatic checks and a manual dashboard rerun, but does not define a bounded API operation that returns a causally corresponding completion receipt. No supported API replacement was found in the current Management API specification, advisor guide, CLI reference, or changelog. That last statement is an inference from the official surfaces inspected, not a provider guarantee that no internal mechanism exists.

The observer must therefore:

- label advisor output `diagnostic_unproven_freshness`;
- preserve the provider response digest and local retrieval time only as transport observations;
- never assign a local `computed_at`, `completed`, or equivalent provider status;
- never use zero lints as an admission predicate;
- never claim the response was recomputed after this DDL.

### Static replacement gate

For one empty staging initialization only, the accepted replacement is a narrow static gate:

1. Pin and execute the exact pre-migration program `PHASE_1_PRE_MIGRATION_V2.sql` at SHA-256 `feb13b3f6ea6a538f6cd5223030fecca1cb0195bce3e0eb0204aed704ea0c16b`.
2. Pin and execute the exact post-migration program `PHASE_1_POST_MIGRATION_V2.sql` at SHA-256 `3945c51cf26ca178e2bb2d6bfa7ac49aa6cf1bbcb268bf68272216efce153456` inside the mutation protocol.
3. After commit, use the independent auditor to run a new, read-only catalog/security assertion program. It must verify the migration’s expected role attributes and memberships; owners; schemas; PostGIS namespace; relation, sequence, function, and schema ACLs; RLS enablement/forcing and policies; security-definer function owner/search path/execute ACL; default privileges; index/constraint definitions; absence of unexpected TrailMind objects; and absence of mutation privileges for the auditor.
4. Compare its canonical result to a reviewed expected manifest. Both the program SHA-256 and expected manifest SHA-256 must be literal values in a reviewed implementation revision. They are intentionally absent today, so this gate is blocked rather than silently underspecified.

The independent program must use catalog reads only, run in `BEGIN TRANSACTION READ ONLY`, use `pg_catalog`-qualified names, set bounded statement/lock/idle timeouts, and reject any result containing an unknown assertion identifier or a non-boolean value. The implementation must not manufacture an expected digest from the live result.

This gate does not cover workload-dependent or time-dependent advisor risks: unused or duplicate indexes under real traffic, query-plan regressions, bloat, data distribution, connection exhaustion, provider configuration outside the database catalogs, network exposure, leaked credentials, SSL policy drift, PITR/backups, evolving advisor rules, or future data-dependent RLS/application mistakes. It can support one initialization of an empty staging database after every other blocker closes. It cannot approve closed beta or production.

## C. Independent least-privilege auditor on Supabase Free

### Role contract

The role can be created in PostgreSQL 17 without superuser, `BYPASSRLS`, `CREATEDB`, `CREATEROLE`, or replication. `pg_read_all_stats` permits reading all `pg_stat_*` views and stats-related extensions, including full `pg_stat_activity` details; it is not a grant of arbitrary application-table reads. Because predefined-role privileges can change between PostgreSQL releases, the server major/minor and effective privilege assertions are admission inputs.

Owner-only provisioning, performed before the migration and in a different session, is:

```sql
CREATE ROLE trailmind_phase1_v2_stats_auditor
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1
  PASSWORD NULL VALID UNTIL '2026-08-30 23:59:59+00';

GRANT CONNECT ON DATABASE postgres TO trailmind_phase1_v2_stats_auditor;
REVOKE CREATE, TEMPORARY ON DATABASE postgres
  FROM trailmind_phase1_v2_stats_auditor;
GRANT pg_read_all_stats TO trailmind_phase1_v2_stats_auditor
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
```

`VALID UNTIL` must be replaced by a reviewed short expiry covering only the maintenance window; the literal above illustrates SQL shape and is already expired, so it cannot be reused. PostgreSQL has no per-role `DENY`: if `PUBLIC` retains `TEMPORARY`, revoking it only from this role is ineffective. Admission therefore checks effective `TEMPORARY = false`. The database owner must harden/restore `PUBLIC` privileges under a separately reviewed change if necessary. The observer may not perform that hardening.

Set the SCRAM password only through an interactive PostgreSQL 17 `psql` owner session using `\password trailmind_phase1_v2_stats_auditor`; do not place it in SQL, shell history, process arguments, environment variables, JSON, logs, or artifacts. Deliver the same password from the owner’s secret manager to the observer through a protected already-open descriptor. The observer verifies descriptor type/ownership/mode, reads it once, closes it, overwrites mutable buffers where possible, and never claims guaranteed SSD or runtime-memory erasure.

The exact membership and effective-privilege assertions are specified in the companion JSON. Admission requires:

- exactly one direct membership: `pg_read_all_stats`, with `admin_option = false`, `inherit_option = false`, and `set_option = true`;
- no direct or inherited membership in `postgres`, `supabase_admin`, `service_role`, `authenticator`, `anon`, `authenticated`, `dashboard_user`, `pg_database_owner`, or any `trailmind_%` role;
- `rolsuper`, `rolcreatedb`, `rolcreaterole`, `rolreplication`, and `rolbypassrls` all false; `rolinherit` false; `rolconnlimit = 1`; login true; unexpired credential;
- no owned database, schema, relation, type, function, operator, collation, conversion, publication, or subscription object;
- no effective `CREATE` or `TEMPORARY` database privilege;
- no effective `CREATE`/`USAGE` on TrailMind schemas and no `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, sequence, or routine privilege on TrailMind objects;
- connection transaction defaults set to read-only by the client and every audit query wrapped in `BEGIN TRANSACTION READ ONLY`.

### Connection contract

Supabase documents that Free projects have a direct IPv6 endpoint and a shared Supavisor session endpoint. Custom database roles can use direct connections and the session pooler. The accepted observer uses only the direct endpoint because current official Supabase documentation does not prove SCRAM channel binding through Supavisor.

The libpq connection parameters are fixed:

```text
host=db.mbvzwsrtqcrwhvykugcd.supabase.co
port=5432
dbname=postgres
user=trailmind_phase1_v2_stats_auditor
sslmode=verify-full
sslrootcert=<protected local CA path with reviewed SHA-256>
require_auth=scram-sha-256
channel_binding=require
gssencmode=disable
connect_timeout=10
application_name=trailmind_p1v2_auditor_<one-run random suffix>
```

The runner must have working IPv6. A successful libpq 17 connection with `sslmode=verify-full`, `require_auth=scram-sha-256`, and `channel_binding=require` proves the observed connection used a verified certificate hostname and SCRAM channel binding. It does not prove all future connections will. Failure is terminal; there is no fallback to `verify-ca`, `require`, password-only SCRAM, the transaction pooler, a service-role key, a PAT/JIT token, Supabase MCP, or the mutation connection.

Temporary/JIT database access is not accepted. Supabase's current guide documents restrictions and expiry and uses an existing platform identity/token as the database password while mapping that identity to an existing database role. The feature was originally announced as a preview, but the current guide no longer applies that label. It is unsuitable here because it couples the database audit to a platform credential and principal whose staging-only isolation is not proven on this Free organization.

### Rotation and teardown

Before each authorized run, rotate the password interactively and shorten `VALID UNTIL`. After the signed cleanup receipt is durably written, a separate owner session executes:

```sql
ALTER ROLE trailmind_phase1_v2_stats_auditor NOLOGIN PASSWORD NULL;
REVOKE pg_read_all_stats FROM trailmind_phase1_v2_stats_auditor;
REVOKE CONNECT ON DATABASE postgres FROM trailmind_phase1_v2_stats_auditor;
DROP ROLE trailmind_phase1_v2_stats_auditor;
```

Before `DROP ROLE`, the owner must independently prove zero owned objects and zero unexpected grants. If either is nonzero, do not use `REASSIGN OWNED` or destructive cleanup to hide it: quarantine the role as `NOLOGIN PASSWORD NULL`, preserve the signed evidence, and require manual review. Any temporary change to `PUBLIC` database privileges must be separately snapshotted, reviewed, and restored only when doing so does not restore mutation capability to the auditor.

Cleanup observation requires two fresh auditor sessions after both mutation and primary-auditor sessions disconnect. Each sample records the observer query’s own PID and excludes only that exact PID. Both must show no row for the mutation PID/application name and no row for any previous auditor PID/application name; rows include `pid`, `usename`, `application_name`, `client_addr`, `backend_start`, `state`, `xact_start`, and `query_start`. Samples use distinct random application names and are separated by a bounded monotonic interval. A single sample is not accepted.

## D. Ed25519 artifact signing

The one-run key lifecycle is:

1. An owner generates an Ed25519 key on a trusted local host using the operating system CSPRNG. The private key is stored encrypted or in a non-exportable signing device. Generation is outside the observer and outside the migration.
2. Export only the public key as DER SubjectPublicKeyInfo. Compute lowercase `SHA-256(SPKI-DER)` and pin that 64-hex digest, key ID, acceptance-contract digest, and implementation-source digest in a reviewed commit.
3. At runtime, provide a decrypted PKCS#8 private key or signing handle through a protected descriptor that is not linked in the filesystem. Verify descriptor provenance and verify that the derived public-key digest equals the pinned digest before allowing a factory to become reachable.
4. Canonicalize the unsigned artifact with the reviewed strict canonical JSON
   function. Compute its SHA-256 for indexing. Sign
   `UTF8("trailmind-production-observer-v2\n") || canonical_unsigned_artifact_bytes`
   using Ed25519. Store the signature as unpadded base64url in an envelope with
   `algorithm`, `keyId`, `publicKeySpkiSha256`, and `artifactSha256`.
5. A verifier re-canonicalizes, recomputes the artifact digest, checks the pinned SPKI digest and accepted key ID, and verifies the Ed25519 signature before interpreting any field. Any duplicate JSON key, non-I-JSON value, unknown schema version, unknown field where the schema forbids it, or invalid signature blocks admission.
6. Rotation requires a new key and a new reviewed commit that pins its public digest and validity window. No runtime trust-on-first-use, key discovery URL, previous-key fallback, or unreviewed multi-key ring is allowed.
7. After the one run, revoke/delete the key in its store, close the descriptor, clear mutable buffers where supported, and destroy operator copies. Report this as best-effort secret destruction, not proof of physical erasure.

Required durable artifacts are
`observer.01.pre-control.json`, `observer.02.post-ddl-static.json`,
`observer.03.final-control.json`, and `observer.04.cleanup.json`. Every artifact
binds the immutable target/protected refs, implementation commit and source
digest, acceptance-contract digest, run ID, phase nonce, previous-artifact
digest, control response digests, transaction/migration receipt identifiers
where applicable, auditor identity/connection evidence, observation times, and
local monotonic sequence. Advisor diagnostics may be attached but never
satisfy `post-ddl-static`.

A valid signature proves that the holder of the private key signed those exact bytes and detects later byte changes. It does **not** prove the statements are true, that an API response was fresh, or that DDL caused an observation. Causality comes only from the fail-closed sequence, independently generated nonces, exact transaction/migration receipts, post-commit catalog assertions, and two cleanup samples. The advisor API cannot supply causal evidence.

## E. Gate ownership

### Code gates

- Delete all synthesized cost/currency/add-on counts and implement the exact billing endpoint contract.
- Downgrade advisors explicitly to diagnostics and implement a new digest-pinned independent static assertion program plus reviewed expected manifest.
- Require the exact least-privilege auditor identity, effective ACL checks, direct TLS/SCRAM/channel-binding contract, fresh application names, `backend_start`, and two cleanup samples.
- Implement RFC 8785 canonicalization, Ed25519 envelopes, pinned public-key verification, chain binding, durable atomic artifact writes, and no-secret logging tests.
- Pin literal reviewed digests for source, acceptance contract, static query, expected manifest, CA, and public key. Reject runtime-derived trust roots.
- Keep the production factory unregistered and unreachable until all pins and setup receipts validate.
- Add negative tests for every forbidden credential, protected ref, redirect, endpoint, billing inference, advisor freshness claim, role privilege, TLS downgrade, unsigned artifact, replay, reordered phase, cleanup sample, and failure path.

### Owner/operator setup

- Provision and rotate the FGA reader out of band with exactly the accepted permissions and independently prove provider-enforced staging-only resource reach.
- Provision, rotate, expire, quarantine, and delete the auditor with a separate owner connection and interactive `\password` flow.
- Provide a reviewed CA file/digest and an IPv6-capable libpq 17 runner.
- Generate the one-run Ed25519 key, pin its public digest through review, deliver the signer via protected descriptor, and destroy it after use.
- Preserve signed artifacts and operator setup/teardown receipts without secrets or raw provider payloads.

### Supabase control-plane setup

- Keep the exact target project active at `mbvzwsrtqcrwhvykugcd`, organization `wbnftkftyamxzvxsftda`, region `eu-central-1`, PostgreSQL major 17, database `postgres`, Free plan, and reported compute `nano`.
- Enforce SSL for incoming database connections.
- Ensure the credential’s provider principal cannot access protected refs. This is not currently evidenced on Free.
- Ensure the add-ons response has the required schema and no selected item with a positive numeric published price; do not convert that observation into an invoice claim.

### Platform limitations

- No documented OAuth billing/add-ons scope.
- No documented project-resource binding for a fine-grained token sufficient to prove isolation in the current Free organization; project-scoped organization roles are Team/Enterprise.
- No advisor run ID, computation time, transaction marker, bounded rerun API, or documented supported API replacement.
- No exact-invoice proof from the project add-ons endpoint.
- No official proof of SCRAM channel binding through Supavisor; only a successful strict direct libpq connection is accepted.

## Historical findings against `b59f432`

The original implementation was not acceptable because it:

- writes `currency: "USD"`, `monthlyCostAmount: 0`, and `nonzeroAddonCount: 0` without calling the billing-addons endpoint;
- converts deprecated advisor GET responses into locally asserted completion/freshness evidence;
- duplicates one database password descriptor and connects as `postgres`, so the alleged auditor is neither independent nor least privilege;
- expects broad `CREATEDB`/`CREATEROLE` properties inconsistent with the required auditor;
- produces SHA-256 integrity fields but no Ed25519 authenticity evidence;
- uses one cleanup query without the required two fresh samples and `backend_start` binding;
- derives source trust at runtime and does not pin a reviewed acceptance/static-query/expected-manifest/public-key set;
- makes the production observer package/factory reachable before the missing external capability proofs exist.

The correction moved the adversarial suite from 29/61 to 35/61. The reconciled
suite is now 61/61 with no skips: implementation defects are fixed, obsolete
tests use the actual V2 module boundaries, and platform limitations assert the
correct typed block. Green tests do not convert unavailable external evidence
into a positive claim. The complete 32-case classification is in
`PRODUCTION_OBSERVER_V2_RECONCILIATION.md`.

## Official sources

All sources below were accessed 2026-08-30. Statements labeled as inference above were derived by comparing these official surfaces.

### Supabase

- [Management API introduction](https://supabase.com/docs/reference/api/introduction)
- [Current Management API OpenAPI specification](https://github.com/supabase/supabase/blob/master/apps/docs/spec/api_v1_openapi.json)
- [List project add-ons endpoint](https://supabase.com/docs/reference/api/v1-list-project-addons)
- [OAuth scopes](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration/oauth-scopes)
- [Platform access control and project-scoped role plan availability](https://supabase.com/docs/guides/platform/access-control)
- [Database advisors](https://supabase.com/docs/guides/database/database-advisors)
- [Current CLI reference](https://supabase.com/docs/reference/cli/supabase-db-lint)
- [Supabase changelog](https://supabase.com/changelog)
- [Billing on Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase)
- [Monthly invoice](https://supabase.com/docs/guides/platform/your-monthly-invoice)
- [Credits](https://supabase.com/docs/guides/platform/credits)
- [Project transfer billing](https://supabase.com/docs/guides/platform/project-transfer)
- [Database connection methods and plan availability](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Custom roles with direct and Supavisor session connections](https://supabase.com/docs/guides/database/prisma)
- [Postgres roles](https://supabase.com/docs/guides/database/postgres/roles)
- [Connection management](https://supabase.com/docs/guides/database/connection-management)
- [SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement)
- [Connecting with `psql` and certificate verification](https://supabase.com/docs/guides/database/psql)
- [Temporary token-based database access](https://supabase.com/docs/guides/platform/temporary-access)
- [Temporary database access feature-preview changelog](https://supabase.com/changelog/46346-feature-preview-temporary-token-based-database-access)

### PostgreSQL 17

- [Predefined roles](https://www.postgresql.org/docs/17/predefined-roles.html)
- [Monitoring statistics and `pg_stat_activity`](https://www.postgresql.org/docs/17/monitoring-stats.html)
- [Role attributes](https://www.postgresql.org/docs/17/role-attributes.html)
- [`GRANT` and membership options](https://www.postgresql.org/docs/17/sql-grant.html)
- [Role membership semantics](https://www.postgresql.org/docs/17/role-membership.html)
- [`pg_roles`](https://www.postgresql.org/docs/17/view-pg-roles.html)
- [Privilege inquiry functions](https://www.postgresql.org/docs/17/functions-info.html)
- [libpq connection parameters](https://www.postgresql.org/docs/17/libpq-connect.html)
- [SCRAM and channel binding](https://www.postgresql.org/docs/17/sasl-authentication.html)
- [libpq environment variables and `PGPASSWORD` warning](https://www.postgresql.org/docs/17/libpq-envars.html)
- [`psql` `\password`](https://www.postgresql.org/docs/17/app-psql.html)
- [Password authentication](https://www.postgresql.org/docs/17/auth-password.html)
- [`ALTER ROLE`](https://www.postgresql.org/docs/17/sql-alterrole.html)
- [`REVOKE`](https://www.postgresql.org/docs/17/sql-revoke.html)
- [`table_privileges`](https://www.postgresql.org/docs/17/infoschema-table-privileges.html)

## Review basis and immutable inputs

- Baseline inspected: `adea2c08540e87f0acd7eebb976c72eab8eb76c3`
- Foundation commit: `b59f432a1947154345f1629ecba50d14fcb1e7c8`
- Correction commit: `68887cf9cd3e8ce28a05cd2ca7eb9e5d5ed5f8ac`
- Capability-policy commit: `b8fdcc8539dc149fd0cfac783602073ae5567f24`
- Adversarial-acceptance commit: `a38677e67b23916e27d7c8f594866ab746a60921`
- Independent review commit: `4821c9b29e070be53c0c22873cb7af124434b985`
- Reconciled source, package, and acceptance-contract SHA-256 values:
  `backend/src/operations/stagingPhase1V2ProductionSourceManifest.js`
- Pre-migration V2 SQL SHA-256: `feb13b3f6ea6a538f6cd5223030fecca1cb0195bce3e0eb0204aed704ea0c16b`
- Post-migration V2 SQL SHA-256: `3945c51cf26ca178e2bb2d6bfa7ac49aa6cf1bbcb268bf68272216efce153456`

No secret, credential, raw provider response, live database observation, or Supabase control-plane result is included in this review.
