# Phase 1 Foundation Proof — Erratum 001

Status: **append-only correction; historical receipt remains immutable**

This erratum corrects two bounded interpretation defects in the protected
historical `PHASE_1_FOUNDATION_PROOF.md` and `.json`. It does not change the
recorded remote attempt, its compensated outcome, or any protected byte.

1. The canonical SHA-256 for historical migration
   `006_outdoor_route_membership_point_index.sql` at the recorded baseline is:
   `13ad98c4fc0fa19b27ad7a398bbaca8a6dfdfb1a29616e2de25c4a877843e8c4`.
   The malformed 62-character value in the Markdown receipt is invalid and
   must not be used for verification.
2. Historical `providerCalls: 0` means zero GraphHopper, AI, and application
   provider calls. It does not mean zero Supabase control-plane operations;
   the historical receipt itself records the Supabase project inspection,
   database attempt, and compensation.

Protected historical bindings:

- `PHASE_1_FOUNDATION_PROOF.md` SHA-256:
  `3209e082f48d33199c68b4cf7e4a8f4b8f08d3e1a07e09faf5faab5c1dabaaff`
- `PHASE_1_FOUNDATION_PROOF.json` SHA-256:
  `45c756fce9a68440c36f8c2cb0ed4228bf7047015166ec603700619abce646a6`
- historical migration `008` SHA-256:
  `e568e6ea65bd0d6f96fd20f636efcbb42700c55856ea3f19d1955b6a9e415b32`

This erratum authorizes no remote action and records no new remote evidence.
