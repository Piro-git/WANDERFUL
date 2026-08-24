# Staging Runtime V1 Local Verification

Verification date: 2026-08-24. Source baseline:
`fc7ea47968aebd7c1c9be747d2abe97c707e4636`, fetched `origin/main`.
No remote service, database, registry, DNS, certificate, secret or provider was
used by these gates.

## Passed local gates

| Gate | Result |
| --- | --- |
| Focused staging/operations tests | 24/24 pass after adversarial corrections |
| Complete backend suite | 836/836 pass; 94 suites; 0 fail; 0 skipped |
| `npm run build` | pass |
| Offline outdoor quality evaluation | 101/101 pass; 0 skipped; no live provider traffic |
| Release-package validator | package structurally valid; authoritative decision remains `NO_GO` with 48 unresolved gates |
| Production dependency audit | 0 known vulnerabilities |
| Deterministic application-image context | 89 files; pass; SHA-256 `adf5e9acb57cc2c6105127dd3922566dda9e867dd7012793f3b460edc804d640` |
| JavaScript/JSON/diff checks | pass |
| Plaintext production project reference in owned runtime paths | absent |

The host verification runtime was Node `v22.22.3`; package metadata now requires
Node 22 or newer. The OCI source pins both stages to the exact official Node
`22.23.2-bookworm-slim` manifest digest. Runtime-version verification is part of
the image inspection command and cannot be claimed until an OCI engine builds
the image.

## Adversarial review disposition

The independent review tested unsafe environment shapes and found they could
initially pass. The corrected admission now rejects Node execution/TLS/debug
overrides, PostgreSQL session/service overrides, connection-query overrides,
enabled or malformed capability flags, and missing/mismatched approved project
hashes or role names. App-security sessions pin and verify
`search_path=pg_catalog,public`. Pool-error events are once per outage and pool
pressure is sampled before each readiness probe. The Docker base is no longer
build-argument overrideable, and the image inspector checks the actual Node
version, non-root identity, application write permissions, symlinks and content.

Exact staging project/role approval, inherited/excess grant denial and distinct
runtime/control credentials still require the database lane's remote receipt.

## Truthfully blocked gates

No Docker, Podman, Buildah, nerdctl, Finch or Colima executable is installed in
this workspace. Therefore these results do **not** claim:

- a completed OCI build or local deterministic container run;
- final-image ID, repository digest, runtime user/filesystem/content inspection;
- registry push or immutable deployable digest;
- HTTPS, TLS, platform health, restart, drain, outage or rollback receipts;
- remote log retention, metric dashboards or alert delivery;
- staging database admission, regional freshness or backup freshness.

Running `node scripts/staging/runtime/inspect-image.js` returned the bounded
machine result `image_inspection_unavailable`, as designed. Those gates require
the exact user-approved platform/registry and the database/proof lanes; they
must not be inferred from local source checks.
