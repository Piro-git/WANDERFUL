# Phase 1 blocked rollback quarantine notice 001

Status: **NON-EXECUTABLE / SUPERSEDED HISTORICAL EVIDENCE**

This append-only notice does not change or repair
`PHASE_1_BLOCKED_ROLLBACK.sql`. That protected file records the compensation
actually used after the blocked historical remote attempt. Its broad
`DROP OWNED` and `CASCADE` operations are unsafe as a current operator path
because they are not bounded to a complete exact inventory of every object
type and owner.

The historical file must never be selected, loaded, or executed by the
Supabase isolated V2 operator, migration policy, runbook, or compensation
workflow. The only current compensation candidate is
`PHASE_1_PRE_MIGRATION_V2_ROLLBACK.sql`, and only while its exact identity,
session, object-inventory, active-session, ACL-restoration, and no-ledger/no-
application-foundation guards all pass. It is not a post-migration rollback.

Protected SHA-256 bindings:

- `PHASE_1_BLOCKED_ROLLBACK.sql`:
  `4f4cdbaee71df8b5b4fd5fdc93dc5711c74cd9746c873fa1524196b52011378e`
- `PHASE_1_FOUNDATION_PROOF.md`:
  `3209e082f48d33199c68b4cf7e4a8f4b8f08d3e1a07e09faf5faab5c1dabaaff`
- `PHASE_1_FOUNDATION_PROOF.json`:
  `45c756fce9a68440c36f8c2cb0ed4228bf7047015166ec603700619abce646a6`

Quarantine is a control around immutable evidence; it is not a claim that the
historical SQL itself has been fixed.
