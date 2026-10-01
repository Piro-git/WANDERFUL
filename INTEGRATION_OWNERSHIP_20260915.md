# Integration ownership — 2026-09-15

- **Owner task:** `01a07697-5b05-7ce3-b758-6268c8a15a49` (delegated integration scope)
- **Checkout:** persistent independent clone at this directory
- **Branch:** `codex/integration-20260915`
- **Verified base:** `3aae5e19ec83b43196295e2dc3e98085e64046f0`
- **Pending child:** `client-new-thread:000b1872-1a1a-4f40-9dc8-22e600bbd189`

The pending child must not edit code if it becomes ready. This checkout is the sole
integration owner. It may receive status or handoff information only.

## Scope

Pack-list integration and release/localization regression work. External owner
handoffs are reviewed and ported by content only; their checkouts are never edited.
Paywall, Apple Login, backend runtime, and Commons Photos remain owner-controlled
until their integration patches are reviewed.
