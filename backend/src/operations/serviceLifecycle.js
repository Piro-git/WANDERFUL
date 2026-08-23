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

export function createOperationalState(options = {}) {
  const logger = options.logger ?? { info() {} };
  const controllers = new Set();
  let accepting = false;
  let dependencyReady = false;
  let draining = false;
  let lastReadiness;
  const isAccepting = () => accepting && dependencyReady && !draining;

  const publishReadiness = () => {
    const readiness = accepting && dependencyReady && !draining;
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
      return isAccepting();
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
  let shutdownPromise;

  try {
    pools = createRuntimePools(env, PoolClass, ownedPools);
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
    await listen(server, http.port, http.host);
    operationalState.markStarted();
    monitor = startReadinessMonitor({
      pools: pools.required,
      operationalState,
      intervalMs: http.readinessProbeIntervalMs,
      timeoutMs: http.headersTimeoutMs,
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
  const probes = pools.map((pool) => pool.query("SELECT 1"));
  await withDeadline(Promise.all(probes), timeoutMs, setTimeoutImpl, clearTimeoutImpl);
}

function createRuntimePools(env, PoolClass, owned = []) {
  const required = [];
  const appConfig = appAttestDatabaseConfiguration(env);
  const appSecurity = createPool(
    PoolClass,
    env.APP_ATTEST_DATABASE_URL,
    appConfig,
    { idleTransactionTimeoutMs: appConfig.idleTransactionTimeoutMs }
  );
  owned.push(appSecurity);
  required.push(appSecurity);

  let outdoorResearch;
  let outdoorResearchCancellation;
  if (flagEnabled(env.OUTDOOR_RESEARCH_PLANNING_ENABLED)) {
    const researchConfig = researchDatabaseConfiguration(env);
    outdoorResearch = createPool(
      PoolClass,
      env.OUTDOOR_RESEARCH_DATABASE_URL,
      researchConfig
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
      }
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
      evidenceConfig
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

function createPool(PoolClass, connectionString, configuration, overrides = {}) {
  return new PoolClass({
    connectionString,
    max: configuration.maximumConnections,
    connectionTimeoutMillis: configuration.connectionTimeoutMs,
    idleTimeoutMillis: configuration.idleTimeoutMs,
    query_timeout: configuration.statementTimeoutMs,
    statement_timeout: configuration.statementTimeoutMs,
    idle_in_transaction_session_timeout:
      overrides.idleTransactionTimeoutMs ??
      Math.max(configuration.statementTimeoutMs * 2, 10_000),
    allowExitOnIdle: true
  });
}

function startReadinessMonitor({
  pools,
  operationalState,
  intervalMs,
  timeoutMs,
  options
}) {
  const setIntervalImpl = options.setIntervalImpl ?? setInterval;
  const clearIntervalImpl = options.clearIntervalImpl ?? clearInterval;
  let running = false;
  const poll = async () => {
    if (running) return;
    running = true;
    try {
      await probeRequiredPools(pools, timeoutMs, options);
      operationalState.setDependencyReady(true);
    } catch {
      operationalState.setDependencyReady(false);
    } finally {
      running = false;
    }
  };
  const timer = setIntervalImpl(poll, intervalMs);
  timer?.unref?.();
  return Object.freeze({ stop() { clearIntervalImpl(timer); } });
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
