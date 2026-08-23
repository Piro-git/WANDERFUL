# V4 Operational Protocol

Status: **HISTORICAL/FUTURE PROTOCOL — ATTEMPTS 10-12 BLOCKED; ATTEMPT 13 NOT AUTHORIZED**

Current package source boundary:
`76f6552a1cd525a38a3840a0204cd81aede94406`. This refresh performs no V4
execution, database provisioning, provider admission, or feature enablement.

## Objective

V4 is a new bounded, non-production provider proof of the independently
reviewed routable-highlight access V2 path. It compares four canonical fixtures
with immutable V1/V2/V3 aggregate evidence. It does not mutate historical
receipts and does not grant beta approval by itself.

## Five independent decisions

| Decision | Evidence | Cannot imply |
| --- | --- | --- |
| Database preflight | Reviewed migrations, current imports/projections, isolation, index use, latency, cancellation | App Attest, provider success, route quality, beta GO |
| Physical App Attest proof | Signed-device 15-case receipt with final flags false | Database freshness, provider correctness, route quality, beta GO |
| Provider proof | Reconciled calls within a new authorization and hard ceiling | Route eligibility, highlight reach, safety, beta GO |
| Route-quality result | Strict geometry/access/quality metrics against unchanged policy | App Attest security, operational ownership, beta GO |
| Beta decision | Every mandatory checklist item verified and signed by owner | Public release, global coverage, navigation, safety guarantee |

Each decision receives a separate typed state: `not_run`, `blocked`, `failed`,
or `passed`. An aggregate may be `passed` only if all mandatory subordinate
states pass; a pass in one lane never fills another lane.

## Hard prerequisites

1. The access-point V2 implementation and migration 007 are in current source,
   but a future run still requires one clean exact candidate plus independent
   backend, database, signed-client, and product-quality acceptance. A dirty or
   concurrently changing lane is never valid proof input.
2. V1/V2/V3 markdown and JSON summaries, the official 18-case summary, and all
   release receipts are read-only inputs with recorded pre/post hashes.
3. Staging migrations apply repeatably through the latest accepted migration.
4. Current Harz and Innsbruck imports and active Evidence Graph projections
   pass provenance, freshness, coverage, isolation, and GiST gates.
5. Real-volume route-membership and access queries pass the pre-provider
   thresholds in the staging runbook.
6. The physical-iPhone App Attest protocol has its own passing receipt, or V4 is
   explicitly classified server-side-only and cannot contribute to the
   physical security gate.
7. Provider credential containment, secret owner, incident owner, cost owner,
   and a new non-secret approval reference are recorded.
8. A new explicit authorization permits exactly 15 non-production route calls
   for only the four fixtures below and expires at task completion.
9. Ordinary client flags remain false. Provider parsing enables only string
   values that normalize to `true`, `yes`, or `1`; missing, empty, unknown,
   malformed, and non-string values remain false. V4 admission is stricter:
   backend research/access/provider flags may use exact `true` only in the
   isolated V4 process/environment and must return exact `false` in terminal
   cleanup. Every insecure/local/in-memory flag remains false.
10. The proof runner enforces safe receipt schemas and rejects provider URLs,
    bodies, headers, credentials, database URLs, prompts, precise coordinates,
    geometry, App Attest material, temporary paths, or unbounded errors.

## Exact canonical mapping and order

| V4 order | Canonical case ID | Comparison purpose | Required distinction |
| ---: | --- | --- | --- |
| 1 | `case-15-partial-provider-failure-survivor` | Controlled survivor | Real provider success must occur before proof-only controlled failure injection; another independent route must remain eligible |
| 2 | `case-04-harz-brocken-must-have-landmark` | Brocken comparison | Compare access snap, original-highlight approach, target deviation, repeat/backtracking, and unchanged eligibility with V3 |
| 3 | `case-07-innsbruck-viewpoint-loop` | Innsbruck viewpoint comparison | Determine whether V2 access coordinates correct the prior provider-snap/highlight-reach failure without overstating mapped access |
| 4 | `case-08-innsbruck-easy-conservative-loop` | Innsbruck easy comparison | Obtain a real bounded result only if the circuit remains closed; verify conservative difficulty and quality constraints |

