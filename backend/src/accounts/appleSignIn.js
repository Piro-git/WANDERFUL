import { createPublicKey, verify, randomBytes } from "node:crypto";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";

/** Verifies only Apple-signed ID tokens; account/session storage is injected. */
export function createAppleSignInEndpoint({
  clientIDs,
  jwks = createAppleJwksProvider(),
  accounts,
  sessions,
  tokenExchange,
  tokenRevoker,
  now = () => Math.floor(Date.now() / 1000)
} = {}) {
  if (!Array.isArray(clientIDs) || !clientIDs.length) throw new Error("Apple client IDs are required.");
  if (!accounts || typeof accounts.matchesAppleSubject !== "function" || !sessions || typeof tokenExchange !== "function" || typeof tokenRevoker !== "function") {
    throw new Error("Durable account/session repositories, token exchange, and token revocation are required.");
  }
  return async function accountEndpoint(path, body, context = {}) {
    try {
      if (path === "/api/account/apple/sign-in") {
        const verified = await verifyAppleIdentityToken(body?.identityToken, body?.nonce, clientIDs, jwks, now);
        // The authorization code is exchanged server-side so its refresh token never reaches iOS.
        const tokens = await tokenExchange({ authorizationCode: requiredString(body?.authorizationCode), nonce: body?.nonce });
        if (typeof tokens?.refreshToken !== "string" || !tokens.refreshToken) throw coded("apple_token_exchange_failed");
        // Bind the code exchange to the same Apple subject. The app-provided ID token
        // alone is not sufficient to mint a durable server session.
        const exchanged = await verifyAppleIdentityToken(tokens.identityToken, body?.nonce, clientIDs, jwks, now);
        if (exchanged.sub !== verified.sub) throw coded("apple_token_exchange_failed");
        const account = await accounts.upsertAppleAccount({ appleSubject: verified.sub, email: verified.email, refreshToken: tokens.refreshToken });
        const session = await sessions.create({ accountID: account.id, opaqueToken: randomBytes(32).toString("base64url") });
        return ok({ sessionToken: session.opaqueToken, accountID: account.id });
      }
      if (path === "/api/account/delete") {
        const session = await sessions.require(context.headers?.authorization);
        // Reauthentication prevents a stolen, long-lived app session from deleting an account.
        const verified = await verifyAppleIdentityToken(body?.identityToken, body?.nonce, clientIDs, jwks, now);
        const account = await accounts.findByID(session.accountID);
        if (!account || !(await accounts.matchesAppleSubject(account, verified.sub))) return fail(403, "reauthentication_failed");
        // A failed revocation must not claim deletion. The caller can retry while local data remains untouched.
        if (account.refreshToken) await tokenRevoker(account.refreshToken);
        await accounts.deleteAccountData(account.id); // owns account record, stored Apple refresh token and app-owned cloud data.
        await sessions.invalidateAll(account.id);
        return ok({ deleted: true });
      }
      if (path === "/api/account/sign-out") {
        const session = await sessions.require(context.headers?.authorization);
        await sessions.invalidate(session.id);
        return ok({ signedOut: true, accountID: session.accountID });
      }
      return fail(404, "not_found");
    } catch (error) {
      return fail(error?.code === "unauthorized" ? 401 : 400, error?.code ?? "invalid_request");
    }
  };
}

