# TrailMind Phase 1 V2 Production Observer Security Review V1

Review date: 2026-08-30

Review role: independent principal security architect / PostgreSQL and Supabase red-team reviewer

Reviewed source: `origin/codex/secure-supabase-live-launcher-v1`

Reviewed commit: `adea2c08540e87f0acd7eebb976c72eab8eb76c3`

Reviewed tree: `0b0d0dbe7ac7c870261a0b0f8f8755039ddf6d22`

Review branch: `codex/red-team-supabase-production-observer-v1`

## Executive decision

**Recommended architecture:** one source-pinned production observer factory defined inside the existing machine-observer module. Each factory session must combine two independently authenticated, non-generic evidence planes:

1. a fixed-function Supabase Management API client authenticated with a short-lived, read-scoped OAuth2 access token; and
2. a distinct PostgreSQL auditor connection authenticated as a pre-provisioned, least-privilege login that can read all session statistics but cannot read TrailMind product data or perform application DDL/DML.

The existing single PostgreSQL mutating session remains the only mutation path. Four canonical, signed, hash-chained observer artifacts must be durably persisted. The terminal receipt may be published only after the mutating connection is closed and the separate auditor has produced two fresh, consecutive `0/0` cleanup samples for the exact run-bound application identity and original backend instance.

**GO to implement this architecture. NO-GO to enable `ADMITTED` or perform a live staging run today.** The launcher must continue returning `observer_required` until every gate in this review is satisfied. In particular:

- the current documented advisor GET endpoints are experimental/deprecated and do not expose a provider-generated run identifier or an observation timestamp proving that the result was recomputed after this run's DDL;
- the current `readonly_auditor_role` is created during the mutation, has `PASSWORD NULL`, and is not granted `pg_read_all_stats`, so it cannot be the independent observer that proves the session closed;
- the documented billing-addons endpoint does not list an OAuth scope, so a read-scoped OAuth token cannot currently prove the existing `$0` and zero-paid-addon contract without either an additional reviewed platform capability or an explicitly approved policy change; and
- no reviewed production package digest, observer signing public key, OAuth client, auditor role, or auditor credential exists in the reviewed baseline.

A broad personal access token (PAT), a Codex/MCP handoff, a manually created artifact, or an injected callback must not be accepted as a substitute.

## Scope, non-actions, and evidence standard

This was a source and documentation review. It made no Supabase MCP, Management API, database, provider, deployment, import, or feature-flag call. It did not inspect a credential, CA file, clipboard, `supabase/.temp`, `Configuration/Local.xcconfig`, provider configuration, or another worktree. No target or protected project was queried.

The review distinguishes three kinds of proof:

- **Cryptographic:** a verifier can check integrity/authorship from bytes and a pinned key or digest.
- **Causal:** trusted code can show an operation occurred after a bound predecessor and before a bound successor, but the external provider did not sign an application-level receipt.
- **Asserted/inferred:** a local component states or derives a fact that the external source did not independently attest. Asserted/inferred facts may be diagnostic but must not authorize `ADMITTED` unless the acceptance contract expressly permits that inference.

TLS authenticates the remote channel and protects bytes in transit. It does not make an HTTP response a provider-signed, non-repudiable receipt. SHA-256 of a local JSON object proves integrity relative to those bytes; it does not prove who created the object.

## Fixed target and protected identities

The observer must use these immutable literals. No runtime override, redirect target, environment substitution, query-supplied ref, or callback-supplied ref is allowed.

| Field | Required value |
|---|---|
| Project name | `TrailMind Outdoor Staging V1` |
| Project ref | `mbvzwsrtqcrwhvykugcd` |
| Organization name | `Alibra AI` |
| Organization id/slug binding | `wbnftkftyamxzvxsftda` |
| Region | `eu-central-1` / Frankfurt |
| Organization plan | `free` |
| Expected base monthly cost | `USD 0` |
| Expected compute | Free-plan/nano contract |
| PostgreSQL major | `17` |
| Database | `postgres` |
| Planua protected ref | `cmkvbxppgofteoutfslp` |
| Production protected ref | `bejvhhjbgtvctpsnlwid` |

The protected refs are deny-list literals, not inventory suggestions. No project-specific Management API or database request may contain either protected ref. If a bounded organization inventory contains either ref, it may be reduced immediately to `{ref, selected:false}` and its other fields discarded. The observer's transport ledger, not the inventory payload, must prove that zero requests targeted those refs.

## Baseline verification

The checked-out source exactly matched the requested commit and tree before analysis. The reviewed launcher intentionally has no production observer:

