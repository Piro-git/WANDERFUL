import { timingSafeEqual } from "node:crypto";
import {
  outdoorResearchRepositoryQueriesForTesting
} from "../../src/outdoorResearch/postgresOutdoorResearchRepository.js";

const CASE_ID = "case-13-cancel-during-postgis-research";
const APPLICATION_NAME = "trailmind_staging_proof_v1";
const LOCK_RELATION = "public.outdoor_evidence_regions";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PHASES = new Set(["query_active", "cancel_settled"]);
const FACTORY_FIELDS = new Set([
  "productPool",
  "controlPool",
  "caseId",
  "nonceDigest",
  "signal",
  "lockTimeoutMilliseconds",
  "queryTimeoutMilliseconds",
  "pollIntervalMilliseconds",
  "maximumPollAttempts"
]);
const WAIT_FIELDS = new Set([
  "schemaVersion",
  "caseId",
  "nonceDigest",
  "phase"
]);
const LIFECYCLE_EVENTS = new Set([
  "began",
  "query_cancelled_after_abort",
  "rollback_completed_after_cancel"
]);
const SNAPSHOT_QUERY_PREFIX =
  outdoorResearchRepositoryQueriesForTesting.snapshotContext.slice(0, 96);

const ACTIVE_QUERY = `
SELECT activity.pid::integer AS pid
  FROM pg_catalog.pg_stat_activity activity
 WHERE activity.datname = current_database()
   AND activity.application_name = $1
   AND activity.pid <> pg_backend_pid()
   AND activity.state = 'active'
   AND activity.wait_event_type = 'Lock'
   AND activity.wait_event = 'relation'
   AND left(activity.query, length($2)) = $2
 ORDER BY activity.pid`;

export class OutdoorAdventureStagingProofPostgresCancellationGateError
  extends Error {
  constructor(code) {
    super(code);
    this.name =
      "OutdoorAdventureStagingProofPostgresCancellationGateError";
    this.code = code;
  }
}

/**
 * Case-13-only coordination for a disposable proof database.
 *
 * The gate holds an ACCESS EXCLUSIVE lock so the first real, parameterized
 * outdoor-research snapshot query cannot finish between observation and the
 * iOS cancellation. Readiness is accepted only when pg_stat_activity exposes
 * exactly one matching backend that is actively waiting on that relation
 * lock. Cancellation settlement remains authoritative only after the existing
 * repository lifecycle reports both an accepted in-flight query cancellation
 * and its transaction rollback.
 *
 * `controlPool` must be distinct from the product pool. The product pool keeps
 * two slots available for the blocked research query and pg_cancel_backend;
 * the control pool owns the lock/probe connection. This is deliberately
 * fail-closed rather than borrowing one of the cancellation slots.
 */
