# Vercel database admission integration — 2026-09-30

## Source

Starting candidate: `d3fc6b0222450bc1cc43b9e289712c77e443f2d0`.
Owner patch: `5e2985a94a01d7401821ed1c5647f28cde6fccdf`, from `/private/tmp/wanderful-release-verification-20260926`, branch `codex/production-readiness-20260930`.
Integrated code commit: `be02b215d23ae7668eba141b2ac6b6a59f9bc0c8`.
Backend tree: `b1b0b37d8b4fc1939cbc16d7a75deed3c304365b`, identical to the owner's tested tree.

This supplements HANDOFF.md, whose photo/native results and prior deployment boundary refer to the earlier candidate. The next documentation-only commit records this backend-only integration; no iOS source or project settings changed.

## Review and behavior

The earlier Vercel adapter checked configuration syntax without executing the standalone service's actual runtime database admission. The new adapter reuses its bounded pool factory and exact admission query, supplies the same app-security pool to the application, and checks admission before readiness or protected requests. Liveness remains independent and recognizes query-bearing exact health paths.

Concurrent requests share an active probe and initialization. Later requests probe again instead of trusting a cached success. Failures, malformed admission results and bounded timeouts return generic unavailable responses; failed initialization closes owned pools and can retry. The app-security database URL requires verified TLS with an absolute CA path and rejects extra URL parameters that could replace startup options. The SQL privilege manifest and roles are unchanged. Optional research/evidence pool construction remains the existing lifecycle implementation; this patch is not a new admission or TLS audit of those disabled lanes.

Reviewed files:

- `backend/api/index.js`
- `backend/src/operations/serviceLifecycle.js` (exports the existing pool factory)
- `backend/test/vercelDatabaseAdmission.test.js`

## Independent candidate verification

Node `v22.22.3`.

- Targeted `node --test backend/test/vercelDatabaseAdmission.test.js backend/test/vercelHealthPaths.test.js`: **9 passed, 0 failed, 0 skipped**.
- Full `npm test`: **1557 passed, 0 failed, 1 skipped**, 1558 tests / 126 suites, 11.4 seconds. Executed with local loopback permission because this harness starts local HTTP fixture servers. No test changes or bypasses were needed.
- `npm run build`: **385 files checked, no failures**.
- `git diff --check`: passed.
- Native/UI tests were not repeated because the patch changes only backend files; the prior iOS evidence remains in HANDOFF.md.

Full local logs: `/private/tmp/wanderful-integrated-vercel-admission-tests-20260930.log` and `/private/tmp/wanderful-integrated-vercel-admission-build-20260930.log`. Compact results are in `evidence/vercel-admission-tests.txt` and `evidence/vercel-admission-build.txt`.

## Deployment and live gates

The backend owner reports that the preceding candidate `d3fc6b0`, backend tree `115b2950a5ea2f6809cead8306f2bd0c6e55dfa2`, was deployed separately, with health 200 and readiness 503. This is owner-reported evidence, not a new live probe by this integration task. Their deployment/operator evidence is at `/private/tmp/wanderful-release-verification-20260926/docs/operations/production-readiness-20260930/OPERATOR-HANDOFF.md`.

The admission patch has not been deployed by the integrator. The tested source/tree must be agreed with the backend owner before any subsequent deployment. A fake-pool unit test cannot establish CA packaging, a real verified TLS connection, authenticated runtime-login admission, production readiness, or provider acceptance. Those remain required gates.

No environment values, credentials, feature flags, schema, grants or deployed artifact were changed by this integration. No provider call, database migration, physical-device install or remote push occurred. Weather and unfinished features remain disabled. The weather migration remains blocked even while disabled because its extra table grants violate the frozen six-table privilege manifest. Do not loosen that manifest as part of rollout.
