import pg from "pg";
import { createAppAttestRuntime } from "../appAttest/appAttestRuntime.js";
import { PostgresAppAttestRepository } from "../appAttest/postgresAppAttestRepository.js";
import { createIntentServer } from "../server.js";
import { createOperationalLogger } from "./operationalEvents.js";
import {
  appAttestDatabaseConfiguration,
  assertProductionConfiguration,
  evidenceDatabaseConfiguration,
  flagEnabled,
  httpServerConfiguration,
  researchDatabaseConfiguration
} from "./productionConfiguration.js";

const { Pool } = pg;
const APP_ATTEST_RUNTIME_ADMISSION_SQL = `
SELECT (
  current_user NOT IN ('postgres', 'service_role', 'supabase_admin')
  AND COALESCE((
    SELECT NOT (
      roles.rolsuper OR roles.rolcreatedb OR roles.rolcreaterole OR
      roles.rolreplication OR roles.rolbypassrls
    )
      FROM pg_catalog.pg_roles AS roles
     WHERE roles.rolname = current_user
  ), false)
  AND has_schema_privilege(current_user, 'public', 'USAGE')
  AND replace(current_setting('search_path'), ' ', '') = 'pg_catalog,public'
  AND to_regclass('public.app_attest_challenges') IS NOT NULL
  AND to_regclass('public.app_attest_keys') IS NOT NULL
  AND to_regclass('public.app_attest_route_sessions') IS NOT NULL
  AND to_regclass('public.app_attest_request_ids') IS NOT NULL
  AND to_regclass('public.app_attest_rate_windows') IS NOT NULL
  AND to_regclass('public.app_attest_provider_leases') IS NOT NULL
  AND COALESCE(has_table_privilege(
    current_user, to_regclass('public.app_attest_challenges'), 'SELECT,INSERT,UPDATE'
  ), false)
  AND COALESCE(has_table_privilege(
    current_user, to_regclass('public.app_attest_keys'), 'SELECT,INSERT,UPDATE'
  ), false)
  AND COALESCE(has_table_privilege(
    current_user, to_regclass('public.app_attest_route_sessions'), 'SELECT,INSERT,UPDATE'
  ), false)
  AND COALESCE(has_table_privilege(
    current_user, to_regclass('public.app_attest_request_ids'), 'INSERT'
  ), false)
  AND COALESCE(has_table_privilege(
    current_user, to_regclass('public.app_attest_rate_windows'), 'SELECT,INSERT,UPDATE'
  ), false)
  AND COALESCE(has_table_privilege(
    current_user, to_regclass('public.app_attest_provider_leases'), 'SELECT,INSERT,UPDATE'
  ), false)
) AS admitted`;

export function createOperationalState(options = {}) {
  const logger = options.logger ?? { info() {} };
  const controllers = new Set();
  let accepting = false;
  let dependencyReady = false;
  let providerReady = true;
  let draining = false;
  let lastReadiness;
  const isAccepting = () => accepting && dependencyReady && !draining;
  const isReady = () => isAccepting() && providerReady;

  const publishReadiness = () => {
    const readiness = isReady();
    if (readiness === lastReadiness) return;
    lastReadiness = readiness;
    try {
      logger.info({
        event: "readiness_changed",
        state: readiness ? "ready" : "not_ready"
      });
    } catch {}
  };

  return Object.freeze({
    isAccepting() {
      return isAccepting();
    },
    isReady() {
      return isReady();
    },
    markStarted() {
      if (draining) return;
      accepting = true;
      publishReadiness();
    },
    setDependencyReady(value) {
      dependencyReady = value === true;
      publishReadiness();
    },
    setProviderReady(value) {
      providerReady = value === true;
      publishReadiness();
    },
    beginDrain() {
      draining = true;
      accepting = false;
      publishReadiness();
    },
    register(controller) {
      if (!isAccepting()) return false;
      controllers.add(controller);
      return true;
    },
    unregister(controller) {
      controllers.delete(controller);
    },
    abortInflight() {
      for (const controller of controllers) controller.abort();
    },
    inflightCount() {
      return controllers.size;
    }
  });
}

