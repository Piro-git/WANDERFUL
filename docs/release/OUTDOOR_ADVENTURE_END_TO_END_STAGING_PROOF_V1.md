# Outdoor Adventure End-to-End Staging Proof V1

Evidence window: 2026-07-29 to 2026-07-31
Overall outcome: **PARTIALLY PROVED - LIVE BLOCKED**
Closed-beta eligibility: **NO**

This evidence window proved the disposable PostgreSQL/PostGIS data path twice:
first with an older bounded snapshot, and again on 2026-07-30 with current
`260729` Geofabrik data inside the strict 24-hour source contract. The current
refresh covered acquisition checksums, bounded derivation, import, projection,
spatial isolation, production containment predicates, GiST query plans, and
database-backed integration behavior. It did not prove the complete
physical-iPhone to backend to GraphHopper route-planning chain.

All 18 mandatory cases remain explicitly `not_run`. None is a pass, skip,
or silent omission. The redacted companion summary is:

- `docs/release/OUTDOOR_ADVENTURE_END_TO_END_STAGING_PROOF_V1.summary.json`

The summary JSON is maintained separately. This report does not replace or
self-assert its machine-verifiable receipts.

## Release decision

TrailMind is not eligible for the requested closed beta from this sprint.

The live proof remains blocked by:

- no asserted bounded GraphHopper live-traffic authorization and no provider
  credential exported to the proof process;
- no active disposable PostgreSQL/PostGIS cluster or current Harz/Innsbruck
  import available to the runner;
- no approved HTTPS physical-iOS host, App Attest/iOS receipt verifier, or
  fully provisioned causal live driver;
- no connected physical iOS device or usable Apple Development signing
  identity. XcodeBuildMCP is callable for Simulator work, but that capability
  does not provide the signed physical-device lane required here.

The current-data database and PBFs were deliberately disposable and were
removed after the aggregate receipt was captured. They therefore must be
recreated from a still-current source before a future live run. The current
source timestamp expires from the strict 24-hour window at
`2026-07-30T20:20:57Z`.

The mandatory manifest deliberately has two proof lanes. Cases 1 through 15
and 17 through 18 require the physical-device/live lane. Case 16 alone requires
the controlled Simulator lane and a synthetic malformed response. The
controlled lane does not substitute for the other 17 cases, and a standalone
case-16 diagnostic does not count as execution of the official 18-case run.
Every other Simulator receipt is explicitly non-proof.

## Tested revision and database environment

| Item | Verified value |
| --- | --- |
| Tested commit | `b880093119a3b216f74d0ba75a2aa0f107d7295d` |
| Evidence dates | 2026-07-29 to 2026-07-31 |
| PostgreSQL | 17.10 |
| PostGIS | 3.6.4 |
| GEOS | 3.14.1 |
| PROJ | 9.8.1 |

Migrations `001` through `005` were applied by the task-owned runner. A repeat
application was a no-op, proving the checked sequence was idempotent in the
disposable environment.

## Bounded source and projection evidence

Only rounded public coverage bounds and aggregate counts are retained here.
No exact feature coordinate, internal entity identifier, source URL,
credential, provider payload, or raw user prompt is included.

| Metric | Harz | Innsbruck |
| --- | ---: | ---: |
| Rounded coverage | `10.300/51.450 - 11.350/51.980` | `10.950/47.000 - 11.650/47.450` |
| Raw POIs | 2,949 | 1,622 |
| Raw trails | 140,565 | 74,624 |
| Raw relations | 886 | 498 |
| Raw relation members | 29,514 | 7,727 |
| Projected entities | 144,400 | 76,744 |
| Projected assertions | 167,285 | 91,339 |
| Projected relationships | 29,298 | 7,709 |
| Quarantined rows | 0 | 0 |
| Dry-run projection duration | 163,898 ms | 146,131 ms |
| Final projection duration | 174,340 ms | 131,193 ms |
| Source age at currentness check | 17.5 hours | 17.5 hours |

