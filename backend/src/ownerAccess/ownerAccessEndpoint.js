import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { hashOpaqueValue } from "../appAttest/clientData.js";

export const OWNER_CHALLENGE_PATH = "/api/owner-access/challenge";
export const OWNER_SESSION_PATH = "/api/owner-access/route-session";
const LIMITS = Object.freeze({
  challengeTtlMs: 60_000,
  sessionTtlMs: 120_000,
  sessionMaximumCost: 12,
  operationWindowMs: 300_000,
  edgeMaximum: 20,
  ownerMaximum: 10
});

/** An independent personal-device protocol, never an App Attest substitute. */
export function createOwnerAccessEndpoint(options = {}) {
  const repository = options.repository;
  const now = options.now ?? Date.now;
  const random = options.randomBytes ?? randomBytes;
  let origin;
  try { origin = canonicalOwnerOrigin(options.origin); } catch { /* Disabled below. */ }
  const enabled = options.enabled === true && origin && repository &&
    (options.environment === "test" || repository.isDurable === true) &&
    ["findActiveOwnerKey", "consumeOwnerOperation", "createOwnerChallenge",
      "findOwnerChallenge", "exchangeOwnerChallenge"].every((name) => typeof repository[name] === "function");

  return async function ownerAccessEndpoint(path, body, context = {}) {
    if (!enabled) return failure(503, "owner_access_unavailable");
    if (![OWNER_CHALLENGE_PATH, OWNER_SESSION_PATH].includes(path)) return failure(404, "not_found");
    try {
      exactFields(body, path === OWNER_CHALLENGE_PATH
        ? ["keyId"] : ["keyId", "challengeId", "sessionNonce", "signature"]);
      const keyId = bytes(body.keyId, 32).toString("base64url");
      if (typeof context.edgeIdentity !== "string" || !context.edgeIdentity || context.edgeIdentity.length > 256) {
        throw new Error("Missing trusted edge identity");
      }
      // The adapter bounds unknown-key traffic too, before allowlist lookup or crypto.
      if (await repository.consumeOwnerOperation({
        edgeIdentity: context.edgeIdentity, keyId, ...LIMITS
      }) !== true) return failure(429, "owner_access_rate_limited");
      const key = await repository.findActiveOwnerKey({ keyId });
      if (!key) return failure(403, "owner_access_denied");
      const publicKey = ownerPublicKey(key.publicKeySPKI, keyId);
      if (typeof key.installationId !== "string" || !/^owner:[A-Za-z0-9_-]{16,128}$/.test(key.installationId)) {
        throw new Error("Invalid owner identity");
      }
      if (path === OWNER_CHALLENGE_PATH) {
        const challengeId = freshBytes(random, 24).toString("base64url");
        const challenge = freshBytes(random, 32);
        const expiresAt = now() + LIMITS.challengeTtlMs;
        if (await repository.createOwnerChallenge({
          keyId, installationId: key.installationId, challengeId, challenge,
          origin, expiresAt
        }) !== true) return failure(403, "owner_access_denied");
        return success({ challengeId, challenge: challenge.toString("base64url"), expiresAt: iso(expiresAt) });
      }

      const challengeId = bytes(body.challengeId, 24).toString("base64url");
      const sessionNonce = bytes(body.sessionNonce, 32);
      const signature = bytes(body.signature, 64); // CryptoKit ECDSA rawRepresentation (r || s).
      const challenge = await repository.findOwnerChallenge({ keyId, challengeId });
      if (!challenge || challenge.origin !== origin || challenge.expiresAt <= now() ||
          challenge.installationId !== key.installationId || challenge.consumed === true) {
        return failure(401, "owner_access_invalid_proof");
      }
      const clientData = canonicalOwnerSessionClientData({
        origin, keyId, challengeId, challenge: challenge.challenge, sessionNonce
      });
      if (!verify("sha256", clientData, { key: publicKey, dsaEncoding: "ieee-p1363" }, signature)) {
        return failure(401, "owner_access_invalid_proof");
      }
      const token = freshBytes(random, 32).toString("base64url");
      const expiresAt = now() + LIMITS.sessionTtlMs;
      // One transaction: lock active allowlist key + challenge, check expiry using DB
      // time, consume once, insert session. Never reset installation/global budgets.
      const exchanged = await repository.exchangeOwnerChallenge({
        keyId, installationId: key.installationId, challengeId, origin,
        tokenHash: hashOpaqueValue(token), expiresAt,
        maximumCost: LIMITS.sessionMaximumCost
      });
      if (exchanged !== true) return failure(401, "owner_access_invalid_proof");
      return success({ routeSessionToken: token, expiresAt: iso(expiresAt), remainingCost: LIMITS.sessionMaximumCost });
    } catch {
      // Do not return database, provider, key, signature, or request details.
      return failure(503, "owner_access_unavailable");
    }
  };
}