export async function startStandaloneIntentService(options = {}) {
  const env = options.env ?? process.env;
  const logger = options.logger ?? createOperationalLogger(options.loggerOptions);
  const preflight = assertProductionConfiguration(env);
  const http = httpServerConfiguration(env);
  const PoolClass = options.PoolClass ?? Pool;
  const ownedPools = [];
  const operationalState = createOperationalState({ logger });
  let pools;
  let server;
  let monitor;
  let databaseState;
  let shutdownPromise;

  try {
    publishCapabilityStates(logger, preflight.capabilities);
    pools = createRuntimePools(env, PoolClass, ownedPools, () => {
      operationalState.setDependencyReady(false);
      databaseState?.publish(false);
      databaseState?.publishError();
    });
    databaseState = createDatabaseStatePublisher({ logger, pools: pools.required });
    const appAttestRepository = new PostgresAppAttestRepository({
      pool: pools.appSecurity
    });
    const appAttestRuntime = createAppAttestRuntime({
      env,
      appAttestRepository
    });
    if (
      appAttestRuntime.repository?.isDurable !== true ||
      !appAttestRuntime.verifier
    ) {
      throw new TypeError("production_runtime_unavailable");
    }

    server = createIntentServer({
      env,
      logger,
      operationalState,
      appAttestRuntime,
      appAttestRepository,
      postgresPool: pools.outdoorEvidence,
      outdoorResearchPool: pools.outdoorResearch,
      outdoorResearchCancellationPool: pools.outdoorResearchCancellation
    });
    configureHttpServer(server, http);
    await probeRequiredPools(pools.required, http.headersTimeoutMs, options);
    operationalState.setDependencyReady(true);
    databaseState.publish(true);
    await listen(server, http.port, http.host);
    operationalState.markStarted();
    monitor = startReadinessMonitor({
      pools: pools.required,
      operationalState,
      intervalMs: http.readinessProbeIntervalMs,
      timeoutMs: http.headersTimeoutMs,
      databaseState,
      options
    });
    safeLog(logger, "info", {
      event: "service_started",
      releaseStage: env.TRAILMIND_RELEASE_STAGE
    });

    const shutdown = (reason = "operator") => {
      if (shutdownPromise) return shutdownPromise;
      shutdownPromise = drainAndShutdown({
        server,
        pools: pools.owned,
        operationalState,
        monitor,
        logger,
        reason,
        deadlineMs: http.shutdownDeadlineMs,
        options
      });
      return shutdownPromise;
    };
    const removeSignalHandlers = installSignalHandlers(options.process ?? process, shutdown);
    return Object.freeze({
      server,
      preflight,
      operationalState,
      async shutdown(reason) {
        try {
          return await shutdown(reason);
        } finally {
          removeSignalHandlers();
        }
      }
    });
  } catch (error) {
    monitor?.stop();
    operationalState.beginDrain();
    await cleanupPartialStartup({
      server,
      pools: ownedPools,
      deadlineMs: http.shutdownDeadlineMs,
      options
    });
    throw error;
  }
}

export function configureHttpServer(server, configuration) {
  server.headersTimeout = configuration.headersTimeoutMs;
  server.requestTimeout = configuration.requestTimeoutMs;
  server.keepAliveTimeout = configuration.keepAliveTimeoutMs;
  server.maxHeadersCount = configuration.maximumHeaders;
  server.maxRequestsPerSocket = 1_000;
  return server;
}

export async function probeRequiredPools(pools, timeoutMs, options = {}) {
  const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
  const probes = pools.map(async (target) => {
    const descriptor = target?.pool ? target : undefined;
    const pool = descriptor?.pool ?? target;
    const result = await pool.query(descriptor?.query ?? "SELECT 1");
    if (descriptor?.requiresAdmission === true && result?.rows?.[0]?.admitted !== true) {
      throw new Error("database_runtime_admission_failed");
    }
  });
  await withDeadline(Promise.all(probes), timeoutMs, setTimeoutImpl, clearTimeoutImpl);
}

