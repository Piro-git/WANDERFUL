# Staging Runtime V1 Local Verification

Verification date: 2026-08-25. Candidate baseline and fetched `origin/main`:
`72b98e3e065ae442168ece20984d8baba26e2d11`.
No remote service, database, registry, DNS, certificate, secret or provider was
used by these gates. The correction pass used a disposable local PostgreSQL
17.10/PostGIS cluster on a private Unix socket and removed it after testing.

## Passed local gates

| Gate | Result |
| --- | --- |
| Focused Supabase V2 static/operator/capability/quarantine tests | 47/47 pass |
| Disposable PostgreSQL 17/PostGIS proof | 87/87 pass across rollback, production runner, provider-owned topology, V2 runtime/adversarial, portable V1, and App Attest suites |
| Historical blocked migration attempt (`001–008`) | **not run remotely**. The operation stopped during pre-migration PostGIS admission, compensated, and left no TrailMind schema, role, object, ledger, or PostGIS extension. This is historical evidence, not the current Supabase retry policy. |
| Current Supabase retry policy (`001–007 + 009`) | local disposable proof only; future remote execution requires a fresh authorization and explicit `supabase-postgis-isolation-v2` selection. |
| Complete backend suite | 1,014/1,014 pass; 106 suites; 0 fail; 0 skipped |
| `npm run build` | pass |
| Offline outdoor quality evaluation | 101/101 pass; 0 skipped; no live provider traffic |
| Release-package validator | not rerun in this correction pass; authoritative decision remains `NO_GO` |
| Production dependency audit | not rerun in this correction pass |
| Deterministic application-image context | 90 files; pass; SHA-256 `10b87ca2f6a62f72754c3f65f7e60ec0f0617a34aeb902ca558c5f670beeb2c6` |
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
`search_path=pg_catalog,<private_application_schema>,pg_temp`. Catalog
admission uses parameterized schema/name inputs and exact runtime/control
manifests. It rejects public shadows, role membership/unsafe attributes,
inherited/direct excess grants and grant options, ownership, writable schemas,
unexpected relations, sequences and functions. Pool-error events are once per outage and pool
pressure is sampled before each readiness probe. The Docker base is no longer
build-argument overrideable, and the image inspector checks the actual Node
version, non-root identity, application write permissions, symlinks and content.

The disposable database proves the query behavior, not the remote staging
configuration. Exact staging project/schema/role approval, RLS/DML denial and
distinct runtime/control/operator credentials still require the database lane's
remote receipt.

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
