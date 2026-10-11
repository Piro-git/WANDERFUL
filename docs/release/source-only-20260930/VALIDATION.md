# Source-only validation

The source-only checkout preserves application/test/configuration/verifier code exactly from `1f5d268`. New Health tests are part of that authoritative source, not a publication edit.

Fresh local checks: Node 22.22.3, locked dependencies without lifecycle scripts; backend build **381 files**, backend **1544 passed / 0 failed / 1 skipped** (1545 tests, 126 suites); **56 verifier self-test cases plus stale-report recovery**; deployment generator `--check`; Actionlint 1.7.7; whitespace and full source-equality checks. Opt-in database/performance suites are unexecuted; Node's single skipped-test summary does not count fully skipped suites. These are fixture/local checks, not provider or deployed database acceptance.

Existing integration evidence was independently reopened: **151 native tests**, **7 feature UI + 6 regression UI**, all passed with zero failures/skips. The new Health-only patch does not change native source. No unnecessary native rebuild is claimed for documentation/CI edits.

Existing unsigned Release binary hash matches its receipt: `9280e6860bb6e2ead7647d8f47d2be2ef9d3a162a4261b57043438cebf4d24d3`. Actual artifact status remains **FAILED, 41 passed / 4 failed / 45 total**: code_signature_integrity, signing_identity_contract, entitlement_contract, final_signature_recheck. A simulator build is not distribution signing.

Publication checks inspect the committed tree and new reachable objects, not only the working directory: no excluded PNG SHA; no new binary/encoded PNG; no local secret/signing/config files; no personal owner path/device/team ID introduced. Full-tree Gitleaks has nine reviewed unchanged main findings (test values/public identifiers); new-commit scan must be empty. The standalone delivery records exact tree, commit, bundle and per-file hashes.

## CI, prepared but not run on GitHub

The macOS 15 workflow uses read-only contents permission, pinned checkout/setup-node action commits, Node 22, complete history for provenance tests and no persisted credentials. It runs backend syntax/fixtures, deployment generation checks and synthetic verifier self-tests. It contains no deployment, secret, signed iOS, StoreKit or live-provider job. It is byte-identical to the previously reviewed workflow apart from the new source-review branch selector.

## External gates remain open

Backend readiness last observed **503**, routes 503; local Health behavior does not change that evidence. New backend tree `9a5147111278d13dbfb9c4b74833d8484d56c5f5` is not deployed by this task. No signature or physical iPhone acceptance. Weather **off**, pending provider/operational gates; Apple login/accounts/purchases **off**, StoreKit runtime gate unresolved. No App Store/live-route GO is inferred.
