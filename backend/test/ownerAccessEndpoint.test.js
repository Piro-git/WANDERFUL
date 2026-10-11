import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import test from "node:test";
import {
  canonicalOwnerOrigin, canonicalOwnerSessionClientData, createOwnerAccessEndpoint,
  ownerKeyId, OWNER_CHALLENGE_PATH, OWNER_SESSION_PATH
} from "../src/ownerAccess/ownerAccessEndpoint.js";

const origin = "https://owner.example.com";
const context = { edgeIdentity: "trusted-edge-owner-test" };

function fixture() {
  let clock = 1_800_000_000_000;
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeySPKI = publicKey.export({ format: "der", type: "spki" });
  const keyId = ownerKeyId(publicKeySPKI);
  const key = { publicKeySPKI, installationId: "owner:stable_test_identity" };
  const challenges = new Map();
  const sessions = [];
  let active = true;
  const repository = {
    isDurable: false,
    allowed: true,
    async consumeOwnerOperation() { return this.allowed; },
    async findActiveOwnerKey(input) { return active && input.keyId === keyId ? key : undefined; },
    async createOwnerChallenge(input) {
      if (!active || challenges.has(input.challengeId)) return false;
      challenges.set(input.challengeId, { ...input, consumed: false });
      return true;
    },
    async findOwnerChallenge(input) {
      const value = challenges.get(input.challengeId);
      return value?.keyId === input.keyId ? { ...value } : undefined;
    },
    async exchangeOwnerChallenge(input) {
      const challenge = challenges.get(input.challengeId);
      if (!active || !challenge || challenge.keyId !== input.keyId || challenge.consumed ||
          challenge.expiresAt <= clock || challenge.origin !== input.origin ||
          challenge.installationId !== input.installationId) return false;
      challenge.consumed = true;
      sessions.push(input);
      return true;
    }
  };
  const options = { enabled: true, origin, environment: "test", repository, now: () => clock };
  const endpoint = createOwnerAccessEndpoint(options);
  async function proof(overrides = {}) {
    const response = await endpoint(OWNER_CHALLENGE_PATH, { keyId }, context);
    assert.equal(response.statusCode, 200);
    const { challengeId, challenge } = response.payload;
    const sessionNonce = randomBytes(32);
    const data = canonicalOwnerSessionClientData({ origin, keyId, challengeId,
      challenge: Buffer.from(challenge, "base64url"), sessionNonce, ...overrides });
    return { keyId, challengeId, sessionNonce: sessionNonce.toString("base64url"),
      signature: sign("sha256", data, { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url") };
  }
  return { options, endpoint, keyId, repository, sessions, challenges, proof,
    advance: (ms) => { clock += ms; }, revoke: () => { active = false; } };
}

test("owner access is disabled by default and rejects non-durable deployed storage", async () => {
  const f = fixture();
  for (const overrides of [{ enabled: false }, { enabled: undefined }, { environment: "production" },
    { origin: "https://temporary.trycloudflare.com" }, { repository: {} }]) {
    const endpoint = createOwnerAccessEndpoint({ ...f.options, ...overrides });
    assert.equal((await endpoint(OWNER_CHALLENGE_PATH, { keyId: f.keyId }, context)).statusCode, 503);
  }
});

test("registered owner receives a short-lived opaque session; only token hash persists", async () => {
  const f = fixture();
  const result = await f.endpoint(OWNER_SESSION_PATH, await f.proof(), context);
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.remainingCost, 12);
  assert.equal(Buffer.from(result.payload.routeSessionToken, "base64url").length, 32);
  assert.equal(Date.parse(result.payload.expiresAt), f.options.now() + 120_000);
  assert.equal(f.sessions.length, 1);
  assert.equal(f.sessions[0].installationId, "owner:stable_test_identity");
  assert.equal(f.sessions[0].tokenHash.length, 64);
  assert.ok(!JSON.stringify(f.sessions).includes(result.payload.routeSessionToken));
  assert.equal(result.headers["Cache-Control"], "no-store");
});

test("concurrent replay consumes a challenge exactly once", async () => {
  const f = fixture();
  const proof = await f.proof();
  const responses = await Promise.all(Array.from({ length: 4 }, () => f.endpoint(OWNER_SESSION_PATH, proof, context)));
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 401, 401, 401]);
  assert.equal(f.sessions.length, 1);
});

test("session renewal preserves owner identity and existing session records", async () => {
  const f = fixture();
  const first = await f.endpoint(OWNER_SESSION_PATH, await f.proof(), context);
  f.advance(130_000);
  const second = await f.endpoint(OWNER_SESSION_PATH, await f.proof(), context);
  assert.equal(second.statusCode, 200);
  assert.notEqual(first.payload.routeSessionToken, second.payload.routeSessionToken);
  assert.equal(f.sessions[0].installationId, f.sessions[1].installationId);
});