No substitute, reordered, ad hoc, or additional case may consume this
authorization. A manifest digest binds exact fixture inputs without retaining
raw prompts or coordinates in the durable summary.

## Provider scheduler contract

- Hard authorized ceiling: **15 attempted calls**.
- Maximum concurrency: **1**.
- Minimum interval between call starts: **2,000 ms**.
- Maximum proposals per case: **3** and never more calls than the remaining
  ledger budget.
- A call is reserved atomically in the ephemeral provider ledger before egress.
- `Retry-After` is honored only when it parses to a positive delay no greater
  than 15 seconds. Missing, invalid, or larger values stop the case safely; they
  do not cause an unbounded wait.
- The circuit opens after **2 consecutive immediate failures** under 1,000 ms
  with the same allowlisted typed classification. No probe is made after open.
- Timeout, cancellation, success, provider failure, and controlled post-success
  failure are mutually reconciled aggregate classes. The controlled failure is
  counted separately but does not relabel the genuine provider success.
- There are no automatic retries. Any new run requires new authorization and a
  new ledger/receipt namespace.

The ledger is task-local, permission-restricted, and contains only sequence,
case/proposal identifiers, reservation time bucket, typed outcome, duration
bucket, and controlled-injection boolean. It contains no endpoint, payload,
coordinate, geometry, header, response, credential, or token. Publication
retains its validated contents in memory, removes the ephemeral ledger and
other authorized runtime artifacts, verifies exact absence, and only then
constructs a final cleanup-success summary.

## Execution protocol

For every future attempt, first apply
`V4_PROOF_RUN_CLOCK_CONTRACT.md` and
`V4_PROOF_RUN_IDENTITY_CONTRACT.md`. Attempts 1–5 and 10–12 retain their
historical bytes, clocks/identities when created, outcomes, and cleanup states.
Attempts 6–9 are not reconstructed as admissible evidence. A future authorized
attempt may not reuse any prior timestamp, authorization reference, identity,
or ledger namespace.

### A. Admission and immutable inputs

1. Invoke the runner with explicit full baseline and candidate commit IDs. Its
   first operation attests that candidate equals actual `HEAD`, the index and
   worktree are clean, the baseline exists, and the baseline is an ancestor.
   Every Git command is bound to the repository root resolved from the V4
   attestation module; caller working directory and CLI input cannot select a
   parent, nested, or unrelated repository.
   Any Git error stops before database URL handling, identity creation,
   credential admission, ledger creation, or provider work.
2. Verify the hashes of every protected historical receipt.
3. Confirm no other proof/import/provider job or feature rollout shares the
   staging environment.
4. Validate the four-case manifest digest and authorization reference.
5. Set all ordinary/provider/insecure flags false and capture the initial state
   digest.
6. Run a zero-work disabled-endpoint probe. Any authorization, database, or
   provider count aborts V4.

### B. Database preflight with provider disabled

1. Validate ordered migration ledger and accepted migration digests.
2. Validate one current active import/projection for each region, acquisition
   checksum provenance, 14-day freshness, quarantine state, and isolation.
3. After both imports/projections complete, capture and seal one canonical
   run-scoped `proofAsOf`; bind both regional timestamp lineages to it.
4. Write the run identity artifact atomically/exclusively at an authorized
   permission-restricted `/private/tmp/TrailMindV4RunRuntime-*` path. Bind its
   identity and artifact digests into the later ledger header and capture.
5. Validate required GiST indexes as valid/ready.
6. Execute each canonical case through research and candidate generation only,
   injecting the sealed clock for every capability and planning operation.
