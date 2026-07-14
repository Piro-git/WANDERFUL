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
    const repository = postgresAppAttestRepositoryFromEnvironment(
      { DATABASE_URL: "postgresql://example.invalid/trailmind" },
      { pool: fakePool() }
    );
    assert.equal(repository.isDurable, true);

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
    const runtime = createAppAttestRuntime({
      env: {
        NODE_ENV: "production",
        POSTGRES_URL: "postgresql://example.invalid/trailmind"
      },
      postgresPool: fakePool()
    });
    assert.equal(runtime.repository?.isDurable, true);
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
