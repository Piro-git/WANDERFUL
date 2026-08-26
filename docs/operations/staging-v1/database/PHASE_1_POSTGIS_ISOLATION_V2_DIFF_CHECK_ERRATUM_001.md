# Phase 1 PostGIS Isolation V2 Diff-Check Erratum 001

Date: 2026-08-26

Severity: **release-evidence integrity; no runtime or security behavior impact**

This append-only erratum corrects the final-seal statement that implied the
entire original baseline-to-checkpoint range passed `git diff --check`. A
clean working-tree invocation after commit did not validate that committed
range.

The correction receipt is
`PHASE_1_POSTGIS_ISOLATION_V2_DIFF_CHECK_ERRATUM_001.json`, SHA-256
`d711eae43531c78c40ef2a6260419b9eb99b60734726fe84a42b5be6521643b1`.

## Exact original-range result

Command:

```text
git diff --check 72b98e3e065ae442168ece20984d8baba26e2d11..360360714c5d467552fc1f9fdc00b255081ea422
```

Result: exit 2, exactly five findings, and no other findings.

| path | lines | classification | checkpoint Git blob SHA-1 | checkpoint file SHA-256 |
| --- | --- | --- | --- | --- |
| `docs/operations/staging-v1/database/PHASE_1_POSTGIS_ISOLATION_V2_LOCAL_PROOF.md` | 5–8 | four intentional CommonMark hard breaks (`20 20 0a`) | `bfa4c3b67c1dac146c186e5aa20018a7450de9e2` | `3d20be8107a89b811921571586f8443eccac1c4b08aece0c7d355cc473d35be7` |
| `docs/operations/staging-v1/database/PHASE_1_POST_MIGRATION.sql` | 345 | one harmless extra blank line at EOF (`0a 0a`) | `446a66362f9254f2e6e8d8bb05fa618ba3a024e6` | `f67a92fc1d003b10601555973f263d2d5a50c53d0f95e67269e6901976611485` |

The Markdown whitespace is intentional rendering syntax. The SQL EOF
formatting does not change execution, but its SHA-256 is explicitly protected
by the local and review-correction receipts. Both checkpoint blobs therefore
remain byte-identical. This erratum corrects the claim without silently
rewriting historical evidence.

## Regression contract

`backend/test/stagingPhase1V2DiffCheckEvidence.test.js` executes the exact
baseline-to-checkpoint command, requires exit 2 and the exact five-finding
output, requires every committed correction after that checkpoint to be
diff-check clean, and validates both checkpoint blobs and this correction's
evidence-map bindings. A clean working-tree-only invocation can no longer
stand in for an explicit committed-range check.

The corrective commit itself must pass:

```text
git diff --check 360360714c5d467552fc1f9fdc00b255081ea422..HEAD
```

with exit 0 and no output. This does not retroactively relabel the original
range as clean.

The migration policies remain mutually exclusive and unchanged: historical
portable V1 is `001–008`; isolated Supabase V2 is `001–007 + 009`. Managed
Supabase execution remains not run and unproven.
