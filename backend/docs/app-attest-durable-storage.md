# App Attest durable-storage decision

## Status

Production deployment remains intentionally blocked. This repository has no selected durable datastore, and this change does not silently introduce Redis, Supabase, or another vendor.

`InMemoryAppAttestRepository` exists only for unit tests and explicitly opted-in local development. It is per-process, disappears on restart, and reports `isDurable = false`. Production endpoints reject it.

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

## Deployment compatibility questions

Before choosing an adapter, confirm:

1. Whether the backend runs as one long-lived Node process, multiple containers, or serverless functions.
2. Whether the platform provides a transactional database or atomic key-value operations with TTL.
3. Whether global GraphHopper concurrency can use durable leases with crash expiry.
4. Expected peak session creation and route cost per minute.
5. Backup, retention, regional-residency, and deletion requirements for App Attest receipts.

Production can be enabled only after the adapter passes the same counter-replay and concurrent-budget test suite against the real datastore.
