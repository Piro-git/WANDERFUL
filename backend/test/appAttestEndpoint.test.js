import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAppAttestEndpoint } from "../src/appAttest/appAttestEndpoint.js";
import { InMemoryAppAttestRepository } from "../src/appAttest/appAttestRepository.js";
import { decodeBase64Url, hashOpaqueValue, sha256 } from "../src/appAttest/clientData.js";

describe("App Attest endpoints", () => {
  it("creates independent 32-byte, one-time, five-minute challenges", async () => {
    const now = 1_000;
    const { endpoint } = fixture({ now: () => now });
    const first = await challenge(endpoint, { purpose: "registration" });
    const second = await challenge(endpoint, { purpose: "registration" });
    assert.equal(decodeBase64Url(first.challenge).length, 32);
    assert.notEqual(first.challenge, second.challenge);
    assert.notEqual(first.challengeId, second.challengeId);
    assert.equal(first.expiresAt, new Date(now + 300_000).toISOString());
  });

  it("registers a key using a consumed challenge and hashed client data", async () => {
    let received;
    const { endpoint } = fixture({
      verifier: fakeVerifier({
        async verifyAttestation(input) {
          received = input;
          return verifiedAttestation();
        }
      })
    });
    const issued = await challenge(endpoint, { purpose: "registration" });
    const result = await endpoint("/api/app-attest/register", {
      challengeId: issued.challengeId,
      keyId: KEY_ID,
      attestationObject: Buffer.from("attestation").toString("base64url")
    }, context());
    assert.deepEqual(result, { statusCode: 200, payload: { registered: true } });
    assert.equal(received.keyId, KEY_ID);
    assert.equal(received.clientDataHash.length, 32);
    assert.deepEqual(received.clientDataHash, sha256(decodeBase64Url(issued.challenge)));

    const replay = await endpoint("/api/app-attest/register", {
      challengeId: issued.challengeId,
      keyId: KEY_ID,
      attestationObject: Buffer.from("attestation").toString("base64url")
    }, context());
    assert.equal(replay.payload.error.code, "app_attest_challenge_reused");
  });

  it("issues an opaque session once and stores only its hash", async () => {
    const { endpoint, repository } = fixture();
    await register(endpoint);
    const issued = await challenge(endpoint, { purpose: "routeSession", keyId: KEY_ID });
    const result = await endpoint("/api/app-attest/route-session", {
      challengeId: issued.challengeId,
      keyId: KEY_ID,
      sessionNonce: Buffer.alloc(32, 3).toString("base64url"),
      assertionObject: Buffer.from("assertion").toString("base64url")
    }, context());
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.remainingCost, 12);
    assert.equal(decodeBase64Url(result.payload.routeSessionToken).length, 32);
    assert.equal(repository.sessions.has(hashOpaqueValue(result.payload.routeSessionToken)), true);
    assert.equal(JSON.stringify([...repository.sessions.values()]).includes(result.payload.routeSessionToken), false);
  });

  it("fails closed in production with an in-memory repository", async () => {
    const repository = new InMemoryAppAttestRepository();
    const endpoint = createAppAttestEndpoint({
      repository,
      verifier: fakeVerifier(),
      env: { NODE_ENV: "production" }
    });
    const result = await endpoint("/api/app-attest/challenge", { purpose: "registration" }, context());
    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.error.code, "authorization_unavailable");
  });
});

const KEY_ID = Buffer.alloc(32, 8).toString("base64");

function fixture(overrides = {}) {
  const repository = overrides.repository ?? new InMemoryAppAttestRepository({ now: overrides.now });
  const endpoint = createAppAttestEndpoint({
    repository,
    verifier: overrides.verifier ?? fakeVerifier(),
    env: { NODE_ENV: "test" },
    now: overrides.now
  });
  return { endpoint, repository };
}

function fakeVerifier(overrides = {}) {
  return {
    configuration: { environment: "development" },
    async verifyAttestation(input) {
      return overrides.verifyAttestation?.(input) ?? verifiedAttestation();
    },
    async verifyAssertion() {
      return { counter: 1, validationCategory: 3, bundleVersion: "1" };
    }
  };
}

function verifiedAttestation() {
  return {
    publicKeyPem: "public-key",
    receipt: Buffer.from("receipt"),
    environment: "development",
    counter: 0,
    validationCategory: 3,
    bundleVersion: "1"
  };
}

async function register(endpoint) {
  const issued = await challenge(endpoint, { purpose: "registration" });
  const result = await endpoint("/api/app-attest/register", {
    challengeId: issued.challengeId,
    keyId: KEY_ID,
    attestationObject: Buffer.from("attestation").toString("base64url")
  }, context());
  assert.equal(result.statusCode, 200);
}

async function challenge(endpoint, body) {
  const result = await endpoint("/api/app-attest/challenge", body, context());
  assert.equal(result.statusCode, 200);
  return result.payload;
}

function context() {
  return { edgeIdentity: "127.0.0.1" };
}
