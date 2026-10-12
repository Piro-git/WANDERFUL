# Single additional planning supplement

This is source documentation for a default-off, reviewed operator workflow. Publication makes no claim about a deployed or activated allocation. Live execution requires separate approval of the exact source, setup SQL and activation bytes.

## Code rules

One supplement can admit at most one remote intent and one schema-3 plan. Every Google/GraphHopper attempt is reserved before invocation, including failures, timeouts and revisions. Supplement caps are eight Google and six GraphHopper attempts; cumulative provider ceilings remain 16 and 10.

The activation template requires counter values 2/4/0 for requests/Google/GraphHopper, no active lease, no existing supplement and the same active enrolled key. These are literal code preconditions, not a report of current database usage. Under those preconditions, the supplement permits at most three cumulative plans, twelve Google attempts and six GraphHopper attempts. Unused headroom does not grant further admissions.

The original request counter and its existing guard remain unchanged. A separate singleton records the additional admission. Key, canonical origin, backend tree, approval digest and expiry are immutable. The supplement cannot be replaced, renamed, reset, deleted or truncated. Original and supplementary provider charges must agree in the same serialized transaction.

Existing TLS, authentication, RLS, actor-role, replay and concurrency checks remain in force. The runtime role receives narrow read/counter-update grants; invoker triggers use fixed search paths. Public application roles cannot access the entitlement.

## Operator workflow

1. Review the exact source, setup SQL hash and bounded 1/8/6 policy; obtain separate approval for activation.
2. Apply the reviewed setup SQL to the selected project. Setup creates the entitlement schema and guards; it does not insert an allocation or reset counters.
3. Prepare the reviewed runtime with the supplement disabled. Validate source identity, protection and closed authorization gates before any separately authorized promotion.
4. Establish readiness separately, then freeze matching client/server metadata and a deadline of at most 30 minutes.
5. Generate and review the insert-only transaction with `prepareSupplementActivation`. The function returns a proposal and configuration; it does not execute SQL, deploy or start a window.
6. Only under separate authorization, activate the reviewed binding and coordinate one native flow. Preserve existing application and saved-state identities.
7. Inspect actual results and both accounting components. Fixture passes or HTTP success alone do not establish route, photograph or persistence acceptance.

## Revocation and checks

Revocation is irreversible and preserves all spent counters. Expiry stops further reservation/readiness; it cannot be silently extended or renewed.

Synthetic and disposable PostgreSQL tests cover binding, schema-4 rejection, concurrent bounds, cumulative accounting, permission/guard checks, reset/deletion/truncation refusal and revocation. Private runtime state, approval records and execution evidence do not belong in this directory.
