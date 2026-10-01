# Private owner diagnostics

The launcher now creates owner-diagnostics.jsonl beside the private session ledger
(mode 0600, real owner-only directory, no symlink following, maximum 32 KiB).
It records allowlisted endpoint/provider phase, local request sequence, elapsed
milliseconds, HTTP status, known error codes, and abort state. It never writes
prompts, coordinates, headers, keys, tokens, upstream responses, or exception text.
The live session must not be restarted merely to enable this instrumentation.

2026-09-06 phone failure evidence: the immutable live ledger recorded 2 Google
attempts and 0 GraphHopper attempts. Its last outcome was an unclassified Google
transport error. Earlier outcomes, endpoint phases, and elapsed times were not
persisted. Therefore successful remote intent parsing, selector execution, and the
exact transport cause cannot be established retrospectively. The phone error alone
also cannot establish those facts because intent parsing can fall back locally.

An offline abort fixture reproduces the historical unclassified outcome. The new
fixture exercises the HTTP adapter at the selector's 4000 ms deadline with a fake
clock and aborting fake fetch; it preserves the typed timed_out failure, records
itinerary_selection/aborted/4000 ms, consumes one Google reservation, and makes no
GraphHopper request. This proves the diagnostic mechanism, not that the live error
was a timeout. There is no measured live latency sufficient to justify increasing
the selector allocation within the overall deadline. Caps, retries, deadlines,
model choice, and real-data research rules are unchanged.

Validation: 20 offline tests covering metadata exclusion/bounds, timeout and
transport discrimination, provider accounting, runtime cleanup, and authenticated
loopback endpoint wiring. No live provider requests were made during diagnosis.
