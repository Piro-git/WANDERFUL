# Phase 1 PostGIS Isolation V2 Review Correction 002 — Local Proof

Date: 2026-08-25

Outcome: **checkpoint-ready local candidate; managed Supabase execution remains
unproven and blocked**

HEAD and locally observed `origin/main`:
`72b98e3e065ae442168ece20984d8baba26e2d11`. This final seal made no fetch or
other remote Git call.

Final-seal receipt SHA-256:
`a4387e8642926fe08bb5bc9a081fb916198f9af76060e78e15e4f8070577d793`

This is append-only evidence for the second independent-review correction
pass. It does not replace the historical blocked/compensated receipt, the first
V2 local proof, or the first review-correction proof. No Supabase project,
remote database, provider, deployment, flag, secret, PBF, or paid resource was
contacted or changed.

## Finding disposition

No local P1, P2, or P3 finding remains open after the final self-review and
the tests below. This is not managed-Supabase proof. The exact remote catalogs,
provider ACLs, project identity/cost, advisors, and final state remain a fresh
authorization gate.

### Git inventory evidence correction

The prior evidence was generated as two untracked correction-002 artifacts
without an atomic pair publication. There are exactly 33 other untracked
candidate files. A status snapshot with one correction-002 artifact present is
therefore 34 untracked; the stable state with both the Markdown and JSON present
is 35. This explains the independent `32 modified + 34 untracked` observation.
No candidate or unrelated file was removed to force that earlier count.

The final stable result is mechanically derived from
`git status --porcelain=v1 --untracked-files=all`: 32 modified, 35 untracked,
zero staged, 67 total. Its exact output SHA-256 is
`ee661547a0ba4845eaaece67c04854ad22ac61111c1f6d8a92c930084fcbf517`.
The JSON receipt contains both complete path inventories and their independent
digests.

### Exact outgoing membership set

The production runner queries the complete direct `pg_auth_members` set for
`migration_role` before filesystem-ledger work. It admits exactly one tuple:

| member | target | inherit | set | admin |
| --- | --- | --- | --- | --- |
| `migration_role` | `trailmind_app_owner` | false | true | false |

The recursive reachable set must contain only `trailmind_app_owner`; that owner
must have no outgoing membership. Extra benign, `CREATEDB`, `BYPASSRLS`,
`SUPERUSER`, and indirect membership paths all fail before ledger creation and
emit no applied filename.

PostgreSQL 17 automatically gives a non-superuser `CREATEROLE` creator an
ADMIN-only membership in each new role. The final managed-admin inventory keeps
that behavior explicit: `postgres` has `SET=true, ADMIN=true` only for the two
NOLOGIN owners, and `SET=false, ADMIN=true` for the nine operational roles.
It cannot assume an operational identity. This inventory is exact and tested;
it is separate from every operational role's outgoing membership contract.

### GIS owner drift

Before ledger creation, again in migration 009, and after DDL, the contract
requires:

- `trailmind_gis` owner exactly `postgres`;
- PostGIS extension owner exactly `postgres` or `supabase_admin`;
- either same-owner local topology or the reviewed managed topology
  `postgres` schema / `supabase_admin` extension members;
- every routine, relation, type, operator, operator class/family, collation,
  conversion, text-search configuration, and dictionary in the GIS schema
  owned by the extension owner;
- no non-owner CREATE ACL and no unexpected non-superuser SET path to the
  schema owner.

The exact schema-owner drift reproducer fails before ledger/stdout. A separate
executable fixture installs PostGIS as `supabase_admin` into a `postgres`-owned
schema and applies the exact V2 ledger successfully, proving the admitted
provider topology rather than merely allowlisting its name.

### Restore-plan binding and rollback

The operator requires one independently supplied
`providerAclRestorePlanDigest`, compares it with both unlocked and locked
database snapshots, and binds it into the durable receipt. Missing, mismatched,
duplicated/aliased, or changed-under-lock values fail closed.

The V2 pre-step snapshots raw ACL representation plus normalized grantee,
grantor, privilege, and grant-option rows for every shared object it changes.
Pre-ledger compensation restores raw and semantic equality and refuses a
ledger, application object, unexpected enum/domain/operator/object, unexpected
membership, active TrailMind session, or repeated execution. It uses exact
object drops and no `DROP OWNED` or `CASCADE`.

