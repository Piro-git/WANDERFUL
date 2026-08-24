# Staging Readiness V1 Independent Adversarial Audit

Status: **P1/P2 findings corrected; no remaining verified P1/P2 in the
offline-only package**

Scope: self-attestation, forged receipts, production aliasing, candidate
TOCTOU, credential leakage, canonical case omission, clock substitution,
cleanup forgery, provider-accounting bypass and database/runtime-owner
collusion.

## Corrected findings

1. **P1 — a signed synthetic live receipt could be locally trusted as GO.**
   A caller that supplied both fabricated evidence and its own trusted observer
   key could satisfy the structural live validator. The exit helper and an
   injected runner implementation could then produce exit zero.

   Correction: the validator now performs the complete structural, binding,
   digest and signature checks and then rejects every `live_staging` receipt
   with `live_execution_not_admitted`. The exit helper has no zero path. The
   command accepts only a validated `offline_contract`/`NO_GO` receipt, reloads
   policy independently, and rejects an injected live GO before publication.
   The regression test proves zero writes and exit `2`.

2. **P2 — offline proof time trusted itself.** The claimed `proofAsOf` value
   was reused as the validator's trusted current time, allowing stale or future
   offline receipts to be published as canonical NO-GO evidence.

   Correction: the process samples a separate clock and passes it independently
   from `proofAsOf`. Offline receipts outside the existing five-minute
   invocation-skew guard are rejected. Tests cover stale and future values.

3. **P2 — the live candidate binding window was not bounded.** A receipt could
   move preflight far into the past and place stale observations inside the
   artificially widened window.

   Correction: the owner-decided maximum receipt age also bounds both the total
   preflight/postflight window and the earliest permitted preflight relative to
   `proofAsOf`. Every live observation remains required inside that window.

## Retest outcome

- focused proof and adversarial corpus: 73 passed, 0 failed, 0 skipped;
- injected signed synthetic live GO: rejected, no receipt write, exit `2`;
- forged signature and untrusted observer: rejected;
- stale/future offline clocks and stale widened live window: rejected;
- no current network/provider path, Attempt 13 authorization, scope violation,
  secret exposure or production mutation found.

## Mandatory future admission warning

The live schema is currently a structural model, not a live evidence capture
driver. Its observations remain constructible by a local caller and do not yet
prove external evidence provenance, production-guard trust, or every possible
cross-category identity alias. This is not currently reachable because all
live receipts are unconditionally rejected.

A future integration owner must not enable live execution by deleting the hard
stop. Live admission requires a separately reviewed trusted capture boundary,
immutable database/runtime candidates, approved non-production identity guard,
explicit authorization, independently false deployed flags, secret-store proof
access, and the complete failure-drill controls in
`REAL_EXECUTION_GATE_V1.md`.
