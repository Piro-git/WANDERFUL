import { randomUUID } from "node:crypto";
import pg from "pg";
import { appAttestError } from "./appAttestErrors.js";
import { hashOpaqueValue } from "./clientData.js";
import { AppAttestRepository } from "./appAttestRepository.js";

const { Pool } = pg;

export class PostgresAppAttestRepository extends AppAttestRepository {
  isDurable = true;

  constructor(options = {}) {
    super();
    if (!options.pool?.connect || !options.pool?.query) unavailable();
    if (
      options.cancellationPool !== undefined &&
      (
        !options.cancellationPool?.connect ||
        options.cancellationPool === options.pool
      )
    ) {
      unavailable();
    }
    this.pool = options.pool;
    this.cancellationPool = options.cancellationPool;
  }

  async createChallenge(record) {
    await this.transaction(async (client) => {
      await consumeRateWindow(client, {
        scope: "challenge-edge",
        identityHash: hashOpaqueValue(record.edgeIdentity),
        cost: 1,
        maximumCost: record.edgeMaximum,
        windowMs: record.edgeWindowMs
      });
      try {
        await client.query(
          `INSERT INTO app_attest_challenges
             (challenge_id, purpose, challenge, key_id_hash, expires_at)
           VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0))`,
          [record.id, record.purpose, record.challenge, record.keyIdHash ?? null, record.expiresAt]
        );
      } catch (error) {
        if (isUniqueViolation(error)) unavailable();
        throw error;
      }
    });
  }

  async consumeChallenge({ id, purpose, keyIdHash }) {
    const outcome = await this.transaction(async (client) => {
      const result = await client.query(
        `SELECT challenge, purpose, key_id_hash, expires_at, consumed_at,
                expires_at <= clock_timestamp() AS expired
           FROM app_attest_challenges
          WHERE challenge_id = $1
          FOR UPDATE`,
        [id]
      );
      const challenge = result.rows[0];
      if (!challenge || challenge.purpose !== purpose) return { error: "invalid" };
      if (challenge.consumed_at) return { error: "reused" };
      if (challenge.key_id_hash !== null && challenge.key_id_hash !== keyIdHash) {
        await markChallengeConsumed(client, id);
        return { error: "invalid" };
      }
      if (challenge.expired) {
        await markChallengeConsumed(client, id);
        return { error: "expired" };
      }
      await markChallengeConsumed(client, id);
      return { challenge: Buffer.from(challenge.challenge) };
    });
    if (outcome.error === "reused") throw appAttestError("app_attest_challenge_reused");
    if (outcome.error === "expired") throw appAttestError("app_attest_challenge_expired");
    if (outcome.error) throw appAttestError("app_attest_invalid");
    return outcome.challenge;
  }

  async consumeRegistrationAttempt(input) {
    await this.consumeOperationAttempt("registration", input);
  }

  async consumeRouteSessionAttempt(input) {
    await this.consumeOperationAttempt("route-session", input);
  }