export async function
createOutdoorAdventureStagingProofPostgresCancellationGateV1(options) {
  validateFactoryOptions(options);
  const lockTimeoutMilliseconds = boundedInteger(
    options.lockTimeoutMilliseconds,
    1_000,
    100,
    5_000
  );
  const queryTimeoutMilliseconds = boundedInteger(
    options.queryTimeoutMilliseconds,
    2_000,
    10,
    5_000
  );
  const pollIntervalMilliseconds = boundedInteger(
    options.pollIntervalMilliseconds,
    10,
    1,
    100
  );
  const maximumPollAttempts = boundedInteger(
    options.maximumPollAttempts,
    250,
    1,
    500
  );

  let client;
  let lockTransactionActive = false;
  let clientReleased = false;
  try {
    client = await boundedOperation(
      () => options.controlPool.connect(),
      {
        signal: options.signal,
        timeoutMilliseconds: queryTimeoutMilliseconds,
        timeoutCode: "postgres_control_connect_timeout",
        onLateResolve(lateClient) {
          try {
            lateClient?.release?.(
              gateError("postgres_control_connect_timeout")
            );
          } catch {}
        }
      }
    );
    await boundedClientQuery(
      client,
      "BEGIN",
      undefined,
      options.signal,
      queryTimeoutMilliseconds
    );
    lockTransactionActive = true;
    await boundedClientQuery(
      client,
      "SELECT set_config('lock_timeout', $1, true)",
      [`${lockTimeoutMilliseconds}ms`],
      options.signal,
      queryTimeoutMilliseconds
    );
    await boundedClientQuery(
      client,
      `LOCK TABLE ${LOCK_RELATION} IN ACCESS EXCLUSIVE MODE`,
      undefined,
      options.signal,
      queryTimeoutMilliseconds
    );
  } catch (error) {
    await releaseLockClient({
      client,
      transactionActive: lockTransactionActive,
      destroyOnFailure: true,
      queryTimeoutMilliseconds
    });
    if (error?.code === "gate_wait_cancelled") throw error;
    throw gateError("postgres_lock_unavailable");
  }

  const expectedNonce = Buffer.from(options.nonceDigest, "hex");
  let state = "armed";
  let transactionBegan = false;
  let activePhaseConsumed = false;
  let settledPhaseConsumed = false;
  let lifecycleFailureCode = null;
  let releasePromise = null;

  const release = async () => {
    if (clientReleased) return true;
    clientReleased = true;
    const released = await releaseLockClient({
      client,
      transactionActive: lockTransactionActive,
      destroyOnFailure: true,
      queryTimeoutMilliseconds
    });
    lockTransactionActive = false;
    return released;
  };

  const failLifecycle = (code) => {
    lifecycleFailureCode ??= code;
    state = "failed";
  };

  const observeTransactionLifecycle = (event) => {
    if (!LIFECYCLE_EVENTS.has(event)) {
      failLifecycle("postgres_cancellation_lifecycle_invalid");
      throw gateError("postgres_cancellation_lifecycle_invalid");
    }
    if (state === "disposed") return;
    if (state === "cancel_settled") {
      failLifecycle("postgres_cancellation_lifecycle_invalid");
      throw gateError("postgres_cancellation_lifecycle_invalid");
    }
    if (event === "began") {
      if (
        transactionBegan ||
        !["armed", "awaiting_query"].includes(state)
      ) {
        failLifecycle("postgres_cancellation_lifecycle_invalid");
        return;
      }
      transactionBegan = true;
      return;
    }
    if (event === "query_cancelled_after_abort") {
      if (!transactionBegan || state !== "query_active") {
        failLifecycle("postgres_cancellation_lifecycle_invalid");
        return;
      }
      state = "query_cancelled";
      return;
    }
    if (state !== "query_cancelled") {
      failLifecycle("postgres_cancellation_lifecycle_invalid");
      return;
    }
    state = "releasing_lock";
    releasePromise = release().then((released) => {
      if (!released) {
        failLifecycle("gate_cleanup_failed");
        return;
      }
      state = "cancel_settled";
    });
  };

  const dispose = async () => {
    if (state === "disposed") return;
    if (releasePromise) await releasePromise;
    const released = await release();
    const finalFailure = lifecycleFailureCode;
    state = "disposed";
    if (finalFailure) throw gateError(finalFailure);
    if (!released) throw gateError("gate_cleanup_failed");
  };

  const wait = async (input, waitOptions = {}) => {
    validateWaitInput(input, waitOptions, expectedNonce);
    if (state === "disposed") throw gateError("gate_disposed");
    if (lifecycleFailureCode) {
      const code = lifecycleFailureCode;
      await dispose();
      throw gateError(code);
    }
    if (input.phase === "query_active") {
      if (activePhaseConsumed) throw gateError("gate_phase_reused");
      if (state !== "armed") throw gateError("gate_phase_out_of_order");
      activePhaseConsumed = true;
      state = "awaiting_query";
      try {
        return await waitForActiveQuery({
          client,
          signal: waitOptions.signal,
          pollIntervalMilliseconds,
          maximumPollAttempts,
          queryTimeoutMilliseconds,
          transactionBegan: () => transactionBegan,
          lifecycleFailureCode: () => lifecycleFailureCode,
          didObserveActive() {
            state = "query_active";
          }
        });
      } catch (error) {
        await dispose();
        throw error;
      }
    }

    if (settledPhaseConsumed) throw gateError("gate_phase_reused");
    if (
      !activePhaseConsumed ||
      ![
        "query_active",
        "query_cancelled",
        "releasing_lock",
        "cancel_settled"
      ].includes(state)
    ) {
      throw gateError("gate_phase_out_of_order");
    }
    settledPhaseConsumed = true;
    try {
      return await waitForCancellationSettlement({
        signal: waitOptions.signal,
        pollIntervalMilliseconds,
        maximumPollAttempts,
        state: () => state,
        lifecycleFailureCode: () => lifecycleFailureCode,
        releasePromise: () => releasePromise
      });
    } catch (error) {
      await dispose();
      throw error;
    }
  };

  return Object.freeze({
    wait,
    observeTransactionLifecycle,
    dispose
  });
}