The protected historical `PHASE_1_BLOCKED_ROLLBACK.sql` is not fixed. It is
quarantined as **NON-EXECUTABLE / SUPERSEDED HISTORICAL EVIDENCE** by
`PHASE_1_BLOCKED_ROLLBACK_QUARANTINE_NOTICE_001.md` and `.json`. Current
runbooks, manifests, commands, policy code, and operator code cannot select it.

## Dominant operator contract

`npm run db:migrate:supabase-postgis-isolation-v2` now enters the Phase 1
operator, whose CLI remains deliberately disabled until a reviewed live adapter
is separately installed. A raw V2 runner cannot execute with only a connection
environment and policy: it requires an in-memory, 30-second, single-use
capability bound to target, policy, and `apply` versus `verify-noop` purpose.
The capability is consumed before file or database access.

One successful operator result proves these exact ordered phases:

1. initial unlocked target/cost/advisor/database admission;
2. nonwaiting foundation-lock acquisition;
3. locked database reinspection and state/restore-plan equality;
4. committed V2 pre-step;
5. committed exact `001–007 + 009` first runner;
6. exact second runner no-op with zero applied files and zero stdout;
7. committed V2 post-step;
8. completed acceptable post-DDL security and performance advisors;
9. final identity/cost/protected-project/13-flag/session/role/ACL/Data API/GIS/
   five-function containment reinspection;
10. sanitized bounded durable receipt persistence.

Evidence with missing, duplicate, reordered, inconsistent, unknown, or
oversized fields is rejected. Failure before the pre-step commit does not
compensate. A committed pre-step with no ledger, or an atomic first-migration
rollback with no ledger/foundation, permits only the bounded pre-ledger
compensation. Any committed migration or later failure revokes outdoor runtime
EXECUTE, terminates only affected outdoor runtime sessions, keeps provider,
import, and deploy flags false, preserves evidence, performs no destructive
rollback, and requires a reviewed forward fix or separately authorized
restore/recreate.

## Final local role and privilege matrix

All operational logins are `NOINHERIT`, non-superuser, `NOCREATEDB`,
`NOCREATEROLE`, `NOREPLICATION`, and `NOBYPASSRLS`; only
`platform_provisioner` and the two object owners are NOLOGIN.

| role | exact local V2 capability after post-step |
| --- | --- |
| `platform_provisioner` | no application/shared/GIS capability |
| `migration_role` | only `SET` to `trailmind_app_owner`; no direct app/shared/GIS capability |
| `regional_import_role` | private-app USAGE; GIS USAGE without CREATE/grant option; database CREATE; reviewed evidence-table DML only |
| `projection_role` | private-app USAGE; GIS USAGE without CREATE/grant option; reviewed evidence reads, projection DML/views, and deterministic UUID function only |
| `app_security_runtime_role` | private-app USAGE; exact App Attest table transactions and matching RLS policies; zero application-function/shared/GIS capability |
| `outdoor_research_runtime_role` | private-app USAGE; EXECUTE on exactly five reviewed SECURITY DEFINER functions; zero base-table/shared/PostGIS capability |
| `outdoor_research_cancellation_control_role` | private control-schema USAGE and one target-restricted cancellation function; zero product-data/shared/GIS capability |
| `pruner_role` | private-app USAGE and DELETE on exactly four App Attest lifecycle tables with RLS; zero function/shared/GIS capability |
| `readonly_auditor_role` | distinct identity with no application/shared/GIS grant in the Phase 1 foundation |

`anon`, `authenticated`, `service_role`, and PUBLIC receive no private app,
control, or GIS access. Runtime, pruner, cancellation, and auditor roles have no
effective `public`, `extensions`, or `trailmind_gis` capability and no database
TEMPORARY. App Attest and outdoor connection paths are exactly
`pg_catalog,trailmind_app,pg_temp`. The five SECURITY DEFINER functions use
`pg_catalog,trailmind_app,trailmind_gis,pg_temp`; no writable or untrusted
schema precedes trusted objects.

## Verification totals

Authoritative environment: Darwin 25.4.0 arm64, Node `v22.22.3`, npm
`10.9.8`, PostgreSQL `17.10` (Homebrew), and PostGIS `3.6.4`. Dependencies came
from a pre-existing read-only install whose `package-lock.json` exactly matched
the candidate SHA-256
`f68d2c233fa98ed7dd57ba1bee8ab560069205b61cf371ca205f26f03f5c2533`;
they were copied only into a disposable local Git mirror. No dependency or
symlink was added to this candidate.

