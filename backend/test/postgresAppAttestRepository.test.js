import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAppAttestRuntime } from "../src/appAttest/appAttestRuntime.js";
import { appAttestError } from "../src/appAttest/appAttestErrors.js";
import {
  PostgresAppAttestRepository,
  postgresAppAttestRepositoryFromEnvironment
} from "../src/appAttest/postgresAppAttestRepository.js";

describe("PostgreSQL App Attest repository", () => {
  it("selects an explicit PostgreSQL URL and supports Vercel's managed fallback", () => {
    assert.equal(postgresAppAttestRepositoryFromEnvironment({}, { pool: fakePool() }), undefined);
    assert.throws(
      () => postgresAppAttestRepositoryFromEnvironment(
        { DATABASE_URL: "https://database.example" },
        { pool: fakePool() }
      ),
      (error) => error.code === "authorization_unavailable"
    );
    const productPool = fakePool();
    const cancellationPool = fakePool();
    const repository = postgresAppAttestRepositoryFromEnvironment(
      { DATABASE_URL: "postgresql://example.invalid/trailmind" },
      { pool: productPool, cancellationPool }
    );
    assert.equal(repository.isDurable, true);
    assert.equal(repository.pool, productPool);
    assert.equal(repository.cancellationPool, cancellationPool);

    const managedRepository = postgresAppAttestRepositoryFromEnvironment(
      { POSTGRES_URL: "postgresql://example.invalid/trailmind" },
      { pool: fakePool() }
    );
    assert.equal(managedRepository.isDurable, true);

    const blankCanonicalRepository = postgresAppAttestRepositoryFromEnvironment(
      {
        DATABASE_URL: "",
        POSTGRES_URL: "postgresql://example.invalid/trailmind"
      },
      { pool: fakePool() }
    );
    assert.equal(blankCanonicalRepository.isDurable, true);

    assert.throws(
      () => postgresAppAttestRepositoryFromEnvironment(
        {
          DATABASE_URL: "https://database.example",
          POSTGRES_URL: "postgresql://example.invalid/trailmind"
        },
        { pool: fakePool() }
      ),
      (error) => error.code === "authorization_unavailable"
    );
  });

  it("selects the durable repository at runtime from POSTGRES_URL", () => {
    const productPool = fakePool();
    const cancellationPool = fakePool();
    const runtime = createAppAttestRuntime({
      env: {
        NODE_ENV: "production",
        POSTGRES_URL: "postgresql://example.invalid/trailmind"
      },
      postgresPool: productPool,
      postgresCancellationPool: cancellationPool
    });
    assert.equal(runtime.repository?.isDurable, true);
    assert.equal(runtime.repository?.pool, productPool);
    assert.equal(
      runtime.repository?.cancellationPool,
      cancellationPool
    );
  });

  it("rejects a cancellation pool that aliases the product pool", () => {
    const pool = fakePool();
    assert.throws(
      () => new PostgresAppAttestRepository({
        pool,
        cancellationPool: pool
      }),
      (error) => error.code === "authorization_unavailable"
    );
  });

  it("uses one checked-out client and always rolls failed transactions back", async () => {
    const calls = [];
    let released = false;
    const client = {
      async query(text) {
        calls.push(text);
        return { rowCount: 0, rows: [] };
      },
      release() { released = true; }
    };
    const repository = new PostgresAppAttestRepository({
      pool: { connect: async () => client, query: async () => ({ rows: [], rowCount: 0 }) }
    });
    await assert.rejects(
      repository.transaction(async () => { throw appAttestError("app_attest_invalid"); }),
      (error) => error.code === "app_attest_invalid"
    );
    assert.deepEqual(calls, ["BEGIN", "ROLLBACK"]);
    assert.equal(released, true);
  });

  it("parameterizes challenge data and hashes the edge identity before storage", async () => {
    const queries = [];
    const client = {
      async query(text, values = []) {
        queries.push({ text, values });
        return { rowCount: 1, rows: [{ reset_at: new Date(Date.now() + 60_000) }] };
      },
      release() {}
    };
    const repository = new PostgresAppAttestRepository({
      pool: { connect: async () => client, query: async () => ({ rows: [], rowCount: 0 }) }
    });
    await repository.createChallenge({
      id: "opaque-challenge",
      purpose: "registration",
      challenge: Buffer.alloc(32, 7),
      expiresAt: Date.now() + 60_000,
      edgeIdentity: "203.0.113.9",
      edgeMaximum: 20,
      edgeWindowMs: 60_000
    });
    assert.equal(queries.length, 4);
    assert.equal(queries[0].text, "BEGIN");
    assert.match(queries[1].text, /INSERT INTO app_attest_rate_windows/);
    assert.match(queries[2].text, /INSERT INTO app_attest_challenges/);
    assert.equal(queries[3].text, "COMMIT");
    assert.equal(queries[1].text.includes("203.0.113.9"), false);
    assert.equal(queries[1].values.includes("203.0.113.9"), false);
    assert.equal(queries[2].text.includes("opaque-challenge"), false);
    assert.equal(queries[2].values[0], "opaque-challenge");
  });

  it("maps a failed counter compare-and-set to replay without weakening it", async () => {
    const responses = [
      { rowCount: 0, rows: [] },
      { rowCount: 1, rows: [{ exists: 1 }] }
    ];
    const repository = new PostgresAppAttestRepository({
      pool: {
        connect: async () => { throw new Error("not used"); },
        query: async () => responses.shift()
      }
    });
    await assert.rejects(
      repository.updateAssertionCounter({
        environment: "production",
        keyIdHash: "hash",
        previousCounter: 3,
        newCounter: 4,
        metadata: { validationCategory: 3, bundleVersion: "1" }
      }),
      (error) => error.code === "app_attest_counter_replayed"
    );
  });

  it("returns fixed aggregate counts after transactional pruning", async () => {
    const calls = [];
    const rowCounts = [2, 3, 5, 7];
    const client = {
      async query(text) {
        calls.push(text);
        if (text === "BEGIN" || text === "COMMIT") return { rowCount: 0, rows: [] };
        return { rowCount: rowCounts.shift(), rows: [] };
      },
      release() {}
    };
    const repository = new PostgresAppAttestRepository({
      pool: { connect: async () => client, query: async () => ({ rows: [], rowCount: 0 }) }
    });
    assert.deepEqual(await repository.pruneExpired(), {
      challenges: 2,
      routeSessions: 3,
      rateWindows: 5,
      providerLeases: 7
    });
    assert.equal(calls[0], "BEGIN");
    assert.match(calls[1], /DELETE FROM app_attest_challenges/);
    assert.match(calls[2], /DELETE FROM app_attest_route_sessions/);
    assert.match(calls[3], /DELETE FROM app_attest_rate_windows/);
    assert.match(calls[4], /DELETE FROM app_attest_provider_leases/);
    assert.equal(calls[5], "COMMIT");
  });

  it("rolls a failed prune back, preserves the failure, and permits a retry", async () => {
    const failure = new Error("synthetic prune failure");
    const failedCalls = [];
    const failedClient = {
      async query(text) {
        failedCalls.push(text);
        if (/DELETE FROM app_attest_route_sessions/.test(text)) throw failure;
        return { rowCount: 1, rows: [] };
      },
      release() {}
    };
    const retryClient = {
      async query(text) {
        return { rowCount: text.startsWith("DELETE") ? 1 : 0, rows: [] };
      },
      release() {}
    };
    let attempts = 0;
    const repository = new PostgresAppAttestRepository({
      pool: {
        connect: async () => (++attempts === 1 ? failedClient : retryClient),
        query: async () => ({ rows: [], rowCount: 0 })
      }
    });
    await assert.rejects(repository.pruneExpired(), (error) => error === failure);
    assert.equal(failedCalls.at(-1), "ROLLBACK");
    assert.deepEqual(await repository.pruneExpired(), {
      challenges: 1,
      routeSessions: 1,
      rateWindows: 1,
      providerLeases: 1
    });
  });
});

function fakePool() {
  return {
    async connect() {
      return { query: async () => ({ rows: [], rowCount: 0 }), release() {} };
    },
    async query() {
      return { rows: [], rowCount: 0 };
    }
  };
}