export function canonicalOwnerSessionClientData({ origin, keyId, challengeId, challenge, sessionNonce }) {
  canonicalOwnerOrigin(origin);
  bytes(keyId, 32);
  bytes(challengeId, 24);
  if (!Buffer.isBuffer(challenge) || challenge.length !== 32 ||
      !Buffer.isBuffer(sessionNonce) || sessionNonce.length !== 32) throw new Error("Invalid proof fields");
  const fields = [
    Buffer.from("wanderful-owner-session-v1"), Buffer.from(origin),
    Buffer.from("POST"), Buffer.from(OWNER_SESSION_PATH), Buffer.from(keyId),
    Buffer.from(challengeId), challenge, sessionNonce
  ];
  return Buffer.concat(fields.flatMap((field) => {
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(field.length);
    return [prefix, field];
  }));
}

export function ownerKeyId(publicKeySPKI) {
  const key = createPublicKey({ key: publicKeySPKI, format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("Owner keys must be P-256");
  }
  const canonical = key.export({ format: "der", type: "spki" });
  if (!Buffer.from(publicKeySPKI).equals(canonical)) throw new Error("Noncanonical owner key");
  return createHash("sha256").update(canonical).digest("base64url");
}

export function canonicalOwnerOrigin(value) {
  const url = new URL(value);
  if (typeof value !== "string" || url.origin !== value || url.protocol !== "https:" ||
      url.port || url.username || url.password || !url.hostname.includes(".") ||
      /^(?:\d+\.){3}\d+$/.test(url.hostname) ||
      /(?:^|\.)(?:localhost|local|trycloudflare\.com|ngrok\.io|ngrok-free\.app)$/.test(url.hostname)) {
    throw new Error("A permanent canonical HTTPS origin is required");
  }
  return value;
}

function ownerPublicKey(spki, keyId) {
  if (ownerKeyId(spki) !== keyId) throw new Error("Owner key identity mismatch");
  return createPublicKey({ key: spki, format: "der", type: "spki" });
}
function bytes(value, count) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > count * 2) {
    throw new Error("Invalid encoded field");
  }
  const result = Buffer.from(value, "base64url");
  if (result.length !== count || result.toString("base64url") !== value) throw new Error("Invalid encoded field");
  return result;
}
function freshBytes(random, count) {
  const value = random(count);
  if (!Buffer.isBuffer(value) || value.length !== count) throw new Error("Invalid random source");
  return value;
}
function exactFields(body, fields) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).length !== fields.length || fields.some((name) => !Object.hasOwn(body, name))) {
    throw new Error("Invalid fields");
  }
}
function iso(value) { return new Date(value).toISOString(); }
function success(payload) { return { statusCode: 200, payload, headers: { "Cache-Control": "no-store" } }; }
function failure(statusCode, code) {
  return { statusCode, payload: { error: { code, message: "Owner access could not be verified." } },
    headers: { "Cache-Control": "no-store" } };
}
