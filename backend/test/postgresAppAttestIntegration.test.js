import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { PostgresAppAttestRepository } from "../src/appAttest/postgresAppAttestRepository.js";
import { createRouteSessionAuthorizer } from "../src/appAttest/routeSessionAuthorizer.js";
import { hashOpaqueValue } from "../src/appAttest/clientData.js";

const connectionString = process.env.TRAILMIND_TEST_DATABASE_URL;

describe("PostgreSQL App Attest integration", { skip: !connectionString }, () => {
  const { Pool } = pg;
  let pool;
  let repository;

  before(async () => {
    pool = new Pool({ connectionString, max: 8, allowExitOnIdle: true });
    const migration = await readFile(
      new URL("../migrations/001_app_attest.sql", import.meta.url),
      "utf8"
    );
    await pool.query(migration);
    repository = new PostgresAppAttestRepository({ pool });
  });

  after(async () => {
    if (!pool) return;
    await pool.query("DELETE FROM app_attest_provider_leases");
    await pool.query("DELETE FROM app_attest_rate_windows");
    await pool.query("DELETE FROM app_attest_route_sessions");
    await pool.query("DELETE FROM app_attest_keys");
    await pool.query("DELETE FROM app_attest_challenges");
    await pool.end();
  });

  it("enforces one-time challenges and atomic counters", async () => {
    const suffix = randomUUID();
    await repository.createChallenge({
      id: `challenge-${suffix}`,
      purpose: "registration",
      challenge: Buffer.alloc(32, 4),
      expiresAt: Date.now() + 60_000,
      edgeIdentity: `edge-${suffix}`,
      edgeMaximum: 20,
      edgeWindowMs: 60_000
    });
    assert.deepEqual(
      await repository.consumeChallenge({ id: `challenge-${suffix}`, purpose: "registration" }),
      Buffer.alloc(32, 4)
    );
    await assert.rejects(
      repository.consumeChallenge({ id: `challenge-${suffix}`, purpose: "registration" }),
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

  it("prevents concurrent session-budget overspending", async () => {
    const token = randomBytes(32).toString("base64url");
    await repository.createRouteSession({
      tokenHash: hashOpaqueValue(token),
      installationId: `installation-${randomUUID()}`,
      expiresAt: Date.now() + 60_000,
      maximumCost: 6
    });
    const authorizer = createRouteSessionAuthorizer({ repository, env: { NODE_ENV: "test" } });
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
});
