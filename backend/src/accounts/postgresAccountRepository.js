import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

/** Durable account/session implementation. All secrets are transformed before SQL. */
export class PostgresAppleAccountRepository {
  isDurable = true;
  constructor({ pool, protector, deleteOwnedCloudData = async () => {} } = {}) {
    if (!pool?.connect || !pool?.query || !protector) throw new Error("A PostgreSQL pool and account protector are required.");
    this.pool = pool; this.protector = protector; this.deleteOwnedCloudData = deleteOwnedCloudData;
  }
  async upsertAppleAccount({ appleSubject, email, refreshToken }) {
    const subjectHash = this.protector.subjectHash(required(appleSubject));
    const token = this.protector.encrypt(required(refreshToken));
    const encryptedEmail = typeof email === "string" && email ? this.protector.encrypt(email) : null;
    const result = await this.pool.query(
      `INSERT INTO apple_accounts (account_id, apple_subject_hash, email_ciphertext, refresh_token_ciphertext)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (apple_subject_hash) DO UPDATE SET
         email_ciphertext = COALESCE(EXCLUDED.email_ciphertext, apple_accounts.email_ciphertext),
         refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext, updated_at = clock_timestamp()
       RETURNING account_id`, [randomUUID(), subjectHash, encryptedEmail, token]);
    return { id: result.rows[0].account_id };
  }
  async findByID(accountID) {
    const result = await this.pool.query(`SELECT account_id, apple_subject_hash, refresh_token_ciphertext FROM apple_accounts WHERE account_id = $1`, [required(accountID)]);
    const row = result.rows[0];
    return row ? { id: row.account_id, appleSubjectHash: row.apple_subject_hash, refreshToken: this.protector.decrypt(row.refresh_token_ciphertext) } : null;
  }
  async matchesAppleSubject(account, appleSubject) {
    return Boolean(account) && timingSafeStringEqual(account.appleSubjectHash, this.protector.subjectHash(required(appleSubject)));
  }
  async deleteAccountData(accountID) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.deleteOwnedCloudData(client, accountID);
      await client.query("DELETE FROM apple_accounts WHERE account_id = $1", [required(accountID)]);
      await client.query("COMMIT");
    } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; }
    finally { client.release(); }
  }
}

export class PostgresAccountSessionRepository {
  isDurable = true;
  constructor({ pool, tokenHashKey, now = () => Date.now() } = {}) { if (!pool?.query || !tokenHashKey) throw new Error("A PostgreSQL pool and session hash key are required."); this.pool = pool; this.tokenHashKey = tokenHashKey; this.now = now; }
  async create({ accountID, opaqueToken }) {
    const token = required(opaqueToken); const id = randomUUID();
    await this.pool.query(`INSERT INTO apple_account_sessions (session_id, account_id, token_hash, expires_at) VALUES ($1, $2, $3, to_timestamp($4))`, [id, required(accountID), keyedHash(token, this.tokenHashKey), this.now() / 1000 + TOKEN_TTL_SECONDS]);
    return { id, opaqueToken: token };
  }
  async require(authorization) {
    const token = bearerToken(authorization); const result = await this.pool.query(
      `SELECT session_id, account_id FROM apple_account_sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > clock_timestamp()`, [keyedHash(token, this.tokenHashKey)]);
    if (!result.rows[0]) throw coded("unauthorized");
    return { id: result.rows[0].session_id, accountID: result.rows[0].account_id };
  }
  async invalidate(id) { await this.pool.query("UPDATE apple_account_sessions SET revoked_at = clock_timestamp() WHERE session_id = $1", [required(id)]); }
  async invalidateAll(accountID) { await this.pool.query("UPDATE apple_account_sessions SET revoked_at = clock_timestamp() WHERE account_id = $1 AND revoked_at IS NULL", [required(accountID)]); }
}

export function createAccountDataProtector({ encryptionKey, subjectHashKey } = {}) {
  const key = decodeKey(encryptionKey); const subjectKey = decodeKey(subjectHashKey);
  return Object.freeze({
    subjectHash: value => createHmac("sha256", subjectKey).update(value).digest("base64url"),
    encrypt(value) { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv); const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`; },
    decrypt(value) { const [version, iv, tag, ciphertext, ...rest] = String(value).split("."); if (version !== "v1" || rest.length) throw coded("account_data_unavailable"); const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url")); decipher.setAuthTag(Buffer.from(tag, "base64url")); return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8"); }
  });
}
function decodeKey(value) { const key = Buffer.from(String(value ?? ""), "base64url"); if (key.length !== 32) throw new Error("Account key must be a 32-byte base64url value."); return key; }
function keyedHash(value, key) { return createHmac("sha256", key).update(value).digest("base64url"); }
function bearerToken(value) { const match = /^Bearer ([A-Za-z0-9_-]{43,})$/.exec(value ?? ""); if (!match) throw coded("unauthorized"); return match[1]; }
function required(value) { if (typeof value !== "string" || !value || value.length > 16_384) throw coded("invalid_request"); return value; }
function timingSafeStringEqual(left, right) { if (left.length !== right.length) return false; let result = 0; for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index); return result === 0; }
function coded(code) { const error = new Error(code); error.code = code; return error; }