- [`stagingPhase1V2MachineObserver.js` lines 64-90](../../../../backend/src/operations/stagingPhase1V2MachineObserver.js#L64-L90) keeps the production factory/session weak sets empty and exposes no registration function.
- [`stagingPhase1V2LiveLauncher.js` lines 163-179](../../../../backend/src/operations/stagingPhase1V2LiveLauncher.js#L163-L179) requires a trusted production factory after safe-environment/TTY checks but before Git inspection, authorization collection, CA reading, password intake, network work, or database work.
- [`stagingPhase1V2LiveLauncher.js` lines 106-119](../../../../backend/src/operations/stagingPhase1V2LiveLauncher.js#L106-L119) correctly describes synthetic preflight as non-authorizing and network-free.

Therefore, **there is no reachable P1 or P2 false-green path in the current live launcher before a production observer exists.** Any arbitrary object, copied package metadata, synthetic fixture, or missing factory fails as `observer_untrusted` or `observer_required` before live effects.

The rest of this review identifies latent trust obligations that become security findings as soon as a production factory is added.

## Current official platform capability assessment

The following official documentation was reviewed as current on the review date:

- [Supabase MCP Server](https://supabase.com/docs/guides/ai-tools/mcp)
- [Management API introduction and authentication](https://supabase.com/docs/reference/api/introduction)
- [Get a project](https://supabase.com/docs/reference/api/v1-get-a-project)
- [Get an organization](https://supabase.com/docs/reference/api/v1-get-an-organization)
- [Get organization projects](https://supabase.com/docs/reference/api/v1-get-all-projects-for-organization)
- [List project billing addons](https://supabase.com/docs/reference/api/v1-list-project-addons)
- [Get security advisors](https://supabase.com/docs/reference/api/v1-get-security-advisors)
- [Get performance advisors](https://supabase.com/docs/reference/api/v1-get-performance-advisors)
- [Management API read-only query](https://supabase.com/docs/reference/api/v1-read-only-query)
- [Supabase database advisors](https://supabase.com/docs/guides/database/database-advisors)
- [Supabase platform access control](https://supabase.com/docs/guides/platform/access-control)
- [Supabase temporary database access](https://supabase.com/docs/guides/platform/temporary-access)
- [Supabase Postgres connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase Postgres roles](https://supabase.com/docs/guides/database/postgres/roles)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [PostgreSQL 17 monitoring statistics](https://www.postgresql.org/docs/17/monitoring-stats.html)
- [PostgreSQL 17 predefined roles](https://www.postgresql.org/docs/17/predefined-roles.html)
- [PostgreSQL 17 row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)
- [PostgreSQL 17 schema/search-path security](https://www.postgresql.org/docs/17/ddl-schemas.html#DDL-SCHEMAS-PATTERNS)

Relevant conclusions from those sources:

- Codex's Supabase MCP browser OAuth session is an MCP-client boundary. The repository process has no official mechanism to borrow or export that session. A repository process could implement a new remote MCP client, but it would need its own OAuth/PAT and would receive a generic tool surface rather than a provider-signed receipt.
- MCP can be project-scoped and read-only, but Supabase explicitly recommends not connecting MCP to production data. Its read-only mode constrains SQL execution; it does not create the run-bound, signed four-phase artifact contract required here.
- Management API PATs carry the same privileges as their user account. OAuth2 access tokens are short-lived and scoped. The standard Management API limit is 120 requests per minute per user and project/organization.
- The project, organization, organization-projects, advisor, and read-only-query endpoints exist. The security/performance advisor endpoints are explicitly marked experimental/deprecated.
- The advisor product documentation says advisors run automatically and can be manually rerun in the dashboard. The GET endpoint schema exposes lints but no documented run id, database transaction id, or server observation timestamp that binds a response to this DDL.
- The read-only query endpoint executes as `supabase_read_only_user`. Supabase documents that role as a broad data-reading role; it is not documented as having `pg_read_all_stats`.
- PostgreSQL ordinarily hides other sessions' detailed `pg_stat_activity` fields. A role needs `pg_read_all_stats` (or the broader `pg_monitor`) for reliable visibility. A result of zero from an underprivileged auditor can therefore be a false zero.
- Supabase's Read-Only organization role and project-scoped roles are available only on Team/Enterprise, not the fixed Free organization. That prevents treating an ordinary Free-plan user's PAT as a provider-enforced least-privilege control-plane credential.
- Direct database connections on port 5432 and session pooler connections on port 5432 preserve session identity. Transaction pooling on port 6543 is not suitable for the required PID/session proof.
- Temporary PAT/JWT database access is disabled by default and needs configuration and role mapping. Enabling or configuring it would be an out-of-scope control-plane mutation and must not be silently introduced as an observer dependency.

## Complete trust chain

The accepted chain must be linear. No phase may be manufactured or reordered by a caller.

1. **Human/Codex boundary.** The operator authorizes only the fixed Git commit/tree, target, CA digest, package digests, and time-bounded run. A Codex MCP OAuth session may inform a human review but cannot be transferred to repository runtime or treated as a receipt.
2. **Observer code trust anchor.** Git-clean reviewed source, the admission file inventory, the lockfile digest, the observer source-manifest digest, and a literal signing public-key digest collectively identify the only factory allowed into `productionFactories`.
3. **Management authentication boundary.** A short-lived OAuth access token with exactly `organizations:read`, `projects:read`, and `database:read` is delivered on a dedicated unlinked descriptor. The observer may not receive a refresh token, client secret, PAT, browser cookie, or Codex OAuth state.
4. **Management transport boundary.** A concrete client permits only HTTPS to `api.supabase.com:443`, the exact GET allowlist below, no redirect, no proxy, bounded DNS, bounded bodies, and a monotonic call ledger. This provides causal proof of which requests the trusted process sent.
5. **Pre-control observation.** The observer binds project/org/status/region/PostgreSQL version, plan, compute evidence, advisors, feature flags, Git/run/attempt, protected-project non-selection, and exact raw-response digests before authorization/password intake.
6. **Local launcher/TTY/FD/CA/TLS boundary.** The corrected launcher retains its current interactive no-echo intake, unlinked descriptor, protected CA, verify-full TLS, fixed host/address, clean Git, single-use authorization envelope, and immutable target checks.
7. **Mutating PostgreSQL session.** The current single adapter remains the sole mutation client. Static, digest-pinned SQL runs under one session, one target, one application name derived from the run binding, one advisory lock, and the current transaction/timeout/containment rules.
8. **Separate database-auditor session.** A second connection, with a different credential and role, observes exact session identity and catalog/ACL state. It never shares the mutating password, never accepts generic SQL, and never becomes the mutation session.
9. **Post-DDL advisors.** Only after the committed post step, the observer issues the exact advisor calls and records request/response timing and raw canonical response digests. Because the current endpoint has no freshness marker, the result remains insufficient for admission unless the platform capability or admission policy is separately corrected.
10. **Final control and database observation.** The observer repeats control identity/billing/advisors and the auditor independently verifies the exact target session, run-bound application name, backend start time, expected role/ACL/RLS/PostGIS state, and absence of sibling writer sessions.
11. **Durable artifact chain.** Four canonical JSON artifacts are written `O_EXCL`, mode `0600`, fsynced, linked by previous digest, and signed with a pinned Ed25519 key. Raw tokens, passwords, CA bytes, connection strings, SQL text, unrelated inventory, and API response bodies are not persisted.
12. **Independent cleanup.** After the mutating client has ended, the auditor clears its local stats snapshot and obtains two consecutive zero samples in fresh read-only transactions for the original PID/backend-start/application/run binding.
13. **Terminal receipt.** Only after all four artifacts, signatures, call ledger, cleanup samples, and descriptor closures verify may the existing durable receipt be published. Any ambiguity yields a failure/invalidation artifact and no `ADMITTED` receipt.

## Architecture comparison

| Candidate | Available capability | Secrets | What it can prove | What it cannot prove | Confused-deputy risk | May authorize `ADMITTED`? |
|---|---|---|---|---|---|---|
| Call Supabase MCP from repository runtime | A remote MCP server exists. The current Codex OAuth session is not exportable to the repository process; a new MCP client would require separate auth. | New OAuth/PAT, plus MCP session state | Causal MCP tool calls if the client and transcript are trusted | Provider-signed receipt, exact HTTP call surface, database cleanup visibility, reuse of Codex OAuth | High: generic tools include SQL and account/project operations; tool-name and prompt routing are broader than needed | **No** |
| Management API with separately contained PAT | Official and implementable | PAT with the user's privileges | TLS-authenticated fixed GET responses and a local call ledger | Least privilege on Free, non-use after leakage, advisor recomputation freshness, application-level provider signature | Critical if path/method/ref can vary or token leaks; PAT may reach every project the user can access | **No**, as a PAT architecture |
| Management API with short-lived scoped OAuth2 | Official for project/org/advisor read scopes | Access token only; no refresh token/client secret in observer | Causal fixed GET responses under limited read scopes | Billing-addons read is not documented with an OAuth scope; advisor freshness still absent | Moderate and containable with literal host/path/method/ref gate | **Only as part of the recommended combined architecture and only after all blockers close** |
| Two-phase Codex/MCP receipt handoff | Codex can perform interactive MCP work when connected | Codex OAuth plus a handoff artifact | That Codex observed something at two times | Same-process ordering, exact Git/PID/session, non-replay, provider signature, cleanup before publication | High: manual/copied receipts and cross-run evidence can be substituted | **No** |
| Generic injected transport/callback | Easy to implement and useful in deterministic tests | Whatever the callback captures | Only that the callback returned an object | Origin, method, host, project, query, token containment, independent cleanup | Critical: a caller can self-attest green evidence | **No** |
| Management API read-only SQL | Official beta endpoint using `supabase_read_only_user` | Management OAuth token | Some schema-qualified read-only SQL results | Full `pg_stat_activity` visibility or independent 0/0 cleanup; endpoint stability | Moderate: generic SQL and broad data reads; beta contract | **No** for session/cleanup proof |
| Direct read-only PostgreSQL auditor | PostgreSQL supports it; a suitable login is not present in this baseline | A distinct auditor password/token and CA | Exact live session/PID/backend-start visibility with `pg_read_all_stats`; catalog/ACL/RLS state | Control-plane plan/billing/project identity; provider advisor run freshness | Low if SQL and role are static/minimal; high if it reuses `postgres` or accepts arbitrary SQL | **Required component, not sufficient alone** |

The sole recommendation is the combined source-pinned Management OAuth + separate database auditor architecture described above. No fallback path is accepted.

## Proof limits of the recommended architecture

| Claim | Maximum available proof |
|---|---|
| Exact observer source | Cryptographic: Git tree, admission file digest, source-manifest digest |
| Artifact integrity/authorship | Cryptographic: SHA-256 plus Ed25519 signature under pinned public key |
| Supabase API origin | TLS channel authentication; not application-level non-repudiation |
| Exact API request order | Causal: monotonic in-process ledger chained into artifacts |
| Zero Management API mutations by observer | Causal under trusted code: method/path gate admits only exact GET calls; not a provider audit-log proof |
| Zero protected-project requests | Causal under trusted code: target literal/path parser rejects protected refs before networking |
| Project/org/region/status/Postgres version | Causal observation of documented API response fields |
| Free plan | Causal observation of organization response field |
| Exact `$0`, nano, and zero paid addons | **Not fully provable with the accepted OAuth scopes under current documented API. Admission blocker.** |
| Advisors were fetched after DDL | Causal local timing/order |
| Advisors were freshly recomputed after DDL | **Not provided by current documented advisor response. Admission blocker.** |
| Database ACL/RLS/PostGIS state | Independent SQL observation, bounded to static catalog/ledger queries |
| Mutating session identity | Independent observation of PID, backend start, run-derived application name, database, role, and TLS session |
| Cleanup `0/0` | Independent database auditor, two fresh samples after disconnect |
| No other actor mutated the project | Not provable from the documented endpoints; outside the observer's local call ledger |

## Attack-path analysis

### AP-01 — Arbitrary factory becomes an admission oracle

- **Preconditions:** a future change exposes registration, accepts package metadata/digest supplied by a caller, or adds a generic factory to `productionFactories` before authenticating its implementation.
- **Path:** caller copies trusted-looking package metadata -> callback emits four syntactically valid objects -> SHA-256 fields validate -> launcher enters the live adapter -> DDL is committed -> callback emits `0/0` cleanup -> receipt is published.
- **Impact:** unauthenticated self-attestation can authorize staging mutation and manufacture cleanup evidence.
- **Counterevidence in baseline:** the weak set is empty and private; there is no registration API ([machine observer lines 64-90](../../../../backend/src/operations/stagingPhase1V2MachineObserver.js#L64-L90)).
- **Disposition:** P0 future trap. Preserve private in-module construction and source pinning.

### AP-02 — Broad management credential becomes a cross-project deputy

- **Preconditions:** PAT belongs to a user with access to target plus Planua/production; transport accepts a variable URL/ref/method, follows redirects, honors proxy environment, or exposes a generic request function.
- **Path:** malicious parameter/error handler/redirect changes target -> bearer credential is sent to an attacker or a write endpoint -> protected project is queried or mutated -> local observer still reports target-only evidence.
- **Impact:** cross-project disclosure or destructive control-plane mutation.
- **Counterevidence in baseline:** no management credential/client exists; the launcher fixes the staging target and locally marks the protected refs ([machine observer lines 54-63](../../../../backend/src/operations/stagingPhase1V2MachineObserver.js#L54-L63)).
- **Disposition:** P0 future trap. Reject PAT authorization and generic transports; hard-code host/method/path/ref.

### AP-03 — Stale advisor result produces false green

- **Preconditions:** advisor GET returns cached/previous automatic results or a partial response that the observer reduces to zero blocking findings.
- **Path:** DDL creates a lint -> observer fetches an older empty `lints` array -> local code stamps current `observedAt` -> artifact says `completed/0` -> operator accepts it.
- **Impact:** insecure schema is admitted.
- **Evidence:** the current contract accepts locally asserted status/count/digest ([machine observer lines 498-511](../../../../backend/src/operations/stagingPhase1V2MachineObserver.js#L498-L511)); the operator checks only those reduced fields ([operator lines 655-681](../../../../backend/src/operations/stagingPhase1V2Operator.js#L655-L681)). The official endpoint is experimental/deprecated and documents no run freshness field.
- **Disposition:** P1 blocker.

### AP-04 — Underprivileged auditor reports false zero

- **Preconditions:** observer uses `supabase_read_only_user`, the current `readonly_auditor_role`, or any role without effective `pg_read_all_stats` membership.
- **Path:** query filters on application/PID fields hidden or incomplete for other users -> application maps null/unseen rows to no matches -> emits `0/0` -> receipt publishes while mutating session remains idle.
- **Impact:** live privileged connection survives terminal receipt.
- **Evidence:** PostgreSQL restricts other-session details; current migration creates `readonly_auditor_role LOGIN PASSWORD NULL` ([pre-migration lines 109-110](../database/PHASE_1_PRE_MIGRATION_V2.sql#L109-L110)) and only sets search path ([lines 479-480](../database/PHASE_1_PRE_MIGRATION_V2.sql#L479-L480)).
- **Disposition:** P1 blocker. A negative-visibility test is mandatory.

### AP-05 — Unkeyed artifact digest is mistaken for authenticity

- **Preconditions:** production artifacts are constructed like the synthetic artifacts and persisted or handed to another process.
- **Path:** attacker copies metadata -> edits evidence -> recomputes SHA-256 -> validator accepts digest -> downstream verifier treats the digest as an observer signature.
- **Impact:** durable evidence can be forged by anyone who can write an artifact.
- **Evidence:** current artifact validation recomputes unkeyed SHA-256 ([machine observer lines 455-458](../../../../backend/src/operations/stagingPhase1V2MachineObserver.js#L455-L458), canonicalization at [lines 624-635](../../../../backend/src/operations/stagingPhase1V2MachineObserver.js#L624-L635)). Weak-set identity protects live in-memory objects, not durable files.
- **Disposition:** P1 requirement. Add a pinned signature; never call SHA-256 a signature.

### AP-06 — Static application name permits cross-run/PID confusion

- **Preconditions:** stale artifact/restarted run shares `trailmind_phase1_v2_operator`; PostgreSQL reuses a PID; backend start is not bound.
- **Path:** observer associates a PID with a fixed app name -> process ends/restarts -> another backend or artifact reuses identifiers -> final/cleanup evidence is replayed across runs.
- **Impact:** wrong session is approved or live session is missed.
- **Evidence:** current connection always uses a fixed application name ([adapter lines 233-247](../../../../backend/src/operations/stagingPhase1V2SingleSessionAdapter.js#L233-L247)); cleanup binds PID/app/run in the object but not a database-visible run-derived name or backend start ([adapter lines 1617-1664](../../../../backend/src/operations/stagingPhase1V2SingleSessionAdapter.js#L1617-L1664)).
- **Disposition:** P1 requirement.

### AP-07 — Token leakage bypasses the observer's read-only code

- **Preconditions:** management token appears in argv, environment, inherited descriptor, proxy configuration, debug/error output, HTTP library diagnostics, redirect, core dump, or durable artifact.
- **Path:** attacker recovers token -> calls Management API outside observer allowlist -> changes or reads any resource the token subject can reach.
- **Impact:** cross-project compromise outside the local call ledger.
- **Counterevidence in baseline:** launcher already rejects common secret environment keys and secret-like argv ([launcher lines 81-84](../../../../backend/src/operations/stagingPhase1V2LiveLauncher.js#L81-L84), [122-133](../../../../backend/src/operations/stagingPhase1V2LiveLauncher.js#L122-L133)); no management token exists yet.
- **Disposition:** P1 requirement. OAuth access token only, dedicated descriptor, no refresh token, structured error allowlist, immediate close/wipe.

### AP-08 — SQL widening or role/search-path escape

- **Preconditions:** auditor accepts SQL strings, identifiers, schemas, roles, or search paths from observer evidence/callbacks; transaction read-only is not asserted; public/temporary schemas are trusted.
- **Path:** injected SQL changes role or transaction mode -> executes DDL/DML or reads product data -> reports expected catalog result.
- **Impact:** the “auditor” becomes a second mutation/exfiltration client.
- **Counterevidence in baseline mutation path:** Graph/DDL execution is currently static and admission-pinned; the proposed auditor does not exist.
- **Disposition:** P1 if generic SQL is exposed; otherwise P2 hardening. Permit only exact compiled statement IDs and parameters.

### AP-09 — Descriptor duplication, inheritance, offset, or lifecycle bug

- **Preconditions:** token/auditor secret descriptors are inherited by children, duplicated, share unexpected offsets, remain linked, start below 3, are read twice, or survive failure.
- **Path:** another component reads secret -> observer continues -> secret remains reusable or leaks through child/error path.
- **Impact:** credential disclosure and replay.
- **Counterevidence:** the database password path already uses a protected, unlinked FD and closes it ([launcher lines 759-821](../../../../backend/src/operations/stagingPhase1V2LiveLauncher.js#L759-L821)).
- **Disposition:** P2 for a correct fixed client; P1 if any secret can reach logging/child execution.

### AP-10 — Disconnect/cleanup race publishes too early

- **Preconditions:** `client.end()` resolves before server stats refresh; auditor holds a cached stats snapshot; one zero sample is accepted; receipt writer runs concurrently.
- **Path:** target socket begins close -> stale stats appears zero or hides row -> cleanup artifact emitted -> terminal receipt fsynced -> backend remains idle/reconnects.
- **Impact:** false terminal cleanup.
- **Evidence:** current ordering correctly calls cleanup before verifier and publication ([adapter lines 1617-1719](../../../../backend/src/operations/stagingPhase1V2SingleSessionAdapter.js#L1617-L1719)), but the missing verifier determines whether zero is real.
- **Disposition:** P1 requirement for the observer; two fresh samples and backend-start binding are mandatory.

### AP-11 — Partial/oversized/duplicated HTTP response changes semantics

- **Preconditions:** client accepts decompression bombs, duplicate JSON keys, wrong content type, truncation, chunked overflow, unknown lint levels, or a 200 body with embedded error/partial state.
- **Path:** parser drops/misorders fields -> reduction returns zero blocking findings -> green artifact.
- **Impact:** false control/advisor evidence or memory exhaustion.
- **Disposition:** P2. Exact schemas, byte/depth/count bounds, duplicate-key rejection, no compression, and fail-closed unknown values are required.

### AP-12 — Free-plan lifecycle and API instability create unsafe retries

- **Preconditions:** project is paused/inactive, API returns 402/429/5xx, advisor endpoint changes, request times out after the server acted, or observer retries/reorders calls.
- **Path:** retry duplicates evidence or mixes responses; a missing advisor is treated as empty; paused project identity is treated as healthy.
- **Impact:** stale/incomplete admission evidence or denial-of-service loops.
- **Disposition:** P2. No automatic retries in an admission run; inactive/paused/unknown status and every non-200 response fail closed.

## Prioritized findings

### P0 — Critical future reject traps

| ID | Finding | Baseline status | Required disposition |
|---|---|---|---|
| OBS-P0-01 | Any public registration, injected production factory, callback, copied metadata, or manual artifact can turn self-attestation into mutation authorization. | Adequately blocked now by private empty weak sets. | Production factory must be a private literal object created in the reviewed module and added internally only after its compiled package manifest is verified. |
| OBS-P0-02 | A broad PAT plus a variable URL/method/ref is a cross-project confused deputy capable of reaching Planua/production. | No token/client exists now; fixed local target is adequate. | PAT must not authorize `ADMITTED`. OAuth access token, exact GET-only paths, protected-ref deny before DNS, redirects/proxies disabled. |

### P1 — High blockers for the missing observer

| ID | Finding | Acceptance consequence |
|---|---|---|
| OBS-P1-01 | Advisor GET responses cannot currently prove recomputation after this DDL. | `observer_required` until provider freshness is available or a separately reviewed policy replaces this gate. |
| OBS-P1-02 | No independently authenticating auditor role with `pg_read_all_stats` exists before the mutation. | `observer_required`; do not reuse `postgres`, `supabase_read_only_user`, or the newly created `readonly_auditor_role`. |
| OBS-P1-03 | Current artifact digest is unkeyed and four observer artifacts are not durably persisted. | Add pinned Ed25519 signatures and durable chained files before terminal receipt. |
| OBS-P1-04 | Fixed application name and PID omit database-visible run/backend-start binding. | Derive the application name from the run binding and capture exact backend start. |
| OBS-P1-05 | Management credential leakage escapes local path/method restrictions. | Access token must be short-lived, scoped, descriptor-contained, non-inherited, redacted, and destroyed before receipt. |
| OBS-P1-06 | `$0`/zero-addon proof is not available through the documented accepted OAuth scopes. | Platform must expose a read-scoped billing capability or the policy must be separately reviewed; no inference may silently satisfy the current exact field. |
| OBS-P1-07 | A single or privilege-blind cleanup query can race or return false zero. | Require privilege self-test plus two fresh consecutive `0/0` samples after target close. |

### P2 — Medium hardening and availability findings

| ID | Finding | Required disposition |
|---|---|---|
| OBS-P2-01 | Redirect, proxy, DNS rebinding, endpoint smuggling, and response ambiguity can change what was observed. | Use the exact transport contract below and deterministic negative tests. |
| OBS-P2-02 | Secret descriptors can be duplicated/inherited/reused or retain an unsafe offset. | Use separate unlinked FDs, identity/size/nlink/offset checks, no child process, single read, close/wipe on every path. |
| OBS-P2-03 | Generic SQL/read-only-query APIs widen data exposure and allow search-path mistakes. | Do not use Management API SQL; direct auditor exposes compiled statement IDs only. |
| OBS-P2-04 | API 429/5xx/paused/partial responses may tempt retries or fallback to old evidence. | No retries/fallback; abort the run and retain no terminal receipt. |
| OBS-P2-05 | Current durable receipt persists projections/hashes, not the signed full observer chain. | Persist all four sanitized signed artifacts before receipt and include their ordered digest root. |
| OBS-P2-06 | Unknown advisor lint levels/categories could be omitted from a blocking count. | Unknown/malformed lint is blocking; stable canonical reduction and raw-response digest required. |

### P3 — Low operational findings

| ID | Finding | Required disposition |
|---|---|---|
| OBS-P3-01 | Wall-clock skew can make fresh artifacts appear reordered. | Use wall clock for bounded timestamps and monotonic elapsed time for order/timeouts; fail on skew. |
| OBS-P3-02 | Free-plan pause and advisor/rate-limit availability may frequently block admission. | Treat as safe operational NO-GO; do not weaken evidence to improve availability. |
| OBS-P3-03 | Notice-only advisor output needs an explicit policy. | Persist notice counts/digests; accept only enumerated nonblocking levels. Unknown levels block. |

No P0-P3 finding above asserts that the current unreachable live path is exploitable. P0 entries are traps that a production-observer implementation must reject; P1/P2 entries are missing trust properties that become reachable only when a factory is installed.

## Corrected launcher guarantees already adequate

These should be preserved, covered by regression tests, and not reimplemented in a parallel observer entry point.

- Fail closed on missing/untrusted observer before authorization/password/network/database work.
- Synthetic preflight cannot enter `productionFactories` and performs no remote calls.
- Exact staging target, project ref, org, region, database, PostgreSQL major, plan, endpoint class, host, port, and user are immutable.
- Planua and production refs are explicit protected literals.
- Arguments reject connection URLs, secrets, overrides, piped input, and transaction pooling.
- Git commit/tree/operator files/dependencies/migrations are read, hashed, bound into the authorization envelope, and rechecked by admission ([admission lines 153-182](../../../../backend/src/operations/stagingPhase1V2Admission.js#L153-L182), [217-300](../../../../backend/src/operations/stagingPhase1V2Admission.js#L217-L300)).
- Database password is taken from an interactive no-echo TTY, stored in an owner-only single-link file, unlinked before database use, and consumed through an FD.
- CA is absolute, outside the repository, owner-only, no-follow, bounded, fresh, parsed, hashed, and revalidated before database use.
- Direct/session endpoints use port 5432, verify-full TLS, server-name validation, public pinned IP, SCRAM channel binding, timeouts, one client, and one advisory lock. Transaction pooler port 6543 is not accepted.
- Mutating SQL and migration files are static and digest-pinned; admission and receipt are single-use/bounded.
- Adapter calls `cleanup()` before the external cleanup verifier and persists the receipt only after exact cleanup fields validate ([adapter lines 1585-1719](../../../../backend/src/operations/stagingPhase1V2SingleSessionAdapter.js#L1585-L1719)).
- Final receipt uses `O_EXCL`, `0600`, file fsync, and directory fsync ([launcher lines 854-917](../../../../backend/src/operations/stagingPhase1V2LiveLauncher.js#L854-L917)).
- Failure messages are bounded and sanitized.

## Residual baseline false-green review

**Result: no reachable residual P1/P2 false-green exists before the observer is installed.** The earliest production-factory check blocks all live paths. The following code sites are latent acceptance hazards, not current live vulnerabilities:

1. **Unkeyed artifact integrity only:** [`stagingPhase1V2MachineObserver.js` lines 455-458 and 624-635](../../../../backend/src/operations/stagingPhase1V2MachineObserver.js#L455-L458). Safe for weak-set-protected synthetic in-memory fixtures; insufficient for durable production authenticity.
2. **Advisor reduction trusts observer-supplied counts:** [`stagingPhase1V2MachineObserver.js` lines 498-511](../../../../backend/src/operations/stagingPhase1V2MachineObserver.js#L498-L511) and [`stagingPhase1V2Operator.js` lines 655-681](../../../../backend/src/operations/stagingPhase1V2Operator.js#L655-L681). A production implementation must derive these fields from bounded raw responses and prove causal timing.
3. **Cleanup reduction trusts observer-supplied `0/0`:** [`stagingPhase1V2MachineObserver.js` lines 514-527](../../../../backend/src/operations/stagingPhase1V2MachineObserver.js#L514-L527). A production implementation must require independent auditor visibility and fresh samples.
4. **Generic boundary shapes exist for testability:** [`stagingPhase1V2SingleSessionAdapter.js` lines 193-208 and 303-324](../../../../backend/src/operations/stagingPhase1V2SingleSessionAdapter.js#L193-L208). They are not a production observer registration path today. The production launcher must continue constructing all boundaries internally; the observer must not expose these as a generic transport hook.
5. **Only the final projected receipt is durable:** [`stagingPhase1V2LiveLauncher.js` lines 854-917](../../../../backend/src/operations/stagingPhase1V2LiveLauncher.js#L854-L917). The implementation must persist the four signed observer artifacts, not only their projected digest fields.
6. **Database-visible run binding is incomplete:** the target connection uses static `trailmind_phase1_v2_operator` ([adapter lines 233-247](../../../../backend/src/operations/stagingPhase1V2SingleSessionAdapter.js#L233-L247)). The cleanup object contains `runId`, but `pg_stat_activity` cannot independently associate that run with the static application name.

If any of these latent sites is used unchanged as proof after a production factory is registered, it becomes a P1 false-green path.

## Exact implementation acceptance contract

### 1. Factory/package trust anchor

The implementation is acceptable only if all of the following hold:

- The production factory is a module-private, deeply frozen literal created inside `stagingPhase1V2MachineObserver.js` (or imported from exact digest-pinned internal modules) and added to `productionFactories` during module initialization.
- There is no exported registration, setter, factory builder, generic callback, transport injection, artifact resealer, test hook, or environment switch that can create a production factory/session.
- Synthetic and production constructors, package ids, keys, weak sets, artifact schemas, and artifact file prefixes are disjoint.
- Every new executable observer/transport/auditor file is added to `EXECUTABLE_OPERATOR_FILES` in `stagingPhase1V2Admission.js`. `backend/package.json` and `backend/package-lock.json` remain in the dependency digest.
- A literal `packageSourceDigest` is computed as SHA-256 over the byte-exact sorted manifest using:

  `path + NUL + sha256(fileBytes) + LF`

  The manifest must include at minimum the machine observer, Management client, database auditor, live launcher, admission, adapter, operator, `backend/package.json`, and `backend/package-lock.json`. A digest supplied by runtime configuration or copied package metadata is invalid.
- The package id is exactly `trailmind.production.staging-phase1-v2-observer`; trust mode is exactly `production-authenticated-v1`; package version is a reviewed literal.
- The production artifact signature algorithm is Ed25519. The public key bytes and SHA-256 public-key digest are literal reviewed constants included in the admission digest. The private key is never in the repository and is delivered to a signing component through its own protected, unlinked FD. Missing key, wrong key id, invalid signature, or a runtime-configured public key returns `observer_required`/`observer_untrusted`.
- The signed payload is the ASCII domain-separated value:

  `trailmind-production-observer-v1` + NUL + lowercase artifact SHA-256 hex.

The implementation commit itself supplies the final literal source and public-key digests. A placeholder, `TBD`, dynamically calculated expected digest, or unreviewed key means `OBSERVER_REQUIRED`.

### 2. Management authentication and secret containment

Allowed authentication for `ADMITTED` is a **short-lived OAuth2 access token only**, with exact scopes:

- `organizations:read`
- `projects:read`
- `database:read`

The observer must not receive or inspect a refresh token, OAuth client secret, authorization code, browser cookie, Codex MCP credential, PAT, database password, service-role key, anon key, or provider configuration.

Token intake requirements:

- dedicated FD >= 3, distinct device/inode from database-password, auditor-password, signer-key, CA, envelope, and every other secret/artifact descriptor;
- owner uid, regular file, `0600`, one link before unlink, no symlink, bounded to 8 KiB, non-empty, no NUL/newline, offset exactly zero, unlinked before first DNS or HTTP call;
- one read, no duplicate descriptor handed to another component, no child process while the FD/key exists, no environment/argv/stdin/clipboard/file-path intake;
- authorization header created only at write time and never included in exception strings, diagnostics, redirects, traces, artifacts, heap snapshots, request dumps, or receipts;
- no refresh; no retry with another credential; close FD and overwrite owned buffers immediately after the last request and before cleanup/receipt publication.

Because the current billing-addons endpoint does not document an OAuth scope, inability to obtain the exact billing evidence with these scopes is `control_billing_capability_unavailable`, which maps to `OBSERVER_REQUIRED`. A PAT fallback is forbidden.

### 3. Management host, methods, paths, and ceilings

The only authority is `api.supabase.com`, port `443`, scheme HTTPS. The client must construct paths from literals, not URL-join user input. No other authority, IP literal Host header, alternate port, userinfo, fragment, percent-encoded slash/backslash, dot segment, duplicate query key, or trailing path component is legal.

Allowed requests per run:

| Phase | Exact method and path | Calls |
|---|---|---:|
| pre-control | `GET /v1/projects/mbvzwsrtqcrwhvykugcd` | 1 |
| pre-control | `GET /v1/organizations/wbnftkftyamxzvxsftda` | 1 |
| pre-control | `GET /v1/organizations/wbnftkftyamxzvxsftda/projects?limit=100&offset=0` | 1 |
| pre-control | `GET /v1/projects/mbvzwsrtqcrwhvykugcd/advisors/security` | 1 |
| pre-control | `GET /v1/projects/mbvzwsrtqcrwhvykugcd/advisors/performance` | 1 |
| post-ddl-advisors | the two exact advisor GETs above | 2 |
| final-control | the five exact pre-control GETs above | 5 |

The normal ceiling is exactly 12 Management API requests. A thirteenth request fails before network. The billing-addons endpoint is deliberately not in the accepted OAuth allowlist; until its proof gap is resolved, admission remains blocked. No protected-project-specific endpoint is allowed.

Transport requirements:

- only `GET`; no request body; only `Accept: application/json`, a fixed user agent, and the Authorization header;
- TLS 1.2 or 1.3, normal platform trust store, exact SNI/hostname verification, `rejectUnauthorized=true`;
- resolve the exact hostname once per phase to public addresses; connect to one admitted address while retaining exact SNI/Host; reject loopback, private, link-local, multicast, documentation, unspecified, and DNS-changed addresses;
- redirects disabled for every 3xx; proxy environment and library-global agents/proxies ignored/rejected; no HTTP downgrade; no alternate certificate callback;
- connect timeout 3 seconds, TLS/header timeout 5 seconds, per-request total 10 seconds, whole Management phase 45 seconds;
- response header bytes <= 16 KiB, compressed responses rejected, body <= 256 KiB before parse, JSON depth <= 16, arrays <= 10,000, strings <= 16 KiB, duplicate JSON keys rejected;
- exact content type JSON, exact documented status 200, complete socket end, no trailing bytes, exact response schema, unknown enum/lint level/category treated as blocking;
- no automatic retry on timeout, EOF, 3xx, 401, 403, 404, 402, 429, 5xx, parse error, or endpoint change. A new run with a new attempt/run id is required.

Each request ledger entry records only method, literal path id, phase, ordinal, monotonic start/end offsets, HTTP status, response byte count, selected non-sensitive freshness/rate-limit headers, canonical raw-response digest, and a previous-entry digest. It must never store raw response bodies or headers capable of containing credentials.

### 4. Management response rules

- Project response must exactly bind ref, organization id/slug, name, region, `ACTIVE_HEALTHY`, and PostgreSQL major 17. `INACTIVE`, paused, unknown, upgrading, unhealthy, absent, or inconsistent fields block.
- Organization response must exactly bind id/slug, name `Alibra AI`, and plan `free`.
- Organization-projects response must contain exactly one entry for the target with matching identity/region/status/compute; at most 100 entries; evidence for unrelated projects is discarded after checking target/protected-ref membership. Pagination/truncation blocks.
- Project and organization identity must match across all three phases byte-for-byte after canonical normalization.
- Advisor bodies must contain exactly one `lints` array and no error/partial marker. `ERROR` and `WARN` are blocking. Only an explicit reviewed list of `INFO` levels may be nonblocking. Unknown/missing level, duplicate/cache key, malformed metadata, excessive count, or changed schema blocks.
- The canonical digest of the complete bounded advisor body is retained in the artifact; the body itself is not durable.
- Post-DDL advisor request start must be strictly after the signed post-step completion evidence and its committed transaction end. Final advisor request start must be later than post-DDL advisor completion.
- A locally current `observedAt` must never be represented as provider freshness. Unless the response/API supplies a provider observation id/timestamp demonstrably after the DDL commit, status is `advisor_freshness_unproved` and admission stays `OBSERVER_REQUIRED`.
- Free plan plus nano compute may not be silently converted into `$0`/zero addons. The current exact billing fields require a provider response under an accepted read scope or a separately approved contract revision.

### 5. Mutating session run binding

Replace the fixed database application name with this deterministic, non-secret value:

`trailmind_p1v2_` + first 24 lowercase hex characters of SHA-256 over RFC 8785 canonical JSON containing exactly `runId`, `authorizationBindingDigest`, `candidateCommit`, and `projectRef`.

The same full hash is `databaseRunBindingDigest` in every artifact and receipt. The adapter, admission envelope, observer request, `pg_stat_activity` query, cleanup proof, and receipt must all require the derived name and full digest. No caller supplies the application name.

The first auditor sample after target connection records:

- exact target backend PID;
- exact `backend_start` timestamp;
- derived application name;
- `database=postgres`;
- `usename=postgres`;
- `backend_type=client backend`;
- target TLS in use;
- exact one matching target session and zero sibling sessions with the derived name.

Every later phase must bind the same tuple. PID without `backend_start` is insufficient.

### 6. Separate database auditor

The auditor is a second database connection and credential. It must not be created by, share a password with, or authenticate as the mutating `postgres` session. It must exist and authenticate before any Phase 1 mutation.

The reviewed baseline's `readonly_auditor_role` is not usable: it is created during the operation, has `PASSWORD NULL`, and lacks the required stats grant. A separately approved pre-provisioning step must create a dedicated login, proposed exact name `trailmind_phase1_v2_observer_auditor`, and update the initial-state/ACL policy to expect it. Provisioning is outside the observer run.

Minimum role contract:

- `LOGIN`, `CONNECTION LIMIT 1`, `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`;
- `CONNECT` on database `postgres` only;
- membership in `pg_read_all_stats` with `INHERIT FALSE`, `SET TRUE`, `ADMIN FALSE`;
- no `pg_monitor`, `pg_read_all_settings`, `pg_read_all_data`, `pg_write_all_data`, role-admin, schema-create, product-schema usage/select, function execute, service-role, or RLS-bypass grant;
- role/database defaults: `default_transaction_read_only=on`, `search_path=pg_catalog`, `statement_timeout=5s`, `lock_timeout=1s`, `idle_in_transaction_session_timeout=5s`;
- optional `SELECT` after DDL only on the exact Phase 1 migration-ledger relation if independent ledger-row validation is retained. No TrailMind user/location/route/evidence table access.

Auditor connection requirements mirror the mutating direct/session port-5432, public-address pinning, CA, verify-full TLS, SCRAM-plus, and timeout contract. It uses a separate unlinked owner-only password FD and a distinct application name derived from the same run digest. Transaction pooler 6543 is forbidden.

Before observations, the auditor must prove its own session/role and effective `pg_read_all_stats` membership. It then executes `SET ROLE pg_read_all_stats` and only the following compiled statement families. The implementation must store their normalized SHA-256 digests in the source manifest; there is no exported `query(sql)` method.

#### `auditor_identity_v1`

Read-only transaction; schema-qualified catalog query that returns exactly one login role and asserts all role flags, connection limit, exact direct membership set `{pg_read_all_stats}`, membership options `inherit=false,set=true,admin=false`, database `postgres`, TLS active, and configured timeouts/search path. Any null/hidden/unexpected field blocks.

#### `target_session_v1(pid, application_name, backend_start)`

Read-only transaction with `SET LOCAL stats_fetch_consistency = 'none'`; call `pg_catalog.pg_stat_clear_snapshot()` immediately before a schema-qualified `pg_catalog.pg_stat_activity`/`pg_catalog.pg_stat_ssl` query. Parameters are typed values, never interpolated identifiers. It returns:

- `exact_backend_instance_count`: rows matching database, `postgres` user, PID, application name, backend start, client-backend type, and TLS;
- `matching_application_count`: all client backends with the exact derived application name;
- `idle_exact_instance_count`: exact instance in an idle/idle-in-transaction state;
- `same_pid_other_instance_count`: same PID with different backend start/app identity.

Live/final expectations are `1/1/(0 or 1)/0`; cleanup expectations are `0/0/0/(0 or 1)`, where a reused PID with a different backend start is recorded but cannot satisfy the original instance.

#### `database_acl_v1`

Read-only, schema-qualified catalog statements copied from and kept semantically equal to the existing pinned ACL/RLS/PostGIS checks: `pg_roles`, `pg_auth_members`, `pg_namespace`, `pg_class`, `pg_proc`, `pg_policy`, `pg_extension`, and ACL-expansion functions in `pg_catalog`. It must verify the exact expected Phase 1 roles/attributes/memberships, schema/object owners, revokes/grants, RLS/policies, function security/search paths, PostGIS isolation/ownership, provider-fixture restoration, and migration ledger metadata without selecting product rows. Unknown objects/grants block.

The compiled SQL boundary is exact. Connection setup issues the following statements individually; it does not submit a multi-statement string:

```sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SET LOCAL idle_in_transaction_session_timeout = '5s';
```

`auditor_identity_v1` is exactly:

```sql
SELECT
  pg_catalog.current_database() AS database_name,
  SESSION_USER AS session_user_name,
  CURRENT_USER AS current_user_name,
  login.rolcanlogin,
  login.rolinherit,
  login.rolsuper,
  login.rolcreatedb,
  login.rolcreaterole,
  login.rolreplication,
  login.rolbypassrls,
  login.rolconnlimit,
  pg_catalog.current_setting('transaction_read_only') AS transaction_read_only,
  pg_catalog.current_setting('search_path') AS search_path,
  pg_catalog.current_setting('statement_timeout') AS statement_timeout,
  pg_catalog.current_setting('lock_timeout') AS lock_timeout,
  pg_catalog.current_setting('idle_in_transaction_session_timeout') AS idle_timeout
FROM pg_catalog.pg_roles AS login
WHERE login.rolname = SESSION_USER;
```

Its membership query is exactly:

```sql
SELECT
  granted.rolname AS granted_role,
  membership.admin_option,
  membership.inherit_option,
  membership.set_option
FROM pg_catalog.pg_auth_members AS membership
JOIN pg_catalog.pg_roles AS granted
  ON granted.oid = membership.roleid
JOIN pg_catalog.pg_roles AS member
  ON member.oid = membership.member
WHERE member.rolname = SESSION_USER
ORDER BY granted.rolname;
```

Its TLS query is exactly:

```sql
SELECT ssl, version, cipher, bits
FROM pg_catalog.pg_stat_ssl
WHERE pid = pg_catalog.pg_backend_pid();
```

After exact identity/membership/TLS validation, the client issues `SET LOCAL ROLE pg_read_all_stats;` and `SELECT pg_catalog.pg_stat_clear_snapshot();`. `target_session_discovery_v1($1::integer, $2::text)` is exactly:

```sql
SELECT
  activity.pid,
  activity.backend_start,
  activity.application_name,
  activity.datname,
  activity.usename,
  activity.backend_type,
  activity.state,
  ssl.ssl,
  ssl.version
FROM pg_catalog.pg_stat_activity AS activity
LEFT JOIN pg_catalog.pg_stat_ssl AS ssl
  ON ssl.pid = activity.pid
WHERE activity.pid = $1::integer
  AND activity.application_name = $2::text
  AND activity.datname = 'postgres'
  AND activity.usename = 'postgres'
  AND activity.backend_type = 'client backend';
```

Discovery must return exactly one row with `ssl=true`. Its returned `backend_start` becomes the immutable third parameter. After another `SELECT pg_catalog.pg_stat_clear_snapshot();`, `target_session_v1($1::integer, $2::text, $3::timestamptz)` is exactly:

```sql
SELECT
  pg_catalog.count(*) FILTER (
    WHERE activity.pid = $1::integer
      AND activity.application_name = $2::text
      AND activity.backend_start = $3::timestamptz
      AND activity.datname = 'postgres'
      AND activity.usename = 'postgres'
      AND activity.backend_type = 'client backend'
      AND ssl.ssl IS TRUE
  )::integer AS exact_backend_instance_count,
  pg_catalog.count(*) FILTER (
    WHERE activity.application_name = $2::text
      AND activity.datname = 'postgres'
      AND activity.usename = 'postgres'
      AND activity.backend_type = 'client backend'
  )::integer AS matching_application_count,
  pg_catalog.count(*) FILTER (
    WHERE activity.pid = $1::integer
      AND activity.application_name = $2::text
      AND activity.backend_start = $3::timestamptz
      AND activity.datname = 'postgres'
      AND activity.usename = 'postgres'
      AND activity.backend_type = 'client backend'
      AND activity.state IN (
        'idle', 'idle in transaction', 'idle in transaction (aborted)'
      )
  )::integer AS idle_exact_instance_count,
  pg_catalog.count(*) FILTER (
    WHERE activity.pid = $1::integer
      AND activity.backend_type = 'client backend'
      AND (
        activity.application_name IS DISTINCT FROM $2::text
        OR activity.backend_start IS DISTINCT FROM $3::timestamptz
        OR activity.datname IS DISTINCT FROM 'postgres'
        OR activity.usename IS DISTINCT FROM 'postgres'
      )
  )::integer AS same_pid_other_instance_count
FROM pg_catalog.pg_stat_activity AS activity
LEFT JOIN pg_catalog.pg_stat_ssl AS ssl
  ON ssl.pid = activity.pid;
```

The `database_acl_v1` statements are the byte-exact, independently executed read-only copies of the existing [`SHARED_ACL_SQL` constants at adapter lines 106-182](../../../../backend/src/operations/stagingPhase1V2SingleSessionAdapter.js#L106-L182) plus the final catalog/RLS/PostGIS inspection statements at [`adapter lines 1107-1390`](../../../../backend/src/operations/stagingPhase1V2SingleSessionAdapter.js#L1107-L1390). The implementation must extract each current statement into an immutable auditor statement constant, preserve all literal expected-role/object lists, run it on the auditor connection, and pin the ordered normalized statement digests in `packageSourceDigest`. It must not call the mutation session's `query` closure or accept caller SQL. Any future change to one of those statements changes the package/admission digest and requires review.

Every successful observation transaction ends with `COMMIT;`; every failure issues bounded `ROLLBACK;` and closes the auditor. Cleanup samples each begin a new read-only transaction and repeat `SET LOCAL ROLE pg_read_all_stats;` plus `pg_stat_clear_snapshot()` so PostgreSQL transaction-scoped statistics caching cannot manufacture a zero.

No statement may contain a writable CTE, DDL, DML, `COPY`, `DO`, `CALL`, `LISTEN`, `NOTIFY`, advisory lock, dynamic SQL, non-`pg_catalog` function except exact inspected TrailMind metadata, unqualified name, caller-provided identifier, `SET transaction_read_only=off`, or `SET search_path` to a writable schema.

### 7. Four artifact schemas and phase order

All artifacts use schema version 2 and RFC 8785 JSON Canonicalization Scheme. Exact common fields:

```text
schemaVersion, contractId, contractVersion, contractDigest,
package { id, version, trustMode, packageSourceDigest, signingKeyId },
binding { attemptId, runId, authorizationBindingDigest|null,
          candidateCommit, candidateTree, operatorDigestsDigest,
          projectRef, organizationId, region, databaseRunBindingDigest },
phase, sequence, observationId, requestNonce, observedAt,
monotonicStartedNanoseconds, monotonicCompletedNanoseconds,
session { applicationName|null, backendPid|null, backendStart|null },
previousArtifactDigest, managementCallLedgerDigest,
auditorEvidenceDigest|null, evidence, artifactDigest,
signature { algorithm, keyId, signedPayloadDigest, valueBase64 }
```

Extra/missing fields block. Each artifact is <= 64 KiB; all IDs/nonces are unique; timestamps are within five minutes and monotonic; digests are lowercase SHA-256; signature is valid; phase/sequence/previous digest are exact.

1. **`pre-control`, sequence 1:** authorization binding and database session fields are null. Evidence contains exact project/org/region/status/PG17/plan/compute observations, billing capability status, canonical pre-advisor reductions/digests, all feature flags false, protected refs unselected, zero non-GET calls, zero protected-ref calls, and response/call-ledger digests. It must complete before CA/authorization/database-password intake.
2. **`post-ddl-advisors`, sequence 2:** previous digest is artifact 1; binds post-step evidence digest/commit time plus exact PID/backend-start/application/run; contains security/performance raw-response digests, full lint-set digests/counts by explicit level, request timings, unknown/partial counts, and provider-freshness evidence. No `completed/0` synthesis is allowed.
3. **`final-control`, sequence 3:** previous digest is artifact 2; repeats exact control identity/billing/advisors, binds the unchanged target and package, contains auditor session tuple, exact ACL/RLS/PostGIS/catalog digest, expected database ACL digest, provider restore digest, one exact target session, zero sibling run-bound sessions, and zero observer Management mutations/protected requests.
4. **`post-disconnect-cleanup`, sequence 4:** previous digest is artifact 3; binds the staged receipt digest and exact original target tuple; contains two cleanup samples, each with a fresh stats-snapshot id/time and `exact_backend_instance_count=0`, `matching_application_count=0`, `idle_exact_instance_count=0`; samples are at least 250 ms and at most 2 s apart; records target close completion before sample 1 and publication eligibility after sample 2.

Required causal order:

`pre-control persisted` -> `operator authorization/secret intake` -> `target connect and independent session bind` -> `DDL/post-step commit` -> `post-ddl advisor calls/artifact persisted` -> `final control + independent database artifact persisted` -> `terminal receipt staged` -> `target socket/session close` -> `two independent cleanup samples/artifact persisted` -> `observer token/auditor/signing descriptors closed` -> `terminal receipt published`.

No phase can be retried or duplicated inside a run. A failed phase requires a new attempt/run id; already written artifacts remain as invalidated evidence and cannot be consumed by another run.

### 8. Durable files and terminal publication

Persist exactly four files in the protected attempt directory before the receipt:

- `<runId>.observer.01.pre-control.json`
- `<runId>.observer.02.post-ddl-advisors.json`
- `<runId>.observer.03.final-control.json`
- `<runId>.observer.04.post-disconnect-cleanup.json`

Each write uses `O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW`, mode `0600`, owner uid, one link, exact byte count, file fsync, close, re-open/read/verify digest+signature+chain, and directory fsync. No rename over an existing file and no caller-supplied path.

The terminal receipt must include:

- ordered artifact digests and a chain-root digest;
- package source/public-key/contract/operator digests;
- attempt/run/authorization/Git/target/run-binding values;
- exact PID/backend start/application name;
- cleanup sample digests and `0/0` counts;
- Management call-ledger root and total call count 12;
- auditor ACL evidence digest;
- explicit status `committed` with a separately interpreted admission decision `ADMITTED` only when every boolean gate is true.

Receipt publication is forbidden until artifact 4 is re-read and verified, all secret FDs/buffers are closed/wiped, target client is closed, auditor client is closed after proof, no HTTP request/retry/redirect is pending, and all files/directories are fsynced. If publication fails, no alternate stdout/manual receipt is authoritative.

### 9. Failure taxonomy and cleanup behavior

Required stable failures:

| Class | Codes (minimum) |
|---|---|
| Factory/package | `observer_required`, `observer_untrusted`, `observer_package_digest`, `observer_signature_key`, `observer_contract` |
| Management auth/transport | `control_auth_required`, `control_auth_scope`, `control_transport`, `control_endpoint`, `control_redirect`, `control_response_bounds`, `control_rate_limited` |
| Identity/billing | `control_identity`, `control_status`, `control_plan`, `control_compute`, `control_billing_capability_unavailable` |
| Advisors | `advisor_unavailable`, `advisor_schema`, `advisor_partial`, `advisor_unknown_lint`, `advisor_blocking`, `advisor_freshness_unproved` |
| Auditor | `auditor_auth_required`, `auditor_role`, `auditor_privilege`, `auditor_visibility`, `auditor_tls`, `auditor_sql`, `auditor_acl` |
| Binding/artifacts | `observer_replay`, `observer_order`, `observer_cross_binding`, `observer_stale`, `observer_oversized`, `observer_signature`, `observer_persistence` |
| Cleanup/receipt | `cleanup_pending`, `cleanup_visibility`, `cleanup_race`, `cleanup_unproved`, `receipt_publication_rejected`, `receipt_publication_unproved` |

Before the first mutation, every failure closes/wipes secrets and writes only a sanitized attempt invalidation. After mutation begins, the existing containment/compensation path runs first; observer/auditor cleanup is best effort and bounded; no green terminal receipt is written. An uncertain network response never causes a Management retry because all permitted requests are reads, but uncertainty still blocks the run. A failure to prove cleanup is `cleanup_unproved`, not success with a warning.

### 10. Required tests

#### Deterministic tests

The production factory cannot be accepted until deterministic tests cover at least:

- missing, arbitrary, copied-metadata, synthetic, manually constructed, unsigned, wrong-key, dynamically keyed, and unpinned factories/artifacts;
- artifact duplicate/replay/reorder, stale/future time, cross-run/attempt/project/org/region/Git/PID/backend-start/application/auth/receipt/package/key substitution;
- path/query/method/host/port/userinfo/fragment/percent-encoding smuggling; protected-ref path attempts; SSRF; redirects; DNS rebinding; private/documentation IP; TLS downgrade/cert/SNI failure; proxy environment;
- PAT/refresh-token/client-secret rejection; token in argv/env/error/redirect/debug/durable JSON; descriptor under 3, wrong owner/mode/link, symlink/race, duplicate inode, nonzero offset, partial read, inheritance/child process, double read, close on every failure;
- exact 12-call order/ceiling, no retries, 429/401/403/404/5xx/timeout/partial/chunk overflow/compression/duplicate JSON key/wrong content type/oversized/deep response;
- unknown/malformed/duplicate advisor lint; ERROR/WARN blocking; empty/partial/cached response; no provider freshness marker; pre-vs-post response replay;
- auditor missing `pg_read_all_stats`, hidden/null session fields, wrong role/memberships/search path/transaction mode/TLS, generic SQL/identifier injection, writable CTE/DDL/DML rejection;
- static vs run-derived application binding, PID reuse with different backend start, sibling/idle sessions, cached stats snapshot, one-zero-then-live race, two-zero timing;
- target close before cleanup, all artifact fsyncs before receipt, crash at every artifact/receipt write boundary, receipt-before-cleanup rejection, no stdout/manual fallback;
- Free/inactive/paused/unknown project status, billing capability unavailable, advisor endpoint removed, rate-limit exhaustion; all remain `OBSERVER_REQUIRED` or bounded failure;
- regression tests preserving current observer-first fail closed, synthetic no-network preflight, Git/CA/TTY/FD/TLS/single-session/lock/static-SQL/containment behavior.

Mocks must simulate the exact fixed TLS/API protocol and verify outbound bytes. A generic callback that directly returns green evidence is not sufficient coverage.

#### Real PostgreSQL 17 + PostGIS tests

The disposable integration suite must run without skips against a local TLS-enabled PostgreSQL 17 cluster with PostGIS and the required `supautils` fixture. It must use two real clients and distinct credentials:

1. pre-provision the exact auditor role/privileges;
2. connect the run-bound mutating session and independent auditor;
3. prove the auditor sees exactly one target PID/backend-start/application tuple;
4. remove `pg_read_all_stats` and prove the suite fails with `auditor_visibility`, never zero;
5. restore the grant and execute the real pinned pre/migrations/post flow plus no-op replay;
6. independently verify roles/memberships, PostGIS isolation, owners, ACLs, RLS/policies, function search paths/security, provider restore, ledger metadata, and zero sibling writers;
7. hold the target idle and prove cleanup cannot pass;
8. close the target, clear stats snapshots, obtain two consecutive real zero samples, and only then persist the receipt;
9. force PID-like/reconnect/backend-start mismatch and prove cross-instance evidence is rejected;
10. verify no auditor product-table SELECT or mutation succeeds and no second mutation session exists.

No test may touch the real Supabase target. Management API behavior is tested with a local TLS fixture; the real integration is database-local only.

### 11. Mandatory `OBSERVER_REQUIRED` conditions

The implementation must remain non-authorizing when any of these is true:

- source/package/public-key digest is absent, dynamic, changed, unreviewed, or not in the Git admission inventory;
- OAuth access token, exact scopes, signer key, auditor credential, auditor role, `pg_read_all_stats`, CA/TLS, or fixed endpoint proof is missing;
- a PAT, MCP credential/handoff, refresh token, generic callback/client/SQL API, manual artifact, or mutating Management endpoint is proposed;
- target/org/ref/region/status/plan/compute/PG17 identity is absent or mismatched;
- exact `$0`/zero-addon capability is unavailable under accepted read scopes;
- advisor endpoint is unavailable/changed/partial/rate-limited, contains unknown/blocking findings, or cannot prove the accepted freshness contract;
- independent target PID/backend-start/application/run visibility is incomplete or any count is ambiguous;
- either cleanup sample is not fresh/exact zero, samples are not consecutive, or receipt publication races cleanup;
- any deterministic or real PostGIS test is skipped, flaky, or fails;
- official Supabase endpoint/auth semantics materially change without review;
- the target is paused/inactive, Free-plan limits prevent evidence, rate limit is insufficient, or any required capability is only inferred.

## Platform/user decisions and credentials still required

These are prerequisites, not observer implementation defaults:

1. Approve and provision a Supabase OAuth integration whose access token has exactly the three read scopes and no broader token is passed to the observer.
2. Decide how the current `$0`/zero-addon contract will be proven. The recommended answer is a provider-documented OAuth read capability; otherwise a separate policy review is required. Do not fall back to PAT.
3. Obtain a provider-supported advisor freshness/recompute receipt or approve a separately reviewed replacement gate. Current GET data is not enough.
4. Approve and pre-provision the dedicated auditor role and a separate credential before the mutation; update initial-state and provider-fixture policy accordingly.
5. Provision an Ed25519 observer signing key outside the repository and pin its public key/digest in reviewed source.
6. Review the completed package source manifest/digest and all test evidence before adding the private factory to `productionFactories`.

None of these credentials or provider changes was requested, inspected, created, or applied during this review.

## Implementation-owner correction brief

Implement only the single combined architecture in this document. Preserve the existing observer-first fail closed. Add a private source-pinned factory; a fixed OAuth Management GET client; a separately authenticated `pg_read_all_stats` auditor with compiled SQL; a run-derived application name/backend-start tuple; and four signed durable artifacts. Do not use MCP, PAT, callbacks, manual receipts, Management SQL, `postgres` as auditor, or the current `readonly_auditor_role` as-is. Do not register the factory or permit a terminal receipt while billing or advisor freshness is unproved. The implementation is acceptable only after all deterministic and real PostGIS gates pass without skips and every `OBSERVER_REQUIRED` condition is false.

## Final acceptance state

| Decision | State |
|---|---|
| Implement recommended observer architecture | **GO** |
| Register production factory now | **NO-GO** |
| Enable live mutation now | **NO-GO** |
| Permit `ADMITTED` now | **NO-GO — `OBSERVER_REQUIRED`** |
| Current corrected launcher fail-closed behavior | **ACCEPTED** |
| Remote/control-plane/database mutation during review | **ZERO** |
| Credential/CA/provider-config access during review | **ZERO** |
