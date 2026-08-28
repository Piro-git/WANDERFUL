# TrailMind Phase 1 staging admission — control-plane blocked

Status: `CONTROL_PLANE_BLOCKED`

Generated: `2026-08-28T22:32:12Z`

Remote mutation did not begin. The mandatory exact-name gate found no Supabase project named exactly `TrailMind outdoor staging v1`.

The only near-match is `TrailMind Outdoor Staging V1` (`mbvzwsrtqcrwhvykugcd`). Its capitalization differs from the authorized name, so it is a non-target under this run's explicit authorization. It is in organization `Alibra AI` (`wbnftkftyamxzvxsftda`), in Frankfurt (`eu-central-1`), on the Free plan, active/healthy, and reports PostgreSQL 17 / platform `17.6.1.155`. The reviewed operator also pins the title-cased name `TrailMind Outdoor Staging V1`; those otherwise-correct properties do not cure this run's exact authorization mismatch.

## Git and duplicate gate

- Required and observed `origin/main`, fetched `FETCH_HEAD`, candidate, and `HEAD`: `10dd59adf4b12dec8288e261438331db78fff9b2`.
- Required and observed tree: `ae82c3e2e4693ae911587e3fbba2516469c9e4d2`.
- Reviewed operator ancestor: `a36c646815f390b60df734147a78e82c8ef46dd1`.
- Archived draft `29fdbef81515c93420517a484f119f0fb555d67b` is not an ancestor and was not used.
- Branch: `codex/secure-supabase-staging-admission-v1`.
- No completed equivalent remote admission and no other active staging writer were found. Prior related tasks were blocked or preparation-only.

## Immutable operator identity

- Operator file-set digest: `3c41abd66538df0e5536bd80de2e58a5ea7d23ded89abb02af2b321928167bf4`.
- Managed migration digest: `c7f98ad346b1384af8fd186911f09414f7ac9e9a14526f81fb61d9db0625e62f`.
- Build-context verifier: `200700b532a88de497750ca3b6f6e6d0f8d69993da5c06ae2ae1e0278ca9bd1`.
- Pre-migration SQL: `feb13b3f6ea6a538f6cd5223030fecca1cb0195bce3e0eb0204aed704ea0c16b`.
- Post-migration SQL: `3945c51cf26ca178e2bb2d6bfa7ac49aa6cf1bbcb268bf68272216efce153456`.
- Reviewed rollback SQL: `55aefe612d35262948b199fecf00960cb0ee39e88a6e8255dcd7a2f36f800ed2`.
- Capacity contract: `98deebe62e49b3a23c4cb30da5d1594b55852e0889342d63c9fe8fbf6af8c3c5`.
- Capacity lifecycle: `5d0b62d8ed18e1bf92ac358d18ebf6c3c7b4f97e8239f185780352260342c444`.
- Dependency lockfile: `f68d2c233fa98ed7dd57ba1bee8ab560069205b61cf371ca205f26f03f5c2533`.

The canonical JSON receipt records every reviewed operator and migration file digest, including exact order `001–007, 009, 010`; historical migration `008` remains excluded.

## Current platform guidance

The current Supabase changelog and official documentation were checked through Supabase MCP and official Supabase web sources before project discovery. The reviewed connection decision remains direct PostgreSQL over verified TLS, with only the reviewed session-pooler class as a possible IPv4 fallback. Transaction pooling remains inadmissible for the session/PID/advisory-lock/role-transition guarantees. Free projects still enter read-only mode at a 500,000,000-byte database size; the repository's 40,000,000-byte reserve remains stricter. The August 2026 extension-version-pinning change is not triggered because the candidate contains zero explicit extension version clauses.

## Containment and remote effects

Only read-only Supabase documentation and control-plane discovery were performed: one inventory, one organization read, and one near-match project read. No database SQL or advisor call was issued because no authorized target existed.

- `Planua` (`cmkvbxppgofteoutfslp`) mutation count: 0.
- Every non-target project mutation count: 0.
- Database reads: 0.
- Database mutations: 0.
- Operator invocations: 0.
- Compensation invocations: 0.
- Credentials requested/read/printed/copied/hashed/retained: 0.
- Authorization envelope created: no.
- Clipboard, `Configuration/Local.xcconfig`, `supabase/.temp`, and local provider configuration inspected: no.
- OSM import/download, evidence projection, GraphHopper, AI provider, deployment, billing, Auth, Storage, Edge Function, domain, or feature-enable operations: 0.

PostgreSQL/TLS/session/role/empty-database/headroom gates, migration/no-op proof, ACL/RLS/function/runtime/capacity checks, advisors, and endpoint probes are truthfully `not_run_control_plane_blocked`. Local verification completed as follows:

- Focused operator/admission/security/capacity tests: 81/81 passed, zero failures/skips.
- Complete backend suite: 1,084/1,084 passed, zero failures/skips.
- Backend build: passed.
- Offline outdoor quality evaluation: 101/101 passed, zero failures/skips.
- Authoritative disposable PostgreSQL 17/PostGIS/`supautils` and its dependent PostGIS integration matrix: not run because the required official PostgreSQL 17 `supautils` library was not available. The host has PostgreSQL 17.10 and PostGIS support, but the reviewed harness correctly refuses substitutes.
- JSON, whitespace, conflict-marker, credential-pattern, protected-path, generated/large-artifact, process, listener, and cleanup scans passed. The task-installed dependency tree was removed after open-handle verification.

Candidate binding and immutable digest checks passed. No admission or readiness claim is made from local or historical evidence.

## Safe resolution

No rename is authorized by this task. Before a fresh run, the user must choose one of these safe control-plane resolutions outside this authorization:

1. Issue a fresh authorization that names the currently observed project exactly as `TrailMind Outdoor Staging V1` and retains the unique reference/organization/region/Free-plan constraints; or
2. If the lower-cased name is intentional, rename the project in the Supabase dashboard to exactly `TrailMind outdoor staging v1`, then separately review, commit, and pin a matching operator identity before issuing a fresh admission authorization.

A future attempt must re-fetch the pinned source, repeat discovery, create a fresh short-lived single-use envelope, and rerun all preconditions. It must not reuse this blocked attempt.

Before any later live evidence import/projection, create and verify a bounded logical backup of the admitted empty foundation and prove a disposable restore. The two parallel tasks unlocked only after successful admission are:

- bounded evidence import/projection with backup and restore proof;
- disabled HTTPS backend deployment and operations validation.

No commit or push was made because the run did not pass remote admission and all verification gates. The two redacted blocked-receipt files remain untracked for review.