Derivative source receipts:

- Harz bounded derivative SHA-256:
  `a551deef5377903934bab15e95e05c5f14b20c1220a0fec747bf93b78dc75822`
- Innsbruck bounded derivative SHA-256:
  `6a54884212d0199aceaac04e404c31966654a6a683ba31a86b648e1c3fbe393a`

Immutable upstream publisher receipts:

| Extract | Publisher MD5 |
| --- | --- |
| `niedersachsen-260729.osm.pbf` | `cab3a28241df17bb2b42215759122b51` |
| `sachsen-anhalt-260729.osm.pbf` | `ada77626e35d0b8b8c46028310b98d08` |
| `thueringen-260729.osm.pbf` | `1fc94d1ede5e463587d95a559bfda78d` |
| `austria-260729.osm.pbf` | `fd2cf0d4e2bc712636663db1ebb62852` |

Every publisher MD5 was verified before deriving the bounded local artifacts.
All four PBF headers reported `2026-07-29T20:20:57Z`. The bounded derivatives
were imported as `operator_supplied_local`, with their own SHA-256 values, so
publisher provenance and derivative provenance remain separate receipts.

Mapped highlight aggregates:

| Category | Harz | Innsbruck |
| --- | ---: | ---: |
| Viewpoint | 923 | 305 |
| Peak | 1,878 | 957 |
| Lake | 92 | 70 |
| Waterfall | 54 | 176 |
| Alpine hut | 0 | 99 |
| Wilderness hut | 2 | 15 |

## Projection behavior and performance

Three earlier-window projection attempts ended with the explicit
`projection_timed_out` result. The first current-refresh Harz promotion also
failed closed with `projection_timed_out`; the server log identified frequent
WAL checkpoints during the projection-entity insert. These are failed setup
attempts, not successful, skipped, or mandatory-case runs.

The eligible-identity join was then changed to materialize the unchanged
category, version, time, and spatial-validity predicates before joining.
The optimized materialized/hash-join diagnostic completed in 102.541 ms.
For the current refresh, only the disposable database was tuned: `max_wal_size`
was raised to 2 GiB, `checkpoint_timeout` to 30 minutes, and projection
sessions received 64 MiB `work_mem`. No application timeout, validation rule,
case requirement, or production setting was loosened. The successful current
dry-run and promoted durations are reported in the aggregate table above.

Real `EXPLAIN ANALYZE` evidence confirmed the
`outdoor_evidence_trail_segments_geom_metric_gist_idx` and
`outdoor_research_projection_entities_geometry_gist_idx` indexes. The
representative bounded trail and highlight queries completed in 7.736 ms and
238.390 ms respectively. Aggregate validation also confirmed:

- no cross-region leakage between Harz and Innsbruck;
- exactly one unique current named Brocken peak;
- zero quarantined projected rows;
- policy `osm-foundational-mapped-v1` produced 21 assertion scopes and one
  relationship policy;
- every row returned through the production containment predicate was covered
  by its operational region.

Some source ways and boundary-straddling lake polygons intersect an import
polygon without being fully covered by it. They remain mapped audit rows, but
the production repository's `ST_CoveredBy` predicate excluded every such row
from a `known` claim. No geometry from one operational region intersected the
other region.

## Currentness result

The refresh contract requires source evidence no older than 24 hours. The
earlier snapshot correctly failed closed at 36.5 to 38.7 hours old.

The `260729` refresh then passed the same strict gate. At the final aggregate
check, both active imports and projections were 17.5 hours from their
`2026-07-29T20:20:57Z` source timestamp. Currentness was proved for the
captured database state; it does not survive past the 24-hour boundary and
does not substitute for a fresh check at a later live run.

### Current refresh execution