7. Require route-membership p95 below 1,500 ms, every reviewed measurement
   below 2,000 ms, access resolution below 2,000 ms, bounded row counts, intended
   indexes, and no projection-entity sequential scan.
8. Require exactly three or the contractually valid bounded number of proposals
   for each case. Record typed limitations, not raw evidence coordinates.
9. Reconcile the database diagnostic and active snapshots to the sealed clock
   immediately before provider admission.
10. Any failure sets `databasePreflight=failed`, leaves provider calls zero, and
   jumps to cleanup.

### C. Physical App Attest checkpoint

Reference the independent physical proof receipt. Do not copy assertions,
device identifiers, or security database values into V4. If no passing receipt
exists, set `physicalAppAttest=not_run`; V4 may proceed only under an explicit
server-side diagnostic classification and can never produce beta GO.

### D. Open the bounded provider window

1. Reconfirm the 15-call approval is current and the credential is visible only
   to the backend proof process.
2. Enable exact `ROUTE_PROVIDER_ENABLED=true`, then backend research, then
   backend V2 access. Parser aliases remain forbidden by V4 operational
   admission even though the application parser recognizes reviewed ordinary
   values. Ordinary iOS flags remain false.
3. Start the empty ledger with `authorized=15`, `attempted=0`, and
   `unused=15`. Validate the circuit state is closed.

### E. Execute the four cases serially

For every proposal:

1. Revalidate remaining budget and circuit state.
2. Reserve one ledger slot atomically.
3. Start one provider request after spacing requirements.
4. Classify the result without persisting raw material.
5. Strictly decode and validate geometry, waypoint visits, access lineage, and
   response schema before quality evaluation.
6. Record only the metrics below and advance to the next proposal/case.

For case 15, the controlled failure seam is armed only after a genuine provider
success has returned strict validated geometry. The seam then converts that
proposal's downstream result to the reviewed typed failure. If the provider
does not first succeed, no controlled injection occurs and no provider failure
is mislabelled. At least one different genuine route must independently survive
all unchanged quality gates for the case to pass.

If the circuit opens, stop immediately, mark all unstarted proposals/cases
`not_run_due_to_circuit`, make no probe, and continue to cleanup.

## Required route/access metrics

For each real validated alternative retain only bounded values:

- coarse case/region/activity/route-type identifiers;
- route result/eligibility state and typed rejection/limitation codes;
- distance and duration buckets plus target-distance deviation percentage;
- ascent bucket and verified geometry boolean;
- provider snap distance to the requested trail-access coordinate;
- route closest-approach distance to the requested trail-access coordinate;
- route closest-approach bucket to the original highlight and classification
  `reached`, `passes_near`, `not_reached`, or `unverified`;
- waypoint count, verified visit count, and order/loop-closure booleans;
- repeated-segment/backtracking and overlap ratios under unchanged policy;
- bounded surface/path/road quality-state counts when verified by the current
  contract;
- proposal attempt count, provider duration bucket, and evidence freshness
  class.

The durable report must not retain the route shape, feature coordinates,
provider-snapped coordinates, names that identify a private start point, or raw
distance series. `providerVerifiedAccess` proves only provider/geometry approach
to the access coordinate; it does not prove public access, safety, or legality.

## Comparison rules

- Compare only identical canonical fixture IDs and unchanged policy thresholds.
- Read V1/V2/V3 summaries; never edit, replace, normalize, or append to them.
- Report an improvement only when the same metric is observed in both runs.
  `not_run`, provider failure, and pre-provider block are not baselines.
- Report regressions and missing evidence explicitly. Do not force a route to
  make a comparison possible.
- Brocken, viewpoint, easy, and controlled-survivor results are independent;
  one passing route cannot compensate for another case.

## Stop conditions

Stop before or during provider work on any of:

- protected receipt hash mismatch or dirty/unreviewed candidate input;
- missing/expired authorization, credential-containment failure, or provider
  ledger inconsistency;