function createRuntimePools(env, PoolClass, owned = [], onPoolError) {
  const required = [];
  const appConfig = appAttestDatabaseConfiguration(env);
  const appSecurity = createPool(
    PoolClass,
    env.APP_ATTEST_DATABASE_URL,
    appConfig,
    {
      idleTransactionTimeoutMs: appConfig.idleTransactionTimeoutMs,
      startupOptions: "-c search_path=pg_catalog,public"
    },
    onPoolError
  );
  owned.push(appSecurity);
  required.push({
    id: "app_security",
    pool: appSecurity,
    query: APP_ATTEST_RUNTIME_ADMISSION_SQL,
    requiresAdmission: true
  });

  let outdoorResearch;
  let outdoorResearchCancellation;
  if (flagEnabled(env.OUTDOOR_RESEARCH_PLANNING_ENABLED)) {
    const researchConfig = researchDatabaseConfiguration(env);
    outdoorResearch = createPool(
      PoolClass,
      env.OUTDOOR_RESEARCH_DATABASE_URL,
      researchConfig,
      {},
      onPoolError
    );
    owned.push(outdoorResearch);
    required.push(outdoorResearch);
    outdoorResearchCancellation = createPool(
      PoolClass,
      env.OUTDOOR_RESEARCH_CANCELLATION_DATABASE_URL,
      {
        ...researchConfig,
        maximumConnections: 1,
        statementTimeoutMs: 1_000
      },
      {},
      onPoolError
    );
    owned.push(outdoorResearchCancellation);
    required.push(outdoorResearchCancellation);
  }

  let outdoorEvidence;
  if (flagEnabled(env.OUTDOOR_EVIDENCE_PROVIDER_ENABLED)) {
    const evidenceConfig = evidenceDatabaseConfiguration(env);
    outdoorEvidence = createPool(
      PoolClass,
      env.OUTDOOR_EVIDENCE_DATABASE_URL,
      evidenceConfig,
      {},
      onPoolError
    );
    owned.push(outdoorEvidence);
    required.push(outdoorEvidence);
  }
  return {
    appSecurity,
    outdoorResearch,
    outdoorResearchCancellation,
    outdoorEvidence,
    owned,
    required
  };
}

function createPool(
  PoolClass,
  connectionString,
  configuration,
  overrides = {},
  onPoolError
) {
  const pool = new PoolClass({
    connectionString,
    max: configuration.maximumConnections,
    connectionTimeoutMillis: configuration.connectionTimeoutMs,
    idleTimeoutMillis: configuration.idleTimeoutMs,
    query_timeout: configuration.statementTimeoutMs,
    statement_timeout: configuration.statementTimeoutMs,
    idle_in_transaction_session_timeout:
      overrides.idleTransactionTimeoutMs ??
      Math.max(configuration.statementTimeoutMs * 2, 10_000),
    ...(overrides.startupOptions ? { options: overrides.startupOptions } : {}),
    allowExitOnIdle: true
  });
  if (typeof pool.on === "function") {
    pool.on("error", () => onPoolError?.());
  }
  return pool;
}

function startReadinessMonitor({
  pools,
  operationalState,
  intervalMs,
  timeoutMs,
  databaseState,
  options
}) {
  const setIntervalImpl = options.setIntervalImpl ?? setInterval;
  const clearIntervalImpl = options.clearIntervalImpl ?? clearInterval;
  let running = false;
  const poll = async () => {
    if (running) return;
    running = true;
    databaseState?.publishPressure();
    try {
      await probeRequiredPools(pools, timeoutMs, options);
      operationalState.setDependencyReady(true);
      databaseState?.publish(true);
    } catch {
      operationalState.setDependencyReady(false);
      databaseState?.publish(false);
    } finally {
      running = false;
    }
  };
  const timer = setIntervalImpl(poll, intervalMs);
  timer?.unref?.();
  return Object.freeze({ stop() { clearIntervalImpl(timer); } });
}

function createDatabaseStatePublisher({ logger, pools }) {
  let previous;
  let available = false;
  let errorPublished = false;
  const publish = (state, pressure, level) => {
    const next = `${state}:${pressure}`;
    if (next === previous) return;
    previous = next;
    safeLog(logger, level, {
      event: "database_pool_state_changed",
      state,
      pressure
    });
  };
  return Object.freeze({
    publish(value) {
      available = value === true;
      if (available) errorPublished = false;
      publish(
        available ? "available" : "unavailable",
        available ? aggregatePoolPressure(pools) : "unknown",
        available ? "info" : "warn"
      );
    },
    publishPressure() {
      if (!available) return;
      publish("available", aggregatePoolPressure(pools), "info");
    },
    publishError() {
      if (errorPublished) return;
      errorPublished = true;
      safeLog(logger, "warn", { event: "database_pool_error" });
    }
  });
}

