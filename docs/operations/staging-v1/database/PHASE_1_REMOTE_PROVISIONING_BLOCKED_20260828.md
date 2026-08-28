# Supabase staging provisioning attempt — blocked before mutation

Outcome: **BLOCKED**. No remote mutation, migration, download, import,
projection, backup, restore, provider call, deployment, or feature enablement
occurred.

Machine-readable evidence:
`PHASE_1_REMOTE_PROVISIONING_BLOCKED_20260828.json`.

## Authorized target and baseline

The read-only inventory unambiguously identified the authorized project as
`TrailMind Outdoor Staging V1` (`mbvzwsrtqcrwhvykugcd`) in `Alibra AI`
(`wbnftkftyamxzvxsftda`), Frankfurt (`eu-central-1`), `ACTIVE_HEALTHY`,
PostgreSQL 17 / platform `17.6.1.155`. The organization remained on the Free
plan and the project had no development branches.

The live remote baseline was
`a36c646815f390b60df734147a78e82c8ef46dd1`, tree
`efd9c0469e031f24e2adfe84fe8bacf021f4c1b3`. The isolated worktree was clean
before work. Repository history, remote operator/staging branches, and existing
receipts contained no equivalent successful remote provision. The historical
`codex/supabase-staging-data-v1` branch records only the earlier resource
decision, not a live provision.

## Pristine remote state preserved

The initial and final read-only catalog snapshots were identical:

- database size: 11,709,587 bytes;
- PostGIS 3.3.7 available, not installed;
- zero TrailMind roles, schemas, relations, and functions;
- no TrailMind application migration ledger;
- only the historical Phase 1 pre-step and compensating rollback remain in
  the Supabase platform migration ledger (`20260824201634`,
  `20260824202617`);
- `CREATE` on `public` denied to `PUBLIC`, `anon`, `authenticated`, and
  `service_role`;
- zero current security-advisor notices and zero performance-advisor notices.

Production TrailMind, Planua, and every unrelated project remained outside the
mutation boundary and were not inspected beyond the mandatory project list.

## Why the reviewed operator could not run

The committed operator correctly refuses direct CLI execution. A live run
requires a fresh single-use authorization envelope and durable consumption
store, protected CA and password file-descriptor inputs, a pinned direct or
reviewed session-pooler address, and live control-plane, containment,
cleanup-verifier, and durable-receipt boundaries. None was supplied to this
task. No scoped Supabase PAT or staging database password was available.

Supabase's current temporary-access mechanism does not remove this blocker: it
is disabled by default, still requires an authorized user token and explicit
role mapping, and no such token or mapping was supplied. The existing project
database password cannot be retrieved through the Management API.

Independent MCP migration requests were not used. They cannot preserve the
reviewed one-session PID, non-waiting advisory lock, in-memory capability,
transaction boundary, locked reinspection, second-run no-op proof, cleanup
attestation, and receipt publication order. Manually replaying the SQL would
have bypassed the operator contract.

The admitted migration bytes remain exactly `001–007, 009, 010`; historical
`008` is excluded. Exact per-file SHA-256 digests are recorded in the JSON
receipt. Because the operator did not run, there is no application ledger and
no first-run or second-run result to claim.

## Free-plan and local capacity gate

Final settled local samples showed 11,441,604 KiB and 11,441,592 KiB free,
above the required 10,485,760 KiB threshold. The project remains subject to
Supabase's 500 MB Free database-size limit.

Historical repository sizing evidence describes 64,877,196 bytes of bounded
compressed Harz and Innsbruck derivatives, 215,286 imported trail segments,
221,242 projected entities, 258,754 projected assertions, and 37,019 projected
relationships. Expanding source geometry, duplicating it into the projection
graph, retaining append-only lineage, and building GiST/B-tree indexes gives a
conservative 450–800 MB risk band. This is not a measured current-volume
database size, but it crosses the 500 MB limit and therefore does not provide
the required safety margin. No data was downloaded or imported. A later pass
must measure the exact current bounded data in a disposable local PostGIS
database and demonstrate safe Free-plan headroom before remote import.

Historical source timestamps and derivative sizes in the JSON are sizing
references only. They are not represented as selected current import sources
or as staging provenance.

## Verification completed

- Focused migration/operator/admission/adapter/importer matrix after the
  lockfile-pinned dependency install: 84/84 passed, zero failures/skips.
- Fresh authoritative disposable Supabase-semantic harness: not run because
  the required official `supautils` library was not supplied. The harness
  failed before database creation and was not counted green.
- Complete backend suite: the sandbox diagnostic passed 1,041 and failed 22
  on loopback `EPERM`; the permitted loopback rerun passed 1,063/1,063 with
  zero failures/skips.
- Backend syntax build: passed.
- Offline outdoor-adventure evaluation: 101/101 passed with zero skips and
  zero bounds, determinism, provenance, safety, must-have, or route-verification
  violations.

All thirteen operator feature flags were unset in the execution process. The
shipping research/evidence flags remain `false` in tracked configuration. Test
providers were injected fakes only; GraphHopper and AI-provider call counts
were both zero.

## Unblock contract

1. Supply protected live-operator inputs without placing secret values in the
   repository, shell arguments, logs, or receipts.
2. Supply the live control-plane, containment, cleanup-verifier, and durable
   receipt boundaries expected by the reviewed operator.
3. Supply the official PostgreSQL 17 `supautils` library for a fresh
   authoritative disposable rerun.
4. Measure the current bounded Harz/Innsbruck database footprint locally and
   prove meaningful headroom below the Free-plan limit.
5. Re-run project identity, plan, region, clean-tree, duplicate, advisor,
   sibling-writer, and feature-off gates immediately before issuing a new
   single-use authorization.

Until those conditions are satisfied, roles/privileges, real imports,
projections, quarantine totals, query plans/p95, cancellation/fault behavior,
logical backup, and restore remain truthfully `not_run`. Database availability
alone would not establish production readiness or route quality.
