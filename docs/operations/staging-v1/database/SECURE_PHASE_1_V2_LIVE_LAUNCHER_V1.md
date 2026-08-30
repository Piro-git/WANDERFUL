# Secure Phase 1 V2 live launcher v1

Status: authenticated production observer implemented and locally verified.
This document does not authorize a remote run, is not evidence that staging
was observed or admitted, and is not a substitute for fresh credentials and a
separately authorized attempt.

## Current production status

The repository now contains one internally constructed production observer.
It uses the official Supabase Management API with a short-lived OAuth access
token limited to `projects:read`, `organizations:read`, and `database:read`,
plus an independent TLS-verified PostgreSQL auditor session. Personal access
tokens (`sbp_`) are rejected because they inherit a user's privileges and are
not the reviewed least-privilege credential for this operation.

The singleton is trusted by private object identity and binds a digest of its
checked-in source into its package identity and every machine artifact. There
is no public registration API, dynamic module path, plugin directory,
environment-selected implementation, generic transport, or callback capable
of gaining production trust. Copied metadata and the synthetic observer remain
non-authorizing. Live mode also rejects every dependency override and invokes
only the checked-in admission and single-session mutation adapter; dependency
injection remains available only to the zero-remote synthetic preflight.

The implementation is structurally available, but this task performed no
Management API request, database connection, credential retrieval, mutation,
or real admission. A live attempt remains prohibited until the branch is
independently integrated and a new attempt is explicitly authorized.

Do not enter advisor counts, digests, timestamps, protected-project claims,
final-state confirmations, or `SESSION_CLOSED` text at a TTY. Manual assertions
are not technical evidence and cannot authorize the reviewed adapter.

## Fixed trust boundary

The launcher can target only `TrailMind Outdoor Staging V1`
(`mbvzwsrtqcrwhvykugcd`) in `Alibra AI`
(`wbnftkftyamxzvxsftda`), Frankfurt (`eu-central-1`), Free / USD 0,
PostgreSQL 17, database `postgres`.

The only modeled endpoint classes are the fixed project direct endpoint on
port 5432 with an exact public IPv6 address, or the fixed Frankfurt shared
pooler in session mode on port 5432 with an exact public IPv4 address.
Transaction pooling, arbitrary hosts, connection URLs, URL options, alternate
users/databases, CIDRs, local/reserved addresses, and TLS modes weaker than
`verify-full` are rejected.

The boundary separates three authorities:

1. The checked-in launcher pins the exact Git candidate, target, endpoint,
   TLS/CA policy, operator package, and authorization-envelope contract.
2. The internal machine observer produces authenticated control-plane,
   advisor, database ACL, and independent cleanup observations. TTY input is
   never accepted as evidence.
3. Only after the pre-control Management API gate passes may the launcher read
   the reviewed CA, authorize the exact action, and accept the database
   password through a real no-echo TTY.

The launcher has no generic SQL runner, project selector, host override,
database URL, or migration-file override. The existing
`runAuthorizedStagingPhase1V2SingleSession` implementation remains the only
mutation adapter.

## Machine-observer contract

`stagingPhase1V2MachineObserver.js` defines the strict contract and constructs
the only production trust anchor. Arbitrary application code cannot promote
itself by copying a package ID or digest.

The control-plane transport is native HTTPS and has no injection seam. It is
limited to 12 GET requests total, with no retry or redirect, to the exact
`api.supabase.com` host and five reviewed endpoint shapes:

- exact target project;
- exact organization;
- one bounded, complete organization-project inventory page;
- exact target security advisors with `lint_type=sql`;
- exact target performance advisors.

DNS answers must all be public addresses. One resolved address is pinned to
the TLS socket while SNI and certificate hostname verification remain bound to
`api.supabase.com`. Only TLS 1.2 or 1.3, HTTP 200, current `Date`, exact JSON
content type, bounded bodies, strict response schemas, a five-second per-call
budget, and a true 20-second aggregate phase deadline are accepted. DNS is
inside the same remaining request budget. Raw responses are discarded after
their canonical digests are recorded.

Supabase currently marks the advisor endpoints as experimental/deprecated.
The observer uses their documented read-only `database:read` capability, but
does not normalize away a platform change: an endpoint, status, or schema
change is an observer failure that prevents admission until this reviewed
package is updated.

The control token is read only from an owner-owned, mode `0600`, unlinked
inherited descriptor. It is never accepted through arguments, environment,
clipboard, tracked files, URLs, or logs. Authentication, schema, freshness,
target, organization, region, status, Free-plan, nano-compute, PostgreSQL 17,
advisor, or protected-inventory ambiguity fails closed before mutation.
Personal access tokens, publishable/secret API keys, and legacy `anon` or
`service_role` JWTs are rejected. The credential gate does not assume that a
Management API OAuth access token must be opaque: Supabase documents the
scopes and bearer semantics, but not a stable token encoding. Least privilege
therefore comes from the reviewed OAuth grant plus the observer's GET-only
transport, not from an invented token prefix.

The feature-flag evidence is sampled from the launcher process at each full
control observation and rejects any defined deploy, import, provider, or
insecure-local flag. Provider configuration is deliberately not inspected by
this task; the evidence is precisely the local launcher containment state.

The database observer is a second connection with a distinct run-bound
`trailmind_p1v2_auditor_*` application name. It reuses the one-time database
identity through a second independently opened descriptor created before the
password file is unlinked; the mutating operator still has exactly one session.
The auditor requires verify-full TLS, the pinned endpoint address, channel
binding, PostgreSQL 17, the reviewed `postgres`/`supautils` platform identity,
a stable distinct PID, `BEGIN READ ONLY`, transaction-local statement/lock/
idle timeouts, and no advisory lock. It exposes no generic query method. Every
query is selected from a static digest-published SQL manifest with exact
parameters.