test("proofs are bound to exact origin, key, challenge, nonce and endpoint purpose", async () => {
  const f = fixture();
  const wrongOrigin = await f.proof({ origin: "https://other.example.com" });
  assert.equal((await f.endpoint(OWNER_SESSION_PATH, wrongOrigin, context)).statusCode, 401);
  const wrongKey = await f.proof({ keyId: randomBytes(32).toString("base64url") });
  assert.equal((await f.endpoint(OWNER_SESSION_PATH, wrongKey, context)).statusCode, 401);
  const wrongNonce = await f.proof();
  wrongNonce.sessionNonce = randomBytes(32).toString("base64url");
  assert.equal((await f.endpoint(OWNER_SESSION_PATH, wrongNonce, context)).statusCode, 401);
  const swapped = await f.proof();
  swapped.challengeId = (await f.proof()).challengeId;
  assert.equal((await f.endpoint(OWNER_SESSION_PATH, swapped, context)).statusCode, 401);
  const input = { origin, keyId: f.keyId, challengeId: randomBytes(24).toString("base64url"),
    challenge: randomBytes(32), sessionNonce: randomBytes(32) };
  const data = canonicalOwnerSessionClientData(input);
  assert.ok(data.includes(Buffer.from(OWNER_SESSION_PATH)));
  assert.ok(data.includes(Buffer.from("wanderful-owner-session-v1")));
  assert.equal(f.sessions.length, 0);
});

test("expired challenge, unknown key, revoked owner and quota block issuance", async () => {
  const f = fixture();
  const proof = await f.proof();
  f.advance(60_000);
  assert.equal((await f.endpoint(OWNER_SESSION_PATH, proof, context)).statusCode, 401);
  assert.equal((await f.endpoint(OWNER_CHALLENGE_PATH, { keyId: randomBytes(32).toString("base64url") }, context)).statusCode, 403);
  f.repository.allowed = false;
  assert.equal((await f.endpoint(OWNER_CHALLENGE_PATH, { keyId: f.keyId }, context)).statusCode, 429);
  f.repository.allowed = true;
  const beforeRevocation = await f.proof();
  f.revoke();
  assert.equal((await f.endpoint(OWNER_SESSION_PATH, beforeRevocation, context)).statusCode, 403);
  assert.equal(f.sessions.length, 0);
});

test("revocation or expiry between verification and atomic exchange denies session", async () => {
  for (const action of ["revoke", "expire"]) {
    const f = fixture();
    const proof = await f.proof();
    const original = f.repository.exchangeOwnerChallenge;
    f.repository.exchangeOwnerChallenge = async (input) => {
      if (action === "revoke") f.revoke(); else f.advance(60_000);
      return original(input);
    };
    assert.equal((await f.endpoint(OWNER_SESSION_PATH, proof, context)).statusCode, 401);
    assert.equal(f.sessions.length, 0);
  }
});

test("malformed requests and repository errors reveal no raw details", async () => {
  const f = fixture();
  const sensitive = "secret-database-and-key-value";
  f.repository.findActiveOwnerKey = async () => { throw new Error(sensitive); };
  for (const body of [null, [], {}, { keyId: f.keyId, extra: sensitive }, { keyId: f.keyId }]) {
    const result = await f.endpoint(OWNER_CHALLENGE_PATH, body, context);
    assert.equal(result.statusCode, 503);
    assert.ok(!JSON.stringify(result).includes(sensitive));
  }
});

test("rejects noncanonical encodings, invalid P256 keys and noncanonical origins", () => {
  for (const value of ["http://owner.example.com", `${origin}/`, `${origin}:443`, `${origin}/path`,
    "https://user:pass@owner.example.com", "https://127.0.0.1", "https://x.ngrok-free.app"]) {
    assert.throws(() => canonicalOwnerOrigin(value));
  }
  assert.equal(canonicalOwnerOrigin(origin), origin);
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
  assert.throws(() => ownerKeyId(publicKey.export({ format: "der", type: "spki" })));
  assert.throws(() => canonicalOwnerSessionClientData({ origin,
    keyId: Buffer.alloc(32, 1).toString("base64url") + "=",
    challengeId: Buffer.alloc(24, 2).toString("base64url"),
    challenge: Buffer.alloc(32, 3), sessionNonce: Buffer.alloc(32, 4) }));
});

test("signing bytes match the public Swift interoperability vector", () => {
  const data = canonicalOwnerSessionClientData({ origin,
    keyId: Buffer.alloc(32, 1).toString("base64url"),
    challengeId: Buffer.alloc(24, 2).toString("base64url"),
    challenge: Buffer.alloc(32, 3), sessionNonce: Buffer.alloc(32, 4) });
  assert.equal(data.length, 257);
  assert.equal(createHash("sha256").update(data).digest("hex"),
    "0c16da272ec832ce7717ec697590deedc911b66548465d1e9703719646e073a1");
});
