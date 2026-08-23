# V4 Proof Run Identity Contract

Status: **VERSIONED FOR A FUTURE AUTHORIZED ATTEMPT; HISTORICAL RECEIPTS BYTE-EXACT**

Attempts 10–12 are historical blocked receipts in current source. Attempt 13
is not authorized and no identity or ledger namespace may be created for it.

The original V4 summary validator was also the Attempt 1 validator. It required
both summary commit fields to equal `cc4f478580ed883223e7eaa6140e686b2e5f5f6d`
and required the Attempt 1 authorization and authorization-derived manifest.
A legitimate later-run summary for baseline
`88ae392e23ec0973835bbe7aa95f9e6d27adb68a` therefore reached the first fixed
commit comparison and terminated with `invalid_v4_summary`. Deterministic tests
reproduce that rejection through the legacy path and prove that the new path
accepts the same synthetic summary only when it matches its independently
sealed run identity.

Future runs first attest the candidate with Git. The candidate must equal the
actual `HEAD`, the index and worktree (including untracked files) must be clean,
the baseline must resolve to a commit, and the baseline must be an ancestor of
the candidate. Every command runs with a fixed repository root derived from the
attestation module location, never from the caller working directory or a CLI
argument. Git or repository-resolution unavailability fails closed. Only the
bounded attestation digest is retained; no repository path or Git output enters
a public receipt.

After the proof clock and regional snapshots are captured, the runner creates
one process-sealed identity and writes its canonical durable artifact before
database planning, provider-credential admission, provider-ledger
initialization, reservation, or traffic. The identity binds:

- proof schema, contract version, and classification;
- candidate and baseline commits;
- the clean-candidate Git attestation digest;
- authorization reference, unique ledger namespace, and 15-call ceiling;
- canonical `proofAsOf`, run-context digest, and regional snapshot digest;
- the four canonical case bindings in exact order and their run-specific
  authorization-derived manifest digest;
- the complete Golden Set manifest digest and evaluation policy version;
- the Product Shaping V3 policy version and canonical policy digest; and
- the regional source-manifest digest.

The in-process identity object is deep-frozen, registered as process-created,
and hashed with deterministic canonical serialization. It is not the only
authority. Before provider work, the runner writes a schema-versioned artifact
atomically and exclusively under the authorized
`/private/tmp/TrailMindV4RunRuntime-*` scope with mode `0600`. The artifact
contains the canonical identity plus the complete bounded run-context record
and has its own digest. The ledger header, execution capture, and final summary
bind both the identity digest and artifact digest.

Restart validation requires the durable artifact bytes and externally supplied
baseline, candidate, authorization, ledger namespace, 15-call ceiling, Git
attestation digest, and artifact digest. The strict parser verifies canonical
bytes, permissions, both digests, the context clock/snapshots, and then
rehydrates new sealed validation objects. An embedded summary identity is
insufficient because it has neither the independently supplied run parameters
nor the full durable context artifact.

Future summary construction runs in a separate credential-free publication
process. It acquires the ledger/publication lock before reading the durable
identity, then validates the identity, execution capture, database diagnostic
and proof clock, ledger bytes and accounting, ordered cases, exact flag states,
disabled zero-work cleanup probe, privacy contract, and historical receipt
hashes. It also requires that the final summary path does not exist. The
publisher retains validated evidence in memory while removing the identity,
capture, and ledger, then closes/removes the lock and verifies exact absence of
all four authorized runtime artifacts. Only that process-created absence
evidence can supply cleanup claims to the summary builder. The final summary is
then validated against the retained durable run and published with an exclusive
fsync-backed write. A cleanup failure or post-cleanup write failure produces no
cleanup-success receipt. The retained final summary is explicitly not counted
as a task-owned runtime artifact. Missing, extra, forged, substituted,
reordered, or mismatched material fails closed with bounded error codes.

Attempts 1–5 remain governed by explicit historical validators plus their
byte-level Markdown and JSON hashes. Their bytes, identities, clocks, statuses,
cleanup evidence, and semantic digests are unchanged. There is no permissive
fallback from a future identity to a historical receipt.

Attempts 6–9 are unavailable as admissible evidence and were not reconstructed.
Attempts 10–12 remain governed by their committed blocked receipts and cannot
support route-quality, release, or closed-beta claims. No unused authorization
can be reused. Any future live execution must have a new explicit authorization,
fresh identity, and fresh ledger namespace; Attempt 13 is not currently such an
authorized execution.
