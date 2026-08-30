# Production Observer V2 adversarial reconciliation

Date: 2026-08-30

This record reconciles the 32 failures in the original 29/61 adversarial run
against `b59f432a1947154345f1629ecba50d14fcb1e7c8`. The correction commit improved
that result to 35/61. After rebasing the suite onto the corrected V2 module
boundaries, the result is 61/61 with no skips. A green external-limitation test
means the observer returned the required typed block; it never means the
missing evidence was proved.

Each former failure has exactly one primary classification from the required
taxonomy.

| ID | Formerly failing adversarial case | Classification | V2 resolution |
|---|---|---|---|
| A01 | ERROR Advisor lint did not reliably block | verified implementation defect | Exact known-severity policy blocks `ERROR`. |
| A02 | WARN Advisor lint did not reliably block | verified implementation defect | Exact known-severity policy blocks `WARN`. |
| A03 | INFO Advisor lint was not preserved as notice-only | verified implementation defect | `INFO` is returned only as a notice. |
| A04 | Duplicate Advisor lint identity was accepted | verified implementation defect | Duplicate identity returns bounded `advisor_duplicate_lint_identity`. |
| A05 | Billing endpoint/permission absent from exact manifest | verified implementation defect | Exact add-ons path and `infra_add_ons_read` are pinned. |
| A06 | Candidate hard-coded zero billing fields | verified implementation defect | Synthesized cost fields were removed; only restricted observations are accepted. |
| A07 | Complete billing corpus targeted the pre-correction seam | obsolete/test-contract drift | Rebased to `validateStagingPhase1V2RestrictedBillingObservation`. |
| A08 | Exact invoice/usage corpus expected a provider proof that is unavailable | external platform limitation | Staging records it unavailable; production returns typed `billing_evidence_unproved`. |
| A09 | Advisor freshness corpus expected local fetch time to prove causality | external platform limitation | Both levels record causal freshness unproved; production blocks. |
| A10 | Exact least-privilege auditor positive fixture targeted the old shape | obsolete/test-contract drift | Fixture uses the corrected distinct-role/effective-ACL contract. |
| A11 | `postgres`/mutator auditor rejection expected old error plumbing | obsolete/test-contract drift | Rebased to the public auditor validator and stable typed rejection. |
| A12 | Fixed application name could be exposed as admission evidence | verified implementation defect | Application identity is derived from the run binding. |
| A13 | Exact application-identity test expected the old private seam | obsolete/test-contract drift | Rebased to `deriveStagingPhase1V2DatabaseRunBinding`. |
| A14 | Cross-run/attempt identity test used stale candidate inputs | obsolete/test-contract drift | Current run binding proves distinct identities. |
| A15 | One cleanup observation could appear sufficient | verified implementation defect | Exactly two samples are mandatory. |
| A16 | Cleanup corpus used one session and old count-only fields | obsolete/test-contract drift | It now requires two distinct auditor PID/application/start identities. |
| A17 | Signed artifact positive corpus expected V1 phase/domain values | obsolete/test-contract drift | Rebased to the V2 four-file names, domain, chain, and verifier seam. |
| A18 | Ed25519 source-region assertion targeted the old implementation | obsolete/test-contract drift | Uses exported V2 signature verification behavior. |
| A19 | Durable four-artifact ordering assertion targeted the old launcher | obsolete/test-contract drift | Uses the V2 artifact contract and durable-write primitive. |
| A20 | Refresh-token credential rejection lacked a current descriptor fixture | obsolete/test-contract drift | Exact descriptor validator rejects refresh tokens. |
| A21 | Client-secret credential rejection lacked a current descriptor fixture | obsolete/test-contract drift | Exact descriptor validator rejects client secrets. |
| A22 | Browser-cookie credential rejection lacked a current descriptor fixture | obsolete/test-contract drift | Exact descriptor validator rejects browser credentials. |
| A23 | MCP credential rejection lacked a current descriptor fixture | obsolete/test-contract drift | Exact descriptor validator rejects MCP credentials. |
| A24 | Opaque credential rejection lacked a current descriptor fixture | obsolete/test-contract drift | Opaque/unprovable credential types block. |
| A25 | Missing-scope credential rejection lacked a current descriptor fixture | obsolete/test-contract drift | Exact OAuth scopes or exact FGA permissions are mandatory. |
| A26 | Nonzero descriptor-offset test invoked a removed candidate factory | obsolete/test-contract drift | Rebased to the single-read descriptor lifecycle validator. |
| A27 | Descriptor reuse test invoked a removed candidate factory | obsolete/test-contract drift | `readCount`, `copyCount`, unlink, close, and offset are exact. |
| A28 | Failure-close test invoked a removed candidate factory | obsolete/test-contract drift | Lifecycle must report the descriptor closed on failure. |
| A29 | Single-read assertion scanned stale source markers | obsolete/test-contract drift | Tests the exact lifecycle contract, not formatting. |
| A30 | Management transport corpus used stale request paths and call count | obsolete/test-contract drift | Rebased to the exact 14-call bounded manifest and strict response parser. |
| A31 | Package identity/source manifest was runtime-derived or absent | verified implementation defect | Reviewed literal per-file, source, package, and acceptance digests are exported. |
| A32 | No-runtime-self-hash assertion scanned the old candidate source | obsolete/test-contract drift | Production imports reviewed literals; independent tests recompute only for review verification. |

Remaining external claim boundaries are deliberate: exact invoice/usage proof,
provider-enforced sibling-project isolation, and causally fresh Advisor results
are not available from the reviewed observer surfaces. In addition, the five
operator/static/signing pins remain null. `production_admission` therefore
stays typed `blocked`; `staging_initialization` also remains typed `blocked`
until its narrower code-controlled and reviewed operational gates are actually
satisfied.
