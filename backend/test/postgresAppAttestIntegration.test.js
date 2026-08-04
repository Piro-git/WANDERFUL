import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { hashOpaqueValue } from "../src/appAttest/clientData.js";
import { PostgresAppAttestRepository } from "../src/appAttest/postgresAppAttestRepository.js";
import { createRouteSessionAuthorizer } from "../src/appAttest/routeSessionAuthorizer.js";

const connectionString = process.env.TRAILMIND_TEST_DATABASE_URL;

describe("PostgreSQL App Attest integration", { skip: !connectionString }, () => {
  const { Pool } = pg;
  let administrativePool;
  let pool;
  let repository;
  let schemaName;

  before(async () => {
    schemaName = `trailmind_app_attest_test_${randomUUID().replaceAll("-", "")}`;
    administrativePool = new Pool({
      connectionString,
      max: 1,
      allowExitOnIdle: true
    });
    await administrativePool.query(`CREATE SCHEMA "${schemaName}"`);
    pool = new Pool({
      connectionString,
      max: 8,
      allowExitOnIdle: true,
      options: `-c search_path=${schemaName},public`
    });
    const migration = await readFile(
      new URL("../migrations/001_app_attest.sql", import.meta.url),
      "utf8"
    );
    await pool.query(migration);
    await pool.query(migration);
    repository = new PostgresAppAttestRepository({ pool });
  });

  after(async () => {
    if (pool) await pool.end();
    if (administrativePool && schemaName) {
      await administrativePool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    }
    if (administrativePool) await administrativePool.end();
  });

  it("applies the schema twice and retains every authorization table", async () => {
    const result = await pool.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = $1
          AND table_name LIKE 'app_attest_%'
        ORDER BY table_name`,
      [schemaName]
    );
    assert.deepEqual(result.rows.map((row) => row.table_name), [
      "app_attest_challenges",
      "app_attest_keys",
      "app_attest_provider_leases",
      "app_attest_rate_windows",
      "app_attest_request_ids",
      "app_attest_route_sessions"
    ]);
  });

  it("enforces one-time challenges, expiry, and atomic assertion counters", async () => {
    const suffix = randomUUID();
    const challengeId = `challenge-${suffix}`;
    await repository.createChallenge({
      id: challengeId,
      purpose: "registration",
      challenge: Buffer.alloc(32, 4),
      expiresAt: Date.now() + 60_000,
      edgeIdentity: `edge-${suffix}`,
      edgeMaximum: 20,
      edgeWindowMs: 60_000
    });
    assert.deepEqual(
      await repository.consumeChallenge({ id: challengeId, purpose: "registration" }),
      Buffer.alloc(32, 4)
    );
    await assert.rejects(
      repository.consumeChallenge({ id: challengeId, purpose: "registration" }),
      (error) => error.code === "app_attest_challenge_reused"
    );

    const expiredChallengeId = `expired-challenge-${suffix}`;
    await repository.createChallenge({
      id: expiredChallengeId,
      purpose: "registration",
      challenge: Buffer.alloc(32, 5),
      expiresAt: Date.now() - 1_000,
      edgeIdentity: `expired-edge-${suffix}`,
      edgeMaximum: 20,
      edgeWindowMs: 60_000
    });
    await assert.rejects(
      repository.consumeChallenge({ id: expiredChallengeId, purpose: "registration" }),
      (error) => error.code === "app_attest_challenge_expired"
    );
    await assert.rejects(
      repository.consumeChallenge({ id: expiredChallengeId, purpose: "registration" }),
      (error) => error.code === "app_attest_challenge_reused"
    );

    const keyIdHash = `key-${suffix}`;
    await repository.registerKey({
      environment: "development",
      keyIdHash,
      installationId: `installation-${suffix}`,
      publicKeyPem: "test-public-key",
      receipt: Buffer.from("test-receipt"),
      counter: 0,
      validationCategory: 3,
      bundleVersion: "1"
    });
    const updates = await Promise.allSettled([
      repository.updateAssertionCounter({
        environment: "development",
        keyIdHash,
        previousCounter: 0,
        newCounter: 1,
        metadata: { validationCategory: 3, bundleVersion: "1" }
      }),
      repository.updateAssertionCounter({
        environment: "development",
        keyIdHash,
        previousCounter: 0,
        newCounter: 1,
        metadata: { validationCategory: 3, bundleVersion: "1" }
      })
    ]);
    assert.equal(updates.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(
      updates.find((result) => result.status === "rejected").reason.code,
      "app_attest_counter_replayed"
    );
  });

  it("rejects request-ID replay and expired sessions without double debiting", async () => {
    const tokenHash = await createSession({ maximumCost: 6 });
    const requestId = randomUUID();
    const access = await repository.consumeRouteAccess(
      routeAccess({ tokenHash, requestId, cost: 2 })
    );
    await repository.releaseRouteLease(access.leaseId);

    await assert.rejects(
      repository.consumeRouteAccess(routeAccess({ tokenHash, requestId, cost: 2 })),
      (error) => error.code === "request_replayed"
    );
    const remaining = await pool.query(
      "SELECT remaining_cost FROM app_attest_route_sessions WHERE token_hash = $1",
      [tokenHash]
    );
    assert.equal(remaining.rows[0].remaining_cost, 4);

    const recovered = await repository.consumeRouteAccess(
      routeAccess({ tokenHash, requestId: randomUUID(), cost: 2 })
    );
    await repository.releaseRouteLease(recovered.leaseId);

    const expiredTokenHash = await createSession({
      maximumCost: 6,
      expiresAt: Date.now() - 1_000
    });
    await assert.rejects(
      repository.consumeRouteAccess(
        routeAccess({ tokenHash: expiredTokenHash, requestId: randomUUID(), cost: 1 })
      ),
      (error) => error.code === "route_session_expired"
    );
  });

  it("prevents concurrent session-budget overspending", async () => {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashOpaqueValue(token);
    await repository.createRouteSession({
      tokenHash,
      installationId: `installation-${randomUUID()}`,
      expiresAt: Date.now() + 60_000,
      maximumCost: 6
    });
    const authorizer = createRouteSessionAuthorizer({
      repository,
      env: { NODE_ENV: "test", ROUTE_PROVIDER_ENABLED: "true" }
    });
    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }, () => authorizer.authorize({
        cost: 2,
        headers: {
          authorization: `TrailMindRouteSession ${token}`,
          "x-trailmind-request-id": randomUUID()
        }
      }))
    );
    const successful = attempts.filter((result) => result.status === "fulfilled");
    assert.equal(successful.length, 3);
    assert.equal(
      attempts.find((result) => result.status === "rejected").reason.code,
      "route_session_exhausted"
    );
    await Promise.all(successful.map((result) => result.value.release()));
  });

  it("enforces weighted installation and provider budgets and recovers after reset", async () => {
    await pool.query(
      "DELETE FROM app_attest_rate_windows WHERE scope IN ('route-installation', 'route-provider')"
    );
    const installationId = `weighted-installation-${randomUUID()}`;
    const tokenHash = await createSession({ installationId, maximumCost: 20 });
    const first = await repository.consumeRouteAccess(routeAccess({
      tokenHash,
      requestId: randomUUID(),
      cost: 2,
      installationMaximumCost: 3
    }));
    await repository.releaseRouteLease(first.leaseId);

    const retryRequestId = randomUUID();
    await assert.rejects(
      repository.consumeRouteAccess(routeAccess({
        tokenHash,
        requestId: retryRequestId,
        cost: 2,
        installationMaximumCost: 3
      })),
      (error) => error.code === "app_attest_rate_limited"
    );
    const rejectedState = await pool.query(
      `SELECT remaining_cost,
              EXISTS (
                SELECT 1 FROM app_attest_request_ids
                 WHERE token_hash = $1 AND request_id = $2
              ) AS request_persisted
         FROM app_attest_route_sessions
        WHERE token_hash = $1`,
      [tokenHash, retryRequestId]
    );
    assert.equal(rejectedState.rows[0].remaining_cost, 18);
    assert.equal(rejectedState.rows[0].request_persisted, false);

    await pool.query(
      `UPDATE app_attest_rate_windows
          SET reset_at = clock_timestamp() - interval '1 second'
        WHERE scope = 'route-installation' AND identity_hash = $1`,
      [installationId]
    );
    const afterInstallationReset = await repository.consumeRouteAccess(routeAccess({
      tokenHash,
      requestId: retryRequestId,
      cost: 2,
      installationMaximumCost: 3
    }));
    await repository.releaseRouteLease(afterInstallationReset.leaseId);

    await pool.query("DELETE FROM app_attest_rate_windows WHERE scope = 'route-provider'");
    const firstGlobalToken = await createSession({ maximumCost: 10 });
    const secondGlobalToken = await createSession({ maximumCost: 10 });
    const firstGlobal = await repository.consumeRouteAccess(routeAccess({
      tokenHash: firstGlobalToken,
      requestId: randomUUID(),
      cost: 2,
      globalMaximumCost: 3
    }));
    await repository.releaseRouteLease(firstGlobal.leaseId);
    const globalRetryRequestId = randomUUID();
    await assert.rejects(
      repository.consumeRouteAccess(routeAccess({
        tokenHash: secondGlobalToken,
        requestId: globalRetryRequestId,
        cost: 2,
        globalMaximumCost: 3
      })),
      (error) => error.code === "app_attest_rate_limited"
    );
    await pool.query(
      `UPDATE app_attest_rate_windows
          SET reset_at = clock_timestamp() - interval '1 second'
        WHERE scope = 'route-provider' AND identity_hash = 'global'`
    );
    const afterGlobalReset = await repository.consumeRouteAccess(routeAccess({
      tokenHash: secondGlobalToken,
      requestId: globalRetryRequestId,
      cost: 2,
      globalMaximumCost: 3
    }));
    await repository.releaseRouteLease(afterGlobalReset.leaseId);
  });

  it("enforces global concurrency and rolls rejected request state back for retry", async () => {
    const tokenHash = await createSession({ maximumCost: 10 });
    const first = await repository.consumeRouteAccess(routeAccess({
      tokenHash,
      requestId: randomUUID(),
      cost: 1,
      globalMaximumConcurrency: 1
    }));
    const retryRequestId = randomUUID();
    await assert.rejects(
      repository.consumeRouteAccess(routeAccess({
        tokenHash,
        requestId: retryRequestId,
        cost: 1,
        globalMaximumConcurrency: 1
      })),
      (error) => error.code === "app_attest_rate_limited"
    );
    await repository.releaseRouteLease(first.leaseId);
    const retry = await repository.consumeRouteAccess(routeAccess({
      tokenHash,
      requestId: retryRequestId,
      cost: 1,
      globalMaximumConcurrency: 1
    }));
    await repository.releaseRouteLease(retry.leaseId);
  });

  it("prunes only records past the grace period and cascades replay IDs", async () => {
    const oldChallenge = `old-challenge-${randomUUID()}`;
    const recentChallenge = `recent-challenge-${randomUUID()}`;
    const futureChallenge = `future-challenge-${randomUUID()}`;
    await pool.query(
      `INSERT INTO app_attest_challenges
         (challenge_id, purpose, challenge, expires_at)
       VALUES
         ($1, 'registration', $4, clock_timestamp() - interval '11 minutes'),
         ($2, 'registration', $4, clock_timestamp() - interval '5 minutes'),
         ($3, 'registration', $4, clock_timestamp() + interval '5 minutes')`,
      [oldChallenge, recentChallenge, futureChallenge, Buffer.alloc(32, 9)]
    );

    const oldSession = `old-session-${randomUUID()}`;
    const recentSession = `recent-session-${randomUUID()}`;
    const futureSession = `future-session-${randomUUID()}`;
    const oldRequestId = randomUUID();
    await pool.query(
      `INSERT INTO app_attest_route_sessions
         (token_hash, installation_id, expires_at, remaining_cost)
       VALUES
         ($1, $4, clock_timestamp() - interval '11 minutes', 1),
         ($2, $5, clock_timestamp() - interval '5 minutes', 1),
         ($3, $6, clock_timestamp() + interval '5 minutes', 1)`,
      [
        oldSession,
        recentSession,
        futureSession,
        `old-installation-${randomUUID()}`,
        `recent-installation-${randomUUID()}`,
        `future-installation-${randomUUID()}`
      ]
    );
    await pool.query(
      "INSERT INTO app_attest_request_ids (token_hash, request_id) VALUES ($1, $2)",
      [oldSession, oldRequestId]
    );

    const expiredWindowIdentity = `expired-window-${randomUUID()}`;
    const futureWindowIdentity = `future-window-${randomUUID()}`;
    await pool.query(
      `INSERT INTO app_attest_rate_windows (scope, identity_hash, cost, reset_at)
       VALUES
         ('challenge-edge', $1, 1, clock_timestamp() - interval '1 second'),
         ('challenge-edge', $2, 1, clock_timestamp() + interval '5 minutes')`,
      [expiredWindowIdentity, futureWindowIdentity]
    );

    const oldLease = randomUUID();
    const oldReleasedLease = randomUUID();
    const recentLease = randomUUID();
    const futureLease = randomUUID();
    await pool.query(
      `INSERT INTO app_attest_provider_leases
         (lease_id, scope, expires_at, released_at)
       VALUES
         ($1, 'route', clock_timestamp() - interval '11 minutes', NULL),
         ($2, 'route', clock_timestamp() + interval '5 minutes',
          clock_timestamp() - interval '11 minutes'),
         ($3, 'route', clock_timestamp() - interval '5 minutes', NULL),
         ($4, 'route', clock_timestamp() + interval '5 minutes', NULL)`,
      [oldLease, oldReleasedLease, recentLease, futureLease]
    );

    assert.deepEqual(await repository.pruneExpired(), {
      challenges: 1,
      routeSessions: 1,
      rateWindows: 1,
      providerLeases: 2
    });
    const retainedChallenges = await pool.query(
      "SELECT challenge_id FROM app_attest_challenges WHERE challenge_id = ANY($1::text[])",
      [[oldChallenge, recentChallenge, futureChallenge]]
    );
    assert.deepEqual(
      retainedChallenges.rows.map((row) => row.challenge_id).sort(),
      [recentChallenge, futureChallenge].sort()
    );
    const retainedSessions = await pool.query(
      "SELECT token_hash FROM app_attest_route_sessions WHERE token_hash = ANY($1::text[])",
      [[oldSession, recentSession, futureSession]]
    );
    assert.deepEqual(
      retainedSessions.rows.map((row) => row.token_hash).sort(),
      [recentSession, futureSession].sort()
    );
    const cascadedRequest = await pool.query(
      "SELECT 1 FROM app_attest_request_ids WHERE token_hash = $1 AND request_id = $2",
      [oldSession, oldRequestId]
    );
    assert.equal(cascadedRequest.rowCount, 0);
    const retainedLeases = await pool.query(
      "SELECT lease_id::text FROM app_attest_provider_leases WHERE lease_id = ANY($1::uuid[])",
      [[oldLease, oldReleasedLease, recentLease, futureLease]]
    );
    assert.deepEqual(
      retainedLeases.rows.map((row) => row.lease_id).sort(),
      [recentLease, futureLease].sort()
    );
  });

  it("rolls a real database failure back and remains usable", async () => {
    const challengeId = `rollback-challenge-${randomUUID()}`;
    const failure = new Error("synthetic transaction failure");
    await assert.rejects(
      repository.transaction(async (client) => {
        await client.query(
          `INSERT INTO app_attest_challenges
             (challenge_id, purpose, challenge, expires_at)
           VALUES ($1, 'registration', $2, clock_timestamp() + interval '1 minute')`,
          [challengeId, Buffer.alloc(32, 6)]
        );
        throw failure;
      }),
      (error) => error === failure
    );
    const rolledBack = await pool.query(
      "SELECT 1 FROM app_attest_challenges WHERE challenge_id = $1",
      [challengeId]
    );
    assert.equal(rolledBack.rowCount, 0);

    await repository.createChallenge({
      id: challengeId,
      purpose: "registration",
      challenge: Buffer.alloc(32, 6),
      expiresAt: Date.now() + 60_000,
      edgeIdentity: `rollback-edge-${randomUUID()}`,
      edgeMaximum: 20,
      edgeWindowMs: 60_000
    });
    const recovered = await pool.query(
      "SELECT 1 FROM app_attest_challenges WHERE challenge_id = $1",
      [challengeId]
    );
    assert.equal(recovered.rowCount, 1);
  });

  async function createSession({
    installationId = `installation-${randomUUID()}`,
    expiresAt = Date.now() + 60_000,
    maximumCost = 12
  } = {}) {
    const tokenHash = hashOpaqueValue(randomBytes(32).toString("base64url"));
    await repository.createRouteSession({
      tokenHash,
      installationId,
      expiresAt,
      maximumCost
    });
    return tokenHash;
  }
});

function routeAccess({
  tokenHash,
  requestId,
  cost,
  installationMaximumCost = 10_000,
  globalMaximumCost = 1_000_000,
  globalMaximumConcurrency = 1_000
}) {
  return {
    scope: "route",
    tokenHash,
    requestId,
    cost,
    providerEnabled: true,
    installationMaximumCost,
    installationWindowMs: 60_000,
    globalMaximumCost,
    globalWindowMs: 60_000,
    globalMaximumConcurrency,
    leaseTtlMs: 60_000
  };
}