Safe cleanup restored approximately 6.36 GiB from ignored dependency/build
artifacts in seven idle Codex Planua worktrees. The Planua source, Git history,
branches, active worktrees, main dependencies, and uncommitted changes were
untouched. Free disk rose to approximately 13 GiB, above the task's 9 GiB
start gate.

The four immutable PBFs totalled 1,638,432,732 bytes. Osmium 1.19.1 clipped
each source with `complete_ways`, merged the three Harz state extracts, and
reported zero missing way-node references in both bounded derivatives. A
task-owned PostgreSQL 17.10 cluster on loopback applied migrations `001`
through `005`; the second real runner pass applied nothing. Imports used
osm2pgsql 2.3.1, and the database exposed PostGIS 3.6.4, GEOS 3.14.1, and
PROJ 9.8.1.

## Explicit live-request preflight

The proof command was rerun with `--execute-live` but without any live-traffic,
credential-containment, or disposable-database acknowledgements. By design,
that topology cannot read provider/database credentials or execute a case. It
regenerated the machine summary as `not_run`, with 18 configured, zero
executed, and these precise readiness blockers:

- `app_attest_receipt_integration_missing`
- `bounded_live_graphhopper_not_authorized`
- `causal_pipeline_capture_missing`
- `credential_containment_not_confirmed`
- `database_configuration_missing`
- `disposable_database_not_confirmed`
- `graphhopper_configuration_missing`
- `ios_runtime_receipt_integration_missing`
- `operational_case_driver_missing`

A disposable database existed for the data proof, but it was deliberately not
presented to the live runner because the runner reads credentials only when
all four live acknowledgements are supplied together. Those acknowledgements
were not supplied. Therefore the companion summary truthfully retains
`database_configuration_missing` and `disposable_database_not_confirmed` for
the live topology.

A separate presence-only audit confirmed that `GRAPHHOPPER_API_KEY` is absent
from the proof process. An ignored backend environment file contains a key
declaration, but its value was not read, validated, exported, or authorized
for traffic. Key declaration would not itself be authorization.

### Continuation proof-harness hardening

The credential-bearing `--driver-module` seam now accepts only the exact
canonical, regular, non-symlink built-in operational-driver path and matching
realpath. Foreign, lookalike, nonexistent, and symlinked modules remain
`operational_case_driver_missing` and are never imported. A sentinel test
proved that rejected modules cannot execute import-time code.

The iOS receipt extractor now binds a receipt to the exact preselected device,
expected physical-iOS or Simulator platform, exact XCTest identifier, and
exactly one passed test. It rejects failed, skipped, expected-failure, unknown,
repeated, extra, ambiguous, and failure-associated results or attachments.
When Xcode supplies identifier URLs, the attachment and test-report values
must also match. A fresh disposable Xcode 26 result confirmed that the
`-only-testing` selector and `.xcresult` identifier have distinct exact forms;
the runner now models both rather than accepting a broadened match.

The Swift proof test adds its retained JSON receipt only after all receipt
assertions finish without increasing the XCTest failure count. The backend
still independently validates the final XCTest status. Case 14 was also
tightened: an in-flight provider abort is insufficient by itself. The same
captured production execution must contain a failed routed-alternative attempt
with `route_timed_out` before the GraphHopper-timeout semantic or limitation
can be emitted.

The runner now dispatches case 16 only to the controlled evaluator and every
other mandatory case to the live evaluator. An approved descriptor must
provide distinct live and controlled runners plus bounded cleanup; the pinned
public driver factory still fails closed with
`approved_https_ios_receipt_verifier_missing`.

The canonical result is now withheld in memory until every driver and database
cleanup completes within its deadline. Before atomic publication, its bytes
must exactly equal the deterministic serialization of the same in-memory
summary, and any `passed` summary must satisfy the harness's full coherence
check. Every terminal status must also satisfy the canonical schema, ordered
case inventory, and recalculated metrics. Cleanup failure, cleanup timeout,
forged status, mismatched bytes, or publication failure invalidates the
canonical output and emits no passing stdout. A timed-out cleanup also forces
only the proof-runner process to terminate, so a stalled database socket cannot
hold a false-incomplete run open indefinitely.

