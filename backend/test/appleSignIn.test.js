import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { createAppleJwksProvider, createAppleSignInEndpoint, verifyAppleIdentityToken } from "../src/accounts/appleSignIn.js";
import { createAccountDataProtector, PostgresAccountSessionRepository, PostgresAppleAccountRepository } from "../src/accounts/postgresAccountRepository.js";

const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = pair.publicKey.export({ format: "jwk" });
Object.assign(jwk, { kid: "fixture", kty: "RSA", alg: "RS256", use: "sig" });
function token(claims, header = { alg: "RS256", kid: "fixture" }) {
  const h = Buffer.from(JSON.stringify(header)).toString("base64url");
  const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), pair.privateKey).toString("base64url")}`;
}
const claims = { iss: "https://appleid.apple.com", aud: "com.trailmind.app", sub: "apple-user", nonce: "nonce", iat: 999, exp: 2_000 };

test("verifies an Apple RS256 ID token, audience, expiry and nonce", async () => {
  const result = await verifyAppleIdentityToken(token(claims), "nonce", ["com.trailmind.app"], { key: async () => jwk }, () => 1_000);
  assert.equal(result.sub, "apple-user");
});

test("rejects ES256 client-secret-style tokens, nonce, expiry, audience and future issue time", async () => {
  const invalid = [["wrong", {}, undefined], ["nonce", { exp: 1 }, undefined], ["nonce", { aud: "other" }, undefined], ["nonce", { iat: 1_301 }, undefined], ["nonce", {}, { alg: "ES256", kid: "fixture" }]];
  for (const [nonce, changed, header] of invalid) {
    await assert.rejects(() => verifyAppleIdentityToken(token({ ...claims, ...changed }, header), nonce, ["com.trailmind.app"], { key: async () => jwk }, () => 1_000));
  }
});

test("JWKS provider accepts only Apple RSA signing keys and refreshes for a rotated kid", async () => {
  let calls = 0;
  const provider = createAppleJwksProvider({ fetchImpl: async () => ({ ok: true, json: async () => ({ keys: [calls++ === 0 ? { ...jwk, kid: "old" } : jwk, { ...jwk, kty: "EC", crv: "P-256" }] }) }) });
  assert.equal((await provider.key("fixture")).kid, "fixture");
  assert.equal(calls, 2);
});

test("account sign-in requires a server code exchange and deletion does not succeed when revocation fails", async () => {
  const accounts = { upsertAppleAccount: async () => ({ id: "account" }), findByID: async () => ({ id: "account", refreshToken: "stored" }), matchesAppleSubject: async () => true, deleteAccountData: async () => assert.fail("must not delete") };
  const sessions = { create: async () => ({ opaqueToken: "session" }), require: async () => ({ id: "session", accountID: "account" }), invalidate: async () => {}, invalidateAll: async () => assert.fail("must not invalidate") };
  assert.throws(() => createAppleSignInEndpoint({ clientIDs: ["com.trailmind.app"], accounts, sessions }));
  const endpoint = createAppleSignInEndpoint({ clientIDs: ["com.trailmind.app"], accounts, sessions, jwks: { key: async () => jwk }, tokenExchange: async () => ({ identityToken: token(claims), refreshToken: "refresh" }), tokenRevoker: async () => { const error = new Error("revocation"); error.code = "apple_revocation_failed"; throw error; }, now: () => 1_000 });
  const result = await endpoint("/api/account/delete", { identityToken: token(claims), nonce: "nonce" }, { headers: { authorization: "Bearer session" } });
  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.error.code, "apple_revocation_failed");
});

test("account protector encrypts sensitive values and uses stable keyed subject hashes", () => {
  const key = Buffer.alloc(32, 7).toString("base64url");
  const protector = createAccountDataProtector({ encryptionKey: key, subjectHashKey: Buffer.alloc(32, 8).toString("base64url") });
  const encrypted = protector.encrypt("refresh-token");
  assert.notEqual(encrypted, "refresh-token");
  assert.equal(protector.decrypt(encrypted), "refresh-token");
  assert.equal(protector.subjectHash("apple-user"), protector.subjectHash("apple-user"));
  assert.notEqual(protector.subjectHash("apple-user"), protector.subjectHash("other-user"));
});

test("durable repositories encrypt tokens, require bearer sessions and remove only account-scoped records", async () => {
  const key = Buffer.alloc(32, 11).toString("base64url"); const protector = createAccountDataProtector({ encryptionKey: key, subjectHashKey: Buffer.alloc(32, 12).toString("base64url") });
  const state = { account: undefined, sessions: new Map(), deletedCloudData: false };
  const query = async (sql, values = []) => {
    if (sql.startsWith("INSERT INTO apple_accounts")) { state.account = { id: values[0], subject: values[1], email: values[2], refresh: values[3] }; return { rows: [{ account_id: values[0] }] }; }
    if (sql.startsWith("SELECT account_id")) return { rows: state.account?.id === values[0] ? [{ account_id: state.account.id, apple_subject_hash: state.account.subject, refresh_token_ciphertext: state.account.refresh }] : [] };
    if (sql.startsWith("INSERT INTO apple_account_sessions")) { state.sessions.set(values[0], { id: values[0], account: values[1], hash: values[2], revoked: false }); return { rows: [] }; }
    if (sql.startsWith("SELECT session_id")) { const session = [...state.sessions.values()].find(item => item.hash === values[0] && !item.revoked); return { rows: session ? [{ session_id: session.id, account_id: session.account }] : [] }; }
    if (sql.startsWith("UPDATE apple_account_sessions SET revoked_at")) { for (const item of state.sessions.values()) if (item.id === values[0] || item.account === values[0]) item.revoked = true; return { rows: [] }; }
    if (sql.startsWith("DELETE FROM apple_accounts")) { if (state.account?.id === values[0]) state.account = undefined; return { rows: [] }; }
    return { rows: [] };
  };
  const pool = { query, connect: async () => ({ query, release() {} }) };
  const accounts = new PostgresAppleAccountRepository({ pool, protector, deleteOwnedCloudData: async (_client, id) => { assert.equal(id, state.account.id); state.deletedCloudData = true; } });
  const sessions = new PostgresAccountSessionRepository({ pool, tokenHashKey: "session-key", now: () => 0 });
  const account = await accounts.upsertAppleAccount({ appleSubject: "apple-user", email: "person@example.invalid", refreshToken: "refresh-secret" });
  assert.notEqual(state.account.refresh, "refresh-secret");
  assert.equal((await accounts.findByID(account.id)).refreshToken, "refresh-secret");
  assert.equal(await accounts.matchesAppleSubject(await accounts.findByID(account.id), "apple-user"), true);
  const token = "a".repeat(43); const session = await sessions.create({ accountID: account.id, opaqueToken: token });
  assert.equal((await sessions.require(`Bearer ${token}`)).accountID, account.id);
  await sessions.invalidate(session.id);
  await assert.rejects(() => sessions.require(`Bearer ${token}`));
  await accounts.deleteAccountData(account.id);
  assert.equal(state.deletedCloudData, true); assert.equal(state.account, undefined);
});