async function waitForActiveQuery({
  client,
  signal,
  pollIntervalMilliseconds,
  maximumPollAttempts,
  queryTimeoutMilliseconds,
  transactionBegan,
  lifecycleFailureCode,
  didObserveActive
}) {
  for (let attempt = 0; attempt < maximumPollAttempts; attempt += 1) {
    throwIfAborted(signal);
    const lifecycleFailure = lifecycleFailureCode();
    if (lifecycleFailure) throw gateError(lifecycleFailure);
    const result = await boundedClientQuery(
      client,
      ACTIVE_QUERY,
      [APPLICATION_NAME, SNAPSHOT_QUERY_PREFIX],
      signal,
      queryTimeoutMilliseconds
    );
    throwIfAborted(signal);
    const rows = result?.rows;
    if (!Array.isArray(rows)) {
      throw gateError("postgres_query_observation_invalid");
    }
    if (rows.length > 1) {
      throw gateError("postgres_query_ambiguous");
    }
    if (rows.length === 1) {
      if (
        !transactionBegan() ||
        !Number.isInteger(rows[0]?.pid) ||
        rows[0].pid < 1 ||
        Object.keys(rows[0]).length !== 1
      ) {
        throw gateError("postgres_query_observation_invalid");
      }
      throwIfAborted(signal);
      didObserveActive();
      throwIfAborted(signal);
      return Object.freeze({
        schemaVersion: 1,
        state: "query_active"
      });
    }
    if (attempt + 1 < maximumPollAttempts) {
      await delay(pollIntervalMilliseconds, signal);
    }
  }
  throw gateError("postgres_query_not_active");
}

async function waitForCancellationSettlement({
  signal,
  pollIntervalMilliseconds,
  maximumPollAttempts,
  state,
  lifecycleFailureCode,
  releasePromise
}) {
  for (let attempt = 0; attempt < maximumPollAttempts; attempt += 1) {
    throwIfAborted(signal);
    const lifecycleFailure = lifecycleFailureCode();
    if (lifecycleFailure) throw gateError(lifecycleFailure);
    if (state() === "cancel_settled") {
      return Object.freeze({
        schemaVersion: 1,
        state: "cancel_settled"
      });
    }
    const pendingRelease = releasePromise();
    if (pendingRelease) {
      await pendingRelease;
      throwIfAborted(signal);
    }
    const postReleaseFailure = lifecycleFailureCode();
    if (postReleaseFailure) throw gateError(postReleaseFailure);
    if (state() === "cancel_settled") {
      throwIfAborted(signal);
      return Object.freeze({
        schemaVersion: 1,
        state: "cancel_settled"
      });
    }
    if (attempt + 1 < maximumPollAttempts) {
      await delay(pollIntervalMilliseconds, signal);
    }
  }
  throw gateError("postgres_cancellation_not_settled");
}

function boundedClientQuery(
  client,
  text,
  values,
  signal,
  timeoutMilliseconds
) {
  return boundedOperation(
    () => client.query(text, values),
    {
      signal,
      timeoutMilliseconds,
      timeoutCode: "postgres_control_query_timeout"
    }
  );
}

function boundedOperation(
  operation,
  {
    signal,
    timeoutMilliseconds,
    timeoutCode,
    onLateResolve
  }
) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (completion) => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      completion();
      return true;
    };
    const abort = () => finish(
      () => reject(gateError("gate_wait_cancelled"))
    );
    timer = setTimeout(
      () => finish(() => reject(gateError(timeoutCode))),
      timeoutMilliseconds
    );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          if (settled) {
            try {
              onLateResolve?.(value);
            } catch {}
            return;
          }
          finish(() => resolve(value));
        },
        (error) => {
          if (!settled) finish(() => reject(error));
        }
      );
  });
}

