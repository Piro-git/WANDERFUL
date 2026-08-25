# TrailMind backend staging proof

Status: deterministic proof complete; disposable-PostgreSQL execution pending
Evidence date: 2026-07-18
Security-scan baseline revision: `e5e70328070498fa343548c0917915677b2c5995`

## Release decision

The reviewed backend fails closed when production App Attest cannot use a durable repository. Deterministic tests cover the endpoint, authorization, transaction, and maintenance controls without provider credentials or network access.

Real PostgreSQL proof was not run on the review machine. `TRAILMIND_TEST_DATABASE_URL`, `DATABASE_URL`, and `POSTGRES_URL` were absent, and no PostgreSQL server/client or supported local container runtime was available. The PostgreSQL integration suite therefore remained skipped. No production database, live route provider, AI provider, deployment, or other external service was contacted.

Closed beta remains blocked until the dedicated staging run below passes and the external schedule/alert is observed.

## Proven locally

- Unknown-key route-session challenge requests consume their edge/key attempt before the registered-key lookup and never create a challenge.
- A route provider timeout that can outlive its concurrency lease is rejected as `authorization_unavailable`; the supported boundary remains timeout less than or equal to lease TTL minus one second.
- Production endpoints and authorizers reject in-memory repositories.
- PostgreSQL transactions use one checked-out client, roll failed work back, preserve the original failure, and release the client.
- Pruning performs four deletes in one transaction, returns fixed aggregate counts, rolls back on a mid-delete failure, and succeeds on retry.
- The one-shot pruning command fails closed without PostgreSQL configuration, closes its own pool, and emits counts only.
- Provider credentials were explicitly unavailable during the deterministic/full-suite run.

## Verification receipts

| Check | Result |
| --- | --- |
| Scoped backend security scan | 26/26 inventory receipts closed; 0 reportable findings; 2 validated candidates rejected by attack-path policy; PostgreSQL/runtime pruning proof deferred |
| Pre-fix focused regression run | 15 tests: 11 passed, 4 failed on the expected attempt-order, lease/timeout, and prune-count assertions |
| Final focused regression run | 20 tests in 4 suites: 20 passed, 0 failed |
| Full backend suite with provider/database variables removed | 177 tests in 19 suites: 177 passed, 0 failed |
| PostgreSQL integration cases | 0 of 8 executed; the enclosing suite reported `SKIP` because `TRAILMIND_TEST_DATABASE_URL` was absent |
| Backend syntax/build check | Passed |
| Original unknown-key reproducer after fix | Exited nonzero because the route-session attempt count changed from 0 to 1; no challenge was created |
| Original lease/timeout reproducer after fix | Exited nonzero with safe `authorization_unavailable` before authorization/provider work |
| Prune command without database configuration | Exited 1 and emitted only `App Attest prune failed.` |

The full-suite test runner's numeric `skipped` footer remains zero because Node marks the PostgreSQL `describe` block itself as `SKIP` and does not instantiate its eight child cases. The eight cases are therefore explicitly recorded as unrun rather than counted as passes.

Commands used:

```sh
cd /Users/piroscheibe/Documents/EasyWander/backend

env -u GRAPHHOPPER_API_KEY -u GOOGLE_API_KEY -u OPENROUTER_API_KEY \
  -u DATABASE_URL -u POSTGRES_URL -u TRAILMIND_TEST_DATABASE_URL \
  node --test test/appAttestEndpoint.test.js \
    test/routeSessionIntegration.test.js \
    test/postgresAppAttestRepository.test.js \
    test/appAttestPrune.test.js

env -u GRAPHHOPPER_API_KEY -u GOOGLE_API_KEY -u OPENROUTER_API_KEY \
  -u DATABASE_URL -u POSTGRES_URL -u TRAILMIND_TEST_DATABASE_URL \
  npm test

env -u GRAPHHOPPER_API_KEY -u GOOGLE_API_KEY -u OPENROUTER_API_KEY \
  -u DATABASE_URL -u POSTGRES_URL -u TRAILMIND_TEST_DATABASE_URL \
  npm run build
```

## Disposable PostgreSQL gate

Use a database created only for this proof. The commands apply migrations and delete expired test authorization records. Never point them at production, a shared staging database, or a database containing user data.

Set `TRAILMIND_TEST_DATABASE_URL` through the shell or secret manager without printing it, then run:

```sh
cd /Users/piroscheibe/Documents/EasyWander/backend

test -n "${TRAILMIND_TEST_DATABASE_URL:-}" || {
  echo "TRAILMIND_TEST_DATABASE_URL is required for a disposable database."
  exit 1
}

case "$TRAILMIND_TEST_DATABASE_URL" in
  postgres://*|postgresql://*) ;;
  *)
    echo "TRAILMIND_TEST_DATABASE_URL must use PostgreSQL."
    exit 1
    ;;
esac

test "${CONFIRM_DISPOSABLE_TRAILMIND_DB:-}" = "yes" || {
  echo "Set CONFIRM_DISPOSABLE_TRAILMIND_DB=yes only after confirming this database is disposable."
  exit 1
}

unset GRAPHHOPPER_API_KEY GOOGLE_API_KEY OPENROUTER_API_KEY

NODE_ENV=test DATABASE_URL="$TRAILMIND_TEST_DATABASE_URL" \
  npm run db:migrate:historical-portable-v1
NODE_ENV=test DATABASE_URL="$TRAILMIND_TEST_DATABASE_URL" \
  npm run db:migrate:historical-portable-v1

NODE_ENV=test node --test test/postgresAppAttestIntegration.test.js

NODE_ENV=test DATABASE_URL="$TRAILMIND_TEST_DATABASE_URL" \
  node src/appAttest/pruneExpired.js
```

Pass criteria:

1. Both migration invocations exit zero. The second invocation applies no new migration.
2. The PostgreSQL integration suite runs rather than reporting the suite as skipped.
3. All eight integration cases pass:
   - repeated migration and six-table schema;
   - one-time challenge, challenge expiry, and atomic assertion counter;
   - request-ID replay, session expiry, and no double debit;
   - concurrent session-budget enforcement;
   - weighted installation/global budgets plus reset recovery;
   - global concurrency plus rejected-request retry;
   - grace-period pruning, cascade deletion, and retained fresh records;
   - real transaction rollback and subsequent recovery.
4. The prune command exits zero and prints exactly the four aggregate fields: `challenges`, `routeSessions`, `rateWindows`, and `providerLeases`.
5. No provider credential is restored and no provider request appears in observed traffic.

The integration suite creates a unique PostgreSQL schema for each run, sets that schema as its search path, and drops only that schema during teardown. It does not blanket-delete shared tables.

## Production pruning operation

Run this one-shot command from the deployed backend with production PostgreSQL variables supplied by the platform:

```sh
node src/appAttest/pruneExpired.js
```

Operational contract:

- recommended cadence: every five minutes;
- success: exit zero plus one aggregate-count line;
- failure: nonzero exit plus the generic `App Attest prune failed.` message;
- alert: any nonzero run or no recorded success for 15 minutes;
- logs: retain exit state, duration, and aggregate counts only;
- prohibited logs: database URLs, credentials, record identifiers, tokens, prompts, coordinates, key material, receipts, assertions, or raw errors.

One scheduler owner should be configured. The SQL is transactional and repeatable, but concurrent schedulers can split aggregate counts and make monitoring ambiguous. The deployed scheduler identity, alert destination, run history, and database dashboards are external evidence and remain unresolved until observed in staging.

## Migration and rollback

- `npm run db:migrate:historical-portable-v1` selects the explicit portable local policy, takes a transaction-scoped advisory lock, applies strictly named local SQL files, and records a migration version only inside the successful transaction. It is not the Supabase V2 operator path.
- A migration failure rolls the transaction back and must block deployment.
- The current migration is additive and repeatable. During an application rollback, leave the authorization tables and recorded migration in place; do not run destructive down-migration SQL.
- The timeout/lease guard and attempt-order fix require no schema change.
- Pruning requires no schema change. If the job causes an operational incident, disable the scheduler and preserve its aggregate/exit evidence; do not delete tables.
- Application rollback must retain production fail-closed behavior. Never use the in-memory repository or local insecure flags to recover production traffic.

## Remaining external blockers

- Execute and retain the disposable-PostgreSQL gate output.
- Provision the production/staging scheduler and alert, then observe at least one successful run and one controlled failure notification.
- Confirm production database backup, restore, encryption, access, region, and retention policy.
- Decide App Attest key/receipt retention and deletion policy.
- Complete signed-device/TestFlight App Attest proof and provider/deployment ownership gates.
