# V4 Proof Run Clock Contract

Status: **VERSIONED FOR FUTURE ATTEMPTS; ATTEMPTS 1–5 UNCHANGED**

Future V4 live attempts use run-context schema 2. The run controller reads the
two completed active import/projection snapshots and then captures exactly one
canonical UTC `proofAsOf` immediately before the database-planning gates. The
canonical form is `YYYY-MM-DDTHH:mm:ss.sssZ`. Local time, offsets, shortened or
extended fractions, impossible dates, trailing data, and invalid dates fail
closed.

The sealed run context binds:

- the authorization reference and ledger namespace;
- the canonical four-case manifest digest;
- the one `proofAsOf` used by Harz, Innsbruck, capability resolution,
  research planning, diagnostics, provider admission, and the receipt;
- each region's source-data, retrieval, import, and active-projection time;
- the unchanged 14-day freshness policy; and
- a deterministic digest over the complete record.

The context is immutable and process-sealed. Domain planning receives only its
injected clock function; it must not call the wall clock. The controller reads
the database snapshots again immediately before provider admission and rejects
any change after sealing. Provider admission also requires a clock-binding
record that reconciles the database diagnostic to the same context digest.
Missing, unsealed, changed, or mismatched records fail before credential or
provider admission.

Temporal validation rejects any `proofAsOf` before source data, retrieval,
import, or active projection completion. Evidence at or beyond the committed
14-day age limit remains stale even with a current clock. A supplied timestamp
more than five minutes ahead of the controller's trusted observation is
rejected and is never clamped or replaced. The default live path captures the
clock directly after the snapshot read, so it does not transport an unbound
environment value.

Future receipts include `proofAsOf`, the run-context digest, the database
diagnostic digest, and the clock-binding digest in their semantic receipt
digest. Changing the proof clock or any bound evidence timestamp invalidates
that digest.

Attempts 1–5 remain historical schema-1 evidence. Their fixed clocks,
outcomes, bytes, receipt hashes, and semantic digests are not migrated or
reinterpreted. In particular, Attempt 5 remains truthfully blocked because its
fixed Attempt 4 evaluation clock preceded its current retrieval/import times.