async function releaseLockClient({
  client,
  transactionActive,
  destroyOnFailure,
  queryTimeoutMilliseconds = 2_000
}) {
  if (!client) return false;
  let failure = null;
  if (transactionActive) {
    try {
      await boundedClientQuery(
        client,
        "ROLLBACK",
        undefined,
        undefined,
        queryTimeoutMilliseconds
      );
    } catch (error) {
      failure = error;
    }
  }
  try {
    client.release(failure && destroyOnFailure ? failure : undefined);
  } catch (error) {
    failure ??= error;
  }
  return failure === null;
}

function validateFactoryOptions(input) {
  if (
    !allowedObject(
      input,
      FACTORY_FIELDS,
      new Set(["productPool", "controlPool", "caseId", "nonceDigest"])
    ) ||
    !input.productPool?.connect ||
    !input.controlPool?.connect ||
    input.productPool === input.controlPool ||
    !Number.isInteger(input.productPool.options?.max) ||
    input.productPool.options.max < 2 ||
    input.productPool.options?.application_name !== APPLICATION_NAME ||
    !Number.isInteger(input.controlPool.options?.max) ||
    input.controlPool.options.max < 1 ||
    input.caseId !== CASE_ID ||
    !SHA256_PATTERN.test(input.nonceDigest) ||
    !validAbortSignal(input.signal)
  ) {
    throw gateError("invalid_dependencies");
  }
}

function validateWaitInput(input, options, expectedNonce) {
  if (
    !exactObject(input, WAIT_FIELDS) ||
    input.schemaVersion !== 1 ||
    input.caseId !== CASE_ID ||
    !PHASES.has(input.phase) ||
    !SHA256_PATTERN.test(input.nonceDigest) ||
    !sameDigest(input.nonceDigest, expectedNonce) ||
    !allowedObject(options, new Set(["signal"]), new Set()) ||
    (
      options.signal !== undefined &&
      (
        typeof options.signal?.aborted !== "boolean" ||
        typeof options.signal.addEventListener !== "function" ||
        typeof options.signal.removeEventListener !== "function"
      )
    )
  ) {
    throw gateError("invalid_gate_binding");
  }
}

function sameDigest(value, expected) {
  const candidate = Buffer.from(value, "hex");
  return candidate.length === expected.length &&
    timingSafeEqual(candidate, expected);
}

function exactObject(input, fields) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return false;
  }
  const keys = Object.keys(input);
  return keys.length === fields.size &&
    keys.every((key) => fields.has(key)) &&
    [...fields].every((field) => Object.hasOwn(input, field));
}

function allowedObject(input, allowedFields, requiredFields) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return false;
  }
  return Object.keys(input).every((key) => allowedFields.has(key)) &&
    [...requiredFields].every((field) => Object.hasOwn(input, field));
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined) return fallback;
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw gateError("invalid_dependencies");
  }
  return value;
}

function validAbortSignal(signal) {
  return signal === undefined ||
    (
      typeof signal?.aborted === "boolean" &&
      typeof signal.addEventListener === "function" &&
      typeof signal.removeEventListener === "function"
    );
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw gateError("gate_wait_cancelled");
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    let settled = false;
    const complete = (operation) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      operation();
    };
    const abort = () => complete(
      () => reject(gateError("gate_wait_cancelled"))
    );
    const timer = setTimeout(() => complete(resolve), milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function gateError(code) {
  return new OutdoorAdventureStagingProofPostgresCancellationGateError(
    code
  );
}

export const
outdoorAdventureStagingProofPostgresCancellationGateForTesting =
  Object.freeze({
    activeQuery: ACTIVE_QUERY,
    applicationName: APPLICATION_NAME,
    caseId: CASE_ID,
    lockRelation: LOCK_RELATION,
    snapshotQueryPrefix: SNAPSHOT_QUERY_PREFIX
  });
