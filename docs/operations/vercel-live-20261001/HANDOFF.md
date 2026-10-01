# Backend owner handoff — 2026-10-01

Status: **NO-GO for live acceptance**. User configuration checklist: [SETUP.md](SETUP.md). No provider requests, deployments, schema migrations, role/grant changes, or iOS modifications were made in this work session. Gemini attempts: 0; GraphHopper attempts: 0.

## Pinned source

- Independent checkout: `/private/tmp/wanderful-backend-live-20261001`, branch `codex/backend-live-20261001`.
- Recovery baseline: local commit `e96b99cbacb4c6838e25855b433e257e7565bcb2`; full tree `12f1ac6f16730809b70f895e2d9811a697fe4fc6`, backend tree `52e7a7913e2db06fc1e44e42655ce927f2ef2165`. Trees match published recovery commit `1c1e18249257b9cf70dce33012f27dd8c1af0e7e`; commit histories differ.
- Setup/CA/budget commit: `c99de15074d81ff360ae046e65f20d9cc895d1b5`.
- Route validation fix: **`0f92256f3ebd479d90a046f7c2341db8c9b8bc25`**.
- Final backend tree: **`633d0c58698c677920e8542c46ad7cf8fcaf986b`**. Subsequent documentation commits do not change it.
- These commits are local and not published/deployed. PR 1's branch was not modified. The release/integration owner must incorporate the two code commits and these documents, preserving the reviewed backend tree or revalidating any changes.

## Changes and limits

`vercelDatabaseCA.js` validates an operator-provided public CA, validity period and independently derived SHA-256 fingerprint, then atomically writes it to the exact `/tmp` path in the runtime DSN. Existing verified TLS and database admission remain required. Local fixture certificates and injected filesystem operations test the contract; they do not prove Supabase TLS or the hosted Vercel filesystem behavior.

The pilot configuration restricts two dynamic requests to seven reserved Gemini generations each, plus one intent call per prompt (16 total). Existing routing limits permit five GraphHopper attempts per request (10 total, below the authorized 32). Failures count. Actual model availability, signed App Attest identity, hosted budgets, and authenticated admission remain unverified. Weather/accounts/purchases remain disabled; the frozen six-table App Attest grant contract is unchanged.

Dynamic GraphHopper requests now ask for `way_point_max_distance: 0`; ordinary routing requests retain their existing shape. [GraphHopper's API guidance](https://discuss.graphhopper.com/t/path-simplification/9299) describes this response-simplification setting. It does not undo import simplification or prove hosted behavior in this project.

The new statistics guard only tightens complete, flat 3D paths with explicit zero ascent/descent. It compares measured horizontal geometry with provider distance and rejects conflicts beyond `max(10 metres, 1% of horizontal length)`. This is a conservative local acceptance policy, **not a provider-guaranteed error bound**. Vertex count cannot increase tolerance. The code never substitutes computed values for provider statistics. Sparse 2D and elevation-bearing paths retain the existing broader checks. A real provider receipt must still establish geometry/statistics consistency; this guard is not complete proof for every path class.

Waypoint validation now separately checks the actually requested source/entrance coordinate against the finite spherical route segments, within the same 100 m limit and monotonically increasing route progress. Two individually tolerated source-to-snap and snap-to-line gaps cannot be combined into a 178 m target miss. An entrance target is not proof that a different POI coordinate was reached. No schema or source/photo identity contract was relaxed.

## Verification

- JavaScript build: 389 files checked, zero failures.
- Targeted route tests: **44 passed, zero failed**. Includes eight independent QA probes copied byte-for-byte from QA commit `a74bd822a5c5d4873fbc4a1cf198f0da63898174` at `/private/tmp/wanderful-route-review-20261001`; copy compared with `cmp`. The QA copy is not part of this code commit. Logs: `/private/tmp/wanderful-routefix-final-targeted-20261001.log`.
- CA/admission/health/endpoint targeted tests: **29 passed, zero failed**. Log: `/private/tmp/wanderful-setup-targeted-20261001.log`.
- Final full suite: **1,577 tests; 1,572 passed, four failed, one skipped**. Log: `/private/tmp/wanderful-backend-live-tests-final-20261001.log`.
- The four failures are the same missing historical Git-object/provenance failures as the recovery baseline: three in `stagingPhase1V2DiffCheckEvidence.test.js`, one in `stagingReadinessV1Runner.test.js`. No sealed receipts or historical objects were changed or fabricated. The full suite is not green; the GitHub/recovery owner retains this gate.
- `git diff --check` passed. Dependencies use a local untracked symlink to the recovery checkout's `backend/node_modules`; package lockfiles match. No dependencies changed.

Independent QA confirmation received October 1 from QA chat `01a0f346-12bc-7092-b7e1-36fcd1d5e480`: the reviewer pinned owner commit `0f92256f3ebd479d90a046f7c2341db8c9b8bc25` in an isolated checkout, overlaid their committed QA test from `a74bd822a5c5d4873fbc4a1cf198f0da63898174`, and ran `node --test backend/quality-gates/routeReview20261001.test.js backend/quality-gates/routeAcceptance.test.js`: **18 passed, zero failed**. They reported restoring their clean QA branch afterward. This independently confirms both P2 contract fixes, including the dense flat geometry case. It does not establish live provider behavior, actual image subjects, or iPhone acceptance; those remain open gates.

## Configuration evidence and next gate

One Production environment-name inspection found `GOOGLE_API_KEY`, `GRAPHHOPPER_API_KEY`, and `APP_ATTEST_DATABASE_URL` absent. Values were not read, decrypted, printed, or copied. Existing general Supabase integration variables are not substitutes. Read-only catalog inspection confirmed `app_security_runtime_role` and `pruner_role` can log in, `migration_role` cannot, and none of these has elevated role flags or inheritance. This does not establish password access, the exact runtime admission, or TLS.

Last verified deployment remains source `016ef5b47fd2308e77afe3be577f7d0203c2079a`, backend `b1b0b37d8b4fc1939cbc16d7a75deed3c304365b`, deployment `dpl_DDMiqxN5eCHMdcV6QZi46FR359ds`, public origin `https://backend-zeta-amber-69.vercel.app`. September 30: health 200, readiness/API 503. No unchanged endpoint probes were repeated October 1.

After the user confirms Production configuration, verify configuration/admission without exporting secrets, integrate the reviewed source and deploy only the existing project. Obtain readiness 200 and real device authentication before two bounded acceptance prompts (Harz plus outside Germany or at least outside Harz). Record every provider attempt and validate ordered geodesic approaches, closure, provider statistics, sources, and photo identities. Stop on unchanged failures. Do not claim success from syntax, mocks, missing-key errors, or local tests alone.
