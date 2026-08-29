# Secure Phase 1 V2 live launcher v1

Status: local launcher release candidate. This document does not authorize a
remote run and is not evidence that staging was admitted.

## Fixed trust boundary

The launcher can target only `TrailMind Outdoor Staging V1`
(`mbvzwsrtqcrwhvykugcd`) in `Alibra AI`
(`wbnftkftyamxzvxsftda`), Frankfurt (`eu-central-1`), Free / USD 0,
PostgreSQL 17, database `postgres`.

The only accepted endpoint classes are the fixed project direct endpoint on
port 5432 with an exact public IPv6 address, or the fixed Frankfurt shared
pooler in session mode on port 5432 with an exact public IPv4 address.
Transaction pooling, arbitrary hosts, connection URLs, options, alternate
users/databases, CIDRs, local/reserved addresses, and TLS modes weaker than
`verify-full` are rejected.

The launcher separates two authorities:

1. A separately authorized read-only observer obtains current project,
   billing, advisor, database ACL, provider ACL restore-plan, post-DDL advisor,
   and closed-session observations. These observations are nonsecret. They
   must be ready before the related prompt and must be no more than five
   minutes old. The launcher does not hold a provider token and does not claim
   an observation that the operator did not supply.
2. The launcher owns the database-password boundary. It accepts the password
   only from an actual no-echo TTY, writes it once to an exclusive owner-only
   file, keeps one same-process descriptor, unlinks the pathname before any
   database action, and passes only that descriptor to the reviewed adapter.

The launcher calls `runAuthorizedStagingPhase1V2SingleSession` exactly once.
It does not expose a SQL runner, project selector, host override, database URL,
or migration-file override. The existing reviewed migration order and SQL are
used without translation.

## Local zero-network preflight

From `backend`, run:

```text
npm run db:migrate:supabase-postgis-isolation-v2:preflight
```

This creates a synthetic task-owned CA and password, exercises clean-Git and
candidate digests, synthetic no-echo TTY intake, protected-file checks,
descriptor unlinking, exclusive
authorization-envelope creation and consumption, and replay storage, then
deletes its validated task-owned artifacts. It performs zero DNS, socket,
database, Supabase, GraphHopper, AI, import, projection, deployment, or feature
flag activity.

Preflight must pass from a clean committed candidate. A dirty worktree,
operator/migration/capacity/lifecycle/dependency drift, stale identity, file
race, or missing local OpenSSL stops before remote work.

## Inputs for a separately authorized live attempt

Before starting, the read-only observer must have current values for:

- the exact target identity, active health, Free plan, nano compute, USD 0
  billing, and PostgreSQL major 17;
- zero blocking security and performance advisor findings;
- the exact current shared database ACL SHA-256;
- the exact current provider ACL restore-plan SHA-256;
- one exact currently resolved public IP for the selected fixed endpoint;
- confirmation that both protected project refs remain unselected with zero
  mutations and all thirteen operator feature flags remain disabled.

Obtain a newly supplied official target-project CA from the Supabase dashboard.
Place it outside the repository as a canonical, owner-owned, single-link
regular file with mode `0600`. The launcher accepts no symlink, hard link,
permissive mode, stale file, malformed/non-CA X.509 content, or path/inode/time
change. The envelope contains only its SHA-256, never its contents.

Run from `backend` with the absolute CA path, endpoint class, and exact resolved
IP:

```text
npm run db:migrate:supabase-postgis-isolation-v2 -- \
  --ca-file <absolute-new-ca-path> \
  --endpoint <direct-or-session> \
  --address <exact-resolved-public-ip>
```

The command prompts for an exact target-state authorization sentence (including
active health, Free/nano/USD 0, Frankfurt, and PostgreSQL 17), an exact
protected-projects-zero-mutation confirmation, observation time, database ACL
digest, provider ACL restore-plan digest, and zero advisor counts. Only then
does it show the no-echo database-password prompt. During
the run it asks the read-only observer for post-DDL advisor evidence, final
target reconfirmation, and the exact zero-session cleanup confirmation.

Do not place the password in an argument, environment variable, pipe, file,
shell substitution, command history, clipboard, Codex chat, or provider
configuration. Do not use `Configuration/Local.xcconfig` or `supabase/.temp`.
The launcher intentionally rejects those input channels and all `PG*`
environment aliases.

## Authorization and artifact lifecycle

Every invocation receives distinct attempt, run, and authorization UUIDs. A
fresh envelope is created with `O_CREAT | O_EXCL`, mode `0600`, only after all
required local and read-only preflight values exist. Its maximum lifetime is
five minutes. It binds:

- candidate commit/tree, the reviewed operator ancestor, repository-root
  digest, and clean-Git attestation;
- exact target, database identity, endpoint class/address, and TLS policy;
- CA digest and password-descriptor containment facts, never secret bytes;
- executable operator, SQL, managed migration, capacity contract, lifecycle,
  dependency-lock, and live-boundary package digests/version;
- Data API schema expectation, a digest of the fresh read-only control
  observations, and provider ACL restore-plan digest;
- attempt/run/authorization identity and issue/expiry times.

Admission durably claims the identity with an exclusive consumed record and
unlinks the envelope before DNS or database connection. A failed or consumed
attempt cannot reuse its envelope. The password descriptor is closed by
admission before connection construction; task-owned password buffers are
wiped, and the path never returns.

The external attempt directory retains only replay records and a sanitized
terminal receipt when one is truthfully published. A committed receipt is
written exclusively only after the advisory lock is released, transactions
are idle, the TLS session is closed, the observer proves zero matching backend
and idle sessions, and the existing cleanup verifier accepts the proof. A
failure before terminal proof does not publish a committed receipt.

## Mutation, failure, and recovery contract

Before mutation, the reviewed adapter verifies the exact database/user,
PostgreSQL 17 managed Supabase role topology, TLS certificate and server name,
channel binding, stable backend PID, timeouts, empty/recoverable foundation,
PostGIS state, at least 40 MB of headroom beneath the 500 MB Free-plan
database limit, shared/provider ACL digests, sibling-writer count, Data API
exposure, and the non-waiting session advisory lock.

The only automatic compensation is the already reviewed Phase 1 V2
pre-ledger compensation SQL. After committed migrations, failure invokes the
reviewed containment path: runtime execution is revoked, affected runtime
sessions are boundedly cancelled, feature flags must remain off, evidence is
preserved, and a forward fix is required. The launcher never resets a project,
drops broad schemas, truncates unknown tables, disables RLS, widens privileges,
or improvises rollback SQL.

Planua, production TrailMind, and every other remote system are outside this
package. A fresh real attempt requires separate explicit authorization and a
new five-minute envelope; the local preflight alone never grants it.