  async registerKey(record) {
    try {
      await this.pool.query(
        `INSERT INTO app_attest_keys
           (environment, key_id_hash, installation_id, public_key_pem, receipt,
            assertion_counter, validation_category, bundle_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          record.environment,
          record.keyIdHash,
          record.installationId,
          record.publicKeyPem,
          record.receipt,
          record.counter,
          record.validationCategory,
          record.bundleVersion
        ]
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw appAttestError("app_attest_invalid");
      throw error;
    }
  }

  async findRegisteredKey({ environment, keyIdHash }) {
    const result = await this.pool.query(
      `SELECT environment, key_id_hash, installation_id, public_key_pem, receipt,
              assertion_counter, validation_category, bundle_version,
              created_at, updated_at
         FROM app_attest_keys
        WHERE environment = $1 AND key_id_hash = $2`,
      [environment, keyIdHash]
    );
    const row = result.rows[0];
    if (!row) throw appAttestError("app_attest_not_registered");
    return registeredKey(row);
  }

  async updateAssertionCounter({
    environment,
    keyIdHash,
    previousCounter,
    newCounter,
    metadata
  }) {
    const result = await this.pool.query(
      `UPDATE app_attest_keys
          SET assertion_counter = $4,
              validation_category = $5,
              bundle_version = $6,
              updated_at = clock_timestamp()
        WHERE environment = $1
          AND key_id_hash = $2
          AND assertion_counter = $3
          AND $4 > assertion_counter
      RETURNING key_id_hash`,
      [
        environment,
        keyIdHash,
        previousCounter,
        newCounter,
        metadata.validationCategory,
        metadata.bundleVersion
      ]
    );
    if (result.rowCount === 1) return;
    const exists = await this.pool.query(
      "SELECT 1 FROM app_attest_keys WHERE environment = $1 AND key_id_hash = $2",
      [environment, keyIdHash]
    );
    if (exists.rowCount === 0) throw appAttestError("app_attest_not_registered");
    throw appAttestError("app_attest_counter_replayed");
  }

  async createRouteSession(record) {
    try {
      await this.pool.query(
        `INSERT INTO app_attest_route_sessions
           (token_hash, installation_id, expires_at, remaining_cost)
         VALUES ($1, $2, to_timestamp($3 / 1000.0), $4)`,
        [record.tokenHash, record.installationId, record.expiresAt, record.maximumCost]
      );
    } catch (error) {
      if (isUniqueViolation(error)) unavailable();
      throw error;
    }
  }

  async consumeRouteAccess(input) {
    if (!input.providerEnabled) unavailable();
    const scope = input.scope === "intent" ? "intent" : "route";
    const outcome = await this.transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`trailmind-app-attest:${scope}`]
      );
      const sessionResult = await client.query(
        `SELECT installation_id, expires_at, remaining_cost, revoked_at,
                expires_at <= clock_timestamp() AS expired
           FROM app_attest_route_sessions
          WHERE token_hash = $1
          FOR UPDATE`,
        [input.tokenHash]
      );
      const session = sessionResult.rows[0];
      if (!session) return { error: "invalid" };
      if (session.expired) return { error: "expired" };
      if (session.revoked_at) return { error: "exhausted" };
      if (!Number.isInteger(input.cost) || input.cost < 1 || session.remaining_cost < input.cost) {
        await client.query(
          "UPDATE app_attest_route_sessions SET revoked_at = clock_timestamp() WHERE token_hash = $1",
          [input.tokenHash]
        );
        return { error: "exhausted" };
      }

      try {
        await client.query(
          `INSERT INTO app_attest_request_ids (token_hash, request_id)
           VALUES ($1, $2)`,
          [input.tokenHash, input.requestId]
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw appAttestError("request_replayed");
        throw error;
      }

      const activeResult = await client.query(
        `SELECT count(*)::integer AS active_count
           FROM app_attest_provider_leases
          WHERE scope = $1 AND released_at IS NULL AND expires_at > clock_timestamp()`,
        [scope]
      );
      if (activeResult.rows[0].active_count >= input.globalMaximumConcurrency) {
        throw appAttestError("app_attest_rate_limited", { retryAfterSeconds: 1 });
      }

      await consumeRateWindow(client, {
        scope: `${scope}-installation`,
        identityHash: session.installation_id,
        cost: input.cost,
        maximumCost: input.installationMaximumCost,
        windowMs: input.installationWindowMs
      });
      await consumeRateWindow(client, {
        scope: `${scope}-provider`,
        identityHash: "global",
        cost: input.cost,
        maximumCost: input.globalMaximumCost,
        windowMs: input.globalWindowMs
      });

      const remainingCost = session.remaining_cost - input.cost;
      await client.query(
        `UPDATE app_attest_route_sessions
            SET remaining_cost = $2,
                revoked_at = CASE WHEN $2 = 0 THEN clock_timestamp() ELSE revoked_at END
          WHERE token_hash = $1`,
        [input.tokenHash, remainingCost]
      );
      const leaseId = randomUUID();
      await client.query(
        `INSERT INTO app_attest_provider_leases (lease_id, scope, expires_at)
         VALUES ($1, $2, clock_timestamp() + ($3::double precision * interval '1 millisecond'))`,
        [leaseId, scope, input.leaseTtlMs]
      );
      return {
        installationId: session.installation_id,
        remainingCost,
        leaseId
      };
    });
    if (outcome.error === "invalid") throw appAttestError("route_session_invalid");
    if (outcome.error === "expired") throw appAttestError("route_session_expired");
    if (outcome.error === "exhausted") throw appAttestError("route_session_exhausted");
    return outcome;
  }

  async releaseRouteLease(leaseId) {
    await this.pool.query(
      `UPDATE app_attest_provider_leases
          SET released_at = COALESCE(released_at, clock_timestamp())
        WHERE lease_id = $1`,
      [leaseId]
    );
  }

  async pruneExpired() {
    return this.transaction(async (client) => {
      const challenges = await client.query(
        `DELETE FROM app_attest_challenges
          WHERE expires_at < clock_timestamp() - interval '10 minutes'`
      );
      const routeSessions = await client.query(
        `DELETE FROM app_attest_route_sessions
          WHERE expires_at < clock_timestamp() - interval '10 minutes'`
      );
      const rateWindows = await client.query(
        "DELETE FROM app_attest_rate_windows WHERE reset_at < clock_timestamp()"
      );
      const providerLeases = await client.query(
        `DELETE FROM app_attest_provider_leases
          WHERE expires_at < clock_timestamp() - interval '10 minutes'
             OR released_at < clock_timestamp() - interval '10 minutes'`
      );
      return {
        challenges: challenges.rowCount,
        routeSessions: routeSessions.rowCount,
        rateWindows: rateWindows.rowCount,
        providerLeases: providerLeases.rowCount
      };
    });
  }

  async consumeOperationAttempt(operation, input) {
    await this.transaction(async (client) => {
      await consumeRateWindow(client, {
        scope: `${operation}-edge`,
        identityHash: hashOpaqueValue(input.edgeIdentity),
        cost: 1,
        maximumCost: input.edgeMaximum,
        windowMs: input.windowMs
      });
      await consumeRateWindow(client, {
        scope: `${operation}-key`,
        identityHash: input.keyIdHash,
        cost: 1,
        maximumCost: input.keyMaximum,
        windowMs: input.windowMs
      });
    });
  }

  async transaction(operation) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original failure and never include connection details.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

export function postgresAppAttestRepositoryFromEnvironment(env = process.env, options = {}) {
  const connectionString = requiredPostgresURL(configuredPostgresURL(env));
  if (!connectionString) return undefined;
  const connectionTimeoutMillis = integer(
    env.DATABASE_CONNECT_TIMEOUT_MS,
    5_000,
    500,
    30_000
  );
  const idleTimeoutMillis = integer(
    env.DATABASE_IDLE_TIMEOUT_MS,
    30_000,
    1_000,
    300_000
  );
  const statementTimeoutMillis = integer(
    env.APP_ATTEST_DATABASE_STATEMENT_TIMEOUT_MS,
    5_000,
    500,
    30_000
  );
  const idleTransactionTimeoutMillis = integer(
    env.APP_ATTEST_DATABASE_IDLE_TRANSACTION_TIMEOUT_MS,
    10_000,
    1_000,
    60_000
  );
  if (idleTransactionTimeoutMillis < statementTimeoutMillis) unavailable();
  const pool = options.pool ?? new Pool({
    connectionString,
    max: integer(env.DATABASE_POOL_MAX, 4, 1, 20),
    connectionTimeoutMillis,
    idleTimeoutMillis,
    query_timeout: statementTimeoutMillis,
    statement_timeout: statementTimeoutMillis,
    idle_in_transaction_session_timeout: idleTransactionTimeoutMillis,
    allowExitOnIdle: true
  });
  const cancellationPool = options.cancellationPool ??
    (options.pool ? undefined : new Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: Math.min(connectionTimeoutMillis, 1_000),
      idleTimeoutMillis,
      query_timeout: 1_000,
      statement_timeout: 1_000,
      idle_in_transaction_session_timeout: idleTransactionTimeoutMillis,
      allowExitOnIdle: true
    }));
  return new PostgresAppAttestRepository({
    pool,
    cancellationPool
  });
}

function configuredPostgresURL(env) {
  if (
    env.APP_ATTEST_DATABASE_URL !== undefined &&
    env.APP_ATTEST_DATABASE_URL !== ""
  ) {
    return env.APP_ATTEST_DATABASE_URL;
  }
  if (env.DATABASE_URL !== undefined && env.DATABASE_URL !== "") return env.DATABASE_URL;
  return env.POSTGRES_URL;
}

async function consumeRateWindow(client, input) {
  if (
    !Number.isInteger(input.cost) || input.cost < 1 ||
    !Number.isInteger(input.maximumCost) || input.maximumCost < input.cost ||
    !Number.isInteger(input.windowMs) || input.windowMs < 1
  ) unavailable();
  const result = await client.query(
    `INSERT INTO app_attest_rate_windows (scope, identity_hash, cost, reset_at)
     VALUES ($1, $2, $3, clock_timestamp() + ($5::double precision * interval '1 millisecond'))
     ON CONFLICT (scope, identity_hash) DO UPDATE
       SET cost = CASE
             WHEN app_attest_rate_windows.reset_at <= clock_timestamp() THEN EXCLUDED.cost
             ELSE app_attest_rate_windows.cost + EXCLUDED.cost
           END,
           reset_at = CASE
             WHEN app_attest_rate_windows.reset_at <= clock_timestamp()
               THEN clock_timestamp() + ($5::double precision * interval '1 millisecond')
             ELSE app_attest_rate_windows.reset_at
           END
     WHERE CASE
             WHEN app_attest_rate_windows.reset_at <= clock_timestamp() THEN EXCLUDED.cost
             ELSE app_attest_rate_windows.cost + EXCLUDED.cost
           END <= $4
     RETURNING reset_at`,
    [input.scope, input.identityHash, input.cost, input.maximumCost, input.windowMs]
  );
  if (result.rowCount === 1) return;
  const existing = await client.query(
    `SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (reset_at - clock_timestamp()))))::integer
            AS retry_after_seconds
       FROM app_attest_rate_windows
      WHERE scope = $1 AND identity_hash = $2`,
    [input.scope, input.identityHash]
  );
  throw appAttestError("app_attest_rate_limited", {
    retryAfterSeconds: existing.rows[0]?.retry_after_seconds ?? 1
  });
}

async function markChallengeConsumed(client, id) {
  await client.query(
    "UPDATE app_attest_challenges SET consumed_at = clock_timestamp() WHERE challenge_id = $1",
    [id]
  );
}

function registeredKey(row) {
  return {
    environment: row.environment,
    keyIdHash: row.key_id_hash,
    installationId: row.installation_id,
    publicKeyPem: row.public_key_pem,
    receipt: Buffer.from(row.receipt),
    counter: Number(row.assertion_counter),
    validationCategory: row.validation_category,
    bundleVersion: row.bundle_version,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime()
  };
}

function requiredPostgresURL(value) {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.length > 8_192 || /\s/.test(value)) unavailable();
  let url;
  try {
    url = new URL(value);
  } catch {
    unavailable();
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") unavailable();
  return value;
}

function integer(value, fallback, minimum, maximum) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) unavailable();
  return number;
}

function isUniqueViolation(error) {
  return error?.code === "23505";
}

function unavailable() {
  throw appAttestError("authorization_unavailable");
}
