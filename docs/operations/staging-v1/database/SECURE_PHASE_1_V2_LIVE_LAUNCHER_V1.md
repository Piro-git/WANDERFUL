# Secure Phase 1 V2 live launcher v1

Status: fail-closed local boundary package. This document does not authorize a
remote run, is not evidence that staging was admitted, and does not claim that
the real admission is currently executable.

## Current production status

The repository does not have a trustworthy authenticated implementation for
Supabase control-plane, billing, advisor, protected-project, and independent
post-disconnect session observations. The available authenticated capability
exists outside this standalone Node.js process. This release therefore has no
registered production observer.

The live entry point stops with the bounded status `observer_required` before
Git inspection, CA access, action authorization, password intake, attempt or
envelope creation, DNS, sockets, database access, mutation, or receipt
publication. Supplying an application callback, copied package metadata,
synthetic preflight observer, manually populated object, or JSON file instead
stops with `observer_untrusted`. There is no public observer-registration API.

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
2. A future separately reviewed machine observer must produce the technical
   control-plane and cleanup observations. TTY input is never accepted as
   evidence.
3. After the observer passes, the launcher may authorize the exact action and
   own password intake through a real no-echo TTY and unlinked descriptor.

The launcher has no generic SQL runner, project selector, host override,
database URL, or migration-file override. The existing
`runAuthorizedStagingPhase1V2SingleSession` implementation remains the only
mutation adapter.

## Machine-observer contract

`stagingPhase1V2MachineObserver.js` defines the strict contract and the only
future production trust-anchor registration point. A reviewed implementation
must be installed inside that module/package; arbitrary application code
cannot promote itself by copying a package ID or digest.

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
and envelope creation, descriptor unlink/closure, admission consumption, and
all four observer phases. It then validates and deletes its task-owned
artifacts.

The synthetic observer is explicitly non-authorizing, is tracked by private
object identity, and is rejected by the production entry point. Preflight
performs zero DNS, socket, database, Supabase, GraphHopper, AI, import,
projection, deployment, or feature-flag activity.

Preflight must pass from a clean committed candidate. A dirty worktree,
operator/migration/capacity/lifecycle/dependency drift, stale identity, file
race, observer-contract failure, or missing local OpenSSL fails locally.

## Live command and safe operator steps

The eventual fixed command shape is:

```text
npm run db:migrate:supabase-postgis-isolation-v2 -- \
  --ca-file <absolute-new-ca-path> \
  --endpoint <direct-or-session> \
  --address <exact-resolved-public-ip>
```

Do not use it for a real attempt in this release: it intentionally returns
`observer_required`. The safe steps now are:

1. Run the zero-network preflight and independently review this package.
2. Implement and review a machine observer through the pinned internal trust
   anchor, with least-privilege authenticated read-only Supabase capabilities
   and independent post-disconnect database session inspection.
3. Add integration tests that prove the real observer emits the exact causal
   sequence and cannot be substituted, replayed, or used cross-target.
4. Obtain a fresh, separate authorization for one staging attempt only after
   that observer implementation is reviewed and committed.
5. For that later attempt, obtain a newly supplied official target-project CA
   outside the repository as a canonical, owner-owned, single-link regular
   file with mode `0600`.
6. Run the fixed command from a clean reviewed commit. The only TTY evidence
   input will be the exact action authorization; the password will use the
   no-echo prompt.

Never place the password in an argument, environment variable, pipe, tracked
file, shell substitution, process argument, history, clipboard, Codex chat, or
provider configuration. Never use `Configuration/Local.xcconfig` or
`supabase/.temp` for this operation.

## Authorization, mutation, and terminal guarantees

Once a reviewed observer is installed, every invocation will use distinct
attempt, run, and authorization UUIDs. A fresh five-minute `O_EXCL` envelope
will bind the candidate commit/tree and clean-Git attestation; exact target,
endpoint and TLS identity; CA digest and password-FD containment facts;
operator/SQL/migration/capacity/lifecycle/dependency/package digests; observer
artifact and provider ACL restore-plan digests; and single-use issue/expiry
identity. No unavailable field may be fabricated.

The password file is exclusively created with mode `0600`, validated as an
owner-owned single-link regular non-symlink, opened on a descriptor at least 3,
and unlinked before database work. Password buffers are wiped and the
descriptor is closed on every outcome.

The adapter preserves one TLS-verified session, stable PID, session advisory
lock, bounded role transitions, reviewed migration order, cancellation latch,
compensation, cleanup-before-publication, redaction, and durable receipt
semantics. The only automatic compensation is the reviewed Phase 1 V2 path.
It never resets a project, drops broad schemas, truncates unknown tables,
disables RLS, widens privileges, or improvises SQL.

Planua, production TrailMind, and every other remote system remain outside
this package. Local preflight never grants a remote admission.