| verification | result |
| --- | --- |
| focused V2 static/operator/capability/quarantine | 47/47 pass, 4 suites |
| V2 exact pre-ledger compensation | 8/8 pass |
| real production-runner state machine | 9/9 pass |
| managed `supabase_admin` PostGIS-owner fixture | 2/2 pass |
| final V2 role/runtime/adversarial PostGIS | 12/12 pass |
| portable V1/PostGIS/App Attest regressions inside harness | 56/56 pass, 5 suites |
| total disposable PostgreSQL 17/PostGIS harness | 87/87 pass, 9 suites |
| complete backend suite | 1,014/1,014 pass, 106 suites |
| `npm run build` | pass |
| offline outdoor-adventure quality | 101/101 pass, 0 skipped |
| deterministic application-image context | 90 files, pass, SHA-256 `10b87ca2f6a62f72754c3f65f7e60ec0f0617a34aeb902ca558c5f670beeb2c6` |

Exact authoritative commands, each run from the disposable mirror's backend
directory:

```text
node --test --test-concurrency=1 test/supabasePostgisIsolationMigrationV2.test.js test/stagingPhase1V2Operator.test.js test/stagingMigrationCapability.test.js test/stagingHistoricalRollbackQuarantine.test.js
npm run test:supabase-postgis-isolation-v2
npm test
npm run build
npm run eval:outdoor-adventure-quality
node scripts/staging/runtime/verify-build-context.js
```

The first sandboxed PostgreSQL bootstrap was denied local SysV shared memory
before any schema creation. The authorized local-only rerun passed. A first
source-only mirror intentionally omitted Git metadata, so five V4 byte-
attestation tests failed closed with `git_attestation_unavailable` while 1,004
tests passed. The authoritative local shared-Git mirror rerun supplied the
required historical objects and passed 1,014/1,014 with zero skips. Neither
environment limitation was converted into a green result.

All disposable clusters, databases, sockets, listeners, dependency copies, and
task-created temporary directories were stopped or removed. JSON validation,
`git diff --check`, whitespace/conflict scans, protected-hash checks, credential
and connection-string scans, generated-artifact checks, and final Git status
were rerun after evidence sealing.

## Policy and evidence integrity

- current Supabase policy: `001–007 + 009`;
- historical portable policy: `001–008`;
- mixed or cross-policy ledger: rejected before mutation;
- migration 008 SHA-256 remains
  `e568e6ea65bd0d6f96fd20f636efcbb42700c55856ea3f19d1955b6a9e415b32`;
- the migration-006 erratum records
  `13ad98c4fc0fa19b27ad7a398bbaca8a6dfdfb1a29616e2de25c4a877843e8c4`;
- historical `providerCalls: 0` means zero GraphHopper/AI/application-provider
  calls, not zero historical Supabase control-plane operations;
- this pass made zero Supabase/control-plane/project/database calls.

The older `SOURCE_EVIDENCE_MANIFEST_V1.json` remains bound to its recorded
commit. The separate
`SOURCE_EVIDENCE_MANIFEST_V1_DATABASE_SUPPLEMENT_V2_CANDIDATE.json` is
explicitly uncommitted, non-homogeneous with that old manifest, and binds the
final correction-002 Markdown/JSON hashes, current Supabase migration digests,
operator/state-machine/runner tests, and both historical safety errata. The
canonical evidence map binds the finalized supplement hash. This directed
binding order avoids an impossible self-hash or circular proof claim.

## Remaining remote gate

Before any retry, obtain fresh explicit mutation authorization, install and
independently review a live adapter for the disabled operator, and independently
supply the expected ACL restore-plan digest. The adapter must observe the exact
staging identity, organization, Frankfurt region, `ACTIVE_HEALTHY`, current
Free/Nano USD 0/month quote, production/Planua exclusion, empty TrailMind state,
no sibling writer, exact shared ACL digest, and acceptable pre-advisors. Then
the single ten-phase operator may run. Any provider-specific ownership/ACL
shape outside the two locally admitted topologies is a fail-closed remote
blocker, not permission to weaken the contract.

Official design references reviewed for this pass:

- https://supabase.com/docs/guides/database/extensions/postgis
- https://supabase.com/docs/guides/database/postgres/roles
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/api/using-custom-schemas
- https://supabase.com/changelog