### Deterministic case-13 cancellation gate

Case 13 no longer relies on a fixed delay to guess when PostGIS work is active.
Its proof-only gate uses a separate one-connection control pool to hold an
`ACCESS EXCLUSIVE` lock while leaving both production-pool connections
available for the real research query and cancellation. It accepts readiness
only after `pg_stat_activity` exposes exactly one production backend executing
the expected parameterized snapshot-query prefix and actively waiting on the
held relation lock. The two one-use phases are bound to the exact mandatory
case and runner nonce. The iOS proof client also requires the exact final
endpoint URL, a successful JSON response, an exact two-field response shape,
and a one-KiB body ceiling, so a response ending at a different URL cannot
satisfy the gate.

After the physical iOS flow cancels, settlement is accepted only when the
existing repository lifecycle reports, in order, that the transaction began,
the in-flight query was cancelled after abort, and rollback completed after
that cancellation. The control transaction is then rolled back and released.
Missing, ambiguous, malformed, reused, or out-of-order observations and lock or
cleanup failures all fail closed without exposing a database process ID.
Control connections and queries are time-bounded, phase acknowledgements
recheck cancellation after awaited work, and duplicate lifecycle events after
settlement invalidate the gate. The iOS proof flow captures its exact planning
task before cancellation and awaits that task before it inspects or publishes
post-cancel state, preventing a late coordinator result from escaping the
receipt's quiescence boundary.

This is local deterministic coordination code, not case-13 execution. The
current controlled server is a loopback HTTP harness reserved for case 16.
There is still no approved live HTTP/HTTPS host integration that can expose the
case-13 gate handshake to a signed physical-device flow while preserving App
Attest/session authorization. The public live-driver factory therefore remains
non-operational, and case 13 remains `not_run`.

The current external-state audit found no connected physical iOS device and no
valid code-signing identity. XcodeBuildMCP is available, but its present
workflow is Simulator-oriented. PostgreSQL/PostGIS and OSM import binaries are
installed locally, while no PostgreSQL process, disposable cluster marker, or
PBF artifact remains in the repository or task temporary area. The data/import
environment must be rebuilt before any live case can run.

## Database-backed integration result

The real PostgreSQL/PostGIS integration suite passed 38 of 38 tests. It covered
the task-owned database path, including database-backed App Attest/session
behavior.

This result must not be read as a physical-device App Attest proof. No signed
iPhone assertion and no independent App Attest verifier receipt were produced
in this evidence window.

## Final verification gates

| Gate | Result |
| --- | --- |
| Complete backend suite | last complete run: 549 passed, 0 failed; 9 subsequently added focused proof tests are separately green |
| Backend build and syntax check | passed |
| Offline outdoor-adventure evaluation | 101 passed, 0 failed |
| Real database integration | 38 passed, 0 failed |
| Current sandbox-safe backend proof components | 47 passed, 0 failed: harness 27, receipt 7, cancellation gate 13 |
| Operational capture suite | last unrestricted run: 20 passed, 0 failed; latest restricted rerun: 17 passed and 3 loopback `EPERM` environment blocks |
| Focused iOS proof support plus cancellation quiescence | 13 passed, 0 failed, 0 skipped |
| Complete iOS unit target | 592 passed, 0 failed; 2 opt-in live-only tests skipped; 594 total |
| Critical-path iOS UI suite | 14 passed, 0 failed |
| Continuation disposable focused iOS UI test | 1 passed, 0 failed; not an official mandatory-case execution |
| Debug mirror Simulator build | passed; both research/evidence flags `false` |
| Release mirror Simulator build | passed; both research/evidence flags `false` |
| Raw proof-only scheme invocation | 18 stopped at the missing runner-nonce precondition; 0 mandatory-case executions |

