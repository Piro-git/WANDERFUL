# Renewable access for a personal iPhone

Status: a separate owner service, PostgreSQL adapter, versioned SQL artifacts,
cryptographic protocol and local HTTP/database tests are implemented. Nothing is
deployed or migrated remotely. Active phone enrollment, a public host and real
provider-backed phone operation remain unverified. Production App Attest and the
expired bounded phone-test credentials remain unchanged.

Apple permits personal-device development with a free Personal Team. Provisioning
profiles expire after seven days, requiring a rebuild and reinstall. A hosted
backend cannot remove this signing restriction. Source:
[Apple developer account overview](https://developer.apple.com/help/account/basics/about-your-developer-account).

## Scope and protocol

This protocol authenticates possession of a manually approved owner's private
key. It does not prove genuine app identity or replace App Attest for public app
distribution. It is deliberately separate from App Attest registration, receipts,
assertions and challenge tables.

The phone generates a P-256 signing key. The enrollment flow must store
the private key in a device-only Keychain item (or Secure Enclave) and allow an
operator to approve only its public SPKI DER key. There is no public registration
endpoint. No reusable provider secret or permanent bearer belongs in the app.

`keyId` is base64url without padding of SHA-256 over canonical P-256 SPKI DER.
`createOwnerAccessEndpoint` is disabled unless `enabled` is exactly `true`, origin
is a canonical permanent HTTPS origin, and a complete durable repository is
provided. Non-durable adapters are accepted only under explicit `environment:
"test"`; deployment must never obtain this option from a client request.

1. `POST /api/owner-access/challenge` accepts exactly `{keyId}`.
   It returns `{challengeId, challenge, expiresAt}`. The ID has 24 random bytes;
   challenge has 32; both use canonical base64url. Challenge lifetime is 60 seconds.
2. The phone creates a 32-byte nonce and signs canonical client data using
   ECDSA P-256 SHA-256. Each field below is prefixed with its byte length as an
   unsigned 32-bit big-endian integer, then concatenated in order:

   - UTF-8 `wanderful-owner-session-v1`
   - UTF-8 exact configured HTTPS origin, without trailing slash
   - UTF-8 `POST`
   - UTF-8 `/api/owner-access/route-session`
   - UTF-8 base64url key ID
   - UTF-8 base64url challenge ID
   - decoded 32-byte challenge
   - decoded 32-byte nonce

3. `POST /api/owner-access/route-session` accepts exactly
   `{keyId, challengeId, sessionNonce, signature}`. Nonce and signature are
   base64url. The signature is the 64-byte IEEE-P1363 representation (`r || s`),
   matching CryptoKit `ECDSASignature.rawRepresentation`.
4. Successful exchange returns `{routeSessionToken, expiresAt, remainingCost}`:
   a random 32-byte base64url token, 120-second validity and maximum cost 12.
   Store only the existing `hashOpaqueValue(token)` in the session repository.
   Dates use ISO 8601 UTC with fractional seconds. Every response is `no-store`.

Error codes are fixed and contain no raw exception text: `owner_access_denied`
(403), `owner_access_invalid_proof` (401), `owner_access_rate_limited` (429),
`owner_access_unavailable` (503). No provider is called during authentication.

## Required durable adapter contract

`PostgresOwnerRepository` implements the endpoint interface below using the
separate `wanderful_owner_v1` schema. The disposable database test exercises real
SQL transactions, restricted runtime grants, RLS, replay and concurrent budgets.

| Method | Required behavior |
| --- | --- |
| `findActiveOwnerKey({keyId})` | Return approved `{publicKeySPKI: Buffer, installationId}` only while key and owner are active. Owner ID has `owner:` prefix and 16–128 URL-safe characters; keep it stable when rotating keys. |
| `consumeOwnerOperation({edgeIdentity,keyId,operationWindowMs,edgeMaximum,ownerMaximum,...})` | Atomically enforce a durable 300-second edge window of 20 operations and key window of 10, including unknown keys. Return explicit boolean. Also bound anonymous-key cardinality at ingress. |
| `createOwnerChallenge({keyId,installationId,challengeId,challenge,origin,expiresAt})` | Insert challenge only if allowlisted key/owner is still active; unique challenge ID; return explicit boolean. |
| `findOwnerChallenge({keyId,challengeId})` | Read only that key's record with `challenge`, `origin`, `installationId`, numeric `expiresAt` milliseconds and `consumed` boolean. |
| `exchangeOwnerChallenge({keyId,installationId,challengeId,origin,tokenHash,expiresAt,maximumCost})` | In one transaction lock/check active key and owner, lock challenge, enforce matching owner/key/origin and expiry using database time, consume once, and insert session. Return true only after commit; rollback all writes on failure. |

The adapter uses dedicated owner key, challenge, session, request, budget and lease
tables with RLS and no public Data API grants. It does not insert records into
App Attest tables. Its authorizer supplies the existing route/intent HTTP handlers
with the same opaque session header contract, so their provider DTOs are unchanged.

`revokeOwner` uses an operator-only database connection to revoke owner, keys,
sessions and challenges atomically. Admission and every provider reservation check
active owner/key/session state again. Key rotation must retain owner identity;
renewal does not reset installation/global usage, provider leases or replay records.

## Startup and operational integration

- The separate executable is `node src/ownerAccess/startOwnerService.js`.
  `NODE_ENV=production`, `OWNER_ACCESS_ENABLED=true`, `OWNER_ACCESS_ORIGIN`,
  `AI_PROVIDER=google` and an explicit `GOOGLE_MODEL` are required. Provider keys
  remain `GOOGLE_API_KEY` and `GRAPHHOPPER_API_KEY` in the host secret store.
- Required limits are `OWNER_ACCESS_ROUTE_DAILY_LIMIT`,
  `OWNER_ACCESS_GLOBAL_ROUTE_DAILY_LIMIT`, `OWNER_ACCESS_INTENT_DAILY_LIMIT`,
  `OWNER_ACCESS_GLOBAL_INTENT_DAILY_LIMIT` (each 1–100) and
  `OWNER_ACCESS_MAX_CONCURRENCY` (1–2). Route means GraphHopper, intent means Google.
  Each actual upstream fetch consumes one durable attempt before network access;
  failures and retries count. These are request counts, not dollar guarantees.
  Windows last 24 hours from first reservation. Session cost and concurrency leases
  are separate. Failed budget reservations never call a provider.
- `OWNER_ACCESS_DATABASE_URL` must name the restricted runtime role and
  `OWNER_ACCESS_DATABASE_CA_FILE` a trusted certificate file; TLS verification
  stays on. An explicitly matching `OWNER_ACCESS_SUPABASE_PROJECT_REF` also permits
  that role's session-pooler username suffix on Supabase port 5432. No transaction
  pooler, URL SSL override, operator credential or arbitrary role suffix is allowed.
- An operator first provisions `wanderful_owner_runtime` as a NOINHERIT login with
  no role memberships, superuser, BYPASSRLS, CREATEDB, CREATEROLE or REPLICATION.
  Apply `001_owner_access.sql` once using the separate migration operator. It
  creates only the new schema, RLS/grants and removes managed Data API default
  grants. Web startup checks the actual role, table ownership and privilege matrix.
  The web role cannot approve/revoke owners or prune; it never receives operator
  credentials. No remote role or table was changed in this task.
- An operator inserts the reviewed public key into `keys` and the stable private
  identity into `owners`. Key rotation retains that identity. Use `revokeOwner`
  with the separate operator connection when needed; existing sessions then fail.
- Run `002_owner_prune.sql` periodically using the operator, not the web role. It
  removes expired state in bounded batches, keeps owners/keys, and preserves active
  budgets. It never resets counters to manufacture allowance. This is a separate
  operational job; no automation was created here.
- The HTTP service accepts only challenge/session, `/api/parse-intent`, `/api/route`,
  `/healthz` and `/readyz`. JSON body size is 16 KiB, upload allowance 10 seconds,
  request deadline 40 seconds. It uses the socket peer as a coarse shared ingress
  identity and never trusts forwarded identity or Host for signing. Closed provider
  configuration excludes inherited research, mocks, alternate APIs and custom URLs.
  Each fetch is restricted to the existing Google interactions/GH route endpoint,
  and redirects are blocked. No grounding or research tools are enabled.

## Live verification remaining

- Verify the phone's opt-in owner Debug configuration and `RouteSessionService`
  integration, origin pinning, Keychain persistence, refresh and safe errors on the
  physical device. App Store builds must not fall back from App Attest to owner auth.
- Approve the physical public key via trusted local transfer; never print a private
  key. Show clear owner setup and revocation behavior without a production debug UI.
- Mount endpoint only on the owner service, deploy, and verify HTTPS readiness,
  renewal, revocation and an authorized route from the phone over mobile data with
  the Mac off. No temporary tunnel is a permanent-host substitute.

Offline verification: `node --test test/ownerAccessEndpoint.test.js
test/ownerAccessService.test.js` passes 13 tests. The HTTP test uses fake provider
responses and a repository spy to verify route/parser envelopes and per-fetch
reservation/release. `node src/ownerAccess/runPostgresTests.js` creates a disposable
loopback PostgreSQL cluster, runs the actual lifecycle/privilege/budget integration
test, stops it and removes its own data. It proves database behavior with concurrent
repository workers and new sessions; it does not prove hosted TLS/networking,
Keychain enrollment or real provider routes.

Public cross-language vector: origin `https://owner.example.com`; key ID is encoded
32 bytes of `01`; challenge ID encoded 24 bytes of `02`; challenge 32 bytes of `03`;
nonce 32 bytes of `04`. Canonical data is 257 bytes, SHA-256
`0c16da272ec832ce7717ec697590deedc911b66548465d1e9703719646e073a1`.