function aggregatePoolPressure(targets) {
  const pools = targets.map((target) => target?.pool ?? target).filter(Boolean);
  if (pools.some((pool) => Number(pool.waitingCount) > 0)) return "waiting";
  if (pools.some((pool) => {
    const maximum = Number(pool.options?.max);
    return Number.isFinite(maximum) && maximum > 0 &&
      Number(pool.totalCount) >= maximum && Number(pool.idleCount) === 0;
  })) return "saturated";
  if (pools.some((pool) => Number(pool.totalCount) > Number(pool.idleCount))) return "busy";
  return pools.every((pool) =>
    Number.isFinite(Number(pool.totalCount)) && Number.isFinite(Number(pool.idleCount))
  ) ? "normal" : "unknown";
}

function publishCapabilityStates(logger, capabilities) {
  for (const capability of capabilities ?? []) {
    safeLog(logger, "info", {
      event: "runtime_capability_state",
      capability: capability.id,
      state: capability.state
    });
  }
}

export async function drainAndShutdown({
  server,
  pools,
  operationalState,
  monitor,
  logger,
  reason,
  deadlineMs,
  options
}) {
  const now = options?.now ?? Date.now;
  const deadlineAt = now() + deadlineMs;
  operationalState.beginDrain();
  monitor?.stop();
  safeLog(logger, "info", {
    event: "service_draining",
    reason: safeReason(reason)
  });
  server.closeIdleConnections?.();
  const closePromise = closeServer(server);
  const graceful = await settlesBefore(
    closePromise,
    remainingMilliseconds(deadlineAt, now),
    options
  );
  if (!graceful) {
    operationalState.abortInflight();
    server.closeAllConnections?.();
  }
  const poolsClosed = await settlesBefore(
    closePools(pools),
    remainingMilliseconds(deadlineAt, now),
    options
  );
  const outcome = graceful && poolsClosed ? "graceful" : "deadline_exceeded";
  safeLog(logger, "info", { event: "service_stopped", outcome });
  return Object.freeze({ outcome });
}

async function cleanupPartialStartup({ server, pools, deadlineMs, options }) {
  const operations = [closePools(pools)];
  if (server) {
    server.closeIdleConnections?.();
    operations.push(closeServer(server));
    server.closeAllConnections?.();
  }
  await settlesBefore(Promise.allSettled(operations), deadlineMs, options);
}

async function closePools(pools) {
  const unique = [...new Set(pools.filter(Boolean))];
  const results = await Promise.allSettled(
    unique.map((pool) => typeof pool.end === "function" ? pool.end() : undefined)
  );
  if (results.some((result) => result.status === "rejected")) {
    throw new Error("pool_shutdown_failed");
  }
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

export function installSignalHandlers(processObject, shutdown) {
  const handlers = new Map();
  for (const signal of ["SIGTERM", "SIGINT"]) {
    const handler = () => {
      shutdown(signal.toLowerCase()).then(
        ({ outcome }) => {
          if (outcome !== "graceful") forceProcessExit(processObject);
        },
        () => { forceProcessExit(processObject); }
      );
    };
    handlers.set(signal, handler);
    processObject.once(signal, handler);
  }
  return () => {
    for (const [signal, handler] of handlers) {
      processObject.removeListener(signal, handler);
    }
  };
}

function forceProcessExit(processObject) {
  processObject.exitCode = 1;
  processObject.exit?.(1);
}

async function settlesBefore(promise, milliseconds, options = {}) {
  const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
  try {
    await withDeadline(promise, milliseconds, setTimeoutImpl, clearTimeoutImpl);
    return true;
  } catch {
    return false;
  }
}

function withDeadline(promise, milliseconds, setTimeoutImpl, clearTimeoutImpl) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeoutImpl(() => reject(new Error("operation_deadline_exceeded")), milliseconds);
    timer?.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeoutImpl(timer));
}

function safeReason(value) {
  const text = typeof value === "string" ? value.toLowerCase() : "operator";
  return ["sigterm", "sigint", "operator", "test"].includes(text)
    ? text
    : "operator";
}

function safeLog(logger, level, event) {
  try {
    logger?.[level]?.(event);
  } catch {}
}

function remainingMilliseconds(deadlineAt, now) {
  return Math.max(0, deadlineAt - now());
}