- stale/wrong-region import, invalid projection, quarantine mismatch, missing
  index, latency/timeout gate failure, or cancellation leak;
- provider attempt 16, concurrency above 1, invalid retry delay, or open circuit;
- raw/sensitive field entering any log/receipt;
- strict V2 contract, lineage, geometry, snap, approach, or quality validation
  failure that is not already represented as a bounded typed case result;
- inability to disable flags or complete bounded cleanup.

## Reconciliation and cleanup

1. Reconcile:
   `attempted = successful + failed + timedOut + cancelled` and
   `unused = 15 - attempted`. Controlled post-success failures are at most the
   successful count and remain separately reported.
2. Disable backend access, research, evidence, route-provider, and intent-
   provider flags. Confirm every insecure/local/in-memory flag false.
3. Release leases, close product/cancellation pools, stop proof processes, and
   remove provider secret access from the proof process.
4. Re-hash V1/V2/V3/official receipts, require exact equality, and run the
   disabled zero-work probe.
5. In the credential-free publication process, acquire the ledger/publication
   lock, validate the durable identity, capture, ledger, and every non-cleanup
   summary input, and require that the final summary path does not exist.
6. Retain the verified evidence in memory; remove the authorized identity,
   capture, and ledger; close and remove the publication lock; then verify the
   exact absence of all four task-owned runtime artifacts.
7. Seal cleanup evidence only after those absence checks. Construct and
   validate the final summary from that evidence, then publish it atomically
   and exclusively. The retained final summary is explicitly excluded from
   “task-owned runtime artifacts.” A cleanup failure or a post-cleanup summary
   write failure publishes no cleanup-success receipt.

Any cleanup or reconciliation failure makes V4 failed regardless of route
results. V4 success still leaves the product NO-GO until the machine-readable
closed-beta checklist is fully verified and approved.

## Historical Attempts 10-12 and future entrypoints

The immutable receipts in `docs/release/` are authoritative for Attempts
10–12. Attempt 10 was blocked at committed runtime-database admission. Attempt
11 was blocked by storage safety before database provisioning. Attempt 12
stopped on credential-containment failure before database provisioning and
later also recorded storage below its committed threshold. They
produced no accepted database/provider/route/physical-device evidence and
cannot be resumed or reused. Attempt 13 is explicitly not authorized and must
not be started by this package refresh.

Only after a new explicit authorization may a future attempt use the following
entrypoints with a fresh identity, ledger namespace, isolated approved proof
database, and credential supplied only to the execution process.

The execution entrypoint is
`backend/scripts/run-outdoor-adventure-targeted-live-route-quality-proof-v4.js`.
It accepts, in exact order, `--baseline-commit`, `--candidate-commit`,
`--authorization-reference`, `--ledger-namespace`, `--ledger`, `--capture`, and
`--identity`. All three artifact paths must be distinct authorized runtime
paths. Successful capture output reports only bounded counts plus the Git
attestation, identity, and identity-artifact digests required by publication.

After that process exits and releases the ledger lock, start a new process with
all V4 flags exact false and no provider credential. The publication entrypoint
is
`backend/scripts/publish-outdoor-adventure-targeted-live-route-quality-proof-v4.js`.
It accepts the same external run identifiers, the reported Git attestation and
identity-artifact digests, the identity/ledger/capture paths, and a new summary
path. It will not derive expected run parameters from the capture or summary.
It first acquires the publication lock and validates every durable and
non-cleanup input. It then removes the temporary identity, capture, ledger, and
lock and verifies exact absence before it can construct a cleanup-success
summary. The summary is validated against the in-memory durable run and written
atomically/exclusively last. Any cleanup failure publishes no final summary;
the successfully published final summary is retained for review and is not a
task-owned runtime artifact.

Attempts 6–9 remain unavailable as admissible current evidence and cannot
supply identity, route-quality, release, or beta claims. No prior authorization
or ledger namespace may be reused.