The 101-case evaluation is offline evidence and is not a live provider proof.
The database integration result likewise does not replace a signed
physical-device App Attest receipt.

## Mandatory-case result

| Metric | Result |
| --- | ---: |
| Configured mandatory cases | 18 |
| Executed | 0 |
| Passed | 0 |
| Failed during mandatory-case execution | 0 |
| Skipped | 0 |
| Explicitly `not_run` | 18 |
| Real GraphHopper cases | 0 |
| Physical-device App Attest cases | 0 |
| Closed-beta qualifying cases | 0 |

The three earlier-window projection timeouts and the first current-refresh
Harz promotion timeout are reported separately as failed setup attempts. They
are not counted as mandatory-case executions.

The 18 mandatory cases remain `not_run` because all required proof
preconditions were not simultaneously true:

1. no safe GraphHopper staging credential was exported to the proof process
   and no bounded live-traffic authorization was asserted;
2. no fully provisioned approved causal live-driver topology or HTTPS receipt
   verifier was available for this run;
3. no physical device or signing identity was available;
4. the disposable current-data environment was removed after evidence capture,
   as required, rather than retained as an unapproved staging service.

## iOS and Simulator status

The ordinary Debug app launched in 74.407 seconds and presented the normal,
polished Home/Plan runtime. An earlier Release Simulator build completed in
72.514 seconds.

A later rebuild on the same booted iPhone 17 Pro Simulator stalled in Xcode
project resolution before compilation output. Bounded process inspection
isolated the wait to iCloud File Provider coordination rather than a compiler
or source failure. The one tracked dataless test fixture was restored
byte-for-byte from its existing Git blob and verified against the blob hash,
but the File Provider coordinator remained wedged.

Current compile and test evidence was therefore collected from a disposable
source mirror under `/private/tmp`, with `.git` and
`Configuration/Local.xcconfig` explicitly excluded. The optional local
configuration include was not needed for the disabled ordinary build. Using a
separate disposable DerivedData directory, both Debug and Release generic
Simulator builds passed.

On the booted Simulator, the iOS unit suite passed 592 tests with zero failures
and two skips, and the critical-path UI suite passed 14 of 14 tests. Both unit
skips are opt-in live-only evaluations. They are not provider proof and are
not counted as mandatory-case results.

The first attempted full unit rerun disabled signing and used parallel test
clones. It was non-authoritative because the test host lacked its expected
Keychain entitlement and a parallel clone failed to launch. An isolated rerun
then passed 1 of 1 tests. The authoritative clean rerun restored normal
Simulator signing, disabled parallel testing, and completed the full unit
target with 592 passes, two declared opt-in live-only skips, and zero failures.
The focused proof-support rerun passed all 12
`StagingProofLaunchSupportTests` plus the exact planning-task cancellation
quiescence test, for 13 of 13 with no skip or failure.

On 2026-07-31, a fresh disposable source mirror also compiled the hardened
proof UI test and passed one focused critical-path UI test. A second
disposable probe retained a harmless JSON attachment solely to confirm the
exact Xcode 26 attachment-manifest and test-report identifier shapes. Neither
invocation ran an official mandatory case or produced a physical-device
receipt.

Two first-pass critical-path UI failures were traced to nested accessibility
elements rather than absent product content. The research fit, highlight, and
limitation cards now preserve their child accessibility elements; a focused
rerun passed both affected tests before the full 14-test critical-path suite
passed.

Compiled ordinary Debug and Release values were verified as:

| Setting | Debug | Release |
| --- | --- | --- |
| `RESEARCH_GUIDED_PLANNING_ENABLED` | `false` | `false` |
| `OUTDOOR_EVIDENCE_ENABLED` | `false` | `false` |

