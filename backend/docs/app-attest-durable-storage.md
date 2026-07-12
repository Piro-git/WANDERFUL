# App Attest durable-storage decision

## Status

The repository now includes a provider-neutral PostgreSQL adapter selected only when `DATABASE_URL` is explicitly configured. Production deployment remains intentionally blocked until a dedicated PostgreSQL database is provisioned, `npm run db:migrate` succeeds, and the adapter passes its integration suite against that database.

`PostgresAppAttestRepository` uses parameterized queries, row locks, atomic upserts, compare-and-set updates, and transaction-scoped advisory locks. `InMemoryAppAttestRepository` remains limited to unit tests and explicitly opted-in local development; production endpoints reject it.

## Required adapter contract

A production adapter must share state across every gateway instance and provide transactional or equivalent atomic operations for:

- inserting and consuming a one-time challenge if it is unused and unexpired;
- inserting a registered key without an inappropriate duplicate association;
- updating an assertion counter only when the stored counter equals the expected old value and the new counter is larger;
- inserting an opaque route session by token hash only;
- consuming, in one transaction, a unique request ID, session cost, resource-specific installation-window cost, resource-specific global-window cost, and a resource-specific concurrency lease;
- releasing a concurrency lease idempotently;
- expiring challenges, sessions, request IDs, rate windows, and abandoned leases.

The adapter must support compare-and-set/conditional writes, server-side time, TTLs, and serializable or correctly constrained transactions. Eventual-consistency-only caches are not sufficient for counters or budgets.

## Capacity assumptions

- Challenge lifetime: 5 minutes.
- Route-session lifetime: 2 minutes.
- Default route-session budget: 12 weighted units.
- Normal installation: one registered key and a small number of active challenges/sessions.
- Route bursts: up to three loop variants concurrently per session.
- Request IDs only need replay retention through session expiry plus an operational safety margin.

Exact coordinates, prompts, route bodies, session tokens, key IDs, public keys, receipts, assertions, and attestations must not be used as logs, analytics fields, or rate-limit keys. Stored key material and receipts require encryption/access controls appropriate to the selected datastore.

## Deployment requirements

Before enabling protected production traffic, confirm:

1. Whether the backend runs as one long-lived Node process, multiple containers, or serverless functions.
2. The PostgreSQL service supports transactions, row locks, advisory locks, and the migration schema.
3. Whether global GraphHopper concurrency can use durable leases with crash expiry.
4. Expected peak session creation and route cost per minute.
5. Backup, retention, regional-residency, and deletion requirements for App Attest receipts.

Production can be enabled only after `TRAILMIND_TEST_DATABASE_URL` points to a disposable database and the adapter passes the same counter-replay and concurrent-budget test suite against real PostgreSQL. Expired records should be pruned by calling `PostgresAppAttestRepository.pruneExpired()` from a controlled scheduled job; request paths do not perform unbounded cleanup work.