export async function verifyAppleIdentityToken(token, expectedNonce, clientIDs, jwks, now = () => Math.floor(Date.now() / 1000)) {
  const [encodedHeader, encodedPayload, encodedSignature, ...rest] = requiredString(token).split(".");
  if (rest.length || !encodedHeader || !encodedPayload || !encodedSignature) throw coded("invalid_identity_token");
  const header = jsonSegment(encodedHeader); const claims = jsonSegment(encodedPayload);
  // Apple publishes RSA signing keys at its JWKS endpoint. ES256 is used for the
  // developer-generated client secret, not for Apple's ID-token signature.
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw coded("invalid_identity_token");
  const key = await jwks.key(header.kid);
  const valid = verify("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedPayload}`), createPublicKey({ key, format: "jwk" }), Buffer.from(encodedSignature, "base64url"));
  const currentTime = now();
  if (!valid || claims.iss !== APPLE_ISSUER || !audienceMatches(claims.aud, clientIDs) || !Number.isFinite(claims.exp) || claims.exp <= currentTime || !Number.isFinite(claims.iat) || claims.iat > currentTime + 300 || typeof claims.sub !== "string" || !claims.sub) throw coded("invalid_identity_token");
  if (!timingSafeEqual(claims.nonce, requiredString(expectedNonce))) throw coded("invalid_nonce");
  return claims;
}

export function createAppleJwksProvider({ fetchImpl = fetch, cacheMilliseconds = 3_600_000, clock = () => Date.now() } = {}) {
  let cached; let expiresAt = 0;
  const load = async () => {
      const response = await fetchImpl(APPLE_JWKS_URL, { headers: { Accept: "application/json" } });
      if (!response.ok) throw coded("apple_keys_unavailable");
      const body = await response.json();
      cached = new Map((body.keys ?? []).filter(key => key.kty === "RSA" && key.alg === "RS256" && key.use === "sig" && typeof key.n === "string" && typeof key.e === "string" && key.kid).map(key => [key.kid, key]));
      expiresAt = clock() + cacheMilliseconds;
  };
  return { async key(kid) {
    if (!cached || clock() >= expiresAt) await load();
    // A rotation can happen before the cache TTL. Refresh once for an unknown kid.
    if (!cached.get(kid)) await load();
    const key = cached.get(kid); if (!key) throw coded("unknown_apple_key"); return key;
  }};
}

export function appleTokenRevoker({ clientID, clientSecret, fetchImpl = fetch } = {}) {
  return async refreshToken => {
    const response = await fetchImpl("https://appleid.apple.com/auth/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientID, client_secret: clientSecret, token: refreshToken, token_type_hint: "refresh_token" }) });
    if (!response.ok) throw coded("apple_revocation_failed");
  };
}

/** Exchanges a one-time authorization code only on the server. `clientSecret`
 * is the server-generated ES256 developer JWT; it is never an Apple ID token. */
export function appleAuthorizationCodeExchanger({ clientID, clientSecret, fetchImpl = fetch } = {}) {
  if (typeof clientID !== "string" || !clientID || typeof clientSecret !== "string" || !clientSecret) {
    throw new Error("Apple client ID and server-generated client secret are required.");
  }
  return async ({ authorizationCode }) => {
    const response = await fetchImpl("https://appleid.apple.com/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: clientID, client_secret: clientSecret, code: requiredString(authorizationCode), grant_type: "authorization_code" })
    });
    if (!response.ok) throw coded("apple_token_exchange_failed");
    const result = await response.json();
    if (typeof result?.id_token !== "string" || typeof result?.refresh_token !== "string") throw coded("apple_token_exchange_failed");
    return { identityToken: result.id_token, refreshToken: result.refresh_token };
  };
}

function audienceMatches(aud, accepted) { return (Array.isArray(aud) ? aud : [aud]).some(value => accepted.includes(value)); }
function jsonSegment(value) { try { return JSON.parse(Buffer.from(value, "base64url").toString("utf8")); } catch { throw coded("invalid_identity_token"); } }
function requiredString(value) { if (typeof value !== "string" || !value || value.length > 16_384) throw coded("invalid_request"); return value; }
function timingSafeEqual(a, b) { if (typeof a !== "string" || a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
function coded(code) { const error = new Error(code); error.code = code; return error; }
function ok(payload) { return { statusCode: 200, payload }; }
function fail(statusCode, code) { return { statusCode, payload: { error: { code } } }; }