Receipt discovery includes the production Xcode 26 attachment-suffix
compatibility correction required for generated `.xcresult` attachment names,
plus exact binding to the preselected device, platform, test identifier, and
Passed status. The extractor requires one selected proof attachment and one
test case, rejects extra or repeated tests and all non-passing statuses, and
cross-binds the identifier URL when present. Swift retains the proof receipt
only after its assertions remain failure-free.

The raw scheme also discovered the 18 proof-only UI methods. Because it was
not launched by the official proof runner, no pre-bound runner nonce digest
was supplied. All 18 methods refused execution at that guard and the raw
scheme exited nonzero. This is expected fail-closed behavior, not a live case
failure, pass, or skip. No GraphHopper request, physical-device assertion, or
mandatory-case execution occurred, so all 18 mandatory cases remain
`not_run`.

A separate controlled Simulator negative diagnostic shaped like case 16
passed outside the official mandatory-case run. This is the manifest's only
controlled lane; cases 1 through 15 and 17 through 18 remain physical/live:

| Diagnostic field | Observed value |
| --- | --- |
| Terminal state | `rejected` |
| Authorization | `none` |
| Evidence source | `none` |
| Routing source | `none` |
| Provider traffic | `none` |
| Response state | `malformed` |
| Route quality | `not_evaluated` |
| Legacy fallback count | 0 |
| Errors | `none` |
| `response_conversion` | `under_100ms` |
| `end_to_end` | `500ms_to_999ms` |

This diagnostic proves strict iOS rejection of the controlled malformed
response. It does not prove PostGIS, GraphHopper, physical App Attest, or any
positive route flow, and it is not counted as one of the 18 official
mandatory-run executions. Mandatory case 16 remains `not_run` with
the other 17 cases. All other Simulator receipts remain explicitly non-proof.
A development session is never counted as an App Attest production proof.

## Data retention and privacy

After the aggregate receipt was captured:

- the four raw regional PBF artifacts and publisher receipt files were deleted;
- the bounded PBF artifacts were deleted;
- the disposable proof and integration-test databases, PostgreSQL files,
  socket, and server log were deleted after a clean server stop;
- no raw import or provider logs were retained;
- only redacted aggregate counts, timings, public rounded bounds, and source
  checksums remain in this report.

No credential, private endpoint, provider response, exact feature coordinate,
raw prompt, or internal entity identifier is retained here.

## Required continuation

The safest continuation is:

1. confirm at least 9 GiB of safe working space, then reacquire and verify
   immutable bounded source artifacts that are still inside the 24-hour
   contract;
2. recreate the disposable database and reapply migrations `001` through
   `005`;
3. rerun import, dry-run projection, promotion, and aggregate isolation checks;
4. explicitly authorize the bounded GraphHopper calls and export an approved
   staging credential to the proof process without logging either;
5. connect a physical iOS device and configure the intended signing team and
   identity; use XcodeBuildMCP for supported Simulator work without treating it
   as the physical-device/App Attest lane;
6. provide an approved HTTPS proof host/physical-device runner in the
   evaluator's causal instrumentation boundary, or an equivalent pinned,
   server-signed causal receipt contract;
7. execute all 18 mandatory cases and accept the result only if every case
   passes with causal backend and iOS receipts.

Any newly stale source, missing receipt, skipped case, Simulator-only positive
claim, provider overrun, or incomplete summary must continue to fail closed.

## Repository and release hygiene

- Nothing was staged.
- Nothing was committed.
- Nothing was pushed.
- Nothing was deployed.
- No release feature was enabled.
- No closed-beta release was created.
- The companion summary JSON was regenerated only by the fail-closed
  live-request preflight. The later raw-scheme XCTest precondition failures did
  not mutate it. The July 31 harness, receipt, timeout-causality, and focused
  disposable UI checks also did not mutate it; its 18 cases remain `not_run`.

The database layer is partially proved. The complete live product chain is
still blocked, so the release decision remains **NO**.
