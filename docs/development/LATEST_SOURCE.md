# Current Wanderful development source

The `codex/latest-20261010` branch combines the recovered iOS/integration source, the latest backend corrections, and the independent QA source. It is the development starting point for local and Cloud work. Read `AGENTS.md` and `CLOUD_HANDOFF.md` first.

## Source provenance

| Source | Original local commit | Published source snapshot |
| --- | --- | --- |
| iOS and integration | `9496ce98e75b1da37f45dc8f4dfdfb4bb9f5a22b` | `codex/backup-ios-latest-20261010` |
| Backend | `b6661b0ca7b1a712f7063bc397389d9eefc4dd06` | `codex/backup-backend-latest-20261010` |
| Independent QA | `95a2cdd1cb298ef76b970cc888aabd6d76684a47` | `codex/backup-qa-latest-20261010` |

The iOS source and release checks come from the integration snapshot. Backend source comes from the backend snapshot; QA gates come from the QA snapshot. Earlier source variants remain in separate backup branches. Original private commit history and execution receipts are not imported into the public history. `SOURCE_PUBLICATION_2026-10-10.json` records the original and published file hashes, including eight operator/recovery scripts whose personal machine paths were made configurable. It does not contain credentials or actual device/session payloads.

Those operator tools remain opt-in. The credential handoff requires a human terminal and an explicitly configured `WANDERFUL_VERCEL_CLI_JS`; `WANDERFUL_NODE_BINARY` can select a Node binary. No database operation, deployment, enrollment or provider request is performed by publishing this source.

## Validation

The combined source passed a fresh iOS Simulator build and 219 focused native tests, JavaScript syntax checks for 397 files, 1,620 backend fixture tests with zero failures and one guarded skip, 48 selected independent QA tests, 10 route acceptance contracts and nine mocked human-input-flow tests. These checks validate source and synthetic fixtures. They do not establish distribution signing, physical-phone acceptance, live-provider results, production database readiness, purchases or release approval.

The selected QA tests use `QA_OWNER_CANDIDATE_ROOT` and the pinned public CA fixture. Where a historical QA helper expects a sibling `evidence/supabase-public-ca-20261005.pem`, provide an exact copy of `backend/test/fixtures/supabase-public-ca-20261005.pem` there. That certificate is public test input; private runtime receipts are not needed for these fixture checks.

Keep Node 22 for the current test-runner contract. Do not activate guarded database or live-provider suites during basic Cloud setup. Preserve complete Git history for historical provenance tests. Use appropriate Mac/Xcode tools for native work.
