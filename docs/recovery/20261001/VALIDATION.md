# Recovered source validation — 2026-10-01

The release branch preserves source from integrated candidate d40a206945c781619948ca2cedbc74c4543642b3, the route-quality patch through 9c88ef325f9e3a043ffddd9386350fac779b4c3f, and independent QA fixtures from c3f3dcc5733b8b717a818e155a7b271028b86624. History is reconstructed on public main; lost historical objects have not been invented or claimed restored.

## Fresh checks

- JavaScript syntax: 386 files checked successfully.
- Focused route/quality/admission contracts: 40 passed, zero failures.
- Complete backend suite: 1,565 tests; 1,560 passed, four failed, one skipped. Four failures require historical Git objects absent in the reconstructed repository: three stagingPhase1V2DiffCheckEvidence cases and one stagingReadinessV1Runner historical receipt case. This is an open provenance gate, not a green full-suite receipt.
- Gitleaks on the four new committed source revisions: zero findings.
- New publication blobs are UTF-8 text. No new screenshots, local credentials or secret configuration files are included. Original source/evidence snapshots remain preserved locally.

## Release gates

Production health was 200 and readiness 503 at the last check. No new live provider route, real database admission, signed-device acceptance or StoreKit transaction is established by these tests. Weather, account and purchase activation remain gated. Only the integration owner may integrate/build/install the iPhone release candidate.
