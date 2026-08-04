import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { InMemoryAppAttestRepository } from "../src/appAttest/appAttestRepository.js";
import { createRouteSessionAuthorizer } from "../src/appAttest/routeSessionAuthorizer.js";
import { hashOpaqueValue } from "../src/appAttest/clientData.js";

describe("App Attest repository", () => {
  it("consumes challenges once and distinguishes expiry from replay", async () => {
    let now = 1_000;
    const repository = new InMemoryAppAttestRepository({ now: () => now });
    await repository.createChallenge(challengeRecord({ id: "first", expiresAt: 2_000 }));
    assert.deepEqual(
      await repository.consumeChallenge({ id: "first", purpose: "registration" }),
      Buffer.alloc(32, 1)
    );
    await assert.rejects(
      repository.consumeChallenge({ id: "first", purpose: "registration" }),
      (error) => error.code === "app_attest_challenge_reused"
    );

    await repository.createChallenge(challengeRecord({ id: "second", expiresAt: 1_500 }));
    now = 1_501;
    await assert.rejects(
      repository.consumeChallenge({ id: "second", purpose: "registration" }),
      (error) => error.code === "app_attest_challenge_expired"
    );
  });

  it("updates assertion counters with atomic compare-and-set", async () => {
    const repository = new InMemoryAppAttestRepository();
    await registerKey(repository);
    const updates = await Promise.allSettled([
      repository.updateAssertionCounter(counterUpdate(0, 1)),
      repository.updateAssertionCounter(counterUpdate(0, 1))
    ]);
    assert.equal(updates.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(
      updates.find((result) => result.status === "rejected").reason.code,
      "app_attest_counter_replayed"
    );
  });

  it("stores only a route-session token hash", async () => {
    const repository = new InMemoryAppAttestRepository();
    const token = Buffer.alloc(32, 9).toString("base64url");
    const tokenHash = hashOpaqueValue(token);
    await repository.createRouteSession({
      tokenHash,
      installationId: "installation",
      expiresAt: Date.now() + 60_000,
      maximumCost: 12
    });
    assert.equal(repository.sessions.has(tokenHash), true);
    assert.equal(JSON.stringify([...repository.sessions.values()]).includes(token), false);
  });

  it("atomically prevents concurrent requests from overspending a session", async () => {
    const repository = new InMemoryAppAttestRepository();
    const token = Buffer.alloc(32, 4).toString("base64url");
    await repository.createRouteSession({
      tokenHash: hashOpaqueValue(token),
      installationId: "installation",
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

  it("rejects a reused request ID within one session", async () => {
    const repository = new InMemoryAppAttestRepository();
    const token = Buffer.alloc(32, 5).toString("base64url");
    await repository.createRouteSession({
      tokenHash: hashOpaqueValue(token),
      installationId: "installation",
      expiresAt: Date.now() + 60_000,
      maximumCost: 12
    });
    const authorizer = createRouteSessionAuthorizer({
      repository,
      env: { NODE_ENV: "test", ROUTE_PROVIDER_ENABLED: "true" }
    });
    const requestId = randomUUID();
    const headers = {
      authorization: `TrailMindRouteSession ${token}`,
      "x-trailmind-request-id": requestId
    };
    const access = await authorizer.authorize({ cost: 1, headers });
    await access.release();
    await assert.rejects(
      authorizer.authorize({ cost: 1, headers }),
      (error) => error.code === "request_replayed"
    );
  });

  it("fails closed in production when the repository is not durable", async () => {
    const repository = new InMemoryAppAttestRepository();
    const authorizer = createRouteSessionAuthorizer({ repository, env: { NODE_ENV: "production" } });
    await assert.rejects(
      authorizer.authorize({ headers: {}, cost: 1 }),
      (error) => error.code === "authorization_unavailable"
    );
  });
});

function challengeRecord(overrides) {
  return {
    id: "challenge",
    purpose: "registration",
    challenge: Buffer.alloc(32, 1),
    expiresAt: Date.now() + 60_000,
    edgeIdentity: "127.0.0.1",
    edgeMaximum: 20,
    edgeWindowMs: 60_000,
    ...overrides
  };
}

async function registerKey(repository) {
  await repository.registerKey({
    environment: "development",
    keyIdHash: "key-hash",
    installationId: "installation",
    publicKeyPem: "public-key",
    receipt: Buffer.from("receipt"),
    counter: 0,
    validationCategory: 3,
    bundleVersion: "1"
  });
}

function counterUpdate(previousCounter, newCounter) {
  return {
    environment: "development",
    keyIdHash: "key-hash",
    previousCounter,
    newCounter,
    metadata: { validationCategory: 3, bundleVersion: "1" }
  };
}
