import { appleAuthorizationCodeExchanger, appleTokenRevoker, createAppleSignInEndpoint } from "./appleSignIn.js";
import { createAccountDataProtector, PostgresAccountSessionRepository, PostgresAppleAccountRepository } from "./postgresAccountRepository.js";

/** Builds the optional account lane only when every production dependency exists.
 * Callers must pass the existing least-privilege PostgreSQL pool; no fallback file
 * or in-memory store exists. */
export function createAppleAccountRuntime({ env = process.env, pool, deleteOwnedCloudData } = {}) {
  if (env.APPLE_ACCOUNT_ENABLED !== "true") return undefined;
  const clientIDs = requiredList(env.APPLE_ACCOUNT_CLIENT_IDS);
  const clientID = required(env.APPLE_ACCOUNT_CLIENT_ID);
  if (!clientIDs.includes(clientID)) throw new Error("Apple account client ID is not an accepted audience.");
  const protector = createAccountDataProtector({ encryptionKey: env.APPLE_ACCOUNT_ENCRYPTION_KEY, subjectHashKey: env.APPLE_ACCOUNT_SUBJECT_HASH_KEY });
  const accounts = new PostgresAppleAccountRepository({ pool, protector, deleteOwnedCloudData });
  const sessions = new PostgresAccountSessionRepository({ pool, tokenHashKey: env.APPLE_ACCOUNT_SESSION_HASH_KEY });
  const clientSecret = required(env.APPLE_ACCOUNT_CLIENT_SECRET);
  return Object.freeze({ endpoint: createAppleSignInEndpoint({ clientIDs, accounts, sessions, tokenExchange: appleAuthorizationCodeExchanger({ clientID, clientSecret }), tokenRevoker: appleTokenRevoker({ clientID, clientSecret }) }), accounts, sessions });
}
function required(value) { if (typeof value !== "string" || !value.trim()) throw new Error("Apple account configuration is incomplete."); return value; }
function requiredList(value) { const result = required(value).split(",").map(item => item.trim()).filter(Boolean); if (!result.length || new Set(result).size !== result.length) throw new Error("Apple account audiences are invalid."); return result; }