Before mutation, the auditor proves the application foundation is empty and
computes independent shared-ACL and provider restore-plan digests. Later
observations reject ACL drift. After confirmed operator teardown and advisory
lock release, the still-independent auditor queries `pg_stat_activity` for the
exact mutating application name and PID, explicitly excludes itself, and must
observe zero active and zero idle matching sessions.

Each canonical observation is bounded to 32 KiB and binds:

- the exact project ref, organization ID, region, attempt ID, run ID,
  candidate commit, and candidate tree;
- observer contract/package identity, session-binding digest, unique request
  nonce, unique observation ID, phase, ordinal, prior-artifact digest, and a
  fresh canonical timestamp;
- the relevant application name and backend PID after connection;
- strict phase-specific control-plane, advisor, ACL, protected-project,
  feature-flag, or cleanup evidence.

The required monotonic one-use phase order is `pre-control`,
`post-ddl-advisors`, `final-control`, then `post-disconnect-cleanup`. Unknown or
extra fields, malformed or oversized content, stale/future timestamps,
duplicate identities/digests, replay, reordering, hash-chain mutation,
cross-run/project/Git/PID substitution, contradictory counts, and sensitive
content fail closed.

Observations retain only bounded metadata and digests. They may not contain a
credential, access token, connection string, endpoint URL, raw provider
response, SQL text, user data, private endpoint, or CA contents.

Cleanup is a separate observation after the mutating connection is torn down.
It must prove zero active and zero idle sessions matching the exact application
name and PID, and bind the attempt/run identities, authorization binding, and
staged receipt digest. The mutating session cannot attest to its own absence.
A missing or rejected cleanup observation prevents terminal receipt
publication and leaves the attempt pending/contained.

## Local zero-network preflight

From `backend`, run:

```text
npm run db:migrate:supabase-postgis-isolation-v2:preflight
```

Preflight creates a synthetic task-owned CA and password and a pinned
`synthetic-preflight` observer session. It exercises clean Git and candidate
digests, CA/file protections, no-echo intake abstraction, exclusive password
and envelope creation, two independent same-identity password descriptors,
unlink/closure, admission consumption, and all four observer phases. It then
validates and deletes its task-owned artifacts.

The synthetic observer is explicitly non-authorizing, is tracked by private
object identity, and is rejected by the production entry point. Preflight
performs zero DNS, socket, database, Supabase, GraphHopper, AI, import,
projection, deployment, or feature-flag activity.

Preflight must pass from a clean committed candidate. A dirty worktree,
operator/migration/capacity/lifecycle/dependency drift, stale identity, file
race, observer-contract failure, or missing local OpenSSL fails locally.

## Live command and safe operator steps

The fixed command shape for a separately authorized future attempt is:

```text
npm run db:migrate:supabase-postgis-isolation-v2 -- \
  --ca-file <absolute-new-ca-path> \
  --endpoint <direct-or-session> \
  --address <exact-resolved-public-ip>
```

Do not use it as part of this implementation task. The safe next steps are:

1. Run the zero-network preflight and independently review this package.
2. Independently integrate and review the internal production observer and
   launcher branch without changing its target or trust boundary.
3. Provision a short-lived OAuth access token from a reviewed Supabase OAuth
   application that has only `projects:read`, `organizations:read`, and
   `database:read`. Do not use a personal or service-role key.
4. Obtain a fresh, separate authorization for one staging attempt only after
   the integrated commit is clean and reviewed.
5. For that attempt, obtain a newly supplied official target-project CA
   outside the repository as a canonical, owner-owned, single-link regular
   file with mode `0600`.
6. Run the fixed command from the clean reviewed commit. The no-echo TTY reads
   the scoped OAuth token first; only after authenticated pre-control passes
   does it read the exact action authorization and database password.

Never place either credential in an argument, environment variable, pipe,
tracked file, shell substitution, process argument, history, clipboard, Codex
chat, or provider configuration. Never use `Configuration/Local.xcconfig` or
`supabase/.temp` for this operation.

## Authorization, mutation, and terminal guarantees

Every invocation uses distinct attempt, run, and authorization UUIDs. A fresh
five-minute `O_EXCL` envelope
will bind the candidate commit/tree and clean-Git attestation; exact target,
endpoint and TLS identity; CA digest and password-FD containment facts;
operator/SQL/migration/capacity/lifecycle/dependency/package digests; observer
artifact and provider ACL restore-plan digests; and single-use issue/expiry
identity. No unavailable field may be fabricated.

The password file is exclusively created with mode `0600`, validated as an
owner-owned single-link regular non-symlink, opened twice to two distinct file
descriptors with independent open-file descriptions and the same device/inode,
then unlinked before database work. Both descriptors are validated at link
count zero. Password buffers are wiped and both descriptors are closed on
success, failure, cancellation, and signal paths.

The adapter preserves one TLS-verified session, stable PID, session advisory
lock, bounded role transitions, reviewed migration order, cancellation latch,
compensation, cleanup-before-publication, redaction, and durable receipt
semantics. The only automatic compensation is the reviewed Phase 1 V2 path.
It never resets a project, drops broad schemas, truncates unknown tables,
disables RLS, widens privileges, or improvises SQL.

Planua, production TrailMind, and every other remote system remain outside
this package. Local preflight never grants a remote admission.
