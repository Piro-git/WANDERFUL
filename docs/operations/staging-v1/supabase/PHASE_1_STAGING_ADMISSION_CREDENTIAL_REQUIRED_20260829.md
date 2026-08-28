# TrailMind Phase 1 staging admission — credential required

Status: `CREDENTIAL_REQUIRED`

Attempt: `310d1fe1-dfb2-4b2e-997f-2baeaabbdd45`

Generated: `2026-08-28T23:42:20Z`

Remote mutation did not begin. No database session was opened and no database read, SQL statement, advisor request, migration, compensation, import, projection, provider call, deployment, billing change, product enablement, or production operation occurred.

## Passed gates

- The remote `main` tip was freshly fetched into a task-owned disposable bare repository and matched required commit `10dd59adf4b12dec8288e261438331db78fff9b2` and tree `ae82c3e2e4693ae911587e3fbba2516469c9e4d2`. The fetch repository was removed after open-handle checks.
- Local `origin/main` matches the same pinned commit/tree. The task branch remains `codex/secure-supabase-staging-admission-v1`.
- No completed equivalent admission and no other active staging writer were found.
- Fresh Supabase MCP discovery found exactly one project named `TrailMind Outdoor Staging V1`: project `mbvzwsrtqcrwhvykugcd`, organization `Alibra AI` (`wbnftkftyamxzvxsftda`), Frankfurt (`eu-central-1`), `ACTIVE_HEALTHY`, Free plan / Nano $0 compute, PostgreSQL 17, platform `17.6.1.155`, GA.
- Planua and all seven other projects appeared only in the mandatory bounded inventory. They received zero project-specific reads and zero mutations.
- All 27 pinned operator, SQL, migration, capacity, lifecycle, and dependency-lock bytes matched the preserved digest manifest. The operator file-set digest is `3c41abd66538df0e5536bd80de2e58a5ea7d23ded89abb02af2b321928167bf4`; the managed migration digest is `c7f98ad346b1384af8fd186911f09414f7ac9e9a14526f81fb61d9db0625e62f`.
- Current official Supabase docs and changelog were rechecked. Direct verified TLS, or only the reviewed session-pooler class, remains required; transaction pooling cannot preserve the session/PID/advisory-lock contract. Free Nano remains $0 with a 500,000,000-byte database limit. The 2026 extension-version change does not weaken the candidate because it has zero explicit extension-version clauses.

The two prior blocked receipts remain byte-for-byte unchanged and are preserved by commit `f5a9d89d62589c89b2824f6db4cfcff9822a69b1`:

- JSON SHA-256: `dc015f003983e12cf2f06e86bd25ae5de4f0d2fdd8178b694c804103e96e3add`
- Markdown SHA-256: `6e24968c0261e89a1c0ddcbb1961237389f3003cacfe5d66a8f2053ef5a2d034`

## Credential blocker

The reviewed admission layer accepts the staging database password only from an inherited descriptor for an owner-only regular file whose pathname has already been unlinked. It separately requires an owner-only CA file outside the repository, a fresh five-minute single-use O_EXCL authorization envelope, and reviewed live control-plane, containment, cleanup-verifier, and durable-receipt boundaries. The checked-in live CLI deliberately refuses direct execution until those boundaries are installed.

This task received none of those protected live inputs. No credential source was inspected. No password, connection string, API key, token, clipboard value, environment secret, `Configuration/Local.xcconfig`, `supabase/.temp`, or local provider configuration was read. MCP SQL, dashboard SQL, a service-role key, a pooler substitute, weaker TLS, or an ad-hoc launcher was not used.

A fresh attempt identity was created, but no authorization envelope was created. A valid envelope cannot truthfully bind a missing unlinked credential descriptor, CA digest, endpoint address, provider ACL restore-plan digest, and live boundary package. Creating a placeholder or expired envelope would be a false authorization artifact; no prior attempt or envelope was reused.

## Safe local placement for a future attempt

1. In the Supabase Dashboard, open only the project whose exact name and reference are recorded above. From Project Settings → Database, obtain its current database password and download the current CA certificate from the SSL configuration area. Do not change the password, SSL enforcement, compute, networking, or any project setting for this handoff.
2. In a local terminal attached to this same isolated task—not chat and not the clipboard—create a new task-owned directory outside the repository with mode `0700`. Place only the CA certificate there as a new, non-symlink, owner-owned mode-`0600` file.
3. Use an interactive no-echo terminal prompt, never a shell argument or environment variable, to write the staging password into a newly created mode-`0600` regular file using exclusive creation. Open that file read-only on descriptor 3 or higher and immediately unlink its pathname. Keep the descriptor inside the same process that launches the reviewed adapter; a descriptor from an unrelated shell cannot be transferred later.
4. Install or supply the reviewed live boundary package that calls `runAuthorizedStagingPhase1V2SingleSession`. It must construct the fresh O_EXCL envelope only after resolving the allowed direct or reviewed session endpoint, hashing the protected CA, calculating the provider ACL restore-plan digest through the reviewed preflight, and rechecking the pinned clean candidate. Do not use the deliberately disabled CLI or the disposable test harness as a production launcher.
5. Resume this task with only a statement that the reviewed local handoff is ready. Do not send the secret, connection string, CA contents, token, file contents, shell history, or clipboard data in chat. The next attempt must create a new attempt ID and new short-lived envelope and repeat every Git, duplicate, control-plane, credential, and read-only database gate.

## Not run

Because the credential gate stopped this attempt, PostgreSQL/Supabase/`supautils` compatibility, endpoint TLS/channel binding, stable PID, roles, advisory lock, empty-foundation, database-size/headroom, migration ledger/no-op, owners, ACLs, RLS, functions, five-function runtime boundary, capacity lifecycle, empty row counts, advisors, and disabled endpoint probes are all truthfully `not_run_credential_required`.

The fresh source/digest proof passed 27/27. No fresh operator test suite, disposable PostgreSQL harness, PostGIS integration suite, complete backend suite, build, or 101-case evaluation was run after the credential gate stopped the attempt. The exact official `supabase/supautils` revision `31854163069a7891ce00bf361f913f4c7cc87c0a` was not downloaded or built because the authoritative database harness was not reached. Xcode was not invoked.

The two downstream tasks remain locked. After a future successful empty-foundation admission, the exact next tasks are bounded evidence import/projection with logical-backup and disposable-restore proof, and disabled HTTPS backend deployment/operations validation.
