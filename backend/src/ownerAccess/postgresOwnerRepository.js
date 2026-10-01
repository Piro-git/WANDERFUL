import { randomUUID } from "node:crypto";
import { hashOpaqueValue } from "../appAttest/clientData.js";
import { appAttestError } from "../appAttest/appAttestErrors.js";

// Serialize the tiny private lane across processes, including revocation and all
// budget windows. This is a database transaction lock, not an in-memory mutex.
const LOCK = "78261642489301";
export class PostgresOwnerRepository {
  isDurable = true;
  constructor({ pool }) {
    if (!pool?.connect || !pool?.query) throw new Error("Owner database unavailable");
    this.pool = pool;
  }
  async transaction(operation) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [LOCK]);
      const value = await operation(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* Pool discards broken clients. */ }
      throw error;
    } finally { client.release(); }
  }
  async findActiveOwnerKey({ keyId }) {
    const r = await activeKey(this.pool, keyId);
    return r ? { installationId: r.installation_id, publicKeySPKI: r.public_key_spki } : undefined;
  }
  async consumeOwnerOperation(input) {
    return this.transaction(async (c) => {
      // Unknown-key cardinality is bounded by the shared global window before any
      // per-edge/key insertion; expired window cleanup belongs to an operator.
      if (!await consumeWindow(c, "auth-global", "global", 40, input.operationWindowMs)) return false;
      if (!await consumeWindow(c, "auth-edge", hashOpaqueValue(input.edgeIdentity), input.edgeMaximum, input.operationWindowMs)) return false;
      return consumeWindow(c, "auth-key", input.keyId, input.ownerMaximum, input.operationWindowMs);
    });
  }
  async createOwnerChallenge(input) {
    return this.transaction(async (c) => {
      const key = await activeKey(c, input.keyId);
      if (key?.installation_id !== input.installationId) return false;
      await c.query(`INSERT INTO wanderful_owner_v1.challenges
        (challenge_id,key_id,installation_id,challenge,origin,expires_at)
        VALUES($1,$2,$3,$4,$5,LEAST(to_timestamp($6/1000.0),clock_timestamp()+interval '60 seconds'))`,
      [input.challengeId,input.keyId,input.installationId,input.challenge,input.origin,input.expiresAt]);
      return true;
    });
  }
  async findOwnerChallenge({ keyId, challengeId }) {
    const { rows } = await this.pool.query(`SELECT *,extract(epoch FROM expires_at)*1000 AS expires_ms
      FROM wanderful_owner_v1.challenges WHERE key_id=$1 AND challenge_id=$2`, [keyId,challengeId]);
    const row = rows[0];
    return row ? { challenge: row.challenge, origin: row.origin, installationId: row.installation_id,
      expiresAt: Number(row.expires_ms), consumed: row.consumed_at !== null } : undefined;
  }
  async exchangeOwnerChallenge(input) {
    return this.transaction(async (c) => {
      const key = await activeKey(c, input.keyId);
      if (key?.installation_id !== input.installationId) return false;
      const { rowCount } = await c.query(`UPDATE wanderful_owner_v1.challenges SET consumed_at=clock_timestamp()
        WHERE challenge_id=$1 AND key_id=$2 AND installation_id=$3 AND origin=$4
        AND consumed_at IS NULL AND expires_at>clock_timestamp()`,
      [input.challengeId,input.keyId,input.installationId,input.origin]);
      if (rowCount !== 1) return false;
      await c.query(`INSERT INTO wanderful_owner_v1.sessions
        (token_hash,key_id,installation_id,expires_at,remaining_cost)
        VALUES($1,$2,$3,LEAST(to_timestamp($4/1000.0),clock_timestamp()+interval '120 seconds'),$5)`,
      [input.tokenHash,input.keyId,input.installationId,input.expiresAt,input.maximumCost]);
      return true;
    });
  }
  async authorizeSession(input) {
    if (!Number.isInteger(input.cost) || input.cost < 1 || input.cost > 12 ||
        !["route","intent"].includes(input.scope)) throw appAttestError("route_session_invalid");
    return this.transaction(async (c) => {
      const session = await activeSession(c,input.tokenHash,true);
      if (!session) throw appAttestError("route_session_invalid");
      if (session.expired) throw appAttestError("route_session_expired");
      const repeated = await c.query(`SELECT 1 FROM wanderful_owner_v1.requests WHERE token_hash=$1 AND request_id=$2`,
        [input.tokenHash,input.requestId]);
      if (repeated.rowCount) throw appAttestError("request_replayed");
      if (session.remaining_cost < input.cost) throw appAttestError("route_session_exhausted");
      const { rows } = await c.query(`SELECT count(*)::int AS count FROM wanderful_owner_v1.leases
        WHERE released_at IS NULL AND expires_at>clock_timestamp()`);
      if (rows[0].count >= input.maximumConcurrency) throw appAttestError("app_attest_rate_limited");
      await c.query(`INSERT INTO wanderful_owner_v1.requests(token_hash,request_id) VALUES($1,$2)`, [input.tokenHash,input.requestId]);
      await c.query(`UPDATE wanderful_owner_v1.sessions SET remaining_cost=remaining_cost-$2 WHERE token_hash=$1`, [input.tokenHash,input.cost]);
      const leaseId = randomUUID();
      await c.query(`INSERT INTO wanderful_owner_v1.leases(lease_id,token_hash,installation_id,scope,expires_at)
        VALUES($1,$2,$3,$4,clock_timestamp()+interval '90 seconds')`,
      [leaseId,input.tokenHash,session.installation_id,input.scope]);
      return { leaseId, installationId: session.installation_id, remainingCost: session.remaining_cost-input.cost };
    });
  }
  async consumeProviderAttempt(input) {
    return this.transaction(async (c) => {
      const session = await activeSession(c,input.tokenHash);
      if (!session) return false;
      const lease = await c.query(`SELECT 1 FROM wanderful_owner_v1.leases WHERE lease_id=$1
        AND token_hash=$2 AND scope=$3 AND released_at IS NULL AND expires_at>clock_timestamp()`,
      [input.leaseId,input.tokenHash,input.scope]);
      if (!lease.rowCount) return false;
      // Reserve every fetch before invoking it. Failed requests are still charged.
      // Check both first so a denied attempt does not partially spend a second cap.
      const windows = [[`${input.scope}-provider-owner`, session.installation_id, input.ownerDailyMaximum],
        [`${input.scope}-provider-global`, "global", input.globalDailyMaximum]];
      for (const [scope,identity,maximum] of windows) {
        if (!await canConsumeWindow(c,scope,identity,maximum)) return false;
      }
      for (const [scope,identity,maximum] of windows) {
        if (!await consumeWindow(c,scope,identity,maximum,86_400_000)) throw new Error("Budget transaction failed");
      }
      return true;
    });
  }
  async releaseLease(leaseId) {
    await this.pool.query(`UPDATE wanderful_owner_v1.leases SET released_at=clock_timestamp()
      WHERE lease_id=$1 AND released_at IS NULL`,[leaseId]);
  }
  // Operator-only pool: runtime role deliberately cannot update owners or keys.
  async revokeOwner(installationId) {
    return this.transaction(async (c) => {
      await c.query(`UPDATE wanderful_owner_v1.owners SET revoked_at=clock_timestamp() WHERE installation_id=$1`,[installationId]);
      await c.query(`UPDATE wanderful_owner_v1.keys SET revoked_at=clock_timestamp() WHERE installation_id=$1`,[installationId]);
      await c.query(`UPDATE wanderful_owner_v1.sessions SET revoked_at=clock_timestamp() WHERE installation_id=$1`,[installationId]);
      await c.query(`UPDATE wanderful_owner_v1.challenges SET consumed_at=clock_timestamp() WHERE installation_id=$1`,[installationId]);
      await c.query(`UPDATE wanderful_owner_v1.leases SET released_at=clock_timestamp() WHERE installation_id=$1`,[installationId]);
    });
  }
  async readiness() {
    const { rows } = await this.pool.query(`SELECT current_user AS role, rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit,rolreplication
      FROM pg_roles WHERE rolname=current_user`);
    const role = rows[0];
    if (!role || role.role !== "wanderful_owner_runtime" || role.rolsuper || role.rolbypassrls ||
        role.rolcreatedb || role.rolcreaterole || role.rolinherit || role.rolreplication) throw new Error("Unsafe owner database role");
    const membership = await this.pool.query("SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user) LIMIT 1");
    if (membership.rowCount) throw new Error("Owner runtime must not inherit or assume other roles");
    const publicAccess=await this.pool.query(`SELECT 1 FROM pg_roles r CROSS JOIN pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE r.rolname IN ('anon','authenticated','service_role') AND n.nspname='wanderful_owner_v1'
      AND c.relkind='r' AND (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_schema_privilege(r.oid,n.oid,'USAGE,CREATE')) LIMIT 1`);
    if(publicAccess.rowCount) throw new Error("Owner tables must not be public Data API tables");
    const tables = await this.pool.query(`SELECT c.relname,c.relrowsecurity,
      pg_get_userbyid(c.relowner)=current_user AS owned,
      has_table_privilege(c.oid,'SELECT') AS sel,has_table_privilege(c.oid,'INSERT') AS ins,
      has_table_privilege(c.oid,'UPDATE') AS upd,has_table_privilege(c.oid,'DELETE') AS del,
      has_table_privilege(c.oid,'TRUNCATE') AS trunc,has_table_privilege(c.oid,'TRIGGER') AS trig,
      has_table_privilege(c.oid,'REFERENCES') AS refs FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='wanderful_owner_v1' AND c.relkind='r'`);
    const expected=["challenges","keys","leases","owners","requests","sessions","windows"];
    if (tables.rows.map((r)=>r.relname).sort().join()!==expected.join() || tables.rows.some((r) =>
      !r.relrowsecurity || r.owned || !r.sel || r.del || r.trunc || r.trig || r.refs ||
      r.ins!==!["keys","owners"].includes(r.relname) || r.upd!==!["keys","owners","requests"].includes(r.relname))) {
      throw new Error("Owner schema unavailable");
    }
    await this.pool.query("SELECT 1 FROM wanderful_owner_v1.owners LIMIT 1");
  }
}
async function activeKey(c,keyId) {
  const { rows } = await c.query(`SELECT k.* FROM wanderful_owner_v1.keys k JOIN wanderful_owner_v1.owners o USING(installation_id)
    WHERE k.key_id=$1 AND k.revoked_at IS NULL AND o.revoked_at IS NULL`,[keyId]);
  return rows[0];
}
async function activeSession(c,hash,includeExpired=false) {
  const { rows } = await c.query(`SELECT s.*,s.expires_at<=clock_timestamp() AS expired FROM wanderful_owner_v1.sessions s
    JOIN wanderful_owner_v1.keys k USING(key_id) JOIN wanderful_owner_v1.owners o ON o.installation_id=s.installation_id
    WHERE token_hash=$1 AND s.revoked_at IS NULL AND k.revoked_at IS NULL AND o.revoked_at IS NULL
    `,[hash]);
  return rows[0] && (includeExpired || !rows[0].expired) ? rows[0] : undefined;
}
async function canConsumeWindow(c,scope,identity,maximum) {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100) throw new Error("Invalid owner budget");
  const { rows } = await c.query(`SELECT cost FROM wanderful_owner_v1.windows
    WHERE scope=$1 AND identity_hash=$2 AND reset_at>clock_timestamp()`,[scope,identity]);
  return !rows[0] || rows[0].cost < maximum;
}
async function consumeWindow(c,scope,identity,maximum,windowMs) {
  if (!await canConsumeWindow(c,scope,identity,maximum)) return false;
  await c.query(`INSERT INTO wanderful_owner_v1.windows(scope,identity_hash,cost,reset_at)
    VALUES($1,$2,1,clock_timestamp()+($3*interval '1 millisecond'))
    ON CONFLICT(scope,identity_hash) DO UPDATE SET
    cost=CASE WHEN wanderful_owner_v1.windows.reset_at<=clock_timestamp() THEN 1 ELSE wanderful_owner_v1.windows.cost+1 END,
    reset_at=CASE WHEN wanderful_owner_v1.windows.reset_at<=clock_timestamp()
      THEN clock_timestamp()+($3*interval '1 millisecond') ELSE wanderful_owner_v1.windows.reset_at END`,[scope,identity,windowMs]);
  return true;
}
